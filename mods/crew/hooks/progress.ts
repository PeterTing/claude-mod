/**
 * The progress map of the PRD under way, worked out from the board and the
 * flow for the decide page to draw: the route of stations in the order they
 * are built (the shared groundwork, each feature, what launch needs), what
 * each station builds on its screens, back end and infrastructure, and how
 * far each piece got. A light comes only from what crew saw: a task is done
 * when its newest commit passed review, in progress while it is being built,
 * waits for review or is being fixed, and not started otherwise. Every text
 * from the board is masked and cut before it goes on the page. Pure.
 */

import { approvedNow, criteriaOf, gainOf, liveTasksOf, placeOf, reviewOf, tasksOf, tipOf, unmergedNow, type PrdItem, type Task, type TaskLayer, type Tracker } from './board'
import { redact } from './memory'
import { cut, droppedRequirements, plainOf, prdFeatures, refsOf, withoutOwnId, type Requirement } from './prd'

/** done: all of it; doing: some of it is being worked on now; part: some done, nobody on the rest; todo: none started. */
export type Light = 'done' | 'doing' | 'part' | 'todo'

/** Where a task in progress stands: being built, being fixed after a review, being reviewed, waiting for a review, sent back. */
export type TaskStep = 'building' | 'fixing' | 'review' | 'waiting' | 'changes' | 'merging'

export type ProgressTask = {
  id: string
  title: string
  detail: string
  state: 'done' | 'doing' | 'todo'
  step?: TaskStep
  /** Who is on it now, as the person knows them. */
  by?: string
  station: string
  item: string
  layer?: TaskLayer
  size?: string
  criteria: string[]
  after: string[]
  touches: string[]
  /** Its newest commit, short, and what the tech lead said of it. */
  sha?: string
  notes?: string
}

/** A piece of the product a station builds: the tasks on one part of one side. `none`: tasks the tech lead has not put on a side yet. */
export type ProgressItem = { key: string; name: string; lane: TaskLayer | 'none'; tasks: string[]; state: Light; done: number }

export type ProgressCriterion = { id: string; text: string; feature: string; tasks: string[]; cases: number; state: Light; done: number }

export type ProgressStation = {
  key: string
  kind: 'base' | 'feature' | 'launch'
  /** The station's number as the PRD numbers its requirements, or the feature's id when they have none. */
  n: string
  name: string
  /** What the person can do once it is done: the PM's words, or the feature's summary. */
  gain?: string
  reqs: string[]
  reqLabel?: string
  items: ProgressItem[]
  /** Pieces on other stations this one waits for. */
  needs: { item: string; name: string; station: string; state: Light }[]
  criteria: string[]
  tasks: string[]
  state: Light
  done: number
}

export type ProgressRequirement = {
  id: string
  label?: string
  text: string
  section: string
  stations: string[]
  state: Light
  done: number
  total: number
  dropped?: string
  /** The PRD no longer has it: its number then. */
  was?: string
  gone?: true
}

/** What the decide page's progress map draws, kept in data.json. */
export type PageProgress = {
  stations: ProgressStation[]
  tasks: ProgressTask[]
  criteria: ProgressCriterion[]
  requirements: ProgressRequirement[]
  done: number
  total: number
}

/** What the flow is doing with the tasks: which one the full-stack builds (and fixes after a review), and which one the tech lead reviews. */
/** The flow as progress reads it: the tasks in hand and the review, or, as stored before builds ran side by side, the one task in hand. */
export type ProgressFlow = {
  stage?: string
  jobs?: Readonly<Record<string, { slot?: number; fixing?: string; tips?: string; asking?: true }>>
  reviewing?: { task: string }
  building?: string
  fixing?: string
}

const TITLE_MAX = 200
const DETAIL_MAX = 1500
const TEXT_MAX = 300
const NAME_MAX = 40

// A board another tool wrote may leave a text out: it shows as empty, and the page is still drawn.
const shown = (text: unknown, max: number): string => (typeof text === 'string' ? cut(redact(text.replace(/\s+/g, ' ').trim()), max) : '')

/** How far a set of tasks got. */
export const lightOf = (tasks: readonly ProgressTask[]): Light => {
  if (tasks.length === 0) return 'todo'
  if (tasks.every(t => t.state === 'done')) return 'done'
  if (tasks.some(t => t.state === 'doing')) return 'doing'
  return tasks.some(t => t.state === 'done') ? 'part' : 'todo'
}

