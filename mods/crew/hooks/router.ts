import type { RoleId, Tier } from './model'

/** What a role is asked to do, and what sizes it. */
export type TaskKind = 'split_prd' | 'write_tests' | 'add_tests' | 'confirm_gaps' | 'plan_tasks' | 'design'

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
  /** Crew's name for the Claude model: the newest of its family; the agent runs its full id (`claudeId`). */
  model: Model
  label: string
  effort: Effort
  /** Context tokens before the role is rotated. */
  limit: number
  /** An XL task that failed again: the step past the ladder, which a tuning does not hold back. */
  beyond?: true
}

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
/** The newest Claude model of each family, by crew's name: the ladder a role on auto climbs. */
export type Model = 'haiku' | 'sonnet' | 'opus' | 'fable'

const TIERS: readonly Tier[] = ['S', 'M', 'L', 'XL']
const MODELS: readonly Model[] = ['haiku', 'sonnet', 'opus', 'fable']
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

const MODEL_LABELS: Record<Model, string> = { haiku: 'Haiku 5.5', sonnet: 'Sonnet 5.5', opus: 'Opus 5.5', fable: 'Fable 5.1' }

/** The full id each of crew's names runs: the agent is given the id, so what runs is what the pane says, whatever an alias comes to mean later. */
const CLAUDE_IDS: Record<Model, string> = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5', fable: 'claude-fable-5-1' }

/** The older generations still served, by their full id, which is crew's name for them: a role may be fixed on one, never climb to it. */
const OLDER_LABELS: Record<string, string> = {
  'claude-fable-5': 'Fable 5',
  'claude-opus-5': 'Opus 5',
  'claude-opus-4-8': 'Opus 4.8',
  'claude-opus-4-7': 'Opus 4.7',
  'claude-opus-4-6': 'Opus 4.6',
  'claude-sonnet-5': 'Sonnet 5',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-haiku-4-5': 'Haiku 4.5',
}

