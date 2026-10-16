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
const FENCE = /^(`{3,}|~{3,})/
const UNDERLINE = /^(?:=+|-+)$/
const FRONT_FIELD = /^[\w-]+\s*:/
/** A section that records the PRD's own history: its dated or versioned entries are not what to build. */
const HISTORY = /(修訂|版本|變更|更新)(紀錄|記錄|歷程|歷史)|revision\s+history|change\s?log/i
const DATED = /^(?:\d{4}[-/.年]\d{1,2}|v?\d+(?:\.\d+)+(?!\S))/i
/** Sections that give context, not requirements: the whole title, numbered or not (一、背景, 1. Background, 背景說明). */
const CONTEXT =
  /^(?:(?:\d+(?:\.\d+)*|[一二三四五六七八九十]+)[、.．)）]?\s*)?(?:背景|動機|參考資料|參考|附錄|名詞解釋|名詞定義|概述|簡介|前言|background|motivation|references?|appendix|glossary|overview|introduction)(?:說明|介紹|資料)?$/i
/** A line that is only an image, a link or an address: no requirement in its own words. */
const BARE = /^(?:!?\[[^\]]*\]\([^)\s]*\)|<?https?:\/\/\S+?>?)$/
/** How much of a requirement crew keeps: its id is taken from all of it. */
const TEXT_KEPT = 1_000
const ITEM_MARK = /^(?:[-*+]|\d{1,9}[.)])(?:\s+|$)/
const TASK_BOX = /^\[[ xX]\]\s+/
const HEADING_MARK = /^#{1,6}(?:\s+|$)/
const BREAK = /^([-*_])(?:[ \t]*\1){2,}$/
const DIVIDER_CELL = /^:?-{3,}:?$/

const cellsOf = (line: string): string[] | undefined =>
  line.length >= 2 && line.startsWith('|') && line.endsWith('|') ? line.slice(1, -1).split('|').map(squeeze) : undefined

const isDivider = (cells: readonly string[]): boolean => cells.length > 0 && cells.every(c => DIVIDER_CELL.test(c))

type Block = { text: string; section: number; title: string; list: boolean; intro: boolean }

/**
 * The PRD's requirements, in order, once each:
 * - in a section with a list, each list item (its wrapped lines with it) and table data row;
 * - in a section without one, each paragraph, except one ending with a colon (a lead-in);
 * - the text under the title only when the rest of the PRD holds no requirement.
 *
 * Not requirements: front matter, code, comments, quotes, headings, breaks,
 * lines that are only an image or a link, context sections (背景, 參考,
 * Background, References…), and the dated or versioned entries of a revision
 * history.
 */
export const requirementsOf = (markdown: string): Requirement[] => {
  const lines = markdown.split(/\r?\n/)
  const blocks: Block[] = []
  let section = 0
  let title = ''
  let fence: { char: string; length: number } | undefined
  let comment = false
  /** The section under the PRD's title: the one before any heading, or under a first heading of level 1. */
  let intro = 0
  let headings = 0
  /** The block a following line may continue: an item, or a paragraph. */
  let open: Block | undefined
  /** A blank line came after a list item: only an indented line continues it. */
  let gap = false
  let i = 0
  if ((lines[0] ?? '').trim() === '---') {
    const close = lines.findIndex((l, n) => n > 0 && (l.trim() === '---' || l.trim() === '...'))
    // Front matter is YAML: key: value lines, with indented lines under a key; anything else makes the first line a rule.
    const body = lines.slice(1, close)
    if (close > 0 && body.some(l => FRONT_FIELD.test(l)) && body.every(l => l.trim() === '' || FRONT_FIELD.test(l) || /^\s/.test(l))) i = close + 1
  }
  for (; i < lines.length; i++) {
    const raw = lines[i] ?? ''
    const line = raw.trim()
    if (comment) {
      if (line.includes('-->')) comment = false
      continue
    }
    if (line.startsWith('<!--')) {
      comment = !line.includes('-->')
      open = undefined
      continue
    }
    if (fence !== undefined) {
      // A fence closes only with the same mark, at least as long, and nothing after it.
      const close = FENCE.exec(line)
      if (close !== null && close[1]?.[0] === fence.char && (close[1]?.length ?? 0) >= fence.length && line.slice(close[0].length).trim() === '') fence = undefined
      continue
    }
    const opening = FENCE.exec(line)
    if (opening !== null) {
      fence = { char: opening[1]?.[0] ?? '`', length: opening[1]?.length ?? 3 }
      open = undefined
      continue
    }
    if (line === '') {
      gap = open?.list === true
      if (open?.list !== true) open = undefined
      continue
    }
    const heading = (level: number, text: string) => {
      section += 1
      headings += 1
      if (headings === 1 && level === 1) intro = section
      title = text
      open = undefined
      gap = false
    }
    if (HEADING_MARK.test(line)) {
      heading(line.length - line.replace(/^#+/, '').length, squeeze(line.replace(/^#+/, '').replace(/\s#+$/, '')))
      continue
    }
    // A paragraph underlined with = or - is a heading.
    if (UNDERLINE.test(line) && open !== undefined && !open.list && !gap && blocks.at(-1) === open) {
      blocks.pop()
      heading(line.startsWith('=') ? 1 : 2, open.text)
      continue
    }
    if (line.startsWith('>')) {
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
      open = { text, section, title, list: true, intro: section === intro }
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
      blocks.push({ text: cells.join(' | '), section, title, list: true, intro: section === intro })
      continue
    }
    const indented = /^(?: {2,}|\t)/.test(raw)
    if (open !== undefined && (!gap || (open.list && indented))) {
      open.text = join(open.text, squeeze(line))
      gap = false
      continue
    }
    open = { text: squeeze(line), section, title, list: false, intro: section === intro }
    blocks.push(open)
    gap = false
  }
  const kept = blocks.filter(b => b.text !== '' && !BARE.test(b.text) && !CONTEXT.test(b.title) && !(HISTORY.test(b.title) && DATED.test(b.text)))
  const listed = new Set(kept.filter(b => b.list).map(b => b.section))
  const chosen = kept.filter(b => b.list || (!listed.has(b.section) && !/[:：]$/.test(b.text)))
  const beyond = chosen.some(b => !b.intro)
  const seen = new Map<string, string>()
  const out: Requirement[] = []
  for (const b of chosen) {
    if (b.intro && !b.list && beyond) continue
    const key = b.text.replace(/\s+/g, '')
    let id = `R-${fingerprint(key)}`
    // Two different texts with one fingerprint: the later one takes the next free salted fingerprint.
    for (let salt = 1; seen.has(id) && seen.get(id) !== key; salt++) id = `R-${fingerprint(`${key}\u0000${salt}`)}`
    if (seen.has(id)) continue
    seen.set(id, key)
    out.push({ id, text: cut(b.text, TEXT_KEPT), section: cut(b.title, TEXT_KEPT) })
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
const earlierOf = (board: Tracker, key: 'ids' | 'features'): Set<string> => {
  const earlier = (board as { crew_prd?: { earlier?: unknown } }).crew_prd?.earlier
  if (!Array.isArray(earlier)) return new Set()
  return new Set(
    earlier.flatMap(e => {
      const list = (e as Record<string, unknown> | null)?.[key]
      return Array.isArray(list) ? list.filter((i): i is string => typeof i === 'string') : []
    }),
  )
}

/**
 * G0: the board answers the PRD as it stands. Each requirement has a feature
 * (or a decision that moved it out of scope), and each feature in scope traces
 * to a requirement still in the PRD. Features that answer only an earlier PRD
 * are that PRD's, and left out.
 */
export const gateG0 = (board: Tracker, requirements: readonly Requirement[]): G0 => {
  const current = new Set(requirements.map(r => r.id))
  const earlier = earlierOf(board, 'ids')
  const theirs = earlierOf(board, 'features')
  const features = board.prd_items.filter(i => {
    if (i.crew_dropped !== undefined || theirs.has(i.id)) return false
    const refs = refsOf(i)
    return refs.length === 0 || refs.some(r => current.has(r)) || !refs.every(r => earlier.has(r))
  })
  const answered = new Set(features.flatMap(refsOf))
  const settled = droppedRequirements(board)
  const gaps: G0['gaps'] = []
  let asked = 0
  for (const r of requirements) {
    if (answered.has(r.id) || settled.has(r.id)) asked += 1
    else gaps.push({ id: r.id, title: `PRD 需求沒有對應的功能：${cut(redact(r.text), 40)}` })
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

/** How many requirements a role's prompt lists; the PM reads the PRD itself for the rest. */
const LIST_MAX = 200

/** The requirements for a role's prompt, one a line, secrets masked before the text is cut. */
export const requirementList = (requirements: readonly Requirement[]): string =>
  [
    ...requirements.slice(0, LIST_MAX).map(r => `- ${r.id}${r.section === '' ? '' : `（${cut(redact(r.section), SECTION_MAX)}）`}${cut(redact(r.text), TEXT_MAX)}`),
    ...(requirements.length > LIST_MAX ? [`（還有 ${requirements.length - LIST_MAX} 條，請直接讀 PRD）`] : []),
  ].join('\n')

/** The requirements as the board keeps them, which is in git: secrets masked, long text cut. */
export const baselineFor = (requirements: readonly Requirement[]): Requirement[] =>
  requirements.map(r => ({ id: r.id, text: cut(redact(r.text), TEXT_MAX), section: cut(redact(r.section), SECTION_MAX) }))

/** The most requirements crew reads back from a board: a PRD with more is refused at start. */
export const MAX_REQUIREMENTS = 1_000

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

type Earlier = { path: string; ids: string[]; features?: string[] }

/**
 * The PRDs crew worked on before `path`, as the board keeps them: a new PRD
 * moves the one before it there, with the ids of its requirements, so that
 * PRD's features stay its own and do not count against the new one. A board
 * from before crew numbered requirements names no PRD: when crew knows it
 * worked on another one (`previous`), that PRD keeps the board's unnumbered
 * features.
 */
export const earlierFor = (board: Tracker, path: string, previous?: string): { earlier?: Earlier[] } => {
  const kept = (board as { crew_prd?: { path?: unknown; earlier?: unknown } }).crew_prd
  if (kept === undefined) {
    const unnumbered = board.prd_items.filter(i => i.crew_dropped === undefined && refsOf(i).length === 0).map(i => i.id)
    return previous === undefined || previous === path || unnumbered.length === 0 ? {} : { earlier: [{ path: previous, ids: [], features: unnumbered }] }
  }
  const before = (Array.isArray(kept.earlier) ? kept.earlier : []).flatMap((e): Earlier[] => {
    const v = e as { path?: unknown; ids?: unknown; features?: unknown } | null
    if (typeof v?.path !== 'string' || !Array.isArray(v.ids) || v.path === path || v.path === kept.path) return []
    const features = Array.isArray(v.features) ? v.features.filter((i): i is string => typeof i === 'string') : []
    return [{ path: v.path, ids: v.ids.filter((i): i is string => typeof i === 'string' && REQUIREMENT_ID.test(i)), ...(features.length > 0 ? { features } : {}) }]
  })
  const moved = typeof kept.path === 'string' && kept.path !== path ? [{ path: kept.path, ids: baselineOf(board).map(r => r.id) }] : []
  const earlier = [...before, ...moved].slice(-EARLIER_MAX)
  return earlier.length === 0 ? {} : { earlier }
}
