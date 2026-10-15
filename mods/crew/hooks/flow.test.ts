import { describe, expect, test } from 'claude-code/testing'

import { applyOps, newTracker } from './board'
import type { Op, Tracker } from './board'
import { INITIAL, step } from './flow'
import type { FlowEvent, FlowState } from './flow'

const ctx = (by: string) => ({ by, today: '2026-10-15', prefixes: { feature: 'PRD-', testCase: 'TC-' } })

const board = (pm: readonly Op[], qa: readonly Op[] = []): Tracker => {
  const a = applyOps(newTracker('shop'), pm, ctx('pm'))
  if (!a.ok) throw new Error(a.errors.join('; '))
  if (qa.length === 0) return a.tracker
  const b = applyOps(a.tracker, qa, ctx('qa'))
  if (!b.ok) throw new Error(b.errors.join('; '))
  return b.tracker
}

const SPLIT: readonly Op[] = [
  { op: 'add_feature', title: '方案選擇', summary: '' },
  { op: 'add_criterion', feature: 'PRD-001', text: '可以選月繳方案' },
  { op: 'add_criterion', feature: 'PRD-001', text: '可以看到價格' },
]

const tc = (criteria: string[]): Op => ({ op: 'add_test_case', criteria, title: 't', steps: ['s'], expected: 'e' })

const run = (events: readonly FlowEvent[], from: FlowState = INITIAL) => {
  let state = from
  const actions = []
  for (const e of events) {
    const r = step(state, e)
    state = r.state
    actions.push(...r.actions)
  }
  return { state, actions }
}

const START: FlowEvent = { type: 'start', prd: { path: 'docs/PRD.md', size: 600, text: '會員訂閱' } }

