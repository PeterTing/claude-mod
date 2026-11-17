/** The pane's tabs. */
export type CrewTab = 'overview' | 'progress' | 'board' | 'threads' | 'log' | 'memory' | 'tokens' | 'models' | 'settings'

/** The sample situation the design preview shows. */
export type CrewScenario = 'normal' | 'empty' | 'attention' | 'restart' | 'leading' | 'drafting' | 'confirm' | 'codex' | 'quota' | 'usage'

/**
 * How the Threads tab lists its threads: newest first, by feature, or only
 * those the person (or the brain for them) wrote in or was written to; the
 * legend of the item kinds open; how many the list shows.
 */
export type CrewThreadsView = { order: 'recent' | 'feature' | 'mine'; legend: boolean; shown: number }

/** How the log tab lists crew's record: one role's or all, the entry shown in full, how many it lists. */
export type CrewLogView = { role: 'all' | 'pm' | 'qa' | 'uiux' | 'techlead' | 'fullstack'; open: string | null; shown: number }

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
  /** Whose rotation it is and why, as the log says it: `你要求輪替`, `大腦輪替：…`. */
  rotateWhy?: string
  /** Whom its current or last run was for: the flow's work, or the person (a question, an answer). */
  run?: 'flow' | 'person'
  /** Its current agent runs on Codex; absent, on Claude. */
  engine?: 'codex'
  /** The Codex thread its current agent goes on with. */
  thread?: string
  /** That thread's tokens so far, as Codex last told them: a run's own are what it adds. */
  codexTotal?: { input: number; cached: number; output: number; reasoning: number }
  /** A builder's: the worktree its current work is in, and the task that work is. */
  dir?: string
  item?: string
}

/** Where a role's agent works: the role's own, or a full-stack builder slot past the first (`fullstack-2` to `fullstack-8`). */
export type CrewLane = 'pm' | 'qa' | 'uiux' | 'techlead' | 'fullstack' | `fullstack-${number}`

export type CrewUsage = { input: number; output: number; cacheRead: number; cacheWrite: number; wakes: number; rotations: number }

/** `n` numbers messages in the order they were posted; a role has read up to the number it was woken at. */
export type CrewMessage = {
  t: number
  n?: number
  item: string
  from: string
  to?: string
  /** The builder past the first that crew's work went to. */
  slot?: number
  text: string
  kind?: 'message' | 'route' | 'memory'
}

export type CrewQuestion = {
  id: string
  question: string
  item?: string
  /** Who asked: a role, the flow itself (`crew`), or the main conversation (`brain`). */
  from: 'pm' | 'qa' | 'uiux' | 'techlead' | 'fullstack' | 'crew' | 'brain'
  status: 'open' | 'answered'
  answer?: string
  t: number
  /** The choices the role gave, at most four: the person may still answer in their own words. */
  options?: string[]
  /** The PRD whose decide page shows it: the draft or the PRD under way when it was asked. */
  prd?: string
  /** A picture the role drew to make it clear: a bit of HTML the decide page shows in a sandboxed frame, and what it shows. */
  picture?: { html: string; caption?: string }
  /** The numbers the question names, written out by crew from the board, the PRD and the memories when it was asked. */
  mentions?: { id: string; kind: string; text: string }[]
  /** The task the full-stack builder who asked was on: the answer goes back to that task's builder. */
  task?: string
  /** The brain asked it as one to settle before its draft `prd` starts: it sits at the top of the draft. */
  draft?: true
  /** crew's question on how to start the app, with what QA found in the repo: set only by the person's own press. */
  app?: { proposal?: CrewAppProposal }
  /** crew's question on QA's proposals of how to verify test cases: each case, the way QA proposed, why, and the proposal as it stood. Set only by the person's own press. */
  verify?: { cases: CrewVerifyCase[] }
}

/** A test case on crew's card of QA's proposals: the way proposed (`qa`, `accept`, or `command` back to the test commands), why, and the proposal's fingerprint. */
export type CrewVerifyCase = { id: string; title: string; method: 'command' | 'qa' | 'accept'; reason: string; mark: string }

