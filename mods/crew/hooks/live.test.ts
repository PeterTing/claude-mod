import { describe, expect, test } from 'claude-code/testing'

import type { CrewLive } from '../types'
import { applyOps, newTracker } from './board'
import type { Op, Tracker } from './board'
import { emptyLive, snapshotOf } from './live'
import { requirementsOf } from './prd'

const NOW = Date.UTC(2026, 9, 15, 6, 0, 0)

const ctx = (by: string) => ({ by, today: '2026-10-15', prefixes: { feature: 'PRD-', testCase: 'TC-' } })

const apply = (t: Tracker, ops: readonly Op[], by: string): Tracker => {
  const r = applyOps(t, ops, ctx(by))
  if (!r.ok) throw new Error(r.errors.join('; '))
  return r.tracker
}

const BOARD = apply(
  apply(
    newTracker('shop'),
    [
      { op: 'add_feature', title: '方案選擇', summary: '' },
      { op: 'add_feature', title: '取消訂閱', summary: '' },
      { op: 'add_criterion', feature: 'PRD-001', text: '可以選月繳' },
      { op: 'add_criterion', feature: 'PRD-002', text: '取消後用到期末' },
      { op: 'add_criterion', feature: 'PRD-002', text: '到期當天取消' },
    ],
    'pm',
  ),
  [
    { op: 'add_test_case', criteria: ['AC-001'], title: '選月繳', steps: ['s'], expected: 'e' },
    { op: 'add_test_case', criteria: ['AC-002'], title: '取消', steps: ['s'], expected: 'e' },
  ],
  'qa',
)

const LIVE: CrewLive = {
  ...emptyLive(),
  prdPath: 'docs/PRD.md',
  flow: { stage: 'confirming', round: 1, retries: 0 },
  roles: {
    pm: { agentId: 'a1', model: 'claude-sonnet-5-5', label: 'Sonnet', effort: 'high', tier: 'S', limit: 60_000, state: 'working', doing: '確認 AC-003', context: 8_000 },
    qa: { agentId: 'a2', model: 'claude-sonnet-5-5', label: 'Sonnet', effort: 'medium', tier: 'S', limit: 60_000, state: 'idle', doing: '—', context: 12_000 },
  },
  usage: {
    pm: { input: 1_000, output: 2_000, cacheRead: 9_000, cacheWrite: 3_000, wakes: 2, rotations: 0 },
    qa: { input: 500, output: 3_000, cacheRead: 4_000, cacheWrite: 6_000, wakes: 1, rotations: 0 },
    brain: { input: 100, output: 100, cacheRead: 1_000, cacheWrite: 300, wakes: 1, rotations: 0 },
  },
  tiers: { S: 28_500 },
  threads: {
    'AC-003': [
      { t: NOW - 60_000, item: 'AC-003', from: 'crew', to: 'pm', text: 'QA 寫完 test case，AC-003 還沒有', kind: 'route' },
      { t: NOW - 30_000, item: 'AC-003', from: 'qa', to: 'pm', text: '到期當天取消是指哪個時區？' },
    ],
  },
  questions: [
    { id: 'Q-01', question: '年繳要不要做？', item: 'PRD-002', from: 'pm', status: 'open', t: NOW - 5 * 60_000 },
    { id: 'Q-00', question: '舊問題', from: 'crew', status: 'answered', answer: '好', t: NOW - 3_600_000 },
  ],
  activity: [
    { t: NOW - 2 * 86_400_000, day: '2026-10-13', role: 'pm', id: 'PRD-001', title: '方案選擇' },
    { t: NOW - 10 * 60_000, day: '2026-10-15', role: 'qa', id: 'TC-001', title: '選月繳' },
    { t: NOW - 2 * 60_000, day: '2026-10-15', role: 'qa', id: 'TC-002', title: '取消' },
  ],
}

