/**
 * The PRD as crew checks the board against it: each list item (or table row,
 * or paragraph when the PRD has no lists) is a requirement with an id made
 * from its words, so the id stays while other lines change and changes when
 * its own words do. G0 holds the board to the PRD as it stands now. Pure.
 */

import type { PrdItem, Tracker } from './board'

export type Requirement = { id: string; text: string; section: string }

/** FNV-1a over the UTF-16 code units: a stable, short fingerprint, not a secret. */
const fingerprint = (text: string): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0').slice(0, 6)
}

const LIST = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*\S)\s*$/
const HEADING = /^\s*#{1,6}\s+(.*\S)\s*$/
const FENCE = /^\s*(```|~~~)/
const ROW = /^\s*\|(.*)\|\s*$/
const DIVIDER = /^\s*\|?\s*:?-{3,}/

const squeeze = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** The PRD's requirements, in order, once each. */
export const requirementsOf = (markdown: string): Requirement[] => {
  const items: { text: string; section: string }[] = []
  const paragraphs: { text: string; section: string }[] = []
  let section = ''
  let inCode = false
  let paragraph: string[] = []
  const endParagraph = () => {
    if (paragraph.length > 0) paragraphs.push({ text: squeeze(paragraph.join(' ')), section })
    paragraph = []
  }
  for (const line of markdown.split('\n')) {
    if (FENCE.test(line)) {
      endParagraph()
      inCode = !inCode
      continue
    }
    if (inCode) continue
    const heading = HEADING.exec(line)
    if (heading !== null) {
      endParagraph()
      section = squeeze(heading[1] ?? '')
      continue
    }
    const item = LIST.exec(line)
    if (item !== null) {
      endParagraph()
      items.push({ text: squeeze(item[1] ?? ''), section })
      continue
    }
    const row = ROW.exec(line)
    if (row !== null) {
      endParagraph()
      if (!DIVIDER.test(line)) items.push({ text: (row[1] ?? '').split('|').map(squeeze).join(' | '), section })
      continue
    }
    if (line.trim() === '') {
      endParagraph()
      continue
    }
    paragraph.push(line)
  }
  endParagraph()
  // A table's first row is its header: keep data rows only.
  const kept = dropTableHeaders(markdown, items)
  const chosen = kept.length > 0 ? kept : paragraphs
  const seen = new Set<string>()
  const out: Requirement[] = []
  for (const r of chosen) {
    if (r.text === '') continue
    const id = `R-${fingerprint(r.text)}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ id, text: r.text, section: r.section })
  }
  return out
}

/** List items and table data rows: a table row followed by a divider is its header, not a requirement. */
const dropTableHeaders = (markdown: string, items: readonly { text: string; section: string }[]): { text: string; section: string }[] => {
  const headers = new Set<string>()
  const lines = markdown.split('\n')
  lines.forEach((line, i) => {
    const row = ROW.exec(line)
    const nextLine = lines[i + 1] ?? ''
    if (row !== null && !DIVIDER.test(line) && DIVIDER.test(nextLine)) headers.add((row[1] ?? '').split('|').map(squeeze).join(' | '))
  })
  return items.filter(i => !headers.has(i.text))
}

export type G0 = { covered: number; total: number; gaps: { id: string; title: string }[] }

const cut = (text: string, max: number): string => ([...text].length > max ? `${[...text].slice(0, max).join('')}…` : text)

const refsOf = (item: PrdItem): string[] =>
  Array.isArray(item.source_refs) ? (item.source_refs as unknown[]).filter((r): r is string => typeof r === 'string' && /^R-[0-9a-f]{6}$/.test(r)) : []

/**
 * G0: the board answers the PRD as it stands. Each requirement has a feature
 * (or a decision that moved it out of scope), and each feature in scope traces
 * to a requirement still in the PRD.
 */
export const gateG0 = (board: Tracker, requirements: readonly Requirement[]): G0 => {
  const current = new Set(requirements.map(r => r.id))
  const features = board.prd_items.filter(i => i.crew_dropped === undefined)
  const answered = new Set(features.flatMap(refsOf))
  const settled = new Set(
    (board.decisions ?? []).flatMap(d => {
      const reqs = (d as { requirements?: unknown }).requirements
      return Array.isArray(reqs) ? reqs.filter((r): r is string => typeof r === 'string') : []
    }),
  )
  const gaps: G0['gaps'] = []
  let covered = 0
  for (const r of requirements) {
    if (answered.has(r.id) || settled.has(r.id)) covered += 1
    else gaps.push({ id: r.id, title: `PRD 需求沒有對應的功能：${cut(r.text, 40)}` })
  }
  for (const f of features) {
    const refs = refsOf(f)
    if (refs.some(r => current.has(r))) covered += 1
    else gaps.push({ id: f.id, title: refs.length === 0 ? `功能沒有對應的 PRD 需求：${f.title}` : `功能對應的 PRD 需求已經不在 PRD 裡：${f.title}` })
  }
  return { covered, total: requirements.length + features.length, gaps }
}

/** What the PRD added and removed since the requirements crew last synced to. */
export const diffRequirements = (before: readonly Requirement[], now: readonly Requirement[]): { added: Requirement[]; removed: Requirement[] } => {
  const old = new Set(before.map(r => r.id))
  const fresh = new Set(now.map(r => r.id))
  return { added: now.filter(r => !old.has(r.id)), removed: before.filter(r => !fresh.has(r.id)) }
}

/** The requirements for a role's prompt, one a line. */
export const requirementList = (requirements: readonly Requirement[]): string =>
  requirements.map(r => `- ${r.id}${r.section === '' ? '' : `（${r.section}）`}${r.text}`).join('\n')
