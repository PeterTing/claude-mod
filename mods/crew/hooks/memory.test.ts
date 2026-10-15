import { describe, expect, test } from 'claude-code/testing'

import {
  addMemory,
  estimateTokens,
  idsIn,
  nextMemoryId,
  packMemories,
  parseMemories,
  redact,
  searchMemories,
  serializeMemories,
  tokensOf,
} from './memory'
import type { MemoryEntry } from './memory'

const entry = (over: Partial<MemoryEntry> & Pick<MemoryEntry, 'id' | 'text'>): MemoryEntry => ({
  type: 'MEM',
  refs: [],
  roles: [],
  source: 'pm',
  t: 1,
  ...over,
})

describe('idsIn', () => {
  test('finds board, test case and memory ids in text', () => {
    expect(idsIn('AC-007 要改，見 DEC-002 和 SMK-012；PRD-001 不動')).toEqual(['AC-007', 'DEC-002', 'SMK-012', 'PRD-001'])
  })

  test('finds each id once and ignores words that only look close', () => {
    expect(idsIn('AC-7 與 AC-7、utf-8 和 covid-19')).toEqual(['AC-7'])
  })

  test('takes the prefixes a schema may define, with underscores', () => {
    expect(idsIn('見 SB_PRD-012 和 SMK-3')).toEqual(['SB_PRD-012', 'SMK-3'])
  })
})

describe('tokensOf', () => {
  test('splits Chinese into pairs of characters', () => {
    expect(tokensOf('待辦清單')).toEqual(['待辦', '辦清', '清單'])
  })

  test('keeps a lone Chinese character', () => {
    expect(tokensOf('刪')).toEqual(['刪'])
  })

  test('splits English into lower-case words and keeps ids whole', () => {
    expect(tokensOf('Login with OAuth, see AC-012')).toEqual(['login', 'with', 'oauth', 'see', 'AC-012'])
  })

  test('handles mixed text', () => {
    expect(tokensOf('匯出 CSV 檔')).toEqual(['匯出', 'csv', '檔'])
  })
})

describe('redact', () => {
  test('masks values that look like keys, tokens and passwords', () => {
    expect(redact('用 sk-ant-api03-abcdefghijklmnopqrstuvwxyz 呼叫')).toBe('用 [已遮罩] 呼叫')
    expect(redact('ghp_abcdefghijklmnopqrstuvwxyz0123456789 推')).toBe('[已遮罩] 推')
    expect(redact('AKIAABCDEFGHIJKLMNOP')).toBe('[已遮罩]')
    expect(redact('sk_live_abcdef1234567890 收款')).toBe('[已遮罩] 收款')
    expect(redact('password: hunter2 之後')).toBe('password: [已遮罩] 之後')
    expect(redact('密碼＝abc123')).toBe('密碼＝[已遮罩]')
    expect(redact('密碼是 hunter2xyz')).toBe('密碼是 [已遮罩]')
    expect(redact('API_KEY=xyz123abc')).toBe('API_KEY=[已遮罩]')
    expect(redact('token="s3cr3t-value"')).toBe('token="[已遮罩]"')
  })

  test('masks secrets in JSON, URLs and headers', () => {
    expect(redact('{"password": "hunter2xyz", "user": "amy"}')).toBe('{"password": "[已遮罩]", "user": "amy"}')
    expect(redact('postgres://admin:S3cretPass@db:5432/app')).toBe('postgres://admin:[已遮罩]@db:5432/app')
    expect(redact('Authorization: Bearer abc.def-ghi_123456')).toBe('Authorization: Bearer [已遮罩]')
    expect(redact('https://hooks.slack.com/services/T000/B000/XXXXXXXX')).toBe('https://hooks.slack.com/services/[已遮罩]')
  })

  test('masks private keys and JWTs, even a key cut before its end line', () => {
    expect(redact('-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----')).toBe('[已遮罩]')
    expect(redact('前 -----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\nabc')).toBe('前 [已遮罩]')
    expect(redact('token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc')).toBe('token [已遮罩]')
  })

  test('leaves ordinary text alone, including rules about passwords', () => {
    expect(redact('登入用 Google OAuth，token 有效期 1 小時')).toBe('登入用 Google OAuth，token 有效期 1 小時')
    expect(redact('密碼：至少 8 個字元')).toBe('密碼：至少 8 個字元')
    expect(redact('token: JWT 格式')).toBe('token: JWT 格式')
    expect(redact('金鑰：放在 Secret Manager')).toBe('金鑰：放在 Secret Manager')
    expect(redact('password: required')).toBe('password: required')
  })

  test('keeps a JSON line valid', () => {
    const line = redact(JSON.stringify({ t: 1, text: 'password=hunter2x', from: 'pm' }))
    expect((JSON.parse(line) as { from: string }).from).toBe('pm')
  })
})