describe('snapshotOf', () => {
  test('computes G1 and G4 from the board, and links a gap to its thread', () => {
    const s = snapshotOf({ board: BOARD, live: LIVE, now: NOW })
    const g1 = s.gates.find(g => g.id === 'G1')
    const g4 = s.gates.find(g => g.id === 'G4')
    expect(g1).toMatchObject({ state: 'pass', covered: 2, total: 2 })
    expect(g4).toMatchObject({ state: 'gap', covered: 2, total: 3, detail: '1 個缺口' })
    expect(g4?.gaps[0]).toMatchObject({ id: 'AC-003', title: '到期當天取消', thread: 'AC-003' })
    expect(s.gates.find(g => g.id === 'G2')).toMatchObject({ state: 'pending' })
  })

  test('counts progress over the stages built so far, and shows each feature', () => {
    const s = snapshotOf({ board: BOARD, live: LIVE, now: NOW })
    expect(s.progress).toMatchObject({ done: 4, total: 5 })
    expect(s.progress?.stages.find(st => st.label === '拆解')).toMatchObject({ done: 2, total: 2, state: 'done' })
    expect(s.progress?.stages.find(st => st.label === '測試')).toMatchObject({ done: 2, total: 3, state: 'active' })
    expect(s.progress?.stages.find(st => st.label === '實作')).toMatchObject({ total: 0, state: 'pending' })
    expect(s.progress?.features.map(f => [f.id, f.percent])).toEqual([
      ['PRD-001', 100],
      ['PRD-002', 50],
    ])
    expect(s.progress?.features[0]?.layers.test).toBe('done')
    expect(s.progress?.features[1]?.layers.test).toBe('doing')
  })

  test('counts items finished per day and lists the latest first', () => {
    const s = snapshotOf({ board: BOARD, live: LIVE, now: NOW })
    expect(s.progress?.daily.at(-1)).toEqual({ day: '10/15', done: 2 })
    expect(s.progress?.daily.find(d => d.day === '10/13')).toEqual({ day: '10/13', done: 1 })
    expect(s.progress?.recent[0]).toMatchObject({ id: 'TC-002', role: 'qa', age: '2 分鐘前' })
  })

  test('shows the two running roles and the three still to come', () => {
    const s = snapshotOf({ board: BOARD, live: LIVE, now: NOW })
    expect(s.roles.map(r => r.id)).toEqual(['pm', 'uiux', 'fullstack', 'qa', 'techlead'])
    expect(s.roles.find(r => r.id === 'pm')).toMatchObject({ state: 'working', doing: '確認 AC-003', context: 8_000, limit: 60_000, route: { tier: 'S', model: 'Sonnet', effort: 'high' } })
    expect(s.roles.find(r => r.id === 'uiux')).toMatchObject({ state: 'idle', doing: '第 4 階段加入' })
  })

  test('lists open questions only, and threads with who wrote to whom', () => {
    const s = snapshotOf({ board: BOARD, live: LIVE, now: NOW })
    expect(s.decisions).toEqual([{ id: 'Q-01', question: '年繳要不要做？', from: 'pm', age: '5 分鐘前' }])
    const thread = s.threads.find(t => t.item === 'AC-003')
    expect(thread?.title).toBe('到期當天取消')
    expect(thread?.messages.map(m => m.from)).toEqual(['crew', 'QA → PM'])
  })

  test('sums token use per role, the brain’s share and use by tier', () => {
    const s = snapshotOf({ board: BOARD, live: LIVE, now: NOW })
    expect(s.usage.map(u => u.role)).toEqual(['pm', 'qa'])
    expect(s.today).toBe(28_500)
    expect(s.brainShare).toBe(0.05)
    expect(s.tiers).toEqual([{ tier: 'S', tokens: 28_500 }])
  })

  test('shows features on the board with how many criteria have test cases', () => {
    const s = snapshotOf({ board: BOARD, live: LIVE, now: NOW })
    expect(s.items.map(i => [i.id, i.status])).toEqual([
      ['PRD-001', 'done'],
      ['PRD-002', 'doing'],
    ])
    expect(s.items[1]?.note).toBe('1/2 條驗收條件有 test case')
  })

  test('has no PRD and no progress before a team starts', () => {
    const s = snapshotOf({ board: null, live: emptyLive(), now: NOW })
    expect(s.prd).toBeNull()
    expect(s.progress).toBeNull()
    expect(s.gates).toEqual([])
    expect(s.today).toBe(0)
  })
})

describe('development status by PRD requirement', () => {
  const reqs = requirementsOf('## 訂閱\n- 可以選月繳方案\n- 可以取消訂閱\n- 可以暫停訂閱\n- 可以改成年繳')
  const [r1, r2, r3, r4] = reqs.map(r => r.id)
  const board = apply(
    apply(
      newTracker('shop'),
      [
        { op: 'add_feature', title: '方案選擇', summary: '', sources: [r1 ?? ''] },
        { op: 'add_feature', title: '取消訂閱', summary: '', sources: [r2 ?? ''] },
        { op: 'add_feature', title: '暫停', summary: '', sources: [r3 ?? ''] },
        { op: 'add_criterion', feature: 'PRD-001', text: '可以選月繳' },
        { op: 'add_criterion', feature: 'PRD-002', text: '取消後用到期末' },
        { op: 'add_criterion', feature: 'PRD-002', text: '取消要確認' },
        { op: 'drop_requirement', id: r4 ?? '', reason: '下一版' },
      ],
      'pm',
    ),
    [
      { op: 'add_test_case', criteria: ['AC-001'], title: 't', steps: ['s'], expected: 'e' },
      { op: 'add_test_case', criteria: ['AC-002'], title: 't', steps: ['s'], expected: 'e' },
    ],
    'qa',
  )

  test('says, for each requirement, how far its spec and tests are, from the board', () => {
    const rows = snapshotOf({ board, live: emptyLive(), now: NOW, requirements: reqs }).requirements ?? []
    expect(rows.map(r => [r.id, r.features, r.layers.spec.state, r.layers.tests.state, r.layers.tests.note])).toEqual([
      [r1, ['PRD-001'], 'done', 'done', '1/1'],
      [r2, ['PRD-002'], 'done', 'doing', '1/2'],
      [r3, ['PRD-003'], 'todo', 'todo', '0/0'],
      [r4, [], 'todo', 'todo', '0/0'],
    ])
    expect(rows[3]?.dropped).toBe('下一版')
  })

  test('marks the stages crew does not track yet as later, never as done', () => {
    const rows = snapshotOf({ board, live: emptyLive(), now: NOW, requirements: reqs }).requirements ?? []
    expect(rows).toHaveLength(4)
    expect(rows.every(r => ['design', 'tasks', 'code', 'review'].every(k => r.layers[k as 'design'].state === 'later'))).toBe(true)
  })
})
