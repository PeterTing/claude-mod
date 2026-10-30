import type { Audit, Engine, Engines, Pick, Progress, RequirementRow, RoleId, RoleModels, Route, Snapshot, StageCell } from './model'

/** Sample data for the design preview. None of it is real. */

const S: Route = { tier: 'S', model: 'Sonnet 5.5', effort: 'medium' }
const M: Route = { tier: 'M', model: 'Sonnet 5.5', effort: 'high' }
const L: Route = { tier: 'L', model: 'Opus 5.5', effort: 'high' }
const XL: Route = { tier: 'XL', model: 'Opus 5.5', effort: 'xhigh' }
/** The full-stack on Codex: at its floor of 6.1 Sol・xhigh however hard the work, until the hardest fails again. */
const CODEX_FS_M: Route = { tier: 'M', model: 'gpt-6.1-sol', effort: 'xhigh', engine: 'codex' }
const CODEX_L: Route = { tier: 'L', model: 'gpt-6.1-sol', effort: 'xhigh', engine: 'codex' }
const CODEX_XL: Route = { tier: 'XL', model: 'gpt-6.1-sol', effort: 'xhigh', engine: 'codex' }
/** QA and PM on Codex at their floors: Terra, which writes test cases and specs. */
const CODEX_S: Route = { tier: 'S', model: 'gpt-6.1-terra', effort: 'medium', engine: 'codex' }
const CODEX_M: Route = { tier: 'M', model: 'gpt-6.1-terra', effort: 'high', engine: 'codex' }

/** Each role's floors as crew starts them, on Claude and on Codex. */
const FLOORS: Record<RoleId, Record<Engine, Pick>> = {
  pm: { claude: { model: 'sonnet', effort: 'high' }, codex: { model: 'gpt-6.1-terra', effort: 'high' } },
  uiux: { claude: { model: 'sonnet', effort: 'medium' }, codex: { model: 'gpt-6.1-terra', effort: 'medium' } },
  qa: { claude: { model: 'sonnet', effort: 'medium' }, codex: { model: 'gpt-6.1-terra', effort: 'medium' } },
  techlead: { claude: { model: 'opus', effort: 'high' }, codex: { model: 'gpt-6.1-sol', effort: 'xhigh' } },
  fullstack: { claude: { model: 'sonnet', effort: 'high' }, codex: { model: 'gpt-6.1-sol', effort: 'xhigh' } },
}

/** A role on crew's default: the brain on `now`, for `why`. */
const auto = (role: RoleId, now: Engine, why: string, limit: RoleModels['limit'] = 'tier'): RoleModels => ({ mode: 'auto', floors: FLOORS[role], fixed: { engine: now, ...FLOORS[role][now] }, now, why, limit })

/** A role the person fixed on one model. */
const fixedOn = (role: RoleId, engine: Engine, pick: Pick): RoleModels => ({ mode: 'fixed', floors: FLOORS[role], fixed: { engine, ...pick }, now: engine, limit: 'tier' })

/** The brain has the full-stack build on Codex, and the tech lead review it on Claude. */
const ENGINES: Engines = {
  roles: {
    pm: auto('pm', 'claude', 'Claude 額度還夠'),
    uiux: { ...auto('uiux', 'claude', 'Claude 額度還夠'), tuned: { limit: 80_000, by: 'DEC-15' } },
    fullstack: auto('fullstack', 'codex', 'Claude 額度留給 Tech lead'),
    qa: auto('qa', 'claude', 'Claude 額度還夠'),
    techlead: auto('techlead', 'claude', '換個引擎 review 全端', 200_000),
  },
  codex: { state: 'ready', login: 'chatgpt', version: '0.162.1', checked: '2 分鐘前' },
  models: ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6.1-terra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
  askBeforeSwitch: true,
}

