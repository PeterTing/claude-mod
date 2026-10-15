import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { CrewLive, CrewMessage, CrewScenario, CrewTab } from '../types'
import { applyOps, criteriaOf, gateG1, gateG4, newTracker, parseOps, prefixesFrom, renderBoard } from './board'
import type { Tracker } from './board'
import { CONSOLIDATION_SYSTEM, consolidationPrompt, parseProposals } from './consolidate'
import { DEMO } from './demo'
import { step } from './flow'
import type { FlowAction, FlowEvent } from './flow'
import { dayOf, emptyLive, snapshotOf } from './live'
import { addMemory, estimateTokens, MEMORY_TYPES, packMemories, parseMemories, redact, searchMemories, serializeMemories } from './memory'
import type { AddResult, MemoryEntry, MemoryInput, MemoryType } from './memory'
import { ROLE_NAMES } from './model'
import { composeStart, relatedOf, threadLines, wakePlan, withMemories, workingSet } from './pack'
import { AGENT_SPECS, CREW_ROLES, TOOL_SPECS } from './roles'
import type { CrewRole } from './roles'
import { routeFor } from './router'
import type { Route } from './router'
import { bandText, CrewPane } from './views'
import type { Actions } from './views'

const PANE = 'crew'

/** The names the roles get as teammates, and how a message names them. */
const CREW_TEAMMATE = /^crew-(pm|qa)\b/i
const CREW_MENTION = /@crew-(pm|qa)\b/i

const isDemo = atom({ plugin: 'crew', key: 'isDemo' } as const, false)
const tab = atom({ plugin: 'crew', key: 'tab' } as const, 'overview' as CrewTab)
const scenario = atom({ plugin: 'crew', key: 'scenario' } as const, 'normal' as CrewScenario)
const thread = atom({ plugin: 'crew', key: 'thread' } as const, null as string | null)
const gate = atom({ plugin: 'crew', key: 'gate' } as const, null as string | null)
const live = atom({ plugin: 'crew', key: 'live' } as const, emptyLive())

/** Where crew keeps things in the repo the session runs in. */
const files = { root: '', board: '', schema: '', crew: '', memories: '' }

/** The memories as last read or written. */
const memo: { list: MemoryEntry[] | undefined } = { list: undefined }

/** Today's log, as written so far. */
const diary: { day: string; lines: string[] } = { day: '', lines: [] }

/** The last day crew checked for a log left to tidy. */
const tidy = { checked: '' }

/** Settles once session.start has registered the command, the roles and the tools. */
const boot: { ready: Promise<void> } = { ready: Promise.resolve() }

/** How many role wakes are under way: the roles are offered to the engine only then. */
const waking = { count: 0 }

/** The board as last read or written; reloaded from disk when a role finishes. */
const cache: { board: Tracker | null | undefined } = { board: undefined }

const crewName = (role: CrewRole): string => ROLE_NAMES[role]

const safe = (item: string): string => item.replace(/[^\w.-]+/g, '_')

const firstLine = (text: string): string => (text.split('\n')[0] ?? '').slice(0, 60)

const cut = (text: string, max: number): string => ([...text].length > max ? `${[...text].slice(0, max).join('')}…` : text)

const who = (name: string): string => (name === 'person' ? '使用者' : (ROLE_NAMES[name as CrewRole] ?? name))

const usageOf = (u: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }) => ({
  input: u.input_tokens ?? 0,
  output: u.output_tokens ?? 0,
  cacheRead: u.cache_read_input_tokens ?? 0,
  cacheWrite: u.cache_creation_input_tokens ?? 0,
})

const ZERO = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, wakes: 0, rotations: 0 }

/** What a role's summary keeps when the engine compacts it before crew rotates it. */
const COMPACT_NOTE =
  '保留：這次的工作還剩哪些、提到的編號（PRD-、AC-、TC-、DEC-、Q-、ASK- 等）、做過的決定和原因。看板、討論串和記憶都存在 repo，之後用 board_read、thread_read、memory_search 再讀，不用抄進摘要。'

const decisionIdsOf = (board: Tracker | null): string[] =>
  (board?.decisions ?? []).map(d => (d as { id?: unknown }).id).filter((id): id is string => typeof id === 'string')

async function loadBoard($: any, force = false): Promise<Tracker | null> {
  if (files.board === '') return null
  if (!force && cache.board !== undefined) return cache.board
  cache.board = (await $.fs.exists(files.board)) ? (JSON.parse(await $.fs.read(files.board)) as Tracker) : null
  return cache.board
}

async function saveBoard($: any, board: Tracker) {
  cache.board = board
  await $.fs.write(files.board, `${JSON.stringify(board, null, 2)}\n`)
}

async function idPrefixes($: any) {
  return prefixesFrom((await $.fs.exists(files.schema)) ? JSON.parse(await $.fs.read(files.schema)) : undefined)
}

async function post($: any, message: Omit<CrewMessage, 't'>) {
  const t = await $.clock.now()
  const next = await update($, live, l => ({
    ...l,
    posted: l.posted + 1,
    threads: { ...l.threads, [message.item]: [...(l.threads[message.item] ?? []), { ...message, t, n: l.posted + 1 }].slice(-50) },
  }))
  const lines = (next.threads[message.item] ?? []).map(m => JSON.stringify(m)).join('\n')
  await $.fs.write(`${files.crew}/threads/${safe(message.item)}.jsonl`, `${lines}\n`)
  await note($, { kind: 'post', item: message.item, from: message.from, ...(message.to === undefined ? {} : { to: message.to }), text: message.text })
}

/** One line in today's log (.crew/log, kept out of git), secrets masked. */
async function note($: any, event: Record<string, unknown>) {
  if (files.crew === '') return
  const t: number = await $.clock.now()
  const day = dayOf(t)
  const path = `${files.crew}/log/${day}.jsonl`
  if (diary.day !== day) {
    diary.day = day
    diary.lines = (await $.fs.exists(path)) ? (await $.fs.read(path)).split('\n').filter((l: string) => l !== '') : []
  }
  const clipped = Object.fromEntries(Object.entries(event).map(([k, v]) => [k, typeof v === 'string' ? cut(v, 1_000) : v]))
  diary.lines.push(redact(JSON.stringify({ t, ...clipped })))
  await $.fs.write(path, `${diary.lines.join('\n')}\n`)
}

