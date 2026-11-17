/**
 * The usage guard: Claude's subscription windows as Claude Code reads them,
 * and what crew does near their limits. It warns once a window, pauses the
 * roles on Claude past a threshold, and goes on at the window's reset. A window
 * at 100% holds whatever the switches say: work started then would fail. Pure.
 */

import type { CrewClaudeUsage, CrewUsageHold, CrewUsageWindow } from '../types'

export type GuardSettings = { on: boolean; warn: number; pause: { five_hour: number; seven_day: number } }

export const GUARD_DEFAULTS: GuardSettings = { on: true, warn: 80, pause: { five_hour: 90, seven_day: 95 } }

/** The thresholds the Token tab's buttons step through. */
export const WARN_STEPS = [70, 75, 80, 85]
export const PAUSE_STEPS: Record<'five_hour' | 'seven_day', number[]> = { five_hour: [85, 90, 95], seven_day: [90, 95, 98] }

/** What a role waiting for the reset says: the pane and the reset find it by these words. */
export const RESET_WAIT = '等 Claude 用量重置'

export const WINDOW_NAMES: Record<string, string> = { five_hour: '5 小時', seven_day: '7 天', spend_limit: '花費上限' }

export const windowName = (kind: string): string => WINDOW_NAMES[kind] ?? kind

/** How long a window runs, for one without a reset time: a warning or a 這次照常做 lasts that long. */
const WINDOW_MS: Record<string, number> = { five_hour: 5 * 3_600_000, seven_day: 7 * 86_400_000 }

const step = (steps: readonly number[], at: number): number => steps[(steps.indexOf(at) + 1) % steps.length] ?? steps[0] ?? at

/** The next threshold a button press gives. */
export const nextWarn = (s: GuardSettings): number => step(WARN_STEPS, s.warn)
export const nextPause = (s: GuardSettings, kind: 'five_hour' | 'seven_day'): number => step(PAUSE_STEPS[kind], s.pause[kind])

/** Settings as stored, each part checked: anything else is the default. */
export const guardOf = (v: unknown): GuardSettings => {
  const o = typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}
  const p = typeof o.pause === 'object' && o.pause !== null ? (o.pause as Record<string, unknown>) : {}
  const pick = (x: unknown, steps: readonly number[], d: number): number => (typeof x === 'number' && steps.includes(x) ? x : d)
  return {
    on: o.on !== false,
    warn: pick(o.warn, WARN_STEPS, GUARD_DEFAULTS.warn),
    pause: { five_hour: pick(p.five_hour, PAUSE_STEPS.five_hour, GUARD_DEFAULTS.pause.five_hour), seven_day: pick(p.seven_day, PAUSE_STEPS.seven_day, GUARD_DEFAULTS.pause.seven_day) },
  }
}

/** Where a window pauses crew: a gateway's spend limit, at the 7-day threshold. */
export const pauseAt = (s: GuardSettings, kind: string): number => (kind === 'five_hour' ? s.pause.five_hour : s.pause.seven_day)

/** The engine's readings as crew keeps them: a reset time unreadable is none. */
export const windowsOf = (limits: readonly { kind: string; percentUsed: number; resetsAt?: string }[]): CrewUsageWindow[] =>
  limits.flatMap(r => {
    if (typeof r.kind !== 'string' || typeof r.percentUsed !== 'number' || !Number.isFinite(r.percentUsed)) return []
    const at = typeof r.resetsAt === 'string' ? Date.parse(r.resetsAt) : NaN
    return [{ kind: r.kind, percent: r.percentUsed, ...(Number.isFinite(at) ? { resetsAt: at } : {}) }]
  })

/** A new reading over the last: a window it does not name keeps its last reading till that one's reset; one with no reset time goes. */
export const merged = (was: readonly CrewUsageWindow[], now: readonly CrewUsageWindow[]): CrewUsageWindow[] => [...now, ...was.filter(w => w.resetsAt !== undefined && !now.some(n => n.kind === w.kind))]

