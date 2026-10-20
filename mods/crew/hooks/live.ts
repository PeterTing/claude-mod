import type { CrewLive, CrewUsage } from '../types'
import { approvedNow, criteriaOf, decisionOf, designsOf, gateG1, gateG2, gateG3, gateG4, gateG5, gateG6, liveCasesOf, liveDesignsOf, liveTasksOf, passedNow, resultOf, reviewOf, tasksOf, tipOf } from './board'
import type { GateResult, PrdItem, Task, TestCase, Tracker } from './board'
import { estimateTokens } from './memory'
import type { MemoryEntry } from './memory'
import { droppedRequirements, gateG0, refsOf } from './prd'
import type { Requirement } from './prd'
import { hitRate, percent, ROLE_NAMES } from './model'
import type { Feature, Gate, Item, RequirementRow, RoleId, RoleRow, Snapshot, Stage, StageCell, Tier, UsageRow } from './model'

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
  escalated: '等你決定',
}

/** Where a held flow stopped, in a sentence: the PRD, the stage, and who was on what. */
const stoppedAt = (live: CrewLive): string => {
  const f = live.flow
  const on = f.stage === 'building' && f.building !== undefined ? `（全端 ${f.building}）` : f.stage === 'reviewing' && f.reviewing !== undefined ? `（Tech lead ${f.reviewing.task}）` : ''
  return `上次的 ${live.prdPath ?? ''} 停在「${STAGE_OF[f.stage] ?? f.stage}」${on}`
}

/** A held flow, in a sentence that says what the person can do. */
const heldText = (live: CrewLive): string => {
  if (live.paused === 'stalled') return `${stoppedAt(live).replace(/^上次的 \S+ 停在/, '流程停在')}，叫醒過一次還是停住。要再試一次嗎？`
  return live.paused === 'person' ? `${stoppedAt(live)}，暫停中。` : `${stoppedAt(live)}。要接續嗎？`
}

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

/** The least a day, or a role's own use, must be before a share or a hit rate says anything. */
const SIGNIFICANT = 50_000

/** A role's name joined to what follows: `全端今日佔`, `Tech lead 今日佔`. */
export const said = (role: RoleId, rest: string): string => (/[A-Za-z]$/.test(ROLE_NAMES[role]) ? `${ROLE_NAMES[role]} ${rest}` : `${ROLE_NAMES[role]}${rest}`)

/**
 * What crew tells the brain about usage, worked out in code: a role over 40%
 * of the day, a role reading under 60% from the cache, a role past its context
 * threshold, two roles going back and forth on one item more than six times.
 * Each with its key, told at most once an hour.
 */
export const usageSignals = (live: CrewLive): { key: string; text: string }[] => {
  const out: { key: string; text: string }[] = []
  const all = Object.values(live.usage).reduce((n, u) => n + spentOf(u), 0)
  for (const role of ['pm', 'uiux', 'fullstack', 'qa', 'techlead'] as const) {
    const u = live.usage[role]
    const spent = spentOf(u)
    if (all >= SIGNIFICANT && spent / all > 0.4) out.push({ key: `share:${role}`, text: said(role, `今日佔 ${Math.round((spent / all) * 100)}%（超過 40%）`) })
    const rate = u === undefined ? 100 : hitRate({ role, ...u })
    if (spent >= SIGNIFICANT && rate < 60) out.push({ key: `hit:${role}`, text: said(role, `快取命中率 ${rate}%（低於 60%）`) })
    const r = live.roles[role]
    const limit = live.tuned?.[role]?.limit ?? r.limit
    if (limit !== undefined && r.context > limit) out.push({ key: `context:${role}`, text: said(role, `的 context ${Math.round(r.context / 1000)}K 超過門檻 ${Math.round(limit / 1000)}K`) })
  }
  for (const [item, messages] of Object.entries(live.threads)) {
    // The latest run of messages two senders passed back and forth, newest first.
    const from = messages.filter(m => m.kind === undefined || m.kind === 'message').map(m => m.from)
    const [a, b] = [from.at(-1), from.at(-2)]
    if (a === undefined || b === undefined || a === b) continue
    let n = 2
    while (from[from.length - 1 - n] === (n % 2 === 0 ? a : b)) n += 1
    if (n > 6) out.push({ key: `pingpong:${item}`, text: `${b} 和 ${a} 在 ${item} 來回 ${n} 次（超過 6 次）` })
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
    gaps: result.gaps.map(g => ({ id: g.id, title: g.title, status: '還沒有覆蓋', ...(threads[g.id] !== undefined ? { thread: g.id } : {}) })),
    checked: '即時',
  }
}

