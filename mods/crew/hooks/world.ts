import type { CommandRunInput, On, RenderPropsOf, SessionStartInput, TurnCompleteInput } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { Tracker } from './board'
import { checkScope } from './flow'
import { requirementsOf } from './prd'

/**
 * crew end to end inside the kit: a repo on an in-memory disk, the PM and QA
 * played by the test through the same tool calls and turn ends a session has.
 */

export const ROOT = '/repo'

/** The board as crew keeps it: in .crew/, or at the root of a repo where crew made it there before 0.5.2. */
const boardOn = (disk: Map<string, string> | undefined): string | undefined => disk?.get(`${ROOT}/.crew/prd-tracker.json`) ?? disk?.get(`${ROOT}/prd-tracker.json`)
export const NOW = Date.UTC(2026, 9, 15, 6, 0, 0)

/** A worktree's detached HEAD in the test world's git: a line of commits named for the worktree, not a branch. */
const DETACHED = /^HEAD@/

export const PRD = '# 會員訂閱\n\n使用者可以選月繳方案，可以隨時取消，取消後用到期末。'

export type Spawn = { subagentType: string; name?: string; description: string; model?: string; prompt: string; cwd?: string }

/** The world a test made last: what `build` commits into. */
const current: {
  commit?: (subject: string, branch?: string) => string
  clock?: { advance: (ms: number) => Promise<unknown> }
  spawned?: Spawn[]
  disk?: Map<string, string>
  store?: Map<string, unknown>
  /** The QA runs a test ended already: checked() ends each once. */
  ended?: Set<string>
} = {}

