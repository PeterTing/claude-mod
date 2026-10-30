import type { CrewScenario, CrewTab } from '../types'
import {
  barCells,
  hitRate,
  percent,
  ENGINE_NAMES,
  ITEM_STATUS_NAMES,
  CODEX_WAIT,
  MEMORY_TYPE_NAMES,
  ROLE_NAMES,
  ROLE_STATE_NAMES,
  tokens,
} from './model'
import type { Audit, Decision, Engine, Engines, Feature, Gate, Item, ItemStatus, LayerState, ModelAsk, Pick, Progress, RequirementRow, RoleId, RoleModels, RoleRow, Route, Snapshot, StageCell, Takeover, Tuning } from './model'
import { failedOf, MAX_SENDS, pendingOf, reviewMark, reviewWord, sentOut } from './draft'
import { redact } from './memory'
import { cut } from './prd'
import { CLAUDE_EFFORTS, CLAUDE_FIXED_MODELS, CLAUDE_MODELS, claudeEfforts, codexChoices, codexLabel, CODEX_MINIMUM, fitEffort, labelOf, ladderOf, limitsByTier, pickSaid, TIER_NAMES } from './router'
import type { Model } from './router'

/** The elements a surface draws with, as `$.ui.resolve(e)` hands them over; a phone's has no text field or picker. */
export type Elements = { Box: any; Text: any; Button: any; Input?: any; Select?: any; Link?: any }

/** What the person can do in the pane: everything crew does on their word, with no command. Each may take time: it resolves once done. */
export type Actions = {
  tab: (tab: CrewTab) => void | Promise<void>
  scenario: (scenario: CrewScenario) => void | Promise<void>
  thread: (item: string | null) => void | Promise<void>
  /** Opens a gate's detail on the overview, or closes it with null. */
  gate: (gate: string | null) => void | Promise<void>
  /** Opens an item's thread on the Threads tab. */
  openThread: (item: string) => void | Promise<void>
  /** The PRD picked in the list, and the start with the one picked or a path typed. */
  pick: (path: string) => void | Promise<void>
  start: (path?: string) => void | Promise<void>
  /** Not now: the pane closes, and crew starts nothing. */
  notNow: () => void | Promise<void>
  resume: () => void | Promise<void>
  answer: (question: string, text: string) => void | Promise<void>
  approve: (question: string) => void | Promise<void>
  reject: (question: string, reason?: string) => void | Promise<void>
  /** Opens a design to read in the pane, or closes it with null. */
  viewDesign: (design: string | null) => void | Promise<void>
  /** The designs decided in the pane, one by one, rather than on the review page. */
  reviewInPane: () => void | Promise<void>
  /** The person decided on the page: the brain reads its comments, which may not have woken it. */
  readPage: () => void | Promise<void>
  /** Opens a role's question field, or closes it with null; asks it; rotates it. */
  openAsk: (role: RoleId | null) => void | Promise<void>
  /** Shows a role's work and last report in full under its row, or hides them with null. */
  openDetail: (role: RoleId | null) => void | Promise<void>
  ask: (role: RoleId, text: string) => void | Promise<void>
  rotate: (role: RoleId) => void | Promise<void>
  testCommand: (text: string) => void | Promise<void>
  runTests: () => void | Promise<void>
  tuning: (mode: Tuning) => void | Promise<void>
  openOnLoad: (open: boolean) => void | Promise<void>
  /** The first press asks to confirm; the second resets. */
  reset: (confirmed: boolean) => void | Promise<void>
  consolidate: () => void | Promise<void>
  demoOff: () => void | Promise<void>
  recall: (query: string) => void | Promise<void>
  remember: (text: string) => void | Promise<void>
  /** The brain takes this repo over from the first message, or no longer does. */
  takeover: (on: boolean) => void | Promise<void>
  /** The person's yes to the brain's draft PRD: the flow starts on it. */
  confirmDraft: () => void | Promise<void>
  /**
   * A role's models from its next piece of work: crew's default or the
   * person's own; an engine's floor; the model it is fixed on; its rotation
   * threshold. Whether the brain asks before it moves a role to another model.
   */
  roleMode: (role: RoleId, mode: RoleModels['mode']) => void | Promise<void>
  roleFloor: (role: RoleId, engine: Engine, pick: Partial<Pick>) => void | Promise<void>
  roleEngine: (role: RoleId, engine: Engine) => void | Promise<void>
  roleFixed: (role: RoleId, change: Partial<RoleModels['fixed']>) => void | Promise<void>
  roleLimit: (role: RoleId, limit: RoleModels['limit']) => void | Promise<void>
  askBeforeSwitch: (ask: boolean) => void | Promise<void>
  /** A question on a role's model, settled by one of its two answers. */
  modelAnswer: (id: string, yes: boolean) => void | Promise<void>
  checkCodex: () => void | Promise<void>
  /** crew's web page: opened in the browser now, or each time crew starts; open to the person's tailnet, and the phones paired with it. */
  openWeb: () => void | Promise<void>
  webOnStart: (open: boolean) => void | Promise<void>
  tailnet: (open: boolean) => void | Promise<void>
  pairDevice: () => void | Promise<void>
  unpairDevice: (id: string) => void | Promise<void>
  /** How many pieces of work the brain lets go by between looks at the token bottlenecks. */
}

export type View = { tab: CrewTab; scenario: CrewScenario; thread: string | null; gate: string | null; asking: string | null; detail: string | null; confirming: boolean }

const ROLE_IDS: readonly RoleId[] = ['pm', 'uiux', 'fullstack', 'qa', 'techlead']

/**
 * The work a control of the pane stands for, by its key: what crew does on the
 * person's word, done in full before it resolves. True when the key is one;
 * false for a control that only moves the view, which its own handler takes.
 */