const stageOf = (label: string, r: GateResult, active: boolean): Stage => ({
  label,
  done: r.covered,
  total: r.total,
  state: r.total > 0 && r.gaps.length === 0 ? 'done' : active ? 'active' : 'pending',
})

const name = (who: string): string => (who === 'crew' ? 'crew' : (ROLE_NAMES[who as RoleId] ?? who))

const MEMORY_ROWS = 40

/** Where a task's code stands with the tech lead: under review, approved, changes asked for, out of date, or waiting. */
const reviewNote = (x: Task, flow: CrewLive['flow']): string | undefined => {
  const tip = tipOf(x)
  if (tip === undefined) return undefined
  if (flow.stage === 'reviewing' && flow.reviewing?.task === x.id) return 'Tech lead 正在 review'
  const r = reviewOf(x)
  if (r === undefined) return '等 review'
  if (r.sha !== tip) return 'review 過期（新的 commit 還沒 review）'
  return r.verdict === 'approve' ? 'review 通過' : `review 要修改${r.notes === undefined ? '' : `：${r.notes}`}`
}

/** Why a task is not yet through G5, said as where it stands. */
const reviewGap = (x: Task, flow: CrewLive['flow']): string => {
  const tip = tipOf(x)
  if (tip === undefined) return '還沒有 commit'
  if (flow.stage === 'reviewing' && flow.reviewing?.task === x.id) return 'Tech lead 正在 review'
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

/** Why a test case is not yet through G6: not run, failed (with its evidence), or out of date. */
const runGap = (tc: TestCase): string => {
  const r = resultOf(tc)
  if (r === undefined) return '還沒跑'
  if (r.stale === true) return '結果過期（之後又有 commit）'
  return `失敗（.crew/runs/${r.run}.log）`
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
    const passed = runCases.filter(passedNow).length
    const out = answering.length === 0 ? dropped.get(r.id) : undefined
    return {
      id: r.id,
      text: r.text,
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
export const snapshotOf = ({
  board,
  live,
  now,
  memories = [],
  prd,
}: {
  board: Tracker | null
  live: CrewLive
  now: number
  memories?: readonly MemoryEntry[]
  /** The PRD as crew can read it now; absent (no PRD started), G0 is not shown. */
  prd?: { requirements?: readonly Requirement[]; problem?: string } | undefined
}): Snapshot => {
  const requirements = prd?.requirements
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
  const stage = live.flow.stage
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
      ...(item.crew_dropped !== undefined ? { dropped: item.crew_dropped } : {}),
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
              ...stageOf('實作', built, stage === 'building'),
              ...(built.total > 0 && built.gaps.length === 0 && g5.gaps.length > 0 ? { state: stage === 'building' || stage === 'reviewing' ? ('active' as const) : ('pending' as const) } : {}),
            },
            stageOf('Review', g5, stage === 'reviewing'),
            stageOf('測試結果', g6, stage === 'testing'),
          ],
          features,
          daily: days.map(d => ({ day: d.slice(5).replace('-', '/'), done: live.activity.filter(a => a.day === d).length })),
          recent: [...live.activity]
            .sort((a, b) => b.t - a.t)
            .slice(0, 3)
            .map(a => ({ id: a.id, title: a.title, role: a.role as RoleId, age: ageOf(a.t, now) })),
        }

  const roleRow = (id: RoleId): RoleRow => {
    const r = live.roles[id]
    return {
      id,
      state: r.state,
      doing: r.doing,
      ...(r.tier !== undefined && r.label !== undefined && r.effort !== undefined ? { route: { tier: r.tier, model: r.label, effort: r.effort } } : {}),
      context: r.context,
      limit: r.limit ?? 60_000,
      today: total(live.usage[id]),
    }
  }

  // The designs: the designer's until the person decides; approved, done.
  const ux = live.roles.uiux
  const designItems: Item[] = (board?.prd_items ?? [])
    .filter(i => i.crew_dropped === undefined)
    .flatMap(i =>
      designsOf(i)
        .filter(d => d.crew_dropped === undefined)
        .map(d => {
          const decision = decisionOf(d)
          return {
            id: d.id,
            title: d.title,
            owner: 'uiux' as const,
            status: decision === undefined ? ('review' as const) : decision.verdict === 'approved' ? ('done' as const) : ('doing' as const),
            route: { tier: ux.tier ?? 'S', model: ux.label ?? 'Sonnet', effort: ux.effort ?? 'medium' },
            note: `${i.id}・${d.kind === 'screen' ? '畫面' : '沒有畫面'} · ${decision === undefined ? '等你核准' : decision.verdict === 'approved' ? '你核准了' : `你退回了${decision.reason === undefined ? '' : `：${decision.reason}`}`}`,
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
        route: { tier: pm.tier ?? 'M', model: pm.label ?? 'Sonnet', effort: pm.effort ?? 'high' },
        note: `${covered}/${criteria.length} 條驗收條件有 test case`,
      }
    })
  // The tasks: the tech lead's until the full-stack takes one on; under way once a commit does it,
  // done only once review and test runs say so (later phases), never by a commit alone.
  const tl = live.roles.techlead
  const fs = live.roles.fullstack
  const taskItems: Item[] = liveTasks.map(x => {
    const commits = x.crew_commits ?? []
    const onIt = live.flow.stage === 'building' && live.flow.building === x.id
    const fixing = onIt && live.flow.fixing !== undefined
    const underReview = live.flow.stage === 'reviewing' && live.flow.reviewing?.task === x.id
    const taken = commits.length > 0 || onIt
    const owner = underReview || !taken ? 'techlead' : 'fullstack'
    const by = owner === 'fullstack' ? fs : tl
    const review = reviewNote(x, live.flow)
    return {
      id: x.id,
      title: x.title,
      owner,
      status: approvedNow(x) ? 'done' : underReview ? 'review' : taken ? 'doing' : 'todo',
      route: { tier: by.tier ?? x.size ?? 'M', model: by.label ?? (owner === 'fullstack' ? 'Sonnet' : 'Opus'), effort: by.effort ?? 'high' },
      note: [
        `對應 ${x.acceptance_criteria.join('、')}${x.size === undefined ? '' : `・${x.size}`}`,
        ...(commits.length > 0 ? [`commit ${commits.map(c => c.slice(0, 7)).join('、')}`] : []),
        ...(review === undefined ? [] : [review]),
        ...(fixing ? ['全端正在改'] : onIt ? ['全端正在做'] : []),
      ].join(' · '),
    }
  })

  const titles = new Map<string, string>()
  for (const item of board?.prd_items ?? []) {
    titles.set(item.id, item.title)
    for (const c of criteriaOf(item)) titles.set(c.id, c.text)
    for (const x of tasksOf(item)) titles.set(x.id, x.title)
  }

  const crewRoles: RoleId[] = ['pm', 'qa', 'uiux', 'techlead', 'fullstack']
  const usage: UsageRow[] = crewRoles
    .filter(r => live.usage[r] !== undefined)
    .map(r => {
      const u = live.usage[r] as CrewUsage
      return { role: r, input: u.input, output: u.output, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite, wakes: u.wakes, rotations: u.rotations }
    })
  const today = crewRoles.reduce((n, r) => n + total(live.usage[r]), 0)
  const brain = total(live.usage.brain)
  const tiers = (['S', 'M', 'L', 'XL'] as const satisfies readonly Tier[])
    .filter(t => (live.tiers[t] ?? 0) > 0)
    .map(t => ({ tier: t, tokens: live.tiers[t] ?? 0 }))

  return {
    prd: board === null ? null : { id: board.project, title: live.prdPath ?? 'prd-tracker.json', progress: progress === null ? 0 : percent(progress.done, progress.total) },
    progress,
    today,
    roles: (['pm', 'uiux', 'fullstack', 'qa', 'techlead'] as const).map(roleRow),
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
              ...gate('G5', g5, stage === 'reviewing', { name: '每個完成的 task 都通過 code review', fill: '全端修', confirm: 'Tech lead review' }, live.threads),
              gaps: liveTasks.filter(x => !approvedNow(x)).map(x => ({ id: x.id, title: x.title, status: reviewGap(x, live.flow), ...(live.threads[x.id] !== undefined ? { thread: x.id } : {}) })),
            },
            {
              ...gate('G6', g6, stage === 'testing', { name: 'test case 全部執行通過、附證據', fill: '全端修', confirm: 'crew 跑你設定的測試指令' }, live.threads),
              gaps: cases.filter(c => !passedNow(c)).map(c => ({ id: c.id, title: c.title ?? c.id, status: runGap(c), ...(live.threads[c.id] !== undefined ? { thread: c.id } : {}) })),
            },
          ],
    decisions: live.questions
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
      })),
    ...(live.paused === undefined || live.prdPath === null ? {} : { start: { prds: [], resumable: heldText(live), ...(live.paused === 'offer' ? {} : { paused: true }) } }),
    ...(live.resident === undefined ? {} : { resident: residentOf(live.resident, now) }),
    items: [...items, ...designItems, ...taskItems],
    threads: Object.entries(live.threads).map(([item, messages]) => ({
      item,
      title: titles.get(item) ?? item,
      messages: messages.map(m => ({
        from: m.from === 'crew' || m.to === undefined ? name(m.from) : `${name(m.from)} → ${name(m.to)}`,
        text: m.text,
        ...(m.kind !== undefined ? { kind: m.kind } : {}),
      })),
    })),
    memories: [...memories]
      .sort((a, b) => Number(a.supersededBy !== undefined) - Number(b.supersededBy !== undefined) || b.t - a.t)
      .slice(0, MEMORY_ROWS)
      .map(m => ({ id: m.id, type: m.type, text: m.text, source: m.source, refs: m.refs, ...(m.supersededBy !== undefined ? { supersededBy: m.supersededBy } : {}) })),
    carrying: crewRoles
      .map(r => {
        const ids = live.roles[r as 'pm' | 'qa' | 'uiux' | 'techlead' | 'fullstack'].given ?? []
        const known = memories.filter(m => ids.includes(m.id))
        return { role: r, ids, tokens: known.reduce((n, m) => n + estimateTokens(m.text), 0) }
      })
      .filter(c => c.ids.length > 0),
    usage,
    tiers,
    brainShare: today + brain === 0 ? 0 : brain / (today + brain),
    // What crew told the brain in the last hour, and what the brain did about usage.
    alerts: (live.alerts ?? []).filter(a => now - a.at < HOUR).map(a => ({ text: a.text, at: clockOf(a.at) })),
    actions: (live.tunings ?? []).map(t => ({
      id: t.id,
      text: t.text,
      before: t.before,
      ...(t.pending === true ? { pending: t.id } : (live.usage[t.role]?.wakes ?? 0) > t.wakes ? { after: metricsOf(live, t.role) } : {}),
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