/** Where the tokens went today, and what cost the most over the week. */
const AUDIT: Audit = {
  parts: [
    { part: '工具結果', tokens: 140_000 },
    { part: '任務與看板', tokens: 64_000 },
    { part: '輸出', tokens: 49_000 },
    { part: '記憶包', tokens: 31_000 },
    { part: '角色說明', tokens: 35_000 },
    { part: 'Codex 固定開銷', tokens: 93_000 },
  ],
  brain: [
    { part: 'MCP 工具說明', tokens: 46_000 },
    { part: '對話', tokens: 38_000 },
    { part: '系統提示', tokens: 12_000 },
    { part: 'CLAUDE.md', tokens: 9_000 },
  ],
  since: '近 7 天',
  sessions: 3,
  told: '記憶包用到的只有 23%（新的瓶頸）· 40 分鐘前',
  bottlenecks: [
    { title: '大腦每一輪都帶 MCP 工具說明 46K', tokens: 4_048_000, share: '46K × 88 輪，大腦 context 的 44%', fix: '關掉這個 repo 用不到的 MCP（Notion、Gmail…）；大腦不能替你改設定', state: 'person' },
    { title: 'Codex 每次固定帶你的 AGENTS.md 和技能說明', tokens: 1_271_000, share: '31K × 41 次，Codex 的 38%', fix: 'crew 給 Codex 精簡的設定', state: 'acting' },
    { title: '全端的工具結果：Read 大檔 23 次超過 8K', tokens: 310_000, share: '全端的 9%', fix: 'DEC-18 先用 Grep 找位置再讀，之後平均每次 2.1K', state: 'done' },
    { title: '記憶包用到的只有 23%', tokens: 80_000, share: '平均 2.1K × 38 次', fix: '只帶跟這件工作的編號有關的記憶', state: 'acting' },
    { title: 'UI/UX 快取命中率 52%：喚醒間隔 7 分鐘', tokens: 61_000, share: 'UI/UX 的 9%', fix: 'DEC-15 輪替門檻 100K → 80K，命中率回到 81%', state: 'done' },
  ],
}

const done: StageCell = { state: 'done' }
const todo: StageCell = { state: 'todo' }

const REQUIREMENTS: RequirementRow[] = [
  {
    id: 'R-5e01a7',
    text: '方案頁列出月繳方案與價格',
    features: ['F-01'],
    layers: { spec: done, design: done, cases: { state: 'done', note: '4/4' }, tasks: done, code: { state: 'done', note: '2/2' }, review: done, runs: { state: 'done', note: '4/4' } },
  },
  {
    id: 'R-9b3c12',
    text: '用信用卡結帳，失敗時說明原因',
    features: ['F-02'],
    layers: { spec: done, design: done, cases: { state: 'done', note: '6/6' }, tasks: done, code: { state: 'doing', note: '3/5' }, review: todo, runs: { state: 'doing', note: '2/6' } },
  },
  {
    id: 'R-07d4e9',
    text: '可以隨時取消，到期前仍可使用',
    features: ['F-03'],
    layers: { spec: done, design: done, cases: { state: 'done', note: '5/5' }, tasks: done, code: { state: 'doing', note: '1/3' }, review: { state: 'stale' }, runs: { state: 'doing', note: '3/5' } },
  },
  {
    id: 'R-c84a10',
    text: '每月寄出電子發票',
    features: ['F-05'],
    layers: { spec: done, design: { state: 'doing' }, cases: { state: 'doing', note: '1/3' }, tasks: todo, code: todo, review: todo, runs: { state: 'todo', note: '0/3' } },
  },
  {
    id: 'R-2f6b55',
    text: '提供年繳方案，打 85 折',
    features: [],
    dropped: '移出 v1（DEC-14），v1.1 再做',
    layers: { spec: todo, design: todo, cases: todo, tasks: todo, code: todo, review: todo, runs: todo },
  },
]

