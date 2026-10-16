import type { CrewLive, CrewUsage } from '../types'
import { criteriaOf, gateG1, gateG3, gateG4, tasksOf } from './board'
import type { GateResult, Tracker } from './board'
import { estimateTokens } from './memory'
import type { MemoryEntry } from './memory'
import { droppedRequirements, gateG0, refsOf } from './prd'
import type { Requirement } from './prd'
import { ROLE_NAMES } from './model'
import type { Feature, Gate, Item, RequirementRow, RoleId, RoleRow, Snapshot, Stage, StageCell, Tier, UsageRow } from './model'

/** A team that has not started. */
export const emptyLive = (): CrewLive => ({
  prdPath: null,
  flow: { stage: 'idle', round: 0, retries: 0 },
  roles: {
    pm: { state: 'idle', doing: '—', context: 0 },
    qa: { state: 'idle', doing: '—', context: 0 },
    techlead: { state: 'idle', doing: '—', context: 0 },
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

const LATER = '第 4 階段加入'

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

const later = (id: string, name: string): Gate => ({
  id,
  state: 'pending',
  name,
  fill: '—',
  confirm: '—',
  covered: 0,
  total: 0,
  gaps: [],
  note: LATER,
  checked: '—',
})

const stageOf = (label: string, r: GateResult, active: boolean): Stage => ({
  label,
  done: r.covered,
  total: r.total,
  state: r.total > 0 && r.gaps.length === 0 ? 'done' : active ? 'active' : 'pending',
})

const pendingStage = (label: string): Stage => ({ label, done: 0, total: 0, state: 'pending' })

const name = (who: string): string => (who === 'crew' ? 'crew' : (ROLE_NAMES[who as RoleId] ?? who))

const MEMORY_ROWS = 40

const NOT_YET: StageCell = { state: 'later' }

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
    const out = answering.length === 0 ? dropped.get(r.id) : undefined
    return {
      id: r.id,
      text: r.text,
      features: answering.map(f => f.id),
      ...(out === undefined ? {} : { dropped: out }),
      layers: {
        spec: { state: spec },
        design: NOT_YET,
        cases: { state: cases === 'done' && spec !== 'done' ? 'doing' : cases, note: `${tested}/${criteria.length}` },
        tasks: { state: tasks === 'done' && spec !== 'done' ? 'doing' : tasks, note: `${withTask}/${criteria.length}` },
        code: NOT_YET,
        review: NOT_YET,
        runs: NOT_YET,
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
  const stage = live.flow.stage
  const testing = TESTING.includes(stage)

  const linked = board === null ? new Set<string>() : coveredCriteria(board)
  // The split is done once every feature has criteria and the board answers the PRD.
  const split: GateResult = g0 === undefined ? g1 : { covered: g1.covered + g0.covered, total: g1.total + g0.total, gaps: [...g1.gaps, ...g0.gaps] }
  const features: Feature[] = (board?.prd_items ?? []).map(item => {
    const criteria = criteriaOf(item)
    const covered = criteria.filter(c => linked.has(c.id)).length
    const percent = criteria.length === 0 ? 0 : Math.round((covered / criteria.length) * 100)
    return {
      id: item.id,
      title: item.title,
      percent,
      layers: { design: 'todo', frontend: 'todo', backend: 'todo', test: percent === 100 ? 'done' : covered > 0 ? 'doing' : 'todo' },
      ...(item.crew_dropped !== undefined ? { dropped: item.crew_dropped } : {}),
    }
  })

  const days = Array.from({ length: 5 }, (_, i) => dayOf(now - (4 - i) * DAY))
  const progress =
    board === null
      ? null
      : {
          done: (g0?.requirements.covered ?? 0) + g1.covered + g4.covered + g3.covered,
          total: (g0?.requirements.total ?? 0) + g1.total + g4.total + g3.total,
          stages: [
            stageOf('拆解', split, stage === 'splitting'),
            pendingStage('設計'),
            // The plan is done only once the split is, as testing is.
            { ...stageOf('架構', g3, stage === 'planning'), ...(split.gaps.length > 0 && g3.total > 0 && g3.gaps.length === 0 ? { state: stage === 'planning' ? ('active' as const) : ('pending' as const) } : {}) },
            pendingStage('實作'),
            // Testing is done only once the split is: a requirement still without features has nothing tested yet.
            { ...stageOf('測試', g4, testing), ...(split.gaps.length > 0 && g4.total > 0 && g4.gaps.length === 0 ? { state: testing ? ('active' as const) : ('pending' as const) } : {}) },
            pendingStage('驗收'),
          ],
          features,
          daily: days.map(d => ({ day: d.slice(5).replace('-', '/'), done: live.activity.filter(a => a.day === d).length })),
          recent: [...live.activity]
            .sort((a, b) => b.t - a.t)
            .slice(0, 3)
            .map(a => ({ id: a.id, title: a.title, role: a.role as RoleId, age: ageOf(a.t, now) })),
        }

  const roleRow = (id: RoleId): RoleRow => {
    if (id !== 'pm' && id !== 'qa' && id !== 'techlead') return { id, state: 'idle', doing: LATER, context: 0, limit: 60_000, today: 0 }
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
  // The tech lead's tasks: not started until the code that does them lands (phase 4c).
  const tl = live.roles.techlead
  const taskItems: Item[] = (board?.prd_items ?? [])
    .filter(i => i.crew_dropped === undefined)
    .flatMap(item => tasksOf(item).filter(x => x.crew_dropped === undefined))
    .map(x => ({
      id: x.id,
      title: x.title,
      owner: 'techlead',
      status: 'todo',
      route: { tier: tl.tier ?? 'M', model: tl.label ?? 'Opus', effort: tl.effort ?? 'high' },
      note: `對應 ${x.acceptance_criteria.join('、')}${x.size === undefined ? '' : `・${x.size}`}`,
    }))

  const titles = new Map<string, string>()
  for (const item of board?.prd_items ?? []) {
    titles.set(item.id, item.title)
    for (const c of criteriaOf(item)) titles.set(c.id, c.text)
    for (const x of tasksOf(item)) titles.set(x.id, x.title)
  }

  const crewRoles: RoleId[] = ['pm', 'qa', 'techlead']
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
    prd: board === null ? null : { id: board.project, title: live.prdPath ?? 'prd-tracker.json', progress: progress === null || progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100) },
    progress,
    today,
    roles: (['pm', 'uiux', 'fullstack', 'qa', 'techlead'] as const).map(roleRow),
    gates:
      board === null
        ? []
        : [
            ...(g0 === undefined ? [] : [gate('G0', g0, stage === 'splitting', { name: 'PRD 每條需求都有對應的功能', fill: 'PM 補', confirm: 'crew 對照 PRD 檔案' }, live.threads)]),
            gate('G1', g1, stage === 'splitting', { name: '每個功能都有驗收條件', fill: 'PM 補', confirm: 'PM 自查' }, live.threads),
            later('G2', '每個有介面的功能都有畫面和各種狀態'),
            gate('G3', g3, stage === 'planning', { name: '每條驗收條件都拆好任務', fill: 'Tech lead 補', confirm: 'Tech lead 自查' }, live.threads),
            gate('G4', g4, stage === 'writing_tests' || stage === 'adding_tests', { name: '每條驗收條件都有 test case', fill: 'QA 補', confirm: 'PM 確認缺口' }, live.threads),
            later('G5', '每個完成的 task 都通過 code review'),
            later('G6', 'test case 全部執行通過、附證據'),
          ],
    decisions: live.questions.filter(q => q.status === 'open').map(q => ({ id: q.id, question: q.question, from: q.from, age: ageOf(q.t, now) })),
    items: [...items, ...taskItems],
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
        const ids = live.roles[r as 'pm' | 'qa' | 'techlead'].given ?? []
        const known = memories.filter(m => ids.includes(m.id))
        return { role: r, ids, tokens: known.reduce((n, m) => n + estimateTokens(m.text), 0) }
      })
      .filter(c => c.ids.length > 0),
    usage,
    tiers,
    brainShare: today + brain === 0 ? 0 : brain / (today + brain),
    alerts: [],
    actions: [],
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