describe('step', () => {
  test('starts by asking the PM to split the PRD, routed by its size', () => {
    const { state, actions } = run([START])
    expect(state.stage).toBe('splitting')
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ type: 'spawn', role: 'pm', route: { tier: 'M', label: 'Sonnet', effort: 'high' } })
    expect((actions[0] as { prompt: string }).prompt).toMatch(/docs\/PRD\.md/)
  })

  test('hands over to QA once every feature has criteria', () => {
    const { state, actions } = run([START, { type: 'role_done', role: 'pm', board: board(SPLIT) }])
    expect(state.stage).toBe('writing_tests')
    expect(actions.at(-1)).toMatchObject({ type: 'spawn', role: 'qa', route: { tier: 'S', label: 'Sonnet', effort: 'medium' } })
    expect((actions.at(-1) as { prompt: string }).prompt).toMatch(/2 條驗收條件/)
  })

  test('sends the PM back to the features that have no criteria', () => {
    const b = board([...SPLIT, { op: 'add_feature', title: '帳單', summary: '' }])
    const { state, actions } = run([START, { type: 'role_done', role: 'pm', board: b }])
    expect(state.stage).toBe('splitting')
    expect(actions.at(-1)).toMatchObject({ type: 'message', role: 'pm', item: 'PRD-002' })
    expect((actions.at(-1) as { text: string }).text).toMatch(/PRD-002 帳單/)
  })

  test('asks the person when the PM leaves the board empty twice', () => {
    const empty = newTracker('shop')
    const once = run([START, { type: 'role_done', role: 'pm', board: empty }])
    expect(once.actions.at(-1)).toMatchObject({ type: 'message', role: 'pm' })
    const twice = run([{ type: 'role_done', role: 'pm', board: empty }], once.state)
    expect(twice.state.stage).toBe('escalated')
    expect(twice.actions.at(-1)).toMatchObject({ type: 'ask_person' })
  })

  test('finishes when QA covers every criterion', () => {
    const { state, actions } = run([
      START,
      { type: 'role_done', role: 'pm', board: board(SPLIT) },
      { type: 'role_done', role: 'qa', board: board(SPLIT, [tc(['AC-001', 'AC-002'])]) },
    ])
    expect(state.stage).toBe('done')
    expect(actions.at(-1)).toMatchObject({ type: 'done' })
    expect((actions.at(-1) as { text: string }).text).toMatch(/2\/2/)
  })

  test('sends the gaps to the PM, then the ones the PM keeps to QA', () => {
    const gaps = board(SPLIT, [tc(['AC-001'])])
    const toPm = run([START, { type: 'role_done', role: 'pm', board: board(SPLIT) }, { type: 'role_done', role: 'qa', board: gaps }])
    expect(toPm.state.stage).toBe('confirming')
    expect(toPm.actions.at(-1)).toMatchObject({ type: 'message', role: 'pm', item: 'AC-002' })
    expect((toPm.actions.at(-1) as { text: string }).text).toMatch(/AC-002 可以看到價格/)

    const toQa = run([{ type: 'role_done', role: 'pm', board: gaps }], toPm.state)
    expect(toQa.state.stage).toBe('adding_tests')
    expect(toQa.actions.at(-1)).toMatchObject({ type: 'message', role: 'qa', item: 'AC-002' })

    const done = run([{ type: 'role_done', role: 'qa', board: board(SPLIT, [tc(['AC-001']), tc(['AC-002'])]) }], toQa.state)
    expect(done.state.stage).toBe('done')
  })

  test('finishes when the PM drops every gap', () => {
    const gaps = board(SPLIT, [tc(['AC-001'])])
    const toPm = run([START, { type: 'role_done', role: 'pm', board: board(SPLIT) }, { type: 'role_done', role: 'qa', board: gaps }])
    const dropped = applyOps(gaps, [{ op: 'drop_criterion', id: 'AC-002', reason: '價格頁下一版' }], ctx('pm'))
    expect(dropped.ok).toBe(true)
    if (!dropped.ok) return
    const done = run([{ type: 'role_done', role: 'pm', board: dropped.tracker }], toPm.state)
    expect(done.state.stage).toBe('done')
    expect((done.actions.at(-1) as { text: string }).text).toMatch(/1\/1/)
  })

  test('asks the person after three rounds that leave gaps', () => {
    const gaps = board(SPLIT, [tc(['AC-001'])])
    let r = run([START, { type: 'role_done', role: 'pm', board: board(SPLIT) }])
    for (let round = 0; round < 3; round += 1) {
      r = run([{ type: 'role_done', role: 'qa', board: gaps }, { type: 'role_done', role: 'pm', board: gaps }], r.state)
    }
    r = run([{ type: 'role_done', role: 'qa', board: gaps }], r.state)
    expect(r.state.stage).toBe('escalated')
    expect(r.actions.at(-1)).toMatchObject({ type: 'ask_person' })
    expect((r.actions.at(-1) as { question: string }).question).toMatch(/AC-002/)
  })

  test('takes the person’s answer back to the PM where the flow got stuck', () => {
    const gaps = board(SPLIT, [tc(['AC-001'])])
    let r = run([START, { type: 'role_done', role: 'pm', board: board(SPLIT) }])
    for (let round = 0; round < 3; round += 1) {
      r = run([{ type: 'role_done', role: 'qa', board: gaps }, { type: 'role_done', role: 'pm', board: gaps }], r.state)
    }
    r = run([{ type: 'role_done', role: 'qa', board: gaps }], r.state)
    expect(r.state.stage).toBe('escalated')

    const answered = run([{ type: 'answered', question: 'AC-002 要怎麼辦？', answer: '價格頁下一版再做，移出範圍' }], r.state)
    expect(answered.state).toMatchObject({ stage: 'confirming', round: 0 })
    expect(answered.actions.at(-1)).toMatchObject({ type: 'message', role: 'pm' })
    expect((answered.actions.at(-1) as { text: string }).text).toMatch(/價格頁下一版再做/)
  })

  test('takes an answer about the split back to the PM’s split', () => {
    const empty = newTracker('shop')
    const r = run([START, { type: 'role_done', role: 'pm', board: empty }, { type: 'role_done', role: 'pm', board: empty }])
    expect(r.state.stage).toBe('escalated')
    const answered = run([{ type: 'answered', question: '拆 PRD 卡住', answer: 'PRD 在 docs/PRD-v2.md' }], r.state)
    expect(answered.state).toMatchObject({ stage: 'splitting', retries: 0 })
  })

  test('passes an answer to a question the PM asked while working', () => {
    const r = run([START, { type: 'answered', question: '要不要做年繳？', answer: '不做' }])
    expect(r.state.stage).toBe('splitting')
    expect(r.actions.at(-1)).toMatchObject({ type: 'message', role: 'pm' })
    expect((r.actions.at(-1) as { text: string }).text).toMatch(/要不要做年繳？[\s\S]*不做/)
  })

  test('picks up new criteria the PM adds after the flow finished, and sends them to QA', () => {
    const covered = board(SPLIT, [tc(['AC-001', 'AC-002'])])
    const finished = run([START, { type: 'role_done', role: 'pm', board: board(SPLIT) }, { type: 'role_done', role: 'qa', board: covered }])
    expect(finished.state.stage).toBe('done')

    const more = applyOps(covered, [{ op: 'add_criterion', feature: 'PRD-001', text: '標題前後空白會去掉' }], ctx('pm'))
    expect(more.ok).toBe(true)
    if (!more.ok) return
    const reopened = run([{ type: 'role_done', role: 'pm', board: more.tracker }], finished.state)
    expect(reopened.state.stage).toBe('adding_tests')
    expect(reopened.actions.at(-1)).toMatchObject({ type: 'message', role: 'qa', item: 'AC-003' })

    const unchanged = run([{ type: 'role_done', role: 'pm', board: covered }], finished.state)
    expect(unchanged.state.stage).toBe('done')
    expect(unchanged.actions).toEqual([])
  })

  test('wakes the PM for questions QA left in threads, even when every criterion is covered', () => {
    const covered = board(SPLIT, [tc(['AC-001', 'AC-002'])])
    const r = run([
      START,
      { type: 'role_done', role: 'pm', board: board(SPLIT) },
      { type: 'role_done', role: 'qa', board: covered, inbox: { pm: ['AC-002'] } },
    ])
    expect(r.state.stage).toBe('confirming')
    expect(r.actions.at(-1)).toMatchObject({ type: 'message', role: 'pm', item: 'AC-002' })
    expect((r.actions.at(-1) as { text: string }).text).toMatch(/AC-002[\s\S]*thread_read/)

    const answered = run([{ type: 'role_done', role: 'pm', board: covered, inbox: { qa: ['AC-002'] } }], r.state)
    expect(answered.state.stage).toBe('adding_tests')
    expect(answered.actions.at(-1)).toMatchObject({ type: 'message', role: 'qa', item: 'AC-002' })

    const settled = run([{ type: 'role_done', role: 'qa', board: covered }], answered.state)
    expect(settled.state.stage).toBe('done')
  })

  test('stops passing thread messages back and forth after three rounds', () => {
    const covered = board(SPLIT, [tc(['AC-001', 'AC-002'])])
    let r = run([START, { type: 'role_done', role: 'pm', board: board(SPLIT) }])
    for (let round = 0; round < 3; round += 1) {
      r = run([
        { type: 'role_done', role: 'qa', board: covered, inbox: { pm: ['AC-002'] } },
        { type: 'role_done', role: 'pm', board: covered, inbox: { qa: ['AC-002'] } },
      ], r.state)
    }
    r = run([{ type: 'role_done', role: 'qa', board: covered, inbox: { pm: ['AC-002'] } }], r.state)
    expect(r.state.stage).toBe('done')
  })

  test('ignores a role that finishes out of turn', () => {
    const r = run([START, { type: 'role_done', role: 'qa', board: board(SPLIT) }])
    expect(r.state.stage).toBe('splitting')
    expect(r.actions).toHaveLength(1)
  })

  test('restarts from a finished flow on a new start', () => {
    const r = run([START], { ...INITIAL, stage: 'done' })
    expect(r.state.stage).toBe('splitting')
  })

  test('does not restart a flow that is running', () => {
    const r = run([START], { ...INITIAL, stage: 'writing_tests' })
    expect(r.state.stage).toBe('writing_tests')
    expect(r.actions).toHaveLength(1)
    expect(r.actions[0]).toMatchObject({ type: 'status' })
    expect((r.actions[0] as { text: string }).text).toMatch(/正在進行/)
  })
})