/** The Claude models a role may be fixed on, as the pane lists them: the strongest family first, each newest first. */
export const CLAUDE_FIXED_MODELS: readonly string[] = ['fable', 'claude-fable-5', 'opus', 'claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'sonnet', 'claude-sonnet-5', 'claude-sonnet-4-6', 'haiku', 'claude-haiku-4-5']

/** The efforts a Claude model takes: Haiku 4.5 none, the 4.6 generation all but xhigh, the rest all five. */
export const claudeEfforts = (model: string): readonly Effort[] =>
  model === 'claude-haiku-4-5' ? [] : model === 'claude-opus-4-6' || model === 'claude-sonnet-4-6' ? EFFORTS.filter(e => e !== 'xhigh') : EFFORTS

/** An effort a Claude model takes, from the one asked: the highest it takes at or under it, else its lowest; undefined for a model with none. */
export const fitEffort = (model: string, effort: string): Effort | undefined => {
  const takes = claudeEfforts(model)
  if (takes.length === 0) return undefined
  if (takes.includes(effort as Effort)) return effort as Effort
  const under = takes.filter(e => EFFORTS.indexOf(e) <= EFFORTS.indexOf(effort as Effort))
  return under.at(-1) ?? takes[0]
}

/** The full id the agent is given for one of crew's names. */
export const claudeId = (model: string): string => CLAUDE_IDS[model as Model] ?? model

/** Where a Claude model stands on the ladder: an older generation where its family's newest does. */
const ladderModel = (model: string): Model | undefined => (MODELS.includes(model as Model) ? (model as Model) : MODELS.find(m => model.includes(`-${m}-`)))

/**
 * Each tier as the pane says it: how hard the work is, which is not how much
 * of it there is. A short task can be hard, a long one routine.
 */
export const TIER_NAMES: Readonly<Record<Tier, string>> = { S: '易', M: '中', L: '難', XL: '極難' }

/** The size steps of each kind of task: at or under the first, S; the second, M; the third, L; over, XL. */
const STEPS: Record<TaskKind, readonly [number, number, number] | readonly [number, number]> = {
  split_prd: [0, 1_000, 5_000],
  write_tests: [10, 30, 80],
  add_tests: [10, 30, 80],
  confirm_gaps: [5, 40],
  plan_tasks: [10, 30, 80],
  design: [3, 8, 20],
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
 * What the brain may set for a role's work from now on: under auto, the
 * engine and a model or effort on it, with why it moved the role; and a
 * rotation threshold. A model is the engine's own: a Claude alias, or a Codex model.
 */
export type Tuning = { engine?: 'claude' | 'codex'; model?: string; effort?: Effort; limit?: number; why?: string; raise?: true }

/** A role's route with the brain's tuning on it; the step up of a task that failed again (Fable) stands. A tuning on Codex leaves the Claude route as it was. */
export const tunedRoute = (route: Route, tuning: Tuning | undefined): Route => {
  if (route.beyond === true) return route
  const claude = tuning?.engine !== 'codex'
  const model = claude && MODELS.includes(tuning?.model as Model) ? (tuning?.model as Model) : undefined
  return {
    ...route,
    ...(model === undefined ? {} : { model, label: MODEL_LABELS[model] }),
    ...(claude && tuning?.effort !== undefined ? { effort: tuning.effort } : {}),
    // A threshold the brain raised on its own is a least one: work the role's tier sizes higher keeps the tier's.
    ...(tuning?.limit === undefined ? {} : { limit: tuning.raise === true ? Math.max(route.limit, tuning.limit) : tuning.limit }),
  }
}

/** A role's floors as the person set them; an engine absent, or set to what no longer holds, is on crew's own. */
export type Floors = { claude?: { model: string; effort: string }; codex?: { model: string; effort: string } }

/** A role's floor on an engine: the person's when it holds there, else crew's own. */
export const floorFor = (role: RoleId, engine: 'claude' | 'codex', floors: Floors = {}): { model: string; effort: string } => {
  if (engine === 'claude') {
    const own = floors.claude
    return own !== undefined && MODELS.includes(own.model as Model) && EFFORTS.includes(own.effort as Effort) ? own : FLOORS[role]
  }
  const own = floors.codex
  const choices = codexChoices(role)
  return own !== undefined && choices.models.includes(own.model as CodexModel) && choices.efforts.includes(own.effort as Effort) ? own : CODEX_FLOORS[role]
}

/** A model and effort as the pane says them: `Sonnet 5.5・high`, `6.1 Sol・xhigh`; a Claude model that takes no effort, by its name alone. */
export const pickSaid = (engine: 'claude' | 'codex', pick: { model: string; effort: string }): string =>
  engine === 'codex' ? `${codexLabel(pick.model)}・${pick.effort}` : claudeEfforts(pick.model).length === 0 ? labelOf(pick.model) : `${labelOf(pick.model)}・${fitEffort(pick.model, pick.effort) ?? pick.effort}`

/** The role's floor, said as `Sonnet 5.5・high`, when a tuning would go below it on its engine; undefined when it keeps to it. */
export const floorOf = (role: RoleId, tuning: Tuning, floors: Floors = {}): string | undefined => {
  const engine = tuning.engine ?? 'claude'
  const floor = floorFor(role, engine, floors)
  const models: readonly string[] = engine === 'codex' ? CODEX_MODELS : MODELS
  const low = (tuning.model !== undefined && models.indexOf(tuning.model) < models.indexOf(floor.model)) || (tuning.effort !== undefined && EFFORTS.indexOf(tuning.effort) < EFFORTS.indexOf(floor.effort as Effort))
  return low ? pickSaid(engine, floor) : undefined
}

/** A Claude model's name as the pane says it, with its generation: by crew's name, or by the full id the agent ran. */
export const labelOf = (model: string): string => {
  // An id the engine resolved may carry its snapshot's date: `claude-haiku-4-5-20251001`.
  const id = model.replace(/-\d{8}$/, '')
  return MODEL_LABELS[id as Model] ?? OLDER_LABELS[id] ?? MODEL_LABELS[MODELS.find(m => CLAUDE_IDS[m] === id) as Model] ?? model
}

/** The alias of a Claude model's family: the Agent tool takes no other `model`, so crew spawns by it and its hook names the full id. */
export const claudeAlias = (model: string): Model => ladderModel(model) ?? 'sonnet'

/** The Claude models and efforts a role's floor may be set to, weakest first. */
export const CLAUDE_MODELS: readonly Model[] = MODELS
export const CLAUDE_EFFORTS: readonly Effort[] = EFFORTS

/** Each role's floor on Claude until the person sets it. */
export const CLAUDE_FLOORS: Readonly<Record<RoleId, { model: Model; effort: Effort }>> = FLOORS

/** The context limit of each tier, as `易 60K · 中 100K · 難 160K · 極難 256K`. */
export const limitsByTier = (): string => TIERS.map(t => `${TIER_NAMES[t]} ${Math.round(BY_TIER[t].limit / 1000)}K`).join(' · ')

/**
 * The model, effort and context limit a role runs a task of this tier on.
 * `beyond` is an XL task that failed again: Fable at xhigh. `floor`, the
 * person's, stands in for the role's own.
 */
export const routeFor = (role: RoleId, tier: Tier, options: { beyond?: boolean; floor?: { model: string; effort: string } } = {}): Route => {
  const base = options.beyond === true ? { model: 'fable' as const, effort: 'xhigh' as const, limit: 256_000 } : BY_TIER[tier]
  const own = options.floor
  const floor = own !== undefined && MODELS.includes(own.model as Model) && EFFORTS.includes(own.effort as Effort) ? { model: own.model as Model, effort: own.effort as Effort } : FLOORS[role]
  const model = higher(MODELS, base.model, floor.model)
  return {
    tier,
    model,
    label: MODEL_LABELS[model],
    effort: higher(EFFORTS, base.effort, floor.effort),
    limit: base.limit,
    ...(options.beyond === true ? { beyond: true as const } : {}),
  }
}

/**
 * The Codex models crew routes to, weakest first: the newest of each family
 * `codex debug models` lists. An older generation (6 Sol, 5.6) is left out.
 */
export const CODEX_MODELS = ['gpt-6-luna', 'gpt-6.1-terra', 'gpt-6.1-sol', 'gpt-6-astra'] as const
export type CodexModel = (typeof CODEX_MODELS)[number]

/** The efforts a Codex role may run on: `ultra` hands parts of the work to Codex's own subagents, which crew does not run. */
export const CODEX_EFFORTS: readonly Effort[] = EFFORTS

const CODEX_LABELS: Record<CodexModel, string> = { 'gpt-6-luna': '6 Luna', 'gpt-6.1-terra': '6.1 Terra', 'gpt-6.1-sol': '6.1 Sol', 'gpt-6-astra': '6 Astra' }

/** A Codex model's name as the pane says it: `6.1 Sol`; `short` drops the generation, for a table cell. */
export const codexLabel = (model: string, short = false): string => {
  const label = CODEX_LABELS[model as CodexModel] ?? model
  return short ? label.replace(/^[\d.]+ /, '') : label
}

type CodexStep = { model: CodexModel; effort: Effort }

/** Codex by tier: Terra writes and reads screens fast, 6.1 Sol is the workhorse for code; an XL task that failed again goes to Astra. */
const CODEX_BY_TIER: Record<Tier, CodexStep> = {
  S: { model: 'gpt-6.1-terra', effort: 'medium' },
  M: { model: 'gpt-6.1-terra', effort: 'high' },
  L: { model: 'gpt-6.1-sol', effort: 'high' },
  XL: { model: 'gpt-6.1-sol', effort: 'xhigh' },
}
const CODEX_BEYOND: CodexStep = { model: 'gpt-6-astra', effort: 'xhigh' }

/**
 * Where each role starts on Codex until the person sets it: PM, UI/UX and QA
 * write specs, designs and test cases, which Terra is made for; the tech lead
 * and the full-stack review and write code, at the least the person set.
 */
export const CODEX_FLOORS: Record<RoleId, CodexStep> = {
  pm: { model: 'gpt-6.1-terra', effort: 'high' },
  uiux: { model: 'gpt-6.1-terra', effort: 'medium' },
  qa: { model: 'gpt-6.1-terra', effort: 'medium' },
  techlead: { model: 'gpt-6.1-sol', effort: 'xhigh' },
  fullstack: { model: 'gpt-6.1-sol', effort: 'xhigh' },
}

/** The least a role's floor may be set to on Codex: the person's rule for the tech lead and the full-stack. */
export const CODEX_MINIMUM: Partial<Record<RoleId, CodexStep>> = {
  techlead: { model: 'gpt-6.1-sol', effort: 'xhigh' },
  fullstack: { model: 'gpt-6.1-sol', effort: 'xhigh' },
}

/** The models and efforts a role's Codex floor may be set to: none under its minimum. */
export const codexChoices = (role: RoleId): { models: readonly CodexModel[]; efforts: readonly Effort[] } => {
  const least = CODEX_MINIMUM[role]
  if (least === undefined) return { models: CODEX_MODELS, efforts: CODEX_EFFORTS }
  return { models: CODEX_MODELS.slice(CODEX_MODELS.indexOf(least.model)), efforts: CODEX_EFFORTS.slice(CODEX_EFFORTS.indexOf(least.effort)) }
}

/**
 * The Codex model and effort a role runs a task of this tier on, at or over
 * its floor. `beyond` is an XL task that failed again.
 */
export const codexRouteFor = (floor: { model: string; effort: string }, tier: Tier, options: { beyond?: boolean } = {}): { tier: Tier; model: string; effort: Effort } => {
  const base = options.beyond === true ? CODEX_BEYOND : CODEX_BY_TIER[tier]
  const model = CODEX_MODELS.includes(floor.model as CodexModel) ? higher(CODEX_MODELS, base.model, floor.model as CodexModel) : base.model
  const effort = EFFORTS.includes(floor.effort as Effort) ? higher(EFFORTS, base.effort, floor.effort as Effort) : base.effort
  return { tier, model, effort }
}

/**
 * The steps a role climbs on an engine, from easy work to the hardest that
 * failed again, said as `易–中 Terra・high · 難 Sol・high · 極難 xhigh · 再失敗 Astra・xhigh`:
 * tiers that run the same are said once, and a step on the model before it says its effort alone.
 */
export const ladderOf = (role: RoleId, engine: 'claude' | 'codex', floor?: { model: string; effort: string }): string => {
  const at = (tier: Tier, beyond: boolean): { model: string; effort: string } => {
    if (engine === 'claude') {
      const r = routeFor(role, tier, { beyond, ...(floor === undefined ? {} : { floor }) })
      return { model: r.label, effort: r.effort }
    }
    const r = codexRouteFor(floor ?? CODEX_FLOORS[role], tier, { beyond })
    return { model: codexLabel(r.model, true), effort: r.effort }
  }
  const steps: { name: string; model: string; effort: string }[] = []
  let from: Tier = 'S'
  TIERS.forEach((tier, i) => {
    const here = at(tier, false)
    const next = TIERS[i + 1]
    const same = next !== undefined && at(next, false).model === here.model && at(next, false).effort === here.effort
    if (same) return
    steps.push({ name: from === tier ? TIER_NAMES[tier] : `${TIER_NAMES[from]}–${TIER_NAMES[tier]}`, ...here })
    if (next !== undefined) from = next
  })
  steps.push({ name: '再失敗', ...at('XL', true) })
  return steps.map((s, i) => `${s.name} ${i > 0 && steps[i - 1]?.model === s.model ? s.effort : `${s.model}・${s.effort}`}`).join(' · ')
}

/** The engine, model and effort a role's next piece of work runs on. */
export type EnginePick = { engine: 'claude' | 'codex'; model: string; label: string; effort: string }

/**
 * Where a role on auto runs a task of this tier: on the engine the brain
 * picked (Claude until it does), from the role's floor there up the tiers. A
 * model or effort the brain set holds the role there, never below its floor;
 * an XL task that failed again climbs past it all the same.
 */
export const autoPick = (role: RoleId, tier: Tier, floors: Floors, tuning: Tuning | undefined, options: { beyond?: boolean; engine?: 'claude' | 'codex' } = {}): EnginePick => {
  // The brain's move first, then the engine the person set the role on, then crew's default.
  const engine = tuning?.engine ?? options.engine ?? 'claude'
  const beyond = options.beyond === true
  const floor = floorFor(role, engine, floors)
  const models: readonly string[] = engine === 'codex' ? CODEX_MODELS : MODELS
  const routed = engine === 'codex' ? codexRouteFor(floor, tier, { beyond }) : routeFor(role, tier, { beyond, floor })
  const held = (value: string | undefined, order: readonly string[], least: string, otherwise: string): string =>
    beyond || value === undefined || !order.includes(value) ? otherwise : higher(order, value, least)
  const model = held(tuning?.model, models, floor.model, routed.model)
  const effort = held(tuning?.effort, EFFORTS, floor.effort, routed.effort)
  return { engine, model, label: engine === 'codex' ? codexLabel(model) : MODEL_LABELS[model as Model], effort }
}

/** Whether a pick runs higher than another on the same engine: a stronger model, or the same model at a higher effort. A Claude model of an older generation stands where its family's newest does. */
export const isClimb = (next: { engine: 'claude' | 'codex'; model: string; effort: string }, from: { model: string; effort: string }): boolean => {
  const models: readonly string[] = next.engine === 'codex' ? CODEX_MODELS : MODELS
  const at = (model: string): number => models.indexOf(next.engine === 'codex' ? model : (ladderModel(model) ?? model))
  const a = at(next.model)
  const b = at(from.model)
  return a !== b ? a > b : EFFORTS.indexOf(next.effort as Effort) > EFFORTS.indexOf(from.effort as Effort)
}
