import type { CrewLive, CrewUsage } from '../types'
import { criteriaOf, gateG1, gateG4 } from './board'
import type { GateResult, Tracker } from './board'
import { ROLE_NAMES } from './model'
import type { Feature, Gate, Item, RoleId, RoleRow, Snapshot, Stage, Tier, UsageRow } from './model'

/** A team that has not started. */
export const emptyLive = (): CrewLive => ({
  prdPath: null,
  flow: { stage: 'idle', round: 0, retries: 0 },
  roles: {
    pm: { state: 'idle', doing: '—', context: 0 },
    qa: { state: 'idle', doing: '—', context: 0 },
  },
  agents: {},
  usage: {},
  tiers: {},
  threads: {},
  questions: [],
  activity: [],
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

/** Everything the pane draws, from the board on disk and the team this session runs. */
export const snapshotOf = ({ board, live, now }: { board: Tracker | null; live: CrewLive; now: number }): Snapshot => {
  const g1 = board === null ? { covered: 0, total: 0, gaps: [] } : gateG1(board)
  const g4 = board === null ? { covered: 0, total: 0, gaps: [] } : gateG4(board)
  const stage = live.flow.stage
  const testing = TESTING.includes(stage)

  const linked = new Set(board === null ? [] : board.prd_items.flatMap(i => i.test_cases.flatMap(c => c.acceptance_criteria ?? [])))
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
          done: g1.covered + g4.covered,
          total: g1.total + g4.total,
          stages: [
            stageOf('拆解', g1, stage === 'splitting'),
            pendingStage('設計'),
            pendingStage('架構'),
            pendingStage('實作'),
            stageOf('測試', g4, testing),
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
    if (id !== 'pm' && id !== 'qa') return { id, state: 'idle', doing: LATER, context: 0, limit: 60_000, today: 0 }
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

  const titles = new Map<string, string>()
  for (const item of board?.prd_items ?? []) {
    titles.set(item.id, item.title)
    for (const c of criteriaOf(item)) titles.set(c.id, c.text)
  }

  const crewRoles: RoleId[] = ['pm', 'qa']
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
            gate('G1', g1, stage === 'splitting', { name: '每個功能都有驗收條件', fill: 'PM 補', confirm: 'PM 自查' }, live.threads),
            later('G2', '每個有介面的功能都有畫面和各種狀態'),
            later('G3', '每個功能都拆好 task'),
            gate('G4', g4, stage === 'writing_tests' || stage === 'adding_tests', { name: '每條驗收條件都有 test case', fill: 'QA 補', confirm: 'PM 確認缺口' }, live.threads),
            later('G5', '每個完成的 task 都通過 code review'),
            later('G6', 'test case 全部執行通過、附證據'),
          ],
    decisions: live.questions.filter(q => q.status === 'open').map(q => ({ id: q.id, question: q.question, from: q.from, age: ageOf(q.t, now) })),
    items,
    threads: Object.entries(live.threads).map(([item, messages]) => ({
      item,
      title: titles.get(item) ?? item,
      messages: messages.map(m => ({
        from: m.from === 'crew' || m.to === undefined ? name(m.from) : `${name(m.from)} → ${name(m.to)}`,
        text: m.text,
        ...(m.kind !== undefined ? { kind: m.kind } : {}),
      })),
    })),
    memories: [],
    carrying: [],
    usage,
    tiers,
    brainShare: today + brain === 0 ? 0 : brain / (today + brain),
    alerts: [],
    actions: [],
  }
}
