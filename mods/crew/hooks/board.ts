/**
 * The board is the repo's prd-tracker.json, in the shape the progress-dashboard
 * skill and its schema use. crew only touches what it owns and keeps every
 * field it does not know.
 */

import { droppedRequirements, refsOf, REQUIREMENT_ID } from './prd'

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
  [key: string]: unknown
}

/** A test case's result in a run crew made: on which commit, which run (its log), and whether a newer commit came since. */
export type TestResult = { result: 'passed' | 'failed'; sha: string; run: string; stale?: true }

export type TaskSize = 'S' | 'M' | 'L' | 'XL'

/** A piece of work the tech lead breaks criteria into: what to build, for which criteria, how big. */
export type Task = {
  id: string
  title: string
  status: string
  /** The criteria this task serves, by id: crew's link for G3. */
  acceptance_criteria: string[]
  detail: string
  size?: TaskSize
  /** Why the task left the plan, when it did. */
  crew_dropped?: string
  /** The commits on crew's branch that do this task, as crew read them from git, newest first. */
  crew_commits?: string[]
  /** The tech lead's last review of the task, as crew recorded it. */
  crew_review?: TaskReview
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
  [key: string]: unknown
}

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
  | { op: 'add_feature'; title: string; summary: string; priority?: 'P0' | 'P1' | 'P2'; sources?: string[] }
  | { op: 'link_requirements'; feature: string; requirements: string[] }
  | { op: 'drop_requirement'; id: string; reason: string }
  | { op: 'add_criterion'; feature: string; text: string }
  | { op: 'drop_criterion'; id: string; reason: string }
  | { op: 'drop_feature'; id: string; reason: string }
  | { op: 'add_task'; feature: string; criteria: string[]; title: string; detail: string; size?: string }
  | { op: 'drop_task'; id: string; reason: string }
  | { op: 'add_design'; feature: string; title: string; kind: string; body: string }
  | { op: 'drop_design'; id: string; reason: string }
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

/** `taken`: ids in use outside the board, such as decisions kept in crew's memory. */
export type OpContext = { by: string; today: string; prefixes: Prefixes; taken?: readonly string[] }

export type OpResult = { op: Op['op']; id?: string }

export type ApplyResult = { ok: true; tracker: Tracker; results: OpResult[] } | { ok: false; errors: string[] }

/** Which ops each role may make. */
const ALLOWED: Record<string, readonly Op['op'][]> = {
  pm: ['add_feature', 'add_criterion', 'drop_criterion', 'drop_feature', 'link_requirements', 'drop_requirement'],
  qa: ['add_test_case'],
  techlead: ['add_task', 'drop_task'],
  uiux: ['add_design', 'drop_design'],
}

const ROLE_LABEL: Record<string, string> = { pm: 'PM', qa: 'QA', techlead: 'Tech lead', fullstack: '全端', uiux: 'UI/UX' }

/** The longest a design may be: it lives on the board, which every role reads. */
const DESIGN_MAX = 6000

const SIZES: readonly TaskSize[] = ['S', 'M', 'L', 'XL']

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

/** A board crew can read. */
export const isTracker = (v: unknown): v is Tracker => trackerProblem(v) === undefined

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