const NORMAL: Snapshot = {
  prd: { id: 'PRD-001', title: '會員訂閱 v1', progress: 58 },
  progress: {
    done: 31,
    total: 50,
    weighted: { done: 88, total: 150 },
    rated: [{ id: 'TASK-12', from: 'L', to: 'M', why: 'Tech lead 重評，範圍大但都照現成的 API 寫法', before: 57, after: 58 }],
    stages: [
      { label: '規格', done: 12, total: 12, state: 'done' },
      { label: '設計', done: 9, total: 9, state: 'done' },
      { label: '測試案例', done: 10, total: 12, state: 'active' },
      { label: '任務', done: 4, total: 5, state: 'active' },
      { label: '實作', done: 5, total: 14, state: 'active' },
      { label: 'Review', done: 3, total: 14, state: 'active' },
      { label: '測試結果', done: 1, total: 8, state: 'active' },
    ],
    features: [
      { id: 'F-01', title: '方案選擇', percent: 100, layers: { design: 'done', frontend: 'done', backend: 'done', test: 'done' } },
      { id: 'F-02', title: '結帳與付款', percent: 55, layers: { design: 'done', frontend: 'doing', backend: 'doing', test: 'todo' } },
      { id: 'F-03', title: '取消訂閱', percent: 40, layers: { design: 'done', frontend: 'todo', backend: 'doing', test: 'doing' } },
      { id: 'F-05', title: '帳單與發票', percent: 10, layers: { design: 'doing', frontend: 'todo', backend: 'todo', test: 'todo' } },
      { id: 'F-04', title: '年繳方案', percent: 0, layers: { design: 'todo', frontend: 'todo', backend: 'todo', test: 'todo' }, dropped: '移出 v1（DEC-14），v1.1 再做' },
    ],
    daily: [
      { day: '10/11', done: 3 },
      { day: '10/12', done: 5 },
      { day: '10/13', done: 4 },
      { day: '10/14', done: 5 },
      { day: '10/15', done: 7 },
    ],
    recent: [
      { id: 'TC-28', title: '月繳扣款成功', role: 'qa', age: '8 分鐘前' },
      { id: 'SCR-01', title: '方案選擇頁', role: 'uiux', age: '20 分鐘前' },
      { id: 'AC-01', title: '可以選月繳方案', role: 'pm', age: '1 小時前' },
    ],
  },
  today: 224_000,
  codexToday: 188_000,
  roles: [
    { id: 'pm', state: 'idle', doing: '—', context: 18_000, limit: 60_000, today: 42_000 },
    { id: 'uiux', state: 'working', doing: 'SCR-04 結帳頁三種狀態', route: M, context: 41_000, limit: 80_000, today: 96_000 },
    { id: 'fullstack', state: 'working', doing: 'TASK-12 訂閱 API', route: CODEX_FS_M, context: 77_000, limit: 100_000, today: 188_000 },
    { id: 'qa', state: 'waiting', doing: '等 PM 確認 AC-07、AC-09', route: S, context: 23_000, limit: 60_000, today: 51_000 },
    { id: 'techlead', state: 'rotating', doing: '閒置後換新對話，帶記憶重開', route: XL, context: 58_000, limit: 200_000, today: 35_000 },
  ],
  gates: [
    { id: 'G0', state: 'pass', name: 'PRD 每條需求都有對應的功能', fill: 'PM 補', confirm: 'crew 對照 PRD 檔案', covered: 14, total: 14, gaps: [], note: 'R-2f6b55 年繳方案用 drop_requirement 移出 v1', checked: '即時' },
    { id: 'G1', state: 'pass', name: '每個功能都有驗收條件', fill: 'PM 補', confirm: 'PM 自查', covered: 4, total: 4, gaps: [], note: 'F-04 年繳方案已移出 v1，不列入計算', checked: '2 分鐘前' },
    { id: 'G2', state: 'pass', name: '每個有介面的功能都有畫面和各種狀態', fill: 'UI/UX 補', confirm: '你核准', covered: 9, total: 9, gaps: [], checked: '2 分鐘前' },
    {
      id: 'G3',
      state: 'active',
      detail: '3/4',
      name: '每個功能都拆好 task',
      fill: 'Tech lead 拆',
      confirm: 'Tech lead 自查',
      covered: 3,
      total: 4,
      gaps: [{ id: 'F-05', title: '帳單與發票', status: '設計稿還在畫（SCR-07），畫完才拆 task' }],
      checked: '2 分鐘前',
    },
    {
      id: 'G4',
      state: 'gap',
      detail: '2 個缺口',
      name: '每條驗收條件都有 test case',
      fill: 'QA 補',
      confirm: 'PM 確認缺口',
      covered: 14,
      total: 16,
      gaps: [
        { id: 'AC-07', title: '取消訂閱後仍可使用到期末', status: '討論中，QA 補邊界情況後等 PM 確認', thread: 'AC-07' },
        { id: 'AC-09', title: '年繳享 2 個月折扣', status: 'PM 已移出 v1（DEC-14），下次檢查會從分母拿掉' },
      ],
      checked: '2 分鐘前',
    },
    {
      id: 'G5',
      state: 'active',
      detail: '3/5',
      name: '每個完成的 task 都通過 code review',
      fill: '全端修',
      confirm: 'Tech lead review',
      covered: 3,
      total: 5,
      gaps: [
        { id: 'TASK-08', title: '方案資料表與 migration', status: '等 Tech lead review' },
        { id: 'TASK-09', title: '方案選擇 API', status: 'review 退回 1 次（缺錯誤處理），全端修正中' },
      ],
      checked: '2 分鐘前',
    },
    {
      id: 'G6',
      state: 'pending',
      name: 'test case 全部執行通過、附證據',
      fill: '全端修',
      confirm: 'crew 跑你設定的測試指令',
      covered: 1,
      total: 14,
      gaps: [],
      note: '還有 13 個 test case 沒執行，對應的功能實作完才會開始',
      checked: '2 分鐘前',
    },
  ],
  decisions: [{ id: 'Q-03', question: '年繳方案要不要第一版就做？', from: 'pm', age: '12 分鐘前' }],
  items: [
    { id: 'SCR-04', title: '結帳頁三種狀態', owner: 'uiux', status: 'doing', route: M },
    { id: 'TASK-12', title: '訂閱 API', owner: 'fullstack', status: 'doing', route: CODEX_FS_M, hard: '範圍大（8 個檔），但都照現成的 API 寫法' },
    { id: 'TC-31', title: '到期當天取消', owner: 'qa', status: 'doing', route: S },
    { id: 'AC-07', title: '取消訂閱後仍可使用到期末', owner: 'pm', status: 'review', route: M, note: '缺 test case，等 PM 確認' },
    { id: 'ADR-02', title: '金流服務與 webhook 驗簽', owner: 'techlead', status: 'review', route: XL },
    { id: 'TASK-15', title: '金流 webhook 驗簽', owner: 'fullstack', status: 'todo', route: CODEX_L, hard: '範圍小（2 個檔），但驗簽和重送要照金流商的規格，錯了會重複扣款' },
    { id: 'SCR-01', title: '方案選擇頁', owner: 'uiux', status: 'done', route: M },
    { id: 'AC-01', title: '可以選月繳方案', owner: 'pm', status: 'done', route: S },
  ],
  threads: [
    {
      item: 'AC-07',
      title: '取消訂閱後仍可使用到期末',
      messages: [
        { from: 'QA → PM', text: 'AC-07、AC-09 還沒有 test case。AC-09 是不是已經移出 v1？' },
        { from: 'crew', text: '轉送給 PM，附上相關記憶 DEC-09、MEM-22', kind: 'route' },
        { from: 'PM → QA', text: 'AC-09 移出 v1（DEC-14）。AC-07 請補邊界情況：到期當天取消。' },
        { from: '記憶', text: 'DEC-14 已寫入 · 來源 PM · 引用 AC-09、PRD-001 · 取代 DEC-09', kind: 'memory' },
        { from: 'QA', text: '新增 TC-31、TC-32 → G4 覆蓋 100%' },
      ],
    },
    {
      item: 'SCR-04',
      title: '結帳頁三種狀態',
      messages: [
        { from: 'UI/UX → PM', text: '付款失敗的狀態要不要給重試按鈕？' },
        { from: 'PM → UI/UX', text: '要，最多重試 3 次，第 3 次失敗導去客服。' },
      ],
    },
    {
      item: 'TASK-15',
      title: '金流 webhook 驗簽',
      messages: [{ from: 'crew', text: '項目碰到金流，複雜度從 L 升到 XL。全端在 Codex 上已經是下限 6.1 Sol・xhigh；XL 再失敗會改用 6 Astra・xhigh', kind: 'route' }],
    },
  ],
  memories: [
    { id: 'DEC-14', type: 'DEC', text: '年繳方案移出 v1，v1.1 再做', source: 'PM', refs: ['AC-09', 'PRD-001'] },
    { id: 'MEM-22', type: 'MEM', text: '金流用 Stripe Billing，webhook 要驗簽', source: 'Tech lead', refs: ['ADR-02'] },
    { id: 'LES-05', type: 'LES', text: '測試帳號用 seed 檔產生，不手寫', source: 'QA', refs: ['TC-12'] },
    { id: 'PREF-02', type: 'PREF', text: '回覆一律用繁體中文', source: '你', refs: [] },
    { id: 'DEC-09', type: 'DEC', text: 'v1 包含年繳', source: 'PM', refs: ['AC-09'], supersededBy: 'DEC-14' },
  ],
  carrying: [
    { role: 'qa', ids: ['DEC-14', 'MEM-22'], tokens: 640 },
    { role: 'fullstack', ids: ['MEM-22', 'LES-05'], tokens: 580 },
  ],
  usage: [
    { role: 'pm', input: 6_000, output: 4_000, cacheRead: 27_000, cacheWrite: 5_000, wakes: 6, rotations: 0 },
    { role: 'uiux', input: 11_000, output: 13_000, cacheRead: 61_000, cacheWrite: 11_000, wakes: 9, rotations: 1 },
    { role: 'fullstack', engine: 'codex', input: 31_000, output: 22_000, cacheRead: 135_000, cacheWrite: 0, wakes: 3, rotations: 0 },
    { role: 'qa', input: 7_000, output: 6_000, cacheRead: 32_000, cacheWrite: 6_000, wakes: 7, rotations: 0 },
    { role: 'techlead', input: 5_000, output: 4_000, cacheRead: 22_000, cacheWrite: 4_000, wakes: 3, rotations: 0 },
  ],
  tiers: [
    { tier: 'S', tokens: 38_000 },
    { tier: 'M', tokens: 121_000 },
    { tier: 'L', tokens: 176_000 },
    { tier: 'XL', tokens: 77_000 },
  ],
  brainShare: 0.09,
  alerts: [],
  actions: [{ id: 'DEC-15', text: 'UI/UX 輪替，門檻 100K → 80K', before: '命中率 52% · context 96K', after: '命中率 81% · context 8K' }],
  tuning: 'ask',
  settings: { testCommand: 'python3 -m pytest -v', openOnLoad: true },
  engines: ENGINES,
  audit: AUDIT,
  web: {
    url: 'http://127.0.0.1:47321/',
    openOnStart: true,
    tailnet: { state: 'on', machine: 'macbook', url: 'https://macbook.tail0c3f.ts.net/', devices: [{ id: 'iphone', name: 'iPhone', paired: '昨天' }] },
  },
  takeover: { on: true, idle: false },
  start: { prds: [{ path: 'docs/PRD.md', title: '會員訂閱 v1' }, { path: 'docs/specs/checkout.md', title: '結帳流程' }] },
  resident: { checked: '2 分鐘前', next: '3 分鐘後', digest: { sent: '12:30', queued: 2, next: '13:00' } },
  requirements: REQUIREMENTS,
  alignment: { covered: 14, total: 14, gaps: 0, added: 0, removed: 0, prdChanged: '2 小時前', checked: '剛剛' },
}

