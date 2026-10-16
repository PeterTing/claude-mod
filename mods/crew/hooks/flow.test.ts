import { describe, expect, test } from 'claude-code/testing'

import { applyOps, newTracker } from './board'
import type { Op, Tracker } from './board'
import { INITIAL, step } from './flow'
import { withCommits } from './git'
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

/** A board with the tech lead's tasks on top: one task per feature, covering the criteria given. */
/** A planned board whose every task has a commit doing it. */
const builtOf = (b: Tracker): Tracker => withCommits(b, new Map(b.prd_items.flatMap(i => (Array.isArray(i.tasks) ? i.tasks : []).map((t, n) => [(t as { id: string }).id, [`abcd00${n}`]] as [string, string[]])))) ?? b

const planned = (pm: readonly Op[], qa: readonly Op[], tasks: readonly { feature: string; criteria: string[] }[]): Tracker => {
  const b = board(pm, qa)
  const r = applyOps(b, tasks.map((t, i) => ({ op: 'add_task', feature: t.feature, criteria: t.criteria, title: `任務 ${i + 1}`, detail: '', size: 'S' }) as Op), ctx('techlead'))
  if (!r.ok) throw new Error(r.errors.join('; '))
  return r.tracker
}

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

  test('hands the tested board to the tech lead to break into tasks', () => {
    const { state, actions } = run([
      START,
      { type: 'role_done', role: 'pm', board: board(SPLIT) },
      { type: 'role_done', role: 'qa', board: board(SPLIT, [tc(['AC-001', 'AC-002'])]) },
    ])
    expect(state.stage).toBe('planning')
    expect(actions.at(-1)).toMatchObject({ type: 'spawn', role: 'techlead', route: { label: 'Opus', effort: 'high' } })
    expect((actions.at(-1) as { prompt: string }).prompt).toMatch(/2 條驗收條件[\s\S]*add_task/)
  })

  test('builds once every criterion has a test case and a task, and finishes once every task has a commit', () => {
    const plannedBoard = planned(SPLIT, [tc(['AC-001', 'AC-002'])], [{ feature: 'PRD-001', criteria: ['AC-001', 'AC-002'] }])
    expect(run([{ type: 'role_done', role: 'techlead', board: plannedBoard }], { stage: 'planning', round: 0, retries: 0 }).state.stage).toBe('building')
    const { state, actions } = run([{ type: 'role_done', role: 'techlead', board: builtOf(plannedBoard) }], { stage: 'planning', round: 0, retries: 0 })
    expect(state.stage).toBe('done')
    expect(actions.at(-1)).toMatchObject({ type: 'done' })
    expect((actions.at(-1) as { text: string }).text).toMatch(/G4 2\/2[\s\S]*G3 2\/2[\s\S]*實作 1\/1/)
  })

  test('sends the tech lead back to criteria without tasks, then asks the person, whose answer goes to the tech lead', () => {
    const half = planned(SPLIT, [tc(['AC-001', 'AC-002'])], [{ feature: 'PRD-001', criteria: ['AC-001'] }])
    const first = step({ stage: 'planning', round: 0, retries: 0 }, { type: 'role_done', role: 'techlead', board: half })
    expect(first.state.stage).toBe('planning')
    expect(first.actions[0]).toMatchObject({ type: 'message', role: 'techlead', item: 'AC-002' })
    expect((first.actions[0] as { text: string }).text).toMatch(/還沒有任務[\s\S]*AC-002/)
    const second = step(first.state, { type: 'role_done', role: 'techlead', board: half })
    expect(second.state).toMatchObject({ stage: 'escalated', resumeAt: 'planning' })
    expect(second.actions[0]).toMatchObject({ type: 'ask_person' })
    const answered = step(second.state, { type: 'answered', question: 'q', answer: 'AC-002 合併到 TASK-001', escalation: true })
    expect(answered.state).toMatchObject({ stage: 'planning', retries: 0 })
    expect(answered.actions[0]).toMatchObject({ type: 'message', role: 'techlead' })
  })

  test('passes the tech lead’s questions to the PM and the PM’s answers back, a bounded number of times', () => {
    const half = planned(SPLIT, [tc(['AC-001', 'AC-002'])], [{ feature: 'PRD-001', criteria: ['AC-001'] }])
    const asked = step({ stage: 'planning', round: 0, retries: 0 }, { type: 'role_done', role: 'techlead', board: half, inbox: { pm: ['AC-002'] } })
    expect(asked.state).toMatchObject({ stage: 'planning', round: 1 })
    expect(asked.actions[0]).toMatchObject({ type: 'message', role: 'pm', item: 'AC-002' })
    expect((asked.actions[0] as { text: string }).text).toMatch(/Tech lead 在這些項目的討論串留言給你：AC-002/)
    const back = step(asked.state, { type: 'role_done', role: 'pm', board: half, inbox: { techlead: ['AC-002'] } })
    expect(back.actions[0]).toMatchObject({ type: 'message', role: 'techlead', item: 'AC-002' })
    expect((back.actions[0] as { text: string }).text).toMatch(/PM 在這些項目的討論串留言給你/)
    // The PM ending without a word for the tech lead still hands the plan back to it.
    expect(step(asked.state, { type: 'role_done', role: 'pm', board: half }).actions[0]).toMatchObject({ type: 'message', role: 'techlead' })
    // After three rounds the gaps go to the person.
    expect(step({ stage: 'planning', round: 3, retries: 1 }, { type: 'role_done', role: 'techlead', board: half, inbox: { pm: ['AC-002'] } }).state.stage).toBe('escalated')
  })

  test('still starts a role that is free while another is busy', () => {
    const out = step({ stage: 'splitting', round: 0, retries: 0 }, { type: 'role_done', role: 'pm', board: board(SPLIT), working: ['techlead'] })
    expect(out.actions.map(a => [a.type, 'role' in a ? a.role : ''])).toEqual([['spawn', 'qa']])
  })

  test('starts planning with fresh rounds, so the tech lead’s questions reach the PM after a long test phase', () => {
    const covered = board(SPLIT, [tc(['AC-001', 'AC-002'])])
    const planning = step({ stage: 'confirming', round: 3, retries: 0 }, { type: 'role_done', role: 'pm', board: covered })
    expect(planning.state).toMatchObject({ stage: 'planning', round: 0 })
    const half = planned(SPLIT, [tc(['AC-001', 'AC-002'])], [{ feature: 'PRD-001', criteria: ['AC-001'] }])
    expect(step(planning.state, { type: 'role_done', role: 'techlead', board: half, inbox: { pm: ['AC-002'] } }).actions[0]).toMatchObject({ type: 'message', role: 'pm' })
  })

  test('sends new criteria to QA first, then to the tech lead for what is new only', () => {
    const plannedBoard = planned([...SPLIT, { op: 'add_criterion', feature: 'PRD-001', text: '可以改方案' }], [tc(['AC-001', 'AC-002'])], [{ feature: 'PRD-001', criteria: ['AC-001', 'AC-002'] }])
    // The PM added AC-003 while the tech lead planned: QA tests it first.
    const toQa = step({ stage: 'planning', round: 0, retries: 0 }, { type: 'role_done', role: 'techlead', board: plannedBoard })
    expect(toQa.state.stage).toBe('adding_tests')
    expect(toQa.actions[0]).toMatchObject({ type: 'message', role: 'qa', item: 'AC-003' })
    const tested = applyOps(plannedBoard, [tc(['AC-003'])], ctx('qa'))
    if (!tested.ok) throw new Error(tested.errors.join())
    const toTl = step(toQa.state, { type: 'role_done', role: 'qa', board: tested.tracker })
    expect(toTl.state.stage).toBe('planning')
    expect(toTl.actions[0]).toMatchObject({ type: 'message', role: 'techlead', item: 'AC-003' })
    expect((toTl.actions[0] as { text: string }).text).not.toMatch(/AC-001/)
  })

  test('resumes the tech lead’s planning after a restart', () => {
    const half = planned(SPLIT, [tc(['AC-001', 'AC-002'])], [{ feature: 'PRD-001', criteria: ['AC-001'] }])
    const r = step({ stage: 'planning', round: 0, retries: 0 }, { type: 'resume', board: half, prd: { path: 'docs/PRD.md', size: 600 } })
    expect(r.actions[0]).toMatchObject({ type: 'message', role: 'techlead', item: 'AC-002' })
    expect((r.actions[0] as { text: string }).text).toMatch(/重開過/)
    const none = step({ stage: 'planning', round: 0, retries: 0 }, { type: 'resume', board: board(SPLIT, [tc(['AC-001', 'AC-002'])]), prd: { path: 'docs/PRD.md', size: 600 } })
    expect(none.actions[0]).toMatchObject({ type: 'spawn', role: 'techlead' })
  })

  test('opens a finished board again when the tech lead drops a task the plan needs', () => {
    const half = planned(SPLIT, [tc(['AC-001', 'AC-002'])], [{ feature: 'PRD-001', criteria: ['AC-001'] }])
    const r = step({ stage: 'done', round: 0, retries: 0 }, { type: 'role_done', role: 'techlead', board: half })
    expect(r.state.stage).toBe('planning')
    expect(r.actions[0]).toMatchObject({ type: 'message', role: 'techlead', item: 'AC-002' })
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
    expect(done.state.stage).toBe('planning')
  })

  test('moves on to the tech lead when the PM drops every gap', () => {
    const gaps = board(SPLIT, [tc(['AC-001'])])
    const toPm = run([START, { type: 'role_done', role: 'pm', board: board(SPLIT) }, { type: 'role_done', role: 'qa', board: gaps }])
    const dropped = applyOps(gaps, [{ op: 'drop_criterion', id: 'AC-002', reason: '價格頁下一版' }], ctx('pm'))
    expect(dropped.ok).toBe(true)
    if (!dropped.ok) return
    const done = run([{ type: 'role_done', role: 'pm', board: dropped.tracker }], toPm.state)
    expect(done.state.stage).toBe('planning')
    expect(done.actions.at(-1)).toMatchObject({ type: 'spawn', role: 'techlead' })
    expect((done.actions.at(-1) as { prompt: string }).prompt).toMatch(/1 條驗收條件/)
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
    const covered = builtOf(planned(SPLIT, [tc(['AC-001', 'AC-002'])], [{ feature: 'PRD-001', criteria: ['AC-001', 'AC-002'] }]))
    const finished = run([
      START,
      { type: 'role_done', role: 'pm', board: board(SPLIT) },
      { type: 'role_done', role: 'qa', board: board(SPLIT, [tc(['AC-001', 'AC-002'])]) },
      { type: 'role_done', role: 'techlead', board: covered },
    ])
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
    expect(settled.state.stage).toBe('planning')
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
    expect(r.state.stage).toBe('planning')
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
    expect(r.state.stage).toBe('planning')
    expect(step({ stage: 'confirming', round: 1, retries: 0 }, { type: 'resume', board: builtOf(planned(SPLIT, [tc(['AC-001', 'AC-002'])], [{ feature: 'PRD-001', criteria: ['AC-001', 'AC-002'] }])), prd: { path: 'p', size: 1 } }).state.stage).toBe('done')
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
    expect(r.state.stage).toBe('planning')
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

  test('waits for QA still at work after a PRD change, then asks it for what is new only', () => {
    const now = requirementsOf('## 方案\n- 可以選月繳方案\n- 可以看到價格\n- 可以改方案')
    const added = now.filter(r => !reqs.some(x => x.id === r.id))
    const synced: readonly Op[] = [...tied, { op: 'add_criterion', feature: 'PRD-001', text: '可以改方案' }, { op: 'link_requirements', feature: 'PRD-001', requirements: added.map(r => r.id) }]
    let s: FlowState = { stage: 'writing_tests', round: 0, retries: 0 }
    s = step(s, { type: 'prd_changed', board: board(tied), requirements: now, added, removed: [], key: 'k' }).state
    // The PM syncs while QA is still writing its first test cases: no second QA.
    const afterPm = step(s, { type: 'role_done', role: 'pm', board: board(synced), requirements: now, qaWorking: true })
    expect(afterPm.actions).toEqual([])
    expect(afterPm.state.awaitingQa).toBe(true)
    // QA finishes the criteria it had: it is asked for the new one, and the PM is asked nothing.
    const afterQa = step(afterPm.state, { type: 'role_done', role: 'qa', board: board(synced, [tc(['AC-001', 'AC-002'])]), requirements: now })
    expect(afterQa.state.stage).toBe('adding_tests')
    expect(afterQa.actions).toHaveLength(1)
    expect(afterQa.actions[0]).toMatchObject({ type: 'message', role: 'qa', item: 'AC-003' })
  })

  test('asks QA for what is new once it finished before the PM synced', () => {
    const now = requirementsOf('## 方案\n- 可以選月繳方案\n- 可以看到價格\n- 可以改方案')
    const added = now.filter(r => !reqs.some(x => x.id === r.id))
    const synced: readonly Op[] = [...tied, { op: 'add_criterion', feature: 'PRD-001', text: '可以改方案' }, { op: 'link_requirements', feature: 'PRD-001', requirements: added.map(r => r.id) }]
    let s: FlowState = { stage: 'writing_tests', round: 0, retries: 0 }
    s = step(s, { type: 'prd_changed', board: board(tied), requirements: now, added, removed: [], key: 'k' }).state
    s = step(s, { type: 'role_done', role: 'qa', board: board(tied, [tc(['AC-001', 'AC-002'])]), requirements: now }).state
    const afterPm = step(s, { type: 'role_done', role: 'pm', board: board(synced, [tc(['AC-001', 'AC-002'])]), requirements: now, qaWorking: false })
    expect(afterPm.state.stage).toBe('adding_tests')
    expect(afterPm.actions[0]).toMatchObject({ type: 'message', role: 'qa', item: 'AC-003' })
  })

  test('does not wait for a QA run that is gone: a restart sends QA what is new', () => {
    const now = requirementsOf('## 方案\n- 可以選月繳方案\n- 可以看到價格\n- 可以改方案')
    const added = now.filter(r => !reqs.some(x => x.id === r.id))
    const synced: readonly Op[] = [...tied, { op: 'add_criterion', feature: 'PRD-001', text: '可以改方案' }, { op: 'link_requirements', feature: 'PRD-001', requirements: added.map(r => r.id) }]
    // The flow waited for QA's run when Claude Code closed; on resume, QA is told what has no test case.
    const s = step({ stage: 'splitting', round: 0, retries: 0 }, { type: 'role_done', role: 'pm', board: board(synced), requirements: now, qaWorking: true }).state
    const resumed = step(s, { type: 'resume', board: board(synced, [tc(['AC-001', 'AC-002'])]), prd: { path: 'docs/PRD.md', size: 600 }, requirements: now })
    expect(resumed.actions[0]).toMatchObject({ type: 'message', role: 'qa', item: 'AC-003' })
    expect(resumed.state.awaitingQa).toBeUndefined()
  })

  test('splits a new PRD that shares only a few requirements with the board, naming the ones already answered', () => {
    const covered = board(tied, [tc(['AC-001', 'AC-002'])])
    const many = requirementsOf(['## 方案', '- 可以選月繳方案', ...Array.from({ length: 5 }, (_, i) => `- 新需求 ${i}`)].join('\n'))
    const r = step({ stage: 'done', round: 1, retries: 0 }, { ...START_WITH, requirements: many, board: covered })
    expect(r.actions[0]).toMatchObject({ type: 'spawn', role: 'pm' })
    expect((r.actions[0] as { prompt: string }).prompt).toMatch(new RegExp(`已經有功能對應[\\s\\S]*${r1}`))
  })

  test('does not count the check a start makes against the split’s retry either', () => {
    // A board that answers the PRD with a feature that has no criteria yet.
    const noCriteria = board([{ op: 'add_feature', title: '方案選擇', summary: '', sources: [r1 ?? '', r2 ?? ''] }])
    const checked = step({ stage: 'done', round: 1, retries: 0 }, { ...START_WITH, board: noCriteria })
    expect(checked.state).toMatchObject({ stage: 'splitting', retries: 0 })
  })

  test('does not count the check a start makes against the PM’s retry', () => {
    const covered = board(tied, [tc(['AC-001', 'AC-002'])])
    const now = requirementsOf('## 方案\n- 可以選月繳方案\n- 可以看到價格\n- 可以改方案')
    const checked = step({ stage: 'done', round: 1, retries: 0 }, { ...START_WITH, requirements: now, board: covered })
    expect(checked.state.stage).toBe('splitting')
    // The PM's first pass after the check still leaves a gap: it is sent back once more before the person is asked.
    expect(step(checked.state, { type: 'role_done', role: 'pm', board: covered, requirements: now }).state.stage).toBe('splitting')
  })

  test('checks a board already split for this PRD on a new start, instead of splitting it again', () => {
    const covered = builtOf(planned(tied, [tc(['AC-001', 'AC-002'])], [{ feature: 'PRD-001', criteria: ['AC-001', 'AC-002'] }]))
    const again = step({ stage: 'done', round: 1, retries: 0 }, { ...START_WITH, board: covered })
    expect(again.state.stage).toBe('done')
    expect(again.actions.some(a => a.type === 'spawn')).toBe(false)
    const now = requirementsOf('## 方案\n- 可以選月繳方案\n- 可以看到價格\n- 可以改方案')
    const short = step({ stage: 'done', round: 1, retries: 0 }, { ...START_WITH, requirements: now, board: covered })
    expect(short.state.stage).toBe('splitting')
    expect(short.actions[0]).toMatchObject({ type: 'message', role: 'pm' })
    // A board that answers none of this PRD is split from the start.
    expect(step(INITIAL, { ...START_WITH, board: board(SPLIT) }).actions[0]).toMatchObject({ type: 'spawn', role: 'pm' })
  })

  describe('building', () => {
    const SPLIT2: readonly Op[] = [
      { op: 'add_feature', title: '方案選擇', summary: '' },
      { op: 'add_criterion', feature: 'PRD-001', text: '可以選月繳方案' },
      { op: 'add_criterion', feature: 'PRD-001', text: '可以看到價格' },
    ]
    const plannedTwo = (): Tracker => {
      const b = planned(SPLIT2, [tc(['AC-001', 'AC-002'])], [{ feature: 'PRD-001', criteria: ['AC-001'] }, { feature: 'PRD-001', criteria: ['AC-002'] }])
      return b
    }
    const committed = (b: Tracker, ids: string[]): Tracker => withCommits(b, new Map(ids.map((id, i) => [id, [`abc000${i}`]]))) ?? b

    test('hands the planned tasks to the full-stack one at a time, in order', () => {
      const r = step({ stage: 'planning', round: 0, retries: 0 }, { type: 'role_done', role: 'techlead', board: plannedTwo() })
      expect(r.state).toMatchObject({ stage: 'building', building: 'TASK-001' })
      expect(r.actions[0]).toMatchObject({ type: 'spawn', role: 'fullstack', route: { label: 'Sonnet', effort: 'high' } })
      const prompt = (r.actions[0] as { prompt: string }).prompt
      expect(prompt).toMatch(/TASK-001 任務 1/)
      expect(prompt).toMatch(/AC-001 可以選月繳方案/)
      expect(prompt).toMatch(/TC-001/)
      expect(prompt).toMatch(/commit[\s\S]*TASK-001/)
    })

    test('moves on once the task has a commit, and finishes once every task has one', () => {
      const s = { stage: 'building' as const, round: 0, retries: 0, building: 'TASK-001' }
      const next = step(s, { type: 'role_done', role: 'fullstack', board: committed(plannedTwo(), ['TASK-001']) })
      expect(next.state).toMatchObject({ stage: 'building', building: 'TASK-002', retries: 0 })
      expect(next.actions[0]).toMatchObject({ type: 'message', role: 'fullstack', item: 'TASK-002' })
      const done = step(next.state, { type: 'role_done', role: 'fullstack', board: committed(plannedTwo(), ['TASK-001', 'TASK-002']) })
      expect(done.state.stage).toBe('done')
      expect((done.actions.at(-1) as { text: string }).text).toMatch(/實作 2\/2/)
    })

    test('sends the full-stack back to a task with no commit, then asks the person, whose answer goes to the full-stack', () => {
      const s = { stage: 'building' as const, round: 0, retries: 0, building: 'TASK-001' }
      const again = step(s, { type: 'role_done', role: 'fullstack', board: plannedTwo() })
      expect(again.state).toMatchObject({ stage: 'building', building: 'TASK-001', retries: 1 })
      expect((again.actions[0] as { text: string }).text).toMatch(/TASK-001 還沒有 commit/)
      const stuck = step(again.state, { type: 'role_done', role: 'fullstack', board: plannedTwo() })
      expect(stuck.state).toMatchObject({ stage: 'escalated', resumeAt: 'building' })
      const answered = step(stuck.state, { type: 'answered', question: 'q', answer: '先用假資料', escalation: true })
      expect(answered.state).toMatchObject({ stage: 'building', retries: 0 })
      expect(answered.actions[0]).toMatchObject({ type: 'message', role: 'fullstack' })
    })

    test('sends new criteria to QA and the tech lead before building on', () => {
      const s = { stage: 'building' as const, round: 0, retries: 0, building: 'TASK-001' }
      const more = applyOps(committed(plannedTwo(), ['TASK-001']), [{ op: 'add_criterion', feature: 'PRD-001', text: '可以改方案' }], ctx('pm'))
      if (!more.ok) throw new Error(more.errors.join())
      expect(step(s, { type: 'role_done', role: 'fullstack', board: more.tracker }).actions[0]).toMatchObject({ type: 'message', role: 'qa', item: 'AC-003' })
      const tested = applyOps(more.tracker, [tc(['AC-003'])], ctx('qa'))
      if (!tested.ok) throw new Error(tested.errors.join())
      expect(step(s, { type: 'role_done', role: 'fullstack', board: tested.tracker }).actions[0]).toMatchObject({ type: 'message', role: 'techlead', item: 'AC-003' })
    })

    test('resumes building after a restart, at the first task with no commit', () => {
      const r = step({ stage: 'building', round: 0, retries: 0, building: 'TASK-001' }, { type: 'resume', board: committed(plannedTwo(), ['TASK-001']), prd: { path: 'docs/PRD.md', size: 600 } })
      expect(r.state).toMatchObject({ stage: 'building', building: 'TASK-002' })
      expect(r.actions[0]).toMatchObject({ type: 'message', role: 'fullstack', item: 'TASK-002' })
      expect((r.actions[0] as { text: string }).text).toMatch(/重開過/)
    })

    test('opens a finished board again when a new task has no commit', () => {
      const r = step({ stage: 'done', round: 0, retries: 0 }, { type: 'role_done', role: 'techlead', board: committed(plannedTwo(), ['TASK-001']) })
      expect(r.state).toMatchObject({ stage: 'building', building: 'TASK-002' })
    })
  })
})
