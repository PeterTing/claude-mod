/**
 * A PRD the brain drafts with the person, before it is started: who reviews
 * it and what each is asked, what a review found, and what the pane and the
 * brain are told about it. Pure.
 */

import type { CrewDraft } from '../types'
import { redact } from './memory'
import { ROLE_NAMES } from './model'
import type { Takeover } from './model'
import { cut } from './prd'

/** The roles that review a draft before the person confirms it. */
export const REVIEWERS = ['pm', 'uiux'] as const
export type Reviewer = (typeof REVIEWERS)[number]

type Review = CrewDraft['reviews'][number]

/** What each reviewer looks for: PM the requirements, UI/UX what the person will see. */
const REVIEW_ASKS: Record<Reviewer, string> = {
  pm: '需求寫不清楚或沒辦法驗收的、遺漏的情境和錯誤狀況、互相矛盾的地方',
  uiux: '使用者會看到的部分：頁面和路徑的缺口、遺漏的狀態（空的、載入中、錯誤）、體驗做不好的地方',
}

/** How many times one draft goes to review before the brain asks the person instead. */
export const MAX_SENDS = 3

/**
 * What a reviewer is asked. The first line is what the pane shows it doing;
 * the whole path is the one crew read, since a role that puts a long path
 * together itself can get it wrong.
 */
export const reviewPrompt = (role: Reviewer, path: string, full: string, id: string): string =>
  `審草稿 ${path}（${id}）\n大腦請你審這份 PRD 草稿。用 Read 讀 ${full}，找出${REVIEW_ASKS[role]}。\n第一行只寫「缺口 N 個」，沒有就寫「沒有缺口」；之後每個缺口一行：哪一條、為什麼、建議怎麼補，提到檔案時用 repo 裡的相對路徑。不要改看板，也不要改任何檔案。`

/** How a review ended: what it found, or why it did not finish. */
export type Outcome = { found: string; failed?: true; unsure?: true }

/** A reviewer's count of gaps, from the first line of its reply, as it was asked to write it; the reply is in the thread either way. */
export const outcomeOf = (reply: string): Outcome => {
  const first = reply.trim().split('\n')[0] ?? ''
  const n = /缺口\s*(\d+)\s*個/.exec(first)?.[1]
  if (n !== undefined) return { found: Number(n) === 0 ? '沒有缺口' : `${Number(n)} 個缺口` }
  return /沒有缺口/.test(first) ? { found: '沒有缺口' } : { found: '回覆沒照格式', unsure: true }
}

