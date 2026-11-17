/**
 * The board is .crew/prd-tracker.json (the repo's root prd-tracker.json where
 * crew made it there before 0.5.2), in the shape the progress-dashboard skill
 * and its schema use. crew only touches what it owns and keeps every field it
 * does not know.
 */

import { droppedRequirements, fingerprint, refsOf, REQUIREMENT_ID } from './prd'

export type TestCase = {
  id: string
  title?: string
  status: string
  use_cases: string[]
  types: string[]
  role: string
  fixture: string
  steps: string[]
  expected: string
  automated_status: string
  manual_status: string
  evidence: unknown[]
  /** The criteria this case covers, by id: crew's link for G4. */
  acceptance_criteria?: string[]
  /** How crew's latest run of the person's test command went for this case, as crew recorded it. */
  crew_result?: TestResult
  /** Why crew's latest run of the person's test commands gave this case no result, as crew recorded it. */
  crew_none?: NoneMark
  /** How this case is verified, when not by the test commands: set by the person alone, written by crew from its own record. */
  crew_method?: 'qa' | 'accept'
  /** The evidence of that other way, as crew recorded it: QA's report with its screenshot, or the person's tick when they passed the feature. */
  crew_check?: CheckMark
  /** QA's proposal of another way to verify this case, with why: it takes effect only once the person says so. */
  qa_proposal?: Proposal
  /** The person said no to QA's proposal on this case as it stands: written by crew from its own record, so no view asks them again. */
  crew_declined?: true
  [key: string]: unknown
}

/**
 * How a test case is verified: crew runs the person's test commands (the
 * default), QA operates it in the app crew started and reports it with a
 * screenshot, or the person confirms it when they accept its feature.
 */
export type VerifyMethod = 'command' | 'qa' | 'accept'

export const METHOD_LABEL: Record<VerifyMethod, string> = { command: '測試指令', qa: 'QA 實際操作', accept: '你驗收時確認' }

/**
 * The evidence of a test case verified another way: passed or failed, when,
 * and from QA, the round, the commit QA operated and its screenshot (a file
 * in the PRD's designs checks folder). `stale`: the feature's tasks have a
 * newer commit than QA operated.
 */
export type CheckMark = { method: 'qa' | 'accept'; result: 'passed' | 'failed'; at: number; round?: number; sha?: string; shot?: string; note?: string; stale?: true }

/** QA's proposal of a test case's way to be verified, with why, and the day it wrote it. */
export type Proposal = { method: VerifyMethod; reason: string; on: string }

/** A test case's result in a run crew made: on which commit, which run (its log), and whether a newer commit came since. */
/** `by`: the test command (as shown) a pass came from. */
export type TestResult = { result: 'passed' | 'failed'; sha: string; run: string; stale?: true; by?: string }

/**
 * Why a test case has no result in a run: its tests are in a folder none of
 * the person's test commands ran (`unreached`), the runner skipped it
 * (`skipped`), its test file ran but no line names it with a result
 * (`unnamed`), crew cannot tell whether a command ran its tests (`unclear`:
 * a script, a narrowed run or an unknown runner, or git's list of test files
 * cut short), or no test file on crew's branch names it (`missing`).
 */
export type NoneWhy = 'unreached' | 'skipped' | 'unnamed' | 'unclear' | 'missing'

/**
 * Why no command ran an unreached test case's folder, when crew can say: the
 * person turned off the command crew found for it (`off`), crew found more
 * commands than it runs at once (`over`), a python folder has no pytest
 * settings (`norule`), crew's command for it could not start (`broken`), its
 * folder's name is one crew puts in no command (`bad`), the root's test
 * script was to run it (`covered`), one of the person's commands was to run
 * it whole (`replaced`), crew found no test command in the project and the
 * person set none (`nocmd`), or the person turned off every command crew
 * found and set none (`alloff`).
 */
export type NoneCause = 'off' | 'over' | 'norule' | 'broken' | 'bad' | 'covered' | 'replaced' | 'nocmd' | 'alloff'

/** Why a test case had no result in a run (its log), and for one unreached or unclear the folder its tests are in ('' the repo's root). */
export type NoneMark = { why: NoneWhy; dir?: string; run: string; cause?: NoneCause }

const NONE_WHYS: readonly NoneWhy[] = ['unreached', 'skipped', 'unnamed', 'unclear', 'missing']

export const NONE_CAUSES: readonly NoneCause[] = ['off', 'over', 'norule', 'broken', 'bad', 'covered', 'replaced', 'nocmd', 'alloff']

/** The causes the person is not asked about: they turned the command off themselves, or there is no command to run. */
export const QUIET_CAUSES: readonly NoneCause[] = ['off', 'nocmd', 'alloff']

export type TaskSize = 'S' | 'M' | 'L' | 'XL'

/** Which side of the product a task builds: the screens, the backend, or the infrastructure. */
export type TaskLayer = 'ui' | 'be' | 'infra'

/** Where on the route a task goes besides its feature: the shared work before it, or what launch needs. */
export type TaskStation = 'base' | 'launch'

/** A piece of work the tech lead breaks criteria into: what to build, for which criteria, how big. */
export type Task = {
  id: string
  title: string
  status: string
  /** The criteria this task serves, by id: crew's link for G3. */
  acceptance_criteria: string[]
  detail: string
  size?: TaskSize
  /** The side it builds, the part of the product it builds (tasks on one part make one item on the route), the tasks it waits for, the files it changes, and its station when not its feature's. */
  crew_layer?: TaskLayer
  crew_part?: string
  crew_after?: string[]
  crew_touches?: string[]
  crew_station?: TaskStation
  /** Why the task left the plan, when it did. */
  crew_dropped?: string
  /** The commits on crew's branch that do this task, as crew read them from git, newest first. */
  crew_commits?: string[]
  /** The tech lead's last review of the task, as crew recorded it. */
  crew_review?: TaskReview
  /** The task's newest commit, when it is on the task's own branch only: crew merges it back once approved. */
  crew_unmerged?: string
  [key: string]: unknown
}

/** A review pinned to the commit the tech lead read: approved, or changes asked for. */
export type TaskReview = { sha: string; verdict: 'approve' | 'changes'; notes?: string }

/**
 * A design the UI/UX designer made for a feature: a screen, with its layout,
 * states and interactions, or no screen, with why. The person approves it.
 */
export type Design = {
  id: string
  title: string
  kind: 'screen' | 'none'
  body: string
  /** Why the design left the plan, when it did. */
  crew_dropped?: string
  /** The person's decision on it, as crew recorded it. */
  crew_decision?: DesignDecision
  /** Its clickable mockup, kept by crew beside the board: which version, and what it says, as a mark. */
  crew_mockup?: Mockup
  /** Its mockup marks where each criterion is seen (data-crew-check): the acceptance card lights them. */
  crew_marked?: true
  [key: string]: unknown
}

/** A design's mockup as the board names it: the HTML itself is in .crew/designs/, never on the board every role reads. */
export type Mockup = { version: number; mark: string; bytes: number }

/** The person approved the design, or sent it back with why. */
export type DesignDecision = { verdict: 'approved' | 'rejected'; reason?: string }

export type PrdItem = {
  id: string
  title: string
  status: string
  priority: string
  summary: string
  acceptance_criteria: (string | { id: string; text: string })[]
  test_cases: TestCase[]
  tasks: unknown[]
  gaps: unknown[]
  /** Why the feature left the plan, when it did. */
  crew_dropped?: string
  /** The UI/UX designer's designs for the feature. */
  crew_designs?: unknown[]
  /** What the person can do once the feature is done, as the PM wrote it. */
  crew_gain?: string
  [key: string]: unknown
}

export type Tracker = {
  schema_version: unknown
  project: string
  mode: string
  source_of_truth: string
  acceptance_policy: unknown
  summary: Record<string, unknown>
  prd_items: PrdItem[]
  decisions?: unknown[]
  [key: string]: unknown
}

export type Prefixes = { feature: string; testCase: string }

export type Op =
  /** `sources`: the ids of the PRD requirements the feature answers (R-xxxxxx). */
  | { op: 'add_feature'; title: string; summary: string; priority?: 'P0' | 'P1' | 'P2'; sources?: string[]; gain?: string }
  | { op: 'link_requirements'; feature: string; requirements: string[] }
  | { op: 'drop_requirement'; id: string; reason: string }
  | { op: 'add_criterion'; feature: string; text: string }
  | { op: 'drop_criterion'; id: string; reason: string }
  | { op: 'drop_feature'; id: string; reason: string }
  | ({ op: 'add_task'; feature: string; criteria: string[]; title: string; detail: string; size?: string } & TaskPlace)
  /** The tech lead fills in or corrects where a task sits: only the fields given change. */
  | ({ op: 'set_task'; id: string } & TaskPlace)
  | { op: 'drop_task'; id: string; reason: string }
  /** `html`: the clickable mockup, which a design with a screen must have and one without must not. */
  | { op: 'add_design'; feature: string; title: string; kind: string; body: string; html?: string }
  | { op: 'add_mockup'; id: string; html: string }
  /** Marks on an approved mockup: each names an element by the start of its opening tag; crew writes the attributes into the approved html (`html`). */
  | { op: 'mark_mockup'; id: string; marks: readonly MockupMark[]; html?: string }
  | { op: 'drop_design'; id: string; reason: string }
  /** QA proposes another way to verify a test case (or going back to the test commands), with why: the person decides. */
  | { op: 'propose_check'; id: string; method: string; reason: string }
  | {
      op: 'add_test_case'
      criteria: string[]
      title: string
      steps: string[]
      expected: string
      types?: string[]
      role?: string
      fixture?: string
    }

