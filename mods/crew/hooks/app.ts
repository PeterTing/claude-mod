/**
 * The app crew starts in QA's worktree, for QA's checks and kept up for the
 * person's acceptance: how long crew waits on it, its record while it runs,
 * what its commands run with, and what a card and a restart read of it. Pure.
 */

import type { CrewAcceptApp } from '../types'
import { redact } from './memory'
import type { AcceptAppRow } from './model'
import { cut, fingerprint } from './prd'
import type { PageAcceptApp } from './review'

/** How long crew waits for the app to answer at its URL. */
export const APP_WAIT_MS = 120_000
/** How long crew waits for an app its start command leaves running in the background (a stop command set): building its images can take minutes. */
export const APP_WAIT_STOP_MS = 600_000
/** How often crew asks the app's URL, and looks at what holds it, while it waits. */
export const APP_POLL_MS = 2_000
/** How often crew asks the URL of the app kept for acceptance that runs in the background: its command ended at the start, so only the URL says it is up. */
export const BACKGROUND_LOOK_MS = 30_000
/** The most of the app's output crew keeps for its log: the end of it. */
export const APP_LOG_MAX = 200_000
/** How long the stop command may take. */
export const STOP_WAIT_MS = 120_000
/** A process that started this long before crew's start command is not one it started (the clock and ps count whole seconds). */
export const START_SLACK_MS = 3_000

export type Shot = { file: string; box?: { x: number; y: number; width: number; height: number } }
/** What QA reported on a check, as crew keeps it: masked, cut to size, its screenshots copied beside the PRD's designs. */
export type CheckReport = {
  feature: string
  round: number
  at: number
  ok: boolean
  /** `shot`: the screenshot of a test case verified by QA in the app, beside the report's (a passed one has one). */
  cases: { id: string; result: 'passed' | 'failed' | 'blocked'; note?: string; shot?: string }[]
  items: { criterion: string; ask: string; saw: string; how?: string; desktop?: Shot; phone?: Shot; api?: { request: string; response: string; lit: string[] } }[]
  console: { errors: number; sample: string[] }
  failed: { criterion?: string; case?: string; what: string }[]
  /** Test cases QA could not run for the setup (no test account, a service down), not for what the code does. */
  blocked?: { case: string; what: string }[]
  /** QA read the feature, with no app to start (crew did so before every item came with a picture): what it lists comes with how to see each. */
  read?: true
  /** Where the feature is in the app: its page's address, the way there from the menu, or why it has none. */
  where?: { page?: string; menu?: string; none?: string }
  /** The commit QA's worktree was at: the app the person opens to accept the feature runs there. */
  sha?: string
}

/**
 * The app crew started: its stream, when crew started it, whether it ended,
 * and how; where it runs (QA's worktree), at which commit, its URL, the start
 * command as it ran, the log its output goes to once it stops, and the end of
 * that output. `kept`: the person's acceptance keeps it up (a check that uses
 * it meanwhile leaves it up).
 */
export type AppRun = {
  it: AsyncIterator<{ text: string }, { code: number | null; signal: string | null } | undefined>
  since: number
  ended: boolean
  end?: string
  code?: number | null
  pids?: string[]
  dir: string
  url: string
  log: string
  sha?: string
  argv: string
  out: string[]
  /** It answered at its URL: what listens there now is `pids`. */
  up?: true
  kept?: true
  /**
   * A stop command was set as it started: a start command that ends well then
   * leaves the app in the background (docker compose up -d), and only that
   * command ends it (see inBackground).
   */
  stop?: true
  /** Kept for acceptance in the background: crew asks its URL now and then (keptBackground). */
  watched?: true
}

/**
 * The app runs on in the background: its start command ended well and the
 * stop command set as it started ends it (docker compose up -d). Its command
 * ending says nothing of it: only its URL tells whether it is up.
 */
export const inBackground = (app: AppRun): boolean => app.ended && app.code === 0 && app.stop === true

/** The app is gone by itself: its command ended (crashed, or ended at all), unless that left it in the background. */
export const appDead = (app: AppRun): boolean => app.ended && !inBackground(app)

/** What QA found in the repo to start the app with, and where it found each: crew sets it only on the person's own press. */
export type AppProposal = { start: string[]; stop?: string[]; url: string; accounts?: string; found: { start: string; stop?: string; url: string; accounts?: string }; noAccounts?: string }

