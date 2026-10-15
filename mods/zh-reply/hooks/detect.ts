export type Variant = 'zh-TW' | 'zh-CN'

export type Verdict =
  | { ok: true; reason: 'chinese' | 'too-short' }
  | { ok: false; reason: 'not-chinese' | 'simplified' | 'traditional' }

export type Counts = {
  han: number
  kana: number
  hangul: number
  /** Plain English words: letters only, not paths, flags, identifiers or file names. */
  words: number
  /** The plain words that only English prose has: the, and, is, to, of… */
  functionWords: number
  simplified: number
  traditional: number
}

/**
 * A reply with no Chinese counts as English from this many plain words with a
 * function word among them, or from LONG_WORDS plain words without one.
 */
const MIN_WORDS = 6
const LONG_WORDS = 8

const FUNCTION_WORDS = new Set(
  (
    'a i the an and or but is are was were be been being to of in on for with that this these those it its as at by ' +
    'from not no you your we our my me they their them he she his her will would can could should have has had do ' +
    'does did so if then than there here what which who when where how why all any some also just now into about ' +
    'after before because only more most other such each both'
  ).split(' '),
)

/** A token that is code rather than prose: a path, flag, file name, identifier, number or address. */
const TECHNICAL = /[/\\_@#=:]|\.[A-Za-z]|^-|[a-z][A-Z]|\d/
const WORD = /^[A-Za-z](?:[A-Za-z'-]*[A-Za-z])?$/

/**
 * Characters written one way in Simplified Chinese and another in Traditional,
 * as Simplified then Traditional. Only pairs where neither form is used in the
 * other script's ordinary text (no 后/後, 里/裡, 台/臺, 只/隻, 准/準).
 */
const PAIRS =
  '这這个個们們说說为為时時会會对對过過还還没沒问問题題来來实實现現应應该該从從让讓给給开開关關' +
  '进進运運动動东東车車门門样樣见見长長头頭话話认認识識书書写寫学學习習经經济濟国國业業产產务務' +
  '处處数數据據库庫网網页頁线線设設计計测測试試错錯误誤报報换換码碼档檔级級项項状狀态態环環变變' +
  '节節点點击擊显顯统統结結构構组組织織权權户戶号號录錄删刪输輸帮幫请請谢謝读讀区區间間闭閉华華' +
  '体體简簡两兩无無与與吗嗎觉覺发發将將当當战戰机機电電脑腦软軟证證验驗览覽链鏈释釋检檢复復杂雜' +
  '类類难難续續缓緩储儲获獲选選择擇优優质質预預历歷册冊导導编編译譯语語补補'

const SIMPLIFIED = new Set<string>()
const TRADITIONAL = new Set<string>()
for (let i = 0; i < PAIRS.length; i += 2) {
  SIMPLIFIED.add(PAIRS.charAt(i))
  TRADITIONAL.add(PAIRS.charAt(i + 1))
}

const FENCE = /^\s*(`{3,}|~{3,})/
const QUOTE = /^\s*>/

/**
 * The prose of a reply: what the model wrote in its own words. Code blocks,
 * inline code, quoted lines, link targets, URLs, HTML tags and paths are
 * dropped, since they stay in their original language.
 */
export const prose = (text: string): string => {
  const kept: string[] = []
  let fence: string | null = null
  for (const line of text.split('\n')) {
    const opens = FENCE.exec(line)?.[1]
    if (fence !== null) {
      if (opens !== undefined && opens.charAt(0) === fence.charAt(0) && opens.length >= fence.length) {
        fence = null
      }
      continue
    }
    if (opens !== undefined) {
      fence = opens
      continue
    }
    if (!QUOTE.test(line)) {
      kept.push(line)
    }
  }
  return kept
    .join('\n')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/\]\([^)\s]*\)/g, ']')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, ' ')
    .replace(/<[^>\n]+>/g, ' ')
    .replace(/(^|[\s(])(?:~|\.{1,2})?(?:\/[\w.@+-]+)+\/?/g, '$1 ')
}

const tally = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0

export const count = (text: string): Counts => {
  let simplified = 0
  let traditional = 0
  for (const char of text) {
    if (SIMPLIFIED.has(char)) simplified += 1
    else if (TRADITIONAL.has(char)) traditional += 1
  }

  let words = 0
  let functionWords = 0
  for (const run of text.match(/[\x21-\x7E]+/g) ?? []) {
    const token = run.replace(/^[(\[{"'`*<|>]+/, '').replace(/[.,;:!?)\]}"'`*>|]+$/, '')
    if (TECHNICAL.test(token) || !WORD.test(token)) continue
    const lower = token.toLowerCase()
    if (token.length === 1 && !FUNCTION_WORDS.has(lower)) continue
    words += 1
    if (FUNCTION_WORDS.has(lower)) functionWords += 1
  }

  return {
    han: tally(text, /\p{Script=Han}/gu),
    kana: tally(text, /[\p{Script=Hiragana}\p{Script=Katakana}]/gu),
    hangul: tally(text, /\p{Script=Hangul}/gu),
    words,
    functionWords,
    simplified,
    traditional,
  }
}

/**
 * Whether a reply is written in the Chinese variant asked for. English counts
 * by its function words, so file lists, commands, identifiers and status
 * words inside a Chinese reply do not make it English.
 */
