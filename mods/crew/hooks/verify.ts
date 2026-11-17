/**
 * How test cases are verified when crew's run of the person's test commands
 * cannot: QA operating them in the app crew started, or the person confirming
 * them when they accept the feature. The way each is verified is the
 * person's own setting, kept in crew's store where no role writes; so is the
 * evidence of it (QA's report with a screenshot, the person's tick). crew
 * writes both onto the board as crew-owned marks, tied to the test case as it
 * stood (testMark): a case changed since starts again from the test commands.
 */

import { featureTips, planTasksOf } from './board'
import type { CheckMark, TestCase, Tracker, VerifyMethod } from './board'
import { testMark } from './runs'

/** The person's setting of one test case: another way than the test commands, for the case as it stood. */
export type MethodSet = { method: 'qa' | 'accept'; mark: string; at: number }

/**
 * The evidence of a test case verified another way: QA's result with its
 * screenshot, on the commit QA operated (`tips`: the feature's tasks' commits
 * it held), or the person's tick when they passed the feature.
 */
export type Evidence = {
  method: 'qa' | 'accept'
  result: 'passed' | 'failed'
  mark: string
  at: number
  feature: string
  tips?: string
  round?: number
  sha?: string
  shot?: string
  note?: string
}

/**
 * What crew keeps on how the test cases of a PRD are verified: the person's
 * settings, QA's proposals they said no to (by the proposal's fingerprint,
 * so the card does not ask them again), and the evidence.
 */
export type VerifyRecord = { methods: Record<string, MethodSet>; declined: Record<string, string>; evidence: Record<string, Evidence> }

/** The presses on crew's card of QA's proposals: every one as QA proposed it, none of them, or one test case's on its own row (with its id). */
export const VERIFY_ALL = '照這樣設'
export const VERIFY_NONE = '都不要'
export const VERIFY_ONE = '照這個設'
export const VERIFY_NOT = '不要'

export const emptyVerify = (): VerifyRecord => ({ methods: {}, declined: {}, evidence: {} })

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const TC_ID = /^[A-Za-z][A-Za-z0-9_]*-\d+$/

/** The record as crew stored it: what does not read as crew wrote it is left out. */
export const verifyOf = (raw: unknown): VerifyRecord => {
  const out = emptyVerify()
  if (!isRecord(raw)) return out
  if (isRecord(raw.methods))
    for (const [id, m] of Object.entries(raw.methods)) {
      if (!TC_ID.test(id) || !isRecord(m) || (m.method !== 'qa' && m.method !== 'accept') || typeof m.mark !== 'string' || typeof m.at !== 'number') continue
      out.methods[id] = { method: m.method, mark: m.mark, at: m.at }
    }
  if (isRecord(raw.declined))
    for (const [id, f] of Object.entries(raw.declined)) {
      if (TC_ID.test(id) && typeof f === 'string') out.declined[id] = f
    }
  if (isRecord(raw.evidence))
    for (const [id, e] of Object.entries(raw.evidence)) {
      if (!TC_ID.test(id) || !isRecord(e) || (e.method !== 'qa' && e.method !== 'accept') || (e.result !== 'passed' && e.result !== 'failed')) continue
      if (typeof e.mark !== 'string' || typeof e.at !== 'number' || typeof e.feature !== 'string') continue
      out.evidence[id] = {
        method: e.method,
        result: e.result,
        mark: e.mark,
        at: e.at,
        feature: e.feature,
        ...(typeof e.tips === 'string' ? { tips: e.tips } : {}),
        ...(typeof e.round === 'number' ? { round: e.round } : {}),
        ...(typeof e.sha === 'string' ? { sha: e.sha } : {}),
        ...(typeof e.shot === 'string' ? { shot: e.shot } : {}),
        ...(typeof e.note === 'string' ? { note: e.note } : {}),
      }
    }
  return out
}

/** The way the person set for a test case as it stands now: the test commands when their setting was for the case before it changed. */
export const methodSetOf = (rec: VerifyRecord, tc: TestCase): VerifyMethod => {
  const m = rec.methods[tc.id]
  return m !== undefined && m.mark === testMark(tc) ? m.method : 'command'
}