/** PM, QA and the full-stack on Codex; UI/UX and the tech lead on Claude, where UI/UX takes most of the day. */
const ATTENTION: Snapshot = {
  ...NORMAL,
  today: 131_000,
  codexToday: 281_000,
  // TASK-15 failed twice: harder than the tech lead rated it, so what is left weighs more.
  progress: {
    ...(NORMAL.progress as Progress),
    rated: [
      { id: 'TASK-15', from: 'L', to: 'XL', why: '測試失敗 2 次', before: 60, after: 58 },
      ...((NORMAL.progress as Progress).rated ?? []),
    ],
  },
  roles: NORMAL.roles.map(r =>
    r.id === 'fullstack'
      ? { ...r, state: 'waiting', doing: 'TASK-15 測試失敗 2 次，升級等你決定（M-03）', route: CODEX_XL, context: 96_000, limit: 256_000 }
      : r.id === 'qa'
        ? { ...r, route: CODEX_S }
        : r,
  ),
  items: NORMAL.items.map(i =>
    i.id === 'TASK-15'
      ? { ...i, status: 'blocked', route: CODEX_XL, note: '測試失敗 2 次：要不要從 6.1 Sol・xhigh 升到 6 Astra・xhigh，在 M-03 等你；Tech lead 在看 ADR-02' }
      : i.id === 'TC-31'
        ? { ...i, route: CODEX_S }
        : i.id === 'AC-07'
          ? { ...i, route: CODEX_M }
          : i,
  ),
  usage: NORMAL.usage.map(u => (u.role === 'pm' || u.role === 'qa' ? { ...u, engine: 'codex', cacheRead: u.cacheRead + u.cacheWrite, cacheWrite: 0, wakes: 1 } : u)),
  // Five Codex runs today, each carrying the 31K Codex adds on its own.
  audit: {
    ...AUDIT,
    parts: [
      { part: 'Codex 固定開銷', tokens: 155_000 },
      { part: '工具結果', tokens: 110_000 },
      { part: '輸出', tokens: 49_000 },
      { part: '任務與看板', tokens: 44_000 },
      { part: '角色說明', tokens: 22_000 },
      { part: '記憶包', tokens: 17_000 },
      { part: '討論串與通知', tokens: 15_000 },
    ],
  },
  engines: {
    ...ENGINES,
    roles: {
      ...ENGINES.roles,
      pm: auto('pm', 'codex', 'Claude 今天吃緊'),
      qa: fixedOn('qa', 'codex', { model: 'gpt-6.1-terra', effort: 'medium' }),
    },
  },
  // The brain asks before it moves a role to another model; a role fixed on one that keeps failing is asked about too.
  modelAsks: [
    { id: 'M-01', kind: 'switch', role: 'uiux', text: '大腦想把 UI/UX 換到 Codex（6.1 Terra・medium 起）：UI/UX 今天用了 Claude 的 73%。', yes: '好', no: '不要', from: 'brain', age: '剛剛' },
    { id: 'M-02', kind: 'stuck', role: 'qa', text: 'QA 固定用 6.1 Terra・medium，TC-31 被 PM 退回 3 次。這件暫時升到 6.1 Sol・high？', yes: '這件升一格', no: '照舊', from: 'crew', age: '3 分鐘前' },
    { id: 'M-03', kind: 'climb', role: 'fullstack', text: '全端的 TASK-15 測試失敗 2 次，要從 6.1 Sol・xhigh 升到 6 Astra・xhigh 嗎？', yes: '升級', no: '照舊', from: 'crew', age: '1 分鐘前' },
  ],
  alerts: [
    { text: 'UI/UX 今日佔 Claude 的 73%（超過 40%）', at: '12:41' },
    { text: '全端快取命中率 52%（低於 60%）：喚醒間隔太長，對話整份重寫快取', at: '12:41' },
    { text: 'PM 和 QA 在 AC-007 來回 7 次（超過 6 次）', at: '12:20' },
  ],
  // The person has the brain ask first: its proposal waits as a question.
  tuning: 'ask',
  actions: [
    ...NORMAL.actions,
    { id: 'Q-04', text: '全端輪替門檻 160K → 120K', before: '命中率 52% · context 96K', pending: 'Q-04' },
  ],
  decisions: [
    ...NORMAL.decisions,
    { id: 'Q-04', question: '大腦建議：全端輪替門檻 160K → 120K', from: 'brain', age: '剛剛', kind: 'proposal' },
    { id: 'Q-05', question: '設計稿 SCR-04 結帳頁三種狀態等你核准', from: 'uiux', age: '5 分鐘前', kind: 'design', design: 'SCR-04' },
  ],
  resident: {
    checked: '1 分鐘前',
    next: '4 分鐘後',
    found: 'crew 的分支在角色工作以外多了 1 個 commit（TASK-12）→ 已排給 Tech lead review',
    resumed: '13:02 從 building 接續（全端，TASK-15）',
    digest: { sent: '12:30', queued: 0, next: '13:00' },
  },
  gates: NORMAL.gates.map(g =>
    g.id === 'G0'
      ? {
          ...g,
          state: 'active',
          detail: '14/16',
          covered: 14,
          total: 16,
          note: 'PRD 2 分鐘前改了',
          gaps: [
            { id: 'R-3a90f2', title: 'PRD 需求沒有對應的功能：可以暫停訂閱，暫停期間不扣款', status: 'PM 同步中' },
            { id: 'PRD-005', title: '功能對應的 PRD 需求已經不在 PRD 裡：取消要客服確認', status: 'PM 同步中' },
          ],
        }
      : g,
  ),
  requirements: [
    ...REQUIREMENTS,
    {
      id: 'R-3a90f2',
      text: '可以暫停訂閱，暫停期間不扣款',
      features: [],
      layers: { spec: todo, design: todo, cases: { state: 'todo', note: '0/0' }, tasks: todo, code: todo, review: todo, runs: todo },
    },
  ],
  alignment: { covered: 14, total: 16, gaps: 2, added: 1, removed: 1, prdChanged: '2 分鐘前', checked: '剛剛' },
}

