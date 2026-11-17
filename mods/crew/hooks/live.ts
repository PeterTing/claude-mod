import type { CrewLive, CrewLiveRole, CrewMessage, CrewUsage } from '../types'
import { acceptCasesOf, approvedNow, checkOf, criteriaOf, decisionOf, designsOf, failedNow, g6PassedNow, gateG1, gateG2, gateG3, gateG4, gateG5, gateG6, liveCasesOf, liveDesignsOf, liveTasksOf, METHOD_LABEL, methodOf, needsMockup, noneOf, openProposalOf, resultOf, reviewOf, tasksOf, tipOf, unmergedNow } from './board'
import type { GateResult, PrdItem, Task, TestCase, Tracker } from './board'
import { entryLine, estimateTokens, PIN_MAX, PIN_TOKENS, pinnedOf, redact } from './memory'
import type { MemoryEntry } from './memory'
import { baselineOf, cut, droppedRequirements, gateG0, goneWords, headlineOf, knownRequirements, plainOf, refsOf, withoutOwnId } from './prd'
import { labelOf, routeFor } from './router'
import { dirSaid, noneSaid } from './runs'
import type { Requirement } from './prd'
import { hitRate, ITEM_STATUS_NAMES, percent, ROLE_NAMES } from './model'
import { RESET_WAIT } from './guard'
import { CARRY_RECENT_MS } from './carry'
import { acceptMark, acceptsOf, doingOf, normalizeFlow, planFeatures, waitingOf } from './flow'
import type { FlowState } from './flow'
import type { AcceptAppRow, Decision, Feature, Gate, IdPrefixes, Item, RequirementRow, RoleId, RoleRow, RoleRun, Route, Snapshot, Stage, StageCell, Thread, Tier, UsageRow } from './model'

/** A team that has not started. */
export const emptyLive = (): CrewLive => ({
  prdPath: null,
  flow: { stage: 'idle', round: 0, retries: 0 },
  roles: {
    pm: { state: 'idle', doing: '—', context: 0 },
    qa: { state: 'idle', doing: '—', context: 0 },
    uiux: { state: 'idle', doing: '—', context: 0 },
    techlead: { state: 'idle', doing: '—', context: 0 },
    fullstack: { state: 'idle', doing: '—', context: 0 },
  },
  agents: {},
  usage: {},
  tiers: {},
  threads: {},
  posted: 0,
  seen: {},
  questions: [],
  activity: [],
  asks: {},
  lead: 'person',
  asked: 0,
  injected: { count: 0, tokens: 0 },
  retired: [],
  usageDay: '',
  pending: {},
  signals: { prdVersion: '', boardVersion: '', doubt: '', doubtAt: 0, prdChangedAt: 0, checkedAt: 0, added: 0, removed: 0 },
})

/** The stage of the seven a flow stage stands in, as the progress row names it. */
export const STAGE_OF: Record<string, string> = {
  splitting: '規格',
  writing_tests: '測試案例',
  adding_tests: '測試案例',
  confirming: '測試案例',
  designing: '設計',
  approving: '設計',
  planning: '任務',
  building: '實作',
  reviewing: 'Review',
  testing: '測試結果',
  accepting: '等你驗收',
  escalated: '等你決定',
}

/** Another copy's record, as the overview offers it: where it stands in the pane's words; written in the last ten minutes, that copy is likely still open. */
const carryOf = (c: NonNullable<CrewLive['carry']>, now: number): NonNullable<Snapshot['carry']> => ({
  from: c.from,
  prd: c.prd,
  stage: c.stage === 'draft' ? 'PRD 草稿' : (STAGE_OF[c.stage] ?? c.stage),
  waits: c.waits,
  ...(c.tests === undefined ? {} : { tests: redact(c.tests) }),
  ...(c.setup === undefined ? {} : { setup: redact(c.setup) }),
  ...(now - c.at < CARRY_RECENT_MS ? { recent: true as const } : {}),
  ...(c.rebuild === true ? { rebuild: true as const } : {}),
})

/** A full-stack slot by name: the role's own agent is 全端, the others 全端 2 to 全端 8. */
export const slotName = (slot: number | undefined, before = false): string => (slot === undefined || slot <= 1 ? '全端' : `全端 ${slot}${before ? ' ' : ''}`)

/** Where a held flow stopped, in a sentence: the PRD, the stage, and who was on what. */
const stoppedAt = (live: CrewLive): string => {
  const f = normalizeFlow(live.flow)
  const hand = Object.entries(f.jobs ?? {}).map(([id, j]) => `${slotName(j.slot)} ${id}`)
  const on = [...hand, ...(f.reviewing === undefined ? [] : [`Tech lead ${f.reviewing.task}`])]
  return `上次的 ${live.prdPath ?? ''} 停在「${STAGE_OF[f.stage] ?? f.stage}」${on.length === 0 ? '' : `（${on.join('、')}）`}`
}

/** A held flow, in a sentence that says what the person can do. */
const heldText = (live: CrewLive): string => {
  if (live.paused === 'stalled') return `${stoppedAt(live).replace(/^上次的 \S+ 停在/, '流程停在')}，叫醒過一次還是停住。要再試一次嗎？`
  return live.paused === 'person' ? `${stoppedAt(live)}，暫停中。` : `${stoppedAt(live)}。要接續嗎？`
}

/** The answer that takes QA's proposed app settings as they are: the decision card's press. */
export const APP_YES = '照這樣設，開始補圖'

/** How often crew looks after its work on its own, in code, with no model call. */
export const HEARTBEAT_MS = 300_000

const residentOf = (r: NonNullable<CrewLive['resident']>, now: number) => {
  const left = Math.max(0, Math.ceil((r.checkedAt + HEARTBEAT_MS - now) / 60_000))
  return {
    checked: ageOf(r.checkedAt, now),
    next: left === 0 ? '馬上' : `${left} 分鐘後`,
    ...(r.found === undefined ? {} : { found: r.found }),
    ...(r.resumed === undefined ? {} : { resumed: r.resumed }),
  }
}

const HOUR = 3_600_000

/** How long the pane says another copy of crew works this repo, after it was last seen at it. */
export const TWIN_MS = 1_800_000

/** A time of day, as the pane says it: 13:02. */
export const clockOf = (t: number): string => {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const spentOf = (u: CrewUsage | undefined): number => (u === undefined ? 0 : u.input + u.output + u.cacheRead + u.cacheWrite)

/** A role's numbers today, as the brain's actions are measured: its share of the day, its cache hit rate, its context. */
export const metricsOf = (live: CrewLive, role: string): string => {
  const all = Object.values(live.usage).reduce((n, u) => n + spentOf(u), 0)
  const u = live.usage[role]
  const share = all === 0 ? 0 : Math.round((spentOf(u) / all) * 100)
  const rate = u === undefined ? 0 : hitRate({ role: role as RoleId, ...u })
  const context = live.roles[role as RoleId]?.context ?? 0
  return `今日佔 ${share}% · 命中率 ${rate}% · context ${Math.round(context / 1000)}K`
}

/** What came since the brain's action took effect: the role's share and hit rate since, its context now; nothing before it ran again. */
const sinceOf = (live: CrewLive, t: NonNullable<CrewLive['tunings']>[number]): { after?: string } => {
  const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, wakes: 0, rotations: 0 }
  // A day that turned since the action counts from its start: usage starts again each day.
  const base = t.base === undefined || t.base.day !== live.usageDay ? { role: zero, total: 0 } : t.base
  const u = live.usage[t.role] ?? zero
  if (u.wakes <= base.role.wakes) return {}
  const d = { input: u.input - base.role.input, output: u.output - base.role.output, cacheRead: u.cacheRead - base.role.cacheRead, cacheWrite: u.cacheWrite - base.role.cacheWrite }
  const all = Object.values(live.usage).reduce((n, x) => n + spentOf(x), 0) - base.total
  const mine = d.input + d.output + d.cacheRead + d.cacheWrite
  const share = all <= 0 ? 0 : Math.round((mine / all) * 100)
  const read = d.input + d.cacheRead + d.cacheWrite
  const rate = read <= 0 ? 0 : Math.round((d.cacheRead / read) * 100)
  return { after: `之後佔 ${share}% · 命中率 ${rate}% · context ${Math.round((live.roles[t.role as RoleId]?.context ?? 0) / 1000)}K` }
}

/** The day's total tokens, as a brain's action is measured against it. */
export const dayTotal = (live: CrewLive): number => Object.values(live.usage).reduce((n, x) => n + spentOf(x), 0)

/** The role a stage of the flow waits on. */
export const STAGE_ROLE: Record<string, string> = {
  splitting: 'PM',
  confirming: 'PM',
  writing_tests: 'QA',
  adding_tests: 'QA',
  designing: 'UI/UX',
  planning: 'Tech lead',
  reviewing: 'Tech lead',
  building: '全端',
  testing: 'crew',
  accepting: '你',
}

