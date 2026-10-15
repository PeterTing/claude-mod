import type { CrewScenario, CrewTab } from '../types'
import {
  hitRate,
  ITEM_STATUS_NAMES,
  MEMORY_TYPE_NAMES,
  ROLE_NAMES,
  ROLE_STATE_NAMES,
  tokens,
} from './model'
import type { Feature, Gate, Item, ItemStatus, LayerState, Progress, RoleRow, Route, Snapshot } from './model'

/** The elements a surface draws with, as `$.ui.resolve(e)` hands them over. */
export type Elements = { Box: any; Text: any; Button: any }

/** What the person can do in the pane. */
export type Actions = {
  tab: (tab: CrewTab) => void
  scenario: (scenario: CrewScenario) => void
  thread: (item: string | null) => void
  /** Opens a gate's detail on the overview, or closes it with null. */
  gate: (gate: string | null) => void
  /** Opens an item's thread on the Threads tab. */
  openThread: (item: string) => void
  reply: (decision: string) => void
}

export type View = { tab: CrewTab; scenario: CrewScenario; thread: string | null; gate: string | null }

const TABS: readonly [CrewTab, string][] = [
  ['overview', '總覽'],
  ['progress', '進度'],
  ['board', '看板'],
  ['threads', '討論'],
  ['memory', '記憶'],
  ['tokens', 'Token'],
]

