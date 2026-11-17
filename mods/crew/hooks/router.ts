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
  /** Crew's name for the Claude model: a family's alias, the newest of it, or an older generation's full id; the agent runs its full id (`claudeId`). */
  model: string
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

/** The newest of each family crew knew when it was written: what it offers until it has asked a Claude Code what its aliases run. */
const KNOWN_LATEST: Record<Model, string> = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5', fable: 'claude-fable-5-2' }

/** The older generations a role may still run, by their full id, which is crew's name for them: Opus only its newest, as the person asked. */
const KEPT_OLDER: Record<Model, readonly string[]> = {
  fable: ['claude-fable-5-1', 'claude-fable-5'],
  opus: [],
  sonnet: ['claude-sonnet-5', 'claude-sonnet-4-6'],
  haiku: ['claude-haiku-4-5'],
}

/** A Codex model as crew lists it: its slug, which runs it, and its name in the pane. */
export type CodexEntry = { slug: string; label: string }

/** The Codex models `codex debug models` listed when crew was written: what crew offers until it reads the list itself. */
const KNOWN_CODEX: readonly CodexEntry[] = [
  { slug: 'gpt-5.6-luna', label: '5.6 Luna' },
  { slug: 'gpt-6-luna', label: '6 Luna' },
  { slug: 'gpt-5.6-terra', label: '5.6 Terra' },
  { slug: 'gpt-6.1-terra', label: '6.1 Terra' },
  { slug: 'gpt-5.6-sol', label: '5.6 Sol' },
  { slug: 'gpt-6-sol', label: '6 Sol' },
  { slug: 'gpt-6.1-sol', label: '6.1 Sol' },
  { slug: 'gpt-6-astra', label: '6 Astra' },
]

/**
 * The models crew offers now: Claude's newest of each family as this Claude
 * Code resolves its aliases, the full ids it resolved before, and Codex's own
 * list. Set by `useCatalog` from what crew stored; each session starts it over.
 */
const catalog: { latest: Record<Model, string>; seen: readonly string[]; codex: readonly CodexEntry[] } = { latest: { ...KNOWN_LATEST }, seen: [], codex: KNOWN_CODEX }

const CLAUDE_ID = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?$/
const CODEX_SLUG = /^gpt-(\d+(?:\.\d+)?)-([a-z]+)$/

/** A Claude model's family and generation, from its full id: `claude-fable-5-2` is Fable 5.2; a snapshot's date is dropped. */
const claudeParts = (id: string): { family: string; version: [number, number] } | undefined => {
  const m = CLAUDE_ID.exec(id.replace(/-\d{8}$/, ''))
  return m === null ? undefined : { family: m[1] ?? '', version: [Number(m[2]), Number(m[3] ?? 0)] }
}

const newer = (a: [number, number], b: [number, number]): number => a[0] - b[0] || a[1] - b[1]

/**
 * Takes the model lists crew stored: what this Claude Code's aliases resolved
 * to, the ids they resolved to before, and Codex's list. Each family's newest
 * is the newest of these and what crew knew, so a list never goes back: not
 * while a Claude Code just updated is still being asked, nor on an older one
 * whose alias runs an older generation. Anything not in the shape of a Claude
 * id or a Codex slug is left out.
 */
export const useCatalog = (given: { latest?: Readonly<Record<string, unknown>>; seen?: readonly unknown[]; codex?: readonly unknown[] } = {}): void => {
  const seen = (given.seen ?? []).filter((id): id is string => typeof id === 'string' && claudeParts(id) !== undefined).slice(0, 40)
  const latest = { ...KNOWN_LATEST }
  for (const m of MODELS) {
    const here = given.latest?.[m]
    for (const id of [...(typeof here === 'string' ? [here] : []), ...seen].map(x => x.replace(/-\d{8}$/, ''))) {
      const p = claudeParts(id)
      const top = claudeParts(latest[m])
      if (p?.family === m && (top === undefined || newer(p.version, top.version) > 0)) latest[m] = id
    }
  }
  const codex = (given.codex ?? []).flatMap(e => {
    const o = (typeof e === 'object' && e !== null ? e : {}) as Record<string, unknown>
    return typeof o.slug === 'string' && CODEX_SLUG.test(o.slug) && typeof o.label === 'string' && o.label.length > 0 && o.label.length <= 40 ? [{ slug: o.slug, label: o.label }] : []
  })
  catalog.latest = latest
  catalog.seen = seen
  catalog.codex = codex.length > 0 ? codex : KNOWN_CODEX
}

/** A Claude model's name as the pane says it, from its full id: `Fable 5.2`. */
const idLabel = (id: string): string | undefined => {
  const p = claudeParts(id)
  if (p === undefined) return undefined
  return `${p.family.charAt(0).toUpperCase()}${p.family.slice(1)} ${p.version[0]}${p.version[1] === 0 && !/-\d+-0$/.test(id) ? '' : `.${p.version[1]}`}`
}

