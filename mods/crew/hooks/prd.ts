/**
 * The PRD as crew checks the board against it: each list item (or table row,
 * or paragraph when the PRD has no lists) is a requirement with an id made
 * from its words, so the id stays while other lines change and changes when
 * its own words do. G0 holds the board to the PRD as it stands now. Pure.
 */

import type { PrdItem, Tracker } from './board'
import { redact } from './memory'

export type Requirement = { id: string; text: string; section: string }

/** FNV-1a over the UTF-16 code units: a stable, short fingerprint, not a secret. */
export const fingerprint = (text: string): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0').slice(0, 6)
}

const squeeze = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** Cuts text to `max` characters, marking the cut. */
export const cut = (text: string, max: number): string => ([...text].length > max ? `${[...text].slice(0, max).join('')}…` : text)

const CJK = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/

/** Joins a wrapped line to the text before it: no space between two CJK characters, as the line break was not one. */
const join = (before: string, line: string): string => {
  if (before === '') return line
  if (line === '') return before
  return CJK.test(before.at(-1) ?? '') && CJK.test(line[0] ?? '') ? `${before}${line}` : `${before} ${line}`
}

// Each pattern runs on a trimmed line and matches a prefix only, so no line can make it backtrack.
const ITEM_MARK = /^(?:[-*+]|\d{1,9}[.)])(?:\s+|$)/
const TASK_BOX = /^\[[ xX]\]\s+/
const HEADING_MARK = /^#{1,6}(?:\s+|$)/
const BREAK = /^([-*_])(?:[ \t]*\1){2,}$/
const DIVIDER_CELL = /^:?-{3,}:?$/

const cellsOf = (line: string): string[] | undefined =>
  line.length >= 2 && line.startsWith('|') && line.endsWith('|') ? line.slice(1, -1).split('|').map(squeeze) : undefined

const isDivider = (cells: readonly string[]): boolean => cells.length > 0 && cells.every(c => DIVIDER_CELL.test(c))

type Block = { text: string; section: number; title: string; list: boolean }

/**
 * The PRD's requirements, in order, once each: in a section with lists, each
 * list item (its wrapped lines with it) and table data row; in a section with
 * none, each paragraph. Front matter, code, headings and breaks are not
 * requirements.
 */
