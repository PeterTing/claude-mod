/**
 * The person's test command and what its output says per test case. crew
 * runs the command itself, on its own branch, and reads each line that names
 * a test case and says how it went; a test case no line names with a result
 * has none. Pure.
 */

import { NONE_CAUSES, type NoneCause, type NoneWhy, type TestCase } from './board'
import { fingerprint } from './prd'

export type Outcome = 'passed' | 'failed'
export type { NoneCause, NoneWhy } from './board'

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

/**
 * How a line says a test went, by the runner's own mark: at its start
 * (✓ ✕ of node, jest, vitest and mocha; ok and not ok of TAP; --- PASS and
 * --- FAIL of go; pytest's FAILED summary) or at its end (pytest -v's PASSED
 * and FAILED; ... ok, ... FAIL and ... ERROR of unittest and cargo). Words
 * inside a test's own name (PAYMENT_FAILED, ERROR state) are not a mark.
 */
const MARKS: readonly [RegExp, Outcome][] = [
  [/^\s*[✗✕✖×❌]/, 'failed'],
  // mocha numbers its failures: `1) TC-002 …`.
  [/^\s*\d+\)\s/, 'failed'],
  [/^\s*[✓✔√✅]/, 'passed'],
  [/^\s*not ok\b/, 'failed'],
  [/^\s*ok\b/, 'passed'],
  [/^\s*--- FAIL\b/, 'failed'],
  [/^\s*--- PASS\b/, 'passed'],
  [/^\s*(?:FAILED|ERROR)\b/, 'failed'],
  [/\s(?:FAILED|ERROR)(?:\s+\[\s*\d+%\])?\s*$/, 'failed'],
  [/\sPASSED(?:\s+\[\s*\d+%\])?\s*$/, 'passed'],
  [/\.\.\.\s*(?:FAIL|FAILED|ERROR)\s*$/, 'failed'],
  [/\.\.\.\s*ok\s*$/, 'passed'],
]

/** A test the runner skipped or holds as to-do (TAP's `# SKIP`, `# TODO`) did not run: it has no result. */
const SKIPPED = /#\s*(?:SKIP|TODO)\b/i

const outcomeOf = (line: string): Outcome | undefined => (SKIPPED.test(line) ? undefined : MARKS.find(([mark]) => mark.test(line))?.[1])

/**
 * The test case ids a line names, as the board writes them: `TC-001`, also
 * written `TC_001`, `tc001` or `TestTC001` in a test's name. The id must start
 * a word, or follow a lower-case letter in a name like `TestTC001`.
 */
export const idsIn = (line: string, prefix: string): string[] => {
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
    const outcome = outcomeOf(line)
    if (outcome === undefined) continue
    for (const id of named) if (out.get(id) !== 'failed') out.set(id, outcome)
  }
  return out
}

/** Which test case an id named: its title, steps, expected result and criteria, so a later one that takes the id is another. */
export const testMark = (tc: TestCase): string =>
  fingerprint(`${tc.title ?? ''}\n${(tc.steps ?? []).join('\n')}\n${tc.expected ?? ''}\n${(tc.acceptance_criteria ?? []).join(',')}`)

/** Control sequences a runner prints for colour: gone from what crew reads. */
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g

/**
 * The lines runners end with to count what ran, read trimmed: vitest's and jest's 「Test Files」「Tests」 with a count,
 * pytest's and mocha's that open on 「n passed」「n passing」, bun's 「n pass」「n fail」「Ran n tests」, node:test's
 * 「# pass n」, deno's 「ok | n passed」, RSpec's 「n examples, n failures」, cargo's 「test result:」, each in the
 * runner's own case. A test's own name, or a log line that opens on a count (「2 errors found in config」), is none
 * of them.
 */
const TOTALS = new RegExp(
  [
    '^(?:Test Files|Test Suites|Tests|Snapshots)\\s*:?\\s+\\d',
    '^test result:',
    '^\\d+ (?:passed|failed|passing|failing|errors?|skipped|warnings?)(?:,| in | \\(|$)',
    '^\\d+\\s+(?:pass|fail)$',
    '^Ran \\d+ tests? across \\d+ files?',
    '^# (?:tests|pass|fail) \\d+$',
    '^(?:ok|FAILED) \\| \\d+ passed',
    '^\\d+ examples?, \\d+ failures?',
  ].join('|'),
)

/** The runner's own totals in a run's output, the last few lines that count tests; none when it printed none crew knows. Pure. */
export const runTotals = (output: string): string[] => {
  const lines = output
    .replace(ANSI, '')
    .split('\n')
    .map(l => l.replace(/[=─━\s]+$/g, '').replace(/^[=─━\s]+/g, '').replace(/\s+/g, ' ').trim())
    .filter(l => l !== '' && l.length <= 160 && TOTALS.test(l))
  return [...new Set(lines.slice(-3))]
}

/**
 * How a run of the test command went as a whole, for the person: its exit
 * code and the runner's own totals. Pure.
 */
export const runSummary = (output: string, exit?: number): string => {
  const totals = runTotals(output)
  const code = exit === undefined ? '' : `exit ${exit}`
  if (totals.length === 0) return code === '' ? '輸出裡找不到測試總數' : `${code}，輸出裡找不到測試總數`
  return [code, ...totals].filter(x => x !== '').join('；')
}


/** A test case's reason for having no result; for one unreached or unclear, the folder its tests are in ('' the repo's root). */
export type NoResult = { why: NoneWhy; dir?: string; cause?: NoneCause }

/** A folder with tests no test command ran: the command crew suggests for it. */
export type DirHint = { suggest?: string; cause?: NoneCause; cmd?: string; rank?: number; error?: string; file?: string }

/**
 * A folder crew found a test command for, as a run's reasons read it: its
 * runner, and why its command did not run this time (`cause`, none when it
 * ran or another command runs it); the command, its place past the most
 * crew runs at once, why it could not start, and the manifest of a python
 * folder with no pytest settings.
 */
export type RowHint = { dir: string; kind: TestRoot['kind']; cause?: NoneCause; cmd?: string; rank?: number; error?: string; file?: string }

/** Test cases one command's output says were skipped: the command (only with several), their ids, and the line saying so for the first. */
export type SkipSet = { cmd?: string; ids: string[]; why: string }

/** What crew makes of the test cases a run gave no result: each one's reason, the folders' hints, and what each command skipped. */
export type NoResults = { none: Record<string, NoResult>; dirs: Record<string, DirHint>; skips?: SkipSet[] }

/** The most test commands the person can set: crew runs them one after another, each up to its own time. */
export const MAX_TEST_COMMANDS = 5

/** A folder of crew's branch a test runner works in: its path ('' the root), the kind, for npm whether package.json has a test script, and for go the module's path. */
export type TestRoot = { dir: string; kind: 'npm' | 'go' | 'py'; test?: boolean; module?: string }

/** Where crew looks for the tests that name a test case: files by the usual test names, and files in test folders; never installed packages. */
export const TEST_FILES: readonly string[] = [
  ':(glob)**/*.test.*',
  ':(glob)**/*.spec.*',
  ':(glob)**/*_test.go',
  ':(glob)**/test_*.py',
  ':(glob)**/*_test.py',
  ':(glob)**/*.e2e-spec.*',
  ':(glob)**/*_spec.rb',
  ':(glob)**/*Test.java',
  ':(glob)**/test/**',
  ':(glob)**/tests/**',
  ':(glob)**/__tests__/**',
  ':(exclude,glob)**/node_modules/**',
  ':(exclude,glob)**/vendor/**',
]

