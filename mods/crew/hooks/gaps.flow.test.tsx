import type { PromptOrigin } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { applyOps, newTracker } from './board'
import type { Op } from './board'
import { parseMemories } from './memory'
import { command, done, paneText, ROOT, SPLIT, start, world, write } from './world'

/** What the test review found untested: failures, restarts, context, filters, and the edges of each rule. */

const MEMORIES = `${ROOT}/.crew/memory/memories.jsonl`
const STATE_KEY = `state:${ROOT}`
const LOG = `${ROOT}/.crew/log/2026-10-15.jsonl`
const USAGE = `${ROOT}/.crew/usage/2026-10-15.json`

const call = ($: Engine, tool: string, input: Record<string, unknown>, agentId?: string) =>
  $.tool.call({ tool: `mcp__crew__${tool}`, tool_use_id: `g-${Math.random()}`, ...(agentId === undefined ? {} : { agentId }), ...input } as never) as Promise<{ result: unknown }>

const notice = async ($: Engine, agentId: string) =>
  (await $.prompt.submit({ text: `<task-notification><task-id>${agentId}</task-id></task-notification>`, wait: false, origin: { kind: 'task-notification' } } as never)) as {
    text?: string
    drop?: string
  }

/** One request of an agent's turn, its usage as the API reports it. */
const step = async ($: Engine, agentId: string | undefined, usage: Record<string, number>, steps: { usage: Record<string, number> }) => {
  steps.usage = usage
  const stream = $.turn.step({ turnId: `s-${Math.random()}`, index: 0, model: 'claude-sonnet-5-5', effort: 'low', messageCount: 3, ...(agentId === undefined ? {} : { agentId }) } as never)
  for await (const _ of stream as AsyncIterable<unknown>) {
    // drained
  }
}

/** A turn.step bottom that records the effort each request ran at and answers with the usage given. */
const requests = (on: Parameters<typeof world>[1]) => {
  const seen = { efforts: [] as unknown[], usage: {} as Record<string, number> }
  on('turn.step', async function* (_$, e) {
    seen.efforts.push(e.effort)
    yield { kind: 'stop', stopReason: 'end_turn', usage: seen.usage } as never
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] } as never
  })
  return seen
}

const ctx = (by: string) => ({ by, today: '2026-10-15', prefixes: { feature: 'PRD-', testCase: 'TC-' } })

const boardWith = (tests: readonly Op[]) => {
  const a = applyOps(newTracker('repo'), SPLIT as unknown as Op[], ctx('pm'))
  if (!a.ok) throw new Error(a.errors.join('; '))
  const b = applyOps(a.tracker, tests, ctx('qa'))
  if (!b.ok) throw new Error(b.errors.join('; '))
  return b.tracker
}

const restartAt = (w: ReturnType<typeof world>, stage: string, extra: Record<string, unknown> = {}, tests: readonly Op[] = []) => {
  w.disk.set(`${ROOT}/prd-tracker.json`, JSON.stringify(boardWith(tests)))
  w.store.set(STATE_KEY, { prdPath: 'docs/PRD.md', flow: { stage, round: 1, retries: 0, ...extra }, questions: [], lead: 'person' })
}

describe('a broken file left behind', () => {
  test('does not keep crew from starting', async ($, on) => {
    const w = world($, on)
    w.disk.set(USAGE, '{"usage": {"pm": ')
    w.disk.set(`${ROOT}/.crew/threads/AC-001.jsonl`, 'not json\n{"t":1,"n":1,"item":"AC-001","from":"qa","to":"pm","text":"ok"}\n')
    w.store.set(STATE_KEY, { prdPath: 'docs/PRD.md', flow: { stage: 'nonsense' }, questions: [null, 3, { id: 'Q-01', question: '留下', status: 'open', from: 'pm', t: 1 }], lead: 'x' })
    await start($)
    expect(w.registered.tools).toHaveLength(8)
    expect(w.registered.agents).toEqual(['pm', 'qa'])
    expect((await $.command.run(command('status'))).text).toMatch(/crew（idle）[\s\S]*待你決定 1/)
    expect((await $.command.run(command('thread AC-001'))).text).toBe('QA → PM：ok')
  })

  test('a board that does not parse is logged and read as no board', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    w.disk.set(`${ROOT}/prd-tracker.json`, '{ broken')
    await done($, 'a-pm-1')
    expect(w.logs.some(l => /prd-tracker\.json does not parse/.test(l))).toBe(true)
  })
})

