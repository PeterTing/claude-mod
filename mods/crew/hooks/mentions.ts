/**
 * What a question to the person names, written out: the board's items, the
 * PRD's requirements and the team's memories by their numbers, and a code the
 * PRD numbers itself (a requirement R03, a ticket P0-04) by the line of the
 * PRD that holds it. The person reads them under the question, with no need
 * to open the PRD or the board. Pure.
 */

import { criteriaOf, designsOf, tasksOf } from './board'
import type { Tracker } from './board'
import { redact } from './memory'
import { COUNT_WORD, cut, goneWords } from './prd'
import type { Requirement } from './prd'

/** A number the question names, what kind of thing it is, and its text. */
export type Mention = { id: string; kind: string; text: string }

/** At most this many, each this long: the question stays the main thing. */
export const MENTIONS_MAX = 8
const TEXT_MAX = 300

/** Whether the board holds an item by this number: a feature, a criterion, a design, a task or a test case. */
export const onBoard = (board: Tracker | null, id: string): boolean => known({ board, requirements: [], memories: [], prd: '' }).has(id)

/** What crew knows to write out: the board, the PRD's requirements as the board keeps them, the memories and the PRD itself. */
export type MentionSources = {
  board: Tracker | null
  requirements: readonly Requirement[]
  memories: readonly { id: string; text: string; supersededBy?: string }[]
  prd: string
}

/**
 * A code as it stands in running text, whole: a dash and the like on either
 * side make it part of something else, and a file name (docs/R03.md) is not
 * one. A criterion with no number of its own is its feature's with #n.
 */
const CODE = /(?<![A-Za-z0-9_.-])[A-Za-z][A-Za-z0-9_]{0,15}(?:-[0-9A-Za-z]{1,8})?(?:#\d+)?(?![A-Za-z0-9_-]|#\d)(?!\.[A-Za-z0-9])/g

/** Numbers that are not about the PRD: the person's own questions, and what they asked a role. */
const NOT_ABOUT = /^(?:Q|ASK)-\d+$/

const squeeze = (text: string): string => text.replace(/\s+/g, ' ').trim()

const out = (id: string, kind: string, text: string): Mention => ({ id, kind, text: cut(squeeze(redact(text)), TEXT_MAX) })

/** Every number the board, the requirements and the memories hold, and what each says. */
const known = (s: MentionSources): Map<string, Mention> => {
  const found = new Map<string, Mention>()
  const add = (id: string, kind: string, text: string, dropped?: unknown) => {
    if (id !== '' && !found.has(id)) found.set(id, out(id, kind, typeof dropped === 'string' ? `${text}（已移出：${dropped}）` : text))
  }
  for (const item of s.board?.prd_items ?? []) {
    add(item.id, '功能', item.title, item.crew_dropped)
    for (const c of criteriaOf(item)) add(c.id, '驗收條件', c.text)
    for (const d of designsOf(item)) add(d.id, '設計稿', d.title, d.crew_dropped)
    for (const t of tasksOf(item)) add(t.id, '任務', t.title, t.crew_dropped)
    for (const c of Array.isArray(item.test_cases) ? item.test_cases : []) {
      if (typeof c?.id === 'string') add(c.id, '測試', typeof c.title === 'string' && c.title !== '' ? c.title : typeof c.expected === 'string' ? c.expected : '')
    }
  }
  for (const r of s.requirements) {
    const text = r.section === '' ? r.text : `${r.text}（PRD「${r.section}」）`
    add(r.id, r.label === undefined ? 'PRD 需求' : `PRD 需求 ${r.label}`, r.gone === true ? `${text}（${goneWords(r)}）` : text)
  }
  for (const m of s.memories) add(m.id, '團隊記憶', m.supersededBy === undefined ? m.text : `${m.text}（已被 ${m.supersededBy} 取代）`)
  return found
}

/** What the PRD writes before a line's own words: a heading's hashes, a list's marker, a table's bar, bold. */
const LEAD = /^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|\|\s*)?(?:\*\*)?/

/** A line's own words: without its lead, bold, and a table's bars. */
const wordsOf = (text: string): string =>
  text
    .replace(/\*\*/g, '')
    .replace(/\s*\|\s*/g, '｜')
    .replace(/^[\s:：｜.、)-]+|[\s｜]+$/g, '')