/**
 * A new session picks up what the last one left in the repo: the threads (so
 * ASK and message numbers go on rather than overwrite) and today's token use.
 */
async function restore($: any) {
  const l = await read($, live)
  if (l.prdPath === null && (await $.fs.exists(`${files.crew}/state.json`))) {
    try {
      const saved = JSON.parse(await $.fs.read(`${files.crew}/state.json`)) as Partial<Pick<CrewLive, 'prdPath' | 'flow' | 'questions' | 'lead'>>
      await update($, live, (x): CrewLive => ({
        ...x,
        prdPath: typeof saved.prdPath === 'string' ? saved.prdPath : null,
        flow: saved.flow ?? x.flow,
        questions: Array.isArray(saved.questions) ? saved.questions : [],
        lead: saved.lead === 'brain' ? 'brain' : 'person',
      }))
    } catch (err) {
      $.ui.log(`crew: .crew/state.json is unreadable, starting clean: ${String(err)}`)
    }
  }
  if (Object.keys(l.threads).length > 0 || Object.keys(l.usage).length > 0) return
  const threads: Record<string, CrewMessage[]> = {}
  const dir = `${files.crew}/threads`
  if (await $.fs.exists(dir)) {
    const entries: { name: string; kind: string }[] = await $.fs.list(dir)
    for (const f of entries.filter(x => x.kind === 'file' && x.name.endsWith('.jsonl'))) {
      const messages = (await $.fs.read(`${dir}/${f.name}`))
        .split('\n')
        .filter((line: string) => line.trim() !== '')
        .flatMap((line: string): CrewMessage[] => {
          try {
            const m = JSON.parse(line) as Partial<CrewMessage>
            return typeof m.item === 'string' && typeof m.text === 'string' && typeof m.from === 'string' && typeof m.t === 'number' ? [m as CrewMessage] : []
          } catch {
            return []
          }
        })
      const first = messages[0]
      if (first !== undefined) threads[first.item] = messages
    }
  }
  const all = Object.values(threads).flat()
  const posted = all.reduce((n, m) => Math.max(n, m.n ?? 0), 0)
  const asked = Object.keys(threads).reduce((n, item) => Math.max(n, Number(/^ASK-(\d+)$/.exec(item)?.[1] ?? 0)), 0)
  const usagePath = `${files.crew}/usage/${dayOf(await $.clock.now())}.json`
  const saved = (await $.fs.exists(usagePath)) ? (JSON.parse(await $.fs.read(usagePath)) as { usage?: CrewLive['usage']; tiers?: CrewLive['tiers'] }) : {}
  await update($, live, s => ({
    ...s,
    threads,
    posted,
    asked,
    // Old messages are history to a role that starts fresh, not unread mail.
    seen: { pm: posted, qa: posted },
    usage: saved.usage ?? {},
    tiers: saved.tiers ?? {},
  }))
}

async function loadMemories($: any): Promise<MemoryEntry[]> {
  if (memo.list !== undefined) return memo.list
  memo.list = files.memories !== '' && (await $.fs.exists(files.memories)) ? parseMemories(await $.fs.read(files.memories)) : []
  return memo.list
}

/**
 * Saves a memory to .crew/memory. A decision crew numbers itself goes on the
 * board's decisions too, so the board and memory share one DEC numbering.
 */
async function remember($: any, input: MemoryInput, knownBy?: CrewRole): Promise<AddResult & { isNew?: boolean }> {
  const before = await loadMemories($)
  const board = await loadBoard($)
  const r = addMemory(before, input, { t: await $.clock.now(), taken: decisionIdsOf(board) })
  if (!r.ok || r.list.length === before.length) return r
  memo.list = r.list
  await $.fs.write(files.memories, serializeMemories(r.list))
  if (r.entry.type === 'DEC' && input.id === undefined && board !== null) {
    const decisions = (board.decisions ?? []).map(d => {
      const old = d as { id?: unknown }
      return old.id === input.supersedes ? { ...(d as object), status: 'superseded', superseded_by: r.entry.id } : d
    })
    decisions.push({ id: r.entry.id, date: dayOf(r.entry.t), status: 'accepted', by: r.entry.source, decision: r.entry.text, refs: r.entry.refs })
    await saveBoard($, { ...board, decisions })
  }
  await note($, { kind: 'memory', id: r.entry.id, type: r.entry.type, source: r.entry.source, text: r.entry.text })
  // The role that said it, or is about to be told it, does not need it attached again.
  if (knownBy !== undefined) await know($, knownBy, r.entry.id)
  return { ...r, isNew: true }
}

async function know($: any, role: CrewRole, id: string) {
  await update($, live, l => ({ ...l, roles: { ...l.roles, [role]: { ...l.roles[role], given: [...new Set([...(l.roles[role].given ?? []), id])] } } }))
}

/** The memories that bear on a text, packed under a token budget. */
async function recall($: any, text: string, options: { role?: string; ids?: string[]; exclude?: string[]; limit?: number; budget?: number }) {
  const hits = searchMemories(await loadMemories($), {
    text,
    ...(options.role === undefined ? {} : { role: options.role }),
    ...(options.ids === undefined ? {} : { ids: options.ids }),
    related: relatedOf(await loadBoard($)),
    exclude: new Set(options.exclude ?? []),
    limit: options.limit ?? 8,
  })
  return packMemories(hits, options.budget ?? 800)
}

/**
 * Starts a fresh agent for a role: the working set, the memories that bear on
 * the work and its recent thread lines go first, the work last. With a reason,
 * it replaces the role's agent (a rotation) and carries its last report.
 */