describe('the log', () => {
  test('masks a private key in a long report, even past the length a line keeps', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    const body = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC'.repeat(45)
    await done($, 'a-pm-1', `金鑰是 -----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY----- 請保管`)
    expect(w.disk.get(LOG)).toMatch(/kind":"report/)
    expect(w.disk.get(LOG)).not.toMatch(/MIIEvQIBADANBgkqhkiG9w0BAQEFAASC/)
  })
})

describe('context, measured each request', () => {
  test('runs a role at its routed effort and starts it fresh past half its limit', async ($, on) => {
    const seen = requests(on)
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    await step($, 'a-pm-1', { input_tokens: 1_000, output_tokens: 500, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 0 }, seen)
    expect(seen.efforts[0]).toBe('high')
    await done($, 'a-pm-1')
    await write($, 'a-qa-2', [{ op: 'add_test_case', criteria: ['AC-001'], title: 't', steps: ['s'], expected: 'e' }])
    await done($, 'a-qa-2')
    expect(w.spawned.at(-1)?.subagentType).toBe('crew:pm')
    expect(w.spawned.at(-1)?.prompt).toMatch(/context 51K 超過上限的一半/)
  })

  test('counts the brain’s own requests as the brain’s, and an unknown agent’s as nobody’s', async ($, on) => {
    const seen = requests(on)
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await step($, undefined, { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, seen)
    await step($, 'a-stranger', { input_tokens: 900, output_tokens: 90, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, seen)
    await done($, 'a-pm-1')
    const usage = JSON.parse(w.disk.get(USAGE) ?? '{}') as { usage: Record<string, { input: number }> }
    expect(usage.usage.brain?.input).toBe(100)
    expect(Object.keys(usage.usage).sort()).toEqual(['brain', 'pm'])
  })

  test('takes no reading from an agent crew has replaced', async ($, on) => {
    const seen = requests(on)
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    await done($, 'a-pm-1')
    await $.command.run(command('rotate pm'))
    await $.command.run(command('ask pm 第一題'))
    const fresh = w.spawned.length
    // The old PM's late request would say the context is huge; the new PM's context stays its own.
    await step($, 'a-pm-1', { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 0 }, seen)
    await done($, `a-pm-${fresh}`, '答')
    await $.command.run(command('ask pm 第二題'))
    expect(w.spawned).toHaveLength(fresh)
    expect(w.sent.at(-1)?.to).toBe(`a-pm-${fresh}`)
  })
})

describe('rotation', () => {
  test('happens once per request, and is counted', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    await done($, 'a-pm-1')
    await $.command.run(command('rotate pm'))
    await $.command.run(command('ask pm 一'))
    const pm = w.spawned.length
    await done($, `a-pm-${pm}`, '一')
    await $.command.run(command('ask pm 二'))
    expect(w.spawned).toHaveLength(pm)
    expect(w.sent.at(-1)?.to).toBe(`a-pm-${pm}`)
    const usage = JSON.parse(w.disk.get(USAGE) ?? '{}') as { usage: Record<string, { rotations: number; wakes: number }> }
    expect(usage.usage.pm?.rotations).toBe(1)
    expect(w.disk.get(LOG)).toMatch(/"kind":"rotate","role":"pm"/)
  })
})

describe('what is not crew’s', () => {
  test('a prompt the person typed passes even when it names a role', async ($, on) => {
    world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    for (const text of ['請 @crew-pm 看一下', '剛剛 a-pm-1 說了什麼？']) {
      const r = (await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } as PromptOrigin })) as { drop?: string }
      expect(r.drop).toBeUndefined()
    }
  })

  test('another agent’s notice is left alone; a coordinator or peer message about a role is crew’s', async ($, on) => {
    world($, on)
    on('session.receive', (_$, e) => ({ text: e.text }))
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    const other = await $.session.receive({ text: '<task-notification><task-id>a-other-1</task-id></task-notification>', origin: { kind: 'task-notification' } } as never)
    expect((other as { consumed?: string }).consumed).toBeUndefined()
    const partial = await $.session.receive({ text: 'xa-pm-1y', origin: { kind: 'task-notification' } } as never)
    expect((partial as { consumed?: string }).consumed).toBeUndefined()
    for (const kind of ['coordinator', 'peer-send-message']) {
      const r = (await $.prompt.submit({ text: 'from @crew-qa: done', wait: false, origin: { kind } as PromptOrigin })) as { drop?: string }
      expect(r.drop).toBeDefined()
    }
  })
})