/** What QA found in the repo to start the app with, and where it found each. */
export type CrewAppProposal = { start: string[]; stop?: string[]; url: string; accounts?: string; found: { start: string; stop?: string; url: string; accounts?: string }; noAccounts?: string }

export type CrewActivity = { t: number; day: string; role: string; id: string; title: string }

/** A task in hand: `slot` is set only while a builder runs on it. */
export type CrewJob = {
  slot?: number
  home?: number
  fixing?: string
  tips?: string
  retries: number
  reviews: number
  own?: true
  asking?: true
  say?: string
  qa?: string
  heard?: true
  backed?: string
  waive?: { sha: string; asked?: true }
  /** It waits for the person's answer to a question on it, alone (`id`: the question). */
  wait?: { at: 'building' | 'reviewing'; by: 'crew' | 'fullstack' | 'techlead'; id?: string }
  /** The tech lead's look at why its runs end without its work. */
  look?: { state: 'owed' | 'told' | 'answered'; report: string; unclean?: true; landed?: true; tl?: string; facts?: string }
  /** What the tech lead is told with its next review of it. */
  note?: string
  /** It waits with work left half done in crew's own worktree: nothing else is built there meanwhile. */
  dirty?: true
  /** crew is setting that work aside on a ref of its own. */
  shelving?: true
  /** That work, set aside by crew: the commit, the ref it is kept on, the file the tech lead reads it in, what its .gitignore hid (set aside apart), the task's commit then, and whether a builder was told to put it back. */
  shelf?: { sha: string; ref: string; patch?: string; also?: readonly { sha: string; ref: string; files: readonly string[]; patch?: string }[]; moved?: readonly { dir: string; files: readonly string[] }[]; tip?: string; sent?: true }
  /** Why crew could not set it aside. */
  unshelved?: string
}

