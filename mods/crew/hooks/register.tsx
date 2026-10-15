import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { CrewLive, CrewMessage, CrewScenario, CrewTab } from '../types'
import { applyOps, criteriaOf, gateG1, gateG4, newTracker, parseOps, prefixesFrom, renderBoard } from './board'
import type { Tracker } from './board'
import { DEMO } from './demo'
import { step } from './flow'
import type { FlowAction, FlowEvent } from './flow'
import { dayOf, emptyLive, snapshotOf } from './live'
import { ROLE_NAMES } from './model'
import { AGENT_SPECS, CREW_ROLES, TOOL_SPECS } from './roles'
import type { CrewRole } from './roles'
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
const files = { root: '', board: '', schema: '', crew: '' }

/** How many role wakes are under way: the roles are offered to the engine only then. */
const waking = { count: 0 }

/** The board as last read or written; reloaded from disk when a role finishes. */
const cache: { board: Tracker | null | undefined } = { board: undefined }

const crewName = (role: CrewRole): string => ROLE_NAMES[role]

const safe = (item: string): string => item.replace(/[^\w.-]+/g, '_')

const firstLine = (text: string): string => (text.split('\n')[0] ?? '').slice(0, 60)

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
}

async function startRole($: any, role: CrewRole, route: Route, prompt: string) {
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
    id = [...agents].reverse().find(a => a.description === `crew ${crewName(role)}` && a.spawnedBy === 'crew')?.id
  }
  if (id === undefined) {
    const reason: string = spawned.deny ?? '找不到它的 agent id'
    $.ui.toast(`crew：${crewName(role)} 沒有啟動（${reason}）`)
    $.ui.log(`crew: ${role} did not start: ${reason}`)
    await update($, live, l => ({ ...l, roles: { ...l.roles, [role]: { ...l.roles[role], state: 'blocked', doing: `沒有啟動：${reason}` } } }))
    return
  }
  const started: string = id
  await update($, live, l => ({
    ...l,
    seen: { ...l.seen, [role]: l.posted },
    agents: { ...l.agents, [started]: role },
    roles: {
      ...l.roles,
      [role]: { agentId: started, model: route.model, label: route.label, effort: route.effort, tier: route.tier, limit: route.limit, state: 'working', doing: firstLine(prompt), context: 0 },
    },
  }))
}

async function execute($: any, actions: readonly FlowAction[]) {
  for (const action of actions) {
    if (action.type === 'spawn') {
      await startRole($, action.role, action.route, action.prompt)
    } else if (action.type === 'message') {
      await post($, { item: action.item ?? 'crew', from: 'crew', to: action.role, text: action.text, kind: 'route' })
      const role = (await read($, live)).roles[action.role]
      let sent: { isDelivered: boolean; reason?: string } = { isDelivered: false, reason: '換模型要用新的 context' }
      if (role.agentId !== undefined && role.model === action.route.model) {
        waking.count += 1
        try {
          sent = await $.session.send({ to: { agentId: role.agentId }, text: action.text })
        } finally {
          waking.count -= 1
        }
      }
      if (sent.isDelivered) {
        await update($, live, l => ({
          ...l,
          seen: { ...l.seen, [action.role]: l.posted },
          roles: {
            ...l.roles,
            [action.role]: { ...l.roles[action.role], effort: action.route.effort, tier: action.route.tier, limit: action.route.limit, state: 'working', doing: firstLine(action.text) },
          },
        }))
      } else {
        // A new model, or a role that cannot be woken: start it again; it reads the board and its threads.
        $.ui.log(`crew: starting ${action.role} again: ${sent.reason ?? ''}`)
        await startRole($, action.role, action.route, `${action.text}\n\n（先用 board_read、thread_read 了解目前狀況。）`)
      }
    } else if (action.type === 'ask_person') {
      await ask($, 'crew', action.question, action.item)
    } else {
      $.ui.toast(`crew：${action.text}`)
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
  return id
}

async function feed($: any, event: FlowEvent) {
  const before = (await read($, live)).flow
  const r = step(before, event)
  await update($, live, l => ({ ...l, flow: r.state }))
  await execute($, r.actions)
}

async function saveUsage($: any) {
  const l = await read($, live)
  const day = dayOf(await $.clock.now())
  await $.fs.write(`${files.crew}/usage/${day}.json`, `${JSON.stringify({ usage: l.usage, tiers: l.tiers }, null, 2)}\n`)
}

const usageOf = (u: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }) => ({
  input: u.input_tokens ?? 0,
  output: u.output_tokens ?? 0,
  cacheRead: u.cache_read_input_tokens ?? 0,
  cacheWrite: u.cache_creation_input_tokens ?? 0,
})

const ZERO = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, wakes: 0, rotations: 0 }

