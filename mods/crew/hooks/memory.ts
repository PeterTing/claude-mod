/**
 * Crew's long-term memory: decisions, facts, lessons and the person's
 * preferences, one JSON line each in `.crew/memory/memories.jsonl`, found again
 * by the ids they reference and by their words (BM25 over Chinese character
 * pairs and English words). Pure: no `$`, no files.
 */

export type MemoryType = 'DEC' | 'MEM' | 'LES' | 'PREF'

export const MEMORY_TYPES: readonly MemoryType[] = ['DEC', 'MEM', 'LES', 'PREF']

const TYPE_NAMES: Record<MemoryType, string> = { DEC: '決定', MEM: '事實', LES: '教訓', PREF: '偏好' }

export type MemoryEntry = {
  id: string
  type: MemoryType
  text: string
  /** Board items, memories or files it is about. */
  refs: string[]
  /** The roles it is for; empty, every role. */
  roles: string[]
  /** Who said it and where: `pm`, `person Q-02`, `board`. */
  source: string
  t: number
  supersedes?: string
  supersededBy?: string
}

export const MAX_TEXT = 300

/** A memory that references everything would be attached to every message. */
export const MAX_REFS = 8

const ID = /\b[A-Z][A-Z0-9]{0,7}-\d+\b/g

/** The board, test case, question and memory ids a text mentions, in order, once each. */
export const idsIn = (text: string): string[] => [...new Set(text.match(ID) ?? [])]

const CJK = '\\u3040-\\u30FA\\u30FC-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\uAC00-\\uD7AF'
const TOKEN = new RegExp(`\\b([A-Z][A-Z0-9]{0,7}-\\d+)\\b|([A-Za-z0-9]+)|([${CJK}]+)`, 'g')

/** Words to match on: ids whole, English lower-cased, Chinese as overlapping pairs of characters. */
export const tokensOf = (text: string): string[] => {
  const out: string[] = []
  for (const m of text.matchAll(TOKEN)) {
    if (m[1] !== undefined) out.push(m[1])
    else if (m[2] !== undefined) out.push(m[2].toLowerCase())
    else if (m[3] !== undefined) {
      const run = [...m[3]]
      if (run.length === 1) out.push(run[0] ?? '')
      for (let i = 0; i + 1 < run.length; i++) out.push(`${run[i]}${run[i + 1]}`)
    }
  }
  return out
}

const MASK = '[已遮罩]'

const SECRETS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
]

const ASSIGNED = /((?<![A-Za-z])(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)|密碼|金鑰|密鑰|權杖)(\s*[:=：＝]\s*)([^\s，。、；,;]+)/gi

/** The text with anything that looks like a key, token or password masked. */
export const redact = (text: string): string =>
  SECRETS.reduce((s, re) => s.replace(re, MASK), text).replace(ASSIGNED, (_, key: string, sep: string) => `${key}${sep}${MASK}`)

/** The next id of a type after the highest of that type in use. */
export const nextMemoryId = (type: MemoryType, taken: readonly string[]): string => {
  const re = new RegExp(`^${type}-(\\d+)$`)
  const most = taken.reduce((n, id) => Math.max(n, Number(re.exec(id)?.[1] ?? 0)), 0)
  return `${type}-${String(most + 1).padStart(3, '0')}`
}

export type MemoryInput = {
  /** An id numbered elsewhere, such as a decision the board recorded. */
  id?: string
  type: MemoryType
  text: string
  refs?: readonly string[]
  roles?: readonly string[]
  source: string
  supersedes?: string
}

export type AddResult = { ok: true; list: MemoryEntry[]; entry: MemoryEntry; note?: string } | { ok: false; error: string }

const same = (a: string): string => a.replace(/\s+/g, ' ').trim()

/**
 * Saves one memory: secrets masked, cut to 300 characters, the ids it mentions
 * added to its refs. The same text of the same type returns the entry already
 * saved; `supersedes` marks the older entry, which retrieval then leaves out.
 */
export const addMemory = (list: readonly MemoryEntry[], input: MemoryInput, ctx: { t: number; taken: readonly string[] }): AddResult => {
  const clean = same(redact(input.text))
  if (clean === '') return { ok: false, error: '記憶內容是空白的。' }
  const text = [...clean].slice(0, MAX_TEXT).join('')
  const twin = list.find(m => m.type === input.type && m.supersededBy === undefined && same(m.text) === text)
  if (twin !== undefined) return { ok: true, list: [...list], entry: twin, note: `已經有同樣的記憶 ${twin.id}。` }
  if (input.supersedes !== undefined) {
    const old = list.find(m => m.id === input.supersedes)
    if (old === undefined) return { ok: false, error: `找不到要取代的記憶 ${input.supersedes}。` }
    if (old.supersededBy !== undefined) return { ok: false, error: `${old.id} 已經被 ${old.supersededBy} 取代，請取代 ${old.supersededBy}。` }
  }
  if (input.id !== undefined && list.some(m => m.id === input.id)) return { ok: false, error: `${input.id} 已經用過了。` }
  const id = input.id ?? nextMemoryId(input.type, [...ctx.taken, ...list.map(m => m.id)])
  const entry: MemoryEntry = {
    id,
    type: input.type,
    text,
    refs: [...new Set([...(input.refs ?? []), ...idsIn(text)])].slice(0, MAX_REFS),
    roles: [...(input.roles ?? [])],
    source: input.source,
    t: ctx.t,
    ...(input.supersedes !== undefined ? { supersedes: input.supersedes } : {}),
  }
  const marked = list.map(m => (m.id === input.supersedes ? { ...m, supersededBy: id } : m))
  return { ok: true, list: [...marked, entry], entry, ...([...clean].length > MAX_TEXT ? { note: `內容超過 ${MAX_TEXT} 字，已截斷。` } : {}) }
}