/** Where a task sits, as the tech lead writes it: its side, its part, what it waits for, what it changes, its station. */
export type TaskPlace = { layer?: string; part?: string; after?: string[]; touches?: string[]; station?: string }

/** `taken`: ids in use outside the board, such as decisions kept in crew's memory. */
export type OpContext = { by: string; today: string; prefixes: Prefixes; taken?: readonly string[] }

export type OpResult = { op: Op['op']; id?: string }

export type ApplyResult = { ok: true; tracker: Tracker; results: OpResult[] } | { ok: false; errors: string[] }

/** Which ops each role may make. */
const ALLOWED: Record<string, readonly Op['op'][]> = {
  pm: ['add_feature', 'add_criterion', 'drop_criterion', 'drop_feature', 'link_requirements', 'drop_requirement'],
  qa: ['add_test_case', 'propose_check'],
  techlead: ['add_task', 'set_task', 'drop_task'],
  uiux: ['add_design', 'add_mockup', 'mark_mockup', 'drop_design'],
}

const ROLE_LABEL: Record<string, string> = { pm: 'PM', qa: 'QA', techlead: 'Tech lead', fullstack: '全端', uiux: 'UI/UX' }

/** The longest a design may be: it lives on the board, which every role reads. */
const DESIGN_MAX = 6000

/** The longest a mockup may be: the brain reads each before it publishes it. */
export const MOCKUP_MAX = 200_000

/**
 * Why a mockup cannot be shown, or undefined when it can: it runs in the
 * person's artifact, so it is whole in itself, loading nothing and calling
 * no one. Pure.
 */
