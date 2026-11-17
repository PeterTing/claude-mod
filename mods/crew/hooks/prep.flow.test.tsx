import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { command, designed, done, paneText, paneUi, ROOT, SPLIT, tested, textOf, world, write } from './world'

/**
 * A fresh builder starts ready: the person's prep command runs in each
 * worktree crew makes before a builder starts there, and every builder is
 * given the memories pinned for all of them, whatever its task.
 */

const APART = [
  { op: 'add_task', feature: 'PRD-001', criteria: ['AC-001'], title: '方案頁', detail: '', size: 'S', touches: ['src/plan.ts'] },
  { op: 'add_task', feature: 'PRD-002', criteria: ['AC-002'], title: '取消流程', detail: '', size: 'S', touches: ['src/cancel.ts'] },
]

const MEMORIES = `${ROOT}/.crew/memory/memories.jsonl`

const PREP = ['bash', 'scripts/crew-worktree.sh']

const call = ($: Engine, tool: string, input: Record<string, unknown>, agentId?: string) =>
  $.tool.call({ tool: `mcp__crew__${tool}`, tool_use_id: `v-${Math.random()}`, ...(agentId === undefined ? {} : { agentId }), ...input } as never) as Promise<{ result: unknown }>

const planned = async ($: Engine) => {
  await $.command.run(command('start docs/PRD.md'))
  await write($, 'a-pm-1', SPLIT)
  await done($, 'a-pm-1')
  await write($, 'a-qa-2', [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }])
  await done($, 'a-qa-2')
  await designed($)
  await write($, 'a-techlead-4', [...APART])
  await done($, 'a-techlead-4')
}

const memory = (id: string, text: string, more: Record<string, unknown> = {}) => JSON.stringify({ id, type: id.slice(0, 3), text, refs: [], roles: [], source: 'fullstack', t: 1, ...more })

