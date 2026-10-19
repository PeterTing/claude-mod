/** The five roles of the team. The brain is the person's main conversation. */
export type RoleId = 'pm' | 'uiux' | 'fullstack' | 'qa' | 'techlead'

export const ROLE_NAMES: Record<RoleId, string> = {
  pm: 'PM',
  uiux: 'UI/UX',
  fullstack: '全端',
  qa: 'QA',
  techlead: 'Tech lead',
}

/** How hard an item is, which picks the model and effort it runs on. */
export type Tier = 'S' | 'M' | 'L' | 'XL'

export type Route = { tier: Tier; model: string; effort: string }

export type RoleState = 'idle' | 'working' | 'waiting' | 'rotating' | 'blocked'

export const ROLE_STATE_NAMES: Record<RoleState, string> = {
  idle: '待命',
  working: '進行中',
  waiting: '等待',
  rotating: '輪替中',
  blocked: '卡住',
}

export type RoleRow = {
  id: RoleId
  state: RoleState
  /** What it is on now, or what it waits for. */
  doing: string
  route?: Route
  /** Tokens in its context now, and the threshold that rotates it. */
  context: number
  limit: number
  /** Tokens it used today. */
  today: number
}

export type ItemStatus = 'doing' | 'review' | 'todo' | 'blocked' | 'done'

export const ITEM_STATUS_NAMES: Record<ItemStatus, string> = {
  doing: '進行中',
  review: '待確認',
  todo: '待開始',
  blocked: '卡住',
  done: '已完成',
}

export type Item = {
  id: string
  title: string
  owner: RoleId
  status: ItemStatus
  route: Route
  note?: string
}

export type GateState = 'pass' | 'gap' | 'active' | 'pending'

/** Something a gate still misses: an item, and where it stands. */
export type Gap = { id: string; title: string; status: string; thread?: string }

/**
 * A check computed from prd-tracker.json in code (no tokens): what it
 * checks, who fills a gap and who confirms, how much is covered, the gaps.
 */
export type Gate = {
  id: string
  state: GateState
  /** The short text beside the id on the overview. */
  detail?: string
  name: string
  fill: string
  confirm: string
  covered: number
  total: number
  gaps: readonly Gap[]
  /** Said instead of a gap list, when there is one thing to say. */
  note?: string
  checked: string
}

/** A question waiting for the person, from a role or from crew itself. */
export type Decision = { id: string; question: string; from: RoleId | 'crew' | 'brain'; age: string }

export type Message = { from: string; text: string; kind?: 'message' | 'memory' | 'route' }

export type Thread = { item: string; title: string; messages: readonly Message[] }

export type MemoryType = 'DEC' | 'MEM' | 'LES' | 'PREF'

export const MEMORY_TYPE_NAMES: Record<MemoryType, string> = {
  DEC: '決定',
  MEM: '事實',
  LES: '教訓',
  PREF: '偏好',
}

export type Memory = {
  id: string
  type: MemoryType
  text: string
  source: string
  refs: readonly string[]
  supersededBy?: string
}

export type Carrying = { role: RoleId; ids: readonly string[]; tokens: number }

export type UsageRow = {
  role: RoleId
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  wakes: number
  rotations: number
}

export type StageState = 'done' | 'active' | 'pending'

/** One step of the product flow, counted in board items. */
export type Stage = { label: string; done: number; total: number; state: StageState }

export type LayerState = 'done' | 'doing' | 'todo'

/** One stage of a requirement's development: `stale`, done once but out of date (a review before newer commits, from phase 4); `later`, a stage crew does not track yet. */
export type StageCell = { state: LayerState | 'stale' | 'later'; note?: string }

/** A PRD requirement and how far each stage of its development is, from the board and the repo. */
export type RequirementRow = {
  id: string
  text: string
  /** The features in scope that answer it. */
  features: readonly string[]
  /** Why it was moved out of scope, when it was. */
  dropped?: string
  /** Spec (criteria), design, test cases written, tasks, code, review, and test runs, in the order the work goes. */
  layers: Readonly<Record<'spec' | 'design' | 'cases' | 'tasks' | 'code' | 'review' | 'runs', StageCell>>
}

/** One feature of the PRD (a prd_items entry) and how far each layer of it is. */
export type Feature = {
  id: string
  title: string
  percent: number
  layers: Readonly<Record<'design' | 'frontend' | 'backend' | 'test', LayerState>>
  /** Why it left the plan, when it did. */
  dropped?: string
}

export type Progress = {
  done: number
  total: number
  stages: readonly Stage[]
  features: readonly Feature[]
  /** Items finished per day, oldest first; the last one is today. */
  daily: readonly { day: string; done: number }[]
  recent: readonly { id: string; title: string; role: RoleId; age: string }[]
}

/** Everything the panes draw, at one moment. */
export type Snapshot = {
  prd: { id: string; title: string; progress: number } | null
  progress: Progress | null
  today: number
  roles: readonly RoleRow[]
  gates: readonly Gate[]
  decisions: readonly Decision[]
  items: readonly Item[]
  threads: readonly Thread[]
  memories: readonly Memory[]
  carrying: readonly Carrying[]
  usage: readonly UsageRow[]
  tiers: readonly { tier: Tier; tokens: number }[]
  /** The brain's share of today's tokens, 0 to 1. */
  brainShare: number
  alerts: readonly string[]
  actions: readonly string[]
  /** Memories attached to starts and wakes: how many times, and their average size. */
  injected?: { count: number; average: number }
  /** The PRD's requirements, each with how far its development is. */
  requirements?: readonly RequirementRow[]
  /** How the board stands against the PRD as it is now, and when crew last looked. */
  alignment?: {
    covered: number
    total: number
    gaps: number
    added: number
    removed: number
    prdChanged: string
    checked: string
    /** Why crew cannot read the PRD now; the board is then held to the requirements it last answered. */
    problem?: string
  }
  /** Tokens the small model spent tidying memory today. */
  chores?: number
}

/** 41200 → "41K", 950 → "950". */
/** A whole percentage, rounded down: it reads 100 only once everything is done. */
export const percent = (done: number, total: number): number => (total === 0 ? 0 : Math.floor((done / total) * 100))

/** How many of a bar's `width` cells a percentage fills, rounded down: the last cell fills only at 100. */
export const barCells = (pct: number, width: number): number => Math.floor((Math.max(0, Math.min(100, pct)) / 100) * width)

export const tokens = (n: number): string => (n >= 1000 ? `${Math.round(n / 1000)}K` : String(n))

/** The share of input read from the prompt cache, as a whole percent. */
export const hitRate = (u: UsageRow): number => {
  const all = u.input + u.cacheRead + u.cacheWrite
  return all === 0 ? 0 : Math.round((u.cacheRead / all) * 100)
}