const EMPTY: Snapshot = {
  prd: null,
  progress: null,
  today: 0,
  roles: NORMAL.roles.map(r => ({ ...r, state: 'idle', doing: '—', route: undefined, context: 0, today: 0 })),
  gates: [],
  decisions: [],
  items: [],
  threads: [],
  memories: [],
  carrying: [],
  usage: [],
  tiers: [],
  brainShare: 0,
  alerts: [],
  actions: [],
  resident: { checked: '剛剛', next: '5 分鐘後' },
  start: {
    prds: [
      { path: 'docs/PRD.md', title: '會員訂閱 v1' },
      { path: 'docs/specs/checkout.md', title: '結帳流程' },
    ],
  },
  settings: { openOnLoad: true },
  engines: { ...ENGINES, roles: { pm: auto('pm', 'claude', '還沒有工作'), uiux: auto('uiux', 'claude', '還沒有工作'), fullstack: auto('fullstack', 'claude', '還沒有工作'), qa: auto('qa', 'claude', '還沒有工作'), techlead: auto('techlead', 'claude', '還沒有工作') } },
  audit: undefined,
  takeover: { on: false, idle: true },
}

/** The brain took this repo over and has heard nothing yet. */
const LEADING: Snapshot = { ...EMPTY, takeover: { on: true, idle: true } }