/** Where a task stands, from its review and what the flow does with it now. */
const stateOf = (x: Task, flow: ProgressFlow): Pick<ProgressTask, 'state' | 'step' | 'by'> => {
  // What the flow does now comes first, and only at its stage: a flow waiting on the person still names the task it was on,
  // and a task approved before its tests failed is being fixed again.
  if (flow.stage !== 'escalated' && flow.reviewing?.task === x.id) return { state: 'doing', step: 'review', by: 'Tech lead' }
  const job = flow.jobs?.[x.id]
  if (job !== undefined && (job.slot !== undefined || job.asking === true)) {
    return { state: 'doing', step: job.fixing !== undefined || job.tips !== undefined ? 'fixing' : 'building', by: job.slot !== undefined && job.slot > 1 ? `全端 ${job.slot}` : '全端' }
  }
  if (flow.stage === 'building' && flow.building === x.id) return { state: 'doing', step: flow.fixing !== undefined ? 'fixing' : 'building', by: '全端' }
  // Approved on a branch of its own: done once crew merged it back into its branch.
  if (approvedNow(x)) return unmergedNow(x) ? { state: 'doing', step: 'merging' } : { state: 'done' }
  if (tipOf(x) === undefined) return { state: 'todo' }
  // A commit the tech lead has not passed: waiting for its review, or sent back for changes.
  const r = reviewOf(x)
  return { state: 'doing', step: r !== undefined && r.sha === tipOf(x) && r.verdict === 'changes' ? 'changes' : 'waiting' }
}

/** The number a station goes by: what its requirements' numbers share, or their range; the feature's id when they have none. */
const numberOf = (labels: readonly string[], contiguous: boolean, fallback: string): string => {
  if (labels.length === 0) return fallback
  if (labels.length === 1) return labels[0] ?? fallback
  const parts = labels.map(l => l.split('.'))
  let shared = 0
  while (parts.every(p => p.length > shared + 1 && p[shared] === parts[0]?.[shared])) shared += 1
  if (shared > 0) return (parts[0] ?? []).slice(0, shared).join('.')
  return contiguous ? `${labels[0]}–${labels[labels.length - 1]}` : `${labels[0]}…`
}

/** The requirements a station answers, as the person reads their numbers. */
const labelOf = (labels: readonly string[], contiguous: boolean): string | undefined => {
  if (labels.length === 0) return undefined
  if (labels.length === 1) return `需求 ${labels[0]}`
  if (contiguous) return `需求 ${labels[0]} 到 ${labels[labels.length - 1]}`
  return `需求 ${labels.slice(0, 3).join('、')}${labels.length > 3 ? ` 等 ${labels.length} 條` : ''}`
}

/**
 * The PRD's progress map, or none before the tech lead has planned any task:
 * a map with nothing on it would only say nothing started.
 */
