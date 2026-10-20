import type { RequirementRow, Route, Snapshot, StageCell } from './model'

/** Sample data for the design preview. None of it is real. */

const S: Route = { tier: 'S', model: 'Sonnet', effort: 'medium' }
const M: Route = { tier: 'M', model: 'Sonnet', effort: 'high' }
const L: Route = { tier: 'L', model: 'Opus', effort: 'high' }
const XL: Route = { tier: 'XL', model: 'Opus', effort: 'xhigh' }

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
  prd: { id: 'PRD-001', title: '會員訂閱 v1', progress: 62 },
  progress: {
    done: 31,
    total: 50,
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
      { id: 'TC-31', title: '到期當天取消', role: 'qa', age: '3 分鐘前' },
      { id: 'SCR-01', title: '方案選擇頁', role: 'uiux', age: '20 分鐘前' },
      { id: 'AC-01', title: '可以選月繳方案', role: 'pm', age: '1 小時前' },
    ],
  },
  today: 412_000,
  roles: [
    { id: 'pm', state: 'idle', doing: '—', context: 18_000, limit: 60_000, today: 42_000 },
    { id: 'uiux', state: 'working', doing: 'SCR-04 結帳頁三種狀態', route: M, context: 41_000, limit: 100_000, today: 96_000 },
    { id: 'fullstack', state: 'working', doing: 'TASK-12 訂閱 API', route: L, context: 77_000, limit: 160_000, today: 188_000 },
    { id: 'qa', state: 'waiting', doing: '等 PM 確認 AC-07、AC-09', route: S, context: 23_000, limit: 60_000, today: 51_000 },
    { id: 'techlead', state: 'rotating', doing: '閒置後換新對話，帶記憶重開', route: XL, context: 58_000, limit: 256_000, today: 35_000 },
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
    { id: 'TASK-12', title: '訂閱 API', owner: 'fullstack', status: 'doing', route: L },
    { id: 'TC-31', title: '到期當天取消', owner: 'qa', status: 'doing', route: S },
    { id: 'AC-07', title: '取消訂閱後仍可使用到期末', owner: 'pm', status: 'review', route: M, note: '缺 test case，等 PM 確認' },
    { id: 'ADR-02', title: '金流服務與 webhook 驗簽', owner: 'techlead', status: 'review', route: XL },
    { id: 'TASK-15', title: '金流 webhook 驗簽', owner: 'fullstack', status: 'todo', route: XL, note: '金流：從 L 升級到 XL' },
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
      messages: [{ from: 'crew', text: '項目碰到金流，複雜度從 L 升到 XL，改用 Opus・xhigh', kind: 'route' }],
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
    { role: 'fullstack', input: 31_000, output: 22_000, cacheRead: 85_000, cacheWrite: 50_000, wakes: 14, rotations: 2 },
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
  actions: [{ id: 'DEC-15', text: '全端輪替，門檻 100K → 80K', before: '命中率 52% · context 96K', after: '命中率 81% · context 8K' }],
  resident: { checked: '2 分鐘前', next: '3 分鐘後', digest: { sent: '12:30', queued: 2, next: '13:00' } },
  requirements: REQUIREMENTS,
  alignment: { covered: 14, total: 14, gaps: 0, added: 0, removed: 0, prdChanged: '2 小時前', checked: '剛剛' },
}

const ATTENTION: Snapshot = {
  ...NORMAL,
  roles: NORMAL.roles.map(r =>
    r.id === 'fullstack'
      ? { ...r, state: 'blocked', doing: 'TASK-15 測試失敗 2 次，已升級', route: XL, context: 96_000, limit: 256_000 }
      : r,
  ),
  items: NORMAL.items.map(i =>
    i.id === 'TASK-15' ? { ...i, status: 'blocked', note: '測試失敗 2 次：從 L 升級到 XL（Opus・xhigh），等 Tech lead 看 ADR-02' } : i,
  ),
  alerts: [
    { text: '全端今日佔 46%（超過 40%）', at: '12:41' },
    { text: '全端快取命中率 52%（低於 60%）：喚醒間隔太長，對話整份重寫快取', at: '12:41' },
    { text: 'PM 和 QA 在 AC-007 來回 7 次（超過 6 次）', at: '12:20' },
  ],
  actions: [
    ...NORMAL.actions,
    { id: 'DEC-16', text: '全端下一個項目改用 Sonnet・high（TASK-15 照舊用 Opus・xhigh）', before: '今日佔 46%' },
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
}

export const DEMO = { normal: NORMAL, empty: EMPTY, attention: ATTENTION } as const