export const mockupProblem = (html: string): string | undefined => {
  if (html.trim() === '') return 'mockup 是空的'
  if (html.length > MOCKUP_MAX) return `mockup 最多 ${MOCKUP_MAX} 字`
  if (!/<[a-z!]/i.test(html)) return 'mockup 要是 HTML'
  if (/\b(?:src|href|srcset|poster|action|data)\s*=\s*["']?\s*(?:https?:)?\/\//i.test(html) || /(?:@import|url\()\s*["']?\s*(?:https?:)?\/\//i.test(html)) return 'mockup 不能載入或連到外部網址（script、字型、圖片、樣式要寫在檔案裡，連結用 # 代替）'
  if (/http-equiv\s*=\s*["']?\s*refresh/i.test(html) || /\blocation(?:\.href)?\s*=\s*["'`]\s*(?:https?:)?\/\//i.test(html)) return 'mockup 不能跳到外部網址（不用 meta refresh，也不改 location）'
  if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\b/.test(html) || /\bimport\s*\(/.test(html)) return 'mockup 不能連網路（fetch、XMLHttpRequest、WebSocket、import() 都不能用）'
  return undefined
}

/** The board's name for a mockup: its version and its mark. */
export const mockupOf = (html: string, version: number): Mockup => ({ version, mark: fingerprint(html), bytes: html.length })

/** A design's mockup, when the board names one crew could have written. */
export const mockupOfDesign = (d: Design): Mockup | undefined => {
  const v = d.crew_mockup as Partial<Mockup> | undefined
  if (typeof v !== 'object' || v === null || typeof v.version !== 'number' || typeof v.mark !== 'string' || typeof v.bytes !== 'number') return undefined
  return { version: v.version, mark: v.mark, bytes: v.bytes }
}

/** One mark on an approved mockup: the element, by the start of its opening tag as the mockup has it once, and the criteria seen there or shown by it. */
export type MockupMark = { at: string; check?: string; show?: string }

/** The marks a mockup carries for the acceptance card: where each criterion is seen, and the switch that shows it. */
const MARK_ATTR = /\s+data-crew-(?:check|show)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+)/gi

/** Criterion ids a mark names, one or more. */
const MARK_IDS = /^[A-Za-z][A-Za-z0-9_]*-\d+( [A-Za-z][A-Za-z0-9_]*-\d+)*$/

/** The most marks one mark_mockup adds. */
const MARKS_MAX = 60

/**
 * A mockup with marks written in: each at the end of the opening-tag text it
 * names, which must appear once and end where an attribute may go. Why not,
 * for the first mark that cannot go in.
 */
export const markMockup = (html: string, marks: readonly MockupMark[]): { html: string } | { error: string } => {
  let out = html
  for (const m of marks) {
    const at = m.at
    if (!at.startsWith('<') || at.includes('>')) return { error: `「${at.slice(0, 60)}」要是元素開頭的標籤文字（從 < 開始、不含 >），例如 <button id="refund"` }
    const first = out.indexOf(at)
    if (first < 0) return { error: `mockup 裡找不到「${at.slice(0, 60)}」` }
    if (out.indexOf(at, first + 1) >= 0) return { error: `「${at.slice(0, 60)}」在 mockup 裡出現不只一次，多寫一點讓它只對到一個元素` }
    const after = out.charAt(first + at.length)
    if (!/[\s>/]/.test(after)) return { error: `「${at.slice(0, 60)}」要在一個屬性結束的地方停（後面接空白或 >）` }
    const attrs = `${m.check === undefined ? '' : ` data-crew-check="${m.check}"`}${m.show === undefined ? '' : ` data-crew-show="${m.show}"`}`
    out = `${out.slice(0, first + at.length)}${attrs}${out.slice(first + at.length)}`
  }
  return { html: out }
}

/** Whether a mockup marks where a criterion is seen. */
export const hasMarks = (html: string): boolean => /\sdata-crew-check\s*=/i.test(html)

/** A mockup without its marks: what the person approved, whatever marks were added since. */
export const withoutMarks = (html: string): string => html.replace(MARK_ATTR, '')

/** A design the person cannot see yet: a screen with no mockup. */
export const needsMockup = (d: Design): boolean => d.kind === 'screen' && mockupOfDesign(d) === undefined

const SIZES: readonly TaskSize[] = ['S', 'M', 'L', 'XL']
const LAYERS: readonly TaskLayer[] = ['ui', 'be', 'infra']
const STATIONS: readonly TaskStation[] = ['base', 'launch']
const PART_MAX = 40
const GAIN_MAX = 200
const TOUCHES_MAX = 20
const PATH_MAX = 200
const LAYER_LABEL: Record<TaskLayer, string> = { ui: '畫面', be: '後端', infra: '基礎建設' }
const STATION_LABEL: Record<TaskStation, string> = { base: '地基', launch: '上線' }

/** A path as the tech lead names it, cleaned: inside the repo with no way out of it, or none. */
const cleanPath = (raw: string): string | undefined => {
  const p = raw.trim().replace(/^(?:\.\/)+/, '')
  if (p === '' || p.length > PATH_MAX || [...p].some(ch => ch.charCodeAt(0) < 32)) return undefined
  if (p.startsWith('/') || p.startsWith('~') || p.includes('\\') || /^[A-Za-z]:/.test(p)) return undefined
  return p.split('/').includes('..') ? undefined : p
}

/** Where a task sits on the route, as the board holds it: a value crew could not have written is none. */
export type Place = { layer?: TaskLayer; part?: string; after: string[]; touches: string[]; station?: TaskStation }

export const placeOf = (task: Task): Place => {
  const texts = (v: unknown, most: number): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string').slice(0, most) : [])
  return {
    ...(LAYERS.includes(task.crew_layer as TaskLayer) ? { layer: task.crew_layer } : {}),
    ...(typeof task.crew_part === 'string' && task.crew_part.trim() !== '' ? { part: task.crew_part.trim().slice(0, PART_MAX) } : {}),
    after: texts(task.crew_after, 50),
    touches: texts(task.crew_touches, TOUCHES_MAX).flatMap(p => cleanPath(p) ?? []),
    ...(STATIONS.includes(task.crew_station as TaskStation) ? { station: task.crew_station } : {}),
  }
}

/** What the person can do once the feature is done, as the PM wrote it, when the board holds text. */
export const gainOf = (item: PrdItem): string | undefined =>
  typeof item.crew_gain === 'string' && item.crew_gain.trim() !== '' ? item.crew_gain.trim().slice(0, GAIN_MAX) : undefined

/** A feature's tasks, read from what the board holds: entries without an id and a title are not crew's to count. */
export const tasksOf = (item: PrdItem): Task[] =>
  (Array.isArray(item.tasks) ? item.tasks : []).flatMap((entry): Task[] => {
    const v = entry as Partial<Task> | null
    if (typeof v !== 'object' || v === null || typeof v.id !== 'string' || typeof v.title !== 'string') return []
    // The commit shas are text, as crew writes them; anything else on a board edited by hand is none.
    const commits = Array.isArray(v.crew_commits) ? v.crew_commits.filter((c): c is string => typeof c === 'string') : undefined
    return [{ ...v, id: v.id, title: v.title, status: typeof v.status === 'string' ? v.status : 'planned', acceptance_criteria: Array.isArray(v.acceptance_criteria) ? v.acceptance_criteria.filter((c): c is string => typeof c === 'string') : [], detail: typeof v.detail === 'string' ? v.detail : '', crew_commits: commits } as Task]
  })

/** A feature's designs, read from what the board holds: entries without an id, a title, a kind and a body are not crew's to count. */
export const designsOf = (item: PrdItem): Design[] =>
  (Array.isArray(item.crew_designs) ? item.crew_designs : []).flatMap((entry): Design[] => {
    const v = entry as Partial<Design> | null
    if (typeof v !== 'object' || v === null || typeof v.id !== 'string' || typeof v.title !== 'string' || typeof v.body !== 'string' || (v.kind !== 'screen' && v.kind !== 'none')) return []
    return [{ ...v, id: v.id, title: v.title, kind: v.kind, body: v.body } as Design]
  })

/** The person's decision on a design, when the mark is one crew could have written. */
export const decisionOf = (d: Design): DesignDecision | undefined => {
  const v = d.crew_decision as Partial<DesignDecision> | undefined
  if (typeof v !== 'object' || v === null || (v.verdict !== 'approved' && v.verdict !== 'rejected')) return undefined
  return { verdict: v.verdict, ...(typeof v.reason === 'string' ? { reason: v.reason } : {}) }
}

/** A feature's designs still in play: not dropped, not sent back. */
export const liveDesignsOf = (item: PrdItem): Design[] => designsOf(item).filter(d => d.crew_dropped === undefined && decisionOf(d)?.verdict !== 'rejected')

/** The tasks in the plan: in a feature in scope, not dropped, in the order the tech lead numbered them. */
export const liveTasksOf = (board: Tracker): Task[] =>
  board.prd_items
    .filter(i => i.crew_dropped === undefined)
    .flatMap(tasksOf)
    .filter(t => t.crew_dropped === undefined)
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))

/** The task's newest commit on crew's branch, as crew saw it. */
export const tipOf = (task: Task): string | undefined => (Array.isArray(task.crew_commits) && typeof task.crew_commits[0] === 'string' ? task.crew_commits[0] : undefined)

/** The tech lead's last review of the task, when the mark is one crew could have written. */
export const reviewOf = (task: Task): TaskReview | undefined => {
  const r = task.crew_review as Partial<TaskReview> | undefined
  if (typeof r !== 'object' || r === null || typeof r.sha !== 'string' || (r.verdict !== 'approve' && r.verdict !== 'changes')) return undefined
  return { sha: r.sha, verdict: r.verdict, ...(typeof r.notes === 'string' ? { notes: r.notes } : {}) }
}

/** The tech lead approved the task's newest commit: an approval of an older one is out of date. */
export const approvedNow = (task: Task): boolean => {
  const tip = tipOf(task)
  const r = reviewOf(task)
  return tip !== undefined && r?.verdict === 'approve' && r.sha === tip
}

/** The task's newest commit is on its own branch only, not yet merged back into crew's branch. */
export const unmergedNow = (task: Task): boolean => {
  const tip = tipOf(task)
  return tip !== undefined && task.crew_unmerged === tip
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** What part of a feature crew cannot read, if any: crew reads its id and title, its criteria (text, or id and text) and its test cases without checking. */
const itemProblem = (v: unknown, at: number): string | undefined => {
  if (!isRecord(v)) return `prd_items 第 ${at + 1} 項不是物件`
  if (typeof v.id !== 'string') return `prd_items 第 ${at + 1} 項沒有 id`
  const name = v.id.length > 40 ? `${v.id.slice(0, 40)}…` : v.id
  if (typeof v.title !== 'string') return `${name} 沒有 title`
  if (!Array.isArray(v.acceptance_criteria)) return `${name} 的 acceptance_criteria 不是清單`
  if (!v.acceptance_criteria.every(c => typeof c === 'string' || (isRecord(c) && typeof c.id === 'string' && typeof c.text === 'string'))) return `${name} 的 acceptance_criteria 有讀不懂的項目`
  if (!Array.isArray(v.test_cases)) return `${name} 的 test_cases 不是清單`
  if (!v.test_cases.every(c => isRecord(c) && typeof c.id === 'string' && (c.acceptance_criteria === undefined || Array.isArray(c.acceptance_criteria)))) return `${name} 的 test_cases 有讀不懂的項目`
  return undefined
}

/**
 * What keeps crew from reading a board, if anything: `isOther` for another
 * tool's file of the same name, otherwise the first part of the board crew
 * cannot read. Either way crew neither reads nor writes it.
 */
export const trackerProblem = (v: unknown): { isOther: boolean; why: string } | undefined => {
  if (!isRecord(v) || !Array.isArray(v.prd_items)) return { isOther: true, why: '沒有 prd_items 清單' }
  for (const [at, item] of v.prd_items.entries()) {
    const why = itemProblem(item, at)
    if (why !== undefined) return { isOther: false, why }
  }
  if (v.decisions !== undefined && !Array.isArray(v.decisions)) return { isOther: false, why: 'decisions 不是清單' }
  // A decision is read by its fields: a line of text has none, and only an empty entry cannot be read at all.
  if (Array.isArray(v.decisions) && v.decisions.includes(null)) return { isOther: false, why: 'decisions 有空的項目' }
  return undefined
}

/**
 * A board as crew reads it: a feature missing its criteria or test case list
 * has none, as the strict schema writes it, and crew adds the empty list when it
 * next writes the board. A list of the wrong type is left for trackerProblem.
 */
export const withEmptyLists = (v: unknown): unknown => {
  if (!isRecord(v) || !Array.isArray(v.prd_items)) return v
  if (v.prd_items.every(i => !isRecord(i) || (i.acceptance_criteria !== undefined && i.test_cases !== undefined))) return v
  const items = v.prd_items.map(i =>
    !isRecord(i) ? i : { ...i, ...(i.acceptance_criteria === undefined ? { acceptance_criteria: [] } : {}), ...(i.test_cases === undefined ? { test_cases: [] } : {}) },
  )
  return { ...v, prd_items: items }
}

/** A board crew can read. */
export const isTracker = (v: unknown): v is Tracker => trackerProblem(v) === undefined

/**
 * Whether a root prd-tracker.json is a board crew made there before 0.5.2:
 * starting a PRD wrote crew_prd into it. One that does not parse, as with a
 * merge conflict, is crew's when it holds crew_prd as an object.
 */
export const madeByCrew = (text: string): boolean => {
  try {
    const v: unknown = JSON.parse(text)
    return isRecord(v) && isRecord(v.crew_prd)
  } catch {
    return /"crew_prd"\s*:\s*\{/.test(text)
  }
}

export const DEFAULT_PREFIXES: Prefixes = { feature: 'PRD-', testCase: 'TC-' }

/** A new board with every field the strict prd-tracker schema requires. */
export const newTracker = (project: string): Tracker => ({
  schema_version: '1.0.0',
  project,
  mode: 'local-only',
  source_of_truth: 'repo-json',
  acceptance_policy: { verified_requires: ['automated_tests_passed', 'manual_acceptance_passed'] },
  summary: { total_prds: 0, verified_prds: 0, partial_prds: 0, blocked_prds: 0, not_covered_prds: 0, total_test_cases: 0 },
  prd_items: [],
  decisions: [],
  migration_maps: [],
})

const patternPrefix = (node: unknown): string | undefined => {
  const pattern = (node as { properties?: { id?: { pattern?: unknown } } } | undefined)?.properties?.id?.pattern
  if (typeof pattern !== 'string') return undefined
  return /^\^([A-Za-z][A-Za-z0-9_]*-)/.exec(pattern)?.[1]
}

/** The id prefixes a project's schema requires, or PRD- and TC-. */
export const prefixesFrom = (schema: unknown): Prefixes => {
  const defs = (schema as { $defs?: Record<string, unknown>; definitions?: Record<string, unknown> } | undefined) ?? {}
  const table = defs.$defs ?? defs.definitions ?? {}
  return {
    feature: patternPrefix(table.prd_item) ?? DEFAULT_PREFIXES.feature,
    testCase: patternPrefix(table.test_case) ?? DEFAULT_PREFIXES.testCase,
  }
}

export type Criterion = { id: string; text: string; feature: string }

const CRITERION = /^\[([A-Za-z][\w-]*)\]\s*([\s\S]*)$/

/**
 * A feature's criteria with their ids: "[AC-001] text", { id, text }, or a
 * plain string, which gets `<feature>#<n>` and can be linked by nothing.
 */
export const criteriaOf = (item: PrdItem): Criterion[] =>
  item.acceptance_criteria.map((entry, i) => {
    if (typeof entry !== 'string') return { id: entry.id, text: entry.text, feature: item.id }
    const m = CRITERION.exec(entry)
    return m !== null ? { id: m[1] ?? '', text: m[2] ?? '', feature: item.id } : { id: `${item.id}#${i + 1}`, text: entry, feature: item.id }
  })

const allCriteria = (t: Tracker): Criterion[] => t.prd_items.flatMap(criteriaOf)

const inScope = (t: Tracker): PrdItem[] => t.prd_items.filter(i => i.crew_dropped === undefined)

const next = (ids: readonly string[], prefix: string): string => {
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`)
  const most = ids.reduce((n, id) => Math.max(n, Number(re.exec(id)?.[1] ?? 0)), 0)
  return `${prefix}${String(most + 1).padStart(3, '0')}`
}

const decisionIds = (t: Tracker): string[] =>
  (t.decisions ?? []).map(d => (d as { id?: unknown }).id).filter((id): id is string => typeof id === 'string')

const recordDecision = (t: Tracker, ctx: OpContext, decision: Record<string, unknown>) => {
  t.decisions = t.decisions ?? []
  t.decisions.push({ id: next([...decisionIds(t), ...(ctx.taken ?? [])], 'DEC-'), date: ctx.today, status: 'accepted', by: ctx.by, ...decision })
}

/** Keeps the summary and per-feature counts in step, leaving other fields as they are. */
const recount = (t: Tracker) => {
  const count = (status: string) => t.prd_items.filter(i => i.status === status).length
  t.summary = {
    ...t.summary,
    total_prds: t.prd_items.length,
    verified_prds: count('verified'),
    partial_prds: count('partial'),
    blocked_prds: count('blocked'),
    not_covered_prds: count('not-covered'),
    total_test_cases: t.prd_items.reduce((n, i) => n + i.test_cases.length, 0),
  }
  for (const item of t.prd_items) {
    item.test_case_counts = { ...((item.test_case_counts as Record<string, unknown> | undefined) ?? {}), total: item.test_cases.length }
  }
}

/**
 * Where a task sits as the tech lead wrote it, checked and cleaned: only the
 * fields given, with '' or [] clearing one; or what is wrong. `self` is the
 * task being changed, which cannot wait for itself.
 */
const placeFrom = (t: Tracker, p: TaskPlace, self?: string): Partial<Task> | string => {
  const out: Partial<Task> = {}
  if (p.layer !== undefined) {
    if (!LAYERS.includes(p.layer as TaskLayer)) return 'layer 要是 ui（畫面）、be（後端）或 infra（基礎建設）'
    out.crew_layer = p.layer as TaskLayer
  }
  if (p.part !== undefined) {
    if (p.part.trim().length > PART_MAX) return `part 最多 ${PART_MAX} 字`
    out.crew_part = p.part.trim() === '' ? undefined : p.part.trim()
  }
  if (p.station !== undefined) {
    if (p.station !== '' && !STATIONS.includes(p.station as TaskStation)) return 'station 要是 base（地基）、launch（上線），或空白（跟著功能）'
    out.crew_station = p.station === '' ? undefined : (p.station as TaskStation)
  }
  if (p.after !== undefined) {
    const all = new Set(t.prd_items.flatMap(i => tasksOf(i).map(x => x.id)))
    const live = new Set(liveTasksOf(t).map(x => x.id))
    const ids = [...new Set(p.after.map(a => a.trim()))]
    const unknown = ids.filter(a => !all.has(a))
    if (unknown.length > 0) return `after 的 ${unknown.join('、')} 不是看板上的任務`
    const gone = ids.filter(a => !live.has(a))
    if (gone.length > 0) return `after 的 ${gone.join('、')} 已經移出`
    if (self !== undefined && ids.includes(self)) return `${self} 不能等自己`
    out.crew_after = ids.length === 0 ? undefined : ids
  }
  if (p.touches !== undefined) {
    if (p.touches.length > TOUCHES_MAX) return `touches 最多 ${TOUCHES_MAX} 個路徑`
    const bad = p.touches.find(raw => cleanPath(raw) === undefined)
    if (bad !== undefined) return `touches 的「${bad.slice(0, 60)}」不是 repo 裡的相對路徑（不能是絕對路徑、不能有 ..）`
    const paths = [...new Set(p.touches.flatMap(raw => cleanPath(raw) ?? []))]
    out.crew_touches = paths.length === 0 ? undefined : paths
  }
  return out
}

/** The task waits for itself through the tasks it waits for. */
const waitsLoop = (t: Tracker, from: string): boolean => {
  const after = new Map(t.prd_items.flatMap(tasksOf).map(x => [x.id, placeOf(x).after] as const))
  const seen = new Set<string>()
  const stack = [...(after.get(from) ?? [])]
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (id === from) return true
    if (seen.has(id)) continue
    seen.add(id)
    stack.push(...(after.get(id) ?? []))
  }
  return false
}

const apply = (t: Tracker, op: Op, ctx: OpContext): string | OpResult => {
  const feature = (id: string) => t.prd_items.find(i => i.id === id)
  switch (op.op) {
    case 'add_feature': {
      if (op.title.trim() === '') return 'add_feature：標題是空白的'
      const gain = op.gain?.trim() ?? ''
      if (gain.length > GAIN_MAX) return `add_feature：gain 最多 ${GAIN_MAX} 字`
      const id = next(t.prd_items.map(i => i.id), ctx.prefixes.feature)
      t.prd_items.push({
        id,
        title: op.title.trim(),
        status: 'planned',
        priority: op.priority ?? 'P1',
        summary: op.summary.trim(),
        source_refs: [...new Set(op.sources ?? [])],
        acceptance_criteria: [],
        test_case_counts: { total: 0 },
        test_cases: [],
        tasks: [],
        gaps: [],
        ...(gain === '' ? {} : { crew_gain: gain }),
      })
      return { op: op.op, id }
    }
    case 'link_requirements': {
      const item = feature(op.feature)
      if (item === undefined) return `link_requirements：找不到功能 ${op.feature}`
      if (op.requirements.length === 0) return `link_requirements：${op.feature} 沒有指定 PRD 需求編號`
      const bad = op.requirements.find(r => !REQUIREMENT_ID.test(r))
      if (bad !== undefined) return `link_requirements：${bad} 不是 PRD 需求編號（R-…）`
      const had = Array.isArray(item.source_refs) ? (item.source_refs as unknown[]).filter((r): r is string => typeof r === 'string') : []
      item.source_refs = [...new Set([...had, ...op.requirements])]
      // A requirement now answered is back in scope: its drop is taken back.
      for (const d of t.decisions ?? []) {
        const v = d as { requirements?: unknown; status?: unknown }
        if (Array.isArray(v.requirements) && v.requirements.some(r => op.requirements.includes(r as string))) v.status = 'superseded'
      }
      return { op: op.op, id: op.feature }
    }
    case 'drop_requirement': {
      if (op.id.trim() === '') return 'drop_requirement：沒有指定 PRD 需求編號'
      if (!REQUIREMENT_ID.test(op.id)) return `drop_requirement：${op.id} 不是 PRD 需求編號（R-…）`
      recordDecision(t, ctx, { decision: `PRD 需求 ${op.id} 移出範圍：${op.reason}`, reason: op.reason, requirements: [op.id] })
      return { op: op.op, id: op.id }
    }
    case 'add_criterion': {
      const item = feature(op.feature)
      if (item === undefined) return `add_criterion：找不到功能 ${op.feature}`
      if (op.text.trim() === '') return `add_criterion：${op.feature} 的條件內容是空白的`
      // A dropped criterion's id stays taken: test cases and decisions still point at it.
      const used = [
        ...allCriteria(t).map(c => c.id),
        ...t.prd_items.flatMap(i => i.test_cases.flatMap(c => c.acceptance_criteria ?? [])),
        ...(t.decisions ?? []).map(d => (d as { criteria?: unknown }).criteria).filter((c): c is string => typeof c === 'string'),
      ]
      const id = next(used, 'AC-')
      item.acceptance_criteria.push(`[${id}] ${op.text.trim()}`)
      return { op: op.op, id }
    }
    case 'drop_criterion': {
      const item = t.prd_items.find(i => criteriaOf(i).some(c => c.id === op.id))
      if (item === undefined) return `drop_criterion：找不到驗收條件 ${op.id}`
      const index = criteriaOf(item).findIndex(c => c.id === op.id)
      item.acceptance_criteria.splice(index, 1)
      recordDecision(t, ctx, { decision: `${op.id} 移出範圍：${op.reason}`, reason: op.reason, criteria: op.id, feature: item.id })
      return { op: op.op, id: op.id }
    }
    case 'drop_feature': {
      const item = feature(op.id)
      if (item === undefined) return `drop_feature：找不到功能 ${op.id}`
      item.crew_dropped = op.reason
      recordDecision(t, ctx, { decision: `${op.id} ${item.title} 移出範圍：${op.reason}`, reason: op.reason, feature: op.id })
      return { op: op.op, id: op.id }
    }
    case 'add_task': {
      const item = feature(op.feature)
      if (item === undefined) return `add_task：找不到功能 ${op.feature}`
      if (item.crew_dropped !== undefined) return `add_task：${op.feature} 已經移出範圍`
      if (op.title.trim() === '') return `add_task：${op.feature} 的任務標題是空白的`
      if (op.criteria.length === 0) return `add_task：沒有指定這個任務對應的驗收條件`
      const own = new Set(criteriaOf(item).map(c => c.id))
      const foreign = op.criteria.filter(c => !own.has(c))
      if (foreign.length > 0) return `add_task：${foreign.join('、')} 不是 ${op.feature} 的驗收條件`
      if (op.size !== undefined && !SIZES.includes(op.size as TaskSize)) return 'add_task：size 要是 S、M、L 或 XL'
      const place = placeFrom(t, op)
      if (typeof place === 'string') return `add_task：${place}`
      // A dropped task's id stays taken: decisions point at it.
      const id = next(t.prd_items.flatMap(i => tasksOf(i).map(x => x.id)), 'TASK-')
      item.tasks = [
        ...(Array.isArray(item.tasks) ? item.tasks : []),
        { id, title: op.title.trim(), status: 'planned', acceptance_criteria: [...new Set(op.criteria)], detail: op.detail.trim(), ...(op.size === undefined ? {} : { size: op.size }), ...place },
      ]
      return { op: op.op, id }
    }
    case 'set_task': {
      const item = t.prd_items.find(i => tasksOf(i).some(x => x.id === op.id))
      const task = item === undefined ? undefined : tasksOf(item).find(x => x.id === op.id)
      if (item === undefined || task === undefined) return `set_task：找不到任務 ${op.id}`
      if (task.crew_dropped !== undefined) return `set_task：${op.id} 已經移出`
      if ([op.layer, op.part, op.after, op.touches, op.station].every(v => v === undefined)) return `set_task：${op.id} 沒有要改的欄位（layer、part、after、touches、station）`
      const place = placeFrom(t, op, op.id)
      if (typeof place === 'string') return `set_task：${op.id} 的 ${place}`
      item.tasks = item.tasks.map(x => ((x as { id?: unknown } | null)?.id === op.id ? { ...(x as object), ...place } : x))
      if (waitsLoop(t, op.id)) return `set_task：${op.id} 的 after 會讓任務互相等待，繞成一圈`
      return { op: op.op, id: op.id }
    }
    case 'drop_task': {
      const item = t.prd_items.find(i => tasksOf(i).some(x => x.id === op.id))
      if (item === undefined) return `drop_task：找不到任務 ${op.id}`
      item.tasks = item.tasks.map(x => ((x as { id?: unknown } | null)?.id === op.id ? { ...(x as object), crew_dropped: op.reason } : x))
      recordDecision(t, ctx, { decision: `${op.id} 移出：${op.reason}`, reason: op.reason, task: op.id, feature: item.id })
      return { op: op.op, id: op.id }
    }
    case 'add_design': {
      const item = feature(op.feature)
      if (item === undefined) return `add_design：找不到功能 ${op.feature}`
      if (item.crew_dropped !== undefined) return `add_design：${op.feature} 已經移出範圍`
      if (op.title.trim() === '') return `add_design：${op.feature} 的設計稿標題是空白的`
      if (op.kind !== 'screen' && op.kind !== 'none') return 'add_design：kind 要是 screen（有畫面）或 none（沒有畫面）'
      if (op.body.trim() === '') return `add_design：${op.feature} 的設計稿內容是空白的`
      if (op.body.length > DESIGN_MAX) return `add_design：設計稿內容最多 ${DESIGN_MAX} 字`
      if (op.kind === 'screen' && op.html === undefined) return `add_design：${op.feature} 有畫面，要附 html（可以點的 mockup），使用者看了畫面才能核准`
      if (op.kind === 'none' && op.html !== undefined) return `add_design：${op.feature} 沒有畫面，不要附 html`
      const problem = op.html === undefined ? undefined : mockupProblem(op.html)
      if (problem !== undefined) return `add_design：${op.feature} 的 ${problem}`
      // A dropped or sent-back design's id stays taken: threads and decisions point at it.
      const id = next(t.prd_items.flatMap(i => designsOf(i).map(d => d.id)), 'SCR-')
      item.crew_designs = [...(Array.isArray(item.crew_designs) ? item.crew_designs : []), { id, title: op.title.trim(), kind: op.kind, body: op.body.trim(), ...(op.html === undefined ? {} : { crew_mockup: mockupOf(op.html, 1) }), ...(op.html !== undefined && hasMarks(op.html) ? { crew_marked: true as const } : {}) }]
      return { op: op.op, id }
    }
    case 'add_mockup': {
      const item = t.prd_items.find(i => designsOf(i).some(d => d.id === op.id))
      const found = item === undefined ? undefined : designsOf(item).find(d => d.id === op.id)
      if (item === undefined || found === undefined) return `add_mockup：找不到設計稿 ${op.id}`
      if (found.crew_dropped !== undefined) return `add_mockup：${op.id} 已經移出`
      if (found.kind !== 'screen') return `add_mockup：${op.id} 沒有畫面，不用 mockup`
      // A mockup would change what the person already decided on: a new design is drawn with add_design instead.
      if (decisionOf(found) !== undefined) return `add_mockup：使用者已經決定了 ${op.id}，不用補 mockup；要改就用 add_design 畫新的一份`
      const problem = mockupProblem(op.html)
      if (problem !== undefined) return `add_mockup：${op.id} 的 ${problem}`
      const version = (mockupOfDesign(found)?.version ?? 0) + 1
      item.crew_designs = (item.crew_designs ?? []).map(d => {
        if ((d as { id?: unknown } | null)?.id !== op.id) return d
        const { crew_marked: _m, ...rest } = d as Design
        return { ...rest, crew_mockup: mockupOf(op.html, version), ...(hasMarks(op.html) ? { crew_marked: true as const } : {}) }
      })
      return { op: op.op, id: op.id }
    }
    case 'mark_mockup': {
      // Marks where each criterion is seen, on a mockup the person approved: what they approved stays (crew checks the html
      // is that version with marks added before the board hears of it), and so does their approval.
      const item = t.prd_items.find(i => designsOf(i).some(d => d.id === op.id))
      const found = item === undefined ? undefined : designsOf(item).find(d => d.id === op.id)
      if (item === undefined || found === undefined) return `mark_mockup：找不到設計稿 ${op.id}`
      if (found.crew_dropped !== undefined) return `mark_mockup：${op.id} 已經移出`
      if (found.kind !== 'screen' || mockupOfDesign(found) === undefined) return `mark_mockup：${op.id} 沒有 mockup`
      if (decisionOf(found)?.verdict !== 'approved') return `mark_mockup：只用在使用者核准過的設計稿；${op.id} 還沒核准，標記直接寫進 add_mockup 的新版本`
      if (op.html === undefined || !hasMarks(op.html)) return `mark_mockup：${op.id} 沒有加上任何 data-crew-check 標記`
      item.crew_designs = (item.crew_designs ?? []).map(d => ((d as { id?: unknown } | null)?.id === op.id ? { ...(d as object), crew_marked: true as const } : d))
      return { op: op.op, id: op.id }
    }
    case 'drop_design': {
      const item = t.prd_items.find(i => designsOf(i).some(d => d.id === op.id))
      if (item === undefined) return `drop_design：找不到設計稿 ${op.id}`
      item.crew_designs = (item.crew_designs ?? []).map(d => ((d as { id?: unknown } | null)?.id === op.id ? { ...(d as object), crew_dropped: op.reason } : d))
      return { op: op.op, id: op.id }
    }
    case 'propose_check': {
      const tc = t.prd_items.flatMap(i => i.test_cases).find(c => c.id === op.id)
      if (tc === undefined) return `propose_check：找不到 test case ${op.id}`
      if (!(VERIFY_METHODS as readonly string[]).includes(op.method)) return `propose_check：method 要是 ${VERIFY_METHODS.join('、')}（${VERIFY_METHODS.map(m => METHOD_LABEL[m]).join('、')}）`
      const method = op.method as VerifyMethod
      const reason = op.reason.trim()
      if (reason === '') return `propose_check：${op.id} 要寫理由（為什麼適合${METHOD_LABEL[method]}）`
      if (reason.length > PROPOSAL_MAX) return `propose_check：${op.id} 的理由超過 ${PROPOSAL_MAX} 字`
      if (method === methodOf(tc)) return `propose_check：${op.id} 現在就是「${METHOD_LABEL[method]}」`
      tc.qa_proposal = { method, reason, on: ctx.today }
      return { op: op.op, id: op.id }
    }
    case 'add_test_case': {
      const known = new Map(allCriteria(t).map(c => [c.id, c]))
      const missing = op.criteria.filter(id => !known.has(id))
      if (op.criteria.length === 0) return 'add_test_case：沒有指定要覆蓋的驗收條件'
      if (missing.length > 0) return `add_test_case：找不到驗收條件 ${missing.join('、')}`
      if (op.steps.length === 0 || op.expected.trim() === '') return 'add_test_case：步驟或預期結果是空白的'
      const owner = feature(known.get(op.criteria[0] ?? '')?.feature ?? '')
      if (owner === undefined) return 'add_test_case：找不到驗收條件所屬的功能'
      const id = next(t.prd_items.flatMap(i => i.test_cases.map(c => c.id)), ctx.prefixes.testCase)
      owner.test_cases.push({
        id,
        title: op.title.trim(),
        status: 'planned',
        use_cases: op.criteria.map(c => known.get(c)?.text ?? c),
        types: op.types ?? ['manual'],
        role: op.role ?? '使用者',
        fixture: op.fixture ?? '',
        steps: op.steps,
        expected: op.expected.trim(),
        automated_status: 'not_run',
        manual_status: 'pending',
        evidence: [],
        acceptance_criteria: [...op.criteria],
      })
      return { op: op.op, id }
    }
  }
}

/**
 * Applies a role's changes all at once: every op lands, or none does and the
 * errors say why. Ids are numbered after the highest in use.
 */
export const applyOps = (tracker: Tracker, ops: readonly Op[], ctx: OpContext): ApplyResult => {
  const allowed = ALLOWED[ctx.by] ?? []
  const refused = ops.filter(o => !allowed.includes(o.op)).map(o => `${ROLE_LABEL[ctx.by] ?? ctx.by} 不能做 ${o.op}`)
  if (refused.length > 0) return { ok: false, errors: refused }

  const t = JSON.parse(JSON.stringify(tracker)) as Tracker
  const results: OpResult[] = []
  const errors: string[] = []
  for (const op of ops) {
    const r = apply(t, op, ctx)
    if (typeof r === 'string') errors.push(r)
    else results.push(r)
  }
  if (errors.length > 0) return { ok: false, errors }
  recount(t)
  return { ok: true, tracker: t, results }
}

/** `shown`: a PRD requirement's own number, which the person reads in place of crew's id. */
export type GateGap = { id: string; title: string; feature?: string; shown?: string }

export type GateResult = { covered: number; total: number; gaps: GateGap[] }

/** G1: every feature in scope has at least one acceptance criterion. */
export const gateG1 = (t: Tracker): GateResult => {
  const items = inScope(t)
  const gaps = items.filter(i => criteriaOf(i).length === 0).map(i => ({ id: i.id, title: i.title }))
  return { covered: items.length - gaps.length, total: items.length, gaps }
}

/** G4: every acceptance criterion of a feature in scope has at least one test case. */
export const gateG4 = (t: Tracker): GateResult => {
  const linked = new Set(t.prd_items.flatMap(i => i.test_cases.flatMap(c => c.acceptance_criteria ?? [])))
  const criteria = inScope(t).flatMap(criteriaOf)
  const gaps = criteria.filter(c => !linked.has(c.id)).map(c => ({ id: c.id, title: c.text, feature: c.feature }))
  return { covered: criteria.length - gaps.length, total: criteria.length, gaps }
}

/** G3: every acceptance criterion of a feature in scope has at least one task in the plan. */
export const gateG3 = (t: Tracker): GateResult => {
  const planned = new Set(inScope(t).flatMap(i => tasksOf(i).filter(x => x.crew_dropped === undefined).flatMap(x => x.acceptance_criteria)))
  const criteria = inScope(t).flatMap(criteriaOf)
  const gaps = criteria.filter(c => !planned.has(c.id)).map(c => ({ id: c.id, title: c.text, feature: c.feature }))
  return { covered: criteria.length - gaps.length, total: criteria.length, gaps }
}

/** The test cases that count: of a feature in scope, covering a criterion that is still there. */
export const liveCasesOf = (t: Tracker): TestCase[] => {
  const criteria = new Set(inScope(t).flatMap(criteriaOf).map(c => c.id))
  return inScope(t).flatMap(i => i.test_cases.filter(c => (c.acceptance_criteria ?? []).some(a => criteria.has(a))))
}

/** crew's result for a test case, when the mark is one crew could have written. */
export const resultOf = (tc: TestCase): TestResult | undefined => {
  const r = tc.crew_result as Partial<TestResult> | undefined
  if (typeof r !== 'object' || r === null || (r.result !== 'passed' && r.result !== 'failed') || typeof r.sha !== 'string' || typeof r.run !== 'string') return undefined
  return { result: r.result, sha: r.sha, run: r.run, ...(r.stale === true ? { stale: true as const } : {}), ...(typeof r.by === 'string' ? { by: r.by } : {}) }
}

/** Why crew's latest run gave the test case no result, when the mark is one crew could have written. */
export const noneOf = (tc: TestCase): NoneMark | undefined => {
  const r = tc.crew_none as Partial<NoneMark> | undefined
  if (typeof r !== 'object' || r === null || !NONE_WHYS.includes(r.why as NoneWhy) || typeof r.run !== 'string') return undefined
  return { why: r.why as NoneWhy, run: r.run, ...(typeof r.dir === 'string' ? { dir: r.dir } : {}), ...(r.why === 'unreached' && NONE_CAUSES.includes(r.cause as NoneCause) ? { cause: r.cause as NoneCause } : {}) }
}

/** Whether crew's latest run left the test case with no result for a reason the person is not asked about (QUIET_CAUSES). */
export const quietNone = (tc: TestCase): boolean => {
  const n = noneOf(tc)
  return n?.cause !== undefined && QUIET_CAUSES.includes(n.cause)
}

const VERIFY_METHODS: readonly VerifyMethod[] = ['command', 'qa', 'accept']

/** The longest QA's reason for a proposal is: the person reads each on the card. */
const PROPOSAL_MAX = 300

/** How the test case is verified now: another way only where crew wrote the person's setting on it. */
export const methodOf = (tc: TestCase): VerifyMethod => (tc.crew_method === 'qa' || tc.crew_method === 'accept' ? tc.crew_method : 'command')

/** The evidence of the way the test case is verified now, when the mark is one crew could have written for it. */
export const checkOf = (tc: TestCase): CheckMark | undefined => {
  const r = tc.crew_check as Partial<CheckMark> | undefined
  const method = methodOf(tc)
  if (typeof r !== 'object' || r === null || method === 'command' || r.method !== method || (r.result !== 'passed' && r.result !== 'failed') || typeof r.at !== 'number') return undefined
  return {
    method,
    result: r.result,
    at: r.at,
    ...(typeof r.round === 'number' ? { round: r.round } : {}),
    ...(typeof r.sha === 'string' ? { sha: r.sha } : {}),
    ...(typeof r.shot === 'string' ? { shot: r.shot } : {}),
    ...(typeof r.note === 'string' ? { note: r.note } : {}),
    ...(r.stale === true ? { stale: true as const } : {}),
  }
}

/** QA's proposal on the test case still open: one of another way than the one it has now. */
export const proposalOf = (tc: TestCase): Proposal | undefined => {
  const p = tc.qa_proposal as Partial<Proposal> | undefined
  if (typeof p !== 'object' || p === null || !VERIFY_METHODS.includes(p.method as VerifyMethod) || typeof p.reason !== 'string' || p.method === methodOf(tc)) return undefined
  return { method: p.method as VerifyMethod, reason: p.reason, on: typeof p.on === 'string' ? p.on : '' }
}

/** QA's proposal on the test case still waiting for the person: open, and not one they said no to. */
export const openProposalOf = (tc: TestCase): Proposal | undefined => (tc.crew_declined === true ? undefined : proposalOf(tc))

/** The test case passed in crew's latest run, on crew's branch as it stands. */
export const passedNow = (tc: TestCase): boolean => {
  const r = resultOf(tc)
  return r?.result === 'passed' && r.stale !== true
}

/** The test case failed in crew's latest run, on crew's branch as it stands. */
export const failedNow = (tc: TestCase): boolean => {
  const r = resultOf(tc)
  return r?.result === 'failed' && r.stale !== true
}

/**
 * The test case has passed by the way it is verified, on crew's branch as it
 * stands: by the test commands, a pass in crew's latest run; by QA, QA's pass
 * with its screenshot on the feature's newest commits; by the person, their
 * tick when they passed the feature. A failure in crew's run of the test
 * commands fails it whatever the way: no source failing is let pass.
 */
export const g6PassedNow = (tc: TestCase): boolean => {
  const method = methodOf(tc)
  if (method === 'command') return passedNow(tc)
  if (failedNow(tc)) return false
  const c = checkOf(tc)
  return c?.result === 'passed' && c.stale !== true
}

/** The test case failed by any way crew has for it: crew's run of the test commands, or the other way's evidence (QA's failure). */
export const g6FailedNow = (tc: TestCase): boolean => {
  if (failedNow(tc)) return true
  const c = checkOf(tc)
  return c?.result === 'failed' && c.stale !== true
}

/**
 * G6's gaps told apart: the test cases that failed in crew's latest run of
 * the test commands (whatever their way), and of those verified by the test
 * commands, those the run gave no result for (none in its output: rerunning
 * the same commit changes nothing) and those whose result is from an older
 * commit (crew's branch moved since: another run has them). Those verified
 * another way wait for QA (`qa`) or the person (`accept`), not for a run.
 */
export const g6Split = (t: Tracker): { failed: TestCase[]; missing: TestCase[]; stale: TestCase[]; qa: TestCase[]; accept: TestCase[] } => {
  const gaps = liveCasesOf(t).filter(c => !g6PassedNow(c))
  const failed = gaps.filter(failedNow)
  const others = gaps.filter(c => !failedNow(c))
  const commands = others.filter(c => methodOf(c) === 'command')
  return {
    failed,
    missing: commands.filter(c => resultOf(c) === undefined),
    stale: commands.filter(c => resultOf(c)?.stale === true),
    qa: others.filter(c => methodOf(c) === 'qa'),
    accept: others.filter(c => methodOf(c) === 'accept'),
  }
}

/**
 * G6: every test case that counts passed, with its evidence, by the way it is
 * verified: crew's latest run of the person's test commands on the newest
 * commit, QA's report with a screenshot, or the person's tick at acceptance.
 */
export const gateG6 = (t: Tracker): GateResult => {
  const cases = liveCasesOf(t)
  const feature = new Map(t.prd_items.flatMap(i => i.test_cases.map(c => [c.id, i.id] as const)))
  const gaps = cases.filter(c => !g6PassedNow(c)).map(c => ({ id: c.id, title: typeof c.title === 'string' ? c.title : c.id, feature: feature.get(c.id) ?? '' }))
  return { covered: cases.length - gaps.length, total: cases.length, gaps }
}

/** The test cases of a feature that count and that the person set to confirm themselves when they accept it. */
export const acceptCasesOf = (t: Tracker, feature: string): TestCase[] => {
  const item = t.prd_items.find(i => i.id === feature)
  if (item === undefined) return []
  const own = new Set(item.test_cases.map(c => c.id))
  return liveCasesOf(t).filter(c => own.has(c.id) && methodOf(c) === 'accept')
}

/** The commits a feature's tasks stand at, task by task: QA's evidence covers the feature as built at these. */
export const featureTips = (tasks: readonly Task[]): string => tasks.map(t => `${t.id}:${tipOf(t) ?? ''}`).join(',')

/** A feature's tasks in the plan, in its own order: none when it has none, or is out of scope. */
export const planTasksOf = (t: Tracker, feature: string): Task[] => {
  const item = t.prd_items.find(i => i.id === feature && i.crew_dropped === undefined)
  return item === undefined ? [] : tasksOf(item).filter(x => x.crew_dropped === undefined)
}

/** G2: every feature in scope has a design the person approved: a screen, or no screen with why. */
export const gateG2 = (t: Tracker): GateResult => {
  const items = inScope(t)
  const gaps = items.filter(i => !liveDesignsOf(i).some(d => decisionOf(d)?.verdict === 'approved')).map(i => ({ id: i.id, title: i.title }))
  return { covered: items.length - gaps.length, total: items.length, gaps }
}

/** G5: every task in the plan has its newest commit approved by the tech lead. */
export const gateG5 = (t: Tracker): GateResult => {
  const tasks = liveTasksOf(t)
  const feature = new Map(t.prd_items.flatMap(i => tasksOf(i).map(x => [x.id, i.id] as const)))
  const gaps = tasks.filter(x => !approvedNow(x)).map(x => ({ id: x.id, title: x.title, feature: feature.get(x.id) ?? '' }))
  return { covered: tasks.length - gaps.length, total: tasks.length, gaps }
}

/** How a test case went, for the roles: passed, failed, or out of date; verified another way, which way, and QA's proposal open on it. */
const caseMark = (tc: TestCase): string => {
  const method = methodOf(tc)
  const p = openProposalOf(tc)
  const proposed = p === undefined ? '' : `（QA 提議改成${METHOD_LABEL[p.method]}，等使用者決定）`
  if (method !== 'command') {
    const c = checkOf(tc)
    const how = failedNow(tc) ? ' ✗' : c === undefined ? '' : c.stale === true ? '（證據過期）' : c.result === 'passed' ? ' ✓' : ' ✗'
    return `［${METHOD_LABEL[method]}］${how}${proposed}`
  }
  const r = resultOf(tc)
  if (r === undefined) return proposed
  return `${r.stale === true ? '（結果過期）' : r.result === 'passed' ? ' ✓' : ' ✗'}${proposed}`
}

/** Where a task's code stands, for the roles: its newest commit and the review of it. */
const workOf = (x: Task): string => {
  const tip = tipOf(x)
  if (tip === undefined) return ''
  const r = reviewOf(x)
  const review =
    r === undefined ? '等 review' : r.sha !== tip ? 'review 過期（新的 commit 還沒 review）' : r.verdict === 'approve' ? 'review 通過' : `review 要修改${r.notes === undefined ? '' : `：${r.notes}`}`
  return ` · commit ${tip.slice(0, 7)} · ${review}`
}

/** Where a task sits, for the roles: its side and part, its station, what it waits for, the files it changes. */
const placeText = (x: Task, full: boolean): string => {
  const p = placeOf(x)
  const bits = [
    p.layer === undefined ? '還沒分層' : `${LAYER_LABEL[p.layer]}${p.part === undefined ? '' : `／${p.part}`}`,
    ...(p.station === undefined ? [] : [STATION_LABEL[p.station]]),
    ...(p.after.length === 0 ? [] : [`等 ${p.after.join('、')}`]),
    ...(p.touches.length === 0 ? [] : [full ? `改 ${p.touches.join('、')}` : `改 ${p.touches.length} 個路徑`]),
  ]
  return ` [${bits.join(' · ')}]`
}

/** The board as compact text for a role to read: ids first, nothing it does not need. */
export const renderBoard = (t: Tracker, scope: { feature?: string } = {}): string => {
  const items = t.prd_items.filter(i => scope.feature === undefined || i.id === scope.feature)
  if (items.length === 0) return scope.feature === undefined ? '看板是空的。' : `找不到功能 ${scope.feature}。`
  const lines: string[] = []
  // Tasks show once the tech lead has planned any: before that they would only be noise.
  const planning = t.prd_items.some(i => tasksOf(i).length > 0)
  for (const item of items) {
    if (item.crew_dropped !== undefined) {
      lines.push(`${item.id} ${item.title} — 移出範圍：${item.crew_dropped}`)
      continue
    }
    const refs = refsOf(item)
    lines.push(`${item.id} ${item.title} [${item.status}] ← ${refs.length === 0 ? '還沒有對應的 PRD 需求' : refs.join('、')}`)
    const gain = gainOf(item)
    if (scope.feature !== undefined && gain !== undefined) lines.push(`  做完使用者可以：${gain}`)
    const criteria = criteriaOf(item)
    if (criteria.length === 0) lines.push('  （還沒有驗收條件）')
    for (const c of criteria) {
      const cases = t.prd_items.flatMap(i => i.test_cases).filter(tc => (tc.acceptance_criteria ?? []).includes(c.id))
      const tasks = tasksOf(item).filter(x => x.crew_dropped === undefined && x.acceptance_criteria.includes(c.id))
      const plan = planning ? ` · ${tasks.length === 0 ? '還沒有任務' : `任務 ${tasks.map(x => x.id).join(', ')}`}` : ''
      lines.push(`  ${c.id} ${c.text} ← ${cases.length === 0 ? '沒有 test case' : cases.map(tc => `${tc.id}${caseMark(tc)}`).join(', ')}${plan}`)
    }
    for (const d of designsOf(item)) {
      const decision = decisionOf(d)
      const where = decision === undefined ? '等你核准' : decision.verdict === 'approved' ? '你核准了' : `你退回了${decision.reason === undefined ? '' : `：${decision.reason}`}`
      const mockup = d.kind !== 'screen' ? '' : mockupOfDesign(d) !== undefined ? ` · mockup 第 ${mockupOfDesign(d)?.version} 版` : decision === undefined ? ' · 還沒有 mockup' : ''
      lines.push(d.crew_dropped !== undefined ? `  設計 ${d.id} ${d.title} — 移出：${d.crew_dropped}` : `  設計 ${d.id} ${d.title}（${d.kind === 'screen' ? '畫面' : '沒有畫面'}）· ${where}${mockup}`)
      // One feature's view carries the design itself; the whole board names it only.
      if (scope.feature !== undefined && d.crew_dropped === undefined) lines.push(d.body.split('\n').map(l => `    ${l}`).join('\n'))
    }
    for (const x of tasksOf(item)) {
      const size = x.size === undefined ? '' : `（${x.size}）`
      lines.push(
        x.crew_dropped !== undefined
          ? `  任務 ${x.id} ${x.title} — 移出：${x.crew_dropped}`
          : `  任務 ${x.id} ${x.title}${size}← ${x.acceptance_criteria.join('、')}${x.detail === '' ? '' : `：${x.detail}`}${workOf(x)}${placeText(x, scope.feature !== undefined)}`,
      )
    }
  }
  const dropped = [...droppedRequirements(t)]
  if (scope.feature === undefined && dropped.length > 0) lines.push(`移出範圍的 PRD 需求：${dropped.map(([id, reason]) => `${id}（${reason}）`).join('、')}`)
  return lines.join('\n')
}

const OP_NAMES = ['add_feature', 'add_criterion', 'drop_criterion', 'drop_feature', 'link_requirements', 'drop_requirement', 'add_test_case', 'propose_check', 'add_task', 'set_task', 'drop_task', 'add_design', 'add_mockup', 'mark_mockup', 'drop_design'] as const

const isText = (v: unknown): v is string => typeof v === 'string'
const isTextList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isText)

/** Where a task sits, as the model wrote it: the fields given with the right types, or which one is wrong. */
const parsePlace = (o: Record<string, unknown>): TaskPlace | string => {
  const place: TaskPlace = {}
  for (const key of ['layer', 'part', 'station'] as const) {
    const v = o[key]
    if (v === undefined) continue
    if (!isText(v)) return `${key} 要是字串`
    place[key] = v
  }
  for (const key of ['after', 'touches'] as const) {
    const v = o[key]
    if (v === undefined) continue
    if (!isTextList(v)) return `${key} 要是字串陣列`
    place[key] = v
  }
  return place
}

/**
 * Checks ops as a model wrote them: each one names a known op and carries
 * its fields with the right types. The error says which op misses what.
 */
export const parseOps = (raw: unknown): { ok: true; ops: Op[] } | { ok: false; error: string } => {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: 'ops 要是一個非空的陣列。' }
  const ops: Op[] = []
  const errors: string[] = []
  raw.forEach((entry, i) => {
    const at = `第 ${i + 1} 筆`
    if (typeof entry !== 'object' || entry === null) {
      errors.push(`${at} 不是物件`)
      return
    }
    const o = entry as Record<string, unknown>
    const name = o.op
    if (!OP_NAMES.includes(name as (typeof OP_NAMES)[number])) {
      errors.push(`${at} 的 op「${String(name)}」不存在，可用：${OP_NAMES.join('、')}`)
      return
    }
    const need = (keys: readonly string[]) => keys.filter(k => !isText(o[k]))
    switch (name) {
      case 'add_feature': {
        if (!isText(o.title)) errors.push(`${at} add_feature 缺少 title`)
        else if (o.priority !== undefined && !['P0', 'P1', 'P2'].includes(String(o.priority))) errors.push(`${at} add_feature 的 priority 要是 P0、P1 或 P2`)
        else if (o.sources !== undefined && !isTextList(o.sources)) errors.push(`${at} add_feature 的 sources 要是 PRD 需求編號的陣列`)
        else if (o.gain !== undefined && !isText(o.gain)) errors.push(`${at} add_feature 的 gain 要是字串`)
        else
          ops.push({
            op: 'add_feature',
            title: o.title,
            ...(isTextList(o.sources) ? { sources: o.sources } : {}),
            summary: isText(o.summary) ? o.summary : '',
            ...(o.priority === undefined ? {} : { priority: o.priority as 'P0' | 'P1' | 'P2' }),
            ...(isText(o.gain) ? { gain: o.gain } : {}),
          })
        return
      }
      case 'add_criterion': {
        const missing = need(['feature', 'text'])
        if (missing.length > 0) errors.push(`${at} add_criterion 缺少 ${missing.join('、')}`)
        else ops.push({ op: 'add_criterion', feature: o.feature as string, text: o.text as string })
        return
      }
      case 'link_requirements': {
        if (!isText(o.feature)) errors.push(`${at} link_requirements 缺少 feature`)
        else if (!isTextList(o.requirements)) errors.push(`${at} link_requirements 的 requirements 要是 PRD 需求編號的陣列`)
        else ops.push({ op: 'link_requirements', feature: o.feature, requirements: o.requirements })
        return
      }
      case 'add_task': {
        const place = parsePlace(o)
        if (!isText(o.feature)) errors.push(`${at} add_task 缺少 feature`)
        else if (!isText(o.title)) errors.push(`${at} add_task 缺少 title`)
        else if (!isTextList(o.criteria)) errors.push(`${at} add_task 的 criteria 要是驗收條件編號的陣列`)
        else if (o.size !== undefined && !isText(o.size)) errors.push(`${at} add_task 的 size 要是 S、M、L 或 XL`)
        else if (typeof place === 'string') errors.push(`${at} add_task 的 ${place}`)
        else ops.push({ op: 'add_task', feature: o.feature, criteria: o.criteria, title: o.title, detail: isText(o.detail) ? o.detail : '', ...(isText(o.size) ? { size: o.size } : {}), ...place })
        return
      }
      case 'set_task': {
        const place = parsePlace(o)
        if (!isText(o.id)) errors.push(`${at} set_task 缺少 id`)
        else if (typeof place === 'string') errors.push(`${at} set_task 的 ${place}`)
        else ops.push({ op: 'set_task', id: o.id, ...place })
        return
      }
      case 'add_design': {
        const missing = need(['feature', 'title', 'kind', 'body'])
        if (missing.length > 0) errors.push(`${at} add_design 缺少 ${missing.join('、')}`)
        else if (o.html !== undefined && !isText(o.html)) errors.push(`${at} add_design 的 html 要是字串`)
        else ops.push({ op: 'add_design', feature: o.feature as string, title: o.title as string, kind: o.kind as string, body: o.body as string, ...(isText(o.html) ? { html: o.html } : {}) })
        return
      }
      case 'add_mockup': {
        const missing = need(['id', 'html'])
        if (missing.length > 0) errors.push(`${at} add_mockup 缺少 ${missing.join('、')}`)
        else ops.push({ op: 'add_mockup', id: o.id as string, html: o.html as string })
        return
      }
      case 'mark_mockup': {
        const missing = need(['id'])
        const marks = Array.isArray(o.marks) ? o.marks : undefined
        const ok = (m: unknown): m is MockupMark => {
          if (typeof m !== 'object' || m === null) return false
          const x = m as Record<string, unknown>
          const ids = (v: unknown) => v === undefined || (typeof v === 'string' && MARK_IDS.test(v.trim()))
          return typeof x.at === 'string' && ids(x.check) && ids(x.show) && (x.check !== undefined || x.show !== undefined)
        }
        if (missing.length > 0) errors.push(`${at} mark_mockup 缺少 ${missing.join('、')}`)
        else if (marks === undefined || marks.length === 0 || marks.length > MARKS_MAX) errors.push(`${at} mark_mockup 的 marks 要是 1 到 ${MARKS_MAX} 筆的陣列`)
        else if (!marks.every(ok)) errors.push(`${at} mark_mockup 的每一筆 mark 要有 at（元素開頭的標籤文字），以及 check 或 show（驗收條件編號，多條用空白分開）`)
        else ops.push({ op: 'mark_mockup', id: o.id as string, marks: marks.map(m => ({ at: m.at, ...(m.check === undefined ? {} : { check: m.check.trim() }), ...(m.show === undefined ? {} : { show: m.show.trim() }) })) })
        return
      }
      case 'propose_check': {
        const missing = need(['id', 'method', 'reason'])
        if (missing.length > 0) errors.push(`${at} propose_check 缺少 ${missing.join('、')}`)
        else ops.push({ op: 'propose_check', id: o.id as string, method: o.method as string, reason: o.reason as string })
        return
      }
      case 'drop_design':
      case 'drop_task':
      case 'drop_requirement':
      case 'drop_criterion':
      case 'drop_feature': {
        const missing = need(['id', 'reason'])
        if (missing.length > 0) errors.push(`${at} ${name} 缺少 ${missing.join('、')}`)
        else ops.push({ op: name, id: o.id as string, reason: o.reason as string })
        return
      }
      default: {
        if (!isTextList(o.criteria)) errors.push(`${at} add_test_case 的 criteria 要是驗收條件編號的陣列`)
        else if (!isTextList(o.steps)) errors.push(`${at} add_test_case 的 steps 要是字串陣列`)
        else if (!isText(o.title) || !isText(o.expected)) errors.push(`${at} add_test_case 缺少 title 或 expected`)
        else
          ops.push({
            op: 'add_test_case',
            criteria: o.criteria,
            title: o.title,
            steps: o.steps,
            expected: o.expected,
            ...(isTextList(o.types) ? { types: o.types } : {}),
            ...(isText(o.role) ? { role: o.role } : {}),
            ...(isText(o.fixture) ? { fixture: o.fixture } : {}),
          })
      }
    }
  })
  return errors.length > 0 ? { ok: false, error: errors.join('\n') } : { ok: true, ops }
}
