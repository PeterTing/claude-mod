/**
 * The PRD as crew checks the board against it: each list item (or table row,
 * or paragraph when the PRD has no lists) is a requirement with an id made
 * from its words, so the id stays while other lines change and changes when
 * its own words do. G0 holds the board to the PRD as it stands now. Pure.
 */

import type { PrdItem, Tracker } from './board'
import { redact } from './memory'

/**
 * A requirement of the PRD. `section`, the headings it is under, the
 * document's title left out; `label`, its number as the PRD gives it;
 * `labelFrom`, where that number comes from: the PRD's own id for it, a
 * numbered list's numbers, its place where the list has no numbers, or its
 * place where the list's numbers repeat or have gaps; `labelUnder`, what the
 * number goes on from: a numbered heading's, or the item it is nested in.
 * `gone`: one the board still holds that the PRD as it stands no longer has,
 * with the number it had (`was`) and none of its own now.
 */
export type Requirement = { id: string; text: string; section: string; label?: string; labelFrom?: LabelFrom; labelUnder?: LabelUnder; gone?: true; was?: string }

export type LabelFrom = 'own' | 'list' | 'place' | 'recount'

export type LabelUnder = 'heading' | 'item'

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

/**
 * A requirement's words as the person reads them, without the PRD's markdown:
 * bold, inline code and a link's address. Shown only: the requirement's number
 * stays the fingerprint of the text as the PRD writes it.
 */
export const plainOf = (text: string): string =>
  text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')

/** A requirement's first words, for a table's row: the bold words it opens with, or its first sentence. */
export const headlineOf = (text: string): string => {
  const lead = /^\s*\*\*([^*]+)\*\*/.exec(text)?.[1]
  const plain = plainOf(lead ?? text).trim()
  return cut(/^.*?(?:[。！？；]|[.!?;](?=\s))/.exec(plain)?.[0] ?? plain, 80)
}

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

/**
 * A run of the PRD's text that may be a requirement. `path`, the headings it is
 * under; `scope`, the number of the nearest numbered one, and `scopeKey`, which
 * heading that is ('doc' with none); `parent`, the list item it is nested in.
 */