const apply = (t: Tracker, op: Op, ctx: OpContext): string | OpResult => {
  const feature = (id: string) => t.prd_items.find(i => i.id === id)
  switch (op.op) {
    case 'add_feature': {
      if (op.title.trim() === '') return 'add_feature：標題是空白的'
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
      // A dropped task's id stays taken: decisions point at it.
      const id = next(t.prd_items.flatMap(i => tasksOf(i).map(x => x.id)), 'TASK-')
      item.tasks = [
        ...(Array.isArray(item.tasks) ? item.tasks : []),
        { id, title: op.title.trim(), status: 'planned', acceptance_criteria: [...new Set(op.criteria)], detail: op.detail.trim(), ...(op.size === undefined ? {} : { size: op.size }) },
      ]
      return { op: op.op, id }
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
      // A dropped or sent-back design's id stays taken: threads and decisions point at it.
      const id = next(t.prd_items.flatMap(i => designsOf(i).map(d => d.id)), 'SCR-')
      item.crew_designs = [...(Array.isArray(item.crew_designs) ? item.crew_designs : []), { id, title: op.title.trim(), kind: op.kind, body: op.body.trim() }]
      return { op: op.op, id }
    }
    case 'drop_design': {
      const item = t.prd_items.find(i => designsOf(i).some(d => d.id === op.id))
      if (item === undefined) return `drop_design：找不到設計稿 ${op.id}`
      item.crew_designs = (item.crew_designs ?? []).map(d => ((d as { id?: unknown } | null)?.id === op.id ? { ...(d as object), crew_dropped: op.reason } : d))
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

export type GateGap = { id: string; title: string; feature?: string }

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
  return { result: r.result, sha: r.sha, run: r.run, ...(r.stale === true ? { stale: true as const } : {}) }
}

/** The test case passed in crew's latest run, on crew's branch as it stands. */
export const passedNow = (tc: TestCase): boolean => {
  const r = resultOf(tc)
  return r?.result === 'passed' && r.stale !== true
}

/** G6: every test case that counts passed in crew's latest run of the person's test command, on the newest commit. */
export const gateG6 = (t: Tracker): GateResult => {
  const cases = liveCasesOf(t)
  const feature = new Map(t.prd_items.flatMap(i => i.test_cases.map(c => [c.id, i.id] as const)))
  const gaps = cases.filter(c => !passedNow(c)).map(c => ({ id: c.id, title: typeof c.title === 'string' ? c.title : c.id, feature: feature.get(c.id) ?? '' }))
  return { covered: cases.length - gaps.length, total: cases.length, gaps }
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

/** How a test case went in crew's latest run, for the roles: passed, failed, or out of date. */
const caseMark = (tc: TestCase): string => {
  const r = resultOf(tc)
  if (r === undefined) return ''
  return r.stale === true ? '（結果過期）' : r.result === 'passed' ? ' ✓' : ' ✗'
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
      lines.push(d.crew_dropped !== undefined ? `  設計 ${d.id} ${d.title} — 移出：${d.crew_dropped}` : `  設計 ${d.id} ${d.title}（${d.kind === 'screen' ? '畫面' : '沒有畫面'}）· ${where}`)
      // One feature's view carries the design itself; the whole board names it only.
      if (scope.feature !== undefined && d.crew_dropped === undefined) lines.push(d.body.split('\n').map(l => `    ${l}`).join('\n'))
    }
    for (const x of tasksOf(item)) {
      const size = x.size === undefined ? '' : `（${x.size}）`
      lines.push(
        x.crew_dropped !== undefined
          ? `  任務 ${x.id} ${x.title} — 移出：${x.crew_dropped}`
          : `  任務 ${x.id} ${x.title}${size}← ${x.acceptance_criteria.join('、')}${x.detail === '' ? '' : `：${x.detail}`}${workOf(x)}`,
      )
    }
  }
  const dropped = [...droppedRequirements(t)]
  if (scope.feature === undefined && dropped.length > 0) lines.push(`移出範圍的 PRD 需求：${dropped.map(([id, reason]) => `${id}（${reason}）`).join('、')}`)
  return lines.join('\n')
}

const OP_NAMES = ['add_feature', 'add_criterion', 'drop_criterion', 'drop_feature', 'link_requirements', 'drop_requirement', 'add_test_case', 'add_task', 'drop_task', 'add_design', 'drop_design'] as const

const isText = (v: unknown): v is string => typeof v === 'string'
const isTextList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isText)

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
        else
          ops.push({
            op: 'add_feature',
            title: o.title,
            ...(isTextList(o.sources) ? { sources: o.sources } : {}),
            summary: isText(o.summary) ? o.summary : '',
            ...(o.priority === undefined ? {} : { priority: o.priority as 'P0' | 'P1' | 'P2' }),
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
        if (!isText(o.feature)) errors.push(`${at} add_task 缺少 feature`)
        else if (!isText(o.title)) errors.push(`${at} add_task 缺少 title`)
        else if (!isTextList(o.criteria)) errors.push(`${at} add_task 的 criteria 要是驗收條件編號的陣列`)
        else if (o.size !== undefined && !isText(o.size)) errors.push(`${at} add_task 的 size 要是 S、M、L 或 XL`)
        else ops.push({ op: 'add_task', feature: o.feature, criteria: o.criteria, title: o.title, detail: isText(o.detail) ? o.detail : '', ...(isText(o.size) ? { size: o.size } : {}) })
        return
      }
      case 'add_design': {
        const missing = need(['feature', 'title', 'kind', 'body'])
        if (missing.length > 0) errors.push(`${at} add_design 缺少 ${missing.join('、')}`)
        else ops.push({ op: 'add_design', feature: o.feature as string, title: o.title as string, kind: o.kind as string, body: o.body as string })
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