export const requirementsOf = (markdown: string): Requirement[] => {
  const lines = markdown.split(/\r?\n/)
  const blocks: Block[] = []
  let section = 0
  let title = ''
  let fence: string | undefined
  /** The block a following line may continue: an item, or a paragraph. */
  let open: Block | undefined
  /** A blank line came after a list item: only an indented line continues it. */
  let gap = false
  let i = 0
  if ((lines[0] ?? '').trim() === '---') {
    const close = lines.findIndex((l, n) => n > 0 && (l.trim() === '---' || l.trim() === '...'))
    if (close > 0) i = close + 1
  }
  for (; i < lines.length; i++) {
    const raw = lines[i] ?? ''
    const line = raw.trim()
    if (fence !== undefined) {
      if (line.startsWith(fence)) fence = undefined
      continue
    }
    if (line.startsWith('```') || line.startsWith('~~~')) {
      fence = line.slice(0, 3)
      open = undefined
      continue
    }
    if (line === '') {
      gap = open?.list === true
      if (open?.list !== true) open = undefined
      continue
    }
    if (HEADING_MARK.test(line)) {
      section += 1
      title = squeeze(line.replace(/^#+/, '').replace(/\s#+$/, ''))
      open = undefined
      gap = false
      continue
    }
    if (BREAK.test(line)) {
      open = undefined
      gap = false
      continue
    }
    const mark = ITEM_MARK.exec(line)
    if (mark !== null) {
      const rest = line.slice(mark[0].length)
      const text = squeeze(rest.replace(TASK_BOX, ''))
      open = { text, section, title, list: true }
      blocks.push(open)
      gap = false
      continue
    }
    const cells = cellsOf(line)
    if (cells !== undefined) {
      open = undefined
      gap = false
      const next = cellsOf((lines[i + 1] ?? '').trim())
      // A row with a divider under it is the table's header; the divider itself is not a row.
      if (isDivider(cells) || (next !== undefined && isDivider(next))) continue
      blocks.push({ text: cells.join(' | '), section, title, list: true })
      continue
    }
    const indented = /^(?: {2,}|\t)/.test(raw)
    if (open !== undefined && (!gap || (open.list && indented))) {
      open.text = join(open.text, squeeze(line))
      gap = false
      continue
    }
    open = { text: squeeze(line), section, title, list: false }
    blocks.push(open)
    gap = false
  }
  const listed = new Set(blocks.filter(b => b.list).map(b => b.section))
  const seen = new Map<string, string>()
  const out: Requirement[] = []
  for (const b of blocks) {
    if (b.text === '' || (listed.has(b.section) && !b.list)) continue
    const key = b.text.replace(/\s+/g, '')
    let id = `R-${fingerprint(key)}`
    // Two different texts with one fingerprint: the later one takes the next free salted fingerprint.
    for (let salt = 1; seen.has(id) && seen.get(id) !== key; salt++) id = `R-${fingerprint(`${key}\u0000${salt}`)}`
    if (seen.has(id)) continue
    seen.set(id, key)
    out.push({ id, text: b.text, section: b.title })
  }
  return out
}

/** G0, with the requirements alone counted apart from the features, for progress. */
export type G0 = { covered: number; total: number; gaps: { id: string; title: string }[]; requirements: { covered: number; total: number } }

/** A PRD requirement's id, as crew numbers it. */
export const REQUIREMENT_ID = /^R-[0-9a-f]{6}$/

/** The PRD requirements a feature answers. */
export const refsOf = (item: PrdItem): string[] =>
  Array.isArray(item.source_refs) ? (item.source_refs as unknown[]).filter((r): r is string => typeof r === 'string' && REQUIREMENT_ID.test(r)) : []

/** Requirements the PM moved out of scope, with the reason; a drop taken back (superseded) no longer counts. */
export const droppedRequirements = (board: Tracker): Map<string, string> => {
  const dropped = new Map<string, string>()
  for (const d of board.decisions ?? []) {
    const v = d as { requirements?: unknown; reason?: unknown; status?: unknown }
    if (!Array.isArray(v.requirements) || (v.status !== undefined && v.status !== 'accepted')) continue
    for (const r of v.requirements) if (typeof r === 'string') dropped.set(r, typeof v.reason === 'string' ? v.reason : '')
  }
  return dropped
}

/** Requirements of PRDs crew worked on before this one, whose features stay on the board. */
const earlierIds = (board: Tracker): Set<string> => {
  const earlier = (board as { crew_prd?: { earlier?: unknown } }).crew_prd?.earlier
  if (!Array.isArray(earlier)) return new Set()
  return new Set(earlier.flatMap(e => (Array.isArray((e as { ids?: unknown } | null)?.ids) ? ((e as { ids: unknown[] }).ids.filter(i => typeof i === 'string') as string[]) : [])))
}

/**
 * G0: the board answers the PRD as it stands. Each requirement has a feature
 * (or a decision that moved it out of scope), and each feature in scope traces
 * to a requirement still in the PRD. Features that answer only an earlier PRD
 * are that PRD's, and left out.
 */
export const gateG0 = (board: Tracker, requirements: readonly Requirement[]): G0 => {
  const current = new Set(requirements.map(r => r.id))
  const earlier = earlierIds(board)
  const features = board.prd_items.filter(i => {
    if (i.crew_dropped !== undefined) return false
    const refs = refsOf(i)
    return refs.length === 0 || refs.some(r => current.has(r)) || !refs.every(r => earlier.has(r))
  })
  const answered = new Set(features.flatMap(refsOf))
  const settled = droppedRequirements(board)
  const gaps: G0['gaps'] = []
  let asked = 0
  for (const r of requirements) {
    if (answered.has(r.id) || settled.has(r.id)) asked += 1
    else gaps.push({ id: r.id, title: `PRD 需求沒有對應的功能：${cut(r.text, 40)}` })
  }
  let traced = 0
  for (const f of features) {
    const refs = refsOf(f)
    if (refs.some(r => current.has(r))) traced += 1
    else gaps.push({ id: f.id, title: refs.length === 0 ? `功能沒有對應的 PRD 需求：${f.title}` : `功能對應的 PRD 需求已經不在 PRD 裡：${f.title}` })
  }
  return { covered: asked + traced, total: requirements.length + features.length, gaps, requirements: { covered: asked, total: requirements.length } }
}

/** What the PRD added and removed since the requirements crew last synced to. */
export const diffRequirements = (before: readonly Requirement[], now: readonly Requirement[]): { added: Requirement[]; removed: Requirement[] } => {
  const old = new Set(before.map(r => r.id))
  const fresh = new Set(now.map(r => r.id))
  return { added: now.filter(r => !old.has(r.id)), removed: before.filter(r => !fresh.has(r.id)) }
}

/** How much of a requirement's text a role's prompt or the board carries: the PM reads the PRD itself for the rest. */
const TEXT_MAX = 300
const SECTION_MAX = 80

/** The requirements for a role's prompt, one a line. */
export const requirementList = (requirements: readonly Requirement[]): string =>
  requirements.map(r => `- ${r.id}${r.section === '' ? '' : `（${cut(r.section, SECTION_MAX)}）`}${cut(r.text, TEXT_MAX)}`).join('\n')

/** The requirements as the board keeps them, which is in git: secrets masked, long text cut. */
export const baselineFor = (requirements: readonly Requirement[]): Requirement[] =>
  requirements.map(r => ({ id: r.id, text: cut(redact(r.text), TEXT_MAX), section: cut(redact(r.section), SECTION_MAX) }))

/** The most requirements crew reads back from a board: a PRD with more is refused at start. */
export const MAX_REQUIREMENTS = 400

/** The requirements the board last answered, as it keeps them: well-formed entries only, each on one line. */
export const baselineOf = (board: Tracker | null): Requirement[] => {
  const kept = (board as { crew_prd?: { requirements?: unknown } } | null)?.crew_prd?.requirements
  if (!Array.isArray(kept)) return []
  return kept.slice(0, MAX_REQUIREMENTS).flatMap((r): Requirement[] => {
    const v = r as Partial<Requirement> | null
    if (typeof v !== 'object' || v === null || typeof v.id !== 'string' || !REQUIREMENT_ID.test(v.id) || typeof v.text !== 'string') return []
    return [{ id: v.id, text: cut(squeeze(v.text), TEXT_MAX), section: typeof v.section === 'string' ? cut(squeeze(v.section), SECTION_MAX) : '' }]
  })
}

/** Names a change of the PRD against the board's baseline, so the PM is told about each change once. */
export const changeKey = (baseline: readonly Requirement[], added: readonly Requirement[], removed: readonly Requirement[]): string => {
  const ids = (rs: readonly Requirement[]) => fingerprint(rs.map(r => r.id).join())
  return `${ids(baseline)}+${ids(added)}-${ids(removed)}`
}

/** How many earlier PRDs a board remembers. */
const EARLIER_MAX = 10

/**
 * The PRDs crew worked on before `path`, as the board keeps them: a new PRD
 * moves the one before it there, with the ids of its requirements, so that
 * PRD's features stay its own and do not count against the new one.
 */
export const earlierFor = (board: Tracker, path: string): { earlier?: { path: string; ids: string[] }[] } => {
  const kept = (board as { crew_prd?: { path?: unknown; earlier?: unknown } }).crew_prd
  if (kept === undefined) return {}
  const before = (Array.isArray(kept.earlier) ? kept.earlier : []).flatMap((e): { path: string; ids: string[] }[] => {
    const v = e as { path?: unknown; ids?: unknown } | null
    if (typeof v?.path !== 'string' || !Array.isArray(v.ids) || v.path === path || v.path === kept.path) return []
    return [{ path: v.path, ids: v.ids.filter((i): i is string => typeof i === 'string' && REQUIREMENT_ID.test(i)) }]
  })
  const moved = typeof kept.path === 'string' && kept.path !== path ? [{ path: kept.path, ids: baselineOf(board).map(r => r.id) }] : []
  const earlier = [...before, ...moved].slice(-EARLIER_MAX)
  return earlier.length === 0 ? {} : { earlier }
}