const SCENARIOS: readonly [CrewScenario, string][] = [
  ['normal', '一般'],
  ['empty', '剛開始'],
  ['attention', '需要注意'],
]

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
  const filled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * width)
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`
}

const percentOf = (p: Progress): number => (p.total === 0 ? 0 : Math.round((p.done / p.total) * 100))

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
            {st.label} {st.state === 'done' ? '✓' : `${st.done}/${st.total}`}
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

function ProgressTab({ el, snap }: { el: Elements; snap: Snapshot }) {
  const { Box, Text } = el
  const p = snap.progress
  if (p === null) return <Text dimColor>還沒有項目。PM 拆完 PRD 後，這裡會顯示每個功能做到哪裡。</Text>
  const most = Math.max(1, ...p.daily.map(d => d.done))
  return (
    <Box flexDirection="column" gap={1}>
      {ProgressSummary({ el, p })}
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
  const pct = g.total === 0 ? 0 : Math.round((g.covered / g.total) * 100)
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

/** One table row: each cell a width and a text. */
function Row({ el, cells }: { el: Elements; cells: readonly [string, string, Record<string, unknown>?][] }) {
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
    </Box>
  )
}

function Header({ el, snap, view, act }: { el: Elements; snap: Snapshot; view: View; act: Actions }) {
  const { Box, Text, Button } = el
  const prd =
    snap.prd === null
      ? '還沒有 PRD'
      : `${snap.prd.id} ${snap.prd.title} · 進度 ${snap.prd.progress}% · 今日 ${tokens(snap.today)} tok`
  return (
    <Box flexDirection="column">
      <Text color="warning">設計稿・示意資料　/crew demo off 關閉</Text>
      <Text bold>{prd}</Text>
      <Box flexDirection="row" gap={1}>
        <Text dimColor>示意情境</Text>
        {SCENARIOS.map(([id, label]) => (
          <Button key={`scenario-${id}`} label={label} variant={view.scenario === id ? 'primary' : 'secondary'} onPress={() => act.scenario(id)} />
        ))}
      </Box>
      <Box flexDirection="row" gap={1}>
        {TABS.map(([id, label]) => (
          <Button key={`tab-${id}`} label={label} variant={view.tab === id ? 'primary' : 'secondary'} onPress={() => act.tab(id)} />
        ))}
      </Box>
    </Box>
  )
}

function Overview({ el, snap, view, act }: { el: Elements; snap: Snapshot; view: View; act: Actions }) {
  const { Box, Text, Button } = el
  const openGate = snap.gates.find(g => g.id === view.gate)
  return (
    <Box flexDirection="column" gap={1}>
      {snap.progress !== null && ProgressSummary({ el, p: snap.progress })}
      {snap.prd === null && (
        <Box flexDirection="column">
          <Text>還沒有 PRD。把 PRD 放進 repo 後，用 /crew prd &lt;檔案&gt; 匯入（規劃中），PM 會把它拆成功能和驗收條件。</Text>
          <Text dimColor>五個角色都在待命，沒有工作時不花 token。</Text>
        </Box>
      )}
      <Box flexDirection="column">
        {Row({ el, cells: [['12%', '角色', { dimColor: true }], ['10%', '狀態', { dimColor: true }], ['32%', '正在做', { dimColor: true }], ['20%', '模型', { dimColor: true }], ['16%', 'context', { dimColor: true }], ['10%', '今日', { dimColor: true }]] })}
        {snap.roles.map(r => Row({ el, cells: [
              ['12%', ROLE_NAMES[r.id]],
              ['10%', ROLE_STATE_NAMES[r.state], { color: STATE_COLORS[r.state] }],
              ['32%', r.doing],
              ['20%', route(r.route), { dimColor: r.route === undefined }],
              ['16%', `${tokens(r.context)}/${tokens(r.limit)}`, { color: r.context / r.limit > 0.85 ? 'warning' : undefined }],
              ['10%', tokens(r.today)],
            ] }))}
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
      {snap.alerts.length > 0 && (
        <Box flexDirection="column">
          <Text color="warning">提醒已送大腦</Text>
          {snap.alerts.map(a => (
            <Text>· {a}</Text>
          ))}
        </Box>
      )}
      {snap.decisions.length > 0 && (
        <Box flexDirection="column">
          <Text color="warning">待你決定（{snap.decisions.length}）</Text>
          {snap.decisions.map(d => (
            <Box flexDirection="row" gap={1}>
              <Text>
                {d.id} {d.question}
              </Text>
              <Text dimColor>
                {ROLE_NAMES[d.from]} 提問 · {d.age}
              </Text>
              <Button key={`reply-${d.id}`} label="回覆" onPress={() => act.reply(d.id)} />
            </Box>
          ))}
        </Box>
      )}
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
      <Text dimColor>模型和 context 門檻依項目複雜度決定：S Sonnet・medium 60K · M Sonnet・high 100K · L Opus・high 160K · XL Opus・xhigh 256K；失敗兩次升一級，最高 Opus・max</Text>
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

function MemoryList({ el, snap }: { el: Elements; snap: Snapshot }) {
  const { Box, Text } = el
  if (snap.memories.length === 0) return <Text dimColor>還沒有記憶。角色做了決定、發現限制，或你說了偏好，就會存在這裡。</Text>
  return (
    <Box flexDirection="column" gap={1}>
      <Text dimColor>搜尋（規劃中）：輸入關鍵字或項目編號</Text>
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

function Tokens({ el, snap }: { el: Elements; snap: Snapshot }) {
  const { Box, Text } = el
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
      {snap.alerts.length > 0 && (
        <Box flexDirection="column">
          <Text color="warning">提醒已送大腦</Text>
          {snap.alerts.map(a => (
            <Text>· {a}</Text>
          ))}
        </Box>
      )}
      {snap.actions.map(a => (
        <Box flexDirection="row" gap={1}>
          <Text color="suggestion">大腦處置</Text>
          <Text>{a}</Text>
        </Box>
      ))}
    </Box>
  )
}

/** The whole pane: header, tabs and the open tab. */
export function CrewPane({ el, snap, view, act }: { el: Elements; snap: Snapshot; view: View; act: Actions }) {
  const { Box } = el
  return (
    <Box flexDirection="column" gap={1}>
      {Header({ el, snap, view, act })}
      {view.tab === 'overview' && Overview({ el, snap, view, act })}
      {view.tab === 'progress' && ProgressTab({ el, snap })}
      {view.tab === 'board' && Board({ el, snap })}
      {view.tab === 'threads' && Threads({ el, snap, view, act })}
      {view.tab === 'memory' && MemoryList({ el, snap })}
      {view.tab === 'tokens' && Tokens({ el, snap })}
    </Box>
  )
}

/** The one line above the prompt: what needs the person first, then the roles. */
export function bandText(snap: Snapshot): string {
  const roles = snap.roles
    .map(r => `${r.id === 'techlead' ? 'TL' : ROLE_NAMES[r.id]} ${r.state === 'working' ? r.doing.split(' ')[0] : ROLE_STATE_NAMES[r.state]}`)
    .join(' · ')
  const parts = [
    'crew（設計稿）',
    ...(snap.progress !== null ? [`進度 ${percentOf(snap.progress)}%（${snap.progress.done}/${snap.progress.total}）`] : []),
    `待你決定 ${snap.decisions.length}`,
    ...(snap.alerts.length > 0 ? [`⚠ ${snap.alerts.length} 則提醒`] : []),
    `今日 ${tokens(snap.today)} tok`,
    roles,
  ]
  return parts.join(' │ ')
}