async function startRole($: any, role: CrewRole, route: Route, task: string, reason?: string) {
  const l = await read($, live)
  const was = l.roles[role]
  const pack = await recall($, `${task}\n${l.prdPath ?? ''}`, { role })
  const prompt = composeStart({
    ...(reason === undefined ? {} : { reason }),
    working: workingSet({ board: await loadBoard($), questions: l.questions }),
    ...(reason !== undefined && was.report !== undefined ? { report: was.report } : {}),
    memories: pack.text,
    lines: threadLines(l.threads, role),
    task,
  })
  // Unnamed on purpose: a named agent in a team-enabled session becomes a teammate, whose
  // finish notices reach the main conversation and whose prompt is the lead's, not the role card.
  const spawned = await $.agent.spawn({
    subagentType: `crew:${role}`,
    description: `crew ${crewName(role)}`,
    prompt,
    model: route.model,
  })
  // The engine answers the new agent's id; when a hook beneath kept it back, find the agent by name.
  let id: string | undefined = spawned.deny === undefined ? spawned.agentId : undefined
  if (spawned.deny === undefined && id === undefined) {
    const agents: { id: string; description?: string; spawnedBy?: string }[] = await $.agent.list()
    id = [...agents].reverse().find(a => a.description === `crew ${crewName(role)}` && a.spawnedBy === 'crew' && l.agents[a.id] === undefined)?.id
  }
  if (id === undefined) {
    const why: string = spawned.deny ?? '找不到它的 agent id'
    $.ui.toast(`crew：${crewName(role)} 沒有啟動（${why}）`)
    $.ui.log(`crew: ${role} did not start: ${why}`)
    await update($, live, s => ({ ...s, roles: { ...s.roles, [role]: { ...s.roles[role], state: 'blocked', doing: `沒有啟動：${why}` } } }))
    return
  }
  const started: string = id
  const rotated = reason !== undefined && was.agentId !== undefined
  await update($, live, s => ({
    ...s,
    seen: { ...s.seen, [role]: s.posted },
    agents: { ...s.agents, [started]: role },
    roles: {
      ...s.roles,
      [role]: {
        agentId: started,
        model: route.model,
        label: route.label,
        effort: route.effort,
        tier: route.tier,
        limit: route.limit,
        state: 'working',
        doing: firstLine(task),
        context: 0,
        task: cut(task, 600),
        ...(was.report === undefined ? {} : { report: was.report }),
        given: pack.ids,
      },
    },
    usage: rotated ? { ...s.usage, [role]: { ...(s.usage[role] ?? ZERO), rotations: (s.usage[role]?.rotations ?? 0) + 1 } } : s.usage,
    injected: pack.ids.length > 0 ? { count: s.injected.count + 1, tokens: s.injected.tokens + pack.tokens } : s.injected,
  }))
  await note($, { kind: rotated ? 'rotate' : 'start', role, agentId: started, ...(reason === undefined ? {} : { reason }), memories: pack.ids, tokens: estimateTokens(prompt) })
}

/**
 * Hands a role work: wakes its agent with the message and the memories it has
 * not been given yet, or starts a fresh one with the pack when a wake costs more
 * (see wakePlan) or the agent cannot be woken.
 */
async function deliver($: any, role: CrewRole, route: Route, text: string, item?: string) {
  const state = (await read($, live)).roles[role]
  const plan = wakePlan(state, route, { forced: state.rotate === true })
  if (plan.kind !== 'wake' || state.agentId === undefined) {
    await startRole($, role, route, text, plan.kind === 'rotate' ? plan.reason : undefined)
    return
  }
  const pack = await recall($, text, { role, ...(item === undefined ? {} : { ids: [item] }), exclude: state.given ?? [], limit: 5 })
  let sent: { isDelivered: boolean; reason?: string } = { isDelivered: false }
  waking.count += 1
  try {
    sent = await $.session.send({ to: { agentId: state.agentId }, text: withMemories(text, pack.text) })
  } finally {
    waking.count -= 1
  }
  if (!sent.isDelivered) {
    // A role that cannot be woken starts again; the pack carries what it needs.
    $.ui.log(`crew: starting ${role} again: ${sent.reason ?? ''}`)
    await startRole($, role, route, text, `原本的對話叫不醒：${sent.reason ?? '沒有原因'}`)
    return
  }
  await update($, live, l => ({
    ...l,
    seen: { ...l.seen, [role]: l.posted },
    roles: {
      ...l.roles,
      [role]: {
        ...l.roles[role],
        effort: route.effort,
        tier: route.tier,
        limit: route.limit,
        state: 'working',
        doing: firstLine(text),
        task: cut(text, 600),
        given: [...(l.roles[role].given ?? []), ...pack.ids],
      },
    },
    injected: pack.ids.length > 0 ? { count: l.injected.count + 1, tokens: l.injected.tokens + pack.tokens } : l.injected,
  }))
  await note($, { kind: 'wake', role, memories: pack.ids })
}

async function execute($: any, actions: readonly FlowAction[]) {
  for (const action of actions) {
    if (action.type === 'spawn') {
      await startRole($, action.role, action.route, action.prompt)
    } else if (action.type === 'message') {
      await post($, { item: action.item ?? 'crew', from: 'crew', to: action.role, text: action.text, kind: 'route' })
      await deliver($, action.role, action.route, action.text, action.item)
    } else if (action.type === 'ask_person') {
      await ask($, 'crew', action.question, action.item)
    } else {
      $.ui.toast(`crew：${action.text}`)
      if ((await read($, live)).lead === 'brain') tellBrain(action.text)
    }
  }
}

async function ask($: any, from: 'pm' | 'qa' | 'crew', question: string, item?: string): Promise<string> {
  const t = await $.clock.now()
  let id = ''
  await update($, live, l => {
    id = `Q-${String(l.questions.length + 1).padStart(2, '0')}`
    return { ...l, questions: [...l.questions, { id, question, ...(item === undefined ? {} : { item }), from, status: 'open' as const, t }] }
  })
  $.ui.toast(`crew：有一件事等你決定（/crew answer ${id} 你的回答）`)
  await note($, { kind: 'ask', id, from, question, ...(item === undefined ? {} : { item }) })
  await saveState($)
  if ((await read($, live)).lead === 'brain') {
    tellBrain(`${from === 'crew' ? 'crew' : crewName(from)} 有一件事要使用者決定（${id}）：${question}\n請問使用者；拿到回答後，用 crew 工具的 answer（question: ${id}）轉回。`)
  }
  return id
}

