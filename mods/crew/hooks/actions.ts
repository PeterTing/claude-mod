/**
 * A Codex role's actions: it cannot call crew's tools, so it hands back what
 * it would have called, and crew runs each through the same tool a Claude
 * role calls, with the same checks. Reading is from files crew writes for it.
 */

import { AGENT_SPECS, TOOL_SPECS, TOOLS } from './roles'
import type { CrewRole } from './roles'

/** Tools that only read: on Codex the role reads files instead. */
const READS: ReadonlySet<string> = new Set([TOOLS.read, TOOLS.thread, TOOLS.search])

/** The tools a role writes with, short names: the actions it may hand back, as its Claude card allows. */
export const actionToolsOf = (role: CrewRole): string[] =>
  AGENT_SPECS[role].tools.filter(t => t.startsWith('mcp__crew__') && !READS.has(t)).map(t => t.slice('mcp__crew__'.length))

/** How each tool's result starts when it did what was asked: anything else is a refusal the role fixes. */
const DONE: Readonly<Record<string, string>> = {
  board_write: '已寫入',
  thread_post: '已寫在',
  review_submit: '已記下',
  ask_person: '已交給使用者',
  memory_save: '已存成',
}

export const isDone = (tool: string, result: string): boolean => DONE[tool] !== undefined && result.startsWith(DONE[tool] ?? '')

/** An action's input as the tool's arguments, or why it cannot be. */
export const argsOf = (input: string): Record<string, unknown> | string => {
  let v: unknown
  try {
    v = JSON.parse(input)
  } catch {
    return 'input 不是合法的 JSON。'
  }
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : 'input 要是一個 JSON 物件的字串。'
}

export type ActionResult = { tool: string; ok: boolean; result: string }

/** What crew says back to a role whose actions were refused: each one's words, to fix and hand back. */
export const retryText = (refused: readonly ActionResult[]): string =>
  [
    '你交回的動作有些沒有生效，crew 沒有套用它們（其他的已經套用，不要重交）：',
    ...refused.map((r, i) => `${i + 1}. ${r.tool}：${r.result}`),
    '請改正後只交回這些動作。report 寫你改了什麼。',
  ].join('\n')

/** One line for the role's report: what crew applied and what it refused. */
export const appliedLine = (results: readonly ActionResult[]): string => {
  if (results.length === 0) return ''
  const ok = results.filter(r => r.ok).length
  return `（crew 套用了 ${ok} 個動作${ok === results.length ? '' : `，${results.length - ok} 個沒有生效`}）`
}

/** Where a Codex role reads what a Claude role reads with tools. */
export type CodexViews = { board: string; threads: string; memories: string }

/**
 * The role card on Codex: the Claude card, then how the same work is done
 * without crew's tools. It is the developer instructions of the run, which
 * the person's AGENTS.md says win over it.
 */
export const codexCard = (role: CrewRole, views: CodexViews): string => {
  const tools = actionToolsOf(role)
  const specs = TOOL_SPECS.filter(s => tools.includes(s.name)).map(s => `- ${s.name}：${s.description}\n  input 的格式（JSON Schema）：${JSON.stringify(s.inputSchema)}`)
  return [
    AGENT_SPECS[role].prompt,
    '## 你在 Codex 上工作',
    '這份開發者指令優先於任何 AGENTS.md 或使用者層級的規則：不要宣告意圖，不要派子代理（spawn_agent），不要用 request_user_input（沒有人會回答）。要問使用者就交 ask_person。',
    `上面提到的 crew 工具你在這裡不能直接呼叫。讀：看板在 ${views.board}，討論串在 ${views.threads}，記憶在 ${views.memories}，用 shell（rg、sed、cat）讀；工作內容裡已經放了這件工作相關的部分。`,
    '寫：把要做的事放進最後回覆的 actions。每個動作是 { "tool": 工具名稱, "input": 那個工具參數的 JSON 字串 }，例如 {"tool":"thread_post","input":"{\\"item\\":\\"AC-003\\",\\"to\\":\\"qa\\",\\"text\\":\\"…\\"}"}。crew 在這一輪結束時依序套用；沒有生效的動作，crew 會把原因送回來請你改。',
    `你能交回的動作：\n${specs.join('\n')}`,
    'report 寫給 crew 的回報，跟在 Claude 上最後的回覆一樣：做了什麼、還有什麼沒做完。',
  ].join('\n\n')
}