/**
 * Where a running flow stopped, as the board and crew's record say it: the
 * stage, the task in hand and the commit it was at, so a later stop of the
 * same task (another round of changes) is another stop. Undefined while
 * anyone is at work, work is queued, or the person has the flow to decide on;
 * the brain's proposal on usage is no such thing.
 */
export const stopKey = (l: CrewLive, running: readonly string[]): string | undefined => {
  if (l.prdPath === null || l.paused !== undefined || !running.includes(l.flow.stage)) return undefined
  if ((['pm', 'qa', 'uiux', 'techlead', 'fullstack'] as const).some(r => l.roles[r].state === 'working') || Object.values(l.slots ?? {}).some(r => r.state === 'working') || Object.values(l.pending).some(p => p.length > 0)) return undefined
  if (l.questions.some(q => q.status === 'open' && !(q.from === 'brain' && q.item === 'tune'))) return undefined
  // Work held for the person's answer on a role's model: the flow waits for them, as for any question.
  if ((l.modelAsks ?? []).some(a => a.work !== undefined)) return undefined
  const f = normalizeFlow(l.flow)
  const hand = Object.entries(f.jobs ?? {})
    .map(([id, j]) => `${id}@${j.fixing ?? ''}`)
    .sort()
    .join(',')
  return `${f.stage}:${hand}:${f.reviewing?.task ?? ''}:${f.reviewing?.sha ?? ''}`
}

/** The least a day, or a role's own use, must be before a share or a hit rate says anything. */
const SIGNIFICANT = 50_000

/** A context's grade goes up with each this many tokens it holds. */
const CONTEXT_STEP = 50_000

/** A role's name joined to what follows: `全端今日佔`, `Tech lead 今日佔`. */
export const roleSays = (role: RoleId, rest: string): string => (/[A-Za-z]$/.test(ROLE_NAMES[role]) ? `${ROLE_NAMES[role]} ${rest}` : `${ROLE_NAMES[role]}${rest}`)

/**
 * What crew tells the brain about usage, worked out in code: a role over 40%
 * of the day, a role reading under 60% from the cache, a role past its context
 * threshold, two roles going back and forth on one item more than six times
 * while they still are. Each with its key, told at most once an hour, and its
 * grade: one told already is told again only once its grade is higher.
 */
export const usageSignals = (live: CrewLive, now: number): { key: string; text: string; level: number }[] => {
  const out: { key: string; text: string; level: number }[] = []
  const all = Object.values(live.usage).reduce((n, u) => n + spentOf(u), 0)
  for (const role of ['pm', 'uiux', 'fullstack', 'qa', 'techlead'] as const) {
    const u = live.usage[role]
    const spent = spentOf(u)
    // Graded by the tenth of the day it takes, and by the tenth it misses from the cache.
    if (all >= SIGNIFICANT && spent / all > 0.4) out.push({ key: `share:${role}`, text: roleSays(role, `今日佔 ${Math.round((spent / all) * 100)}%（超過 40%）`), level: Math.floor((spent / all) * 10) })
    const rate = u === undefined ? 100 : hitRate({ role, ...u })
    if (spent >= SIGNIFICANT && rate < 60) out.push({ key: `hit:${role}`, text: roleSays(role, `快取命中率 ${rate}%（低於 60%）`), level: Math.floor((100 - rate) / 10) })
    const r = live.roles[role]
    const t = live.tuned?.[role]
    const limit = t?.limit === undefined ? r.limit : t.raise === true ? Math.max(t.limit, r.limit ?? 0) : t.limit
    // Only a run going on past it: a role at rest starts fresh at its next wake anyway, and one marked to rotate already will.
    if (limit !== undefined && r.context > limit && r.state === 'working' && r.rotate !== true) {
      out.push({ key: `context:${role}`, text: roleSays(role, `這一輪的 context ${Math.round(r.context / 1000)}K 超過輪替門檻 ${Math.round(limit / 1000)}K（工作不會中斷，這一輪做完、下次叫醒時換新 context；門檻不是 context 容量）`), level: Math.floor(r.context / CONTEXT_STEP) })
    }
  }
  for (const [item, messages] of Object.entries(live.threads)) {
    const said = messages.filter(m => m.kind === undefined || m.kind === 'message')
    // An exchange that stopped an hour ago is history: however long it ran, nothing goes back and forth now.
    if ((said.at(-1)?.t ?? 0) <= now - HOUR) continue
    // The latest run of messages two senders passed back and forth, newest first.
    const from = said.map(m => m.from)
    const [a, b] = [from.at(-1), from.at(-2)]
    if (a === undefined || b === undefined || a === b) continue
    let n = 2
    while (from[from.length - 1 - n] === (n % 2 === 0 ? a : b)) n += 1
    if (n > 6) out.push({ key: `pingpong:${item}`, text: `${b} 和 ${a} 在 ${item} 來回 ${n} 次（超過 6 次）`, level: n })
  }
  return out
}

const DAY = 86_400_000

/** "2 分鐘前" from a time and now. */
export const ageOf = (t: number, now: number): string => {
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return '剛剛'
  if (s < 3_600) return `${Math.floor(s / 60)} 分鐘前`
  if (s < DAY / 1000) return `${Math.floor(s / 3_600)} 小時前`
  return `${Math.floor(s / (DAY / 1000))} 天前`
}

/** The day of a time, as the activity log keys it. */
export const dayOf = (t: number): string => new Date(t).toISOString().slice(0, 10)

const total = (u: CrewUsage | undefined): number => (u === undefined ? 0 : u.input + u.output + u.cacheRead + u.cacheWrite)

/** A role's tokens on Codex, as the token tab lists them: Codex writes no cache, so it has none. */
const codexRow = (role: RoleId, u: CrewUsage): UsageRow => ({ role, engine: 'codex', input: u.input, output: u.output, cacheRead: u.cacheRead, cacheWrite: 0, wakes: u.wakes, rotations: u.rotations })

const TESTING: readonly CrewLive['flow']['stage'][] = ['writing_tests', 'confirming', 'adding_tests', 'escalated']

const gate = (
  id: string,
  result: GateResult,
  active: boolean,
  meta: { name: string; fill: string; confirm: string },
  threads: CrewLive['threads'],
): Gate => {
  const state = result.total === 0 ? 'pending' : result.gaps.length === 0 ? 'pass' : active ? 'active' : 'gap'
  return {
    id,
    state,
    ...(state === 'gap' ? { detail: `${result.gaps.length} 個缺口` } : state === 'active' ? { detail: `${result.covered}/${result.total}` } : {}),
    ...meta,
    covered: result.covered,
    total: result.total,
    gaps: result.gaps.map(g => ({ id: g.id, title: g.title, status: '還沒有覆蓋', ...('shown' in g && typeof g.shown === 'string' ? { shown: g.shown } : {}), ...(talkedOn(threads[g.id]) ? { thread: g.id } : {}) })),
    checked: '即時',
  }
}

const stageOf = (label: string, r: GateResult, active: boolean): Stage => ({
  label,
  done: r.covered,
  total: r.total,
  state: r.total > 0 && r.gaps.length === 0 ? 'done' : active ? 'active' : 'pending',
})

const name = (who: string): string => (who === 'person' ? '你' : who === 'brain' ? '大腦' : (ROLE_NAMES[who as RoleId] ?? who))

/** A day and a time of day, as a thread's message says it: 10/31 15:42, with the year where it is not this one's. */
export const stampOf = (t: number, now: number): string => {
  const d = new Date(t)
  const year = d.getFullYear() === new Date(now).getFullYear() ? '' : `${d.getFullYear()}/`
  return `${year}${d.getMonth() + 1}/${d.getDate()} ${clockOf(t)}`
}

/** What an item is, in words: its kind, its title, the feature it belongs to, and where it stands now. */
export type ItemFacts = Pick<Thread, 'kind' | 'title' | 'feature' | 'status' | 'shown'>

const prefixOf = (id: string | undefined): string | undefined => (id === undefined ? undefined : /^([A-Za-z][A-Za-z0-9_]*-)\d/.exec(id)?.[1])

/** The start of a feature's number and a test case's, as the board's own ids show them: a project's schema may set its own. */
const idPrefixesOf = (board: Tracker | null): IdPrefixes => {
  const items = board?.prd_items ?? []
  const cases = items.flatMap(i => (Array.isArray(i.test_cases) ? i.test_cases : []).map(c => (typeof c?.id === 'string' ? c.id : undefined)))
  return { feature: prefixOf(items[0]?.id) ?? 'PRD-', testCase: prefixOf(cases.find(c => c !== undefined)) ?? 'TC-' }
}

/** The kind an item's number says, where the board no longer has it. */
const kindByPrefix = (prefixes: IdPrefixes): readonly [string, string][] => [
  [prefixes.feature, '功能'],
  ['AC-', '驗收條件'],
  ['SCR-', '設計稿'],
  ['TASK-', '任務'],
  [prefixes.testCase, '測試'],
  ['R-', 'PRD 需求'],
]

