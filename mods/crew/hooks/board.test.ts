import { describe, expect, test } from 'claude-code/testing'

import { applyOps, criteriaOf, gateG1, gateG3, gateG4, newTracker, parseOps, prefixesFrom, renderBoard, tasksOf } from './board'
import type { Op, Tracker } from './board'

const CTX = { by: 'pm', today: '2026-10-15', prefixes: { feature: 'PRD-', testCase: 'TC-' } } as const

const run = (tracker: Tracker, ops: readonly Op[], by: string = 'pm') => applyOps(tracker, ops, { ...CTX, by })

const withTwoFeatures = (): Tracker => {
  const r = run(newTracker('shop'), [
    { op: 'add_feature', title: '方案選擇', summary: '使用者選月繳方案' },
    { op: 'add_feature', title: '取消訂閱', summary: '取消後用到期末' },
    { op: 'add_criterion', feature: 'PRD-001', text: '可以選月繳方案' },
    { op: 'add_criterion', feature: 'PRD-002', text: '取消後仍可使用到期末' },
    { op: 'add_criterion', feature: 'PRD-002', text: '到期當天取消立即生效' },
  ])
  if (!r.ok) throw new Error(r.errors.join('; '))
  return r.tracker
}

describe('newTracker', () => {
  test('has every field the strict schema requires', () => {
    const t = newTracker('shop')
    for (const key of ['schema_version', 'project', 'mode', 'source_of_truth', 'acceptance_policy', 'summary', 'prd_items']) {
      expect(t).toHaveProperty(key)
    }
    expect(t.mode).toBe('local-only')
    expect(t.source_of_truth).toBe('repo-json')
    expect((t.acceptance_policy as { verified_requires: string[] }).verified_requires).toContain('automated_tests_passed')
    for (const key of ['total_prds', 'verified_prds', 'partial_prds', 'blocked_prds', 'not_covered_prds', 'total_test_cases']) {
      expect(t.summary).toHaveProperty(key)
    }
  })
})

describe('prefixesFrom', () => {
  test('reads the id prefixes a project schema requires', () => {
    const schema = {
      $defs: {
        prd_item: { properties: { id: { type: 'string', pattern: '^PRD-' } } },
        test_case: { properties: { id: { type: 'string', pattern: '^SMK-' } } },
      },
    }
    expect(prefixesFrom(schema)).toEqual({ feature: 'PRD-', testCase: 'SMK-' })
  })

  test('falls back to PRD- and TC- without a schema or a pattern', () => {
    expect(prefixesFrom(undefined)).toEqual({ feature: 'PRD-', testCase: 'TC-' })
    expect(prefixesFrom({ $defs: { test_case: { properties: { id: { pattern: '.*' } } } } })).toEqual({ feature: 'PRD-', testCase: 'TC-' })
  })
})