/** A window whose reset time has passed reads as nothing until the next reading: its number is the last window's. */
export const current = (windows: readonly CrewUsageWindow[], now: number): CrewUsageWindow[] => windows.filter(w => w.resetsAt === undefined || w.resetsAt > now)

export type Judged = {
  next: CrewClaudeUsage
  /** Windows that crossed the warning line, once each window. */
  warn: CrewUsageWindow[]
  /** The hold that began now, or the one that ended now. */
  paused?: CrewUsageHold
  released?: CrewUsageHold
}

/**
 * What a reading means: the hold is the window over its threshold, or at 100%,
 * that resets last; 這次照常做 lifts a window's pause till its reset, not its
 * 100%. A warning or a 這次照常做 ends with its window, or when the window reads
 * below its line again.
 */
export function judge(was: CrewClaudeUsage | undefined, windows: readonly CrewUsageWindow[], s: GuardSettings, now: number): Judged {
  const live = current(windows, now)
  const reading = (kind: string) => live.find(w => w.kind === kind)
  // A mark with no reading of its window yet, as at a restart, stays: only a reading below its line ends it before its time.
  const lasting = (marks: Record<string, number> | undefined, line: (kind: string) => number) =>
    Object.fromEntries(Object.entries(marks ?? {}).filter(([kind, until]) => until > now && (reading(kind)?.percent ?? Infinity) >= line(kind)))
  const goOn = lasting(was?.goOn, kind => pauseAt(s, kind))
  const warned = lasting(was?.warned, () => s.warn)
  const warn = s.on ? live.filter(w => w.percent >= s.warn && warned[w.kind] === undefined) : []
  for (const w of warn) warned[w.kind] = w.resetsAt ?? now + (WINDOW_MS[w.kind] ?? WINDOW_MS.five_hour ?? 0)
  const over = live.filter(w => w.percent >= 100 || (s.on && w.percent >= pauseAt(s, w.kind) && goOn[w.kind] === undefined))
  const last = [...over].sort((a, b) => (b.resetsAt ?? Infinity) - (a.resetsAt ?? Infinity))[0]
  const hold: CrewUsageHold | undefined = last === undefined ? undefined : { kind: last.kind, percent: last.percent, ...(last.resetsAt === undefined ? {} : { until: last.resetsAt }), ...(last.percent >= 100 ? { full: true as const } : {}) }
  const next: CrewClaudeUsage = {
    windows: [...windows],
    ...(Object.keys(warned).length === 0 ? {} : { warned }),
    ...(Object.keys(goOn).length === 0 ? {} : { goOn }),
    ...(hold === undefined ? {} : { hold }),
  }
  return {
    next,
    warn,
    ...(hold !== undefined && was?.hold === undefined ? { paused: hold } : {}),
    ...(hold === undefined && was?.hold !== undefined ? { released: was.hold } : {}),
  }
}

/** 這次照常做: the held window, and any other over its pause line, runs on till its reset. */
export const goOnUntil = (u: CrewClaudeUsage, s: GuardSettings, now: number): Record<string, number> =>
  Object.fromEntries(
    current(u.windows, now)
      .filter(w => w.percent < 100 && w.percent >= pauseAt(s, w.kind))
      .map(w => [w.kind, w.resetsAt ?? now + (WINDOW_MS[w.kind] ?? 0)]),
  )

/** When a window resets, in the pane's words: the time today, the day and time further off. */
export const resetWords = (until: number | undefined, now: number, clock: (t: number) => string, stamp: (t: number, now: number) => string): string =>
  until === undefined ? '重置時間不明' : until - now < 20 * 3_600_000 ? clock(until) : stamp(until, now)

/** A percent as Claude Code shows it: whole, or one decimal. */
export const percentWords = (p: number): string => `${Math.round(p * 10) / 10}%`
