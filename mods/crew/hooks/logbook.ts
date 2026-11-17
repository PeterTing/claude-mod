/**
 * The log tab: what crew did, read from its daily log (.crew/log), in words.
 * What people wrote each other is the Threads tab's, and crew's quiet looks (a
 * memory search) are left out. Pure.
 */

import { stampOf } from './live'
import { ROLE_NAMES } from './model'
import type { LogEntry, RoleId, RunStep } from './model'
import { cut } from './prd'
import { exitWords, prepWhere, tookWords } from './prep'
import type { PrepExit } from './prep'

const isRole = (who: unknown): who is RoleId => typeof who === 'string' && Object.hasOwn(ROLE_NAMES, who)

const nameOf = (who: unknown): string => (isRole(who) ? ROLE_NAMES[who] : who === 'brain' ? '大腦' : who === 'person' ? '你' : typeof who === 'string' && who !== '' ? who : 'crew')

/** A role's name, a builder past the first by its slot, as the overview names it. */
export const nameIn = (role: unknown, slot: unknown): string => (role === 'fullstack' && typeof slot === 'number' && slot > 1 ? `${ROLE_NAMES.fullstack} ${slot}` : nameOf(role))

/** Who a line is about. */
const byOf = (e: Line): string => nameIn(e.role, e.slot)

const stringOf = (v: unknown): string => (typeof v === 'string' ? v : '')

const firstLine = (text: string): string => (text.split('\n').find(l => l.trim() !== '') ?? '').trim()

/** The row's line of a long text, and all of it when the line does not say it all. */
const said = (text: string): Pick<LogEntry, 'text' | 'full'> => {
  const line = cut(firstLine(text), 140)
  return { text: line, ...(line === text.trim() ? {} : { full: text }) }
}

/** The number work is on, where the log line names none: what crew hands out for one item opens with it. */
const itemIn = (text: string): string | undefined => /\b(?:TASK|SCR|AC)-[0-9A-Za-z]+\b/.exec(firstLine(text))?.[0]

const roleField = (who: unknown): Pick<LogEntry, 'role'> => (isRole(who) ? { role: who } : {})

/** Why a run did not finish, in words: the engine's word stays in brackets. */
export const reasonWords = (reason: unknown): string => {
  const word = typeof reason === 'string' && reason !== '' ? reason : '沒有說原因'
  const said: Record<string, string> = { aborted: '被中斷了', error: '出錯了', refusal: '模型拒絕回答，通常是安全機制擋下了這一輪' }
  return said[word] === undefined ? word : `${said[word]}（${word}）`
}

const itemField = (id: unknown): Pick<LogEntry, 'item'> => (typeof id === 'string' && id !== '' && id !== 'crew' ? { item: id } : {})

type Line = Record<string, unknown>
type Words = Omit<LogEntry, 'key' | 'at'>