export async function actOn(act: Actions, view: View, snap: Snapshot, key: string, value?: string): Promise<boolean> {
  const did = async (work: void | Promise<void>): Promise<true> => {
    await work
    return true
  }
  const id = (prefix: string) => (key.startsWith(prefix) ? key.slice(prefix.length) : undefined)
  const role = (x: string | undefined): RoleId | undefined => ROLE_IDS.find(r => r === x)
  if (value !== undefined) {
    // A field's Enter, or a pick.
    if (key === 'prd-path') return did(act.start(value))
    if (key === 'prd-pick' || key === 'prd-switch') return did(act.pick(value))
    if (key === 'test-command') return did(act.testCommand(value))
    const floored = key.match(/^floor-(\w+)-(claude|codex)-(model|effort)$/)
    const floorRole = role(floored?.[1])
    if (floored !== null && floorRole !== undefined) return did(act.roleFloor(floorRole, floored[2] as Engine, { [floored[3] as 'model' | 'effort']: value }))
    const fixedPick = key.match(/^fixed-(\w+)-(model|effort)$/)
    const fixedRole = role(fixedPick?.[1])
    if (fixedPick !== null && fixedRole !== undefined) return did(act.roleFixed(fixedRole, { [fixedPick[2] as 'model' | 'effort']: value }))
    const limited = role(id('limit-'))
    if (limited !== undefined) return did(act.roleLimit(limited, value === 'tier' ? 'tier' : Number(value)))
    if (key === 'recall') return did(act.recall(value))
    if (key === 'remember') return did(act.remember(value))
    const answer = id('answer-')
    if (answer !== undefined) return did(act.answer(answer, value))
    const sent = id('reject-')
    if (sent !== undefined) return did(act.reject(sent, value))
    const asked = role(key.match(/^ask-(\w+)-text$/)?.[1])
    if (asked !== undefined) return did(act.ask(asked, value))
    return false
  }
  const simple: Record<string, () => void | Promise<void>> = {
    start: () => act.start(),
    'switch-prd': () => act.start(),
    'not-now': () => act.notNow(),
    resume: () => act.resume(),
    'run-tests': () => act.runTests(),
    'tuning-auto': () => act.tuning('auto'),
    'tuning-ask': () => act.tuning('ask'),
    'open-on-load': () => act.openOnLoad(true),
    'not-on-load': () => act.openOnLoad(false),
    reset: () => act.reset(false),
    'reset-confirm': () => act.reset(true),
    consolidate: () => act.consolidate(),
    'close-design': () => act.viewDesign(null),
    'takeover-on': () => act.takeover(true),
    'takeover-off': () => act.takeover(false),
    'confirm-draft': () => act.confirmDraft(),
    'review-in-pane': () => act.reviewInPane(),
    'read-page': () => act.readPage(),
    'codex-check': () => act.checkCodex(),
    'ask-switch-on': () => act.askBeforeSwitch(true),
    'ask-switch-off': () => act.askBeforeSwitch(false),
    'web-open': () => act.openWeb(),
    'web-on-start': () => act.webOnStart(true),
    'web-not-on-start': () => act.webOnStart(false),
    'tailnet-on': () => act.tailnet(true),
    'tailnet-off': () => act.tailnet(false),
    'pair-device': () => act.pairDevice(),
  }
  const run = simple[key]
  if (run !== undefined) return did(run())
  const approve = id('approve-')
  if (approve !== undefined) return did(act.approve(approve))
  const reject = id('reject-')
  if (reject !== undefined) return did(act.reject(reject))
  const design = id('view-')
  if (design !== undefined) return did(act.viewDesign(design))
  const moded = key.match(/^mode-(\w+)-(auto|fixed)$/)
  const modeRole = role(moded?.[1])
  if (moded !== null && modeRole !== undefined) return did(act.roleMode(modeRole, moded[2] as RoleModels['mode']))
  const fixedOn = key.match(/^fixed-(\w+)-(claude|codex)$/)
  const fixedOnRole = role(fixedOn?.[1])
  if (fixedOn !== null && fixedOnRole !== undefined) return did(act.roleFixed(fixedOnRole, { engine: fixedOn[2] as Engine }))
  const defaulted = key.match(/^engine-(\w+)-(claude|codex)$/)
  const defaultRole = role(defaulted?.[1])
  if (defaulted !== null && defaultRole !== undefined) return did(act.roleEngine(defaultRole, defaulted[2] as Engine))
  const unpaired = id('unpair-')
  if (unpaired !== undefined && snap.web?.tailnet?.devices.some(d => d.id === unpaired) === true) return did(act.unpairDevice(unpaired))
  const answered = key.match(/^model-(yes|no)-(.+)$/)
  if (answered !== null && snap.modelAsks?.some(a => a.id === answered[2]) === true) return did(act.modelAnswer(answered[2] ?? '', answered[1] === 'yes'))
  const rotated = role(id('rotate-'))
  if (rotated !== undefined) return did(act.rotate(rotated))
  const opened = role(id('ask-'))
  if (opened !== undefined) return did(act.openAsk(view.asking === opened ? null : opened))
  const detailed = role(id('detail-'))
  if (detailed !== undefined) return did(act.openDetail(view.detail === detailed ? null : detailed))
  const option = id('prd-option-')
  const prd = option === undefined ? undefined : snap.start?.prds[Number(option)]
  if (prd !== undefined) return did(act.pick(prd.path))
  // A question's option answers with its words, as the decision on screen lists them.
  const picked = key.match(/^option-(.+)-(\d)$/)
  const chosen = picked === null ? undefined : snap.decisions.find(d => d.id === picked[1] && d.kind === undefined)?.options?.[Number(picked[2])]
  if (picked !== null && chosen !== undefined) return did(act.answer(picked[1] ?? '', chosen))
  return false
}

const TABS: readonly [CrewTab, string][] = [
  ['overview', '總覽'],
  ['progress', '進度'],
  ['board', '看板'],
  ['threads', '討論'],
  ['memory', '記憶'],
  ['tokens', 'Token'],
  ['models', '模型'],
  ['settings', '設定'],
]

/** Where crew keeps its board, unless an earlier version's board is already at the repo's root. */
export const BOARD_FILE = '.crew/prd-tracker.json'

const SCENARIOS: readonly [CrewScenario, string][] = [
  ['normal', '一般'],
  ['empty', '剛開始'],
  ['attention', '需要注意'],
  ['restart', '剛重開'],
  ['leading', '大腦接手'],
  ['drafting', 'PRD 草稿審查中'],
  ['confirm', 'PRD 草稿待確認'],
  ['codex', 'Codex 沒登入'],
  ['quota', 'Codex 額度用完'],
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

/** The percentage done, each item weighed by its size where the board says it. */
const percentOf = (p: Progress): number => (p.weighted === undefined ? percent(p.done, p.total) : percent(p.weighted.done, p.weighted.total))

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
          {p.weighted === undefined ? '' : '依難易度加權 · '}
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
      <Box flexDirection="column">
        {ProgressSummary({ el, p })}
        {p.weighted !== undefined && (
          <Box flexDirection="column">
            <Text dimColor>加權：每一項照它的難易度算，易 1・中 2・難 4・極難 8；Tech lead 還沒評的算中。</Text>
            <Text dimColor>難易度看難不難，不看範圍大小：Tech lead 拆單時評，寫一句理由，</Text>
            <Text dimColor>例如哪裡不確定、碰不碰金流或權限、跨幾個模組、有沒有現成做法、好不好測。</Text>
            <Text dimColor>測試失敗 2 次、review 被退回 2 次、PM 和 QA 來回超過 6 次、</Text>
            <Text dimColor>用掉的 token 超過同級平均 2 倍，各往上調一級。做完的照最後的難易度算，</Text>
            <Text dimColor>
              所以調高時百分比可能往下掉。不加權是 {p.done}/{p.total} 項。
            </Text>
            {p.rated !== undefined &&
              p.rated.map(r => (
                <Text color="warning">
                  最近調整：{r.id} {TIER_NAMES[r.from]} → {TIER_NAMES[r.to]}：{r.why} · 進度 {r.before}% → {r.after}%
                </Text>
              ))}
          </Box>
        )}
      </Box>
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
                  ['26%', bar(f.percent, 16), { color: f.percent === 100 ? 'success' : 'suggestion', wrap: 'truncate-end' }],
                  ['8%', `${f.percent}%`],
                  ['40%', layers(f), { dimColor: true }],
                ],
              }),
        )}
      </Box>
      <Box flexDirection="column">
        <Text bold>每天完成</Text>
        {p.daily.map(d => Row({ el, cells: [['10%', d.day, { dimColor: true }], ['50%', bar((d.done / most) * 100, 14), { wrap: 'truncate-end' }], ['40%', `${d.done} 項`]] }))}
      </Box>
      <Box flexDirection="column">
        <Text bold>最近完成</Text>
        {p.recent.map(r => Row({ el, cells: [['14%', r.id], ['46%', r.title], ['20%', ROLE_NAMES[r.role], { dimColor: true }], ['20%', r.age, { dimColor: true }]] }))}
      </Box>
    </Box>
  )
}

/** What a gate checks, who fills and confirms it, how much is covered, and each gap. */
function GateDetail({ el, g, act, board }: { el: Elements; g: Gate; act: Actions; board: string }) {
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
      <Text dimColor>上次檢查：{g.checked} · 程式計算，比對 {board}，不花 token</Text>
    </Box>
  )
}

/** A route in a table cell: a Codex model without its generation, `XL Sol・xhigh`; the whole name is in 設定. */
const route = (r: Route | undefined): string => (r === undefined ? '—' : `${TIER_NAMES[r.tier]} ${r.engine === 'codex' ? codexLabel(r.model, true) : r.model}・${r.effort}`)

