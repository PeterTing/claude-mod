import type { CrewScenario, CrewTab } from '../types'
import {
  barCells,
  hitRate,
  percent,
  ITEM_STATUS_NAMES,
  MEMORY_TYPE_NAMES,
  ROLE_NAMES,
  ROLE_STATE_NAMES,
  tokens,
} from './model'
import type { Decision, Feature, Gate, Item, ItemStatus, LayerState, Progress, RequirementRow, RoleId, RoleRow, Route, Snapshot, StageCell, Tuning } from './model'

/** The elements a surface draws with, as `$.ui.resolve(e)` hands them over; a phone's has no text field or picker. */
export type Elements = { Box: any; Text: any; Button: any; Input?: any; Select?: any }

/** What the person can do in the pane: everything crew does on their word, with no command. */
export type Actions = {
  tab: (tab: CrewTab) => void
  scenario: (scenario: CrewScenario) => void
  thread: (item: string | null) => void
  /** Opens a gate's detail on the overview, or closes it with null. */
  gate: (gate: string | null) => void
  /** Opens an item's thread on the Threads tab. */
  openThread: (item: string) => void
  /** The PRD picked in the list, and the start with the one picked or a path typed. */
  pick: (path: string) => void
  start: (path?: string) => void
  /** Not now: the pane closes, and crew starts nothing. */
  notNow: () => void
  resume: () => void
  answer: (question: string, text: string) => void
  approve: (question: string) => void
  reject: (question: string, reason?: string) => void
  /** Opens a design to read in the pane, or closes it with null. */
  viewDesign: (design: string | null) => void
  /** Opens a role's question field, or closes it with null; asks it; rotates it. */
  openAsk: (role: RoleId | null) => void
  ask: (role: RoleId, text: string) => void
  rotate: (role: RoleId) => void
  testCommand: (text: string) => void
  runTests: () => void
  tuning: (mode: Tuning) => void
  openOnLoad: (open: boolean) => void
  /** The first press asks to confirm; the second resets. */
  reset: (confirmed: boolean) => void
  consolidate: () => void
  demoOff: () => void
  recall: (query: string) => void
  remember: (text: string) => void
}

export type View = { tab: CrewTab; scenario: CrewScenario; thread: string | null; gate: string | null; asking: string | null; confirming: boolean }

const TABS: readonly [CrewTab, string][] = [
  ['overview', '總覽'],
  ['progress', '進度'],
  ['board', '看板'],
  ['threads', '討論'],
  ['memory', '記憶'],
  ['tokens', 'Token'],
  ['settings', '設定'],
]

const SCENARIOS: readonly [CrewScenario, string][] = [
  ['normal', '一般'],
  ['empty', '剛開始'],
  ['attention', '需要注意'],
  ['restart', '剛重開'],
]

/** A text field where the surface has one; where it has none (a phone), where to type instead. */
function Field({ el, id, label, placeholder, value, submit, what, onSubmit }: { el: Elements; id: string; label: string; placeholder?: string; value?: string; submit?: string; what: string; onSubmit: (text: string) => void }) {
  const { Input, Text } = el
  if (Input === undefined) return <Text dimColor>{what}請在電腦上的面板輸入</Text>
  return <Input key={id} label={label} placeholder={placeholder} value={value} submitLabel={submit} onSubmit={(text: string) => onSubmit(text)} />
}

const STATE_COLORS: Record<RoleRow['state'], string | undefined> = {
  idle: 'subtle',
  working: 'suggestion',
  waiting: 'warning',
  rotating: 'claude',
  blocked: 'error',
}

const GATE_TEXT = (g: Gate): [string, string] => {
  if (g.state === 'pass') return [`${g.id} ✓`, 'success']
  if (g.state === 'gap') return [`${g.id} ${g.detail ?? '有缺口'}`, 'warning']
  if (g.state === 'active') return [`${g.id} 進行中`, 'suggestion']
  return [`${g.id} —`, 'subtle']
}

