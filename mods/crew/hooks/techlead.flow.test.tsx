import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { applyOps, DEFAULT_PREFIXES, newTracker } from './board'
import type { Op } from './board'
import { requirementsOf } from './prd'
import { build, command, done, paneText, PLAN, PRD, ROOT, SPLIT, start, world, write } from './world'

/** The tech lead breaks the tested criteria into tasks; G3 holds every criterion to one. */

const PRD_PATH = `${ROOT}/docs/PRD.md`
const ADDED = '使用者可以改成年繳方案。'
const CHANGED = `${PRD}\n\n${ADDED}`
const NEW_REQ = requirementsOf(CHANGED).find(r => r.text === ADDED)?.id ?? ''

const tested = async ($: Engine) => {
  await $.command.run(command('start docs/PRD.md'))
  await write($, 'a-pm-1', SPLIT)
  await done($, 'a-pm-1')
  await write($, 'a-qa-2', [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }])
  await done($, 'a-qa-2')
}

const call = ($: Engine, tool: string, input: Record<string, unknown>, agentId?: string) =>
  $.tool.call({ tool: `mcp__crew__${tool}`, tool_use_id: `v-${Math.random()}`, ...(agentId === undefined ? {} : { agentId }), ...input } as never) as Promise<{ result: unknown }>

