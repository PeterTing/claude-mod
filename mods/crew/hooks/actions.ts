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
 * What the full-stack on Codex is told of git: its sandbox writes the worktree
 * but not the worktree's git data, which is in the main repo's .git, and crew
 * never lets it write there (whoever writes .git/hooks, .git/config or a
 * worktree's gitdir runs anything in the next git outside the sandbox). It
 * changes files only; crew commits for it as its run ends, once it says its
 * work is done (a commit message), and runs the merge or stash apply its work
 * asks for before the run starts. No git repo of its own in the worktree:
 * crew's git would run that repo's config.
 */
export const CODEX_GIT = [
  '## git 由 crew 替你做',
  '你的工作目錄是 git worktree，它的 git 資料在主 repo 的 .git 裡，不在你的 sandbox 可寫範圍。所以 git add、commit、merge、rebase、stash、reset、checkout、switch、cherry-pick、revert 這類會寫進 git 的指令一定會失敗（index.lock: Operation not permitted）。不要跑，也不要想辦法繞過（不要改 .git 檔、不要另外 git init、不要改 GIT_DIR）。git status、diff、log、show 這類只讀的指令可以用。',
  '你只改檔案，git 的部分由 crew 在這一輪的前後替你做：',
  '- 做完、確認測試通過，上面的規則或工作內容要你 commit 時：把 commit 訊息寫在最後回覆的 commit 欄位，以任務編號開頭（例如「TASK-003: 加上標題驗證」；改到其他任務就把那些編號也寫上，例如「TASK-003, TASK-005: …」）。這一輪結束後，crew 照 .gitignore 把工作目錄裡的修改用這個訊息 commit（被 .gitignore 忽略的檔案不會收進去）。',
  '- commit 欄位空著，或沒有以任務編號開頭：crew 當成你還沒做完，不 commit，修改留在工作目錄，下一輪你接著做。所以還沒做完、卡住、或交了 ask_person 在等回答時，commit 欄位留空，在 report 寫清楚做到哪裡、卡在哪裡。',
  '- 工作內容要你跑 git merge 或 git stash apply 時：crew 在這一輪開始前已經替你跑了，結果寫在工作內容最前面（「crew 在這一輪開始前替你…」，或 crew 沒有替你跑的原因）。有衝突的檔案，把衝突標記改掉、確認測試通過，再照上面寫 commit 訊息；合併進行中時 commit 欄位空著，crew 也會用預設訊息完成合併的 commit。衝突標記沒有改完，crew 不會 commit；沒有衝突標記可改的衝突（二進位檔，或一邊刪除、一邊修改或改名），以及整個檔案直接採用其中一邊版本的衝突，決定留哪個版本後，在 commit 訊息裡寫出這些檔案的完整路徑（例如 src/a.ts，不是只寫 a.ts），crew 才當成你處理過了。工作內容最前面沒有這段，就是 crew 沒辦法替你跑：不要自己跑，在 report 寫出來。',
  '- 不要在工作目錄裡放另一個 git repo（git clone、git init）：crew 跑 git 時會執行它自己的設定，所以有的話 crew 不 commit，會請你刪掉或加進 .gitignore。需要的套件用套件管理工具安裝。',
  '- 不該進 git 的檔案（建置或測試產生的），加進 .gitignore；不要的修改，把檔案改回原樣或刪掉新檔案。',
].join('\n')

/**
 * The role card on Codex: the Claude card, then how the same work is done
 * without crew's tools, and, for the full-stack, without writing git. It is the
 * developer instructions of the run, which the person's AGENTS.md says win over it.
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
    ...(role === 'fullstack' ? [CODEX_GIT] : []),
    `report 寫給 crew 的回報，跟在 Claude 上最後的回覆一樣：做了什麼、還有什麼沒做完。${role === 'fullstack' ? 'commit 寫 commit 訊息（見上面）：做完才寫，沒做完就留空。' : ''}`,
  ].join('\n\n')
}
