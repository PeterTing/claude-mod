/**
 * Codex as a role's engine: the command crew runs, what it reads back from
 * Codex's JSON events, and why a run failed. Nothing here touches the host;
 * register.tsx runs the command and hands the output back.
 */

import { SUBJECT } from './git'
import type { RunStep } from './model'

/** The Codex version these flags were tried on: a name a later Codex no longer knows is ignored by it. */
export const CODEX_TESTED = '0.162.1'

/**
 * Codex features a crew role never gets, beyond what the person's config.toml
 * turns on (crew does not load it): the Claude roles have no web search,
 * browser, image making, goals or sub-agents either. `code_mode_host` stays
 * on: without it the shell tools go too, and a role cannot read the repo.
 */
export const CODEX_OFF = [
  'plugins',
  'apps',
  'image_generation',
  'goals',
  'memories',
  'chronicle',
  'browser_use',
  'browser_use_external',
  'browser_use_full_cdp_access',
  'computer_use',
  'in_app_browser',
  'tool_suggest',
  'skill_search',
  'hooks',
  'sleep_tool',
  'realtime_conversation',
  'multi_agent',
  'multi_agent_v2',
] as const

/** A TOML string, as `-c key=value` reads one. */
const toml = (text: string): string => JSON.stringify(text)

/** The `skills.config` that turns off each skill file Codex would offer the role. */
export const skillsOff = (paths: readonly string[]): string => `skills.config=[${paths.map(p => `{path=${toml(p)}, enabled=false}`).join(', ')}]`

export type CodexRun = {
  model: string
  effort: string
  /** The four roles that write nothing but crew's actions read only; the full-stack writes its worktree. */
  sandbox: 'read-only' | 'workspace-write'
  network: boolean
  /** The JSON schema file the last message must match. */
  schema: string
  /** The role card: developer instructions, which win over the person's AGENTS.md. */
  developer: string
  skills: readonly string[]
  /** The thread to go on with: a wake. */
  resume?: string
}

/**
 * The command for one run, its work read from stdin (`-`) so it never shows in
 * `ps`. The person's config.toml is not loaded (their MCP servers, features and
 * environment); the login still is. Nor are their execpolicy rules: a command a
 * rule allows runs outside the sandbox (tried on 0.162.1: a read-only role's
 * `git commit` went through without `--ignore-rules`). The sandbox is set by
 * `-c`, which a resumed run takes too: `exec resume` has no `-s`.
 */
export const codexArgv = (r: CodexRun): string[] => [
  'codex',
  'exec',
  ...(r.resume === undefined ? [] : ['resume', r.resume]),
  '--json',
  '--ignore-user-config',
  '--ignore-rules',
  '--skip-git-repo-check',
  '-m',
  r.model,
  '-c',
  `model_reasoning_effort=${toml(r.effort)}`,
  '-c',
  `sandbox_mode=${toml(r.sandbox)}`,
  ...(r.sandbox === 'workspace-write' ? ['-c', `sandbox_workspace_write.network_access=${r.network}`] : []),
  '-c',
  'approval_policy="never"',
  '-c',
  'shell_environment_policy.inherit="core"',
  '-c',
  'web_search="disabled"',
  '-c',
  `developer_instructions=${toml(r.developer)}`,
  ...(r.skills.length === 0 ? [] : ['-c', skillsOff(r.skills)]),
  ...CODEX_OFF.flatMap(f => ['--disable', f]),
  '--output-schema',
  r.schema,
  '-',
]

/** Tokens as Codex counts them: `cached` is the part of `input` read from its cache. */
export type CodexUsage = { input: number; cached: number; output: number; reasoning: number }

/** `commit`: the full-stack's message for what it changed, which crew commits for it (Codex cannot write the worktree's git data). */
export type CodexOutput = { report: string; actions: { tool: string; input: string }[]; commit?: string }

/** What a run said, read from its JSON events. */
export type CodexEnd = {
  thread?: string
  output?: CodexOutput
  /** As Codex told it: on a resumed thread, the thread's total so far. */
  usage?: CodexUsage
  /** Why the turn failed, when it did. */
  failed?: string
  /** The last error event, which may only be a retry. */
  error?: string
  /** Calls to start a sub-agent: a role card forbids them, so each is told. */
  spawned: number
  /** The commands it ran, and how much each printed: never what. */
  commands: { command: string; chars: number }[]
  /** What it did, step by step, as it told it: for the person to read back. */
  steps?: RunStep[]
}