/** Items whose threads hold a message to each role written after that role was last woken. */
const inboxOf = (l: CrewLive): { pm: string[]; qa: string[] } => {
  const unread = (role: 'pm' | 'qa') =>
    Object.entries(l.threads)
      .filter(([, messages]) => messages.some(m => m.to === role && m.from !== 'crew' && (m.n ?? 0) > (l.seen[role] ?? 0)))
      .map(([item]) => item)
  return { pm: unread('pm'), qa: unread('qa') }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    files.root = e.cwd
    files.board = `${e.cwd}/prd-tracker.json`
    files.schema = `${e.cwd}/schemas/prd-tracker.schema.json`
    files.crew = `${e.cwd}/.crew`
    cache.board = undefined
    // State kept from before a reload may predate fields added since: fill them in.
    await update($, live, l => ({ ...emptyLive(), ...l }))
    await $.command.register({
      name: 'crew',
      description: 'crew 產品團隊：/crew start <PRD 檔案> 開始、/crew answer <Q-編號> <回答>、/crew status、/crew demo',
    })
    for (const spec of TOOL_SPECS) {
      await $.tool.register({ ...spec, isDeferred: false })
    }
    for (const role of CREW_ROLES) {
      await $.agent.register(AGENT_SPECS[role])
    }
    return next(e)
  })

  // The roles are crew's to start, not the main conversation's. While crew wakes a finished role
  // the engine asks again whether its type is offered, so the roles are offered for that moment.
  on('agent.offer', { agent: 'crew:pm' }, ($, e, next) => (waking.count > 0 ? next(e) : { isOffered: false }))
  on('agent.offer', { agent: 'crew:qa' }, ($, e, next) => (waking.count > 0 ? next(e) : { isOffered: false }))

  on('command.run', { command: 'crew' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/).filter(Boolean)
    if (verb === 'demo') {
      if (rest[0] === 'off') {
        await update($, isDemo, () => false)
        await $.ui.close({ id: PANE })
        return { text: '已關閉 crew 設計稿。' }
      }
      await update($, isDemo, () => true)
      await update($, tab, () => 'overview')
      await update($, scenario, () => 'normal')
      await update($, thread, () => null)
      await update($, gate, () => null)
      await $.ui.open({ id: PANE, title: 'Crew（設計稿）' })
      return { text: '已開啟 crew 設計稿：面板和輸入框上方那一行都是示意資料。/crew demo off 關閉。' }
    }
    if (verb === 'start') {
      const path = rest.join(' ')
      if (path === '') return { text: '用法：/crew start <PRD 檔案路徑>' }
      const full = path.startsWith('/') ? path : `${files.root}/${path}`
      if (!(await $.fs.exists(full))) return { text: `找不到 ${path}。` }
      const text: string = await $.fs.read(full)
      const board = (await loadBoard($, true)) ?? newTracker(files.root.split('/').pop() ?? 'project')
      await saveBoard($, board)
      await $.fs.write(`${files.crew}/.gitignore`, 'usage/\n')
      const stage = (await read($, live)).flow.stage
      if (stage !== 'idle' && stage !== 'done' && stage !== 'escalated') {
        return { text: `crew 正在進行（${stage}），等這一輪完成再開始新的；卡住的話先用 /crew reset。` }
      }
      await update($, isDemo, () => false)
      await update($, live, l => ({ ...l, prdPath: path }))
      await feed($, { type: 'start', prd: { path, size: text.length, text: text.slice(0, 4_000) } })
      await $.ui.open({ id: PANE, title: 'Crew' })
      const pm = (await read($, live)).roles.pm
      if (pm.state === 'blocked') return { text: `crew 沒有開始：${pm.doing}` }
      return { text: `crew 開始：PM 正在拆 ${path}（${pm.tier ?? ''} ${pm.label ?? ''}・${pm.effort ?? ''}）。進度在 /crew 面板。` }
    }
    if (verb === 'reset') {
      await update($, live, () => emptyLive())
      return { text: '已清掉這個 session 的 crew 狀態。看板（prd-tracker.json）和討論串檔案都保留。' }
    }
    if (verb === 'answer') {
      const [id = '', ...words] = rest
      const answer = words.join(' ')
      const q = (await read($, live)).questions.find(x => x.id === id && x.status === 'open')
      if (q === undefined || answer === '') return { text: '用法：/crew answer <Q-編號> <回答>，編號要是還沒回答的問題。' }
      await update($, live, l => ({ ...l, questions: l.questions.map(x => (x.id === id ? { ...x, status: 'answered' as const, answer } : x)) }))
      if (q.item !== undefined) await post($, { item: q.item, from: 'person', to: q.from === 'qa' ? 'qa' : 'pm', text: `${q.question} → ${answer}` })
      await feed($, { type: 'answered', question: q.question, answer, role: q.from === 'qa' ? 'qa' : 'pm' })
      return { text: `已把 ${id} 的回答轉給 ${q.from === 'qa' ? 'QA' : 'PM'}。` }
    }
    if (verb === 'status') {
      const board = await loadBoard($)
      const l = await read($, live)
      const s = snapshotOf({ board, live: l, now: await $.clock.now() })
      return { text: bandText(s, `crew（${l.flow.stage}）`) }
    }
    await $.ui.open({ id: PANE, title: 'Crew' })
    return { text: 'crew 面板已開啟。/crew start <PRD 檔案> 開始一份 PRD。' }
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
    const r = applyOps(board, parsed.ops, { by: role, today: dayOf(now), prefixes: await idPrefixes($) })
    if (!r.ok) return { result: `board_write 沒有生效，看板沒有任何變更：\n- ${r.errors.join('\n- ')}` }
    await saveBoard($, r.tracker)
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
      if (ids.some(id => e.text.includes(id)) || CREW_MENTION.test(e.text)) return { drop: 'crew 自己處理角色的回報' }
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const role = e.agentId === undefined ? undefined : (await read($, live)).agents[e.agentId]
    if (role !== undefined) {
      await update($, live, l => ({ ...l, roles: { ...l.roles, [role]: { ...l.roles[role], state: 'working' } } }))
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
            roles: role === undefined ? s.roles : { ...s.roles, [role]: { ...s.roles[role], context: u.input + u.cacheRead + u.cacheWrite } },
          }
        })
      }
      yield chunk
    }
    return await stream.result
  })

  on('turn.complete', async ($, e, next) => {
    const role = e.agentId === undefined ? undefined : (await read($, live)).agents[e.agentId]
    if (role === undefined) return next(e)
    // A role's own turn start is not always raised to this plugin, so a finished run is what counts as a wake.
    const l = await update($, live, s => ({
      ...s,
      roles: { ...s.roles, [role]: { ...s.roles[role], state: 'idle', doing: '—' } },
      usage: { ...s.usage, [role]: { ...(s.usage[role] ?? ZERO), wakes: (s.usage[role]?.wakes ?? 0) + 1 } },
    }))
    const done = await next(e)
    await saveUsage($)
    const board = await loadBoard($, true)
    if (board !== null) await feed($, { type: 'role_done', role, board, inbox: inboxOf(l) })
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
    const snap = demo ? DEMO[view.scenario] : snapshotOf({ board, live: l, now: await $.clock.now() })
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
