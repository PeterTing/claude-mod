/**
 * The test commands crew finds in the project on its own: each folder whose
 * package.json has a test script, each go.mod, each python folder with pytest
 * settings, as of a commit of crew's branch. A command is made from a fixed
 * template for its runner, never copied from the repo (no README, Makefile or
 * CI file is read as a command), and runs with no shell. The person's own
 * commands go first and take the places of the most crew runs at once; one of
 * theirs that crew can tell runs a folder's whole tests runs it in place of
 * crew's. Pure, but for the scan, which reads git through the runner given.
 */

import type { NoneCause } from './board'
import { composable, idPattern, MAX_TEST_COMMANDS, reachOf, rootOf, runnerOf, TEST_FILES, testScriptIn, type RowHint, type TestRoot } from './runs'

/** The manifests and lock files crew reads a folder's runner from. */
export const MANIFESTS: readonly string[] = ['package.json', 'go.mod', 'pyproject.toml', 'pytest.ini', 'setup.cfg', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'uv.lock', 'poetry.lock']

/** What git lists them by: every folder's, none in node_modules or vendor. */
const MANIFEST_SPECS: readonly string[] = [...MANIFESTS.map(m => `:(glob)**/${m}`), ':(exclude,glob)**/node_modules/**', ':(exclude,glob)**/vendor/**']

/** The most manifests crew reads at a scan, the folders nearest the repo's root first. */
export const FOUND_READ = 40

/** The test files a found command's folder keeps, for telling whether another command's output shows them. */
const FILES_KEPT = 40

/** The longest a script or module crew shows from a manifest. */
const SHOWN = 80

/** A folder's runner as its command calls it: npm, pnpm or yarn for a package.json; go; python, uv or poetry for pytest. */
export type FoundTool = 'npm' | 'pnpm' | 'yarn' | 'go' | 'python' | 'uv' | 'poetry'

/**
 * A folder crew found tests and a runner for, as the scan read it: its key
 * (runner and folder: the person's turning it off stays with it), the
 * command crew makes for it (none for python with no pytest settings, or a
 * folder crew puts in no command), where it came from, whether its tests name
 * test case ids, a few of its test files, and an npm folder's test script.
 */
export type FoundScanRow = {
  key: string
  kind: TestRoot['kind']
  dir: string
  tool?: FoundTool
  argv?: string[]
  /** The manifest it came from, and what in it ('' for one whose name says it, as pytest.ini). */
  file: string
  said: string
  tc?: true
  files?: string[]
  /** npm's test script, as the manifest has it. */
  script?: string
  module?: string
  /** Python tests, and no pytest settings in their folder or above. */
  norule?: true
  /** A folder whose name crew puts in no command (composable). */
  bad?: true
}

/** A scan: the commit it read, when, the folders found, and whether there were more manifests than crew reads. */
export type FoundScan = { sha: string; at: number; rows: FoundScanRow[]; cut?: true }

/**
 * Where a found folder stands this time: its command runs (`run`), the
 * person turned it off (`off`), one of the person's commands runs its whole
 * tests (`replaced`), the root's test script runs it (`covered`), crew makes
 * no command for it (`norule`, `bad`), or it is past the most crew runs at
 * once (`over`).
 */
export type FoundStatus = 'run' | 'off' | 'replaced' | 'covered' | 'norule' | 'bad' | 'over'

/** A found folder planned: its place among those that run (`n`, 1 the first), its place in the queue past the most crew runs (`rank`), the person's command that runs it instead (`by`, 1 the first of theirs), and whether it was added back because the root's run showed none of its tests (`back`). */
export type FoundRow = FoundScanRow & { status: FoundStatus; n?: number; rank?: number; by?: number; back?: true }

/** The plan of a run: each found folder in order, those whose commands run in order, and how many commands run in all. */
export type FoundPlan = { rows: FoundRow[]; run: FoundRow[]; user: number; total: number }