export const judge = (text: string, variant: Variant): Verdict => {
  const c = count(prose(text))

  if (c.han + c.kana + c.hangul === 0) {
    const isEnglish = c.words >= LONG_WORDS || (c.words >= MIN_WORDS && c.functionWords >= 1)
    return isEnglish ? { ok: false, reason: 'not-chinese' } : { ok: true, reason: 'too-short' }
  }
  if (c.hangul >= 5 && c.hangul > c.han) return { ok: false, reason: 'not-chinese' }
  if (c.kana >= 5 && c.kana * 4 >= c.han) return { ok: false, reason: 'not-chinese' }
  if (c.functionWords >= 3 && c.han < c.functionWords * 2) return { ok: false, reason: 'not-chinese' }

  if (variant === 'zh-TW' && c.simplified >= 3 && c.simplified > c.traditional) {
    return { ok: false, reason: 'simplified' }
  }
  if (variant === 'zh-CN' && c.traditional >= 3 && c.traditional > c.simplified) {
    return { ok: false, reason: 'traditional' }
  }
  return { ok: true, reason: 'chinese' }
}

const SIMPLIFIED_NAMES = '簡體中文|简体中文|簡體字|简体字|簡體|简体|簡中|简中'
const TRADITIONAL_NAMES = '繁體中文|繁体中文|繁體字|繁体字|繁體|繁体|繁中'
const FOREIGN_NAMES = '英文|英語|英语|日文|日語|日语|韓文|韩文|韓語|韩语|法文|德文|西班牙文'
const FOREIGN_EN = 'English|Japanese|Korean|French|German|Spanish'
const EN_REPLY_VERBS = 'reply|answer|respond|write|say|explain|speak|talk|rewrite|summari[sz]e|describe'
/** What follows a language in a request: a verb of saying or writing (not 寫法, 寫的, 說明), a recipient, or the end of a clause. */
const ZH_FOLLOW =
  '(?:回答|回覆|回复|作答|重寫|重写|撰寫|撰写|講|讲|解釋|解释|寫(?![法的])|写(?![法的])|說(?![法的明])|说(?![法的明])|跟|和|對|对|給|给|向|[，,。.!！]|$)'

type Patterns = { translate: RegExp; replyIn: RegExp }

/**
 * The request patterns for one configured variant. Its own script, and plain
 * "中文" or "Chinese", are not another language: a reply in them is checked.
 */
const build = (variant: Variant): Patterns => {
  const other = variant === 'zh-TW' ? 'Simplified Chinese' : 'Traditional Chinese'
  const langs = `${variant === 'zh-TW' ? SIMPLIFIED_NAMES : TRADITIONAL_NAMES}|${FOREIGN_NAMES}`
  const enLangs = `${other}|${FOREIGN_EN}`
  return {
    translate: new RegExp(
      `(?:翻譯成|翻译成|譯成|译成|轉成|转成)\\s*(?:${langs})` +
        `|\\btranslat\\w*\\b[^.?!\\n]{0,40}\\b(?:in|into|to)\\s+(?:${enLangs})\\b`,
      'gi',
    ),
    replyIn: new RegExp(
      [
        `(?:用|改用|以|寫成|写成)\\s*(?:${langs})\\s*${ZH_FOLLOW}`,
        `(?:${langs})\\s*(?:回答|回覆|回复|作答|版|就好|就可以)`,
        `(?:${langs})\\s*(?:說明|说明)\\s*一?下`,
        `(?:講|讲|說|说)\\s*(?:${langs})`,
        `(?:寫|写|撰寫|撰写)\\s*(?:一[封篇段份個个])?\\s*(?:${langs})`,
        `\\b(?:${EN_REPLY_VERBS})\\b[^.?!\\n]{0,40}\\b(?:in|into)\\s+(?:${enLangs})\\b`,
        `\\buse\\s+(?:${enLangs})\\b`,
        `\\b(?:${enLangs})\\s+(?:version|summary|email|draft|reply|translation)\\b`,
        `\\b(?:${FOREIGN_EN})\\s*,?\\s*please\\b`,
      ].join('|'),
      'gim',
    ),
  }
}

const PATTERNS: Record<Variant, Patterns> = { 'zh-TW': build('zh-TW'), 'zh-CN': build('zh-CN') }

/** "不要用英文", "別再用英文", "don't reply in English": the request is negated. */
const NEGATED = /(?:不要|別|别|勿|不)(?:再|要|會|会)?(?:用|使用|改用|以)?\s*$|\b(?:don't|do not|never|not)\s+(?:\w+\s+)?$/i

const asks = (text: string, pattern: RegExp): boolean => {
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0
    if (!NEGATED.test(text.slice(Math.max(0, at - 16), at))) return true
  }
  return false
}

/**
 * Whether a prompt asks for its reply in a language other than the configured
 * script (another language, or the other Chinese script), or for a
 * translation into one. Such a turn is not checked, so a reply in what the
 * person asked for is never rewritten. Asking for the configured script, or
 * for plain Chinese, leaves the turn checked.
 */
export const asksForAnotherLanguage = (text: string, variant: Variant): boolean =>
  asks(text, PATTERNS[variant].translate) || asks(text, PATTERNS[variant].replyIn)