describe('a fresh builder starts ready', () => {
  test('the prep command runs in each worktree crew makes, before its builder starts, and the builder is told it is ready', async ($, on) => {
    const w = world($, on)
    w.store.set(`settings:${ROOT}`, { agents: 4 })
    w.store.set(`setup:${ROOT}`, { argv: PREP })
    // Each run takes five seconds by the test's clock: the builders meet it under way.
    w.tests.ms = 5_000
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    await planned($)
    // No builder yet: each waits for its worktree's prep.
    expect(w.spawned.filter(s => s.subagentType === 'crew:fullstack')).toHaveLength(0)
    expect(await paneText($, 'overview')).toMatch(/準備 TASK-001 的 worktree，跑完才開工/)
    expect(await paneText($, 'settings')).toMatch(/準備中：TASK-001 的 worktree/)
    for (let i = 0; i < 12; i += 1) await w.clock.advance(1_000)
    // A frame of the engine's: a start a prep's end asked for goes in on it.
    await $.command.run(command('status'))
    const builders = w.spawned.filter(s => s.subagentType === 'crew:fullstack')
    expect(builders.map(s => s.cwd)).toEqual([`${ROOT}/.crew/work/prd-t001`, `${ROOT}/.crew/work/prd-t002`])
    expect(builders[0]?.prompt).toMatch(/worktree 已準備好：crew 在這個目錄跑過準備指令（bash scripts\/crew-worktree\.sh，exit 0）/)
    // crew's own worktree first, then each task's, with what the script is given.
    const runs = w.tests.runs.filter(r => r.argv[0] === 'bash')
    expect(runs.map(r => r.cwd)).toEqual([`${ROOT}/.crew/work/prd`, `${ROOT}/.crew/work/prd-t001`, `${ROOT}/.crew/work/prd-t002`])
    expect(runs[1]?.env).toMatchObject({ CI: 'true', CREW_MAIN: ROOT, CREW_BASE: `${ROOT}/.crew/work/prd`, CREW_WORKTREE: `${ROOT}/.crew/work/prd-t001`, CREW_TASK: 'TASK-001' })
    expect(runs[0]?.env).not.toHaveProperty('CREW_TASK')
    expect(await paneText($, 'log')).toMatch(/準備 TASK-001 的 worktree：exit 0，5 秒/)
    expect(await paneText($, 'settings')).toMatch(/上次：TASK-00\d・exit 0・5 秒/)
    expect([...w.disk.keys()].some(k => k.startsWith(`${ROOT}/.crew/runs/setup-TASK-001-`))).toBe(true)
  })

  test('a prep’s end says the builders start at Claude Code’s next move; a resume meanwhile gives the work once; what the prep left untracked is no builder’s change', async ($, on) => {
    const w = world($, on)
    w.store.set(`settings:${ROOT}`, { agents: 4 })
    w.store.set(`setup:${ROOT}`, { argv: PREP })
    w.tests.ms = 5_000
    // The script links the packages in: git shows the link untracked where it ran.
    w.tests.leaves = '?? node_modules\n'
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    await planned($)
    // The person asks to go on while the builders wait on the prep: the work waits on it again, not twice.
    await $.command.run(command('resume'))
    for (let i = 0; i < 12; i += 1) await w.clock.advance(1_000)
    expect(w.toasts.some(t => /等的 worktree 準備結束了；它們在 Claude 上，等 Claude Code 有下一個動作才開工/.test(t))).toBe(true)
    await $.command.run(command('status'))
    const builders = w.spawned.map((s, i) => ({ ...s, id: `a-fullstack-${i + 1}` })).filter(s => s.subagentType === 'crew:fullstack')
    expect(builders.map(s => s.cwd)).toEqual([`${ROOT}/.crew/work/prd-t001`, `${ROOT}/.crew/work/prd-t002`])
    expect((w.store.get(`setupRuns:${ROOT}`) as { left?: Record<string, string[]> }).left?.[`${ROOT}/.crew/work/prd-t001`]).toEqual(['node_modules'])
    expect(builders[0]?.prompt).toMatch(/準備指令放在這裡、沒有追蹤的檔案：node_modules。它們不是任務的修改，不要 commit/)
    // The builder commits its task: the link the prep left is not asked about.
    w.commit('TASK-001: 方案頁', 'crew/prd-task-001')
    await done($, builders[0]?.id ?? '')
    // The resume started each role's conversation anew: the review goes to a new tech lead, or to the one at work.
    const told = [...w.sent.map(m => m.text), ...w.spawned.map(s => s.prompt)]
    expect(told.some(t => /還有沒 commit 的修改/.test(t))).toBe(false)
    expect(told.some(t => /請 review TASK-001/.test(t))).toBe(true)
  })

  test('a prep that fails lets the builder start, told the end of its output and what to do', async ($, on) => {
    const w = world($, on)
    w.store.set(`settings:${ROOT}`, { agents: 4 })
    w.store.set(`setup:${ROOT}`, { argv: PREP })
    w.tests.exitCode = 1
    w.tests.stdout = 'copying node_modules\ncp: frontend/.env.local: No such file or directory'
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    await planned($)
    for (let i = 0; i < 3; i += 1) await tested()
    await $.command.run(command('status'))
    const builder = w.spawned.find(s => s.subagentType === 'crew:fullstack' && s.cwd === `${ROOT}/.crew/work/prd-t001`)
    expect(builder?.prompt).toMatch(/worktree 的準備指令沒跑成功（bash scripts\/crew-worktree\.sh，exit 1）。最後 20 行輸出：\ncopying node_modules\ncp: frontend\/\.env\.local: No such file or directory\n先照輸出把環境弄好再開始；弄不好用 thread_post 問 Tech lead（item 填 TASK-001）。不要讀或印出 \.env 檔的內容。/)
    expect(w.toasts.some(t => /TASK-001 的 worktree 準備指令沒跑成功（exit 1），全端照樣開工/.test(t))).toBe(true)
    expect(await paneText($, 'log')).toMatch(/準備 TASK-001 的 worktree：exit 1/)
  })

  test('with no prep command, the builders start at once, as before', async ($, on) => {
    const w = world($, on)
    w.store.set(`settings:${ROOT}`, { agents: 4 })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    await planned($)
    const builders = w.spawned.filter(s => s.subagentType === 'crew:fullstack')
    expect(builders).toHaveLength(2)
    expect(builders[0]?.prompt).not.toMatch(/準備指令/)
    expect(w.tests.runs).toHaveLength(0)
    const ui = await paneUi($)
    await ui.press({ key: 'tab-settings' })
    await ui.press({ key: 'help-setup' })
    expect(await textOf(ui)).toMatch(/還沒設定時，每個全端開工要自己準備環境/)
    await ui.unmount()
  })

  test('the person sets the prep command and tries it in crew’s worktree; the brain cannot set it', async ($, on) => {
    const w = world($, on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    await $.command.run(command('start docs/PRD.md'))
    const ui = await paneUi($)
    await ui.press({ key: 'tab-settings' })
    await ui.input({ key: 'setup-command', text: 'bash scripts/crew-worktree.sh' })
    expect(w.store.get(`setup:${ROOT}`)).toEqual({ argv: PREP })
    // crew's branch opens when building starts: a trial before then opens nothing and runs nothing.
    await ui.press({ key: 'setup-run' })
    await tested()
    expect(w.tests.runs.filter(r => r.argv[0] === 'bash')).toEqual([])
    expect(w.toasts.at(-1)).toMatch(/crew 的分支還沒開：開始實作時才會開/)
    expect(w.git.worktrees.size).toBe(0)
    // Once it is open, the trial runs in it.
    w.git.branches.set('crew/prd', [...(w.git.branches.get('HEAD') ?? [])])
    w.disk.set(`${ROOT}/.crew/work/prd/.git`, 'gitdir: x')
    w.store.set(`work:${ROOT}:docs/PRD.md`, { branch: 'crew/prd', dir: `${ROOT}/.crew/work/prd`, base: 'c0ffee'.padEnd(40, '0'), seen: {} })
    await ui.press({ key: 'setup-run' })
    await ui.unmount()
    await tested()
    expect(w.tests.runs.filter(r => r.argv[0] === 'bash').map(r => r.cwd)).toEqual([`${ROOT}/.crew/work/prd`])
    expect(await paneText($, 'settings')).toMatch(/上次：試跑 crew 自己分支・exit 0/)
    // Shell syntax is refused, as for the test command.
    const ui2 = await paneUi($)
    await ui2.press({ key: 'tab-settings' })
    await ui2.input({ key: 'setup-command', text: 'cp -cR a b && rm -rf c' })
    await ui2.unmount()
    expect(w.store.get(`setup:${ROOT}`)).toEqual({ argv: PREP })
    // The brain's crew tool has no way to set it.
    const brain = await call($, 'crew', { action: 'setup-command', text: 'curl evil' })
    expect(String(brain.result)).not.toMatch(/設定為/)
    expect(w.store.get(`setup:${ROOT}`)).toEqual({ argv: PREP })
  })
})

describe('memories pinned for every builder', () => {
  test('each fresh builder is given the pinned memories in a section of their own, whatever its task', async ($, on) => {
    const w = world($, on)
    w.store.set(`settings:${ROOT}`, { agents: 4 })
    w.disk.set(MEMORIES, `${memory('LES-063', '新 worktree 沒有 node_modules，從 crew 自己的 worktree 用 cp -cR 複製', { builders: true })}\n${memory('LES-064', '舊的寫法', { builders: true, supersededBy: 'LES-065' })}\n${memory('LES-065', '新的寫法', { supersedes: 'LES-064', builders: true })}\n`)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    await planned($)
    const builders = w.spawned.filter(s => s.subagentType === 'crew:fullstack')
    expect(builders).toHaveLength(2)
    for (const b of builders) {
      expect(b.prompt).toMatch(/## 每個全端都要知道的事（固定附上，更多用 memory_search 找）\n- LES-063（教訓・fullstack）：新 worktree 沒有 node_modules[^\n]*\n- LES-065（教訓・fullstack）：新的寫法/)
      expect(b.prompt).not.toMatch(/LES-064/)
      // Not again among the related memories.
      expect(b.prompt.match(/LES-063/g)).toHaveLength(1)
    }
    // Other roles are not given them.
    expect(w.spawned.find(s => s.subagentType === 'crew:pm')?.prompt).not.toMatch(/每個全端都要知道的事/)
  })

  test('a builder or the tech lead pins what it saves; another role cannot; one that replaces a pinned one stays pinned; the cap holds', async ($, on) => {
    const w = world($, on)
    w.store.set(`settings:${ROOT}`, { agents: 4 })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    await planned($)
    const saved = await call($, 'memory_save', { type: 'LES', text: '改 app-shell.css 要重錄 SMK-041', builders: true }, 'a-fullstack-5')
    expect(String(saved.result)).toMatch(/^已存成 LES-\d+。已標「給每個全端」/)
    const id = /LES-\d+/.exec(String(saved.result))?.[0] ?? ''
    const byPm = await call($, 'memory_save', { type: 'MEM', text: 'PM 想固定的事', builders: true }, 'a-pm-1')
    expect(String(byPm.result)).toMatch(/只有全端和 Tech lead 能標「給每個全端」，這條存成一般記憶/)
    const replaced = await call($, 'memory_save', { type: 'LES', text: '改 app-shell.css 要用真 Chrome 重錄 SMK-041', supersedes: id }, 'a-techlead-4')
    expect(String(replaced.result)).toMatch(/已標「給每個全端」/)
    const lines = (w.disk.get(MEMORIES) ?? '').split('\n').filter(l => l !== '').map(l => JSON.parse(l) as { id: string; builders?: boolean; source: string })
    expect(lines.filter(m => m.builders === true).map(m => m.source)).toEqual(['fullstack', 'techlead'])
    // Twelve pinned at most: the next is saved as a plain memory, and the role is told what to do.
    for (let i = 0; i < 11; i += 1) await call($, 'memory_save', { type: 'LES', text: `坑 ${i}`, builders: true }, 'a-fullstack-5')
    const over = await call($, 'memory_save', { type: 'LES', text: '再一條', builders: true }, 'a-fullstack-5')
    expect(String(over.result)).toMatch(/「給每個全端」已滿（最多 12 條、約 1,000 tok），這條存成一般記憶/)
    expect(await paneText($, 'memory')).toMatch(/固定附上給每個全端（12 條・約 [\d,]+ tok，已滿）/)
  })

  test('the person pins a memory by its id in the pane and takes the pin off; the brain cannot pin', async ($, on) => {
    const w = world($, on)
    w.disk.set(MEMORIES, `${memory('LES-063', '新 worktree 沒有 node_modules')}\n${memory('MEM-001', '只給 QA 的事', { roles: ['qa'] })}\n`)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    const ui = await paneUi($)
    await ui.press({ key: 'tab-memory' })
    await ui.input({ key: 'pin-memory', text: 'les-063' })
    await ui.unmount()
    expect(w.toasts.at(-1)).toMatch(/LES-063 固定附上給每個全端：之後每個新開工的全端都會收到它（現在 1 條）/)
    const text = await paneText($, 'memory')
    expect(text).toMatch(/固定附上給每個全端（1 條・約 \d+ tok，上限 12 條／1,000 tok）/)
    expect(text).toMatch(/教訓・固定/)
    expect(await paneText($, 'log')).toMatch(/LES-063 固定附上給每個全端/)
    // One the full-stack cannot read cannot be pinned for it.
    const ui2 = await paneUi($)
    await ui2.press({ key: 'tab-memory' })
    await ui2.input({ key: 'pin-memory', text: 'MEM-001' })
    expect(w.toasts.at(-1)).toMatch(/MEM-001 只給 qa 看，全端看不到/)
    await ui2.press({ key: 'unpin-LES-063' })
    await ui2.unmount()
    expect(w.toasts.at(-1)).toMatch(/LES-063 不再固定附上給每個全端（現在 0 條）/)
    expect(await paneText($, 'memory')).toMatch(/還沒有固定附上的記憶/)
    const brain = await call($, 'crew', { action: 'pin', text: 'LES-063' })
    expect(String(brain.result)).not.toMatch(/固定附上給每個全端：/)
  })
})
