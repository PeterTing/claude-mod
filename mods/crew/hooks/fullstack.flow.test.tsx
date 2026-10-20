import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { applyOps, DEFAULT_PREFIXES, newTracker } from './board'
import type { Op } from './board'
import { taskMark } from './git'
import { approve, build, command, designed, done, paneText, PLAN, ROOT, SPLIT, start, tested, world, write } from './world'

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
  await designed($)
  await write($, 'a-techlead-4', PLAN)
  await done($, 'a-techlead-4')
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
    await done($, 'a-fullstack-5', '做完了')
    expect(w.sent.at(-1)?.to).toBe('a-fullstack-5')
    expect(w.sent.at(-1)?.text).toMatch(/TASK-001 還沒有 commit/)
    w.commit('TASK-001: 方案頁')
    await done($, 'a-fullstack-5')
    // The tech lead reviews the commit before the next task starts.
    expect(w.sent.at(-1)).toMatchObject({ to: 'a-techlead-4' })
    expect(w.sent.at(-1)?.text).toMatch(/請 review TASK-001 方案頁（commit abc0001）[\s\S]*commit abc0001\n TASK-001: 方案頁|請 review TASK-001 方案頁（commit abc0001）[\s\S]*diff of abc0001/)
    expect(String((await approve($, 'TASK-001')).result)).toMatch(/已記下 TASK-001 的 review 結論（通過，commit abc0001）/)
    expect(w.sent.at(-1)?.text).toMatch(/請實作 TASK-002 取消流程/)
    w.commit('TASK-002: 取消流程')
    await done($, 'a-fullstack-5')
    await approve($, 'TASK-002')
    // crew runs the person's test command; every test case passes.
    await tested()
    expect((await $.command.run(command('status'))).text).toMatch(/done/)
    expect(w.toasts.at(-1)).toMatch(/G5 2\/2[\s\S]*G6/)
  })

  test('has the person decide when a task twice ends with no commit', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await done($, 'a-fullstack-5', '卡住了')
    await done($, 'a-fullstack-5', '還是卡住')
    expect((await $.command.run(command('status'))).text).toMatch(/escalated[\s\S]*待你決定 1/)
    expect((await $.command.run(command('answer Q-03 先跳過金流，用假資料'))).text).toMatch(/轉給 全端|轉給全端/)
    expect(w.sent.at(-1)?.to).toBe('a-fullstack-5')
  })

  test('counts a task as built from its commit, not from what the full-stack says', async ($, on) => {
    world($, on)
    await start($)
    await planned($)
    await done($, 'a-fullstack-5', 'TASK-001 和 TASK-002 都做完了')
    const text = await paneText($, 'progress')
    expect(text).toMatch(/實作 0\/2/)
  })

  test('says why it cannot start in a folder that is not a git repo', async ($, on) => {
    const w = world($, on)
    w.git.repo = false
    await start($)
    await planned($)
    expect(w.spawned.map(s => s.subagentType)).toEqual(['crew:pm', 'crew:qa', 'crew:uiux', 'crew:techlead'])
    expect(w.toasts.some(t => /全端沒有開始：這個資料夾不是 git repo/.test(t))).toBe(true)
  })

  test('picks the build up again after Claude Code restarts, at the first task not approved', async ($, on) => {
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
    const sha = w.commit('TASK-001: 方案頁')
    // The tech lead approved TASK-001 before the restart.
    const mark = taskMark({ id: 'TASK-001', title: '方案頁', status: 'planned', acceptance_criteria: ['AC-001'], detail: '' })
    w.store.set(`work:${ROOT}:docs/PRD.md`, { branch: 'crew/prd', dir: `${ROOT}/.crew/work/prd`, base: BASE, seen: {}, reviewed: { 'TASK-001': { sha, verdict: 'approve', mark } } })
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
    await done($, 'a-fullstack-5')
    w.commit('TASK-002: 取消流程')
    await done($, 'a-fullstack-5')
    expect((await $.command.run(command('ask fullstack 用了什麼框架？'))).text).toMatch(/全端/)
    expect(w.sent.at(-1)).toMatchObject({ to: 'a-fullstack-5' })
    expect(String((await write($, 'a-fullstack-5', [{ op: 'add_feature', title: 'x', summary: '' }])).result)).toMatch(/全端 不能做 add_feature/)
  })

  test('shows each built task under way with its commit on the board tab', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    w.commit('TASK-001: 方案頁')
    await done($, 'a-fullstack-5')
    let text = await paneText($, 'board')
    expect(text).toMatch(/TASK-001[\s\S]*commit abc0001 · Tech lead 正在 review/)
    await approve($, 'TASK-001')
    text = await paneText($, 'board')
    expect(text).toMatch(/TASK-001[\s\S]*commit abc0001 · review 通過/)
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
    expect(await paneText($, 'progress')).toMatch(/實作 ✓/)
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
    await $.tool.call({ tool: 'mcp__crew__thread_post', tool_use_id: 'q', agentId: 'a-fullstack-5', item: 'TASK-001', to: 'techlead', text: '金流用哪家？' } as never)
    await done($, 'a-fullstack-5', '等 Tech lead')
    expect(w.sent.at(-1)?.to).toBe('a-techlead-4')
    await done($, 'a-techlead-4', '用 Stripe。')
    expect(w.sent.at(-1)?.to).toBe('a-fullstack-5')
    expect(w.sent.at(-1)?.text).toMatch(/用 Stripe/)
  })

  test('does not count a task built while its worktree holds changes not committed', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    w.commit('TASK-001: 先寫失敗的測試')
    w.git.dirty = ' M src/plan.ts\n'
    await done($, 'a-fullstack-5', '先休息')
    expect(w.sent.at(-1)?.to).toBe('a-fullstack-5')
    expect(w.sent.at(-1)?.text).toMatch(/TASK-001 的工作目錄還有沒 commit 的修改/)
    // A project's build or test output is no reason to stop: it belongs in .gitignore.
    expect(w.sent.at(-1)?.text).toMatch(/建置或測試產生的檔案，請加進 \.gitignore/)
    w.git.dirty = ''
    w.commit('TASK-001: 方案頁')
    await done($, 'a-fullstack-5')
    expect(w.sent.at(-1)?.text).toMatch(/請 review TASK-001/)
  })

  test('shows code as committed, not done, until the tech lead approves it', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    w.commit('TASK-001: 方案頁')
    await done($, 'a-fullstack-5')
    let text = await paneText($, 'progress')
    expect(text).not.toMatch(/實作 ✓/)
    expect(text).toMatch(/→ Review 0\/2/)
    await approve($, 'TASK-001')
    w.commit('TASK-002: 取消流程')
    await done($, 'a-fullstack-5')
    await approve($, 'TASK-002')
    text = await paneText($, 'progress')
    expect(text).toMatch(/→ 實作 ✓/)
    expect(text).toMatch(/→ Review ✓/)
  })

  test('does not count a commit made before crew made its branch, even one no branch has', async ($, on) => {
    const w = world($, on)
    w.commit('TASK-001: 團隊自己的票', 'HEAD')
    await start($)
    await planned($)
    // The person's checkout leaves its branch (a detached HEAD, a tag): the old commit is now on crew's branch only.
    w.git.branches.delete('HEAD')
    w.git.ref = ''
    await done($, 'a-fullstack-5', '做完了')
    expect(w.sent.at(-1)?.text).toMatch(/TASK-001 還沒有 commit/)
    expect(await paneText($, 'progress')).toMatch(/實作 0\/2/)
  })

  test('does not count a new board’s task built from commits crew saw for an earlier task of the same id', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await build($)
    expect(await paneText($, 'progress')).toMatch(/實作 ✓/)
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
    await done($, 'a-fullstack-5')
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
    await done($, 'a-fullstack-5')
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
    await designed($)
    await write($, 'a-techlead-4', PLAN.map(t => ({ ...t, size: 'XL' })))
    await done($, 'a-techlead-4')
    expect(w.spawned.at(-1)).toMatchObject({ subagentType: 'crew:fullstack', model: 'opus' })
    await done($, 'a-fullstack-5', '卡住了')
    await done($, 'a-fullstack-5', '還是卡住')
    await $.command.run(command('answer Q-03 先跳過金流，用假資料'))
    // The answer wakes the same Opus agent: another model would have started the task afresh.
    expect(w.sent.at(-1)?.to).toBe('a-fullstack-5')
    expect(w.spawned.filter(s => s.subagentType === 'crew:fullstack')).toHaveLength(1)
  })

  test('takes the checkout as it was when the full-stack’s run began, not when work reached it mid-run', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    w.git.checkout = ' M src/early.ts\n'
    // The person's answer reaches the full-stack while it is at work: the run's start stays as it was.
    await $.tool.call({ tool: 'mcp__crew__ask_person', tool_use_id: 'q', agentId: 'a-fullstack-5', question: '金流用哪家？', item: 'TASK-001' } as never)
    await $.command.run(command('answer Q-03 用 Stripe'))
    expect(w.sent.at(-1)).toMatchObject({ to: 'a-fullstack-5' })
    w.commit('TASK-001: 方案頁')
    await done($, 'a-fullstack-5')
    expect(w.toasts.some(t => /全端這一輪期間，你的工作目錄多了 1 個變更（src\/early\.ts）/.test(t))).toBe(true)
  })

  test('makes a new branch once crew’s branch is merged and deleted, and keeps what it saw built', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    w.commit('TASK-001: 方案頁')
    await done($, 'a-fullstack-5')
    await approve($, 'TASK-001')
    // The person merges crew's branch and deletes it while the full-stack works on TASK-002.
    const crew = w.git.branches.get('crew/prd') ?? []
    w.git.branches.set('HEAD', crew)
    w.git.branches.delete('crew/prd')
    // TASK-002 is not committed yet: its next work needs a worktree again.
    await done($, 'a-fullstack-5')
    const fresh = w.git.commands.filter(c => c.includes('worktree') && c.includes('-b')).at(-1) ?? []
    const branch = fresh[fresh.indexOf('-b') + 1] ?? ''
    expect(branch).toMatch(/^crew\/prd-[0-9a-f]{6}$/)
    w.commit('TASK-002: 取消流程', branch)
    await done($, 'a-fullstack-5')
    await approve($, 'TASK-002')
    await tested()
    // A branch merged and deleted is gone, not taken by someone else.
    expect(w.toasts.some(t => /不是 crew 自己的分支/.test(t))).toBe(false)
    const board = JSON.parse(w.disk.get(`${ROOT}/prd-tracker.json`) ?? '{}') as { prd_items: { tasks?: { id: string; crew_commits?: string[] }[] }[] }
    expect(board.prd_items.flatMap(i => i.tasks ?? []).map(t => [t.id, (t.crew_commits ?? []).length])).toEqual([
      ['TASK-001', 1],
      ['TASK-002', 1],
    ])
    expect((await $.command.run(command('status'))).text).toMatch(/done/)
  })

  test('does not report changes the person already had in the checkout before the full-stack’s run', async ($, on) => {
    const w = world($, on)
    w.git.checkout = ' M src/mine.ts\n'
    await start($)
    await planned($)
    w.commit('TASK-001: 方案頁')
    await done($, 'a-fullstack-5')
    expect(w.toasts.filter(t => t.includes('全端這一輪期間'))).toEqual([])
  })

  test('says why it cannot start in a repo with no commit yet', async ($, on) => {
    const w = world($, on)
    w.git.branches.set('HEAD', [])
    await start($)
    await planned($)
    expect(w.spawned.map(s => s.subagentType)).toEqual(['crew:pm', 'crew:qa', 'crew:uiux', 'crew:techlead'])
    expect(w.toasts.some(t => /全端沒有開始：這個 repo 還沒有 commit/.test(t))).toBe(true)
  })

  test('does not take a record whose base or commits are not ones git could have written', async ($, on) => {
    const w = world($, on)
    w.git.branches.set('crew/prd', [...(w.git.branches.get('HEAD') ?? [])])
    w.store.set(`work:${ROOT}:docs/PRD.md`, { branch: 'crew/prd', dir: `${ROOT}/.crew/work/prd`, base: '--upload-pack=x', seen: {} })
    await start($)
    await planned($)
    expect(String((w.spawned.at(-1) as { cwd?: string }).cwd)).toMatch(/^\/repo\/\.crew\/work\/prd-[0-9a-f]{6}$/)
  })

  test('counts nothing from recorded commits that are not shas or tasks', async ($, on) => {
    const w = world($, on)
    w.git.branches.set('crew/prd', [...(w.git.branches.get('HEAD') ?? [])])
    w.disk.set(`${ROOT}/.crew/work/prd/.git`, 'gitdir: x')
    const mark = taskMark({ id: 'TASK-001', title: '方案頁', status: 'planned', acceptance_criteria: ['AC-001'], detail: '' })
    w.store.set(`work:${ROOT}:docs/PRD.md`, { branch: 'crew/prd', dir: `${ROOT}/.crew/work/prd`, base: 'c0ffee'.padEnd(40, '0'), seen: { 'not-a-sha': { 'TASK-001': mark }, abc1234: { 'TASK-1x': mark, 'TASK-001': 7 } } })
    await start($)
    await planned($)
    expect(w.spawned.at(-1)?.prompt).toMatch(/請實作 TASK-001/)
    expect(await paneText($, 'progress')).toMatch(/實作 0\/2/)
  })

  test('says when crew’s own files were changed during the full-stack’s run by someone other than crew', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    // The tech lead writes the board through crew while the full-stack works: that is crew's own write.
    await $.tool.call({ tool: 'mcp__crew__memory_save', tool_use_id: 'm', agentId: 'a-techlead-4', type: 'MEM', text: '金流用 Stripe' } as never)
    w.commit('TASK-001: 方案頁')
    await done($, 'a-fullstack-5')
    expect(w.toasts.some(t => /crew 以外/.test(t))).toBe(false)
    await approve($, 'TASK-001')
    // Now the board is edited behind crew's back while the full-stack works on TASK-002.
    w.disk.set(`${ROOT}/prd-tracker.json`, (w.disk.get(`${ROOT}/prd-tracker.json`) ?? '').replace('"取消流程"', '"取消流程（改）"'))
    w.commit('TASK-002: 取消流程')
    await done($, 'a-fullstack-5')
    expect(w.toasts.some(t => /全端這一輪期間，crew 的檔案 prd-tracker\.json 被 crew 以外的人改了/.test(t))).toBe(true)
  })

  test('says a change to crew’s memory during the full-stack’s run, and blames no run for a change made before it began', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await $.tool.call({ tool: 'mcp__crew__memory_save', tool_use_id: 'm', agentId: 'a-techlead-4', type: 'MEM', text: '金流用 Stripe' } as never)
    const memory = `${ROOT}/.crew/memory/memories.jsonl`
    w.commit('TASK-001: 方案頁')
    await done($, 'a-fullstack-5')
    // Changed between the full-stack's runs, before TASK-002 is handed over: not the next run's doing,
    // though crew writes the board over the change meanwhile.
    w.disk.set(memory, `${w.disk.get(memory) ?? ''}{"id":"MEM-099","type":"MEM","text":"手改"}\n`)
    w.disk.set(`${ROOT}/prd-tracker.json`, (w.disk.get(`${ROOT}/prd-tracker.json`) ?? '').replace('"取消流程"', '"取消流程（改）"'))
    await approve($, 'TASK-001')
    w.commit('TASK-002: 取消流程')
    await done($, 'a-fullstack-5')
    expect(w.toasts.some(t => /crew 以外/.test(t))).toBe(false)
    // Changed while the full-stack fixes a failed test run: told after that run.
    w.tests.stdout = '✗ TC-001 fails'
    await approve($, 'TASK-002')
    await tested()
    expect(w.sent.at(-1)).toMatchObject({ to: 'a-fullstack-5' })
    w.disk.set(memory, `${w.disk.get(memory) ?? ''}{"id":"MEM-100","type":"MEM","text":"又手改"}\n`)
    w.tests.stdout = ''
    w.commit('TASK-001: 修好 TC-001')
    await done($, 'a-fullstack-5')
    expect(w.toasts.some(t => /crew 的檔案 \.crew\/memory\/memories\.jsonl 被 crew 以外的人改了/.test(t))).toBe(true)
  })

  test('reads none of its own files through a link, and counts one made a link, or one it cannot read, as changed', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    const board = `${ROOT}/prd-tracker.json`
    // During the full-stack's run, the board becomes a link out of the repo.
    w.disk.set('/home/someone/secret.txt', 'secret')
    w.links.set(board, '/home/someone/secret.txt')
    const before = w.reads.get(board) ?? 0
    w.commit('TASK-001: 方案頁')
    await done($, 'a-fullstack-5')
    expect(w.reads.get(board) ?? 0).toBe(before)
    expect(w.toasts.some(t => /crew 的檔案 prd-tracker\.json 被 crew 以外的人改了/.test(t))).toBe(true)
  })

  test('still ends the full-stack’s run when one of its own files cannot be read', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    // The board is now a folder: reading it fails.
    const text = w.disk.get(`${ROOT}/prd-tracker.json`) ?? ''
    w.disk.delete(`${ROOT}/prd-tracker.json`)
    w.disk.set(`${ROOT}/prd-tracker.json/x`, '')
    w.commit('TASK-001: 方案頁')
    await done($, 'a-fullstack-5')
    expect(w.toasts.some(t => /crew 的檔案 prd-tracker\.json 被 crew 以外的人改了/.test(t))).toBe(true)
    expect(text).not.toBe('')
  })

  test('counts its memory as changed when reading it fails, rather than stopping there', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await $.tool.call({ tool: 'mcp__crew__memory_save', tool_use_id: 'm', agentId: 'a-techlead-4', type: 'MEM', text: '金流用 Stripe' } as never)
    w.broken.reads = `${ROOT}/.crew/memory/memories.jsonl`
    w.commit('TASK-001: 方案頁')
    await done($, 'a-fullstack-5')
    expect(w.toasts.some(t => /crew 的檔案 \.crew\/memory\/memories\.jsonl 被 crew 以外的人改了/.test(t))).toBe(true)
  })

  test('says when another of the person’s branches moved during the full-stack’s run', async ($, on) => {
    const w = world($, on)
    w.git.branches.set('feature-x', [{ sha: 'f00d001', subject: 'mine' }])
    await start($)
    await planned($)
    w.commit('feature-x 上多了一個 commit', 'feature-x')
    w.commit('TASK-001: 方案頁')
    await done($, 'a-fullstack-5')
    expect(w.toasts.some(t => /全端這一輪期間，你的分支 feature-x 動了/.test(t))).toBe(true)
    await approve($, 'TASK-001')
    // A branch deleted during the next run is said too.
    w.git.branches.delete('feature-x')
    w.commit('TASK-002: 取消流程')
    await done($, 'a-fullstack-5')
    expect(w.toasts.filter(t => /你的分支 feature-x 動了/.test(t))).toHaveLength(2)
  })

  test('tells the tech lead, and the person, when crew’s commits change the board or crew’s folder', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    w.commit('TASK-001: 方案頁', 'crew/prd', ['src/plan.ts', 'prd-tracker.json', '.crew/memory/memories.jsonl', '.crew/threads/my notes.jsonl'])
    await done($, 'a-fullstack-5')
    expect(w.sent.at(-1)).toMatchObject({ to: 'a-techlead-4' })
    expect(w.sent.at(-1)?.text).toMatch(/改到了 crew 的檔案（prd-tracker\.json、\.crew\/memory\/memories\.jsonl、\.crew\/threads\/my notes\.jsonl）[\s\S]*changes/)
    expect(w.toasts.filter(t => /TASK-001 的 commit 改到了 crew 的檔案/.test(t))).toHaveLength(1)
    // The tech lead's run ends with no verdict and it is asked again: the person was told already.
    await done($, 'a-techlead-4')
    expect(w.sent.at(-1)).toMatchObject({ to: 'a-techlead-4' })
    expect(w.toasts.filter(t => /TASK-001 的 commit 改到了 crew 的檔案/.test(t))).toHaveLength(1)
  })

  test('takes no branch of crew’s name for its own once it no longer holds the commit crew last saw', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    w.commit('TASK-001: 方案頁')
    await done($, 'a-fullstack-5')
    await approve($, 'TASK-001')
    // The branch is deleted, and one of the same name comes back from elsewhere, with a planted commit.
    w.git.branches.set('crew/prd', [{ sha: 'bad0001', subject: 'TASK-002: 別人的東西' }])
    await w.clock.advance(40_000)
    await done($, 'a-fullstack-5')
    expect(await paneText($, 'progress')).toMatch(/→ 實作 1\/2/)
    // Said once, though crew looked again.
    expect(w.toasts.filter(t => /crew\/prd 已經不是 crew 自己的分支/.test(t))).toHaveLength(1)
    // The next work gets a branch of crew's own.
    const fresh = w.git.commands.filter(c => c.includes('worktree') && c.includes('-b')).at(-1) ?? []
    expect(fresh[fresh.indexOf('-b') + 1]).toMatch(/^crew\/prd-[0-9a-f]{6}$/)
  })

  test('takes a commit off its task once crew’s branch is reset to drop it, and keeps the newest commit it saw as the one its branch must hold', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    const key = `work:${ROOT}:docs/PRD.md`
    const base = w.git.branches.get('crew/prd')?.[0]?.sha ?? ''
    // A new branch must hold the commit it was made from.
    expect((w.store.get(key) as { last?: string }).last).toBe(base)
    const sha = w.commit('TASK-001: 方案頁')
    await done($, 'a-fullstack-5')
    await approve($, 'TASK-001')
    expect((w.store.get(key) as { last?: string }).last).toBe(sha)
    // The person resets crew's branch to where it started: TASK-001's commit is on it no more.
    w.reset(base)
    await w.clock.advance(40_000)
    const task = (JSON.parse(w.disk.get(`${ROOT}/prd-tracker.json`) ?? '{}') as { prd_items: { tasks?: { id: string; crew_commits?: string[]; crew_review?: unknown }[] }[] }).prd_items.flatMap(i => i.tasks ?? []).find(t => t.id === 'TASK-001')
    expect(task?.crew_commits).toBeUndefined()
    expect(task?.crew_review).toBeUndefined()
    expect(await paneText($, 'progress')).toMatch(/→ 實作 0\/2/)
    // The branch is still crew's: a reset is no branch made again.
    expect(w.toasts.some(t => /不是 crew 自己的分支/.test(t))).toBe(false)
  })

  test('does not take a file merely named like crew’s own for one', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    w.commit('TASK-001: 方案頁', 'crew/prd', ['prd-tracker.json.bak', '.crewx/a.ts', 'src/.crew/b.ts'])
    await done($, 'a-fullstack-5')
    expect(w.sent.at(-1)).toMatchObject({ to: 'a-techlead-4' })
    expect(w.sent.at(-1)?.text).not.toMatch(/改到了 crew 的檔案/)
    expect(w.toasts.some(t => /改到了 crew 的檔案/.test(t))).toBe(false)
  })

  test('keeps its branch when the full-stack amends a commit on it, and reviews the amended commit alone', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    const first = w.commit('TASK-001: 方案頁')
    await done($, 'a-fullstack-5')
    await approve($, 'TASK-001', 'a-techlead-4', 'changes', '缺錯誤處理')
    // The full-stack folds the fix into its commit: the branch no longer holds the commit crew saw, but its reflog does.
    const amended = w.amend('TASK-001: 方案頁（含錯誤處理）')
    await done($, 'a-fullstack-5')
    expect(w.toasts.some(t => /不是 crew 自己的分支/.test(t))).toBe(false)
    expect(w.git.commands.filter(c => c.includes('worktree') && c.includes('-b'))).toHaveLength(1)
    expect(w.sent.at(-1)).toMatchObject({ to: 'a-techlead-4' })
    const text = w.sent.at(-1)?.text ?? ''
    expect(text).toMatch(new RegExp(`請 review TASK-001 方案頁（commit ${amended}）`))
    // The commit the amend replaced is on no branch now: it is not shown again.
    expect(text).toMatch(new RegExp(`diff of ${amended}`))
    expect(text).not.toMatch(new RegExp(`diff of ${first}`))
    await approve($, 'TASK-001')
    expect(w.sent.at(-1)?.text).toMatch(/請實作 TASK-002/)
  })
})
