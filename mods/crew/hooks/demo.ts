import type { Route, Snapshot } from './model'

/** Sample data for the design preview. None of it is real. */

const S: Route = { tier: 'S', model: 'Haiku', effort: 'low' }
const M: Route = { tier: 'M', model: 'Sonnet', effort: 'medium' }
const L: Route = { tier: 'L', model: 'Sonnet', effort: 'high' }
const XL: Route = { tier: 'XL', model: 'Opus', effort: 'high' }

const NORMAL: Snapshot = {
  prd: { id: 'PRD-001', title: '會員訂閱 v1', progress: 62 },
  today: 412_000,
  roles: [
    { id: 'pm', state: 'idle', doing: '—', context: 18_000, limit: 60_000, today: 42_000 },
    { id: 'uiux', state: 'working', doing: 'SCR-04 結帳頁三種狀態', route: M, context: 41_000, limit: 60_000, today: 96_000 },
    { id: 'fullstack', state: 'working', doing: 'TASK-12 訂閱 API', route: L, context: 77_000, limit: 100_000, today: 188_000 },
    { id: 'qa', state: 'waiting', doing: '等 PM 確認 AC-07、AC-09', route: S, context: 23_000, limit: 60_000, today: 51_000 },
    { id: 'techlead', state: 'rotating', doing: '存記憶、寫交接摘要', route: XL, context: 58_000, limit: 60_000, today: 35_000 },
  ],
  gates: [
    { id: 'G1', state: 'pass' },
    { id: 'G2', state: 'pass' },
    { id: 'G3', state: 'active' },
    { id: 'G4', state: 'gap', detail: '2 個缺口' },
    { id: 'G5', state: 'pending' },
    { id: 'G6', state: 'pending' },
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
      messages: [{ from: 'crew', text: '項目碰到金流，複雜度從 L 升到 XL，改用 Opus・high', kind: 'route' }],
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
  actions: ['DEC-15 TASK-12 拆成 12a／12b，全端門檻 100K → 80K'],
}

const ATTENTION: Snapshot = {
  ...NORMAL,
  roles: NORMAL.roles.map(r =>
    r.id === 'fullstack'
      ? { ...r, state: 'blocked', doing: 'TASK-15 測試失敗 2 次，已升級', route: XL, context: 96_000 }
      : r,
  ),
  items: NORMAL.items.map(i =>
    i.id === 'TASK-15' ? { ...i, status: 'blocked', note: '測試失敗 2 次：從 L 升級到 XL，等 Tech lead 看 ADR-02' } : i,
  ),
  alerts: [
    '全端今日佔 46%，快取命中率 52%（喚醒間隔太長，對話整份重寫快取）',
    '全端 context 96K，接近 100K 門檻',
  ],
}

const EMPTY: Snapshot = {
  prd: null,
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
}

export const DEMO = { normal: NORMAL, empty: EMPTY, attention: ATTENTION } as const