/**
 * One table row: each cell a width and a text, and what follows the cells (a
 * row's buttons). A text longer than its cell wraps, the row as tall as its
 * longest cell: nothing a table shows is cut. A bar, drawn to a width, says
 * `wrap: 'truncate-end'`.
 */
function Row({ el, cells, tail }: { el: Elements; cells: readonly [string, string, Record<string, unknown>?][]; tail?: unknown }) {
  const { Box, Text } = el
  return (
    <Box flexDirection="row">
      {cells.map(([width, text, props]) => (
        <Box width={width}>
          <Text wrap="wrap" {...(props ?? {})}>
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
  // While the brain has taken over, its draft or its wait comes first: a board from an earlier PRD is history.
  const draft = snap.takeover?.on === true ? snap.takeover.draft : undefined
  const prd =
    draft !== undefined
      ? `大腦接手中 · PRD 草稿 ${draft.title}`
      : waitsForWord(snap)
        ? '大腦接手中 · 還沒有 PRD'
        : snap.prd !== null
          ? `${snap.prd.id} ${snap.prd.title} · 進度 ${snap.prd.progress}% · 今日 ${tokens(snap.today)} tok${snap.codexToday === undefined ? '' : ` · Codex ${tokens(snap.codexToday)}`}`
          : '還沒有 PRD'
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
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
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
  const digest = r.digest === undefined ? '' : ` · 大腦摘要 ${r.digest.sent === undefined ? '還沒有送出' : `${r.digest.sent} 送出`}，${r.digest.queued} 則等 ${r.digest.next}`
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
      {snap.takeover?.on === true && (snap.takeover.draft !== undefined || snap.takeover.idle === true) && TakeoverScreen({ el, snap, act })}
      {snap.progress !== null && !waitsForWord(snap) && ProgressSummary({ el, p: snap.progress })}
      {snap.boardProblem?.prd !== undefined && (
        <Text color="warning">
          ⚠ crew 停在 {snap.boardProblem.prd}：{snap.boardProblem.text}
        </Text>
      )}
      {snap.prd === null && snap.boardProblem?.prd === undefined && StartScreen({ el, snap, act })}
      {snap.modelAsks !== undefined && snap.modelAsks.length > 0 && ModelAsks({ el, asks: snap.modelAsks, act })}
      <Box flexDirection="column">
        {Row({ el, cells: [['11%', '角色', { dimColor: true }], ['9%', '狀態', { dimColor: true }], ['25%', '正在做', { dimColor: true }], ['20%', '模型', { dimColor: true }], ['11%', 'context', { dimColor: true }], ['8%', '今日', { dimColor: true }]] })}
        {snap.roles.map(r => (
          <Box flexDirection="column">
            {Row({ el, cells: [
                ['11%', ROLE_NAMES[r.id]],
                ['9%', ROLE_STATE_NAMES[r.state], { color: STATE_COLORS[r.state] }],
                ['25%', r.doing],
                ['20%', route(r.route), { dimColor: r.route === undefined }],
                // Codex tells no context size: its thread's is not crew's to count.
                r.engine === 'codex' ? ['11%', '—', { dimColor: true }] : ['11%', `${tokens(r.context)}/${tokens(r.limit)}`, { color: r.context / r.limit > 0.85 ? 'warning' : undefined }],
                ['8%', tokens(r.today)],
              ], tail: (
                <Box flexDirection="row" gap={1}>
                  {(r.task !== undefined || r.report !== undefined) && (
                    <Button key={`detail-${r.id}`} label="詳情" variant={view.detail === r.id ? 'primary' : 'secondary'} onPress={() => act.openDetail(view.detail === r.id ? null : r.id)} />
                  )}
                  {snap.prd !== null && <Button key={`ask-${r.id}`} label="問" onPress={() => act.openAsk(view.asking === r.id ? null : r.id)} />}
                  {snap.prd !== null && <Button key={`rotate-${r.id}`} label="輪替" onPress={() => act.rotate(r.id)} />}
                </Box>
              ) })}
            {view.detail === r.id && RoleDetail({ el, r })}
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
          {openGate !== undefined && GateDetail({ el, g: openGate, act, board: snap.boardFile?.path ?? BOARD_FILE })}
        </Box>
      )}
      {snap.alerts.length > 0 && Alerts({ el, alerts: snap.alerts })}
      {snap.decisions.length > 0 && (
        <Box flexDirection="column">
          <Text color="warning">待你決定（{waitingCount(snap)}）</Text>
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

/** A role's work and last report in full, under its row: the table shows the work's first line. */
function RoleDetail({ el, r }: { el: Elements; r: RoleRow }) {
  const { Box, Text } = el
  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Text dimColor>{r.state === 'working' ? '這次的工作' : '上次的工作'}</Text>
      <Text>{r.task ?? '—'}</Text>
      {r.report !== undefined && r.report !== '' && <Text dimColor>上次回報</Text>}
      {r.report !== undefined && r.report !== '' && <Text>{r.report}</Text>}
    </Box>
  )
}

/** How many things wait for the person: a row for the decide page counts each it holds. */
const waitingCount = (snap: Snapshot): number => snap.decisions.reduce((n, d) => n + (d.count ?? 1), 0)

/** One thing that waits for the person, with what settles it: an answer, a press, or a reason to send a design back. */
function DecisionRow({ el, d, act }: { el: Elements; d: Decision; act: Actions }) {
  const { Box, Text, Button } = el
  const who = d.from === 'crew' ? 'crew' : d.from === 'brain' ? '大腦' : ROLE_NAMES[d.from]
  // A question with buttons has them on a row of their own, so a long question wraps across the pane and not beside them.
  // The review row is one line for many designs: its question says what it is, with no number of its own.
  const head = <Text>{d.kind === 'review' ? d.question : `${d.id} ${d.question}`}</Text>
  return (
    <Box flexDirection="column">
      {d.kind !== undefined && head}
      <Box flexDirection="row" gap={1}>
        {d.kind === undefined && head}
        <Text dimColor>
          {who} · {d.age}
        </Text>
        {d.kind === 'design' && d.design !== undefined && <Button key={`view-${d.design}`} label="看設計稿" onPress={() => act.viewDesign(d.design ?? null)} />}
        {(d.kind === 'review' || d.kind === 'design') && d.url !== undefined && ReviewLink({ el, url: d.url })}
        {d.kind === 'review' && d.url !== undefined && <Button key="read-page" label="我在頁面上決定好了" onPress={() => act.readPage()} />}
        {d.kind === 'review' && d.inPane === true && <Button key="review-in-pane" label="改在面板決定" onPress={() => act.reviewInPane()} />}
        {(d.kind === 'design' || d.kind === 'proposal') && <Button key={`approve-${d.id}`} label="核准" variant="primary" onPress={() => act.approve(d.id)} />}
        {d.kind === 'proposal' && <Button key={`reject-${d.id}`} label="不要" onPress={() => act.reject(d.id)} />}
      </Box>
      {d.kind === undefined && d.options !== undefined && (
        <Box flexDirection="column">
          {d.options.map((o, i) => (
            <Button key={`option-${d.id}-${i}`} label={`${'ABCD'.charAt(i)} ${o}`} onPress={() => act.answer(d.id, o)} />
          ))}
        </Box>
      )}
      {d.kind === undefined && Field({ el, id: `answer-${d.id}`, label: '回答', placeholder: d.options === undefined ? '你的回答' : '或自己寫', submit: '送出', what: '回答', onSubmit: text => act.answer(d.id, text) })}
      {d.kind === 'design' && Field({ el, id: `reject-${d.id}`, label: '退回原因', placeholder: '要改什麼', submit: '退回', what: '退回原因', onSubmit: text => act.reject(d.id, text) })}
    </Box>
  )
}

/** The decide page's link: a link where the surface draws one, else the address to open. */
function ReviewLink({ el, url }: { el: Elements; url: string }) {
  const { Text, Link } = el
  return <Text key="review-url">{Link === undefined ? `開待你決定頁：${url}` : <Link href={url} label="［開待你決定頁 ↗］" />}</Text>
}

/**
 * The repo's PRDs to pick from, and the one a start begins: a picker where the
 * surface has one, a button for each where it has none (a phone).
 */
function PrdPicker({ el, snap, act, id, label }: { el: Elements; snap: Snapshot; act: Actions; id: string; label: string }) {
  const { Box, Text, Button, Select } = el
  const prds = snap.start?.prds ?? []
  const chosen = prds.find(p => p.path === snap.start?.chosen) ?? prds[0]
  if (chosen === undefined) return null
  return (
    <Box flexDirection="column">
      {Select !== undefined ? (
        <Select key={id} label={label} value={chosen.path} options={prds.map(p => ({ value: p.path, label: `${p.path}　${p.title}` }))} onSelect={(path: string) => act.pick(path)} />
      ) : (
        prds.map((p, i) => <Button key={`prd-option-${i}`} label={`${p.path}　${p.title}`} variant={p.path === chosen.path ? 'primary' : 'secondary'} onPress={() => act.pick(p.path)} />)
      )}
      <Text dimColor>
        會開始：{chosen.path}　{chosen.title}
      </Text>
    </Box>
  )
}

/** The brain has taken over and no PRD is under way: it waits for the person's word. */
const waitsForWord = (snap: Snapshot): boolean => snap.takeover?.on === true && snap.takeover.idle === true

/** The brain's word on a draft: whether each role it asked has reviewed it, and what it found. */
const reviewsLine = (d: NonNullable<Takeover['draft']>): string => d.reviews.map(r => `${ROLE_NAMES[r.role]} ${reviewMark(r)}${reviewWord(r)}`).join(' · ')

/** The brain that took this repo over: what to say to it, or the PRD it drafted with the person and where that stands. */
function TakeoverScreen({ el, snap, act }: { el: Elements; snap: Snapshot; act: Actions }) {
  const { Box, Text, Button } = el
  const draft = snap.takeover?.draft
  if (draft === undefined) {
    return (
      <Box flexDirection="column">
        <Text bold>大腦接手中：在主對話說你要做什麼。</Text>
        <Text dimColor>功能等級的工作，大腦會先和你寫 PRD，請 PM、UI/UX 審過，你確認後才分派。修 bug、改文案這類小事，大腦直接處理，不建 PRD。</Text>
      </Box>
    )
  }
  const settled = pendingOf(draft).length === 0
  return (
    <Box flexDirection="column">
      <Text bold color={draft.stage === 'confirm' ? 'suggestion' : undefined}>
        {draft.stage === 'confirm' ? 'PRD 草稿等你確認' : 'PRD 草稿'}：{draft.path}　{draft.title}（{draft.requirements} 條需求）
      </Text>
      <Text>審查：{reviewsLine(draft)}</Text>
      {draft.stage === 'confirm' && draft.note !== undefined && <Text>大腦：{draft.note}</Text>}
      {draft.url !== undefined && ReviewLink({ el, url: draft.url })}
      {draft.stage === 'confirm' && draft.change !== undefined ? (
        <Text>你要改：{draft.change}（大腦修改中，改好會再請你確認）</Text>
      ) : draft.stage === 'confirm' ? (
        <Box flexDirection="row" gap={1}>
          <Button key="confirm-draft" label="確認，開始" variant="primary" onPress={() => act.confirmDraft()} />
          <Text dimColor>在主對話回覆大腦也可以。開始後 PM 先把它拆成功能和驗收條件。</Text>
        </Box>
      ) : settled && failedOf(draft).length > 0 ? (
        <Text color="warning">{sentOut(draft) ? `有審查沒有完成，已經送審 ${MAX_SENDS} 次：在主對話告訴大腦要不要照現在的草稿確認。` : '有審查沒有完成：在主對話請大腦重新送審。'}</Text>
      ) : settled ? (
        <Text dimColor>審完了，大腦會整理缺口，在主對話問你；重開過 Claude Code 的話，在主對話請大腦接著做。</Text>
      ) : (
        <Text dimColor>審完後，大腦會整理缺口，在主對話問你。</Text>
      )}
    </Box>
  )
}

/** What crew offers when it loads with no PRD: the brain to take over, one picked from the repo or typed, or not now. */
function StartScreen({ el, snap, act }: { el: Elements; snap: Snapshot; act: Actions }) {
  const { Box, Text, Button } = el
  const takenOver = snap.takeover?.on === true
  const drafting = takenOver && snap.takeover?.draft !== undefined
  // A question asked with no PRD under way still has a role at work.
  const working = snap.roles.filter(r => r.state === 'working').map(r => ROLE_NAMES[r.id])
  return (
    <Box flexDirection="column" gap={1}>
      {!takenOver && <Text bold>crew 已載入，還沒有開始的 PRD。</Text>}
      {snap.boardProblem !== undefined && <Text color="warning">⚠ {snap.boardProblem.text}</Text>}
      {snap.takeover?.on === false && (
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Button key="takeover-on" label="讓大腦接手這個 repo" variant="primary" onPress={() => act.takeover(true)} />
          </Box>
          <Text dimColor>之後在這個 repo 開 session，大腦會從你的第一句話開始主導：和你寫 PRD、分派給角色、小事直接處理。其他 repo 不受影響。</Text>
        </Box>
      )}
      {takenOver && !drafting && <Text dimColor>已經有寫好的 PRD，也可以直接選：</Text>}
      {snap.takeover?.on === false && <Text dimColor>或自己選 PRD 開始：</Text>}
      {!drafting && (
        <Box flexDirection="column" gap={1}>
          {PrdPicker({ el, snap, act, id: 'prd-pick', label: 'PRD 檔案' })}
          {Field({ el, id: 'prd-path', label: '或輸入路徑', placeholder: 'docs/PRD.md', submit: '開始', what: 'PRD 路徑', onSubmit: path => act.start(path) })}
          <Box flexDirection="row" gap={1}>
            <Button key="start" label="開始" variant={takenOver ? 'secondary' : 'primary'} onPress={() => act.start()} />
            {!takenOver && <Button key="not-now" label="這次不用" onPress={() => act.notNow()} />}
          </Box>
          <Text dimColor>
            PM 會先把 PRD 拆成功能和驗收條件。
            {working.length === 0 ? '五個角色都在待命，沒有工作時不花 token。' : `${working.join('、')} 正在工作，其他角色待命，沒有工作時不花 token。`}
          </Text>
        </Box>
      )}
    </Box>
  )
}

/** Codex as crew last found it: what the line says, and its color. */
const codexLine = (codex: Engines['codex']): [string, string] => {
  if (codex.state === 'ready' && codex.limited !== undefined) return [`Codex ⚠ 額度用完，${codex.limited} · 已登入（${codex.login === 'chatgpt' ? 'ChatGPT 帳號' : 'API key'}）`, 'warning']
  if (codex.state === 'ready') return [`Codex ✓ 已登入（${codex.login === 'chatgpt' ? 'ChatGPT 帳號' : 'API key'}）· codex-cli ${codex.version} · ${codex.checked}檢查`, 'success']
  if (codex.state === 'logged-out') return [`Codex ✗ 還沒登入 · codex-cli ${codex.version} · ${codex.checked}檢查`, 'warning']
  return [`Codex ✗ 這台電腦找不到 codex 指令 · ${codex.checked}檢查`, 'warning']
}

/** Whether Codex can take work now: found, logged in, with quota left. */
const codexOpen = (codex: Engines['codex']): boolean => codex.state === 'ready' && codex.limited === undefined

/** A model's name as the pane says it, on its engine. */
const modelName = (engine: Engine, model: string): string => (engine === 'claude' ? labelOf(model) : codexLabel(model))

/** The rotation thresholds a person may fix a role at; `tier` follows how hard the work is, and the brain may tune it. */
const LIMITS = ['tier', '60000', '100000', '160000', '200000', '256000'] as const

/**
 * Two picks, a model and an effort, on one engine: a role's floor there, or
 * the model it is fixed on. A floor on Claude is the newest of each family; a
 * fixed one, any generation still served, each with the efforts it takes.
 */
function Picks({ el, role, engine, pick, prefix, label, models, fixed, act }: { el: Elements; role: RoleId; engine: Engine; pick: Pick; prefix: string; label: string; models: readonly string[]; fixed: boolean; act: (change: Partial<Pick>) => void | Promise<void> }) {
  const { Box, Text, Select } = el
  const choices = engine === 'claude' ? { models: fixed ? CLAUDE_FIXED_MODELS : (CLAUDE_MODELS as readonly string[]), efforts: fixed ? claudeEfforts(pick.model) : CLAUDE_EFFORTS } : { models: codexChoices(role).models.filter(m => models.includes(m)), efforts: codexChoices(role).efforts }
  const effort = engine === 'claude' ? (fitEffort(pick.model, pick.effort) ?? pick.effort) : pick.effort
  if (Select === undefined) return <Text>{label} {pickSaid(engine, pick)}</Text>
  return (
    <Box flexDirection="row" gap={1}>
      <Select key={`${prefix}-model`} label={label} value={pick.model} options={choices.models.map(m => ({ value: m, label: modelName(engine, m) }))} onSelect={(m: string) => act({ model: m })} />
      {choices.efforts.length === 0 ? (
        <Text dimColor>這個模型沒有 effort</Text>
      ) : (
        <Select key={`${prefix}-effort`} label="effort" value={effort} options={choices.efforts.map(e => ({ value: e, label: e }))} onSelect={(e: string) => act({ effort: e })} />
      )}
    </Box>
  )
}

/** What a role fixed on Codex waits for while Codex cannot take it, as the heartbeat says it: what comes back by itself, and what is the person's. */
const codexWait = (codex: Engines['codex']): string =>
  codex.state === 'missing' ? '這台電腦找不到 codex 指令，裝好之後按上面的［重新檢查］' : codex.state === 'logged-out' ? 'Codex 還沒登入，登入後 crew 會自己接續一次' : `Codex 額度用完（${codex.limited ?? ''}），時間到了 crew 會自己接續一次`

/** What a role is on now, in a few words: its engine, and who picked it; and what it waits for, when it does. */
const nowWords = (r: RoleModels, engines: Engines, ask: ModelAsk | undefined, blocked: boolean): [string, string | undefined] => {
  const codex = engines.codex
  // Where to decide: the question on its model when crew asked one, else Codex's own check above.
  if (r.mode === 'fixed' && r.fixed.engine === 'codex' && !codexOpen(codex)) return [ask !== undefined ? '停著：Codex 現在不能用，在「模型的事」決定' : `停著：${codexWait(codex)}`, 'warning']
  if (r.mode === 'fixed') return [`現在 ${ENGINE_NAMES[r.fixed.engine]}：你選的`, undefined]
  // Crew's question holds the role's work; the brain's leaves it at work meanwhile.
  if (ask !== undefined && ask.from === 'crew') return [`停著：等你在「模型的事」決定（${ask.id}）`, 'warning']
  // No why: nobody picked, the role is on crew's default.
  const now = `現在 ${ENGINE_NAMES[r.now]}：${r.why !== undefined ? `大腦選的，${r.why}` : r.chose === 'codex' && r.now === 'codex' ? '你選的' : '系統預設'}`
  if (ask !== undefined) return [`${now}；大腦想換，在「模型的事」決定（${ask.id}）`, undefined]
  // Told to wait for Codex, the role is stopped till it comes back.
  if (r.now === 'codex' && !codexOpen(codex) && blocked) return [`停著：${codexWait(codex)}`, 'warning']
  // On Codex by the person's own pick, Claude takes a piece only; by the brain's, the role goes back.
  if (r.now === 'codex' && !codexOpen(codex)) return [`${now}；Codex 現在不能用，下一件${engines.askBeforeSwitch ? '會先問你要不要改用 Claude' : r.why === undefined ? '會改用 Claude' : '會改回 Claude'}`, 'warning']
  return [now, undefined]
}

/** One role's models: how it picks them, each engine's floor and the steps from it, or the one it is fixed on; and its rotation threshold. */
function RoleModelsRow({ el, role, r, engines, ask, blocked, act }: { el: Elements; role: RoleId; r: RoleModels; engines: Engines; ask: ModelAsk | undefined; blocked: boolean; act: Actions }) {
  const { Box, Text, Button, Select } = el
  const [now, color] = nowWords(r, engines, ask, blocked)
  const limitValue = r.limit === 'tier' ? 'tier' : String(r.limit)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Box width="11%" flexShrink={0}>
          <Text>{ROLE_NAMES[role]}</Text>
        </Box>
        <Button key={`mode-${role}-auto`} label="系統預設" variant={r.mode === 'auto' ? 'primary' : 'secondary'} onPress={() => act.roleMode(role, 'auto')} />
        <Button key={`mode-${role}-fixed`} label="自己挑選" variant={r.mode === 'fixed' ? 'primary' : 'secondary'} onPress={() => act.roleMode(role, 'fixed')} />
        <Text dimColor={color === undefined} color={color}>
          {now}
        </Text>
      </Box>
      <Box flexDirection="row">
        <Box width="11%" flexShrink={0} />
        <Box flexDirection="column">
          {r.mode === 'auto' && (
            <Box flexDirection="row" gap={1}>
              <Text>預設引擎:</Text>
              <Button key={`engine-${role}-claude`} label="Claude" variant={(r.chose ?? 'claude') === 'claude' ? 'primary' : 'secondary'} onPress={() => act.roleEngine(role, 'claude')} />
              <Button key={`engine-${role}-codex`} label="Codex" variant={r.chose === 'codex' ? 'primary' : 'secondary'} onPress={() => act.roleEngine(role, 'codex')} />
            </Box>
          )}
          {r.mode === 'auto' &&
            (['claude', 'codex'] as const).map(engine => (
              <Box flexDirection="column">
                {Picks({ el, role, engine, pick: r.floors[engine], prefix: `floor-${role}-${engine}`, label: `${ENGINE_NAMES[engine]} 下限`, models: engines.models, fixed: false, act: pick => act.roleFloor(role, engine, pick) })}
                <Text dimColor>
                  {'  '}
                  {ladderOf(role, engine, r.floors[engine])}
                </Text>
              </Box>
            ))}
          {r.mode === 'fixed' && (
            <Box flexDirection="column">
              <Box flexDirection="row" gap={1}>
                <Text>引擎</Text>
                {(['claude', 'codex'] as const).map(e =>
                  // Codex not on this machine cannot be picked: a role fixed on it would only stop.
                  e === 'codex' && engines.codex.state === 'missing' && r.fixed.engine !== 'codex' ? (
                    <Text key={`fixed-${role}-${e}`} dimColor>
                      Codex（這台電腦找不到）
                    </Text>
                  ) : (
                    <Button key={`fixed-${role}-${e}`} label={ENGINE_NAMES[e]} variant={r.fixed.engine === e ? 'primary' : 'secondary'} onPress={() => act.roleFixed(role, { engine: e })} />
                  ),
                )}
              </Box>
              {Picks({ el, role, engine: r.fixed.engine, pick: r.fixed, prefix: `fixed-${role}`, label: '模型', models: engines.models, fixed: true, act: change => act.roleFixed(role, change) })}
              <Text dimColor>
                {'  '}固定用 {pickSaid(r.fixed.engine, r.fixed)}：不升級，大腦也不換；一直失敗時 crew 會問你
              </Text>
            </Box>
          )}
          <Box flexDirection="row" gap={1}>
            {Select !== undefined ? (
              <Select key={`limit-${role}`} label="輪替門檻" value={limitValue} options={LIMITS.map(v => ({ value: v, label: v === 'tier' ? '依難易度' : `${Number(v) / 1000}K` }))} onSelect={(v: string) => act.roleLimit(role, v === 'tier' ? 'tier' : Number(v))} />
            ) : (
              <Text>輪替門檻 {r.limit === 'tier' ? '依難易度' : `${r.limit / 1000}K`}</Text>
            )}
            {r.limit === 'tier' && <Text dimColor>{r.tuned === undefined ? limitsByTier() : `大腦調成 ${r.tuned.limit / 1000}K（${r.tuned.by}）`}</Text>}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

/** The questions on a role's model, apart from what else waits for the person: each with its two answers. */
function ModelAsks({ el, asks, act, hints = true }: { el: Elements; asks: readonly ModelAsk[]; act: Actions; hints?: boolean }) {
  const { Box, Text, Button } = el
  return (
    <Box flexDirection="column">
      <Text color="warning" bold>
        模型的事（{asks.length}）
      </Text>
      {asks.map(a => (
        <Box flexDirection="column">
          <Text>
            {a.id} {a.text}
          </Text>
          <Box flexDirection="row" gap={1}>
            <Text dimColor>
              {a.from === 'brain' ? '大腦' : 'crew'} · {a.age}
            </Text>
            <Button key={`model-yes-${a.id}`} label={a.yes} variant="primary" onPress={() => act.modelAnswer(a.id, true)} />
            <Button key={`model-no-${a.id}`} label={a.no} onPress={() => act.modelAnswer(a.id, false)} />
          </Box>
          {hints && a.kind === 'login' && <Text dimColor>在你自己的終端機執行 codex login，登入後 crew 會自己發現，不用重開。</Text>}
        </Box>
      ))}
    </Box>
  )
}

/** Each role's models, Codex as crew last found it, and whether the brain asks before it moves a role to another model. */
function ModelsTab({ el, snap, act }: { el: Elements; snap: Snapshot; act: Actions }) {
  const { Box, Text, Button } = el
  const engines = snap.engines
  if (engines === undefined) return <Text dimColor>crew 還沒讀到角色的模型設定。</Text>
  const [line, color] = codexLine(engines.codex)
  const least = Object.keys(CODEX_MINIMUM).map(r => ROLE_NAMES[r as RoleId]).join(' 和 ')
  return (
    <Box flexDirection="column" gap={1}>
      {snap.modelAsks !== undefined && snap.modelAsks.length > 0 && ModelAsks({ el, asks: snap.modelAsks, act, hints: false })}
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text color={color}>{line}</Text>
          <Button key="codex-check" label="重新檢查" onPress={() => act.checkCodex()} />
        </Box>
        {engines.codex.state === 'logged-out' && (
          <Box flexDirection="column">
            <Text dimColor>在你自己的終端機執行 codex login，用 ChatGPT 帳號登入；</Text>
            <Text dimColor>用 API key 就執行 codex login --with-api-key。key 只交給 Codex，不要貼進對話。</Text>
          </Box>
        )}
        {engines.codex.state === 'missing' && <Text dimColor>在終端機執行 npm install -g @openai/codex 安裝並登入。</Text>}
        <Text dimColor>登入或額度恢復後，crew 會自己發現，不用重開 Claude Code。</Text>
      </Box>
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text>大腦換模型前</Text>
          <Button key="ask-switch-on" label="先問你" variant={engines.askBeforeSwitch ? 'primary' : 'secondary'} onPress={() => act.askBeforeSwitch(true)} />
          <Button key="ask-switch-off" label="不用問" variant={engines.askBeforeSwitch ? 'secondary' : 'primary'} onPress={() => act.askBeforeSwitch(false)} />
        </Box>
        {engines.askBeforeSwitch ? (
          <Box flexDirection="column">
            <Text dimColor>換引擎、模型或 effort，Claude 和 Codex 都先在「模型的事」問你：</Text>
            <Text dimColor>依難易度往上升、失敗後升級、Codex 不能用時改用 Claude，都算。</Text>
            <Text dimColor>等你回答的時候，那個角色停著。</Text>
          </Box>
        ) : (
          <Text dimColor>不用問：大腦自己換引擎、模型或 effort，事後記成決定。</Text>
        )}
        <Text dimColor>自己挑選的角色不會被換；它卡住時，不管開關都會問你。</Text>
      </Box>
      <Box flexDirection="column" gap={1}>
        {ROLE_IDS.map(r =>
          RoleModelsRow({
            el,
            role: r,
            r: engines.roles[r],
            engines,
            // Crew's question, which holds the role's work, before the brain's.
            ask: snap.modelAsks?.find(a => a.role === r && a.from === 'crew') ?? snap.modelAsks?.find(a => a.role === r),
            // Stopped because the person said to wait for Codex, not for another reason.
            blocked: snap.roles.some(x => x.id === r && x.state === 'blocked' && x.doing.startsWith(CODEX_WAIT)),
            act,
          }),
        )}
      </Box>
      {/* Each line short enough for the pane: the terminal wraps only at spaces, and a long run of Chinese breaks early. */}
      <Box flexDirection="column">
        <Text dimColor>系統預設：用你設的預設引擎，大腦可以提議換；每件工作從下限開始，越難往右一格，</Text>
        <Text dimColor>失敗兩次再往右一格。自己挑選：固定用你選的模型。</Text>
        <Text dimColor>換了以後，角色從下一件工作開始用；正在做的這一輪照舊。</Text>
        <Text dimColor>6.1 Sol：寫程式和 review 的主力。6 Astra：最強也最貴，留給失敗過的難題。</Text>
        <Text dimColor>6.1 Terra：快，擅長寫規格、文案和看畫面。6 Luna：最省，只適合抽取和分類。</Text>
        <Text dimColor>{least}在 Codex 上至少 6.1 Sol・xhigh。</Text>
        <Text dimColor>輪替門檻依難易度時，大腦可以調；你固定了，大腦就不動。</Text>
        <Text dimColor>輪替門檻不會超過模型的 context：6.1 Sol、6.1 Terra 500K，6 Astra、6 Luna 272K。</Text>
        <Text dimColor>權限跟 Claude 一樣：PM、QA、UI/UX、Tech lead 只讀 repo；</Text>
        <Text dimColor>全端只在 crew 的工作目錄改檔，可以跑指令、上網裝套件。</Text>
        <Text dimColor>Codex 做到一半不能停下來問你，所以由沙箱守住這條線，</Text>
        <Text dimColor>蓋過你 Codex 設定裡的 danger-full-access。</Text>
        <Text dimColor>Codex 用你在這台電腦的登入，額度另外算，crew 不經手金鑰。</Text>
      </Box>
    </Box>
  )
}

/** The phone's way in: the web page on the person's tailnet, through `tailscale serve`, and the devices paired with it. */
function TailnetSection({ el, tailnet, act }: { el: Elements; tailnet: NonNullable<NonNullable<Snapshot['web']>['tailnet']>; act: Actions }) {
  const { Box, Text, Button } = el
  const open = tailnet.state === 'on'
  const STATES = {
    on: [`Tailscale ✓ 已連上 · 這台電腦 ${tailnet.machine ?? ''}`, 'success'],
    off: [`Tailscale ✓ 已連上 · 這台電腦 ${tailnet.machine ?? ''} · 還沒開放給手機`, undefined],
    stopped: ['Tailscale ✗ 沒在執行：打開 Tailscale app 並登入', 'warning'],
    missing: ['Tailscale ✗ 這台電腦沒有裝 Tailscale', 'warning'],
  } as const
  const [line, color] = STATES[tailnet.state]
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text>手機</Text>
        <Button key="tailnet-on" label="用 Tailscale 開放" variant={open ? 'primary' : 'secondary'} onPress={() => act.tailnet(true)} />
        <Button key="tailnet-off" label="只限這台電腦" variant={open ? 'secondary' : 'primary'} onPress={() => act.tailnet(false)} />
      </Box>
      <Text color={color}>{line}</Text>
      {open && tailnet.url !== undefined && (
        <Box flexDirection="row" gap={1}>
          <Text>{tailnet.url}</Text>
          <Button key="pair-device" label="配對新裝置" onPress={() => act.pairDevice()} />
        </Box>
      )}
      {open &&
        tailnet.devices.map(d => (
          <Box flexDirection="row" gap={1}>
            <Text>
              已配對：{d.name} · {d.paired}配對
            </Text>
            <Button key={`unpair-${d.id}`} label="移除" onPress={() => act.unpairDevice(d.id)} />
          </Box>
        ))}
      <Text dimColor>只有你 tailnet 裡、用你的帳號登入的裝置連得到。crew 用 tailscale serve，</Text>
      <Text dimColor>不用 funnel，不會公開到網路上。第一次在手機打開要輸入配對碼，之後這支手機就記住了。</Text>
      <Text dimColor>關掉 Claude Code，手機也連不到。</Text>
    </Box>
  )
}

/** Where the day's tokens went, and what costs the most over the days crew recorded, with what is done about each. */
function AuditSection({ el, audit }: { el: Elements; audit: Audit }) {
  const { Box, Text } = el
  const MARKS = { done: ['✓ 已處置', 'success'], acting: ['◐ 處置中', 'suggestion'], person: ['! 要你處理', 'warning'] } as const
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>去向（今天）</Text>
        {/* Four parts a line: the terminal wraps only at spaces, and would part a name from its number. */}
        {Array.from({ length: Math.ceil(audit.parts.length / 4) }, (_, i) => (
          <Text>{audit.parts.slice(i * 4, i * 4 + 4).map(p => `${p.part} ${tokens(p.tokens)}`).join(' · ')}</Text>
        ))}
        {audit.brain !== undefined && <Text dimColor>大腦每一輪：{audit.brain.map(p => `${p.part} ${tokens(p.tokens)}`).join(' · ')}</Text>}
      </Box>
      <Box flexDirection="column">
        <Text bold>
          瓶頸（{audit.since}，{audit.sessions} 個 session，依 token 排）
        </Text>
        {audit.bottlenecks.map((b, i) => (
          <Box flexDirection="column">
            <Text>
              {i + 1} {b.title}
            </Text>
            <Text dimColor>
              {'  '}
              {tokens(b.tokens)} · {b.share}
            </Text>
            <Text color={MARKS[b.state][1]}>
              {'  '}
              {MARKS[b.state][0]}：{b.fix}
            </Text>
          </Box>
        ))}
      </Box>
      <Box flexDirection="column">
        <Text dimColor>每一次執行都記在 .crew/usage/，不進 git，跨 session 留著：</Text>
        <Text dimColor>token、模型、工具和結果大小、技能、記憶、怎麼被叫起來。</Text>
        <Text dimColor>每件工作做完，crew 用程式重算一次瓶頸，不花 token。</Text>
        <Text dimColor>只有出現新的瓶頸，或處置過的又變大，才把那一條告訴大腦；</Text>
        <Text dimColor>每個 session 開始時，還沒處置完的再說一次。整份排行大腦和你隨時可以看。</Text>
        <Text dimColor>單次執行超標馬上提醒：工具結果超過 10K、context 超過門檻的 85%、快取命中率低於 60%。</Text>
        {audit.told !== undefined && <Text dimColor>上次告訴大腦：{audit.told}</Text>}
        <Text dimColor>處置照「大腦處置 token 用量」先問你或自動。</Text>
      </Box>
    </Box>
  )
}

/** Where crew is set up: the test command, how the brain acts on usage, the pane on load, the flow, the memory, the preview. */
function Settings({ el, snap, view, act, isDemo }: { el: Elements; snap: Snapshot; view: View; act: Actions; isDemo: boolean }) {
  const { Box, Text, Button } = el
  const tuning = snap.tuning ?? 'ask'
  const open = snap.settings?.openOnLoad ?? true
  const prds = snap.start?.prds ?? []
  return (
    <Box flexDirection="column" gap={1}>
      {snap.takeover !== undefined && (
        <Box flexDirection="column">
          <Text bold>大腦</Text>
          <Box flexDirection="row" gap={1}>
            <Button key="takeover-on" label="接手這個 repo" variant={snap.takeover.on ? 'primary' : 'secondary'} onPress={() => act.takeover(true)} />
            <Button key="takeover-off" label="不接手" variant={snap.takeover.on ? 'secondary' : 'primary'} onPress={() => act.takeover(false)} />
            <Text dimColor>現在：{snap.takeover.on ? '接手，這個 repo 每個 session 從第一句話起由大腦主導' : '不接手，你叫 crew 時它才做事'}</Text>
          </Box>
          <Text dimColor>只影響這個 repo。設定存在這台電腦，不進 git，所以別人的 repo 不能替你打開。</Text>
        </Box>
      )}
      {snap.prd !== null && prds.length > 0 && (
        <Box flexDirection="column">
          <Text bold>PRD</Text>
          {PrdPicker({ el, snap, act, id: 'prd-switch', label: '換一份' })}
          <Box flexDirection="row" gap={1}>
            <Button key="switch-prd" label="改跟這一份" onPress={() => act.start()} />
            <Text dimColor>看板會對準選的 PRD；流程還在進行時要先等這一輪做完。</Text>
          </Box>
        </Box>
      )}
      <Box flexDirection="column">
        <Text bold>看板</Text>
        <Text>檔案：{snap.boardFile?.path ?? BOARD_FILE}</Text>
        {snap.boardFile?.why !== undefined && <Text dimColor>{snap.boardFile.why}</Text>}
      </Box>
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
        <Text dimColor>瓶頸每件工作做完就重算，有新的才告訴大腦，沒有頻率要設。</Text>
        <Text dimColor>換模型另外由「模型」分頁的「大腦換模型前」管。</Text>
      </Box>
      {snap.web !== undefined && (
        <Box flexDirection="column">
          <Text bold>網頁</Text>
          <Box flexDirection="row" gap={1}>
            <Text>{snap.web.url}</Text>
            <Button key="web-open" label="在瀏覽器打開" onPress={() => act.openWeb()} />
          </Box>
          <Box flexDirection="row" gap={1}>
            <Text>crew 啟動時</Text>
            <Button key="web-on-start" label="自動打開" variant={snap.web.openOnStart ? 'primary' : 'secondary'} onPress={() => act.webOnStart(true)} />
            <Button key="web-not-on-start" label="不要" variant={snap.web.openOnStart ? 'secondary' : 'primary'} onPress={() => act.webOnStart(false)} />
          </Box>
          <Text dimColor>這個網址只有這台電腦打得開，帶一次性的鑰匙；關掉 Claude Code，網頁就停。</Text>
          <Text dimColor>在網頁上可以看全部內容、核准和回答，也可以直接跟大腦對話。</Text>
          {snap.web.tailnet !== undefined && TailnetSection({ el, tailnet: snap.web.tailnet, act })}
        </Box>
      )}
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
                {i.hard !== undefined && <Text dimColor>　　{TIER_NAMES[i.route.tier]}：{i.hard}</Text>}
                {i.note !== undefined && <Text dimColor>　　{i.note}</Text>}
              </Box>
            ))}
          </Box>
        )
      })}
      <Box flexDirection="column">
        <Text dimColor>模型和 context 門檻依項目的難易度：難易度看難不難，不看範圍大小，</Text>
        <Text dimColor>Tech lead 拆單時評，失敗、被退回就往上調。每個角色的模型在「模型」分頁。</Text>
      </Box>
    </Box>
  )
}