/** Tidies a day's log into memories with the small model; says what it added. */
async function consolidate($: any, day: string): Promise<string> {
  const path = `${files.crew}/log/${day}.jsonl`
  if (!(await $.fs.exists(path))) return `${day} 沒有流水帳。`
  const log = (await $.fs.read(path)).split('\n').filter((l: string) => l !== '')
  const reply = await $.model.complete({
    model: 'haiku',
    system: CONSOLIDATION_SYSTEM,
    prompt: consolidationPrompt({ day, log, memories: await loadMemories($) }),
    maxTokens: 2_000,
    effort: 'low',
    timeoutMs: 120_000,
  })
  const u = reply.usage === undefined ? undefined : usageOf(reply.usage)
  if (u !== undefined) {
    await update($, live, l => {
      const was = l.usage.memory ?? ZERO
      return { ...l, usage: { ...l.usage, memory: { ...was, input: was.input + u.input, output: was.output + u.output, cacheRead: was.cacheRead + u.cacheRead, cacheWrite: was.cacheWrite + u.cacheWrite } } }
    })
  }
  if (!reply.isAnswered) return `整理 ${day} 沒有完成：${String(reply.reason)}`
  const added: string[] = []
  for (const p of parseProposals(reply.text)) {
    // The tidy-up may replace only the facts and lessons it could have written itself.
    const replaced = p.supersedes === undefined ? undefined : (await loadMemories($)).find(m => m.id === p.supersedes)
    const { supersedes: _, ...rest } = p
    const proposal = replaced !== undefined && (replaced.type === 'MEM' || replaced.type === 'LES') ? p : rest
    const r = await remember($, { ...proposal, source: `整理 ${day}` })
    if (r.ok && r.isNew === true) added.push(r.entry.id)
  }
  const done = `${files.crew}/memory/consolidated.json`
  const days: string[] = (await $.fs.exists(done)) ? (JSON.parse(await $.fs.read(done)) as { days?: string[] }).days ?? [] : []
  await $.fs.write(done, `${JSON.stringify({ days: [...new Set([...days, day])].sort().slice(-60) }, null, 2)}\n`)
  return added.length > 0 ? `整理 ${day}：新增 ${added.join('、')}。` : `整理 ${day}：沒有要補的記憶。`
}

/** Once a day, tidies the latest earlier day whose log has not been tidied. */
async function consolidateDue($: any) {
  const today = dayOf(await $.clock.now())
  if (tidy.checked === today || files.crew === '') return
  tidy.checked = today
  const dir = `${files.crew}/log`
  if (!(await $.fs.exists(dir))) return
  const done = `${files.crew}/memory/consolidated.json`
  const days: string[] = (await $.fs.exists(done)) ? (JSON.parse(await $.fs.read(done)) as { days?: string[] }).days ?? [] : []
  const logs: { name: string }[] = await $.fs.list(dir)
  const due = logs
    .map(e => e.name.replace(/\.jsonl$/, ''))
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d < today && !days.includes(d))
    .sort()
    .at(-1)
  if (due !== undefined) $.ui.log(`crew: ${await consolidate($, due)}`)
}

async function feed($: any, event: FlowEvent) {
  const before = (await read($, live)).flow
  const r = step(before, event)
  await update($, live, l => ({ ...l, flow: r.state }))
  await saveState($)
  await execute($, r.actions)
}

/** What a restart needs to pick the PRD up again, in .crew/state.json. */
async function saveState($: any) {
  if (files.crew === '') return
  const l = await read($, live)
  await $.fs.write(`${files.crew}/state.json`, `${JSON.stringify({ prdPath: l.prdPath, flow: l.flow, questions: l.questions, lead: l.lead }, null, 2)}\n`)
}

/** How the brain should take a note: pass it on briefly, and put decisions where the roles will see them. */
const BRAIN_NOTE =
  '（crew 的通知：用一兩句話轉告使用者就好，不用另外查證；要細節時再用 board_read、thread_read。你或使用者做了決定，用 crew 工具的 answer 或 remember 記進團隊記憶，角色才會知道。）'

/**
 * Notes for the main conversation about work it started. They ride on the
 * engine's notice that a role's run ended, which crew would otherwise drop;
 * with no notice they go out as crew's own prompt after `BRAIN_TICKS` ticks.
 *
 * Measured: when the engine runs queued prompts together and the first one is
 * dropped, the ones after it are shown but never answered. So crew never puts
 * a prompt of its own behind a role's notice it is about to drop.
 */
const brain = { queue: [] as string[], ticks: 0 }

/** Ticks of `BRAIN_TICK_MS` a note waits for a role's notice before crew sends it itself. */
const BRAIN_TICK_MS = 15_000
const BRAIN_TICKS = 4

function tellBrain(text: string) {
  brain.queue.push(text)
}

/** The queued notes as one message, emptying the queue; undefined with nothing queued. */
function takeBrainNotes(): string | undefined {
  if (brain.queue.length === 0) return undefined
  brain.ticks = 0
  return `[crew] ${brain.queue.splice(0).join('\n\n')}\n\n${BRAIN_NOTE}`
}

/**
 * Sends the queued notes as crew's own prompt, which runs once the conversation
 * is idle. Never from a tool call: the prompt would wait on the turn the call holds.
 */
function flushBrain($: any) {
  const text = takeBrainNotes()
  if (text === undefined) return
  void Promise.resolve($.prompt.submit({ text })).catch((err: unknown) => $.ui.log(`crew: could not tell the brain: ${String(err)}`))
}

/**
 * Picks up a PRD the last session left under way: its roles went with that
 * session, so the flow starts them again from what the board shows.
 */
async function resumeOnStart($: any) {
  const l = await read($, live)
  const open = l.questions.filter(q => q.status === 'open').length
  const running = ['splitting', 'writing_tests', 'confirming', 'adding_tests'].includes(l.flow.stage)
  if (running && l.prdPath !== null && Object.keys(l.agents).length === 0) {
    const full = l.prdPath.startsWith('/') ? l.prdPath : `${files.root}/${l.prdPath}`
    const board = await loadBoard($, true)
    if (board !== null && (await $.fs.exists(full))) {
      const text: string = await $.fs.read(full)
      $.ui.toast(`crew：接續 ${l.prdPath}（${l.flow.stage}）`)
      await note($, { kind: 'resume', path: l.prdPath, stage: l.flow.stage })
      await feed($, { type: 'resume', board, prd: { path: l.prdPath, size: text.length, text: text.slice(0, 4_000) } })
    }
  }
  if (open > 0) $.ui.toast(`crew：有 ${open} 件事等你決定（/crew status）`)
  flushBrain($)
}

async function saveUsage($: any) {
  const l = await read($, live)
  const day = dayOf(await $.clock.now())
  await $.fs.write(`${files.crew}/usage/${day}.json`, `${JSON.stringify({ usage: l.usage, tiers: l.tiers }, null, 2)}\n`)
}

