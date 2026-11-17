import type { CrewTab } from '../types'
import { ROLE_NAMES } from './model'

/**
 * Where a press on the pane takes crew's web page, in one word: kept as the
 * page's own move when a crew tab is open, and carried on the page's address
 * when a new one opens (`#k=<key>&go=<word>`), so only these characters, which
 * pass an address, the server and its check as they are.
 *
 * The words: a tab (`overview`, `progress`, …, `decide`); `decide~draft`;
 * `decide~accept~F-001`, `decide~design~SCR-001`, `decide~question~Q-01`, one
 * thing on 待你決定; `decide~key~<control>`, one of crew's own controls there;
 * `progress~stage~<n>`, a stage of the progress; `overview~gate~G6`, a gate
 * opened; `overview~gates~G4`, the gates scrolled to; `overview~role~<row>`,
 * a role's row, `overview~detail~<row>`, its details opened; `run~<role>` or
 * `run~<role>~<item>`, a role's runs; `item~<id>`, an item's page; and
 * `tokens~alerts`, the reminders sent to the brain.
 */
export const GO_WORD = /^[A-Za-z0-9_.:@~-]{1,160}$/

/** One id in a word: a board's or crew's number, a role's row, a control's key. */
const ID = /^[A-Za-z0-9_.:@-]{1,80}$/

/** A tab of the page as a word names it: the pane's tabs, and 待你決定. */
const TAB_WORDS: readonly (CrewTab | 'decide')[] = ['decide', 'overview', 'progress', 'board', 'threads', 'log', 'memory', 'tokens', 'models', 'settings']

/** The stages of the progress, in their order: the page finds the one pressed by its name. */
export const STAGE_LABELS = ['規格', '設計', '測試案例', '任務', '實作', 'Review', '測試結果'] as const

const ROLES = ['pm', 'uiux', 'fullstack', 'qa', 'techlead'] as const

/**
 * What the page brings into view once it is there: a thing of the decide page
 * (its tab and the thing's number), else the first of crew's own controls the
 * page draws by these keys, else the first words that start so.
 */
export type GoFocus = { frame?: { tab: 'prd' | 'accept' | 'designs' | 'questions'; id?: string }; keys?: readonly string[]; text?: string }

/**
 * A word read: the page's tab, the page opened over it, the gate and the role
 * whose details are open on the overview, what to bring into view, and the
 * place in the words a toast says it.
 */
export type PaneGo = { tab: CrewTab | 'decide'; page?: string; gate?: string; detail?: string; focus?: GoFocus; say: string }

const TAB_SAID: Record<CrewTab | 'decide', string> = {
  decide: '待你決定',
  overview: '總覽',
  progress: '進度',
  board: '看板',
  threads: '討論',
  log: '記錄',
  memory: '記憶',
  tokens: 'Token',
  models: '模型',
  settings: '設定',
}

/** A word read, or nothing for one crew does not know: the page then stays where it is. */
export function goOf(word: string): PaneGo | undefined {
  if (!GO_WORD.test(word)) return undefined
  const [head = '', what, id, extra, ...rest] = word.split('~')
  if (rest.length > 0) return undefined
  const tab = TAB_WORDS.find(t => t === head)
  if (tab !== undefined && what === undefined) return { tab, say: TAB_SAID[tab] }
  const ok = (x: string | undefined): x is string => x !== undefined && ID.test(x)
  if (head === 'decide' && extra === undefined) {
    if (what === 'draft' && id === undefined) return { tab: 'decide', focus: { frame: { tab: 'prd' }, keys: ['confirm-draft'] }, say: '待你決定・PRD 草稿' }
    if (!ok(id)) return undefined
    if (what === 'accept') return { tab: 'decide', focus: { frame: { tab: 'accept', id }, keys: [`acc-pass-${id}`, `acc-change-${id}`] }, say: `待你決定・${id}` }
    if (what === 'design') return { tab: 'decide', focus: { frame: { tab: 'designs', id }, keys: [`view-${id}`, `approve-${id}`] }, say: `待你決定・${id}` }
    if (what === 'question') return { tab: 'decide', focus: { frame: { tab: 'questions', id }, keys: [`answer-${id}`, `option-${id}-0`] }, say: `待你決定・${id}` }
    if (what === 'key') return { tab: 'decide', focus: { keys: [id] }, say: '待你決定' }
    return undefined
  }
  if (head === 'progress' && what === 'stage' && extra === undefined && id !== undefined && /^\d$/.test(id)) {
    const label = STAGE_LABELS[Number(id)]
    return label === undefined ? undefined : { tab: 'progress', focus: { text: label }, say: `進度・${label}` }
  }
  if (head === 'overview' && extra === undefined && ok(id)) {
    if (what === 'gate') return { tab: 'overview', gate: id, focus: { keys: [`gate-${id}`] }, say: `總覽・${id}` }
    if (what === 'gates') return { tab: 'overview', focus: { keys: [`gate-${id}`] }, say: '總覽・關卡' }
    if (what === 'role' || what === 'detail') {
      const m = id.match(/^([a-z]+)(?:-(\d+))?$/)
      const role = ROLES.find(r => r === m?.[1])
      if (role === undefined) return undefined
      const slot = m?.[2]
      // A builder after the first has no 問 of its own (the full-stack's is on the first's card): its card is found by its name.
      const focus: GoFocus = slot === undefined ? { keys: [`detail-${id}`, `run-${id}`, `ask-${role}`] } : { keys: [`detail-${id}`, `run-${id}`], text: `${ROLE_NAMES[role]} ${slot}` }
      return { tab: 'overview', ...(what === 'detail' ? { detail: id } : {}), focus, say: '總覽・角色' }
    }
    return undefined
  }
  if (head === 'run' && ROLES.some(r => r === what) && (id === undefined || (ok(id) && extra === undefined))) {
    return { tab: 'overview', page: `run:${what}${id === undefined ? '' : `@${id}`}`, say: '執行過程' }
  }
  if (head === 'item' && ok(what) && id === undefined) return { tab: 'progress', page: `item:${what}`, say: what }
  if (head === 'tokens' && what === 'alerts' && id === undefined) return { tab: 'tokens', focus: { text: '提醒已送大腦' }, say: 'Token・提醒' }
  return undefined
}

/** A word made of its parts, or the coarser one when a part cannot go in a word (an id crew does not expect). */
export function goWord(parts: readonly string[], fallback: string): string {
  const word = parts.join('~')
  return goOf(word) === undefined ? fallback : word
}
