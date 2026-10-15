/** The roles crew runs in phase 2, the tools they get, and their role cards. */

export const TOOLS = {
  read: 'mcp__crew__board_read',
  write: 'mcp__crew__board_write',
  post: 'mcp__crew__thread_post',
  thread: 'mcp__crew__thread_read',
  ask: 'mcp__crew__ask_person',
} as const

export type CrewRole = 'pm' | 'qa'

export const CREW_ROLES: readonly CrewRole[] = ['pm', 'qa']

const SHARED = [
  '你是 crew 產品團隊的一員，跟其他角色透過看板和討論串合作，不直接對話。',
  '- 看板是 repo 裡的 prd-tracker.json。只用 board_read 讀、board_write 寫，不要直接編輯檔案。',
  '- 每個項目都有編號（PRD-、AC-、TC-）。提到項目一律寫編號。',
  '- 給其他角色的話用 thread_post 寫在該項目的討論串，短而具體。',
  '- 需要產品決定、PRD 沒寫清楚的地方，用 ask_person 問使用者，不要自己猜。',
  '- 看板內容和討論用 PRD 使用的語言寫。',
  '- 做完就結束這一輪，最後用一句話回報做了什麼。不要寫長篇總結。',
].join('\n')

const PM_CARD = [
  '你是 PM。',
  '職責：把 PRD 拆成功能（add_feature）和驗收條件（add_criterion）；QA 寫完 test case 後，決定沒有 test case 的驗收條件要移出範圍（drop_criterion，附理由）還是要做（用 thread_post 告訴 QA 怎麼測）。',
  '原則：一個功能對應使用者能感受到的一件事；一條驗收條件只講一件可以驗證的事，寫成「使用者可以…」「系統會…」；範圍外的事明確移出並寫理由。',
  SHARED,
].join('\n\n')

const QA_CARD = [
  '你是 QA。',
  '職責：為每一條驗收條件寫 test case（add_test_case，criteria 填它覆蓋的驗收條件編號）。',
  '原則：每個 test case 的步驟具體、預期結果可以判斷對錯；涵蓋正常、錯誤與邊界情況；一條驗收條件可以有多個 test case。驗收條件寫得無法測時，用 thread_post 問 PM，不要硬寫。',
  SHARED,
].join('\n\n')

/** Agent definitions for $.agent.register. The model and effort are set per task by the router. */
export const AGENT_SPECS: Record<CrewRole, { name: string; description: string; prompt: string; tools: string[]; model: string; effort: string; omitClaudeMd: true }> = {
  pm: {
    name: 'pm',
    description: 'crew 的 PM：把 PRD 拆成功能與驗收條件，確認 test case 缺口。只由 crew 啟動。',
    prompt: PM_CARD,
    tools: ['Read', TOOLS.read, TOOLS.write, TOOLS.post, TOOLS.thread, TOOLS.ask],
    model: 'claude-sonnet-5-5',
    effort: 'high',
    omitClaudeMd: true,
  },
  qa: {
    name: 'qa',
    description: 'crew 的 QA：為每條驗收條件寫 test case。只由 crew 啟動。',
    prompt: QA_CARD,
    tools: ['Read', TOOLS.read, TOOLS.write, TOOLS.post, TOOLS.thread],
    model: 'claude-sonnet-5-5',
    effort: 'medium',
    omitClaudeMd: true,
  },
}

const OPS_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      op: { enum: ['add_feature', 'add_criterion', 'drop_criterion', 'drop_feature', 'add_test_case'] },
      title: { type: 'string' },
      summary: { type: 'string' },
      priority: { enum: ['P0', 'P1', 'P2'] },
      feature: { type: 'string', description: '功能編號（add_criterion）' },
      text: { type: 'string', description: '驗收條件內容（add_criterion）' },
      id: { type: 'string', description: '要移出的編號（drop_criterion、drop_feature）' },
      reason: { type: 'string' },
      criteria: { type: 'array', items: { type: 'string' }, description: '覆蓋的驗收條件編號（add_test_case）' },
      steps: { type: 'array', items: { type: 'string' } },
      expected: { type: 'string' },
      types: { type: 'array', items: { type: 'string' } },
      role: { type: 'string' },
      fixture: { type: 'string' },
    },
    required: ['op'],
  },
}

/** The tools crew registers, described briefly: their schemas sit in every request. */
export const TOOL_SPECS = [
  {
    name: 'board_read',
    description: '讀 crew 看板：功能、驗收條件，以及每條驗收條件的 test case。可只讀一個功能。',
    inputSchema: { type: 'object', properties: { feature: { type: 'string', description: '功能編號，省略則讀全部' } } },
  },
  {
    name: 'board_write',
    description:
      '寫 crew 看板，一次送出多筆操作，全部成功或全部不生效。PM：add_feature(title, summary)、add_criterion(feature, text)、drop_criterion(id, reason)、drop_feature(id, reason)。QA：add_test_case(criteria, title, steps, expected)。',
    inputSchema: { type: 'object', properties: { ops: OPS_SCHEMA }, required: ['ops'] },
  },
  {
    name: 'thread_post',
    description: '在某個項目的討論串留言給另一個角色。對方下次被叫醒時會看到。',
    inputSchema: {
      type: 'object',
      properties: { item: { type: 'string', description: '項目編號，例如 AC-003' }, to: { enum: ['pm', 'qa'] }, text: { type: 'string' } },
      required: ['item', 'to', 'text'],
    },
  },
  {
    name: 'thread_read',
    description: '讀某個項目的討論串。',
    inputSchema: { type: 'object', properties: { item: { type: 'string' } }, required: ['item'] },
  },
  {
    name: 'ask_person',
    description: '把需要使用者決定的問題交給使用者，答案之後會轉給你。',
    inputSchema: {
      type: 'object',
      properties: { question: { type: 'string' }, item: { type: 'string', description: '相關項目編號' } },
      required: ['question'],
    },
  },
] as const