/**
 * The app the last session kept up for acceptance, as it saved it: only what
 * crew needs to stop it, and only strings. One it was closing (QA's check on
 * it, to stop as the check ended) is crew's to stop too: the session ended
 * first, and what it left runs on.
 */
export const acceptAppOf = (v: unknown): { acceptApp?: CrewAcceptApp } => {
  if (typeof v !== 'object' || v === null) return {}
  const a = v as Record<string, unknown>
  if (a.state !== 'starting' && a.state !== 'up' && a.state !== 'closing') return {}
  const str = (x: unknown): string | undefined => (typeof x === 'string' && x !== '' ? x : undefined)
  const dir = str(a.dir)
  const url = str(a.url)
  const pids = Array.isArray(a.pids) ? a.pids.filter((p): p is string => typeof p === 'string' && /^\d+$/.test(p)) : []
  if (dir === undefined && url === undefined) return {}
  const checking = typeof a.checking === 'string' && /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(a.checking) ? a.checking : undefined
  return { acceptApp: { state: a.state, features: [], since: typeof a.since === 'number' ? a.since : 0, ...(dir === undefined ? {} : { dir }), ...(url === undefined ? {} : { url }), ...(pids.length === 0 ? {} : { pids }), ...(a.state === 'closing' && checking !== undefined ? { checking } : {}) } }
}

/**
 * What the app's commands run with in QA's worktree. Docker Compose names its project by the folder, or by the compose
 * file's own name, which the person's own stack from their checkout shares: crew's gets a name of its own, so its start
 * and stop commands touch only the containers crew started. A `-p` the person wrote still wins.
 */
export const qaEnv = (dir: string): Record<string, string> => ({ CREW_QA: '1', BROWSER: 'none', COMPOSE_PROJECT_NAME: qaProject(dir) })

/** The Docker Compose project crew's app runs as, by QA's worktree: one per worktree, the same after a reload. */
export const qaProject = (dir: string): string => `crew-qa-${fingerprint(dir)}`

/** How long crew waits for the app to answer: longer when a stop command ends it, the start command leaving it in the background. */
export const appWaitMs = (stop: boolean): number => (stop ? APP_WAIT_STOP_MS : APP_WAIT_MS)

/** ps's elapsed time, `[[dd-]hh:]mm:ss`, in ms. */
export const elapsedMs = (etime: string): number | undefined => {
  const m = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/.exec(etime)
  if (m === null) return undefined
  const [d, h, mi, s] = [m[1], m[2], m[3], m[4]].map(x => Number(x ?? 0))
  return ((((d ?? 0) * 24 + (h ?? 0)) * 60 + (mi ?? 0)) * 60 + (s ?? 0)) * 1000
}

/** What the person is told of a close that waits for QA's check: the app stops as the check ends. */
export const closingSaid = (feature: string | undefined): string => `QA 正在用它檢查 ${feature ?? '一個功能'}，檢查完 crew 就關掉。`

/** The record as it is when the app could not start: what the card says, with the log to read. */
export const acceptFailed = (a: CrewAcceptApp, url: string, why: string, log?: string): CrewAcceptApp => ({ state: 'failed', features: a.features, since: a.since, url, why: cut(redact(why).replace(/\s+/g, ' ').trim(), 400), ...(log === undefined ? {} : { log }) })

/** The app kept up for acceptance as a card shows it: its log (from the project's root, as the caller gives it), and whether it serves the card's feature. */
export const pageAcceptApp = (a: AcceptAppRow, log: string | undefined, feature: string): PageAcceptApp => ({
  state: a.state,
  mine: a.features.includes(feature),
  ...(a.sha === undefined ? {} : { sha: a.sha }),
  ...(a.phase === undefined ? {} : { phase: a.phase }),
  ...(a.waitS === undefined ? {} : { waitS: a.waitS }),
  ...(a.why === undefined ? {} : { why: a.why }),
  ...(log === undefined || a.state !== 'failed' ? {} : { log }),
  ...(a.checking === undefined ? {} : { checking: a.checking }),
  ...(a.background === true ? { background: true as const } : {}),
  ...(a.waits.tests + a.waits.merges === 0 ? {} : { waits: { ...a.waits } }),
})