/** Where a code stands first, whole: a dash, a letter or a sub-number (R20.1) after it makes it part of another. */
const startsWith = (rest: string, code: string): boolean => rest.startsWith(code) && !/^(?:[A-Za-z0-9_#-]|\.[A-Za-z0-9])/.test(rest.slice(code.length))

/** Whether a line starts with another code of the same kind as this one: R08 after R07, P0-05 after P0-04. */
const anotherOf = (own: string, code: string): boolean => {
  const kind = /^[A-Za-z]+/.exec(code)?.[0] ?? ''
  const other = new RegExp(`^${kind}[0-9_-]`).test(own) ? (own.match(CODE) ?? [])[0] : undefined
  return other !== undefined && other !== code && startsWith(own, other)
}

/**
 * The PRD's line that names a code first thing, as a heading, a list item or
 * a table row does where the PRD defines it; a line that only mentions it is
 * not where it is said what it is. A code with nothing after it takes the next
 * line, unless that line is a heading, a table row, a code fence or another
 * code's, which say what something else is: then the PRD is read on, as a
 * contents list names a code before the section that defines it.
 */
const definedIn = (lines: readonly string[], code: string): string | undefined => {
  for (const [i, line] of lines.entries()) {
    const rest = line.replace(LEAD, '')
    if (!startsWith(rest, code)) continue
    const words = wordsOf(rest.slice(code.length))
    if (words !== '') return words
    const next = lines.slice(i + 1).find(l => l.trim() !== '')
    if (next === undefined || /^\s*(?:[#|]|```)/.test(next)) continue
    const own = next.replace(LEAD, '')
    if (anotherOf(own, code)) continue
    const said = wordsOf(own)
    if (said !== '') return said
  }
  return undefined
}

/**
 * Where a text names a requirement by the PRD's number for it, as crew writes
 * it (需求 2.3, 需求 2.3（帳號）, 需求 FR-1): the requirement's id at each
 * place. A longer number is matched first, so 需求 2.3（帳號） is not read as
 * 需求 2.3; 需求 2.3 is not 需求 2.31 nor 需求 2.3.1.
 */
const byNumber = (text: string, requirements: readonly Requirement[]): { at: number; end: number; id: string }[] => {
  const numbered = requirements.filter((r): r is Requirement & { label: string } => r.label !== undefined && r.gone !== true).sort((a, b) => b.label.length - a.label.length)
  const taken: [number, number][] = []
  const found: { at: number; end: number; id: string }[] = []
  for (const r of numbered) {
    const label = r.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // A whole number with a count after it is the count: 需求 1 天內 is not requirement 1.
    const count = /^\d+$/.test(r.label) ? `(?!\\s*${COUNT_WORD})` : ''
    for (const m of text.matchAll(new RegExp(`需求\\s*${label}(?![0-9A-Za-z_]|[.-][0-9A-Za-z])${count}`, 'g'))) {
      const at = m.index ?? 0
      const end = at + m[0].length
      if (taken.some(([s, e]) => at < e && end > s)) continue
      taken.push([at, end])
      found.push({ at, end, id: r.id })
    }
  }
  return found
}

/**
 * The numbers a question names, in the order it names them, each written out:
 * the board's, the requirements' and the memories' by what they hold, a code
 * of the PRD's own by its line. `except` is the item the question is about,
 * which the person sees already; a code crew cannot find is left out.
 */
export const mentionsOf = (text: string, s: MentionSources, except?: string): Mention[] => {
  const board = known(s)
  const lines = s.prd.split('\n')
  const seen = new Set<string>(except === undefined ? [] : [except])
  const found: Mention[] = []
  // Requirements named by the PRD's number for them, and codes as written outside those, in the text's order: 需求 FR-1 is the requirement, not FR-1's line.
  const numbers = byNumber(text, s.requirements)
  // A requirement's own id written bare (FR-1) is that requirement, so it is written out once.
  const ownIds = new Map(s.requirements.flatMap(r => (r.labelFrom === 'own' && r.label !== undefined && r.gone !== true ? [[r.label, r.id] as const] : [])))
  const codes = [...text.matchAll(CODE)].map(m => ({ at: m.index ?? 0, id: ownIds.get(m[0]) ?? m[0] })).filter(c => !numbers.some(n => c.at >= n.at && c.at < n.end))
  const named = [...codes, ...numbers].sort((a, b) => a.at - b.at)
  for (const { id: code } of named) {
    if (found.length >= MENTIONS_MAX) break
    if (seen.has(code) || NOT_ABOUT.test(code)) continue
    seen.add(code)
    const hit = board.get(code)
    if (hit !== undefined) {
      found.push(hit)
      continue
    }
    // A code of the PRD's own has a capital and a digit; a word like admin is no code.
    if (!/^[A-Z]/.test(code) || !/\d/.test(code)) continue
    const line = definedIn(lines, code)
    if (line !== undefined) found.push(out(code, 'PRD 原文', line))
  }
  return found
}
