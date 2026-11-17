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
  /** Tokens it used today, on Claude and on Codex: the builders' all on the full-stack row. */
  today: number
  /** One of the builders after the first, by its number: 2 for 全端 2. */
  slot?: number
  /** Its agent runs on Codex, which tells no context size. */
  engine?: 'codex'
  /** The work it was last given, and what it said at the end of its last run, in full. */
  task?: string
  report?: string
  /** Its runs crew can show, oldest first. */
  run?: RoleRun
  /** The usage guard holds the roles on Claude: this one finishes the run it is on, or waits for the reset. */
  held?: 'finishing' | 'paused'
}

/** One Claude subscription window as the pane shows it: its name, its reading, its reset, and the line it is past. */
export type GuardWindow = { kind: string; name: string; percent: number; resets: string; past?: 'warn' | 'pause' }

/**
 * The usage guard: its switch and thresholds, the windows as last read (none
 * off a subscription, or before the first reading), and its hold: the window,
 * the work waiting, whether ［這次照常做］ can lift it (not at 100%).
 */
export type Guard = {
  on: boolean
  warn: number
  pause: { five_hour: number; seven_day: number }
  windows: readonly GuardWindow[]
  hold?: { name: string; percent: number; resets: string; full: boolean; waiting: readonly string[] }
}

/**
 * What ［看執行過程］ opens for a role: `live`, at work on Claude, shows in the
 * main view as it runs; any other is crew's record, as the engine drops a
 * finished agent from its list within minutes and Codex has no view at all.
 */
export type RoleRun = { agentId: string; live?: true; item?: string }

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
  /** The numbers its note starts with, for the person to open, and the note after them. */
  links?: readonly string[]
  rest?: string
  /** Why it is as hard as its tier says: the tech lead's word on it. */
  hard?: string
}

export type GateState = 'pass' | 'gap' | 'active' | 'pending'

/** Something a gate still misses: an item, and where it stands. */
/** `shown`: the number the person reads in place of the id (a PRD requirement's own). */
export type Gap = { id: string; title: string; status: string; thread?: string; shown?: string }

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
  /** G6: where its passes come from, each counted apart (each test command, QA in the app, the person at acceptance). */
  sources?: string
  checked: string
}

/**
 * A question waiting for the person, from a role or from crew itself: answered
 * in words, a design to approve or send back, or the brain's proposal to approve.
 */
/** `review`: the PRD's designs, decided on the review page the brain published, at `url` once it has; `inPane`, that they can be decided in the pane instead. */
export type Decision = {
  id: string
  question: string
  from: RoleId | 'crew' | 'brain'
  age: string
  /** `app`: crew's question on how to start the app, settled by the person's press or in the settings tab. `verify`: QA's proposals on how test cases are verified, each pressed by the person. */
  kind?: 'design' | 'proposal' | 'review' | 'app' | 'verify'
  design?: string
  url?: string
  inPane?: true
  options?: readonly string[]
  count?: number
  /** A role's question that carries a picture: what the pane says of it, as only the decide page draws it. */
  picture?: string
  /** The numbers the question names, written out by crew. */
  mentions?: readonly { id: string; kind: string; text: string }[]
  /** What waits on it and what goes on meanwhile, where crew knows: 「在等這一題：TASK-002。照常進行：TASK-004。」 */
  holds?: string
  /** crew's question on starting the app carries what QA found: the press that takes it as it is. */
  appYes?: string
  /** QA's proposals on the card: each test case, the way QA proposes (as said), and why. */
  verify?: readonly { id: string; title: string; way: string; reason: string }[]
}

/** What crew offers when it loads: the PRDs in the repo to start from, or the PRD it stopped on. */
/** `stalled`: the flow stopped on its own (woken once, still stopped) and asks whether to try again; `paused` alone is the person's own pause. */
export type Start = { prds: readonly { path: string; title: string }[]; chosen?: string; resumable?: string; paused?: boolean; stalled?: true }

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
  /** The brain's own fills on the draft the person has not answered yet: the yes waits for them. */
  asks?: readonly string[]
}

/**
 * The brain taking this repo over from the person's first message, as the
 * person turned it on here; whether no PRD is under way (`idle`: a board may
 * still be there from one before); and the PRD it drafts.
 */
export type Takeover = { on: boolean; idle?: boolean; draft?: Draft }

/** crew's latest run of the person's test commands, for the settings: its commit (short) and how each command went. */
export type TestRunInfo = { sha: string; parts: readonly { cmd: string; exit: number; took: string }[] }

/**
 * A folder crew found a test command for, as the settings show it: its place
 * among the commands that run (none when it does not run), the command, where
 * it came from, the folder, where it stands (the chip, its tone, and why),
 * whether it is new since the last flow run, whether its tests name test case
 * ids, why it could not start last time, and how its last run went.
 */