describe('nextMemoryId', () => {
  test('numbers after the highest id of that type in use', () => {
    expect(nextMemoryId('DEC', ['DEC-001', 'DEC-004', 'MEM-009'])).toBe('DEC-005')
    expect(nextMemoryId('PREF', [])).toBe('PREF-001')
  })
})

describe('addMemory', () => {
  const ctx = { t: 100, taken: [] as string[] }

  test('adds an entry with the ids its text mentions as refs', () => {
    const r = addMemory([], { type: 'DEC', text: 'AC-003 只支援 Google 登入', source: 'pm' }, ctx)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.entry).toEqual({ id: 'DEC-001', type: 'DEC', text: 'AC-003 只支援 Google 登入', refs: ['AC-003'], roles: [], source: 'pm', t: 100 })
    expect(r.list).toEqual([r.entry])
  })

  test('numbers after ids used elsewhere, such as the board’s decisions', () => {
    const r = addMemory([], { type: 'DEC', text: '不做匯出', source: 'pm' }, { t: 1, taken: ['DEC-002'] })
    expect(r.ok && r.entry.id).toBe('DEC-003')
  })

  test('merges given refs with mentioned ones, once each', () => {
    const r = addMemory([], { type: 'MEM', text: 'AC-001 用 UTC', refs: ['PRD-001', 'AC-001'], source: 'qa' }, ctx)
    expect(r.ok && r.entry.refs).toEqual(['PRD-001', 'AC-001'])
  })

  test('keeps at most eight refs, so one memory does not match every message', () => {
    const refs = Array.from({ length: 12 }, (_, i) => `AC-${String(i + 1).padStart(3, '0')}`)
    const r = addMemory([], { type: 'MEM', text: '對應表', refs, source: 'pm' }, ctx)
    expect(r.ok && r.entry.refs).toEqual(refs.slice(0, 8))
  })

  test('masks secrets before saving', () => {
    const r = addMemory([], { type: 'MEM', text: '測試帳號 password=abc123', source: 'qa' }, ctx)
    expect(r.ok && r.entry.text).toBe('測試帳號 password=[已遮罩]')
  })

  test('cuts text past 300 characters and says so', () => {
    const r = addMemory([], { type: 'MEM', text: '字'.repeat(320), source: 'pm' }, ctx)
    expect(r.ok && r.entry.text.length).toBe(300)
    expect(r.ok && r.note).toBe('內容超過 300 字，已截斷。')
  })

  test('refuses empty text', () => {
    expect(addMemory([], { type: 'MEM', text: '  ', source: 'pm' }, ctx)).toEqual({ ok: false, error: '記憶內容是空白的。' })
  })

  test('returns the existing entry instead of saving the same thing twice', () => {
    const first = addMemory([], { type: 'LES', text: '日期要寫時區', source: 'qa' }, ctx)
    if (!first.ok) throw new Error('first save failed')
    const again = addMemory(first.list, { type: 'LES', text: ' 日期要寫時區 ', source: 'pm' }, { t: 200, taken: [] })
    expect(again.ok && again.entry.id).toBe('LES-001')
    expect(again.ok && again.list.length).toBe(1)
    expect(again.ok && again.note).toBe('已經有同樣的記憶 LES-001。')
  })

  test('marks the entry it supersedes', () => {
    const first = addMemory([], { type: 'DEC', text: '只做 Google 登入', source: 'pm' }, ctx)
    if (!first.ok) throw new Error('first save failed')
    const next = addMemory(first.list, { type: 'DEC', text: '改成 Google 和 Email 登入', source: 'person', supersedes: 'DEC-001' }, { t: 200, taken: [] })
    expect(next.ok).toBe(true)
    if (!next.ok) return
    expect(next.list.map(m => [m.id, m.supersededBy, m.supersedes])).toEqual([
      ['DEC-001', 'DEC-002', undefined],
      ['DEC-002', undefined, 'DEC-001'],
    ])
  })

  test('refuses to supersede an entry that is missing or already superseded', () => {
    expect(addMemory([], { type: 'DEC', text: 'x', source: 'pm', supersedes: 'DEC-009' }, ctx)).toEqual({ ok: false, error: '找不到要取代的記憶 DEC-009。' })
    const list = [entry({ id: 'DEC-001', text: 'a', supersededBy: 'DEC-002' }), entry({ id: 'DEC-002', text: 'b', supersedes: 'DEC-001' })]
    expect(addMemory(list, { type: 'DEC', text: 'c', source: 'pm', supersedes: 'DEC-001' }, ctx)).toEqual({ ok: false, error: 'DEC-001 已經被 DEC-002 取代，請取代 DEC-002。' })
  })

  test('keeps an id given to it, such as a decision the board already numbered', () => {
    const r = addMemory([], { id: 'DEC-004', type: 'DEC', text: 'AC-009 移出範圍', source: 'pm' }, ctx)
    expect(r.ok && r.entry.id).toBe('DEC-004')
  })

  test('refuses an id already in use', () => {
    const list = [entry({ id: 'DEC-004', type: 'DEC', text: 'a' })]
    expect(addMemory(list, { id: 'DEC-004', type: 'DEC', text: 'b', source: 'pm' }, ctx)).toEqual({ ok: false, error: 'DEC-004 已經用過了。' })
  })

  test('keeps the roles it applies to', () => {
    const r = addMemory([], { type: 'LES', text: '先跑 lint', roles: ['qa'], source: 'qa' }, ctx)
    expect(r.ok && r.entry.roles).toEqual(['qa'])
  })
})