describe('work the person started', () => {
  test('never wakes the brain', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await call($, 'ask_person', { question: '年繳要不要做？' }, 'a-pm-1')
    await write($, 'a-pm-1', SPLIT)
    await done($, 'a-pm-1')
    expect((await notice($, 'a-pm-1')).drop).toBeDefined()
    await $.command.run(command('ask pm 為什麼這樣拆？'))
    await done($, 'a-pm-1', '因為')
    expect((await notice($, 'a-pm-1')).drop).toBeDefined()
    await w.clock.advance(61_000)
    expect(w.prompts).toEqual([])
  })

  test('waits a full minute before crew sends a note of its own', async ($, on) => {
    const w = world($, on)
    await start($)
    await call($, 'crew', { action: 'start', path: 'docs/PRD.md' })
    await call($, 'ask_person', { question: '年繳？' }, 'a-pm-1')
    await done($, 'a-pm-1')
    await w.clock.advance(45_000)
    expect(w.prompts).toEqual([])
    await w.clock.advance(16_000)
    expect(w.prompts).toHaveLength(1)
  })
})

describe('the person’s words', () => {
  test('a decision from /crew answer cannot be replaced by a role', async ($, on) => {
    world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await call($, 'ask_person', { question: '年繳要不要做？' }, 'a-pm-1')
    await $.command.run(command('answer Q-01 不做'))
    const r = await call($, 'memory_save', { type: 'DEC', text: '改做年繳', supersedes: 'DEC-001' }, 'a-pm-1')
    expect(String(r.result)).toMatch(/只有使用者能改/)
  })

  test('a decision is never replaced by the daily tidy-up', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await call($, 'memory_save', { type: 'DEC', text: '只做月繳' }, 'a-pm-1')
    w.replies.push('[{"type":"MEM","text":"其實做年繳","supersedes":"DEC-001"}]')
    await $.command.run(command('consolidate'))
    expect(parseMemories(w.disk.get(MEMORIES) ?? '').find(m => m.id === 'DEC-001')?.supersededBy).toBeUndefined()
  })
})

describe('restarting at each stage', () => {
  test('a split: the PM finishes it', async ($, on) => {
    const w = world($, on)
    restartAt(w, 'splitting')
    await start($)
    expect(w.spawned.map(s => s.subagentType)).toEqual(['crew:pm'])
    expect(w.spawned[0]?.prompt).toMatch(/拆到一半/)
  })

  test('confirming gaps: the PM gets them again', async ($, on) => {
    const w = world($, on)
    restartAt(w, 'confirming', {}, [{ op: 'add_test_case', criteria: ['AC-001'], title: 't', steps: ['s'], expected: 'e' }])
    await start($)
    expect(w.spawned.map(s => s.subagentType)).toEqual(['crew:pm'])
    expect(w.spawned[0]?.prompt).toMatch(/AC-002/)
  })

  test('adding tests: QA gets what is still uncovered', async ($, on) => {
    const w = world($, on)
    restartAt(w, 'adding_tests', {}, [{ op: 'add_test_case', criteria: ['AC-002'], title: 't', steps: ['s'], expected: 'e' }])
    await start($)
    expect(w.spawned.map(s => s.subagentType)).toEqual(['crew:qa'])
    expect(w.spawned[0]?.prompt).toMatch(/重開過[\s\S]*AC-001/)
  })

  test('waiting for the person: nothing starts, and the answer goes back where the flow stopped', async ($, on) => {
    const w = world($, on)
    restartAt(w, 'escalated', { resumeAt: 'splitting', retries: 2 })
    w.store.set(STATE_KEY, { ...(w.store.get(STATE_KEY) as object), questions: [{ id: 'Q-01', question: '拆 PRD 卡住了', from: 'crew', status: 'open', t: 1 }] })
    await start($)
    expect(w.spawned).toEqual([])
    await $.command.run(command('answer Q-01 先拆前兩個功能'))
    expect((await $.command.run(command('status'))).text).toMatch(/splitting/)
    expect(w.spawned.map(s => s.subagentType)).toEqual(['crew:pm'])
  })

  test('work the brain led still reports to the brain', async ($, on) => {
    const w = world($, on)
    restartAt(w, 'splitting')
    w.store.set(STATE_KEY, { ...(w.store.get(STATE_KEY) as object), lead: 'brain' })
    await start($)
    await call($, 'ask_person', { question: '年繳？' }, 'a-pm-1')
    await done($, 'a-pm-1')
    expect((await notice($, 'a-pm-1')).text).toMatch(/Q-01/)
  })

  test('tests go on without the PRD; a split cannot, and says why', async ($, on) => {
    const w = world($, on)
    w.disk.delete(`${ROOT}/docs/PRD.md`)
    restartAt(w, 'writing_tests')
    await start($)
    expect(w.spawned.map(s => s.subagentType)).toEqual(['crew:qa'])
  })

  test('a split without its PRD says so', async ($, on) => {
    const w = world($, on)
    w.disk.delete(`${ROOT}/docs/PRD.md`)
    restartAt(w, 'splitting')
    await start($)
    expect(w.spawned).toEqual([])
    expect(w.toasts.some(t => /沒有接續：找不到 docs\/PRD\.md/.test(t))).toBe(true)
  })
})

