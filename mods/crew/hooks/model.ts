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

/** What runs a role: Claude through the Agent tool, or Codex through its own CLI. */
export type Engine = 'claude' | 'codex'

export const ENGINE_NAMES: Record<Engine, string> = { claude: 'Claude', codex: 'Codex' }

/** What a role on auto is doing once the person told it to wait for Codex: how crew and the pane know it waits for Codex and not for something else. */
export const CODEX_WAIT = '停著：等 Codex'

/** `engine` absent: Claude. */
export type Route = { tier: Tier; model: string; effort: string; engine?: Engine }

/** Whether Codex can run on this machine: its CLI found, how it is logged in, and when its quota comes back if it ran out. */
export type CodexStatus =
  | { state: 'ready'; login: 'chatgpt' | 'apikey'; version: string; checked: string; limited?: string }
  | { state: 'logged-out'; version: string; checked: string }
  | { state: 'missing'; checked: string }

/** A model and an effort on one engine: a role's floor there, or what it is fixed on. */
export type Pick = { model: string; effort: string }

/**
 * How a role picks its model. `auto`, crew's default: the brain picks the
 * engine, and each piece of work starts at that engine's floor and climbs with
 * its size, its risk and its failures. `fixed`: the person's engine and model,
 * always, with no climbing and no switch by the brain.
 */
export type RoleModels = {
  mode: 'auto' | 'fixed'
  floors: Readonly<Record<Engine, Pick>>
  fixed: Pick & { engine: Engine }
  /** The engine the role is on now; under `auto`, why the brain picked it. */
  now: Engine
  why?: string
  /** Under `auto`, the engine the person set the role on; Claude when none. */
  chose?: Engine
  /**
   * Tokens in context before the role is rotated: by the work's size, or a
   * number the person set. By the work's size, the brain may tune it, which
   * `tuned` says, with the decision it made; a number the person set it leaves.
   */
  limit: 'tier' | number
  tuned?: { limit: number; by: string }
}

/**
 * Each role's models; Codex as crew last found it, and the models it offers
 * here; and whether the brain asks the person before it moves a role to
 * another engine or model.
 */
export type Engines = { roles: Readonly<Record<RoleId, RoleModels>>; codex: CodexStatus; models: readonly string[]; askBeforeSwitch: boolean }

/**
 * A question on a role's model, asked apart from the others: Codex not logged
 * in, or out of quota, for a role fixed on it; a role fixed on a model that
 * keeps failing; or, when the person has it ask first, any move to another
 * engine, model or effort: the brain's, or a climb for harder work or a
 * failure. Its two answers.
 */
export type ModelAsk = { id: string; kind: 'login' | 'quota' | 'stuck' | 'switch' | 'climb'; role: RoleId; text: string; yes: string; no: string; from: 'crew' | 'brain'; age: string }

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
  /** Tokens it used today, on Claude and on Codex. */
  today: number
  /** Its agent runs on Codex, which tells no context size. */
  engine?: 'codex'
  /** The work it was last given, and what it said at the end of its last run, in full. */
  task?: string
  report?: string
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
  /** Why it is as hard as its tier says: the tech lead's word on it. */
  hard?: string
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

/**
 * A question waiting for the person, from a role or from crew itself: answered
 * in words, a design to approve or send back, or the brain's proposal to approve.
 */
/** `review`: the PRD's designs, decided on the review page the brain published, at `url` once it has; `inPane`, that they can be decided in the pane instead. */
export type Decision = { id: string; question: string; from: RoleId | 'crew' | 'brain'; age: string; kind?: 'design' | 'proposal' | 'review'; design?: string; url?: string; inPane?: true; options?: readonly string[]; count?: number }

/** What crew offers when it loads: the PRDs in the repo to start from, or the PRD it stopped on. */
export type Start = { prds: readonly { path: string; title: string }[]; chosen?: string; resumable?: string; paused?: boolean }

/**
 * A PRD the brain wrote with the person and has not started: the roles it
 * asked to review it, what each found, and whether it waits for the person.
 */
export type Draft = {
  path: string
  title: string
  requirements: number
  stage: 'reviewing' | 'confirm'
  reviews: readonly { role: RoleId; done: boolean; failed?: boolean; unsure?: boolean; found?: string }[]
  /** The brain's word on the reviews when it asks the person to confirm. */
  note?: string
  /** How many times the draft went to review. */
  sends?: number
  /** What the person asked to change on the decide page, while the brain changes it. */
  change?: string
  /** The decide page the draft is on, while the person decides there. */
  url?: string
}

/**
 * The brain taking this repo over from the person's first message, as the
 * person turned it on here; whether no PRD is under way (`idle`: a board may
 * still be there from one before); and the PRD it drafts.
 */
export type Takeover = { on: boolean; idle?: boolean; draft?: Draft }

/** crew's settings, set in the pane: the test command, and whether the pane opens when crew loads. */
export type Settings = { testCommand?: string; openOnLoad: boolean }

export type Message = { from: string; text: string; kind?: 'message' | 'memory' | 'route' }

