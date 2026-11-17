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
  /** Pinned for every builder: each fresh full-stack agent is given it, whatever its task. */
  builders?: true
}

export const MAX_TEXT = 300

/** A memory that references everything would be attached to every message. */
export const MAX_REFS = 8

const ID = /\b[A-Z][A-Z0-9_]{0,15}-\d+\b/g

/** The board, test case, question and memory ids a text mentions, in order, once each. */
export const idsIn = (text: string): string[] => [...new Set(text.match(ID) ?? [])]

const CJK = '\\u3040-\\u30FA\\u30FC-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\uAC00-\\uD7AF'
const TOKEN = new RegExp(`\\b([A-Z][A-Z0-9_]{0,15}-\\d+)\\b|([A-Za-z0-9]+)|([${CJK}]+)`, 'g')

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

/** Whole values that are secrets whatever surrounds them. */
const SECRETS: readonly RegExp[] = [
  // To the end line, or to the end of the text when the key was cut short.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bsk_(?:live|test)_[A-Za-z0-9]{10,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
]

/** Dotted keys, taken last: read first, they would swallow a `_password=…` stuck to them before it is masked. */
const DOTTED: readonly RegExp[] = [/\bSG\.[\w-]{16,}\.[\w-]{16,}/g, /\bsk\.eyJ[\w-]+\.[\w-]+/g, /\bhvs\.[\w-]{20,}/g, /\bdp\.(?:st|ct|pt|sa)\.[\w.-]{20,}/g]