export type SearchQuery = {
  text: string
  /** Who will read the result: memories kept for other roles are left out. */
  role?: string
  /** Ids to link on besides the ones the text mentions. */
  ids?: readonly string[]
  /** Ids an id stands for too: a criterion's feature, a feature's criteria. */
  related?: Readonly<Record<string, readonly string[]>>
  /** Memories the reader already has. */
  exclude?: ReadonlySet<string>
  limit?: number
}

export type Hit = { entry: MemoryEntry; score: number; why: 'link' | 'match' | 'pref' }

const K1 = 1.2
const B = 0.75
const DIRECT = 10
const RELATED = 5

/**
 * The memories that bear on a text, best first: those referencing an id it
 * mentions (or that id's feature), then those sharing at least two of its
 * words or one long English term, then the person's preferences. Superseded
 * ones never come back.
 */
export const searchMemories = (list: readonly MemoryEntry[], query: SearchQuery): Hit[] => {
  const docs = list.filter(
    m =>
      m.supersededBy === undefined &&
      !(query.exclude?.has(m.id) ?? false) &&
      (query.role === undefined || m.roles.length === 0 || m.roles.includes(query.role)),
  )
  if (docs.length === 0) return []
  const direct = new Set([...idsIn(query.text), ...(query.ids ?? [])])
  const near = new Set([...direct].flatMap(id => [...(query.related?.[id] ?? [])]).filter(id => !direct.has(id)))
  const words = [...new Set(tokensOf(query.text).filter(t => !direct.has(t)))]

  const bags = docs.map(m => tokensOf(m.text))
  const avg = bags.reduce((n, b) => n + b.length, 0) / docs.length || 1
  const df = new Map<string, number>()
  for (const bag of bags) for (const t of new Set(bag)) df.set(t, (df.get(t) ?? 0) + 1)

  const hits = docs.map((m, i): Hit => {
    const bag = bags[i] ?? []
    const tf = new Map<string, number>()
    for (const t of bag) tf.set(t, (tf.get(t) ?? 0) + 1)
    let match = 0
    let shared = 0
    let specific = false
    for (const w of words) {
      const f = tf.get(w) ?? 0
      if (f === 0) continue
      shared += 1
      if (/^[a-z0-9]{5,}$/.test(w)) specific = true
      const n = df.get(w) ?? 0
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5))
      match += (idf * f * (K1 + 1)) / (f + K1 * (1 - B + (B * bag.length) / avg))
    }
    const keys = [m.id, ...m.refs]
    const link = keys.reduce((n, k) => n + (direct.has(k) ? DIRECT : near.has(k) ? RELATED : 0), 0)
    if (link > 0) return { entry: m, score: link + match, why: 'link' }
    // One shared Chinese pair is too weak to call related; one long English term is specific enough.
    if (shared >= 2 || specific) return { entry: m, score: match, why: 'match' }
    return { entry: m, score: m.type === 'PREF' ? 0.01 : 0, why: 'pref' }
  })
  return hits
    .filter(h => h.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.t - a.entry.t)
    .slice(0, query.limit ?? 8)
}

const WIDE = /[⺀-鿿가-힯豈-﫿︰-﹏＀-￯]/gu

/** About how many tokens a text costs: Chinese characters about 1.2 each, other text about 3.5 characters a token. */
export const estimateTokens = (text: string): number => {
  const wide = text.match(WIDE)?.length ?? 0
  const other = [...text].length - wide
  return Math.max(0, Math.ceil((wide * 6) / 5 + (other * 2) / 7 - 1e-9))
}

/** One line per memory, best first, as many as fit the budget. */
export const packMemories = (hits: readonly Hit[], budget = 800): { text: string; ids: string[]; tokens: number } => {
  const lines: string[] = []
  const ids: string[] = []
  for (const h of hits) {
    const line = `- ${h.entry.id}（${TYPE_NAMES[h.entry.type]}・${h.entry.source}）：${h.entry.text}`
    if (estimateTokens([...lines, line].join('\n')) > budget) break
    lines.push(line)
    ids.push(h.entry.id)
  }
  const text = lines.join('\n')
  return { text, ids, tokens: estimateTokens(text) }
}

const isEntry = (v: unknown): v is MemoryEntry => {
  const m = v as Partial<MemoryEntry> | null
  return (
    typeof m === 'object' &&
    m !== null &&
    typeof m.id === 'string' &&
    typeof m.text === 'string' &&
    MEMORY_TYPES.includes(m.type as MemoryType) &&
    Array.isArray(m.refs) &&
    Array.isArray(m.roles) &&
    typeof m.source === 'string' &&
    typeof m.t === 'number'
  )
}

/** The entries of a memories.jsonl file; lines that do not parse are skipped. */
export const parseMemories = (text: string): MemoryEntry[] =>
  text
    .split('\n')
    .filter(line => line.trim() !== '')
    .flatMap(line => {
      try {
        const v: unknown = JSON.parse(line)
        return isEntry(v) ? [v] : []
      } catch {
        return []
      }
    })

export const serializeMemories = (list: readonly MemoryEntry[]): string => list.map(m => JSON.stringify(m)).join('\n') + (list.length > 0 ? '\n' : '')
