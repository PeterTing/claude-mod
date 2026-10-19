import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { applyOps, DEFAULT_PREFIXES, newTracker } from './board'
import type { Op } from './board'
import { build, command, done, paneText, PLAN, ROOT, SPLIT, start, world, write } from './world'

/** The full-stack builds the tasks one at a time in crew's own worktree; a commit, not its word, says a task is built. */

/** How crew runs git: the repo's hooks and file monitor off. */
const GIT = 'git -c core.hooksPath=/dev/null -c core.fsmonitor=false'

/** The commit the person's checkout is on when crew makes its branch. */
const BASE = 'c0ffee'.padEnd(40, '0')

/** A board planned for the PRD: features, criteria, test cases and the tech lead's tasks. */
const plannedBoard = (plan: readonly unknown[] = PLAN) => {
  let t = newTracker('repo')
  for (const [by, ops] of [
    ['pm', SPLIT],
    ['qa', [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }]],
    ['techlead', plan],
  ] as const) {
    const r = applyOps(t, ops as unknown as Op[], { by, today: '2026-10-15', prefixes: DEFAULT_PREFIXES })
    if (!r.ok) throw new Error(r.errors.join())
    t = r.tracker
  }
  return t
}

const planned = async ($: Engine) => {
  await $.command.run(command('start docs/PRD.md'))
  await write($, 'a-pm-1', SPLIT)
  await done($, 'a-pm-1')
  await write($, 'a-qa-2', [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }])
  await done($, 'a-qa-2')
  await write($, 'a-techlead-3', PLAN)
  await done($, 'a-techlead-3')
}