/** A PRD's title: its first heading, or its file name. */
export const titleIn = (text: string, path: string): string => cut(redact(/^#\s+(.+)$/m.exec(text.slice(0, 4_000))?.[1]?.trim() ?? path.split('/').pop() ?? path), 60)

/** A draft just sent to review: every reviewer at work. */
export const sentDraft = (path: string, title: string, requirements: number, sends: number): CrewDraft => ({
  path,
  title,
  requirements,
  stage: 'reviewing',
  reviews: REVIEWERS.map(role => ({ role, done: false })),
  sends,
})

/** The draft with a reviewer's ASK thread. */
export const withAsk = (d: CrewDraft, role: Reviewer, ask: string): CrewDraft => ({ ...d, reviews: d.reviews.map(r => (r.role === role ? { ...r, ask } : r)) })

/** The draft with how a reviewer's review ended. */
export const withOutcome = (d: CrewDraft, role: Reviewer, o: Outcome): CrewDraft => ({
  ...d,
  reviews: d.reviews.map(r =>
    r.role !== role
      ? r
      : {
          role: r.role,
          ...(r.ask === undefined ? {} : { ask: r.ask }),
          ...(o.failed === true ? { done: false, failed: true } : { done: true, ...(o.unsure === true ? { unsure: true } : {}) }),
          found: o.found,
        },
  ),
})

/** The reviewers still at work, and the ones that did not finish. */
export const pendingOf = <R extends { done: boolean; failed?: boolean }>(d: { reviews: readonly R[] }): R[] => d.reviews.filter(r => !r.done && r.failed !== true)
export const failedOf = <R extends { failed?: boolean }>(d: { reviews: readonly R[] }): R[] => d.reviews.filter(r => r.failed === true)

/** One review in a few words, the pane's and the brain's alike. */
export const reviewWord = (r: { done: boolean; failed?: boolean; found?: string }): string =>
  r.done ? (r.found ?? '已回覆') : r.failed === true ? (r.found ?? '沒有審完') : '審查中'

/** The mark the pane puts before a review: done, done in a form not asked for, did not finish, or none while at work. */
export const reviewMark = (r: { done: boolean; failed?: boolean; unsure?: boolean }): string =>
  r.done ? (r.unsure === true ? '? ' : '✓ ') : r.failed === true ? '✗ ' : ''

const name = (role: string): string => ROLE_NAMES[role as Reviewer] ?? role

/** Whether the draft went to review as often as it may: a review that did not finish is then the person's to weigh, not sent again. */
export const sentOut = (d: { sends?: number }): boolean => (d.sends ?? 1) >= MAX_SENDS

/** What the brain hears once every reviewer has settled: where each reply is, and what to do next. */
export const settledNote = (d: CrewDraft): string => {
  const each = d.reviews.map(r => `${name(r.role)}：${r.failed === true ? `沒有審完（${r.found ?? ''}）` : reviewWord(r)}${r.ask === undefined ? '' : `，${r.ask}`}`).join('；')
  const missed = failedOf(d).map(r => name(r.role))
  if (missed.length > 0 && sentOut(d)) return `PRD 草稿 ${d.path} 已送審 ${MAX_SENDS} 次，仍有審查沒有完成（${each}）。不要再送審：問使用者要不要照現在的草稿確認，要的話用 crew 工具 action=ready。`
  if (missed.length > 0) return `PRD 草稿 ${d.path} 的審查沒有全部完成（${each}）。${missed.join('、')} 要重審：用 crew 工具 action=draft、path=${d.path} 重新送審。`
  // A reply not in the asked form may say it could not review: the brain reads it before going on.
  const doubted = d.reviews.filter(r => r.unsure === true).map(r => `${name(r.role)}${r.ask === undefined ? '' : `（${r.ask}）`}`)
  const notReviewed = sentOut(d) ? `沒審的話，已送審 ${MAX_SENDS} 次，問使用者要不要照現在的草稿確認。` : `沒審就用 action=draft、path=${d.path} 重新送審。`
  const check = doubted.length === 0 ? '' : `${doubted.join('、')} 的回覆沒照格式：先用 thread_read 讀原話，確認真的審了；${notReviewed}`
  return `PM 和 UI/UX 都審完 PRD 草稿 ${d.path} 了（${each}；原話用 thread_read 讀）。${check}把缺口整理成問題問使用者，照回答改草稿，改好用 crew 工具 action=ready 請使用者確認。`
}

/** The draft as the brain needs it to go on, after a restart too: where it is, its stage, and each review with its thread. */
export const draftDetail = (d: CrewDraft): string =>
  `PRD 草稿：${d.path}（${d.stage === 'confirm' ? '等使用者確認' : '審查中'}；${d.reviews
    .map(r => `${name(r.role)} ${r.failed === true ? `沒有審完（${r.found ?? ''}）` : reviewWord(r)}${r.ask === undefined ? '' : ` ${r.ask}`}`)
    .join('、')}）`

/**
 * A draft as crew kept it for a restart; none when it has another shape, or
 * reviews other than one of each reviewer's. A review the last session left
 * under way cannot finish now: it did not.
 */
export const draftOf = (v: unknown): CrewDraft | undefined => {
  if (typeof v !== 'object' || v === null) return undefined
  const d = v as Partial<CrewDraft>
  if (typeof d.path !== 'string' || typeof d.title !== 'string' || typeof d.requirements !== 'number' || (d.stage !== 'reviewing' && d.stage !== 'confirm') || !Array.isArray(d.reviews)) return undefined
  const reviews: Review[] = []
  for (const role of REVIEWERS) {
    const kept = d.reviews.filter((r): r is Review => typeof r === 'object' && r !== null && r.role === role && typeof r.done === 'boolean')
    const r = kept[0]
    if (kept.length !== 1 || r === undefined) return undefined
    const found = typeof r.found === 'string' ? r.found : undefined
    reviews.push({
      role,
      ...(typeof r.ask === 'string' ? { ask: r.ask } : {}),
      ...(r.done
        ? { done: true, ...(found === undefined ? {} : { found }), ...(r.unsure === true ? { unsure: true } : {}) }
        : { done: false, failed: true, found: r.failed === true && found !== undefined ? found : '重開前沒審完' }),
    })
  }
  return {
    path: d.path,
    title: d.title,
    requirements: d.requirements,
    stage: d.stage,
    reviews,
    ...(typeof d.note === 'string' ? { note: d.note } : {}),
    ...(Number.isInteger(d.sends) && (d.sends ?? 0) >= 0 ? { sends: d.sends } : {}),
  }
}

/** The brain's takeover as the pane and the line above the prompt show it: on or not, whether no PRD is under way, and its draft. */
export const takeoverOf = (on: boolean, prdPath: string | null, draft: CrewDraft | undefined): Takeover => ({
  on,
  idle: prdPath === null,
  ...(on && draft !== undefined ? { draft } : {}),
})