describe('applyOps', () => {
  test('adds features with every required prd_item field, numbered in order', () => {
    const t = withTwoFeatures()
    expect(t.prd_items.map(i => i.id)).toEqual(['PRD-001', 'PRD-002'])
    const item = t.prd_items[0]
    for (const key of ['id', 'title', 'status', 'priority', 'summary', 'acceptance_criteria', 'test_cases', 'tasks', 'gaps']) {
      expect(item).toHaveProperty(key)
    }
    expect(item?.status).toBe('planned')
    expect(item?.priority).toBe('P1')
  })

  test('keeps criteria as strings with a stable id, numbered across features', () => {
    const t = withTwoFeatures()
    expect(t.prd_items[1]?.acceptance_criteria).toEqual(['[AC-002] 取消後仍可使用到期末', '[AC-003] 到期當天取消立即生效'])
    expect(criteriaOf(t.prd_items[1]!).map(c => c.id)).toEqual(['AC-002', 'AC-003'])
  })

  test('adds a test case with every required field, linked to its criteria', () => {
    const r = run(withTwoFeatures(), [
      { op: 'add_test_case', criteria: ['AC-002', 'AC-003'], title: '取消後到期前仍可登入', steps: ['取消訂閱', '登入'], expected: '仍可使用' },
    ], 'qa')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const tc = r.tracker.prd_items[1]?.test_cases[0]
    for (const key of ['id', 'status', 'use_cases', 'types', 'role', 'fixture', 'steps', 'expected', 'automated_status', 'manual_status', 'evidence']) {
      expect(tc).toHaveProperty(key)
    }
    expect(tc?.id).toBe('TC-001')
    expect(tc?.acceptance_criteria).toEqual(['AC-002', 'AC-003'])
    expect(tc?.automated_status).toBe('not_run')
    expect(tc?.manual_status).toBe('pending')
    expect(r.results[0]).toEqual({ op: 'add_test_case', id: 'TC-001' })
  })

  test('uses the project’s test case prefix', () => {
    const r = applyOps(withTwoFeatures(), [{ op: 'add_test_case', criteria: ['AC-001'], title: 't', steps: ['s'], expected: 'e' }], {
      ...CTX,
      by: 'qa',
      prefixes: { feature: 'PRD-', testCase: 'SMK-' },
    })
    expect(r.ok && r.tracker.prd_items[0]?.test_cases[0]?.id).toBe('SMK-001')
  })

  test('changes nothing when one op is invalid, and says which', () => {
    const before = withTwoFeatures()
    const r = run(before, [
      { op: 'add_criterion', feature: 'PRD-001', text: '可以改成年繳' },
      { op: 'add_criterion', feature: 'PRD-009', text: '不存在的功能' },
      { op: 'add_criterion', feature: 'PRD-001', text: '  ' },
    ])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.join('\n')).toMatch(/PRD-009/)
    expect(r.errors.join('\n')).toMatch(/空白/)
    expect(before.prd_items[0]?.acceptance_criteria).toEqual(['[AC-001] 可以選月繳方案'])

    const qa = run(before, [
      { op: 'add_test_case', criteria: ['AC-001'], title: 't', steps: ['s'], expected: 'e' },
      { op: 'add_test_case', criteria: ['AC-404'], title: 't', steps: ['s'], expected: 'e' },
      { op: 'add_test_case', criteria: [], title: 't', steps: ['s'], expected: 'e' },
      { op: 'add_test_case', criteria: ['AC-001'], title: 't', steps: [], expected: 'e' },
    ], 'qa')
    expect(qa.ok).toBe(false)
    if (qa.ok) return
    expect(qa.errors.join('\n')).toMatch(/AC-404/)
    expect(qa.errors.join('\n')).toMatch(/沒有指定/)
    expect(qa.errors.join('\n')).toMatch(/步驟或預期結果/)
    expect(before.prd_items[0]?.test_cases).toEqual([])
  })

  test('drops a criterion out of scope and records the decision', () => {
    const r = run(withTwoFeatures(), [{ op: 'drop_criterion', id: 'AC-003', reason: '到期當天取消移到 v1.1' }])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.tracker.prd_items[1]?.acceptance_criteria).toEqual(['[AC-002] 取消後仍可使用到期末'])
    const dec = (r.tracker.decisions as { id: string; criteria?: string; decision: string; date: string }[]).at(-1)
    expect(dec).toMatchObject({ id: 'DEC-001', criteria: 'AC-003', date: '2026-10-15' })
    expect(dec?.decision).toMatch(/AC-003/)
    expect(dec?.decision).toMatch(/v1\.1/)
  })

  test('drops a feature out of scope without deleting it', () => {
    const r = run(withTwoFeatures(), [{ op: 'drop_feature', id: 'PRD-001', reason: '年繳移到 v1.1' }])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.tracker.prd_items[0]?.crew_dropped).toBe('年繳移到 v1.1')
    expect(gateG1(r.tracker).total).toBe(1)
  })

  test('recomputes the summary counts and keeps fields it does not own', () => {
    const t = { ...newTracker('shop'), summary: { current_focus: '訂閱', total_prds: 0 } } as Tracker
    const r = run(t, [{ op: 'add_feature', title: 'a', summary: 's' }])
    expect(r.ok && r.tracker.summary).toMatchObject({ current_focus: '訂閱', total_prds: 1, total_test_cases: 0, partial_prds: 0 })
  })

  test('only lets each role make its own kind of change', () => {
    const qa = run(withTwoFeatures(), [{ op: 'add_feature', title: 'x', summary: 'y' }], 'qa')
    expect(qa.ok).toBe(false)
    if (!qa.ok) expect(qa.errors[0]).toMatch(/QA/)
    const pm = run(withTwoFeatures(), [{ op: 'add_test_case', criteria: ['AC-001'], title: 't', steps: ['s'], expected: 'e' }], 'pm')
    expect(pm.ok).toBe(false)
  })
})

