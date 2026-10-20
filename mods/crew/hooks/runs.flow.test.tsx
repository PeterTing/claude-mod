import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { approve, build, command, done, paneText, PLAN, ROOT, SPLIT, start, tested, world, write } from './world'

/** crew runs the person's test command on its branch; each test case passes or not by what the run printed. */

const planned = async ($: Engine) => {
  await $.command.run(command('start docs/PRD.md'))
  await write($, 'a-pm-1', SPLIT)
  await done($, 'a-pm-1')
  await write($, 'a-qa-2', [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }])
  await done($, 'a-qa-2')
  await write($, 'a-techlead-3', PLAN)
  await done($, 'a-techlead-3')
}

const crew = ($: Engine, input: Record<string, unknown>) => $.tool.call({ tool: 'mcp__crew__crew', tool_use_id: `c-${Math.random()}`, ...input } as never) as Promise<{ result: unknown }>

describe('crew’s test runs', () => {
  test('run the person’s command in crew’s worktree, by its words, and keep what it printed as evidence out of git', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await build($)
    expect(w.tests.runs).toEqual([{ argv: ['npm', 'test'], cwd: `${ROOT}/.crew/work/prd` }])
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
    expect(w.sent.at(-1)).toMatchObject({ to: 'a-fullstack-4' })
    expect(w.sent.at(-1)?.text).toMatch(/TC-001 t：失敗[\s\S]*方案價格錯誤[\s\S]*「TASK-001: 」/)
    expect((await $.command.run(command('status'))).text).toMatch(/building/)
    // The fix is committed, reviewed, and the tests run again and pass.
    w.tests.stdout = ''
    w.tests.exitCode = 0
    w.commit('TASK-001: 修正方案價格')
    await done($, 'a-fullstack-4')
    expect(w.sent.at(-1)).toMatchObject({ to: 'a-techlead-3' })
    await approve($, 'TASK-001')
    await tested()
    expect(w.tests.runs).toHaveLength(2)
    expect((await $.command.run(command('status'))).text).toMatch(/done/)
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
    await done($, 'a-fullstack-4')
    expect(await paneText($, 'progress')).toMatch(/→ 測試結果 0\/1/)
  })
})