/** A thread, its last messages; `total`, how many it has, where that is more. */
export type Thread = { item: string; title: string; messages: readonly Message[]; total?: number }

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
  /** Absent: Claude. Codex's tokens are its own account's, so they are told apart from Claude's. */
  engine?: Engine
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
  /** The same, each item weighed by how hard it is (1, 2, 4, 8 by tier): the percentage the pane shows. */
  weighted?: { done: number; total: number }
  /** Items found harder or easier than rated, latest first, and the percentage before and after. */
  rated?: readonly { id: string; from: Tier; to: Tier; why: string; before: number; after: number }[]
  stages: readonly Stage[]
  features: readonly Feature[]
  /** Items finished per day, oldest first; the last one is today. */
  daily: readonly { day: string; done: number }[]
  recent: readonly { id: string; title: string; role: RoleId; age: string }[]
}

/** A reminder crew sent the brain: what it saw, against which line, and when. */
export type Alert = { text: string; at: string }

/**
 * What the brain did about a reminder: the decision it wrote, and the numbers
 * before it and since; or, when the person has the brain ask first, what it
 * proposes and the question that waits for them.
 */
export type BrainAction = { id: string; text: string; before: string; after?: string; pending?: string }

/** How the brain's actions on usage are taken: on its own, or once the person approves each. */
export type Tuning = 'auto' | 'ask'

/**
 * crew while it stays on: when its heartbeat (a look in code, no model) last
 * looked and looks next, what it found and did; where a restart went on from;
 * and the brain's digest of the roles' routine news.
 */
export type Resident = {
  checked: string
  next: string
  found?: string
  resumed?: string
  /** `sent` absent: none went out yet. */
  digest?: { sent?: string; queued: number; next: string }
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
  /** How many memories there are, when more than the list shows. */
  memoryTotal?: number
  carrying: readonly Carrying[]
  usage: readonly UsageRow[]
  tiers: readonly { tier: Tier; tokens: number }[]
  /** The brain's share of today's tokens, 0 to 1. */
  brainShare: number
  alerts: readonly Alert[]
  actions: readonly BrainAction[]
  /** crew's heartbeat, its last restart and the brain's digest; none before crew has looked. */
  resident?: Resident
  /** Whether the brain acts on usage on its own or asks the person first. */
  tuning?: Tuning
  /** What crew offers on load: a PRD to start, or the one to go on with. */
  start?: Start
  /** Why crew neither reads nor writes the board, and the PRD it stopped on, if one was started. */
  boardProblem?: { text: string; prd?: string }
  /** Where crew keeps its board, from the repo's root, and why when it is not in .crew/. */
  boardFile?: { path: string; why?: string }
  settings?: Settings
  /** The engine each role runs on, and whether Codex can run here; none where crew does not say. */
  engines?: Engines
  /** Today's Codex tokens, apart from Claude's `today`. */
  codexToday?: number
  /** Questions on a role's model, kept apart from `decisions`. */
  modelAsks?: readonly ModelAsk[]
  /** Where the tokens went and what costs the most, from every run crew recorded. */
  audit?: Audit
  /** crew's web page on this machine: its address, whether it opens when crew starts, and the phone's way in. */
  web?: { url: string; openOnStart: boolean; tailnet?: Tailnet }
  /** Whether the brain has taken this repo over, and its draft PRD; none where crew does not say. */
  takeover?: Takeover
  /** A design the person opened to read in the pane. */
  opened?: { id: string; title: string; body: string }
  /** The person's memory search, and what it found. */
  recalled?: { query: string; text: string }
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

/**
 * One thing that costs the most tokens, from the runs crew recorded across
 * sessions: where, how much and its share, what is done about it, and how it
 * stands: acted on (a decision), being acted on, or the person's to do.
 */
export type Bottleneck = { title: string; tokens: number; share: string; fix: string; state: 'done' | 'acting' | 'person' }

/**
 * The token audit: what today's tokens went to, by part of a run, and what
 * each of the brain's turns carries; and the bottlenecks over the days and
 * sessions crew recorded.
 */
export type Audit = {
  parts: readonly { part: string; tokens: number }[]
  brain?: readonly { part: string; tokens: number }[]
  since: string
  sessions: number
  bottlenecks: readonly Bottleneck[]
  /** The last bottleneck crew told the brain about, and when: crew reckons them in code after each piece of work. */
  told?: string
}

/**
 * The web page on the person's tailnet, for their phone: off, open through
 * `tailscale serve`, or Tailscale not running or not installed here; this
 * machine's name and address there, and the devices paired with it.
 */
export type Tailnet = {
  state: 'on' | 'off' | 'stopped' | 'missing'
  machine?: string
  url?: string
  devices: readonly { id: string; name: string; paired: string }[]
}

/** A whole percentage, rounded down: it reads 100 only once everything is done. */
export const percent = (done: number, total: number): number => (total === 0 ? 0 : Math.floor((done / total) * 100))

/** How many of a bar's `width` cells a percentage fills, rounded down: the last cell fills only at 100. */
export const barCells = (pct: number, width: number): number => Math.floor((Math.max(0, Math.min(100, pct)) / 100) * width)

/** 41200 → "41K", 950 → "950". */
export const tokens = (n: number): string => (n >= 1000 ? `${Math.round(n / 1000)}K` : String(n))

/** The share of input read from the prompt cache, as a whole percent. */
export const hitRate = (u: UsageRow): number => {
  const all = u.input + u.cacheRead + u.cacheWrite
  return all === 0 ? 0 : Math.round((u.cacheRead / all) * 100)
}