/**
 * Every item the board, the PRD's requirements and the team's memory hold, in
 * words. A design says whether the person approved it, a task how far it is,
 * as the board tab does; anything moved out says so, with why, and so does
 * what a feature moved out held.
 */
export const factsOf = (
  board: Tracker | null,
  requirements: readonly Requirement[],
  items: readonly Item[],
  memories: readonly { id: string; text: string; supersededBy?: string }[],
): Map<string, ItemFacts> => {
  const facts = new Map<string, ItemFacts>()
  const statuses = new Map(items.map(i => [i.id, ITEM_STATUS_NAMES[i.status]]))
  for (const item of board?.prd_items ?? []) {
    const feature = { id: item.id, title: item.title }
    const gone = (why: string | undefined, status?: string) =>
      why !== undefined ? { status: `已移出：${why}` } : item.crew_dropped !== undefined ? { status: `所屬功能已移出：${item.crew_dropped}` } : status !== undefined ? { status } : {}
    facts.set(item.id, { kind: '功能', title: item.title, feature, ...(item.crew_dropped !== undefined ? { status: `已移出：${item.crew_dropped}` } : {}) })
    for (const c of criteriaOf(item)) facts.set(c.id, { kind: '驗收條件', title: c.text, feature, ...gone(undefined) })
    for (const d of designsOf(item)) {
      const decision = decisionOf(d)
      const said = decision === undefined ? '等你核准' : decision.verdict === 'approved' ? '你核准了' : `你退回了${decision.reason === undefined ? '' : `：${decision.reason}`}`
      facts.set(d.id, { kind: '設計稿', title: d.title, feature, ...gone(d.crew_dropped, said) })
    }
    for (const x of tasksOf(item)) facts.set(x.id, { kind: '任務', title: x.title, feature, ...gone(x.crew_dropped, statuses.get(x.id)) })
    for (const c of Array.isArray(item.test_cases) ? item.test_cases : []) {
      if (typeof c?.id !== 'string') continue
      const title = typeof c.title === 'string' && c.title !== '' ? c.title : typeof c.expected === 'string' && c.expected !== '' ? c.expected : '（沒有標題）'
      facts.set(c.id, { kind: '測試', title, feature, ...gone(undefined) })
    }
  }
  for (const r of requirements) {
    if (facts.has(r.id)) continue
    // One the PRD no longer has goes by crew's code: its old number may be another's now.
    facts.set(r.id, { kind: 'PRD 需求', title: plainOf(withoutOwnId(r)), ...(r.gone === true ? { status: goneWords(r) } : r.label === undefined ? {} : { shown: `需求 ${r.label}` }) })
  }
  for (const m of memories) if (!facts.has(m.id)) facts.set(m.id, { kind: '團隊記憶', title: m.text, ...(m.supersededBy === undefined ? {} : { status: `已被 ${m.supersededBy} 取代` }) })
  return facts
}

/** The first line of what was said. */
const firstLine = (text: string): string => cut((text.split('\n').find(l => l.trim() !== '') ?? '').trim(), 200)

/** A message people wrote: the roles, the person or the brain. Crew's own notices (its work handed out) and memory lines are the log's. */
const spoken = (m: { kind?: string; from?: string }): boolean => (m.kind === undefined || m.kind === 'message') && m.from !== 'crew'

/** Whether an item has anything to read on the Threads tab. */
export const talkedOn = (messages: readonly CrewMessage[] | undefined): boolean => messages?.some(spoken) === true

/** The kinds of item that have a page of their own: not a team memory, nor a question to a role. */
const hasPage = (facts: ItemFacts | undefined): boolean => facts !== undefined && facts.kind !== '團隊記憶'

/**
 * The threads, the newest first: only what people wrote, so an item crew only
 * handed out work on has none. Each says what its item is: a question to a role
 * takes its asker's words for its title, and an item the board no longer has
 * says so. An answer to a question, posted as 問題 → 回答, shows its answer in
 * the list.
 */
const threadsOf = (live: CrewLive, facts: Map<string, ItemFacts>, prefixes: IdPrefixes, now: number): Thread[] =>
  Object.entries(live.threads)
    .filter(([, kept]) => talkedOn(kept))
    .map(([item, kept]) => {
      const messages = kept.filter(spoken)
      const newest = messages.reduce((t, m) => Math.max(t, m.t), 0)
      const known = facts.get(item)
      const what: ItemFacts =
        known !== undefined
          ? known
          : /^ASK-/.test(item)
            ? { kind: messages[0]?.from === 'brain' ? '大腦替你問的' : '你問的', title: firstLine(messages[0]?.text ?? '') || item }
            : (() => {
                const kind = kindByPrefix(prefixes).find(([prefix]) => item.startsWith(prefix))?.[1]
                return kind === undefined ? { kind: '項目', title: '看板上沒有這個編號' } : { kind, title: '看板上已經沒有這個項目' }
              })()
      const answers = live.questions.filter(q => q.item === item && q.answer !== undefined)
      const gistOf = (m: CrewMessage): string | undefined => {
        if (m.from !== 'person' && m.from !== 'brain') return undefined
        const q = answers.find(x => m.text.endsWith(` → ${x.answer}`))
        return q?.answer === undefined ? undefined : `回答：${redact(q.answer)}`
      }
      const yours = (m: CrewMessage) => [m.from, m.to].some(w => w === 'person' || w === 'brain')
      const mineAt = messages.filter(yours).reduce((t, m) => Math.max(t, m.t), 0)
      return {
        newest,
        thread: {
          item,
          ...what,
          ...((live.threadTotals?.[item] ?? 0) > kept.length ? { older: true as const } : {}),
          ...(hasPage(known) ? { opens: true as const } : {}),
          latest: ageOf(newest, now),
          ...(mineAt > 0 ? { mine: { latest: ageOf(mineAt, now), t: mineAt } } : {}),
          messages: messages.map(m => {
            const gist = gistOf(m)
            return {
              from: m.to === undefined ? name(m.from) : `${name(m.from)} → ${name(m.to)}`,
              text: m.text,
              ...(gist === undefined ? {} : { gist }),
              ...(yours(m) ? { mine: true } : {}),
              at: stampOf(m.t, now),
            }
          }),
        },
      }
    })
    .sort((a, b) => b.newest - a.newest)
    .map(t => t.thread)

/** A role's runs the person can watch: each Claude agent it had, and its runs on Codex as one. */
export const roleRun = (live: CrewLive, role: RoleId): RoleRun | undefined => {
  const r = live.roles[role]
  const agentId = r.agentId ?? Object.entries(live.agents).filter(([, x]) => x === role).at(-1)?.[0]
  if (agentId === undefined) return undefined
  return { agentId, ...(r.state === 'working' && r.agentId === agentId && !agentId.startsWith('codex:') ? { live: true as const } : {}) }
}

const MEMORY_ROWS = 40

const memoryRow = (m: MemoryEntry) => ({
  id: m.id,
  type: m.type,
  text: m.text,
  source: m.source,
  refs: m.refs,
  ...(m.supersededBy !== undefined ? { supersededBy: m.supersededBy } : {}),
  ...(m.builders === true && m.supersededBy === undefined ? { builders: true as const } : {}),
})

/** What is pinned for every builder, as the memory tab shows it against the cap. */
const pinnedRows = (memories: readonly MemoryEntry[]) => {
  const pinned = pinnedOf(memories)
  return { rows: pinned.map(memoryRow), tokens: estimateTokens(pinned.map(entryLine).join('\n')), max: PIN_MAX, maxTokens: PIN_TOKENS }
}

/** Where a task's code stands with the tech lead: under review, approved, changes asked for, out of date, or waiting. */
export const reviewNote = (x: Task, flow: CrewLive['flow']): string | undefined => {
  const tip = tipOf(x)
  if (tip === undefined) return undefined
  if (doingOf(flow, x.id)?.step === 'review') return 'Tech lead 正在 review'
  const r = reviewOf(x)
  if (r === undefined) return '等 review'
  if (r.sha !== tip) return 'review 過期（新的 commit 還沒 review）'
  return r.verdict === 'approve' ? 'review 通過' : `review 要修改${r.notes === undefined ? '' : `：${r.notes}`}`
}

/** Why a task is not yet through G5, said as where it stands. */
export const reviewGap = (x: Task, flow: CrewLive['flow']): string => {
  const tip = tipOf(x)
  if (tip === undefined) return '還沒有 commit'
  if (doingOf(flow, x.id)?.step === 'review') return 'Tech lead 正在 review'
  const r = reviewOf(x)
  if (r === undefined) return '等 Tech lead review'
  if (r.sha !== tip) return 'review 過期，等重新 review'
  return 'review 要修改，全端修正中'
}