describe('applyOps errors', () => {
  test('says what is missing for each kind of op', () => {
    const t = withTwoFeatures()
    const cases: [Op, RegExp][] = [
      [{ op: 'add_feature', title: ' ', summary: '' }, /標題是空白/],
      [{ op: 'drop_criterion', id: 'AC-404', reason: 'x' }, /找不到驗收條件 AC-404/],
      [{ op: 'drop_feature', id: 'PRD-404', reason: 'x' }, /找不到功能 PRD-404/],
      [{ op: 'link_requirements', feature: 'PRD-404', requirements: ['R-abc123'] }, /找不到功能 PRD-404/],
      [{ op: 'link_requirements', feature: 'PRD-001', requirements: [] }, /沒有指定 PRD 需求編號/],
      [{ op: 'link_requirements', feature: 'PRD-001', requirements: ['登入'] }, /不是 PRD 需求編號/],
      [{ op: 'drop_requirement', id: ' ', reason: 'x' }, /沒有指定 PRD 需求編號/],
      [{ op: 'drop_requirement', id: 'PRD-001', reason: 'x' }, /不是 PRD 需求編號/],
    ]
    for (const [op, message] of cases) {
      const r = run(t, [op])
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.errors[0]).toMatch(message)
    }
  })

  test('lets only the PM link or drop PRD requirements', () => {
    for (const op of [
      { op: 'link_requirements', feature: 'PRD-001', requirements: ['R-abc123'] },
      { op: 'drop_requirement', id: 'R-abc123', reason: 'x' },
    ] as Op[]) {
      const r = run(withTwoFeatures(), [op], 'qa')
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.errors[0]).toMatch(new RegExp(`QA 不能做 ${op.op}`))
    }
  })

  test('linking a requirement the PM dropped takes the drop back', () => {
    const r = run(withTwoFeatures(), [
      { op: 'drop_requirement', id: 'R-abc123', reason: '下一版' },
      { op: 'link_requirements', feature: 'PRD-001', requirements: ['R-abc123'] },
    ])
    expect(r.ok && (r.tracker.decisions?.at(-1) as { status: string }).status).toBe('superseded')
  })

  test('refuses every op from a role it does not know', () => {
    const r = run(withTwoFeatures(), [{ op: 'add_feature', title: 'x', summary: 'y' }], 'designer')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toMatch(/designer 不能做 add_feature/)
  })

  test('numbers decisions after the highest one in use', () => {
    const t = { ...withTwoFeatures(), decisions: [{ id: 'DEC-007', decision: '舊的' }, { note: 'no id' }] } as Tracker
    const r = run(t, [{ op: 'drop_criterion', id: 'AC-001', reason: '移到下一版' }])
    expect(r.ok && (r.tracker.decisions?.at(-1) as { id: string }).id).toBe('DEC-008')
  })

  test('numbers decisions after ids taken elsewhere, such as decisions kept only in memory', () => {
    const r = applyOps(withTwoFeatures(), [{ op: 'drop_criterion', id: 'AC-001', reason: '移到下一版' }], { ...CTX, taken: ['DEC-011', 'MEM-020'] })
    expect(r.ok && (r.tracker.decisions?.at(-1) as { id: string }).id).toBe('DEC-012')
  })

  test('starts a decisions list on a board that has none', () => {
    const { decisions: _, ...rest } = withTwoFeatures()
    const r = run(rest as Tracker, [{ op: 'drop_feature', id: 'PRD-002', reason: '下一版' }])
    expect(r.ok && r.tracker.decisions).toHaveLength(1)
  })
})

describe('prefixesFrom, other spellings', () => {
  test('reads draft-07 definitions too', () => {
    expect(prefixesFrom({ definitions: { prd_item: { properties: { id: { pattern: '^FEAT-' } } } } })).toEqual({ feature: 'FEAT-', testCase: 'TC-' })
  })
})