/** A family's older generations a role may run, newest first: the ones crew keeps, and any newest this Claude Code has since moved past. */
const olderOf = (family: Model): string[] => {
  if (family === 'opus') return []
  const top = claudeParts(catalog.latest[family])?.version ?? [0, 0]
  const ids = new Set([...catalog.seen, KNOWN_LATEST[family], ...KEPT_OLDER[family]].map(id => id.replace(/-\d{8}$/, '')))
  return [...ids]
    .flatMap(id => {
      const p = claudeParts(id)
      return p !== undefined && p.family === family && newer(p.version, top) < 0 ? [{ id, version: p.version }] : []
    })
    .sort((a, b) => newer(b.version, a.version))
    .map(x => x.id)
}

/** The Claude models a role may be fixed on or start from, as the pane lists them: the strongest family first, its newest (by alias) then its older generations. */
export const claudeFixedModels = (): readonly string[] => [...MODELS].reverse().flatMap(m => [m, ...olderOf(m)])

/**
 * Every Claude model crew takes by name: what the pane lists, and each
 * family's newest by its full id. A full id stays the generation named: once
 * a newer one comes, it is among the older ones, not moved up with the alias.
 */
export const claudeModels = (): readonly string[] => [...claudeFixedModels(), ...MODELS.map(m => catalog.latest[m])]

/** Whether a Claude model is one crew takes: a family's alias, its newest by full id, or an older generation it keeps. */
export const isClaudeModel = (model: string): boolean => claudeModels().includes(model)

/**
 * A Claude model the person set, as crew offers it now: one it still offers as
 * it is; a generation it no longer offers (an older Opus, say) as its
 * family's newest, so the family the person chose holds; anything else none.
 */
export const claudeKept = (model: string): string | undefined => {
  // As the pane offers it: a family's newest by its full id is its alias there.
  if (claudeFixedModels().includes(model)) return model
  const family = /^claude-([a-z]+)-\d/.exec(model)?.[1]
  return MODELS.find(m => m === family)
}

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

/** The full id the agent is given for one of crew's names: a family's alias runs the newest this Claude Code resolves it to. */
export const claudeId = (model: string): string => (MODELS.includes(model as Model) ? catalog.latest[model as Model] : model)

/** Where a Claude model stands on the ladder: an older generation where its family's newest does. */
const ladderModel = (model: string): Model | undefined => (MODELS.includes(model as Model) ? (model as Model) : MODELS.find(m => claudeParts(model)?.family === m))

/** Of two Claude models, the stronger family's; of one family, the first. */
const strongerClaude = (a: string, b: string): string => (MODELS.indexOf(ladderModel(b) ?? 'haiku') > MODELS.indexOf(ladderModel(a) ?? 'haiku') ? b : a)

/** Whether a Claude model is weaker than another: a lower family, or an older generation of the same one (an alias stands at its family's newest). */
const claudeBelow = (a: string, b: string): boolean => {
  const fa = MODELS.indexOf(ladderModel(a) ?? 'haiku')
  const fb = MODELS.indexOf(ladderModel(b) ?? 'haiku')
  if (fa !== fb) return fa < fb
  return newer(claudeParts(claudeId(a))?.version ?? [0, 0], claudeParts(claudeId(b))?.version ?? [0, 0]) < 0
}

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
  const model = claude && tuning?.model !== undefined && isClaudeModel(tuning.model) ? tuning.model : undefined
  return {
    ...route,
    ...(model === undefined ? {} : { model, label: labelOf(model) }),
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
    return own !== undefined && isClaudeModel(own.model) && EFFORTS.includes(own.effort as Effort) ? own : FLOORS[role]
  }
  const own = floors.codex
  const choices = codexChoices(role)
  return own !== undefined && choices.models.includes(own.model) && choices.efforts.includes(own.effort as Effort) ? own : codexFloor(role)
}

/** A model and effort as the pane says them: `Sonnet 5.5・high`, `6.1 Sol・xhigh`; a Claude model that takes no effort, by its name alone. */
export const pickSaid = (engine: 'claude' | 'codex', pick: { model: string; effort: string }): string =>
  engine === 'codex' ? `${codexLabel(pick.model)}・${pick.effort}` : claudeEfforts(pick.model).length === 0 ? labelOf(pick.model) : `${labelOf(pick.model)}・${fitEffort(pick.model, pick.effort) ?? pick.effort}`

