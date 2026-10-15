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

export type Gate = { id: string; state: GateState; detail?: string }

export type Decision = { id: string; question: string; from: RoleId; age: string }

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

/** Everything the panes draw, at one moment. */
export type Snapshot = {
  prd: { id: string; title: string; progress: number } | null
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
}

/** 41200 → "41K", 950 → "950". */
export const tokens = (n: number): string => (n >= 1000 ? `${Math.round(n / 1000)}K` : String(n))

/** The share of input read from the prompt cache, as a whole percent. */
export const hitRate = (u: UsageRow): number => {
  const all = u.input + u.cacheRead + u.cacheWrite
  return all === 0 ? 0 : Math.round((u.cacheRead / all) * 100)
}