/** The brain wrote a PRD with the person and asked PM and UI/UX to review it. */
const DRAFTING: Snapshot = {
  ...EMPTY,
  today: 21_000,
  roles: EMPTY.roles.map(r =>
    r.id === 'uiux'
      ? { ...r, state: 'working', doing: '審草稿 docs/crew/billing-PRD.md（ASK-02）', route: S, context: 9_000, today: 9_000 }
      : r.id === 'pm'
        ? { ...r, context: 12_000, today: 12_000 }
        : r,
  ),
  takeover: {
    on: true,
    idle: true,
    draft: {
      path: 'docs/crew/billing-PRD.md',
      title: '會員訂閱 v1',
      requirements: 12,
      stage: 'reviewing',
      reviews: [
        { role: 'pm', done: true, found: '2 個缺口' },
        { role: 'uiux', done: false },
      ],
    },
  },
}

/** The brain filled the gaps the reviews found, with the person, and waits for their yes. */
const CONFIRM: Snapshot = {
  ...DRAFTING,
  today: 34_000,
  roles: EMPTY.roles.map(r => (r.id === 'pm' ? { ...r, context: 12_000, today: 12_000 } : r.id === 'uiux' ? { ...r, context: 22_000, today: 22_000 } : r)),
  takeover: {
    on: true,
    idle: true,
    draft: {
      path: 'docs/crew/billing-PRD.md',
      title: '會員訂閱 v1',
      requirements: 14,
      stage: 'confirm',
      reviews: [
        { role: 'pm', done: true, found: '2 個缺口' },
        { role: 'uiux', done: true, found: '1 個缺口' },
      ],
      note: '兩邊共 3 個缺口，已照你的回答補進草稿',
    },
  },
}