describe('gates', () => {
  test('G1 counts features that have criteria, leaving out dropped ones', () => {
    const r = run(withTwoFeatures(), [{ op: 'add_feature', title: '帳單', summary: '發票' }])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const g = gateG1(r.tracker)
    expect(g).toMatchObject({ covered: 2, total: 3 })
    expect(g.gaps).toEqual([{ id: 'PRD-003', title: '帳單' }])
  })

  test('G4 lists criteria with no test case', () => {
    const r = run(withTwoFeatures(), [{ op: 'add_test_case', criteria: ['AC-002'], title: 't', steps: ['s'], expected: 'e' }], 'qa')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const g = gateG4(r.tracker)
    expect(g).toMatchObject({ covered: 1, total: 3 })
    expect(g.gaps.map(gap => gap.id)).toEqual(['AC-001', 'AC-003'])
    expect(g.gaps[0]).toMatchObject({ title: '可以選月繳方案', feature: 'PRD-001' })
  })

  test('reads criteria written as plain strings or as id and text objects', () => {
    const t = {
      ...newTracker('legacy'),
      prd_items: [
        {
          id: 'PRD-DISCORD',
          title: 'Discord',
          status: 'partial',
          priority: 'P0',
          summary: '',
          acceptance_criteria: [{ id: 'AC-DISCORD-001', text: '可以綁定' }, '沒有編號的條件'],
          test_cases: [{ id: 'TC-1', status: 'verified', acceptance_criteria: ['AC-DISCORD-001'] }],
          tasks: [],
          gaps: [],
        },
      ],
    } as unknown as Tracker
    const ids = criteriaOf(t.prd_items[0]!).map(c => c.id)
    expect(ids).toEqual(['AC-DISCORD-001', 'PRD-DISCORD#2'])
    expect(gateG4(t)).toMatchObject({ covered: 1, total: 2 })
  })
})

describe('ids after a drop', () => {
  test('a new criterion never takes the id of one that was dropped', () => {
    const covered = run(withTwoFeatures(), [{ op: 'add_test_case', criteria: ['AC-003'], title: 't', steps: ['s'], expected: 'e' }], 'qa')
    if (!covered.ok) throw new Error('setup')
    const dropped = run(covered.tracker, [{ op: 'drop_criterion', id: 'AC-003', reason: '下一版' }])
    if (!dropped.ok) throw new Error('drop')
    const added = run(dropped.tracker, [{ op: 'add_criterion', feature: 'PRD-001', text: '新的條件' }])
    expect(added.ok && added.results[0]?.id).toBe('AC-004')
    // The old test case still points at AC-003; the new criterion is a gap.
    expect(added.ok && gateG4(added.tracker).gaps.map(g => g.id)).toContain('AC-004')
  })

  test('a criterion dropped before any test case covered it keeps its id too', () => {
    const dropped = run(withTwoFeatures(), [{ op: 'drop_criterion', id: 'AC-003', reason: '下一版' }])
    if (!dropped.ok) throw new Error('drop')
    const added = run(dropped.tracker, [{ op: 'add_criterion', feature: 'PRD-001', text: '新的' }])
    expect(added.ok && added.results[0]?.id).toBe('AC-004')
  })

  test('a criterion only a test case still points at keeps its id', () => {
    const t = withTwoFeatures()
    const covered = run(t, [{ op: 'add_test_case', criteria: ['AC-003'], title: 't', steps: ['s'], expected: 'e' }], 'qa')
    if (!covered.ok) throw new Error('setup')
    const removed = covered.tracker
    const item = removed.prd_items[1]
    if (item === undefined) throw new Error('setup')
    item.acceptance_criteria = item.acceptance_criteria.slice(0, 1)
    const added = run(removed, [{ op: 'add_criterion', feature: 'PRD-001', text: '新的' }])
    expect(added.ok && added.results[0]?.id).toBe('AC-004')
  })

  test('G4 leaves out the criteria of a dropped feature', () => {
    const r = run(withTwoFeatures(), [{ op: 'drop_feature', id: 'PRD-002', reason: '下一版' }])
    expect(r.ok && gateG4(r.tracker).gaps.map(g => g.id)).toEqual(['AC-001'])
  })
})