export const world = (engine: Engine, on: On, { deliver = true, denySpawn = '', denySpawnOf = '', stopped = [] as string[] } = {}) => {
  /** The next so many `$.clock.after` dispatches are refused, as another plugin's hook can refuse them. */
  const refuse = { timers: 0 }
  const timed = ((event: string, ...rest: unknown[]) => {
    const register = on as unknown as (event: string, ...rest: unknown[]) => unknown
    if (event !== 'clock.after') return register(event, ...rest)
    const hook = rest.at(-1) as (...args: unknown[]) => unknown
    return register(event, ...rest.slice(0, -1), (...args: unknown[]) => {
      if (refuse.timers === 0) return hook(...args)
      refuse.timers -= 1
      return { deny: 'refused by another plugin' }
    })
  }) as unknown as On
  const clock = mock.clock(timed, { now: NOW })
  /** crew's own store, which outlives sessions and is not in the repo. */
  // One agent at a time unless a test sets more: crew's flow on its own branch, as before builds ran side by side.
  const store = new Map<string, unknown>([
    [`tests:${ROOT}`, { argv: ['npm', 'test'] }],
    [`settings:${ROOT}`, { agents: 1 }],
  ])
  on('store.get', async (_$, e) => {
    const { key } = e as { key: string }
    if (broken.storeReads !== '' && key.startsWith(broken.storeReads)) return { deny: `EIO: i/o error, store '${key}'` }
    // Where the board is takes this long to look up, by the test's clock, so work can meet crew still looking.
    if (slow.store > 0 && key.startsWith('board:')) await clock.sleep(slow.store)
    return { value: store.get(key) }
  })
  on('store.set', (_$, e) => {
    const { key, value } = e as { key: string; value: unknown }
    if (broken.store !== '' && key.startsWith(broken.store)) return { deny: `${broken.reason}, store '${key}'` }
    store.set(key, JSON.parse(JSON.stringify(value)))
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    store.delete((e as { key: string }).key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  /** The environment crew reads: none set unless a test sets them, but for crew's web page, which tests do not start. */
  const env = new Map<string, string>([['CREW_WEB', 'off']])
  on('env.get', (_$, e) => ({ value: env.get((e as { name: string }).name) }))
  /** When each file was last written, by the test's clock: a file's modified time. */
  const written = new Map<string, number>()
  let writes = 0
  const disk = new (class extends Map<string, string> {
    override set(path: string, text: string) {
      // A thousandth of a millisecond apart, so two writes at one clock time are still two versions.
      writes += 1
      written.set(path, clock.now() + writes / 1000)
      return super.set(path, text)
    }
  })([[`${ROOT}/docs/PRD.md`, PRD]])
  /** Paths that are symbolic links, and where they lead. */
  const links = new Map<string, string>()
  /** Every prompt that reached the bottom, as the hooks left it. */
  const submitted: { text: string; context?: readonly string[]; kind: string }[] = []
  const spawned: Spawn[] = []
  const sent: { to: string; text: string }[] = []
  const toasts: string[] = []
  const registered = { tools: [] as string[], agents: [] as string[] }
  /** What the small model is asked, and the replies it gives in turn. */
  const completions: { model: string; prompt: string; system?: string }[] = []
  /** What crew submitted to the main conversation. */
  const prompts: string[] = []
  /** The caffeinate runs crew started to keep the Mac awake. */
  const awake: string[][] = []
  /**
   * The app crew starts for QA's check: whether it answers at its URL, the
   * starts and the commands crew ran around it (curl, lsof, kill, mkdir, rm,
   * cp), and how to end the running one.
   */
  const app = {
    up: false,
    starts: [] as { argv: string[]; cwd?: string; env?: Record<string, string> }[],
    calls: [] as string[][],
    fails: false,
    stop: undefined as (() => void) | undefined,
    /** When the app crew started last began (the clock's ms): ps counts its elapsed time from it. */
    since: 0,
    /** The start command ends with exit 0 at once, leaving the app up in the background (docker compose up -d), until the stop command. */
    detached: false,
    /** Programs listening on the app's port that were running long before (Docker's own): their ids. */
    others: [] as string[],
    /** Ports something listens on, as lsof lists every listener. */
    ports: [] as string[],
    /** The stop commands crew ran, with where. */
    stops: [] as { argv: string[]; cwd?: string; env?: Record<string, string> }[],
  }
  const replies: string[] = []
  /** A path with every link on the way followed, as the file system resolves it. */
  const resolve = (path: string): string => {
    for (const [link, target] of [...links].sort((a, b) => b[0].length - a[0].length)) {
      if (path === link) return target
      if (path.startsWith(`${link}/`)) return `${target}${path.slice(link.length)}`
    }
    return path
  }
  const isDir = (path: string) => [...disk.keys()].some(p => p.startsWith(`${path}/`))
  on('fs.exists', (_$, e) => ({ value: disk.has(resolve(e.path)) || isDir(resolve(e.path)) }))
  /**
   * A repo's git, as far as crew asks it: branches with their commits (newest
   * first; `HEAD` is the person's checkout, made with one commit), worktrees,
   * and the checkout's branch.
   */
  const git = {
    repo: true,
    branches: new Map<string, { sha: string; subject: string; files?: string[] }[]>([['HEAD', [{ sha: 'c0ffee'.padEnd(40, '0'), subject: 'init' }]]]),
    worktrees: new Map<string, string>(),
    commands: [] as string[][],
    /** What `git status --porcelain` says in crew's worktree: changes not committed. */
    dirty: '',
    /** What it says in one worktree, in place of `dirty`: what the person's prep left there. */
    dirtyIn: new Map<string, string>(),
    /** Why `git status` fails in crew's worktree, when it does. */
    unreadable: '',
    /** What it says in the person's checkout. */
    checkout: '',
    /** The checkout's branch, as `git symbolic-ref HEAD` says it. */
    ref: 'refs/heads/main',
    /** Commits whose merge conflicts, with the files that conflict; and the conflict a merge under way left. */
    conflicts: new Map<string, string[]>(),
    conflicted: [] as string[],
    /** Refs crew keeps of its own outside the branches (refs/crew/shelf/...), with the commit each points at. */
    refs: new Map<string, string>(),
    /** What `git stash create` set aside, by the commit it made: what `git status` said then, less what `git add` left out. */
    stashed: new Map<string, string>(),
    /** The commit each of those was made on. */
    stashedOn: new Map<string, string>(),
    /** What git shows untracked after the next `git reset --hard`, as a .gitignore put back would: files it ignored till then. */
    unhidden: '',
    /** The set-asides `git stash apply` put back, in order; and those it fails on, with what git says (a CONFLICT puts it back marked). */
    applied: [] as string[],
    applyFails: new Map<string, string>(),
    /** What `mv` moved out of a worktree (where it went → where it was), and back. */
    movedOut: new Map<string, string>(),
    movedBack: [] as string[],
    /** What `git grep` finds in the test files (each line a path, a NUL, what matched); `listed`, the manifests `git ls-files` lists; `blobs`, what `git show HEAD:<path>` prints. */
    grep: '',
    listed: [] as string[],
    blobs: new Map<string, string>(),
  }
  /** The paths the last `git add` left out (`:(exclude,literal)<path>`). */
  let excluded: string[] = []
  /** The person's test command as crew runs it: what it prints and how it exits, and each run's words and folder. */
  /** `leaves`: what git shows untracked where a run of the person's ran, after it (a prep that links the packages in). */
  /** `by`: what one command prints and how it exits, by its words joined with spaces, in place of the rest; `failsFor`, a command that cannot start. */
  const tests = { exitCode: 0, stdout: '', stderr: '', runs: [] as { argv: string[]; cwd?: string; env?: Record<string, string> }[], fails: '', ms: 0, leaves: '', by: new Map<string, { stdout: string; exitCode: number }>(), failsFor: '' }
  /** Writes under this path fail, as on a full disk; so do writes of store keys that start with `store`, and reads of those that start with `storeReads`. */
  const broken = { writes: '', reason: 'ENOSPC: no space left on device', reads: '', store: '', storeReads: '' }
  let shas = 0
  /**
   * Each branch's reflog, oldest first: the commits git moved it to. A branch a
   * test sets outright is one made anew, with a reflog of its own.
   */
  const reflogs = new Map<string, string[]>()
  const reflogOf = (branch: string): string[] => {
    const top = git.branches.get(branch)?.[0]?.sha
    if (top === undefined) return []
    const log = reflogs.get(branch) ?? []
    if (log.at(-1) === top) return log
    reflogs.set(branch, [top])
    return [top]
  }
  const nextSha = () => {
    shas += 1
    return (0xabc0000 + shas).toString(16).padStart(7, '0')
  }
  /** A commit the full-stack made on a branch (crew's, by default the PRD's). */
  const commit = (subject: string, branch = 'crew/prd', files?: string[]) => {
    const moves = reflogOf(branch)
    const sha = nextSha()
    git.branches.set(branch, [{ sha, subject, ...(files === undefined ? {} : { files }) }, ...(git.branches.get(branch) ?? [])])
    reflogs.set(branch, [...moves, sha])
    return sha
  }
  /** The branch moved back to one of its commits, as `git reset --hard` does: the commits above it are on it no more. */
  const reset = (sha: string, branch = 'crew/prd') => {
    const moves = reflogOf(branch)
    const cs = git.branches.get(branch) ?? []
    git.branches.set(branch, cs.slice(Math.max(0, cs.findIndex(c => c.sha === sha))))
    reflogs.set(branch, [...moves, sha])
  }
  /** The branch's newest commit made again, as `git commit --amend` does: a new commit in its place. */
  const amend = (subject: string, branch = 'crew/prd') => {
    const moves = reflogOf(branch)
    const sha = nextSha()
    git.branches.set(branch, [{ sha, subject }, ...(git.branches.get(branch) ?? []).slice(1)])
    reflogs.set(branch, [...moves, sha])
    return sha
  }
  on('process.run', async (_$, e) => {
    const argv = (e as { argv: string[] }).argv
    const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const fail = (stderr = '') => ({ value: { exitCode: 1, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false } })
    // crew keeps the Mac awake while it works: not the person's command, nor git's. Ending at once, it is not tried again.
    if (argv[0] === '/usr/bin/caffeinate') {
      awake.push([...argv])
      return ok()
    }
    // QA's check: what crew runs around the app it starts, apart from the person's test command and git.
    // crew moving files a task's .gitignore hid out of a worktree, and back: git no longer shows them there.
    if (argv[0] === '/bin/mv') {
      const [from = '', to = ''] = argv.slice(-2)
      const dir = [...git.worktrees.keys(), ...git.dirtyIn.keys()].find(d => from.startsWith(`${d}/`))
      if (dir !== undefined) {
        const rel = from.slice(dir.length + 1)
        const now = (git.dirtyIn.get(dir) ?? git.dirty).split('\n').filter(l => l.trim() !== '' && l !== `?? ${rel}` && l !== `?? ${rel}/` && l !== `?? "${rel}"`)
        const text = now.length === 0 ? '' : `${now.join('\n')}\n`
        if (git.dirtyIn.has(dir)) git.dirtyIn.set(dir, text)
        else git.dirty = text
        git.movedOut.set(to, from)
      } else if (git.movedOut.has(from)) git.movedBack.push(to)
      return ok()
    }
    if (['/usr/bin/curl', '/usr/sbin/lsof', '/bin/kill', '/bin/mkdir', '/bin/rm', '/bin/cp', '/bin/ps'].includes(argv[0] ?? '')) {
      app.calls.push([...argv])
      if (argv[0] === '/usr/bin/curl') return app.up ? ok('200') : { value: { exitCode: 7, stdout: '000', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      // Every listener, for the ports in use; or the ids listening on the app's port.
      if (argv[0] === '/usr/sbin/lsof' && argv.includes('-Fn')) return ok(app.ports.map((port, i) => `p${9000 + i}\nn*:${port}\n`).join(''))
      // Docker's own program listens on the app's port too while the app is up.
      if (argv[0] === '/usr/sbin/lsof') return ok((app.up ? ['4242', ...app.others] : []).map(x => `${x}\n`).join(''))
      // How long each process has run: the app since crew started it, the others for days.
      if (argv[0] === '/bin/ps') {
        const ids = (argv[argv.length - 1] ?? '').split(',')
        const ran = Math.floor((clock.now() - app.since) / 1000)
        const mmss = `${String(Math.floor(ran / 60)).padStart(2, '0')}:${String(ran % 60).padStart(2, '0')}`
        return ok(ids.map(id => (id === '4242' ? `${id} ${mmss}` : app.others.includes(id) ? `${id} 3-04:05:06` : '')).filter(x => x !== '').map(x => `  ${x}\n`).join(''))
      }
      if (argv[0] === '/bin/kill') {
        app.up = false
        app.stop?.()
        return ok()
      }
      if (argv[0] === '/bin/cp') {
        const [from = '', to = ''] = argv.slice(-2)
        const v = disk.get(from)
        if (v !== undefined) disk.set(to, v)
        return ok()
      }
      if (argv[0] === '/bin/rm') for (const f of argv.slice(3)) disk.delete(f)
      return ok()
    }
    // crew reading which models are newest (Claude's aliases, Codex's list): none here, so it keeps what it knew.
    if (argv.includes('--safe-mode') || (argv[0] === 'codex' && argv[1] === 'debug')) return fail('no model list here')
    // crew's run of the person's stop command for the app (CREW_QA=1): the app it left in the background goes down.
    const runInit = (e as { init?: { cwd?: string; env?: Record<string, string> } }).init
    if (argv[0] !== 'git' && runInit?.env?.CREW_QA === '1') {
      app.stops.push({ argv: [...argv], ...(runInit.cwd === undefined ? {} : { cwd: runInit.cwd }), ...(runInit.env === undefined ? {} : { env: { ...runInit.env } }) })
      app.up = false
      app.stop?.()
      return ok('Container app Removed\n')
    }
    git.commands.push([...argv])
    if (argv[0] !== 'git') {
      // Anything but git is the person's test command.
      const init = (e as { init?: { cwd?: string; env?: Record<string, string> } }).init
      tests.runs.push({ argv: [...argv], ...(init?.cwd === undefined ? {} : { cwd: init.cwd }), ...(init?.env === undefined ? {} : { env: init.env }) })
      if (tests.fails !== '') return { deny: tests.fails }
      if (tests.failsFor !== '' && argv.join(' ') === tests.failsFor) return { deny: `spawn ${argv[0] ?? ''} ENOENT` }
      const own = tests.by.get(argv.join(' '))
      if (own !== undefined) return { value: { exitCode: own.exitCode, stdout: own.stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      // A run that takes this long, by the test's clock, so requests can meet one under way.
      if (tests.ms > 0) await clock.sleep(tests.ms)
      if (tests.leaves !== '' && init?.cwd !== undefined) git.dirtyIn.set(init.cwd, tests.leaves)
      // Unless a test says what the run prints, every test case on the board passes, named by its id.
      const board = JSON.parse(boardOn(disk) ?? '{"prd_items":[]}') as { prd_items: { test_cases?: { id: string }[] }[] }
      const all = board.prd_items.flatMap(i => i.test_cases ?? []).map(c => `✓ ${c.id} passes`).join('\n')
      return { value: { exitCode: tests.exitCode, stdout: tests.stdout === '' ? all : tests.stdout, stderr: tests.stderr, isStdoutTruncated: false, isStderrTruncated: false } }
    }
    // `-c name=value` settings come first, then `-C <dir>`.
    let at = 1
    while (argv[at] === '-c') at += 2
    if (argv[at] !== '-C') return fail('no -C')
    const dir = argv[at + 1] ?? ''
    const args = argv.slice(at + 2)
    if (!git.repo) return fail('fatal: not a git repository')
    const top = (name: string) => git.branches.get(name)?.[0]?.sha
    if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') return ok('true\n')
    if (args[0] === 'rev-parse' && args[1] === '--verify') {
      const name = args[3] ?? ''
      // In a worktree, HEAD is the worktree's own branch.
      const head = dir !== ROOT && git.worktrees.has(dir) ? (git.worktrees.get(dir) ?? 'HEAD') : 'HEAD'
      if (name === 'HEAD^{commit}' || name === 'HEAD') return top(head) === undefined ? fail() : ok(`${top(head)}\n`)
      // crew's own refs, and the commit a set-aside was made on.
      if (name.startsWith('refs/crew/')) return git.refs.has(name) ? ok(`${git.refs.get(name) ?? ''}\n`) : fail()
      if (name.endsWith('^1') && git.stashedOn.has(name.slice(0, -2))) return ok(`${git.stashedOn.get(name.slice(0, -2)) ?? ''}\n`)
      const branch = name.replace('refs/heads/', '').replace('^{commit}', '')
      return git.branches.has(branch) ? ok(`${top(branch) ?? 'x'}\n`) : fail()
    }
    // A worktree's HEAD is its own branch; detached, a line of its own that is no branch.
    if (args[0] === 'symbolic-ref') return dir !== ROOT && git.worktrees.has(dir) ? (DETACHED.test(git.worktrees.get(dir) ?? '') ? fail() : ok(`refs/heads/${git.worktrees.get(dir) ?? ''}\n`)) : git.ref === '' ? fail() : ok(`${git.ref}\n`)
    if (args[0] === 'checkout' && args[1] === '--detach') {
      const branch = git.worktrees.get(dir) ?? 'HEAD'
      const head = `HEAD@${dir}`
      git.branches.set(head, [...(git.branches.get(branch) ?? [])])
      git.worktrees.set(dir, head)
      return ok()
    }
    if (args[0] === 'checkout') {
      const branch = args.at(-1) ?? ''
      if (!git.branches.has(branch)) return fail(`error: pathspec '${branch}' did not match`)
      const was = git.worktrees.get(dir) ?? ''
      if (DETACHED.test(was)) git.branches.delete(was)
      git.worktrees.set(dir, branch)
      return ok()
    }
    // A ref of crew's own: set to the commit given.
    if (args[0] === 'update-ref' && (args[1] ?? '').startsWith('refs/crew/')) {
      git.refs.set(args[1] ?? '', args[2] ?? '')
      return ok()
    }
    // Staged, but what the pathspecs leave out.
    if (args[0] === 'add') {
      excluded = args.filter(a => a.startsWith(':(exclude,literal)')).map(a => a.slice(':(exclude,literal)'.length))
      return ok()
    }
    const statusIn = (d: string) => (d === ROOT ? git.checkout : (git.dirtyIn.get(d) ?? git.dirty))
    // git shows a name with a space quoted; the pathspec names the file itself.
    const leftOut = (line: string) => line.startsWith('?? ') && (excluded.includes(line.slice(3)) || (line.slice(3).startsWith('"') && excluded.includes(line.slice(4, -1))))
    // A commit of what was staged, made apart from the stash list on the commit HEAD is at; nothing to set aside, nothing printed.
    if (args[0] === 'stash' && args[1] === 'create') {
      const staged = statusIn(dir).split('\n').filter(l => l.trim() !== '' && !leftOut(l))
      if (staged.length === 0) return ok('')
      const sha = nextSha()
      git.stashed.set(sha, `${staged.join('\n')}\n`)
      const head = dir !== ROOT && git.worktrees.has(dir) ? (git.worktrees.get(dir) ?? 'HEAD') : 'HEAD'
      git.stashedOn.set(sha, top(head) ?? '')
      return ok(`${sha}\n`)
    }
    // The index put back as HEAD has it: nothing staged, the worktree as it was.
    if (args[0] === 'reset' && args[1] === '--quiet') return ok()
    // The worktree put back as its branch holds it: what was staged is gone; what git add left out stays, and so does what a
    // .gitignore put back no longer ignores.
    if (args[0] === 'reset' && args[1] === '--hard' && args.at(-1) === 'HEAD') {
      if (dir === ROOT) return ok()
      const kept = [...statusIn(dir).split('\n').filter(l => leftOut(l)), ...git.unhidden.split('\n').filter(l => l.trim() !== '')]
      git.unhidden = ''
      const now = kept.length === 0 ? '' : `${kept.join('\n')}\n`
      if (git.dirtyIn.has(dir)) git.dirtyIn.set(dir, now)
      else git.dirty = now
      return ok()
    }
    // A set-aside put back in the worktree: what it holds shows changed there again.
    if (args[0] === 'stash' && args[1] === 'apply') {
      const sha = args[2] ?? ''
      const said = git.applyFails.get(sha)
      const back = () => {
        const lines = [...statusIn(dir).split('\n'), ...(git.stashed.get(sha) ?? '').split('\n')].filter(l => l.trim() !== '')
        const text = lines.length === 0 ? '' : `${[...new Set(lines)].join('\n')}\n`
        if (git.dirtyIn.has(dir)) git.dirtyIn.set(dir, text)
        else git.dirty = text
        git.applied.push(sha)
      }
      if (said === undefined) {
        back()
        return ok()
      }
      if (said.includes('CONFLICT')) {
        back()
        return { value: { exitCode: 1, stdout: said, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      }
      return fail(said)
    }
    // What a set-aside holds, against the commit it was made on.
    if (args[0] === 'diff' && args[1] === `${args[2] ?? ''}^1` && git.stashed.has(args[2] ?? '')) return ok(`diff --git (crew 收起來的) ${args[2] ?? ''}\n${git.stashed.get(args[2] ?? '') ?? ''}`)
    if (args[0] === 'update-ref') {
      // Moved from the commit it was at only, to the commit given and those beneath it.
      const branch = (args[1] ?? '').replace('refs/heads/', '')
      const [to, from] = [args[2] ?? '', args[3] ?? '']
      if (top(branch) !== from) return fail(`fatal: cannot lock ref 'refs/heads/${branch}': is at ${top(branch) ?? ''} but expected ${from}`)
      const line = [...git.branches.values()].find(cs => cs.some(c => c.sha === to))
      if (line === undefined) return fail(`fatal: ${to}: not a valid SHA1`)
      git.branches.set(branch, line.slice(line.findIndex(c => c.sha === to)))
      reflogs.set(branch, [...reflogOf(branch), to])
      return ok()
    }
    // A merge in a worktree: its branch takes the commit and those beneath it, under a merge commit of its own;
    // a commit a test said conflicts leaves the files in conflict instead.
    if (args[0] === 'merge' && args[1] === '--no-ff') {
      const branch = git.worktrees.get(dir) ?? 'HEAD'
      const sha = args.at(-1) ?? ''
      const clash = git.conflicts.get(sha)
      if (clash !== undefined) {
        git.conflicted = [...clash]
        return fail(`CONFLICT (content): Merge conflict in ${clash[0] ?? ''}`)
      }
      const line = [...git.branches.values()].find(cs => cs.some(c => c.sha === sha))
      if (line === undefined) return fail(`merge: ${sha} - not something we can merge`)
      const mine = git.branches.get(branch) ?? []
      const theirs = line.slice(line.findIndex(c => c.sha === sha)).filter(c => !mine.some(m => m.sha === c.sha))
      const moves = reflogOf(branch)
      const merged = nextSha()
      git.branches.set(branch, [{ sha: merged, subject: args[args.indexOf('-m') + 1] ?? 'merge' }, ...theirs, ...mine])
      reflogs.set(branch, [...moves, merged])
      return ok()
    }
    if (args[0] === 'merge' && args[1] === '--abort') {
      git.conflicted = []
      return ok()
    }
    if (args[0] === 'merge' && args[1] === '--ff-only') {
      // Forward only: the branch named must hold this branch's newest commit.
      const branch = git.worktrees.get(dir) ?? 'HEAD'
      const to = (args.at(-1) ?? '').replace('refs/heads/', '')
      const line = git.branches.get(to) ?? []
      const head = git.branches.get(branch)?.[0]?.sha
      if (head === undefined || !line.some(c => c.sha === head)) return fail('fatal: Not possible to fast-forward, aborting.')
      git.branches.set(branch, [...line])
      return ok()
    }
    if (args[0] === 'reset' && args[1] === '--hard') {
      reset(args.at(-1) ?? '', git.worktrees.get(dir) ?? 'HEAD')
      return ok()
    }
    if (args[0] === 'diff' && args[1] === '--name-only') return ok(git.conflicted.join('\n'))
    if (args[0] === 'worktree' && args[1] === 'add') {
      const fresh = args[2] === '-b'
      // Detached at a commit: a line of its own, from the branch that holds it.
      const detach = args[2] === '--detach'
      const branch = detach ? `HEAD@${args[3] ?? ''}` : (args[3] ?? '')
      const at2 = fresh ? (args[4] ?? '') : detach ? (args[3] ?? '') : (args[2] ?? '')
      if (detach) {
        const sha = args[4] ?? ''
        const line = [...git.branches.values()].find(cs => cs.some(c => c.sha === sha)) ?? []
        git.branches.set(branch, line.slice(Math.max(0, line.findIndex(c => c.sha === sha))))
      }
      if (fresh) {
        // The new branch starts at the commit given, with the history beneath it.
        const from = args[5] ?? 'HEAD'
        // From a branch by its ref: its newest commit.
        const named = from.startsWith('refs/heads/') ? git.branches.get(from.slice('refs/heads/'.length)) : undefined
        const line = named ?? [...git.branches.values()].find(cs => cs.some(c => c.sha === from)) ?? git.branches.get('HEAD') ?? []
        git.branches.set(branch, named !== undefined ? [...named] : line.slice(Math.max(0, line.findIndex(c => c.sha === from))))
      }
      // A worktree deleted by hand is still on git's list: refused, as git does, till that entry is removed.
      if (git.worktrees.has(at2) && !disk.has(`${at2}/.git`)) return fail(`fatal: '${at2}' is a missing but already registered worktree;\nuse 'add -f' to override, or 'prune' or 'remove' to clear`)
      git.worktrees.set(at2, branch)
      disk.set(`${at2}/.git`, `gitdir: ${ROOT}/.git/worktrees/x`)
      return ok()
    }
    if (args[0] === 'worktree' && args[1] === 'remove') {
      // Refused, as git does, while anything in it is not committed, unless forced.
      const forced = args[2] === '--force'
      const at2 = (forced ? args[3] : args[2]) ?? ''
      if (!forced && (git.dirtyIn.get(at2) ?? git.dirty) !== '') return fail(`fatal: '${at2}' contains modified or untracked files, use --force to delete it`)
      git.dirtyIn.delete(at2)
      git.worktrees.delete(at2)
      disk.delete(`${at2}/.git`)
      return ok()
    }
    if (args[0] === 'branch' && args[1] === '-d') {
      // Only a branch the worktree's own holds all of.
      const name = args[2] ?? ''
      const mine = git.branches.get(git.worktrees.get(dir) ?? 'HEAD') ?? []
      const its = git.branches.get(name)
      if (its === undefined) return fail(`error: branch '${name}' not found.`)
      if (!its.every(c => mine.some(m => m.sha === c.sha))) return fail(`error: the branch '${name}' is not fully merged.`)
      git.branches.delete(name)
      return ok()
    }
    if (args[0] === 'check-ignore') {
      // What crew moves out of a worktree goes under .crew/shelved/, ignored as .crew/.gitignore says.
      const path = args.at(-1) ?? ''
      const rules = (disk.get(`${ROOT}/.crew/.gitignore`) ?? '').split('\n')
      return path.startsWith(`${ROOT}/.crew/shelved/`) && rules.includes('shelved/') ? ok() : { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (args[0] === 'status' && args[1] === '--porcelain') return dir !== ROOT && git.unreadable !== '' ? fail(git.unreadable) : ok(dir === ROOT ? git.checkout : (git.dirtyIn.get(dir) ?? git.dirty))
    if (args[0] === 'grep') {
      if (git.grep === '') return fail()
      // With -l, git names each file once (a NUL after each with -z): the paths before each line's NUL.
      if (args.includes('-l')) return ok([...new Set(git.grep.split('\n').flatMap(l => (l === '' ? [] : [l.includes('\0') ? l.slice(0, l.indexOf('\0')) : l])))].map(p => `${p}\0`).join(''))
      return ok(git.grep)
    }
    if (args[0] === 'ls-files' && args[1] === '-z') return ok(git.listed.map(p => `${p}\0`).join(''))
    if (args[0] === 'show' && (args[1] ?? '').startsWith('HEAD:')) {
      const blob = git.blobs.get((args[1] ?? '').slice('HEAD:'.length))
      return blob === undefined ? { value: { exitCode: 128, stdout: '', stderr: 'fatal: path not in HEAD', isStdoutTruncated: false, isStderrTruncated: false } } : ok(blob)
    }
    // What crew looks for before it stages: no nested repo untracked (`?? dir/`), no submodule in the index.
    if (args[0] === 'status' && args[1] === '-z') return dir !== ROOT && git.unreadable !== '' ? fail(git.unreadable) : ok('')
    if (args[0] === 'ls-files') return ok('')
    if (args[0] === 'show') {
      // Each commit as `git show` prints it: its sha, its subject, and a diff.
      const shas = args.slice(1, args.indexOf('--') === -1 ? undefined : args.indexOf('--')).filter(a => !a.startsWith('-'))
      const all = [...git.branches.values()].flat()
      return ok(
        shas
          .map(sha => {
            const c = all.find(x => x.sha === sha)
            return `commit ${sha}\n${c?.subject ?? ''}\n\n diff of ${sha}\n${(c?.files ?? []).map(f => `diff --git a/${f} b/${f}\n`).join('')}`
          })
          .join('\n'),
      )
    }
    if (args[0] === 'for-each-ref') {
      // The person's branches, as `refs/heads/<name> <sha>`; HEAD stands for the checkout's own.
      return ok([...git.branches].filter(([b]) => b !== 'HEAD' && !DETACHED.test(b)).map(([b, cs]) => `refs/heads/${b} ${cs[0]?.sha ?? ''}`).join('\n'))
    }
    if (args[0] === 'merge-base' && args[1] === '--is-ancestor') {
      // In a worktree, HEAD is its own branch.
      const own = (name: string) => (name === 'HEAD' && dir !== ROOT && git.worktrees.has(dir) ? (git.worktrees.get(dir) ?? 'HEAD') : name.replace('refs/heads/', ''))
      const of = own(args[3] ?? '')
      const sha = args[2] === 'HEAD' ? top(own('HEAD')) : args[2]
      return (git.branches.get(of) ?? []).some(c => c.sha === sha) ? ok() : { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (args[0] === 'log' && args[1] === '-g') {
      // The reflog of the branch named, newest first.
      const name = (args.find(a => a.startsWith('refs/heads/')) ?? '').replace('refs/heads/', '')
      return ok([...reflogOf(name)].reverse().join('\n'))
    }
    if (args[0] === 'log') {
      const end = args.indexOf('--')
      const not = args.indexOf('--not')
      const refs = args.slice(4, not === -1 ? end : not).map(r => r.replace('refs/heads/', ''))
      // As in git, a branch that is not there is an error, not an empty log.
      if (refs.some(r => !git.branches.has(r))) return { value: { exitCode: 128, stdout: '', stderr: `fatal: bad revision '${refs.find(r => !git.branches.has(r)) ?? ''}'`, isStdoutTruncated: false, isStderrTruncated: false } }
      const negated = not === -1 ? [] : args.slice(not + 1, end)
      // `--not <sha>`: that commit and those beneath it.
      const beneath = new Set(
        negated
          .filter(a => !a.startsWith('--'))
          .flatMap(sha => [...git.branches.values()].flatMap(cs => (cs.some(c => c.sha === sha) ? cs.slice(cs.findIndex(c => c.sha === sha)).map(c => c.sha) : []))),
      )
      // `--exclude=<name> --branches`: every other branch's commits. As in git, the pattern an --exclude
      // gives --branches is the branch's name under refs/heads/: `refs/heads/x` matches nothing.
      const branches = negated.includes('--branches')
      const keep = negated.filter(a => a.startsWith('--exclude=')).map(a => a.slice('--exclude='.length))
      const kept = (b: string) => keep.some(k => (k.endsWith('*') ? b.startsWith(k.slice(0, -1)) : b === k))
      const elsewhere = new Set(branches ? [...git.branches].filter(([b]) => !kept(b)).flatMap(([, cs]) => cs.map(c => c.sha)) : [])
      const seen = new Set<string>()
      const lines = refs
        .flatMap(r => git.branches.get(r) ?? [])
        .filter(c => !elsewhere.has(c.sha) && !beneath.has(c.sha) && !seen.has(c.sha) && seen.add(c.sha) !== undefined)
      return ok(lines.map(c => `${c.sha}\t${c.subject}`).join('\n'))
    }
    return fail(`unknown: ${args.join(' ')}`)
  })
  /** A read of a Markdown file takes this long, by the test's clock, so two looks at the PRD can meet; `store`, the look-up of where the board is; `stat` and `write`, a look at and a write of one file. */
  const slow = { ms: 0, store: 0, stat: { path: '', ms: 0 }, write: { path: '', ms: 0 } }
  /** How many times each file was read. */
  const reads = new Map<string, number>()
  on('fs.read', async (_$, e) => {
    reads.set(e.path, (reads.get(e.path) ?? 0) + 1)
    if (broken.reads !== '' && e.path.startsWith(broken.reads)) return { deny: `EACCES: permission denied, open '${e.path}'` }
    if (slow.ms > 0 && e.path.endsWith('.md')) await clock.sleep(slow.ms)
    return disk.has(resolve(e.path)) ? { value: disk.get(resolve(e.path)) ?? '' } : { deny: `ENOENT ${e.path}` }
  })
  on('fs.write', async (_$, e) => {
    if (broken.writes !== '' && e.path.startsWith(broken.writes)) return { deny: `${broken.reason}, write '${e.path}'` }
    if (slow.write.ms > 0 && e.path === slow.write.path) await clock.sleep(slow.write.ms)
    // Writes follow links, as a real file system's do.
    disk.set(resolve(e.path), e.text)
    return { value: undefined }
  })
  on('fs.stat', async (_$, e) => {
    if (slow.stat.ms > 0 && e.path === slow.stat.path) await clock.sleep(slow.stat.ms)
    const real = resolve(e.path)
    // A link to nothing is still there: a link, with nowhere it leads.
    if (links.has(e.path) && !disk.has(real) && !isDir(real)) return { value: { kind: 'other' as const, size: 0, mtimeMs: 0, isLink: true } }
    if (!disk.has(real) && !isDir(real)) return { deny: `ENOENT ${e.path}` }
    const text = disk.get(real) ?? ''
    const mtimeMs = written.get(real) ?? 0
    return { value: { kind: isDir(real) ? ('dir' as const) : ('file' as const), size: text.length, mtimeMs, isLink: links.has(e.path), ...(e.resolve ? { realPath: real } : {}) } }
  })
  on('fs.list', (_$, e) => {
    const dir = e.path.endsWith('/') ? e.path : `${e.path}/`
    const names = new Set([...disk.keys()].filter(p => p.startsWith(dir)).map(p => p.slice(dir.length).split('/')[0] ?? ''))
    // A file's size and time come with its entry, as a real listing's do.
    return { value: [...names].map(name => (disk.has(`${dir}${name}`) ? { name, kind: 'file' as const, size: (disk.get(`${dir}${name}`) ?? '').length, mtimeMs: written.get(`${dir}${name}`) ?? 0, isLink: false } : { name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('model.complete', (_$, e) => {
    completions.push({ model: e.model, prompt: e.prompt, ...(e.system === undefined ? {} : { system: e.system }) })
    return { value: { isAnswered: true as const, text: replies.shift() ?? '[]', usage: { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  /** Registrations and spawns, in the order they happened. */
  const order: string[] = []
  on('tool.register', (_$, e) => {
    order.push(`tool:${e.name}`)
    registered.tools.push(e.name)
    return { value: { tool: `mcp__crew__${e.name}` } }
  })
  on('agent.register', (_$, e) => {
    order.push(`agent:${e.name}`)
    registered.agents.push(e.name)
    return { value: { agent: `crew:${e.name}` } }
  })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  /** The panes crew opened and closed, in order: `open:<id>`, `close:<id>`. */
  const panes: string[] = []
  on('ui.open', (_$, e) => {
    panes.push(`open:${(e as { id: string }).id}`)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$, e) => {
    panes.push(`close:${(e as { id: string }).id}`)
    return { value: undefined }
  })
  const logs: string[] = []
  /** Log rows that went to the person's transcript, not the debug log alone. */
  const shown: string[] = []
  on('ui.log', (_$, e) => {
    logs.push(String((e as { text?: unknown }).text ?? JSON.stringify(e)))
    if ((e as { to?: unknown }).to !== 'debug') shown.push(String((e as { text?: unknown }).text ?? ''))
    return { value: undefined }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  // The kit hands a plugin's spawn down as the Agent tool's input, and keeps the agent id to the engine:
  // the plugin finds its agent in the list instead, as it would behind a hook that kept the id back.
  on('agent.spawn', (_$, e) => {
    const input = e as unknown as { subagent_type?: string; subagentType?: string; name?: string; description: string; model?: string; prompt: string; cwd?: string }
    if (denySpawn !== '' && (denySpawnOf === '' || (input.subagentType ?? input.subagent_type) === denySpawnOf)) return { deny: denySpawn }
    order.push(`spawn:${input.subagentType ?? input.subagent_type ?? ''}`)
    spawned.push({
      subagentType: input.subagentType ?? input.subagent_type ?? '',
      description: input.description,
      prompt: input.prompt,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    })
    return { model: input.model ?? 'claude-sonnet-5-5' }
  })
  on('agent.list', () => ({
    value: spawned.map((s, i) => {
      const id = `a-${s.subagentType.replace('crew:', '')}-${i + 1}`
      return { id, spawnedBy: 'crew', type: s.subagentType, status: stopped.includes(id) ? 'completed' : 'running', description: s.description }
    }),
  }))
  /** The next so many messages to an agent are not delivered, as when it cannot take one just then. */
  const failSends = { n: 0 }
  // Resuming a finished agent asks whether its type is offered, as the engine does.
  /** Prompts another plugin drops: the next `times` that match. */
  const drops = { match: /$^/, times: 0 }
  /** The conversation's id, as the engine answers it: a /clear starts another. */
  const session = { id: 'session-1' }
  on('session.id', () => ({ value: session.id }) as never)
  on('session.messages', () => ({ value: [] }) as never)
  /** Claude's subscription windows as the engine reads them: none, as off a subscription, until a test sets them. */
  const limits: { kind: string; percentUsed: number; resetsAt?: string }[] = []
  on('session.usage', () => ({ value: { rateLimits: limits } }) as never)
  on('session.measure', (_$, e) => ({ changed: (e as { changed: unknown }).changed }) as never)
  on('session.send', async (_$, e) => {
    sent.push({ to: String(e.to), text: e.text })
    if (failSends.n > 0) {
      failSends.n -= 1
      return { isDelivered: false, reason: 'not now' }
    }
    const offer = (await engine.agent.offer({ agent: 'crew:pm', description: 'crew PM', source: 'plugin', provider: { plugin: 'crew', tier: 'user' } } as never)) as { isOffered: boolean }
    if (!offer.isOffered) return { isDelivered: false, reason: "Agent type 'crew:pm' is not offered in this session." }
    return deliver ? { isDelivered: true } : { isDelivered: false, reason: 'Agent could not be resumed' }
  })
  on('agent.offer', () => ({ isOffered: true }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_$, e) => {
    // Another plugin dropping the next prompts that match, as a hook may.
    if (drops.times > 0 && drops.match.test(e.text)) {
      drops.times -= 1
      return { drop: 'dropped by another plugin' }
    }
    submitted.push({ text: e.text, kind: e.origin.kind, ...(e.context === undefined ? {} : { context: e.context }) })
    if (e.origin.kind === 'plugin') prompts.push(e.text)
    return { text: e.text }
  })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  const board = () => JSON.parse(boardOn(disk) ?? 'null') as Tracker | null
  current.commit = commit
  current.clock = clock
  current.spawned = spawned
  current.ended = new Set()
  current.disk = disk
  current.store = store
  // The app crew starts: it answers once started, prints a line, and runs till crew stops it.
  on('process.spawn', async function* (_$, e) {
    const req = e as { argv: readonly string[]; cwd?: string; env?: Record<string, string> }
    app.starts.push({ argv: [...req.argv], ...(req.cwd === undefined ? {} : { cwd: req.cwd }), ...(req.env === undefined ? {} : { env: req.env }) })
    app.since = clock.now()
    if (app.fails) return { value: { code: 1, signal: null } }
    app.up = true
    if (app.detached) {
      yield { stream: 'stdout' as const, text: 'Container app Started\n' }
      return { value: { code: 0, signal: null } }
    }
    yield { stream: 'stdout' as const, text: 'ready on http://localhost:3000\n' }
    await new Promise<void>(resolve => {
      app.stop = resolve
    })
    return { value: { code: null, signal: 'SIGTERM' } }
  })
  return { disk, env, spawned, sent, toasts, registered, board, completions, replies, order, prompts, logs, shown, clock, links, submitted, store, slow, reads, git, commit, amend, reset, tests, broken, refuse, panes, failSends, session, drops, limits, awake, app }
}

export const start = ($: Engine) => $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as SessionStartInput)

export const command = (args: string): CommandRunInput => ({
  command: 'crew',
  args,
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 140 },
})

export const write = ($: Engine, agentId: string, ops: unknown[]) =>
  $.tool.call({ tool: 'mcp__crew__board_write', tool_use_id: `t-${Math.random()}`, agentId, ops } as never) as Promise<{ result: unknown }>

export const done = ($: Engine, agentId: string, answer = '完成') =>
  $.turn.complete({ answer, durationMs: 5, isAborted: false, turnId: `turn-${agentId}`, reason: 'answer', agentId } as TurnCompleteInput)

/** The world PRD's one requirement (a paragraph: it has no lists), which every feature of the split answers. */
export const REQ = requirementsOf(PRD)[0]?.id ?? ''

export const SPLIT = [
  { op: 'add_feature', title: '方案選擇', summary: '選月繳', sources: [REQ] },
  { op: 'add_feature', title: '取消訂閱', summary: '用到期末', sources: [REQ] },
  { op: 'add_criterion', feature: 'PRD-001', text: '可以選月繳方案' },
  { op: 'add_criterion', feature: 'PRD-002', text: '取消後仍可使用到期末' },
]

/** The tech lead's plan for SPLIT: one task for each feature's criterion. */
export const PLAN = [
  { op: 'add_task', feature: 'PRD-001', criteria: ['AC-001'], title: '方案頁', detail: '', size: 'S' },
  { op: 'add_task', feature: 'PRD-002', criteria: ['AC-002'], title: '取消流程', detail: '', size: 'S' },
]


/** The pane's text on one tab. */
/** crew's pane as the person sees it in the terminal, held open to press and type in. */
export const paneUi = ($: Engine) =>
  $.ui.mount({
    plugin: 'crew',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'crew',
    props: { title: 'Crew', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 80 } } as unknown as RenderPropsOf['Pane'],
  })

/** The person presses 接續 in the pane: a flow left running when Claude Code closed goes on. */
export const resumed = async ($: Engine) => {
  const ui = await paneUi($)
  await ui.press({ key: 'resume' })
  await ui.unmount()
}

/** Every text a mounted drawing shows, joined. */
export const textOf = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) => (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')

export const paneText = async ($: Engine, tab?: string) => {
  const ui = await $.ui.mount({
    plugin: 'crew',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'crew',
    props: { title: 'Crew', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 80 } } as unknown as RenderPropsOf['Pane'],
  })
  if (tab !== undefined) {
    await ui.press({ key: `tab-${tab}` })
  }
  const text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
  await ui.unmount()
  return text
}

/** The full-stack builds each task in turn: a commit that does it on crew's branch, then the end of its run. */
type BoardFile = { prd_items: { id: string; title: string; crew_dropped?: string; crew_designs?: { id: string; crew_dropped?: string; crew_decision?: { verdict: string } }[] }[] }

const boardFile = (): BoardFile => JSON.parse(boardOn(current.disk) ?? '{"prd_items":[]}') as BoardFile

/** The latest agent crew started for a role, by the test world's numbering. */
export const agentOf = (role: string): string => `a-${role}-${(current.spawned ?? []).map(s => s.subagentType).lastIndexOf(`crew:${role}`) + 1}`

/**
 * The UI/UX designer designs every feature that has none (a feature with no
 * new screen), its run ends, and the person approves every design waiting.
 */
export const designed = async ($: Engine) => {
  const agentId = agentOf('uiux')
  const need = boardFile().prd_items.filter(i => i.crew_dropped === undefined && !(i.crew_designs ?? []).some(d => d.crew_dropped === undefined && d.crew_decision?.verdict !== 'rejected'))
  if (need.length > 0) await write($, agentId, need.map(i => ({ op: 'add_design', feature: i.id, title: `${i.title} 畫面`, kind: 'none', body: '沒有新畫面：用既有頁面。' })))
  await done($, agentId)
  const waiting = boardFile().prd_items.flatMap(i => (i.crew_designs ?? []).filter(d => d.crew_dropped === undefined && d.crew_decision === undefined).map(d => d.id))
  if (waiting.length > 0) await $.command.run(command(`approve ${waiting.join(' ')}`))
}

/** The tech lead sends its verdict on the task it reviews, and its run ends. */
export const approve = async ($: Engine, task: string, agentId = 'a-techlead-4', verdict: 'approve' | 'changes' = 'approve', notes?: string) => {
  const r = await $.tool.call({ tool: 'mcp__crew__review_submit', tool_use_id: `r-${Math.random()}`, agentId, task, verdict, ...(notes === undefined ? {} : { notes }) } as never)
  await done($, agentId)
  return r as { result: unknown }
}

/** The full-stack commits each task and the tech lead approves it; then the tests crew runs on the clock pass. */
export const build = async ($: Engine, ids: readonly string[] = ['TASK-001', 'TASK-002'], agentId = 'a-fullstack-5', techlead = 'a-techlead-4') => {
  for (const id of ids) {
    current.commit?.(`${id}: 完成 ${id}`)
    await done($, agentId)
    await approve($, id, techlead)
  }
  await tested()
}

/** The app QA's checks open, as the person sets it on the settings tab when a test has not. */
/** A QA run the test ends itself: checked() leaves it. */
export const qaDone = ($: Engine, agentId: string, answer = '完成') => {
  current.ended?.add(agentId)
  return done($, agentId, answer)
}

export const APP_CMD = 'npm run dev'
export const APP_URL = 'http://localhost:3000'

/**
 * QA, in the app, reports on the feature crew asked it to check: every test
 * case passed, and a picture of each thing the person is to look at (or the
 * API it called, for a feature with no screen), as crew requires.
 */
export const reportShots = async ($: Engine, agentId: string, over: Record<string, unknown> = {}) => {
  const prompt = (current.spawned ?? []).filter(x => x.subagentType === 'crew:checker').at(-1)?.prompt ?? ''
  const feature = /請在 app 裡實際操作 (\S+)/.exec(prompt)?.[1] ?? ''
  const scope = checkScope(JSON.parse(boardOn(current.disk) ?? '{"prd_items":[]}') as Tracker, feature)
  const criteria = scope?.criteria ?? []
  const screen = (scope?.screens.length ?? 0) > 0
  const items = Array.from({ length: Math.min(3, Math.max(1, criteria.length)) }, (_, n) => {
    const shot = (kind: string) => {
      const file = `${feature.toLowerCase()}-${n + 1}-${kind}.png`
      current.disk?.set(`${ROOT}/.crew/qa-shots/${file}`, 'png')
      return { file, box: { x: 10, y: 20, width: 100, height: 40 } }
    }
    const c = criteria[n % Math.max(1, criteria.length)]
    return { criterion: c?.id ?? 'AC-001', ask: `看第 ${n + 1} 件`, saw: '照驗收條件做到了', ...(screen ? { desktop: shot('desktop'), phone: shot('phone') } : { api: { request: 'GET /api/items', response: '{"ok":true}', lit: ['ok'] } }) }
  })
  return $.tool.call({ tool: 'mcp__crew__check_report', tool_use_id: `c-${Math.random()}`, agentId, feature, cases: (scope?.cases ?? []).map(c => ({ id: c.id, result: 'passed' })), items, where: { page: '/' }, console: { errors: 0, sample: [] }, failed: [], ...over } as never) as Promise<{ result: unknown }>
}

/**
 * QA checks each finished feature in the app and reports with pictures (see
 * reportShots): nothing reaches the person without them, so the person sets
 * the app first, as on the settings tab, where a test has not. A QA run crew
 * started to find how to start the app ends with nothing found.
 */
export const checked = async ($: Engine) => {
  if (current.store?.get(`start:${ROOT}`) === undefined) await $.command.run(command(`start-command ${APP_CMD}`))
  if (current.store?.get(`url:${ROOT}`) === undefined) await $.command.run(command(`app-url ${APP_URL}`))
  const ended = current.ended ?? new Set<string>()
  for (let n = 0, idle = 0; n < 60 && idle < 3; n++) {
    // QA starts at the engine's next frame once the app is up: here the brain's turn ending. The clock moves by whole
    // looks at the PRD (10 s), so a test's looks after this keep their times.
    await current.clock?.advance(10_000)
    await $.turn.complete({ answer: '好', durationMs: 5, isAborted: false, turnId: `turn-brain-${n}`, reason: 'answer' } as TurnCompleteInput)
    const finder = agentOf('finder')
    if (finder !== 'a-finder-0' && !ended.has(finder)) {
      ended.add(finder)
      idle = 0
      await done($, finder)
      continue
    }
    const checker = agentOf('checker')
    if (checker !== 'a-checker-0' && !ended.has(checker)) {
      ended.add(checker)
      idle = 0
      await reportShots($, checker)
      await done($, checker)
      continue
    }
    // Nothing new to end: over, unless a check is on its way (its app coming up, or its QA starting at the next frame).
    const flow = (current.store?.get(`state:${ROOT}`) as { flow?: { checks?: Record<string, { state?: string }> } } | undefined)?.flow
    if (!Object.values(flow?.checks ?? {}).some(c => c.state === 'running')) break
    idle += 1
  }
}

/**
 * QA hands each feature over and the person passes it: QA checks each in the
 * app (see checked), then the person presses 通過 on every feature in the
 * pane: the one the test holds open, if it does.
 */
export const accepted = async ($: Engine, open?: Awaited<ReturnType<typeof paneUi>>) => {
  await checked($)
  const ui = open ?? (await paneUi($))
  await ui.press({ key: 'tab-overview' })
  // One the person passed already, with nothing new since, has no card to pass.
  const accepts = (current.store?.get(`state:${ROOT}`) as { flow?: { accepts?: Record<string, { state?: string }> } } | undefined)?.flow?.accepts ?? {}
  for (const i of boardFile().prd_items.filter(x => x.crew_dropped === undefined && accepts[x.id]?.state !== 'passed')) await ui.press({ key: `acc-pass-${i.id}` })
  if (open === undefined) await ui.unmount()
}

/** Lets a test run crew started on the clock go to its end. */
export const tested = async () => {
  await current.clock?.advance(1)
}