export type CrewFlow = {
  stage:
    | 'idle'
    | 'splitting'
    | 'writing_tests'
    | 'confirming'
    | 'adding_tests'
    | 'designing'
    | 'approving'
    | 'planning'
    | 'building'
    | 'reviewing'
    | 'testing'
    | 'accepting'
    | 'done'
    | 'escalated'
  round: number
  retries: number
  /** Times the PM was sent back because the board did not answer the PRD (G0). */
  aligning?: number
  /** The PRD change the PM was last told about. */
  synced?: string
  /** The PM synced while QA was at work: the flow waits for QA's run to end. */
  awaitingQa?: boolean
  resumeAt?: 'splitting' | 'confirming' | 'designing' | 'planning' | 'building' | 'reviewing' | 'testing'
  /** The id of the question the flow asked the person last: one the flow leaves unanswered is closed by it. */
  askId?: string
  /** The tasks in hand, from the first build until approved and merged back. */
  jobs?: Record<string, CrewJob>
  /** The task whose worktree each full-stack slot's builder sits in, by slot; none for crew's own worktree, `?` where crew cannot vouch for it. */
  seats?: Record<string, string>
  /** The task the tech lead reviews, the commit it reads, and the times it was asked again for its verdict. */
  reviewing?: { task: string; sha: string; retries?: number }
  /** The tech lead is answering a thread. */
  talking?: true
  /** The feature whose changes the person asked for that run of the tech lead's is on. */
  hearing?: string
  /** The task the person is asked about. */
  held?: string
  backs?: Record<string, number>
  /** Merges back asked of crew, as task:commit. */
  merging?: string[]
  /** How many agents may work at once, the tech lead counted, and where the usage guard stands. */
  room?: { limit: number; usage?: 'warn' | 'pause' }
  /** Runs of the person's test command that left test cases not passed. */
  runs?: number
  /** The person's last answers when the tests could not run or kept failing, with the test cases not passing then: told with the next fix on those. */
  heard?: { answers: string[]; cases: string[] }
  /**
   * Test cases the person's test command gives no result for, as the person answered on them. `ok`: the person
   * said to go on without (no reason for another run or a fix, and not asked again while they still have none;
   * one that gets a result and loses it again is asked anew). `fix`: the person asked the full-stack to add
   * tests for them. `asked`: those the open question on the tests is about; `only`, it asked on them alone
   * (nothing failed); `exit`, the exit code of the run it came from, when not 0. `tips`: each task's newest commit
   * when `ok` was last confirmed by a run: a commit since, and the tests run again before `ok` counts.
   */
  unrun?: { ok: string[]; fix?: string[]; mend?: string[]; asked?: string[]; only?: true; exit?: number; whys?: string; tips?: string }
  /** Stored before `jobs`: the task the full-stack was building. */
  building?: string
  /** Stored before `jobs`: the commit a review asked changes on. */
  fixing?: string
  /** Stored before `jobs`: times the tech lead asked for changes. */
  reviews?: number
  /** Stored before `jobs`: each task's newest commit when a test run sent failures to fix. */
  tips?: string
  /** Features whose design the person sent back after their tasks were planned. */
  redesigned?: string[]
  /** Designs the person sent back in a feature that keeps others, by id: the newest design number then, and whether the designer was asked. */
  redraws?: Record<string, { after: number; asked?: true }>
  /** Features the tech lead was asked to check against their new design, until its run ends. */
  rechecking?: string[]
  /** Tasks the tech lead was asked to say the files of, while builds could run side by side: each asked once. */
  placed?: string[]
  /** The tasks the tech lead's run under way says the files of: asked again if that run is lost to a restart. */
  placing?: string[]
  /** QA's checks of the features in the running app, by feature: the round, the tasks' commits covered, how it went. */
  checks?: Record<string, { round: number; tips: string; state: 'running' | 'passed' | 'failed' | 'skipped' | 'error' | 'accepted'; why?: string; again?: true; settled?: number; fix?: { task: string; tip: string; text: string; data?: string; heard?: true; out?: true }; asked?: { id?: string }; stuck?: { cases: readonly string[]; mark: string; passed: number; shown?: number; rest?: { n: number; ids: string; why: string }; answer?: string; unclear?: number }; unseen?: true; partial?: { passed: number; blocked: number; theirs?: number }; redo?: { why: string; auto: number; asks: number; stopped?: true; told?: true }; untasked?: { criteria: readonly string[]; tasks?: readonly string[]; owed?: true }; recheck?: string; unread?: true }>
  /** The features handed to the person to accept: waiting for their look, fixing what they asked to change, or passed. */
  accepts?: Record<string, { state: 'waiting' | 'fixing' | 'passed'; round: number; said?: string; before?: readonly string[]; told?: true; asks?: number; note?: string; seq?: number; tips?: string; fixes?: readonly string[]; announced?: number; reply?: string; toPm?: readonly string[]; pmTold?: readonly string[] }>
  /** Approved designs UI/UX was asked to mark where each criterion is seen, for the acceptance cards: each asked once. */
  marksAsked?: string[]
  /** The person was asked, before the first build, to set the test command and what QA starts the app with. */
  setupAsked?: true
  /** That question is open: its answer starts the build, with no role to take it. */
  setupOpen?: true
  /** crew's question on a feature QA checked is open: its answer goes with the fix, or the check runs again. */
  checkOpen?: string
  /** Features waited for pictures with no app to start: crew was asked once to find how to start it. Gone once the app is set. */
  appAsked?: true
}

/** Work the flow gave a role while it was busy answering the person: handed over when that turn ends. */
export type CrewWork = {
  kind: 'spawn' | 'message'
  route: { tier: CrewTier; model: string; label: string; effort: string; limit: number }
  text: string
  item?: string
  run?: 'flow' | 'person'
  /** A start that replaces the role's agent: why. */
  reason?: string
  /** The question to the role this work answers, kept with it while it waits. */
  ask?: CrewAsking
  /** A full-stack task built on a branch and worktree of its own. */
  own?: true
}