/** How a command crew runs from its own folder reads: one that runs another (uv, poetry) is a word of its own. */
const shownArgv = (argv: readonly string[]): string => argv.map(a => (a === '' || /[\s"']/.test(a) ? (a.includes('"') ? `'${a}'` : `"${a}"`) : a)).join(' ')

/** A found row's command as the person reads it. */
export const foundCmd = (r: Pick<FoundScanRow, 'argv'>): string => (r.argv === undefined ? '' : shownArgv(r.argv))

const base = (path: string): string => path.slice(path.lastIndexOf('/') + 1)
const dirOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
const depth = (dir: string): number => (dir === '' ? 0 : dir.split('/').length)
/** Whether a folder is the one given or inside it ('' holds every folder). */
const inside = (dir: string, top: string): boolean => top === '' || dir === top || dir.startsWith(`${top}/`)
/** A path crew does not look in: packages installed, vendored code, git's own. */
const skipped = (path: string): boolean => path.split('/').some(p => p === 'node_modules' || p === 'vendor' || p === '.git')

/** Whether a path is a test file as TEST_FILES has them. Pure. */
export const isTestFile = (path: string): boolean => {
  if (path === '' || skipped(path)) return false
  const name = base(path)
  if (/\.(?:test|spec|e2e-spec)\.[^/]+$/.test(name) || /_test\.go$/.test(name) || /^test_.*\.py$/.test(name) || /_test\.py$/.test(name) || /_spec\.rb$/.test(name) || /Test\.java$/.test(name)) return true
  return path.split('/').slice(0, -1).some(p => p === 'test' || p === 'tests' || p === '__tests__')
}

/** Whether a manifest's text holds pytest settings: pyproject.toml's [tool.pytest.ini_options], setup.cfg's [tool:pytest]. Pure. */
export const pytestIn = (file: string, text: string): boolean => {
  const name = base(file)
  if (name === 'pytest.ini') return true
  if (name === 'pyproject.toml') return /^\s*\[\s*tool\.pytest\.ini_options\s*\]/m.test(text)
  if (name === 'setup.cfg') return /^\s*\[\s*tool:pytest\s*\]/m.test(text)
  return false
}

/** npm's test script in a package.json, cut to SHOWN; none when there is none. Pure. */
const scriptIn = (text: string): string | undefined => {
  try {
    const test = (JSON.parse(text) as { scripts?: { test?: unknown } } | null)?.scripts?.test
    return typeof test === 'string' ? test.trim().replace(/\s+/g, ' ').slice(0, SHOWN) : undefined
  } catch {
    return undefined
  }
}

/** The tool of the lock nearest a folder (its own, else one above): pnpm's, yarn's or npm's for JavaScript; uv's or poetry's for python. */
const lockOf = (dir: string, locks: ReadonlyMap<string, readonly string[]>, order: readonly [string, FoundTool][]): { tool: FoundTool; at: string } | undefined => {
  for (let at: string | undefined = dir; at !== undefined; at = at === '' ? undefined : dirOf(at)) {
    const here = locks.get(at) ?? []
    const hit = order.find(([file]) => here.includes(file))
    if (hit !== undefined) return { tool: hit[1], at }
  }
  return undefined
}

const JS_LOCKS: readonly [string, FoundTool][] = [['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['package-lock.json', 'npm']]
const PY_LOCKS: readonly [string, FoundTool][] = [['uv.lock', 'uv'], ['poetry.lock', 'poetry']]

/**
 * The command crew makes for a folder, from its runner's fixed template, run
 * from the repo's root: the test script with npm --prefix, pnpm --dir or
 * yarn --cwd; go test -v ./... in the module's folder; pytest -v on the
 * folder, in uv's or poetry's environment when the project has their lock
 * (from the lock's folder when it is not the root's). Pure.
 */
export const commandFor = (tool: FoundTool, dir: string, lockAt = ''): string[] => {
  if (tool === 'npm') return dir === '' ? ['npm', 'test'] : ['npm', '--prefix', dir, 'test']
  if (tool === 'pnpm') return dir === '' ? ['pnpm', 'test'] : ['pnpm', '--dir', dir, 'test']
  if (tool === 'yarn') return dir === '' ? ['yarn', 'test'] : ['yarn', '--cwd', dir, 'test']
  if (tool === 'go') return dir === '' ? ['go', 'test', '-v', './...'] : ['go', '-C', dir, 'test', '-v', './...']
  const rel = lockAt === '' ? dir : dir === lockAt ? '' : dir.slice(lockAt.length + 1)
  const pytest = ['python', '-m', 'pytest', '-v', ...(rel === '' ? [] : [rel])]
  if (tool === 'uv') return lockAt === '' ? ['uv', 'run', ...pytest] : ['uv', '--directory', lockAt, 'run', ...pytest]
  if (tool === 'poetry') return lockAt === '' ? ['poetry', 'run', ...pytest] : ['poetry', '-C', lockAt, 'run', ...pytest]
  return ['python3', '-m', 'pytest', '-v', ...(dir === '' ? [] : [dir])]
}

/**
 * The program a found command runs the tests with, as what it prints names
 * it when it is not installed: npm's test script's first command (past
 * NAME=value settings), pytest for python. None for go, which is its own.
 * Pure.
 */
export const runnerName = (r: Pick<FoundScanRow, 'kind' | 'script'>): string | undefined => {
  if (r.kind === 'py') return 'pytest'
  if (r.kind !== 'npm' || r.script === undefined) return undefined
  const first = r.script.split(/\s+/).find(w => w !== '' && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w))
  return first === undefined || !/^[A-Za-z0-9@._/-]+$/.test(first) ? undefined : first.slice(first.lastIndexOf('/') + 1)
}

/** What the scan reads git with: a command's words past `git`, run in the folder scanned. */
export type GitRun = (args: string[]) => Promise<{ exitCode: number; stdout: string; isStdoutTruncated?: boolean }>

/** The paths a `git ls-files -z` or `git grep -l -z` printed, each once, none crew does not look in: NUL ends each, so a name with a newline in it stays whole. */
const pathsOf = (stdout: string): string[] => [...new Set(stdout.split('\0').filter(p => p !== '' && !skipped(p)))]

/**
 * Reads the project at the scanned folder's commit (HEAD): its manifests, its
 * test files, and those that name a test case id, and makes a found row for
 * each folder that holds tests of a runner crew knows. Only manifests of a
 * folder that holds tests are read, at most FOUND_READ, the nearest the root
 * first. Undefined when git could not list the files.
 */
export async function scanFound(git: GitRun, prefix: string): Promise<{ rows: FoundScanRow[]; cut?: true } | undefined> {
  const listed = await git(['ls-files', '-z', '--', ...MANIFEST_SPECS])
  if (listed.exitCode !== 0) return undefined
  const manifests = pathsOf(listed.stdout).filter(p => MANIFESTS.includes(base(p)))
  const all = await git(['ls-files', '-z', '--', ...TEST_FILES])
  const pattern = idPattern(prefix)
  const grep = pattern === undefined ? undefined : await git(['grep', '-l', '-z', '-I', '-i', '-E', pattern, '--', ...TEST_FILES])
  // Exit 1: no test file names one.
  const named = new Set(grep === undefined || grep.exitCode > 1 ? [] : pathsOf(grep.stdout).filter(isTestFile))
  const tests = [...new Set([...(all.exitCode === 0 ? pathsOf(all.stdout) : []), ...named])].filter(isTestFile)
  const at = new Map<string, string[]>()
  for (const m of manifests) at.set(dirOf(m), [...(at.get(dirOf(m)) ?? []), base(m)])
  const has = (dir: string, file: string): boolean => (at.get(dir) ?? []).includes(file)
  // The manifests of folders that hold tests of their runner, or one above them: only these say anything.
  const wanted = new Set<string>()
  for (const f of tests) {
    const kind = runnerOf(f)
    if (kind === undefined || kind === 'other') continue
    for (let d: string | undefined = dirOf(f); d !== undefined; d = d === '' ? undefined : dirOf(d)) {
      if (kind === 'npm' && has(d, 'package.json')) wanted.add(d === '' ? 'package.json' : `${d}/package.json`)
      if (kind === 'go' && has(d, 'go.mod')) wanted.add(d === '' ? 'go.mod' : `${d}/go.mod`)
      if (kind === 'py') for (const m of ['pyproject.toml', 'setup.cfg', 'pytest.ini']) if (has(d, m)) wanted.add(d === '' ? m : `${d}/${m}`)
    }
  }
  const order = [...wanted].sort((a, b) => depth(dirOf(a)) - depth(dirOf(b)) || (a < b ? -1 : a > b ? 1 : 0))
  const texts = new Map<string, string>()
  let cut = false
  let reads = 0
  for (const path of order) {
    // pytest.ini is pytest's own: its name says it.
    if (base(path) === 'pytest.ini') {
      texts.set(path, '')
      continue
    }
    if (reads >= FOUND_READ) {
      cut = true
      continue
    }
    reads++
    const shown = await git(['show', `HEAD:${path}`])
    if (shown.exitCode === 0) texts.set(path, shown.stdout)
  }
  const roots: TestRoot[] = []
  const scripts = new Map<string, string>()
  const pytestAt = new Map<string, string>()
  const modules = new Map<string, string>()
  for (const path of order) {
    const d = dirOf(path)
    const text = texts.get(path)
    if (text === undefined) continue
    if (base(path) === 'package.json') {
      const script = scriptIn(text)
      roots.push({ dir: d, kind: 'npm', test: testScriptIn(text) })
      if (script !== undefined && testScriptIn(text)) scripts.set(d, script)
    } else if (base(path) === 'go.mod') {
      const module = /^\s*module\s+("?)([^\s"]+)\1\s*$/m.exec(text)?.[2]
      roots.push({ dir: d, kind: 'go', ...(module === undefined ? {} : { module }) })
      if (module !== undefined) modules.set(d, module.slice(0, SHOWN))
    } else {
      if (!roots.some(r => r.kind === 'py' && r.dir === d)) roots.push({ dir: d, kind: 'py' })
      if (pytestIn(path, text) && !pytestAt.has(d)) pytestAt.set(d, path)
    }
  }
  // Each test file to the folder whose command runs it: npm's deepest package with a test script (past one without),
  // go's module, python's nearest folder with pytest settings (else its own, which crew does not run).
  const groups = new Map<string, { kind: TestRoot['kind']; dir: string; files: string[]; tc: boolean; norule?: string }>()
  for (const f of tests) {
    // A data file under a tests folder goes with no runner of its own.
    const runner = runnerOf(f)
    if (runner === undefined || runner === 'other') continue
    const r = rootOf(f, roots)
    if (r === undefined) continue
    let dir = r.dir
    let norule: string | undefined
    if (r.kind === 'npm' && r.test !== true) continue
    if (r.kind === 'py') {
      let up: string | undefined = r.dir
      while (up !== undefined && !pytestAt.has(up)) up = up === '' ? undefined : dirOf(up)
      if (up === undefined) {
        const own = ['pyproject.toml', 'setup.cfg'].find(m => has(r.dir, m))
        norule = own === undefined ? undefined : r.dir === '' ? own : `${r.dir}/${own}`
        if (norule === undefined) continue
      } else dir = up
    }
    const key = `${r.kind}:${dir}`
    const g = groups.get(key) ?? { kind: r.kind, dir, files: [], tc: false, ...(norule === undefined ? {} : { norule }) }
    if (g.files.length < FILES_KEPT) g.files.push(f)
    if (named.has(f)) g.tc = true
    groups.set(key, g)
  }
  // A root package.json with a test script runs the packages below it (a monorepo's turbo, workspaces): it is a row of
  // its own though no test file sits at the root, and planFound covers those packages with it.
  const top = roots.find(r => r.kind === 'npm' && r.dir === '' && r.test === true)
  const below = [...groups.values()].filter(g => g.kind === 'npm' && g.dir !== '')
  if (top !== undefined && !groups.has('npm:') && below.length > 0) groups.set('npm:', { kind: 'npm', dir: '', files: [], tc: below.some(g => g.tc) })
  const locks = new Map<string, string[]>()
  for (const [d, files] of at) locks.set(d, files.filter(f => [...JS_LOCKS, ...PY_LOCKS].some(([l]) => l === f)))
  const rows: FoundScanRow[] = []
  for (const [key, g] of groups) {
    const common = { key, kind: g.kind, dir: g.dir, ...(g.tc ? { tc: true as const } : {}), files: g.files }
    if (g.norule !== undefined) {
      rows.push({ ...common, file: g.norule, said: '沒有 pytest 設定', norule: true })
      continue
    }
    const lock = lockOf(g.dir, locks, g.kind === 'npm' ? JS_LOCKS : PY_LOCKS)
    const tool: FoundTool = g.kind === 'go' ? 'go' : g.kind === 'npm' ? (lock?.tool ?? 'npm') : (lock?.tool ?? 'python')
    const file = g.kind === 'npm' ? (g.dir === '' ? 'package.json' : `${g.dir}/package.json`) : g.kind === 'go' ? (g.dir === '' ? 'go.mod' : `${g.dir}/go.mod`) : (pytestAt.get(g.dir) ?? '')
    const script = scripts.get(g.dir)
    const lockSaid = lock === undefined || lock.tool === 'npm' ? '' : `（有 ${lock.at === '' ? '' : `${lock.at}/`}${[...JS_LOCKS, ...PY_LOCKS].find(([, t]) => t === lock.tool)?.[0] ?? ''}，用 ${lock.tool} 跑）`
    const said =
      g.kind === 'npm'
        ? `scripts.test：${script ?? ''}${lockSaid}`
        : g.kind === 'go'
          ? modules.has(g.dir)
            ? `module：${modules.get(g.dir) ?? ''}`
            : ''
          : `${base(file) === 'pytest.ini' ? '' : base(file) === 'setup.cfg' ? '[tool:pytest]' : '[tool.pytest.ini_options]'}${lockSaid}`
    const extra = { ...(script === undefined ? {} : { script }), ...(modules.has(g.dir) ? { module: modules.get(g.dir) } : {}) }
    if (!composable(g.dir)) {
      rows.push({ ...common, tool, file, said, ...extra, bad: true })
      continue
    }
    rows.push({ ...common, tool, argv: commandFor(tool, g.dir, g.kind === 'py' ? (lock?.at ?? '') : ''), file, said, ...extra })
  }
  return { rows: sortRows(rows), ...(cut || listed.isStdoutTruncated === true || all.isStdoutTruncated === true ? { cut: true as const } : {}) }
}

const KIND_RANK: Record<TestRoot['kind'], number> = { npm: 0, go: 1, py: 2 }

/** Found rows in the order crew runs them: folders whose tests name test case ids first, then by folder path (the root first). */
export const sortRows = <T extends Pick<FoundScanRow, 'dir' | 'kind' | 'tc'>>(rows: readonly T[]): T[] =>
  [...rows].sort((a, b) => (a.tc === true ? 0 : 1) - (b.tc === true ? 0 : 1) || (a.dir === b.dir ? 0 : a.dir === '' ? -1 : b.dir === '' ? 1 : a.dir < b.dir ? -1 : 1) || KIND_RANK[a.kind] - KIND_RANK[b.kind])

/**
 * The run's plan: crew's found folders, the person's commands, the folders
 * the person turned off, and those added back because the root's run showed
 * none of their tests. The person's commands go first for places: crew runs
 * at most MAX_TEST_COMMANDS less theirs, in the rows' order. One of theirs
 * that crew can tell runs a folder's whole tests runs it in place of crew's;
 * a root package.json with a test script runs the JavaScript of each folder
 * below it. Pure.
 */
export const planFound = (scan: readonly FoundScanRow[], o: { user: readonly (readonly string[])[]; off: ReadonlySet<string>; back?: ReadonlySet<string> }): FoundPlan => {
  const back = o.back ?? new Set<string>()
  const rows: FoundRow[] = sortRows(scan).map(r => {
    if (r.bad === true) return { ...r, status: 'bad' }
    if (r.norule === true) return { ...r, status: 'norule' }
    const by = o.user.findIndex(argv => reachOf(argv, { dir: r.dir, kind: r.kind, ...(r.kind === 'npm' ? { test: true } : {}) }) === 'all')
    if (by >= 0) return { ...r, status: 'replaced', by: by + 1 }
    if (o.off.has(r.key)) return { ...r, status: 'off' }
    return { ...r, status: 'run' }
  })
  const root = rows.find(r => r.kind === 'npm' && r.dir === '')
  const slots = Math.max(0, MAX_TEST_COMMANDS - o.user.length)
  const runnable = rows.filter(r => r.status === 'run')
  // The root's test script runs every package below it: those are covered, unless its run showed none of their tests.
  // The rest take the places left in order; past them, a folder waits its turn (`rank`, the person's commands counted).
  const fill = (covering: boolean): void => {
    let i = 0
    for (const r of runnable) {
      delete r.rank
      delete r.back
      if (covering && r.kind === 'npm' && r.dir !== '') {
        if (!back.has(r.key)) {
          r.status = 'covered'
          continue
        }
        r.back = true
      }
      i++
      if (i <= slots) r.status = 'run'
      else {
        r.status = 'over'
        r.rank = o.user.length + i
      }
    }
  }
  const covering = root !== undefined && (root.status === 'run' || root.status === 'replaced')
  fill(covering)
  // The root's command past the most crew runs: nothing covers the packages below, which take their own places.
  if (covering && root?.status === 'over') fill(false)
  let n = 0
  for (const r of rows) if (r.status === 'run') r.n = ++n
  return { rows, run: rows.filter(r => r.status === 'run'), user: o.user.length, total: n + o.user.length }
}

/** The cause a found folder's test cases with no result have, from where it stands: none for one whose command ran; the root's script or the person's command for one another was to run. */
export const causeOf = (r: FoundRow, broken?: string): NoneCause | undefined =>
  r.status === 'off'
    ? 'off'
    : r.status === 'over'
      ? 'over'
      : r.status === 'norule'
        ? 'norule'
        : r.status === 'bad'
          ? 'bad'
          : r.status === 'covered'
            ? 'covered'
            : r.status === 'replaced'
              ? 'replaced'
              : r.status === 'run' && broken !== undefined
                ? 'broken'
                : undefined

/** What a run's reasons read of each found folder. Pure. */
export const hintsOf = (plan: FoundPlan, broken: Readonly<Record<string, string>> = {}): RowHint[] =>
  plan.rows.map(r => {
    const cause = causeOf(r, broken[r.key])
    return {
      dir: r.dir,
      kind: r.kind,
      ...(cause === undefined ? {} : { cause }),
      ...(r.argv === undefined ? {} : { cmd: foundCmd(r) }),
      ...(r.rank === undefined ? {} : { rank: r.rank }),
      ...(cause === 'broken' ? { error: broken[r.key] } : {}),
      ...(r.norule === true ? { file: r.file } : {}),
    }
  })

/** A folder as the settings show it: the repo's root by name, any other with a / after it, a control character in its name (a newline) written out. */
export const dirShown = (dir: string): string =>
  dir === '' ? '整個專案（根目錄）' : `${dir.replace(/[\0-\x1f\x7f]/g, c => (c === '\n' ? '\\n' : c === '\t' ? '\\t' : `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`))}/`

/** The folders below the root whose tests the root's test script was to run and its output does not show: their own commands run next time. */
export const backAfter = (plan: FoundPlan, outputOf: (r: FoundRow | number) => string | undefined, shown: (output: string, r: FoundRow) => boolean, was: ReadonlySet<string>): Set<string> => {
  const root = plan.rows.find(r => r.kind === 'npm' && r.dir === '')
  if (root === undefined || (root.status !== 'run' && root.status !== 'replaced')) return new Set(was)
  const output = outputOf(root.status === 'replaced' ? (root.by ?? 0) : root)
  if (output === undefined) return new Set(was)
  const out = new Set<string>()
  for (const r of plan.rows) {
    if (r.kind !== 'npm' || r.dir === '' || r.argv === undefined) continue
    if (r.status !== 'covered' && r.back !== true) continue
    if ((r.files ?? []).length > 0 && !shown(output, r)) out.add(r.key)
  }
  return out
}

/** A found row's chip: what the settings say of where it stands. */
export const FOUND_CHIPS: Record<FoundStatus, { text: string; tone: 'run' | 'todo' | 'kind' | 'wait' }> = {
  run: { text: '會跑', tone: 'run' },
  off: { text: '你關掉了', tone: 'todo' },
  replaced: { text: '由你的指令取代', tone: 'kind' },
  covered: { text: '根目錄那條會跑', tone: 'kind' },
  norule: { text: '不自動跑', tone: 'todo' },
  bad: { text: '不自動跑', tone: 'todo' },
  over: { text: `這次不跑：超過 ${MAX_TEST_COMMANDS} 條`, tone: 'wait' },
}

/** Why a found row stands where it does, for the person; none for one that runs as found. */
export const foundWhy = (r: FoundRow, plan: FoundPlan, broken?: string): string | undefined => {
  // The root's name ends in a bracket: no space before 的 there.
  const where = `${dirShown(r.dir)}${r.dir === '' ? '' : ' '}`
  if (r.status === 'off') return `你關掉了這條，記在這台電腦，之後再找到也不跑。${where}的 test case 在測試那一關算缺口，不算通過。`
  if (r.status === 'replaced') return `你的第 ${plan.run.length + (r.by ?? 1)} 條會跑整個 ${dirShown(r.dir)}，這條就不跑，免得重複。`
  if (r.status === 'covered') {
    const root = plan.rows.find(x => x.kind === 'npm' && x.dir === '')
    const cmd = root === undefined ? 'npm test' : root.status === 'replaced' ? `你的第 ${plan.run.length + (root.by ?? 1)} 條` : foundCmd(root)
    return `根目錄的 ${cmd}${root?.script === undefined ? ' ' : `（${root.script}）`}會跑每個子專案，這裡再跑一次會重複。跑完輸出裡看不到 ${where}的測試檔的話，下次把這條加回來跑。`
  }
  if (r.status === 'norule') return `${r.file} 沒有 pytest 設定，看不出這裡用什麼跑測試。要跑的話，在下面自己加一條。`
  if (r.status === 'bad') return `資料夾名稱有 crew 不放進指令的字元（例如 ; | & $、換行或開頭的 -），crew 不幫它組指令。要跑的話，在下面自己加一條。`
  if (r.status === 'over') return `排第 ${r.rank ?? ''}，一次最多跑 ${MAX_TEST_COMMANDS} 條。${where}的 test case 這次在測試那一關算缺口。`
  if (broken !== undefined) return `上次跑不起來（${broken}）。這次照樣再試；其他條照跑、照算。${where}的 test case 跑不起來時沒有結果，在測試那一關算缺口。`
  if (r.back === true) return `上次根目錄那條跑完，輸出裡看不到 ${where}的測試檔，所以這次把這條加回來跑。`
  return undefined
}