export const progressOf = (board: Tracker, requirements: readonly Requirement[], flow: ProgressFlow): PageProgress | undefined => {
  const features = prdFeatures(board, requirements)
  const ours = new Set(features.flatMap(f => tasksOf(f).map(x => x.id)))
  const live = liveTasksOf(board).filter(x => ours.has(x.id))
  if (live.length === 0) return undefined
  const featureOf = new Map(features.flatMap(f => tasksOf(f).map(x => [x.id, f] as const)))
  const stationOf = (x: Task): string => placeOf(x).station ?? featureOf.get(x.id)?.id ?? 'base'

  // Features in the order they are built: by their first task, those with none after, as the PRD lists them.
  const first = (f: PrdItem): number => {
    const ns = live.filter(x => featureOf.get(x.id) === f && placeOf(x).station === undefined).map(x => Number(/(\d+)$/.exec(x.id)?.[1] ?? Infinity))
    return ns.length === 0 ? Infinity : Math.min(...ns)
  }
  const ordered = features.map((f, i) => ({ f, i, at: first(f) })).sort((a, b) => a.at - b.at || a.i - b.i).map(x => x.f)
  const keys = [...(live.some(x => placeOf(x).station === 'base') ? ['base'] : []), ...ordered.map(f => f.id), ...(live.some(x => placeOf(x).station === 'launch') ? ['launch'] : [])]

  // Each task's item: tasks on the same part of the same side of a station make one.
  const itemKey = (x: Task): string => {
    const p = placeOf(x)
    return `${stationOf(x)}:${p.layer ?? 'none'}:${p.part ?? x.id}`
  }
  const tasks: ProgressTask[] = live.map(x => {
    const p = placeOf(x)
    const tip = tipOf(x)
    const r = reviewOf(x)
    return {
      id: x.id,
      title: shown(x.title, TITLE_MAX),
      detail: shown(x.detail, DETAIL_MAX),
      ...stateOf(x, flow),
      station: stationOf(x),
      item: itemKey(x),
      ...(p.layer === undefined ? {} : { layer: p.layer }),
      ...(typeof x.size === 'string' ? { size: x.size } : {}),
      criteria: x.acceptance_criteria,
      after: p.after.filter(a => ours.has(a)),
      touches: p.touches.map(t => shown(t, 200)),
      ...(tip === undefined ? {} : { sha: tip.slice(0, 7) }),
      ...(r?.notes === undefined || r.sha !== tip ? {} : { notes: shown(r.notes, TEXT_MAX) }),
    }
  })
  const byId = new Map(tasks.map(t => [t.id, t] as const))
  const of = (ids: readonly string[]): ProgressTask[] => ids.flatMap(id => byId.get(id) ?? [])
  const done = (ids: readonly string[]): number => of(ids).filter(t => t.state === 'done').length

  const items = new Map<string, ProgressItem>()
  for (const x of live) {
    const key = itemKey(x)
    const p = placeOf(x)
    const found = items.get(key)
    if (found !== undefined) found.tasks.push(x.id)
    else items.set(key, { key, name: shown(p.part ?? x.title, NAME_MAX), lane: p.layer ?? 'none', tasks: [x.id], state: 'todo', done: 0 })
  }
  for (const it of items.values()) Object.assign(it, { state: lightOf(of(it.tasks)), done: done(it.tasks) })

  const cases = board.prd_items.flatMap(i => i.test_cases)
  const criteria: ProgressCriterion[] = features.flatMap(f =>
    criteriaOf(f).map(c => {
      const serving = live.filter(x => x.acceptance_criteria.includes(c.id)).map(x => x.id)
      return {
        id: c.id,
        text: shown(c.text, TEXT_MAX),
        feature: f.id,
        tasks: serving,
        cases: cases.filter(tc => (tc.acceptance_criteria ?? []).includes(c.id)).length,
        state: lightOf(of(serving)),
        done: done(serving),
      }
    }),
  )

  const order = new Map(requirements.map((r, i) => [r.id, i] as const))
  const stations: ProgressStation[] = keys.map(key => {
    const f = features.find(x => x.id === key)
    const ids = tasks.filter(t => t.station === key).map(t => t.id)
    const reqs = f === undefined ? [] : refsOf(f).filter(r => order.has(r)).sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    const labels = reqs.flatMap(r => requirements[order.get(r) ?? -1]?.label ?? [])
    const at = reqs.map(r => order.get(r) ?? 0)
    const contiguous = labels.length === reqs.length && at.every((n, i) => i === 0 || n === (at[i - 1] ?? 0) + 1)
    const needs = new Map<string, ProgressStation['needs'][number]>()
    for (const t of of(ids)) {
      for (const a of t.after) {
        const w = byId.get(a)
        const it = w === undefined ? undefined : items.get(w.item)
        if (w !== undefined && it !== undefined && w.station !== key) needs.set(it.key, { item: it.key, name: it.name, station: w.station, state: it.state })
      }
    }
    // A board another tool wrote may leave a feature's summary out.
    const summary = typeof f?.summary === 'string' ? f.summary.trim() : ''
    const gain = f === undefined ? undefined : (gainOf(f) ?? (summary === '' ? undefined : summary))
    return {
      key,
      kind: key === 'base' ? 'base' : key === 'launch' ? 'launch' : 'feature',
      n: key === 'base' ? '地基' : key === 'launch' ? '上線' : cut(numberOf(labels, contiguous, key), 16),
      name: key === 'base' ? '開工前的共用工作' : key === 'launch' ? '上線前要好的事' : shown(f?.title ?? key, 80),
      ...(gain === undefined ? {} : { gain: shown(gain, 200) }),
      reqs,
      ...(labelOf(labels, contiguous) === undefined ? {} : { reqLabel: cut(labelOf(labels, contiguous) ?? '', 80) }),
      items: [...items.values()].filter(it => it.key.startsWith(`${key}:`)),
      needs: [...needs.values()],
      criteria: criteria.filter(c => c.feature === key).map(c => c.id),
      tasks: ids,
      state: lightOf(of(ids)),
      done: done(ids),
    }
  })

  const dropped = droppedRequirements(board)
  const shownRequirements: ProgressRequirement[] = requirements.map(r => {
    const answering = features.filter(f => refsOf(f).includes(r.id))
    // The tasks on the stations that answer it, as those stations count them: a feature's groundwork and launch tasks are elsewhere.
    const ids = stations.filter(st => answering.some(f => f.id === st.key)).flatMap(st => st.tasks)
    const why = dropped.get(r.id)
    return {
      id: r.id,
      ...(r.label === undefined ? {} : { label: r.label }),
      text: shown(plainOf(withoutOwnId(r)), TEXT_MAX),
      section: shown(r.section, 80),
      stations: answering.map(f => f.id).filter(k => keys.includes(k)),
      state: lightOf(of(ids)),
      done: done(ids),
      total: ids.length,
      ...(why === undefined ? {} : { dropped: shown(why, 200) }),
      ...(r.gone === true ? { gone: true as const, ...(r.was === undefined ? {} : { was: r.was }) } : {}),
    }
  })

  return { stations, tasks, criteria, requirements: shownRequirements, done: done(tasks.map(t => t.id)), total: tasks.length }
}
