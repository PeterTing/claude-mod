import { describe, expect, test } from 'claude-code/testing'

import type { CrewLive } from '../types'
import { applyOps, newTracker } from './board'
import type { Op, Tracker } from './board'
import { emptyLive, snapshotOf } from './live'
import type { Snapshot } from './model'
import { bandText } from './views'
import { withCommits } from './git'
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
    techlead: { state: 'idle', doing: '—', context: 0 },
    fullstack: { state: 'idle', doing: '—', context: 0 },
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
    // Two features with criteria, two of three criteria tested, none planned into tasks yet.
    expect(s.progress).toMatchObject({ done: 4, total: 8 })
    // The same seven stages, in the same order, as each requirement's row.
    expect(s.progress?.stages.map(st => st.label)).toEqual(['規格', '設計', '測試案例', '任務', '實作', 'Review', '測試結果'])
    expect(s.progress?.stages.find(st => st.label === '規格')).toMatchObject({ done: 2, total: 2, state: 'done' })
    expect(s.progress?.stages.find(st => st.label === '測試案例')).toMatchObject({ done: 2, total: 3, state: 'active' })
    expect(s.progress?.stages.find(st => st.label === '任務')).toMatchObject({ done: 0, total: 3, state: 'pending' })
    expect(s.progress?.stages.find(st => st.label === '實作')).toMatchObject({ total: 0, state: 'pending' })
    // Nothing reviews code or runs tests yet: those stages never show as done.
    expect(s.progress?.stages.find(st => st.label === 'Review')).toMatchObject({ total: 0, state: 'pending' })
    expect(s.progress?.stages.find(st => st.label === '測試結果')).toMatchObject({ total: 0, state: 'pending' })
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

  test('says, for each requirement, how far its spec and test cases are, from the board', () => {
    const rows = snapshotOf({ board, live: emptyLive(), now: NOW, prd: { requirements: reqs } }).requirements ?? []
    expect(rows.map(r => [r.id, r.features, r.layers.spec.state, r.layers.cases.state, r.layers.cases.note])).toEqual([
      [r1, ['PRD-001'], 'done', 'done', '1/1'],
      [r2, ['PRD-002'], 'done', 'doing', '1/2'],
      [r3, ['PRD-003'], 'todo', 'todo', '0/0'],
      [r4, [], 'todo', 'todo', '0/0'],
    ])
    expect(rows[3]?.dropped).toBe('下一版')
  })

  test('marks the stages crew does not track yet as later, never as done', () => {
    const rows = snapshotOf({ board, live: emptyLive(), now: NOW, prd: { requirements: reqs } }).requirements ?? []
    expect(rows).toHaveLength(4)
    expect(rows.every(r => (['design', 'review', 'runs'] as const).every(k => r.layers[k].state === 'later'))).toBe(true)
  })

  test('does not call test cases done while a feature that answers the requirement has no criteria', () => {
    const more = apply(board, [{ op: 'link_requirements', feature: 'PRD-003', requirements: [r1 ?? ''] }], 'pm')
    const row = (snapshotOf({ board: more, live: emptyLive(), now: NOW, prd: { requirements: reqs } }).requirements ?? [])[0]
    expect([row?.layers.spec.state, row?.layers.cases.state, row?.layers.cases.note]).toEqual(['doing', 'doing', '1/1'])
  })

  test('leaves a dropped feature out of the requirement it answered', () => {
    const less = apply(board, [{ op: 'drop_feature', id: 'PRD-002', reason: '不做' }], 'pm')
    const row = (snapshotOf({ board: less, live: emptyLive(), now: NOW, prd: { requirements: reqs } }).requirements ?? [])[1]
    expect([row?.features, row?.layers.spec.state, row?.layers.cases.note]).toEqual([[], 'todo', '0/0'])
  })

  test('shows a requirement a feature answers again as in scope, though it was dropped once', () => {
    const back = apply(board, [{ op: 'link_requirements', feature: 'PRD-001', requirements: [r4 ?? ''] }], 'pm')
    const row = (snapshotOf({ board: back, live: emptyLive(), now: NOW, prd: { requirements: reqs } }).requirements ?? [])[3]
    expect(row?.dropped).toBeUndefined()
    expect(row?.features).toEqual(['PRD-001'])
  })

  test('says the PRD cannot be read, and holds the board to what it last answered', () => {
    const snap = snapshotOf({ board, live: emptyLive(), now: NOW, prd: { requirements: reqs, problem: '讀不到 PRD：找不到 docs/PRD.md' } })
    expect(snap.alignment?.problem).toBe('讀不到 PRD：找不到 docs/PRD.md')
    expect(snap.requirements).toHaveLength(4)
  })

  test('shows a requirement as in scope while a feature answers it, even with its drop still on record', () => {
    const answered = apply(board, [{ op: 'add_feature', title: '年繳', summary: '', sources: [r4 ?? ''] }], 'pm')
    const row = (snapshotOf({ board: answered, live: emptyLive(), now: NOW, prd: { requirements: reqs } }).requirements ?? [])[3]
    expect(row?.dropped).toBeUndefined()
  })

  test('counts the split done only once the board answers the PRD', () => {
    const snap = snapshotOf({ board, live: emptyLive(), now: NOW, prd: { requirements: [...reqs, { id: 'R-000001', text: '新需求', section: '' }] } })
    expect(snap.progress?.stages[0]?.state).not.toBe('done')
  })
})