export type FoundRowView = {
  key: string
  n?: number
  cmd: string
  src: string
  dir: string
  status: 'run' | 'off' | 'replaced' | 'covered' | 'norule' | 'bad' | 'over'
  chip: string
  tone: 'run' | 'todo' | 'kind' | 'wait'
  why?: string
  fresh?: true
  tc?: true
  broken?: string
  last?: { sha: string; exit: number; took: string }
}

/**
 * The test commands crew found in the project, as the settings show them: each
 * folder in the order crew runs them, how many of crew's run and how many of
 * the person's, whether crew has looked yet (and on which commit), whether
 * there were more manifests than it reads, how many are past the most crew
 * runs at once, and, by the place of each of the person's commands (1 the
 * first of theirs), the folder it runs in place of crew's.
 */
export type FoundView = { rows: readonly FoundRowView[]; crew: number; user: number; scanned: boolean; sha?: string; cut?: true; over: number; replaces?: Readonly<Record<number, string>> }

/** crew's settings, set in the pane: the test command, and whether the pane opens when crew loads. */
export type Settings = {
  testCommand?: string
  /** The person's test commands, in the order crew runs them (the first is testCommand). */
  testCommands?: readonly string[]
  /** The test commands crew found in the project, run with the person's: theirs go first for places. */
  found?: FoundView
  /** How crew's latest run went per command: on which commit (short), each command's exit code and how long it ran. */
  testRun?: TestRunInfo
  /** What QA starts the app with in crew's worktree, what stops it, the URL it opens, and the file with the test accounts. */
  startCommand?: string
  stopCommand?: string
  appUrl?: string
  accounts?: string
  /** What QA found in the repo to start the app with, while the app is not set: the fields hold it until the person saves. */
  proposal?: { start?: string; stop?: string; url?: string; accounts?: string }
  /** The person's worktree prep command, and how its runs went. */
  setupCommand?: string
  setup?: SetupState
  openOnLoad: boolean
  selfPublish?: boolean
  selfPublishFailed?: string
  /** How many agents may work on the tasks at once in this repo, the tech lead's review counted. */
  agents?: number
}

/**
 * A message: who wrote to whom (`你 → UI/UX`), its words, and when (`10/31
 * 15:42`); `gist`, what a thread's row shows of it where that is not its first
 * line (an answer, not the question it answers); `mine`, whether it is about
 * the person: theirs, to them, or the brain's for them.
 */
export type Message = { from: string; text: string; at?: string; gist?: string; mine?: boolean }

/** The start of a feature's number and a test case's, where a project's schema sets its own: PRD- and TC- otherwise. */
export type IdPrefixes = { feature: string; testCase: string }

/**
 * A thread: what the roles, the person and the brain said on an item, oldest
 * first (crew's own notices are in the log, not here); `older`, that earlier
 * messages are only in its file. What its item is, in words: its kind (設計稿)
 * and title, the feature it belongs to, and where it stands now (你核准了);
 * `opens`, that the item has a page of its own. `latest`, how long ago its
 * newest message came; `mine`, when and how long ago the newest message about
 * the person came, where it has one.
 */
export type Thread = {
  item: string
  kind: string
  title: string
  /** A PRD requirement's own number, read in place of crew's id. */
  shown?: string
  messages: readonly Message[]
  older?: true
  opens?: true
  feature?: { id: string; title: string }
  status?: string
  latest?: string
  mine?: { latest: string; t: number }
}

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
  /** Pinned for every builder. */
  builders?: true
}

/** The memories pinned for every builder: the rows, the tokens their lines take, and the cap. */
export type Pinned = { rows: readonly Memory[]; tokens: number; max: number; maxTokens: number }

/**
 * The prep command's runs: those under way, by where (a task's worktree or
 * crew's own branch) and since when; the last, how it ended, and its log.
 */
