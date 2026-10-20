/**
 * The person's test command and what its output says per test case. crew
 * runs the command itself, on its own branch, and reads each line that names
 * a test case and says how it went; a test case no line names with a result
 * has none. Pure.
 */

import type { TestCase } from './board'
import { fingerprint } from './prd'

export type Outcome = 'passed' | 'failed'

/** Shell syntax the command may not hold: crew runs one program by its words, never a shell. */
const SHELL = /[|;&<>`]|\$\(/

/** The command as the program and its arguments: words split on spaces, quotes kept together. */
export const parseCommand = (text: string): { ok: true; argv: string[] } | { ok: false; error: string } => {
  const t = text.trim()
  if (t === '') return { ok: false, error: '請寫一個指令，例如 npm test。' }
  if (SHELL.test(t)) return { ok: false, error: 'crew 不經過 shell 執行，指令裡不能有 |、;、&、<、>、` 或 $(…)。請寫成單一指令，例如 npm test。' }
  const argv: string[] = []
  let word = ''
  let quote: string | undefined
  let started = false
  for (const ch of t) {
    if (quote !== undefined) {
      if (ch === quote) quote = undefined
      else word += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      started = true
    } else if (/\s/.test(ch)) {
      if (started) argv.push(word)
      word = ''
      started = false
    } else {
      word += ch
      started = true
    }
  }
  if (quote !== undefined) return { ok: false, error: '指令裡有沒有收尾的引號。' }
  if (started) argv.push(word)
  if (argv.length > 64 || argv.some(a => a.length > 500)) return { ok: false, error: '指令太長了。' }
  return { ok: true, argv }
}

/** Words that say a test failed: in capitals as runners print them, so a test's own title ("handles failure") is not one. */
const FAIL = /(?:^|[^A-Za-z])(?:FAIL(?:ED|URE|S)?|ERROR|not ok)(?:[^A-Za-z]|$)|[✗✕✖×❌]/
const PASS = /(?:^|[^A-Za-z])(?:PASS(?:ED)?|ok)(?:[^A-Za-z]|$)|[✓✔√✅]/

/**
 * The test case ids a line names, as the board writes them: `TC-001`, also
 * written `TC_001`, `tc001` or `TestTC001` in a test's name. The id must start
 * a word, or follow a lower-case letter in a name like `TestTC001`.
 */
const idsIn = (line: string, prefix: string): string[] => {
  const letters = prefix.replace(/[^A-Za-z]/g, '')
  if (letters === '') return []
  const out: string[] = []
  for (const m of line.matchAll(new RegExp(`${letters}[-_ ]?0*(\\d+)(?!\\d)`, 'gi'))) {
    const at = m.index ?? 0
    const before = at === 0 ? '' : (line[at - 1] ?? '')
    const starts = before === '' || !/[A-Za-z0-9]/.test(before) || (/[a-z]/.test(before) && m[0].startsWith(letters.toUpperCase()))
    if (starts) out.push(`${prefix}${(m[1] ?? '').padStart(3, '0')}`)
  }
  return out
}

/** Test case id → how it went, for the board's test cases a line names with a result: a failure anywhere wins over a pass. */
export const resultsOf = (output: string, ids: readonly string[], prefix: string): Map<string, Outcome> => {
  const known = new Set(ids)
  const out = new Map<string, Outcome>()
  for (const line of output.split('\n')) {
    const named = idsIn(line, prefix).filter(id => known.has(id))
    if (named.length === 0) continue
    const outcome: Outcome | undefined = FAIL.test(line) ? 'failed' : PASS.test(line) ? 'passed' : undefined
    if (outcome === undefined) continue
    for (const id of named) if (out.get(id) !== 'failed') out.set(id, outcome)
  }
  return out
}

/** Which test case an id named: its title, steps, expected result and criteria, so a later one that takes the id is another. */
export const testMark = (tc: TestCase): string =>
  fingerprint(`${tc.title ?? ''}\n${(tc.steps ?? []).join('\n')}\n${tc.expected ?? ''}\n${(tc.acceptance_criteria ?? []).join(',')}`)
