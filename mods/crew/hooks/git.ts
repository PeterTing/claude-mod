/**
 * Where the full-stack works and how crew sees its work: a branch and a git
 * worktree of crew's own, named after the PRD, and the commits on it whose
 * subject starts with the task ids they do. The commits are the signal; what
 * the full-stack says about its work is not. Pure.
 */

import type { Task, TaskReview, Tracker } from './board'
import { tasksOf } from './board'
import { fingerprint } from './prd'

/** The name crew gives a PRD's branch and worktree: the file's name in plain letters, or a fingerprint of its path. */
const slugOf = (prdPath: string): string => {
  const base = (prdPath.split('/').pop() ?? prdPath).replace(/\.[^.]*$/, '')
  const plain = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return plain === '' ? `prd-${fingerprint(prdPath)}` : plain
}

/** The branch the full-stack commits a PRD's tasks on. */
export const branchOf = (prdPath: string): string => `crew/${slugOf(prdPath)}`

/** The worktree the full-stack works in, inside crew's folder, which is out of git. */
export const workdirOf = (root: string, prdPath: string): string => `${root}/.crew/work/${slugOf(prdPath)}`

/** A commit's subject that does tasks: it starts with their ids, as `TASK-001: …`, `TASK-001, TASK-002：…` or `[TASK-001] …`. */
export const SUBJECT = /^\[?(TASK-\d{3,}(?:\s*[,，、]\s*TASK-\d{3,})*)\]?(?=[\s:：\]])/

/** Each commit that does tasks, newest first, from `git log --format=%H%x09%s`: its sha and the task ids its subject starts with. */
export const commitsOf = (log: string): { sha: string; ids: string[] }[] =>
  log.split('\n').flatMap(line => {
    const tab = line.indexOf('\t')
    if (tab <= 0) return []
    const sha = line.slice(0, tab).trim()
    const m = SUBJECT.exec(line.slice(tab + 1).trim())
    if (m === null || !/^[0-9a-f]{7,40}$/.test(sha)) return []
    return [{ sha, ids: [...new Set((m[1] ?? '').split(/\s*[,，、]\s*/))] }]
  })

/** Task id → the commits that do it, newest first, from `git log --format=%H%x09%s`. */
export const commitsByTask = (log: string): Map<string, string[]> => {
  const out = new Map<string, string[]>()
  for (const { sha, ids } of commitsOf(log)) for (const id of ids) out.set(id, [...(out.get(id) ?? []), sha])
  return out
}

/**
 * What crew saw done on its branch: each commit, newest first, with the tasks it
 * did as they stood when crew first saw it (task id → taskMark). A commit is
 * tied once and stays tied, so a task that later takes the same id, on a board
 * made again, is not counted built by the earlier task's commits.
 */
export type Seen = Record<string, Record<string, string>>

/** Which task an id named: its title and criteria, not its size or detail, which the plan may still change. */
export const taskMark = (task: Task): string => fingerprint(`${task.title}\n${task.acceptance_criteria.join(',')}`)

/** The record with the commits crew has not seen before tied to the board's tasks; the same record when nothing is new. */
export const recordSeen = (seen: Seen, commits: readonly { sha: string; ids: readonly string[] }[], board: Tracker): Seen => {
  const tasks = new Map(board.prd_items.flatMap(item => tasksOf(item)).map(t => [t.id, t]))
  const fresh: Seen = {}
  for (const { sha, ids } of commits) {
    if (Object.hasOwn(seen, sha) || Object.hasOwn(fresh, sha)) continue
    const did: Record<string, string> = {}
    for (const id of ids) {
      const task = tasks.get(id)
      if (task !== undefined) did[id] = taskMark(task)
    }
    fresh[sha] = did
  }
  return Object.keys(fresh).length === 0 ? seen : { ...fresh, ...seen }
}

/** Task id → the commits crew saw doing that very task, newest first. */
export const marksOf = (board: Tracker, seen: Seen): Map<string, string[]> => {
  const out = new Map<string, string[]>()
  for (const task of board.prd_items.flatMap(item => tasksOf(item))) {
    const mark = taskMark(task)
    const shas = Object.entries(seen).flatMap(([sha, did]) => (did[task.id] === mark ? [sha] : []))
    if (shas.length > 0) out.set(task.id, shas)
  }
  return out
}

/** The board with each task's `field` set to its value in `values`, or taken off when it has none; null when no mark changes. */
const markTasks = (board: Tracker, field: string, values: ReadonlyMap<string, unknown>): Tracker | null => {
  let changed = false
  const items = board.prd_items.map(item => {
    if (!Array.isArray(item.tasks) || item.tasks.length === 0) return item
    const known = new Set(tasksOf(item).map(t => t.id))
    const tasks = item.tasks.map(entry => {
      const v = entry as Record<string, unknown> | null
      if (typeof v?.id !== 'string' || !known.has(v.id)) return entry
      const now = values.get(v.id)
      if (JSON.stringify(v[field] ?? null) === JSON.stringify(now ?? null)) return entry
      changed = true
      const { [field]: _, ...rest } = v
      return now === undefined ? rest : { ...rest, [field]: now }
    })
    return { ...item, tasks }
  })
  return changed ? { ...board, prd_items: items } : null
}

/** The board with each task marked with the commits that do it; null when no mark changes. */
export const withCommits = (board: Tracker, commits: ReadonlyMap<string, readonly string[]>): Tracker | null =>
  markTasks(board, 'crew_commits', new Map([...commits].map(([id, shas]) => [id, [...shas]])))

/**
 * crew's record of the tech lead's reviews: each pinned to the commit the
 * tech lead read, and tied to the task as it stood (taskMark), so a later task
 * that takes the same id is not taken for reviewed.
 */
export type Reviewed = Record<string, { sha: string; verdict: 'approve' | 'changes'; notes?: string; mark: string }>

/** Task id → crew's review of that very task, of a commit crew saw doing it. */
export const reviewsOf = (board: Tracker, reviewed: Reviewed, commits: ReadonlyMap<string, readonly string[]>): Map<string, TaskReview> => {
  const out = new Map<string, TaskReview>()
  for (const task of board.prd_items.flatMap(item => tasksOf(item))) {
    const r = reviewed[task.id]
    if (r === undefined || r.mark !== taskMark(task) || !(commits.get(task.id) ?? []).includes(r.sha)) continue
    out.set(task.id, { sha: r.sha, verdict: r.verdict, ...(r.notes === undefined ? {} : { notes: r.notes }) })
  }
  return out
}

/** The board with each task marked with crew's review of it; null when no mark changes. */
export const withReviews = (board: Tracker, reviews: ReadonlyMap<string, TaskReview>): Tracker | null => markTasks(board, 'crew_review', reviews)