describe('searchMemories', () => {
  const list: MemoryEntry[] = [
    entry({ id: 'DEC-001', type: 'DEC', text: '登入只支援 Google OAuth', refs: ['AC-003'], t: 10 }),
    entry({ id: 'MEM-001', text: '待辦清單最多 500 筆，超過要分頁', refs: ['AC-010'], t: 20 }),
    entry({ id: 'LES-001', type: 'LES', text: '日期欄位要寫時區，QA 才測得出跨日問題', roles: ['qa'], t: 30 }),
    entry({ id: 'DEC-002', type: 'DEC', text: '匯出 CSV 移出範圍', refs: ['PRD-004'], t: 40 }),
    entry({ id: 'DEC-003', type: 'DEC', text: '舊的登入決定', refs: ['AC-003'], supersededBy: 'DEC-001', t: 5 }),
    entry({ id: 'PREF-001', type: 'PREF', text: '金額一律用新台幣', source: 'person', t: 50 }),
  ]

  test('finds memories that reference an id the message mentions', () => {
    const hits = searchMemories(list, { text: '請確認 AC-003 的 test case' })
    expect(hits[0]).toMatchObject({ entry: { id: 'DEC-001' }, why: 'link' })
  })

  test('finds memories about the feature a mentioned criterion belongs to', () => {
    const hits = searchMemories(list, { text: 'AC-021 是不是還要做', related: { 'AC-021': ['PRD-004'] } })
    expect(hits[0]).toMatchObject({ entry: { id: 'DEC-002' }, why: 'link' })
  })

  test('finds memories by words when no id matches', () => {
    const hits = searchMemories(list, { text: '清單超過幾筆要分頁？' })
    expect(hits[0]).toMatchObject({ entry: { id: 'MEM-001' }, why: 'match' })
  })

  test('leaves out superseded memories', () => {
    const ids = searchMemories(list, { text: 'AC-003 登入' }).map(h => h.entry.id)
    expect(ids.includes('DEC-003')).toBe(false)
  })

  test('leaves out memories for other roles', () => {
    expect(searchMemories(list, { text: '日期 時區', role: 'pm' }).map(h => h.entry.id).includes('LES-001')).toBe(false)
    expect(searchMemories(list, { text: '日期 時區', role: 'qa' })[0]).toMatchObject({ entry: { id: 'LES-001' } })
  })

  test('leaves out memories already given', () => {
    const ids = searchMemories(list, { text: 'AC-003', exclude: new Set(['DEC-001']) }).map(h => h.entry.id)
    expect(ids.includes('DEC-001')).toBe(false)
  })

  test('needs more than one shared word to count a match', () => {
    // "登入" alone appears in a memory; one shared pair is too weak to be related.
    expect(searchMemories(list, { text: '登入' }).filter(h => h.why === 'match')).toEqual([])
  })

  test('counts one specific English term as enough to match', () => {
    const hits = searchMemories([entry({ id: 'DEC-009', type: 'DEC', text: '篩選存在 localStorage' })], { text: 'localStorage 的決定' })
    expect(hits[0]).toMatchObject({ entry: { id: 'DEC-009' }, why: 'match' })
    expect(searchMemories([entry({ id: 'MEM-009', text: 'see the api docs' })], { text: 'api 呢' })).toEqual([])
  })

  test('adds the person’s preferences after the related memories', () => {
    const hits = searchMemories(list, { text: '清單超過幾筆要分頁？' })
    expect(hits.map(h => [h.entry.id, h.why])).toEqual([
      ['MEM-001', 'match'],
      ['PREF-001', 'pref'],
    ])
  })

  test('ranks a direct link above a word match', () => {
    const hits = searchMemories(list, { text: '清單分頁和 AC-003 登入' })
    expect(hits[0]?.entry.id).toBe('DEC-001')
  })

  test('finds a memory by its own id', () => {
    expect(searchMemories(list, { text: '照 DEC-002 做' })[0]).toMatchObject({ entry: { id: 'DEC-002' }, why: 'link' })
  })

  test('returns nothing for an empty store', () => {
    expect(searchMemories([], { text: 'AC-001' })).toEqual([])
  })
})