const isOutput = (v: unknown): v is CodexOutput => {
  const o = v as CodexOutput
  return typeof o === 'object' && o !== null && typeof o.report === 'string' && Array.isArray(o.actions) && o.actions.every(a => typeof a?.tool === 'string' && typeof a?.input === 'string') && (o.commit === undefined || typeof o.commit === 'string')
}

/** Reads `codex exec --json` output, one event a line; a line that is not an event is skipped. */
export const readEvents = (text: string): CodexEnd => {
  const end: CodexEnd = { spawned: 0, commands: [] }
  const steps: RunStep[] = []
  for (const line of text.split('\n')) {
    let ev: { type?: string; thread_id?: string; usage?: Record<string, number>; message?: string; error?: { message?: string }; item?: Record<string, unknown> }
    try {
      ev = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof ev !== 'object' || ev === null) continue
    if (ev.type === 'thread.started' && typeof ev.thread_id === 'string') end.thread = ev.thread_id
    if (ev.type === 'turn.completed' && ev.usage !== undefined) {
      end.usage = { input: ev.usage.input_tokens ?? 0, cached: ev.usage.cached_input_tokens ?? 0, output: ev.usage.output_tokens ?? 0, reasoning: ev.usage.reasoning_output_tokens ?? 0 }
    }
    if (ev.type === 'turn.failed') end.failed = String(ev.error?.message ?? 'Codex 沒有說原因')
    if (ev.type === 'error' && typeof ev.message === 'string') end.error = ev.message
    const item = ev.item
    if (ev.type !== 'item.completed' || item === undefined) continue
    if (item.type === 'agent_message' && typeof item.text === 'string') {
      try {
        const parsed: unknown = JSON.parse(item.text)
        if (isOutput(parsed)) end.output = parsed
        else steps.push({ kind: 'message', text: item.text })
      } catch {
        // Its words along the way, not the answer.
        steps.push({ kind: 'message', text: item.text })
      }
    } else if (item.type === 'command_execution') {
      end.commands.push({ command: String(item.command ?? '').slice(0, 120), chars: String(item.aggregated_output ?? '').length })
      steps.push({ kind: 'command', text: String(item.command ?? ''), output: String(item.aggregated_output ?? '') })
    } else if (item.type === 'file_change' && Array.isArray(item.changes)) {
      steps.push({ kind: 'file', text: (item.changes as { kind?: unknown; path?: unknown }[]).map(c => `${String(c?.kind ?? '')} ${String(c?.path ?? '')}`.trim()).join('\n') })
    } else if (item.type !== 'reasoning' && (item.tool === 'spawn_agent' || item.name === 'spawn_agent')) {
      // A call of the tool itself, not its name in the run's words.
      end.spawned += 1
    } else if (item.type === 'mcp_tool_call' || item.type === 'web_search') {
      steps.push({ kind: 'tool', text: [item.server, item.tool, item.query].filter(x => typeof x === 'string').join(' ') })
    }
  }
  if (steps.length > 0) end.steps = steps
  return end
}

/** This run's tokens: a resumed thread reports its whole total, so the total before it comes off. */
export const usageDelta = (now: CodexUsage, before?: CodexUsage): CodexUsage =>
  before === undefined
    ? now
    : { input: Math.max(0, now.input - before.input), cached: Math.max(0, now.cached - before.cached), output: Math.max(0, now.output - before.output), reasoning: Math.max(0, now.reasoning - before.reasoning) }

export type CodexFailure = { kind: 'login' | 'quota' | 'busy' | 'failed'; text: string; retryAt?: string }

/**
 * Why a run failed, from its message as codex-cli 0.162.1 words it: a 401 is
 * a login gone; "hit your usage limit" the quota, with when it comes back;
 * "Selected model is at capacity" the model busy for everyone, for a while.
 */