describe('the tech lead', () => {
  test('is asked for tasks once every criterion is tested, and finishes the flow when each has one', async ($, on) => {
    const w = world($, on)
    await start($)
    await tested($)
    expect(w.spawned.at(-1)).toMatchObject({ subagentType: 'crew:techlead', model: 'opus' })
    expect((await $.command.run(command('status'))).text).toMatch(/planning[\s\S]*TL/)
    expect(String((await write($, 'a-techlead-3', PLAN)).result)).toMatch(/TASK-001、TASK-002/)
    await done($, 'a-techlead-3')
    await build($)
    expect((await $.command.run(command('status'))).text).toMatch(/done/)
    expect(w.toasts.at(-1)).toMatch(/G3 2\/2/)
    expect(String((await call($, 'board_read', {}, 'a-pm-1')).result)).toMatch(/AC-001 可以選月繳方案 ← TC-001 · 任務 TASK-001/)
  })

  test('is sent back to criteria without a task, and then the person is asked', async ($, on) => {
    const w = world($, on)
    await start($)
    await tested($)
    await write($, 'a-techlead-3', PLAN.slice(0, 1))
    await done($, 'a-techlead-3')
    expect(w.sent.at(-1)?.to).toBe('a-techlead-3')
    expect(w.sent.at(-1)?.text).toMatch(/還沒有任務[\s\S]*AC-002/)
    await done($, 'a-techlead-3')
    expect((await $.command.run(command('status'))).text).toMatch(/escalated[\s\S]*待你決定 1/)
    await $.command.run(command('answer Q-01 AC-002 也由 TASK-001 處理'))
    expect(w.sent.at(-1)?.to).toBe('a-techlead-3')
    expect((await $.command.run(command('status'))).text).toMatch(/planning/)
  })

  test('takes the person’s questions, and has its writes kept to tasks', async ($, on) => {
    const w = world($, on)
    await start($)
    await tested($)
    await write($, 'a-techlead-3', PLAN)
    await done($, 'a-techlead-3')
    expect((await $.command.run(command('ask techlead 任務要多細？'))).text).toMatch(/Tech lead/)
    expect(w.sent.at(-1)).toMatchObject({ to: 'a-techlead-3' })
    expect(String((await write($, 'a-techlead-3', [{ op: 'add_feature', title: 'x', summary: '' }])).result)).toMatch(/Tech lead 不能做 add_feature/)
  })

  test('asks the PM through a thread, and gets the PM’s answer back', async ($, on) => {
    const w = world($, on)
    await start($)
    await tested($)
    await write($, 'a-techlead-3', PLAN.slice(0, 1))
    expect(String((await call($, 'thread_post', { item: 'AC-002', to: 'pm', text: '到期末是看台灣時間嗎？' }, 'a-techlead-3')).result)).toMatch(/PM 下次被叫醒時會看到/)
    await done($, 'a-techlead-3')
    expect(w.sent.at(-1)?.to).toBe('a-pm-1')
    expect(w.sent.at(-1)?.text).toMatch(/Tech lead 在這些項目的討論串留言給你：AC-002/)
    await call($, 'thread_post', { item: 'AC-002', to: 'techlead', text: '是' }, 'a-pm-1')
    await done($, 'a-pm-1')
    expect(w.sent.at(-1)?.to).toBe('a-techlead-3')
    expect(w.sent.at(-1)?.text).toMatch(/PM 在這些項目的討論串留言給你：AC-002/)
    await write($, 'a-techlead-3', PLAN.slice(1))
    await done($, 'a-techlead-3')
    await build($)
    expect((await $.command.run(command('status'))).text).toMatch(/done/)
  })

  test('picks its plan up again after Claude Code restarts', async ($, on) => {
    const w = world($, on)
    const tracker = applyOps(newTracker('repo'), SPLIT as unknown as Op[], { by: 'pm', today: '2026-10-15', prefixes: DEFAULT_PREFIXES })
    if (!tracker.ok) throw new Error(tracker.errors.join())
    const withTests = applyOps(tracker.tracker, [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }], { by: 'qa', today: '2026-10-15', prefixes: DEFAULT_PREFIXES })
    if (!withTests.ok) throw new Error(withTests.errors.join())
    const half = applyOps(withTests.tracker, PLAN.slice(0, 1) as unknown as Op[], { by: 'techlead', today: '2026-10-15', prefixes: DEFAULT_PREFIXES })
    if (!half.ok) throw new Error(half.errors.join())
    w.disk.set(`${ROOT}/prd-tracker.json`, JSON.stringify(half.tracker))
    w.store.set(`state:${ROOT}`, { prdPath: 'docs/PRD.md', flow: { stage: 'planning', round: 0, retries: 0 }, questions: [], lead: 'person' })
    await start($)
    expect(w.spawned.map(s => s.subagentType)).toEqual(['crew:techlead'])
    expect(w.spawned[0]?.prompt).toMatch(/重開過[\s\S]*AC-002/)
  })

  test('takes a message to it that was handled before a restart as read', async ($, on) => {
    const w = world($, on)
    const tracker = applyOps(newTracker('repo'), SPLIT as unknown as Op[], { by: 'pm', today: '2026-10-15', prefixes: DEFAULT_PREFIXES })
    if (!tracker.ok) throw new Error(tracker.errors.join())
    const withTests = applyOps(tracker.tracker, [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }], { by: 'qa', today: '2026-10-15', prefixes: DEFAULT_PREFIXES })
    if (!withTests.ok) throw new Error(withTests.errors.join())
    const plannedBoard = applyOps(withTests.tracker, PLAN as unknown as Op[], { by: 'techlead', today: '2026-10-15', prefixes: DEFAULT_PREFIXES })
    if (!plannedBoard.ok) throw new Error(plannedBoard.errors.join())
    w.commit('TASK-001: 方案頁', 'HEAD')
    w.commit('TASK-002: 取消流程', 'HEAD')
    w.disk.set(`${ROOT}/prd-tracker.json`, JSON.stringify(plannedBoard.tracker))
    w.disk.set(`${ROOT}/.crew/threads/AC-001.jsonl`, `${JSON.stringify({ t: 1, n: 1, item: 'AC-001', from: 'pm', to: 'techlead', text: '用台灣時間' })}\n`)
    w.store.set(`state:${ROOT}`, { prdPath: 'docs/PRD.md', flow: { stage: 'done', round: 0, retries: 0 }, questions: [], lead: 'person' })
    await start($)
    await $.command.run(command('ask pm 月繳價格多少？'))
    await done($, 'a-pm-1', '一百元')
    expect(w.spawned.map(s => s.subagentType)).toEqual(['crew:pm'])
  })

  test('says an answer to the tech lead’s own question went to the tech lead', async ($, on) => {
    world($, on)
    await start($)
    await tested($)
    await call($, 'ask_person', { question: '要用哪個資料庫？', item: 'AC-001' }, 'a-techlead-3')
    expect((await $.command.run(command('answer Q-01 SQLite'))).text).toMatch(/轉給 Tech lead/)
  })

  test('shows the tasks it plans among what was done today', async ($, on) => {
    world($, on)
    await start($)
    await tested($)
    await write($, 'a-techlead-3', PLAN)
    // Two features with criteria, two criteria with test cases, and the tech lead's two tasks.
    expect(await paneText($)).toMatch(/今天完成 6 項/)
  })

  test('keeps one tech lead when the PRD changes while it plans', async ($, on) => {
    const w = world($, on)
    await start($)
    await tested($)
    w.disk.set(PRD_PATH, CHANGED)
    await w.clock.advance(10_000)
    await write($, 'a-pm-1', [
      { op: 'add_criterion', feature: 'PRD-001', text: '可以改成年繳' },
      { op: 'link_requirements', feature: 'PRD-001', requirements: [NEW_REQ] },
    ])
    await done($, 'a-pm-1')
    await write($, 'a-qa-2', [{ op: 'add_test_case', criteria: ['AC-003'], title: 't', steps: ['s'], expected: 'e' }])
    await done($, 'a-qa-2')
    // The tech lead's first run ends: it is asked for what is still without a task, as itself.
    await write($, 'a-techlead-3', PLAN)
    await done($, 'a-techlead-3')
    expect(w.sent.at(-1)?.to).toBe('a-techlead-3')
    expect(w.sent.at(-1)?.text).toMatch(/AC-003/)
    await write($, 'a-techlead-3', [{ op: 'add_task', feature: 'PRD-001', criteria: ['AC-003'], title: '年繳', detail: '', size: 'S' }])
    await done($, 'a-techlead-3')
    await build($, ['TASK-001', 'TASK-002', 'TASK-003'])
    expect(w.spawned.map(s => s.subagentType)).toEqual(['crew:pm', 'crew:qa', 'crew:techlead', 'crew:fullstack'])
    expect((await $.command.run(command('status'))).text).toMatch(/done/)
  })

  test('does not call the plan done on the progress tab while the board does not answer a changed PRD', async ($, on) => {
    const w = world($, on)
    await start($)
    await tested($)
    await write($, 'a-techlead-3', PLAN)
    await done($, 'a-techlead-3')
    w.disk.set(PRD_PATH, CHANGED)
    await w.clock.advance(10_000)
    expect(await paneText($, 'progress')).not.toMatch(/架構 ✓/)
  })

  test('sends an answer to its own question to it', async ($, on) => {
    const w = world($, on)
    await start($)
    await tested($)
    await call($, 'ask_person', { question: '年繳要不要做？' }, 'a-techlead-3')
    expect((await $.command.run(command('answer Q-01 先不做'))).text).toBe('已把 Q-01 的回答轉給 Tech lead。')
    expect(w.sent.at(-1)?.to).toBe('a-techlead-3')
  })
})