/** Claude Code started again on an unfinished PRD: crew offers to go on. */
const RESTART: Snapshot = {
  ...NORMAL,
  start: { prds: [], resumable: '上次的 PRD-001 會員訂閱 v1 停在「實作」（全端 TASK-12）。要接續嗎？' },
  resident: { checked: '剛剛', next: '5 分鐘後' },
}

/** Every role on crew's default that was on Codex moves to Claude, for `why`. */
const onClaude = (why: string): Engines['roles'] =>
  Object.fromEntries(Object.entries(ENGINES.roles).map(([id, r]) => [id, r.mode === 'auto' && r.now === 'codex' ? { ...r, now: 'claude', why } : r])) as Engines['roles']

/** The person fixed the full-stack on Codex, and Codex on this machine is not logged in. */
const CODEX: Snapshot = {
  ...NORMAL,
  roles: NORMAL.roles.map(r => (r.id === 'fullstack' ? { ...r, state: 'blocked', doing: 'TASK-12 沒有開始：Codex 還沒登入', context: 0, today: 0 } : r)),
  codexToday: 0,
  engines: {
    ...ENGINES,
    roles: { ...onClaude('Codex 還沒登入'), fullstack: fixedOn('fullstack', 'codex', { model: 'gpt-6.1-sol', effort: 'xhigh' }) },
    codex: { state: 'logged-out', version: '0.162.1', checked: '剛剛' },
  },
  modelAsks: [
    { id: 'M-01', kind: 'login', role: 'fullstack', text: 'Codex 還沒登入。全端固定用 Codex，TASK-12 停著。要改用 Claude（Sonnet 5.5・high）做嗎？', yes: '改用 Claude', no: '等我登入', from: 'crew', age: '剛剛' },
  ],
}