/** The feature a test case is in, on the board. */
const featureOfCase = (board: Tracker, id: string): string | undefined => board.prd_items.find(i => i.test_cases.some(c => c.id === id))?.id

/**
 * The evidence of a test case as the board shows it: only of the way it is
 * verified now and the case as it stands. QA's is out of date once the
 * feature's tasks have a newer commit than QA operated.
 */
export const checkMarkOf = (board: Tracker, rec: VerifyRecord, tc: TestCase): CheckMark | undefined => {
  const method = methodSetOf(rec, tc)
  const e = rec.evidence[tc.id]
  if (method === 'command' || e === undefined || e.method !== method || e.mark !== testMark(tc)) return undefined
  const feature = featureOfCase(board, tc.id)
  // The person's tick is of the feature as they passed it: with the commits it held kept, a newer one puts it out of date too.
  const stale = (e.method === 'qa' || e.tips !== undefined) && (feature === undefined || e.tips !== featureTips(planTasksOf(board, feature)))
  return {
    method: e.method,
    result: e.result,
    at: e.at,
    ...(e.round === undefined ? {} : { round: e.round }),
    ...(e.sha === undefined ? {} : { sha: e.sha }),
    ...(e.shot === undefined ? {} : { shot: e.shot }),
    ...(e.note === undefined ? {} : { note: e.note }),
    ...(stale ? { stale: true as const } : {}),
  }
}

/**
 * The board with each test case marked with the way the person set for it
 * and its evidence, from crew's own record; null when no mark changes. A mark
 * crew's record does not hold (one written by hand) is taken off.
 */
export const withVerify = (board: Tracker, rec: VerifyRecord): Tracker | null => {
  let changed = false
  const items = board.prd_items.map(item => {
    const cases = item.test_cases.map(tc => {
      const method = methodSetOf(rec, tc)
      const check = checkMarkOf(board, rec, tc)
      const wantMethod = method === 'command' ? undefined : method
      const declined = tc.qa_proposal !== undefined && rec.declined[tc.id] === proposalMark(tc) ? true : undefined
      if (tc.crew_method === wantMethod && JSON.stringify(tc.crew_check ?? null) === JSON.stringify(check ?? null) && tc.crew_declined === declined) return tc
      changed = true
      const { crew_method: _m, crew_check: _c, crew_declined: _d, ...rest } = tc
      return { ...rest, ...(wantMethod === undefined ? {} : { crew_method: wantMethod }), ...(check === undefined ? {} : { crew_check: check }), ...(declined === undefined ? {} : { crew_declined: declined }) } as TestCase
    })
    return { ...item, test_cases: cases }
  })
  return changed ? { ...board, prd_items: items } : null
}

/** A proposal as one value: the same proposal said no to is not asked again; another is. */
export const proposalMark = (tc: TestCase): string => {
  const p = tc.qa_proposal as { method?: unknown; reason?: unknown } | undefined
  return `${String(p?.method ?? '')}:${testMark(tc)}`
}

/**
 * The record with the person's setting of test cases: another way, or the
 * test commands again (their setting taken off). The evidence of another way
 * than the one set is dropped: it was gathered for what is no longer asked.
 */
export const setMethods = (rec: VerifyRecord, cases: readonly TestCase[], method: VerifyMethod, at: number): VerifyRecord => {
  const methods = { ...rec.methods }
  const evidence = { ...rec.evidence }
  const declined = { ...rec.declined }
  for (const tc of cases) {
    if (method === 'command') delete methods[tc.id]
    else methods[tc.id] = { method, mark: testMark(tc), at }
    if (evidence[tc.id]?.method !== method) delete evidence[tc.id]
    delete declined[tc.id]
  }
  return { methods, declined, evidence }
}

/** The record with QA's proposals on these test cases said no to, as they stand. */
export const declineProposals = (rec: VerifyRecord, cases: readonly TestCase[]): VerifyRecord => ({
  ...rec,
  declined: { ...rec.declined, ...Object.fromEntries(cases.map(tc => [tc.id, proposalMark(tc)])) },
})

/** The record with evidence of test cases added: each replaces what was kept for that case. */
export const withEvidence = (rec: VerifyRecord, add: Readonly<Record<string, Evidence>>): VerifyRecord => ({ ...rec, evidence: { ...rec.evidence, ...add } })
