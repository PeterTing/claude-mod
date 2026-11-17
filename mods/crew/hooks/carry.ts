/**
 * Another copy of crew on this machine (installed from a marketplace, or
 * loaded with --plugin-dir) keeps a store of its own: a repo worked on with
 * one has nothing in the other's. What the other kept for a repo, found and
 * brought over at the person's word: read from its file, written to this
 * copy's store alone. Pure.
 */
import type { CrewCarry } from '../types'
import { MAX_TEST_COMMANDS } from './runs'

/** A store file of a copy of crew: `crew_<marketplace>-<12 hex>.json`, `inline` for one loaded from a folder. */
export const STORE_FILE = /^crew_([A-Za-z0-9._-]+)-[0-9a-f]{12}\.json$/

/** The key a copy keeps its own mark under, in its own store: a file that holds this copy's mark is this copy's. */
export const COPY_KEY = 'copy'

/** A store file written this recently may be a copy still open: brought over at the person's press only, after they closed it. */
export const CARRY_RECENT_MS = 10 * 60_000

/** The copy a store file is, in the pane's words. */
export const copyName = (file: string): string => {
  const source = STORE_FILE.exec(file)?.[1]
  return source === undefined ? file : source === 'inline' ? '用 --plugin-dir 載入的那一份' : `從 ${source} 裝的那一份`
}

/** The keys of one repo's: its own, and those of each of its PRDs. */
const exact = (root: string): string[] => ['state', 'settings', 'tests', 'setup', 'setupRuns', 'board'].map(k => `${k}:${root}`)
const prefixes = (root: string): string[] => ['designs', 'review', 'work'].map(k => `${k}:${root}:`)
export const repoKey = (key: string, root: string): boolean => exact(root).includes(key) || prefixes(root).some(p => key.startsWith(p) && key.length > p.length)

const isArgv = (a: unknown): a is string[] => Array.isArray(a) && a.length > 0 && a.every(x => typeof x === 'string')

const argvWords = (v: unknown): string | undefined => {
  const argv = (v as { argv?: unknown } | undefined)?.argv
  return isArgv(argv) ? argv.join(' ') : undefined
}

/** The test commands another copy kept, as words: every one of its list (all come over), or the one from before there could be several. */
const testsWords = (v: unknown): string | undefined => {
  const list = (v as { list?: unknown } | undefined)?.list
  const each = Array.isArray(list) ? list.filter(isArgv).slice(0, MAX_TEST_COMMANDS).map(a => a.join(' ')) : []
  return each.length > 0 ? each.join('；') : argvWords(v)
}

/**
 * What another copy kept for the repo, as the pane offers it: only a PRD under
 * way or a draft is worth bringing over. `at` is when its file was last written.
 */
export const offerOf = (data: unknown, root: string, file: string, at: number): CrewCarry | undefined => {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined
  const store = data as Record<string, unknown>
  const state = store[`state:${root}`] as { prdPath?: unknown; flow?: { stage?: unknown }; questions?: unknown; draft?: { path?: unknown } } | undefined
  if (typeof state !== 'object' || state === null) return undefined
  const prd = typeof state.prdPath === 'string' && state.prdPath !== '' ? state.prdPath : typeof state.draft?.path === 'string' ? state.draft.path : undefined
  if (prd === undefined) return undefined
  const stage = typeof state.prdPath === 'string' && typeof state.flow?.stage === 'string' ? state.flow.stage : 'draft'
  const waits = (Array.isArray(state.questions) ? state.questions : []).filter(q => typeof q === 'object' && q !== null && (q as { status?: unknown }).status === 'open').length
  const tests = testsWords(store[`tests:${root}`])
  const setup = argvWords(store[`setup:${root}`])
  return { file, from: copyName(file), at, prd, stage, waits, ...(tests === undefined ? {} : { tests }), ...(setup === undefined ? {} : { setup }) }
}

/**
 * What goes into this copy's store: the repo's state, in place of this copy's
 * (which holds no PRD, or it would offer nothing), and every other key of the
 * repo this copy does not hold. Of the preps, what each left behind and the
 * last run: a run under way was the other process's, and ended with it.
 */
export const carriedOf = (data: Record<string, unknown>, root: string, mine: ReadonlySet<string>): [string, unknown][] =>
  Object.entries(data).flatMap(([key, value]): [string, unknown][] => {
    if (!repoKey(key, root) || value === null || value === undefined) return []
    if (key === `state:${root}`) return [[key, value]]
    if (mine.has(key)) return []
    if (key === `setupRuns:${root}`) {
      const { left, last } = value as { left?: unknown; last?: unknown }
      const kept = { ...(left === undefined ? {} : { left }), ...(last === undefined ? {} : { last }) }
      return Object.keys(kept).length === 0 ? [] : [[key, kept]]
    }
    return [[key, value]]
  })

/** The same record offered again, once the person said no to it: by the PRD and where it stood, not by the file's time, which other repos move. */
export const carryMark = (c: CrewCarry): string => `${c.file}|${c.prd}|${c.stage}`