/** One line of the log in words; none for what the person does not need to read. */
const wordsOf = (e: Line): Words | undefined => {
  const text = stringOf(e.text)
  switch (e.kind) {
    case 'post': {
      // People's own words are the Threads tab's.
      if (e.from !== 'crew') return undefined
      const word = /^請 review /.test(text) ? '請 review' : /\n使用者的決定：/.test(text) ? '轉你的決定' : '派工'
      return { word, who: `crew → ${nameIn(e.to, e.slot)}`, ...said(text), ...roleField(e.to), ...itemField(e.item) }
    }
    case 'dispatch':
      return { word: '派工', who: `crew → ${byOf(e)}`, ...said(text), ...roleField(e.role), ...itemField(e.item ?? itemIn(text)) }
    case 'start':
      return { word: '開始', who: byOf(e), text: `開了新的 context${typeof e.model === 'string' ? `，用 ${e.model}` : ''}`, ...roleField(e.role) }
    case 'wake':
      return { word: '開始', who: byOf(e), text: `接著原本的 context 做${typeof e.model === 'string' ? `，用 ${e.model}` : ''}`, ...roleField(e.role) }
    case 'rotate':
      return { word: '換 context', who: byOf(e), text: `${stringOf(e.reason) || '換了新的 context'}${typeof e.model === 'string' ? `，用 ${e.model}` : ''}`, ...roleField(e.role) }
    case 'tune':
      return { word: '換模型', who: nameOf(e.role), ...said(`${text}${typeof e.reason === 'string' && e.reason !== '' ? `\n原因：${e.reason}` : ''}`), ...roleField(e.role) }
    case 'report':
      return { word: '回報', who: byOf(e), ...said(text), ...roleField(e.role) }
    case 'failed':
      return { word: '失敗', who: byOf(e), ...said(`這一輪沒有完成：${reasonWords(e.reason)}`), ...roleField(e.role), failed: true }
    case 'codex': {
      const failed = stringOf(e.failed)
      const count = typeof e.commands === 'number' ? e.commands : 0
      return { word: 'Codex 跑完', who: byOf(e), text: failed === '' ? `跑了 ${count} 個指令` : `失敗：${failed}`, ...roleField(e.role), ...(failed === '' ? {} : { failed: true as const }) }
    }
    case 'tests': {
      const sha = stringOf(e.sha).slice(0, 7)
      return { word: '跑測試', who: 'crew', text: `${String(e.passed ?? 0)}/${String(e.total ?? 0)} 個測試案例通過${sha === '' ? '' : `（commit ${sha}）`}`, ...(e.exit === 0 ? {} : { failed: true as const }) }
    }
    case 'review': {
      const notes = stringOf(e.notes)
      const line = `${stringOf(e.task)} ${e.verdict === 'approve' ? '通過' : '要修改'}（commit ${stringOf(e.sha).slice(0, 7)}）`
      return { word: 'Review 結論', who: nameOf('techlead'), text: line, role: 'techlead', ...(notes === '' ? {} : { full: notes }), ...itemField(e.task) }
    }
    case 'board': {
      const ids = Array.isArray(e.ids) ? e.ids.filter((x): x is string => typeof x === 'string') : []
      const ops = Array.isArray(e.ops) ? e.ops.length : 0
      return { word: '寫看板', who: nameOf(e.role), text: `${ops} 筆${ids.length === 0 ? '' : `：${cut(ids.join('、'), 100)}`}`, ...roleField(e.role), ...itemField(ids[0]) }
    }
    case 'ask':
      return { word: '問你', who: nameOf(e.from), ...said(stringOf(e.question)), ...roleField(e.from), ...itemField(e.item) }
    case 'memory':
      return { word: '記下', who: nameOf(e.source), ...said(`${stringOf(e.id)}${e.builders === true ? '（標「給每個全端」）' : ''} ${text}`) }
    case 'pin':
      return { word: e.on === false ? '取消固定' : '固定附上', who: nameOf(e.by), text: `${stringOf(e.id)} ${e.on === false ? '不再固定附上給每個全端' : '固定附上給每個全端'}` }
    case 'setup': {
      const exit: PrepExit = typeof e.exit === 'number' || e.exit === 'timeout' ? e.exit : 'error'
      const ok = exit === 0
      const words = exitWords(exit)
      const secs = typeof e.ms === 'number' ? tookWords(e.ms) : ''
      const where = prepWhere(typeof e.task === 'string' ? e.task : undefined)
      // A run again in crew's worktree for a merge: one that fails stops the merge, and crew asks the person, not a builder.
      const merge = e.merge === true
      const what = e.trial === true ? `試跑 ${where} 的 worktree 準備指令` : merge ? `合回前在 ${where}重跑 worktree 準備指令` : `準備 ${where} 的 worktree`
      const after = ok || e.trial === true ? '' : merge ? '。合回先停住，等你回覆 crew 的問題' : '。全端照樣開工，已把輸出告訴它'
      return { word: merge ? '合回前準備' : '準備 worktree', who: 'crew', ...said(`${what}：${words}${secs === '' ? '' : `，${secs}`}${after}\n輸出在 ${stringOf(e.log)}`), ...itemField(e.task), ...(ok ? {} : { failed: true as const }) }
    }
    case 'merge': {
      const task = stringOf(e.task)
      const failed = stringOf(e.failed)
      const refused = stringOf(e.refused)
      // crew's own merge: one stopped (by the prep, or crew's own trouble), one sent back to the builder, one that went in.
      if (failed !== '') return { word: '沒有合回', who: 'crew', ...said(`${task}：${failed}${e.prep === true ? '。等你回覆 crew 的問題' : ''}`), ...itemField(task), failed: true }
      if (refused !== '') return { word: '沒有合回', who: 'crew', ...said(`${task}：${refused}，退回給全端修`), ...itemField(task), failed: true }
      if (typeof e.commit === 'string') return { word: '合回', who: 'crew', text: `${task} 併進 ${stringOf(e.into)}（commit ${e.commit.slice(0, 7)}）`, ...itemField(task) }
      return undefined
    }
    case 'prd':
      return { word: '開始 PRD', who: nameOf(e.by), text: stringOf(e.path) }
    case 'prd_changed': {
      const count = (v: unknown) => (Array.isArray(v) ? v.length : 0)
      return { word: 'PRD 改了', who: 'crew', text: `多了 ${count(e.added)} 條、少了 ${count(e.removed)} 條` }
    }
    case 'resume':
      return { word: '接續', who: 'crew', text: `${stringOf(e.path)} 從 ${stringOf(e.stage)} 接續` }
    case 'usage':
      return { word: '用量', who: 'crew', ...said(text) }
    case 'compact':
      return { word: '壓縮 context', who: byOf(e), text: stringOf(e.trigger), ...roleField(e.role) }
    case 'wake_brain': {
      const held = Array.isArray(e.held) ? e.held.filter((x): x is string => typeof x === 'string') : []
      return { word: '叫醒大腦', who: 'crew', text: `Claude Code 沒有動作，${held.length} 個角色排著要開始：送一句話讓大腦回一個短回合` }
    }
    case 'check_start':
      if (e.kept === true) return { word: 'QA 開 app', who: 'crew', text: `用留給你驗收、還開著的 app（crew 分支 ${stringOf(e.sha)}）給 QA 實際操作 ${stringOf(e.feature)}（第 ${String(e.round ?? 1)} 輪）：${stringOf(e.url)}` }
      return { word: 'QA 開 app', who: 'crew', text: `在 QA 的工作目錄（crew 分支 ${stringOf(e.sha)}）開 app 給 QA 實際操作 ${stringOf(e.feature)}（第 ${String(e.round ?? 1)} 輪）：${stringOf(e.url)}` }
    case 'accept_app':
      if (e.open === true) return { word: '驗收用的 app', who: '你', text: `你按了［開 app］（${stringOf(e.feature)}）` }
      if (e.up === true) return { word: '驗收用的 app', who: 'crew', text: `開好了（crew 分支 ${stringOf(e.sha)}${e.from === 'check' ? '，沿用 QA 檢查時開著的 app' : ''}）` }
      // Closed while QA's check runs on it: it stops as the check ends, and a line says when.
      if (typeof e.after === 'string' && e.after !== '') return { word: '驗收用的 app', who: e.closed === 'person' ? '你' : 'crew', text: `${e.closed === 'person' ? '你按了［關掉 app］' : '它服務的功能你都決定了'}：QA 正在用它檢查 ${e.after}，檢查完 crew 就關掉` }
      if (e.closed === 'after_check') return { word: '驗收用的 app', who: 'crew', text: `QA 檢查完 ${stringOf(e.feature)}，crew 把它關掉了` }
      // In the background (its start command ended at the start), its URL answered no more: crew ran the stop command.
      if (e.closed === 'gone') return { word: '驗收用的 app', who: 'crew', text: '它在背景跑，網址沒有回應了：crew 用關掉 app 的指令收掉它' }
      return { word: '驗收用的 app', who: e.closed === 'person' ? '你' : 'crew', text: e.closed === 'person' ? '你按了［關掉 app］，crew 關掉了' : e.closed === 'decided' ? '它服務的功能你都決定了，crew 關掉了' : e.closed === 'reload' ? 'crew 重新載入，關掉上一次開著的 app' : '關掉了' }
    case 'check_qa':
      return { word: 'QA 實際操作', who: 'QA', text: `用瀏覽器實際操作 ${stringOf(e.feature)}（第 ${String(e.round ?? 1)} 輪）` }
    case 'check_end':
      return {
        word: 'QA 操作結果',
        who: 'QA',
        text: `${stringOf(e.feature)}：${e.ok === true ? '通過' : e.skipped !== undefined ? `沒有實際操作（${stringOf(e.skipped)}）` : e.error !== undefined ? `沒辦法操作（${stringOf(e.error)}）` : e.failed !== undefined ? `${String(e.failed)} 個地方沒過` : e.blocked !== undefined ? `沒有地方沒過，${String(e.blocked)} 個 test case 沒辦法操作` : '中斷，會再試'}`,
      }
    case 'dialog':
      return { word: '擋下選擇框', who: 'crew', text: 'crew 正在做事，大腦要開的選擇框沒有開，改請它用待你決定頁或在對話裡問' }
    case 'draft_confirmed':
      return { word: 'PRD 草稿確認', who: '你', text: stringOf(e.path) }
    case 'draft_change':
      return { word: 'PRD 草稿要改', who: '你', text: stringOf(e.path) }
    default:
      return undefined
  }
}