/** A bar of `width` cells, filled to `percent`. */
export const bar = (percent: number, width = 20): string => {
  const filled = barCells(percent, width)
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`
}

const percentOf = (p: Progress): number => percent(p.done, p.total)

const STAGE_COLORS = { done: 'success', active: 'suggestion', pending: 'subtle' } as const

const LAYER_MARKS: Record<LayerState, string> = { done: '✓', doing: '…', todo: '·' }

const layers = (f: Feature): string =>
  `設計${LAYER_MARKS[f.layers.design]} 前端${LAYER_MARKS[f.layers.frontend]} 後端${LAYER_MARKS[f.layers.backend]} 測試${LAYER_MARKS[f.layers.test]}`

/** How much there is, how much is done, where the team is and what moved lately. */
function ProgressSummary({ el, p }: { el: Elements; p: Progress }) {
  const { Box, Text } = el
  const pct = percentOf(p)
  const today = p.daily.at(-1)?.done ?? 0
  const yesterday = p.daily.at(-2)?.done ?? 0
  const latest = p.recent[0]
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text bold>整體進度</Text>
        <Text color="success">{bar(pct)}</Text>
        <Text bold>{pct}%</Text>
        <Text dimColor>
          {p.done}/{p.total} 項
        </Text>
      </Box>
      <Box flexDirection="row" gap={1}>
        {p.stages.map((st, i) => (
          <Text color={STAGE_COLORS[st.state]}>
            {i > 0 ? '→ ' : ''}
            {st.label} {st.state === 'done' ? '✓' : st.total === 0 ? '—' : `${st.done}/${st.total}`}
          </Text>
        ))}
      </Box>
      <Text>
        目前在：{p.stages.filter(st => st.state === 'active').map(st => st.label).join('、') || '—'}
      </Text>
      <Text dimColor>
        今天完成 {today} 項（昨天 {yesterday} 項）
        {latest === undefined ? '' : ` · 最近完成：${latest.id} ${latest.title}（${ROLE_NAMES[latest.role]}，${latest.age}）`}
      </Text>
    </Box>
  )
}

const STAGE_MARK: Record<StageCell['state'], string> = { done: '✓', doing: '◐', todo: '○', stale: '⟳', later: '—' }

const STAGE_NAMES: [keyof RequirementRow['layers'], string][] = [
  ['spec', '規格'],
  ['design', '設計'],
  ['cases', '測試案例'],
  ['tasks', '任務'],
  ['code', '實作'],
  ['review', 'Review'],
  ['runs', '測試結果'],
]

/** Each PRD requirement and how far each stage of its development is, one row each under the stage names. */
function RequirementList({ el, rows }: { el: Elements; rows: readonly RequirementRow[] }) {
  const { Box, Text } = el
  return (
    <Box flexDirection="column">
      <Text bold>PRD 需求（✓ 完成 ◐ 進行中 ○ 還沒開始 ⟳ 過期 — 還沒追蹤）</Text>
      {Row({ el, cells: [['10%', '需求', { dimColor: true }], ['27%', '內容', { dimColor: true }], ...STAGE_NAMES.map(([, name]): [string, string, Record<string, unknown>] => ['9%', name, { dimColor: true }])] })}
      {rows.map(r =>
        r.dropped !== undefined
          ? Row({ el, cells: [['10%', r.id, { dimColor: true }], ['27%', r.text, { dimColor: true, strikethrough: true }], ['63%', `移出範圍：${r.dropped}`, { dimColor: true }]] })
          : Row({
              el,
              cells: [
                ['10%', r.id, { color: 'suggestion' }],
                ['27%', r.text],
                ...STAGE_NAMES.map(([key]): [string, string, Record<string, unknown>] => {
                  const cell = r.layers[key]
                  return [
                    '9%',
                    `${STAGE_MARK[cell.state]}${cell.note === undefined ? '' : ` ${cell.note}`}`,
                    { color: cell.state === 'done' ? 'success' : cell.state === 'stale' ? 'warning' : undefined, dimColor: cell.state === 'later' || cell.state === 'todo' },
                  ]
                }),
              ],
            }),
      )}
    </Box>
  )
}

function ProgressTab({ el, snap }: { el: Elements; snap: Snapshot }) {
  const { Box, Text } = el
  const p = snap.progress
  if (p === null) return <Text dimColor>還沒有項目。PM 拆完 PRD 後，這裡會顯示每個功能做到哪裡。</Text>
  const most = Math.max(1, ...p.daily.map(d => d.done))
  return (
    <Box flexDirection="column" gap={1}>
      {ProgressSummary({ el, p })}
      {snap.requirements !== undefined && snap.requirements.length > 0 && RequirementList({ el, rows: snap.requirements })}
      <Box flexDirection="column">
        <Text bold>各功能</Text>
        {p.features.map(f =>
          f.dropped !== undefined
            ? Row({ el, cells: [['26%', `${f.id} ${f.title}`, { dimColor: true, strikethrough: true }], ['74%', f.dropped, { dimColor: true }]] })
            : Row({
                el,
                cells: [
                  ['26%', `${f.id} ${f.title}`],
                  ['26%', bar(f.percent, 16), { color: f.percent === 100 ? 'success' : 'suggestion' }],
                  ['8%', `${f.percent}%`],
                  ['40%', layers(f), { dimColor: true }],
                ],
              }),
        )}
      </Box>
      <Box flexDirection="column">
        <Text bold>每天完成</Text>
        {p.daily.map(d => Row({ el, cells: [['10%', d.day, { dimColor: true }], ['50%', bar((d.done / most) * 100, 14)], ['40%', `${d.done} 項`]] }))}
      </Box>
      <Box flexDirection="column">
        <Text bold>最近完成</Text>
        {p.recent.map(r => Row({ el, cells: [['14%', r.id], ['46%', r.title], ['20%', ROLE_NAMES[r.role], { dimColor: true }], ['20%', r.age, { dimColor: true }]] }))}
      </Box>
    </Box>
  )
}

/** What a gate checks, who fills and confirms it, how much is covered, and each gap. */
function GateDetail({ el, g, act }: { el: Elements; g: Gate; act: Actions }) {
  const { Box, Text, Button } = el
  const pct = percent(g.covered, g.total)
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Box flexDirection="row" gap={1}>
        <Text bold>
          {g.id} {g.name}
        </Text>
        <Button key="gate-close" label="收起" onPress={() => act.gate(null)} />
      </Box>
      <Text dimColor>
        負責：{g.fill} · {g.confirm}
      </Text>
      <Box flexDirection="row" gap={1}>
        <Text>覆蓋</Text>
        <Text color={pct === 100 ? 'success' : 'suggestion'}>{bar(pct)}</Text>
        <Text>
          {g.covered}/{g.total}（{pct}%）
        </Text>
      </Box>
      {g.gaps.length === 0 ? (
        <Text color="success">沒有缺口。</Text>
      ) : (
        <Box flexDirection="column">
          <Text color="warning">缺口（{g.gaps.length}）</Text>
          {g.gaps.map(gap => (
            <Box flexDirection="row" gap={1}>
              <Text>
                {gap.id} {gap.title}
              </Text>
              <Text dimColor>· {gap.status}</Text>
              {gap.thread !== undefined && (
                <Button key={`gap-thread-${gap.thread}`} label="看討論" onPress={() => act.openThread(gap.thread ?? '')} />
              )}
            </Box>
          ))}
        </Box>
      )}
      {g.note !== undefined && <Text dimColor>{g.note}</Text>}
      <Text dimColor>上次檢查：{g.checked} · 程式計算，比對 prd-tracker.json，不花 token</Text>
    </Box>
  )
}

const route = (r: Route | undefined): string => (r === undefined ? '—' : `${r.tier} ${r.model}・${r.effort}`)

/** One table row: each cell a width and a text, and what follows the cells (a row's buttons). */
function Row({ el, cells, tail }: { el: Elements; cells: readonly [string, string, Record<string, unknown>?][]; tail?: unknown }) {
  const { Box, Text } = el
  return (
    <Box flexDirection="row">
      {cells.map(([width, text, props]) => (
        <Box width={width}>
          <Text wrap="truncate-end" {...(props ?? {})}>
            {text}
          </Text>
        </Box>
      ))}
      {tail}
    </Box>
  )
}

function Header({ el, snap, view, act, isDemo }: { el: Elements; snap: Snapshot; view: View; act: Actions; isDemo: boolean }) {
  const { Box, Text, Button } = el
  const prd =
    snap.prd === null
      ? '還沒有 PRD'
      : `${snap.prd.id} ${snap.prd.title} · 進度 ${snap.prd.progress}% · 今日 ${tokens(snap.today)} tok`
  return (
    <Box flexDirection="column">
      {isDemo && (
        <Box flexDirection="row" gap={1}>
          <Text color="warning">設計稿・示意資料</Text>
          <Button key="demo-close" label="關閉設計稿" onPress={() => act.demoOff()} />
        </Box>
      )}
      <Text bold>{prd}</Text>
      {snap.alignment !== undefined && Alignment({ el, a: snap.alignment })}
      {snap.resident !== undefined && ResidentLine({ el, r: snap.resident })}
      {isDemo && (
        <Box flexDirection="row" gap={1}>
          <Text dimColor>示意情境</Text>
          {SCENARIOS.map(([id, label]) => (
            <Button key={`scenario-${id}`} label={label} variant={view.scenario === id ? 'primary' : 'secondary'} onPress={() => act.scenario(id)} />
          ))}
        </Box>
      )}
      <Box flexDirection="row" gap={1}>
        {TABS.map(([id, label]) => (
          <Button key={`tab-${id}`} label={label} variant={view.tab === id ? 'primary' : 'secondary'} onPress={() => act.tab(id)} />
        ))}
      </Box>
    </Box>
  )
}

/** Whether the board answers the PRD as it stands: one rule for the pane and the line above the prompt. */
const aligned = (a: NonNullable<Snapshot['alignment']>): boolean => a.problem === undefined && a.gaps === 0 && a.added === 0 && a.removed === 0

/** One line: how the board stands against the PRD as it is now, and when crew last looked. */
function Alignment({ el, a }: { el: Elements; a: NonNullable<Snapshot['alignment']> }) {
  const { Text } = el
  const ok = aligned(a)
  const drift =
    a.problem !== undefined
      ? ` ${a.problem}`
      : a.added + a.removed > 0
        ? ` PRD 改了：新增 ${a.added}、移除 ${a.removed}`
        : a.gaps > 0
          ? ` ${a.gaps} 處對不上`
          : ''
  return (
    <Text color={ok ? 'success' : 'warning'}>
      對準 PRD {a.covered}/{a.total} {ok ? '✓' : `⚠${drift}`} · PRD 更新於 {a.prdChanged} · 即時檢查 {a.checked}
    </Text>
  )
}

/** crew while it stays on: the heartbeat and what it found, a restart, and the brain's digest. */
function ResidentLine({ el, r }: { el: Elements; r: NonNullable<Snapshot['resident']> }) {
  const { Box, Text } = el
  const digest = r.digest === undefined ? '' : ` · 大腦摘要 ${r.digest.sent} 送出，${r.digest.queued} 則等 ${r.digest.next}`
  return (
    <Box flexDirection="column">
      {r.found === undefined ? (
        <Text dimColor>
          常駐 ✓ 心跳 {r.checked} · 下次 {r.next}
          {digest}
        </Text>
      ) : (
        <Text color="warning">
          常駐 ⚠ 心跳 {r.checked}發現：{r.found}
        </Text>
      )}
      {r.resumed !== undefined && <Text dimColor>重開接續：{r.resumed}</Text>}
    </Box>
  )
}

function Overview({ el, snap, view, act }: { el: Elements; snap: Snapshot; view: View; act: Actions }) {
  const { Box, Text, Button } = el
  const openGate = snap.gates.find(g => g.id === view.gate)
  return (
    <Box flexDirection="column" gap={1}>
      {snap.start?.resumable !== undefined && (
        <Box flexDirection="row" gap={1}>
          <Text color="suggestion">{snap.start.resumable}</Text>
          <Button key="resume" label="接續" variant="primary" onPress={() => act.resume()} />
          {snap.start.paused !== true && <Button key="not-now" label="先不要" onPress={() => act.notNow()} />}
        </Box>
      )}
      {snap.progress !== null && ProgressSummary({ el, p: snap.progress })}
      {snap.prd === null && StartScreen({ el, snap, act })}
      <Box flexDirection="column">
        {Row({ el, cells: [['11%', '角色', { dimColor: true }], ['9%', '狀態', { dimColor: true }], ['28%', '正在做', { dimColor: true }], ['17%', '模型', { dimColor: true }], ['11%', 'context', { dimColor: true }], ['8%', '今日', { dimColor: true }]] })}
        {snap.roles.map(r => (
          <Box flexDirection="column">
            {Row({ el, cells: [
                ['11%', ROLE_NAMES[r.id]],
                ['9%', ROLE_STATE_NAMES[r.state], { color: STATE_COLORS[r.state] }],
                ['28%', r.doing],
                ['17%', route(r.route), { dimColor: r.route === undefined }],
                ['11%', `${tokens(r.context)}/${tokens(r.limit)}`, { color: r.context / r.limit > 0.85 ? 'warning' : undefined }],
                ['8%', tokens(r.today)],
              ], tail: snap.prd === null ? undefined : (
                <Box flexDirection="row" gap={1}>
                  <Button key={`ask-${r.id}`} label="問" onPress={() => act.openAsk(view.asking === r.id ? null : r.id)} />
                  <Button key={`rotate-${r.id}`} label="輪替" onPress={() => act.rotate(r.id)} />
                </Box>
              ) })}
            {view.asking === r.id && Field({ el, id: `ask-${r.id}-text`, label: `問 ${ROLE_NAMES[r.id]}`, placeholder: '你的問題', submit: '送出', what: '問題', onSubmit: text => act.ask(r.id, text) })}
          </Box>
        ))}
      </Box>
      {snap.gates.length > 0 && (
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Text dimColor>關卡</Text>
            {snap.gates.map(g => (
              <Button
                key={`gate-${g.id}`}
                label={GATE_TEXT(g)[0]}
                variant={view.gate === g.id ? 'primary' : 'secondary'}
                dimColor={g.state === 'pending'}
                onPress={() => act.gate(view.gate === g.id ? null : g.id)}
              />
            ))}
          </Box>
          {openGate !== undefined && GateDetail({ el, g: openGate, act })}
        </Box>
      )}
      {snap.alerts.length > 0 && Alerts({ el, alerts: snap.alerts })}
      {snap.decisions.length > 0 && (
        <Box flexDirection="column">
          <Text color="warning">待你決定（{snap.decisions.length}）</Text>
          {snap.decisions.map(d => DecisionRow({ el, d, act }))}
        </Box>
      )}
      {snap.opened !== undefined && (
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Text bold>
              {snap.opened.id} {snap.opened.title}
            </Text>
            <Button key="close-design" label="關閉" onPress={() => act.viewDesign(null)} />
          </Box>
          <Text>{snap.opened.body}</Text>
        </Box>
      )}
    </Box>
  )
}

/** One thing that waits for the person, with what settles it: an answer, a press, or a reason to send a design back. */
function DecisionRow({ el, d, act }: { el: Elements; d: Decision; act: Actions }) {
  const { Box, Text, Button } = el
  const who = d.from === 'crew' ? 'crew' : d.from === 'brain' ? '大腦' : ROLE_NAMES[d.from]
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text>
          {d.id} {d.question}
        </Text>
        <Text dimColor>
          {who} · {d.age}
        </Text>
        {d.kind === 'design' && d.design !== undefined && <Button key={`view-${d.design}`} label="看設計稿" onPress={() => act.viewDesign(d.design ?? null)} />}
        {d.kind !== undefined && <Button key={`approve-${d.id}`} label="核准" variant="primary" onPress={() => act.approve(d.id)} />}
        {d.kind === 'proposal' && <Button key={`reject-${d.id}`} label="不要" onPress={() => act.reject(d.id)} />}
      </Box>
      {d.kind === undefined && Field({ el, id: `answer-${d.id}`, label: '回答', placeholder: '你的回答', submit: '送出', what: '回答', onSubmit: text => act.answer(d.id, text) })}
      {d.kind === 'design' && Field({ el, id: `reject-${d.id}`, label: '退回原因', placeholder: '要改什麼', submit: '退回', what: '退回原因', onSubmit: text => act.reject(d.id, text) })}
    </Box>
  )
}

/** What crew offers when it loads with no PRD: one picked from the repo or typed, or not now. */
function StartScreen({ el, snap, act }: { el: Elements; snap: Snapshot; act: Actions }) {
  const { Box, Text, Button, Select } = el
  const prds = snap.start?.prds ?? []
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>crew 已載入，還沒有開始的 PRD。</Text>
      {prds.length > 0 && Select !== undefined && (
        <Select key="prd-pick" label="PRD 檔案" value={snap.start?.chosen ?? prds[0]?.path} options={prds.map(p => ({ value: p.path, label: `${p.path}　${p.title}` }))} onSelect={(path: string) => act.pick(path)} />
      )}
      {Field({ el, id: 'prd-path', label: '或輸入路徑', placeholder: 'docs/PRD.md', submit: '開始', what: 'PRD 路徑', onSubmit: path => act.start(path) })}
      <Box flexDirection="row" gap={1}>
        <Button key="start" label="開始" variant="primary" onPress={() => act.start()} />
        <Button key="not-now" label="這次不用" onPress={() => act.notNow()} />
      </Box>
      <Text dimColor>PM 會先把 PRD 拆成功能和驗收條件。五個角色都在待命，沒有工作時不花 token。</Text>
    </Box>
  )
}

/** Where crew is set up: the test command, how the brain acts on usage, the pane on load, the flow, the memory, the preview. */
function Settings({ el, snap, view, act, isDemo }: { el: Elements; snap: Snapshot; view: View; act: Actions; isDemo: boolean }) {
  const { Box, Text, Button } = el
  const tuning = snap.tuning ?? 'ask'
  const open = snap.settings?.openOnLoad ?? true
  const { Select } = el
  const prds = snap.start?.prds ?? []
  return (
    <Box flexDirection="column" gap={1}>
      {snap.prd !== null && prds.length > 0 && (
        <Box flexDirection="column">
          <Text bold>PRD</Text>
          {Select !== undefined && (
            <Select key="prd-switch" label="換一份" value={snap.start?.chosen ?? prds[0]?.path} options={prds.map(p => ({ value: p.path, label: `${p.path}　${p.title}` }))} onSelect={(path: string) => act.pick(path)} />
          )}
          <Box flexDirection="row" gap={1}>
            <Button key="switch-prd" label="改跟這一份" onPress={() => act.start()} />
            <Text dimColor>看板會對準選的 PRD；流程還在進行時要先等這一輪做完。</Text>
          </Box>
        </Box>
      )}
      <Box flexDirection="column">
        <Text bold>測試指令</Text>
        {Field({ el, id: 'test-command', label: '指令', placeholder: '例如 npm test', value: snap.settings?.testCommand, submit: '儲存', what: '測試指令', onSubmit: text => act.testCommand(text) })}
        <Box flexDirection="row" gap={1}>
          <Button key="run-tests" label="跑測試" onPress={() => act.runTests()} />
          <Text dimColor>crew 在全端的工作目錄直接執行，不經過 shell，不會每次問你。</Text>
        </Box>
      </Box>
      <Box flexDirection="column">
        <Text bold>大腦處置 token 用量</Text>
        <Box flexDirection="row" gap={1}>
          <Button key="tuning-auto" label="自動" variant={tuning === 'auto' ? 'primary' : 'secondary'} onPress={() => act.tuning('auto')} />
          <Button key="tuning-ask" label="先問你" variant={tuning === 'ask' ? 'primary' : 'secondary'} onPress={() => act.tuning('ask')} />
          <Text dimColor>{tuning === 'auto' ? '大腦自己處置，事後記成決定' : '大腦提出建議，你核准才執行'}</Text>
        </Box>
      </Box>
      <Box flexDirection="column">
        <Text bold>Claude Code 開啟時</Text>
        <Box flexDirection="row" gap={1}>
          <Button key="open-on-load" label="打開這個面板" variant={open ? 'primary' : 'secondary'} onPress={() => act.openOnLoad(true)} />
          <Button key="not-on-load" label="不要打開" variant={open ? 'secondary' : 'primary'} onPress={() => act.openOnLoad(false)} />
          <Text dimColor>現在：{open ? '打開這個面板' : '不打開'}</Text>
        </Box>
      </Box>
      <Box flexDirection="column">
        <Text bold>流程</Text>
        <Box flexDirection="row" gap={1}>
          <Button key="resume" label="接續" onPress={() => act.resume()} />
          <Button key="reset" label="重設流程" onPress={() => act.reset(false)} />
        </Box>
        {view.confirming && (
          <Box flexDirection="row" gap={1}>
            <Text color="warning">重設這個 session 的流程和角色？重設後看板、討論和記憶都會留著。</Text>
            <Button key="reset-confirm" label="確定重設" variant="primary" onPress={() => act.reset(true)} />
          </Box>
        )}
      </Box>
      <Box flexDirection="column">
        <Text bold>記憶</Text>
        <Box flexDirection="row" gap={1}>
          <Button key="consolidate" label="整理今天的記憶" onPress={() => act.consolidate()} />
          <Text dimColor>小模型把今天的紀錄整理成事實和教訓，不會產生決定。</Text>
        </Box>
      </Box>
      {isDemo && <Button key="demo-off" label="關閉設計稿" onPress={() => act.demoOff()} />}
    </Box>
  )
}

const BOARD_ORDER: readonly ItemStatus[] = ['blocked', 'doing', 'review', 'todo', 'done']

function Board({ el, snap }: { el: Elements; snap: Snapshot }) {
  const { Box, Text } = el
  if (snap.items.length === 0) return <Text dimColor>看板是空的。PM 拆完 PRD 後，項目會出現在這裡。</Text>
  return (
    <Box flexDirection="column" gap={1}>
      {BOARD_ORDER.map(status => {
        const items: readonly Item[] = snap.items.filter(i => i.status === status)
        if (items.length === 0) return null
        return (
          <Box flexDirection="column">
            <Text bold color={status === 'blocked' ? 'error' : undefined}>
              {ITEM_STATUS_NAMES[status]}（{items.length}）
            </Text>
            {items.map(i => (
              <Box flexDirection="column">
                {Row({ el, cells: [
                    ['12%', i.id],
                    ['38%', i.title, { dimColor: status === 'done' }],
                    ['14%', ROLE_NAMES[i.owner]],
                    ['26%', route(i.route), { color: i.route.tier === 'XL' ? 'claude' : undefined }],
                  ] })}
                {i.note !== undefined && <Text dimColor>　　{i.note}</Text>}
              </Box>
            ))}
          </Box>
        )
      })}
      <Text dimColor>模型和 context 門檻依項目複雜度決定：S Sonnet・medium 60K · M Sonnet・high 100K · L Opus・high 160K · XL Opus・xhigh 256K</Text>
    </Box>
  )
}

function Threads({ el, snap, view, act }: { el: Elements; snap: Snapshot; view: View; act: Actions }) {
  const { Box, Text, Button } = el
  if (snap.threads.length === 0) return <Text dimColor>還沒有討論。角色之間的訊息都會掛在項目底下，出現在這裡。</Text>
  const open = snap.threads.find(t => t.item === view.thread)
  if (open === undefined) {
    return (
      <Box flexDirection="column">
        {snap.threads.map(t => (
          <Button key={`thread-${t.item}`} label={`${t.item} ${t.title} · ${t.messages.length} 則`} onPress={() => act.thread(t.item)} />
        ))}
      </Box>
    )
  }
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={1}>
        <Button key="thread-back" label="← 所有討論" onPress={() => act.thread(null)} />
        <Text bold>
          {open.item} {open.title}
        </Text>
      </Box>
      <Box flexDirection="column">
        {open.messages.map(m => Row({ el, cells: [
              ['18%', m.from, { color: m.kind === undefined || m.kind === 'message' ? 'suggestion' : 'subtle' }],
              ['82%', m.text, { dimColor: m.kind === 'memory' || m.kind === 'route' }],
            ] }))}
      </Box>
    </Box>
  )
}

function MemoryList({ el, snap, act }: { el: Elements; snap: Snapshot; act: Actions }) {
  const { Box, Text } = el
  const fields = (
    <Box flexDirection="column">
      {Field({ el, id: 'recall', label: '搜尋', placeholder: '關鍵字或編號', submit: '搜尋', what: '搜尋', onSubmit: q => act.recall(q) })}
      {snap.recalled !== undefined && (
        <Box flexDirection="column">
          <Text color="suggestion">找到（{snap.recalled.query}）：</Text>
          <Text>{snap.recalled.text}</Text>
        </Box>
      )}
      {Field({ el, id: 'remember', label: '記下偏好', placeholder: '例如：文案用台灣用語', submit: '記下', what: '偏好', onSubmit: text => act.remember(text) })}
    </Box>
  )
  if (snap.memories.length === 0) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text dimColor>還沒有記憶。角色做了決定、發現限制，或你說了偏好，就會存在這裡。</Text>
        {fields}
      </Box>
    )
  }
  return (
    <Box flexDirection="column" gap={1}>
      {fields}
      <Box flexDirection="column">
        {snap.memories.map(m => {
          const isOld = m.supersededBy !== undefined
          return Row({ el, cells: [
                ['12%', m.id, { color: isOld ? undefined : 'suggestion', dimColor: isOld }],
                ['8%', MEMORY_TYPE_NAMES[m.type], { dimColor: isOld }],
                ['48%', isOld ? `${m.text}（已被 ${m.supersededBy} 取代）` : m.text, { dimColor: isOld }],
                ['12%', m.source, { dimColor: true }],
                ['20%', m.refs.join('、'), { dimColor: true }],
              ] })
        })}
      </Box>
      <Box flexDirection="column">
        {snap.carrying.map(c => (
          <Text dimColor>
            {ROLE_NAMES[c.role]} 目前帶著：{c.ids.join('、')}（{tokens(c.tokens)} tok）
          </Text>
        ))}
      </Box>
    </Box>
  )
}

function Tokens({ el, snap, act }: { el: Elements; snap: Snapshot; act: Actions }) {
  const { Box, Text, Button } = el
  if (snap.usage.length === 0) return <Text dimColor>今天還沒有用量。角色開始工作後，每一輪的 token 都會記在這裡。</Text>
  const head: [string, string, Record<string, unknown>][] = [
    ['14%', '角色', { dimColor: true }],
    ['12%', '輸入', { dimColor: true }],
    ['12%', '輸出', { dimColor: true }],
    ['13%', '快取讀', { dimColor: true }],
    ['13%', '快取寫', { dimColor: true }],
    ['12%', '命中率', { dimColor: true }],
    ['12%', '喚醒', { dimColor: true }],
    ['12%', '輪替', { dimColor: true }],
  ]
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        {Row({ el, cells: head })}
        {snap.usage.map(u => {
          const rate = hitRate(u)
          return Row({ el, cells: [
                ['14%', ROLE_NAMES[u.role]],
                ['12%', tokens(u.input)],
                ['12%', tokens(u.output)],
                ['13%', tokens(u.cacheRead)],
                ['13%', tokens(u.cacheWrite)],
                ['12%', `${rate}%`, { color: rate < 60 ? 'warning' : undefined }],
                ['12%', String(u.wakes)],
                ['12%', String(u.rotations)],
              ] })
        })}
      </Box>
      <Text dimColor>
        今日 {tokens(snap.today)} tok · 大腦協調佔 {Math.round(snap.brainShare * 100)}%
      </Text>
      <Text dimColor>依複雜度：{snap.tiers.map(t => `${t.tier} ${tokens(t.tokens)}`).join(' · ')}</Text>
      {snap.injected !== undefined && snap.injected.count > 0 && (
        <Text dimColor>
          每次附上的記憶平均 {tokens(snap.injected.average)} tok（{snap.injected.count} 次）
          {snap.chores !== undefined && snap.chores > 0 ? ` · 記憶整理 ${tokens(snap.chores)} tok` : ''}
        </Text>
      )}
      {snap.tuning !== undefined && (
        <Box flexDirection="row" gap={1}>
          <Text dimColor>{snap.tuning === 'auto' ? '大腦處置：自動（大腦自己處置，事後記成決定）' : '大腦處置：先問你（大腦提出建議，你核准才執行）'}</Text>
          <Button key="tuning-auto" label="自動" variant={snap.tuning === 'auto' ? 'primary' : 'secondary'} onPress={() => act.tuning('auto')} />
          <Button key="tuning-ask" label="先問你" variant={snap.tuning === 'ask' ? 'primary' : 'secondary'} onPress={() => act.tuning('ask')} />
        </Box>
      )}
      {snap.alerts.length > 0 && Alerts({ el, alerts: snap.alerts })}
      {snap.actions.length > 0 && (
        <Box flexDirection="column">
          <Text color="suggestion">大腦處置（不能為了省 token 跳過關卡、測試或 review）</Text>
          {snap.actions.map(a => (
            <Box flexDirection="column">
              <Box flexDirection="row" gap={1}>
                <Text>{a.pending === undefined ? `${a.id} ${a.text}` : `建議 ${a.text}`}</Text>
                {a.pending !== undefined && <Button key={`approve-${a.pending}`} label="核准" variant="primary" onPress={() => act.approve(a.pending ?? '')} />}
                {a.pending !== undefined && <Button key={`reject-${a.pending}`} label="不要" onPress={() => act.reject(a.pending ?? '')} />}
              </Box>
              <Text dimColor>
                {'  '}處置前 {a.before} → {a.pending !== undefined ? '等你核准' : a.after === undefined ? '之後的數字等下一輪' : `現在 ${a.after}`}
              </Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}

/** The reminders sent to the brain, each with when. */
function Alerts({ el, alerts }: { el: Elements; alerts: Snapshot['alerts'] }) {
  const { Box, Text } = el
  return (
    <Box flexDirection="column">
      <Text color="warning">提醒已送大腦（同一條件一小時最多一次）</Text>
      {alerts.map(a => (
        <Text>
          · {a.text} · {a.at}
        </Text>
      ))}
    </Box>
  )
}

/** The whole pane: header, tabs and the open tab. */
export function CrewPane({ el, snap, view, act, isDemo = true }: { el: Elements; snap: Snapshot; view: View; act: Actions; isDemo?: boolean }) {
  const { Box } = el
  return (
    <Box flexDirection="column" gap={1}>
      {Header({ el, snap, view, act, isDemo })}
      {view.tab === 'overview' && Overview({ el, snap, view, act })}
      {view.tab === 'progress' && ProgressTab({ el, snap })}
      {view.tab === 'board' && Board({ el, snap })}
      {view.tab === 'threads' && Threads({ el, snap, view, act })}
      {view.tab === 'memory' && MemoryList({ el, snap, act })}
      {view.tab === 'tokens' && Tokens({ el, snap, act })}
      {view.tab === 'settings' && Settings({ el, snap, view, act, isDemo })}
    </Box>
  )
}

const alignmentWord = (a: NonNullable<Snapshot['alignment']>): string =>
  aligned(a) ? '對準 PRD ✓' : a.problem !== undefined ? `⚠ ${a.problem}` : a.gaps > 0 ? `⚠ PRD 對不上 ${a.gaps}` : '⚠ PRD 改了'

/** The one line above the prompt: what needs the person first, then the roles. */
export function bandText(snap: Snapshot, label = 'crew（設計稿）'): string {
  const roles = snap.roles
    .map(r => `${r.id === 'techlead' ? 'TL' : ROLE_NAMES[r.id]} ${r.state === 'working' ? r.doing.split(' ')[0] : ROLE_STATE_NAMES[r.state]}`)
    .join(' · ')
  const parts = [
    label,
    ...(snap.progress !== null ? [`進度 ${percentOf(snap.progress)}%（${snap.progress.done}/${snap.progress.total}）`] : []),
    ...(snap.alignment === undefined ? [] : [alignmentWord(snap.alignment)]),
    `待你決定 ${snap.decisions.length}`,
    ...(snap.alerts.length > 0 ? [`⚠ ${snap.alerts.length} 則提醒`] : []),
    `今日 ${tokens(snap.today)} tok`,
    roles,
  ]
  return parts.join(' │ ')
}