type Block = {
  text: string
  section: number
  title: string
  path: string
  scope?: string
  scopeKey: string
  list: boolean
  intro: boolean
  n?: number
  table?: true
  /** A table row's: its table's first header cell, which says what the first column holds. */
  head?: string
  /** A table row's: the line its table starts on, which tells one table from the next. */
  tableAt?: number
  parent?: Block
}

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
  /** The headings the text is under, outermost first. */
  const heads: { level: number; title: string; number?: string; at: number }[] = []
  /** The list items a nested item may be under: their indents, outermost first. */
  let nest: { indent: number; block: Block }[] = []
  /** Where a block stands: the headings over it, the document's title left out, and the nearest numbered one. */
  const where = (): Pick<Block, 'path' | 'scope' | 'scopeKey'> => {
    const over = heads.filter(h => !(h.at === intro && h.level === 1))
    // The document's title (# 2.0 訂閱改版) numbers the document, not its sections.
    const numbered = [...over].reverse().find(h => h.number !== undefined)
    return {
      path: over.length > 0 ? over.map(h => h.title).join(' › ') : (heads[0]?.title ?? ''),
      ...(numbered === undefined ? { scopeKey: 'doc' } : { scope: numbered.number, scopeKey: `h${numbered.at}` }),
    }
  }
  let i = 0
  if ((lines[0] ?? '').trim() === '---') {
    const close = lines.findIndex((l, n) => n > 0 && (l.trim() === '---' || l.trim() === '...'))
    // Front matter is YAML: key: value lines, with indented lines under a key; anything else makes the first line a rule.
    const body = lines.slice(1, close)
    if (close > 0 && body.some(l => FRONT_FIELD.test(l)) && body.every(l => l.trim() === '' || FRONT_FIELD.test(l) || /^\s/.test(l))) i = close + 1
  }
  const marked: { at: number; level: number; plain: string }[] = []
  {
    let inFence: { char: string; length: number } | undefined
    let inComment = false
    for (let k = i; k < lines.length; k++) {
      const line = (lines[k] ?? '').trim()
      if (inFence !== undefined) {
        const close = FENCE.exec(line)
        if (close !== null && close[1]?.[0] === inFence.char && (close[1]?.length ?? 0) >= inFence.length && line.slice(close[0].length).trim() === '') inFence = undefined
        continue
      }
      if (inComment) {
        if (line.includes('-->')) inComment = false
        continue
      }
      if (line.startsWith('<!--')) {
        inComment = !line.includes('-->')
        continue
      }
      const opening = FENCE.exec(line)
      if (opening !== null) {
        inFence = { char: opening[1]?.[0] ?? '`', length: opening[1]?.length ?? 3 }
        continue
      }
      if (HEADING_MARK.test(line)) marked.push({ at: k, level: line.length - line.replace(/^#+/, '').length, plain: headingPlain(squeeze(line.replace(/^#+/, '').replace(/\s#+$/, ''))) })
    }
  }
  const numbers = headingNumbers(marked)
  for (; i < lines.length; i++) {
    const raw = lines[i] ?? ''
    const line = raw.trim()
    // Inside code, a comment's mark is code too.
    if (fence !== undefined) {
      // A fence closes only with the same mark, at least as long, and nothing after it.
      const close = FENCE.exec(line)
      if (close !== null && close[1]?.[0] === fence.char && (close[1]?.length ?? 0) >= fence.length && line.slice(close[0].length).trim() === '') fence = undefined
      continue
    }
    if (comment) {
      if (line.includes('-->')) comment = false
      continue
    }
    if (line.startsWith('<!--')) {
      comment = !line.includes('-->')
      open = undefined
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
    const heading = (level: number, text: string, at?: number) => {
      section += 1
      headings += 1
      if (headings === 1 && level === 1) intro = section
      title = text
      open = undefined
      gap = false
      nest = []
      while ((heads.at(-1)?.level ?? 0) >= level) heads.pop()
      const plain = headingPlain(text)
      // A heading written with # is told against its siblings; one underlined, alone.
      const number = at !== undefined && numbers.has(at) ? numbers.get(at) : headingNumber(plain)
      heads.push({ level, title: plain, at: section, ...(number === undefined ? {} : { number }) })
    }
    if (HEADING_MARK.test(line)) {
      heading(line.length - line.replace(/^#+/, '').length, squeeze(line.replace(/^#+/, '').replace(/\s#+$/, '')), i)
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
      nest = []
      continue
    }
    if (BREAK.test(line)) {
      open = undefined
      gap = false
      nest = []
      continue
    }
    const mark = ITEM_MARK.exec(line)
    if (mark !== null) {
      const rest = line.slice(mark[0].length)
      const text = squeeze(rest.replace(TASK_BOX, ''))
      const n = /^\d+/.exec(mark[0])?.[0]
      // Nested under the nearest item indented less.
      const indent = indentOf(raw)
      while ((nest.at(-1)?.indent ?? -1) >= indent) nest.pop()
      const parent = nest.at(-1)?.block
      open = { text, section, title, ...where(), list: true, intro: section === intro, ...(n === undefined ? {} : { n: Number(n) }), ...(parent === undefined ? {} : { parent }) }
      nest.push({ indent, block: open })
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
      nest = []
      // The table's header is its first row, with a divider under it.
      let top = i
      while (top > 0 && cellsOf((lines[top - 1] ?? '').trim()) !== undefined) top--
      const header = top < i ? cellsOf((lines[top] ?? '').trim()) : undefined
      const head = header !== undefined && isDivider(cellsOf((lines[top + 1] ?? '').trim()) ?? []) ? header[0]?.replace(/[*_\x60]/g, '').trim() : undefined
      blocks.push({ text: cells.join(' | '), section, title, ...where(), list: true, intro: section === intro, table: true, tableAt: top, ...(head === undefined || head === '' ? {} : { head }) })
      continue
    }
    const indented = /^(?: {2,}|\t)/.test(raw)
    if (open !== undefined && (!gap || (open.list && indented))) {
      open.text = join(open.text, squeeze(line))
      gap = false
      continue
    }
    nest = []
    open = { text: squeeze(line), section, title, ...where(), list: false, intro: section === intro }
    blocks.push(open)
    gap = false
  }
  const kept = blocks.filter(b => b.text !== '' && !BARE.test(b.text) && !CONTEXT.test(b.title) && !(HISTORY.test(b.title) && DATED.test(b.text)))
  const listed = new Set(kept.filter(b => b.list).map(b => b.section))
  const chosen = kept.filter(b => b.list || (!listed.has(b.section) && !/[:：]$/.test(b.text)))
  const beyond = chosen.some(b => !b.intro)
  const seen = new Map<string, string>()
  const out: Requirement[] = []
  const placed: Block[] = []
  for (const b of chosen) {
    if (b.intro && !b.list && beyond) continue
    const key = b.text.replace(/\s+/g, '')
    let id = `R-${fingerprint(key)}`
    // Two different texts with one fingerprint: the later one takes the next free salted fingerprint.
    for (let salt = 1; seen.has(id) && seen.get(id) !== key; salt++) id = `R-${fingerprint(`${key}\u0000${salt}`)}`
    if (seen.has(id)) continue
    seen.set(id, key)
    out.push({ id, text: cut(b.text, TEXT_KEPT), section: cut(b.path, TEXT_KEPT) })
    placed.push(b)
  }
  return withLabels(out, placed)
}

/** How far a list item is indented: a tab is four spaces. */
const indentOf = (raw: string): number => [.../^[ \t]*/.exec(raw)?.[0] ?? ''].reduce((n, c) => n + (c === '\t' ? 4 : 1), 0)

/** A heading's words without the PRD's markdown: bold, italics, strikes, code and a link's address. */
const headingPlain = (text: string): string =>
  squeeze(
    plainOf(text)
      .replace(/~~/g, '')
      .replace(/(^|[\s(（])[*_]+(?=\S)/g, '$1')
      .replace(/(\S)[*_]+(?=$|[\s)）:：,，.。、])/g, '$1'),
  )

const CHINESE_DIGITS = '一二三四五六七八九'

/** 一 to 九十九 as a number; anything else, none. */
const chineseNumber = (s: string): number | undefined => {
  const digit = (c: string) => CHINESE_DIGITS.indexOf(c) + 1
  if (!s.includes('十')) return s.length === 1 && digit(s) > 0 ? digit(s) : undefined
  const [tens = '', ones = ''] = s.split('十')
  if (s.split('十').length > 2 || tens.length > 1 || ones.length > 1) return undefined
  const n = (tens === '' ? 1 : digit(tens)) * 10 + (ones === '' ? 0 : digit(ones))
  return (tens !== '' && digit(tens) === 0) || (ones !== '' && digit(ones) === 0) ? undefined : n
}

/**
 * A heading's own number: 2. 退款, 2.1 退款, 3、範圍, 二、功能需求, 第三章, and
 * 2 人氣排行 or 2.1頁面規格 with nothing after the number to say so. A year
 * (2024 年) is no number. A number with nothing after it is a section's when a
 * heading beside it goes on from it (## 1 帳號, ## 2 人氣排行, ## 3 結帳); alone,
 * it is one unless a count follows a whole number (3個角色, 10 分鐘內) or a share a
 * dotted one (1.5 倍). A count is told by its whole word, so 7 個人資料, 3 年繳方案
 * and 5 元件 are headings.
 */
export const COUNT_WORD = String.raw`(?:個(?!人|資|案|別|性)|位(?!置|址|元)|次(?!要|序|數)|分鐘|秒(?!殺|數)|小時|天(?!氣|數|使)|週(?!報|年|末|期|邊)|個月|年(?!度|費|繳|齡|終|資|報|票|卡|會)|倍(?!速|率|數)|歲(?!末)|千(?!人|分)|萬(?!用|能)|億|元(?!件|素|旦|宇|資|數)|筆(?!記|電)|張(?!貼)|星(?!球|期|級|座)|％|%)`
const SHARE_WORD = String.raw`(?:倍(?!速|率|數)|％|%)`
const ARABIC_NUMBER = /^(?:(\d{1,3}(?:\.\d{1,3})+)|(\d{1,3}))(?:([.、．)）])(?!\d)\s*|\s+|(?=[^\x00-\x7f]))/
const CHINESE_NUMBER = /^第?([一二三四五六七八九十]{1,3})(?:[、.．)）]|\s*[章節部]|\s+)/

/** A heading's number as written: `sure` with a mark after it (2. 退款) or in Chinese; `count` where a count's or a share's word follows. */
type HeadingNumber = { number: string; sure: boolean; count: boolean }

const numberParts = (plain: string): HeadingNumber | undefined => {
  const m = ARABIC_NUMBER.exec(plain)
  if (m !== null) {
    const dotted = m[1]
    const number = dotted ?? m[2] ?? ''
    if (m[3] !== undefined) return { number, sure: true, count: false }
    return { number, sure: false, count: new RegExp(`^${dotted === undefined ? COUNT_WORD : SHARE_WORD}`).test(plain.slice(m[0].length)) }
  }
  const chinese = CHINESE_NUMBER.exec(plain)?.[1]
  const n = chinese === undefined ? undefined : chineseNumber(chinese)
  return n === undefined ? undefined : { number: String(n), sure: true, count: false }
}

/** Two numbers one after the other at the same depth: 2 and 3, 2.1 and 2.2. */
const follows = (a: string, b: string): boolean => {
  const x = a.split('.')
  const y = b.split('.')
  return x.length === y.length && x.slice(0, -1).join('.') === y.slice(0, -1).join('.') && Math.abs(Number(x.at(-1)) - Number(y.at(-1))) === 1
}

/** A heading's number, alone: one with nothing after it counts unless a count follows. */
const headingNumber = (plain: string): string | undefined => {
  const n = numberParts(plain)
  return n === undefined || (!n.sure && n.count) ? undefined : n.number
}

/**
 * The numbers of the headings written with #, by the line each is on, each
 * told against its siblings', the headings at its level under the same one:
 * a number with nothing after it is a section's when a sibling's goes on from
 * it or before it, whatever follows it.
 */
const headingNumbers = (heads: readonly { at: number; level: number; plain: string }[]): Map<number, string | undefined> => {
  const parts = heads.map(h => numberParts(h.plain))
  const parent = heads.map((h, i) => {
    for (let j = i - 1; j >= 0; j--) if ((heads[j]?.level ?? 0) < h.level) return j
    return -1
  })
  return new Map(
    heads.map((h, i) => {
      const n = parts[i]
      if (n === undefined || n.sure || !n.count) return [h.at, n?.number]
      // Two counts beside each other (1 年方案, 2 年方案) vouch for neither: only a sibling that is a number by itself does.
      const beside = heads.some((o, j) => {
        const m = parts[j]
        return j !== i && o.level === h.level && parent[j] === parent[i] && m !== undefined && (m.sure || !m.count) && follows(m.number, n.number)
      })
      return [h.at, beside ? n.number : undefined]
    }),
  )
}

const ID_CORE = String.raw`[A-Za-z]{1,6}[-_]?\d+(?:[.-]\d+)*[a-z]?`
/** An id with a separator, as an id is written: FR-03, US_4, REQ-12. */
const STRICT_ID = /^[A-Za-z]{1,6}[-_]\d+(?:[.-]\d+)*[a-z]?$/
/** A requirement's own id at its start, as the PRD writes it: R1：, FR-03 —, [REQ-12], **US-4**, `A-1`. */
const OWN_ID = new RegExp(String.raw`^(?:\[(${ID_CORE})\]|\*\*(${ID_CORE})\*\*|\x60(${ID_CORE})\x60|(${ID_CORE})(?=\s*[:：、]|\s+[-–—]\s))`)
/** A number the PRD gives a row: 2.3, or 2.3.1. */
const DOTTED = /^\d{1,3}(?:\.\d{1,3})+$/
/** A first column that holds the requirements' numbers, by its header. */
const ID_HEAD = /^(?:#|[Nn][Oo]\.?|.{0,6}(?:編號|代號|序號|項次)|(?:.{0,20}[\s_-]|[^\x00-\x7f]{0,6})?(?:ID|Id|[Rr]ef|REF|[Kk]ey|KEY))$/
/** A first column that holds something else: a version, a date, a stage. */
const OTHER_HEAD = /版本|version|release|日期|date|時間|里程碑|milestone|sprint|階段|phase|週次|week|月份|季度/i

/** A cell without the bold or code marks around it: **FR-1** is FR-1. */
const plainCell = (cell: string): string => cell.replace(/^(\*\*|__|\x60)(.+)\1$/, '$2')
const firstCell = (b: Block): string => plainCell(b.text.split(' | ')[0] ?? '')

/**
 * Whether a table's first cells are the PRD's numbers for its rows, one answer
 * for the whole column. Its dotted ones (1.1): as its header says, else when
 * each goes on from the heading over it (3.1 under ## 3.), or when no heading
 * over it has a number to go on from. Its whole ones too where dotted ones are
 * among them (1, 1.1, 1.2, 2).
 */
const columnOf = (rows: readonly Block[]): { dotted: boolean; whole: boolean } => {
  const head = rows[0]?.head
  const dotted =
    head !== undefined && OTHER_HEAD.test(head)
      ? false
      : (head !== undefined && ID_HEAD.test(head)) || rows.every(r => !DOTTED.test(firstCell(r)) || r.scope === undefined || firstCell(r).startsWith(`${r.scope}.`))
  return { dotted, whole: dotted && rows.some(r => DOTTED.test(firstCell(r))) }
}

/** A dotted number an item starts with (- 2.1 登入), and what follows it. */
const LEADING_DOTTED = /^(\d{1,3}(?:\.\d{1,3})+)(?:[.、．)）]?\s+|(?=[^\x00-\x7f]))/
/** What after a dotted number makes it a size, not an item's number: 2.5 GB, 1.5 s, 2.4 GHz. */
const SIZE_UNIT = /^(?:[KMGT]?B|[KMGT]b|ms|s|px|x|%|[KMG]?Hz)(?![A-Za-z])/i
/** What after a dotted number makes it a version or a measure in Chinese: 3.0 版, 5.0 吋, 1.5 公里. */
const MEASURE_WORD = /^(?:版|吋|寸|公[分里斤尺]|度)/

/**
 * The id a requirement's own words start with, or a table row's: its first
 * cell, else a cell that is an id with a separator. `loose`: an id with no
 * separator nor brackets (R1, P0, H5, OAuth2), which counts only as one of a
 * series in its section. `cited`: an id in a row's other cell, as a
 * 對應需求 column cites one, which is the row's only where no other has it.
 * `leading`: a dotted number an item starts with where no heading over it has
 * a number, which counts only where another beside it starts with one too.
 */
type Candidate = { id: string; loose: boolean; cited?: true; leading?: true }

const ownCandidate = (b: Block, column: { dotted: boolean; whole: boolean }): Candidate | undefined => {
  if (b.table === true) {
    const cells = b.text.split(' | ').map(plainCell)
    const first = cells[0] ?? ''
    // 1.1 in a version table is the version, not the row's number.
    if (STRICT_ID.test(first) || (column.dotted && DOTTED.test(first)) || (column.whole && /^\d{1,3}$/.test(first))) return { id: first, loose: false }
    if (new RegExp(`^${ID_CORE}$`).test(first)) return { id: first, loose: true }
    const other = cells.slice(1).find(c => STRICT_ID.test(c))
    return other === undefined ? undefined : { id: other, loose: false, cited: true }
  }
  const m = OWN_ID.exec(b.text)
  if (m === null) {
    // A dotted number it starts with, as a table's first cell: where it goes on from the heading over it, or no heading over it has one.
    const d = LEADING_DOTTED.exec(b.text)
    const id = d?.[1]
    if (d === null || id === undefined) return undefined
    const rest = b.text.slice(d[0].length)
    if (new RegExp(`^(?:${SHARE_WORD}|${COUNT_WORD})`).test(rest) || SIZE_UNIT.test(rest) || MEASURE_WORD.test(rest)) return undefined
    if (b.scope === undefined) return { id, loose: false, leading: true }
    return id.startsWith(`${b.scope}.`) ? { id, loose: false } : undefined
  }
  const wrapped = m[1] ?? m[2] ?? m[3]
  if (wrapped !== undefined) return { id: wrapped, loose: false }
  const bare = m[4] ?? ''
  return { id: bare, loose: !STRICT_ID.test(bare) }
}

/** A list item's number, or a table row's first cell when it is a whole number. */
const numberOf = (b: Block): number | undefined => {
  if (b.table !== true) return b.n
  const first = b.text.split(' | ')[0] ?? ''
  return /^\d{1,4}$/.test(first) ? Number(first) : undefined
}

const letters = (id: string): string => /^[A-Za-z]+/.exec(id)?.[0]?.toUpperCase() ?? ''

/** A loose word that is a priority (P0) or a version (v2), not an id, however many there are. */
const NOT_AN_ID = /^(?:P[0-4]|v\d+)$/i

/**
 * Each requirement's number as the PRD gives it, different for each:
 * - its own id, if it starts with one no other requirement has (one with no
 *   separator only as one of a series in its section: R1, R2);
 * - else its place: a numbered list keeps its numbers where they are all
 *   different, otherwise items are counted; counted under the nearest
 *   numbered heading, after its number (2.3), or through the PRD where no
 *   heading over it has one; a nested item after its parent's (2.3.1).
 * Where two still share a number, the one most like the PRD's own numbering
 * keeps it (its own id, then one under a numbered heading); where none is more
 * like it, none keeps it. The others take their section's name, then their place.
 */
const withLabels = (out: Requirement[], placed: readonly Block[]): Requirement[] => {
  const index = new Map(placed.map((b, i) => [b, i]))
  // A parent crew does not list (it was the same words as another) is skipped for its own.
  const parentOf = (b: Block): Block | undefined => {
    let p = b.parent
    while (p !== undefined && !index.has(p)) p = p.parent
    return p
  }
  const tables = new Map<number, Block[]>()
  for (const b of placed) if (b.tableAt !== undefined) tables.set(b.tableAt, [...(tables.get(b.tableAt) ?? []), b])
  const columns = new Map([...tables].map(([at, rows]) => [at, columnOf(rows)]))
  const found = placed.map(b => ownCandidate(b, (b.tableAt === undefined ? undefined : columns.get(b.tableAt)) ?? { dotted: false, whole: false }))
  // A dotted number with no heading number to go on from is an item's where another beside it starts with one too: 1.1 登入, 1.2 登出, not 1.5 倍速播放 alone.
  const besideOf = (b: Block) => parentOf(b) ?? b.scopeKey
  const candidates = found.map((c, i) =>
    c?.leading === true && !placed.some((o, j) => j !== i && found[j]?.leading === true && besideOf(o) === besideOf(placed[i] as Block)) ? undefined : c,
  )
  const uses = new Map<string, number>()
  for (const c of candidates) if (c !== undefined) uses.set(c.id, (uses.get(c.id) ?? 0) + 1)
  // An id with a separator two requirements start with is still the PRD's: each takes its section's name after it. One with none, or one a row cites in another cell, is an id only once.
  const unique = (c: Candidate | undefined): c is Candidate => c !== undefined && ((!c.loose && c.cited !== true) || ((uses.get(c.id) ?? 0) === 1 && !(c.loose && NOT_AN_ID.test(c.id))))
  const own = placed.map((b, i) => {
    const c = candidates[i]
    if (!unique(c)) return undefined
    if (!c.loose) return c.id
    // One of a series of its own: another in its section with the same letters, itself an id.
    const series = placed.some((o, j) => {
      const d = candidates[j]
      return j !== i && o.section === b.section && unique(d) && d.loose && letters(d.id) === letters(c.id)
    })
    return series ? c.id : undefined
  })
  // Siblings: the items under one parent, or the top-level ones under one numbered heading, or through the PRD.
  const siblings = new Map<Block | string, number[]>()
  placed.forEach((b, i) => {
    // One with its own number is not counted among the others: 1, 1.1, 備註, 1.2 counts the note alone.
    if (own[i] !== undefined) return
    const key = parentOf(b) ?? b.scopeKey
    siblings.set(key, [...(siblings.get(key) ?? []), i])
  })
  /** A list's own numbers, where they are all different; the others are counted as they are labelled. */
  const place: (string | undefined)[] = []
  const groupOf: (Block | string)[] = []
  /** How an item's place was had: its list's number, or counted where the list has none, or where its numbers repeat or skip. */
  const how: LabelFrom[] = []
  for (const [key, at] of siblings) {
    const numbers = at.map(i => numberOf(placed[i] as Block))
    const kept = numbers.every(n => n !== undefined) && new Set(numbers).size === numbers.length
    const none = numbers.every(n => n === undefined)
    at.forEach((i, k) => {
      place[i] = kept ? String(numbers[k]) : undefined
      groupOf[i] = key
      how[i] = kept ? 'list' : none ? 'place' : 'recount'
    })
  }
  /** The numbers the PRD gives at each level, which a counted one there passes over: 2.1, 備註, 2.2 counts the note 2.3. */
  const taken = new Map<Block | string, Set<string>>()
  placed.forEach((b, i) => {
    const mine = own[i]
    if (mine === undefined) return
    const key = parentOf(b) ?? b.scopeKey
    taken.set(key, (taken.get(key) ?? new Set()).add(mine))
  })
  const counted = new Map<Block | string, number>()
  const labels: string[] = []
  const from: LabelFrom[] = []
  const under: (LabelUnder | undefined)[] = []
  // In the PRD's order: a parent is labelled before its items.
  placed.forEach((b, i) => {
    const mine = own[i]
    if (mine !== undefined) {
      labels[i] = mine
      from[i] = 'own'
      return
    }
    const p = parentOf(b)
    const j = p === undefined ? undefined : index.get(p)
    const prefix = j !== undefined ? labels[j] : b.scope
    const at = (n: string) => (prefix === undefined ? n : `${prefix}.${n}`)
    let nth = place[i]
    if (nth === undefined) {
      const key = groupOf[i] ?? ''
      let n = counted.get(key) ?? 0
      do n += 1
      while (taken.get(key)?.has(at(String(n))) === true)
      counted.set(key, n)
      nth = String(n)
    }
    labels[i] = at(nth)
    from[i] = how[i] ?? 'place'
    under[i] = j !== undefined ? 'item' : b.scope === undefined ? undefined : 'heading'
  })
  // Two that still share a number: the one most like the PRD's own numbering keeps it, the others take their section's name, then their place.
  const rank = (i: number) => (from[i] === 'own' ? 2 : 0) + (under[i] === 'heading' ? 1 : 0)
  const rename = (suffix: (i: number) => string) => {
    const groups = new Map<string, number[]>()
    labels.forEach((l, i) => groups.set(l, [...(groups.get(l) ?? []), i]))
    for (const at of groups.values()) {
      if (at.length < 2) continue
      const best = Math.max(...at.map(rank))
      const keeps = at.filter(i => rank(i) === best)
      for (const i of at) if (keeps.length > 1 || i !== keeps[0]) labels[i] = `${labels[i]}${suffix(i)}`
    }
  }
  rename(i => `（${cut(headingPlain((placed[i] as Block).title), 20) || 'PRD 開頭'}）`)
  rename(i => ` #${i + 1}`)
  return out.map((r, i) =>
    labels[i] === undefined ? r : { ...r, label: labels[i], labelFrom: from[i] ?? 'place', ...(under[i] === undefined ? {} : { labelUnder: under[i] }) },
  )
}

/** A requirement's words without the id it starts with, when that id is its number: the number is shown beside them. */
export const withoutOwnId = (r: Requirement): string => {
  if (r.labelFrom !== 'own' || r.label === undefined) return r.text
  // A table row's id is a cell of its own: the row's other cells, without the bar before them.
  // The id as the PRD writes it, without the section's name crew put after it for another with the same.
  const own = r.label.replace(/ #\d+$/, '').split('（')[0] ?? r.label
  const cells = r.text.split(' | ')
  if (cells.length > 1 && cells.some(c => plainCell(c) === own)) return cells.filter(c => plainCell(c) !== own).join(' | ') || r.text
  const id = own.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rest = r.text.replace(new RegExp(String.raw`^(?:\[${id}\]|\*\*${id}\*\*|\x60${id}\x60|${id})\s*(?:[:：、.．)）]|[-–—](?=\s))?\s*`), '')
  return rest === '' ? r.text : rest
}

/** G0, with the requirements alone counted apart from the features, for progress. */
export type G0 = { covered: number; total: number; gaps: { id: string; title: string; shown?: string }[]; requirements: { covered: number; total: number } }

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

/** The features in scope that are this PRD's: those answering only an earlier PRD are that PRD's. */
export const prdFeatures = (board: Tracker, requirements: readonly Requirement[]): PrdItem[] => {
  const current = new Set(requirements.map(r => r.id))
  const earlier = earlierOf(board, 'ids')
  const theirs = earlierOf(board, 'features')
  return board.prd_items.filter(i => {
    if (i.crew_dropped !== undefined || theirs.has(i.id)) return false
    const refs = refsOf(i)
    return refs.length === 0 || refs.some(r => current.has(r)) || !refs.every(r => earlier.has(r))
  })
}

/**
 * G0: the board answers the PRD as it stands. Each requirement has a feature
 * (or a decision that moved it out of scope), and each feature in scope traces
 * to a requirement still in the PRD. Features that answer only an earlier PRD
 * are that PRD's, and left out.
 */
export const gateG0 = (board: Tracker, requirements: readonly Requirement[]): G0 => {
  const current = new Set(requirements.map(r => r.id))
  const features = prdFeatures(board, requirements)
  const answered = new Set(features.flatMap(refsOf))
  const settled = droppedRequirements(board)
  const gaps: G0['gaps'] = []
  let asked = 0
  for (const r of requirements) {
    if (answered.has(r.id) || settled.has(r.id)) asked += 1
    else gaps.push({ id: r.id, ...(r.label === undefined ? {} : { shown: `需求 ${r.label}` }), title: `PRD 需求沒有對應的功能：${cut(redact(plainOf(r.text)), 40)}` })
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
    ...requirements.slice(0, LIST_MAX).map(r => `- ${r.id}${r.label === undefined ? '' : ` 需求 ${cut(redact(r.label), LABEL_MAX)}`}${r.section === '' ? '' : `（${cut(redact(r.section), SECTION_MAX)}）`}${cut(redact(r.text), TEXT_MAX)}`),
    ...(requirements.length > LIST_MAX ? [`（還有 ${requirements.length - LIST_MAX} 條，請直接讀 PRD）`] : []),
  ].join('\n')

/** The requirements as the board keeps them, which is in git: secrets masked, long text cut. */
export const baselineFor = (requirements: readonly Requirement[]): Requirement[] =>
  requirements.map(r => ({
    id: r.id,
    text: cut(redact(r.text), TEXT_MAX),
    section: cut(redact(r.section), SECTION_MAX),
    // Its number, so the panel shows it while the PRD cannot be read.
    ...(r.label === undefined ? {} : { label: cut(redact(r.label), LABEL_MAX), labelFrom: r.labelFrom ?? 'place', ...(r.labelUnder === undefined ? {} : { labelUnder: r.labelUnder }) }),
  }))

/** The longest number the board keeps for a requirement. */
const LABEL_MAX = 40

const LABEL_FROM: readonly LabelFrom[] = ['own', 'list', 'place', 'recount']
const LABEL_UNDER: readonly LabelUnder[] = ['heading', 'item']

/** The most requirements crew reads back from a board: a PRD with more is refused at start. */
export const MAX_REQUIREMENTS = 1_000

/** The requirements the board last answered, as it keeps them: well-formed entries only, each on one line. */
export const baselineOf = (board: Tracker | null): Requirement[] => {
  const kept = (board as { crew_prd?: { requirements?: unknown } } | null)?.crew_prd?.requirements
  if (!Array.isArray(kept)) return []
  return kept.slice(0, MAX_REQUIREMENTS).flatMap((r): Requirement[] => {
    const v = r as Partial<Requirement> | null
    if (typeof v !== 'object' || v === null || typeof v.id !== 'string' || !REQUIREMENT_ID.test(v.id) || typeof v.text !== 'string') return []
    const label = typeof v.label === 'string' && v.label.trim() !== '' ? cut(squeeze(v.label), LABEL_MAX) : undefined
    return [
      {
        id: v.id,
        text: cut(squeeze(v.text), TEXT_MAX),
        section: typeof v.section === 'string' ? cut(squeeze(v.section), SECTION_MAX) : '',
        ...(label === undefined
          ? {}
          : {
              label,
              labelFrom: LABEL_FROM.includes(v.labelFrom as LabelFrom) ? (v.labelFrom as LabelFrom) : 'place',
              ...(LABEL_UNDER.includes(v.labelUnder as LabelUnder) ? { labelUnder: v.labelUnder as LabelUnder } : {}),
            }),
      },
    ]
  })
}

/**
 * The requirements to name things by: the PRD's as they stand, then those
 * only the board still holds, reworded or taken out since. A number is the
 * PRD's as it stands: one it no longer has keeps its old number only as
 * `was`, so no two show the same number. With no PRD read (none, or none
 * readable), the board's stand as they are, numbers and all.
 */
export const knownRequirements = (current: readonly Requirement[] | undefined, baseline: readonly Requirement[]): Requirement[] => {
  if (current === undefined || current.length === 0) return [...baseline]
  const ids = new Set(current.map(r => r.id))
  return [
    ...current,
    ...baseline
      .filter(r => !ids.has(r.id))
      .map(({ label, labelFrom: _f, labelUnder: _u, ...r }): Requirement => ({ ...r, gone: true, ...(label === undefined ? {} : { was: label }) })),
  ]
}

/** What a requirement the PRD no longer has says of itself. */
export const goneWords = (r: Requirement): string => `已不在現在的 PRD${r.was === undefined ? '' : `（原本是需求 ${r.was}）`}`

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
  const kept = (board as { crew_prd?: { path?: unknown; earlier?: unknown } | null }).crew_prd
  if (typeof kept !== 'object' || kept === null) {
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