/** A role's work moved it to another model, seen from the model each start and message went out on: each builder its own. */
const modelMove = (e: Line, models: Map<string, string>): Words | undefined => {
  if (typeof e.model !== 'string') return undefined
  const who = `${String(e.role)}#${typeof e.slot === 'number' ? e.slot : 1}`
  const was = models.get(who)
  models.set(who, e.model)
  return was !== undefined && was !== e.model ? { word: '換模型', who: byOf(e), text: `${was} → ${e.model}`, ...roleField(e.role) } : undefined
}

/** A piece of work that started a role: it is on no thread, so an item's page finds it here. */
export type Handed = { t: number; to: unknown; slot?: number; text: string }

export const handedOutOf = (lines: readonly string[]): Handed[] =>
  lines.flatMap(line => {
    try {
      const e = JSON.parse(line) as Line
      return e.kind === 'dispatch' && typeof e.t === 'number' && typeof e.text === 'string' ? [{ t: e.t, to: e.role, ...(typeof e.slot === 'number' ? { slot: e.slot } : {}), text: e.text }] : []
    } catch {
      return []
    }
  })

/** The log's lines, oldest first as the files hold them, as the tab lists them: the newest first. */
export const logOf = (lines: readonly string[], now: number): LogEntry[] => {
  const count = new Map<number, number>()
  const models = new Map<string, string>()
  const entries: LogEntry[] = []
  for (const line of lines) {
    let e: unknown
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof e !== 'object' || e === null || typeof (e as Line).t !== 'number') continue
    // A start on another model is both: the start, and the move above it.
    const t = (e as { t: number }).t
    for (const words of [wordsOf(e as Line), modelMove(e as Line, models)]) {
      if (words === undefined) continue
      const n = (count.get(t) ?? 0) + 1
      count.set(t, n)
      entries.push({ key: `${t}-${n}`, at: stampOf(t, now), ...words })
    }
  }
  return entries.reverse()
}