/** A task approved at an older commit, with none of its newest: its review is out of date. */
const staleReview = (x: Task): boolean => {
  const r = reviewOf(x)
  return !approvedNow(x) && r?.verdict === 'approve' && r.sha !== tipOf(x)
}

/**
 * Why a test case is not yet through G6: not run; run with no result for it
 * (the person answered that the test command does not run it, or the
 * full-stack is adding its test); failed (with its evidence); or out of date.
 * `ran`: crew's latest run gave other test cases a result.
 */
export const runGap = (tc: TestCase, flow?: Pick<FlowState, 'unrun' | 'app'>, ran = false): string => {
  const base = commandGap(tc, flow, ran)
  // QA's proposal on another way waits for the person: said beside the gap, which it does not close.
  const p = openProposalOf(tc)
  return p === undefined ? base : `${base}；QA 提議改用「${METHOD_LABEL[p.method]}」，等你在待你決定確認`
}

/** Why a test case is not yet through G6, by the way it is verified: the test commands' gaps, or the other way's. */
const commandGap = (tc: TestCase, flow?: Pick<FlowState, 'unrun' | 'app'>, ran = false): string => {
  const method = methodOf(tc)
  // A failure in crew's run of the test commands is a failure whatever the way: told as it is below.
  if (method !== 'command' && !failedNow(tc)) {
    const c = checkOf(tc)
    if (method === 'accept') return '等你驗收時確認（G6 不等這一項）'
    if (c?.stale === true) return '結果過期（這個功能的任務之後又有 commit）'
    if (c?.result === 'failed') return `QA 實際操作沒過${c.round === undefined ? '' : `（第 ${c.round} 輪）`}，照現在的流程交給全端修`
    return flow?.app === true ? '等 QA 實際操作' : '等 QA 實際操作：這個 repo 還沒設定 app'
  }
  const r = resultOf(tc)
  if (r === undefined) {
    const n = noneOf(tc)
    const why = n === undefined ? undefined : noneSaid(n)
    if (flow?.unrun?.ok.includes(tc.id) === true) return why === undefined ? '沒有結果：你回答過測試指令跑不到（不算通過）' : `${why}（你回答過照現在繼續，不算通過）`
    // What the full-stack does for it, by why it has none.
    if (flow?.unrun?.fix?.includes(tc.id) === true) {
      return n?.why === 'skipped'
        ? '沒有結果：全端在查它為什麼被跳過'
        : n?.why === 'unnamed'
          ? '沒有結果：全端在讓測試的輸出列出這個編號的結果'
          : n?.why === 'unclear'
            ? '沒有結果：全端在確認測試指令有沒有跑到它'
            : n?.why === 'unreached'
              ? '沒有結果：全端在修測試指令沒有正常結束；這個編號要你加測試指令才跑得到'
              : '沒有結果：全端在補上帶這個編號的測試'
    }
    // One crew can say why no command ran (turned off, past the most crew runs, no command found…): said, a gap all the same.
    if (n?.cause !== undefined && why !== undefined) return `${why}（算缺口，不算通過）`
    // After a run that did not end cleanly, "no command ran its folder" is only what the output shows: it may have stopped before.
    if (n?.why === 'unreached' && flow?.unrun?.exit !== undefined) return `可能沒跑到：測試在 ${dirSaid(n.dir ?? '')}，測試指令以 exit ${flow.unrun.exit} 結束，也可能是停在它之前`
    return why ?? (ran ? '沒有結果（測試指令的輸出裡找不到）' : '還沒跑')
  }
  if (r.stale === true) return '結果過期（之後又有 commit）'
  return `失敗（.crew/runs/${r.run}.log）`
}

/**
 * Where G6's passes come from, counted apart: each test command's (the first
 * that passed the case), QA's in the app, and the person's at acceptance.
 */
const g6Sources = (cases: readonly TestCase[]): { sources?: string } => {
  if (cases.length === 0) return {}
  const commands = new Map<string, number>()
  let qa = 0
  let accept = 0
  for (const c of cases.filter(g6PassedNow)) {
    const m = methodOf(c)
    if (m === 'qa') qa += 1
    else if (m === 'accept') accept += 1
    else {
      const by = resultOf(c)?.by ?? '測試指令'
      commands.set(by, (commands.get(by) ?? 0) + 1)
    }
  }
  const parts = [...[...commands].map(([cmd, n]) => (cmd === '測試指令' ? `測試指令 ${n}` : `測試指令「${cmd}」${n}`)), `QA 實際操作 ${qa}`, `你驗收時確認 ${accept}`]
  return { sources: `通過的來源：${parts.join('・')}` }
}

/** Why a feature is not yet through G2: no design, one waiting for the person, or one sent back. */
const designGap = (item: PrdItem): string => {
  const waiting = liveDesignsOf(item).filter(d => decisionOf(d) === undefined)
  if (waiting.length > 0) return `等你核准（${waiting.map(d => d.id).join('、')}）`
  return designsOf(item).some(d => decisionOf(d)?.verdict === 'rejected') ? '你退回了，UI/UX 重畫中' : '還沒有設計稿'
}

/** A feature has a design the person approved. */
const designed = (item: PrdItem): boolean => liveDesignsOf(item).some(d => decisionOf(d)?.verdict === 'approved')

/** Criteria ids some test case covers. */
const coveredCriteria = (board: Tracker): Set<string> => new Set(board.prd_items.flatMap(i => i.test_cases.flatMap(c => c.acceptance_criteria ?? [])))

/**
 * Each PRD requirement with how far its development is, from the board: the
 * spec (every feature that answers it has criteria) and the test cases written
 * for those criteria, which count as done only once the spec is. Stages crew
 * does not track yet (design, tasks, code, review, test runs) are marked later,
 * never done. A requirement a feature answers is in scope, even if it was
 * dropped once.
 */
const requirementRows = (board: Tracker, requirements: readonly Requirement[]): RequirementRow[] => {
  const features = board.prd_items.filter(i => i.crew_dropped === undefined)
  const covered = coveredCriteria(board)
  const dropped = droppedRequirements(board)
  return requirements.map(r => {
    const answering = features.filter(f => refsOf(f).includes(r.id))
    const criteria = answering.flatMap(criteriaOf)
    const specced = answering.filter(f => criteriaOf(f).length > 0).length
    const tested = criteria.filter(c => covered.has(c.id)).length
    const state = (done: number, all: number): StageCell['state'] => (all > 0 && done === all ? 'done' : done > 0 ? 'doing' : 'todo')
    const spec = state(specced, answering.length)
    const cases = state(tested, criteria.length)
    const planned = new Set(answering.flatMap(f => tasksOf(f).filter(x => x.crew_dropped === undefined).flatMap(x => x.acceptance_criteria)))
    const withTask = criteria.filter(c => planned.has(c.id)).length
    const tasks = state(withTask, criteria.length)
    // The tasks serving this requirement's criteria, and those with a commit that does them.
    const ids = new Set(criteria.map(c => c.id))
    const serving = answering.flatMap(f => tasksOf(f).filter(x => x.crew_dropped === undefined && x.acceptance_criteria.some(c => ids.has(c))))
    const built = serving.filter(x => (x.crew_commits ?? []).length > 0).length
    const approved = serving.filter(approvedNow).length
    // The test cases of this requirement's criteria, and those that passed in crew's latest run on the newest commit.
    const runCases = liveCasesOf(board).filter(c => (c.acceptance_criteria ?? []).some(a => ids.has(a)))
    const passed = runCases.filter(g6PassedNow).length
    const out = answering.length === 0 ? dropped.get(r.id) : undefined
    return {
      id: r.id,
      label: r.label ?? r.id,
      section: plainOf(r.section),
      text: plainOf(r.text),
      // Its number stands beside it: the words go on without it.
      headline: headlineOf(withoutOwnId(r)),
      features: answering.map(f => f.id),
      ...(out === undefined ? {} : { dropped: out }),
      layers: {
        spec: { state: spec },
        design: (() => {
          const approved = answering.filter(designed).length
          const started = answering.filter(f => designsOf(f).length > 0).length
          return answering.length === 0 ? { state: 'todo' as const, note: '0/0' } : { state: approved === answering.length ? ('done' as const) : started > 0 ? ('doing' as const) : ('todo' as const), note: `${approved}/${answering.length}` }
        })(),
        cases: { state: cases === 'done' && spec !== 'done' ? 'doing' : cases, note: `${tested}/${criteria.length}` },
        tasks: { state: tasks === 'done' && spec !== 'done' ? 'doing' : tasks, note: `${withTask}/${criteria.length}` },
        // A commit says code is there, not that it is right: done waits for the tech lead to approve the newest commit.
        code: serving.length === 0 ? { state: 'todo', note: '0/0' } : { state: approved === serving.length ? 'done' : built > 0 ? 'doing' : 'todo', note: `${built}/${serving.length}` },
        review:
          serving.length === 0
            ? { state: 'todo', note: '0/0' }
            : { state: approved === serving.length ? 'done' : serving.some(staleReview) ? 'stale' : approved > 0 ? 'doing' : 'todo', note: `${approved}/${serving.length}` },
        runs:
          runCases.length === 0
            ? { state: 'todo', note: '0/0' }
            : {
                state: passed === runCases.length ? 'done' : runCases.some(c => resultOf(c)?.stale === true) ? 'stale' : passed > 0 ? 'doing' : 'todo',
                note: `${passed}/${runCases.length}`,
              },
      },
    }
  })
}