/** Items whose threads hold a message to each role written after that role was last woken. */
const inboxOf = (l: CrewLive): { pm: string[]; qa: string[] } => {
  const unread = (role: 'pm' | 'qa') =>
    Object.entries(l.threads)
      .filter(([, messages]) => messages.some(m => m.to === role && m.from !== 'crew' && (m.n ?? 0) > (l.seen[role] ?? 0)))
      .map(([item]) => item)
  return { pm: unread('pm'), qa: unread('qa') }
}

/**
 * One crew command, from /crew or from the brain's crew tool: what it did, in
 * a sentence. Work the brain starts reports back to it.
 */
async function crewVerb($: any, verb: string, rest: string[], by: 'person' | 'brain'): Promise<string> {
  if (verb === 'demo') {
    if (rest[0] === 'off') {
      await update($, isDemo, () => false)
      await $.ui.close({ id: PANE })
      return '已關閉 crew 設計稿。'
    }
    await update($, isDemo, () => true)
    await update($, tab, () => 'overview')
    await update($, scenario, () => 'normal')
    await update($, thread, () => null)
    await update($, gate, () => null)
    await $.ui.open({ id: PANE, title: 'Crew（設計稿）' })
    return '已開啟 crew 設計稿：面板和輸入框上方那一行都是示意資料。/crew demo off 關閉。'
  }
  if (verb === 'start') {
    const path = rest.join(' ')
    if (path === '') return '用法：/crew start <PRD 檔案路徑>'
    const full = path.startsWith('/') ? path : `${files.root}/${path}`
    if (!(await $.fs.exists(full))) return `找不到 ${path}。`
    const text: string = await $.fs.read(full)
    const board = (await loadBoard($, true)) ?? newTracker(files.root.split('/').pop() ?? 'project')
    await saveBoard($, board)
    await $.fs.write(`${files.crew}/.gitignore`, 'usage/\nlog/\n')
    const stage = (await read($, live)).flow.stage
    if (stage !== 'idle' && stage !== 'done' && stage !== 'escalated') {
      return `crew 正在進行（${stage}），等這一輪完成再開始新的；卡住的話先用 /crew reset。`
    }
    await update($, isDemo, () => false)
    await update($, live, l => ({ ...l, prdPath: path, lead: by }))
    await note($, { kind: 'prd', path, size: text.length, by })
    await feed($, { type: 'start', prd: { path, size: text.length, text: text.slice(0, 4_000) } })
    await $.ui.open({ id: PANE, title: 'Crew' })
    const pm = (await read($, live)).roles.pm
    if (pm.state === 'blocked') return `crew 沒有開始：${pm.doing}`
    return `crew 開始：PM 正在拆 ${path}（${pm.tier ?? ''} ${pm.label ?? ''}・${pm.effort ?? ''}）。進度在 /crew 面板。`
  }
  if (verb === 'reset') {
    await update($, live, () => emptyLive())
    await saveState($)
    return '已清掉這個 session 的 crew 狀態。看板（prd-tracker.json）、討論串和記憶（.crew/memory）都保留。'
  }
  if (verb === 'answer') {
    const [id = '', ...words] = rest
    const answer = words.join(' ')
    const q = (await read($, live)).questions.find(x => x.id === id && x.status === 'open')
    if (q === undefined || answer === '') return '用法：/crew answer <Q-編號> <回答>，編號要是還沒回答的問題。'
    await update($, live, l => ({ ...l, questions: l.questions.map(x => (x.id === id ? { ...x, status: 'answered' as const, answer } : x)) }))
    if (q.item !== undefined) await post($, { item: q.item, from: 'person', to: q.from === 'qa' ? 'qa' : 'pm', text: `${q.question} → ${answer}` })
    await remember($, { type: 'DEC', text: `使用者決定：${answer}（問題：${q.question}）`, refs: q.item === undefined ? [] : [q.item], source: `person ${q.id}` }, q.from === 'qa' ? 'qa' : 'pm')
    await feed($, { type: 'answered', question: q.question, answer, role: q.from === 'qa' ? 'qa' : 'pm' })
    return `已把 ${id} 的回答轉給 ${q.from === 'qa' ? 'QA' : 'PM'}。`
  }
  if (verb === 'ask') {
    const [role = '', ...words] = rest
    const question = words.join(' ')
    if ((role !== 'pm' && role !== 'qa') || question === '') return '用法：/crew ask <pm|qa> <你的問題>'
    const l = await read($, live)
    const name = crewName(role)
    if (l.roles[role].state === 'working') return `${name} 正在工作，等它這一輪做完再問。`
    const id = `ASK-${String(l.asked + 1).padStart(2, '0')}`
    await update($, live, s => ({ ...s, asked: s.asked + 1, asks: { ...s.asks, [role]: { id, by } } }))
    await post($, { item: id, from: 'person', to: role, text: question })
    const text = `使用者問你（${id}）：${question}\n直接回答，幾句話就好；需要時先用 board_read、thread_read、memory_search 查。使用者沒有要你改看板就不要改。`
    await deliver($, role, routeFor(role, l.roles[role].tier ?? 'S'), text, id)
    const after = (await read($, live)).roles[role]
    if (after.state === 'blocked') {
      await update($, live, s => ({ ...s, asks: Object.fromEntries(Object.entries(s.asks).filter(([r]) => r !== role)) }))
      return `沒有問到 ${name}：${after.doing}`
    }
    return by === 'brain' ? `已問 ${name}（${id}）。${name} 回覆後會再通知你。` : `已問 ${name}（${id}）。回覆後會通知你，用 /crew thread ${id} 看。`
  }
  if (verb === 'rotate') {
    const role = rest[0] ?? ''
    if (role !== 'pm' && role !== 'qa') return '用法：/crew rotate <pm|qa>'
    const r = (await read($, live)).roles[role]
    const name = crewName(role)
    if (r.agentId === undefined) return `${name} 還沒開始，下次叫它時就是新的 context。`
    await update($, live, s => ({ ...s, roles: { ...s.roles, [role]: { ...s.roles[role], rotate: true } } }))
    return `下次叫醒 ${name} 時會換新的 context，帶看板狀況、相關記憶和上一輪的回報重開（目前 context ${Math.round(r.context / 1000)}K）。可以用 /crew ask ${role} <問題> 馬上試。`
  }
  if (verb === 'thread') {
    const item = rest[0] ?? ''
    const messages = (await read($, live)).threads[item] ?? []
    if (item === '' || messages.length === 0) return `${item || '這個項目'} 還沒有討論。`
    return messages.map(m => `${who(m.from)}${m.to === undefined ? '' : ` → ${who(m.to)}`}：${m.text}`).join('\n')
  }
  if (verb === 'recall') {
    const query = rest.join(' ')
    if (query === '') return '用法：/crew recall <關鍵字或編號>'
    const hits = searchMemories(await loadMemories($), { text: query, related: relatedOf(await loadBoard($)), limit: 10 }).filter(h => h.why !== 'pref')
    return hits.length === 0 ? '沒有找到相關記憶。' : packMemories(hits, 4_000).text
  }
  if (verb === 'remember') {
    const text = rest.join(' ')
    if (text === '') return '用法：/crew remember <要記住的偏好>'
    const r = await remember($, { type: 'PREF', text, source: 'person' })
    return r.ok ? `已記住 ${r.entry.id}：${r.entry.text}${r.note === undefined ? '' : `（${r.note}）`}` : r.error
  }
  if (verb === 'consolidate') {
    return await consolidate($, rest[0] ?? dayOf(await $.clock.now()))
  }
  if (verb === 'status') {
    const board = await loadBoard($)
    const l = await read($, live)
    const s = snapshotOf({ board, live: l, now: await $.clock.now(), memories: await loadMemories($) })
    return bandText(s, `crew（${l.flow.stage}）`)
  }
  await $.ui.open({ id: PANE, title: 'Crew' })
  return 'crew 面板已開啟。/crew start <PRD 檔案> 開始一份 PRD。'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Set before the first await, so no command slips in ahead of the gate.
    let booted = () => {}
    boot.ready = new Promise<void>(resolve => {
      booted = resolve
    })
    files.root = e.cwd
    files.board = `${e.cwd}/prd-tracker.json`
    files.schema = `${e.cwd}/schemas/prd-tracker.schema.json`
    files.crew = `${e.cwd}/.crew`
    files.memories = `${e.cwd}/.crew/memory/memories.jsonl`
    cache.board = undefined
    memo.list = undefined
    diary.day = ''
    tidy.checked = ''
    // State kept from before a reload may predate fields added since: fill them in.
    try {
      await update($, live, l => ({ ...emptyLive(), ...l }))
      await restore($)
      // The roles first: each tool takes a moment to become visible, and a command can run meanwhile.
      for (const role of CREW_ROLES) {
        await $.agent.register(AGENT_SPECS[role])
      }
      await $.command.register({
        name: 'crew',
        description: 'crew 產品團隊：/crew start <PRD>、answer <Q-編號> <回答>、ask <pm|qa> <問題>、recall <關鍵字>、remember <偏好>、status',
      })
      for (const spec of TOOL_SPECS) {
        await $.tool.register({ ...spec, isDeferred: false })
      }
    } finally {
      booted()
    }
    await resumeOnStart($)
    // Notes no role notice came for go out on their own after a minute.
    brain.ticks = 0
    $.clock.every(BRAIN_TICK_MS, () => {
      if (brain.queue.length === 0) return
      brain.ticks += 1
      if (brain.ticks >= BRAIN_TICKS) flushBrain($)
    })
    return next(e)
  })

  // The roles are crew's to start, not the main conversation's. While crew wakes a finished role
  // the engine asks again whether its type is offered, so the roles are offered for that moment.
  on('agent.offer', { agent: 'crew:pm' }, ($, e, next) => (waking.count > 0 ? next(e) : { isOffered: false }))
  on('agent.offer', { agent: 'crew:qa' }, ($, e, next) => (waking.count > 0 ? next(e) : { isOffered: false }))

  on('command.run', { command: 'crew' }, async ($, e) => {
    // A command typed while the session is still starting waits for crew's roles and tools.
    await boot.ready
    const [verb = '', ...rest] = e.args.trim().split(/\s+/).filter(Boolean)
    return { text: await crewVerb($, verb, rest, 'person') }
  })

  on('tool.call', { tool: 'mcp__crew__board_read' }, async ($, e: any) => {
    const board = await loadBoard($)
    if (board === null) return { result: '還沒有看板。' }
    const open = (await read($, live)).questions.filter(q => q.status === 'open')
    const waiting = open.length === 0 ? '' : `\n\n等使用者回答的問題（不要重複問）：\n${open.map(q => `- ${q.id} ${q.question}`).join('\n')}`
    return { result: `${renderBoard(board, typeof e.feature === 'string' ? { feature: e.feature } : {})}${waiting}` }
  })

  on('tool.call', { tool: 'mcp__crew__board_write' }, async ($, e: any) => {
    const role = (await read($, live)).agents[e.agentId ?? ''] ?? 'brain'
    const parsed = parseOps(e.ops)
    if (!parsed.ok) return { result: `board_write 沒有生效：\n${parsed.error}` }
    const board = (await loadBoard($)) ?? newTracker(files.root.split('/').pop() ?? 'project')
    const now = await $.clock.now()
    const taken = (await loadMemories($)).map(m => m.id)
    const r = applyOps(board, parsed.ops, { by: role, today: dayOf(now), prefixes: await idPrefixes($), taken })
    if (!r.ok) return { result: `board_write 沒有生效，看板沒有任何變更：\n- ${r.errors.join('\n- ')}` }
    await saveBoard($, r.tracker)
    // The board's decisions are memories too, under the same ids.
    const had = new Set(decisionIdsOf(board))
    for (const d of (r.tracker.decisions ?? []) as { id?: unknown; decision?: unknown; criteria?: unknown; feature?: unknown }[]) {
      if (typeof d.id !== 'string' || had.has(d.id) || typeof d.decision !== 'string') continue
      const refs = [d.criteria, d.feature].filter((x): x is string => typeof x === 'string')
      await remember($, { id: d.id, type: 'DEC', text: d.decision, refs, source: role }, role === 'pm' || role === 'qa' ? role : undefined)
    }
    // Done means progress moved: a feature got its first criterion, a criterion its first test case.
    const covered = (t: Tracker) => {
      const g1 = gateG1(t)
      const g4 = gateG4(t)
      const open = new Set([...g1.gaps.map(g => g.id), ...g4.gaps.map(g => g.id)])
      const ids = [...t.prd_items.filter(i => i.crew_dropped === undefined).map(i => i.id), ...t.prd_items.flatMap(criteriaOf).map(c => c.id)]
      return new Set(ids.filter(id => !open.has(id)))
    }
    const before = covered(board)
    const titles = new Map<string, string>()
    for (const item of r.tracker.prd_items) {
      titles.set(item.id, item.title)
      for (const c of criteriaOf(item)) titles.set(c.id, c.text)
    }
    const moved = [...covered(r.tracker)].filter(id => !before.has(id))
    await update($, live, l => ({
      ...l,
      activity: [...l.activity, ...moved.map(id => ({ t: now, day: dayOf(now), role, id, title: titles.get(id) ?? id }))].slice(-200),
    }))
    const written = r.results.map(x => x.id).filter((x): x is string => x !== undefined)
    await note($, { kind: 'board', role, ops: parsed.ops.map(o => o.op), ids: written })
    return { result: `已寫入：${written.join('、')}。` }
  })

  on('tool.call', { tool: 'mcp__crew__thread_post' }, async ($, e: any) => {
    const role = (await read($, live)).agents[e.agentId ?? ''] ?? 'brain'
    if (typeof e.item !== 'string' || typeof e.text !== 'string' || (e.to !== 'pm' && e.to !== 'qa')) {
      return { result: 'thread_post 需要 item、to（pm 或 qa）和 text。' }
    }
    await post($, { item: e.item, from: role, to: e.to, text: e.text })
    return { result: `已寫在 ${e.item} 的討論串，${crewName(e.to)} 下次被叫醒時會看到。` }
  })

  on('tool.call', { tool: 'mcp__crew__thread_read' }, async ($, e: any) => {
    const messages = (await read($, live)).threads[String(e.item)] ?? []
    if (messages.length === 0) return { result: '這個項目還沒有討論。' }
    return { result: messages.map(m => `${m.from}${m.to === undefined ? '' : ` → ${m.to}`}：${m.text}`).join('\n') }
  })

  on('tool.call', { tool: 'mcp__crew__ask_person' }, async ($, e: any) => {
    const role = (await read($, live)).agents[e.agentId ?? '']
    if (typeof e.question !== 'string' || e.question.trim() === '') return { result: 'ask_person 需要 question。' }
    const id = await ask($, role ?? 'crew', e.question, typeof e.item === 'string' ? e.item : undefined)
    return { result: `已交給使用者（${id}）。先處理其他部分，答案會轉給你。` }
  })

  // The brain's way to run the team in plain language: the /crew commands, as a tool.
  on('tool.call', { tool: 'mcp__crew__crew' }, async ($, e: any) => {
    if (e.agentId !== undefined) return { result: 'crew 工具只給主對話用。' }
    const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
    const words = (v: unknown): string[] => (str(v) === '' ? [] : [str(v)])
    const args: Record<string, string[]> = {
      start: words(e.path),
      ask: [...words(e.role), ...words(e.text)],
      answer: [...words(e.question), ...words(e.text)],
      status: [],
      remember: words(e.text),
      recall: words(e.text),
      rotate: words(e.role),
    }
    const verb = str(e.action)
    const rest = args[verb]
    if (rest === undefined) return { result: 'action 要是 start、ask、answer、status、remember、recall 或 rotate。' }
    await boot.ready
    return { result: await crewVerb($, verb, rest, 'brain') }
  })

  on('tool.call', { tool: 'mcp__crew__memory_save' }, async ($, e: any) => {
    const role = (await read($, live)).agents[e.agentId ?? '']
    const type = e.type as MemoryType
    const allowed: readonly string[] = role === undefined ? MEMORY_TYPES : ['DEC', 'MEM', 'LES']
    if (!allowed.includes(type)) return { result: 'memory_save 的 type 要是 DEC、MEM 或 LES（偏好由使用者自己說）。' }
    if (typeof e.text !== 'string') return { result: 'memory_save 需要 text。' }
    const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
    const replaced = typeof e.supersedes === 'string' ? (await loadMemories($)).find(m => m.id === e.supersedes) : undefined
    if (role !== undefined && replaced !== undefined && replaced.source.startsWith('person')) {
      return { result: `${replaced.id} 是使用者說的，只有使用者能改。需要改的話用 ask_person 問。` }
    }
    const r = await remember($, {
      type,
      text: e.text,
      refs: strings(e.refs),
      roles: strings(e.roles),
      source: role ?? 'brain',
      ...(typeof e.supersedes === 'string' && e.supersedes !== '' ? { supersedes: e.supersedes } : {}),
    })
    if (!r.ok) return { result: `沒有存：${r.error}` }
    // What a role saved itself it already knows: a wake does not hand it back.
    if (role !== undefined) await know($, role, r.entry.id)
    return { result: `已存成 ${r.entry.id}。${r.note ?? ''}` }
  })

  on('tool.call', { tool: 'mcp__crew__memory_search' }, async ($, e: any) => {
    const role = (await read($, live)).agents[e.agentId ?? '']
    if (typeof e.query !== 'string' || e.query.trim() === '') return { result: 'memory_search 需要 query。' }
    const pack = await recall($, e.query, { ...(role === undefined ? {} : { role }), limit: 8, budget: 1_500 })
    const found = pack.text.split('\n').filter(line => line !== '' && !line.includes('（偏好・'))
    await note($, { kind: 'search', role: role ?? 'brain', query: e.query, ids: pack.ids })
    return { result: found.length === 0 ? '沒有找到相關記憶。' : pack.text }
  })

  // A role finishing or reporting is crew's to handle, not a reason to wake the main conversation.
  // In a session with agent teams on, the roles run as teammates (crew-pm, crew-qa) and report through the team mailbox.
  on('session.receive', async ($, e, next) => {
    const origin = e.origin as { kind: string; teammate?: string }
    if (e.agentId === undefined && origin.teammate !== undefined && CREW_TEAMMATE.test(origin.teammate)) {
      return { consumed: `crew 自己處理 ${origin.teammate} 的回報` }
    }
    if (e.agentId === undefined && origin.kind === 'task-notification') {
      const ids = Object.keys((await read($, live)).agents)
      if (ids.some(id => e.text.includes(id))) return { consumed: 'crew 自己處理角色的完成通知' }
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const kind = e.origin.kind
    if (kind === 'task-notification' || kind === 'peer' || kind === 'peer-send-message' || kind === 'coordinator') {
      const ids = Object.keys((await read($, live)).agents)
      if (ids.some(id => e.text.includes(id)) || CREW_MENTION.test(e.text)) {
        // A role's notice the brain has news waiting for carries that news instead.
        const notes = takeBrainNotes()
        return notes === undefined ? { drop: 'crew 自己處理角色的回報' } : next({ ...e, text: notes })
      }
    }
    return next(e)
  })

  // A role compacted by the engine (one long run past its window) keeps what crew cannot re-read for it.
  on('session.compact', async ($, e, next) => {
    const role = e.agentId === undefined ? undefined : (await read($, live)).agents[e.agentId]
    if (role === undefined) return next(e)
    await note($, { kind: 'compact', role, trigger: e.trigger })
    return next({ ...e, instructions: e.instructions === undefined ? COMPACT_NOTE : `${e.instructions}\n${COMPACT_NOTE}` })
  })

  on('turn.start', async ($, e, next) => {
    const role = e.agentId === undefined ? undefined : (await read($, live)).agents[e.agentId]
    if (role !== undefined) {
      await update($, live, l => (l.roles[role].agentId !== e.agentId ? l : { ...l, roles: { ...l.roles, [role]: { ...l.roles[role], state: 'working' } } }))
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const l = await read($, live)
    const role = e.agentId === undefined ? undefined : l.agents[e.agentId]
    const effort = role === undefined ? undefined : l.roles[role].effort
    const input = effort !== undefined && effort !== e.effort ? { ...e, effort: effort as typeof e.effort } : e
    const stream = next(input)
    for await (const chunk of stream) {
      if (chunk.kind === 'stop' && chunk.usage !== null && (role !== undefined || e.agentId === undefined)) {
        const u = usageOf(chunk.usage)
        const key = role ?? 'brain'
        await update($, live, s => {
          const was = s.usage[key] ?? ZERO
          const spent = u.input + u.output + u.cacheRead + u.cacheWrite
          const tier = role === undefined ? undefined : s.roles[role].tier
          return {
            ...s,
            usage: { ...s.usage, [key]: { ...was, input: was.input + u.input, output: was.output + u.output, cacheRead: was.cacheRead + u.cacheRead, cacheWrite: was.cacheWrite + u.cacheWrite } },
            tiers: tier === undefined ? s.tiers : { ...s.tiers, [tier]: (s.tiers[tier] ?? 0) + spent },
            // Only the role's current agent says how full its context is; one it replaced may still finish a run.
            roles: role === undefined || s.roles[role].agentId !== e.agentId ? s.roles : { ...s.roles, [role]: { ...s.roles[role], context: u.input + u.cacheRead + u.cacheWrite } },
          }
        })
      }
      yield chunk
    }
    return await stream.result
  })

  on('turn.complete', async ($, e, next) => {
    const before = await read($, live)
    const role = e.agentId === undefined ? undefined : before.agents[e.agentId]
    if (role === undefined) return next(e)
    // An agent crew has since replaced finishing late changes nothing about the role.
    if (before.roles[role].agentId !== e.agentId) return next(e)
    const asking = before.asks[role]
    // A role's own turn start is not always raised to this plugin, so a finished run is what counts as a wake.
    const l = await update($, live, s => ({
      ...s,
      roles: { ...s.roles, [role]: { ...s.roles[role], state: 'idle', doing: '—', report: cut(e.answer, 600) } },
      usage: { ...s.usage, [role]: { ...(s.usage[role] ?? ZERO), wakes: (s.usage[role]?.wakes ?? 0) + 1 } },
      asks: Object.fromEntries(Object.entries(s.asks).filter(([r]) => r !== role)),
    }))
    const done = await next(e)
    await note($, { kind: 'report', role, text: e.answer })
    if (asking !== undefined) {
      const reply = e.answer.trim() === '' ? '（沒有回覆內容）' : e.answer
      await post($, { item: asking.id, from: role, to: 'person', text: reply })
      $.ui.toast(`crew：${crewName(role)} 回覆了 ${asking.id}（/crew thread ${asking.id}）`)
      if (asking.by === 'brain') tellBrain(`${crewName(role)} 回覆了 ${asking.id}：${reply}`)
    }
    await saveUsage($)
    const board = await loadBoard($, true)
    if (board !== null) await feed($, { type: 'role_done', role, board, inbox: inboxOf(l) })
    await consolidateDue($)
    // Notes for the brain wait for the engine's notice of this run, which follows.
    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const el = $.ui.resolve(e)
    const demo = await read($, isDemo)
    const l = await read($, live)
    const board = demo ? null : await loadBoard($)
    if (!demo && board === null && l.prdPath === null) {
      return <el.Text dimColor>用 /crew start &lt;PRD 檔案&gt; 開始一份 PRD，或用 /crew demo 看設計稿。</el.Text>
    }
    const act: Actions = {
      tab: id => void update($, tab, () => id),
      scenario: id => void update($, scenario, () => id),
      thread: id => void update($, thread, () => id),
      gate: id => void update($, gate, () => id),
      openThread: id => {
        void update($, thread, () => id)
        void update($, tab, () => 'threads')
      },
      reply: id => $.ui.toast(`用 /crew answer ${id} <你的回答> 回覆`),
    }
    const view = { tab: await read($, tab), scenario: await read($, scenario), thread: await read($, thread), gate: await read($, gate) }
    const snap = demo ? DEMO[view.scenario] : snapshotOf({ board, live: l, now: await $.clock.now(), memories: await loadMemories($) })
    return CrewPane({ el, snap, view, act, isDemo: demo })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Text } = $.ui.resolve(e)
    if (await read($, isDemo)) {
      return (
        <Text dimColor wrap="truncate-end">
          {bandText(DEMO[await read($, scenario)])}
        </Text>
      )
    }
    const l = await read($, live)
    if (l.prdPath === null) return next(e)
    const snap = snapshotOf({ board: await loadBoard($), live: l, now: await $.clock.now() })
    return (
      <Text dimColor wrap="truncate-end">
        {bandText(snap, 'crew')}
      </Text>
    )
  })
}
