/**
 * Where the full-stack works and how crew sees its work: a branch and a git
 * worktree of crew's own, named after the PRD, and the commits on it whose
 * subject starts with the task ids they do. The commits are the signal; what
 * the full-stack says about its work is not. Pure.
 */

import type { Tracker } from './board'
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

/** Task id → the commits that do it, newest first, from `git log --format=%H%x09%s`. */
export const commitsByTask = (log: string): Map<string, string[]> => {
  const out = new Map<string, string[]>()
  for (const line of log.split('\n')) {
    const tab = line.indexOf('\t')
    if (tab <= 0) continue
    const sha = line.slice(0, tab).trim()
    const m = SUBJECT.exec(line.slice(tab + 1).trim())
    if (m === null || !/^[0-9a-f]{7,40}$/.test(sha)) continue
    for (const id of (m[1] ?? '').split(/\s*[,，、]\s*/)) {
      const shas = out.get(id) ?? []
      if (!shas.includes(sha)) out.set(id, [...shas, sha])
    }
  }
  return out
}

/** The board with each task marked with the commits that do it; null when no mark changes. */
export const withCommits = (board: Tracker, commits: ReadonlyMap<string, readonly string[]>): Tracker | null => {
  let changed = false
  const items = board.prd_items.map(item => {
    if (!Array.isArray(item.tasks) || item.tasks.length === 0) return item
    const known = new Set(tasksOf(item).map(t => t.id))
    const tasks = item.tasks.map(entry => {
      const v = entry as { id?: unknown; crew_commits?: unknown } | null
      if (typeof v?.id !== 'string' || !known.has(v.id)) return entry
      const now = commits.get(v.id)
      if (JSON.stringify(v.crew_commits ?? null) === JSON.stringify(now ?? null)) return entry
      changed = true
      const { crew_commits: _, ...rest } = v as Record<string, unknown>
      return now === undefined ? rest : { ...rest, crew_commits: [...now] }
    })
    return { ...item, tasks }
  })
  return changed ? { ...board, prd_items: items } : null
}
