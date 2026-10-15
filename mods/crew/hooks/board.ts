/**
 * The board is the repo's prd-tracker.json, in the shape the progress-dashboard
 * skill and its schema use. crew only touches what it owns and keeps every
 * field it does not know.
 */

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
  [key: string]: unknown
}

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
  | { op: 'add_feature'; title: string; summary: string; priority?: 'P0' | 'P1' | 'P2' }
  | { op: 'add_criterion'; feature: string; text: string }
  | { op: 'drop_criterion'; id: string; reason: string }
  | { op: 'drop_feature'; id: string; reason: string }
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

export type OpContext = { by: string; today: string; prefixes: Prefixes }

export type OpResult = { op: Op['op']; id?: string }

export type ApplyResult = { ok: true; tracker: Tracker; results: OpResult[] } | { ok: false; errors: string[] }

/** Which ops each role may make. */
const ALLOWED: Record<string, readonly Op['op'][]> = {
  pm: ['add_feature', 'add_criterion', 'drop_criterion', 'drop_feature'],
  qa: ['add_test_case'],
}

const ROLE_LABEL: Record<string, string> = { pm: 'PM', qa: 'QA' }

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
  t.decisions.push({ id: next(decisionIds(t), 'DEC-'), date: ctx.today, status: 'accepted', by: ctx.by, ...decision })
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
        source_refs: [],
        acceptance_criteria: [],
        test_case_counts: { total: 0 },
        test_cases: [],
        tasks: [],
        gaps: [],
      })
      return { op: op.op, id }
    }
    case 'add_criterion': {
      const item = feature(op.feature)
      if (item === undefined) return `add_criterion：找不到功能 ${op.feature}`
      if (op.text.trim() === '') return `add_criterion：${op.feature} 的條件內容是空白的`
      const id = next(allCriteria(t).map(c => c.id), 'AC-')
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

/** The board as compact text for a role to read: ids first, nothing it does not need. */
export const renderBoard = (t: Tracker, scope: { feature?: string } = {}): string => {
  const items = t.prd_items.filter(i => scope.feature === undefined || i.id === scope.feature)
  if (items.length === 0) return scope.feature === undefined ? '看板是空的。' : `找不到功能 ${scope.feature}。`
  const lines: string[] = []
  for (const item of items) {
    if (item.crew_dropped !== undefined) {
      lines.push(`${item.id} ${item.title} — 移出範圍：${item.crew_dropped}`)
      continue
    }
    lines.push(`${item.id} ${item.title} [${item.status}]`)
    const criteria = criteriaOf(item)
    if (criteria.length === 0) lines.push('  （還沒有驗收條件）')
    for (const c of criteria) {
      const cases = t.prd_items.flatMap(i => i.test_cases).filter(tc => (tc.acceptance_criteria ?? []).includes(c.id))
      lines.push(`  ${c.id} ${c.text} ← ${cases.length === 0 ? '沒有 test case' : cases.map(tc => tc.id).join(', ')}`)
    }
  }
  return lines.join('\n')
}

const OP_NAMES = ['add_feature', 'add_criterion', 'drop_criterion', 'drop_feature', 'add_test_case'] as const

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
        else
          ops.push({
            op: 'add_feature',
            title: o.title,
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
