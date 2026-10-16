import { describe, expect, test } from 'claude-code/testing'

import { applyOps, newTracker } from './board'
import type { Op, Tracker } from './board'
import { INITIAL, step } from './flow'
import { requirementsOf } from './prd'
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

    const answered = run([{ type: 'answered', question: 'AC-002 要怎麼辦？', answer: '價格頁下一版再做，移出範圍', escalation: true }], r.state)
    expect(answered.state).toMatchObject({ stage: 'confirming', round: 0 })
    expect(answered.actions.at(-1)).toMatchObject({ type: 'message', role: 'pm' })
    expect((answered.actions.at(-1) as { text: string }).text).toMatch(/價格頁下一版再做/)
  })

  test('takes an answer about the split back to the PM’s split', () => {
    const empty = newTracker('shop')
    const r = run([START, { type: 'role_done', role: 'pm', board: empty }, { type: 'role_done', role: 'pm', board: empty }])
    expect(r.state.stage).toBe('escalated')
    const answered = run([{ type: 'answered', question: '拆 PRD 卡住', answer: 'PRD 在 docs/PRD-v2.md', escalation: true }], r.state)
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

describe('edges', () => {
  test('names the features still without criteria when the split stays stuck', () => {
    const half = board([...SPLIT, { op: 'add_feature', title: '帳單', summary: '' }])
    const once = run([START, { type: 'role_done', role: 'pm', board: half }])
    const twice = run([{ type: 'role_done', role: 'pm', board: half }], once.state)
    expect(twice.state).toMatchObject({ stage: 'escalated', resumeAt: 'splitting' })
    expect((twice.actions.at(-1) as { question: string }).question).toMatch(/這些功能還是沒有驗收條件：PRD-002/)
  })

  test('a finished flow opens again for a thread message to the other role', () => {
    const covered = board(SPLIT, [tc(['AC-001', 'AC-002'])])
    const done: FlowState = { stage: 'done', round: 1, retries: 0 }
    const toQa = step(done, { type: 'role_done', role: 'pm', board: covered, inbox: { qa: ['AC-001'] } })
    expect(toQa.state.stage).toBe('adding_tests')
    expect(toQa.actions[0]).toMatchObject({ type: 'message', role: 'qa', item: 'AC-001' })
    const toPm = step(done, { type: 'role_done', role: 'qa', board: covered, inbox: { pm: ['AC-002'] } })
    expect(toPm.state.stage).toBe('confirming')
    expect(toPm.actions[0]).toMatchObject({ type: 'message', role: 'pm', item: 'AC-002' })
  })

  test('takes an answer back to the gaps when the flow did not say where it stopped', () => {
    const r = step({ stage: 'escalated', round: 3, retries: 0 }, { type: 'answered', question: 'q', answer: 'a', escalation: true })
    expect(r.state).toEqual({ stage: 'confirming', round: 0, retries: 0 })
  })

  test('finishes when the PM drops the feature that held the gaps', () => {
    const dropped = board([...SPLIT, { op: 'drop_feature', id: 'PRD-001', reason: '下一版' }])
    expect(step({ stage: 'confirming', round: 1, retries: 0 }, { type: 'role_done', role: 'pm', board: dropped }).state.stage).toBe('done')
  })

  test('a restart in confirming with no gaps left finishes', () => {
    const r = step({ stage: 'confirming', round: 1, retries: 0 }, { type: 'resume', board: board(SPLIT, [tc(['AC-001', 'AC-002'])]), prd: { path: 'p', size: 1 } })
    expect(r.state.stage).toBe('done')
  })
})

describe('answers while the flow waits for the person', () => {
  const waiting: FlowState = { stage: 'escalated', round: 3, retries: 0, resumeAt: 'confirming' }

  test('a role’s own question answered meanwhile goes to that role, and the flow keeps waiting', () => {
    const r = step(waiting, { type: 'answered', question: 'AC-002 怎麼測？', answer: '看 UTC', role: 'qa' })
    expect(r.state).toEqual(waiting)
    expect(r.actions[0]).toMatchObject({ type: 'message', role: 'qa', person: true })
  })

  test('the answer to the flow’s own question takes the flow on, with the PM', () => {
    const r = step(waiting, { type: 'answered', question: '要移出範圍嗎？', answer: '要做', role: 'pm', escalation: true })
    expect(r.state.stage).toBe('confirming')
    expect(r.actions[0]).toMatchObject({ type: 'message', role: 'pm' })
    expect((r.actions[0] as { person?: true }).person).toBeUndefined()
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

describe('the PRD as the flow holds the board to it', () => {
  const reqs = requirementsOf('## 方案\n- 可以選月繳方案\n- 可以看到價格')
  const [r1, r2] = reqs.map(r => r.id)
  const START_WITH: FlowEvent = { type: 'start', prd: { path: 'docs/PRD.md', size: 600, text: '會員訂閱' }, requirements: reqs }
  const tied: readonly Op[] = [
    { op: 'add_feature', title: '方案選擇', summary: '', sources: [r1 ?? '', r2 ?? ''] },
    { op: 'add_criterion', feature: 'PRD-001', text: '可以選月繳方案' },
    { op: 'add_criterion', feature: 'PRD-001', text: '可以看到價格' },
  ]

  test('gives the PM the PRD’s requirements with their ids to split', () => {
    const { actions } = run([START_WITH])
    expect((actions[0] as { prompt: string }).prompt).toMatch(new RegExp(`sources[\\s\\S]*${r1}（方案）可以選月繳方案`))
  })

  test('sends the PM back to requirements no feature covers before QA starts', () => {
    const half: readonly Op[] = [{ op: 'add_feature', title: '方案選擇', summary: '', sources: [r1 ?? ''] }, { op: 'add_criterion', feature: 'PRD-001', text: '可以選月繳方案' }]
    const { state, actions } = run([START_WITH, { type: 'role_done', role: 'pm', board: board(half), requirements: reqs }])
    expect(state.stage).toBe('splitting')
    expect(actions.at(-1)).toMatchObject({ type: 'message', role: 'pm', item: r2 })
    expect((actions.at(-1) as { text: string }).text).toMatch(/PRD 需求沒有對應的功能：可以看到價格/)
  })

  test('hands over to QA once the board answers the whole PRD', () => {
    const { state } = run([START_WITH, { type: 'role_done', role: 'pm', board: board(tied), requirements: reqs }])
    expect(state.stage).toBe('writing_tests')
  })

  test('takes a finished board back to the PM when the PRD changes, then sends QA only what is new', () => {
    const covered = board(tied, [tc(['AC-001', 'AC-002'])])
    const now = requirementsOf('## 方案\n- 可以選月繳方案\n- 可以看到價格\n- 可以改方案')
    const added = now.filter(r => !reqs.some(x => x.id === r.id))
    const done: FlowState = { stage: 'done', round: 1, retries: 0 }
    const changed = step(done, { type: 'prd_changed', board: covered, requirements: now, added, removed: [], key: 'k' })
    expect(changed.state.stage).toBe('splitting')
    expect((changed.actions[0] as { text: string }).text).toMatch(/PRD 改了[\s\S]*新增[\s\S]*可以改方案/)
    const synced = board([...tied, { op: 'add_criterion', feature: 'PRD-001', text: '可以改方案' }, { op: 'link_requirements', feature: 'PRD-001', requirements: added.map(r => r.id) }], [tc(['AC-001', 'AC-002'])])
    const after = step(changed.state, { type: 'role_done', role: 'pm', board: synced, requirements: now })
    // QA, who tested the board before, gets the new criterion only.
    expect(after.state.stage).toBe('adding_tests')
    expect(after.actions[0]).toMatchObject({ type: 'message', role: 'qa', item: 'AC-003' })
  })

  test('takes a running flow back to the split when the PRD changes, with fresh rounds', () => {
    const changed = step(
      { stage: 'writing_tests', round: 2, retries: 1, aligning: 1 },
      { type: 'prd_changed', board: board(tied), requirements: reqs, added: [], removed: [{ id: 'R-000000', text: '舊需求', section: '' }], key: 'k' },
    )
    expect(changed.state).toEqual({ stage: 'splitting', round: 0, retries: 0, aligning: 0, synced: 'k' })
    expect(changed.actions[0]).toMatchObject({ type: 'message', role: 'pm' })
    expect((changed.actions[0] as { text: string }).text).toMatch(/移除[\s\S]*舊需求/)
    // QA finishing meanwhile does not move the flow: the PM's sync comes first.
    expect(step(changed.state, { type: 'role_done', role: 'qa', board: board(tied), requirements: reqs }).actions).toEqual([])
  })

  test('keeps a flow that waits for the person waiting, and tells the PM', () => {
    const changed = step({ stage: 'escalated', round: 3, retries: 0, resumeAt: 'confirming' }, { type: 'prd_changed', board: board(tied), requirements: reqs, added: reqs, removed: [], key: 'k' })
    expect(changed.state.stage).toBe('escalated')
    expect(changed.actions[0]).toMatchObject({ type: 'message', role: 'pm' })
  })

  test('gives the PM a fresh retry for the PRD after a split that passed on its second try', () => {
    const half: readonly Op[] = [{ op: 'add_feature', title: '方案選擇', summary: '', sources: [r1 ?? ''] }, { op: 'add_criterion', feature: 'PRD-001', text: '可以選月繳方案' }]
    let s: FlowState = { stage: 'splitting', round: 0, retries: 0 }
    s = step(s, { type: 'role_done', role: 'pm', board: board(half), requirements: reqs }).state
    s = step(s, { type: 'role_done', role: 'pm', board: board(tied), requirements: reqs }).state
    expect(s.stage).toBe('writing_tests')
    const now = requirementsOf('## 方案\n- 可以選月繳方案\n- 可以看到價格\n- 可以改方案')
    const after = step(s, { type: 'role_done', role: 'qa', board: board(tied, [tc(['AC-001', 'AC-002'])]), requirements: now })
    expect(after.state.stage).toBe('splitting')
    expect(after.actions[0]).toMatchObject({ type: 'message', role: 'pm' })
  })

  test('gives the PM a retry again after the person answered the flow’s question about the PRD', () => {
    const half = board([{ op: 'add_feature', title: '方案選擇', summary: '', sources: [r1 ?? ''] }, { op: 'add_criterion', feature: 'PRD-001', text: '可以選月繳方案' }])
    let s: FlowState = { stage: 'splitting', round: 0, retries: 0 }
    s = step(s, { type: 'role_done', role: 'pm', board: half, requirements: reqs }).state
    s = step(s, { type: 'role_done', role: 'pm', board: half, requirements: reqs }).state
    expect(s.stage).toBe('escalated')
    s = step(s, { type: 'answered', question: 'q', answer: '先做月繳', escalation: true }).state
    expect(s.stage).toBe('splitting')
    expect(step(s, { type: 'role_done', role: 'pm', board: half, requirements: reqs }).state.stage).toBe('splitting')
  })

  test('sends the PM back when its turn after the flow finished leaves the board short of the PRD', () => {
    const short: readonly Op[] = [
      { op: 'add_feature', title: '方案選擇', summary: '', sources: [r1 ?? ''] },
      { op: 'add_criterion', feature: 'PRD-001', text: '可以選月繳方案' },
      { op: 'add_criterion', feature: 'PRD-001', text: '可以看到價格' },
    ]
    const r = step({ stage: 'done', round: 1, retries: 0 }, { type: 'role_done', role: 'pm', board: board(short, [tc(['AC-001', 'AC-002'])]), requirements: reqs })
    expect(r.state.stage).toBe('splitting')
    expect((r.actions[0] as { text: string }).text).toMatch(/看板還對不上 PRD/)
  })

  test('holds every other way to done to the PRD too', () => {
    const now = requirementsOf('## 方案\n- 可以選月繳方案\n- 可以看到價格\n- 可以改方案')
    const covered = board(tied, [tc(['AC-001', 'AC-002'])])
    const prd = { path: 'docs/PRD.md', size: 600 }
    // A finished board QA reopens with a question for the PM, past the last round.
    expect(step({ stage: 'done', round: 3, retries: 0 }, { type: 'role_done', role: 'qa', board: covered, inbox: { pm: ['AC-001'] }, requirements: now }).state.stage).toBe('splitting')
    // A restart in a test stage with nothing left to test.
    expect(step({ stage: 'writing_tests', round: 0, retries: 0 }, { type: 'resume', board: covered, prd, requirements: now }).state.stage).toBe('splitting')
    expect(step({ stage: 'confirming', round: 1, retries: 0 }, { type: 'resume', board: covered, prd, requirements: now }).state.stage).toBe('splitting')
  })

  test('does nothing for a PRD change before any PRD was started', () => {
    expect(step(INITIAL, { type: 'prd_changed', board: board(tied), requirements: reqs, added: [], removed: [], key: 'k' }).actions).toEqual([])
  })

  test('tells the PM once per change, not once per look or save', () => {
    const removed = [{ id: 'R-000000', text: '舊需求', section: '' }]
    const at: FlowState = { stage: 'writing_tests', round: 0, retries: 0 }
    const first = step(at, { type: 'prd_changed', board: board(tied), requirements: reqs, added: [], removed, key: 'a' })
    expect(first.actions).toHaveLength(1)
    expect(step(first.state, { type: 'prd_changed', board: board(tied), requirements: reqs, added: [], removed, key: 'a' }).actions).toEqual([])
    expect(step(first.state, { type: 'prd_changed', board: board(tied), requirements: reqs, added: reqs.slice(0, 1), removed, key: 'b' }).actions).toHaveLength(1)
  })

  test('does not finish while the board does not answer the PRD: the PM is sent back first', () => {
    const now = requirementsOf('## 方案\n- 可以選月繳方案\n- 可以看到價格\n- 可以改方案')
    const covered = board(tied, [tc(['AC-001', 'AC-002'])])
    // The PRD gained a requirement while QA was writing tests, and the PM's sync turn left the board as it was.
    const after = step({ stage: 'writing_tests', round: 0, retries: 0 }, { type: 'role_done', role: 'qa', board: covered, requirements: now })
    expect(after.state.stage).toBe('splitting')
    expect(after.actions[0]).toMatchObject({ type: 'message', role: 'pm' })
    expect((after.actions[0] as { text: string }).text).toMatch(/看板還對不上 PRD[\s\S]*可以改方案/)
    const confirmed = step({ stage: 'confirming', round: 1, retries: 0 }, { type: 'role_done', role: 'pm', board: covered, requirements: now })
    expect(confirmed.state.stage).toBe('splitting')
  })

  test('gives the PRD its own retry after the PM fixed the criteria', () => {
    const noCriteria: readonly Op[] = [{ op: 'add_feature', title: '方案選擇', summary: '', sources: [r1 ?? ''] }]
    const half: readonly Op[] = [...noCriteria, { op: 'add_criterion', feature: 'PRD-001', text: '可以選月繳方案' }]
    const { state, actions } = run([
      START_WITH,
      { type: 'role_done', role: 'pm', board: board(noCriteria), requirements: reqs },
      { type: 'role_done', role: 'pm', board: board(half), requirements: reqs },
    ])
    expect(state.stage).toBe('splitting')
    expect(actions.at(-1)).toMatchObject({ type: 'message', role: 'pm', item: r2 })
    const again = step(state, { type: 'role_done', role: 'pm', board: board(half), requirements: reqs })
    expect(again.state.stage).toBe('escalated')
    expect(again.actions[0]).toMatchObject({ type: 'ask_person' })
  })

  test('resumes a split with the PRD’s requirements', () => {
    const r = step({ stage: 'splitting', round: 0, retries: 0 }, { type: 'resume', board: newTracker('shop'), prd: { path: 'docs/PRD.md', size: 600 }, requirements: reqs })
    expect((r.actions[0] as { prompt: string }).prompt).toMatch(new RegExp(`${r1}[\\s\\S]*重開過`))
  })

  test('asks the PM to number a board made before crew numbered requirements', () => {
    const old = board([{ op: 'add_feature', title: '方案選擇', summary: '' }, { op: 'add_criterion', feature: 'PRD-001', text: '可以選月繳方案' }])
    const r = step({ stage: 'done', round: 0, retries: 0 }, { type: 'prd_changed', board: old, requirements: reqs, added: reqs, removed: [], key: 'k', unlinked: true })
    expect(r.state.stage).toBe('splitting')
    const text = (r.actions[0] as { text: string }).text
    expect(text).not.toMatch(/PRD 改了/)
    expect(text).toMatch(/還沒有對應到 PRD 需求編號[\s\S]*link_requirements[\s\S]*可以看到價格/)
  })

  test('asks QA for tests of a board started again without saying the PRD changed', () => {
    const covered = board(tied, [tc(['AC-001'])])
    const r = run([START_WITH, { type: 'role_done', role: 'pm', board: covered, requirements: reqs }])
    expect(r.state.stage).toBe('adding_tests')
    expect((r.actions.at(-1) as { text: string }).text).not.toMatch(/PRD 更新/)
  })
})