export type SetupState = {
  running: readonly { where: string; since: string }[]
  /** `trial`, a run the person asked for; `merge`, a run again in crew's worktree for a merge, which stops it when it fails. */
  last?: { where: string; ok: boolean; exit: string; took: string; at: string; log: string; tail?: string; trial?: true; merge?: true }
  /** crew's question on the merges the prep stopped is open, with merges still waiting on it: the answer there runs them again. */
  stuck?: true
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
  /** Its number as the PRD gives it, and the heading it is under: the list groups by heading. */
  label: string
  section: string
  text: string
  /** Its first words, for its row; its page has it all. */
  headline: string
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

/**
 * One thing crew did, for the log tab: when, in a word, who did it, the role
 * it was about (for the filter), a line of it and all of it, and the item it
 * was on. `failed`, that it went wrong.
 */
export type LogEntry = { key: string; at: string; word: string; who: string; text: string; role?: RoleId; full?: string; item?: string; opens?: true; failed?: true }

/** A number on a page, pressed to open it: what it is, where it stands, and what else the page says of it. */
/** `shown`: a PRD requirement's own number, read in place of crew's id. */
export type PageLink = { id: string; title: string; note?: string; lines?: readonly string[]; shown?: string }

/** A part of a page: its title and what it counts; its words, its lines, the numbers it names; what it says when it has none. */
export type PageSection = { title: string; hint?: string; text?: string; lines?: readonly string[]; links?: readonly PageLink[]; empty?: string }

/**
 * The page of an item of the board or a requirement of the PRD: what it is,
 * where it stands, who is on it and on what, whose it is, its parts in full;
 * whether it has a thread, the runs that worked on it, and the page its design
 * was decided on.
 */
export type ItemPage = {
  type: 'item'
  id: string
  kind: string
  title: string
  status?: string
  owner?: RoleId
  route?: Route
  feature?: PageLink
  requirements?: readonly PageLink[]
  sections: readonly PageSection[]
  /** Its id is crew's own, said in a section of the page: the title line leaves it out. */
  idHidden?: true
  thread?: true
  runs?: readonly { role: RoleId; run: RoleRun }[]
  url?: string
  /** A test case's page: how it is verified now, with the person's presses to change it. */
  verify?: { method: 'command' | 'qa' | 'accept' }
}

/** One step of a run: what it said, a command and what it printed, the files it changed, another tool, what it was told along the way. */
export type RunStep = { kind: 'message' | 'command' | 'file' | 'tool' | 'told'; text: string; output?: string }

/** A role's runs as crew kept them, the newest first, and the one open: when, on what, what crew told it, each step, its report or failure. */
export type RunPage = {
  type: 'run'
  role: RoleId
  open: number
  /** The item asked for when no run on it is kept: the newest is open instead. */
  missing?: string
  /** The role is on that item now: its run is kept once it ends. */
  running?: true
  runs: readonly { t: number; at: string; engine: 'claude' | 'codex'; item?: string; prompt: string; steps: readonly RunStep[]; report?: string; failed?: string }[]
}

/** A thread opened from a page, so ← 上一頁 goes back to that page. */
export type ThreadPage = { type: 'thread'; item: string }

export type Page = ItemPage | RunPage | ThreadPage

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
  /** The id prefixes the board uses, where they are not PRD- and TC-: the Threads tab's legend says them. */
  idPrefixes?: IdPrefixes
  memories: readonly Memory[]
  /** How many memories there are, when more than the list shows. */
  memoryTotal?: number
  pinned?: Pinned
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
  /** Claude's subscription windows and the usage guard; none where crew does not say. */
  guard?: Guard
  /** What crew offers on load: a PRD to start, or the one to go on with. */
  start?: Start
  /**
   * Another copy of crew on this machine holds this repo's PRD under way while
   * this one holds none: what it holds, and whether it wrote its record a few
   * minutes ago (still open, likely) and the board can be rebuilt from instead.
   */
  carry?: { from: string; prd: string; stage: string; waits: number; tests?: string; setup?: string; recent?: true; rebuild?: true }
  /** Another copy of crew at work on this repo in the last half hour, which one: two copies write over each other's board and decisions. */
  twin?: string
  /** crew keeps the Mac from sleeping while a role works, since this clock time. */
  awake?: { since: string }
  /** QA checking a feature in the running app now: which, its round, since when, and how far it got; `find`, QA is finding how to start the app for it. */
  checking?: { feature: string; title?: string; round: number; since: string; phase: 'starting' | 'waiting' | 'checking'; find?: true }
  /** QA's checks of the features in the running app so far, in board order. */
  checks?: readonly { feature: string; title?: string; round: number; state: 'running' | 'passed' | 'failed' | 'skipped' | 'error' | 'accepted'; why?: string; waits?: 'person' | 'builder' | 'task'; unseen?: true; partial?: { passed: number; blocked: number; theirs?: number }; stopped?: true; recheck?: true }[]
  /**
   * The features handed to the person to accept, not passed yet: QA's round,
   * whether they are back after the person's 要改 (`again`) or being changed now
   * (`fixing`, with what the person said). `passed`: how many they passed.
   * `confirm`: how many test cases they confirm themselves as they pass it, ticked on its card.
   * `mark`: the card as the pane shows it; a decision sent with it is refused once the card has moved on.
   */
  accepts?: { rows: readonly { feature: string; title?: string; round: number; state: 'waiting' | 'again' | 'fixing'; said?: string; confirm?: number; mark?: string }[]; passed: number }
  /** The decide page has news crew could not publish outside a hook: it goes with Claude Code's next action. */
  pageDue?: true
  /**
   * The decide page, where the progress map is: its link, or why it could not
   * be published; whether it was asked for, the person chose the pane, or the
   * brain has an update of it to make; and whether the brain is the one that
   * publishes it, only when something waits for the person.
   */
  decidePage?: { url?: string; failed?: string; asked?: true; chose?: true; brain?: true; byBrain?: true }
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
  /** The page the person opened over the tab. */
  page?: Page
  /** The decide page's link while crew publishes it itself and nothing on it waits: its progress map is there to see. */
  pageLink?: string
  /** crew's record of the last days, the newest first, while the log tab is open. */
  log?: readonly LogEntry[]
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
