/**
 * The person's decisions on the UI/UX designer's designs: kept by crew on this
 * machine, each tied to the design as it stood (designMark), so a design
 * rewritten after it was approved is not taken for approved, and a board
 * brings no decision of its own. Pure.
 */

import { designsOf } from './board'
import type { Design, DesignDecision, Tracker } from './board'
import { fingerprint } from './prd'

/** crew's record of the person's decisions: design id → the decision, with the design it was made on. */
export type Decided = Record<string, DesignDecision & { mark: string }>

/** Which design an id named: its title, its kind and what it says. */
export const designMark = (d: Design): string => fingerprint(`${d.title}\n${d.kind}\n${d.body}`)

/** Design id → the person's decision on that very design. */
export const decisionsOf = (board: Tracker, decided: Decided): Map<string, DesignDecision> => {
  const out = new Map<string, DesignDecision>()
  for (const d of board.prd_items.flatMap(item => designsOf(item))) {
    const r = decided[d.id]
    if (r === undefined || r.mark !== designMark(d)) continue
    out.set(d.id, { verdict: r.verdict, ...(r.reason === undefined ? {} : { reason: r.reason }) })
  }
  return out
}

/** The board with each design marked with the person's decision on it; null when none changes. */
export const withDecisions = (board: Tracker, decisions: ReadonlyMap<string, DesignDecision>): Tracker | null => {
  let changed = false
  const items = board.prd_items.map(item => {
    if (!Array.isArray(item.crew_designs) || item.crew_designs.length === 0) return item
    const known = new Set(designsOf(item).map(d => d.id))
    const designs = item.crew_designs.map(entry => {
      const v = entry as Record<string, unknown> | null
      if (typeof v?.id !== 'string' || !known.has(v.id)) return entry
      const now = decisions.get(v.id)
      if (JSON.stringify(v.crew_decision ?? null) === JSON.stringify(now ?? null)) return entry
      changed = true
      const { crew_decision: _, ...rest } = v
      return now === undefined ? rest : { ...rest, crew_decision: now }
    })
    return { ...item, crew_designs: designs }
  })
  return changed ? { ...board, prd_items: items } : null
}
