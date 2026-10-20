import type { CommandRunInput, On, RenderPropsOf, SessionStartInput, TurnCompleteInput } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { Tracker } from './board'
import { requirementsOf } from './prd'

/**
 * crew end to end inside the kit: a repo on an in-memory disk, the PM and QA
 * played by the test through the same tool calls and turn ends a session has.
 */

export const ROOT = '/repo'
export const NOW = Date.UTC(2026, 9, 15, 6, 0, 0)

export const PRD = '# 會員訂閱\n\n使用者可以選月繳方案，可以隨時取消，取消後用到期末。'

export type Spawn = { subagentType: string; name?: string; description: string; model?: string; prompt: string; cwd?: string }

/** The world a test made last: what `build` commits into. */
const current: {
  commit?: (subject: string, branch?: string) => string
  clock?: { advance: (ms: number) => Promise<unknown> }
  spawned?: { subagentType: string }[]
  disk?: Map<string, string>
} = {}

export const world = (engine: Engine, on: On, { deliver = true, denySpawn = '', denySpawnOf = '', stopped = [] as string[] } = {}) => {
  const clock = mock.clock(on, { now: NOW })
  /** crew's own store, which outlives sessions and is not in the repo. */
  const store = new Map<string, unknown>([[`tests:${ROOT}`, { argv: ['npm', 'test'] }]])
  on('store.get', (_$, e) => ({ value: store.get((e as { key: string }).key) }))
  on('store.set', (_$, e) => {
    const { key, value } = e as { key: string; value: unknown }
    store.set(key, JSON.parse(JSON.stringify(value)))
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    store.delete((e as { key: string }).key)
    return { value: undefined }
  })
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
    branches: new Map<string, { sha: string; subject: string }[]>([['HEAD', [{ sha: 'c0ffee'.padEnd(40, '0'), subject: 'init' }]]]),
    worktrees: new Map<string, string>(),
    commands: [] as string[][],
    /** What `git status --porcelain` says in crew's worktree: changes not committed. */
    dirty: '',
    /** What it says in the person's checkout. */
    checkout: '',
    /** The checkout's branch, as `git symbolic-ref HEAD` says it. */
    ref: 'refs/heads/main',
  }
  /** The person's test command as crew runs it: what it prints and how it exits, and each run's words and folder. */
  const tests = { exitCode: 0, stdout: '', stderr: '', runs: [] as { argv: string[]; cwd?: string; env?: Record<string, string> }[], fails: '' }
  /** Writes under this path fail, as on a full disk. */
  const broken = { writes: '' }
  let shas = 0
  /** A commit the full-stack made on a branch (crew's, by default the PRD's). */
  const commit = (subject: string, branch = 'crew/prd') => {
    shas += 1
    const sha = (0xabc0000 + shas).toString(16).padStart(7, '0')
    git.branches.set(branch, [{ sha, subject }, ...(git.branches.get(branch) ?? [])])
    return sha
  }
  on('process.run', (_$, e) => {
    const argv = (e as { argv: string[] }).argv
    git.commands.push([...argv])
    const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const fail = (stderr = '') => ({ value: { exitCode: 1, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[0] !== 'git') {
      // Anything but git is the person's test command.
      const init = (e as { init?: { cwd?: string; env?: Record<string, string> } }).init
      tests.runs.push({ argv: [...argv], ...(init?.cwd === undefined ? {} : { cwd: init.cwd }), ...(init?.env === undefined ? {} : { env: init.env }) })
      if (tests.fails !== '') return { deny: tests.fails }
      // Unless a test says what the run prints, every test case on the board passes, named by its id.
      const board = JSON.parse(disk.get(`${ROOT}/prd-tracker.json`) ?? '{"prd_items":[]}') as { prd_items: { test_cases?: { id: string }[] }[] }
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
      if (name === 'HEAD^{commit}') return top('HEAD') === undefined ? fail() : ok(`${top('HEAD')}\n`)
      const branch = name.replace('refs/heads/', '').replace('^{commit}', '')
      return git.branches.has(branch) ? ok(`${top(branch) ?? 'x'}\n`) : fail()
    }
    if (args[0] === 'symbolic-ref') return git.ref === '' ? fail() : ok(`${git.ref}\n`)
    if (args[0] === 'worktree' && args[1] === 'add') {
      const fresh = args[2] === '-b'
      const branch = args[3] ?? ''
      const at2 = fresh ? (args[4] ?? '') : (args[2] ?? '')
      if (fresh) {
        // The new branch starts at the commit given, with the history beneath it.
        const from = args[5] ?? 'HEAD'
        const line = [...git.branches.values()].find(cs => cs.some(c => c.sha === from)) ?? git.branches.get('HEAD') ?? []
        git.branches.set(branch, line.slice(Math.max(0, line.findIndex(c => c.sha === from))))
      }
      git.worktrees.set(at2, branch)
      disk.set(`${at2}/.git`, `gitdir: ${ROOT}/.git/worktrees/x`)
      return ok()
    }
    if (args[0] === 'status' && args[1] === '--porcelain') return ok(dir === ROOT ? git.checkout : git.dirty)
    if (args[0] === 'show') {
      // Each commit as `git show` prints it: its sha, its subject, and a diff.
      const shas = args.slice(1, args.indexOf('--') === -1 ? undefined : args.indexOf('--')).filter(a => !a.startsWith('-'))
      const all = [...git.branches.values()].flat()
      return ok(shas.map(sha => `commit ${sha}\n${all.find(c => c.sha === sha)?.subject ?? ''}\n\n diff of ${sha}\n`).join('\n'))
    }
    if (args[0] === 'log') {
      const end = args.indexOf('--')
      const not = args.indexOf('--not')
      const refs = args.slice(4, not === -1 ? end : not).map(r => r.replace('refs/heads/', ''))
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
      const keep = negated.find(a => a.startsWith('--exclude='))?.slice('--exclude='.length)
      const elsewhere = new Set(branches ? [...git.branches].filter(([b]) => b !== keep).flatMap(([, cs]) => cs.map(c => c.sha)) : [])
      const seen = new Set<string>()
      const lines = refs
        .flatMap(r => git.branches.get(r) ?? [])
        .filter(c => !elsewhere.has(c.sha) && !beneath.has(c.sha) && !seen.has(c.sha) && seen.add(c.sha) !== undefined)
      return ok(lines.map(c => `${c.sha}\t${c.subject}`).join('\n'))
    }
    return fail(`unknown: ${args.join(' ')}`)
  })
  /** A read of a Markdown file takes this long, by the test's clock, so two looks at the PRD can meet. */
  const slow = { ms: 0 }
  /** How many times each file was read. */
  const reads = new Map<string, number>()
  on('fs.read', async (_$, e) => {
    reads.set(e.path, (reads.get(e.path) ?? 0) + 1)
    if (slow.ms > 0 && e.path.endsWith('.md')) await clock.sleep(slow.ms)
    return disk.has(resolve(e.path)) ? { value: disk.get(resolve(e.path)) ?? '' } : { deny: `ENOENT ${e.path}` }
  })
  on('fs.write', (_$, e) => {
    if (broken.writes !== '' && e.path.startsWith(broken.writes)) return { deny: `ENOSPC: no space left on device, write '${e.path}'` }
    // Writes follow links, as a real file system's do.
    disk.set(resolve(e.path), e.text)
    return { value: undefined }
  })
  on('fs.stat', (_$, e) => {
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
    return { value: [...names].map(name => ({ name, kind: disk.has(`${dir}${name}`) ? ('file' as const) : ('dir' as const), size: 0, mtimeMs: 0, isLink: false })) }
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
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
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
  // Resuming a finished agent asks whether its type is offered, as the engine does.
  on('session.send', async (_$, e) => {
    sent.push({ to: String(e.to), text: e.text })
    const offer = (await engine.agent.offer({ agent: 'crew:pm', description: 'crew PM', source: 'plugin', provider: { plugin: 'crew', tier: 'user' } } as never)) as { isOffered: boolean }
    if (!offer.isOffered) return { isDelivered: false, reason: "Agent type 'crew:pm' is not offered in this session." }
    return deliver ? { isDelivered: true } : { isDelivered: false, reason: 'Agent could not be resumed' }
  })
  on('agent.offer', () => ({ isOffered: true }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_$, e) => {
    submitted.push({ text: e.text, kind: e.origin.kind, ...(e.context === undefined ? {} : { context: e.context }) })
    if (e.origin.kind === 'plugin') prompts.push(e.text)
    return { text: e.text }
  })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  const board = () => JSON.parse(disk.get(`${ROOT}/prd-tracker.json`) ?? 'null') as Tracker | null
  current.commit = commit
  current.clock = clock
  current.spawned = spawned
  current.disk = disk
  return { disk, spawned, sent, toasts, registered, board, completions, replies, order, prompts, logs, shown, clock, links, submitted, store, slow, reads, git, commit, tests, broken }
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

const boardFile = (): BoardFile => JSON.parse(current.disk?.get(`${ROOT}/prd-tracker.json`) ?? '{"prd_items":[]}') as BoardFile

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

/** Lets a test run crew started on the clock go to its end. */
export const tested = async () => {
  await current.clock?.advance(1)
}
