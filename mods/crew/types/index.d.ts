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
  /** Whom its current or last run was for: the flow's work, or the person (a question, an answer). */
  run?: 'flow' | 'person'
}

export type CrewUsage = { input: number; output: number; cacheRead: number; cacheWrite: number; wakes: number; rotations: number }

/** `n` numbers messages in the order they were posted; a role has read up to the number it was woken at. */
export type CrewMessage = { t: number; n?: number; item: string; from: string; to?: string; text: string; kind?: 'message' | 'route' | 'memory' }

export type CrewQuestion = {
  id: string
  question: string
  item?: string
  /** Who asked: a role, the flow itself (`crew`), or the main conversation (`brain`). */
  from: 'pm' | 'qa' | 'techlead' | 'fullstack' | 'crew' | 'brain'
  status: 'open' | 'answered'
  answer?: string
  t: number
}

export type CrewActivity = { t: number; day: string; role: string; id: string; title: string }

export type CrewFlow = {
  stage: 'idle' | 'splitting' | 'writing_tests' | 'confirming' | 'adding_tests' | 'planning' | 'building' | 'done' | 'escalated'
  round: number
  retries: number
  /** Times the PM was sent back because the board did not answer the PRD (G0). */
  aligning?: number
  /** The PRD change the PM was last told about. */
  synced?: string
  /** The PM synced while QA was at work: the flow waits for QA's run to end. */
  awaitingQa?: boolean
  resumeAt?: 'splitting' | 'confirming' | 'planning' | 'building'
  /** The task the full-stack is building. */
  building?: string
}

/** Work the flow gave a role while it was busy answering the person: handed over when that turn ends. */
export type CrewWork = {
  kind: 'spawn' | 'message'
  route: { tier: CrewTier; model: string; label: string; effort: string; limit: number }
  text: string
  item?: string
  run?: 'flow' | 'person'
}

/** Everything crew keeps for a running team in this session. */
export type CrewLive = {
  prdPath: string | null
  flow: CrewFlow
  roles: { pm: CrewLiveRole; qa: CrewLiveRole; techlead: CrewLiveRole; fullstack: CrewLiveRole }
  /** Agent id → role, for every agent crew started. */
  agents: Record<string, 'pm' | 'qa' | 'techlead' | 'fullstack'>
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
  /** Role → work waiting for its current turn to end. */
  pending: Record<string, CrewWork[]>
  /** What crew last saw of the PRD and the board, checked every few seconds: the board is held to the PRD as it stands. */
  signals: CrewSignals
}

export type CrewSignals = {
  /** The PRD file's version (time and size) crew last took in; '' before the first look. */
  prdVersion: string
  /** The board file's version at the last look: a board change brings the next look on. */
  boardVersion: string
  /** A PRD version that removed requirements, waiting for a later look to confirm it; '' with none. */
  doubt: string
  /** When that version was first seen. */
  doubtAt: number
  /** When the PRD file was last modified, as of the last look; 0 before the first. */
  prdChangedAt: number
  /** When crew last looked. */
  checkedAt: number
  /** Requirements the PRD added and removed that the board has not caught up with. */
  added: number
  removed: number
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
