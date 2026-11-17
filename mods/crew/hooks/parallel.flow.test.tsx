import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { HEARTBEAT_MS } from './live'
import { accepted, approve, command, designed, done, NOW, paneText, paneUi, ROOT, SPLIT, tested, textOf, world, write } from './world'

/**
 * Builds side by side: tasks that touch different files go to builders of
 * their own, each on a branch and worktree of its own, and crew merges each
 * back into its branch once the tech lead approves it, one at a time.
 */

/** Two tasks on files of their own: they may build at once. */
const APART = [
  { op: 'add_task', feature: 'PRD-001', criteria: ['AC-001'], title: '方案頁', detail: '', size: 'S', touches: ['src/plan.ts'] },
  { op: 'add_task', feature: 'PRD-002', criteria: ['AC-002'], title: '取消流程', detail: '', size: 'S', touches: ['src/cancel.ts'] },
]

const call = ($: Engine, tool: string, input: Record<string, unknown>, agentId?: string) =>
  $.tool.call({ tool: `mcp__crew__${tool}`, tool_use_id: `v-${Math.random()}`, ...(agentId === undefined ? {} : { agentId }), ...input } as never) as Promise<{ result: unknown }>

const planned = async ($: Engine, plan: readonly unknown[] = APART) => {
  await $.command.run(command('start docs/PRD.md'))
  await write($, 'a-pm-1', SPLIT)
  await done($, 'a-pm-1')
  await write($, 'a-qa-2', [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }])
  await done($, 'a-qa-2')
  await designed($)
  await write($, 'a-techlead-4', [...plan])
  await done($, 'a-techlead-4')
}

/** Lets the merges and test runs crew started apart from the step go to their ends. */
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await tested()
}