/** Everything the pane draws, from the board and memories on disk and the team this session runs. */
/**
 * The designs waiting for the person, as one row once the review page is
 * theirs to decide on: its link, or that the brain is publishing it; or, on a
 * board from before mockups, that UI/UX has them to draw first. Where the
 * brain could not publish the page, or the person chose the pane, each design
 * stays a row of its own.
 */
/** What the pane says of a design the person was asked about that the board no longer has. */
const goneQuestion = (id: string): string =>
  `設計稿 ${id} 不在目前的看板上（可能切了分支，或看板被改過）。只是切了分支的話，先切回來再決定；按核准或退回會關掉這題，沒有設計稿的功能交給 UI/UX 重畫。`

/** A question the decide page holds: a role's or crew's own; the brain's own and its proposals stay in the pane. */
const onPage = (d: Decision): boolean => d.kind === 'design' || (d.kind === undefined && d.from !== 'brain')

/**
 * What waits for the person on the decide page, as one row with its link:
 * the designs and the roles' questions. Each keeps a row of its own when the
 * person chose the pane or the page could not be published, and before a
 * page is asked for while something can be decided.
 */
const reviewed = (asked: Decision[], review: CrewLive['review'], board: Tracker | null, web = false): Decision[] => {
  const all = board === null ? [] : board.prd_items.flatMap(i => designsOf(i))
  // One asked about and gone from the board has nothing to see, on the page or here: it keeps a row of its own, saying so, for the person to close.
  const gone = (d: Decision) => board !== null && d.kind === 'design' && !all.some(x => x.id === d.design)
  const decisions = asked.map(d => (gone(d) ? { ...d, question: goneQuestion(d.design ?? '') } : d))
  // Decided in the pane, each design still has the page to see it on, once there is one.
  // On crew's web page the decide page is always there: what it holds is one row, whatever was chosen for claude.ai's.
  if (!web && (review?.failed !== undefined || review?.chose === true)) return review.url === undefined ? decisions : decisions.map(d => (d.kind === 'design' && !gone(d) ? { ...d, url: review.url as string } : d))
  const paged = decisions.filter(d => onPage(d) && !gone(d))
  if (paged.length === 0) return decisions
  const designs = paged.filter(d => d.kind === 'design')
  const questions = paged.length - designs.length
  const drawing = designs.filter(d => {
    const found = all.find(x => x.id === d.design)
    return found !== undefined && needsMockup(found)
  }).length
  const ready = designs.length - drawing + questions
  // A page nobody was asked to publish: rows of their own, unless none of them can be decided yet.
  if (!web && review === undefined && ready > 0) return decisions
  const parts = [...(designs.length - drawing === 0 ? [] : [`設計稿 ${designs.length - drawing} 份等你核准`]), ...(questions === 0 ? [] : [`問題 ${questions} 題等你回答`])].join('、')
  const rest = drawing === 0 ? '' : `，${drawing} 份設計稿 UI/UX 補畫中`
  const question =
    ready === 0
      ? `設計稿：${drawing} 份還沒有 mockup，UI/UX 補好才能看和決定`
      : web
        ? `待你決定頁：${parts}${rest}；在 crew 網頁的「待你決定」看完再決定`
        : review?.url === undefined
          ? `待你決定頁：${parts}${rest}；待你決定頁發佈中，好了才能看和決定`
          : `待你決定頁：${parts}${rest}；在頁面上看完再決定，結果會回到這裡`
  const row: Decision = {
    id: 'designs',
    question,
    from: 'crew',
    age: paged[paged.length - 1]?.age ?? '',
    kind: 'review',
    // The row holds every one of them: the pane counts each.
    count: paged.length,
    ...(web || review?.url === undefined ? {} : { url: review.url }),
    ...(!web && ready > 0 ? { inPane: true as const } : {}),
  }
  const at = decisions.indexOf(paged[0] as Decision)
  const others = decisions.filter(d => !paged.includes(d))
  return [...others.slice(0, at), row, ...others.slice(at)]
}

/**
 * What waits on a question to the person, and what goes on meanwhile, in the
 * words 待你決定 shows under it: the tasks and features held on it alone, and
 * those set after them; the whole flow for crew's own question it stopped on.
 * Nothing where crew does not know (a planning role's question).
 */
export const holdOf = (flow: FlowState, board: Tracker | null, q: { id: string; from: string; item?: string; task?: string }): string | undefined => {
  const jobs = flow.jobs ?? {}
  const tasks = Object.entries(jobs)
    .filter(([id, j]) => j.wait !== undefined && (j.wait.id === q.id || (j.wait.id === undefined && id === q.item)))
    .map(([id]) => id)
  if (q.from === 'fullstack' && q.task !== undefined) tasks.push(q.task)
  if (q.from === 'techlead' && q.item !== undefined && /^TASK-\d+$/.test(q.item)) tasks.push(q.item)
  const features = Object.entries(flow.checks ?? {})
    .filter(([f, c]) => c.asked !== undefined && (c.asked.id === q.id || (c.asked.id === undefined && (f === q.item || c.fix?.task === q.item))))
    .map(([f]) => f)
  const held = [...new Set([...tasks, ...features])]
  if (held.length === 0) return q.from === 'crew' && flow.stage === 'escalated' ? '整個流程在等這一題，回答之後才往下走。' : undefined
  // The tasks set after one held, and after those in turn: they wait too, as the status says (「等 TASK-002 先做完」).
  const after = board === null ? [] : waitingOf(flow, board).flatMap(w => (held.includes(w.task) ? [] : [{ task: w.task, first: (/^等 (.+) 先做完$/.exec(w.why)?.[1] ?? '').split('、') }]))
  const behind: string[] = []
  for (let grew = true; grew; ) {
    grew = false
    for (const w of after)
      if (!behind.includes(w.task) && w.first.some(id => held.includes(id) || behind.includes(id))) {
        behind.push(w.task)
        grew = true
      }
  }
  const going = Object.entries(jobs)
    .filter(([id, j]) => j.slot !== undefined && !held.includes(id))
    .map(([id]) => id)
  return `在等這一題：${[...held, ...behind].join('、')}。${going.length > 0 ? `照常進行：${going.join('、')}。` : '其他任務照常進行。'}`
}

const withHold = (holds: string | undefined): { holds?: string } => (holds === undefined ? {} : { holds })

/** How many of a feature's test cases the person confirms themselves as they pass it. */
const confirmCount = (board: Tracker, feature: string): { confirm?: number } => {
  const n = acceptCasesOf(board, feature).length
  return n === 0 ? {} : { confirm: n }
}

/** The app kept up for acceptance as the pane says it: the commit short, and the seconds left to wait while it comes up. */
export const acceptAppRow = (a: NonNullable<CrewLive['acceptApp']>, now: number, waits: { tests: number; merges: number }): AcceptAppRow => ({
  state: a.state,
  features: [...a.features],
  ...(a.sha === undefined ? {} : { sha: a.sha.slice(0, 7) }),
  ...(a.state === 'starting' && a.phase !== undefined ? { phase: a.phase } : {}),
  ...(a.state === 'starting' && a.phase === 'app' && a.until !== undefined ? { waitS: Math.max(0, Math.ceil((a.until - now) / 1000)) } : {}),
  ...(a.why === undefined ? {} : { why: a.why }),
  ...(a.checking === undefined ? {} : { checking: a.checking }),
  ...(a.background === true && a.state === 'up' ? { background: true as const } : {}),
  waits: { tests: waits.tests, merges: waits.merges },
})

/** The features waiting on the person to accept, and how many they passed: none before QA hands one over. */
const acceptRows = (board: Tracker | null, flow: CrewLive['flow']): { accepts?: NonNullable<Snapshot['accepts']> } => {
  if (board === null) return {}
  const all = Object.entries(acceptsOf(normalizeFlow(flow), board))
  if (all.length === 0) return {}
  const order = new Map(board.prd_items.map((i, n) => [i.id, n]))
  const rows = all
    .filter(([, a]) => a.state !== 'passed')
    .sort(([x], [y]) => (order.get(x) ?? 0) - (order.get(y) ?? 0))
    .map(([feature, a]) => ({
      feature,
      ...titleOf(board, feature),
      round: a.round,
      state: a.state === 'fixing' ? ('fixing' as const) : (a.asks ?? 0) > 0 ? ('again' as const) : ('waiting' as const),
      ...(a.said === undefined ? {} : { said: a.said }),
      ...confirmCount(board, feature),
      mark: acceptMark(feature, a),
    }))
  return { accepts: { rows, passed: all.length - rows.length } }
}