describe('the daily tidy-up', () => {
  test('runs again the next day for the day before', { timeoutMs: 90_000 }, async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await done($, 'a-pm-1')
    expect(w.completions).toHaveLength(0)
    // A day in two halves: the kit resolves at most 10000 timer waits per advance.
    await w.clock.advance(43_200_000)
    await w.clock.advance(43_200_000)
    await done($, 'a-pm-1')
    expect(w.completions).toHaveLength(1)
    expect(w.completions[0]?.prompt).toMatch(/2026-10-15/)
  })
})

describe('every action of the crew tool', () => {
  test('answers in a sentence', async ($, on) => {
    world($, on)
    await start($)
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ action: 'remember', text: '用新台幣' }, /已記住 PREF-001/],
      [{ action: 'recall', text: '新台幣' }, /PREF-001/],
      [{ action: 'status' }, /crew（idle）/],
      [{ action: 'rotate', role: 'pm' }, /PM 還沒開始/],
      [{ action: 'resume' }, /沒有進行中的 PRD/],
      [{ action: 'start', path: 'docs/PRD.md' }, /PM 正在拆/],
      [{ action: 'ask', role: 'qa', text: '你好' }, /已問 QA（ASK-01）/],
    ]
    for (const [input, expected] of cases) expect(String((await call($, 'crew', input)).result)).toMatch(expected)
  })
})

describe('inputs crew does not take', () => {
  test('says what it needs', async ($, on) => {
    world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await call($, 'ask_person', { question: '年繳？' }, 'a-pm-1')
    expect((await $.command.run(command('answer Q-01'))).text).toMatch(/用法/)
    expect((await $.command.run(command('rotate designer'))).text).toMatch(/用法/)
    expect(String((await call($, 'thread_post', { item: 'AC-001', to: 'designer', text: 'x' }, 'a-pm-1')).result)).toMatch(/需要 item、to/)
  })

  test('an empty reply to the person’s question is said to be empty', async ($, on) => {
    world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    await done($, 'a-pm-1')
    await $.command.run(command('ask pm 在嗎？'))
    await done($, 'a-pm-1', '  ')
    expect((await $.command.run(command('thread ASK-01'))).text).toMatch(/PM → 使用者：（沒有回覆內容）/)
  })
})

describe('the roles', () => {
  test('are hidden from the main model, both of them', async ($, on) => {
    world($, on)
    await start($)
    for (const agent of ['crew:pm', 'crew:qa']) {
      const offer = await $.agent.offer({ agent, description: agent, source: 'plugin', provider: { plugin: 'crew', tier: 'user' } } as never)
      expect((offer as { isOffered: boolean }).isOffered).toBe(false)
    }
  })

  test('that cannot start leave the flow blocked and say why', async ($, on) => {
    const w = world($, on, { denySpawn: '不允許開 agent' })
    await start($)
    const r = await $.command.run(command('start docs/PRD.md'))
    expect(r.text).toMatch(/crew 沒有開始：沒有啟動：不允許開 agent/)
    expect(w.toasts.at(-1)).toMatch(/PM 沒有啟動/)
  })
})

describe('reset', () => {
  test('clears the saved flow too, so a restart does not resume it', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await $.command.run(command('reset'))
    expect(w.store.get(STATE_KEY)).toMatchObject({ prdPath: null, flow: { stage: 'idle' } })
  })

  test('drop_feature does not count a dropped feature’s criteria as done today', async ($, on) => {
    world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    await write($, 'a-pm-1', [{ op: 'drop_feature', id: 'PRD-002', reason: '下一版' }])
    const text = await paneText($)
    // PRD-001 and PRD-002 got criteria; dropping PRD-002 adds nothing done.
    expect(text).toMatch(/今天完成 2 項/)
  })
})
