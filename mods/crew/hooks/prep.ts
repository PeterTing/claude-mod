/**
 * The person's worktree prep command: what crew runs in a worktree it has just
 * made, before a builder starts there (links the packages, copies the env
 * files), and how a run went, in words. Pure: no `$`.
 */

import { cut } from './prd'

/** How a run ended: its exit code, killed past the limit, or not started at all. */
export type PrepExit = number | 'timeout' | 'error'

/**
 * One run of the prep command: in which worktree, for which task, how it
 * ended, and its evidence; `left`, what git showed untracked there after it
 * (a link to the packages, a copied env file); `trial`, one the person asked
 * for, which no builder waits on; `merge`, one run again in crew's worktree
 * for a merge, which stops the merge when it fails; `sha`, the commit the
 * worktree was on.
 */
export type PrepRun = { dir: string; task?: string; cmd: string; exit: PrepExit; ms: number; at: number; log: string; tail: string; left?: string[]; linked?: Record<string, string>; trial?: true; merge?: true; sha?: string }

/** The longest crew lets the prep run: the most the host allows. */
export const PREP_TIMEOUT_MS = 600_000

/** The lines of output a builder is told when the prep failed. */
export const PREP_TAIL_LINES = 20

/** The last lines of a run's output, each cut: what the builder and the pane are shown. */
export const tailOf = (output: string, lines = PREP_TAIL_LINES): string =>
  output
    .split('\n')
    .map(l => l.trimEnd())
    .filter(l => l !== '')
    .slice(-lines)
    .map(l => cut(l, 200))
    .join('\n')

/** How a run ended, in words. */
export const exitWords = (exit: PrepExit): string => (exit === 'timeout' ? '跑超過 10 分鐘被停掉' : exit === 'error' ? '沒辦法執行' : `exit ${exit}`)

/** Which worktree a run was in: a task's, or crew's own branch. */
export const prepWhere = (task: string | undefined): string => (task === undefined ? 'crew 自己分支' : task)

/** How long a run took, in seconds or minutes. */
export const tookWords = (ms: number): string => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} 秒` : `${Math.round(ms / 60_000)} 分鐘`)

/**
 * What the first builder in a worktree is told of the prep run there: ready,
 * or what went wrong and what to do about it. `item` is the work it was given,
 * for the thread it asks on.
 */
export const prepLine = (run: PrepRun, item?: string): string => {
  const cmd = run.cmd
  const left = run.left === undefined || run.left.length === 0 ? '' : `準備指令放在這裡、沒有追蹤的檔案：${run.left.slice(0, 10).join('、')}${run.left.length > 10 ? ` 等 ${run.left.length} 個` : ''}。它們不是任務的修改，不要 commit（不要用 git add -A 或 git add .，只 add 你改的檔案）。`
  if (run.exit === 0) return `worktree 已準備好：crew 在這個目錄跑過準備指令（${cmd}，exit 0）。${left}`
  const tail = run.tail === '' ? '（沒有輸出）' : run.tail
  const ask = item === undefined ? '弄不好用 thread_post 問 Tech lead' : `弄不好用 thread_post 問 Tech lead（item 填 ${item}）`
  return `worktree 的準備指令沒跑成功（${cmd}，${exitWords(run.exit)}）。最後 ${PREP_TAIL_LINES} 行輸出：\n${tail}\n先照輸出把環境弄好再開始；${ask}。不要讀或印出 .env 檔的內容。${left}`
}

/**
 * The newest `n` of a record kept by worktree, in the order they were written, with crew's own worktree (`own`) always
 * among them: a merge reads its entry there however many task worktrees came since.
 */
export const keepNewest = <T,>(entries: readonly (readonly [string, T])[], n: number, own: string | undefined): (readonly [string, T])[] => {
  const mine = entries.filter(([d]) => d === own)
  const others = entries.filter(([d]) => d !== own)
  return [...mine, ...others.slice(Math.max(0, others.length - Math.max(0, n - mine.length)))]
}

/** Where the person sets the prep command and tries it, as the pane names them. */
export const PREP_ROW = '右側面板「設定」分頁的「worktree 準備」'
export const PREP_TRY = '［試跑］'

/**
 * crew's one question on the merges its prep run stopped in crew's worktree:
 * that the merges stopped and the tasks are not at fault, which tasks, the end
 * of the run's output and its log, what the person does, and what crew does on
 * the answer (one run again per answer, never more on its own).
 */
export const stuckQuestion = (merges: readonly { task: string; title?: string; sha: string }[], run: PrepRun | undefined): string => {
  const tail = run === undefined || run.tail === '' ? [] : run.tail.split('\n').slice(-6)
  return [
    'crew 要把做好、Tech lead 也看過的任務併進 crew 的分支（做好的任務都併在這裡）。併進去之前，crew 要先在自己的工作目錄重跑你在設定分頁「worktree 準備」填的指令（任務改到套件設定檔，或上次沒跑成功時都會重跑）。這次沒跑成功，所以下面的任務先停著，沒有併進去，也還沒跑測試。這不是這些任務的程式有問題，全端不用改。',
    '',
    '停住的任務：',
    ...merges.map(m => `- ${m.task}${m.title === undefined || m.title === '' ? '' : `「${m.title}」`}（commit ${m.sha.slice(0, 7)}）`),
    '',
    run === undefined ? '準備指令沒有跑完，沒有輸出。' : `準備指令：${run.cmd}（${exitWords(run.exit)}）`,
    ...(tail.length === 0 ? [] : ['輸出的最後幾行：', ...tail.map(l => `    ${l}`)]),
    ...(run === undefined ? [] : [`完整輸出在 ${run.log}。`]),
    '',
    '要怎麼處理：',
    `1. 照輸出把這台電腦的環境，或準備指令本身弄好（準備指令在${PREP_ROW}）。`,
    `2. 按同一列的${PREP_TRY}，確認它在 crew 的分支跑得成功。`,
    '3. 回覆這一題，寫什麼都可以，例如「好了」。',
    '',
    '回覆之後：crew 先在自己的工作目錄重跑一次準備指令。跑成功，就依序把上面的任務併進去、跑測試；還是沒成功，crew 把新的原因寫回這一題，等你再回覆。crew 不會自己一直重試，要等你回覆才會再試一輪。在面板按［接續］也會照樣重試。',
    '',
    '停住的期間，其他任務照常做；之後要併的任務如果也停在這裡，會加進這一題，不會另外再問。',
  ].join('\n')
}

/** The overview's line for a builder waiting on the prep. */
export const PREP_WAIT = '準備'

export const prepWait = (task: string | undefined): string => `${PREP_WAIT} ${prepWhere(task)} 的 worktree，跑完才開工`
