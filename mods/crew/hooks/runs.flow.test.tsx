import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { applyOps, DEFAULT_PREFIXES, newTracker } from './board'
import type { Op } from './board'
import { accepted, agentOf, approve, build, checked, command, designed, done, paneText, PLAN, resumed, ROOT, SPLIT, start, tested, world, write } from './world'

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

/** The flow's own test runs, in crew's worktree: with one builder, each approved task's commit is also tested apart, in QA's. */
const ours = <R extends { cwd?: string }>(w: { tests: { runs: R[] } }): R[] => w.tests.runs.filter(r => r.cwd !== `${ROOT}/.crew/work/prd-qa`)

describe('crew’s test runs', () => {
  test('run the person’s command in crew’s worktree, by its words, and keep what it printed as evidence out of git', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await build($)
    // With one builder, TASK-001's approved commit is tested at once in QA's worktree; the last task's is the flow's own run.
    expect(w.tests.runs).toEqual([
      { argv: ['npm', 'test'], cwd: `${ROOT}/.crew/work/prd-qa`, env: { CI: 'true' } },
      { argv: ['npm', 'test'], cwd: `${ROOT}/.crew/work/prd`, env: { CI: 'true' } },
    ])
    const logs = [...w.disk.keys()].filter(p => p.startsWith(`${ROOT}/.crew/runs/`))
    expect(logs).toHaveLength(2)
    const log = logs.map(p => w.disk.get(p) ?? '').find(x => x.includes('# /repo/.crew/work/prd\n')) ?? ''
    expect(log).toMatch(/^\$ npm test\n# \/repo\/\.crew\/work\/prd\n# commit abc0002\n# exit 0\n\n[\s\S]*✓ TC-001 passes/)
    expect(w.disk.get(`${ROOT}/.crew/.gitignore`)).toMatch(/runs\//)
    // Built and tested: QA hands each feature over and the person passes it.
    await accepted($)
    expect((await $.command.run(command('status'))).text).toMatch(/done/)
    expect(w.toasts.some(t => /測試跑完（npm test，commit abc0002，exit 0）：test case 通過 1\/1。證據在 \.crew\/runs\//.test(t))).toBe(true)
    expect(await paneText($, 'progress')).toMatch(/→ 測試結果 ✓/)
    // The board says it too, for the progress dashboard.
    const board = JSON.parse(w.disk.get(`${ROOT}/.crew/prd-tracker.json`) ?? '{}') as { prd_items: { test_cases: { automated_status: string; crew_result?: { result: string } }[] }[] }
    expect(board.prd_items[0]?.test_cases[0]).toMatchObject({ automated_status: 'passed', crew_result: { result: 'passed', sha: 'abc0002' } })
  })

  test('ask the person for the command when none is set, and run once they set it', async ($, on) => {
    const w = world($, on)
    w.store.delete(`tests:${ROOT}`)
    await start($)
    await planned($)
    // Asked before building starts, for the app alone: crew finds the project's test commands itself.
    expect((await $.command.run(command('status'))).text).toMatch(/escalated[\s\S]*待你決定 1/)
    await $.command.run(command('answer Q-03 先不設定'))
    await build($, undefined, agentOf('fullstack'))
    expect(ours(w)).toEqual([])
    await checked($)
    expect(w.spawned.some(s => s.subagentType === 'crew:checker')).toBe(true)
    // Nothing found and none set: no test runs, the person is told once, and the flow goes on without asking.
    expect((await $.command.run(command('status'))).text).toMatch(/accepting[\s\S]*待你決定 0/)
    expect(w.toasts.filter(t => /專案裡找不到測試指令/.test(t))).toHaveLength(1)
    expect((await $.command.run(command('test-command'))).text).toMatch(/還沒有設定測試指令/)
    expect((await $.command.run(command('test-command python3 -m pytest -v'))).text).toMatch(/測試指令設定為：python3 -m pytest -v[\s\S]*現在開始跑/)
    await tested()
    expect(ours(w).map(r => r.argv)).toEqual([['python3', '-m', 'pytest', '-v']])
    // Built and tested: QA hands each feature over and the person passes it.
    await accepted($)
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
    expect(ours(w)).toHaveLength(2)
    // Built and tested: QA hands each feature over and the person passes it.
    await accepted($)
    expect((await $.command.run(command('status'))).text).toMatch(/done/)
  })

  test('tell the full-stack the person’s answer to tests that kept failing with the next fix they ask for', async ($, on) => {
    const w = world($, on)
    w.tests.stdout = 'tests/test_plan.py::test_TC_001 FAILED\nAssertionError: 方案價格錯誤'
    w.tests.exitCode = 1
    await start($)
    await planned($)
    await build($)
    const status = async () => (await $.command.run(command('status'))).text ?? ''
    for (let i = 0; i < 6 && !/escalated/.test(await status()); i += 1) {
      w.commit(`TASK-001: 修正 ${i}`)
      await done($, 'a-fullstack-5')
      await approve($, 'TASK-001')
      await tested()
    }
    expect(await status()).toMatch(/escalated/)
    const asked = (w.store.get(`state:${ROOT}`) as { questions: { id: string; item?: string; status: string }[] }).questions.find(q => q.status === 'open')
    expect(asked?.item).toBe('TC-001')
    const [sent, spawned] = [w.sent.length, w.spawned.length]
    await $.command.run(command(`answer ${asked?.id ?? ''} 預期結果寫錯了，照新價格改測試`))
    await tested()
    await status()
    // The run fails again: the fix it asks for carries the answer.
    const work = [...w.sent.slice(sent).filter(m => m.to.startsWith('a-fullstack')).map(m => m.text), ...w.spawned.slice(spawned).filter(s => s.subagentType === 'crew:fullstack').map(s => s.prompt)]
    expect(work).toHaveLength(1)
    expect(work[0]).toMatch(/TC-001 t：失敗[\s\S]*使用者對測試的回答（修正時照這個做）：\ncrew 問：測試跑了 3 次[\s\S]*\n使用者回答：預期結果寫錯了，照新價格改測試\n/)
    expect(work[0]).not.toMatch(/一句話回報/)
    // Told once: the fix after it does not repeat it.
    w.commit('TASK-001: 照新價格改測試')
    await done($, 'a-fullstack-5')
    await approve($, 'TASK-001')
    const again = w.sent.length
    await tested()
    expect(w.sent.slice(again).some(m => /預期結果寫錯了/.test(m.text))).toBe(false)
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
    expect(ours(w)).toHaveLength(1)
    expect(w.spawned).toHaveLength(before)
    await $.command.run(command('status'))
    expect(w.spawned.slice(before).map(s => s.subagentType)).toEqual(['crew:fullstack'])
    expect(w.spawned.at(-1)?.prompt).toMatch(/TC-001 t：失敗/)
  })

  test('hand a waiting fix to the full-stack after the person’s question, in the agent the question started', async ($, on) => {
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
    await $.command.run(command('rotate fullstack'))
    const before = w.spawned.length
    await tested()
    expect(w.spawned).toHaveLength(before)
    // The person asks the full-stack before any frame started the fix: one agent, the question first.
    await $.command.run(command('ask fullstack 為什麼失敗？'))
    expect(w.spawned.slice(before).map(s => s.subagentType)).toEqual(['crew:fullstack'])
    expect(w.spawned.at(-1)?.prompt).toMatch(/為什麼失敗/)
    const agent = `a-fullstack-${w.spawned.length}`
    await done($, agent, '失敗是因為價格少乘了稅率。')
    // The answer is the person's; the fix then goes to the same agent.
    expect((await $.command.run(command('thread ASK-01'))).text).toMatch(/少乘了稅率/)
    expect(w.spawned).toHaveLength(before + 1)
    expect(w.sent.at(-1)).toMatchObject({ to: agent })
    expect(w.sent.at(-1)?.text).toMatch(/TC-001 t：失敗/)
  })

  test('hand a waiting fix on another model to the agent the person’s question woke, after the answer', async ($, on) => {
    const w = world($, on)
    // The climb this work takes is not what the test is about: crew does not ask before it here.
    w.store.set(`settings:${ROOT}`, { askBeforeSwitch: false })
    w.tests.stdout = 'tests/test_plan.py::test_TC_001 FAILED\nAssertionError: 方案價格錯誤'
    w.tests.exitCode = 1
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    await done($, 'a-pm-1')
    await write($, 'a-qa-2', [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }])
    await done($, 'a-qa-2')
    await designed($)
    // TASK-001 is large (Opus), TASK-002 small (Sonnet): the full-stack ends on Sonnet, and a fix of TASK-001 needs Opus.
    await write($, 'a-techlead-4', [
      { op: 'add_task', feature: 'PRD-001', criteria: ['AC-001'], title: '方案頁', detail: '', size: 'L' },
      { op: 'add_task', feature: 'PRD-002', criteria: ['AC-002'], title: '取消流程', detail: '', size: 'S' },
    ])
    await done($, 'a-techlead-4')
    for (const id of ['TASK-001', 'TASK-002']) {
      w.commit(`${id}: 完成 ${id}`)
      await done($, agentOf('fullstack'))
      await approve($, id, agentOf('techlead'))
    }
    const before = w.spawned.length
    await tested()
    expect(w.spawned).toHaveLength(before)
    // The person asks the idle agent the fix would replace: it is woken for the question, and kept.
    const asked = agentOf('fullstack')
    await $.command.run(command('ask fullstack 為什麼失敗？'))
    expect(w.spawned).toHaveLength(before)
    expect(agentOf('fullstack')).toBe(asked)
    await done($, asked, '失敗是因為價格少乘了稅率。')
    expect((await $.command.run(command('thread ASK-01'))).text).toMatch(/少乘了稅率/)
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
    expect(ours(w)).toHaveLength(3)
  })

  test('take off a result the board brought that crew never recorded', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    const board = JSON.parse(w.disk.get(`${ROOT}/.crew/prd-tracker.json`) ?? '{}') as { prd_items: { test_cases: Record<string, unknown>[] }[] }
    for (const c of board.prd_items.flatMap(i => i.test_cases)) c.crew_result = { result: 'passed', sha: 'abc0001', run: '20261020-120000' }
    w.disk.set(`${ROOT}/.crew/prd-tracker.json`, JSON.stringify(board))
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
    expect(ours(w)[0]?.env).toEqual({ CI: 'true' })
  })

  test('try the tests again when Claude Code starts on a flow that was testing, and say how it went', async ($, on) => {
    const w = world($, on)
    // A restart, or a reload, ended the run under way: the flow was left testing.
    const split = applyOps(newTracker('repo'), SPLIT as unknown as Op[], { by: 'pm', today: '2026-10-15', prefixes: DEFAULT_PREFIXES })
    if (!split.ok) throw new Error(split.errors.join())
    const cases = applyOps(split.tracker, [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }], { by: 'qa', today: '2026-10-15', prefixes: DEFAULT_PREFIXES })
    if (!cases.ok) throw new Error(cases.errors.join())
    w.disk.set(`${ROOT}/.crew/prd-tracker.json`, JSON.stringify(cases.tracker))
    w.store.set(`state:${ROOT}`, { prdPath: 'docs/PRD.md', flow: { stage: 'testing', round: 0, retries: 0 }, questions: [], lead: 'person' })
    await start($)
    // Nothing goes on before the person says so in the pane: the brain cannot run the tests on a held flow either.
    expect(String((await crew($, { action: 'test' })).result)).toMatch(/流程暫停中/)
    await tested()
    expect(ours(w)).toEqual([])
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
    expect(ours(w).length).toBe(1)
    // Built and tested: QA hands each feature over and the person passes it.
    await accepted($)
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
    expect(ours(w)).toEqual([])
    expect((await $.command.run(command('status'))).text).toMatch(/escalated[\s\S]*待你決定 1/)
    expect(w.toasts.some(t => /有一件事等你決定/.test(t))).toBe(true)
    expect(await paneText($, 'progress')).toMatch(/→ 測試結果 0\/1/)
    // The worktree is clean again but on another commit: still not run.
    w.git.dirty = ''
    w.git.branches.set('elsewhere', [{ sha: 'ddd0001', subject: 'x' }])
    w.git.worktrees.set(`${ROOT}/.crew/work/prd`, 'elsewhere')
    await $.command.run(command('test'))
    await tested()
    expect(ours(w)).toEqual([])
    // Back on the newest commit: the tests run.
    w.git.worktrees.set(`${ROOT}/.crew/work/prd`, 'crew/prd')
    await $.command.run(command('test'))
    await tested()
    expect(ours(w)).toHaveLength(1)
  })

  test('say why a run the person asked for did not happen, even when the flow has nothing to do about it', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await build($)
    w.git.dirty = '?? notes.txt\n'
    expect((await $.command.run(command('test'))).text).toMatch(/開始跑測試/)
    await tested()
    expect(ours(w)).toHaveLength(1)
    expect(w.toasts.some(t => /crew 的工作目錄有沒 commit 的修改（notes\.txt）/.test(t))).toBe(true)
  })

  test('do not run in a worktree that is a link out of the repo, nor one git cannot read', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await build($)
    expect(ours(w)).toHaveLength(1)
    // crew's worktree is now a link to a folder outside the repo, with a git checkout of its own.
    w.disk.set('/elsewhere/.git', 'gitdir: /elsewhere/.git')
    w.links.set(`${ROOT}/.crew/work/prd`, '/elsewhere')
    await $.command.run(command('test'))
    await tested()
    expect(ours(w)).toHaveLength(1)
    expect(w.toasts.some(t => /crew：\/repo\/\.crew\/work\/prd 是連結，或指到 repo 外/.test(t))).toBe(true)
    // Back in place, but git cannot say what changed there.
    w.links.delete(`${ROOT}/.crew/work/prd`)
    w.git.unreadable = 'fatal: index file corrupt'
    await $.command.run(command('test'))
    await tested()
    expect(ours(w)).toHaveLength(1)
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
    expect(ours(w)).toEqual([])
    // Within the minute, a request joins the run asked for.
    await $.command.run(command('test'))
    await tested()
    expect(ours(w)).toEqual([])
    // Past it, that timer is taken for lost: the next request asks again, and the tests run.
    await w.clock.advance(60_000)
    await $.command.run(command('test'))
    await tested()
    expect(ours(w)).toHaveLength(1)
    // Built and tested: QA hands each feature over and the person passes it.
    await accepted($)
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
    expect(ours(w)).toHaveLength(1)
    w.tests.ms = 1_000
    await $.command.run(command('test'))
    await tested()
    expect(ours(w)).toHaveLength(2)
    // Three requests while that run is under way: one more run, after it.
    for (let i = 0; i < 3; i++) {
      await $.command.run(command('test'))
      await tested()
    }
    await w.clock.advance(5_000)
    expect(ours(w)).toHaveLength(3)
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
    expect(ours(w)).toHaveLength(2)
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
    expect(ours(w)).toHaveLength(1)
    await $.command.run(command('test'))
    await $.command.run(command('test'))
    await $.command.run(command('test'))
    await tested()
    // The three requests, made before the run they asked for started, make one run.
    expect(ours(w)).toHaveLength(2)
  })

  test('run several commands one after another, each with a log of its own, and take their results together', async ($, on) => {
    const w = world($, on)
    w.store.set(`tests:${ROOT}`, { argv: ['npm', '--prefix', 'web', 'test'], list: [['npm', '--prefix', 'web', 'test'], ['npm', '--prefix', 'api', 'test']] })
    w.tests.by.set('npm --prefix web test', { stdout: 'Tests  4 passed (4)', exitCode: 0 })
    w.tests.by.set('npm --prefix api test', { stdout: '✓ TC-001 passes\nTests  1 passed (1)', exitCode: 0 })
    await start($)
    await planned($)
    await build($)
    expect(ours(w).map(r => r.argv.join(' '))).toEqual(['npm --prefix web test', 'npm --prefix api test'])
    const logs = [...w.disk.keys()].filter(p => p.startsWith(`${ROOT}/.crew/runs/`) && w.disk.get(p)?.includes('# /repo/.crew/work/prd\n') === true)
    expect(logs).toHaveLength(3)
    const head = logs.map(p => w.disk.get(p) ?? '').find(t => t.startsWith('$ npm --prefix web test\n$ npm --prefix api test\n')) ?? ''
    expect(head).toMatch(/# exit 0\n\n每一條測試指令的紀錄：\n1\. \.crew\/runs\/\d{8}-\d{6}-1\.log（exit 0・0 秒）\n2\. \.crew\/runs\/\d{8}-\d{6}-2\.log（exit 0・0 秒）/)
    expect(logs.some(p => /-2\.log$/.test(p) && /^\$ npm --prefix api test\n[\s\S]*✓ TC-001 passes/.test(w.disk.get(p) ?? ''))).toBe(true)
    expect(w.toasts.some(t => /測試跑完（npm --prefix web test；npm --prefix api test，commit abc0002，exit 0）：test case 通過 1\/1/.test(t))).toBe(true)
    // The settings show each command with how its last run went.
    const settings = await paneText($, 'settings')
    expect(settings.match(/上次：commit abc0002・exit 0・跑了 0 秒・紀錄在 \.crew\/runs/g)).toHaveLength(2)
    await accepted($)
    expect((await $.command.run(command('status'))).text).toMatch(/done/)
  })

  test('set, add, change and take out test commands, at most five, typed by the person', async ($, on) => {
    const w = world($, on)
    await start($)
    const stored = () => (w.store.get(`tests:${ROOT}`) as { list?: string[][] } | undefined)?.list?.map(a => a.join(' '))
    expect((await $.command.run(command('test-command add npm --prefix api test'))).text).toMatch(/測試指令（依序執行，每條最多 10 分鐘）：\n1\. npm test\n2\. npm --prefix api test\n[\s\S]*下次跑測試時用/)
    expect(stored()).toEqual(['npm test', 'npm --prefix api test'])
    // Kept where a crew from before there could be several reads its one.
    expect((w.store.get(`tests:${ROOT}`) as { argv?: string[] }).argv).toEqual(['npm', 'test'])
    expect((await $.command.run(command('test-command add npm --prefix api test'))).text).toMatch(/已經有了/)
    expect((await $.command.run(command('test-command go version'))).text).toMatch(/已經有 2 條測試指令，沒有改/)
    expect((await $.command.run(command('test-command set 2 npm --prefix backend/api test'))).text).toMatch(/2\. npm --prefix backend\/api test/)
    expect((await $.command.run(command('test-command set 3 go -C svc test -v ./...'))).text).toMatch(/3\. go -C svc test -v \.\/\.\.\./)
    expect((await $.command.run(command('test-command set 2 npm ci && npm test'))).text).toMatch(/不經過 shell/)
    for (const cmd of ['python3 -m pytest -v a', 'python3 -m pytest -v b']) await $.command.run(command(`test-command add ${cmd}`))
    expect(stored()).toHaveLength(5)
    expect((await $.command.run(command('test-command add python3 -m pytest -v c'))).text).toMatch(/最多 5 條測試指令/)
    expect((await $.command.run(command('test-command remove 9'))).text).toMatch(/沒有刪：請寫要刪第幾條（1 到 5）/)
    await $.command.run(command('test-command remove 1'))
    expect(stored()).toEqual(['npm --prefix backend/api test', 'go -C svc test -v ./...', 'python3 -m pytest -v a', 'python3 -m pytest -v b'])
    expect((w.store.get(`tests:${ROOT}`) as { argv?: string[] }).argv).toEqual(['npm', '--prefix', 'backend/api', 'test'])
    expect((await $.command.run(command('test-command'))).text).toMatch(/測試指令（crew 依序執行）：\n1\. npm --prefix backend\/api test\n2\. go -C svc/)
    // A record kept before there could be several reads as one command.
    w.store.set(`tests:${ROOT}`, { argv: ['npm', 'test'] })
    expect((await $.command.run(command('test-command'))).text).toMatch(/^測試指令：npm test（存在這台機器上/)
    expect((await $.command.run(command('test-command remove 1'))).text).toMatch(/已清除測試指令/)
    expect(w.store.get(`tests:${ROOT}`)).toBeUndefined()
    // Not from the brain, another plugin or a peer: the person's alone.
    const r = (await $.command.run({ ...command('test-command add curl x'), origin: { kind: 'plugin' } } as never)) as { text: string }
    expect(r.text).toMatch(/要使用者自己在右側面板的「設定」分頁設定/)
  })

  test('run the tests of a folder crew finds in the project beside the person’s command, and pass the test case they name', async ($, on) => {
    const w = world($, on)
    w.tests.stdout = 'Tests  5 passed (5)'
    w.git.grep = 'backend/api/src/plan.test.ts\0TC-001\n'
    w.git.listed = ['package.json', 'backend/api/package.json']
    w.git.blobs.set('backend/api/package.json', JSON.stringify({ scripts: { test: 'vitest run' } }))
    w.tests.by.set('npm --prefix backend/api test', { stdout: '✓ src/plan.test.ts > TC-001 passes\nTests  1 passed (1)', exitCode: 0 })
    await start($)
    await planned($)
    await build($)
    await tested()
    // crew found backend/api's test script itself: its command runs before the person's, the test case passes, and nothing is asked.
    expect(ours(w).map(r => r.argv.join(' ')).slice(-2)).toEqual(['npm --prefix backend/api test', 'npm test'])
    const after = w.store.get(`state:${ROOT}`) as { questions: { status: string }[]; flow: { stage: string } }
    expect(after.questions.filter(q => q.status === 'open')).toEqual([])
    expect(after.flow.stage).not.toBe('escalated')
    const fresh = JSON.parse(w.disk.get(`${ROOT}/.crew/prd-tracker.json`) ?? '{}') as { prd_items: { test_cases: { crew_none?: object; crew_result?: object }[] }[] }
    expect(fresh.prd_items[0]?.test_cases[0]).toMatchObject({ crew_result: { result: 'passed' } })
    expect(fresh.prd_items[0]?.test_cases[0]?.crew_none).toBeUndefined()
  })
})

