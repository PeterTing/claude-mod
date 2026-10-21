import { describe, expect, test } from 'claude-code/testing'

import type { CrewLive } from '../types'
import { applyOps, newTracker } from './board'
import type { Op, Tracker } from './board'
import { emptyLive, metricsOf, snapshotOf, stopKey, usageSignals } from './live'
import { barCells, percent } from './model'
import type { Snapshot } from './model'
import { bandText, bar, paneFailure } from './views'
import { withCommits, withResults, withReviews } from './git'
import { withDecisions } from './designs'
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
    uiux: { state: 'idle', doing: '—', context: 0 },
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
    // No designs yet: G2 has every feature as a gap.
    expect(s.gates.find(g => g.id === 'G2')).toMatchObject({ state: 'gap', covered: 0, total: 2 })
  })

  test('counts progress over the stages built so far, and shows each feature', () => {
    const s = snapshotOf({ board: BOARD, live: LIVE, now: NOW })
    // Two features with criteria, two of three criteria tested, none planned into tasks yet.
    // Units: 2 features specced, 2 designed, 3 criteria tested, 3 criteria planned, and 2 test cases run.
    expect(s.progress).toMatchObject({ done: 4, total: 12 })
    // The same seven stages, in the same order, as each requirement's row.
    expect(s.progress?.stages.map(st => st.label)).toEqual(['規格', '設計', '測試案例', '任務', '實作', 'Review', '測試結果'])
    expect(s.progress?.stages.find(st => st.label === '規格')).toMatchObject({ done: 2, total: 2, state: 'done' })
    expect(s.progress?.stages.find(st => st.label === '測試案例')).toMatchObject({ done: 2, total: 3, state: 'active' })
    expect(s.progress?.stages.find(st => st.label === '任務')).toMatchObject({ done: 0, total: 3, state: 'pending' })
    expect(s.progress?.stages.find(st => st.label === '實作')).toMatchObject({ total: 0, state: 'pending' })
    // Nothing reviews code or runs tests yet: those stages never show as done.
    expect(s.progress?.stages.find(st => st.label === 'Review')).toMatchObject({ total: 0, state: 'pending' })
    expect(s.progress?.stages.find(st => st.label === '測試結果')).toMatchObject({ done: 0, total: 2, state: 'pending' })
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

  test('shows each of the five roles, the designer among them', () => {
    const s = snapshotOf({ board: BOARD, live: LIVE, now: NOW })
    expect(s.roles.map(r => r.id)).toEqual(['pm', 'uiux', 'fullstack', 'qa', 'techlead'])
    expect(s.roles.find(r => r.id === 'pm')).toMatchObject({ state: 'working', doing: '確認 AC-003', context: 8_000, limit: 60_000, route: { tier: 'S', model: 'Sonnet', effort: 'high' } })
    expect(s.roles.find(r => r.id === 'uiux')).toMatchObject({ state: 'idle', doing: '—' })
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

describe('a board crew cannot read', () => {
  test('is in the snapshot, with the PRD crew stopped on, and in the band', () => {
    const why = 'prd-tracker.json 讀不懂：PRD-001 的 test_cases 不是清單。請先修好；crew 沒有改動它。'
    const stopped = snapshotOf({ board: null, live: LIVE, now: NOW, boardProblem: why })
    expect(stopped.boardProblem).toEqual({ text: why, prd: 'docs/PRD.md' })
    expect(bandText(stopped, 'crew')).toMatch(/^crew │ ⚠ 看板讀不到 │/)
    expect(snapshotOf({ board: null, live: emptyLive(), now: NOW, boardProblem: why }).boardProblem).toEqual({ text: why })
    expect(snapshotOf({ board: BOARD, live: LIVE, now: NOW }).boardProblem).toBeUndefined()
    expect(bandText(snapshotOf({ board: BOARD, live: LIVE, now: NOW }), 'crew')).not.toMatch(/看板讀不到/)
  })

  test('draws a title or a reason that is not text as none: the pane takes text alone', () => {
    const [first, second] = BOARD.prd_items
    if (first === undefined || second === undefined) throw new Error('two features')
    const odd = { ...BOARD, prd_items: [{ ...first, test_cases: first.test_cases.map(c => ({ ...c, title: { text: 'x' } })) }, { ...second, crew_dropped: { why: 'x' } }] } as unknown as Tracker
    const s = snapshotOf({ board: odd, live: { ...LIVE, flow: { stage: 'testing', round: 1, retries: 0 } }, now: NOW })
    expect(s.gates.find(g => g.id === 'G6')?.gaps.map(g => g.title)).toContain('TC-001')
    expect(s.progress?.features.find(f => f.id === 'PRD-002')?.dropped).toBe('')
  })
})

describe('a pane crew cannot draw', () => {
  test('says why on one line, masked and cut short', () => {
    const key = `sk-ant-api03-${'A'.repeat(40)}`
    const said = paneFailure(new Error(`board went\nwrong ${key} ${'x'.repeat(400)}`))
    expect(said).toMatch(/^crew 面板畫不出來：Error: board went wrong /)
    expect(said).not.toContain(key)
    expect(said).not.toContain('\n')
    expect(said.length).toBeLessThan(230)
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

  test('never marks a stage done that has nothing approved or passed yet', () => {
    const rows = snapshotOf({ board, live: emptyLive(), now: NOW, prd: { requirements: reqs } }).requirements ?? []
    expect(rows).toHaveLength(4)
    // No design approved, no task reviewed, no test case passed: none of those is done.
    expect(rows.every(r => r.layers.design.state !== 'done' && r.layers.review.state === 'todo' && r.layers.runs.state !== 'done')).toBe(true)
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
    expect(snap.roles.find(r => r.id === 'uiux')?.doing).toBe('—')
  })

  test('fill each requirement’s code column, under way while committed and never done by a commit alone', () => {
    expect((snapshotOf({ board: half, live: building, now: NOW, prd: { requirements: reqs } }).requirements ?? [])[0]?.layers.code).toEqual({ state: 'doing', note: '1/2' })
    const all = withCommits(planned, new Map([['TASK-001', ['abc1234def']], ['TASK-002', ['def5678abc']]])) ?? planned
    expect((snapshotOf({ board: all, live: building, now: NOW, prd: { requirements: reqs } }).requirements ?? [])[0]?.layers.code).toEqual({ state: 'doing', note: '2/2' })
    // Review and test runs are still to come: never shown as done by a commit.
    expect((snapshotOf({ board: all, live: building, now: NOW, prd: { requirements: reqs } }).requirements ?? [])[0]?.layers.review).toEqual({ state: 'todo', note: '0/2' })
  })

  test('count committed code toward the whole but never as done: overall progress stays short of 100% until review', () => {
    const all = withCommits(planned, new Map([['TASK-001', ['abc1234def']], ['TASK-002', ['def5678abc']]])) ?? planned
    const before = snapshotOf({ board: planned, live: building, now: NOW }).progress
    const after = snapshotOf({ board: all, live: building, now: NOW }).progress
    expect(after?.total).toBe(before?.total)
    expect(after?.done).toBe(before?.done)
    expect(after?.done ?? 0).toBeLessThan(after?.total ?? 0)
  })

  describe('and the tech lead’s reviews of them', () => {
    const both = withCommits(planned, new Map([['TASK-001', ['abc1234def']], ['TASK-002', ['def5678abc', 'fed0000aaa']]])) ?? planned
    const review = (b: Tracker, reviews: [string, { sha: string; verdict: 'approve' | 'changes'; notes?: string }][]): Tracker => withReviews(b, new Map(reviews)) ?? b
    const reviewing: CrewLive = { ...emptyLive(), prdPath: 'docs/PRD.md', flow: { stage: 'reviewing', round: 0, retries: 0, building: 'TASK-002', reviewing: { task: 'TASK-002', sha: 'def5678abc' } } }

    test('make G5 and the Review stage, and count code done only once approved', () => {
      // TASK-001 approved; TASK-002 approved at an older commit: out of date.
      const b = review(both, [['TASK-001', { sha: 'abc1234def', verdict: 'approve' }], ['TASK-002', { sha: 'fed0000aaa', verdict: 'approve' }]])
      const snap = snapshotOf({ board: b, live: reviewing, now: NOW })
      const g5 = snap.gates.find(g => g.id === 'G5')
      expect(g5).toMatchObject({ state: 'active', covered: 1, total: 2, name: '每個完成的 task 都通過 code review', fill: '全端修', confirm: 'Tech lead review' })
      expect(g5?.gaps).toEqual([{ id: 'TASK-002', title: '方案 API', status: 'Tech lead 正在 review' }])
      expect(snap.progress?.stages.find(st => st.label === 'Review')).toMatchObject({ done: 1, total: 2, state: 'active' })
      expect(snap.progress?.stages.find(st => st.label === '實作')).toMatchObject({ done: 2, total: 2, state: 'active' })
      const before = snapshotOf({ board: planned, live: reviewing, now: NOW }).progress
      expect((snap.progress?.done ?? 0) - (before?.done ?? 0)).toBe(1)
      const row = (snapshotOf({ board: b, live: reviewing, now: NOW, prd: { requirements: reqs } }).requirements ?? [])[0]
      expect(row?.layers.review).toEqual({ state: 'stale', note: '1/2' })
      expect(row?.layers.code).toEqual({ state: 'doing', note: '2/2' })
    })

    test('say done for code and review once every task’s newest commit is approved', () => {
      const b = review(both, [['TASK-001', { sha: 'abc1234def', verdict: 'approve' }], ['TASK-002', { sha: 'def5678abc', verdict: 'approve' }]])
      const done: CrewLive = { ...emptyLive(), prdPath: 'docs/PRD.md', flow: { stage: 'done', round: 0, retries: 0 } }
      const snap = snapshotOf({ board: b, live: done, now: NOW, prd: { requirements: reqs } })
      expect(snap.gates.find(g => g.id === 'G5')).toMatchObject({ state: 'pass', covered: 2, total: 2 })
      expect(snap.progress?.stages.find(st => st.label === '實作')?.state).toBe('done')
      expect(snap.progress?.stages.find(st => st.label === 'Review')?.state).toBe('done')
      expect(snap.requirements?.[0]?.layers.code).toEqual({ state: 'done', note: '2/2' })
      expect(snap.requirements?.[0]?.layers.review).toEqual({ state: 'done', note: '2/2' })
      expect(snap.items.find(i => i.id === 'TASK-002')).toMatchObject({ status: 'done' })
    })

    test('show each task’s review on the board tab, and the gaps of G5 by where they stand', () => {
      const b = review(both, [['TASK-002', { sha: 'def5678abc', verdict: 'changes', notes: '缺錯誤處理' }]])
      const fixing: CrewLive = { ...emptyLive(), prdPath: 'docs/PRD.md', flow: { stage: 'building', round: 0, retries: 0, building: 'TASK-002', fixing: 'def5678abc' } }
      const snap = snapshotOf({ board: b, live: fixing, now: NOW })
      expect(snap.items.find(i => i.id === 'TASK-001')).toMatchObject({ status: 'doing', note: expect.stringMatching(/commit abc1234 · 等 review/) })
      expect(snap.items.find(i => i.id === 'TASK-002')).toMatchObject({ owner: 'fullstack', status: 'doing', note: expect.stringMatching(/review 要修改：缺錯誤處理 · 全端正在改/) })
      expect(snap.gates.find(g => g.id === 'G5')?.gaps).toEqual([
        { id: 'TASK-001', title: '方案頁', status: '等 Tech lead review' },
        { id: 'TASK-002', title: '方案 API', status: 'review 要修改，全端修正中' },
      ])
      const under: CrewLive = { ...reviewing }
      expect(snapshotOf({ board: both, live: under, now: NOW }).items.find(i => i.id === 'TASK-002')).toMatchObject({ owner: 'techlead', status: 'review', note: expect.stringMatching(/Tech lead 正在 review/) })
    })

    test('call a review out of date once a newer commit lands, and only an approval stale', () => {
      const building: CrewLive = { ...emptyLive(), prdPath: 'docs/PRD.md', flow: { stage: 'building', round: 0, retries: 0, building: 'TASK-001' } }
      const at = (verdict: 'approve' | 'changes'): Tracker => review(both, [['TASK-001', { sha: 'abc1234def', verdict: 'approve' }], ['TASK-002', { sha: 'fed0000aaa', verdict }]])
      // TASK-002 was reviewed at fed0000; def5678 came after, and is not reviewed yet.
      for (const verdict of ['approve', 'changes'] as const) {
        expect(snapshotOf({ board: at(verdict), live: building, now: NOW }).gates.find(g => g.id === 'G5')?.gaps).toEqual([{ id: 'TASK-002', title: '方案 API', status: 'review 過期，等重新 review' }])
      }
      // An approval of an older commit is stale; changes asked of one are no approval, so the stage is under way.
      expect(snapshotOf({ board: at('approve'), live: building, now: NOW, prd: { requirements: reqs } }).requirements?.[0]?.layers.review).toEqual({ state: 'stale', note: '1/2' })
      expect(snapshotOf({ board: at('changes'), live: building, now: NOW, prd: { requirements: reqs } }).requirements?.[0]?.layers.review).toEqual({ state: 'doing', note: '1/2' })
    })
  })

  describe('and crew’s test runs on them', () => {
    const drawn = withDecisions(apply(planned, [{ op: 'add_design', feature: 'PRD-001', title: '方案頁', kind: 'screen', body: '卡片' }], 'uiux'), new Map([['SCR-001', { verdict: 'approved' as const }]])) ?? planned
    const approved = withReviews(withCommits(drawn, new Map([['TASK-001', ['abc1234def']], ['TASK-002', ['def5678abc']]])) ?? drawn, new Map([['TASK-001', { sha: 'abc1234def', verdict: 'approve' as const }], ['TASK-002', { sha: 'def5678abc', verdict: 'approve' as const }]])) ?? drawn
    const ran = (result: 'passed' | 'failed', stale = false): Tracker => withResults(approved, new Map([['TC-001', { result, sha: 'def5678abc', run: '20261020-120000', ...(stale ? { stale: true as const } : {}) }]])) ?? approved
    const testing: CrewLive = { ...emptyLive(), prdPath: 'docs/PRD.md', flow: { stage: 'testing', round: 0, retries: 0 } }

    test('make G6 and the 測試結果 stage from crew’s latest run, and count it toward the whole', () => {
      const none = snapshotOf({ board: approved, live: testing, now: NOW, prd: { requirements: reqs } })
      expect(none.gates.find(g => g.id === 'G6')).toMatchObject({ state: 'active', covered: 0, total: 1, name: 'test case 全部執行通過、附證據', fill: '全端修', confirm: 'crew 跑你設定的測試指令' })
      expect(none.gates.find(g => g.id === 'G6')?.gaps).toEqual([{ id: 'TC-001', title: 't', status: '還沒跑' }])
      // Every task approved, no test case passed yet: the whole is not done.
      expect((none.progress?.done ?? 0) < (none.progress?.total ?? 0)).toBe(true)
      expect(none.requirements?.[0]?.layers.runs).toEqual({ state: 'todo', note: '0/1' })
      const passed = snapshotOf({ board: ran('passed'), live: { ...testing, flow: { stage: 'done', round: 0, retries: 0 } }, now: NOW, prd: { requirements: reqs } })
      expect(passed.gates.find(g => g.id === 'G6')).toMatchObject({ state: 'pass', covered: 1, total: 1 })
      expect(passed.progress?.stages.find(st => st.label === '測試結果')?.state).toBe('done')
      expect(passed.progress?.done).toBe(passed.progress?.total)
      expect(passed.requirements?.[0]?.layers.runs).toEqual({ state: 'done', note: '1/1' })
    })

    test('say a failed run with its evidence, and a result out of date once a commit came after it', () => {
      const failed = snapshotOf({ board: ran('failed'), live: testing, now: NOW, prd: { requirements: reqs } })
      expect(failed.gates.find(g => g.id === 'G6')?.gaps).toEqual([{ id: 'TC-001', title: 't', status: '失敗（.crew/runs/20261020-120000.log）' }])
      const stale = snapshotOf({ board: ran('passed', true), live: testing, now: NOW, prd: { requirements: reqs } })
      expect(stale.gates.find(g => g.id === 'G6')?.gaps).toEqual([{ id: 'TC-001', title: 't', status: '結果過期（之後又有 commit）' }])
      expect(stale.requirements?.[0]?.layers.runs).toEqual({ state: 'stale', note: '0/1' })
    })
  })

  test('show a committed task as under way, by the full-stack, with its commit; a task being built as the full-stack’s', () => {
    const items = snapshotOf({ board: half, live: building, now: NOW }).items
    expect(items.find(i => i.id === 'TASK-001')).toMatchObject({ owner: 'fullstack', status: 'doing' })
    expect(items.find(i => i.id === 'TASK-001')?.note).toMatch(/commit abc1234/)
    expect(items.find(i => i.id === 'TASK-002')).toMatchObject({ owner: 'fullstack', status: 'doing' })
    expect(items.find(i => i.id === 'TASK-002')?.note).toMatch(/全端正在做/)
  })
})

describe('percentages', () => {
  test('never read 100 before everything is done, and fill a bar’s last cell only then', () => {
    expect(percent(199, 200)).toBe(99)
    expect(percent(200, 200)).toBe(100)
    expect(percent(1, 3)).toBe(33)
    expect(percent(0, 0)).toBe(0)
    expect(barCells(99.6, 20)).toBe(19)
    expect(barCells(100, 20)).toBe(20)
    expect(barCells(-5, 20)).toBe(0)
  })

  test('are rounded down where they are shown: the band, the bar, a feature and the PRD', () => {
    const almost = { ...snapshotOf({ board: null, live: emptyLive(), now: 0 }), progress: { done: 199, total: 200, stages: [], features: [], daily: [], recent: [] } } as unknown as Snapshot
    expect(bandText(almost, 'crew')).toMatch(/進度 99%/)
    expect(bar(99.6, 20)).toBe(`${'█'.repeat(19)}░`)
    const apply = (t: Tracker, ops: readonly unknown[], by: string): Tracker => {
      const r = applyOps(t, ops as Op[], { today: '2026-10-15', prefixes: { feature: 'PRD-', testCase: 'TC-' }, by })
      if (!r.ok) throw new Error(r.errors.join())
      return r.tracker
    }
    const board = apply(
      apply(newTracker('x'), [{ op: 'add_feature', title: 'A', summary: '' }, ...['a', 'b', 'c'].map(text => ({ op: 'add_criterion', feature: 'PRD-001', text }))], 'pm'),
      [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }],
      'qa',
    )
    const s = snapshotOf({ board, live: emptyLive(), now: 0 })
    // Two of three criteria tested: 66, not 67.
    expect(s.progress?.features[0]?.percent).toBe(66)
    // The PRD: a feature specced and designed, three criteria tested by one case, none planned: 5 of 9, 55, not 56.
    const five = withDecisions(
      apply(
        apply(apply(newTracker('x'), [{ op: 'add_feature', title: 'A', summary: '' }, ...['a', 'b', 'c'].map(text => ({ op: 'add_criterion', feature: 'PRD-001', text }))], 'pm'), [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002', 'AC-003'], title: 't', steps: ['s'], expected: 'e' }], 'qa'),
        [{ op: 'add_design', feature: 'PRD-001', title: 'A', kind: 'none', body: '沒有畫面' }],
        'uiux',
      ),
      new Map([['SCR-001', { verdict: 'approved' as const }]]),
    )
    const p = snapshotOf({ board: five, live: emptyLive(), now: 0 })
    expect(p.progress).toMatchObject({ done: 5, total: 9 })
    expect(p.prd?.progress).toBe(55)
  })
})

describe('the UI/UX designer’s designs', () => {
  const reqs = requirementsOf('## 訂閱\n- 可以選月繳方案\n- 可以取消訂閱')
  const [r1, r2] = reqs.map(r => r.id)
  const split = apply(
    newTracker('shop'),
    [
      { op: 'add_feature', title: '方案選擇', summary: '', sources: [r1 ?? ''] },
      { op: 'add_feature', title: '取消訂閱', summary: '', sources: [r2 ?? ''] },
      { op: 'add_criterion', feature: 'PRD-001', text: '可以選月繳' },
      { op: 'add_criterion', feature: 'PRD-002', text: '可以取消' },
    ],
    'pm',
  )
  const designed = apply(
    split,
    [
      { op: 'add_design', feature: 'PRD-001', title: '方案頁', kind: 'screen', body: '三張卡片' },
      { op: 'add_design', feature: 'PRD-002', title: '取消', kind: 'none', body: '後台處理' },
    ],
    'uiux',
  )
  const decide = (b: Tracker, d: [string, { verdict: 'approved' | 'rejected'; reason?: string }][]): Tracker => withDecisions(b, new Map(d)) ?? b
  const approving: CrewLive = { ...emptyLive(), prdPath: 'docs/PRD.md', flow: { stage: 'approving', round: 0, retries: 0 } }

  test('make G2 and the 設計 stage from the person’s decisions, and count them toward the whole', () => {
    const b = decide(designed, [['SCR-001', { verdict: 'approved' }], ['SCR-002', { verdict: 'rejected', reason: '要確認頁' }]])
    const snap = snapshotOf({ board: b, live: approving, now: NOW, prd: { requirements: reqs } })
    const g2 = snap.gates.find(g => g.id === 'G2')
    expect(g2).toMatchObject({ state: 'active', covered: 1, total: 2, name: '每個有介面的功能都有畫面和各種狀態', fill: 'UI/UX 補', confirm: '你核准' })
    expect(g2?.gaps).toEqual([{ id: 'PRD-002', title: '取消訂閱', status: '你退回了，UI/UX 重畫中' }])
    expect(snap.progress?.stages.find(st => st.label === '設計')).toMatchObject({ done: 1, total: 2, state: 'active' })
    expect(snap.requirements?.map(r => r.layers.design)).toEqual([
      { state: 'done', note: '1/1' },
      { state: 'doing', note: '0/1' },
    ])
    const before = snapshotOf({ board: designed, live: approving, now: NOW, prd: { requirements: reqs } }).progress
    expect((snap.progress?.done ?? 0) - (before?.done ?? 0)).toBe(1)
    expect(snapshotOf({ board: designed, live: approving, now: NOW }).gates.find(g => g.id === 'G2')?.gaps.map(g => g.status)).toEqual(['等你核准（SCR-001）', '等你核准（SCR-002）'])
    expect(snapshotOf({ board: split, live: approving, now: NOW }).gates.find(g => g.id === 'G2')?.gaps.map(g => g.status)).toEqual(['還沒有設計稿', '還沒有設計稿'])
  })

  test('list each design on the board tab by where it stands, and the designer’s row as it runs', () => {
    const b = decide(designed, [['SCR-001', { verdict: 'approved' }]])
    const designing: CrewLive = { ...approving, flow: { stage: 'designing', round: 0, retries: 0 }, roles: { ...approving.roles, uiux: { state: 'working', doing: '畫設計稿', context: 9_000, label: 'Sonnet', tier: 'S', effort: 'medium' } } }
    const snap = snapshotOf({ board: b, live: designing, now: NOW })
    expect(snap.items.find(i => i.id === 'SCR-001')).toMatchObject({ owner: 'uiux', status: 'done', note: expect.stringMatching(/PRD-001・畫面 · 你核准了/) })
    expect(snap.items.find(i => i.id === 'SCR-002')).toMatchObject({ owner: 'uiux', status: 'review', note: expect.stringMatching(/PRD-002・沒有畫面 · 等你核准/) })
    expect(snap.roles.find(r => r.id === 'uiux')).toMatchObject({ state: 'working', doing: '畫設計稿', route: { tier: 'S', model: 'Sonnet', effort: 'medium' } })
  })
})

describe('usage signals for the brain', () => {
  const day = (usage: CrewLive['usage']): CrewLive => ({ ...emptyLive(), usage })
  const u = (input: number, cacheRead: number, cacheWrite: number) => ({ input, output: 0, cacheRead, cacheWrite, wakes: 1, rotations: 0 })

  test('name a role over 40% of a day big enough to tell, and one reading under 60% from the cache', () => {
    const l = day({ fullstack: u(31_000, 85_000, 50_000), pm: u(6_000, 27_000, 5_000) })
    expect(usageSignals(l).map(x => x.key)).toEqual(['share:fullstack', 'hit:fullstack'])
    expect(usageSignals(l).map(x => x.text)).toEqual(['全端今日佔 81%（超過 40%）', '全端快取命中率 51%（低於 60%）'])
    // A day under 50K, or a role under it, says nothing.
    expect(usageSignals(day({ fullstack: u(3_000, 1_000, 4_000) }))).toEqual([])
  })

  test('tell at each threshold’s edge: over 40%, under 60%, from 50K, past the limit', () => {
    const keys = (usage: CrewLive['usage']) => usageSignals(day(usage)).map(x => x.key)
    // 40% of the day is no reminder; just over it is.
    expect(keys({ pm: u(4_000, 36_000, 0), fullstack: u(6_000, 54_000, 0) })).toEqual(['share:fullstack'])
    expect(keys({ pm: u(4_001, 36_000, 0), fullstack: u(6_000, 54_000, 0) })).toEqual(['share:pm', 'share:fullstack'])
    // 60% from the cache is no reminder; 59% is.
    expect(keys({ fullstack: u(40_000, 60_000, 0) })).toEqual(['share:fullstack'])
    expect(keys({ fullstack: u(41_000, 59_000, 0) })).toEqual(['share:fullstack', 'hit:fullstack'])
    // A day, and a role, of 50K are big enough to tell; one token less is not.
    expect(keys({ fullstack: u(50_000, 0, 0) })).toEqual(['share:fullstack', 'hit:fullstack'])
    expect(keys({ fullstack: u(49_999, 0, 0) })).toEqual([])
    // A context at its limit is no reminder; past it is.
    const at = (context: number): CrewLive => ({ ...emptyLive(), roles: { ...emptyLive().roles, qa: { ...emptyLive().roles.qa, context, limit: 60_000 } } })
    expect(usageSignals(at(60_000))).toEqual([])
    expect(usageSignals(at(60_001)).map(x => x.key)).toEqual(['context:qa'])
  })

  test('name a role past its context threshold, its own or the brain’s', () => {
    const l = { ...emptyLive(), roles: { ...emptyLive().roles, qa: { ...emptyLive().roles.qa, context: 70_000, limit: 60_000 } } }
    expect(usageSignals(l)).toEqual([{ key: 'context:qa', text: 'QA 的 context 70K 超過門檻 60K' }])
    expect(usageSignals({ ...l, tuned: { qa: { limit: 80_000 } } })).toEqual([])
  })

  test('name two roles going back and forth on one item more than six times', () => {
    const msgs = (n: number) => Array.from({ length: n }, (_, i) => ({ t: i, item: 'AC-007', from: i % 2 === 0 ? 'PM' : 'QA', text: '…' }))
    expect(usageSignals({ ...emptyLive(), threads: { 'AC-007': msgs(6) } })).toEqual([])
    expect(usageSignals({ ...emptyLive(), threads: { 'AC-007': msgs(7) } })).toEqual([{ key: 'pingpong:AC-007', text: 'QA 和 PM 在 AC-007 來回 7 次（超過 6 次）' }])
    // A third voice breaks the run.
    expect(usageSignals({ ...emptyLive(), threads: { 'AC-007': [...msgs(4), { t: 9, item: 'AC-007', from: '你', text: '…' }, ...msgs(4)] } })).toEqual([])
  })

  test('measure a role by its share, cache hit rate and context', () => {
    const l = { ...day({ fullstack: u(31_000, 85_000, 50_000), pm: u(6_000, 27_000, 5_000) }), roles: { ...emptyLive().roles, fullstack: { ...emptyLive().roles.fullstack, context: 96_000 } } }
    expect(metricsOf(l, 'fullstack')).toBe('今日佔 81% · 命中率 51% · context 96K')
  })
})

describe('the brain’s actions on usage, measured', () => {
  const at = (role: Partial<CrewLive['usage'][string]>) => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, wakes: 0, rotations: 0, ...role })
  const action = (day: string): NonNullable<CrewLive['tunings']>[number] => ({
    id: 'DEC-007',
    role: 'fullstack',
    text: '全端之後的工作改用 Sonnet・high',
    change: { model: 'sonnet' },
    reason: '',
    before: '今日佔 80% · 命中率 75% · context 96K',
    wakes: 3,
    at: 0,
    base: { day, role: at({ input: 100_000, cacheRead: 300_000, wakes: 3 }), total: 500_000 },
  })
  const now = (tunings: NonNullable<CrewLive['tunings']>, usage: CrewLive['usage']): CrewLive => ({
    ...emptyLive(),
    usageDay: '2026-10-15',
    usage,
    tunings,
    roles: { ...emptyLive().roles, fullstack: { ...emptyLive().roles.fullstack, context: 8_000 } },
  })

  test('by what came since: the role’s share and hit rate since the action, and its context now', () => {
    const usage = { fullstack: at({ input: 110_000, cacheRead: 340_000, wakes: 4 }), pm: at({ input: 150_000 }) }
    const snap = snapshotOf({ board: null, live: now([action('2026-10-15')], usage), now: 0 })
    expect(snap.actions).toEqual([{ id: 'DEC-007', text: '全端之後的工作改用 Sonnet・high', before: '今日佔 80% · 命中率 75% · context 96K', after: '之後佔 50% · 命中率 80% · context 8K' }])
  })

  test('waiting for the role to run again before there is anything since', () => {
    const usage = { fullstack: at({ input: 100_000, cacheRead: 300_000, wakes: 3 }), pm: at({ input: 100_000 }) }
    expect(snapshotOf({ board: null, live: now([action('2026-10-15')], usage), now: 0 }).actions[0]?.after).toBeUndefined()
  })

  test('from the start of a new day, once the day has turned since the action', () => {
    const usage = { fullstack: at({ input: 10_000, cacheRead: 30_000, wakes: 1 }), pm: at({ input: 40_000 }) }
    expect(snapshotOf({ board: null, live: now([action('2026-10-14')], usage), now: 0 }).actions[0]?.after).toBe('之後佔 50% · 命中率 75% · context 8K')
  })
})

describe('where a running flow stopped', () => {
  const RUN = ['building', 'reviewing', 'testing']
  const at = (flow: CrewLive['flow'], more: Partial<CrewLive> = {}): CrewLive => ({ ...emptyLive(), prdPath: 'docs/PRD.md', flow, ...more })

  test('is the stage, the task and the commit it was at: another round of changes is another stop', () => {
    const first = stopKey(at({ stage: 'building', round: 0, retries: 0, building: 'TASK-001', fixing: 'abc0001' }), RUN)
    const later = stopKey(at({ stage: 'building', round: 0, retries: 0, building: 'TASK-001', fixing: 'abc0002' }), RUN)
    expect(first).toBeDefined()
    expect(later).not.toBe(first)
    expect(stopKey(at({ stage: 'reviewing', round: 0, retries: 0, reviewing: { task: 'TASK-001', sha: 'abc0001' } }), RUN)).not.toBe(stopKey(at({ stage: 'reviewing', round: 0, retries: 0, reviewing: { task: 'TASK-001', sha: 'abc0002' } }), RUN))
  })

  test('is no stop while someone works, work is queued, the flow is held, or the person has a question to answer', () => {
    const flow = { stage: 'building' as const, round: 0, retries: 0, building: 'TASK-001' }
    expect(stopKey(at(flow, { roles: { ...emptyLive().roles, fullstack: { ...emptyLive().roles.fullstack, state: 'working' } } }), RUN)).toBeUndefined()
    expect(stopKey(at(flow, { pending: { fullstack: [{ kind: 'message', text: 'x', route: { tier: 'S', model: 'sonnet', label: 'Sonnet', effort: 'high', limit: 60_000 }, run: 'flow' }] } as never }), RUN)).toBeUndefined()
    expect(stopKey(at(flow, { paused: 'person' }), RUN)).toBeUndefined()
    expect(stopKey(at(flow, { questions: [{ id: 'Q-01', question: 'q', from: 'pm', status: 'open', t: 0 }] }), RUN)).toBeUndefined()
    // The brain's proposal on usage is no question about the flow.
    expect(stopKey(at(flow, { questions: [{ id: 'Q-02', question: 'q', from: 'brain', item: 'tune', status: 'open', t: 0 }] }), RUN)).toBeDefined()
    expect(stopKey(at({ stage: 'done', round: 0, retries: 0 }), RUN)).toBeUndefined()
  })
})
