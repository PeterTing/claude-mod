import { describe, expect, test } from 'claude-code/testing'

import { applyOps, newTracker } from './board'
import type { Op, Tracker } from './board'
import { diffRequirements, gateG0, requirementList, requirementsOf } from './prd'

const TODO = [
  '# 待辦清單 App v1',
  '',
  '使用者可以在網頁上管理自己的待辦事項。',
  '',
  '## 功能',
  '1. 新增待辦：在輸入框輸入標題後按 Enter 新增；標題不可以空白，最多 100 字。',
  '2. 完成待辦：點勾選框把待辦標記為完成，完成的項目顯示刪除線；再點一次可以取消完成。',
  '3. 篩選：可以切換「全部、未完成、已完成」三種檢視；重新整理頁面後記住上次選的檢視。',
].join('\n')

describe('requirementsOf', () => {
  test('takes each list item of the PRD as a requirement, under its section', () => {
    const reqs = requirementsOf(TODO)
    expect(reqs.map(r => [r.section, r.text.slice(0, 4)])).toEqual([
      ['功能', '新增待辦'],
      ['功能', '完成待辦'],
      ['功能', '篩選：可'],
    ])
    expect(reqs.every(r => /^R-[0-9a-f]{6}$/.test(r.id))).toBe(true)
  })

  test('keeps a requirement’s id while other lines change, and gives it a new one when its own text changes', () => {
    const before = requirementsOf(TODO)
    const edited = requirementsOf(TODO.replace('三種檢視', '四種檢視').replace('# 待辦清單 App v1', '# 待辦清單 App v2'))
    expect(edited[0]?.id).toBe(before[0]?.id)
    expect(edited[1]?.id).toBe(before[1]?.id)
    expect(edited[2]?.id).not.toBe(before[2]?.id)
  })

  test('reads nested items, task lists and table rows, and skips code', () => {
    const md = [
      '## 帳號',
      '- 登入',
      '  - 用 Google 登入',
      '- [ ] 登出',
      '- [x] 忘記密碼',
      '```',
      '- 這是範例程式，不是需求',
      '```',
      '## 方案',
      '| 方案 | 價格 |',
      '| --- | --- |',
      '| 月繳 | 100 |',
    ].join('\n')
    expect(requirementsOf(md).map(r => r.text)).toEqual(['登入', '用 Google 登入', '登出', '忘記密碼', '月繳 | 100'])
  })

  test('takes paragraphs when the PRD has no lists', () => {
    const md = '# 匯出\n\n使用者可以把清單匯出成 CSV。\n\n匯出的檔名包含日期。'
    expect(requirementsOf(md).map(r => r.text)).toEqual(['使用者可以把清單匯出成 CSV。', '匯出的檔名包含日期。'])
  })

  test('counts the same requirement written twice once', () => {
    expect(requirementsOf('- 可以登出\n- 可以登出')).toHaveLength(1)
  })

  test('is empty for an empty PRD', () => {
    expect(requirementsOf('')).toEqual([])
  })
})

describe('diffRequirements', () => {
  test('says which requirements the PRD added and removed', () => {
    const before = requirementsOf(TODO)
    const now = requirementsOf(`${TODO.replace(/^3\..*$/m, '')}\n4. 匯出：可以匯出成 CSV。`)
    const d = diffRequirements(before, now)
    expect(d.added.map(r => r.text)).toEqual(['匯出：可以匯出成 CSV。'])
    expect(d.removed.map(r => r.text.slice(0, 3))).toEqual(['篩選：'])
  })
})

const ctx = { by: 'pm', today: '2026-10-16', prefixes: { feature: 'PRD-', testCase: 'TC-' } }

const boardOf = (ops: readonly Op[]): Tracker => {
  const r = applyOps(newTracker('todo'), ops, ctx)
  if (!r.ok) throw new Error(r.errors.join('; '))
  return r.tracker
}

describe('gateG0', () => {
  const reqs = requirementsOf(TODO)
  const [r1, r2, r3] = reqs.map(r => r.id)

  test('passes when every requirement has a feature and every feature has a requirement', () => {
    const b = boardOf([
      { op: 'add_feature', title: '新增待辦', summary: '', sources: [r1 ?? ''] },
      { op: 'add_feature', title: '完成待辦', summary: '', sources: [r2 ?? ''] },
      { op: 'add_feature', title: '篩選', summary: '', sources: [r3 ?? ''] },
    ])
    expect(gateG0(b, reqs)).toEqual({ covered: 6, total: 6, gaps: [] })
  })

  test('lists requirements no feature covers, and features no requirement backs', () => {
    const b = boardOf([
      { op: 'add_feature', title: '新增待辦', summary: '', sources: [r1 ?? ''] },
      { op: 'add_feature', title: '主題切換', summary: '' },
    ])
    const g = gateG0(b, reqs)
    // One requirement covered, one feature backed; two requirements and one feature are gaps.
    expect(g.covered).toBe(2)
    expect(g.total).toBe(5)
    expect(g.gaps.map(x => x.id)).toEqual([r2, r3, 'PRD-002'])
    expect(g.gaps[0]?.title).toMatch(/^PRD 需求沒有對應的功能：完成待辦/)
    expect(g.gaps[2]?.title).toBe('功能沒有對應的 PRD 需求：主題切換')
  })

  test('calls out a feature whose requirements left the PRD', () => {
    const b = boardOf([{ op: 'add_feature', title: '舊功能', summary: '', sources: ['R-000000'] }])
    expect(gateG0(b, []).gaps).toEqual([{ id: 'PRD-001', title: '功能對應的 PRD 需求已經不在 PRD 裡：舊功能' }])
  })

  test('counts a requirement the PM moved out of scope as settled', () => {
    const b = boardOf([
      { op: 'add_feature', title: '新增待辦', summary: '', sources: [r1 ?? ''] },
      { op: 'add_feature', title: '完成待辦', summary: '', sources: [r2 ?? ''] },
      { op: 'drop_requirement', id: r3 ?? '', reason: '下一版' },
    ])
    expect(gateG0(b, reqs).gaps).toEqual([])
  })

  test('leaves dropped features out', () => {
    const b = boardOf([
      { op: 'add_feature', title: '新增待辦', summary: '', sources: [r1 ?? ''] },
      { op: 'add_feature', title: '主題', summary: '' },
      { op: 'drop_feature', id: 'PRD-002', reason: '不做' },
    ])
    expect(gateG0(b, reqs.slice(0, 1)).gaps).toEqual([])
  })

  test('links requirements to a feature after the fact', () => {
    const b = boardOf([
      { op: 'add_feature', title: '新增待辦', summary: '' },
      { op: 'link_requirements', feature: 'PRD-001', requirements: [r1 ?? ''] },
    ])
    expect(gateG0(b, reqs.slice(0, 1)).gaps).toEqual([])
  })
})

describe('requirementList', () => {
  test('lists requirements one a line with their ids and sections', () => {
    expect(requirementList(requirementsOf('## 帳號\n- 登入'))).toMatch(/^- R-[0-9a-f]{6}（帳號）登入$/)
  })
})
