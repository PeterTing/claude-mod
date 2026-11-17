/**
 * Which work on the tasks starts now, and where: the full-stack slots the
 * builds and fixes run in, the one tech lead that reviews, the person's limit
 * on agents at once, and the rules that keep two jobs from breaking each
 * other's work. Two jobs that change the same files, or the files every part
 * of a project leans on, never run at once; a job that did not say what it
 * changes runs alone. Pure.
 */

/** The most full-stack slots crew runs: slot 1 is the role's own agent. */
export const MAX_SLOTS = 8

/** A piece of work that could start: a review, a fix of what a review asked for, or a build. */
export type Work = {
  kind: 'review' | 'fix' | 'build'
  task: string
  /** The files and folders the task says it changes. */
  touches: readonly string[]
  /** How many tasks wait for this one. */
  waitedOn: number
  /** Its place in the plan: the tech lead's numbering. */
  order: number
  /** The slot that last worked on it: a fix goes back there when it is free. */
  home?: number
  /** Built in crew's own worktree, not on a branch of its own: only the first slot's builder works there. */
  shared?: true
  /** A fix the person asked for on a feature handed to them: it goes ahead of other work of its kind. */
  urgent?: true
}

/** A job under way: its slot (0 for the tech lead) and the files it said it changes. */
export type Running = { task: string; slot: number; touches: readonly string[] }

export type Room = {
  /** Agents at once, the tech lead's review counted. */
  limit: number
  /** Tasks with a commit waiting for review: past REVIEW_BACKLOG, no new build starts. */
  waitingReview: number
  /** Why the limit is lower than the person set: the usage guard's warn or pause line. */
  usage?: 'warn' | 'pause'
  /** Free slots whose builder still holds a task that waits (for the person, or the tech lead): other work takes them last, so that task goes on with the builder that knows it. */
  kept?: readonly number[]
}

/** Tasks waiting for review before new builds hold off: the tech lead catches up first. */
export const REVIEW_BACKLOG = 2

export type Start = { work: Work; slot: number }

/**
 * Files every part of a project leans on: packages and their locks, database
 * migrations and schemas, route tables, global styles and configuration. Two
 * jobs that touch any of them run one after the other.
 */
const HOT_NAMES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'npm-shrinkwrap.json',
  'cargo.toml',
  'cargo.lock',
  'go.mod',
  'go.sum',
  'pyproject.toml',
  'poetry.lock',
  'uv.lock',
  'requirements.txt',
  'pipfile',
  'pipfile.lock',
  'gemfile',
  'gemfile.lock',
  'composer.json',
  'composer.lock',
  'tsconfig.json',
  'settings.py',
  '.env.example',
  'globals.css',
  'global.css',
  'docker-compose.yml',
  'docker-compose.yaml',
  'dockerfile',
])

const HOT_SEGMENTS = new Set(['migrations', 'migration', 'migrate', 'alembic'])

const HOT_PATTERNS = [/^schema\.[a-z]+$/, /\.prisma$/, /^routes?\.[a-z]+$/, /^router\.[a-z]+$/, /\.config\.[a-z]+$/]