describe('builds side by side', () => {
  test('two tasks on files of their own build at once, each in its own worktree, and merge back one at a time', async ($, on) => {
    const w = world($, on)
    w.store.set(`settings:${ROOT}`, { agents: 4 })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    await planned($)
    const builders = w.spawned.filter(s => s.subagentType === 'crew:fullstack')
    expect(builders.map(s => s.cwd)).toEqual([`${ROOT}/.crew/work/prd-t001`, `${ROOT}/.crew/work/prd-t002`])
    expect(builders[0]?.prompt).toMatch(/請實作 TASK-001[\s\S]*分支 crew\/prd-task-001/)
    expect(builders[1]?.prompt).toMatch(/請實作 TASK-002[\s\S]*分支 crew\/prd-task-002/)
    // Each branch starts from crew's branch.
    expect(w.git.branches.get('crew/prd-task-001')?.[0]?.sha).toBe(w.git.branches.get('crew/prd')?.[0]?.sha)
    // Each builder has its row in the overview, and the log names it the same.
    expect(await paneText($, 'overview')).toMatch(/全端 2[\s\S]*TASK-002/)
    expect(await paneText($, 'log')).toMatch(/crew → 全端 2/)

    const one = w.commit('TASK-001: 方案頁', 'crew/prd-task-001')
    await done($, 'a-fullstack-5')
    // The tech lead reviews the first; the second builder is still at work.
    expect(w.sent.at(-1)).toMatchObject({ to: 'a-techlead-4' })
    expect(w.sent.at(-1)?.text).toMatch(/請 review TASK-001/)
    const two = w.commit('TASK-002: 取消流程', 'crew/prd-task-002')
    await done($, 'a-fullstack-6')
    expect(w.board()?.prd_items.flatMap(i => i.tasks ?? []).map(t => (t as { crew_unmerged?: string }).crew_unmerged)).toEqual([one, two])

    await approve($, 'TASK-001')
    // The second review starts while the first merges back.
    expect(w.sent.at(-1)?.text).toMatch(/請 review TASK-002/)
    await settle()
    const main = w.git.branches.get('crew/prd') ?? []
    expect(main[0]?.subject).toBe('crew: 合回 TASK-001')
    expect(main.some(c => c.sha === one)).toBe(true)
    expect(main.some(c => c.sha === two)).toBe(false)

    await approve($, 'TASK-002')
    await settle()
    expect((w.git.branches.get('crew/prd') ?? [])[0]?.subject).toBe('crew: 合回 TASK-002')
    // Each task merged back leaves no worktree or branch of its own behind.
    expect([...w.git.branches.keys()].filter(b => b.startsWith('crew/prd-task-'))).toEqual([])
    expect([...w.git.worktrees.keys()].filter(d => /prd-t\d+$/.test(d))).toEqual([])
    // Tests ran after each merge, in crew's worktree; the flow's own run on the last merge is that one.
    expect(w.tests.runs.every(r => r.cwd === `${ROOT}/.crew/work/prd`)).toBe(true)
    expect(w.tests.runs).toHaveLength(2)
    // Built and tested: QA hands each feature over and the person passes it.
    await accepted($)
    expect((await $.command.run(command('status'))).text).toMatch(/done/)
  })

  test('a merge that conflicts is taken back, and the task goes back to its builder with crew’s changes', async ($, on) => {
    const w = world($, on)
    w.store.set(`settings:${ROOT}`, { agents: 4 })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    await planned($)
    const one = w.commit('TASK-001: 方案頁', 'crew/prd-task-001')
    w.git.conflicts.set(one, ['src/shared.ts'])
    const before = w.git.branches.get('crew/prd')?.[0]?.sha
    await done($, 'a-fullstack-5')
    await approve($, 'TASK-001')
    await settle()
    expect(w.git.branches.get('crew/prd')?.[0]?.sha).toBe(before)
    expect(w.git.commands.some(c => c.includes('--abort'))).toBe(true)
    // Back to the builder that built it, told what conflicts and how to bring crew's branch in.
    const back = w.sent.filter(s => s.to === 'a-fullstack-5').at(-1)
    expect(back?.text).toMatch(/TASK-001[\s\S]*衝突（src\/shared\.ts）[\s\S]*git merge crew\/prd/)
    // The merge it commits is the task's: its subject starts with the task's number.
    expect(back?.text).toMatch(/git commit -m "TASK-001: 合進 crew\/prd，解決衝突"/)
    expect(w.toasts.some(t => /TASK-001 沒有合回（衝突/.test(t))).toBe(true)
  })

  test('a merge that breaks a test that passed is taken back, and the task goes back to its builder', async ($, on) => {
    const w = world($, on)
    w.store.set(`settings:${ROOT}`, { agents: 4 })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    await planned($)
    w.commit('TASK-001: 方案頁', 'crew/prd-task-001')
    await done($, 'a-fullstack-5')
    await approve($, 'TASK-001')
    await settle()
    const merged = w.git.branches.get('crew/prd')?.[0]?.sha
    // The second task's merge breaks TC-001, which passed after the first.
    w.commit('TASK-002: 取消流程', 'crew/prd-task-002')
    await done($, 'a-fullstack-6')
    w.tests.stdout = '✗ TC-001 fails'
    w.tests.exitCode = 1
    await approve($, 'TASK-002')
    await settle()
    expect(w.git.branches.get('crew/prd')?.[0]?.sha).toBe(merged)
    const back = w.sent.filter(s => s.to === 'a-fullstack-6').at(-1)
    expect(back?.text).toMatch(/TASK-002[\s\S]*原本通過的測試失敗了（TC-001/)
    // The log names the builder the work went back to, as its start did.
    expect(await paneText($, 'log')).toMatch(/crew → 全端 2[\s\S]*TASK-002[\s\S]*原本通過的測試失敗了/)
  })

  test('the tech lead hears of files a commit changes beyond what its task said it changes', async ($, on) => {
    const w = world($, on)
    w.store.set(`settings:${ROOT}`, { agents: 4 })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    await planned($)
    // The builder is told which files are its task's.
    expect(w.spawned.find(s => /請實作 TASK-001/.test(s.prompt))?.prompt).toMatch(/要改的地方（Tech lead 規劃的）：src\/plan\.ts。/)
    w.commit('TASK-001: 方案頁', 'crew/prd-task-001', ['src/plan.ts', 'src/cancel.ts'])
    await done($, 'a-fullstack-5')
    const review = w.sent.at(-1)
    expect(review?.to).toBe('a-techlead-4')
    expect(review?.text).toMatch(/全端的工作目錄：\/repo\/\.crew\/work\/prd-t001（分支 crew\/prd-task-001/)
    expect(review?.text).toMatch(/touches（src\/plan\.ts）以外的檔案：src\/cancel\.ts。/)
  })

  test('tasks that do not say their files are built one at a time until the tech lead says them, then side by side', async ($, on) => {
    const w = world($, on)
    w.store.set(`settings:${ROOT}`, { agents: 4 })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    // Planned the way a board before builds side by side was: no files said.
    await planned($, APART.map(({ touches: _, ...t }) => t))
    expect(w.spawned.filter(s => s.subagentType === 'crew:fullstack')).toHaveLength(1)
    // The tech lead is asked once to say the files of both, the one under way included.
    const asked = w.sent.at(-1)
    expect(asked).toMatchObject({ to: 'a-techlead-4' })
    expect(asked?.text).toMatch(/最多可以讓 4 個 agent 同時做[\s\S]*沒寫會改哪些檔案[\s\S]*TASK-001、TASK-002[\s\S]*set_task/)
    expect(String((await $.command.run(command('status'))).text)).toMatch(/TASK-002[^\n]*沒寫會改哪些檔案/)
    await write($, 'a-techlead-4', [
      { op: 'set_task', id: 'TASK-001', touches: ['src/plan.ts'], layer: 'ui' },
      { op: 'set_task', id: 'TASK-002', touches: ['src/cancel.ts'], layer: 'be' },
    ])
    const sent = w.sent.length
    await done($, 'a-techlead-4')
    // Files of their own: the second starts beside the first, on a branch of its own; the tech lead is not asked again.
    expect(w.spawned.filter(s => s.subagentType === 'crew:fullstack').map(s => s.cwd)).toEqual([`${ROOT}/.crew/work/prd-t001`, `${ROOT}/.crew/work/prd-t002`])
    expect(w.sent.slice(sent).some(m => /沒寫會改哪些檔案/.test(m.text))).toBe(false)
  })

  test('the tech lead saying the files of tasks answers no builder’s question: its thread does', async ($, on) => {
    const w = world($, on)
    w.store.set(`settings:${ROOT}`, { agents: 4 })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    await planned($, APART.map(({ touches: _, ...t }) => t))
    // The builder asks the tech lead while it says the files, and stops to wait.
    await call($, 'thread_post', { item: 'TASK-001', to: 'techlead', text: '價格要含稅嗎？' }, 'a-fullstack-5')
    await done($, 'a-fullstack-5')
    const spawned = w.spawned.length
    await write($, 'a-techlead-4', [
      { op: 'set_task', id: 'TASK-001', touches: ['src/plan.ts'], layer: 'ui' },
      { op: 'set_task', id: 'TASK-002', touches: ['src/cancel.ts'], layer: 'be' },
    ])
    await done($, 'a-techlead-4', '補了 2 件 touches，都看得出來。')
    // Its report is no answer: the builder is not started on it, and the tech lead hears of the question.
    expect(w.spawned.slice(spawned).some(s => /補了 2 件/.test(s.prompt))).toBe(false)
    expect(w.sent.at(-1)).toMatchObject({ to: 'a-techlead-4' })
    expect(w.sent.at(-1)?.text).toMatch(/TASK-001/)
    expect(w.sent.at(-1)?.text).not.toMatch(/Tech lead 在這些項目的討論串留言給你/)
    await call($, 'thread_post', { item: 'TASK-001', to: 'fullstack', text: '要含稅。' }, 'a-techlead-4')
    await done($, 'a-techlead-4', '回覆了 TASK-001。')
    const told = [...w.sent.map(m => m.text), ...w.spawned.slice(spawned).map(s => s.prompt)].join('\n')
    expect(told).toMatch(/Tech lead 在這些項目的討論串留言給你：TASK-001。[\s\S]*請接著做 TASK-001/)
    expect(told).not.toMatch(/補了 2 件/)
  })

  test('one at a time, the tech lead is not asked for the files of tasks', async ($, on) => {
    const w = world($, on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    await planned($, APART.map(({ touches: _, ...t }) => t))
    expect(w.sent.some(m => /沒寫會改哪些檔案/.test(m.text))).toBe(false)
  })

  test('more agents set while building start the next task at once, and its merge waits for the builder in crew’s worktree', async ($, on) => {
    const w = world($, on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    await planned($)
    expect(w.spawned.filter(s => s.subagentType === 'crew:fullstack').map(s => s.cwd)).toEqual([`${ROOT}/.crew/work/prd`])
    const ui = await paneUi($)
    await ui.press({ key: 'tab-settings' })
    // What the number means is behind its 「?」.
    await ui.press({ key: 'help-agents' })
    expect(await textOf(ui)).toMatch(/同時做任務[\s\S]*一次做一件任務/)
    await ui.press({ key: 'agents-2' })
    expect(await textOf(ui)).toMatch(/最多 2 個同時做/)
    await ui.unmount()
    expect(w.store.get(`settings:${ROOT}`)).toMatchObject({ agents: 2 })
    // The second task starts now, on a branch of its own; the first goes on in crew's worktree.
    expect(w.spawned.filter(s => s.subagentType === 'crew:fullstack').map(s => s.cwd)).toEqual([`${ROOT}/.crew/work/prd`, `${ROOT}/.crew/work/prd-t002`])

    const two = w.commit('TASK-002: 取消流程', 'crew/prd-task-002')
    await done($, 'a-fullstack-6')
    await approve($, 'TASK-002')
    await settle()
    // The first builder still works in crew's worktree: the merge waits for its run.
    expect((w.git.branches.get('crew/prd') ?? []).some(c => c.sha === two)).toBe(false)
    expect(w.toasts.some(t => /TASK-002 等全端這一輪做完再合回/.test(t))).toBe(true)
    w.commit('TASK-001: 方案頁', 'crew/prd')
    await done($, 'a-fullstack-5')
    await settle()
    expect((w.git.branches.get('crew/prd') ?? [])[0]?.subject).toBe('crew: 合回 TASK-002')
  })

  test('a question to the full-stack waits while crew merges in crew’s worktree, and goes in after', async ($, on) => {
    const w = world($, on)
    w.store.set(`settings:${ROOT}`, { agents: 4 })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    await planned($)
    w.commit('TASK-001: 方案頁', 'crew/prd-task-001')
    await done($, 'a-fullstack-5')
    w.tests.ms = 1_000
    await approve($, 'TASK-001')
    const before = w.sent.length + w.spawned.length
    await $.command.run(command('ask fullstack 用了什麼框架？'))
    // Nothing goes to the full-stack while its worktree is being merged into and tested.
    expect(w.sent.length + w.spawned.length).toBe(before)
    expect(await paneText($, 'overview')).toMatch(/等 crew 合回完成/)
    // The task approved is not done till it is on crew's branch.
    expect(await paneText($, 'board')).toMatch(/TASK-001[\s\S]*review 通過 · crew 合回中/)
    // crew's branch moves only once the merge's tests pass: a branch made from it meanwhile holds none of it.
    expect((w.git.branches.get('crew/prd') ?? [])[0]?.subject).not.toBe('crew: 合回 TASK-001')
    await w.clock.advance(1_000)
    await settle()
    expect((w.git.branches.get('crew/prd') ?? [])[0]?.subject).toBe('crew: 合回 TASK-001')
    const asked = [...w.sent.map(m => m.text), ...w.spawned.map(m => m.prompt)].filter(t => /用了什麼框架/.test(t))
    expect(asked.length).toBe(1)
  })

  test('past the usage warn line one agent works at a time, and back under it the others start without waiting for a run to end', async ($, on) => {
    const w = world($, on)
    w.store.set(`settings:${ROOT}`, { agents: 4 })
    w.limits.push({ kind: 'five_hour', percentUsed: 85, resetsAt: new Date(NOW + 3 * 3_600_000).toISOString() })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    await planned($)
    expect(w.spawned.filter(s => s.subagentType === 'crew:fullstack').map(s => s.cwd)).toEqual([`${ROOT}/.crew/work/prd-t001`])
    w.limits.splice(0, 1, { kind: 'five_hour', percentUsed: 40, resetsAt: new Date(NOW + 3 * 3_600_000).toISOString() })
    await w.clock.advance(HEARTBEAT_MS)
    // A timer starts no Claude agent: the second builder waits for Claude Code's next frame, any press in the pane.
    expect(w.spawned.filter(s => s.subagentType === 'crew:fullstack')).toHaveLength(1)
    const ui = await paneUi($)
    await ui.press({ key: 'tab-overview' })
    await ui.unmount()
    expect(w.spawned.filter(s => s.subagentType === 'crew:fullstack').map(s => s.cwd)).toEqual([`${ROOT}/.crew/work/prd-t001`, `${ROOT}/.crew/work/prd-t002`])
  })

  test('a merge cut short by a restart leaves crew’s worktree off its branch: the next merge puts it back first', async ($, on) => {
    const w = world($, on)
    w.store.set(`settings:${ROOT}`, { agents: 4 })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    await planned($)
    const one = w.commit('TASK-001: 方案頁', 'crew/prd-task-001')
    await done($, 'a-fullstack-5')
    // As a merge leaves it before its tests end: detached, on a line that is no branch.
    const dir = `${ROOT}/.crew/work/prd`
    w.git.branches.set(`HEAD@${dir}`, [...(w.git.branches.get('crew/prd') ?? [])])
    w.git.worktrees.set(dir, `HEAD@${dir}`)
    await approve($, 'TASK-001')
    await settle()
    expect(w.git.worktrees.get(dir)).toBe('crew/prd')
    expect((w.git.branches.get('crew/prd') ?? []).some(c => c.sha === one)).toBe(true)
  })

  test('the flow’s test run takes the run crew made on the last merge, on the same commit, as it is', async ($, on) => {
    const w = world($, on)
    w.store.set(`settings:${ROOT}`, { agents: 4 })
    // TC-001 fails from the start: no merge broke it, so none is taken back.
    w.tests.stdout = '✗ TC-001 fails'
    w.tests.exitCode = 1
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    await planned($)
    w.commit('TASK-001: 方案頁', 'crew/prd-task-001')
    await done($, 'a-fullstack-5')
    w.commit('TASK-002: 取消流程', 'crew/prd-task-002')
    await done($, 'a-fullstack-6')
    await approve($, 'TASK-001')
    await settle()
    await approve($, 'TASK-002')
    await settle()
    expect((w.git.branches.get('crew/prd') ?? [])[0]?.subject).toBe('crew: 合回 TASK-002')
    // No third run: the tests on crew's branch's tip ran at its merge.
    expect(w.tests.runs).toHaveLength(2)
    expect(w.toasts.some(t => /測試沒有重跑：commit [0-9a-f]{7} 在合回時跑過了（exit 1）/.test(t))).toBe(true)
    // What failed there goes to the builder, with that run's output.
    const told = [...w.sent.map(m => m.text), ...w.spawned.map(m => m.prompt)].filter(t => /TC-001 t：失敗/.test(t))
    expect(told).toHaveLength(1)
    expect(told[0]).toMatch(/✗ TC-001 fails/)
  })

  test('a builder’s question to the person goes back to the builder of its task, not the first slot’s', async ($, on) => {
    const w = world($, on)
    w.store.set(`settings:${ROOT}`, { agents: 4 })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    await planned($)
    const asked = await call($, 'ask_person', { question: '取消後要退款嗎？' }, 'a-fullstack-6')
    const id = /Q-\d+/.exec(String(asked.result))?.[0] ?? ''
    await $.command.run(command(`answer ${id} 不退款`))
    expect(w.sent.filter(m => m.to === 'a-fullstack-6').some(m => /不退款/.test(m.text))).toBe(true)
    expect(w.sent.filter(m => m.to === 'a-fullstack-5').some(m => /不退款/.test(m.text))).toBe(false)
    // The answer is kept on the task's thread too, for whoever takes the task up.
    const thread = await call($, 'thread_read', { item: 'TASK-002' }, 'a-fullstack-6')
    expect(JSON.stringify(thread.result)).toMatch(/取消後要退款嗎？ → 不退款/)
  })

  test('an answer that comes once its task is merged stays on the thread, and is not put to another builder to read', async ($, on) => {
    const w = world($, on)
    w.store.set(`settings:${ROOT}`, { agents: 4 })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    await planned($)
    const asked = await call($, 'ask_person', { question: '取消後要退款嗎？' }, 'a-fullstack-6')
    const id = /Q-\d+/.exec(String(asked.result))?.[0] ?? ''
    w.commit('TASK-002: 取消流程', 'crew/prd-task-002')
    await done($, 'a-fullstack-6')
    await approve($, 'TASK-002')
    await settle()
    expect((w.git.branches.get('crew/prd') ?? [])[0]?.subject).toBe('crew: 合回 TASK-002')
    await $.command.run(command(`answer ${id} 不退款`))
    const thread = await call($, 'thread_read', { item: 'TASK-002' }, 'a-fullstack-5')
    expect(JSON.stringify(thread.result)).toMatch(/取消後要退款嗎？ → 不退款/)
    // Slot 1's builder goes on with TASK-001 alone: the done task's thread is not pointed out to it.
    await done($, 'a-fullstack-5')
    const back = w.sent.filter(m => m.to === 'a-fullstack-5').at(-1)
    expect(back?.text).toMatch(/TASK-001 還沒有 commit/)
    expect(back?.text).not.toMatch(/TASK-002/)
  })

  test('a builder reads its own task’s thread: what is posted on another builder’s task is not put to it', async ($, on) => {
    const w = world($, on)
    w.store.set(`settings:${ROOT}`, { agents: 4 })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    await planned($)
    await call($, 'thread_post', { item: 'TASK-002', to: 'fullstack', text: '取消要寫進 log' }, 'a-techlead-4')
    await done($, 'a-techlead-4')
    // The first builder's run ends with nothing committed: it is told to go on with TASK-001 alone.
    await done($, 'a-fullstack-5')
    const back = w.sent.filter(m => m.to === 'a-fullstack-5').at(-1)
    expect(back?.text).toMatch(/TASK-001 還沒有 commit/)
    expect(back?.text).not.toMatch(/TASK-002/)
  })

  test('a run in crew’s worktree that ends in an error lets the merge that waited for it go in', async ($, on) => {
    const w = world($, on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    await planned($)
    const ui = await paneUi($)
    await ui.press({ key: 'tab-settings' })
    await ui.press({ key: 'agents-2' })
    await ui.unmount()
    const two = w.commit('TASK-002: 取消流程', 'crew/prd-task-002')
    await done($, 'a-fullstack-6')
    await approve($, 'TASK-002')
    await settle()
    expect((w.git.branches.get('crew/prd') ?? []).some(c => c.sha === two)).toBe(false)
    await $.turn.complete({ answer: '', durationMs: 5, isAborted: false, turnId: 'turn-cut', reason: 'error', agentId: 'a-fullstack-5' } as never)
    await settle()
    expect((w.git.branches.get('crew/prd') ?? [])[0]?.subject).toBe('crew: 合回 TASK-002')
  })

  test('接續 waits while crew merges a task back', async ($, on) => {
    const w = world($, on)
    w.store.set(`settings:${ROOT}`, { agents: 4 })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    await planned($)
    w.commit('TASK-001: 方案頁', 'crew/prd-task-001')
    await done($, 'a-fullstack-5')
    w.tests.ms = 1_000
    await approve($, 'TASK-001')
    await done($, 'a-fullstack-6')
    expect((await $.command.run(command('resume'))).text).toMatch(/正在合回任務/)
    await w.clock.advance(1_000)
    await settle()
    expect((w.git.branches.get('crew/prd') ?? [])[0]?.subject).toBe('crew: 合回 TASK-001')
  })

  test('two builders that end at the same moment both reach the flow: one review at a time, and none lost', async ($, on) => {
    const w = world($, on)
    w.store.set(`settings:${ROOT}`, { agents: 4 })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    await planned($)
    w.commit('TASK-001: 方案頁', 'crew/prd-task-001')
    w.commit('TASK-002: 取消流程', 'crew/prd-task-002')
    await Promise.all([done($, 'a-fullstack-5'), done($, 'a-fullstack-6')])
    // One review is asked for; the other task waits for it rather than being asked of the same tech lead beside it.
    const asked = () => w.sent.filter(s => s.to === 'a-techlead-4' && /請 review TASK-00\d/.test(s.text)).map(s => /請 review (TASK-00\d)/.exec(s.text)?.[1])
    expect(asked()).toHaveLength(1)
    const first = asked()[0] ?? ''
    const second = first === 'TASK-001' ? 'TASK-002' : 'TASK-001'
    await approve($, first)
    // The other is reviewed once the first is in: its builder's end was not lost.
    expect(asked()).toEqual([first, second])
    await settle()
    await approve($, second)
    await settle()
    // Built and tested: QA hands each feature over and the person passes it.
    await accepted($)
    expect((await $.command.run(command('status'))).text).toMatch(/done/)
  })

  test('a builder the person asked something sits in crew’s worktree after: its task goes on with a fresh builder, told the whole task', async ($, on) => {
    const w = world($, on)
    w.store.set(`settings:${ROOT}`, { agents: 4 })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    await planned($)
    // TASK-001's builder asks the tech lead and ends without a commit: it waits for the answer.
    await call($, 'thread_post', { item: 'TASK-001', to: 'techlead', text: '月繳要含稅嗎？' }, 'a-fullstack-5')
    await done($, 'a-fullstack-5')
    // The person asks the full-stack something meanwhile: slot 1's builder answers it in crew's worktree.
    await $.command.run(command('ask fullstack 用了什麼框架？'))
    await done($, 'a-fullstack-5', '用 express')
    await call($, 'thread_post', { item: 'TASK-001', to: 'fullstack', text: '要含稅' }, 'a-techlead-4')
    const before = w.spawned.length
    await done($, 'a-techlead-4')
    // TASK-001 goes on with a builder started afresh in its worktree, told the whole task and what the tech lead said.
    const next = w.spawned.slice(before).find(s => s.subagentType === 'crew:fullstack')
    expect(next?.cwd).toBe(`${ROOT}/.crew/work/prd-t001`)
    expect(next?.prompt).toMatch(/請實作 TASK-001[\s\S]*請接著做 TASK-001/)
  })

  test('a builder that cannot be woken is started afresh in its task’s worktree, told the whole task with what it was to hear', async ($, on) => {
    const w = world($, on)
    w.store.set(`settings:${ROOT}`, { agents: 4 })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    await planned($)
    // TASK-001's builder asks the tech lead and ends without a commit: it waits for the answer.
    await call($, 'thread_post', { item: 'TASK-001', to: 'techlead', text: '月繳要含稅嗎？' }, 'a-fullstack-5')
    await done($, 'a-fullstack-5')
    await call($, 'thread_post', { item: 'TASK-001', to: 'fullstack', text: '要含稅' }, 'a-techlead-4')
    // The answer is for the builder sitting in TASK-001's worktree, which cannot take a message now.
    w.failSends.n = 1
    const before = w.spawned.length
    await done($, 'a-techlead-4')
    expect(w.sent.at(-1)).toMatchObject({ to: 'a-fullstack-5' })
    const next = w.spawned.slice(before).find(s => s.subagentType === 'crew:fullstack')
    expect(next?.cwd).toBe(`${ROOT}/.crew/work/prd-t001`)
    expect(next?.prompt).toMatch(/請實作 TASK-001[\s\S]*對應的驗收條件[\s\S]*請接著做 TASK-001/)
  })

  test('one agent at a time builds on crew’s branch, as before', async ($, on) => {
    const w = world($, on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    await planned($)
    expect(w.spawned.filter(s => s.subagentType === 'crew:fullstack').map(s => s.cwd)).toEqual([`${ROOT}/.crew/work/prd`])
  })
})

describe('the brain asks why a task waits', () => {
  test('work set aside in crew’s worktree goes back only once a merge there and its test run are over, then the builder gets it', async ($, on) => {
    const w = world($, on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    await planned($)
    const ui = await paneUi($)
    await ui.press({ key: 'tab-settings' })
    await ui.press({ key: 'agents-2' })
    await ui.unmount()
    // TASK-001, in crew's worktree, asks the person and stops with work not committed: crew sets it aside.
    w.git.dirty = ' M src/plan.ts\n'
    const asked = await call($, 'ask_person', { question: '金流要用哪一家？' }, 'a-fullstack-5')
    const q = /Q-\d+/.exec(String(asked.result))?.[0] ?? ''
    await done($, 'a-fullstack-5', '問了使用者')
    await settle()
    const ref = [...w.git.refs.keys()].find(k => k.startsWith('refs/crew/shelf/TASK-001/')) ?? ''
    const sha = w.git.refs.get(ref) ?? ''
    expect(sha).not.toBe('')
    expect(w.git.dirty).toBe('')
    // TASK-002, on its own branch, approved: crew merges it into its worktree and runs the tests there, which take a while.
    w.commit('TASK-002: 取消流程', 'crew/prd-task-002')
    await done($, 'a-fullstack-6')
    w.tests.ms = 60_000
    await approve($, 'TASK-002')
    await tested()
    const handed = () => w.sent.filter(m => m.to === 'a-fullstack-5').length + w.spawned.filter(s => s.subagentType === 'crew:fullstack').length
    const before = handed()
    // Answered while the merge's tests run: nothing goes back under them, and the builder waits with its task.
    await $.command.run(command(`answer ${q} 用綠界`))
    await tested()
    expect(w.git.applied).toEqual([])
    expect(w.git.dirty).toBe('')
    expect(handed()).toBe(before)
    // The run over and TASK-002 merged: crew puts TASK-001's work back on top of it, then hands the builder the answer.
    await w.clock.advance(60_000)
    await settle()
    expect((w.git.branches.get('crew/prd') ?? [])[0]?.subject).toMatch(/合回 TASK-002/)
    expect(w.git.applied).toEqual([sha])
    expect(w.git.dirty).toMatch(/src\/plan\.ts/)
    const told = [...w.sent.filter(m => m.to === 'a-fullstack-5').map(m => m.text), ...w.spawned.filter(s => s.subagentType === 'crew:fullstack').map(s => s.prompt ?? '')].find(t => /用綠界/.test(t))
    expect(told).toMatch(new RegExp(`crew 已經把 TASK-001 上一輪改到一半、還沒 commit 的修改放回工作目錄了（原本收在 ${ref}[\\s\\S]*用綠界`))
  })

  test('status says what each task not under way waits for, and the brain is told which copy of crew runs here', async ($, on) => {
    const w = world($, on)
    on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' as const }] }))
    w.store.set(`settings:${ROOT}`, { agents: 4 })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    // Two tasks change the same file; a third waits on the first.
    await planned($, [
      { op: 'add_task', feature: 'PRD-001', criteria: ['AC-001'], title: '方案頁', detail: '', size: 'S', touches: ['src/styles/app-shell.css', 'src/plan.ts'] },
      { op: 'add_task', feature: 'PRD-002', criteria: ['AC-002'], title: '取消流程', detail: '', size: 'S', touches: ['src/styles'] },
      { op: 'add_task', feature: 'PRD-001', criteria: ['AC-001'], title: '方案頁的回歸', detail: '', size: 'S', touches: ['src/plan.test.ts'], after: ['TASK-001'] },
    ])
    expect(w.spawned.filter(s => s.subagentType === 'crew:fullstack')).toHaveLength(1)
    const status = String((await call($, 'crew', { action: 'status' })).result)
    expect(status).toMatch(/等待中：.*TASK-003（等 TASK-001 先做完）/)
    expect(status).toMatch(/TASK-002（和 TASK-001 都改 src\/styles，等它做完）/)
    const sections = (await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: ['mcp__crew__crew'], outputStyle: null, traits: [] } as never)).sections as readonly { text: string }[]
    expect(sections.map(s => s.text).join('\n')).toMatch(/這個 session 的 crew 從 \S+ 載入，只有它在跑。別的資料夾的 crew（例如 ~\/\.claude\/plugins\/cache 底下安裝的版本）沒有在這個 session 跑/)
  })
})
