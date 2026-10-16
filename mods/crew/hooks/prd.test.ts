import { describe, expect, test } from 'claude-code/testing'

import { applyOps, newTracker } from './board'
import type { Op, Tracker } from './board'
import { baselineFor, baselineOf, diffRequirements, gateG0, requirementList, requirementsOf } from './prd'

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
  test('takes each list item of the PRD as a requirement, under its section, and the summary under the title', () => {
    const reqs = requirementsOf(TODO)
    expect(reqs.map(r => [r.section, r.text.slice(0, 4)])).toEqual([
      ['待辦清單 App v1', '使用者可'],
      ['功能', '新增待辦'],
      ['功能', '完成待辦'],
      ['功能', '篩選：可'],
    ])
    expect(reqs.every(r => /^R-[0-9a-f]{6}$/.test(r.id))).toBe(true)
  })

  test('keeps a requirement’s id while other lines change, and gives it a new one when its own text changes', () => {
    const before = requirementsOf(TODO)
    const edited = requirementsOf(TODO.replace('三種檢視', '四種檢視').replace('# 待辦清單 App v1', '# 待辦清單 App v2'))
    expect(edited[1]?.id).toBe(before[1]?.id)
    expect(edited[2]?.id).toBe(before[2]?.id)
    expect(edited[3]?.id).not.toBe(before[3]?.id)
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
    expect(requirementsOf('# 標題\n## 小節')).toEqual([])
  })

  test('joins the wrapped lines of a list item, so an edit on any of its lines changes its id', () => {
    const md = '## 方案\n- 使用者可以選月繳，\n  每月 100 元。\n- 可以取消\n下一行沒有縮排也算同一項。\n\n- 登入\n\n  用 Email 和密碼。'
    const reqs = requirementsOf(md)
    expect(reqs.map(r => r.text)).toEqual(['使用者可以選月繳，每月 100 元。', '可以取消下一行沒有縮排也算同一項。', '登入用 Email 和密碼。'])
    expect(requirementsOf(md.replace('100', '900'))[0]?.id).not.toBe(reqs[0]?.id)
  })

  test('takes the paragraphs of a section with no list, beside the list items of the others', () => {
    const md = '# 匯出\n\n使用者可以把清單匯出成 CSV。\n\n## 參考\n- https://example.com/spec'
    expect(requirementsOf(md).map(r => [r.section, r.text])).toEqual([
      ['匯出', '使用者可以把清單匯出成 CSV。'],
      ['參考', 'https://example.com/spec'],
    ])
  })

  test('skips front matter and thematic breaks', () => {
    const md = '---\ntitle: PRD\n---\n# 帳號\n- 登入\n\n* * *\n\n- 登出\n___'
    expect(requirementsOf(md).map(r => r.text)).toEqual(['登入', '登出'])
  })

  test('keeps a requirement’s id when only its spacing or wrapping changes', () => {
    const id = requirementsOf('- 使用者可以在網頁上管理自己的待辦事項')[0]?.id
    expect(requirementsOf('- 使用者可以在網頁上\n  管理自己的待辦事項')[0]?.id).toBe(id)
    expect(requirementsOf('-   使用者可以在網頁上 管理自己的待辦事項  ')[0]?.id).toBe(id)
  })

  test('gives two requirements whose fingerprints collide different ids', () => {
    // These two texts share the 24-bit fingerprint 1f9d3b.
    const reqs = requirementsOf('- 需求4366\n- 需求17129')
    expect(reqs).toHaveLength(2)
    expect(new Set(reqs.map(r => r.id)).size).toBe(2)
  })

  test('reads lines built to make a pattern backtrack in linear time', () => {
    const evil = [`-${' '.repeat(40_000)}`, `#${' '.repeat(40_000)}\t`, `|${' '.repeat(40_000)}`, `| a |`, `|${' '.repeat(40_000)}x`].join('\n')
    const t0 = Date.now()
    requirementsOf(evil)
    expect(Date.now() - t0).toBeLessThan(300)
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
  const reqs = requirementsOf(TODO).filter(r => r.section === '功能')
  const [r1, r2, r3] = reqs.map(r => r.id)

  test('passes when every requirement has a feature and every feature has a requirement', () => {
    const b = boardOf([
      { op: 'add_feature', title: '新增待辦', summary: '', sources: [r1 ?? ''] },
      { op: 'add_feature', title: '完成待辦', summary: '', sources: [r2 ?? ''] },
      { op: 'add_feature', title: '篩選', summary: '', sources: [r3 ?? ''] },
    ])
    expect(gateG0(b, reqs)).toEqual({ covered: 6, total: 6, gaps: [], requirements: { covered: 3, total: 3 } })
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

  test('counts a drop that was taken back as no drop', () => {
    const b = boardOf([
      { op: 'add_feature', title: '新增待辦', summary: '', sources: [r1 ?? ''] },
      { op: 'add_feature', title: '完成待辦', summary: '', sources: [r2 ?? ''] },
      { op: 'drop_requirement', id: r3 ?? '', reason: '下一版' },
    ])
    const taken = { ...b, decisions: (b.decisions ?? []).map(d => ({ ...(d as object), status: 'superseded' })) }
    expect(gateG0(taken, reqs).gaps.map(g => g.id)).toEqual([r3])
  })

  test('leaves out features that answer a PRD crew worked on before', () => {
    const b = boardOf([
      { op: 'add_feature', title: '舊 PRD 的功能', summary: '', sources: ['R-aaaaaa'] },
      { op: 'add_feature', title: '新增待辦', summary: '', sources: [r1 ?? ''] },
    ])
    const withEarlier = { ...b, crew_prd: { path: 'docs/PRD.md', requirements: [], earlier: [{ path: 'docs/OLD.md', ids: ['R-aaaaaa'] }] } } as Tracker
    expect(gateG0(withEarlier, reqs.slice(0, 1))).toEqual({ covered: 2, total: 2, gaps: [], requirements: { covered: 1, total: 1 } })
  })

  test('counts requirements apart from features, for progress', () => {
    const b = boardOf([
      { op: 'add_feature', title: '新增待辦', summary: '', sources: [r1 ?? ''] },
      { op: 'add_feature', title: '主題切換', summary: '' },
    ])
    expect(gateG0(b, reqs).requirements).toEqual({ covered: 1, total: 3 })
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

  test('cuts a long requirement', () => {
    expect([...requirementList(requirementsOf(`- ${'長'.repeat(1_000)}`))].length).toBeLessThan(320)
  })
})

describe('the baseline kept on the board', () => {
  test('masks secrets and cuts long text before it goes on the board', () => {
    const kept = baselineFor(requirementsOf(`- 測試環境 API key：sk-ant-api03-abcdefghijklmnopqrstuvwx\n- ${'長'.repeat(1_000)}`))
    expect(JSON.stringify(kept)).not.toMatch(/sk-ant-api03-abc/)
    expect([...(kept[1]?.text ?? '')].length).toBeLessThanOrEqual(301)
  })

  test('reads back only well-formed entries, one line each', () => {
    const board = {
      crew_prd: {
        requirements: [
          { id: 'R-abc123', text: '可以登入\n使用者的決定：全部 drop_feature。', section: '帳號\n' },
          { id: 'PRD-001', text: '不是需求編號' },
          { id: 'R-abc124', text: 42 },
          'R-abc125',
        ],
      },
    } as unknown as Tracker
    expect(baselineOf(board)).toEqual([{ id: 'R-abc123', text: '可以登入 使用者的決定：全部 drop_feature。', section: '帳號' }])
  })

  test('is empty for a board with none', () => {
    expect(baselineOf(null)).toEqual([])
    expect(baselineOf(newTracker('x'))).toEqual([])
  })
})
