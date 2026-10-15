import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { applyOps, newTracker } from './board'
import type { Op } from './board'
import { command, done, ROOT, SPLIT, start, world, write } from './world'

/** The main conversation running crew in plain language, and crew picking up after a restart. */

const crew = ($: Engine, input: Record<string, unknown>, agentId?: string) =>
  $.tool.call({ tool: 'mcp__crew__crew', tool_use_id: `c-${Math.random()}`, ...(agentId === undefined ? {} : { agentId }), ...input } as never) as Promise<{ result: unknown }>

const askPerson = ($: Engine, agentId: string, question: string, item?: string) =>
  $.tool.call({ tool: 'mcp__crew__ask_person', tool_use_id: `q-${Math.random()}`, agentId, question, ...(item === undefined ? {} : { item }) } as never)

const STATE = `${ROOT}/.crew/state.json`

describe('the brain runs crew', () => {
  test('gives the main conversation a crew tool', async ($, on) => {
    const w = world($, on)
    await start($)
    expect(w.registered.tools.at(-1)).toBe('crew')
  })

  test('starts a PRD for the brain, brings a role’s question back to it, and takes the answer', async ($, on) => {
    const w = world($, on)
    await start($)
    const r = await crew($, { action: 'start', path: 'docs/PRD.md' })
    expect(String(r.result)).toMatch(/PM 正在拆 docs\/PRD\.md/)
    expect(w.spawned[0]?.subagentType).toBe('crew:pm')

    await askPerson($, 'a-pm-1', '年繳要不要做？', 'PRD-001')
    // Sent when the PM's run ends: a prompt cannot be submitted from inside a tool call.
    expect(w.prompts).toEqual([])
    await done($, 'a-pm-1')
    expect(w.logs).toEqual([])
    expect(w.prompts.at(-1)).toMatch(/^\[crew\] PM 有一件事要使用者決定（Q-01）：年繳要不要做？/)
    expect(w.prompts.at(-1)).toMatch(/answer/)

    const a = await crew($, { action: 'answer', question: 'Q-01', text: '這一版不做' })
    expect(String(a.result)).toMatch(/轉給 PM/)
    expect(w.sent.at(-1)?.to).toBe('a-pm-1')
  })

  test('sends what is waiting for the brain when its own turn ends, too', async ($, on) => {
    const w = world($, on)
    await start($)
    await crew($, { action: 'start', path: 'docs/PRD.md' })
    await askPerson($, 'a-pm-1', '年繳要不要做？')
    await $.turn.complete({ answer: '好', durationMs: 5, isAborted: false, turnId: 'turn-main', reason: 'answer' } as never)
    expect(w.prompts).toHaveLength(1)
    expect(w.prompts[0]).toMatch(/Q-01/)
    await done($, 'a-pm-1')
    expect(w.prompts).toHaveLength(1)
  })

  test('tells the brain when the work it started is done', async ($, on) => {
    const w = world($, on)
    await start($)
    await crew($, { action: 'start', path: 'docs/PRD.md' })
    await write($, 'a-pm-1', SPLIT)
    await done($, 'a-pm-1')
    await write($, 'a-qa-2', [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: '全部', steps: ['s'], expected: 'e' }])
    await done($, 'a-qa-2')
    expect(w.prompts.at(-1)).toMatch(/^\[crew\] PM＋QA 完成/)
  })

  test('passes a role’s reply to the brain that asked', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    await done($, 'a-pm-1')
    const r = await crew($, { action: 'ask', role: 'pm', text: '為什麼拆成兩個功能？' })
    expect(String(r.result)).toMatch(/ASK-01/)
    await done($, 'a-pm-1', '因為是兩件使用者感受得到的事')
    expect(w.prompts.at(-1)).toMatch(/^\[crew\] PM 回覆了 ASK-01：因為是兩件使用者感受得到的事/)
  })

  test('keeps work the person started with /crew to toasts, without waking the brain', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await askPerson($, 'a-pm-1', '年繳要不要做？')
    await $.command.run(command('ask pm 嗨'))
    await done($, 'a-pm-1', '嗨')
    expect(w.prompts).toEqual([])
    expect(w.toasts.some(t => /Q-01/.test(t))).toBe(true)
  })

  test('is for the main conversation only', async ($, on) => {
    world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    expect(String((await crew($, { action: 'status' }, 'a-pm-1')).result)).toMatch(/只給主對話/)
  })

  test('says what an action needs', async ($, on) => {
    world($, on)
    await start($)
    expect(String((await crew($, { action: 'ask', role: 'pm' })).result)).toMatch(/用法/)
    expect(String((await crew($, { action: 'dance' })).result)).toMatch(/action/)
  })
})

const ctx = (by: string) => ({ by, today: '2026-10-15', prefixes: { feature: 'PRD-', testCase: 'TC-' } })

const boardWith = (ops: readonly Op[], tests: readonly Op[]) => {
  const a = applyOps(newTracker('repo'), ops, ctx('pm'))
  if (!a.ok) throw new Error(a.errors.join('; '))
  const b = applyOps(a.tracker, tests, ctx('qa'))
  if (!b.ok) throw new Error(b.errors.join('; '))
  return b.tracker
}

describe('crew across restarts', () => {
  test('keeps the PRD, the flow and open questions in .crew/state.json', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await askPerson($, 'a-pm-1', '年繳要不要做？')
    const state = JSON.parse(w.disk.get(STATE) ?? '{}') as { prdPath?: string; flow?: { stage: string }; questions?: { id: string; status: string }[]; lead?: string }
    expect(state).toMatchObject({ prdPath: 'docs/PRD.md', flow: { stage: 'splitting' }, questions: [{ id: 'Q-01', status: 'open' }], lead: 'person' })
  })

  test('picks up an unfinished PRD when Claude Code starts again', async ($, on) => {
    const w = world($, on)
    const tracker = boardWith(SPLIT as unknown as Op[], [{ op: 'add_test_case', criteria: ['AC-001'], title: 't', steps: ['s'], expected: 'e' }])
    w.disk.set(`${ROOT}/prd-tracker.json`, JSON.stringify(tracker))
    w.disk.set(
      STATE,
      JSON.stringify({
        prdPath: 'docs/PRD.md',
        flow: { stage: 'writing_tests', round: 0, retries: 0 },
        questions: [{ id: 'Q-01', question: '年繳要不要做？', from: 'pm', status: 'open', t: 1 }],
        lead: 'person',
      }),
    )
    await start($)
    expect(w.spawned).toHaveLength(1)
    expect(w.spawned[0]?.subagentType).toBe('crew:qa')
    expect(w.spawned[0]?.prompt).toMatch(/## 這次的工作\n[\s\S]*AC-002/)
    expect(w.toasts.some(t => /接續 docs\/PRD\.md/.test(t))).toBe(true)
    expect(w.toasts.some(t => /1 件事等你決定/.test(t))).toBe(true)
    expect((await $.command.run(command('status'))).text).toMatch(/待你決定 1/)
  })

  test('starts nothing when no PRD was under way', async ($, on) => {
    const w = world($, on)
    w.disk.set(STATE, JSON.stringify({ prdPath: 'docs/PRD.md', flow: { stage: 'done', round: 0, retries: 0 }, questions: [], lead: 'person' }))
    await start($)
    expect(w.spawned).toEqual([])
  })
})