/** A question to a role under way, ASK-: who asked, and the draft when it is a draft's review. */
export type CrewAsking = { id: string; by: 'person' | 'brain'; draft?: string }

/** What another copy of crew on this machine kept for the repo: the pane offers to bring it over. */
export type CrewCarry = {
  /** Its store file's name, in the plugins' store folder. */
  file: string
  /** Which copy, in the pane's words. */
  from: string
  /** When its file was last written: a copy still open writes it. */
  at: number
  prd: string
  /** The flow's stage, or `draft` for a PRD draft not started. */
  stage: string
  /** Questions it holds open for the person. */
  waits: number
  tests?: string
  setup?: string
  /** The board holds a PRD of its own to rebuild from, should the person not bring this over. */
  rebuild?: true
}

/** Another copy of crew seen at work on this repo, its record changing between two looks: which copy, and when. */
export type CrewTwin = { from: string; at: number }

/** Everything crew keeps for a running team in this session. */

export type CrewLive = {
  prdPath: string | null
  flow: CrewFlow
  roles: { pm: CrewLiveRole; qa: CrewLiveRole; uiux: CrewLiveRole; techlead: CrewLiveRole; fullstack: CrewLiveRole }
  /** Agent id → the role, or the full-stack slot, it was started for: every agent crew started. */
  agents: Record<string, CrewLane>
  /** The full-stack builder slots past the first, `fullstack-2` to `fullstack-8`, each with an agent of its own while builds run side by side. */
  slots?: Record<string, CrewLiveRole>
  /** Token use by role, `brain` being the main conversation. */
  usage: Record<string, CrewUsage>
  /** The roles' tokens on Codex, the same day's: Codex's own account, so apart from `usage`. */
  codexUsage?: Record<string, CrewUsage>
  /** Tokens by the tier of the task that spent them. */
  tiers: Record<string, number>
  threads: Record<string, CrewMessage[]>
  /** How many messages a thread has, where that is more than the session keeps (its last 50); its file has all. */
  threadTotals?: Record<string, number>
  /** The number of the last message posted. */
  posted: number
  /** The last message number each role was woken after: later messages to it are unread. */
  seen: Record<string, number>
  /** For the full-stack's builders, by item: the last message number a builder was woken after while told of that item. Each reads its own task's thread. */
  read?: Record<string, number>
  questions: CrewQuestion[]
  activity: CrewActivity[]
  /** Role → the ASK thread of the question it is answering, and who asked: the person, or the brain for them; with `draft`, a review of that draft PRD. */
  asks: Record<string, CrewAsking>
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
  /**
   * A running flow held until the person goes on: offered when Claude Code
   * started, put off by the person, or stopped again after the heartbeat woke it.
   */
  paused?: 'offer' | 'person' | 'stalled'
  /** crew's heartbeat: when it last looked, what it found and did; and where a restart went on from. */
  resident?: { checkedAt: number; found?: string; resumed?: string }
  /** Reminders on usage sent to the brain: the condition, what was said, when, and how bad (`level`); one per condition an hour, again only once worse. */
  alerts?: { key: string; text: string; at: number; level?: number }[]
  /** When the main conversation last ended a turn: a reminder sent before it is one the brain has not taken yet. */
  brainDoneAt?: number
  /** When crew last read a new model list (Claude's aliases, Codex's models): what shows them is drawn again. */
  catalogAt?: number
  /** The brain's tuning of each role's work from now on: under auto, an engine and a model or effort on it; a rotation threshold. */
  tuned?: Record<string, CrewTuning>
  /** The questions on a role's model waiting for the person (M-), apart from the others; and the next one's number. */
  modelAsks?: CrewModelAsk[]
  modelAskSeq?: number
  /** The review page of the PRD under way, as the pane shows it: its link once the brain published it, why it could not, or that it was asked to. */
  review?: { url?: string; failed?: string; asked?: true; chose?: true; path?: string }
  /** The PRD whose decide page the brain was last asked to publish: its report is that page's, though another PRD is shown since. */
  pageAsked?: string
  /** Codex on this machine as crew last checked: found, logged in, out of quota until when. */
  codex?: { state: 'ready' | 'logged-out' | 'missing'; login?: 'chatgpt' | 'apikey'; version?: string; at: number; limited?: string; until?: number }
  /**
   * The brain's actions on usage: taken (a decision, `DEC-`), or waiting for
   * the person (a question, `Q-`); what they change, why, and the role's
   * numbers before, with its wakes then, so the numbers since show after it ran.
   */
  tunings?: {
    id: string
    pending?: boolean
    role: string
    text: string
    change: CrewTuning
    reason: string
    before: string
    wakes: number
    at: number
    /** The role's counters and the day's total when the action took effect: what came since is measured from them. */
    base?: { day: string; role: CrewUsage; total: number }
  }[]
  /** The person said not now on the start screen: the pane stays closed for this session. */
  declined?: boolean
  /** Another copy of crew holds this repo's PRD under way, while this one holds none: offered to the person on the overview. */
  carry?: CrewCarry
  twin?: CrewTwin
  /** crew keeps the Mac from sleeping while crew works (a role, its tests or a prep): since when, until the last caffeinate run ends. */
  awake?: { since: number }
  /**
   * QA's check of a feature in the running app under way: the feature, its
   * round, since when, how far it got (crew starting the app, waiting for a
   * frame to start QA, QA at work), QA's agent once started, and the PRD;
   * where the app runs; `find`, QA is finding in the repo how to start the app.
   */
  checking?: { feature: string; round: number; since: number; phase: 'starting' | 'waiting' | 'checking'; agentId?: string; prd: string; url?: string; pids?: string[]; dir?: string; find?: true }
  /** Questions the heartbeat already brought up to the person. */
  reminded?: string[]
  /** A PRD the brain wrote with the person and has not started: who reviews it, and whether it waits for the person's yes. */
  draft?: CrewDraft
  /** Claude's subscription windows as Claude Code last read them, and the usage guard's hold on the roles on Claude. */
  claude?: CrewClaudeUsage
}