/** A thread's name: its item and the item's title, the id once where the title is the id (a question to a role). */
const titled = (t: { item: string; title: string }): string => (t.title === t.item ? t.item : `${t.item} ${t.title}`)

function Threads({ el, snap, view, act }: { el: Elements; snap: Snapshot; view: View; act: Actions }) {
  const { Box, Text, Button } = el
  if (snap.threads.length === 0) return <Text dimColor>還沒有討論。角色之間的訊息都會掛在項目底下，出現在這裡。</Text>
  const open = snap.threads.find(t => t.item === view.thread)
  if (open === undefined) {
    return (
      <Box flexDirection="column">
        {snap.threads.map(t => (
          <Button key={`thread-${t.item}`} label={`${titled(t)} · ${t.total ?? t.messages.length} 則`} onPress={() => act.thread(t.item)} />
        ))}
      </Box>
    )
  }
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={1}>
        <Button key="thread-back" label="← 所有討論" onPress={() => act.thread(null)} />
        <Text bold>{titled(open)}</Text>
      </Box>
      {open.total !== undefined && (
        <Text dimColor>
          只顯示最近 {open.messages.length} 則（共 {open.total} 則），較早的在 .crew/threads/{open.item}.jsonl。
        </Text>
      )}
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
      {snap.memoryTotal !== undefined && (
        <Text dimColor>
          只列最新的 {snap.memories.length} 條（共 {snap.memoryTotal} 條），較早的用上面的「搜尋」找。
        </Text>
      )}
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
  // A day with no use yet still shows the brain's switch, its reminders and what it did.
  const used =
    snap.usage.length === 0 ? (
      <Text dimColor>今天還沒有用量。角色開始工作後，每一輪的 token 都會記在這裡。</Text>
    ) : (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          {Row({ el, cells: head })}
          {snap.usage.map(u => {
            const rate = hitRate(u)
            return Row({ el, cells: [
                  ['14%', `${ROLE_NAMES[u.role]}${u.engine === 'codex' ? '・Codex' : ''}`],
                  ['12%', tokens(u.input)],
                  ['12%', tokens(u.output)],
                  ['13%', tokens(u.cacheRead)],
                  // Codex tells no cache writes.
                  ['13%', u.engine === 'codex' ? '—' : tokens(u.cacheWrite)],
                  ['12%', `${rate}%`, { color: rate < 60 ? 'warning' : undefined }],
                  ['12%', String(u.wakes)],
                  ['12%', String(u.rotations)],
                ] })
          })}
        </Box>
        <Text dimColor>
          今日 {tokens(snap.today)} tok · 大腦協調佔 {Math.round(snap.brainShare * 100)}%
          {snap.codexToday === undefined ? '' : ` · Codex ${tokens(snap.codexToday)} tok，走你的 Codex 額度，不算進前面的數字`}
        </Text>
        <Text dimColor>依難易度：{snap.tiers.map(t => `${TIER_NAMES[t.tier]} ${tokens(t.tokens)}`).join(' · ')}</Text>
        {snap.audit !== undefined && AuditSection({ el, audit: snap.audit })}
        {snap.injected !== undefined && snap.injected.count > 0 && (
          <Text dimColor>
            每次附上的記憶平均 {tokens(snap.injected.average)} tok（{snap.injected.count} 次）
            {snap.chores !== undefined && snap.chores > 0 ? ` · 記憶整理 ${tokens(snap.chores)} tok` : ''}
          </Text>
        )}
      </Box>
    )
  return (
    <Box flexDirection="column" gap={1}>
      {used}
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

/** Why the pane could not be drawn, on one line, masked: an error can carry what a board or a file held. */
export const paneFailure = (error: unknown): string => `crew 面板畫不出來：${cut(redact(String(error)).replace(/\s+/g, ' ').trim(), 200)}`

/** The pane when crew could not draw it: says why, rather than an empty pane. */
export function PaneFailed({ el, error }: { el: Elements; error: unknown }) {
  const { Box, Text } = el
  return (
    <Box flexDirection="column" gap={1}>
      <Text color="error">{paneFailure(error)}</Text>
      <Text dimColor>請回報這個問題。</Text>
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
      {view.tab === 'models' && ModelsTab({ el, snap, act })}
      {view.tab === 'settings' && Settings({ el, snap, view, act, isDemo })}
    </Box>
  )
}

const alignmentWord = (a: NonNullable<Snapshot['alignment']>): string =>
  aligned(a) ? '對準 PRD ✓' : a.problem !== undefined ? `⚠ ${a.problem}` : a.gaps > 0 ? `⚠ PRD 對不上 ${a.gaps}` : '⚠ PRD 改了'

/** The brain that took over, in a few words: its draft and where it stands, or waiting to hear with no PRD under way. */
const takeoverWords = (t: Takeover): string[] =>
  t.draft !== undefined
    ? [t.draft.stage === 'confirm' ? `PRD 草稿等你確認：${t.draft.title}` : `PRD 草稿 ${t.draft.title} · ${reviewsLine(t.draft)}`]
    : t.idle === true
      ? ['大腦接手中 · 還沒有 PRD']
      : []

/** The one line above the prompt: what needs the person first, then the roles. */
export function bandText(snap: Snapshot, label = 'crew（設計稿）'): string {
  const roles = snap.roles
    .map(r => `${r.id === 'techlead' ? 'TL' : ROLE_NAMES[r.id]} ${r.state === 'working' ? r.doing.split(' ')[0] : ROLE_STATE_NAMES[r.state]}`)
    .join(' · ')
  const parts = [
    label,
    ...(snap.boardProblem === undefined ? [] : ['⚠ 看板讀不到']),
    ...(snap.takeover?.on === true ? takeoverWords(snap.takeover) : []),
    // With no PRD under way, the progress of a board an earlier one left is history, as in the pane's head.
    ...(snap.progress !== null && !waitsForWord(snap) ? [`進度 ${percentOf(snap.progress)}%（${snap.progress.done}/${snap.progress.total}）`] : []),
    ...(snap.alignment === undefined ? [] : [alignmentWord(snap.alignment)]),
    ...(snap.modelAsks !== undefined && snap.modelAsks.length > 0 ? [`⚠ 模型 ${snap.modelAsks.length}`] : []),
    `待你決定 ${waitingCount(snap)}`,
    // A flow held for the person is said here too, for when the pane is closed.
    ...(snap.start?.resumable !== undefined ? ['⏸ 等你接續'] : []),
    ...(snap.alerts.length > 0 ? [`⚠ ${snap.alerts.length} 則提醒`] : []),
    `今日 ${tokens(snap.today)} tok${snap.codexToday === undefined ? '' : ` · Codex ${tokens(snap.codexToday)}`}`,
    roles,
  ]
  return parts.join(' │ ')
}
