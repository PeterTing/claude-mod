import type { RoleId, Tier } from './model'

/** What a role is asked to do, and what sizes it. */
export type TaskKind = 'split_prd' | 'write_tests' | 'add_tests' | 'confirm_gaps'

export type TaskSignals = {
  kind: TaskKind
  /** split_prd: the PRD's length in characters; the others: how many criteria. */
  size: number
  /** Text to look for risky areas in: the PRD, the item, the criteria. */
  text?: string
  /** Times this item already failed (tests, review). */
  failures?: number
}

export type Route = {
  tier: Tier
  model: string
  label: string
  effort: Effort
  /** Context tokens before the role is rotated. */
  limit: number
}

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
type Model = 'haiku' | 'sonnet' | 'opus'

const TIERS: readonly Tier[] = ['S', 'M', 'L', 'XL']
const MODELS: readonly Model[] = ['haiku', 'sonnet', 'opus']
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

const MODEL_IDS: Record<Model, string> = {
  haiku: 'claude-haiku-5-5',
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
}
const MODEL_LABELS: Record<Model, string> = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus' }

/** The size steps of each kind of task: at or under the first, S; the second, M; the third, L; over, XL. */
const STEPS: Record<TaskKind, readonly [number, number, number] | readonly [number, number]> = {
  split_prd: [0, 1_000, 5_000],
  write_tests: [10, 30, 80],
  add_tests: [10, 30, 80],
  confirm_gaps: [5, 40],
}

/** Areas where a miss costs most: one tier more. */
const RISKY = /金流|付款|支付|退款|payment|billing|webhook|migration|遷移|權限|auth|security|資安|個資|concurrency|並行|race/i

const BY_TIER: Record<Tier, { model: Model; effort: Effort; limit: number }> = {
  S: { model: 'sonnet', effort: 'medium', limit: 60_000 },
  M: { model: 'sonnet', effort: 'high', limit: 100_000 },
  L: { model: 'opus', effort: 'high', limit: 160_000 },
  XL: { model: 'opus', effort: 'xhigh', limit: 256_000 },
}

/** No role runs below its floor. */
const FLOORS: Record<RoleId, { model: Model; effort: Effort }> = {
  pm: { model: 'sonnet', effort: 'high' },
  uiux: { model: 'sonnet', effort: 'medium' },
  fullstack: { model: 'sonnet', effort: 'high' },
  qa: { model: 'sonnet', effort: 'medium' },
  techlead: { model: 'opus', effort: 'high' },
}

/** How complex a task is, from its size, its risk and how often it failed. */
export const tierFor = (task: TaskSignals): Tier => {
  const steps = STEPS[task.kind]
  let index = steps.findIndex(step => task.size <= step)
  if (index === -1) index = steps.length
  if (task.text !== undefined && RISKY.test(task.text)) index += 1
  index += Math.floor((task.failures ?? 0) / 2)
  return TIERS[Math.min(index, TIERS.length - 1)] ?? 'XL'
}

const higher = <T>(order: readonly T[], a: T, b: T): T => (order.indexOf(a) >= order.indexOf(b) ? a : b)

/**
 * The model, effort and context limit a role runs a task of this tier on.
 * `beyond` is an XL task that failed again: Opus at max.
 */
export const routeFor = (role: RoleId, tier: Tier, options: { beyond?: boolean } = {}): Route => {
  const base = options.beyond === true ? { model: 'opus' as const, effort: 'max' as const, limit: 256_000 } : BY_TIER[tier]
  const floor = FLOORS[role]
  const model = higher(MODELS, base.model, floor.model)
  return {
    tier,
    model: MODEL_IDS[model],
    label: MODEL_LABELS[model],
    effort: higher(EFFORTS, base.effort, floor.effort),
    limit: base.limit,
  }
}
