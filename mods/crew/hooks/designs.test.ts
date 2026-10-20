import { describe, expect, test } from 'claude-code/testing'

import { applyOps, designsOf, newTracker } from './board'
import type { Op, Tracker } from './board'
import { decisionsOf, designMark, withDecisions } from './designs'

const ctx = (by: string) => ({ by, today: '2026-10-20', prefixes: { feature: 'PRD-', testCase: 'TC-' } })

const designed = (): Tracker => {
  const a = applyOps(newTracker('x'), [{ op: 'add_feature', title: '方案', summary: '' }, { op: 'add_criterion', feature: 'PRD-001', text: '可以選月繳' }], ctx('pm'))
  if (!a.ok) throw new Error(a.errors.join())
  const b = applyOps(a.tracker, [{ op: 'add_design', feature: 'PRD-001', title: '方案頁', kind: 'screen', body: '三張卡片' }] as Op[], ctx('uiux'))
  if (!b.ok) throw new Error(b.errors.join())
  return b.tracker
}

describe('the person’s decisions on designs', () => {
  test('mark a design with the decision crew recorded for it as it stood, and take one off once it changes', () => {
    const board = designed()
    const d = designsOf(board.prd_items[0]!)[0]!
    const record = { 'SCR-001': { verdict: 'approved' as const, mark: designMark(d) }, 'SCR-009': { verdict: 'approved' as const, mark: 'ffffff' } }
    expect(Object.fromEntries(decisionsOf(board, record))).toEqual({ 'SCR-001': { verdict: 'approved' } })
    const marked = withDecisions(board, decisionsOf(board, record))!
    expect(designsOf(marked.prd_items[0]!)[0]!.crew_decision).toEqual({ verdict: 'approved' })
    expect(withDecisions(marked, decisionsOf(marked, record))).toBeNull()
    // The design was rewritten after the approval: the approval was for another design.
    const rewritten: Tracker = { ...marked, prd_items: marked.prd_items.map(i => ({ ...i, crew_designs: (i.crew_designs ?? []).map(x => ({ ...(x as object), body: '兩張卡片' })) })) }
    expect(decisionsOf(rewritten, record).size).toBe(0)
    expect(designsOf(withDecisions(rewritten, decisionsOf(rewritten, record))!.prd_items[0]!)[0]!.crew_decision).toBeUndefined()
  })

  test('keep a rejection’s reason', () => {
    const board = designed()
    const d = designsOf(board.prd_items[0]!)[0]!
    expect(Object.fromEntries(decisionsOf(board, { 'SCR-001': { verdict: 'rejected', reason: '太擠', mark: designMark(d) } }))).toEqual({ 'SCR-001': { verdict: 'rejected', reason: '太擠' } })
  })
})