/** The role's floor, said as `Sonnet 5.5・high`, when a tuning would go below it on its engine; undefined when it keeps to it. */
export const floorOf = (role: RoleId, tuning: Tuning, floors: Floors = {}): string | undefined => {
  const engine = tuning.engine ?? 'claude'
  const floor = floorFor(role, engine, floors)
  // On Claude an older generation of the floor's family is under it too.
  const under = (model: string): boolean => (engine === 'codex' ? codexRank(model) < codexRank(floor.model) : claudeBelow(model, floor.model))
  const low = (tuning.model !== undefined && under(tuning.model)) || (tuning.effort !== undefined && EFFORTS.indexOf(tuning.effort) < EFFORTS.indexOf(floor.effort as Effort))
  return low ? pickSaid(engine, floor) : undefined
}

/** A Claude model's name as the pane says it, with its generation: by crew's name, or by the full id the agent ran. */
export const labelOf = (model: string): string => {
  // An id the engine resolved may carry its snapshot's date: `claude-haiku-4-5-20251001`.
  const id = model.replace(/-\d{8}$/, '')
  return idLabel(claudeId(id)) ?? model
}

/** The alias of a Claude model's family: the Agent tool takes no other `model`, so crew spawns by it and its hook names the full id. */
export const claudeAlias = (model: string): Model => ladderModel(model) ?? 'sonnet'

/** The Claude families, weakest first: the ladder a role on auto climbs, each by its newest. */
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
  const floor = own !== undefined && isClaudeModel(own.model) && EFFORTS.includes(own.effort as Effort) ? { model: own.model, effort: own.effort as Effort } : FLOORS[role]
  // A floor on an older generation holds its family there: work that climbs to that family runs the generation the person picked.
  const model = strongerClaude(floor.model, base.model)
  return {
    tier,
    model,
    label: labelOf(model),
    effort: higher(EFFORTS, base.effort, floor.effort),
    limit: base.limit,
    ...(options.beyond === true ? { beyond: true as const } : {}),
  }
}

/** Codex's families, weakest first: Luna, Terra, Sol, Astra. A family crew does not know stands with the weakest. */
const CODEX_FAMILIES: readonly string[] = ['luna', 'terra', 'sol', 'astra']

/** Where a Codex model stands, by family, then generation. */
const codexKey = (slug: string): [number, number] => {
  const m = CODEX_SLUG.exec(slug)
  return m === null ? [-1, 0] : [Math.max(0, CODEX_FAMILIES.indexOf(m[2] ?? '')), Number(m[1])]
}

/** The Codex models crew offers, weakest first: every one `codex debug models` lists, older generations too. */
export const codexModels = (): readonly string[] => [...catalog.codex].sort((a, b) => newer(codexKey(a.slug), codexKey(b.slug))).map(e => e.slug)

/** A Codex model's place among the ones offered, weakest first; -1 for one not offered. */
const codexRank = (slug: string): number => codexModels().indexOf(slug)

/** Of two Codex models, the stronger: by family, then generation; of the same, the first. */
const strongerCodex = (a: string, b: string): string => (newer(codexKey(b), codexKey(a)) > 0 ? b : a)

/** The newest Codex model of a family offered, else the one crew knew. */
const newestCodex = (family: string, known: string): string => {
  const own = codexModels().filter(slug => CODEX_SLUG.exec(slug)?.[2] === family)
  return own.at(-1) ?? known
}

/** The efforts a Codex role may run on: `ultra` hands parts of the work to Codex's own subagents, which crew does not run. */
export const CODEX_EFFORTS: readonly Effort[] = EFFORTS

/** A Codex model's name as the pane says it: `6.1 Sol`; `short` drops the generation, for a table cell. */
export const codexLabel = (model: string, short = false): string => {
  const label = catalog.codex.find(e => e.slug === model)?.label ?? KNOWN_CODEX.find(e => e.slug === model)?.label ?? model
  return short ? label.replace(/^[\d.]+ /, '') : label
}

type CodexStep = { model: string; effort: Effort }

/** Codex by tier, each the newest of its family: Terra writes and reads screens fast, Sol is the workhorse for code; an XL task that failed again goes to Astra. */
const codexByTier = (tier: Tier): CodexStep => {
  const terra = newestCodex('terra', 'gpt-6.1-terra')
  const sol = newestCodex('sol', 'gpt-6.1-sol')
  return { S: { model: terra, effort: 'medium' as Effort }, M: { model: terra, effort: 'high' as Effort }, L: { model: sol, effort: 'high' as Effort }, XL: { model: sol, effort: 'xhigh' as Effort } }[tier]
}
const codexBeyond = (): CodexStep => ({ model: newestCodex('astra', 'gpt-6-astra'), effort: 'xhigh' })

/**
 * Where a role starts on Codex until the person sets it: PM, UI/UX and QA
 * write specs, designs and test cases, which Terra is made for; the tech lead
 * and the full-stack review and write code, at the least the person set.
 */