describe('how aligned the board is, in a word', () => {
  const snap = (alignment: NonNullable<Snapshot['alignment']>): Snapshot =>
    ({ ...snapshotOf({ board: null, live: emptyLive(), now: NOW }), alignment }) as Snapshot
  const base = { covered: 3, total: 3, gaps: 0, added: 0, removed: 0, prdChanged: '剛剛', checked: '剛剛' }

  test('is aligned only with no gap, no change pending and a PRD crew can read', () => {
    expect(bandText(snap(base), 'crew')).toMatch(/對準 PRD ✓/)
    expect(bandText(snap({ ...base, added: 1 }), 'crew')).toMatch(/⚠ PRD 改了/)
    expect(bandText(snap({ ...base, gaps: 2, added: 1 }), 'crew')).toMatch(/⚠ PRD 對不上 2/)
    expect(bandText(snap({ ...base, gaps: 2, problem: '讀不到 PRD：找不到 docs/PRD.md' }), 'crew')).toMatch(/⚠ 讀不到 PRD：找不到 docs\/PRD\.md/)
  })
})

describe('the tech lead’s tasks', () => {
  const reqs = requirementsOf('## 訂閱\n- 可以選月繳方案\n- 可以取消訂閱')
  const [r1, r2] = reqs.map(r => r.id)
  const split = apply(
    newTracker('shop'),
    [
      { op: 'add_feature', title: '方案選擇', summary: '', sources: [r1 ?? ''] },
      { op: 'add_feature', title: '取消訂閱', summary: '', sources: [r2 ?? ''] },
      { op: 'add_criterion', feature: 'PRD-001', text: '可以選月繳' },
      { op: 'add_criterion', feature: 'PRD-002', text: '取消後用到期末' },
      { op: 'add_criterion', feature: 'PRD-002', text: '取消要確認' },
    ],
    'pm',
  )
  const tested = apply(split, [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002', 'AC-003'], title: 't', steps: ['s'], expected: 'e' }], 'qa')
  const board = apply(
    tested,
    [
      { op: 'add_task', feature: 'PRD-001', criteria: ['AC-001'], title: '方案頁', detail: '', size: 'M' },
      { op: 'add_task', feature: 'PRD-002', criteria: ['AC-002'], title: '取消流程', detail: '', size: 'L' },
    ],
    'techlead',
  )
  const planning: CrewLive = { ...emptyLive(), prdPath: 'docs/PRD.md', flow: { stage: 'planning', round: 0, retries: 0 } }

  test('show the tech lead as a role crew runs', () => {
    const tl = snapshotOf({ board, live: planning, now: NOW }).roles.find(r => r.id === 'techlead')
    expect(tl?.doing).toBe('—')
    expect(tl?.limit).toBeGreaterThan(0)
  })

  test('make G3 and the 任務 stage from the board, and count toward progress', () => {
    const snap = snapshotOf({ board, live: planning, now: NOW })
    const g3 = snap.gates.find(g => g.id === 'G3')
    expect(g3).toMatchObject({ state: 'active', covered: 2, total: 3, name: '每條驗收條件都拆好任務' })
    expect(g3?.gaps.map(g => g.id)).toEqual(['AC-003'])
    expect(snap.progress?.stages.find(st => st.label === '任務')).toMatchObject({ done: 2, total: 3, state: 'active' })
    // The two tasks add two units of code still to build.
    expect((snap.progress?.total ?? 0) - (snapshotOf({ board: tested, live: planning, now: NOW }).progress?.total ?? 0)).toBe(2)
    expect((snap.progress?.done ?? 0) - (snapshotOf({ board: tested, live: planning, now: NOW }).progress?.done ?? 0)).toBe(2)
  })

  test('fill the tasks column of each requirement, done only once its spec is', () => {
    const rows = snapshotOf({ board, live: planning, now: NOW, prd: { requirements: reqs } }).requirements ?? []
    expect(rows.map(r => [r.layers.tasks.state, r.layers.tasks.note])).toEqual([
      ['done', '1/1'],
      ['doing', '1/2'],
    ])
  })

  test('leave a dropped task out of the requirement’s tasks cell, and keep the cell short of done while a feature has no criteria', () => {
    const dropped = apply(tested, [{ op: 'add_task', feature: 'PRD-001', criteria: ['AC-001'], title: 't', detail: '' }, { op: 'drop_task', id: 'TASK-001', reason: 'x' }], 'techlead')
    expect([0].map(i => (snapshotOf({ board: dropped, live: planning, now: NOW, prd: { requirements: reqs } }).requirements ?? [])[i]?.layers.tasks)).toEqual([{ state: 'todo', note: '0/1' }])
    const more = apply(board, [{ op: 'add_feature', title: '方案說明', summary: '', sources: [r1 ?? ''] }], 'pm')
    expect((snapshotOf({ board: more, live: planning, now: NOW, prd: { requirements: reqs } }).requirements ?? [])[0]?.layers.tasks.state).toBe('doing')
    // A dropped task is not on the board tab either.
    expect(snapshotOf({ board: dropped, live: planning, now: NOW }).items.some(i => i.id === 'TASK-001')).toBe(false)
  })

  test('list on the board tab, owned by the tech lead, not started until code lands', () => {
    const items = snapshotOf({ board, live: planning, now: NOW }).items
    const task = items.find(i => i.id === 'TASK-001')
    expect(task).toMatchObject({ title: '方案頁', owner: 'techlead', status: 'todo' })
    expect(task?.note).toMatch(/AC-001[\s\S]*M/)
  })
})

describe('the full-stack’s commits', () => {
  const reqs = requirementsOf('## 訂閱\n- 可以選月繳方案')
  const [r1] = reqs.map(r => r.id)
  const split = apply(
    newTracker('shop'),
    [
      { op: 'add_feature', title: '方案選擇', summary: '', sources: [r1 ?? ''] },
      { op: 'add_criterion', feature: 'PRD-001', text: '可以選月繳' },
    ],
    'pm',
  )
  const tested = apply(split, [{ op: 'add_test_case', criteria: ['AC-001'], title: 't', steps: ['s'], expected: 'e' }], 'qa')
  const planned = apply(
    tested,
    [
      { op: 'add_task', feature: 'PRD-001', criteria: ['AC-001'], title: '方案頁', detail: '', size: 'S' },
      { op: 'add_task', feature: 'PRD-001', criteria: ['AC-001'], title: '方案 API', detail: '', size: 'M' },
    ],
    'techlead',
  )
  const half = withCommits(planned, new Map([['TASK-001', ['abc1234def']]])) ?? planned
  const building: CrewLive = { ...emptyLive(), prdPath: 'docs/PRD.md', flow: { stage: 'building', round: 0, retries: 0, building: 'TASK-002' } }

  test('make the 實作 stage and the full-stack row live', () => {
    const snap = snapshotOf({ board: half, live: building, now: NOW })
    expect(snap.progress?.stages.find(st => st.label === '實作')).toMatchObject({ done: 1, total: 2, state: 'active' })
    expect(snap.roles.find(r => r.id === 'fullstack')?.doing).toBe('—')
    expect(snap.roles.find(r => r.id === 'uiux')?.doing).toBe('第 4 階段加入')
  })

  test('fill each requirement’s code column, under way while committed and never done by a commit alone', () => {
    expect((snapshotOf({ board: half, live: building, now: NOW, prd: { requirements: reqs } }).requirements ?? [])[0]?.layers.code).toEqual({ state: 'doing', note: '1/2' })
    const all = withCommits(planned, new Map([['TASK-001', ['abc1234def']], ['TASK-002', ['def5678abc']]])) ?? planned
    expect((snapshotOf({ board: all, live: building, now: NOW, prd: { requirements: reqs } }).requirements ?? [])[0]?.layers.code).toEqual({ state: 'doing', note: '2/2' })
    // Review and test runs are still to come: never shown as done by a commit.
    expect((snapshotOf({ board: all, live: building, now: NOW, prd: { requirements: reqs } }).requirements ?? [])[0]?.layers.review.state).toBe('later')
  })

  test('count committed code toward the whole but never as done: overall progress stays short of 100% until review', () => {
    const all = withCommits(planned, new Map([['TASK-001', ['abc1234def']], ['TASK-002', ['def5678abc']]])) ?? planned
    const before = snapshotOf({ board: planned, live: building, now: NOW }).progress
    const after = snapshotOf({ board: all, live: building, now: NOW }).progress
    expect(after?.total).toBe(before?.total)
    expect(after?.done).toBe(before?.done)
    expect(after?.done ?? 0).toBeLessThan(after?.total ?? 0)
  })

  test('show a committed task as under way, by the full-stack, with its commit; a task being built as the full-stack’s', () => {
    const items = snapshotOf({ board: half, live: building, now: NOW }).items
    expect(items.find(i => i.id === 'TASK-001')).toMatchObject({ owner: 'fullstack', status: 'doing' })
    expect(items.find(i => i.id === 'TASK-001')?.note).toMatch(/commit abc1234/)
    expect(items.find(i => i.id === 'TASK-002')).toMatchObject({ owner: 'fullstack', status: 'doing' })
    expect(items.find(i => i.id === 'TASK-002')?.note).toMatch(/全端正在做/)
  })
})