describe('the full-stack', () => {
  test('builds in crew’s own worktree and branch, made from the checkout’s HEAD, and kept out of git', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    expect(w.git.commands.some(c => c.join(' ') === `${GIT} -C ${ROOT} worktree add -b crew/prd ${ROOT}/.crew/work/prd ${BASE}`)).toBe(true)
    // crew runs git itself, outside the session's permission prompts: never with the repo's hooks or file monitor.
    expect(w.git.commands.length).toBeGreaterThan(0)
    expect(w.git.commands.every(c => c.slice(0, 5).join(' ') === GIT)).toBe(true)
    expect(w.spawned.at(-1)).toMatchObject({ subagentType: 'crew:fullstack' })
    expect(w.spawned.at(-1)?.prompt).toMatch(/請實作 TASK-001 方案頁[\s\S]*工作目錄：\/repo\/\.crew\/work\/prd（分支 crew\/prd）/)
    expect(w.disk.get(`${ROOT}/.crew/.gitignore`)).toMatch(/work\//)
    expect((await $.command.run(command('status'))).text).toMatch(/building[\s\S]*全端/)
  })

  test('is given the next task only once a commit does the last one, and is sent back when none does', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await done($, 'a-fullstack-4', '做完了')
    expect(w.sent.at(-1)?.to).toBe('a-fullstack-4')
    expect(w.sent.at(-1)?.text).toMatch(/TASK-001 還沒有 commit/)
    w.commit('TASK-001: 方案頁')
    await done($, 'a-fullstack-4')
    expect(w.sent.at(-1)?.text).toMatch(/請實作 TASK-002 取消流程/)
    w.commit('TASK-002: 取消流程')
    await done($, 'a-fullstack-4')
    expect((await $.command.run(command('status'))).text).toMatch(/done/)
    expect(w.toasts.at(-1)).toMatch(/實作 2\/2/)
  })

  test('has the person decide when a task twice ends with no commit', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await done($, 'a-fullstack-4', '卡住了')
    await done($, 'a-fullstack-4', '還是卡住')
    expect((await $.command.run(command('status'))).text).toMatch(/escalated[\s\S]*待你決定 1/)
    expect((await $.command.run(command('answer Q-01 先跳過金流，用假資料'))).text).toMatch(/轉給 全端|轉給全端/)
    expect(w.sent.at(-1)?.to).toBe('a-fullstack-4')
  })

  test('counts a task as built from its commit, not from what the full-stack says', async ($, on) => {
    world($, on)
    await start($)
    await planned($)
    await done($, 'a-fullstack-4', 'TASK-001 和 TASK-002 都做完了')
    const text = await paneText($, 'progress')
    expect(text).toMatch(/實作 0\/2/)
  })

  test('says why it cannot start in a folder that is not a git repo', async ($, on) => {
    const w = world($, on)
    w.git.repo = false
    await start($)
    await planned($)
    expect(w.spawned.map(s => s.subagentType)).toEqual(['crew:pm', 'crew:qa', 'crew:techlead'])
    expect(w.toasts.some(t => /全端沒有開始：這個資料夾不是 git repo/.test(t))).toBe(true)
  })

  test('picks the build up again after Claude Code restarts, at the first task with no commit', async ($, on) => {
    const w = world($, on)
    let t = newTracker('repo')
    for (const [by, ops] of [
      ['pm', SPLIT],
      ['qa', [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }]],
      ['techlead', PLAN],
    ] as const) {
      const r = applyOps(t, ops as unknown as Op[], { by, today: '2026-10-15', prefixes: DEFAULT_PREFIXES })
      if (!r.ok) throw new Error(r.errors.join())
      t = r.tracker
    }
    w.disk.set(`${ROOT}/prd-tracker.json`, JSON.stringify(t))
    // crew made its branch and worktree in the last session, and keeps that in its own store.
    w.git.branches.set('crew/prd', [...(w.git.branches.get('HEAD') ?? [])])
    w.disk.set(`${ROOT}/.crew/work/prd/.git`, 'gitdir: x')
    w.store.set(`work:${ROOT}:docs/PRD.md`, { branch: 'crew/prd', dir: `${ROOT}/.crew/work/prd`, base: BASE, seen: {} })
    w.commit('TASK-001: 方案頁')
    w.store.set(`state:${ROOT}`, { prdPath: 'docs/PRD.md', flow: { stage: 'building', round: 0, retries: 0, building: 'TASK-001' }, questions: [], lead: 'person' })
    await start($)
    expect(w.spawned.map(s => s.subagentType)).toEqual(['crew:fullstack'])
    expect(w.spawned[0]?.prompt).toMatch(/重開過[\s\S]*TASK-002/)
  })

  test('takes the person’s questions, and cannot write the board', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    w.commit('TASK-001: 方案頁')
    await done($, 'a-fullstack-4')
    w.commit('TASK-002: 取消流程')
    await done($, 'a-fullstack-4')
    expect((await $.command.run(command('ask fullstack 用了什麼框架？'))).text).toMatch(/全端/)
    expect(w.sent.at(-1)).toMatchObject({ to: 'a-fullstack-4' })
    expect(String((await write($, 'a-fullstack-4', [{ op: 'add_feature', title: 'x', summary: '' }])).result)).toMatch(/全端 不能做 add_feature/)
  })

  test('shows each built task under way with its commit on the board tab', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    w.commit('TASK-001: 方案頁')
    await done($, 'a-fullstack-4')
    const text = await paneText($, 'board')
    expect(text).toMatch(/TASK-001[\s\S]*commit abc0001/)
    expect(text).toMatch(/TASK-002[\s\S]*全端正在做/)
  })

  test('runs in its worktree', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    expect(w.spawned.at(-1)).toMatchObject({ subagentType: 'crew:fullstack', cwd: `${ROOT}/.crew/work/prd` })
  })

  test('counts only commits on crew’s own branch: the checkout’s own TASK- commits are not its work', async ($, on) => {
    const w = world($, on)
    w.commit('TASK-001: fix login redirect', 'HEAD')
    await start($)
    await planned($)
    expect(w.spawned.at(-1)?.prompt).toMatch(/請實作 TASK-001/)
    expect(await paneText($, 'progress')).toMatch(/實作 0\/2/)
  })

  test('keeps a task built once its commit was seen, after the branch is merged and deleted', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await build($)
    expect((await $.command.run(command('status'))).text).toMatch(/done/)
    // The person merges crew/prd and deletes it: its commits are now on HEAD only.
    w.git.branches.set('HEAD', [...(w.git.branches.get('crew/prd') ?? []), ...(w.git.branches.get('HEAD') ?? [])])
    w.git.branches.delete('crew/prd')
    await w.clock.advance(31_000)
    await $.command.run(command('ask pm 月繳價格多少？'))
    await done($, 'a-pm-1', '一百元')
    expect(w.spawned.filter(s => s.subagentType === 'crew:fullstack')).toHaveLength(1)
    expect(await paneText($, 'progress')).toMatch(/實作 2\/2/)
  })

  test('does not start building a finished board’s tasks on an unrelated turn', async ($, on) => {
    const w = world($, on)
    let t = newTracker('repo')
    for (const [by, ops] of [
      ['pm', SPLIT],
      ['qa', [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }]],
      ['techlead', PLAN],
    ] as const) {
      const r = applyOps(t, ops as unknown as Op[], { by, today: '2026-10-15', prefixes: DEFAULT_PREFIXES })
      if (!r.ok) throw new Error(r.errors.join())
      t = r.tracker
    }
    w.disk.set(`${ROOT}/prd-tracker.json`, JSON.stringify(t))
    w.store.set(`state:${ROOT}`, { prdPath: 'docs/PRD.md', flow: { stage: 'done', round: 0, retries: 0 }, questions: [], lead: 'person' })
    await start($)
    await $.command.run(command('ask pm 月繳價格多少？'))
    await done($, 'a-pm-1', '一百元')
    expect(w.spawned.map(s => s.subagentType)).toEqual(['crew:pm'])
    expect(w.git.commands.some(c => c.includes('worktree'))).toBe(false)
  })

  test('hears the tech lead’s answer even when it came in the report, not the thread', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await $.tool.call({ tool: 'mcp__crew__thread_post', tool_use_id: 'q', agentId: 'a-fullstack-4', item: 'TASK-001', to: 'techlead', text: '金流用哪家？' } as never)
    await done($, 'a-fullstack-4', '等 Tech lead')
    expect(w.sent.at(-1)?.to).toBe('a-techlead-3')
    await done($, 'a-techlead-3', '用 Stripe。')
    expect(w.sent.at(-1)?.to).toBe('a-fullstack-4')
    expect(w.sent.at(-1)?.text).toMatch(/用 Stripe/)
  })

  test('does not count a task built while its worktree holds changes not committed', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    w.commit('TASK-001: 先寫失敗的測試')
    w.git.dirty = ' M src/plan.ts\n'
    await done($, 'a-fullstack-4', '先休息')
    expect(w.sent.at(-1)?.to).toBe('a-fullstack-4')
    expect(w.sent.at(-1)?.text).toMatch(/TASK-001 的工作目錄還有沒 commit 的修改/)
    // A project's build or test output is no reason to stop: it belongs in .gitignore.
    expect(w.sent.at(-1)?.text).toMatch(/建置或測試產生的檔案，請加進 \.gitignore/)
    w.git.dirty = ''
    w.commit('TASK-001: 方案頁')
    await done($, 'a-fullstack-4')
    expect(w.sent.at(-1)?.text).toMatch(/請實作 TASK-002/)
  })

  test('shows code as committed, not done, until a review checks it', async ($, on) => {
    world($, on)
    await start($)
    await planned($)
    await build($)
    const text = await paneText($, 'progress')
    expect(text).not.toMatch(/實作 ✓/)
    expect(text).toMatch(/◐ 2\/2/)
  })

  test('does not count a commit made before crew made its branch, even one no branch has', async ($, on) => {
    const w = world($, on)
    w.commit('TASK-001: 團隊自己的票', 'HEAD')
    await start($)
    await planned($)
    // The person's checkout leaves its branch (a detached HEAD, a tag): the old commit is now on crew's branch only.
    w.git.branches.delete('HEAD')
    w.git.ref = ''
    await done($, 'a-fullstack-4', '做完了')
    expect(w.sent.at(-1)?.text).toMatch(/TASK-001 還沒有 commit/)
    expect(await paneText($, 'progress')).toMatch(/實作 0\/2/)
  })

  test('does not count a new board’s task built from commits crew saw for an earlier task of the same id', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await build($)
    expect(await paneText($, 'progress')).toMatch(/實作 2\/2/)
    // The board is made again: the tech lead's TASK-001 is another task now, while the old commits stay on crew's branch.
    const again = plannedBoard([
      { op: 'add_task', feature: 'PRD-001', criteria: ['AC-001'], title: '登入頁', detail: '', size: 'S' },
      { op: 'add_task', feature: 'PRD-002', criteria: ['AC-002'], title: '登出', detail: '', size: 'S' },
    ])
    w.disk.set(`${ROOT}/prd-tracker.json`, JSON.stringify(again))
    // crew's next look at git and the board marks nothing on the new tasks.
    await w.clock.advance(31_000)
    const board = JSON.parse(w.disk.get(`${ROOT}/prd-tracker.json`) ?? '{}') as { prd_items: { tasks?: { id: string; crew_commits?: string[] }[] }[] }
    expect(board.prd_items.flatMap(i => i.tasks ?? []).map(t => [t.id, t.crew_commits])).toEqual([
      ['TASK-001', undefined],
      ['TASK-002', undefined],
    ])
    expect(await paneText($, 'progress')).toMatch(/實作 0\/2/)
  })

  test('keeps each PRD’s record of its own: another PRD starts with nothing built', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await build($)
    expect(w.store.get(`work:${ROOT}:docs/PRD.md`)).toMatchObject({ branch: 'crew/prd', base: BASE })
    expect(w.store.get(`work:${ROOT}:docs/OTHER.md`)).toBeUndefined()
  })

  test('makes a branch of its own when the one in its record is not one it can trust', async ($, on) => {
    const w = world($, on)
    w.git.branches.set('crew/prd', [...(w.git.branches.get('HEAD') ?? [])])
    w.store.set(`work:${ROOT}:docs/PRD.md`, { branch: 'crew/prd', dir: `${ROOT}/.crew/work/../..`, base: BASE, seen: {} })
    await start($)
    await planned($)
    const cwd = String((w.spawned.at(-1) as { cwd?: string }).cwd)
    expect(cwd).toMatch(/^\/repo\/\.crew\/work\/prd-[0-9a-f]{6}$/)
  })

  test('says what changed in the person’s checkout during the full-stack’s run, without blaming it', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    w.git.checkout = ' M src/mine.ts\n M prd-tracker.json.bak\n M prd-tracker.json\n?? .crew/threads/x.jsonl\n'
    w.commit('TASK-001: 方案頁', 'HEAD')
    w.commit('TASK-001: 方案頁')
    await done($, 'a-fullstack-4')
    const said = w.toasts.find(t => t.includes('全端這一輪期間')) ?? ''
    expect(said).toMatch(/多了 2 個變更（src\/mine\.ts、prd-tracker\.json\.bak）/)
    expect(said).toMatch(/checkout 從 main c0ffee0 變成 main abc000/)
    expect(said).toMatch(/如果不是你自己改的/)
  })

  test('says a file moved out of crew’s folder into the checkout, though crew’s own files are left out', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    w.git.checkout = 'R  .crew/memory/x.md -> src/y.ts\nR  .crew/a.md -> .crew/b.md\n'
    w.commit('TASK-001: 方案頁')
    await done($, 'a-fullstack-4')
    expect(w.toasts.find(t => t.includes('全端這一輪期間'))).toMatch(/多了 1 個變更（\.crew\/memory\/x\.md -> src\/y\.ts）/)
  })

  test('goes back to a stuck task on the model its size calls for once the person answers, keeping its agent', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    await done($, 'a-pm-1')
    await write($, 'a-qa-2', [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }])
    await done($, 'a-qa-2')
    await write($, 'a-techlead-3', PLAN.map(t => ({ ...t, size: 'XL' })))
    await done($, 'a-techlead-3')
    expect(w.spawned.at(-1)).toMatchObject({ subagentType: 'crew:fullstack', model: 'opus' })
    await done($, 'a-fullstack-4', '卡住了')
    await done($, 'a-fullstack-4', '還是卡住')
    await $.command.run(command('answer Q-01 先跳過金流，用假資料'))
    // The answer wakes the same Opus agent: another model would have started the task afresh.
    expect(w.sent.at(-1)?.to).toBe('a-fullstack-4')
    expect(w.spawned.filter(s => s.subagentType === 'crew:fullstack')).toHaveLength(1)
  })

  test('takes the checkout as it was when the full-stack’s run began, not when work reached it mid-run', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    w.git.checkout = ' M src/early.ts\n'
    // The person's answer reaches the full-stack while it is at work: the run's start stays as it was.
    await $.tool.call({ tool: 'mcp__crew__ask_person', tool_use_id: 'q', agentId: 'a-fullstack-4', question: '金流用哪家？', item: 'TASK-001' } as never)
    await $.command.run(command('answer Q-01 用 Stripe'))
    expect(w.sent.at(-1)).toMatchObject({ to: 'a-fullstack-4' })
    w.commit('TASK-001: 方案頁')
    await done($, 'a-fullstack-4')
    expect(w.toasts.some(t => /全端這一輪期間，你的工作目錄多了 1 個變更（src\/early\.ts）/.test(t))).toBe(true)
  })
})