export const codexFloor = (role: RoleId): CodexStep => {
  const terra = newestCodex('terra', 'gpt-6.1-terra')
  const sol = newestCodex('sol', 'gpt-6.1-sol')
  return { pm: { model: terra, effort: 'high' as Effort }, uiux: { model: terra, effort: 'medium' as Effort }, qa: { model: terra, effort: 'medium' as Effort }, techlead: { model: sol, effort: 'xhigh' as Effort }, fullstack: { model: sol, effort: 'xhigh' as Effort } }[role]
}

/** The least a role's floor may be set to on Codex: the person's rule for the tech lead and the full-stack, 6.1 Sol at xhigh or stronger. */
export const CODEX_MINIMUM: Partial<Record<RoleId, CodexStep>> = {
  techlead: { model: 'gpt-6.1-sol', effort: 'xhigh' },
  fullstack: { model: 'gpt-6.1-sol', effort: 'xhigh' },
}

/** The models and efforts a role's Codex floor may be set to: none under its minimum. */
export const codexChoices = (role: RoleId): { models: readonly string[]; efforts: readonly Effort[] } => {
  const least = CODEX_MINIMUM[role]
  if (least === undefined) return { models: codexModels(), efforts: CODEX_EFFORTS }
  return { models: codexModels().filter(slug => newer(codexKey(slug), codexKey(least.model)) >= 0), efforts: CODEX_EFFORTS.slice(CODEX_EFFORTS.indexOf(least.effort)) }
}

/**
 * The Codex model and effort a role runs a task of this tier on, at or over
 * its floor. `beyond` is an XL task that failed again.
 */
export const codexRouteFor = (floor: { model: string; effort: string }, tier: Tier, options: { beyond?: boolean } = {}): { tier: Tier; model: string; effort: Effort } => {
  const base = options.beyond === true ? codexBeyond() : codexByTier(tier)
  const model = codexRank(floor.model) >= 0 ? strongerCodex(base.model, floor.model) : base.model
  const effort = EFFORTS.includes(floor.effort as Effort) ? higher(EFFORTS, base.effort, floor.effort as Effort) : base.effort
  return { tier, model, effort }
}

/**
 * The steps a role climbs on an engine, from easy work to the hardest that
 * failed again, said as `易–中 6.1 Terra・high · 難 6.1 Sol・high · 極難 xhigh · 再失敗 6 Astra・xhigh`
 * (the generation said, as older ones are offered too): tiers that run the same are said once,
 * and a step on the model before it says its effort alone.
 */
export const ladderOf = (role: RoleId, engine: 'claude' | 'codex', floor?: { model: string; effort: string }): string => {
  const at = (tier: Tier, beyond: boolean): { model: string; effort: string } => {
    if (engine === 'claude') {
      const r = routeFor(role, tier, { beyond, ...(floor === undefined ? {} : { floor }) })
      return { model: r.label, effort: r.effort }
    }
    const r = codexRouteFor(floor ?? codexFloor(role), tier, { beyond })
    return { model: codexLabel(r.model), effort: r.effort }
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
  const routed = engine === 'codex' ? codexRouteFor(floor, tier, { beyond }) : routeFor(role, tier, { beyond, floor })
  const offered = (model: string): boolean => (engine === 'codex' ? codexRank(model) >= 0 : isClaudeModel(model))
  // The brain's model holds the role there, never below the floor; of one family, the brain's pick, unless it is an older generation than the floor's.
  const model =
    beyond || tuning?.model === undefined || !offered(tuning.model)
      ? routed.model
      : engine === 'codex'
        ? strongerCodex(tuning.model, floor.model)
        : claudeBelow(tuning.model, floor.model)
          ? floor.model
          : strongerClaude(tuning.model, floor.model)
  const effort = beyond || tuning?.effort === undefined || !EFFORTS.includes(tuning.effort) ? routed.effort : higher(EFFORTS, tuning.effort, floor.effort as Effort)
  return { engine, model, label: engine === 'codex' ? codexLabel(model) : labelOf(model), effort }
}

/** Whether a pick runs higher than another on the same engine: a stronger model, or the same model at a higher effort. A Claude model of an older generation stands where its family's newest does. */
export const isClimb = (next: { engine: 'claude' | 'codex'; model: string; effort: string }, from: { model: string; effort: string }): boolean => {
  const at = (model: string): number => (next.engine === 'codex' ? codexRank(model) : MODELS.indexOf(ladderModel(model) ?? ('' as Model)))
  const a = at(next.model)
  const b = at(from.model)
  return a !== b ? a > b : EFFORTS.indexOf(next.effort as Effort) > EFFORTS.indexOf(from.effort as Effort)
}