describe('preferences', () => {
  test('come with every search, beyond the limit of related memories', () => {
    const many = Array.from({ length: 9 }, (_, i) => entry({ id: `MEM-${String(i + 1).padStart(3, '0')}`, text: `驗收條件第 ${i} 條要寫清楚` }))
    const pref = entry({ id: 'PREF-001', type: 'PREF', text: '回覆用繁體中文', source: 'person', t: 0 })
    const hits = searchMemories([...many, pref], { text: '為每一條驗收條件寫清楚 test case', limit: 8 })
    expect(hits.filter(h => h.why === 'match')).toHaveLength(8)
    expect(hits.at(-1)).toMatchObject({ entry: { id: 'PREF-001' }, why: 'pref' })
  })

  test('are packed first when the budget is tight', () => {
    const hits = [
      { entry: entry({ id: 'MEM-001', text: '字'.repeat(60) }), score: 9, why: 'match' as const },
      { entry: entry({ id: 'PREF-001', type: 'PREF', text: '用新台幣', source: 'person' }), score: 0, why: 'pref' as const },
    ]
    expect(packMemories(hits, 40).ids).toEqual(['PREF-001'])
    expect(packMemories(hits, 400).ids).toEqual(['MEM-001', 'PREF-001'])
  })
})

describe('estimateTokens', () => {
  test('counts Chinese characters more heavily than English letters', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('一二三四五六七八九十')).toBe(12)
    expect(estimateTokens('hello world, this is text')).toBe(8)
  })
})

describe('packMemories', () => {
  const hits = [
    { entry: entry({ id: 'DEC-001', type: 'DEC', text: '登入只支援 Google', source: 'person Q-01' }), score: 9, why: 'link' as const },
    { entry: entry({ id: 'MEM-001', text: '清單最多 500 筆', source: 'pm' }), score: 3, why: 'match' as const },
  ]

  test('writes one line per memory with its type and source', () => {
    const pack = packMemories(hits)
    expect(pack.text).toBe('- DEC-001（決定・person Q-01）：登入只支援 Google\n- MEM-001（事實・pm）：清單最多 500 筆')
    expect(pack.ids).toEqual(['DEC-001', 'MEM-001'])
    expect(pack.tokens).toBe(estimateTokens(pack.text))
  })

  test('stops before the budget runs out', () => {
    const pack = packMemories(hits, 25)
    expect(pack.ids).toEqual(['DEC-001'])
  })

  test('is empty with nothing to pack', () => {
    expect(packMemories([])).toEqual({ text: '', ids: [], tokens: 0 })
  })
})

describe('parseMemories and serializeMemories', () => {
  test('round-trip one entry per line and skip lines that do not parse', () => {
    const list = [entry({ id: 'MEM-001', text: 'a' }), entry({ id: 'DEC-001', type: 'DEC', text: 'b', supersedes: 'DEC-000' })]
    const text = serializeMemories(list)
    expect(text.split('\n').filter(Boolean).length).toBe(2)
    expect(parseMemories(`${text}not json\n{"id":1}\n`)).toEqual(list)
  })
})