/** What the engine gives for an agent's conversation, as much of it as a run needs. */
export type RunMessage = {
  role: 'user' | 'assistant'
  text: string
  toolUses: readonly { tool: string; input: Record<string, unknown>; text?: string }[]
}

const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
/** Tools whose output is the repo's and not the run's: where they looked is enough. */
const LOOKING_TOOLS = new Set(['Read', 'Glob', 'Grep'])
const TOOL_INPUT_SHOWN = 200

const stepOfTool = (t: RunMessage['toolUses'][number]): RunStep => {
  const name = t.tool.replace(/^mcp__crew__/, '')
  if (t.tool === 'Bash') return { kind: 'command', text: String(t.input.command ?? ''), ...(t.text === undefined ? {} : { output: t.text }) }
  if (FILE_TOOLS.has(t.tool)) return { kind: 'file', text: `${t.tool} ${String(t.input.file_path ?? t.input.notebook_path ?? '')}` }
  if (LOOKING_TOOLS.has(t.tool)) return { kind: 'tool', text: `${t.tool} ${String(t.input.file_path ?? t.input.pattern ?? '')}` }
  return { kind: 'tool', text: `${name} ${cut(JSON.stringify(t.input), TOOL_INPUT_SHOWN)}`, ...(t.text === undefined ? {} : { output: t.text }) }
}

/**
 * A Claude role's run from its conversation: what it was first told, then what
 * it said, each tool it called, and anything it was told along the way. A user
 * message with no words only carries tool results.
 */
export const runOfMessages = (messages: readonly RunMessage[]): { prompt: string; steps: RunStep[] } => {
  const steps: RunStep[] = []
  let prompt = ''
  for (const m of messages) {
    if (m.role === 'user') {
      if (m.text === '') continue
      if (prompt === '') prompt = m.text
      else steps.push({ kind: 'told', text: m.text })
      continue
    }
    if (m.text !== '') steps.push({ kind: 'message', text: m.text })
    // Its report goes through this one: said under 回報.
    steps.push(...m.toolUses.filter(t => t.tool !== 'SubagentHandback').map(stepOfTool))
  }
  return { prompt, steps }
}

/** Whether a text names an id as a whole: TASK-1 is not named by TASK-12, nor TASK-001 by TASK-0011. */
export const names = (text: string, id: string): boolean =>
  new RegExp(`(?<![0-9A-Za-z-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![0-9A-Za-z])`).test(text)

/** The item a role works on, from what it is doing: the first number in it. */
export const workItem = (text: string | undefined): string | undefined => /\b[A-Z]{1,6}-[0-9A-Za-z]+\b/.exec(text ?? '')?.[0]