/** A feature's title on the board, when it is there. */
const titleOf = (board: Tracker | null, feature: string): { title?: string } => {
  const item = board?.prd_items.find(i => i.id === feature)
  return item === undefined ? {} : { title: item.title }
}

/** QA's checks as the pane shows them: in board order, the features no longer on the board last. */
const checksIn = (board: Tracker | null, checks: NonNullable<CrewLive['flow']['checks']>, open?: string): NonNullable<Snapshot['checks']> => {
  const order = new Map((board?.prd_items ?? []).map((i, n) => [i.id, n]))
  // A feature moved out of the plan since holds nothing: crew's stop on its check has no 接續 (the flow lets it go at its next look).
  const plan = board === null ? undefined : planFeatures(board)
  return Object.entries(checks)
    .sort(([a], [b]) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity))
    .map(([feature, c]) => {
      // What it waits on: the person's answer to crew's question on it, or a builder free to take its fix (not one handed out).
      // Or, on criteria no task covers, the task the tech lead is to add for them, and its build.
      const waits =
        open === feature || c.asked !== undefined
          ? ('person' as const)
          : c.fix !== undefined && c.fix.out !== true
            ? ('builder' as const)
            : c.state === 'failed' && c.fix === undefined && c.untasked !== undefined
              ? ('task' as const)
              : undefined
      // One QA confirmed nothing of in the app, or passed only in part, is said so: neither reads 通過.
      const seen = c.state === 'skipped' && c.unseen === true ? { unseen: true as const } : c.state === 'passed' && c.partial !== undefined ? { partial: c.partial } : {}
      // One crew stopped trying waits on the person's 接續 beside it; one the person said QA saw wrong, on QA's look again.
      const marks = c.redo?.stopped === true ? (plan === undefined || plan.has(feature) ? { stopped: true as const } : {}) : c.state === 'error' && c.recheck !== undefined ? { recheck: true as const } : {}
      return { feature, ...titleOf(board, feature), round: c.round, state: c.state, ...(c.why === undefined ? {} : { why: c.why }), ...(waits === undefined ? {} : { waits }), ...seen, ...marks }
    })
}

/** A task's merge stopped by crew's prep run, as the board says it: not crew at it, the person's to see to. */
export const MERGE_STUCK = '合回停住：準備指令沒跑成功'