/** One subscription window: how much is used, 0 to 100, and when it resets (ms). */
export type CrewUsageWindow = { kind: string; percent: number; resetsAt?: number }

/** The guard holding the roles on Claude: the window, its reading, its reset; `full`, the window is used up. */
export type CrewUsageHold = { kind: string; percent: number; until?: number; full?: true }

/**
 * The usage guard's state: the last readings; the windows already warned of,
 * and those the person let run on (這次照常做), each till when; the hold.
 */
export type CrewClaudeUsage = { windows: CrewUsageWindow[]; warned?: Record<string, number>; goOn?: Record<string, number>; hold?: CrewUsageHold }

export type CrewDraft = {
  path: string
  title: string
  requirements: number
  stage: 'reviewing' | 'confirm'
  /**
   * Each reviewer: done with what it found, or failed (not sent, a run that did
   * not finish, a restart); `unsure`: it replied, but not in the asked form, so
   * whether it reviewed is the reply's to say; `ask` is its ASK thread.
   */
  reviews: { role: 'pm' | 'uiux'; done: boolean; failed?: boolean; unsure?: boolean; found?: string; ask?: string }[]
  /** The brain's word on the reviews when it asks the person to confirm. */
  note?: string
  /** How many times this draft went to review. */
  sends?: number
  /** What the person asked to change on the decide page: the brain changes the draft, and asks again. */
  change?: string
  /** The draft's questions the person answered since the brain's last ready: its next ready hands them back first. */
  answered?: string[]
}

