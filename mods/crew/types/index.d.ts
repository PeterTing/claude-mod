/** The pane's tabs. */
export type CrewTab = 'overview' | 'progress' | 'board' | 'threads' | 'memory' | 'tokens'

/** The sample situation the design preview shows. */
export type CrewScenario = 'normal' | 'empty' | 'attention'

export type CrewTier = 'S' | 'M' | 'L' | 'XL'

/** A role crew runs, as this session knows it. */
export type CrewLiveRole = {
  agentId?: string
  model?: string
  label?: string
  effort?: string
  tier?: CrewTier
  limit?: number
  state: 'idle' | 'working' | 'waiting' | 'rotating' | 'blocked'
  doing: string
  /** Tokens in its context at its last request. */
  context: number
  /** The work it was last given. */
  task?: string
  /** What it said at the end of its last run. */
  report?: string
  /** Memories its current agent has been given or saved, so a wake adds only new ones. */
  given?: string[]
  /** The person asked for a fresh context at its next wake. */
  rotate?: boolean
}

export type CrewUsage = { input: number; output: number; cacheRead: number; cacheWrite: number; wakes: number; rotations: number }

/** `n` numbers messages in the order they were posted; a role has read up to the number it was woken at. */
export type CrewMessage = { t: number; n?: number; item: string; from: string; to?: string; text: string; kind?: 'message' | 'route' | 'memory' }

export type CrewQuestion = {
  id: string
  question: string
  item?: string
  from: 'pm' | 'qa' | 'crew'
  status: 'open' | 'answered'
  answer?: string
  t: number
}

export type CrewActivity = { t: number; day: string; role: string; id: string; title: string }

export type CrewFlow = {
  stage: 'idle' | 'splitting' | 'writing_tests' | 'confirming' | 'adding_tests' | 'done' | 'escalated'
  round: number
  retries: number
  resumeAt?: 'splitting' | 'confirming'
}

/** Everything crew keeps for a running team in this session. */
export type CrewLive = {
  prdPath: string | null
  flow: CrewFlow
  roles: { pm: CrewLiveRole; qa: CrewLiveRole }
  /** Agent id → role, for every agent crew started. */
  agents: Record<string, 'pm' | 'qa'>
  /** Token use by role, `brain` being the main conversation. */
  usage: Record<string, CrewUsage>
  /** Tokens by the tier of the task that spent them. */
  tiers: Record<string, number>
  threads: Record<string, CrewMessage[]>
  /** The number of the last message posted. */
  posted: number
  /** The last message number each role was woken after: later messages to it are unread. */
  seen: Record<string, number>
  questions: CrewQuestion[]
  activity: CrewActivity[]
  /** Role → the ASK thread of the question it is answering, and who asked: the person, or the brain for them. */
  asks: Record<string, { id: string; by: 'person' | 'brain' }>
  /** Who started the PRD under way: work the brain started reports back to it. */
  lead: 'person' | 'brain'
  /** How many questions the person has asked the roles directly. */
  asked: number
  /** Memories attached to starts and wakes: how many times, how many tokens in all. */
  injected: { count: number; tokens: number }
  /** Agents a reset let go: their notices are still crew's to take, their writes are refused. */
  retired: string[]
  /** The day `usage` and `tiers` count. */
  usageDay: string
}

declare module 'claude-code' {
  interface PluginState {
    crew: {
      /** `/crew demo` is showing the design preview. */
      isDemo: boolean
      /** The tab the pane shows. */
      tab: CrewTab
      /** The sample situation the preview shows. */
      scenario: CrewScenario
      /** The item whose thread the Threads tab has open, if any. */
      thread: string | null
      /** The gate whose detail the overview has open, if any. */
      gate: string | null
      /** The running team. */
      live: CrewLive
    }
  }
}