describe('test case details', () => {
  test('refuses a test case with no steps or a blank expected result', () => {
    const r = run(withTwoFeatures(), [{ op: 'add_test_case', criteria: ['AC-001'], title: 't', steps: [], expected: 'e' }], 'qa')
    expect(r.ok).toBe(false)
    const blank = run(withTwoFeatures(), [{ op: 'add_test_case', criteria: ['AC-001'], title: 't', steps: ['s'], expected: '  ' }], 'qa')
    expect(!blank.ok && blank.errors[0]).toMatch(/步驟或預期結果是空白的/)
  })

  test('keeps the types, role and fixture a test case is given', () => {
    const r = run(withTwoFeatures(), [{ op: 'add_test_case', criteria: ['AC-001'], title: 't', steps: ['s'], expected: 'e', types: ['e2e'], role: '管理員', fixture: '已登入' }], 'qa')
    expect(r.ok && r.tracker.prd_items[0]?.test_cases[0]).toMatchObject({ types: ['e2e'], role: '管理員', fixture: '已登入' })
  })

  test('parseOps says what is wrong with each kind of op', () => {
    const r = parseOps([
      'x',
      { op: 'add_feature', title: 't', priority: 'P9' },
      { op: 'drop_feature', id: 'PRD-001' },
      { op: 'add_test_case', criteria: 'AC-001' },
      { op: 'add_test_case', criteria: ['AC-001'], steps: 's' },
      { op: 'add_test_case', criteria: ['AC-001'], steps: ['s'] },
    ])
    expect(!r.ok && r.error.split('\n')).toEqual([
      '第 1 筆 不是物件',
      '第 2 筆 add_feature 的 priority 要是 P0、P1 或 P2',
      '第 3 筆 drop_feature 缺少 reason',
      '第 4 筆 add_test_case 的 criteria 要是驗收條件編號的陣列',
      '第 5 筆 add_test_case 的 steps 要是字串陣列',
      '第 6 筆 add_test_case 缺少 title 或 expected',
    ])
  })
})

describe('renderBoard, edges', () => {
  test('says when the board is empty or the feature is unknown', () => {
    expect(renderBoard(newTracker('x'))).toBe('看板是空的。')
    expect(renderBoard(withTwoFeatures(), { feature: 'PRD-404' })).toBe('找不到功能 PRD-404。')
  })

  test('marks dropped features and features with no criteria', () => {
    const r = run(withTwoFeatures(), [
      { op: 'drop_feature', id: 'PRD-001', reason: '下一版' },
      { op: 'add_feature', title: '帳單', summary: '' },
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const text = renderBoard(r.tracker)
    expect(text).toMatch(/PRD-001 方案選擇 — 移出範圍：下一版/)
    expect(text).toMatch(/PRD-003 帳單 \[planned\] ← 還沒有對應的 PRD 需求\n  （還沒有驗收條件）/)
  })
})

describe('renderBoard', () => {
  test('lists features, criteria and test cases compactly with their ids', () => {
    const r = run(withTwoFeatures(), [{ op: 'add_test_case', criteria: ['AC-002'], title: '取消後仍可登入', steps: ['s'], expected: 'e' }], 'qa')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const text = renderBoard(r.tracker)
    expect(text).toMatch(/PRD-002 取消訂閱/)
    expect(text).toMatch(/AC-002 取消後仍可使用到期末 ← TC-001/)
    expect(text).toMatch(/AC-003 到期當天取消立即生效 ← 沒有 test case/)
  })

  test('shows the PRD requirements each feature answers, and the ones moved out of scope', () => {
    const r = run(withTwoFeatures(), [
      { op: 'link_requirements', feature: 'PRD-001', requirements: ['R-abc123', 'R-def456'] },
      { op: 'drop_requirement', id: 'R-0a0b0c', reason: '下一版' },
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const text = renderBoard(r.tracker)
    expect(text).toMatch(/PRD-001 .*\[[^\]]+\] ← R-abc123、R-def456/)
    expect(text).toMatch(/PRD-002 .*← 還沒有對應的 PRD 需求/)
    expect(text).toMatch(/移出範圍的 PRD 需求：R-0a0b0c（下一版）/)
  })

  test('narrows to one feature', () => {
    const text = renderBoard(withTwoFeatures(), { feature: 'PRD-001' })
    expect(text).toMatch(/PRD-001/)
    expect(text).not.toMatch(/PRD-002/)
  })
})

describe('parseOps', () => {
  test('accepts well-formed ops of every kind', () => {
    const r = parseOps([
      { op: 'add_feature', title: 'a', summary: 's', priority: 'P0' },
      { op: 'add_feature', title: 'b' },
      { op: 'add_criterion', feature: 'PRD-001', text: 't' },
      { op: 'drop_criterion', id: 'AC-001', reason: 'r' },
      { op: 'drop_feature', id: 'PRD-001', reason: 'r' },
      { op: 'add_test_case', criteria: ['AC-001'], title: 't', steps: ['s'], expected: 'e', types: ['manual'], role: 'u', fixture: 'f' },
      { op: 'link_requirements', feature: 'PRD-001', requirements: ['R-abc123'] },
      { op: 'drop_requirement', id: 'R-abc123', reason: 'r' },
      { op: 'add_feature', title: 'c', sources: ['R-abc123'] },
    ])
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.ops).toHaveLength(9)
      expect(r.ops[8]).toEqual({ op: 'add_feature', title: 'c', summary: '', sources: ['R-abc123'] })
      expect(r.ops[1]).toEqual({ op: 'add_feature', title: 'b', summary: '' })
    }
  })

  test('says which op is missing what', () => {
    const r = parseOps([
      { op: 'add_criterion', feature: 'PRD-001' },
      { op: 'add_test_case', criteria: 'AC-001', title: 't', steps: ['s'], expected: 'e' },
      { op: 'teleport' },
      'not an op',
      { op: 'drop_feature', id: 'PRD-001' },
      { op: 'add_feature', title: 'x', priority: 'P9' },
      { op: 'link_requirements', requirements: ['R-abc123'] },
      { op: 'link_requirements', feature: 'PRD-001', requirements: 'R-abc123' },
      { op: 'drop_requirement', id: 'R-abc123' },
      { op: 'add_feature', title: 'y', sources: 'R-abc123' },
    ])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/第 1 筆 add_criterion 缺少 text/)
    expect(r.error).toMatch(/第 2 筆 add_test_case 的 criteria/)
    expect(r.error).toMatch(/第 3 筆.*teleport/)
    expect(r.error).toMatch(/第 4 筆/)
    expect(r.error).toMatch(/第 5 筆 drop_feature 缺少 reason/)
    expect(r.error).toMatch(/第 6 筆 add_feature 的 priority/)
    expect(r.error).toMatch(/第 7 筆 link_requirements 缺少 feature/)
    expect(r.error).toMatch(/第 8 筆 link_requirements 的 requirements/)
    expect(r.error).toMatch(/第 9 筆 drop_requirement 缺少 reason/)
    expect(r.error).toMatch(/第 10 筆 add_feature 的 sources/)
  })

  test('needs a list', () => {
    expect(parseOps({ op: 'add_feature' }).ok).toBe(false)
    expect(parseOps([]).ok).toBe(false)
  })
})