/** A path as the scheduler compares it: no glob, no leading `./`, no trailing slash; '' stands for the whole repo. */
export const baseOf = (path: string): string => {
  const parts = path.trim().replace(/^\.\//, '').split('/')
  const cut = parts.findIndex(p => /[*?[{]/.test(p))
  return (cut === -1 ? parts : parts.slice(0, cut)).filter(p => p !== '' && p !== '.').join('/')
}

/** Whether a path is one of the files every part of the project leans on. */
export const isHot = (path: string): boolean => {
  const parts = baseOf(path).toLowerCase().split('/').filter(p => p !== '')
  const name = parts.at(-1) ?? ''
  return parts.some(p => HOT_SEGMENTS.has(p)) || HOT_NAMES.has(name) || HOT_PATTERNS.some(r => r.test(name))
}

/** Whether two paths may name the same file: one is the other, or holds it. */
export const overlap = (a: string, b: string): boolean => {
  const x = baseOf(a)
  const y = baseOf(b)
  return x === '' || y === '' || x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)
}

/** Whether two jobs may change the same files: one did not say what it changes, they share a path, or both touch a hot file. */
export const clash = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === 0 || b.length === 0 || a.some(p => b.some(q => overlap(p, q))) || (a.some(isHot) && b.some(isHot))

/** The slot a job takes: work in crew's own worktree the first; a fix the slot that built it, when free; else a free one, a slot kept for a waiting task last. */
const slotFor = (w: Work, busy: ReadonlySet<number>, kept: readonly number[] = []): number | undefined => {
  if (w.shared === true) return busy.has(1) ? undefined : 1
  if (w.home !== undefined && w.home >= 1 && w.home <= MAX_SLOTS && !busy.has(w.home)) return w.home
  const free = Array.from({ length: MAX_SLOTS }, (_, i) => i + 1).filter(n => !busy.has(n))
  return free.find(n => !kept.includes(n)) ?? free[0]
}

const KIND_ORDER: Record<Work['kind'], number> = { review: 0, fix: 1, build: 2 }

/** The order work is taken in: what is in hand first (review, then fix), the person's fixes before the rest of a kind, then the task most waited on, then the plan's order. */
export const ordered = (work: readonly Work[]): Work[] =>
  [...work].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || Number(b.urgent === true) - Number(a.urgent === true) || b.waitedOn - a.waitedOn || a.order - b.order)

/**
 * The work that starts now, each with its slot: the review in the tech lead's
 * (slot 0), one at a time; fixes and builds in free full-stack slots, a fix
 * back in the slot that built it when that one is free, and work in crew's
 * own worktree in the first slot alone. Agents at once stay
 * within the limit, the review counted. A build waits while more than
 * REVIEW_BACKLOG tasks wait for review, and any job waits while one that may
 * change the same files runs.
 */
export const schedule = (work: readonly Work[], running: readonly Running[], room: Room): Start[] => {
  const limit = Math.max(0, Math.min(MAX_SLOTS + 1, room.limit))
  const now = [...running]
  const starts: Start[] = []
  for (const w of ordered(work)) {
    if (now.length >= limit) break
    if (now.some(r => r.task === w.task)) continue
    if (w.kind === 'review') {
      if (now.some(r => r.slot === 0)) continue
      now.push({ task: w.task, slot: 0, touches: [] })
      starts.push({ work: w, slot: 0 })
      continue
    }
    if (w.kind === 'build' && room.waitingReview > REVIEW_BACKLOG) continue
    // A review only reads: it changes no file another job could break.
    if (now.some(r => r.slot !== 0 && clash(w.touches, r.touches))) continue
    const slot = slotFor(w, new Set(now.map(r => r.slot)), room.kept)
    if (slot === undefined) continue
    now.push({ task: w.task, slot, touches: w.touches })
    starts.push({ work: w, slot })
  }
  return starts
}

/** What two jobs' files have in common, in words: the path they share, or the hot files both lean on. */
const clashWords = (a: readonly string[], b: readonly string[]): string => {
  if (a.length === 0) return '沒寫會改哪些檔案，要單獨做'
  if (b.length === 0) return '那件沒寫會改哪些檔案，要單獨做'
  // Of a path and the one holding it, the holder: the folder one changes, the other changing a file in it.
  const pair = a.flatMap(p => b.filter(q => overlap(p, q)).map(q => [baseOf(p), baseOf(q)] as const))[0]
  if (pair !== undefined) return `都改 ${(pair[0].length <= pair[1].length ? pair[0] : pair[1]) || '整個 repo'}`
  return `都改專案共用的檔案（${a.filter(isHot).map(baseOf).join('、')}）`
}

/**
 * Why each piece of work the schedule does not start waits, in words, in the
 * order the schedule weighs it: the same rules as `schedule`.
 */
export const waitsOf = (work: readonly Work[], running: readonly Running[], room: Room): { task: string; why: string }[] => {
  const limit = Math.max(0, Math.min(MAX_SLOTS + 1, room.limit))
  const now = [...running]
  const waits: { task: string; why: string }[] = []
  for (const w of ordered(work)) {
    if (now.some(r => r.task === w.task)) continue
    if (now.length >= limit) {
      // The usage guard's line, not the person's setting nor a full room, is what holds the work then.
      const why =
        room.usage === 'pause'
          ? 'Claude 用量到了暫停線，crew 先不開新的工作，重置後接著做'
          : room.usage === 'warn'
            ? `Claude 用量到了提醒線，crew 一次只跑 1 個 agent（Tech lead 的 review 算在內），現在 ${now.length} 個在工作`
            : `同時最多 ${limit} 個 agent（Tech lead 的 review 算在內），都在工作`
      waits.push({ task: w.task, why })
      continue
    }
    if (w.kind === 'review') {
      if (now.some(r => r.slot === 0)) {
        const at = now.find(r => r.slot === 0)?.task ?? ''
        waits.push({ task: w.task, why: at === '' ? '等 Tech lead 忙完手上的事再 review' : `等 Tech lead review 完 ${at}` })
        continue
      }
      now.push({ task: w.task, slot: 0, touches: [] })
      continue
    }
    if (w.kind === 'build' && room.waitingReview > REVIEW_BACKLOG) {
      waits.push({ task: w.task, why: `已經有 ${room.waitingReview} 件等 review，Tech lead 先追上才開新的` })
      continue
    }
    const hit = now.find(r => r.slot !== 0 && clash(w.touches, r.touches))
    if (hit !== undefined) {
      waits.push({ task: w.task, why: hit.task === '' ? '全端 1 正在做你交代的事，它的檔案可能重疊' : `和 ${hit.task} ${clashWords(w.touches, hit.touches)}，等它做完` })
      continue
    }
    const slot = slotFor(w, new Set(now.map(r => r.slot)), room.kept)
    if (slot === undefined) {
      waits.push({ task: w.task, why: w.shared === true ? '要在 crew 自己的分支做，全端 1 還在忙' : '沒有空的全端' })
      continue
    }
    now.push({ task: w.task, slot, touches: w.touches })
  }
  return waits
}