/** A model is the engine's own: a Claude alias, or a Codex model; `why`, the brain's reason for the engine it moved the role to. */
export type CrewTuning = { engine?: 'claude' | 'codex'; model?: string; effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'; limit?: number; why?: string; raise?: true }

/** An engine, a model on it and an effort: what a role's piece of work runs on. */
export type CrewPick = { engine: 'claude' | 'codex'; model: string; label: string; effort: string }

/** A piece of work held for the person's answer on its model: started, or handed to the role, when they answer. */
export type CrewHeldWork = {
  kind: 'start' | 'message'
  route: { tier: CrewTier; model: string; label: string; effort: string; limit: number }
  text: string
  reason?: string
  item?: string
  run: 'flow' | 'person'
  /** The question to the role this work answers, kept with it while it waits. */
  ask?: CrewAsking
  /** The full-stack slot it goes to, past the first; and its task built on a branch of its own. */
  lane?: CrewLane
  own?: true
}

/**
 * A question on a role's model, M-: the brain's move to another engine, model
 * or effort (`change`, taken on yes); or crew's, for a piece of work that would
 * climb (`pick` on yes, `keep` on no) or that Codex cannot take now (`fallback`:
 * the role goes back to Claude on yes, and waits for Codex on no). Crew's hold
 * their work (`work`) till the person answers.
 */
/**
 * Work a new version of crew cut as it loaded, which crew said it would start
 * again once the flow stops: the lanes whose Codex runs were cut, and whether
 * the test run was; for the PRD it was cut in.
 */
export type CrewReloadRedo = {
  prd: string
  lanes: string[]
  tests: boolean
  /** When crew last looked at it: a load long after (crew switched off meanwhile) waits for 接續. */
  at?: number
}

export type CrewModelAsk = {
  id: string
  kind: 'switch' | 'climb'
  role: string
  text: string
  yes: string
  no: string
  from: 'crew' | 'brain'
  at: number
  change?: CrewTuning
  reason?: string
  pick?: CrewPick
  keep?: CrewPick
  fallback?: string
  /** Codex unable to take the work of a role the person set on Codex: Claude takes this piece only, and the setting stays. */
  onlyThis?: boolean
  work?: CrewHeldWork
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
      /** The session whose system prompt the engine composed, which that conversation keeps. */
      composedFor: string
      /** The item whose thread the Threads tab has open, if any. */
      thread: string | null
      /** How the Threads tab lists the threads. */
      threadsView: CrewThreadsView
      /** How the log tab lists crew's record. */
      logView: CrewLogView
      /** The pages opened over the tab, the last on top: an item's (`item:TASK-003`) or a Codex role's runs (`run:fullstack:0`). */
      pages: string[]
      /** The role whose question field the overview has open, if any. */
      asking: string | null
      /** The role whose work and last report the overview shows in full, if any. */
      detail: string | null
      /** The settings tab asks to confirm a reset. */
      confirming: boolean
      /** What the person opened in the pane: a setting's help, a role's model editor, the PRD path field. */
      shown: string[]
      /** The PRD picked on the start screen, before the start. */
      picked: string | null
      /** The design whose content the overview shows, if any. */
      designOpen: string | null
      /** The conversation crew last started in: a start in the same one is a reload. */
      began: string
      /** The repo a conversation started in: a reload keeps it, wherever the shell has moved since. */
      rootedIn: { session: string; root: string }
      /** The person's last memory search on the memory tab, and what it found. */
      recalled: { query: string; text: string } | null
      /** The gate whose detail the overview has open, if any. */
      gate: string | null
      /** Presses of 重畫 on a pane that could not draw: each one draws it again. */
      redraws: number
      /**
       * crew's web page, as the pane draws it: starting, up with its links
       * (the local one carries the one-time key the page pairs with), or down
       * with why.
       */
      webStatus:
        | { state: 'off' }
        | { state: 'starting' }
        | { state: 'up'; local: string; open: string; remote?: string; remoteWhy?: string }
        | { state: 'down'; why: string }
      /**
       * Whether crew's files on disk have been a newer crew than the one this
       * conversation runs for a minute: Claude Code did not take the new one,
       * and the pane and the page say so.
       */
      outdated: boolean
      /** The version of crew's files the last load in this Claude Code ran: a load of other files is a new version. */
      loadedBuild: string
      /** The work a new version's load cut that crew said it would start again, while it waits for the flow to stop. */
      reloadRedo: CrewReloadRedo | null
      /** The running team. */
      live: CrewLive
    }
  }
}