export const snapshotOf = ({
  board,
  live,
  now,
  memories = [],
  prd,
  boardProblem,
  boardFile,
  planned = tier => {
    const r = routeFor('fullstack', tier)
    return { tier, model: r.label, effort: r.effort }
  },
  web = false,
  stuck = [],
  appWaits = { tests: 0, merges: 0 },
}: {
  board: Tracker | null
  live: CrewLive
  now: number
  /** crew's test runs and merges waiting for the app kept up for acceptance to close. */
  appWaits?: { tests: number; merges: number }
  /** The tasks whose merge crew's prep stopped, while crew's question on them is open: the person is to see to them. */
  stuck?: readonly string[]
  /** What the full-stack builds a task of this tier on, from its models as the person set them; absent, on crew's own. */
  planned?: (tier: Tier) => Route
  memories?: readonly MemoryEntry[]
  /** The decide page is on crew's own web page: what it holds is one row there, never the claude.ai page's. */
  web?: boolean
  /** The PRD as crew can read it now; absent (no PRD started), G0 is not shown. */
  prd?: { requirements?: readonly Requirement[]; problem?: string } | undefined
  /** Why crew neither reads nor writes the board, when it will not. */
  boardProblem?: string
  /** Where crew keeps the board, and why when it is not in .crew/. */
  boardFile?: { path: string; why?: string }
}): Snapshot => {
  const requirements = prd?.requirements
  const prefixes = idPrefixesOf(board)
  const g0 = board === null || requirements === undefined ? undefined : gateG0(board, requirements)
  const g1 = board === null ? { covered: 0, total: 0, gaps: [] } : gateG1(board)
  const g4 = board === null ? { covered: 0, total: 0, gaps: [] } : gateG4(board)
  const g3 = board === null ? { covered: 0, total: 0, gaps: [] } : gateG3(board)
  // The tasks in the plan, those with a commit doing them, and those the tech lead approved.
  const liveTasks = board === null ? [] : liveTasksOf(board)
  const g5 = board === null ? { covered: 0, total: 0, gaps: [] } : gateG5(board)
  const g6 = board === null ? { covered: 0, total: 0, gaps: [] } : gateG6(board)
  const g2 = board === null ? { covered: 0, total: 0, gaps: [] } : gateG2(board)
  const cases = board === null ? [] : liveCasesOf(board)
  const built: GateResult = {
    covered: liveTasks.filter(x => (x.crew_commits ?? []).length > 0).length,
    total: liveTasks.length,
    gaps: liveTasks.filter(x => (x.crew_commits ?? []).length === 0).map(x => ({ id: x.id, title: x.title })),
  }
  const flowNow = normalizeFlow(live.flow)
  const stage = flowNow.stage
  // The tech lead's review under way, and builders at work beside it or waiting on it.
  const reviewingNow = flowNow.reviewing !== undefined && stage !== 'escalated'
  const buildingNow = stage === 'building' && (!reviewingNow || Object.values(flowNow.jobs ?? {}).some(j => j.slot !== undefined || j.asking === true))
  const testing = TESTING.includes(stage)

  const linked = board === null ? new Set<string>() : coveredCriteria(board)
  // The split is done once every feature has criteria and the board answers the PRD.
  const split: GateResult = g0 === undefined ? g1 : { covered: g1.covered + g0.covered, total: g1.total + g0.total, gaps: [...g1.gaps, ...g0.gaps] }
  const features: Feature[] = (board?.prd_items ?? []).map(item => {
    const criteria = criteriaOf(item)
    const covered = criteria.filter(c => linked.has(c.id)).length
    const share = percent(covered, criteria.length)
    return {
      id: item.id,
      title: item.title,
      percent: share,
      layers: { design: 'todo', frontend: 'todo', backend: 'todo', test: share === 100 ? 'done' : covered > 0 ? 'doing' : 'todo' },
      ...(item.crew_dropped !== undefined ? { dropped: typeof item.crew_dropped === 'string' ? item.crew_dropped : '' } : {}),
    }
  })

  const days = Array.from({ length: 5 }, (_, i) => dayOf(now - (4 - i) * DAY))
  const progress =
    board === null
      ? null
      : {
          // Code counts toward the whole, and as done once the tech lead approved its newest commit: a commit alone is not.
          // Each test case counts too, as done once it passed in crew's latest run on the newest commit.
          done: (g0?.requirements.covered ?? 0) + g1.covered + g2.covered + g4.covered + g3.covered + g5.covered + g6.covered,
          total: (g0?.requirements.total ?? 0) + g1.total + g2.total + g4.total + g3.total + built.total + g6.total,
          // The seven stages of each requirement's row, in its order, over the whole board.
          stages: [
            stageOf('規格', split, stage === 'splitting'),
            stageOf('設計', g2, stage === 'designing' || stage === 'approving'),
            // Test cases are done only once the spec is: a requirement still without features has nothing to test yet.
            { ...stageOf('測試案例', g4, testing), ...(split.gaps.length > 0 && g4.total > 0 && g4.gaps.length === 0 ? { state: testing ? ('active' as const) : ('pending' as const) } : {}) },
            // The plan is done only once the spec is, as test cases are.
            { ...stageOf('任務', g3, stage === 'planning'), ...(split.gaps.length > 0 && g3.total > 0 && g3.gaps.length === 0 ? { state: stage === 'planning' ? ('active' as const) : ('pending' as const) } : {}) },
            // Code committed is not code checked: the stage is done once the tech lead approved every task's newest commit.
            {
              ...stageOf('實作', built, buildingNow),
              ...(built.total > 0 && built.gaps.length === 0 && g5.gaps.length > 0 ? { state: stage === 'building' ? ('active' as const) : ('pending' as const) } : {}),
            },
            stageOf('Review', g5, reviewingNow),
            stageOf('測試結果', g6, stage === 'testing'),
          ],
          features,
          daily: days.map(d => ({ day: d.slice(5).replace('-', '/'), done: live.activity.filter(a => a.day === d).length })),
          recent: [...live.activity]
            .sort((a, b) => b.t - a.t)
            .slice(0, 3)
            .map(a => ({ id: a.id, title: a.title, role: a.role as RoleId, age: ageOf(a.t, now) })),
        }

  const rowOf = (id: RoleId, r: CrewLiveRole, run: RoleRun | undefined): RoleRow => ({
    id,
    state: r.state,
    doing: r.doing,
    ...(r.tier !== undefined && r.label !== undefined && r.effort !== undefined ? { route: { tier: r.tier, model: r.label, effort: r.effort } } : {}),
    context: r.context,
    limit: r.limit ?? 60_000,
    today: total(live.usage[id]) + total(live.codexUsage?.[id]),
    ...(r.engine === 'codex' ? { engine: 'codex' as const } : {}),
    ...(r.task === undefined ? {} : { task: r.task }),
    ...(r.report === undefined ? {} : { report: r.report }),
    ...(run === undefined ? {} : { run }),
    ...(live.claude?.hold === undefined ? {} : r.state === 'working' && r.engine !== 'codex' ? { held: 'finishing' as const } : r.state === 'waiting' && r.doing.startsWith(RESET_WAIT) ? { held: 'paused' as const } : {}),
  })
  const roleRow = (id: RoleId): RoleRow => rowOf(id, live.roles[id], roleRun(live, id))
  // The other builders at work, each a row of its own after the full-stack one; their tokens count on that row.
  const slotRows: RoleRow[] = Object.entries(live.slots ?? {})
    .map(([lane, r]) => ({ slot: Number(lane.replace(/^fullstack-/, '')), r }))
    .filter(({ slot, r }) => Number.isInteger(slot) && slot > 1 && r.state !== 'idle')
    .sort((a, b) => a.slot - b.slot)
    .map(({ slot, r }) => ({
      ...rowOf('fullstack', r, r.agentId === undefined ? undefined : { agentId: r.agentId, ...(r.state === 'working' && !r.agentId.startsWith('codex:') ? { live: true as const } : {}) }),
      today: 0,
      slot,
    }))

  // The designs: the designer's until the person decides; approved, done. One waits for the person as the page shows it:
  // once crew has asked about it, never while its mockup is missing or before it is asked.
  const ux = live.roles.uiux
  const asked = new Set(live.questions.filter(q => q.status === 'open' && q.from === 'crew' && q.item !== undefined).map(q => q.item))
  const designItems: Item[] = (board?.prd_items ?? [])
    .filter(i => i.crew_dropped === undefined)
    .flatMap(i =>
      designsOf(i)
        .filter(d => d.crew_dropped === undefined)
        .map(d => {
          const decision = decisionOf(d)
          const waits = decision === undefined && !needsMockup(d) && asked.has(d.id)
          const undecidedSaid = waits ? '等你核准' : needsMockup(d) ? 'UI/UX 補畫中' : 'UI/UX 畫好了，crew 等這一輪畫完一起問你'
          return {
            id: d.id,
            title: d.title,
            owner: 'uiux' as const,
            status: waits ? ('review' as const) : decision?.verdict === 'approved' ? ('done' as const) : ('doing' as const),
            route: { tier: ux.tier ?? 'S', model: ux.label ?? labelOf('sonnet'), effort: ux.effort ?? 'medium' },
            note: `${i.id}・${d.kind === 'screen' ? '畫面' : '沒有畫面'} · ${decision === undefined ? undecidedSaid : decision.verdict === 'approved' ? '你核准了' : `你退回了${decision.reason === undefined ? '' : `：${decision.reason}`}`}`,
          }
        }),
    )
  const items: Item[] = (board?.prd_items ?? [])
    .filter(i => i.crew_dropped === undefined)
    .map(item => {
      const criteria = criteriaOf(item)
      const covered = criteria.filter(c => linked.has(c.id)).length
      const done = criteria.length > 0 && covered === criteria.length
      const pm = live.roles.pm
      return {
        id: item.id,
        title: item.title,
        owner: 'pm',
        status: done ? 'done' : stage === 'idle' || stage === 'done' ? 'todo' : 'doing',
        route: { tier: pm.tier ?? 'M', model: pm.label ?? labelOf('sonnet'), effort: pm.effort ?? 'high' },
        note: `${covered}/${criteria.length} 條驗收條件有 test case`,
      }
    })
  // The tasks: the full-stack's to build, the tech lead's while it reviews one; under way once a commit does it,
  // done only once review and test runs say so (later phases), never by a commit alone.
  const tl = live.roles.techlead
  const fs = live.roles.fullstack
  // A role's run now, for the task it runs on; any other task is at its own tier, not at the run's.
  const running = (r: CrewLive['roles'][RoleId], otherwise: Route): Route =>
    r.tier !== undefined && r.label !== undefined && r.effort !== undefined ? { tier: r.tier, model: r.label, effort: r.effort } : otherwise
  // Approved on a branch of its own, it is done once crew merged it back: one at a time, tested after each.
  const merging = new Set((normalizeFlow(live.flow).merging ?? []).map(k => k.split(':')[0]))
  const stopped = new Set(stuck)
  const taskItems: Item[] = liveTasks.map(x => {
    const commits = x.crew_commits ?? []
    const unmerged = approvedNow(x) && unmergedNow(x)
    const doing = doingOf(live.flow, x.id)
    const onIt = doing?.step === 'building' || doing?.step === 'fixing'
    const fixing = doing?.step === 'fixing'
    const underReview = doing?.step === 'review'
    const taken = commits.length > 0 || onIt
    const owner = underReview ? 'techlead' : 'fullstack'
    const own = planned(x.size ?? 'M')
    const review = reviewNote(x, live.flow)
    const after = [
      ...(commits.length > 0 ? [`commit ${commits.map(c => c.slice(0, 7)).join('、')}`] : []),
      ...(review === undefined ? [] : [review]),
      ...(unmerged ? [stopped.has(x.id) ? MERGE_STUCK : merging.has(x.id) ? 'crew 合回中' : '等合回'] : []),
      ...(fixing ? [`${slotName(doing?.slot, true)}正在改`] : onIt ? [`${slotName(doing?.slot, true)}正在做`] : []),
    ]
    return {
      id: x.id,
      title: x.title,
      owner,
      status: approvedNow(x) && !unmerged ? 'done' : underReview || unmerged ? 'review' : taken ? 'doing' : 'todo',
      route: underReview ? running(tl, { tier: x.size ?? 'M', model: labelOf('opus'), effort: 'high' }) : onIt && (doing?.slot ?? 1) === 1 ? running(fs, own) : own,
      note: [`對應 ${x.acceptance_criteria.join('、')}${x.size === undefined ? '' : `・${x.size}`}`, ...after].join(' · '),
      links: x.acceptance_criteria,
      rest: after.join(' · '),
    }
  })

  const crewRoles: RoleId[] = ['pm', 'qa', 'uiux', 'techlead', 'fullstack']
  const usage: UsageRow[] = crewRoles
    .filter(r => live.usage[r] !== undefined)
    .map(r => {
      const u = live.usage[r] as CrewUsage
      return { role: r, input: u.input, output: u.output, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite, wakes: u.wakes, rotations: u.rotations }
    })
  // Codex's rows, each after its role's Claude one: its own account's tokens, not in today's count.
  const codexBook = live.codexUsage ?? {}
  const withCodex: UsageRow[] = usage.flatMap(u => (codexBook[u.role] === undefined ? [u] : [u, codexRow(u.role, codexBook[u.role] as CrewUsage)]))
  const onlyCodex: UsageRow[] = crewRoles.filter(r => live.usage[r] === undefined && codexBook[r] !== undefined).map(r => codexRow(r, codexBook[r] as CrewUsage))
  const codexToday = crewRoles.reduce((n, r) => n + total(codexBook[r]), 0)
  const today = crewRoles.reduce((n, r) => n + total(live.usage[r]), 0)
  const brain = total(live.usage.brain)
  const tiers = (['S', 'M', 'L', 'XL'] as const satisfies readonly Tier[])
    .filter(t => (live.tiers[t] ?? 0) > 0)
    .map(t => ({ tier: t, tokens: live.tiers[t] ?? 0 }))

  return {
    prd: board === null ? null : { id: board.project, title: live.prdPath ?? boardFile?.path ?? '.crew/prd-tracker.json', progress: progress === null ? 0 : percent(progress.done, progress.total) },
    progress,
    today,
    roles: (['pm', 'uiux', 'fullstack', 'qa', 'techlead'] as const).flatMap(id => (id === 'fullstack' ? [roleRow(id), ...slotRows] : [roleRow(id)])),
    gates:
      board === null
        ? []
        : [
            ...(g0 === undefined ? [] : [gate('G0', g0, stage === 'splitting', { name: 'PRD 每條需求都有對應的功能', fill: 'PM 補', confirm: 'crew 對照 PRD 檔案' }, live.threads)]),
            gate('G1', g1, stage === 'splitting', { name: '每個功能都有驗收條件', fill: 'PM 補', confirm: 'PM 自查' }, live.threads),
            {
              ...gate('G2', g2, stage === 'designing' || stage === 'approving', { name: '每個有介面的功能都有畫面和各種狀態', fill: 'UI/UX 補', confirm: '你核准' }, live.threads),
              gaps: (board?.prd_items ?? []).filter(i => i.crew_dropped === undefined && !designed(i)).map(i => ({ id: i.id, title: i.title, status: designGap(i) })),
            },
            gate('G3', g3, stage === 'planning', { name: '每條驗收條件都拆好任務', fill: 'Tech lead 補', confirm: 'Tech lead 自查' }, live.threads),
            gate('G4', g4, stage === 'writing_tests' || stage === 'adding_tests', { name: '每條驗收條件都有 test case', fill: 'QA 補', confirm: 'PM 確認缺口' }, live.threads),
            {
              ...gate('G5', g5, reviewingNow, { name: '每個完成的 task 都通過 code review', fill: '全端修', confirm: 'Tech lead review' }, live.threads),
              gaps: liveTasks.filter(x => !approvedNow(x)).map(x => ({ id: x.id, title: x.title, status: reviewGap(x, live.flow), ...(talkedOn(live.threads[x.id]) ? { thread: x.id } : {}) })),
            },
            {
              ...gate('G6', g6, stage === 'testing', { name: 'test case 全部執行通過、附證據', fill: '全端修', confirm: 'crew 跑測試指令（crew 找到的和你設定的）' }, live.threads),
              ...g6Sources(cases),
              gaps: cases.filter(c => !g6PassedNow(c)).map(c => ({ id: c.id, title: typeof c.title === 'string' ? c.title : c.id, status: runGap(c, live.flow, cases.some(x => resultOf(x) !== undefined)), ...(talkedOn(live.threads[c.id]) ? { thread: c.id } : {}) })),
            },
          ],
    decisions: reviewed(
      live.questions
        .filter(q => q.status === 'open')
        .map(q => ({
          id: q.id,
          question: q.question,
          from: q.from,
          age: ageOf(q.t, now),
          // crew's question on a design is the person's to approve or send back in the pane.
          ...(q.from === 'crew' && q.item !== undefined && /^SCR-\d+$/.test(q.item) ? { kind: 'design' as const, design: q.item } : {}),
          // The brain's proposal on usage is the person's to approve or not.
          ...(q.from === 'brain' && q.item === 'tune' ? { kind: 'proposal' as const } : {}),
          // crew's question on starting the app: its own presses, the proposal taken or the settings tab.
          ...(q.app !== undefined ? { kind: 'app' as const, ...(q.app.proposal === undefined ? {} : { appYes: APP_YES }) } : {}),
          // crew's card of QA's proposals on how test cases are verified: the person's presses, one test case at a time or all.
          ...(q.verify !== undefined && q.app === undefined ? { kind: 'verify' as const, verify: q.verify.cases.map(c => ({ id: c.id, title: c.title, way: `${c.method === 'command' ? '改回' : '改用'}「${METHOD_LABEL[c.method]}」`, reason: c.reason })) } : {}),
          // The choices the role gave, for the person to pick in the pane too.
          ...(q.app === undefined && q.verify === undefined && Array.isArray(q.options) && q.options.length >= 2 ? { options: q.options.filter((o): o is string => typeof o === 'string').slice(0, 4) } : {}),
          ...(q.picture === undefined
            ? {}
            : {
                picture: `這題附了一張圖${q.picture.caption === undefined ? '' : `（${q.picture.caption}）`}，${live.review?.failed === undefined ? '只有待你決定頁畫得出來' : '現在沒有待你決定頁可以看；照問題的文字回答就好'}。`,
              }),
          ...(q.mentions === undefined || q.mentions.length === 0 ? {} : { mentions: q.mentions }),
          ...withHold(holdOf(flowNow, board, q)),
        })),
      live.review,
      board,
      web,
    ),
    ...(live.review === undefined
      ? {}
      : {
          decidePage: {
            ...(live.review.url === undefined ? {} : { url: live.review.url }),
            ...(live.review.failed === undefined ? {} : { failed: live.review.failed }),
            ...(live.review.asked === true ? { asked: true as const } : {}),
            ...(live.review.chose === true ? { chose: true as const } : {}),
            // The brain was asked to publish this page and has not said it did: what is out is older.
            ...(live.pageAsked !== undefined && live.pageAsked === live.review.path ? { brain: true as const } : {}),
          },
        }),
    // The questions on a role's model, apart from the others: the person answers each in the pane.
    ...((live.modelAsks ?? []).length === 0
      ? {}
      : { modelAsks: (live.modelAsks ?? []).map(a => ({ id: a.id, kind: a.kind, role: a.role as RoleId, text: a.text, yes: a.yes, no: a.no, from: a.from, age: ageOf(a.at, now) })) }),
    ...(live.paused === undefined || live.prdPath === null ? {} : { start: { prds: [], resumable: heldText(live), ...(live.paused === 'offer' ? {} : { paused: true }), ...(live.paused === 'stalled' ? { stalled: true as const } : {}) } }),
    ...(live.carry === undefined || live.prdPath !== null || live.draft !== undefined ? {} : { carry: carryOf(live.carry, now) }),
    ...(live.twin === undefined || now - live.twin.at > TWIN_MS ? {} : { twin: live.twin.from }),
    ...(live.awake === undefined ? {} : { awake: { since: clockOf(live.awake.since) } }),
    ...(live.checking === undefined ? {} : { checking: { feature: live.checking.feature, ...titleOf(board, live.checking.feature), round: live.checking.round, since: clockOf(live.checking.since), phase: live.checking.phase, ...(live.checking.find === true ? { find: true as const } : {}) } }),
    ...(live.flow.checks === undefined || Object.keys(live.flow.checks).length === 0
      ? {}
      : { checks: checksIn(board, live.flow.checks, live.flow.checkOpen) }),
    ...acceptRows(board, live.flow),
    ...(live.acceptApp === undefined ? {} : { acceptApp: acceptAppRow(live.acceptApp, now, appWaits) }),
    ...(live.resident === undefined ? {} : { resident: residentOf(live.resident, now) }),
    ...(boardProblem === undefined ? {} : { boardProblem: { text: boardProblem, ...(live.prdPath === null ? {} : { prd: live.prdPath }) } }),
    ...(boardFile === undefined ? {} : { boardFile }),
    items: [...items, ...designItems, ...taskItems],
    threads: threadsOf(live, factsOf(board, knownRequirements(requirements, baselineOf(board)), [...items, ...designItems, ...taskItems], memories), prefixes, now),
    ...(prefixes.feature === 'PRD-' && prefixes.testCase === 'TC-' ? {} : { idPrefixes: prefixes }),
    memories: [...memories]
      .sort((a, b) => Number(a.supersededBy !== undefined) - Number(b.supersededBy !== undefined) || b.t - a.t)
      .slice(0, MEMORY_ROWS)
      .map(memoryRow),
    ...(memories.length > MEMORY_ROWS ? { memoryTotal: memories.length } : {}),
    pinned: pinnedRows(memories),
    carrying: crewRoles
      .map(r => {
        const ids = live.roles[r as 'pm' | 'qa' | 'uiux' | 'techlead' | 'fullstack'].given ?? []
        const known = memories.filter(m => ids.includes(m.id))
        return { role: r, ids, tokens: known.reduce((n, m) => n + estimateTokens(m.text), 0) }
      })
      .filter(c => c.ids.length > 0),
    usage: [...withCodex, ...onlyCodex],
    tiers,
    ...(codexToday === 0 ? {} : { codexToday }),
    brainShare: today + brain === 0 ? 0 : brain / (today + brain),
    // What crew told the brain in the last hour, or before and not taken yet, and what the brain did about usage.
    alerts: (live.alerts ?? []).filter(a => now - a.at < HOUR || (live.brainDoneAt ?? 0) < a.at).map(a => ({ text: a.text, at: clockOf(a.at) })),
    actions: (live.tunings ?? []).map(t => ({
      id: t.id,
      text: t.text,
      before: t.before,
      ...(t.pending === true ? { pending: t.id } : sinceOf(live, t)),
    })),
    injected: { count: live.injected.count, average: live.injected.count === 0 ? 0 : Math.round(live.injected.tokens / live.injected.count) },
    chores: total(live.usage.memory),
    ...(board === null || prd === undefined
      ? {}
      : {
          ...(requirements === undefined ? {} : { requirements: requirementRows(board, requirements) }),
          alignment: {
            covered: g0?.covered ?? 0,
            total: g0?.total ?? 0,
            gaps: g0?.gaps.length ?? 0,
            added: live.signals.added,
            removed: live.signals.removed,
            prdChanged: live.signals.prdChangedAt > 0 ? ageOf(live.signals.prdChangedAt, now) : '—',
            checked: live.signals.checkedAt > 0 ? ageOf(live.signals.checkedAt, now) : '—',
            ...(prd.problem === undefined ? {} : { problem: prd.problem }),
          },
        }),
  }
}