/** The files that make a folder one a test runner works in. */
export const ROOT_FILES: readonly string[] = [':(glob)**/package.json', ':(glob)**/go.mod', ':(glob)**/pyproject.toml', ':(glob)**/pytest.ini', ':(glob)**/setup.cfg', ':(exclude,glob)**/node_modules/**']

/** What git grep looks for in the test files: anything that may be a test case id with the board's prefix. */
export const idPattern = (prefix: string): string | undefined => {
  const letters = prefix.replace(/[^A-Za-z]/g, '')
  return letters === '' ? undefined : `${letters}[-_ ]?0*[0-9]+`
}

/**
 * The lines a runner marks a test it skipped or holds as to-do: TAP's
 * `# SKIP` and `# TODO`, vitest's ↓, jest's ○, `[skipped]`, go's --- SKIP,
 * pytest's SKIPPED (after a test or opening its summary), unittest's
 * `... skipped`.
 */
const SKIP_MARKS: readonly RegExp[] = [/#\s*(?:SKIP|TODO)\b/i, /^\s*[↓○]/, /\[skipped\]/i, /^\s*--- SKIP\b/, /\sSKIPPED\b/, /^\s*SKIPPED\b/, /\.\.\.\s*skipped\b/i]

/** Test case id → the first line the runner skipped it on, for the test cases given. Pure. */
export const skippedOf = (output: string, ids: readonly string[], prefix: string): Map<string, string> => {
  const known = new Set(ids)
  const out = new Map<string, string>()
  for (const raw of output.replace(ANSI, '').split('\n')) {
    if (!SKIP_MARKS.some(m => m.test(raw))) continue
    for (const id of idsIn(raw, prefix)) if (known.has(id) && !out.has(id)) out.set(id, raw.trim().slice(0, 160))
  }
  return out
}

/** Test case id → the test files that name it, from `git grep --null` (each line a path, a NUL, the line), for the test cases given. Pure. */
export const namedIn = (grep: string, ids: readonly string[], prefix: string): Map<string, string[]> => {
  const known = new Set(ids)
  const out = new Map<string, string[]>()
  for (const line of grep.split('\n')) {
    const at = line.indexOf('\0')
    if (at <= 0) continue
    const path = line.slice(0, at)
    for (const id of idsIn(line.slice(at + 1), prefix)) {
      if (!known.has(id)) continue
      const files = out.get(id) ?? []
      if (!files.includes(path)) out.set(id, [...files, path])
    }
  }
  return out
}

/** The test files `git grep --null` found anything in, each once. Pure. */
export const grepFiles = (grep: string): string[] => [...new Set(grep.split('\n').flatMap(line => (line.indexOf('\0') > 0 ? [line.slice(0, line.indexOf('\0'))] : [])))]

/** How much a runner's folder is preferred among those at the same depth: one npm can test first, then go, then python, then npm with no test script. */
const ROOT_RANK = (r: TestRoot): number => (r.kind === 'npm' && r.test === true ? 0 : r.kind === 'go' ? 1 : r.kind === 'py' ? 2 : 3)

/**
 * The runner a test file's language goes with: npm for JavaScript and
 * TypeScript (and their snapshots), go, python; `other` for a language whose
 * runner crew does not know (Ruby, Java…); none told for a data file, which
 * any runner's tests may read. Pure.
 */
export const runnerOf = (file: string): TestRoot['kind'] | 'other' | undefined => {
  if (/\.go$/.test(file)) return 'go'
  if (/\.py$/.test(file)) return 'py'
  if (/\.(?:[cm]?[jt]sx?|vue|svelte|snap)$/.test(file)) return 'npm'
  if (/\.(?:rb|java|kts?|scala|groovy|cs|fs|php|rs|swift|exs?|erl|clj|dart|c|cc|cpp|h|hpp|mm?|lua|pl)$/i.test(file)) return 'other'
  return undefined
}

/**
 * The runner's folder a file is in: the deepest of its language's runner that
 * holds it, past a package.json known to have no test script to the nearest
 * one above with a test script (a workspace's package is tested from its root;
 * one crew did not read stays, as crew cannot tell); none for a language whose
 * runner crew does not know. Pure.
 */
export const rootOf = (file: string, roots: readonly TestRoot[]): TestRoot | undefined => {
  const kind = runnerOf(file)
  if (kind === 'other') return undefined
  const holding = roots
    .filter(r => (kind === undefined || r.kind === kind) && (r.dir === '' || file.startsWith(`${r.dir}/`)))
    .sort((a, b) => b.dir.length - a.dir.length || ROOT_RANK(a) - ROOT_RANK(b))
  const [deepest] = holding
  return deepest?.kind === 'npm' && deepest.test === false ? (holding.find(r => r.kind === 'npm' && r.test === true) ?? deepest) : deepest
}

/** A folder as a command's word: quoted, with the quote it does not hold, when it holds a space or a quote. */
const word = (dir: string): string => (!/[\s'"]/.test(dir) ? dir : dir.includes('"') ? `'${dir}'` : `"${dir}"`)

/**
 * Whether crew puts a folder in a command it makes: not one with shell
 * syntax, both quotes or a control character such as a newline (no command
 * the person could type names it), nor one whose name starts with a dash (a
 * program would read it as an option).
 */
export const composable = (dir: string): boolean => !SHELL.test(dir) && !/[\0-\x1f\x7f]/.test(dir) && !(dir.includes('"') && dir.includes("'")) && !dir.split('/').some(part => part.startsWith('-'))

/**
 * The command crew suggests for a runner's folder, run from the repo's root:
 * npm's test script, or go test with -v (without it go lists no test's name);
 * none for npm with no test script, or python, whose runner a folder does not
 * say, or a folder no command crew runs can name (shell syntax, both quotes).
 */
export const suggestFor = (r: TestRoot): string | undefined => {
  if (!composable(r.dir)) return undefined
  if (r.kind === 'npm') return r.test === true ? (r.dir === '' ? 'npm test' : `npm --prefix ${word(r.dir)} test`) : undefined
  if (r.kind === 'go') return r.dir === '' ? 'go test -v ./...' : `go -C ${word(r.dir)} test -v ./...`
  return undefined
}

/** A path as a command gives it, compared with a folder of the repo: no ./ before it, no / after it, the repo's root ''. */
const plainPath = (a: string): string => {
  const p = a.replace(/\/+$/, '').replace(/^(?:\.\/)+/, '')
  return p === '.' ? '' : p
}

/** Where a command runs its program: the folder after one of the flags given ('' none given). */
const folderOf = (argv: readonly string[], flags: readonly string[]): string => {
  for (const [i, a] of argv.entries()) {
    for (const f of flags) {
      if (a === f) return plainPath(argv[i + 1] ?? '')
      if (a.startsWith(`${f}=`)) return plainPath(a.slice(f.length + 1))
    }
  }
  return ''
}

/** Whether a folder is the one given or inside it ('' the repo's root holds every folder). */
const within = (dir: string, top: string): boolean => top === '' || dir === top || dir.startsWith(`${top}/`)

/**
 * The words of a command past its program that are not flags, nor the value
 * of one of the flags given (`valued`), and whether it has a flag crew does
 * not know to change only what the runner prints (`other`): `known` tells a
 * flag, with its value when it takes the next word. `--` is no flag.
 */
const argsOf = (rest: readonly string[], valued: readonly string[], known: (flag: string, value?: string) => boolean): { words: string[]; other: boolean } => {
  const words: string[] = []
  let other = false
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] ?? ''
    if (a === '--') continue
    if (!a.startsWith('-')) {
      words.push(a)
      continue
    }
    const value = valued.includes(a) ? rest[i + 1] : undefined
    if (!known(a, value)) other = true
    if (valued.includes(a)) i++
  }
  return { words, other }
}

/**
 * Flags of npm (pnpm, yarn) itself, before `--`, that change only what is
 * printed: the folder flags crew reads, the log level and colors. Not -v: to
 * npm it prints its version and runs nothing.
 */
const PM_QUIET = /^(?:--prefix|--dir|--cwd|-C)(?:=.*)?$|^(?:--silent|-s|--quiet|-q|--verbose|--loglevel(?:=\S+)?|--colou?r(?:=\S+)?|--no-colou?r)$/
/** Of npm's, the ones whose value is the next word. */
const PM_VALUED = ['--loglevel']
/**
 * Flags of a JavaScript runner (jest, vitest, mocha), after `--`, that never
 * change which tests run: long ones alone, its reporter, verbosity, colors and
 * silence, and the common ones a CI script adds (coverage, --ci, one process,
 * no watching, workers, open handles). Short ones are not read: -v prints the
 * runner's version and runs no test. Any other (a name pattern, --shard,
 * --onlyChanged, --bail…) may run fewer.
 */
const RUNNER_QUIET = (flag: string, value?: string): boolean =>
  /^--(?:verbose|silent|ci|runInBand|passWithNoTests|detectOpenHandles|forceExit|no-watch|no-colou?rs?|colou?rs?(?:=\S+)?|coverage(?:=(?:true|false))?|reporters?=\S+|watchAll=false|watch=false|maxWorkers=\S+)$/.test(flag) ||
  ((flag === '--reporter' || flag === '--reporters') && value !== undefined)
/** Of a runner's, the ones whose value is the next word. */
const RUNNER_VALUED = ['--reporter', '--reporters']
/** go test's flags that change only what is printed or how the tests are built, timed and measured, never which run: -v, -count, -race, -timeout, -json, coverage (and -C, the folder). */
const GO_QUIET = /^--?(?:v|race|json|cover|count(?:=\d+)?|timeout(?:=\S+)?|cover(?:mode|profile|pkg)(?:=\S+)?|C(?:=.*)?)$/
/** Of go test's, the ones whose value may be the next word. */
const GO_VALUED = ['-C', '--C', '-count', '--count', '-timeout', '--timeout', '-covermode', '--covermode', '-coverprofile', '--coverprofile', '-coverpkg', '--coverpkg']
/** pytest's flags that change only what is printed or measured: verbosity, -r's summary, --tb, colors, output capture, durations, no header, coverage, and the cache plugin off. */
const PY_QUIET = (flag: string, value?: string): boolean =>
  /^(?:-v+|--verbose|-q+|--quiet|-r\S*|--tb=\S+|--colou?r=\S+|-s|--capture=\S+|--no-header|--durations=\d+|-pno:cacheprovider|--cov(?:=\S+)?|--cov-report=\S+|--no-cov)$/.test(flag) ||
  ((flag === '--tb' || flag === '--color' || flag === '--durations' || flag === '-r' || flag === '--cov' || flag === '--cov-report') && value !== undefined) ||
  (flag === '-p' && value === 'no:cacheprovider')

/** go test's flags that run part of the tests. */
const GO_PART = /^--?(?:run|skip|list)(?:=|$)/
/** pytest's flags that run part of the tests. */
const PY_PART = /^(?:-k|-m|--deselect|--ignore|--ignore-glob|--lf|--last-failed|--sw|--stepwise)(?:=|$)|^-[km]\S/
/** pytest's flags whose value is the next word. */
const PY_VALUED = ['-k', '-m', '-c', '-p', '-o', '-n', '-r', '--rootdir', '--maxfail', '--deselect', '--ignore', '--ignore-glob', '--junitxml', '--junit-xml', '--cov', '--cov-report', '--tb', '--durations', '--log-level', '--basetemp', '--confcutdir', '--color']

/** How much of the tests of a runner's folder a command runs: all of them, part (a filter, some packages), none, or crew cannot tell. */
export type Reach = 'all' | 'part' | 'none' | 'unknown'

/** uv's options whose value is the next word, before `run` or after it. */
const UV_VALUED = ['--directory', '--project', '--python', '-p', '--with', '--with-editable', '--with-requirements', '--env-file', '--group', '--extra', '--package', '--index', '--index-url', '--extra-index-url', '--config-file', '--cache-dir']
/** poetry's options whose value is the next word. */
const POETRY_VALUED = ['-C', '--directory', '-P', '--project']

/**
 * A command that runs another in a project's environment: `uv run` or
 * `poetry run`, the command it runs and the folder it runs it in (uv's
 * --directory, poetry's -C; '' the repo's root). None for any other. Pure.
 */
const unwrapped = (argv: readonly string[]): { argv: string[]; folder: string } | undefined => {
  const [program, ...rest] = argv
  if (program !== 'uv' && program !== 'poetry') return undefined
  const valued = program === 'uv' ? UV_VALUED : POETRY_VALUED
  const moves = program === 'uv' ? ['--directory'] : ['-C', '--directory']
  let folder = ''
  let i = 0
  const option = (): void => {
    const a = rest[i] ?? ''
    const named = moves.find(f => a === f || a.startsWith(`${f}=`))
    if (named !== undefined) folder = plainPath(a === named ? (rest[i + 1] ?? '') : a.slice(named.length + 1))
    i += valued.includes(a) ? 2 : 1
  }
  while (i < rest.length && rest[i] !== 'run') {
    if (!(rest[i] ?? '').startsWith('-')) return undefined
    option()
  }
  if (rest[i] !== 'run') return undefined
  i++
  while (i < rest.length && (rest[i] ?? '').startsWith('-') && rest[i] !== '--') option()
  if (rest[i] === '--') i++
  const inner = rest.slice(i)
  return inner.length === 0 ? undefined : { argv: inner, folder }
}

/**
 * How much of the tests in a folder one of the person's commands runs, as crew
 * reads the command. npm's (pnpm's, yarn's) test script in a runner's folder
 * runs them all, or part with words after it (a path, a name filter); a script
 * runs what is under its folder and never what is beside it, so another script
 * there, or a test script in a folder above (a workspace's), may run them. go
 * test in a module's folder runs them all with ./..., part with packages, -run
 * or from a folder inside it, and none of a module inside its folder. pytest
 * given the folder or one above it runs them all, given a path in it or -k
 * part. A program crew does not know may run anything. `bare`: the folder holds
 * no runner's manifest, so no command is known to run its tests at all. Pure.
 */
export const reachOf = (argv: readonly string[], r: { dir: string; kind: TestRoot['kind'] | 'other' | undefined; test?: boolean }, bare = false): Reach => reachRead(argv, r, bare).reach

/**
 * Whether a command is the folder's own runner, told to run less than all of
 * it: words after it (a path, a name filter) or a flag crew does not know
 * (a shard, only changed files, stop at the first failure). Another test file
 * of the folder in what it printed then says nothing of this one. Pure.
 */
export const narrowedOn = (argv: readonly string[], r: { dir: string; kind: TestRoot['kind'] | 'other' | undefined; test?: boolean }): boolean => reachRead(argv, r, false).narrowed

const reachRead = (argv: readonly string[], r: { dir: string; kind: TestRoot['kind'] | 'other' | undefined; test?: boolean }, bare: boolean): { reach: Reach; narrowed: boolean } => {
  // uv run and poetry run run another command, from a folder of their own when told one: the folder is the repo's root to it.
  const inner = unwrapped(argv)
  if (inner !== undefined) {
    if (inner.folder === '') return reachRead(inner.argv, r, bare)
    if (!within(r.dir, inner.folder)) return { reach: within(inner.folder, r.dir) ? 'unknown' : 'none', narrowed: false }
    return reachRead(inner.argv, { ...r, dir: r.dir === inner.folder ? '' : r.dir.slice(inner.folder.length + 1) }, bare)
  }
  // Set where the folder's own runner is told to run less than all: words after it, or a flag crew does not know.
  let narrowed = false
  const fewer = (reach: Reach): Reach => {
    narrowed = true
    return reach
  }
  const read = (): Reach => {
    const [program, ...rest] = argv
    if (program === 'npm' || program === 'pnpm' || program === 'yarn') {
      const flags = program === 'npm' ? ['--prefix'] : ['--dir', '--cwd', '-C']
      const folder = folderOf(argv, flags)
      // A command in a folder inside the runner's runs its own script there, which may run tests of the folder around it.
      if (!within(r.dir, folder)) return within(folder, r.dir) ? 'unknown' : 'none'
      // npm's own flags before `--`, the runner's after it: a flag means a different thing on each side.
      const cut = rest.indexOf('--')
      const own = argsOf(cut < 0 ? rest : rest.slice(0, cut), [...flags, ...PM_VALUED], f => PM_QUIET.test(f))
      const runner = cut < 0 ? { words: [], other: false } : argsOf(rest.slice(cut + 1), RUNNER_VALUED, RUNNER_QUIET)
      const words = [...own.words, ...runner.words]
      const other = own.other || runner.other
      const run = words[0] === 'run' || words[0] === 'run-script'
      const test = words[0] === 'test' || words[0] === 't' || (run && words[1] === 'test')
      if (!test || r.dir !== folder || r.kind !== 'npm' || r.test !== true) return 'unknown'
      // A flag crew does not know (a name pattern, a shard, only changed files…) may run fewer: crew cannot tell it runs all.
      return words.length > (run ? 2 : 1) ? fewer('part') : other ? fewer('unknown') : 'all'
    }
    if (program === 'go') {
      const folder = folderOf(argv, ['-C'])
      const { words, other } = argsOf(rest, GO_VALUED, f => GO_QUIET.test(f))
      if (words[0] !== 'test') return 'unknown'
      if (r.kind !== 'go' && r.kind !== undefined) return 'none'
      // ./... stops at a module's folder: one inside the folder the command runs in is not reached.
      if (!within(folder, r.dir)) return 'none'
      if (folder !== r.dir || words.length !== 2 || words[1] !== './...' || rest.some(a => GO_PART.test(a))) return fewer('part')
      // -short, -failfast or any flag crew does not know may run fewer, or stop early.
      return other ? fewer('unknown') : 'all'
    }
    const python = (program === 'python' || program === 'python3') && rest[0] === '-m' && rest[1] === 'pytest'
    if (program === 'pytest' || program === 'py.test' || python) {
      if (r.kind !== 'py' && r.kind !== undefined) return 'none'
      const args = python ? rest.slice(2) : rest
      const picked = args.some(a => PY_PART.test(a))
      const { words, other } = argsOf(args, PY_VALUED, PY_QUIET)
      const paths = words.map(a => plainPath(a.split('::')[0] ?? a))
      // All the folder's tests, unless a flag crew does not know (-x, --co, -n…) may run fewer or stop early.
      const whole = (): Reach => (picked ? fewer('part') : other ? fewer('unknown') : 'all')
      // Given no path, pytest collects from the repo's root, as far as the project's settings say.
      if (paths.length === 0) return r.dir === '' ? whole() : 'unknown'
      if (paths.some(p => within(r.dir, p))) return whole()
      return paths.some(p => within(p, r.dir)) ? fewer('part') : 'none'
    }
    return 'unknown'
  }
  const reach = read()
  return { reach: bare && (reach === 'all' || reach === 'part') ? 'unknown' : reach, narrowed }
}

/** The most of a folder's tests any of the commands runs: all, else part or unknown (crew cannot tell), else none. */
const mostOf = (reaches: readonly Reach[]): Reach =>
  reaches.includes('all') ? 'all' : reaches.includes('part') ? 'part' : reaches.includes('unknown') ? 'unknown' : 'none'

/** The characters crew reads a path of an output as made of. */
const PATH_CHAR = /[A-Za-z0-9_.~@+\-/]/

/**
 * The paths a run's output names, each standing apart from the characters a
 * path is made of: by their last part (a ./ before one dropped), and those a
 * space or the end follows (go's package lines); and the output itself, for a
 * path with other characters. Read once per run. Pure.
 */
const pathsIn = (text: string): { byBase: Map<string, Set<string>>; spaced: Set<string>; text: string } => {
  const byBase = new Map<string, Set<string>>()
  const spaced = new Set<string>()
  for (const m of text.matchAll(/[A-Za-z0-9_.~@+\-/]+/g)) {
    const raw = m[0]
    const next = text[(m.index ?? 0) + raw.length]
    if (next === undefined || /\s/.test(next)) spaced.add(raw)
    const path = raw.replace(/^(?:\.\/)+/, '')
    const base = path.slice(path.lastIndexOf('/') + 1)
    if (base === '') continue
    const set = byBase.get(base)
    if (set === undefined) byBase.set(base, new Set([path]))
    else set.add(path)
  }
  return { byBase, spaced, text }
}

/**
 * Whether the output names a path that has characters other than a path's
 * usual ones (a [slug] or (group) folder, a space, a letter of another
 * language) standing apart: nothing of a path just before it, but a ./ (or,
 * `inside`, the / of a longer path), and nothing of a path just after. Pure.
 */
const namedApart = (text: string, path: string, inside: boolean): boolean => {
  for (let at = text.indexOf(path); at !== -1; at = text.indexOf(path, at + 1)) {
    const before = text[at - 1]
    const after = text[at + path.length]
    // Past each ./ before it (./ and ././ are the same folder).
    let start = at
    while (start >= 2 && text.slice(start - 2, start) === './') start -= 2
    const lead = text[start - 1]
    const opens = lead === undefined || !PATH_CHAR.test(lead) || (inside && before === '/')
    if (opens && (after === undefined || !PATH_CHAR.test(after))) return true
  }
  return false
}

/**
 * Whether a run's output shows a test file ran: it names the file as a path of
 * its own, from the repo's root (also at the end of an absolute path, for one
 * in a folder), or from its runner's folder; a path that a test file of another
 * runner's folder has too says nothing of which of them ran. go names the
 * package: the module's path and the file's folder in it.
 */
const ranIn = (paths: ReturnType<typeof pathsIn>, file: string, root: TestRoot | undefined, alike: ReadonlySet<string>): boolean => {
  const rel = root === undefined || root.dir === '' ? file : file.slice(root.dir.length + 1)
  const deep = file.includes('/')
  // A path the reading above splits in parts is looked for as it is.
  const plain = !/[^A-Za-z0-9_.~@+\-/]/.test(file)
  const said = paths.byBase.get(file.slice(file.lastIndexOf('/') + 1))
  const named = (p: string, inside: boolean): boolean =>
    plain ? said !== undefined && (said.has(p) || (inside && [...said].some(x => x.endsWith(`/${p}`)))) : namedApart(paths.text, p, inside)
  if ((deep || !alike.has(file)) && named(file, deep)) return true
  if (rel !== file && !alike.has(rel) && named(rel, false)) return true
  if (!file.endsWith('_test.go') || root?.module === undefined) return false
  const pkg = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
  return paths.spaced.has(pkg === '' ? root.module : `${root.module}/${pkg}`)
}

/** Whether a run's output shows any of a folder's test files ran, as crew reads a run's output for a test file. Pure. */
export const filesShown = (output: string, files: readonly string[], root: TestRoot): boolean => {
  const paths = pathsIn(output.replace(ANSI, ''))
  return files.some(f => ranIn(paths, f, root, new Set()))
}

/**
 * Why each test case a run gave no result has none, from the run's output (its
 * commands' each), the test files on crew's branch that name it, every test
 * file there, and the folders test runners work in. A folder was run when a
 * command runs all its tests, or the output names a test file in it (a runner
 * that lists only failed files, as vitest does, still ran the others there).
 * One no command runs, as far as crew can read every command, is unreached; one
 * crew cannot tell of (a command it does not read, one that runs part of it, a
 * language whose runner it does not know, a list of test files cut short) is
 * unclear. With the folders crew found a command for (`found`), an
 * unreached one says why that command did not run (turned off, past the
 * most crew runs at once…), and crew suggests no command for a folder it has
 * one for; with no command at all, each test case is unreached because no
 * command was there to run (`nocmd`), but those of a folder whose command the
 * person turned off. Pure.
 */
export const noResultsOf = (o: {
  ids: readonly string[]
  output: string
  prefix: string
  named: ReadonlyMap<string, readonly string[]>
  roots: readonly TestRoot[]
  commands: readonly string[]
  files?: readonly string[]
  tests?: readonly string[]
  parts?: readonly { cmd: string; output: string }[]
  partial?: boolean
  found?: readonly RowHint[]
}): NoResults => {
  // Nothing ran: no command crew found or the person set (or each one crew found is turned off, or could not start).
  const idle = o.commands.length === 0 && o.found !== undefined
  // Why, for a test case no folder crew found holds: none found at all, or the person turned off every one there was.
  const runnable = (o.found ?? []).filter(r => r.cmd !== undefined)
  const idleCause: NoneCause | undefined = !idle ? undefined : runnable.length === 0 ? 'nocmd' : runnable.every(r => r.cause === 'off') ? 'alloff' : undefined
  const rowOf = (dir: string, root: TestRoot | undefined): RowHint | undefined => (root === undefined ? undefined : o.found?.find(r => r.dir === dir && r.kind === root.kind))
  const text = o.output.replace(ANSI, '')
  const parts = o.parts ?? []
  // What each command skipped, apart: with several, each says which one.
  const skips: SkipSet[] = []
  const skipped = new Set<string>()
  for (const p of parts.length > 0 ? parts : [{ cmd: '', output: text }]) {
    const found = skippedOf(p.output.replace(ANSI, ''), o.ids, o.prefix)
    const ids = [...found.keys()].filter(id => !skipped.has(id))
    if (ids.length === 0) continue
    for (const id of ids) skipped.add(id)
    if (skips.length < MAX_TEST_COMMANDS) skips.push({ ...(parts.length < 2 ? {} : { cmd: p.cmd.slice(0, 500) }), ids, why: found.get(ids[0] ?? '') ?? '' })
  }
  const argvs = o.commands.map(c => {
    const p = parseCommand(c)
    return p.ok ? p.argv : undefined
  })
  const paths = pathsIn(text)
  const roots = new Map<string, TestRoot | undefined>()
  const rootFor = (f: string): TestRoot | undefined => {
    if (!roots.has(f)) roots.set(f, rootOf(f, o.roots))
    return roots.get(f)
  }
  const seen = o.tests ?? o.files ?? [...new Set([...o.named.values()].flat())]
  // A path from a runner's folder that a test file of another runner's folder has too says nothing of which of them ran.
  const rels = new Map<string, Set<TestRoot | undefined>>()
  for (const f of seen) {
    const r = rootFor(f)
    const rel = r === undefined || r.dir === '' ? f : f.slice(r.dir.length + 1)
    rels.set(rel, new Set([...(rels.get(rel) ?? []), r]))
  }
  const alike = new Set([...rels].filter(([, rs]) => rs.size > 1).map(([rel]) => rel))
  const said = new Map<string, boolean>()
  const saidOf = (f: string): boolean => {
    if (!said.has(f)) said.set(f, ranIn(paths, f, rootFor(f), alike))
    return said.get(f) === true
  }
  const byRoot = new Map<TestRoot, string[]>()
  for (const f of seen) {
    const r = rootFor(f)
    if (r !== undefined) byRoot.set(r, [...(byRoot.get(r) ?? []), f])
  }
  const reaches = new Map<TestRoot, Reach>()
  const reachOfRoot = (r: TestRoot): Reach => {
    if (!reaches.has(r)) reaches.set(r, mostOf(argvs.map(a => (a === undefined ? 'unknown' : reachOf(a, r)))))
    return reaches.get(r) ?? 'unknown'
  }
  const ranThere = new Map<TestRoot, boolean>()
  // Another test file of the folder in the output shows its runner ran them all, unless a command told it to run fewer.
  const ran = (r: TestRoot): boolean => {
    if (!ranThere.has(r)) ranThere.set(r, reachOfRoot(r) === 'all' || (!argvs.some(a => a !== undefined && narrowedOn(a, r)) && (byRoot.get(r) ?? []).some(saidOf)))
    return ranThere.get(r) === true
  }
  const folder = (f: string): string => (f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '')
  // How a test file stands in the run: it ran, or as far as the commands reach its folder.
  const standing = (f: string): 'ran' | Reach => {
    const r = rootFor(f)
    if (saidOf(f) || (r !== undefined && ran(r))) return 'ran'
    if (r !== undefined) return reachOfRoot(r)
    return mostOf(argvs.map(a => (a === undefined ? 'unknown' : reachOf(a, { dir: folder(f), kind: runnerOf(f) }, true))))
  }
  const none: Record<string, NoResult> = {}
  const dirs: Record<string, DirHint> = {}
  for (const id of o.ids) {
    if (skipped.has(id)) {
      none[id] = { why: 'skipped' }
      continue
    }
    const files = o.named.get(id) ?? []
    const first = files[0]
    if (first === undefined) {
      // With git's list of the test files cut short, a test naming it may be in the part left out.
      none[id] = idleCause !== undefined ? { why: 'unreached', cause: idleCause } : { why: o.partial === true ? 'unclear' : 'missing' }
      continue
    }
    const stands = files.map(standing)
    if (stands.includes('ran')) {
      none[id] = { why: 'unnamed' }
      continue
    }
    const root = rootFor(first)
    const dir = root?.dir ?? folder(first)
    const row = rowOf(dir, root)
    // The folder's own command, crew's, did not run (turned off, past the most, no pytest settings, a name crew puts in
    // no command, could not start): its test cases are out of reach for that, unless another command ran part of it.
    const own = row?.cause !== undefined && OWN_CAUSES.includes(row.cause) && !stands.includes('part')
    const why: NoneWhy = idle || own || stands.every(s => s === 'none') ? 'unreached' : 'unclear'
    const cause = why !== 'unreached' ? undefined : (row?.cause ?? idleCause)
    none[id] = { why, dir, ...(cause === undefined ? {} : { cause }) }
    if (dirs[dir] === undefined) {
      // A folder crew has a command for is crew's to run: the person is told why it did not, not a command to add.
      const suggest = root === undefined || row !== undefined || idle ? undefined : suggestFor(root)
      // Unclear, a folder the root's script or the person's command was to run says so too.
      const said = cause ?? (row?.cause === 'covered' || row?.cause === 'replaced' ? row.cause : undefined)
      dirs[dir] = {
        ...(suggest === undefined ? {} : { suggest }),
        ...(said === undefined ? {} : { cause: said }),
        ...(row?.cmd === undefined ? {} : { cmd: row.cmd }),
        ...(row?.rank === undefined ? {} : { rank: row.rank }),
        ...(row?.error === undefined ? {} : { error: row.error }),
        ...(row?.file === undefined ? {} : { file: row.file }),
      }
    }
  }
  return { none, dirs, ...(skips.length === 0 ? {} : { skips }) }
}

const WHYS: readonly NoneWhy[] = ['unreached', 'skipped', 'unnamed', 'unclear', 'missing']

/** The causes that say the folder's own command, crew's, did not run: nothing else was to run it. */
const OWN_CAUSES: readonly NoneCause[] = ['off', 'over', 'norule', 'broken', 'bad']

/** What each command skipped, read back the way crew wrote it; anything else left out. Pure. */
const skipsFrom = (v: unknown): SkipSet[] => {
  if (!Array.isArray(v)) return []
  const out: SkipSet[] = []
  for (const x of v.slice(0, MAX_TEST_COMMANDS) as Partial<SkipSet>[]) {
    if (typeof x !== 'object' || x === null || typeof x.why !== 'string' || !Array.isArray(x.ids)) continue
    const ids = x.ids.filter((id): id is string => typeof id === 'string')
    if (ids.length > 0) out.push({ ...(typeof x.cmd === 'string' ? { cmd: x.cmd.slice(0, 500) } : {}), ids, why: x.why.slice(0, 160) })
  }
  return out
}

/** The reasons a stored run kept, read back the way crew wrote them; anything else left out. Pure. */
export const noResultsFrom = (v: { none?: unknown; dirs?: unknown; skips?: unknown }): Partial<NoResults> => {
  const none: Record<string, NoResult> = {}
  if (typeof v.none === 'object' && v.none !== null) {
    for (const [id, x] of Object.entries(v.none as Record<string, Partial<NoResult>>)) {
      if (typeof x !== 'object' || x === null || !WHYS.includes(x.why as NoneWhy)) continue
      none[id] = { why: x.why as NoneWhy, ...(typeof x.dir === 'string' ? { dir: x.dir } : {}), ...(x.why === 'unreached' && NONE_CAUSES.includes(x.cause as NoneCause) ? { cause: x.cause as NoneCause } : {}) }
    }
  }
  const dirs: Record<string, DirHint> = {}
  if (typeof v.dirs === 'object' && v.dirs !== null) {
    for (const [dir, x] of Object.entries(v.dirs as Record<string, Partial<DirHint>>)) {
      if (typeof x !== 'object' || x === null) continue
      dirs[dir] = {
        ...(typeof x.suggest === 'string' ? { suggest: x.suggest } : {}),
        ...(NONE_CAUSES.includes(x.cause as NoneCause) ? { cause: x.cause as NoneCause } : {}),
        ...(typeof x.cmd === 'string' ? { cmd: x.cmd.slice(0, 500) } : {}),
        ...(typeof x.rank === 'number' && Number.isInteger(x.rank) && x.rank > 0 ? { rank: x.rank } : {}),
        ...(typeof x.error === 'string' ? { error: x.error.slice(0, 300) } : {}),
        ...(typeof x.file === 'string' ? { file: x.file.slice(0, 300) } : {}),
      }
    }
  }
  const skips = skipsFrom(v.skips)
  return {
    ...(Object.keys(none).length === 0 ? {} : { none }),
    ...(Object.keys(dirs).length === 0 ? {} : { dirs }),
    ...(skips.length === 0 ? {} : { skips }),
  }
}

/** A folder as the person reads it: the repo's root by name. */
export const dirSaid = (dir: string): string => (dir === '' ? '專案根目錄' : dir)

/** Why no command ran an unreached test case's folder, as the person reads it after 沒跑到. */
export const causeSaid = (cause: NoneCause, dir: string | undefined): string => {
  const where = dirSaid(dir ?? '')
  if (cause === 'off') return `你關掉了 crew 找到的 ${where} 這條`
  if (cause === 'over') return `${where} 那條超過一次最多跑的 ${MAX_TEST_COMMANDS} 條，這次沒排進去`
  if (cause === 'norule') return `crew 看不出 ${where} 的 python 測試怎麼跑（沒有 pytest 設定）`
  if (cause === 'broken') return `crew 找到的 ${where} 這條跑不起來`
  if (cause === 'bad') return `${where} 的資料夾名稱有 crew 不放進指令的字元，crew 不幫它組指令`
  if (cause === 'covered') return `${where} 由根目錄那條測試指令一起跑，但它的輸出裡看不到 ${where} 的測試，crew 下次會把 ${where} 這條加回來單獨跑`
  if (cause === 'replaced') return `${where} 由你設定的指令取代，你的指令沒有跑出這裡的測試`
  if (cause === 'alloff') return 'crew 找到的測試指令都被你關掉了，你也沒有設定自己的，沒有跑'
  return 'crew 在專案找不到測試指令，你也沒有設定，沒有跑'
}

/** Why a test case has no result, as one line for the person. */
export const noneSaid = (n: { why: NoneWhy; dir?: string; cause?: NoneCause }): string =>
  n.why === 'unreached' && n.cause !== undefined
    ? `沒跑到：${causeSaid(n.cause, n.dir)}`
    : n.why === 'unreached'
    ? `沒跑到：測試在 ${dirSaid(n.dir ?? '')}，你的測試指令沒跑那裡`
    : n.why === 'skipped'
      ? '被跳過：測試有跑到，但輸出寫它被跳過'
      : n.why === 'unnamed'
        ? '有跑到，但輸出沒有列出這個編號的結果'
        : n.why === 'unclear'
          ? n.dir === undefined
            ? '看不出有沒有跑到：crew 找測試檔的結果太長被截斷，可能在沒列出的部分'
            : `看不出有沒有跑到：測試在 ${dirSaid(n.dir)}，從你的測試指令和輸出都看不出有沒有跑那裡`
          : '找不到測試：crew 分支上沒有測試檔寫這個編號'

/** One test command as it ran: the command as shown (masked), its exit code, how long it ran in milliseconds, all it printed (masked), and whether crew found it in the project (`found`) or the person set it. */
export type PartOut = { cmd: string; exit: number; ms: number; output: string; found?: true }

/** How one command of a run went, as crew keeps it: its exit code, how long it ran, the runner's totals in a line, whether it printed any, and whether crew found it. */
export type PartSum = { cmd: string; exit: number; ms: number; sum: string; counted: boolean; found?: true }

/** A while as the person reads it: seconds, or minutes and seconds. */
export const durationSaid = (ms: number): string => {
  const secs = Math.max(0, Math.round(ms / 1000))
  return secs < 60 ? `${secs} 秒` : `${Math.floor(secs / 60)} 分${secs % 60 === 0 ? '' : ` ${secs % 60} 秒`}`
}

/** The overall result of a run for the person: the one command's, or a line per command, each saying whose it is when crew's and the person's ran together. Pure. */
export const summaryOf = (sums: readonly PartSum[]): string => {
  const [only] = sums
  if (sums.length === 1 && only !== undefined) return only.sum
  const mixed = sums.some(s => s.found === true) && sums.some(s => s.found !== true)
  const whose = (s: PartSum): string => (!mixed ? '' : s.found === true ? '（crew 從專案找到的）' : '（使用者設定的）')
  return sums.map((s, i) => `${i + 1}. ${s.cmd}${whose(s)}：${s.sum}`).join('\n')
}

/**
 * A run of the person's test commands taken as one: each test case's result
 * (a failure in any command wins); the exit code, that of a command that may
 * have stopped short (not 0, no failure of its own, and no totals or no
 * result), else the first not 0, else 0; whether the run counts as one that
 * went to its end (one printed totals, every one not 0 printed its own,
 * and none may have stopped short); the overall result; each command's own; and the output's end, a
 * share per command. Pure.
 */
export const combined = (parts: readonly PartOut[], ids: readonly string[], prefix: string, tail: number) => {
  const each = parts.map(p => ({ p, found: resultsOf(p.output, ids, prefix), counted: runTotals(p.output).length > 0 }))
  const results = new Map<string, Outcome>()
  for (const e of each) for (const [id, r] of e.found) if (results.get(id) !== 'failed') results.set(id, r)
  // The command each pass came from (the first that passed it), for G6's count of where passes come from.
  const by = new Map<string, number>()
  for (const [i, e] of each.entries()) for (const [id, r] of e.found) if (r === 'passed' && results.get(id) === 'passed' && !by.has(id)) by.set(id, i)
  const cut = each.find(e => e.p.exit !== 0 && ![...e.found.values()].includes('failed') && (!e.counted || e.found.size === 0))
  const exit = cut?.p.exit ?? parts.find(p => p.exit !== 0)?.exit ?? 0
  // A command that exited 0 ran to its end, totals or not (go test prints none): the run did when at least one printed totals.
  const counted = cut === undefined && each.some(e => e.counted) && each.every(e => e.p.exit === 0 || e.counted)
  const sums: PartSum[] = each.map(e => ({ cmd: e.p.cmd, exit: e.p.exit, ms: e.p.ms, sum: runSummary(e.p.output, e.p.exit), counted: e.counted, ...(e.p.found === true ? { found: true as const } : {}) }))
  return { results, by, exit, counted, summary: summaryOf(sums), sums, output: outputTail(parts, tail) }
}

/** A word as a regular expression matches it, and nothing else. */
const literal = (w: string): string => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * What npm, pnpm, yarn, uv, poetry, corepack and node print of their own
 * around a runner: warnings and notices, a lifecycle failing, packages
 * checked or a virtual environment made, node's own lines above an error it
 * throws. Never what a runner prints.
 */
const NOISE: readonly RegExp[] = [
  /^npm (?:warn|WARN|notice|NOTICE|error|ERR!|info|http|timing|verb|verbose|sill|silly)\b/,
  /^yarn run v\d/,
  /^info (?:Visit|There appears)\b/,
  /^error Command failed with exit code \d+\.?$/,
  /^warning\b/,
  /^(?:✨\s+)?Done in [\d.]+m?s\b/,
  /^Already up to date$/,
  /^Lockfile is up to date\b/,
  /^(?:\[ELIFECYCLE\]|ELIFECYCLE)\s/,
  /^\[?ERR_PNPM_[A-Z_]+\]?/,
  /^\[?WARN\]?\s/,
  /^Progress: resolved \d/,
  /^Packages: [+-]\d/,
  /^[+-]{3,}$/,
  /^Scope: /,
  /^! Corepack is about to download\b/,
  /^Using (?:CPython|Python|PyPy) /,
  /^Creating virtual ?env/,
  /^(?:Resolved|Prepared|Installed|Uninstalled|Audited) \d/,
  /^Bytecode compiled/,
  /^node:internal\/\S+:\d+$/,
  /^throw err;$/,
  /^throw new ERR_[A-Z_]+\($/,
  /^internalBinding\('errors'\)\.triggerUncaughtException\($/,
  /^\^+$/,
]

/** A script's banner (npm's and pnpm's `> name@1.0.0 test` and `> vitest run`, yarn's and pnpm's `$ vitest run`): the first two lines of a stream at most. */
const BANNER = /^(?:> |\$ )/

/** npm's and pnpm's head of a script it runs, `> name@1.0.0 pretest` (a scope, a folder after it, and all): with the `> ` line after it, one script's banner. */
const SCRIPT_HEAD = /^> (?:@[^\s@/]+\/)?[^\s@]+@\S+ \S+/

/**
 * The first line a stream holds past what launchers print of their own,
 * trimmed; none when it holds no other. npm runs each of a script's pre and
 * post scripts with a banner of its own (its head and its command), as many as
 * there are; any other banner line goes only twice. Pure.
 */
const firstOwn = (stream: string): string | undefined => {
  let banners = 0
  let head = false
  for (const raw of stream.split('\n')) {
    const line = raw.trim()
    if (line === '' || NOISE.some(x => x.test(line))) continue
    if (SCRIPT_HEAD.test(line)) {
      head = true
      continue
    }
    if (head && line.startsWith('> ')) {
      head = false
      continue
    }
    head = false
    if (BANNER.test(line) && banners < 2) {
      banners++
      continue
    }
    return line
  }
  return undefined
}

/** The launchers that end with an exit code of their own when the script's shell could not find a command (pnpm 1, yarn its own). */
const OWN_EXIT = new Set(['pnpm', 'yarn'])

/**
 * Why a command crew found started but could not run any test, as what it
 * printed says: the runner it calls (`runner`: the test script's first
 * command, pytest) is not installed here, or its own package is there only in
 * part, as the shell, node or python says, or uv or poetry (`launcher`) could
 * not start it. Only for a run that ended not 0, printed no totals and failed
 * no test case. stdout and stderr are read apart, past what npm, pnpm, yarn,
 * uv, corepack and node print of their own (yarn's notes on stdout come out
 * before the shell's line on stderr): one of them begins with the line that
 * says so, and the other has nothing of its own. A runner that is not there
 * prints nothing before it, while one that started and then broke (a config
 * importing what is not there, a crash, a test module's own import) printed
 * its own lines first, and stays the run's. Whole lines alone count: the
 * shell's not found (exit 127, or the exit code pnpm or yarn end with), cmd's
 * not recognized, node's for the runner's own package in node_modules (or
 * imported from it), node's for the runner by itself, python naming the
 * program and pytest. A run read as one (`output`) is one stream. The line
 * that says so; none when it is not such a run. Pure.
 */
export const runnerMissing = (out: { exit: number; output?: string; stdout?: string; stderr?: string }, runner: string | undefined, ids: readonly string[], prefix: string, launcher?: string): string | undefined => {
  if (out.exit === 0) return undefined
  const streams = (out.stdout === undefined && out.stderr === undefined ? [out.output ?? ''] : [out.stdout ?? '', out.stderr ?? '']).map(x => x.replace(ANSI, ''))
  const text = streams.join('\n')
  if (runTotals(text).length > 0 || [...resultsOf(text, ids, prefix).values()].includes('failed')) return undefined
  const own = streams.map(firstOwn).filter((l): l is string => l !== undefined)
  const [first] = own
  if (own.length !== 1 || first === undefined) return undefined
  const signs: RegExp[] = []
  if (runner !== undefined && runner !== '') {
    const r = literal(runner)
    // sh, bash and dash say a command is not found (`sh: vitest: command not found`, `sh: 1: vitest: not found`), zsh the other way round:
    // with exit 127, or with the exit code pnpm or yarn end with for a script that failed.
    if (out.exit === 127 || (launcher !== undefined && OWN_EXIT.has(launcher))) {
      signs.push(new RegExp(`^[\\w./-]*sh: (?:line \\d+: |\\d+: )?${r}: (?:command )?not found$`), new RegExp(`^[\\w./-]*sh:\\d*:? ?command not found: ${r}$`))
    }
    // cmd on Windows, its whole line.
    signs.push(new RegExp(`^'${r}' is not recognized as an internal or external command,?$`))
    // node, for the runner's own package gone from node_modules, or the runner itself: not a module the project imports from it.
    signs.push(new RegExp(`^(?:Error: )?Cannot find module '(?:[^']*[/\\\\])?node_modules[/\\\\]${r}[/\\\\][^']*'$`), new RegExp(`^(?:Error: )?Cannot find module '${r}'$`))
    // node's ESM loader, for a file of the runner's own package that one of its own files imports: the package there only in part.
    signs.push(new RegExp(`^Error \\[ERR_MODULE_NOT_FOUND\\]: Cannot find (?:module|package) '(?:[^']*[/\\\\])?node_modules[/\\\\]${r}[/\\\\][^']*' imported from .*[/\\\\]node_modules[/\\\\]${r}[/\\\\][^/\\\\]+(?:[/\\\\][^/\\\\]+)*$`))
    // python -m with pytest not installed: the program, its path spaces and all, and the module named bare.
    signs.push(new RegExp(`^(?:.*[/\\\\])?python[\\d.]*(?:\\.exe)?: No module named ${r}$`))
  }
  if (launcher === 'uv') signs.push(/^error: Failed to spawn: `[^`]+`$/)
  if (launcher === 'poetry') signs.push(/^Command not found: \S+$/)
  return signs.some(x => x.test(first)) ? first.slice(0, 300) : undefined
}

/** A command crew found that did not run: as shown, its exit code when it started (its runner not installed), and why. */
export type Stopped = { cmd: string; exit?: number; why: string }

/** The found commands that could not run, each with how it ended, on one line. Pure. */
export const stoppedSaid = (stopped: readonly Stopped[]): string => stopped.map(s => `${s.cmd} ${s.exit === undefined ? '沒辦法啟動' : `exit ${s.exit}`}`).join('；')

/**
 * The overall result of a run with the commands crew found that did not run:
 * a line for each after those that ran, with its exit code (none when it
 * could not start at all) and why; as summaryOf when none. Pure.
 */
export const summaryWith = (sums: readonly PartSum[], stopped: readonly Stopped[]): string => {
  if (stopped.length === 0) return summaryOf(sums)
  const why = (s: Stopped): string => `跑不起來（${s.exit === undefined ? '沒辦法啟動' : `exit ${s.exit}`}：${s.why}）`
  const [one] = stopped
  if (sums.length === 0 && stopped.length === 1 && one !== undefined) return `${one.cmd}：${why(one)}`
  const mixed = sums.some(s => s.found !== true)
  const whose = (found: boolean): string => (!mixed ? '' : found ? '（crew 從專案找到的）' : '（使用者設定的）')
  return [...sums.map(s => `${s.cmd}${whose(s.found === true)}：${s.sum}`), ...stopped.map(s => `${s.cmd}${whose(true)}：${why(s)}`)].map((l, i) => `${i + 1}. ${l}`).join('\n')
}

/** The end of what a run printed, for the full-stack: the one command's, or a share of each command's under its name. Pure. */
export const outputTail = (parts: readonly { cmd: string; exit: number; output: string }[], tail: number): string => {
  const [only] = parts
  if (parts.length === 1 && only !== undefined) return only.output.slice(-tail)
  const share = Math.max(200, Math.floor(tail / Math.max(1, parts.length)))
  return parts
    .map((p, i) => `## [${i + 1}/${parts.length}] $ ${p.cmd}（exit ${p.exit}）\n${p.output.slice(-share)}`)
    .join('\n\n')
    .slice(-tail)
}

/** One command's log: what ran, where, on which commit, how it ended, and all it printed. */
const oneLog = (cmd: string, where: string, sha: string, exit: number, output: string, stopped = ''): string => `$ ${cmd}\n# ${where}\n# commit ${sha}\n# exit ${exit}\n${stopped}\n${output}`

/** The head's lines for the found commands that could not run, each with how it ended and why (none: no line). Pure. */
const stoppedLines = (stopped: readonly Stopped[]): string =>
  stopped.map(s => `# 跑不起來（crew 從專案找到的）：${s.cmd}：${s.exit === undefined ? '沒辦法啟動' : `exit ${s.exit}`}：${s.why}\n`).join('')

/** The log a command of a run of several keeps of its own, by the run's name and the command's place (1 the first). */
export const partLog = (run: string, i: number): string => `${run}-${i + 1}`

/**
 * A run's logs, the evidence in .crew/runs, by name: one command's reads as
 * it did before there could be several; with several, each command keeps a
 * log of its own, and the run's own log says what ran, where, on which
 * commit, how it ended, and where each command's log is. A found command
 * that could not run is a line in the head, with how it ended and why;
 * with none run, the run has no exit code of its own and the head says so. Pure.
 */
export const runLogs = (parts: readonly PartOut[], where: string, sha: string, exit: number, name: string, stopped: readonly Stopped[] = []): { name: string; text: string }[] => {
  const [only] = parts
  if (parts.length === 1 && only !== undefined) return [{ name, text: oneLog(only.cmd, where, sha, exit, only.output, stoppedLines(stopped)) }]
  const ended = parts.length === 0 && stopped.length > 0 ? '# 沒有一條測試指令跑得起來' : `# exit ${exit}`
  const head = `${parts.map(p => `$ ${p.cmd}\n`).join('')}# ${where}\n# commit ${sha}\n${ended}\n${stoppedLines(stopped)}${parts.length === 0 ? '' : `\n每一條測試指令的紀錄：\n${parts.map((p, i) => `${i + 1}. .crew/runs/${partLog(name, i)}.log（exit ${p.exit}・${durationSaid(p.ms)}）`).join('\n')}\n`}`
  return [{ name, text: head }, ...parts.map((p, i) => ({ name: partLog(name, i), text: oneLog(p.cmd, where, sha, p.exit, p.output) }))]
}

/** What a command's log holds after its head: all the command printed. Pure. */
export const logOutput = (log: string): string => {
  const at = log.indexOf('\n\n')
  return at < 0 ? '' : log.slice(at + 2)
}

/** Whether a package.json gives `npm test` a script of its own: npm's placeholder that only says none is there is none. Pure. */
export const testScriptIn = (packageJson: string): boolean => {
  try {
    const test = (JSON.parse(packageJson) as { scripts?: { test?: unknown } } | null)?.scripts?.test
    return typeof test === 'string' && test.trim() !== '' && !/no test specified/i.test(test)
  } catch {
    return false
  }
}

/** The runner a folder's manifest names: package.json for npm, go.mod for go, the rest for pytest. */
export const kindOf = (path: string): TestRoot['kind'] => {
  const base = path.split('/').pop() ?? path
  return base === 'package.json' ? 'npm' : base === 'go.mod' ? 'go' : 'py'
}