describe('resume', () => {
  const at = (stage: FlowState['stage']): FlowState => ({ stage, round: 1, retries: 0 })
  const resume = (state: FlowState, b: Tracker) => step(state, { type: 'resume', board: b, prd: { path: 'docs/PRD.md', size: 600 } })

  test('starts the PM again on a split left half done, keeping what is on the board', () => {
    const r = resume(at('splitting'), newTracker('shop'))
    expect(r.state.stage).toBe('splitting')
    expect(r.actions[0]).toMatchObject({ type: 'spawn', role: 'pm', route: { tier: 'M' } })
    expect((r.actions[0] as { prompt: string }).prompt).toMatch(/docs\/PRD\.md[\s\S]*已經在看板上的不要重複/)
  })

  test('has the PM finish a split even when every feature on the board has criteria: the PRD may hold more', () => {
    const r = resume(at('splitting'), board(SPLIT))
    expect(r.state.stage).toBe('splitting')
    expect(r.actions[0]).toMatchObject({ type: 'spawn', role: 'pm' })
  })

  test('sends QA the criteria it had not covered yet', () => {
    const r = resume(at('writing_tests'), board(SPLIT, [tc(['AC-001'])]))
    expect(r.state.stage).toBe('writing_tests')
    expect(r.actions[0]).toMatchObject({ type: 'message', role: 'qa', item: 'AC-002' })
    expect((r.actions[0] as { text: string }).text).toMatch(/重開過[\s\S]*AC-002 可以看到價格/)
    expect((r.actions[0] as { text: string }).text).not.toMatch(/AC-001|PM 確認/)
  })

  test('finishes a test round QA had completed', () => {
    const r = resume(at('adding_tests'), board(SPLIT, [tc(['AC-001', 'AC-002'])]))
    expect(r.state.stage).toBe('done')
  })

  test('sends the PM the gaps it was confirming', () => {
    const r = resume(at('confirming'), board(SPLIT, [tc(['AC-001'])]))
    expect(r.state.stage).toBe('confirming')
    expect(r.actions[0]).toMatchObject({ type: 'message', role: 'pm', item: 'AC-002' })
  })

  test('leaves a finished, idle or waiting flow alone', () => {
    for (const stage of ['idle', 'done', 'escalated'] as const) {
      expect(resume(at(stage), board(SPLIT)).actions).toEqual([])
    }
  })
})