describe('tasks the tech lead breaks the criteria into', () => {
  const task = (criteria: string[], title = '方案頁', extra: Record<string, unknown> = {}): Op => ({ op: 'add_task', feature: 'PRD-001', criteria, title, detail: '做方案選擇頁', size: 'M', ...extra }) as Op

  test('land under the feature, numbered, with the criteria they serve', () => {
    const r = run(withTwoFeatures(), [task(['AC-001']), { op: 'add_task', feature: 'PRD-002', criteria: ['AC-002', 'AC-003'], title: '取消流程', detail: '', size: 'L' }], 'techlead')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(tasksOf(r.tracker.prd_items[0]!)).toEqual([{ id: 'TASK-001', title: '方案頁', status: 'planned', acceptance_criteria: ['AC-001'], detail: '做方案選擇頁', size: 'M' }])
    expect(tasksOf(r.tracker.prd_items[1]!).map(t => t.id)).toEqual(['TASK-002'])
  })

  test('say what is wrong with a task', () => {
    const cases: [Op, RegExp][] = [
      [{ ...task(['AC-001']), feature: 'PRD-404' } as Op, /找不到功能 PRD-404/],
      [task([]), /沒有指定.*驗收條件/],
      [task(['AC-002']), /AC-002 不是 PRD-001 的驗收條件/],
      [task(['AC-001'], ' '), /標題是空白的/],
      [task(['AC-001'], 't', { size: 'XXL' }), /size 要是 S、M、L 或 XL/],
      [{ op: 'drop_task', id: 'TASK-404', reason: 'x' }, /找不到任務 TASK-404/],
    ]
    for (const [op, message] of cases) {
      const r = run(withTwoFeatures(), [op], 'techlead')
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.errors[0]).toMatch(message)
    }
  })

  test('are the tech lead’s alone to add and drop, and the tech lead adds nothing else', () => {
    for (const by of ['pm', 'qa']) {
      const r = run(withTwoFeatures(), [task(['AC-001'])], by)
      expect(r.ok).toBe(false)
    }
    const r = run(withTwoFeatures(), [{ op: 'add_feature', title: 'x', summary: '' }], 'techlead')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toMatch(/Tech lead 不能做 add_feature/)
  })

  test('can be dropped with a reason, which is recorded, and a dropped task keeps its number', () => {
    const r = run(withTwoFeatures(), [task(['AC-001']), { op: 'drop_task', id: 'TASK-001', reason: '併到 TASK-002' }, task(['AC-001'], '方案頁 v2')], 'techlead')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const tasks = tasksOf(r.tracker.prd_items[0]!)
    expect(tasks.map(t => [t.id, t.crew_dropped])).toEqual([
      ['TASK-001', '併到 TASK-002'],
      ['TASK-002', undefined],
    ])
    expect((r.tracker.decisions?.at(-1) as { decision: string }).decision).toMatch(/TASK-001 移出：併到 TASK-002/)
  })

  test('are refused on a feature out of scope, and shown on the board as dropped once dropped', () => {
    const out = run(withTwoFeatures(), [{ op: 'drop_feature', id: 'PRD-001', reason: '下一版' }])
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const r = run(out.tracker, [task(['AC-001'])], 'techlead')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toMatch(/PRD-001 已經移出範圍/)
    const d = run(withTwoFeatures(), [task(['AC-001']), { op: 'drop_task', id: 'TASK-001', reason: '不做' }], 'techlead')
    expect(d.ok).toBe(true)
    if (!d.ok) return
    const text = renderBoard(d.tracker)
    expect(text).toMatch(/任務 TASK-001 方案頁 — 移出：不做/)
    expect(text).toMatch(/AC-001 可以選月繳方案 ← 沒有 test case · 還沒有任務/)
    // Before any task exists the board shows no task lines.
    expect(renderBoard(withTwoFeatures())).not.toMatch(/任務/)
  })

  test('G3 holds every criterion in scope to a task', () => {
    const r = run(withTwoFeatures(), [task(['AC-001']), { op: 'add_task', feature: 'PRD-002', criteria: ['AC-002'], title: '取消', detail: '', size: 'S' }, { op: 'add_task', feature: 'PRD-002', criteria: ['AC-003'], title: '到期', detail: '', size: 'S' }, { op: 'drop_task', id: 'TASK-003', reason: '不做' }], 'techlead')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const g3 = gateG3(r.tracker)
    expect([g3.covered, g3.total]).toEqual([2, 3])
    expect(g3.gaps.map(g => g.id)).toEqual(['AC-003'])
    // A feature out of scope asks for no tasks.
    const out = run(r.tracker, [{ op: 'drop_feature', id: 'PRD-002', reason: '下一版' }])
    expect(out.ok && gateG3(out.tracker)).toEqual({ covered: 1, total: 1, gaps: [] })
  })

  test('show on the board under the criteria they serve', () => {
    const r = run(withTwoFeatures(), [task(['AC-001'])], 'techlead')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const text = renderBoard(r.tracker)
    expect(text).toMatch(/AC-001 可以選月繳方案 ← 沒有 test case · 任務 TASK-001/)
    expect(text).toMatch(/  任務 TASK-001 方案頁（M）← AC-001：做方案選擇頁/)
    expect(text).toMatch(/AC-002 .* · 還沒有任務/)
  })

  test('parse from what the model wrote', () => {
    const ok = parseOps([
      { op: 'add_task', feature: 'PRD-001', criteria: ['AC-001'], title: 't', detail: 'd', size: 'S' },
      { op: 'add_task', feature: 'PRD-001', criteria: ['AC-001'], title: 't' },
      { op: 'drop_task', id: 'TASK-001', reason: 'r' },
    ])
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.ops[1]).toEqual({ op: 'add_task', feature: 'PRD-001', criteria: ['AC-001'], title: 't', detail: '' })
    const bad = parseOps([{ op: 'add_task', criteria: ['AC-001'], title: 't' }, { op: 'add_task', feature: 'PRD-001', criteria: 'AC-001', title: 't' }, { op: 'drop_task', id: 'TASK-001' }])
    expect(bad.ok).toBe(false)
    if (bad.ok) return
    expect(bad.error).toMatch(/第 1 筆 add_task 缺少 feature/)
    expect(bad.error).toMatch(/第 2 筆 add_task 的 criteria/)
    expect(bad.error).toMatch(/第 3 筆 drop_task 缺少 reason/)
  })
})