export const failureOf = (message: string): CodexFailure => {
  const text = message.slice(0, 400)
  if (/401 Unauthorized|Not logged in|reauthoriz|refresh token/i.test(message)) return { kind: 'login', text }
  if (/model is at capacity|server_is_overloaded|overloaded/i.test(message)) return { kind: 'busy', text }
  if (/hit your usage limit|usage_limit_reached|rate_limit_reached/i.test(message)) {
    const at = /try again at ([^.\n]+)/i.exec(message)?.[1]?.trim()
    return { kind: 'quota', text, ...(at === undefined ? {} : { retryAt: at }) }
  }
  return { kind: 'failed', text }
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * When a used-up quota comes back, from the time its message gives (codex-cli
 * 0.162.1 writes `%b %-d<st|nd|rd|th>, %Y %-I:%M %p`, or the time alone for
 * today), in this machine's time; undefined for any other wording.
 */
export const retryTime = (at: string, now: number): number | undefined => {
  const time = /(\d{1,2}):(\d{2})\s*([AP]M)/i.exec(at)
  if (time === null) return undefined
  const hour = (Number(time[1]) % 12) + (time[3]?.toUpperCase() === 'PM' ? 12 : 0)
  const minute = Number(time[2])
  const date = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/.exec(at)
  const today = new Date(now)
  const month = date === null ? today.getMonth() : MONTHS.indexOf((date[1] ?? '').toLowerCase())
  if (month < 0) return undefined
  const t = new Date(date === null ? today.getFullYear() : Number(date[3]), month, date === null ? today.getDate() : Number(date[2]), hour, minute).getTime()
  if (Number.isNaN(t)) return undefined
  // A time alone that has passed today is tomorrow's; one that passed minutes ago is today's, said to the minute.
  return date === null && t <= now - 10 * 60_000 ? t + 86_400_000 : t
}

/** How the person is logged in, from `codex login status`, which exits 0 only when logged in. */
export const loginOf = (said: string): 'chatgpt' | 'apikey' => (/api key/i.test(said) ? 'apikey' : 'chatgpt')

/**
 * The schema of a Codex role's last message: a report, and the actions it
 * hands crew; for the full-stack (`commit`), its commit message too, '' for
 * none. Codex's strict schema has every property required.
 */
export const outputSchema = (tools: readonly string[], commit = false) => ({
  type: 'object',
  additionalProperties: false,
  required: ['report', 'actions', ...(commit ? ['commit'] : [])],
  properties: {
    report: { type: 'string' },
    ...(commit ? { commit: { type: 'string' } } : {}),
    actions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['tool', 'input'],
        properties: { tool: { type: 'string', enum: [...tools] }, input: { type: 'string' } },
      },
    },
  },
})

/** The most of a commit message crew takes from a Codex builder. */
const MESSAGE_MAX = 2_000

/**
 * What crew takes out of a Codex builder's commit message: control characters
 * (C0 but the newline and tab, DEL, C1), the line and paragraph separators, and
 * the marks that reorder text as a terminal or a review shows it (bidi
 * embeddings, overrides and isolates), so the log reads as it was written.
 */
const UNSHOWN = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g

/**
 * The message crew commits a Codex builder's work with: its own when its first
 * line starts with task ids as crew reads a commit (`TASK-003: …`, or with
 * other tasks' too) that hold the task it works on, and says something after
 * them; what it cannot show taken out, cut (`given`). Otherwise crew's own,
 * `<task>: <fallback>`, which crew uses only to finish a merge it began for
 * the builder: other work is not done till the builder says so. With no task,
 * only one of its own: none.
 */
export const commitMessage = (said: string | undefined, task: string | undefined, fallback: string): { message: string; given: boolean } | undefined => {
  const text = (said ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(UNSHOWN, '')
    .trim()
    .slice(0, MESSAGE_MAX)
  const first = (text.split('\n')[0] ?? '').trim()
  const m = SUBJECT.exec(first)
  const ids = m === null ? [] : (m[1] ?? '').split(/\s*[,，、]\s*/)
  const rest = m === null ? '' : first.slice(m[0].length).replace(/^[\]\s:：]+/, '').trim()
  if (m !== null && rest !== '' && (task === undefined || ids.includes(task))) return { message: text, given: true }
  return task === undefined ? undefined : { message: `${task}: ${fallback}`, given: false }
}