/**
 * Codex ran out of quota, and the person has the brain switch without asking:
 * the full-stack, on crew's default, goes on with Claude and the brain notes
 * it as a decision; QA, fixed on Codex, waits and is asked about.
 */
const QUOTA: Snapshot = {
  ...NORMAL,
  roles: NORMAL.roles.map(r =>
    r.id === 'qa' ? { ...r, state: 'blocked', doing: 'TC-31 停著：Codex 額度用完' } : r.id === 'fullstack' ? { ...r, route: M } : r,
  ),
  items: NORMAL.items.map(i => (i.id === 'TASK-12' ? { ...i, route: M } : i)),
  engines: {
    ...ENGINES,
    roles: { ...onClaude('Codex 額度用完（DEC-21）'), qa: fixedOn('qa', 'codex', { model: 'gpt-6.1-terra', effort: 'medium' }) },
    codex: { state: 'ready', login: 'chatgpt', version: '0.162.1', checked: '剛剛', limited: '約 15:40 重置' },
    askBeforeSwitch: false,
  },
  modelAsks: [
    { id: 'M-01', kind: 'quota', role: 'qa', text: 'Codex 額度用完了，約 15:40 重置。QA 固定用 Codex，TC-31 停著。', yes: '這段時間改用 Claude', no: '等重置', from: 'crew', age: '剛剛' },
  ],
}

export const DEMO = { normal: NORMAL, empty: EMPTY, attention: ATTENTION, restart: RESTART, leading: LEADING, drafting: DRAFTING, confirm: CONFIRM, codex: CODEX, quota: QUOTA } as const
