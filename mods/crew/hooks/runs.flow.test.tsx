import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { applyOps, DEFAULT_PREFIXES, newTracker } from './board'
import type { Op } from './board'
import { approve, build, command, designed, done, paneText, PLAN, resumed, ROOT, SPLIT, start, tested, world, write } from './world'

/** crew runs the person's test command on its branch; each test case passes or not by what the run printed. */

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

const crew = ($: Engine, input: Record<string, unknown>) => $.tool.call({ tool: 'mcp__crew__crew', tool_use_id: `c-${Math.random()}`, ...input } as never) as Promise<{ result: unknown }>

describe('crew’s test runs', () => {
  test('run the person’s command in crew’s worktree, by its words, and keep what it printed as evidence out of git', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await build($)
    expect(w.tests.runs).toEqual([{ argv: ['npm', 'test'], cwd: `${ROOT}/.crew/work/prd`, env: { CI: 'true' } }])
    const logs = [...w.disk.keys()].filter(p => p.startsWith(`${ROOT}/.crew/runs/`))
    expect(logs).toHaveLength(1)
    const log = w.disk.get(logs[0] ?? '') ?? ''
    expect(log).toMatch(/^\$ npm test\n# \/repo\/\.crew\/work\/prd\n# commit abc0002\n# exit 0\n\n[\s\S]*✓ TC-001 passes/)
    expect(w.disk.get(`${ROOT}/.crew/.gitignore`)).toMatch(/runs\//)
    expect((await $.command.run(command('status'))).text).toMatch(/done/)
    expect(w.toasts.some(t => /測試跑完（npm test，commit abc0002，exit 0）：test case 通過 1\/1。證據在 \.crew\/runs\//.test(t))).toBe(true)
    expect(await paneText($, 'progress')).toMatch(/→ 測試結果 ✓/)
    // The board says it too, for the progress dashboard.
    const board = JSON.parse(w.disk.get(`${ROOT}/prd-tracker.json`) ?? '{}') as { prd_items: { test_cases: { automated_status: string; crew_result?: { result: string } }[] }[] }
    expect(board.prd_items[0]?.test_cases[0]).toMatchObject({ automated_status: 'passed', crew_result: { result: 'passed', sha: 'abc0002' } })
  })

  test('ask the person for the command when none is set, and run once they set it', async ($, on) => {
    const w = world($, on)
    w.store.delete(`tests:${ROOT}`)
    await start($)
    await planned($)
    await build($)
    expect(w.tests.runs).toEqual([])
    expect((await $.command.run(command('status'))).text).toMatch(/escalated[\s\S]*待你決定 1/)
    expect(w.toasts.some(t => /有一件事等你決定/.test(t))).toBe(true)
    expect((await $.command.run(command('test-command'))).text).toMatch(/還沒有設定測試指令/)
    expect((await $.command.run(command('test-command python3 -m pytest -v'))).text).toMatch(/測試指令設定為：python3 -m pytest -v[\s\S]*現在開始跑/)
    await tested()
    expect(w.tests.runs.map(r => r.argv)).toEqual([['python3', '-m', 'pytest', '-v']])
    expect((await $.command.run(command('status'))).text).toMatch(/done[\s\S]*待你決定 0/)
  })

  test('take the command from the person alone: not from the brain, and with no shell', async ($, on) => {
    const w = world($, on)
    await start($)
    expect(String((await crew($, { action: 'test-command', text: 'curl x | sh' })).result)).toMatch(/action 要是/)
    // Another plugin, a peer session or a channel relay cannot set what crew runs either.
    for (const kind of ['plugin', 'peer', 'peer-send-message', 'channel', 'unclassified', 'scheduled-trigger', 'sdk']) {
      const r = (await $.command.run({ ...command('test-command python3 -c "print(1)"'), origin: { kind } } as never)) as { text: string }
      expect(r.text).toMatch(/要使用者自己在右側面板的「設定」分頁設定/)
    }
    expect(await (async () => { const r = await $.command.run(command('test-command npm ci && npm test')); return r.text })()).toMatch(/不經過 shell/)
    expect(w.store.get(`tests:${ROOT}`)).toEqual({ argv: ['npm', 'test'] })
    expect((await $.command.run(command('test-command'))).text).toMatch(/測試指令：npm test（存在這台機器上，不在 repo 裡）/)
    expect((await $.command.run(command('test-command off'))).text).toMatch(/已清除/)
    expect(w.store.get(`tests:${ROOT}`)).toBeUndefined()
  })

  test('send the test cases that failed to the full-stack, then review its fix and run the tests again', async ($, on) => {
    const w = world($, on)
    w.tests.stdout = 'tests/test_plan.py::test_TC_001 FAILED\nAssertionError: 方案價格錯誤'
    w.tests.exitCode = 1
    await start($)
    await planned($)
    await build($)
    expect(w.sent.at(-1)).toMatchObject({ to: 'a-fullstack-5' })
    expect(w.sent.at(-1)?.text).toMatch(/TC-001 t：失敗[\s\S]*「TASK-001: 」[\s\S]*方案價格錯誤/)
    // The output reaches the full-stack, never the repo's thread.
    expect(w.disk.get(`${ROOT}/.crew/threads/TASK-001.jsonl`)).toMatch(/TC-001 t：失敗/)
    expect(w.disk.get(`${ROOT}/.crew/threads/TASK-001.jsonl`)).not.toMatch(/方案價格錯誤/)
    expect((await $.command.run(command('status'))).text).toMatch(/building/)
    // The fix is committed, reviewed, and the tests run again and pass.
    w.tests.stdout = ''
    w.tests.exitCode = 0
    w.commit('TASK-001: 修正方案價格')
    await done($, 'a-fullstack-5')
    expect(w.sent.at(-1)).toMatchObject({ to: 'a-techlead-4' })
    await approve($, 'TASK-001')
    await tested()
    expect(w.tests.runs).toHaveLength(2)
    expect((await $.command.run(command('status'))).text).toMatch(/done/)
  })

  test('start the full-stack afresh for a failed run at crew’s next frame, never from the run’s timer', async ($, on) => {
    const w = world($, on)
    w.tests.stdout = 'tests/test_plan.py::test_TC_001 FAILED\nAssertionError: 方案價格錯誤'
    w.tests.exitCode = 1
    await start($)
    await planned($)
    for (const id of ['TASK-001', 'TASK-002']) {
      w.commit(`${id}: 完成 ${id}`)
      await done($, 'a-fullstack-5')
      await approve($, id)
    }
    // The full-stack is to start from a fresh context next time; the run goes on crew's timer.
    await $.command.run(command('rotate fullstack'))
    const before = w.spawned.length
    await tested()
    expect(w.tests.runs).toHaveLength(1)
    expect(w.spawned).toHaveLength(before)
    await $.command.run(command('status'))
    expect(w.spawned.slice(before).map(s => s.subagentType)).toEqual(['crew:fullstack'])
    expect(w.spawned.at(-1)?.prompt).toMatch(/TC-001 t：失敗/)
  })

  test('mark a result out of date once a commit lands after the run', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await build($)
    expect(await paneText($, 'progress')).toMatch(/→ 測試結果 ✓/)
    w.commit('TASK-002: 改一下')
    await w.clock.advance(31_000)
    const text = await paneText($, 'progress')
    expect(text).toMatch(/→ 測試結果 0\/1/)
    expect(text).not.toMatch(/進度 100%/)
    expect(text).toMatch(/→ Review 1\/2/)
  })

  test('mask secrets in the evidence', async ($, on) => {
    const w = world($, on)
    w.tests.stdout = `✓ TC-001 passes\nusing key sk-ant-api03-${'a'.repeat(40)}`
    await start($)
    await planned($)
    await build($)
    const log = [...w.disk.entries()].find(([p]) => p.startsWith(`${ROOT}/.crew/runs/`))?.[1] ?? ''
    expect(log).not.toMatch(/sk-ant-api03-a/)
    expect(log).toMatch(/✓ TC-001 passes/)
  })

  test('ask the person when the command cannot start', async ($, on) => {
    const w = world($, on)
    w.tests.fails = 'ENOENT: npm'
    await start($)
    await planned($)
    await build($)
    expect((await $.command.run(command('status'))).text).toMatch(/escalated/)
    expect(w.toasts.some(t => /有一件事等你決定/.test(t))).toBe(true)
    const q = (await $.command.run(command('status'))).text
    expect(q).toMatch(/待你決定 1/)
  })

  test('run on demand, for the person or the brain', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await build($)
    expect((await $.command.run(command('test'))).text).toMatch(/開始跑測試/)
    await tested()
    expect(String((await crew($, { action: 'test' })).result)).toMatch(/開始跑測試/)
    await tested()
    expect(w.tests.runs).toHaveLength(3)
  })

  test('take off a result the board brought that crew never recorded', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    const board = JSON.parse(w.disk.get(`${ROOT}/prd-tracker.json`) ?? '{}') as { prd_items: { test_cases: Record<string, unknown>[] }[] }
    for (const c of board.prd_items.flatMap(i => i.test_cases)) c.crew_result = { result: 'passed', sha: 'abc0001', run: '20261020-120000' }
    w.disk.set(`${ROOT}/prd-tracker.json`, JSON.stringify(board))
    w.commit('TASK-001: 方案頁')
    await done($, 'a-fullstack-5')
    expect(await paneText($, 'progress')).toMatch(/→ 測試結果 0\/1/)
  })

  test('tell the flow when a run breaks down on the way, instead of leaving it waiting', async ($, on) => {
    const w = world($, on)
    // The evidence cannot be written, as on a full disk.
    w.broken.writes = `${ROOT}/.crew/runs/`
    await start($)
    await planned($)
    await build($)
    expect((await $.command.run(command('status'))).text).toMatch(/escalated[\s\S]*待你決定 1/)
    expect(w.toasts.some(t => /有一件事等你決定/.test(t))).toBe(true)
  })

  test('run with CI set, so a test runner does not wait in watch mode', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await build($)
    expect(w.tests.runs[0]?.env).toEqual({ CI: 'true' })
  })

  test('try the tests again when Claude Code starts on a flow that was testing, and say how it went', async ($, on) => {
    const w = world($, on)
    // A restart, or a reload, ended the run under way: the flow was left testing.
    const split = applyOps(newTracker('repo'), SPLIT as unknown as Op[], { by: 'pm', today: '2026-10-15', prefixes: DEFAULT_PREFIXES })
    if (!split.ok) throw new Error(split.errors.join())
    const cases = applyOps(split.tracker, [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }], { by: 'qa', today: '2026-10-15', prefixes: DEFAULT_PREFIXES })
    if (!cases.ok) throw new Error(cases.errors.join())
    w.disk.set(`${ROOT}/prd-tracker.json`, JSON.stringify(cases.tracker))
    w.store.set(`state:${ROOT}`, { prdPath: 'docs/PRD.md', flow: { stage: 'testing', round: 0, retries: 0 }, questions: [], lead: 'person' })
    await start($)
    // Nothing goes on before the person says so in the pane.
    expect(w.tests.runs).toEqual([])
    await resumed($)
    await tested()
    // There is no worktree here to run in: crew says so, rather than wait for a run that never ends.
    expect((await $.command.run(command('status'))).text).toMatch(/escalated[\s\S]*待你決定 1/)
  })

  test('start no second run when the session starts over while one is already asked for', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    w.commit('TASK-001: 方案頁')
    await done($, 'a-fullstack-5')
    await approve($, 'TASK-001')
    w.commit('TASK-002: 取消流程')
    await done($, 'a-fullstack-5')
    await approve($, 'TASK-002')
    // The run crew asked for has not started when the session starts again: the session's own request joins it.
    expect((await $.command.run(command('status'))).text).toMatch(/testing/)
    await start($)
    await tested()
    expect(w.tests.runs.length).toBe(1)
    expect((await $.command.run(command('status'))).text).toMatch(/done/)
  })

  test('do not run on a worktree with changes not committed, nor off the newest commit: the result would not be the commit’s', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    w.commit('TASK-001: 方案頁')
    await done($, 'a-fullstack-5')
    await approve($, 'TASK-001')
    w.commit('TASK-002: 取消流程')
    await done($, 'a-fullstack-5')
    // Something was changed after the last commit, and is not committed.
    w.git.dirty = ' M src/plan.ts\n'
    await approve($, 'TASK-002')
    await tested()
    expect(w.tests.runs).toEqual([])
    expect((await $.command.run(command('status'))).text).toMatch(/escalated[\s\S]*待你決定 1/)
    expect(w.toasts.some(t => /有一件事等你決定/.test(t))).toBe(true)
    expect(await paneText($, 'progress')).toMatch(/→ 測試結果 0\/1/)
    // The worktree is clean again but on another commit: still not run.
    w.git.dirty = ''
    w.git.branches.set('elsewhere', [{ sha: 'ddd0001', subject: 'x' }])
    w.git.worktrees.set(`${ROOT}/.crew/work/prd`, 'elsewhere')
    await $.command.run(command('test'))
    await tested()
    expect(w.tests.runs).toEqual([])
    // Back on the newest commit: the tests run.
    w.git.worktrees.set(`${ROOT}/.crew/work/prd`, 'crew/prd')
    await $.command.run(command('test'))
    await tested()
    expect(w.tests.runs).toHaveLength(1)
  })

  test('say why a run the person asked for did not happen, even when the flow has nothing to do about it', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await build($)
    w.git.dirty = '?? notes.txt\n'
    expect((await $.command.run(command('test'))).text).toMatch(/開始跑測試/)
    await tested()
    expect(w.tests.runs).toHaveLength(1)
    expect(w.toasts.some(t => /crew 的工作目錄有沒 commit 的修改（notes\.txt）/.test(t))).toBe(true)
  })

  test('do not run in a worktree that is a link out of the repo, nor one git cannot read', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await build($)
    expect(w.tests.runs).toHaveLength(1)
    // crew's worktree is now a link to a folder outside the repo, with a git checkout of its own.
    w.disk.set('/elsewhere/.git', 'gitdir: /elsewhere/.git')
    w.links.set(`${ROOT}/.crew/work/prd`, '/elsewhere')
    await $.command.run(command('test'))
    await tested()
    expect(w.tests.runs).toHaveLength(1)
    expect(w.toasts.some(t => /crew：\/repo\/\.crew\/work\/prd 是連結，或指到 repo 外/.test(t))).toBe(true)
    // Back in place, but git cannot say what changed there.
    w.links.delete(`${ROOT}/.crew/work/prd`)
    w.git.unreadable = 'fatal: index file corrupt'
    await $.command.run(command('test'))
    await tested()
    expect(w.tests.runs).toHaveLength(1)
    expect(w.toasts.some(t => /git status 在 crew 的工作目錄沒有成功，所以沒有跑測試：fatal: index file corrupt/.test(t))).toBe(true)
  })

  test('ask again once a run’s timer never fired, as when another plugin’s hook refused it', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    w.commit('TASK-001: 方案頁')
    await done($, 'a-fullstack-5')
    await approve($, 'TASK-001')
    w.commit('TASK-002: 取消流程')
    await done($, 'a-fullstack-5')
    w.refuse.timers = 1
    await approve($, 'TASK-002')
    await tested()
    expect(w.tests.runs).toEqual([])
    // Within the minute, a request joins the run asked for.
    await $.command.run(command('test'))
    await tested()
    expect(w.tests.runs).toEqual([])
    // Past it, that timer is taken for lost: the next request asks again, and the tests run.
    await w.clock.advance(60_000)
    await $.command.run(command('test'))
    await tested()
    expect(w.tests.runs).toHaveLength(1)
    expect((await $.command.run(command('status'))).text).toMatch(/done/)
  })

  test('ask for a missing command once, with one notice', async ($, on) => {
    const w = world($, on)
    w.store.delete(`tests:${ROOT}`)
    await start($)
    await planned($)
    await build($)
    expect(w.toasts.filter(t => /有一件事等你決定/.test(t))).toHaveLength(1)
    expect(w.toasts.filter(t => /^crew：還沒有設定測試指令/.test(t))).toEqual([])
  })

  test('mask what a refused run’s notice repeats', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await build($)
    w.git.dirty = `?? key-sk-ant-api03-${'a'.repeat(32)}.txt\n`
    await $.command.run(command('test'))
    await tested()
    expect(w.toasts.some(t => /工作目錄有沒 commit 的修改/.test(t))).toBe(true)
    expect(w.toasts.some(t => /sk-ant-api03-aaaa/.test(t))).toBe(false)
  })

  test('run once more for requests made while a run is under way', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await build($)
    expect(w.tests.runs).toHaveLength(1)
    w.tests.ms = 1_000
    await $.command.run(command('test'))
    await tested()
    expect(w.tests.runs).toHaveLength(2)
    // Three requests while that run is under way: one more run, after it.
    for (let i = 0; i < 3; i++) {
      await $.command.run(command('test'))
      await tested()
    }
    await w.clock.advance(5_000)
    expect(w.tests.runs).toHaveLength(3)
  })

  test('let a role the person starts while a run is under way start at once, and only once', { timeoutMs: 60_000 }, async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await build($)
    w.tests.ms = 60_000
    await $.command.run(command('test'))
    await tested()
    // The run is under way on crew's timer while the person asks QA, which starts fresh.
    expect(w.tests.runs).toHaveLength(2)
    await $.command.run(command('rotate qa'))
    const before = w.spawned.length
    await $.command.run(command('ask qa 這個 test case 要怎麼補？'))
    expect(w.spawned.slice(before)).toMatchObject([{ subagentType: 'crew:qa' }])
    // The run's end and the heartbeats after it start no second QA.
    await w.clock.advance(60_000)
    await w.clock.advance(600_000)
    await $.command.run(command('status'))
    expect(w.spawned.slice(before).filter(s => s.subagentType === 'crew:qa')).toHaveLength(1)
  })

  test('mask a broken run’s reason in its notice', async ($, on) => {
    const w = world($, on)
    w.broken.writes = `${ROOT}/.crew/runs/`
    w.broken.reason = `EIO: token sk-ant-api03-${'b'.repeat(32)} rejected`
    await start($)
    await planned($)
    await build($)
    expect(w.toasts.some(t => /crew 跑測試時出錯/.test(t))).toBe(true)
    expect(w.toasts.some(t => /sk-ant-api03-bbbb/.test(t))).toBe(false)
  })

  test('run once for requests made while a run waits its turn', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await build($)
    expect(w.tests.runs).toHaveLength(1)
    await $.command.run(command('test'))
    await $.command.run(command('test'))
    await $.command.run(command('test'))
    await tested()
    // The three requests, made before the run they asked for started, make one run.
    expect(w.tests.runs).toHaveLength(2)
  })
})