/** Secrets inside a known shape: the shape stays, the secret goes. */
const SHAPED: readonly [RegExp, string][] = [
  [/((["'])(?:password|passwd|passcode|pass|pwd|pw|pin|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|private[_-]?key)\2\s*:\s*(["']))(?:(?!\3)[^\\\n]|\\.)+(\3)/gi, `$1${MASK}$4`],
  // A Basic header's credential, whatever it decodes to.
  [/(\bauthorization\s*[:=：]\s*basic\s+)[A-Za-z0-9+/=_-]{4,}/gi, `$1${MASK}`],
  // From the start of a scheme's run of letters, whatever its first: a long run is read once, not once per letter.
  [/((?<![a-z0-9+.-])[a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+(@)/gi, `$1${MASK}$2`],
  [/(\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, `$1${MASK}`],
  [/(https:\/\/hooks\.slack\.com\/services\/)[A-Za-z0-9/]+/g, `$1${MASK}`],
]

/**
 * Keys whose value is a password: a value of letters alone after one is masked too when it is assigned (`:`, `=`, `是`,
 * `為`, `is`), unless it is a word of the screen (`password is required`, `password: optional`). Written with a space
 * alone (`Password successfully changed`), only a value that looks like a secret is.
 */
const PASSWORD_KEY = /^(?:password|passwd|passcode|pass|pwd|pw|密碼|密码|口令)$/i
/** Keys of another secret: a value of letters alone after one is masked only after `:` or `=` (`secret: …`, `token=…`). */
const SECRET_WORD_KEY = /^(?:secret|token|passphrase)$/i
/** Words that follow a password key on a screen or in a rule, not a password: never masked. */
const SCREEN_WORDS = new Set([
  'required', 'invalid', 'incorrect', 'missing', 'mismatch', 'matches', 'confirm', 'confirmation', 'confirmed', 'changed', 'change', 'update', 'updated', 'reset', 'resets', 'manager',
  'policy', 'policies', 'strength', 'strong', 'length', 'lengths', 'minimum', 'maximum', 'complexity', 'requirement', 'requirements', 'criteria', 'format', 'pattern', 'recovery', 'forgot',
  'forgotten', 'placeholder', 'label', 'labels', 'field', 'fields', 'input', 'inputs', 'button', 'buttons', 'toggle', 'visible', 'visibility', 'hidden', 'masked', 'unmasked', 'shown', 'showing',
  'expired', 'expires', 'expiry', 'entered', 'entry', 'typed', 'stored', 'hashed', 'encrypted', 'saved', 'protected', 'validation', 'validator', 'checker', 'errors', 'message', 'messages',
  'prompt', 'dialog', 'screen', 'page', 'pages', 'form', 'forms', 'login', 'logins', 'signin', 'signup', 'section', 'settings', 'setting', 'history', 'generator', 'autofill', 'autocomplete',
  'should', 'cannot', 'must', 'needs', 'without', 'within', 'between', 'characters', 'chars', 'digits', 'letters', 'symbols', 'number', 'numbers', 'again', 'twice', 'blank', 'empty',
  'wrong', 'rejected', 'accepted', 'works', 'worked', 'failed', 'fails', 'failure', 'correct', 'correctly', 'properly', 'please', 'instead', 'before', 'after', 'during', 'remains',
  'textbox', 'textfield', 'inputbox', 'element', 'elements', 'component', 'selector', 'attribute', 'column', 'columns', 'changes', 'request', 'requests', 'rotation', 'expiration',
  'storage', 'tooltip', 'helper', 'warning', 'warnings', 'hashing', 'encryption', 'rules', 'checks', 'match', 'mismatched', 'differs', 'different', 'same', 'reuse', 'reused',
  // A state the field or the value is in: `password: optional`, `token: verified`.
  'optional', 'mandatory', 'enabled', 'disabled', 'verified', 'unverified', 'displayed', 'unchanged', 'obscured', 'present', 'absent', 'redacted', 'focused', 'unfocused',
  'errored', 'active', 'inactive', 'locked', 'unlocked', 'filled', 'prefilled', 'cleared', 'pending', 'ignored', 'skipped', 'supported', 'unsupported', 'allowed', 'readonly',
  'editable', 'removed', 'deleted', 'created', 'generated', 'copied', 'rotated', 'revoked', 'refreshed', 'applied', 'submitted', 'success', 'successful', 'successfully',
  'complete', 'completed', 'available', 'unavailable', 'enforced', 'needed', 'provided', 'supplied', 'expected', 'unknown', 'invisible', 'issued',
])
/** What assigns a value to a key: a value of letters alone after a password key is masked only after one of these. */
const ASSIGNS = /[:=：＝]|是|為|为|(?<![A-Za-z])is(?![A-Za-z])/i
const PASSWORD_LIKE = (key: string, sep: string, value: string): boolean =>
  looksSecret(value) ||
  (/^[A-Za-z]{6,}$/.test(value) && !SCREEN_WORDS.has(value.toLowerCase()) && (PASSWORD_KEY.test(key) ? ASSIGNS.test(sep) : SECRET_WORD_KEY.test(key) && /[:=：＝]/.test(sep)))

/** `password: x`, `密碼是 x`, `password is x`, `pw=x`: x is masked when it looks like a secret, not a word in a rule ("密碼：至少 8 個字元"). */
const ASSIGNED =
  /((?<![A-Za-z])(?:password|passwd|passcode|passphrase|pass|pwd|pw|pin|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)|密碼|密码|口令|金鑰|密鑰|權杖)(\s*(?:[:=：＝]|是|為|为)\s*["'`]?|\s+is\s+["'`]?)([\x21\x23-\x26\x28-\x2B\x2D-\x3A\x3D\x3F-\x5F\x61-\x7E]+)/gi

// Stars alone are a placeholder (`********`); a digit over and over (`111111`) is a weak password, still masked.
const looksSecret = (value: string): boolean => value.length >= 6 && /[\d!@#$%^&*_+=-]/.test(value) && !/^\*+$/.test(value)

/**
 * A login written out in a sentence, its value masked when it looks like a secret: `密碼 hunter2` and `password Passw0rd`
 * with no colon (a space after an English key, none needed after a Chinese one). A word of letters alone after it is
 * prose (`Password successfully changed`), never masked.
 */
const PASSWORD_SPACED = /((?<![A-Za-z])(?:password|passwd|passcode|pwd|pw)(?=\s)|密碼|密码|口令)(\s*)([\x21\x23-\x26\x28-\x2B\x2D-\x3A\x3D\x3F-\x7E]+)/gi
/** A PIN's digits: `PIN 1234`, `pin: 482913`. */
const PIN = /((?<![A-Za-z])pin(?:\s*code)?(?![A-Za-z])|PIN\s*碼|pin碼)(\s*(?:[:=：＝]|是|為|\s+is\s+)?\s*)(\d{4,8})(?!\d)/gi
/** An account and its password: `qa@example.com / Secret123`, `qa@example.com:Secret123` (no `/` in the value: `git@host:org/repo` is none). */
const EMAIL_PAIRED = /(?<![A-Za-z0-9._%+-])([A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)(\s*[/:：|]\s*)([\x21\x23-\x26\x28-\x2B\x2D-\x2E\x30-\x3A\x3D\x3F-\x7E]+)(?![\x21-\x7E])/g
/** An account and a password after it with a space alone (`qa@example.com hunter2 登不進去`): only where the text speaks of logging in. */
const EMAIL_SPACED = /(?<![A-Za-z0-9._%+-])([A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)(\s+)([\x21\x23-\x26\x28-\x2B\x2D-\x2E\x30-\x3A\x3D\x3F-\x7E]+)(?![\x21-\x7E])/g
/** A cookie's values: `cookie session=…`, `Set-Cookie: sid=…; theme=…`. */
const COOKIE = /((?<![A-Za-z])(?:set-)?cookies?\s*[:=：]?\s*)((?:[\w.-]+=[^\s;,]+(?:;\s*)?)+)/gi
/** A one-time code's digits: `OTP 482913`, `驗證碼：123456`. */
const ONE_TIME = /((?<![A-Za-z])(?:otp|totp|2fa|mfa)(?![A-Za-z])|驗證碼|验证码|認證碼|认证码|動態密碼|一次性密碼)(\s*(?:[:=：＝]|是|為)?\s*)(\d{4,8})(?!\d)/gi
/** A Basic credential after `basic` or `basic auth`, masked when it reads as `user:password`. */
const BASIC = /(\bbasic(?:\s+auth(?:entication)?)?\s*[:=：]?\s*)([A-Za-z0-9+/_-]{8,}={0,2})/gi

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** A base64 run decoded, when it reads as text (UTF-8, no control characters): undefined otherwise. */
const fromBase64 = (run: string): string | undefined => {
  const s = run.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  if (s.length % 4 === 1) return undefined
  let acc = 0
  let bits = 0
  const bytes: string[] = []
  for (const ch of s) {
    const n = B64.indexOf(ch)
    if (n < 0) return undefined
    acc = ((acc << 6) | n) & 0xffffff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push(`%${((acc >> bits) & 0xff).toString(16).padStart(2, '0')}`)
    }
  }
  if (bytes.length < 4) return undefined
  try {
    const text = decodeURIComponent(bytes.join(''))
    return /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\uFFFD]/.test(text) ? undefined : text
  } catch {
    return undefined
  }
}

/** `%xx` runs decoded (UTF-8, or byte by byte where they are none). */
const percentDecoded = (s: string): string =>
  s.replace(/(?:%[0-9A-Fa-f]{2})+/g, run => {
    try {
      return decodeURIComponent(run)
    } catch {
      return run.replace(/%([0-9A-Fa-f]{2})/g, (_x: string, h: string) => String.fromCharCode(parseInt(h, 16)))
    }
  })

/** A word spelt out a character at a time (`h u n t e r 2`, `h-u-n-t-e-r-2`): joined as one. */
const SPELT = /(?<![^\s])(?:[^\s\-_.·,][\s\-_.·,]){3,}[^\s\-_.·,](?![^\s\-_.·,])/g
const joined = (s: string): string => s.replace(SPELT, run => run.replace(/[\s\-_.·,]+/g, ''))

/** What stands in for a masked value. */
export const MASKED = MASK

/** The text with anything that looks like a key, token or password masked. */
export const redact = (text: string): string => {
  // An email followed by a password with a space alone is a login only where the text speaks of one.
  const login = LOGIN_WORDS.test(text)
  return DOTTED.reduce(
    (s, re) => s.replace(re, MASK),
    SHAPED.reduce((s, [re, to]) => s.replace(re, to), SECRETS.reduce((s, re) => s.replace(re, MASK), text))
      .replace(BASIC, (all: string, key: string, value: string) => (fromBase64(value)?.includes(':') === true ? `${key}${MASK}` : all))
      .replace(ASSIGNED, (all: string, key: string, sep: string, value: string) => (PASSWORD_LIKE(key, sep, value) ? `${key}${sep}${MASK}` : all))
      .replace(PASSWORD_SPACED, (all: string, key: string, sep: string, value: string) => (looksSecret(value) ? `${key}${sep}${MASK}` : all))
      .replace(PIN, (_all: string, key: string, sep: string) => `${key}${sep}${MASK}`)
      .replace(EMAIL_PAIRED, (all: string, mail: string, sep: string, value: string) => (looksSecret(value) ? `${mail}${sep}${MASK}` : all))
      .replace(EMAIL_SPACED, (all: string, mail: string, sep: string, value: string) => (login && looksSecret(value) && /[A-Za-z]/.test(value) && /\d/.test(value) ? `${mail}${sep}${MASK}` : all))
      .replace(COOKIE, (_all: string, key: string, pairs: string) => `${key}${pairs.replace(/([\w.-]+=)([^\s;,]+)/g, (pair: string, name: string, value: string) => (value.length >= 6 ? `${name}${MASK}` : pair))}`)
      .replace(ONE_TIME, (_all: string, key: string, sep: string) => `${key}${sep}${MASK}`),
  )
}

/** Characters that show nothing (zero-width spaces and joiners, a soft hyphen): taken out before a text is compared. */
const unseen = (s: string): string => s.replace(/\p{Cf}/gu, '')

/**
 * Whether a text holds what masking would hide, or a user and password pair:
 * read as written, with characters that show nothing taken out, NFKC-folded
 * (full-width letters), with `%xx` decoded, and with a word spelt out a
 * character at a time joined.
 */
export const leaks = (text: string): boolean => {
  const nfkc = unseen(text).normalize('NFKC')
  const decoded = unseen(percentDecoded(nfkc))
  return [...new Set([text, nfkc, decoded, joined(decoded)])].some(s => redact(s) !== s || loginPair(s))
}

/** Keys whose values in a test accounts file are secrets. */
const SECRET_KEY = /pass(?:word|wd|code)?|pwd|secret|token|otp|密碼|密码|口令|^pin$|_pin$|^pin_|^pw$|_pw$|^pw_/i
/** Keys whose values are the account itself. */
const ACCOUNT_KEY = /^(?:user(?:_?name)?|login(?:_?id)?|account(?:_?name)?|e-?mail(?:_?address)?|mail|帳號|账号|帳戶|账户|使用者名稱|用戶名)$/i
/** Keys holding a login as a pair (`auth: [user, pass]`), or whose `id` is the account. */
const AUTH_KEY = /^(?:auth|basic_?auth|credentials?|creds|logins?)$/i
/** Account names that are also the words of a report (`admin` 頁面, a `test` case): never taken for the account. */
const COMMON_NAMES = new Set(['admin', 'guest', 'test', 'tester', 'user', 'users', 'demo', 'staff', 'owner', 'member', 'manager', 'editor', 'viewer', 'customer', 'client', 'qa'])
/**
 * Passwords that are also words of the screens and code QA reports on (`admin` 頁面, a `test` case, the `password`
 * field): such a password, or one the same as an account name of the file, is refused only where it reads as a login
 * (see holdsCredential). Letters alone: a password with a digit or a sign is never one of these.
 */
const COMMON_SECRETS = new Set([
  'admin', 'administrator', 'password', 'passwd', 'pass', 'test', 'tester', 'testing', 'demo', 'secret', 'user', 'guest', 'root', 'changeme', 'qwerty', 'letmein',
  'welcome', 'default', 'login',
])
const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g
/** A header cell of a table: a name, not a value. */
const HEADER_CELL = /^[A-Za-z_\u4e00-\u9fff][\w \u4e00-\u9fff.-]{0,39}$/

/**
 * A test accounts file's values: `secrets`, the passwords (and PINs, tokens),
 * refused in a report in any form; `accounts`, emails and account names with
 * a digit or a sign, refused as well; `plain`, account names of letters alone,
 * which are ordinary words too (`finance`), refused only beside a password or
 * a login. `weak`: the secrets of letters alone that are common words (see
 * COMMON_SECRETS) or the same as an account name of the file, refused only
 * where they read as a login; `users`, every account name and email of the
 * file, common ones too, for telling such a login. `unknown`: why the file
 * could not be read whole, when it could not.
 */
export type Credentials = { secrets: readonly string[]; accounts: readonly string[]; plain: readonly string[]; weak?: readonly string[]; users?: readonly string[]; unknown?: string }
export const NO_CREDENTIALS: Credentials = { secrets: [], accounts: [], plain: [] }

/**
 * The values of a test accounts file, to keep them out of what QA reports:
 * every email in it, and the values under a password or an account key (JSON,
 * YAML, .ini, .env, Ruby or JS seeds, a CSV or Markdown table with a header
 * line, SQL INSERTs, `auth: [user, pass]`). Held in memory by whoever reads
 * them, never written or said.
 */
export const credentialValues = (raw: string): Credentials => {
  const secrets = new Set<string>()
  const accounts = new Set<string>()
  const plain = new Set<string>()
  const users = new Set<string>()
  const account = (v: string) => {
    users.add(v)
    if (v.includes('@')) accounts.add(v)
    else if (/[^A-Za-z]/.test(v)) accounts.add(v)
    else if (v.length >= 5 && !COMMON_NAMES.has(v.toLowerCase())) plain.add(v)
  }
  const take = (key: string, value: unknown, parent = '') => {
    if (typeof value !== 'string' && typeof value !== 'number') return
    const v = String(value).trim()
    if (v.length < 4 || /^\*+$/.test(v) || /^(?:null|true|false|none|undefined|nil)$/i.test(v)) return
    if (SECRET_KEY.test(key)) secrets.add(v)
    else if (ACCOUNT_KEY.test(key) || (/^id$/i.test(key) && AUTH_KEY.test(parent))) account(v)
  }
  const pair = (user: unknown, pass: unknown) => {
    take('username', user)
    take('password', pass)
  }
  for (const m of raw.matchAll(EMAIL)) {
    accounts.add(m[0])
    users.add(m[0])
  }
  const walk = (v: unknown, key = '', parent = ''): void => {
    if (Array.isArray(v)) {
      if (AUTH_KEY.test(key) && v.length === 2 && v.every(x => typeof x === 'string' || typeof x === 'number')) return pair(v[0], v[1])
      for (const x of v) walk(x, key, parent)
    } else if (typeof v === 'object' && v !== null) for (const [k, x] of Object.entries(v)) walk(x, k, key)
    else take(key, v, parent)
  }
  try {
    walk(JSON.parse(raw))
  } catch {
    // Not JSON: read as keys and values below.
  }
  const quoted = (m: RegExpMatchArray, at: number): string | undefined => m[at] ?? m[at + 1] ?? m[at + 2] ?? m[at + 3]
  const VALUE = `(?:"([^"\\n]*)"|'([^'\\n]*)'|\`([^\`\\n]*)\`|([^\\s,;'"\`}\\])]+))`
  // key: value, key = value, key => value, "key": "value": YAML, .ini, .env, Ruby, JS and the like; `id` under credentials.
  let parent = ''
  for (const m of raw.matchAll(new RegExp(`(?<![\\w\\u4e00-\\u9fff-])(["'\`]?)([A-Za-z_\\u4e00-\\u9fff][\\w\\u4e00-\\u9fff-]*)\\1\\s*(?::|=>?|：)\\s*(?:${VALUE}|([{\\[]|$))`, 'gm'))) {
    const key = m[2] ?? ''
    if (m[7] !== undefined) {
      parent = key
      continue
    }
    take(key, quoted(m, 3), parent)
  }
  // A command line's flags: `--password hunter2`, `--password=hunter2`, `--username admin`.
  for (const m of raw.matchAll(/(?<![\w-])--([A-Za-z][\w-]*)(?:=|[ \t]+)(?:"([^"\n]*)"|'([^'\n]*)'|([^\s"'`;|&]+))/g)) {
    const key = (m[1] ?? '').replace(/-/g, '_')
    if (SECRET_KEY.test(key) || ACCOUNT_KEY.test(key)) take(key, m[2] ?? m[3] ?? m[4])
  }
  // auth: [user, pass], in YAML, Ruby, JS.
  for (const m of raw.matchAll(new RegExp(`(?<![\\w-])(["'\`]?)(auth|basic_?auth|credentials?|creds|logins?)\\1\\s*(?::|=>?|：)\\s*\\[\\s*${VALUE}\\s*,\\s*${VALUE}\\s*\\]`, 'gi'))) pair(quoted(m, 3), quoted(m, 7))
  const lines = raw.split(/\r?\n/)
  const cell = (c: string): string => c.trim().replace(/^["'`]|["'`]$/g, '')
  // A Markdown table: its header names the columns.
  let head: string[] | undefined
  for (const line of lines) {
    const t = line.trim()
    if (!t.startsWith('|')) {
      head = undefined
      continue
    }
    const cells = t.replace(/^\||\|$/g, '').split('|').map(cell)
    if (head === undefined) head = cells.every(h => HEADER_CELL.test(h)) ? cells : []
    else if (!cells.every(c => /^:?-{2,}:?$/.test(c))) cells.forEach((c, i) => take(head?.[i] ?? '', c))
  }
  // A table with a header line (CSV, TSV): the columns named as a password or an account.
  const rows = lines.filter(l => l.trim() !== '')
  const sep = (rows[0] ?? '').includes('\t') ? '\t' : ','
  const top = (rows[0] ?? '').split(sep).map(cell)
  if (top.length > 1 && top.every(h => HEADER_CELL.test(h)) && top.some(h => SECRET_KEY.test(h) || ACCOUNT_KEY.test(h))) for (const line of rows.slice(1)) line.split(sep).forEach((c, i) => take(top[i] ?? '', cell(c)))
  // SQL: INSERT INTO t (col, …) VALUES (…), (…).
  for (const m of raw.matchAll(/insert\s+into\s+[^\s(]+\s*\(([^)]*)\)\s*values\s*/gi)) {
    const cols = (m[1] ?? '').split(',').map(c => c.trim().replace(/^[`"[]|[`"\]]$/g, ''))
    let i = (m.index ?? 0) + m[0].length
    const end = Math.min(raw.length, i + 4_000_000)
    while (i < end && raw[i] === '(') {
      i++
      const values: string[] = []
      while (i < end && raw[i] !== ')') {
        while (raw[i] === ' ' || raw[i] === '\n' || raw[i] === '\t' || raw[i] === '\r') i++
        const q = raw[i]
        let v = ''
        if (q === "'" || q === '"') {
          i++
          while (i < end) {
            if (raw[i] === q && raw[i + 1] === q) {
              v += q
              i += 2
            } else if (raw[i] === q) {
              i++
              break
            } else v += raw[i++]
          }
        } else while (i < end && raw[i] !== ',' && raw[i] !== ')') v += raw[i++]
        values.push(v.trim())
        while (raw[i] === ' ' || raw[i] === '\n' || raw[i] === '\t' || raw[i] === '\r') i++
        if (raw[i] === ',') i++
      }
      values.forEach((v, n) => take(cols[n] ?? '', v))
      i++
      while (i < end && /[\s,]/.test(raw[i] ?? '')) i++
    }
  }
  const names = new Set([...users].map(u => u.toLowerCase()))
  const weak = [...secrets].filter(v => /^[A-Za-z]+$/.test(v) && (COMMON_SECRETS.has(v.toLowerCase()) || names.has(v.toLowerCase())))
  return { secrets: [...secrets], accounts: [...accounts], plain: [...plain], weak, users: [...users] }
}

/** Both sides of a comparison: no characters that show nothing, NFKC (full-width as half), `%xx` decoded, lower case. */
const fold = (s: string): string => unseen(percentDecoded(unseen(s).normalize('NFKC'))).toLowerCase()

/**
 * A text as the comparison reads it: as written (folded, with characters that
 * show nothing taken out), an email written apart (`qa @ example.com`,
 * `qa[at]example.com`, `。`), a word spelt out, base64 runs decoded, and
 * (`loose`, for values mixing letters with a digit or a sign, and emails) with
 * every space taken out.
 */
const formsOf = (text: string): { s: string; loose?: true }[] => {
  const decoded = unseen(percentDecoded(unseen(text).normalize('NFKC')))
  const base = decoded.toLowerCase()
  const out = new Set<string>([base])
  out.add(base.replace(/\s*[[(]\s*at\s*[\])]\s*/g, '@').replace(/\s*[[(]\s*dot\s*[\])]\s*/g, '.').replace(/\s*@\s*/g, '@').replace(/。/g, '.'))
  out.add(joined(base))
  let n = 0
  for (const m of decoded.matchAll(/[A-Za-z0-9+/_-]{8,}={0,2}/g)) {
    if (++n > 64) break
    const d = fromBase64(m[0])
    if (d !== undefined) out.add(fold(d))
  }
  return [...[...out].map(s => ({ s })), { s: base.replace(/\s+/g, ''), loose: true as const }]
}

type Kind = 'mixed' | 'letters' | 'digits' | 'weak' | 'email' | 'name' | 'plain'
const KEY = 4
type Index = { map: Map<string, { v: string; kind: Kind }[]>; users: ReadonlySet<string> }
const indexes = new WeakMap<Credentials, Index>()

/** A file's values by their first characters, folded, and its account names folded: built once a file, for a report's every field. */
const indexOf = (c: Credentials): Index => {
  const known = indexes.get(c)
  if (known !== undefined) return known
  const map = new Map<string, { v: string; kind: Kind }[]>()
  const put = (raw: string, kind: (v: string) => Kind) => {
    const v = fold(raw)
    if (v.length < KEY) return
    const k = v.slice(0, KEY)
    const list = map.get(k)
    if (list === undefined) map.set(k, [{ v, kind: kind(v) }])
    else list.push({ v, kind: kind(v) })
  }
  const weak = new Set((c.weak ?? []).map(fold))
  for (const s of c.secrets) put(s, v => (/^\d+$/.test(v) ? 'digits' : /^[a-z]+$/.test(v) ? (weak.has(v) ? 'weak' : 'letters') : 'mixed'))
  for (const a of c.accounts) put(a, v => (v.includes('@') ? 'email' : 'name'))
  for (const p of c.plain) put(p, () => 'plain')
  const index = { map, users: new Set((c.users ?? []).map(fold)) }
  indexes.set(c, index)
  return index
}

/** Words of logging in near an account name of letters alone: it is the account there, not the word. */
const LOGIN_NEAR = /登入|登錄|登录|登不|log\s*-?in|sign\s*-?in|帳號|账号|帳密|账密|帳戶|账户|account|user\s*name|使用者名稱|用戶名|密碼|密码|password|passwd|pwd|credential/i

/**
 * Keys right before a common-word password that make it the password (`密碼 admin`, `password: admin`, `"pw":"admin"`,
 * `帳號 admin`): the key, a quote, then `:`, `=`, `是` or nothing.
 */
const WEAK_KEY_BEFORE =
  /(?:(?<![a-z])(?:password|passwd|passcode|passphrase|pass|pwd|pw|pin|secret|token|user\s*name|login(?:\s*id)?)|密碼|密码|口令|帳號|账号|帳戶|账户|帳密|账密|使用者名稱|用戶名)["'`]?\s*(?:也|都)?\s*(?:[:=：＝]|是|為|为|(?<![a-z])(?:is|was)(?![a-z]))?\s*["'`「『(（]?\s*$/i
/** A word paired with a value before it (`admin / `, `qa@example.com:`) or after it (` / admin`): the word. */
const PAIRED_BEFORE = /(?:^|[\s"'`(（「『[{,，])["'`]?([^\s"'`/|:：,，]+)["'`]?\s*[/|:：,，]\s*["'`]?$/
const PAIRED_AFTER = /^["'`]?\s*[/|:：,，]\s*["'`]?([^\s"'`/|:：,，]+)/

/**
 * Whether a common-word password (see COMMON_SECRETS), at `at` in a folded text, reads as the password there: right
 * after a password or account key, right beside a word of logging in (`用 admin 登入`), or paired with an account of
 * the file or itself (`admin / admin`, `qa@example.com / password`), or with any word right beside a word of logging
 * in (`用 boss/admin 登入`). `admin 頁面`, `/admin/users`, `{"role":"admin"}`, `登入頁的 password 欄位` are words.
 */
const weakTold = (s: string, at: number, v: string, users: ReadonlySet<string>): boolean => {
  const end = at + v.length
  const before = s.slice(Math.max(0, at - 40), at)
  const after = s.slice(end, end + 40)
  if (WEAK_KEY_BEFORE.test(before)) return true
  if (LOGIN_BEFORE.test(before.slice(-16)) || LOGIN_AFTER.test(after.slice(0, 12))) return true
  const pair = (word: string, from: number, to: number): boolean =>
    users.has(word) || word === v || LOGIN_BEFORE.test(s.slice(Math.max(0, from - 16), from)) || LOGIN_AFTER.test(s.slice(to, to + 12))
  const left = PAIRED_BEFORE.exec(before)
  if (left?.[1] !== undefined && pair(left[1], at - left[0].length + left[0].indexOf(left[1]), end)) return true
  const right = PAIRED_AFTER.exec(after)
  return right?.[1] !== undefined && pair(right[1], at, end + right[0].length)
}

/**
 * Whether a text holds one of a test accounts file's values (see
 * credentialValues), in any of its forms (see formsOf): a password in any
 * case; a value of digits alone only on its own (`48210` holds no `4821`), one
 * of letters alone only as a word; a common-word password, or one the same as
 * an account name, only where it reads as a login (see weakTold); an account
 * name of letters alone only beside a password or a login (`finance 報表` is a
 * word). `names: false` (a page's address): passwords and emails alone.
 */
export const holdsCredential = (text: string, c: Credentials, opts: { names?: boolean } = {}): boolean => {
  const { map, users } = indexOf(c)
  if (map.size === 0) return false
  const names = opts.names !== false
  const apart = (s: string, at: number, len: number, re: RegExp): boolean => !re.test(s[at - 1] ?? '') && !re.test(s[at + len] ?? '')
  let plain = false
  for (const f of formsOf(text)) {
    const s = f.s
    for (let i = 0; i + KEY <= s.length; i++) {
      const list = map.get(s.slice(i, i + KEY))
      if (list === undefined) continue
      for (const e of list) {
        if (!s.startsWith(e.v, i)) continue
        if (f.loose === true && e.kind !== 'mixed' && e.kind !== 'email') continue
        if (e.kind === 'digits' && !apart(s, i, e.v.length, /\d/)) continue
        if ((e.kind === 'letters' || e.kind === 'weak' || e.kind === 'name' || e.kind === 'plain') && !apart(s, i, e.v.length, /[a-z0-9]/)) continue
        if (e.kind === 'weak') {
          if (weakTold(s, i, e.v, users)) return true
          plain = true
          continue
        }
        if (e.kind === 'name' || e.kind === 'plain') {
          if (!names) continue
          if (e.kind === 'name' || LOGIN_NEAR.test(s.slice(Math.max(0, i - 16), i + e.v.length + 16))) return true
          plain = true
          continue
        }
        return true
      }
    }
  }
  return plain && loginPair(text)
}

/** A text with each of a test accounts file's values in it masked, as written (see credentialValues). */
export const maskCredentials = (text: string, c: Credentials): string => {
  const escape = (v: string): string => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const lower = text.toLowerCase()
  const present = [...c.secrets, ...c.accounts, ...c.plain].filter(v => v.length >= KEY && lower.includes(v.toLowerCase())).sort((x, y) => y.length - x.length)
  return present.reduce((s, v) => s.replace(new RegExp(/^[A-Za-z0-9]+$/.test(v) ? `(?<![A-Za-z0-9])${escape(v)}(?![A-Za-z0-9])` : escape(v), 'gi'), MASK), text)
}

/** Words of logging in, for a pair written as user / password below. */
const LOGIN_WORDS = /登入|登錄|登录|登不進|登不进|log\s*-?in|sign\s*-?in|帳號|账号|帳密|账密|帳戶|账户|account|credential|用戶|使用者/i
/** Words right before a pair that make it a login (`用 admin/admin123`, `帳密 admin:admin123`). */
const LOGIN_BEFORE = /(?:用|以|輸入|输入|試了|试了|試過|试过|帳密|账密|帳號密碼|账号密码|帳號|账号|帳戶|账户|log\s*-?in(?:\s+(?:with|as))?|sign\s*-?in(?:\s+(?:with|as))?|credentials?|creds|tried|using)\s*[:：=「『"'(（]?\s*$/i
/** Words right after a pair that make it a login (`admin:admin123 登入`). */
const LOGIN_AFTER = /^\s*[」』"')）]?\s*(?:登入|登錄|登录|登不|log\s*-?in|sign\s*-?in)/i
/** A name, a separator and a value: `admin / admin123`, `admin|admin123`, `admin:admin123`, `admin, admin123`. */
const PAIR = /(?<![\w@./:|-])([A-Za-z][\w.+-]{1,39})(\s*)([/|:,])(\s*)([\x21\x23-\x26\x28-\x2B\x2D-\x2E\x30-\x3A\x3D\x3F-\x7B\x7D\x7E]{6,})(?![\x21-\x7E])/g
/** A name and a value with a space alone between: `admin admin123 登入失敗`. */
const SPACE_PAIR = /(?<![\w@./:|-])([A-Za-z][\w.+-]{1,39})(\s+)([\x21\x23-\x26\x28-\x2B\x2D-\x2E\x30-\x3A\x3D\x3F-\x7B\x7D\x7E]{6,})(?![\x21-\x7E])/g
/** A request line's method: `GET /accounts?id=42` is a path, not a login. */
const HTTP_METHOD = /^(?:get|post|put|patch|delete|head|options)$/i

/**
 * Whether a text writes a login as a user and a password (`admin / admin123`,
 * `admin|admin123`, `admin:admin123`): the second looks like a secret and is no
 * file name, id (TC-002), version (Chrome/120.0.1) or lower-case slug
 * (feature/login-v2). Written apart alike on both sides, with `/` or `|`, it
 * counts where the second mixes letters and digits or the text speaks of
 * logging in; with `:`, only where it speaks of logging in. Run together
 * (`v2/settings3`, `btn/primary2` are paths), with a comma, or with a space
 * alone, it counts only right beside a word of logging in (`用 admin/admin123`,
 * `admin admin123 登入失敗`). Full-width forms are read as half-width.
 */
export const loginPair = (raw: string): boolean => {
  const text = raw.normalize('NFKC')
  const login = LOGIN_WORDS.test(text)
  const near = (m: RegExpMatchArray): boolean => {
    const at = m.index ?? 0
    return LOGIN_BEFORE.test(text.slice(Math.max(0, at - 16), at)) || LOGIN_AFTER.test(text.slice(at + m[0].length, at + m[0].length + 12))
  }
  const secret = (user: string, v: string): boolean =>
    !HTTP_METHOD.test(user) && looksSecret(v) && !/\.[a-z]{2,5}$/i.test(v) && !/^[A-Za-z]+-\d+$/.test(v) && !/^v?\d+(?:\.\d+)*$/.test(v) && !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(v)
  const mixes = (v: string): boolean => /[A-Za-z]/.test(v) && /\d/.test(v)
  const paired = [...text.matchAll(PAIR)].some(m => {
    const [, user = '', before = '', sep = '', after = '', v = ''] = m
    if (!secret(user, v)) return false
    if (sep === ',') return before === '' && after !== '' && login && near(m)
    if ((before === '') !== (after === '')) return false
    if (before === '') return near(m)
    return sep === ':' ? login : login || mixes(v)
  })
  return paired || [...text.matchAll(SPACE_PAIR)].some(m => secret(m[1] ?? '', m[3] ?? '') && mixes(m[3] ?? '') && near(m))
}

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
  /** Pinned for every builder; absent, it keeps the pin of the memory it replaces; false, it does not. Only with `pins`. */
  builders?: boolean
  /** The one saving may pin for every builder (a builder, the Tech lead): a save by anyone else carries no pin, its own or one it replaces. */
  pins?: boolean
}

/**
 * `changed`: the list changed though no memory was added (one already saved
 * got pinned). `unpinned`: the pinned memory this one replaced, its pin not
 * carried over.
 */
export type AddResult = { ok: true; list: MemoryEntry[]; entry: MemoryEntry; note?: string; changed?: true; unpinned?: string } | { ok: false; error: string }

/** The most memories pinned for every builder, and the tokens their lines may take in a start. */
export const PIN_MAX = 12
export const PIN_TOKENS = 1_000

const PIN_FULL = `「給每個全端」已滿（最多 ${PIN_MAX} 條、約 ${PIN_TOKENS.toLocaleString('en-US')} tok）`

/** The memories pinned for every builder, oldest first: those not replaced, and for the full-stack to read. */
export const pinnedOf = (list: readonly MemoryEntry[]): MemoryEntry[] =>
  list.filter(m => m.builders === true && m.supersededBy === undefined && (m.roles.length === 0 || m.roles.includes('fullstack')))

/** Whether the pinned memories, `entry` in place of the one it replaces, fit the cap. */
const pinFits = (list: readonly MemoryEntry[], entry: MemoryEntry, replaces?: string): boolean => {
  const next = [...pinnedOf(list).filter(m => m.id !== replaces && m.id !== entry.id), entry]
  return next.length <= PIN_MAX && estimateTokens(next.map(entryLine).join('\n')) <= PIN_TOKENS
}

const same = (a: string): string => a.replace(/\s+/g, ' ').trim()

/** Whether the full-stack reads a memory: one kept for other roles cannot be pinned for it. */
const forBuilders = (roles: readonly string[]): boolean => roles.length === 0 || roles.includes('fullstack')

/**
 * Saves one memory: secrets masked, cut to 300 characters, the ids it mentions
 * added to its refs. The same text of the same type returns the entry already
 * saved; `supersedes` marks the older entry, which retrieval then leaves out.
 */
export const addMemory = (list: readonly MemoryEntry[], input: MemoryInput, ctx: { t: number; taken: readonly string[] }): AddResult => {
  const clean = same(redact(input.text))
  if (clean === '') return { ok: false, error: '記憶內容是空白的。' }
  const text = [...clean].slice(0, MAX_TEXT).join('')
  // A memory numbered elsewhere (the board's own decision) is kept under its number even when the words repeat.
  const twin = input.id === undefined ? list.find(m => m.type === input.type && m.supersededBy === undefined && same(m.text) === text) : undefined
  if (twin !== undefined) {
    // Saved again to pin it: the memory already there gets the pin.
    if (input.builders !== true || input.pins !== true || twin.builders === true) return { ok: true, list: [...list], entry: twin, note: `已經有同樣的記憶 ${twin.id}。` }
    if (!forBuilders(twin.roles)) return { ok: true, list: [...list], entry: twin, note: `已經有同樣的記憶 ${twin.id}；它只給 ${twin.roles.join('、')} 看，全端看不到，沒有標「給每個全端」。` }
    if (!pinFits(list, { ...twin, builders: true })) return { ok: true, list: [...list], entry: twin, note: `已經有同樣的記憶 ${twin.id}；${PIN_FULL}，沒有標上。` }
    const pinned: MemoryEntry = { ...twin, builders: true }
    return { ok: true, list: list.map(m => (m.id === twin.id ? pinned : m)), entry: pinned, note: `已經有同樣的記憶 ${twin.id}，已標「給每個全端」。`, changed: true }
  }
  if (input.supersedes !== undefined) {
    const old = list.find(m => m.id === input.supersedes)
    if (old === undefined) return { ok: false, error: `找不到要取代的記憶 ${input.supersedes}。` }
    if (old.supersededBy !== undefined) return { ok: false, error: `${old.id} 已經被 ${old.supersededBy} 取代，請取代 ${old.supersededBy}。` }
  }
  if (input.id !== undefined && list.some(m => m.id === input.id)) return { ok: false, error: `${input.id} 已經用過了。` }
  const id = input.id ?? nextMemoryId(input.type, [...ctx.taken, ...list.map(m => m.id)])
  const plain: MemoryEntry = {
    id,
    type: input.type,
    text,
    refs: [...new Set([...(input.refs ?? []), ...idsIn(text)])].slice(0, MAX_REFS),
    roles: [...(input.roles ?? [])],
    source: input.source,
    t: ctx.t,
    ...(input.supersedes !== undefined ? { supersedes: input.supersedes } : {}),
  }
  // A memory that replaces a pinned one is pinned in its place, unless the save says otherwise; only by one who may pin.
  const replacesPin = input.supersedes !== undefined && list.some(m => m.id === input.supersedes && m.builders === true)
  const wants = input.pins === true && (input.builders === true || (input.builders !== false && replacesPin))
  const sees = forBuilders(plain.roles)
  const fits = wants && sees && pinFits(list, { ...plain, builders: true }, input.supersedes)
  const entry: MemoryEntry = fits ? { ...plain, builders: true } : plain
  const notes = [
    ...([...clean].length > MAX_TEXT ? [`內容超過 ${MAX_TEXT} 字，已截斷。`] : []),
    ...(wants && !sees ? [`這條只給 ${plain.roles.join('、')} 看，全端看不到，沒有標「給每個全端」。`] : []),
    ...(wants && sees && !fits ? [`${PIN_FULL}，這條存成一般記憶；要固定的話先用 supersedes 取代一條固定附上的，或請使用者在記憶分頁取消一條。`] : []),
    ...(replacesPin && input.pins !== true ? [`${input.supersedes} 原本固定附上給每個全端；只有全端、Tech lead 和使用者能固定，${id} 存成一般記憶，${input.supersedes} 也不再附上，crew 會告訴使用者。`] : []),
  ]
  const marked = list.map(m => (m.id === input.supersedes ? { ...m, supersededBy: id } : m))
  const unpinned = replacesPin && !fits ? { unpinned: input.supersedes as string } : {}
  return { ok: true, list: [...marked, entry], entry, ...unpinned, ...(notes.length === 0 ? {} : { note: notes.join('') }) }
}

/**
 * The person pins a memory for every builder, or takes the pin off. A memory
 * replaced is not pinned: the one that replaced it is.
 */
export const setPinned = (list: readonly MemoryEntry[], id: string, on: boolean): { ok: true; list: MemoryEntry[]; entry: MemoryEntry } | { ok: false; error: string } => {
  const m = list.find(x => x.id === id)
  if (m === undefined) return { ok: false, error: `找不到記憶 ${id}。` }
  if (on && m.supersededBy !== undefined) return { ok: false, error: `${id} 已經被 ${m.supersededBy} 取代，請固定 ${m.supersededBy}。` }
  if (on && m.roles.length > 0 && !m.roles.includes('fullstack')) return { ok: false, error: `${id} 只給 ${m.roles.join('、')} 看，全端看不到，不能固定附上給全端。` }
  if (on === (m.builders === true)) return { ok: false, error: on ? `${id} 已經固定附上了。` : `${id} 沒有固定附上。` }
  if (on && !pinFits(list, { ...m, builders: true })) return { ok: false, error: `${PIN_FULL}：先在記憶分頁取消一條。` }
  const { builders: _b, ...rest } = m
  const entry: MemoryEntry = on ? { ...m, builders: true } : rest
  return { ok: true, list: list.map(x => (x.id === id ? entry : x)), entry }
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
 * words or one long English term, up to the limit; then the person's
 * preferences, always. Superseded ones never come back.
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
    return { entry: m, score: 0, why: 'pref' }
  })
  const related = hits
    .filter(h => h.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.t - a.entry.t)
    .slice(0, query.limit ?? 8)
  // The person's preferences go with every search, outside the limit: they apply to all work.
  const prefs = hits
    .filter(h => h.entry.type === 'PREF' && !related.some(r => r.entry.id === h.entry.id))
    .sort((a, b) => b.entry.t - a.entry.t)
    .slice(0, MAX_PREFS)
    .map(h => ({ ...h, score: 0, why: 'pref' as const }))
  return [...related, ...prefs]
}

const MAX_PREFS = 5

const WIDE = /[⺀-鿿가-힯豈-﫿︰-﹏＀-￯]/gu

/** About how many tokens a text costs: Chinese characters about 1.2 each, other text about 3.5 characters a token. */
export const estimateTokens = (text: string): number => {
  const wide = text.match(WIDE)?.length ?? 0
  const other = [...text].length - wide
  return Math.max(0, Math.ceil((wide * 6) / 5 + (other * 2) / 7 - 1e-9))
}

/**
 * Who a memory is from, as a role reads it. A decision or preference the brain
 * wrote with no words of the person's quoted is the brain's own judgment, and
 * says so: a role does not take it for what the person decided.
 */
export const sourceOf = (m: MemoryEntry): string =>
  m.source === 'brain' && (m.type === 'DEC' || m.type === 'PREF') && !m.text.startsWith(QUOTED) ? '大腦的判斷，使用者沒有明說' : m.source

/** How a decision the brain records for the person begins: their own words. */
export const QUOTED = '使用者原話：'

const lineOf = (h: Hit): string => entryLine(h.entry)

/** A memory as a role reads it: one line, with its kind and who it is from. */
export const entryLine = (m: MemoryEntry): string => `- ${m.id}（${TYPE_NAMES[m.type]}・${sourceOf(m)}）：${m.text}`

/**
 * One line per memory, as many as fit the budget: the person's preferences
 * are placed first and listed last, the related memories fill what is left.
 */
export const packMemories = (hits: readonly Hit[], budget = 800): { text: string; ids: string[]; tokens: number } => {
  const prefs: Hit[] = []
  for (const h of hits.filter(x => x.why === 'pref')) {
    if (estimateTokens([...prefs, h].map(lineOf).join('\n')) > budget) break
    prefs.push(h)
  }
  const others: Hit[] = []
  for (const h of hits.filter(x => x.why !== 'pref')) {
    if (estimateTokens([...others, h, ...prefs].map(lineOf).join('\n')) > budget) break
    others.push(h)
  }
  const chosen = [...others, ...prefs]
  const text = chosen.map(lineOf).join('\n')
  return { text, ids: chosen.map(h => h.entry.id), tokens: estimateTokens(text) }
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
