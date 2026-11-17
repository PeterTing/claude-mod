import type { CrewLogView, CrewScenario, CrewTab, CrewThreadsView } from '../types'
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
import type { AcceptAppRow, Audit, Decision, Engine, Engines, Feature, FoundRowView, Gate, Guard, IdPrefixes, Item, ItemPage, ItemStatus, LayerState, LogEntry, ModelAsk, PageLink, PageSection, Pick, Progress, RequirementRow, RoleId, RoleModels, RoleRow, RoleRun, Route, RunPage, RunStep, Snapshot, StageCell, Takeover, Thread, Tuning } from './model'
import { failedOf, MAX_SENDS, pendingOf, reviewMark, reviewWord, sentOut } from './draft'
import { goWord } from './go'
import { percentWords } from './guard'
import { redact } from './memory'
import { cut } from './prd'
import { MAX_TEST_COMMANDS } from './runs'
import { VERIFY_ALL, VERIFY_NONE, VERIFY_NOT, VERIFY_ONE } from './verify'
import { asCards } from './web'
import { claudeFixedModels, CLAUDE_MODELS, claudeEfforts, codexChoices, codexLabel, CODEX_MINIMUM, fitEffort, labelOf, ladderOf, limitsByTier, pickSaid, TIER_NAMES } from './router'
import type { Model } from './router'

/** The elements a surface draws with, as `$.ui.resolve(e)` hands them over; a phone's has no text field or picker. */
export type Elements = { Box: any; Text: any; Button: any; Input?: any; Select?: any; Link?: any; web?: boolean }

/** A look the web page gives a box or a text (a card, a chip, a table row); a pane draws none, and is handed nothing. */
const look = (el: Elements, cls: string): { cls?: string } => (el.web === true ? { cls } : {})

/**
 * A text as the pane draws it: colour codes and other terminal escapes left out, a tab as two spaces,
 * any other control character but a newline gone. What a role runs prints them, and a surface draws
 * nothing at all of a tree with one text that holds one.
 */
export const plain = (text: string): string =>
  text
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[@-_]?/g, '')
    .replace(/\t/g, '  ')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')

const plainChildren = (c: unknown): unknown => (typeof c === 'string' ? plain(c) : Array.isArray(c) ? c.map(plainChildren) : c)

/** A surface's elements, the strings in each Text and Button and each Button's label made plain: one word a role wrote cannot blank the pane. */
export const plainElements = <E extends Elements>(el: E): E => ({
  ...el,
  Text: (props: any) => el.Text({ ...props, children: plainChildren(props.children) }),
  Button: (props: any) => el.Button({ ...props, children: plainChildren(props.children), ...(typeof props.label === 'string' ? { label: plain(props.label) } : {}) }),
})

/** What the person can do in the pane: everything crew does on their word, with no command. Each may take time: it resolves once done. */
export type Actions = {
  tab: (tab: CrewTab) => void | Promise<void>
  scenario: (scenario: CrewScenario) => void | Promise<void>
  thread: (item: string | null) => void | Promise<void>
  /** Opens a gate's detail on the overview, or closes it with null. */
  gate: (gate: string | null) => void | Promise<void>
  /** Opens an item's thread on the Threads tab. */
  openThread: (item: string) => void | Promise<void>
  /** The Threads tab's order, its legend and how many it lists. */
  threadsView: (change: Partial<CrewThreadsView>) => void | Promise<void>
  /** The log tab's role, the entry open, and how many it lists. */
  logView: (change: Partial<CrewLogView>) => void | Promise<void>
  /** A page over the tab: opened on top of the last, back to the one before, or another in the last one's place. */
  openPage: (page: string) => void | Promise<void>
  backPage: () => void | Promise<void>
  swapPage: (page: string) => void | Promise<void>
  /** A role's run in the main view where Claude Code can show it, or its runs on Codex in the pane; and back to the main conversation. */
  viewRun: (role: RoleId, run: RoleRun) => void | Promise<void>
  backToMain: () => void | Promise<void>
  pageThread: (item: string) => void | Promise<void>
  /** The PRD picked in the list, and the start with the one picked or a path typed. */
  pick: (path: string) => void | Promise<void>
  start: (path?: string) => void | Promise<void>
  /** Not now: the pane closes, and crew starts nothing. */
  notNow: () => void | Promise<void>
  resume: () => void | Promise<void>
  /** The 接續 beside a feature crew stopped checking: QA operates that feature in the app again, the rest of the flow as it is. */
  recheck: (feature: string) => void | Promise<void>
  /** Another copy of crew's record of the repo brought over, or not (rebuilt from the board where it can be). */
  carry: () => void | Promise<void>
  skipCarry: () => void | Promise<void>
  answer: (question: string, text: string) => void | Promise<void>
  approve: (question: string) => void | Promise<void>
  reject: (question: string, reason?: string) => void | Promise<void>
  /** Opens a design to read in the pane, or closes it with null. */
  viewDesign: (design: string | null) => void | Promise<void>
  /** The designs decided in the pane, one by one, rather than on the review page. */
  reviewInPane: () => void | Promise<void>
  /** Back to the decide page from the pane, or to one that could not be published: made again from now. */
  reviewOnPage: () => void | Promise<void>
  /** The person decided on the page: the brain reads its comments, which may not have woken it. */
  readPage: () => void | Promise<void>
  /** A feature handed to the person: passed, or to change as they say. */
  accept: (feature: string, verdict: 'passed' | 'changes', said?: string, code?: string) => void | Promise<void>
  /** The app crew keeps up for the person's acceptance closes: their own press, in the pane or on crew's web page. */
  closeApp: () => void | Promise<void>
  /** Opens or closes a part of the pane the person asked for: a setting's help, a role's model editor, the PRD path field. */
  toggle: (key: string) => void | Promise<void>
  /** Opens a role's question field, or closes it with null; asks it; rotates it. */
  openAsk: (role: RoleId | null) => void | Promise<void>
  /** Shows a role's work and last report in full under its row, or hides them with null. */
  /** A role's details, or a builder's after the first by `fullstack-N`. */
  openDetail: (row: string | null) => void | Promise<void>
  ask: (role: RoleId, text: string) => void | Promise<void>
  rotate: (role: RoleId) => void | Promise<void>
  testCommand: (text: string) => void | Promise<void>
  /** A command crew found turned off (`run` false) or back on, by its folder's key: the person's press alone. */
  foundTest: (key: string, run: boolean) => void | Promise<void>
  runTests: () => void | Promise<void>
  /** The worktree prep command, set by the person; a trial run of it in crew's own worktree. */
  setupCommand: (text: string) => void | Promise<void>
  setupRun: () => void | Promise<void>
  /** What QA starts the app with, the URL it opens and the test accounts file, set by the person. */
  startCommand: (text: string) => void | Promise<void>
  stopCommand: (text: string) => void | Promise<void>
  appUrl: (text: string) => void | Promise<void>
  testAccounts: (text: string) => void | Promise<void>
  /** How a test case is verified, set by the person on its page: the test commands, QA in the app, or their own check at acceptance. */
  verifyMethod: (testCase: string, method: 'command' | 'qa' | 'accept') => void | Promise<void>
  /** A memory pinned for every builder, or the pin taken off. */
  pinMemory: (id: string) => void | Promise<void>
  unpinMemory: (id: string) => void | Promise<void>
  tuning: (mode: Tuning) => void | Promise<void>
  /** The usage guard on or off; the next warning line; the next pause line of a window; 這次照常做, to this reset. */
  usageGuard: (on: boolean) => void | Promise<void>
  usageWarn: () => void | Promise<void>
  usagePause: (kind: 'five_hour' | 'seven_day') => void | Promise<void>
  usageGoOn: () => void | Promise<void>
  openOnLoad: (open: boolean) => void | Promise<void>
  /** crew publishes the decide page itself, or the brain does. */
  selfPublish: (on: boolean) => void | Promise<void>
  agents: (n: number) => void | Promise<void>
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

export type View = { tab: CrewTab; scenario: CrewScenario; thread: string | null; threadsView: CrewThreadsView; logView: CrewLogView; pages: readonly string[]; gate: string | null; asking: string | null; detail: string | null; confirming: boolean; shown: readonly string[] }

const ROLE_IDS: readonly RoleId[] = ['pm', 'uiux', 'fullstack', 'qa', 'techlead']

/** A control's work, run once the pane's record is read: false when what it needs is no longer on screen. */
export type PaneWork = (act: Actions, view: View, snap: Snapshot) => Promise<boolean>

/**
 * The work a control of the pane stands for, told by its key alone: what crew
 * does on the person's word, done in full before it resolves. Undefined for a
 * control crew does nothing for, whose own handler takes it all, so its press
 * goes on at once and needs none of crew's record.
 */
export function workOf(key: string, value?: string): PaneWork | undefined {
  const did = async (work: void | Promise<void>): Promise<true> => {
    await work
    return true
  }
  const id = (prefix: string) => (key.startsWith(prefix) ? key.slice(prefix.length) : undefined)
  const role = (x: string | undefined): RoleId | undefined => ROLE_IDS.find(r => r === x)
  if (value !== undefined) {
    // A field's Enter, or a pick.
    if (key === 'prd-path') return act => did(act.start(value))
    if (key === 'prd-pick' || key === 'prd-switch') return act => did(act.pick(value))
    if (key === 'test-command') return act => did(act.testCommand(value))
    if (key === 'test-command-add') return act => did(act.testCommand(`add ${value}`))
    const testRow = key.match(/^test-command-(\d)$/)?.[1]
    if (testRow !== undefined) return act => did(act.testCommand(`set ${testRow} ${value}`))
    if (key === 'setup-command') return act => did(act.setupCommand(value))
    if (key === 'start-command') return act => did(act.startCommand(value))
    if (key === 'stop-command') return act => did(act.stopCommand(value))
    if (key === 'app-url') return act => did(act.appUrl(value))
    if (key === 'test-accounts') return act => did(act.testAccounts(value))
    if (key === 'pin-memory') return act => did(act.pinMemory(value))
    const floored = key.match(/^floor-(\w+)-(claude|codex)-(model|effort)$/)
    const floorRole = role(floored?.[1])
    if (floored !== null && floorRole !== undefined) return act => did(act.roleFloor(floorRole, floored[2] as Engine, { [floored[3] as 'model' | 'effort']: value }))
    const fixedPick = key.match(/^fixed-(\w+)-(model|effort)$/)
    const fixedRole = role(fixedPick?.[1])
    if (fixedPick !== null && fixedRole !== undefined) return act => did(act.roleFixed(fixedRole, { [fixedPick[2] as 'model' | 'effort']: value }))
    const limited = role(id('limit-'))
    if (limited !== undefined) return act => did(act.roleLimit(limited, value === 'tier' ? 'tier' : Number(value)))
    if (key === 'recall') return act => did(act.recall(value))
    if (key === 'remember') return act => did(act.remember(value))
    const answer = id('answer-')
    if (answer !== undefined) return act => did(act.answer(answer, value))
    const sent = id('reject-')
    if (sent !== undefined) return act => did(act.reject(sent, value))
    const changes = id('acc-change-')
    if (changes !== undefined) {
      return async (act, _view, snap) => {
        const row = snap.accepts?.rows.find(r => r.feature === changes && r.state !== 'fixing')
        return row === undefined ? false : did(act.accept(changes, 'changes', value, row.mark))
      }
    }
    const asked = role(key.match(/^ask-(\w+)-text$/)?.[1])
    if (asked !== undefined) return act => did(act.ask(asked, value))
    return undefined
  }
  // Only while the app kept for acceptance is there to close.
  if (key === 'acc-app-close') return async (act, _view, snap) => (snap.acceptApp === undefined ? false : did(act.closeApp()))
  const simple: Record<string, (act: Actions) => void | Promise<void>> = {
    start: act => act.start(),
    'switch-prd': act => act.start(),
    'not-now': act => act.notNow(),
    resume: act => act.resume(),
    carry: act => act.carry(),
    'carry-no': act => act.skipCarry(),
    'run-tests': act => act.runTests(),
    'setup-run': act => act.setupRun(),
    'tuning-auto': act => act.tuning('auto'),
    'tuning-ask': act => act.tuning('ask'),
    'usage-on': act => act.usageGuard(true),
    'usage-off': act => act.usageGuard(false),
    'usage-warn': act => act.usageWarn(),
    'usage-pause-five_hour': act => act.usagePause('five_hour'),
    'usage-pause-seven_day': act => act.usagePause('seven_day'),
    'usage-go-on': act => act.usageGoOn(),
    'open-on-load': act => act.openOnLoad(true),
    'not-on-load': act => act.openOnLoad(false),
    'self-publish-on': act => act.selfPublish(true),
    'self-publish-off': act => act.selfPublish(false),
    reset: act => act.reset(false),
    'reset-confirm': act => act.reset(true),
    consolidate: act => act.consolidate(),
    'close-design': act => act.viewDesign(null),
    'takeover-on': act => act.takeover(true),
    'takeover-off': act => act.takeover(false),
    'confirm-draft': act => act.confirmDraft(),
    'review-in-pane': act => act.reviewInPane(),
    'review-on-page': act => act.reviewOnPage(),
    'read-page': act => act.readPage(),
    'codex-check': act => act.checkCodex(),
    'ask-switch-on': act => act.askBeforeSwitch(true),
    'ask-switch-off': act => act.askBeforeSwitch(false),
    'web-open': act => act.openWeb(),
    'web-on-start': act => act.webOnStart(true),
    'web-not-on-start': act => act.webOnStart(false),
    'tailnet-on': act => act.tailnet(true),
    'tailnet-off': act => act.tailnet(false),
    'pair-device': act => act.pairDevice(),
  }
  const run = Object.hasOwn(simple, key) ? simple[key] : undefined
  if (run !== undefined) return act => did(run(act))
  const testGone = key.match(/^test-command-remove-(\d)$/)?.[1]
  if (testGone !== undefined) return act => did(act.testCommand(`remove ${testGone}`))
  // A command crew found, turned off or back on: the person's press, on a row the settings still show that way.
  const foundPress = key.match(/^found-(off|on)-(.+)$/)
  if (foundPress !== null) {
    const [, how, row] = foundPress
    return async (act, _view, snap) =>
      snap.settings?.found?.rows.some(r => r.key === row && r.status === (how === 'off' ? 'run' : 'off')) === true ? did(act.foundTest(row ?? '', how === 'on')) : false
  }
  // QA's proposals on how test cases are verified: the person's press, on the card still showing them.
  const verifyAll = key.match(/^verify-(all|none)-(Q-\d+)$/)
  if (verifyAll !== null)
    return async (act, _view, snap) => (snap.decisions.some(d => d.id === verifyAll[2] && d.kind === 'verify') ? did(act.answer(verifyAll[2] ?? '', verifyAll[1] === 'all' ? VERIFY_ALL : VERIFY_NONE)) : false)
  const verifyOne = key.match(/^verify-(one|not)-(Q-\d+)-(.+)$/)
  if (verifyOne !== null)
    return async (act, _view, snap) =>
      snap.decisions.some(d => d.id === verifyOne[2] && d.kind === 'verify' && d.verify?.some(c => c.id === verifyOne[3]) === true)
        ? did(act.answer(verifyOne[2] ?? '', `${verifyOne[1] === 'one' ? VERIFY_ONE : VERIFY_NOT} ${verifyOne[3] ?? ''}`))
        : false
  // How one test case is verified, pressed on its page.
  const method = key.match(/^method-([A-Za-z][A-Za-z0-9_]*-\d+)-(command|qa|accept)$/)
  if (method !== null) return act => did(act.verifyMethod(method[1] ?? '', method[2] as 'command' | 'qa' | 'accept'))
  // The 接續 beside a check crew stopped, pressed while the overview still shows it stopped.
  const recheck = key.match(/^recheck-([A-Za-z][A-Za-z0-9_]*-\d+)$/)?.[1]
  if (recheck !== undefined) return async (act, _view, snap) => ((snap.checks ?? []).some(c => c.feature === recheck && c.stopped === true) ? did(act.recheck(recheck)) : false)
  const approve = id('approve-')
  if (approve !== undefined) return act => did(act.approve(approve))
  const reject = id('reject-')
  if (reject !== undefined) return act => did(act.reject(reject))
  const design = id('view-')
  if (design !== undefined) return act => did(act.viewDesign(design))
  const passed = id('acc-pass-')
  if (passed !== undefined) {
    return async (act, _view, snap) => {
      const row = snap.accepts?.rows.find(r => r.feature === passed && r.state !== 'fixing')
      return row === undefined ? false : did(act.accept(passed, 'passed', undefined, row.mark))
    }
  }
  const moded = key.match(/^mode-(\w+)-(auto|fixed)$/)
  const modeRole = role(moded?.[1])
  if (moded !== null && modeRole !== undefined) return act => did(act.roleMode(modeRole, moded[2] as RoleModels['mode']))
  const fixedOn = key.match(/^fixed-(\w+)-(claude|codex)$/)
  const fixedOnRole = role(fixedOn?.[1])
  if (fixedOn !== null && fixedOnRole !== undefined) return act => did(act.roleFixed(fixedOnRole, { engine: fixedOn[2] as Engine }))
  const defaulted = key.match(/^engine-(\w+)-(claude|codex)$/)
  const defaultRole = role(defaulted?.[1])
  if (defaulted !== null && defaultRole !== undefined) return act => did(act.roleEngine(defaultRole, defaulted[2] as Engine))
  const agents = key.match(/^agents-([1-8])$/)
  if (agents !== null) return act => did(act.agents(Number(agents[1])))
  const unpaired = id('unpair-')
  if (unpaired !== undefined) return async (act, _view, snap) => (snap.web?.tailnet?.devices.some(d => d.id === unpaired) === true ? did(act.unpairDevice(unpaired)) : false)
  const answered = key.match(/^model-(yes|no)-(.+)$/)
  if (answered !== null) return async (act, _view, snap) => (snap.modelAsks?.some(a => a.id === answered[2]) === true ? did(act.modelAnswer(answered[2] ?? '', answered[1] === 'yes')) : false)
  const unpinned = id('unpin-')
  if (unpinned !== undefined) return async (act, _view, snap) => (snap.pinned?.rows.some(m => m.id === unpinned) === true ? did(act.unpinMemory(unpinned)) : false)
  const rotated = role(id('rotate-'))
  if (rotated !== undefined) return act => did(act.rotate(rotated))
  const opened = role(id('ask-'))
  if (opened !== undefined) return (act, view) => did(act.openAsk(view.asking === opened ? null : opened))
  const detail = id('detail-')
  if (detail !== undefined)
    return async (act, view, snap) => {
      const detailed = role(detail) ?? (snap.roles.some(r => r.slot !== undefined && `${r.id}-${r.slot}` === detail) ? detail : undefined)
      return detailed === undefined ? false : did(act.openDetail(view.detail === detailed ? null : detailed))
    }
  const option = id('prd-option-')
  if (option !== undefined)
    return async (act, _view, snap) => {
      const prd = snap.start?.prds[Number(option)]
      return prd === undefined ? false : did(act.pick(prd.path))
    }
  // A question's option answers with its words, as the decision on screen lists them.
  const picked = key.match(/^option-(.+)-(\d)$/)
  if (picked !== null)
    return async (act, _view, snap) => {
      const chosen = snap.decisions.find(d => d.id === picked[1] && d.kind === undefined)?.options?.[Number(picked[2])]
      return chosen === undefined ? false : did(act.answer(picked[1] ?? '', chosen))
    }
  return undefined
}

/**
 * The work a control of the pane stands for, by its key: what crew does on the
 * person's word, done in full before it resolves. True when the key is one;
 * false for a control that only moves the view, which its own handler takes.
 */
export async function actOn(act: Actions, view: View, snap: Snapshot, key: string, value?: string): Promise<boolean> {
  const work = workOf(key, value)
  return work === undefined ? false : work(act, view, snap)
}

export const TABS: readonly [CrewTab, string][] = [
  ['overview', '總覽'],
  ['progress', '進度'],
  ['board', '看板'],
  ['threads', '討論'],
  ['log', '記錄'],
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
  ['usage', 'Claude 用量暫停'],
]

/** A text field where the surface has one; where it has none (a phone), where to type instead. A field in a setting's row has no label of its own. */
function Field({ el, id, label, placeholder, value, submit, what, onSubmit }: { el: Elements; id: string; label?: string; placeholder?: string; value?: string; submit?: string; what: string; onSubmit: (text: string) => void }) {
  const { Input, Text } = el
  if (Input === undefined) return <Text dimColor>{what}請在電腦上的面板輸入</Text>
  return <Input key={id} {...(label === undefined ? {} : { label })} placeholder={placeholder} value={value} submitLabel={submit} onSubmit={(text: string) => onSubmit(text)} />
}

/**
 * The room between things stacked one under another, and between the lines of a
 * wrapped row: a step, so a graphical surface (desktop, the phones) leaves its
 * own small gap while the terminal and VS Code draw it as no line at all.
 */
const ROW_GAP = 'sm' as const

/** The room between the rows of a list or table whose rows can be pressed: less, so a long list stays short. A list of plain words, and a heading with what it heads, take none. */
const LIST_GAP = 'xs' as const

/** The column a setting's name takes, in cells: its controls line up after it. */
const NAME_WIDTH = 14

/**
 * One setting on one line: its name, then its controls and how it stands, then
 * a 「?」 that opens its help underneath. The help is closed until asked for.
 */
function SettingRow({ el, view, act, id, name, body, help }: { el: Elements; view: View; act: Actions; id: string; name: string; body: unknown; help?: string }) {
  const { Box, Text, Button } = el
  const open = help !== undefined && view.shown.includes(`help-${id}`)
  return (
    <Box flexDirection="column" rowGap={ROW_GAP}>
      <Box flexDirection="row" columnGap={1}>
        <Box width={NAME_WIDTH} flexShrink={0}>
          <Text wrap="truncate-end">{name}</Text>
        </Box>
        <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1} flexGrow={1} flexShrink={1} minWidth={0}>
          {body}
        </Box>
        {help !== undefined && <Button key={`help-${id}`} label="?" variant={open ? 'primary' : 'secondary'} onPress={() => act.toggle(`help-${id}`)} />}
      </Box>
      {open && (
        <Box paddingLeft={NAME_WIDTH + 1}>
          <Text dimColor wrap="wrap">
            {help}
          </Text>
        </Box>
      )}
    </Box>
  )
}

/** A quiet line with a 「?」 that opens the longer word under it, closed until asked for. */
function HelpLine({ el, view, act, id, line, help }: { el: Elements; view: View; act: Actions; id: string; line: string; help: readonly string[] }) {
  const { Box, Text, Button } = el
  const open = view.shown.includes(`help-${id}`)
  return (
    <Box flexDirection="column" rowGap={ROW_GAP} {...look(el, 'list')}>
      <Box flexDirection="row" columnGap={1}>
        <Box flexShrink={1} minWidth={0}>
          <Text dimColor wrap="truncate-end">
            {line}
          </Text>
        </Box>
        <Button key={`help-${id}`} label="?" variant={open ? 'primary' : 'secondary'} onPress={() => act.toggle(`help-${id}`)} />
      </Box>
      {/* Not `h`: JSX is drawn with the global `h`. */}
      {open &&
        help.map(words => (
          <Text dimColor wrap="wrap">
            {words}
          </Text>
        ))}
    </Box>
  )
}

/** A group of settings under a quiet heading. */
function SettingGroup({ el, title, rows }: { el: Elements; title: string; rows: unknown }) {
  const { Box, Text } = el
  return (
    <Box flexDirection="column" rowGap={ROW_GAP} {...look(el, 'card')}>
      <Text dimColor {...look(el, 'h3')}>
        {title}
      </Text>
      {rows}
    </Box>
  )
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
  const lately = `今天完成 ${today} 項（昨天 ${yesterday} 項）${latest === undefined ? '' : ` · 最近完成：${latest.id} ${latest.title}（${ROLE_NAMES[latest.role]}，${latest.age}）`}`
  if (el.web === true)
    return (
      <Box flexDirection="column" rowGap={ROW_GAP} {...look(el, 'card')}>
        <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1} {...look(el, 'item-head')}>
          <Text bold {...look(el, 'h3')}>
            整體進度
          </Text>
          <Text bold {...look(el, 'big')}>
            {pct}%
          </Text>
          <Text dimColor {...look(el, 'cap')}>
            {p.weighted === undefined ? '' : '依難易度加權 · '}
            {p.done}/{p.total} 項
          </Text>
        </Box>
        {Meter({ el, pct, done: pct === 100 })}
        <Box flexDirection="row" flexWrap="wrap" {...look(el, 'steps')}>
          {p.stages.map(st => (
            <Text {...look(el, `step${st.state === 'done' ? ' done' : st.state === 'active' ? ' now' : ''}`)}>
              {st.label} {st.state === 'done' ? '✓' : st.total === 0 ? '—' : `${st.done}/${st.total}`}
            </Text>
          ))}
        </Box>
        <Text {...look(el, 'cap')}>目前在：{p.stages.filter(st => st.state === 'active').map(st => st.label).join('、') || '—'}</Text>
        <Text dimColor {...look(el, 'cap')}>
          {lately}
        </Text>
      </Box>
    )
  return (
    <Box flexDirection="column" rowGap={ROW_GAP}>
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

/** One row of the page's bar chart: a name, its bar, and its number. */
function Bar({ el, name, pct, n }: { el: Elements; name: string; pct: number; n: string }) {
  const { Box, Text } = el
  return (
    <Box flexDirection="row" {...look(el, 'barrow')}>
      <Text wrap="truncate-end">{name}</Text>
      {Meter({ el, pct })}
      <Text dimColor {...look(el, 'n')}>
        {n}
      </Text>
    </Box>
  )
}

/** A bar the page draws to a percent: its track, filled that far. */
function Meter({ el, pct, done = false }: { el: Elements; pct: number; done?: boolean }) {
  const { Box } = el
  return (
    <Box flexDirection="row" {...look(el, 'meter')}>
      <Box flexDirection="row" pct={pct} {...look(el, `fill${done ? ' ok' : ''}`)} />
    </Box>
  )
}

/** A feature's place on the page's map: done (dim, ticked), being worked on (lit), begun, or not yet begun (dashed). */
const regionOf = (f: Feature): string =>
  f.dropped !== undefined ? 'todo gone' : f.percent === 100 ? 'done' : Object.values(f.layers).includes('doing') ? 'lit' : f.percent > 0 ? 'part' : 'todo'

/** The features as the page's map: one region each, pressed to open its page, with how far it is and its layers. */
function FeatureMap({ el, rows, act }: { el: Elements; rows: readonly Feature[]; act: Actions }) {
  const { Box, Text, Button } = el
  return (
    <Box flexDirection="row" flexWrap="wrap" {...look(el, 'map')}>
      {rows.map(f => (
        <Box key={`region-${f.id}`} flexDirection="column" rowGap={LIST_GAP} {...look(el, `region ${regionOf(f)}`)}>
          <Button key={`feature-${f.id}`} plain onPress={() => openItem(act, f.id)}>
            <Text bold>
              {f.percent === 100 ? '✓ ' : ''}
              {f.title}
            </Text>
          </Button>
          <Text dimColor {...look(el, 'cap')}>
            {f.id}
            {f.dropped !== undefined ? `・移出範圍：${f.dropped}` : `・${f.percent}%`}
          </Text>
          {f.dropped === undefined && Meter({ el, pct: f.percent, done: f.percent === 100 })}
          {f.dropped === undefined && (
            <Text dimColor {...look(el, 'cap')}>
              {layers(f)}
            </Text>
          )}
        </Box>
      ))}
    </Box>
  )
}

const STAGE_MARK: Record<StageCell['state'], string> = { done: '✓', doing: '◐', todo: '○', stale: '⟳', later: '—' }

/** The widest a requirement's number is drawn in the list. */
const LABEL_WIDTH = 14

/** How many columns text takes in the terminal: a full-width character (CJK, full-width punctuation) takes two. */
const columnsOf = (text: string): number => [...text].reduce((n, c) => n + (/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(c) ? 2 : 1), 0)

/** Text cut to fit `max` columns, marking the cut: whole when it fits. */
const fitColumns = (text: string, max: number): string => {
  if (columnsOf(text) <= max) return text
  let out = ''
  for (const c of text) {
    if (columnsOf(`${out}${c}`) > max - 1) break
    out += c
  }
  return `${out}…`
}

/** Each with its width: the longer of its name and ◐ 3/5, and the space after it. */
const STAGE_NAMES: [keyof RequirementRow['layers'], string, number][] = [
  ['spec', '規格', 5],
  ['design', '設計', 6],
  ['cases', '測試案例', 9],
  ['tasks', '任務', 6],
  ['code', '實作', 6],
  ['review', 'Review', 7],
  ['runs', '測試結果', 9],
]


/** Opens the page of a number of the board or the PRD. */
const openItem = (act: Actions, id: string) => act.openPage(`item:${id}`)

/**
 * Each PRD requirement by its first words and how far each stage of its
 * development is, one row each under the stage names, with what each column
 * counts; its number opens all of it.
 */
/**
 * How many rows a long list of the board or the progress tab draws at first.
 * Every drawing goes to the surface whole, and a long one is slow to send and
 * to lay out (the desktop app redraws it on every change, and the engine draws
 * only its first 100,000 characters anyway): the rest is a press away.
 */
export const LIST_SHOWN = 30

/** The rows of a long list as the pane draws them now: the first few, or all once the person asked for all. */
function capped<T>(view: View, id: string, rows: readonly T[], limit = LIST_SHOWN): { rows: readonly T[]; all: boolean } {
  const all = view.shown.includes(`more-${id}`)
  return { rows: all || rows.length <= limit ? rows : rows.slice(0, limit), all }
}

/** Under a long list: how much of it shows, and the press for the rest, or back to the first few. */
function MoreLine({ el, act, id, total, all, noun, limit = LIST_SHOWN }: { el: Elements; act: Actions; id: string; total: number; all: boolean; noun: string; limit?: number }) {
  const { Box, Text, Button } = el
  if (total <= limit) return null
  return (
    <Box flexDirection="row" columnGap={1}>
      <Text dimColor>{all ? `顯示全部 ${total} ${noun}` : `顯示 ${limit} / ${total} ${noun}`}</Text>
      <Button key={`more-${id}`} label={all ? `只顯示前 ${limit} ${noun}` : `顯示全部 ${total} ${noun}`} onPress={() => act.toggle(`more-${id}`)} />
    </Box>
  )
}

function RequirementList({ el, rows: every, view, act }: { el: Elements; rows: readonly RequirementRow[]; view: View; act: Actions }) {
  const { Box, Text } = el
  const opens = (id: string) => ({ key: `req-${id}`, onPress: () => openItem(act, id) })
  const { rows, all } = capped(view, 'requirements', every)
  // The PRD's own numbers, as wide as the longest and the space after it, to a point: a longer one is cut, and its page has it whole.
  const idWidth = Math.min(LABEL_WIDTH + 1, Math.max(5, ...rows.map(r => columnsOf(r.label) + 1)))
  // A number cut to fit keeps its #n, which tells it from another with the same section's name.
  const label = (r: RequirementRow) => {
    const nth = / #\d+$/.exec(r.label)?.[0] ?? ''
    return nth === '' || columnsOf(r.label) <= LABEL_WIDTH ? fitColumns(r.label, LABEL_WIDTH) : `${fitColumns(r.label.slice(0, -nth.length), LABEL_WIDTH - nth.length)}${nth}`
  }
  return (
    <Box flexDirection="column" rowGap={LIST_GAP}>
      <Text bold {...look(el, 'h3')}>
        PRD 需求（✓ 完成 ◐ 進行中 ○ 還沒開始 ⟳ 過期 — 還沒追蹤）
      </Text>
      {Row({ el, cells: [[idWidth, '編號', { dimColor: true }], ['22%', '內容', { dimColor: true }], ...STAGE_NAMES.map(([, name, width]): [number, string, Record<string, unknown>] => [width, name, { dimColor: true }])], head: true })}
      {rows.flatMap((r, i) => [
        ...(i === 0 || rows[i - 1]?.section !== r.section ? [<Text bold dimColor>{r.section === '' ? 'PRD 開頭' : r.section}</Text>] : []),
        r.dropped !== undefined
          ? Row({ el, cells: [[idWidth, label(r), { color: 'suggestion' }, opens(r.id)], ['22%', r.headline, { dimColor: true, strikethrough: true }], ['63%', `移出範圍：${r.dropped}`, { dimColor: true }]] })
          : Row({
              el,
              cells: [
                [idWidth, label(r), { color: 'suggestion' }, opens(r.id)],
                ['22%', r.headline, {}, { key: `req-title-${r.id}`, onPress: () => openItem(act, r.id) }],
                ...STAGE_NAMES.map(([key, , width]): [number, string, Record<string, unknown>] => {
                  const cell = r.layers[key]
                  return [
                    width,
                    `${STAGE_MARK[cell.state]}${cell.note === undefined ? '' : ` ${cell.note}`}`,
                    { color: cell.state === 'done' ? 'success' : cell.state === 'stale' ? 'warning' : undefined, dimColor: cell.state === 'later' || cell.state === 'todo' },
                  ]
                }),
              ],
            }),
      ])}
      {MoreLine({ el, act, id: 'requirements', total: every.length, all, noun: '條需求' })}
      <Text wrap="wrap" dimColor>
        依 PRD 的標題分組（上層標題寫在前面，第一個標題之前的叫「PRD 開頭」）。編號照 PRD 自己的寫法：條目開頭有自己的編號（像 FR-03、[REQ-12]，或一整串 R1、R2）就用它；有編號的清單照它的編號；都沒有就照它的位置算，接在最近一個有章節號的標題後面（2.3），子項目再往下一層（2.3.1）；上層的標題都沒有章節號時，照它在整份 PRD 裡的順序數。兩條碰巧同號時，最像 PRD 原本編號的那條（自己的編號、有章節號的標題底下）不變，其他的後面接小節名稱；一樣像就都接。按彩色的編號看全文和它底下的所有項目。數字怎麼算：規格，有沒有驗收條件；設計，幾個功能有核准的設計稿；測試案例，幾條驗收條件已經有測試案例；任務，幾條驗收條件已經有任務；實作，幾個任務已經 commit；Review，幾個任務的最新 commit 被 Tech lead 核准；測試結果，幾個測試案例在最新一次跑測試通過。
      </Text>
    </Box>
  )
}

function ProgressTab({ el, snap, view, act }: { el: Elements; snap: Snapshot; view: View; act: Actions }) {
  const { Box, Text } = el
  const p = snap.progress
  if (p === null) return <Text dimColor>還沒有項目。PM 拆完 PRD 後，這裡會顯示每個功能做到哪裡。</Text>
  const most = Math.max(1, ...p.daily.map(d => d.done))
  const features = capped(view, 'features', p.features)
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column" rowGap={ROW_GAP} {...look(el, 'list')}>
        {ProgressSummary({ el, p })}
        {p.weighted !== undefined && (
          <Box flexDirection="column" rowGap={ROW_GAP}>
            {HelpLine({
              el,
              view,
              act,
              id: 'weighting',
              line: `不加權是 ${p.done}/${p.total} 項`,
              help: [
                '加權：每一項照它的難易度算，易 1・中 2・難 4・極難 8；Tech lead 還沒評的算中。',
                '難易度看難不難，不看範圍大小：Tech lead 拆單時評，寫一句理由，例如哪裡不確定、碰不碰金流或權限、跨幾個模組、有沒有現成做法、好不好測。',
                '測試失敗 2 次、review 被退回 2 次、PM 和 QA 來回超過 6 次、用掉的 token 超過同級平均 2 倍，各往上調一級。做完的照最後的難易度算，所以調高時百分比可能往下掉。',
              ],
            })}
            {p.rated !== undefined &&
              p.rated.map(r => (
                <Text color="warning">
                  最近調整：{r.id} {TIER_NAMES[r.from]} → {TIER_NAMES[r.to]}：{r.why} · 進度 {r.before}% → {r.after}%
                </Text>
              ))}
          </Box>
        )}
      </Box>
      {snap.requirements !== undefined && snap.requirements.length > 0 && RequirementList({ el, rows: snap.requirements, view, act })}
      <Box flexDirection="column" rowGap={LIST_GAP}>
        <Text bold {...look(el, 'h3')}>
          各功能
        </Text>
        {el.web === true && (
          <Text dimColor {...look(el, 'cap')}>
            發亮的是正在做的，變淡打勾的是做完的，虛線是還沒開始。按功能名稱看它的細節。
          </Text>
        )}
        {el.web === true && FeatureMap({ el, rows: features.rows, act })}
        {el.web !== true && features.rows.map(f =>
          f.dropped !== undefined
            ? Row({ el, cells: [['26%', `${f.id} ${f.title}`, { dimColor: true, strikethrough: true }, { key: `feature-${f.id}`, onPress: () => openItem(act, f.id) }], ['74%', f.dropped, { dimColor: true }]] })
            : Row({
                el,
                cells: [
                  ['26%', `${f.id} ${f.title}`, { color: 'suggestion' }, { key: `feature-${f.id}`, onPress: () => openItem(act, f.id) }],
                  ['26%', bar(f.percent, 16), { color: f.percent === 100 ? 'success' : 'suggestion', wrap: 'truncate-end' }],
                  ['8%', `${f.percent}%`],
                  ['40%', layers(f), { dimColor: true }],
                ],
              }),
        )}
        {MoreLine({ el, act, id: 'features', total: p.features.length, all: features.all, noun: '個功能' })}
      </Box>
      <Box flexDirection="column">
        <Text bold {...look(el, 'h3')}>
          每天完成
        </Text>
        {el.web === true
          ? p.daily.map(d => Bar({ el, name: d.day, pct: (d.done / most) * 100, n: `${d.done} 項` }))
          : p.daily.map(d => Row({ el, cells: [['10%', d.day, { dimColor: true }], ['50%', bar((d.done / most) * 100, 14), { wrap: 'truncate-end' }], ['40%', `${d.done} 項`]] }))}
      </Box>
      <Box flexDirection="column" rowGap={LIST_GAP}>
        <Text bold {...look(el, 'h3')}>
          最近完成
        </Text>
        {p.recent.map((r, i) => Row({ el, cells: [['14%', r.id, { color: 'suggestion' }, { key: `recent-${i}-${r.id}`, onPress: () => openItem(act, r.id) }], ['46%', r.title], ['20%', ROLE_NAMES[r.role], { dimColor: true }], ['20%', r.age, { dimColor: true }]] }))}
      </Box>
    </Box>
  )
}

/** What a gate checks, who fills and confirms it, how much is covered, and each gap. */
function GateDetail({ el, g, act, board, view }: { el: Elements; g: Gate; act: Actions; board: string; view: View }) {
  const { Box, Text, Button } = el
  const pct = percent(g.covered, g.total)
  const gaps = capped(view, `gaps-${g.id}`, g.gaps)
  return (
    <Box flexDirection="column" rowGap={ROW_GAP} borderStyle="round" paddingX={1}>
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
      {g.sources !== undefined && <Text dimColor>{g.sources}</Text>}
      {g.gaps.length === 0 ? (
        <Text color="success">沒有缺口。</Text>
      ) : (
        <Box flexDirection="column" rowGap={ROW_GAP}>
          <Text color="warning">缺口（{g.gaps.length}）</Text>
          {gaps.rows.map(gap => (
            <Box flexDirection="row" gap={1}>
              <Button key={`gap-item-${g.id}-${gap.id}`} plain onPress={() => openItem(act, gap.id)}>
                <Text color="suggestion">{gap.shown ?? gap.id}</Text>
              </Button>
              <Text>{gap.title}</Text>
              <Text dimColor>· {gap.status}</Text>
              {gap.thread !== undefined && (
                <Button key={`gap-thread-${gap.thread}`} label="看討論" onPress={() => act.openThread(gap.thread ?? '')} />
              )}
            </Box>
          ))}
          {MoreLine({ el, act, id: `gaps-${g.id}`, total: g.gaps.length, all: gaps.all, noun: '項' })}
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
 * longest cell: nothing a table shows is cut. A cell keeps a column clear on
 * its right, so a text that fills it never runs into the next; the last does
 * only before a tail. A bar, drawn to a width, says `wrap: 'truncate-end'`.
 */
function Row({ el, cells, tail, head = false }: { el: Elements; cells: readonly [string | number, string, Record<string, unknown>?, { key: string; onPress: () => void | Promise<void> }?][]; tail?: unknown; head?: boolean }) {
  const { Box, Text, Button } = el
  return (
    <Box flexDirection="row" {...look(el, head ? 'tr th' : 'tr')}>
      {cells.map(([width, text, props, press], i) => {
        const words = (
          <Text wrap="wrap" {...(props ?? {})}>
            {text}
          </Text>
        )
        return (
          <Box width={width} {...(i < cells.length - 1 || tail !== undefined ? { paddingRight: 1 } : {})} {...look(el, 'td')}>
            {press === undefined ? (
              words
            ) : (
              <Button key={press.key} plain onPress={press.onPress}>
                {words}
              </Button>
            )}
          </Box>
        )
      })}
      {tail}
    </Box>
  )
}

/** The guard's hold, first on the overview: why, until when, the work it holds, and the person's way past it. */
function HoldCard({ el, g, act }: { el: Elements; g: Guard; act: Actions }) {
  const { Box, Text, Button } = el
  const hold = g.hold
  if (hold === undefined) return undefined
  return (
    <Box flexDirection="column" rowGap={ROW_GAP} borderStyle="round" borderColor="warning" paddingX={1}>
      <Text bold color="warning">
        ⏸ crew 暫停中：Claude {hold.name}用量 {percentWords(hold.percent)}{hold.full ? '，額度用完了' : ''}
      </Text>
      <Text>{hold.resets} 重置後自動接著做。跑在 Codex 的角色照常。</Text>
      {hold.waiting.length > 0 && <Text dimColor>等著的工作：{hold.waiting.join(' · ')}</Text>}
      {!hold.full && (
        <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1}>
          <Button key="usage-go-on" label="這次照常做" onPress={() => act.usageGoOn()} />
          <Text dimColor>到這次重置為止不再暫停</Text>
        </Box>
      )}
    </Box>
  )
}

/** The usage guard in the Token tab, one setting a line: on or off, each window's bar, the lines it warns and pauses at, and how the brain acts on usage. */
function GuardSection({ el, g, view, act, tuning }: { el: Elements; g: Guard; view: View; act: Actions; tuning: Tuning | undefined }) {
  const { Box, Text, Button } = el
  const bar = (p: number) => {
    const full = Math.max(0, Math.min(10, Math.round(p / 10)))
    return `${'█'.repeat(full)}${'░'.repeat(10 - full)}`
  }
  return (
    <Box flexDirection="column" rowGap={ROW_GAP}>
      {SettingRow({
        el,
        view,
        act,
        id: 'guard',
        name: '用量保護',
        body: [
          <Button key="usage-on" label="開" variant={g.on ? 'primary' : 'secondary'} onPress={() => act.usageGuard(true)} />,
          <Button key="usage-off" label="關" variant={g.on ? 'secondary' : 'primary'} onPress={() => act.usageGuard(false)} />,
        ],
        help: `數字和 /usage 一樣。到提醒線時一次只做一件，到暫停線時先停 Claude 上的角色。${g.on ? '' : '關掉時 crew 不提醒也不暫停；真的碰到上限時，還是會等重置後自己接續。'}crew 只讀數字，不碰你的登入資料。`,
      })}
      {g.windows.length === 0 ? (
        <Box paddingLeft={NAME_WIDTH + 1}>
          <Text dimColor wrap="wrap">還沒有讀到用量。用 API key 時沒有 5 小時和 7 天的上限，這裡不作用。</Text>
        </Box>
      ) : (
        g.windows.map(w =>
          SettingRow({
            el,
            view,
            act,
            id: `window-${w.name}`,
            name: w.name,
            body: [
              <Text color={w.past === 'pause' ? 'error' : w.past === 'warn' ? 'warning' : 'suggestion'}>{bar(w.percent)}</Text>,
              <Text>{percentWords(w.percent)}</Text>,
              <Text dimColor>{w.resets} 重置</Text>,
            ],
          }),
        )
      )}
      {g.on &&
        SettingRow({
          el,
          view,
          act,
          id: 'lines',
          name: '門檻',
          body: [
            <Text dimColor>提醒</Text>,
            <Button key="usage-warn" label={`${g.warn}%`} onPress={() => act.usageWarn()} />,
            <Text dimColor>5 小時暫停</Text>,
            <Button key="usage-pause-five_hour" label={`${g.pause.five_hour}%`} onPress={() => act.usagePause('five_hour')} />,
            <Text dimColor>7 天暫停</Text>,
            <Button key="usage-pause-seven_day" label={`${g.pause.seven_day}%`} onPress={() => act.usagePause('seven_day')} />,
          ],
          help: '按數字換門檻。',
        })}
      {tuning !== undefined && TuningRow({ el, view, act, tuning })}
    </Box>
  )
}

/** How the brain acts on usage: on its own, or proposing first. */
function TuningRow({ el, view, act, tuning }: { el: Elements; view: View; act: Actions; tuning: Tuning }) {
  const { Button } = el
  return SettingRow({
    el,
    view,
    act,
    id: 'tuning',
    name: '大腦處置',
    body: [
      <Button key="tuning-auto" label="自動" variant={tuning === 'auto' ? 'primary' : 'secondary'} onPress={() => act.tuning('auto')} />,
      <Button key="tuning-ask" label="先問你" variant={tuning === 'ask' ? 'primary' : 'secondary'} onPress={() => act.tuning('ask')} />,
    ],
    help: '大腦看到 token 瓶頸時的做法。自動：自己處置，事後記成決定。先問你：提出建議，你核准才做。瓶頸每件工作做完就重算，有新的才告訴大腦。換模型另外由「模型」分頁的「大腦換模型前」管。',
  })
}

function Header({ el, snap, view, act, isDemo, tabs = true }: { el: Elements; snap: Snapshot; view: View; act: Actions; isDemo: boolean; tabs?: boolean }) {
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
    <Box flexDirection="column" rowGap={ROW_GAP}>
      {isDemo && (
        <Box flexDirection="row" gap={1}>
          <Text color="warning">設計稿・示意資料</Text>
          <Button key="demo-close" label="關閉設計稿" onPress={() => act.demoOff()} />
        </Box>
      )}
      <Text bold>{prd}</Text>
      {/* The progress map is on the decide page: its link stays in reach when nothing on it waits for the person. */}
      {/* The overview has the page first of all, once its row is drawn: said there once. */}
      {snap.pageLink !== undefined && !(view.tab === 'overview' && (view.pages.length === 0 || snap.page === undefined) && snap.decidePage !== undefined) && !snap.decisions.some(d => d.url !== undefined) && (
        <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1}>
          <Text dimColor>進度圖和已經決定的事在待你決定頁</Text>
          {ReviewLink({ el, url: snap.pageLink })}
        </Box>
      )}
      {snap.alignment !== undefined && Alignment({ el, a: snap.alignment })}
      {StatusLine({ el, snap })}
      {isDemo && (
        <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1}>
          <Text dimColor>示意情境</Text>
          {SCENARIOS.map(([id, label]) => (
            <Button key={`scenario-${id}`} label={label} variant={view.scenario === id ? 'primary' : 'secondary'} onPress={() => act.scenario(id)} />
          ))}
        </Box>
      )}
      {tabs && (
        <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1}>
          {TABS.map(([id, label]) => (
            <Button key={`tab-${id}`} label={label} variant={view.tab === id ? 'primary' : 'secondary'} onPress={() => act.tab(id)} />
          ))}
        </Box>
      )}
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

/**
 * crew while it stays on, and Claude's windows, in one line under the PRD:
 * the heartbeat or what it found, each window's use; a restart's resume and
 * the brain's waiting digest underneath when there is one.
 */
function StatusLine({ el, snap }: { el: Elements; snap: Snapshot }) {
  const { Box, Text } = el
  const r = snap.resident
  const windows = snap.guard?.windows ?? []
  if (r === undefined && windows.length === 0) return null
  const queued = r?.digest !== undefined && r.digest.queued > 0 ? `大腦摘要 ${r.digest.queued} 則等 ${r.digest.next}` : undefined
  return (
    <Box flexDirection="column" rowGap={ROW_GAP}>
      <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={2}>
        {r !== undefined &&
          (r.found === undefined ? (
            <Text dimColor>✓ 常駐・心跳 {r.checked}</Text>
          ) : (
            <Text color="warning">
              ⚠ 常駐・心跳 {r.checked}發現：{r.found}
            </Text>
          ))}
        {windows.length > 0 && (
          <Box flexDirection="row" columnGap={1}>
            <Text dimColor>Claude</Text>
            {windows.map((w, i) => (
              <Text bold={w.past !== undefined} color={w.past === 'pause' ? 'error' : w.past === 'warn' ? 'warning' : undefined} dimColor={w.past === undefined}>
                {i > 0 ? '・' : ''}
                {w.name} {percentWords(w.percent)}
              </Text>
            ))}
          </Box>
        )}
      </Box>
      {queued !== undefined && <Text dimColor>{queued}</Text>}
      {r?.resumed !== undefined && (
        <Text dimColor wrap="truncate-end">
          重開接續：{r.resumed}
        </Text>
      )}
    </Box>
  )
}

/** The Mac stays awake while crew works (a role, its tests or a prep): how many roles, and that it sleeps as usual soon after they stop. */
function AwakeLine({ el, snap }: { el: Elements; snap: Snapshot }) {
  const { Text } = el
  const working = snap.roles.filter(r => r.state === 'working').length
  return (
    <Text color="success">
      ● Mac 保持清醒中（{working > 0 ? `${working} 位角色在做事` : '角色排著要開始、crew 在跑測試或準備，或剛做完'}；都停下來兩分鐘內恢復，闔上螢幕還是會睡）
    </Text>
  )
}

/** The same steps for QA finding in the repo how to start the app. */
const FIND_PHASE: Record<NonNullable<Snapshot['checking']>['phase'], string> = {
  starting: '準備 QA 的工作目錄',
  waiting: '工作目錄好了，等 Claude Code 下一個動作讓 QA 開始',
  checking: '讀 README、package.json、Makefile 這類檔案中',
}

const CHECK_PHASE: Record<NonNullable<Snapshot['checking']>['phase'], string> = {
  starting: '準備 QA 的工作目錄、開 app',
  waiting: 'app 開好了，等 Claude Code 下一個動作讓 QA 開始',
  checking: '用瀏覽器操作中',
}

/** QA checking a feature in the running app now: which, the round, and how far it got. */
function CheckingLine({ el, snap }: { el: Elements; snap: Snapshot }) {
  const { Text } = el
  const c = snap.checking
  if (c === undefined) return null
  return (
    <Text color="suggestion">
      {c.find === true
        ? `● QA 正在從 repo 找怎麼開 app，好替 ${c.feature}${c.title === undefined ? '' : ` ${c.title}`} 這些做完的功能截圖（${FIND_PHASE[c.phase]}，${c.since} 開始）`
        : `● QA 正在 app 裡實際操作 ${c.feature}${c.title === undefined ? '' : ` ${c.title}`}（第 ${c.round} 輪，${CHECK_PHASE[c.phase]}，${c.since} 開始）`}
    </Text>
  )
}

/** A check crew stopped trying, as the overview and the settings tab say it: why, and what the person's 接續 beside it does. */
const STOPPED_CHECK = '已停下：QA 一直送不出 crew 收得下的回報，按［接續］再請 QA 試'

/**
 * Checks crew stopped trying (QA kept ending with no report crew took): each
 * on the overview with its 接續, the person's own press, which has QA operate
 * that feature again. Till then it is no one's to pass and the PRD is not done.
 */
function StoppedChecks({ el, snap, act }: { el: Elements; snap: Snapshot; act: Actions }) {
  const { Box, Text, Button } = el
  const stopped = (snap.checks ?? []).filter(c => c.stopped === true)
  if (stopped.length === 0) return null
  return (
    <Box flexDirection="column" rowGap={ROW_GAP}>
      {stopped.map(c => (
        <Box key={`stopped-${c.feature}`} flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1}>
          <Text color="warning" wrap="wrap">
            ⚠ QA 在 app 裡實際操作 {c.feature}
            {c.title === undefined ? '' : ` ${c.title}`}：{STOPPED_CHECK}
            {c.why === undefined ? '' : `（${c.why}）`}
          </Text>
          <Button key={`recheck-${c.feature}`} label="接續" variant="primary" onPress={() => act.recheck(c.feature)} />
        </Box>
      ))}
    </Box>
  )
}

const CHECK_STATE: Record<NonNullable<Snapshot['checks']>[number]['state'], string> = {
  running: '操作中',
  passed: '通過',
  failed: '沒過，全端修正中',
  skipped: '沒有實際操作',
  error: '沒辦法操作，會再試一次',
  accepted: '照你的決定先照現在的樣子',
}

/** A check as the settings tab says it: what it waits on, when it waits; passed only for what QA passed in the app (in part as the flow's partialSaid says it). */
const checkState = (c: NonNullable<Snapshot['checks']>[number]): string =>
  c.stopped === true
    ? STOPPED_CHECK
    : c.recheck === true
      ? '你請 QA 再檢查一次，等 QA 在 app 裡操作'
      : c.waits === 'task'
        ? '沒過，等 Tech lead 補開發工作來修，修好再檢查'
        : c.waits === 'person'
    ? c.state === 'error'
      ? '沒辦法操作，等你回答'
      : '沒過，等你決定怎麼處理'
    : c.waits === 'builder'
      ? '沒過，等有空的全端來修'
      : c.partial !== undefined
        ? `部分通過：${[`${c.partial.passed} 個 test case 在 app 裡通過`, ...(c.partial.blocked > 0 ? [`${c.partial.blocked} 個沒辦法操作`] : []), ...((c.partial.theirs ?? 0) > 0 ? [`${c.partial.theirs} 個改成你驗收時自己確認`] : [])].join('，')}`
        : c.unseen === true
          ? '沒有在 app 裡確認任何 test case'
          : CHECK_STATE[c.state]

/** No PRD under way and every role resting with nothing done today: one line says so instead of the roles' table. */
const resting = (snap: Snapshot): boolean => snap.prd === null && snap.roles.every(r => r.state === 'idle' && r.today === 0 && r.task === undefined && r.run === undefined)

function Overview({ el, snap, view, act }: { el: Elements; snap: Snapshot; view: View; act: Actions }) {
  const { Box, Text, Button } = el
  const openGate = snap.gates.find(g => g.id === view.gate)
  return (
    <Box flexDirection="column" gap={1}>
      {snap.twin !== undefined && (
        <Text color="warning" wrap="wrap">
          {twinWords(snap.twin)}
        </Text>
      )}
      {snap.carry !== undefined && CarryCard({ el, c: snap.carry, act })}
      {PageRow({ el, snap, act })}
      {snap.guard?.hold !== undefined && HoldCard({ el, g: snap.guard, act })}
      {snap.start?.resumable !== undefined && (
        <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1}>
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
      {snap.prd === null && snap.boardProblem?.prd === undefined && StartScreen({ el, snap, view, act })}
      {snap.modelAsks !== undefined && snap.modelAsks.length > 0 && ModelAsks({ el, asks: snap.modelAsks, act })}
      {resting(snap) ? (
        <Text dimColor {...look(el, 'cap')}>
          {snap.roles.length} 個角色待命，沒有工作時不花 token。有角色在做事時，這裡才列出角色表。
        </Text>
      ) : el.web === true ? (
        WebRoles({ el, snap, view, act })
      ) : (
      <Box flexDirection="column" rowGap={ROW_GAP}>
        {Row({ el, cells: [['12%', '角色', { dimColor: true }], ['10%', '狀態', { dimColor: true }], ['30%', '正在做', { dimColor: true }], ['26%', '模型', { dimColor: true }], ['13%', 'context', { dimColor: true }], ['9%', '今日', { dimColor: true }]], head: true })}
        {snap.roles.map(r => {
          const next = nextEngine(r, snap.engines)
          // A builder after the first: its own row and details; questions and rotations go to the full-stack role.
          const key = r.slot === undefined ? r.id : `${r.id}-${r.slot}`
          return (
          <Box flexDirection="column" rowGap={ROW_GAP}>
            {Row({ el, cells: [
                ['12%', rowName(r)],
                ['10%', r.held === 'paused' ? '暫停' : ROLE_STATE_NAMES[r.state], { color: STATE_COLORS[r.state] }],
                ['30%', r.held === 'finishing' ? `${r.doing}（這一輪做完就停）` : r.doing],
                // Moved to the other engine since its last run: what it was on is no longer what it will be on.
                next !== undefined ? ['26%', `下一件用 ${ENGINE_NAMES[next]}${r.route === undefined ? '' : `（上一件 ${route(r.route)}）`}`] : ['26%', route(r.route), { dimColor: r.route === undefined }],
                // Codex tells no context size: its thread's is not crew's to count. A role moved to the other engine starts afresh.
                r.engine === 'codex' || next !== undefined ? ['13%', '—', { dimColor: true }] : ['13%', `${tokens(r.context)}/${tokens(r.limit)}`, { color: r.context / r.limit > 0.85 ? 'warning' : undefined }],
                r.slot === undefined ? ['9%', tokens(r.today)] : ['9%', '—', { dimColor: true }],
              ] })}
            <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1} paddingLeft={2}>
                  {(r.task !== undefined || r.report !== undefined) && (
                    <Button key={`detail-${key}`} label="詳情" variant={view.detail === key ? 'primary' : 'secondary'} onPress={() => act.openDetail(view.detail === key ? null : key)} />
                  )}
                  {r.run !== undefined && <Button key={`run-${key}`} label="看執行過程" onPress={() => act.viewRun(r.id, r.run as RoleRun)} />}
                  {snap.prd !== null && r.slot === undefined && <Button key={`ask-${r.id}`} label="問" onPress={() => act.openAsk(view.asking === r.id ? null : r.id)} />}
                  {snap.prd !== null && r.slot === undefined && <Button key={`rotate-${r.id}`} label="輪替" onPress={() => act.rotate(r.id)} />}
            </Box>
            {view.detail === key && RoleDetail({ el, r })}
            {view.asking === r.id && Field({ el, id: `ask-${r.id}-text`, label: `問 ${ROLE_NAMES[r.id]}`, placeholder: '你的問題', submit: '送出', what: '問題', onSubmit: text => act.ask(r.id, text) })}
          </Box>
          )
        })}
      </Box>
      )}
      {snap.awake !== undefined && AwakeLine({ el, snap })}
      {snap.checking !== undefined && CheckingLine({ el, snap })}
      {StoppedChecks({ el, snap, act })}
      {snap.gates.length > 0 && (
        <Box flexDirection="column" rowGap={ROW_GAP}>
          <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1}>
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
          {openGate !== undefined && GateDetail({ el, g: openGate, act, board: snap.boardFile?.path ?? BOARD_FILE, view })}
        </Box>
      )}
      {snap.alerts.length > 0 && Alerts({ el, alerts: snap.alerts })}
      {el.web === true && waitingAll(snap) > 0 && (
        <Text color="warning" {...look(el, 'cap')}>
          {waitingAll(snap)} 件事等你決定，在「待你決定」分頁。
        </Text>
      )}
      {el.web !== true && snap.decisions.length > 0 && (
        <Box flexDirection="column" rowGap={ROW_GAP}>
          <Text color="warning">待你決定（{waitingCount(snap)}）</Text>
          {capped(view, 'decisions', snap.decisions).rows.map(d => DecisionRow({ el, d, act }))}
          {MoreLine({ el, act, id: 'decisions', total: snap.decisions.length, all: capped(view, 'decisions', snap.decisions).all, noun: '項' })}
        </Box>
      )}
      {el.web !== true && snap.accepts !== undefined && snap.accepts.rows.length > 0 && AcceptRows({ el, snap, act, view })}
      {el.web !== true && snap.opened !== undefined && (
        <Box flexDirection="column" rowGap={ROW_GAP}>
          <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1}>
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

/** A role's state as the page's chip colours it. */
const STATE_CHIPS: Record<RoleRow['state'], string> = { idle: 'kind', working: 'run', waiting: 'wait', rotating: 'kind', blocked: 'bad' }

/**
 * The roles as the page draws them: a card each, its name and state, what it
 * is on, its model, context and today's tokens, and its presses (詳情, 看執行過程,
 * 問, 輪替), with the same keys and actions as the pane's table.
 */
function WebRoles({ el, snap, view, act }: { el: Elements; snap: Snapshot; view: View; act: Actions }) {
  const { Box, Text, Button } = el
  return (
    <Box flexDirection="row" flexWrap="wrap" {...look(el, 'grid2')}>
      {snap.roles.map(r => {
        const next = nextEngine(r, snap.engines)
        const key = r.slot === undefined ? r.id : `${r.id}-${r.slot}`
        const model = next !== undefined ? `下一件用 ${ENGINE_NAMES[next]}${r.route === undefined ? '' : `（上一件 ${route(r.route)}）`}` : route(r.route)
        const context = r.engine === 'codex' || next !== undefined ? undefined : `context ${tokens(r.context)}/${tokens(r.limit)}`
        const facts = [model, ...(context === undefined ? [] : [context]), ...(r.slot === undefined ? [`今日 ${tokens(r.today)}`] : [])]
        return (
          <Box key={`role-${key}`} flexDirection="column" rowGap={ROW_GAP} {...look(el, `role${r.state === 'working' ? ' busy' : ''}`)}>
            <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1} {...look(el, 'item-head')}>
              <Text bold>{rowName(r)}</Text>
              <Text {...look(el, `chip ${r.held === 'paused' ? 'wait' : STATE_CHIPS[r.state]}`)}>{r.held === 'paused' ? '暫停' : ROLE_STATE_NAMES[r.state]}</Text>
            </Box>
            <Text wrap="wrap">{r.held === 'finishing' ? `${r.doing}（這一輪做完就停）` : r.doing}</Text>
            <Text dimColor wrap="wrap" color={r.engine !== 'codex' && next === undefined && r.context / r.limit > 0.85 ? 'warning' : undefined} {...look(el, 'cap')}>
              {facts.join('・')}
            </Text>
            <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1} {...look(el, 'opts')}>
              {(r.task !== undefined || r.report !== undefined) && (
                <Button key={`detail-${key}`} label="詳情" variant={view.detail === key ? 'primary' : 'secondary'} onPress={() => act.openDetail(view.detail === key ? null : key)} />
              )}
              {r.run !== undefined && <Button key={`run-${key}`} label="看執行過程" onPress={() => act.viewRun(r.id, r.run as RoleRun)} />}
              {snap.prd !== null && r.slot === undefined && <Button key={`ask-${r.id}`} label="問" onPress={() => act.openAsk(view.asking === r.id ? null : r.id)} />}
              {snap.prd !== null && r.slot === undefined && <Button key={`rotate-${r.id}`} label="輪替" onPress={() => act.rotate(r.id)} />}
            </Box>
            {view.detail === key && RoleDetail({ el, r })}
            {view.asking === r.id && Field({ el, id: `ask-${r.id}-text`, label: `問 ${ROLE_NAMES[r.id]}`, placeholder: '你的問題', submit: '送出', what: '問題', onSubmit: text => act.ask(r.id, text) })}
          </Box>
        )
      })}
    </Box>
  )
}

/**
 * The features QA handed to the person: each with where it stands, a link to
 * its card on the decide page (what to look at, numbered, on the screen), and
 * 通過 or 要改 with their own words. One being changed only says so.
 */
function AcceptRows({ el, snap, act, view }: { el: Elements; snap: Snapshot; act: Actions; view: View }) {
  const { Box, Text, Button } = el
  const all = snap.accepts
  if (all === undefined) return null
  const rows = capped(view, 'accepts', all.rows)
  const url = snap.decidePage?.url
  const open = all.rows.filter(r => r.state !== 'fixing').length
  return (
    <Box key="accepts" flexDirection="column" rowGap={ROW_GAP} {...look(el, 'list')}>
      <Text color="warning" {...look(el, 'h3')}>
        待你驗收（{open}）{all.passed > 0 ? `　已通過 ${all.passed} 個` : ''}
      </Text>
      {snap.acceptApp !== undefined && AcceptAppLine({ el, a: snap.acceptApp, close: () => act.closeApp() })}
      {rows.rows.map(r => (
        <Box key={`acc-${r.feature}`} flexDirection="column" rowGap={ROW_GAP} {...look(el, 'item')}>
          <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1} {...look(el, 'item-head')}>
            {el.web === true && <Text {...look(el, `chip ${r.state === 'fixing' ? 'run' : 'ok'}`)}>{r.state === 'fixing' ? '修改中' : '待你驗收'}</Text>}
            <Text>
              {r.feature} {r.title ?? ''}
            </Text>
            <Text dimColor>
              {r.state === 'fixing' ? '照你說的改中，改好、QA 看過再交給你' : r.state === 'again' ? `照你上次說的改好了，QA 又看過（第 ${r.round} 輪）` : `QA 看過（第 ${r.round} 輪），等你看`}
            </Text>
          </Box>
          {r.said !== undefined && <Text dimColor>你上次說：{r.said}</Text>}
          {r.state !== 'fixing' && (
            <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1}>
              {el.web === true ? <Text dimColor>要看的地方在這個網頁「待你決定」的「待你驗收」</Text> : url === undefined ? <Text dimColor>要看的地方在待你決定頁的「待你驗收」，頁面發佈後會有連結</Text> : ReviewLink({ el, url })}
              {r.confirm === undefined ? (
                <Button key={`acc-pass-${r.feature}`} label="通過" variant="primary" onPress={() => act.accept(r.feature, 'passed', undefined, r.mark)} />
              ) : (
                <Text color="suggestion" wrap="wrap">
                  有 {r.confirm} 項要你驗收時確認：在「待你驗收」卡片上逐項勾選後再按通過。
                </Text>
              )}
            </Box>
          )}
          {r.state !== 'fixing' && Field({ el, id: `acc-change-${r.feature}`, label: '要改', placeholder: '哪裡不對、要改成怎樣', submit: '要改', what: '要改的地方', onSubmit: text => act.accept(r.feature, 'changes', text, r.mark) })}
        </Box>
      ))}
      {MoreLine({ el, act, id: 'accepts', total: all.rows.length, all: rows.all, noun: '項' })}
    </Box>
  )
}

/** What the app kept up for the person's acceptance is doing, in a few words: the pane's line and crew's web page's. */
export const acceptAppWords = (a: AcceptAppRow): string => {
  const served = a.features.length === 0 ? '' : `：${a.features.join('、')}`
  if (a.state === 'up') return `驗收用的 app 開著（${a.sha ?? 'crew 分支'}）${served}${a.checking === undefined ? '' : `・QA 正在用它檢查 ${a.checking}`}`
  if (a.state === 'failed') return `驗收用的 app 開不起來：${a.why ?? '原因不明'}`
  if (a.state === 'theirs') return '網址上已經有不是 crew 開的程式在回應（可能是你自己的 app），crew 沒有另外開'
  if (a.state === 'closing') return `驗收用的 app 關掉中：QA 正在用它檢查 ${a.checking ?? '一個功能'}，檢查完 crew 就關掉`
  const why = a.checking !== undefined ? `換到 QA 要檢查 ${a.checking} 的版本` : a.phase === 'qa' ? '等 QA 的工作目錄空出來' : a.phase === 'tests' ? '等正在跑的測試和合回結束' : '等 app 開起來'
  return `驗收用的 app 正在開：${why}${a.phase === 'app' && a.waitS !== undefined ? `，最多再等 ${a.waitS} 秒` : ''}`
}

/**
 * crew's test runs and merges waiting for the app kept for acceptance to
 * close, as the card and the pane say it: nothing when none waits. Merges held
 * hold the full-stack's work in crew's worktree too (it goes in once they are over).
 */
export const appWaitWords = (a: AcceptAppRow): string | undefined => {
  const n = a.waits.tests + a.waits.merges
  if (n === 0) return undefined
  return `${n} 個合回／測試在等${a.state === 'closing' ? ' app 關掉' : '你關掉 app'}${a.waits.merges > 0 ? '，全端在 crew 工作目錄的工作也會等' : ''}`
}

/** The app kept up for acceptance, on the pane's 待你驗收: what it is doing, what waits for it, and the person's ［關掉 app］. */
function AcceptAppLine({ el, a, close }: { el: Elements; a: AcceptAppRow; close: () => void | Promise<void> }) {
  const { Box, Text, Button } = el
  const waits = appWaitWords(a)
  const down = a.state === 'failed' || a.state === 'theirs'
  return (
    <Box key="acc-app" flexDirection="column" rowGap={ROW_GAP} {...look(el, 'item')}>
      <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1}>
        <Text color={a.state === 'failed' ? 'error' : a.state === 'up' ? 'success' : 'suggestion'} wrap="wrap">
          {acceptAppWords(a)}
        </Text>
        {/* Closing already: it stops as QA's check ends, with nothing more for the person to press. */}
        {a.state !== 'closing' && <Button key="acc-app-close" label={down ? '不用了' : '關掉 app'} onPress={() => void close()} />}
      </Box>
      {waits !== undefined && (
        <Text color="warning" wrap="wrap">
          {waits}
        </Text>
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
export const waitingCount = (snap: Snapshot): number => snap.decisions.reduce((n, d) => n + (d.count ?? 1), 0)

/** Another crew on this repo, in the words the overview and the minimal pane say it. */
const twinWords = (twin: string): string =>
  twin === '另一個 Claude Code session'
    ? '⚠ 這個專案在另一個 Claude Code session（終端機或桌面版）也開著 crew：兩邊會互相蓋掉看板和決定。關掉其中一個，留下的那一個按［接續］接著做。'
    : `⚠ 另一份 crew（${twin}）也在做這個 repo：兩份會互相蓋掉看板和設計稿的決定。關掉其中一個 Claude Code，留下的那一個按［接續］接著做。`

/**
 * Everything 待你決定 holds for the person, as the minimal pane and the page's
 * tab count it: the decisions, the features to accept (not those being changed
 * now), the questions on a role's model, the draft to confirm, a stopped PRD
 * offered to go on with or a flow stopped on its own (not the person's own
 * pause), and another crew's progress offered to take over.
 */
export const waitingAll = (snap: Snapshot): number =>
  waitingCount(snap) +
  (snap.accepts?.rows.filter(r => r.state !== 'fixing').length ?? 0) +
  (snap.modelAsks?.length ?? 0) +
  (snap.takeover?.on === true && snap.takeover.draft !== undefined ? 1 : 0) +
  (snap.start?.resumable !== undefined && (snap.start.paused !== true || snap.start.stalled === true) ? 1 : 0) +
  (snap.carry !== undefined ? 1 : 0)

/** One thing that waits for the person, with what settles it: an answer, a press, or a reason to send a design back. */
function DecisionRow({ el, d, act }: { el: Elements; d: Decision; act: Actions }) {
  const { Box, Text, Button } = el
  const who = d.from === 'crew' ? 'crew' : d.from === 'brain' ? '大腦' : ROLE_NAMES[d.from]
  if (el.web === true) return WebDecision({ el, d, act, who })
  // A question with buttons has them on a row of their own, so a long question wraps across the pane and not beside them.
  // The review row is one line for many designs: its question says what it is, with no number of its own.
  const head = <Text>{d.kind === 'review' ? d.question : `${d.id} ${d.question}`}</Text>
  return (
    <Box flexDirection="column" rowGap={ROW_GAP}>
      {d.kind !== undefined && head}
      <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1}>
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
        {d.kind === 'app' && AppPresses({ el, d, act })}
      </Box>
      {d.kind === 'verify' && VerifyPresses({ el, d, act })}
      {d.holds !== undefined && (
        <Text color="suggestion" wrap="wrap">
          {d.holds}
        </Text>
      )}
      {d.kind === undefined && d.picture !== undefined && <Text dimColor>{d.picture}</Text>}
      {d.kind === undefined && d.mentions !== undefined && (
        <Box flexDirection="column">
          <Text dimColor>提到的項目（crew 附上的原文）：</Text>
          {d.mentions.map(m => Row({ el, cells: [['16%', m.id, { dimColor: true }], ['84%', `${m.kind}：${m.text}`, { dimColor: true }]] }))}
        </Box>
      )}
      {d.kind === undefined && d.options !== undefined && (
        <Box flexDirection="column" rowGap={ROW_GAP}>
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

/** crew's question on starting the app: QA's proposal taken as it is, or the settings tab, where the fields hold it. */
function AppPresses({ el, d, act }: { el: Elements; d: Decision; act: Actions }) {
  const { Button } = el
  return [
    ...(d.appYes === undefined ? [] : [<Button key={`app-yes-${d.id}`} label={d.appYes} variant="primary" onPress={() => act.answer(d.id, d.appYes ?? '')} />]),
    <Button key={`app-settings-${d.id}`} label={d.appYes === undefined ? '去設定' : '改設定'} onPress={() => act.tab('settings')} />,
  ]
}

/**
 * crew's card of QA's proposals on how test cases are verified: each test
 * case on a row of its own, with the way QA proposes, why, and the person's
 * press on it; then the presses on all of them. Only the person's press sets one.
 */
function VerifyPresses({ el, d, act }: { el: Elements; d: Decision; act: Actions }) {
  const { Box, Text, Button } = el
  const cases = d.verify ?? []
  return (
    <Box key={`verify-${d.id}`} flexDirection="column" rowGap={ROW_GAP}>
      {cases.map(c => (
        <Box key={`verify-row-${d.id}-${c.id}`} flexDirection="column" {...look(el, 'note')}>
          <Text wrap="wrap">
            {c.id} {c.title}：{c.way}
          </Text>
          <Text dimColor wrap="wrap" {...look(el, 'cap')}>
            QA 的理由：{c.reason}
          </Text>
          <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1}>
            <Button key={`verify-one-${d.id}-${c.id}`} label={VERIFY_ONE} onPress={() => act.answer(d.id, `${VERIFY_ONE} ${c.id}`)} />
            <Button key={`verify-not-${d.id}-${c.id}`} label={VERIFY_NOT} onPress={() => act.answer(d.id, `${VERIFY_NOT} ${c.id}`)} />
          </Box>
        </Box>
      ))}
      <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1} {...look(el, 'opts')}>
        <Button key={`verify-all-${d.id}`} label={VERIFY_ALL} variant="primary" onPress={() => act.answer(d.id, VERIFY_ALL)} />
        <Button key={`verify-none-${d.id}`} label={VERIFY_NONE} onPress={() => act.answer(d.id, VERIFY_NONE)} />
      </Box>
    </Box>
  )
}

/** What kind of thing waits, as the page's chip says it, and the chip's colour. */
const DECISION_CHIPS: Record<NonNullable<Decision['kind']> | 'question', [string, string]> = {
  question: ['問題', 'wait'],
  design: ['設計稿', 'kind'],
  proposal: ['提案', 'kind'],
  review: ['待你決定頁', 'kind'],
  app: ['app 設定', 'kind'],
  verify: ['驗證方式', 'kind'],
}

/**
 * A decision as the page draws it, one card each: what kind it is, its
 * number and who asked, the question in full, what waits on it, then the
 * presses that settle it. The same keys as the pane's, the same actions.
 */
function WebDecision({ el, d, act, who }: { el: Elements; d: Decision; act: Actions; who: string }) {
  const { Box, Text, Button } = el
  const [chip, tone] = DECISION_CHIPS[d.kind ?? 'question']
  return (
    <Box key={`decision-${d.id}`} flexDirection="column" rowGap={ROW_GAP} {...look(el, 'item')}>
      <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1} {...look(el, 'item-head')}>
        <Text {...look(el, `chip ${tone}`)}>{chip}</Text>
        {d.kind !== 'review' && <Text {...look(el, 'mono')}>{d.id}</Text>}
        <Text dimColor {...look(el, 'cap')}>
          {who}・{d.age}
        </Text>
      </Box>
      <Text wrap="wrap" {...look(el, 'md')}>
        {d.question}
      </Text>
      {d.kind === undefined && d.picture !== undefined && (
        <Text dimColor {...look(el, 'cap')}>
          {d.picture}
        </Text>
      )}
      {d.kind === undefined && d.mentions !== undefined && (
        <Box flexDirection="column" {...look(el, 'note')}>
          <Text dimColor>提到的項目（crew 附上的原文）：</Text>
          {d.mentions.map(m => Row({ el, cells: [['16%', m.id, { dimColor: true }], ['84%', `${m.kind}：${m.text}`, { dimColor: true }]] }))}
        </Box>
      )}
      {d.kind === undefined && d.options !== undefined && (
        <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1} {...look(el, 'opts')}>
          {d.options.map((o, i) => (
            <Button key={`option-${d.id}-${i}`} label={`${'ABCD'.charAt(i)} ${o}`} onPress={() => act.answer(d.id, o)} />
          ))}
        </Box>
      )}
      {d.kind !== undefined && (
        <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1} {...look(el, 'opts')}>
          {d.kind === 'design' && d.design !== undefined && <Button key={`view-${d.design}`} label="看設計稿" onPress={() => act.viewDesign(d.design ?? null)} />}
          {(d.kind === 'review' || d.kind === 'design') && d.url !== undefined && ReviewLink({ el, url: d.url })}
          {d.kind === 'review' && d.url !== undefined && <Button key="read-page" label="我在頁面上決定好了" onPress={() => act.readPage()} />}
          {d.kind === 'review' && d.inPane === true && <Button key="review-in-pane" label="改在面板和網頁決定" onPress={() => act.reviewInPane()} />}
          {(d.kind === 'design' || d.kind === 'proposal') && <Button key={`approve-${d.id}`} label="核准" variant="primary" onPress={() => act.approve(d.id)} />}
          {d.kind === 'proposal' && <Button key={`reject-${d.id}`} label="不要" onPress={() => act.reject(d.id)} />}
          {d.kind === 'app' && AppPresses({ el, d, act })}
        </Box>
      )}
      {d.kind === undefined && Field({ el, id: `answer-${d.id}`, label: '回答', placeholder: d.options === undefined ? '你的回答' : '或自己寫', submit: '送出', what: '回答', onSubmit: text => act.answer(d.id, text) })}
      {d.kind === 'design' && Field({ el, id: `reject-${d.id}`, label: '退回原因', placeholder: '要改什麼', submit: '退回', what: '退回原因', onSubmit: text => act.reject(d.id, text) })}
      {d.kind === 'verify' && VerifyPresses({ el, d, act })}
      {d.holds !== undefined && (
        <Text color="suggestion" wrap="wrap" {...look(el, 'cap')}>
          {d.holds}
        </Text>
      )}
    </Box>
  )
}

/** The decide page, first in the overview whatever waits: the progress map is on it. */
function PageRow({ el, snap, act }: { el: Elements; snap: Snapshot; act: Actions }) {
  const { Box, Text, Button } = el
  const page = snap.decidePage
  if (page === undefined) return null
  // A failure the person did not choose is a warning; the rest is said quietly.
  const broken = page.failed !== undefined && page.chose !== true
  // On the web the person is on crew's own page: "the pane" alone would send them looking for it, and "the page" would be read as this one.
  const chose = el.web === true ? '你選了在面板和這個網頁決定' : '你選了在面板決定'
  const instead = el.web === true ? '這個網頁' : '下方面板'
  const that = el.web === true ? '待你決定頁' : '這頁'
  const state =
    page.chose === true
      ? page.failed !== undefined
        ? `${chose}；${that}${page.url === undefined ? '發佈' : '更新'}不了：${cut(page.failed, 80)}`
        : page.url === undefined
          ? page.asked === true
            ? `${chose}：${el.web === true ? '待你決定頁' : '頁面'}發佈中，只給你看`
            : `${chose}：有東西給你看時會發佈${that}，只給你看`
          : `${chose}：${that}照樣更新，只給你看`
      : page.failed !== undefined
        ? `${page.url === undefined ? '發佈不了' : '更新不了'}：${cut(page.failed, 80)}。要決定的事改在${instead}決定`
        : page.url === undefined
          ? page.asked === true
            ? '發佈中，好了連結會出現在這裡'
            : '還沒有發佈，crew 有東西給你看時就會發佈'
          : page.brain === true
            ? '有新進度，等大腦更新'
            : snap.pageDue === true
              ? '有新進度，等下一個動作更新'
              : page.byBrain === true
                ? '大腦發佈的版本：進度圖只在有事等你決定時更新'
                : '已是最新'
  return (
    <Box key="page-row" flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1}>
      <Text bold>待你決定頁（含進度圖）</Text>
      {page.url !== undefined && ReviewLink({ el, url: page.url })}
      <Text color={broken ? 'warning' : undefined} dimColor={!broken}>
        {state}
      </Text>
      {/* The pane chosen, or the page given up on: the way back, on a new page if the link is gone for this account. */}
      {(page.failed !== undefined || page.chose === true) && <Button key="review-on-page" label={page.chose === true ? (el.web === true ? '改回待你決定頁決定' : '改回網頁決定') : '再發佈一次'} onPress={() => act.reviewOnPage()} />}
    </Box>
  )
}

/** The decide page's link: a link where the surface draws one, else the address to open. */
function ReviewLink({ el, url }: { el: Elements; url: string }) {
  const { Text, Link } = el
  return <Text key="review-url">{Link === undefined ? `開待你決定頁：${url}` : <Link href={url} label="［開待你決定頁 ↗］" />}</Text>
}

/**
 * The repo's PRDs to pick from, each by its file name: a picker where the
 * surface has one, a button for each where it has none (a phone). The one
 * picked shows its folder and title underneath, cut to the pane.
 */
function PrdPicker({ el, snap, act, id, label }: { el: Elements; snap: Snapshot; act: Actions; id: string; label?: string }) {
  const { Box, Text, Button, Select } = el
  const prds = snap.start?.prds ?? []
  const chosen = prds.find(p => p.path === snap.start?.chosen) ?? prds[0]
  if (chosen === undefined) return null
  const file = (path: string): string => path.slice(path.lastIndexOf('/') + 1)
  // A file name two PRDs share is no way to tell them apart: those show their whole path.
  const name = (path: string): string => (prds.filter(q => file(q.path) === file(path)).length > 1 ? path : file(path))
  const folder = chosen.path.includes('/') ? chosen.path.slice(0, chosen.path.lastIndexOf('/') + 1) : ''
  return (
    <Box flexDirection="column" flexShrink={1} minWidth={0}>
      {Select !== undefined ? (
        <Select key={id} {...(label === undefined ? {} : { label })} value={chosen.path} options={prds.map(p => ({ value: p.path, label: name(p.path) }))} onSelect={(path: string) => act.pick(path)} />
      ) : (
        prds.map((p, i) => <Button key={`prd-option-${i}`} label={name(p.path)} variant={p.path === chosen.path ? 'primary' : 'secondary'} onPress={() => act.pick(p.path)} />)
      )}
      <Text dimColor wrap="truncate-end">
        {folder}
        {folder !== '' && chosen.title !== '' ? '・' : ''}
        {chosen.title}
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
    <Box flexDirection="column" rowGap={ROW_GAP}>
      <Text bold color={draft.stage === 'confirm' ? 'suggestion' : undefined}>
        {draft.stage === 'confirm' ? 'PRD 草稿等你確認' : 'PRD 草稿'}：{draft.path}　{draft.title}（{draft.requirements} 條需求）
      </Text>
      <Text>審查：{reviewsLine(draft)}</Text>
      {draft.stage === 'confirm' && draft.note !== undefined && <Text>大腦：{draft.note}</Text>}
      {draft.url !== undefined && ReviewLink({ el, url: draft.url })}
      {draft.stage === 'confirm' && draft.change !== undefined && <Text>你要改：{draft.change}（大腦修改中，改好會再請你確認）</Text>}
      {draft.stage === 'confirm' && draft.asks !== undefined && (
        <Text color="suggestion">先在「待你決定」回答確認之前要你拍板的 {draft.asks.length} 題（{draft.asks.join('、')}）；大腦照回答改好草稿，才能確認開始。</Text>
      )}
      {draft.stage === 'confirm' && (draft.change !== undefined || draft.asks !== undefined) ? null : draft.stage === 'confirm' ? (
        <Box flexDirection="row" gap={1}>
          <Button key="confirm-draft" label="確認，開始" variant="primary" onPress={() => act.confirmDraft()} />
          <Text dimColor>在主對話回覆大腦也可以。開始後 PM 先把它拆成功能和驗收條件。</Text>
        </Box>
      ) : settled && failedOf(draft).length > 0 ? (
        <Text color="warning">{sentOut(draft) ? `有審查沒有完成，已經送審 ${MAX_SENDS} 次：在主對話告訴大腦要不要照現在的草稿確認。` : '有審查沒有完成：在主對話請大腦重新送審。'}</Text>
      ) : settled ? (
        <Text dimColor>審完了，大腦會整理缺口，放進「待你決定」問你；重開過 Claude Code 的話，在主對話請大腦接著做。</Text>
      ) : (
        <Text dimColor>審完後，大腦會整理缺口，放進「待你決定」問你。</Text>
      )}
    </Box>
  )
}

/** Another copy of crew holds this repo's PRD under way: brought over by the person's press, with the commands it would run said first. */
function CarryCard({ el, c, act }: { el: Elements; c: NonNullable<Snapshot['carry']>; act: Actions }) {
  const { Box, Text, Button } = el
  const comes = [...(c.tests === undefined ? [] : [`測試指令 ${c.tests}`]), ...(c.setup === undefined ? [] : [`準備指令 ${c.setup}`]), '設計稿的決定、待你決定頁和 crew 分支的紀錄']
  return (
    <Box flexDirection="column" rowGap={ROW_GAP}>
      <Text color="suggestion">這個 repo 的進度在另一份 crew 裡（{c.from}）：</Text>
      <Text>
        {c.prd} 停在「{c.stage}」{c.waits > 0 ? `，${c.waits} 件事等你決定` : ''}。
      </Text>
      <Text dimColor>會一起接過來：{comes.join('、')}。另一份 crew 的紀錄不會改。</Text>
      {c.recent === true && <Text color="warning">那一份 crew 幾分鐘前還在寫入紀錄：先關掉用它開著這個 repo 的 Claude Code，再接過來。</Text>}
      <Box flexDirection="row" gap={1}>
        <Button key="carry" label="接過來" variant="primary" onPress={() => act.carry()} />
        <Button key="carry-no" label={c.rebuild === true ? '不要，從看板重建' : '不要'} onPress={() => act.skipCarry()} />
      </Box>
    </Box>
  )
}

/** What crew offers when it loads with no PRD: the brain to take over, one picked from the repo or typed, or not now. */
function StartScreen({ el, snap, view, act }: { el: Elements; snap: Snapshot; view: View; act: Actions }) {
  const { Box, Text, Button } = el
  const takenOver = snap.takeover?.on === true
  const drafting = takenOver && snap.takeover?.draft !== undefined
  const listed = (snap.start?.prds ?? []).length > 0
  // With no PRD in the repo to pick, the path field is the way to start.
  const typing = !listed || view.shown.includes('prd-path')
  return (
    <Box flexDirection="column" gap={1}>
      {!takenOver && <Text bold>還沒有開始的 PRD</Text>}
      {snap.boardProblem !== undefined && <Text color="warning">⚠ {snap.boardProblem.text}</Text>}
      {snap.takeover?.on === false && (
        <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1}>
          <Button key="takeover-on" label="讓大腦接手這個 repo" variant="primary" onPress={() => act.takeover(true)} />
          <Text dimColor>大腦從你的第一句話開始帶：寫 PRD、分派工作</Text>
        </Box>
      )}
      {!drafting && (
        <Box flexDirection="column" rowGap={ROW_GAP}>
          {listed && <Text dimColor>{takenOver ? '已經有寫好的 PRD，也可以直接選：' : snap.takeover?.on === false ? '或自己選一份：' : '選一份 PRD：'}</Text>}
          {listed && (
            <Box flexDirection="row" columnGap={1}>
              <Box width={6} flexShrink={0}>
                <Text>PRD</Text>
              </Box>
              {PrdPicker({ el, snap, act, id: 'prd-pick' })}
            </Box>
          )}
          <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1} paddingLeft={listed ? 7 : 0}>
            {listed && <Button key="start" label="開始" variant={takenOver ? 'secondary' : 'primary'} onPress={() => act.start()} />}
            {!takenOver && <Button key="not-now" label="這次不用" onPress={() => act.notNow()} />}
            {listed && <Button key="prd-path-open" label="輸入其他路徑" plain onPress={() => act.toggle('prd-path')} />}
          </Box>
          {typing && Field({ el, id: 'prd-path', label: '路徑', placeholder: 'docs/PRD.md', submit: '開始', what: 'PRD 路徑', onSubmit: path => act.start(path) })}
        </Box>
      )}
    </Box>
  )
}

/** Codex as crew last found it: what the line says, and its color. */
const codexLine = (codex: Engines['codex']): [string, string] => {
  // A ChatGPT login is the usual one and goes unsaid; an API key is said, as its use is paid by the token.
  const login = codex.state === 'ready' && codex.login !== 'chatgpt' ? '（API key）' : ''
  if (codex.state === 'ready' && codex.limited !== undefined) return [`Codex ⚠ 額度用完，${codex.limited}`, 'warning']
  if (codex.state === 'ready') return [`Codex ✓ 已登入${login}・${codex.version}・${codex.checked}檢查`, 'success']
  if (codex.state === 'logged-out') return [`Codex ✗ 還沒登入・${codex.version}・${codex.checked}檢查`, 'warning']
  return [`Codex ✗ 這台電腦找不到 codex 指令・${codex.checked}檢查`, 'warning']
}

/** Whether Codex can take work now: found, logged in, with quota left. */
const codexOpen = (codex: Engines['codex']): boolean => codex.state === 'ready' && codex.limited === undefined

/** A model's name as the pane says it, on its engine. */
const modelName = (engine: Engine, model: string): string => (engine === 'claude' ? labelOf(model) : codexLabel(model))

/** The rotation thresholds a person may fix a role at; `tier` follows how hard the work is, and the brain may tune it. */
const LIMITS = ['tier', '60000', '100000', '160000', '200000', '256000'] as const

/**
 * Two picks, a model and an effort, on one engine: a role's floor there, or
 * the model it is fixed on. On Claude, each family's newest (which follows new
 * releases) and the older generations crew keeps, each with the efforts it takes.
 */
function Picks({ el, role, engine, pick, prefix, label, models, act }: { el: Elements; role: RoleId; engine: Engine; pick: Pick; prefix: string; label?: string; models: readonly string[]; act: (change: Partial<Pick>) => void | Promise<void> }) {
  const { Box, Text, Select } = el
  const choices = engine === 'claude' ? { models: claudeFixedModels(), efforts: claudeEfforts(pick.model) } : { models: codexChoices(role).models.filter((m: string) => models.includes(m)), efforts: codexChoices(role).efforts }
  const named = (m: string): string => (engine === 'claude' && (CLAUDE_MODELS as readonly string[]).includes(m) ? `${modelName(engine, m)}（最新）` : modelName(engine, m))
  const effort = engine === 'claude' ? (fitEffort(pick.model, pick.effort) ?? pick.effort) : pick.effort
  if (Select === undefined) return <Text>{pickSaid(engine, pick)}</Text>
  return (
    <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1}>
      <Select key={`${prefix}-model`} {...(label === undefined ? {} : { label })} value={pick.model} options={choices.models.map(m => ({ value: m, label: named(m) }))} onSelect={(m: string) => act({ model: m })} />
      {choices.efforts.length === 0 ? (
        <Text dimColor>這個模型沒有 effort</Text>
      ) : (
        <Select key={`${prefix}-effort`} value={effort} options={choices.efforts.map(e => ({ value: e, label: e }))} onSelect={(e: string) => act({ effort: e })} />
      )}
    </Box>
  )
}

/** What a role fixed on Codex waits for while Codex cannot take it, as the heartbeat says it: what comes back by itself, and what is the person's. */
const codexWait = (codex: Engines['codex']): string =>
  codex.state === 'missing' ? '這台電腦找不到 codex 指令，裝好之後按上面的［重新檢查］' : codex.state === 'logged-out' ? 'Codex 還沒登入，登入後 crew 會自己接續一次' : `Codex 額度用完（${codex.limited ?? ''}），時間到了 crew 會自己接續一次`

/**
 * The engine a role not at work starts its next work on, where its last run
 * was on the other one: the person or the brain moved it since. None while
 * Codex cannot run, where 模型 says what happens instead.
 */
export const nextEngine = (r: RoleRow, engines: Engines | undefined): Engine | undefined => {
  if (r.state === 'working' || engines === undefined) return undefined
  const m = engines.roles[r.id]
  const next = m.mode === 'fixed' ? m.fixed.engine : m.now
  if (next === 'codex' && !codexOpen(engines.codex)) return undefined
  return next === (r.engine ?? 'claude') ? undefined : next
}

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

/** A role's models table's columns: role, how it picks, where it starts on each engine, rotation, the button. */
const MODEL_COLUMNS: readonly [string, string][] = [
  ['14%', '角色'],
  ['14%', '方式'],
  ['46%', '起點：Claude／Codex'],
  ['14%', '輪替'],
]

/** A line of a role's editor: what is set, then its controls. */
function EditLine({ el, name, body }: { el: Elements; name: string; body: unknown }) {
  const { Box, Text } = el
  return (
    <Box flexDirection="row" columnGap={1}>
      <Box width={10} flexShrink={0}>
        <Text dimColor>{name}</Text>
      </Box>
      <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1} flexShrink={1} minWidth={0}>
        {body}
      </Box>
    </Box>
  )
}

/**
 * One role's models in a line: how it picks them, where it starts on each
 * engine, its rotation threshold; 「調整」 opens its editor underneath: the
 * way it picks, the engine it uses first, each engine's starting model, the
 * threshold, and the steps harder work climbs.
 */
function RoleModelsRow({ el, view, role, r, engines, ask, blocked, act, isDemo }: { el: Elements; view: View; role: RoleId; r: RoleModels; engines: Engines; ask: ModelAsk | undefined; blocked: boolean; act: Actions; isDemo: boolean }) {
  const { Box, Text, Button, Select } = el
  const [now, color] = nowWords(r, engines, ask, blocked)
  const limitValue = r.limit === 'tier' ? 'tier' : String(r.limit)
  const open = view.shown.includes(`models-${role}`)
  const start = r.mode === 'fixed' ? `固定 ${pickSaid(r.fixed.engine, r.fixed)}` : `${pickSaid('claude', r.floors.claude)}／${pickSaid('codex', r.floors.codex)}`
  const limit = r.limit !== 'tier' ? `${r.limit / 1000}K` : r.tuned === undefined ? '依難易度' : `大腦調成 ${r.tuned.limit / 1000}K`
  // Under the row only what needs the person: a role stopped, waiting, or about to change. The rest is in its editor.
  return (
    <Box flexDirection="column" rowGap={ROW_GAP}>
      {Row({
        el,
        cells: [
          [MODEL_COLUMNS[0]?.[0] ?? '14%', ROLE_NAMES[role]],
          [MODEL_COLUMNS[1]?.[0] ?? '14%', r.mode === 'fixed' ? '自己挑選' : '系統預設', { dimColor: true }],
          [MODEL_COLUMNS[2]?.[0] ?? '46%', start],
          [MODEL_COLUMNS[3]?.[0] ?? '14%', limit, { dimColor: r.tuned === undefined }],
        ],
        tail: <Button key={`models-${role}`} label={open ? '收起' : '調整'} variant={open ? 'primary' : 'secondary'} onPress={() => act.toggle(`models-${role}`)} />,
      })}
      {(color !== undefined || ask !== undefined) && (
        <Box paddingLeft={2}>
          <Text color={color} wrap="wrap">
            {now}
          </Text>
        </Box>
      )}
      {open && (
        <Box flexDirection="column" rowGap={ROW_GAP} paddingLeft={2} marginBottom={1}>
          {color === undefined && ask === undefined && (
            <Text dimColor wrap="wrap">
              {now}
            </Text>
          )}
          {EditLine({
            el,
            name: '方式',
            body: [
              <Button key={`mode-${role}-auto`} label="系統預設" variant={r.mode === 'auto' ? 'primary' : 'secondary'} onPress={() => act.roleMode(role, 'auto')} />,
              <Button key={`mode-${role}-fixed`} label="自己挑選" variant={r.mode === 'fixed' ? 'primary' : 'secondary'} onPress={() => act.roleMode(role, 'fixed')} />,
            ],
          })}
          {r.mode === 'auto' &&
            EditLine({
              el,
              name: '先用',
              body: [
                <Button key={`engine-${role}-claude`} label="Claude" variant={(r.chose ?? 'claude') === 'claude' ? 'primary' : 'secondary'} onPress={() => act.roleEngine(role, 'claude')} />,
                <Button key={`engine-${role}-codex`} label="Codex" variant={r.chose === 'codex' ? 'primary' : 'secondary'} onPress={() => act.roleEngine(role, 'codex')} />,
              ],
            })}
          {r.mode === 'auto' &&
            (['claude', 'codex'] as const).map(engine =>
              EditLine({ el, name: `${ENGINE_NAMES[engine]} 起點`, body: Picks({ el, role, engine, pick: r.floors[engine], prefix: `floor-${role}-${engine}`, models: engines.models, act: pick => act.roleFloor(role, engine, pick) }) }),
            )}
          {r.mode === 'fixed' &&
            EditLine({
              el,
              name: '引擎',
              body: (['claude', 'codex'] as const).map(e =>
                // Codex not on this machine cannot be picked: a role fixed on it would only stop.
                e === 'codex' && engines.codex.state === 'missing' && r.fixed.engine !== 'codex' ? (
                  <Text key={`fixed-${role}-${e}`} dimColor>
                    Codex（這台電腦找不到）
                  </Text>
                ) : (
                  <Button key={`fixed-${role}-${e}`} label={ENGINE_NAMES[e]} variant={r.fixed.engine === e ? 'primary' : 'secondary'} onPress={() => act.roleFixed(role, { engine: e })} />
                ),
              ),
            })}
          {r.mode === 'fixed' && EditLine({ el, name: '模型', body: Picks({ el, role, engine: r.fixed.engine, pick: r.fixed, prefix: `fixed-${role}`, models: engines.models, act: change => act.roleFixed(role, change) }) })}
          {EditLine({
            el,
            name: '輪替門檻',
            body:
              // The person setting it is not wired yet: the real pane says so rather than offer a select that does nothing.
              !isDemo ? (
                <Text>
                  {r.limit === 'tier' ? '依難易度' : `${r.limit / 1000}K`}
                  <Text dimColor>（自己設定：規劃中）</Text>
                </Text>
              ) : Select !== undefined ? (
                <Select key={`limit-${role}`} value={limitValue} options={LIMITS.map(v => ({ value: v, label: v === 'tier' ? '依難易度' : `${Number(v) / 1000}K` }))} onSelect={(v: string) => act.roleLimit(role, v === 'tier' ? 'tier' : Number(v))} />
              ) : (
                <Text>{r.limit === 'tier' ? '依難易度' : `${r.limit / 1000}K`}</Text>
              ),
          })}
          {r.mode === 'auto' && r.tuned !== undefined && r.limit === 'tier' && (
            <Text dimColor>
              大腦調成 {r.tuned.limit / 1000}K（{r.tuned.by}）
            </Text>
          )}
          {r.mode === 'auto' ? (
            <Box flexDirection="column">
              <Text dimColor wrap="wrap">越難越往上（Claude）：{ladderOf(role, 'claude', r.floors.claude)}</Text>
              <Text dimColor wrap="wrap">越難越往上（Codex）：{ladderOf(role, 'codex', r.floors.codex)}</Text>
              {r.limit === 'tier' && <Text dimColor>輪替門檻依難易度：{limitsByTier()}</Text>}
            </Box>
          ) : (
            <Text dimColor wrap="wrap">固定用 {pickSaid(r.fixed.engine, r.fixed)}：不升級，大腦也不換；一直失敗時 crew 會問你</Text>
          )}
        </Box>
      )}
    </Box>
  )
}

/** The questions on a role's model, apart from what else waits for the person: each with its two answers. */
function ModelAsks({ el, asks, act, hints = true }: { el: Elements; asks: readonly ModelAsk[]; act: Actions; hints?: boolean }) {
  const { Box, Text, Button } = el
  return (
    <Box flexDirection="column" rowGap={ROW_GAP}>
      <Text color="warning" bold>
        模型的事（{asks.length}）
      </Text>
      {asks.map(a => (
        <Box flexDirection="column" rowGap={ROW_GAP}>
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

/** Each role's models, Codex as crew last found it, the models on offer, and whether the brain asks before it moves a role to another model. */
function ModelsTab({ el, snap, view, act, isDemo }: { el: Elements; snap: Snapshot; view: View; act: Actions; isDemo: boolean }) {
  const { Box, Text, Button } = el
  const engines = snap.engines
  // Codex not checked yet (the tab was open before any press on it, after a reset or a demo): the person checks it here.
  if (engines === undefined)
    return (
      <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1}>
        <Text dimColor>還沒檢查 Codex，檢查完才會列出各角色的模型。</Text>
        <Button key="codex-check" label="重新檢查" onPress={() => act.checkCodex()} />
      </Box>
    )
  const [line, color] = codexLine(engines.codex)
  const least = Object.keys(CODEX_MINIMUM).map(r => ROLE_NAMES[r as RoleId]).join(' 和 ')
  const claudeOffered = [...CLAUDE_MODELS].reverse().map(m => labelOf(m)).join('・')
  // Codex's newest of each family, strongest first; how many it lists in all.
  const families = new Map<string, string>()
  for (const m of [...engines.models].reverse()) {
    const family = /^gpt-[\d.]+-([a-z]+)$/.exec(m)?.[1] ?? m
    if (!families.has(family)) families.set(family, m)
  }
  const codexOffered = [...families.values()].map(m => codexLabel(m))
  const footer = view.shown.includes('help-models')
  return (
    <Box flexDirection="column" gap={1}>
      {snap.modelAsks !== undefined && snap.modelAsks.length > 0 && ModelAsks({ el, asks: snap.modelAsks, act, hints: false })}
      <Box flexDirection="column" rowGap={ROW_GAP}>
        <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1}>
          <Text color={color}>{line}</Text>
          <Button key="codex-check" label="重新檢查" onPress={() => act.checkCodex()} />
        </Box>
        {engines.codex.state !== 'ready' && (
          <Box flexDirection="column">
            {engines.codex.state === 'logged-out' && <Text dimColor wrap="wrap">在你自己的終端機執行 codex login（用 API key 就加 --with-api-key）。key 只交給 Codex，不要貼進對話。</Text>}
            {engines.codex.state === 'missing' && <Text dimColor wrap="wrap">在終端機執行 npm install -g @openai/codex 安裝並登入。</Text>}
            <Text dimColor>登入或額度恢復後，crew 會自己發現，不用重開 Claude Code。</Text>
          </Box>
        )}
      </Box>
      <Box flexDirection="column" rowGap={ROW_GAP}>
        {SettingRow({
          el,
          view,
          act,
          id: 'switch',
          name: '大腦換模型前',
          body: [
            <Button key="ask-switch-on" label="先問你" variant={engines.askBeforeSwitch ? 'primary' : 'secondary'} onPress={() => act.askBeforeSwitch(true)} />,
            <Button key="ask-switch-off" label="不用問" variant={engines.askBeforeSwitch ? 'secondary' : 'primary'} onPress={() => act.askBeforeSwitch(false)} />,
          ],
          help: engines.askBeforeSwitch
            ? '大腦要換引擎、模型或 effort 前（依難易度往上、失敗後升級、Codex 不能用時改用 Claude 都算），先在「模型的事」問你，那個角色等你回答。你自己挑選的角色不會被換；它卡住時一樣會問你。'
            : '大腦自己換引擎、模型或 effort，事後記成決定。你自己挑選的角色不會被換；它卡住時會問你。',
        })}
        {SettingRow({
          el,
          view,
          act,
          id: 'catalog',
          name: '可用模型',
          body: (
            <Box flexDirection="column" minWidth={0}>
              <Text wrap="truncate-end">
                Claude：{claudeOffered}
                <Text color="success">（跟著 Claude Code 更新）</Text>
              </Text>
              <Text wrap="truncate-end">
                Codex：{codexOffered.join('・')}
                {engines.models.length > codexOffered.length ? ` 等 ${engines.models.length} 個` : ''}
                <Text color="success">（讀 codex 的清單）</Text>
              </Text>
            </Box>
          ),
          help: '選「最新」的角色跟著新版本走：Claude Code 更新後，crew 查一次各系列最新是哪一版。舊版本也可以選，例如 Fable 5.1；Opus 只列最新。Codex 的清單照 codex 自己列出的。',
        })}
      </Box>
      <Box flexDirection="column" rowGap={ROW_GAP}>
        {Row({ el, cells: MODEL_COLUMNS.map(([w, t]) => [w, t, { dimColor: true }] as [string, string, Record<string, unknown>]), head: true })}
        {ROLE_IDS.map(r =>
          RoleModelsRow({
            el,
            view,
            role: r,
            r: engines.roles[r],
            engines,
            // Crew's question, which holds the role's work, before the brain's.
            ask: snap.modelAsks?.find(a => a.role === r && a.from === 'crew') ?? snap.modelAsks?.find(a => a.role === r),
            // Stopped because the person said to wait for Codex, not for another reason.
            blocked: snap.roles.some(x => x.id === r && x.state === 'blocked' && x.doing.startsWith(CODEX_WAIT)),
            act,
            isDemo,
          }),
        )}
      </Box>
      <Box flexDirection="column" rowGap={ROW_GAP}>
        <Box flexDirection="row" columnGap={1}>
          <Button key="help-models" label="?" variant={footer ? 'primary' : 'secondary'} onPress={() => act.toggle('help-models')} />
          <Text dimColor>系統預設、Codex 權限、各模型的用途</Text>
        </Box>
        {footer && (
          <Box flexDirection="column">
            <Text dimColor wrap="wrap">系統預設：用你設的「先用」引擎，大腦可以提議換。每件工作從起點開始，越難或失敗兩次往上一格。自己挑選：固定用你選的模型。換了從下一件工作生效。</Text>
            <Text dimColor wrap="wrap">Codex：Sol 寫程式和 review；Astra 最強也最貴，留給失敗過的難題；Terra 快，寫規格、文案和看畫面；Luna 最省，只適合抽取和分類。{least}在 Codex 上至少 6.1 Sol・xhigh。</Text>
            <Text dimColor wrap="wrap">輪替門檻依難易度時大腦可以調；你固定了，大腦就不動。門檻不會超過模型的 context。</Text>
            <Text dimColor wrap="wrap">Codex 角色的權限和 Claude 一樣：只有全端能改檔，而且只在 crew 的工作目錄；由沙箱守住，蓋過你 Codex 設定裡的 danger-full-access。Codex 用你在這台電腦的登入，額度另外算，crew 不經手金鑰。</Text>
          </Box>
        )}
      </Box>
    </Box>
  )
}

/** The phone's way in: the web page on the person's tailnet, through `tailscale serve`, and the devices paired with it. */
function TailnetSection({ el, view, tailnet, act }: { el: Elements; view: View; tailnet: NonNullable<NonNullable<Snapshot['web']>['tailnet']>; act: Actions }) {
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
    <Box flexDirection="column" rowGap={ROW_GAP}>
      {SettingRow({
        el,
        view,
        act,
        id: 'phone',
        name: '手機',
        body: [
          <Button key="tailnet-on" label="用 Tailscale 開放" variant={open ? 'primary' : 'secondary'} onPress={() => act.tailnet(true)} />,
          <Button key="tailnet-off" label="只限這台電腦" variant={open ? 'secondary' : 'primary'} onPress={() => act.tailnet(false)} />,
        ],
        help: '只有你 tailnet 裡、用你的帳號登入的裝置連得到。crew 用 tailscale serve，不用 funnel，不會公開到網路上。第一次在手機打開要輸入配對碼，之後這支手機就記住了。關掉 Claude Code，手機也連不到。',
      })}
      <Box flexDirection="column" rowGap={ROW_GAP} paddingLeft={NAME_WIDTH + 1}>
        <Text color={color} wrap="truncate-end">
          {line}
        </Text>
        {open && tailnet.url !== undefined && (
          <Box flexDirection="row" columnGap={1}>
            <Box flexShrink={1} minWidth={0}>
              <Text wrap="truncate-end">{tailnet.url}</Text>
            </Box>
            <Button key="pair-device" label="配對新裝置" onPress={() => act.pairDevice()} />
          </Box>
        )}
        {open &&
          tailnet.devices.map(d => (
            <Box flexDirection="row" columnGap={1}>
              <Box flexShrink={1} minWidth={0}>
                <Text wrap="truncate-end">
                  已配對：{d.name} · {d.paired}配對
                </Text>
              </Box>
              <Button key={`unpair-${d.id}`} label="移除" onPress={() => act.unpairDevice(d.id)} />
            </Box>
          ))}
      </Box>
    </Box>
  )
}

/** Where the day's tokens went, and what costs the most over the days crew recorded, with what is done about each. */
function AuditSection({ el, view, act, audit }: { el: Elements; view: View; act: Actions; audit: Audit }) {
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
      <Box flexDirection="column" rowGap={ROW_GAP}>
        {HelpLine({
          el,
          view,
          act,
          id: 'audit',
          line: '每一次執行都記在 .crew/usage/，不進 git，跨 session 留著',
          help: [
            '記的是 token、模型、工具和結果大小、技能、記憶、怎麼被叫起來。',
            '每件工作做完，crew 用程式重算一次瓶頸，不花 token。只有出現新的瓶頸，或處置過的又變大，才把那一條告訴大腦；每個 session 開始時，還沒處置完的再說一次。整份排行大腦和你隨時可以看。',
            '單次執行超標馬上提醒：工具結果超過 10K、context 超過門檻的 85%、快取命中率低於 60%。',
            '處置照「大腦處置」先問你或自動。',
          ],
        })}
        {audit.told !== undefined && (
          <Text dimColor wrap="truncate-end">
            上次告訴大腦：{audit.told}
          </Text>
        )}
      </Box>
    </Box>
  )
}


/**
 * Where crew is set up, one setting a line, its help behind 「?」: this repo's
 * (takeover, PRD, tests, worktree prep, QA in the app, builders at once), the
 * pane and the decide page, and upkeep (the board file, the flow).
 */
function Settings({ el, snap, view, act, isDemo }: { el: Elements; snap: Snapshot; view: View; act: Actions; isDemo: boolean }) {
  const { Box, Text, Button } = el
  const open = snap.settings?.openOnLoad ?? true
  const self = snap.settings?.selfPublish ?? true
  const selfFailed = snap.settings?.selfPublishFailed
  const agents = snap.settings?.agents ?? 4
  const prds = snap.start?.prds ?? []
  const row = (id: string, name: string, body: unknown, help?: string) => SettingRow({ el, view, act, id, name, body, ...(help === undefined ? {} : { help }) })
  return (
    <Box flexDirection="column" gap={1}>
      {SettingGroup({
        el,
        title: '這個 repo',
        rows: [
          snap.takeover !== undefined &&
            row(
              'takeover',
              '大腦接手',
              [
                <Button key="takeover-on" label="接手" variant={snap.takeover.on ? 'primary' : 'secondary'} onPress={() => act.takeover(true)} />,
                <Button key="takeover-off" label="不接手" variant={snap.takeover.on ? 'secondary' : 'primary'} onPress={() => act.takeover(false)} />,
                <Text dimColor wrap="truncate-end">{snap.takeover.on ? '大腦從第一句話起主導' : '你叫 crew 時它才做事'}</Text>,
              ],
              '接手後，在這個 repo 開 session，大腦從你的第一句話開始主導。只影響這個 repo；設定存在這台電腦，不進 git。',
            ),
          snap.prd !== null &&
            prds.length > 0 &&
            row('prd', 'PRD', [PrdPicker({ el, snap, act, id: 'prd-switch' }), <Button key="switch-prd" label="改跟這一份" onPress={() => act.start()} />], '看板會對準選的 PRD。流程還在進行時，要等這一輪做完。'),
          TestCommands({ el, snap, view, act }),
          SetupCommand({ el, snap, view, act }),
          AppCheck({ el, snap, view, act }),
          row(
            'agents',
            '同時做任務',
            [...[1, 2, 3, 4, 5, 6, 7, 8].map(n => <Button key={`agents-${n}`} label={String(n)} variant={agents === n ? 'primary' : 'secondary'} onPress={() => act.agents(n)} />), <Text dimColor>個全端</Text>],
            agents === 1
              ? '一次做一件任務，全端直接在 crew 的分支上做。Claude 用量到提醒線時一次只做一件，到暫停線時先停。'
              : `不改同一批檔案的任務最多 ${agents} 個同時做（Tech lead 的 review 也算一個），各在自己的分支；核准後 crew 一件一件合回，每合一件跑一次測試。Claude 用量到提醒線時一次只做一件。`,
          ),
        ],
      })}
      {SettingGroup({
        el,
        title: '面板與頁面',
        rows: [
          row('open', '開啟時', [
            <Button key="open-on-load" label="打開面板" variant={open ? 'primary' : 'secondary'} onPress={() => act.openOnLoad(true)} />,
            <Button key="not-on-load" label="不要" variant={open ? 'secondary' : 'primary'} onPress={() => act.openOnLoad(false)} />,
          ]),
          // On the web this page is where decisions are made: there is no other page to publish.
          el.web !== true &&
          row(
            'page',
            '待你決定頁',
            [
              <Button key="self-publish-on" label="crew 自己更新" variant={self ? 'primary' : 'secondary'} onPress={() => act.selfPublish(true)} />,
              <Button key="self-publish-off" label="請大腦發佈" variant={self ? 'secondary' : 'primary'} onPress={() => act.selfPublish(false)} />,
              ...(self && selfFailed !== undefined ? [<Text dimColor>這次改由大腦發佈</Text>] : []),
            ],
            'crew 自己更新：工作一動就更新進度圖，只放行這份 PRD 的 .crew/designs 裡的頁。請大腦發佈：有事等你決定時才更新。',
          ),
          el.web !== true && self && selfFailed !== undefined && <Text color="warning" wrap="wrap">crew 自己發佈沒有成功：{selfFailed}。按「crew 自己更新」再試一次。</Text>,
          snap.web !== undefined && WebRows({ el, view, act, web: snap.web }),
        ],
      })}
      {SettingGroup({
        el,
        title: '維護',
        rows: [
          row('board', '看板', [<Text dimColor wrap="truncate-end">{snap.boardFile?.path ?? BOARD_FILE}</Text>]),
          // Why the board is where it is, or that it moved: said where it shows, not behind 「?」.
          snap.boardFile?.why !== undefined && (
            <Box paddingLeft={NAME_WIDTH + 1}>
              <Text wrap="wrap">
                {snap.boardFile.why}
              </Text>
            </Box>
          ),
          row('flow', '流程', [<Button key="resume" label="接續" onPress={() => act.resume()} />, <Button key="reset" label="重設流程" onPress={() => act.reset(false)} />]),
          view.confirming && (
            <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1} paddingLeft={NAME_WIDTH + 1}>
              <Text color="warning">重設流程和角色？看板、討論和記憶都會留著。</Text>
              <Button key="reset-confirm" label="確定重設" variant="primary" onPress={() => act.reset(true)} />
            </Box>
          ),
        ],
      })}
      {isDemo && <Button key="demo-off" label="關閉設計稿" onPress={() => act.demoOff()} />}
    </Box>
  )
}

/** crew's web page in the settings: its address, opening it on start, and the tailnet. */
function WebRows({ el, view, act, web }: { el: Elements; view: View; act: Actions; web: NonNullable<Snapshot['web']> }) {
  const { Box, Text, Button } = el
  return (
    <Box flexDirection="column" rowGap={ROW_GAP}>
      {SettingRow({
        el,
        view,
        act,
        id: 'web',
        name: '網頁',
        body: [<Text wrap="truncate-end">{web.url}</Text>, <Button key="web-open" label="在瀏覽器打開" onPress={() => act.openWeb()} />],
        help: '只有這台電腦打得開，帶一次性的鑰匙；關掉 Claude Code，網頁就停。在網頁上可以看全部內容、核准和回答，也可以直接跟大腦對話。',
      })}
      {SettingRow({
        el,
        view,
        act,
        id: 'web-start',
        name: '網頁・啟動時',
        body: [
          <Button key="web-on-start" label="自動打開" variant={web.openOnStart ? 'primary' : 'secondary'} onPress={() => act.webOnStart(true)} />,
          <Button key="web-not-on-start" label="不要" variant={web.openOnStart ? 'secondary' : 'primary'} onPress={() => act.webOnStart(false)} />,
        ],
      })}
      {web.tailnet !== undefined && TailnetSection({ el, view, tailnet: web.tailnet, act })}
    </Box>
  )
}

const BOARD_ORDER: readonly ItemStatus[] = ['blocked', 'doing', 'review', 'todo', 'done']

/** Each status's chip on the page. */
const BOARD_CHIPS: Record<ItemStatus, string> = { blocked: 'bad', doing: 'run', review: 'wait', todo: 'todo', done: 'ok' }

function Board({ el, snap, view, act }: { el: Elements; snap: Snapshot; view: View; act: Actions }) {
  const { Box, Text, Button } = el
  if (snap.items.length === 0) return <Text dimColor>看板是空的。PM 拆完 PRD 後，項目會出現在這裡。</Text>
  // Wide enough for the longest number on one line, and the space after it.
  const idWidth = Math.max(...snap.items.map(i => i.id.length)) + 1
  const head = Row({ el, cells: [[idWidth, '編號', { dimColor: true }], ['38%', '項目', { dimColor: true }], ['14%', '負責', { dimColor: true }], ['26%', '難易度和模型', { dimColor: true }]], head: true })
  return (
    <Box flexDirection="column" gap={1}>
      {el.web !== true && head}
      {BOARD_ORDER.map(status => {
        const every: readonly Item[] = snap.items.filter(i => i.status === status)
        if (every.length === 0) return null
        const { rows: items, all } = capped(view, `board-${status}`, every)
        return (
          <Box flexDirection="column" rowGap={LIST_GAP}>
            {el.web === true ? (
              <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1} {...look(el, 'item-head')}>
                <Text bold color={status === 'blocked' ? 'error' : undefined} {...look(el, 'h3')}>
                  {ITEM_STATUS_NAMES[status]}
                </Text>
                <Text {...look(el, `chip ${BOARD_CHIPS[status]}`)}>{every.length} 項</Text>
              </Box>
            ) : (
              <Text bold color={status === 'blocked' ? 'error' : undefined}>
                {ITEM_STATUS_NAMES[status]}（{every.length}）
              </Text>
            )}
            {el.web === true && head}
            {items.map(i => (
              <Box flexDirection="column">
                {Row({ el, cells: [
                    [idWidth, i.id, { color: 'suggestion' }, { key: `item-${i.id}`, onPress: () => openItem(act, i.id) }],
                    ['38%', i.title, { dimColor: status === 'done' }, { key: `item-title-${i.id}`, onPress: () => openItem(act, i.id) }],
                    ['14%', ROLE_NAMES[i.owner]],
                    ['26%', route(i.route), { color: i.route.tier === 'XL' ? 'claude' : undefined }],
                  ] })}
                {i.hard !== undefined && <Text dimColor>　　{TIER_NAMES[i.route.tier]}：{i.hard}</Text>}
                {i.links !== undefined ? (
                  <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1} paddingLeft={2}>
                    <Text dimColor>對應</Text>
                    {i.links.map(ac => (
                      <Button key={`item-${i.id}-${ac}`} plain onPress={() => openItem(act, ac)}>
                        <Text color="suggestion">{ac}</Text>
                      </Button>
                    ))}
                    {i.rest !== undefined && i.rest !== '' && <Text dimColor>· {i.rest}</Text>}
                  </Box>
                ) : (
                  i.note !== undefined && <Text dimColor>　　{i.note}</Text>
                )}
              </Box>
            ))}
            {MoreLine({ el, act, id: `board-${status}`, total: every.length, all, noun: '項' })}
          </Box>
        )
      })}
      {HelpLine({
        el,
        view,
        act,
        id: 'board',
        line: '按彩色的編號看細節：完整規格、對應的驗收條件、測試案例和 commit。',
        help: ['模型和 context 門檻依項目的難易度：難易度看難不難，不看範圍大小，Tech lead 拆單時評，失敗、被退回就往上調。每個角色的模型在「模型」分頁。'],
      })}
    </Box>
  )
}

/** A thread's name: its item and the item's title, the id once where the title is the id (a question to a role). */
/** How many threads the list shows at first, and how many more a press adds. */
export const THREADS_SHOWN = 20

/** Each kind of item a thread is about: the start of its number, as the board uses it, and what it is. */
const threadKinds = (prefixes: IdPrefixes = { feature: 'PRD-', testCase: 'TC-' }): readonly [string, string, string][] => [
  ['功能', prefixes.feature, 'PRD 拆出來的一塊功能'],
  ['驗收條件', 'AC-', '功能要做到什麼才算完成，一條講一件事'],
  ['設計稿', 'SCR-', 'UI/UX 畫的畫面；你核准後全端才照著做'],
  ['任務', 'TASK-', 'Tech lead 拆給全端的一份工作'],
  ['測試', prefixes.testCase, 'QA 寫的測試案例，驗證某一條驗收條件'],
  ['PRD 需求', 'R-', 'PRD 檔案裡的一條需求；R- 是 crew 內部代號，面板上改顯示 PRD 自己的編號'],
  ['你問的', 'ASK-', '你直接問某個角色的問題：在面板上按［問］，或送 PRD 草稿請角色審'],
  ['大腦替你問的', 'ASK-', '大腦替你直接問某個角色的問題，或替你送 PRD 草稿請角色審'],
  ['團隊記憶', 'DEC- MEM- LES-', '角色記下的決定、事實或教訓'],
]

const THREAD_ORDERS: readonly [CrewThreadsView['order'], string][] = [
  ['recent', '最近'],
  ['feature', '依功能'],
  ['mine', '跟你有關'],
]

/** The message a thread's row shows: the newest; among those about the person, the newest about them. */
const newestOf = (t: Thread, mine: boolean): Thread['messages'][number] | undefined => {
  const last = [...t.messages].reverse()
  return (mine ? last.find(m => m.mine === true) : undefined) ?? last[0]
}

/** A message's first line, cut to fit under a row. */
const gistOf = (text: string): string => cut((text.split('\n').find(l => l.trim() !== '') ?? '').trim(), 90)

/**
 * A thread in the list: its kind, title, number, how long ago its newest
 * message came and how many it has; under it, who wrote to whom and the start
 * of what they said. In a feature's group the feature's own thread is 功能本身.
 */
function ThreadRow({ el, t, act, own, mine }: { el: Elements; t: Thread; act: Actions; own?: boolean; mine?: boolean }) {
  const { Box, Text, Button } = el
  const newest = newestOf(t, mine === true)
  const latest = mine === true ? t.mine?.latest : t.latest
  const tail = [t.shown ?? t.item, ...(latest === undefined ? [] : [latest]), `${t.messages.length}${t.older === true ? '+' : ''} 則`].join(' · ')
  return (
    <Box key={`row-${t.item}`} flexDirection="column" rowGap={ROW_GAP} {...look(el, 'item')}>
      <Button key={`thread-${t.item}`} {...(el.web === true ? { plain: true } : {})} onPress={() => act.thread(t.item)}>
        <Text color="suggestion">{own === true ? '功能本身' : t.kind}</Text> {cut(t.title, 60)} <Text dimColor>{tail}</Text>
      </Button>
      {newest !== undefined && (
        <Box paddingLeft={2}>
          <Text wrap="wrap" dimColor>
            {newest.from}：{gistOf(newest.gist ?? newest.text)}
          </Text>
        </Box>
      )}
    </Box>
  )
}

/** One open thread: what its item is, then its messages newest first. */
function OpenThread({ el, open, act, prefixes, fromPage = false }: { el: Elements; open: Thread; act: Actions; prefixes?: IdPrefixes; fromPage?: boolean }) {
  const { Box, Text, Button } = el
  const shown = open.messages.slice().reverse()
  const about = threadKinds(prefixes).find(([kind]) => kind === open.kind)?.[2]
  const where = [
    ...(open.feature !== undefined && open.feature.id !== open.item ? [`屬於：功能「${open.feature.title}」（${open.feature.id}）`] : []),
    ...(open.status !== undefined ? [`現在：${open.status}`] : []),
  ]
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1}>
        {fromPage ? <Button key="thread-back" label="← 上一頁" onPress={() => act.backPage()} /> : <Button key="thread-back" label="← 所有討論" onPress={() => act.thread(null)} />}
        {open.opens === true && <Button key="thread-item" label="看細節" onPress={() => openItem(act, open.item)} />}
      </Box>
      <Box flexDirection="column">
        <Text wrap="wrap">
          <Text color="suggestion">{open.kind}</Text> <Text bold>{open.title}</Text> <Text dimColor>{open.shown ?? open.item}</Text>
        </Text>
        {about !== undefined && <Text dimColor>這是什麼：{about}</Text>}
        {where.length > 0 && (
          <Text wrap="wrap" dimColor>
            {where.join('　')}
          </Text>
        )}
      </Box>
      <Text dimColor>{open.messages.length} 則，最新的在最上面</Text>
      {open.older === true && <Text dimColor>較早的訊息在 .crew/threads/{open.item}.jsonl。</Text>}
      <Box flexDirection="column" gap={1} {...look(el, 'list')}>
        {shown.map(m => (
          <Box flexDirection="column" {...look(el, 'item')}>
            <Text dimColor>
              {m.at === undefined ? '' : `${m.at}　`}
              <Text color="suggestion">{m.from}</Text>
            </Text>
            <Text wrap="wrap" {...look(el, 'md')}>
              {m.text}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

/**
 * The threads, as the person reads them: what the tab is for, the newest first
 * (or by feature, or only those about them), each row saying what its item is
 * and the latest that was said; a legend of the numbers on a press.
 */
function Threads({ el, snap, view, act }: { el: Elements; snap: Snapshot; view: View; act: Actions }) {
  const { Box, Text, Button } = el
  if (snap.threads.length === 0) return <Text dimColor>還沒有討論。角色之間、角色和你真的開始溝通，才會出現在這裡；crew 派工在「記錄」分頁。</Text>
  const open = snap.threads.find(t => t.item === view.thread)
  if (open !== undefined) return OpenThread({ el, open, act, ...(snap.idPrefixes === undefined ? {} : { prefixes: snap.idPrefixes }) })
  const { order, legend, shown } = view.threadsView
  // About the person: by the newest message about them, as each row shows it.
  const listed = order === 'mine' ? snap.threads.filter(t => t.mine !== undefined).sort((a, b) => (b.mine?.t ?? 0) - (a.mine?.t ?? 0)) : snap.threads
  // By feature: the features by their newest thread, as the list already is, and what belongs to none last.
  const groups = new Map<string, Thread[]>()
  for (const t of listed) groups.set(t.feature?.id ?? '', [...(groups.get(t.feature?.id ?? '') ?? []), t])
  const grouped = order === 'feature' ? [...[...groups].filter(([id]) => id !== ''), ...[...groups].filter(([id]) => id === '')] : [['', listed] as const]
  let left = shown
  return (
    <Box flexDirection="column" gap={1}>
      {HelpLine({
        el,
        view,
        act,
        id: 'threads',
        line: '角色之間、角色和你講的話，你不用在這裡回',
        help: ['要你決定的事在「總覽」的待你決定；crew 派工在「記錄」分頁。', '「跟你有關」只列你寫過、寫給你，或大腦替你寫的討論。', '「依功能」時，功能依最新一則的時間排，功能裡的項目也是。'],
      })}
      <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1}>
        {THREAD_ORDERS.map(([o, label]) => (
          <Button key={`threads-${o}`} label={label} variant={order === o ? 'primary' : 'secondary'} onPress={() => act.threadsView({ order: o })} />
        ))}
        <Button key="threads-legend" label={legend ? '收起說明' : '編號是什麼？'} variant="secondary" onPress={() => act.threadsView({ legend: !legend })} />
      </Box>
      {legend && (
        <Box flexDirection="column">
          {Row({ el, cells: [['16%', '類別', { dimColor: true }], ['16%', '編號', { dimColor: true }], ['68%', '是什麼', { dimColor: true }]], head: true })}
          {threadKinds(snap.idPrefixes).map(([kind, prefix, what]) => Row({ el, cells: [['16%', kind, { color: 'suggestion' }], ['16%', prefix, { dimColor: true }], ['68%', what]] }))}
        </Box>
      )}
      {listed.length === 0 && <Text dimColor>還沒有跟你有關的討論。</Text>}
      {grouped.map(([id, threads]) => {
        if (left <= 0) return null
        const rows = threads.slice(0, left)
        left -= rows.length
        const feature = threads[0]?.feature
        return (
          <Box key={`group-${id}`} flexDirection="column" rowGap={ROW_GAP} {...look(el, 'list')}>
            {order === 'feature' &&
              (id === '' || feature === undefined ? (
                <Text bold>不屬於某個功能</Text>
              ) : (
                <Text wrap="wrap">
                  <Text bold>功能：{feature.title}</Text> <Text dimColor>{[feature.id, ...(threads[0]?.latest === undefined ? [] : [`最新 ${threads[0].latest}`])].join(' · ')}</Text>
                </Text>
              ))}
            <Box flexDirection="column" rowGap={ROW_GAP} paddingLeft={order === 'feature' ? 2 : 0}>
              {rows.map(t => ThreadRow({ el, t, act, own: order === 'feature' && t.feature?.id === t.item, mine: order === 'mine' }))}
            </Box>
          </Box>
        )
      })}
      {listed.length > shown && (
        <Box flexDirection="row" gap={1}>
          <Text dimColor>
            顯示 {shown} / {listed.length} 個
          </Text>
          <Button key="threads-more" label={`再顯示 ${Math.min(THREADS_SHOWN, listed.length - shown)} 個`} onPress={() => act.threadsView({ shown: shown + THREADS_SHOWN })} />
        </Box>
      )}
    </Box>
  )
}

/** How many entries the log tab shows at first, and how many more a press adds. */
export const LOG_SHOWN = 50

const LOG_ROLES: readonly [CrewLogView['role'], string][] = [
  ['all', '全部'],
  ['pm', ROLE_NAMES.pm],
  ['uiux', ROLE_NAMES.uiux],
  ['qa', ROLE_NAMES.qa],
  ['techlead', ROLE_NAMES.techlead],
  ['fullstack', ROLE_NAMES.fullstack],
]

/** 10/15 14:48 and Review 結論, each with the space after it. */
const LOG_AT_WIDTH = 12
const LOG_WORD_WIDTH = 13

/** One thing crew did: when, in a word, who and what; the item it was on, and all of it on a press. */
function LogRow({ el, e, open, act }: { el: Elements; e: LogEntry; open: boolean; act: Actions }) {
  const { Box, Text, Button } = el
  return (
    <Box key={`log-${e.key}`} flexDirection="row" {...look(el, 'logrow')}>
      <Box width={LOG_AT_WIDTH} flexShrink={0}>
        <Text dimColor>{e.at}</Text>
      </Box>
      <Box width={LOG_WORD_WIDTH} flexShrink={0}>
        <Text color={e.failed === true ? 'error' : 'suggestion'}>{e.word}</Text>
      </Box>
      <Box flexDirection="column" rowGap={ROW_GAP} flexGrow={1} flexShrink={1}>
        <Text wrap="wrap">
          {e.who}：{e.text}
        </Text>
        {(e.item !== undefined || e.full !== undefined) && (
          <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1}>
            {e.item !== undefined && e.opens === true && (
              <Button key={`log-item-${e.key}`} plain onPress={() => openItem(act, e.item ?? '')}>
                <Text color="suggestion">{e.item}</Text>
              </Button>
            )}
            {e.item !== undefined && e.opens !== true && <Text dimColor>{e.item}</Text>}
            {e.full !== undefined && <Button key={`log-open-${e.key}`} label={open ? '收起' : '看內容'} onPress={() => act.logView({ open: open ? null : e.key })} />}
          </Box>
        )}
        {open && <Text wrap="wrap">{e.full}</Text>}
      </Box>
    </Box>
  )
}

/** What crew did, the newest first: one role's or all, each row saying what and who, all of it on a press. */
function LogTab({ el, snap, view, act }: { el: Elements; snap: Snapshot; view: View; act: Actions }) {
  const { Box, Text, Button } = el
  const { role, open, shown } = view.logView
  const all = snap.log ?? []
  const listed = role === 'all' ? all : all.filter(e => e.role === role)
  return (
    <Box flexDirection="column" gap={1}>
      {HelpLine({
        el,
        view,
        act,
        id: 'log',
        line: 'crew 做過的事，最新的在最上面；只列最近 3 天',
        help: ['包括派工、請 Tech lead review、跑測試、角色開始和回報、換 context、換模型。', '角色之間說的話在「討論」分頁。', '更早的記錄在 .crew/log/。'],
      })}
      <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1}>
        {LOG_ROLES.map(([id, label]) => (
          <Button key={`log-role-${id}`} label={label} variant={role === id ? 'primary' : 'secondary'} onPress={() => act.logView({ role: id })} />
        ))}
      </Box>
      {listed.length === 0 && <Text dimColor>{role === 'all' ? '最近 3 天還沒有記錄。' : `最近 3 天 ${ROLE_NAMES[role]} 還沒有記錄。`}</Text>}
      {listed.length > 0 && (
        <Box flexDirection="column" rowGap={LIST_GAP} {...look(el, 'card log')}>
          {listed.slice(0, shown).map(e => LogRow({ el, e, open: open === e.key, act }))}
        </Box>
      )}
      {listed.length > shown && (
        <Box flexDirection="row" gap={1}>
          <Text dimColor>
            顯示 {shown} / {listed.length} 筆
          </Text>
          <Button key="log-more" label={`再顯示 ${Math.min(LOG_SHOWN, listed.length - shown)} 筆`} onPress={() => act.logView({ shown: shown + LOG_SHOWN })} />
        </Box>
      )}
    </Box>
  )
}

/** A number on a page: pressed, its own page opens on top; what it is and where it stands, and what else the page says of it. */
function LinkRow({ el, l, at, act }: { el: Elements; l: PageLink; at: number; act: Actions }) {
  const { Box, Text, Button } = el
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Button key={`open-${at}-${l.id}`} plain onPress={() => openItem(act, l.id)}>
          <Text color="suggestion">{l.shown === undefined ? l.id : `需求 ${l.shown}`}</Text>
        </Button>
        <Text wrap="wrap">
          {l.title}
          {l.note !== undefined && <Text dimColor>　{l.note}</Text>}
        </Text>
      </Box>
      {(l.lines ?? []).map(line => (
        <Box paddingLeft={2}>
          <Text wrap="wrap" dimColor>
            {line}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

function SectionView({ el, s, at, act }: { el: Elements; s: PageSection; at: number; act: Actions }) {
  const { Box, Text } = el
  const lines = s.lines ?? []
  const links = s.links ?? []
  return (
    <Box flexDirection="column" rowGap={LIST_GAP}>
      <Text>
        <Text bold>{s.title}</Text>
        {s.hint !== undefined && <Text dimColor>　{s.hint}</Text>}
      </Text>
      {s.text !== undefined && (
        <Text wrap="wrap" {...look(el, 'md')}>
          {s.text}
        </Text>
      )}
      {lines.map(line => (
        <Text wrap="wrap" {...look(el, 'md')}>
          {line}
        </Text>
      ))}
      {links.map(l => LinkRow({ el, l, at, act }))}
      {s.text === undefined && lines.length === 0 && links.length === 0 && s.empty !== undefined && <Text dimColor>{s.empty}</Text>}
    </Box>
  )
}

/** The page of an item: what it is and where it stands, whose it is, its parts in full, and where to go from it. */
function ItemPageView({ el, page, act }: { el: Elements; page: ItemPage; act: Actions }) {
  const { Box, Text, Button } = el
  const now = [
    ...(page.status === undefined ? [] : [page.status]),
    ...(page.owner === undefined ? [] : [ROLE_NAMES[page.owner]]),
    ...(page.route === undefined ? [] : [route(page.route)]),
  ]
  const runs = page.runs ?? []
  return (
    <Box flexDirection="column" gap={1}>
      <Button key="page-back" label="← 上一頁" onPress={() => act.backPage()} />
      <Box flexDirection="column" rowGap={ROW_GAP}>
        <Text wrap="wrap">
          <Text color="suggestion">{page.kind}</Text> <Text bold>{page.title}</Text>{page.idHidden === true ? null : <Text dimColor> {page.id}</Text>}
        </Text>
        {now.length > 0 && (
          <Text wrap="wrap" dimColor>
            現在：{now.join(' · ')}
          </Text>
        )}
        {page.feature !== undefined && (
          <Box flexDirection="row" gap={1}>
            <Text dimColor>屬於功能</Text>
            <Button key={`page-feature-${page.feature.id}`} plain onPress={() => openItem(act, page.feature?.id ?? '')}>
              <Text color="suggestion">{page.feature.id}</Text>
            </Button>
            <Text wrap="wrap" dimColor>
              {page.feature.title}
            </Text>
          </Box>
        )}
        {(page.requirements ?? []).map(r => (
          <Box flexDirection="row" gap={1}>
            <Text dimColor>PRD 需求</Text>
            <Button key={`page-req-${r.id}`} plain onPress={() => openItem(act, r.id)}>
              <Text color="suggestion">{r.shown ?? r.id}</Text>
            </Button>
            <Text wrap="wrap" dimColor>
              {r.title}
            </Text>
          </Box>
        ))}
      </Box>
      {page.sections.map((s, i) => SectionView({ el, s, at: i, act }))}
      {page.verify !== undefined && MethodPresses({ el, id: page.id, method: page.verify.method, act })}
      {page.url !== undefined && ReviewLink({ el, url: page.url })}
      {(page.thread === true || runs.length > 0) && (
        <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1}>
          {page.thread === true && <Button key="page-thread" label="看討論" onPress={() => act.pageThread(page.id)} />}
          {runs.map(r => (
            <Button key={`page-run-${r.role}`} label={`執行過程：${ROLE_NAMES[r.role]}`} onPress={() => act.viewRun(r.role, r.run)} />
          ))}
        </Box>
      )}
      {page.thread !== true && page.sections.length > 0 && <Text dimColor>這一項還沒有角色討論。</Text>}
    </Box>
  )
}

const METHOD_NAMES: Record<'command' | 'qa' | 'accept', string> = { command: '測試指令', qa: 'QA 實際操作', accept: '你驗收時確認' }

/** The person's presses on a test case's page: another way to verify it, or back to the test commands. */
function MethodPresses({ el, id, method, act }: { el: Elements; id: string; method: 'command' | 'qa' | 'accept'; act: Actions }) {
  const { Box, Text, Button } = el
  const others = (['command', 'qa', 'accept'] as const).filter(m => m !== method)
  return (
    <Box key={`method-${id}`} flexDirection="column" rowGap={ROW_GAP}>
      <Text dimColor wrap="wrap">
        只有你的按鍵能改驗證方式。自動測試不適合的才改：要看畫面的用「QA 實際操作」，只有人能判斷的交付檢查用「你驗收時確認」。
      </Text>
      <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1}>
        {others.map(m => (
          <Button key={`method-${id}-${m}`} label={`${m === 'command' ? '改回' : '改用'}「${METHOD_NAMES[m]}」`} onPress={() => act.verifyMethod(id, m)} />
        ))}
      </Box>
    </Box>
  )
}

const STEP_WORDS: Record<RunStep['kind'], string> = { message: '說', command: '指令', file: '改檔案', tool: '工具', told: '被告知' }

/** A thread opened from a page: the thread, and the way back to that page. */
function ThreadPageView({ el, snap, item, act }: { el: Elements; snap: Snapshot; item: string; act: Actions }) {
  const { Box, Text, Button } = el
  const open = snap.threads.find(t => t.item === item)
  if (open !== undefined) return OpenThread({ el, open, act, fromPage: true, ...(snap.idPrefixes === undefined ? {} : { prefixes: snap.idPrefixes }) })
  return (
    <Box flexDirection="column" gap={1}>
      <Button key="thread-back" label="← 上一頁" onPress={() => act.backPage()} />
      <Text dimColor>{item} 現在沒有討論。</Text>
    </Box>
  )
}

/** A role's runs as crew kept them: which run, what crew told it, each step, and how it ended. */
function RunPageView({ el, page, act }: { el: Elements; page: RunPage; act: Actions }) {
  const { Box, Text, Button } = el
  const run = page.runs[page.open]
  return (
    <Box flexDirection="column" gap={1}>
      <Button key="page-back" label="← 上一頁" onPress={() => act.backPage()} />
      <Box flexDirection="column">
        <Text>
          <Text color="suggestion">執行過程</Text> <Text bold>{ROLE_NAMES[page.role]}</Text> {run !== undefined && <Text dimColor>{run.engine === 'codex' ? 'Codex' : 'Claude'}{run.item === undefined ? '' : ` · ${run.item}`}</Text>}
        </Text>
        <Text wrap="wrap" dimColor>
          這裡是 crew 存下的訊息、指令和改過的檔案，每跑完一次多一筆：最多留最近 20 次，每個指令的輸出留最後 1000 字。Claude 的角色正在跑的時候，按［看執行過程］會在左邊主畫面看即時過程。
        </Text>
      </Box>
      {page.runs.length === 0 && <Text dimColor>還沒有紀錄：{ROLE_NAMES[page.role]}下一次跑完，這裡就會有。</Text>}
      {page.missing !== undefined && page.runs.length > 0 && (
        <Text wrap="wrap" color="warning">
          {page.running === true
            ? `${ROLE_NAMES[page.role]}還在做 ${page.missing}，這一次跑完才會存下。`
            : `${page.missing} 沒有存下的執行過程：可能是在 crew 開始存紀錄之前做的，或已經超過最近 20 次。`}
          下面是{ROLE_NAMES[page.role]}存下的最新一次。
        </Text>
      )}
      {page.runs.length > 1 && (
        <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1}>
          {page.runs.map((r, n) => (
            <Button key={`run-pick-${n}`} label={`${r.at}${r.item === undefined ? '' : ` ${r.item}`}`} variant={n === page.open ? 'primary' : 'secondary'} onPress={() => act.swapPage(`run:${page.role}:${r.t}`)} />
          ))}
        </Box>
      )}
      {run !== undefined && (
        <Box flexDirection="column">
          <Text bold>crew 交代的內容</Text>
          <Text wrap="wrap" {...look(el, 'md')}>
            {run.prompt}
          </Text>
        </Box>
      )}
      {run !== undefined && (
        <Box flexDirection="column">
          <Text bold>過程</Text>
          {run.steps.length === 0 && <Text dimColor>這一次沒有留下步驟。</Text>}
          {run.steps.map(step => (
            <Box flexDirection="column">
              {el.web === true && (step.kind === 'message' || step.kind === 'told') ? (
                <Box flexDirection="column">
                  <Text color="suggestion">{STEP_WORDS[step.kind]}</Text>
                  <Text wrap="wrap" {...look(el, 'md')}>
                    {step.text}
                  </Text>
                </Box>
              ) : (
                <Text wrap="wrap">
                  <Text color="suggestion">{STEP_WORDS[step.kind]}</Text> {step.text}
                </Text>
              )}
              {step.output !== undefined && step.output !== '' && (
                <Box paddingLeft={2}>
                  <Text wrap="wrap" dimColor {...look(el, 'mono')}>
                    {step.output}
                  </Text>
                </Box>
              )}
            </Box>
          ))}
        </Box>
      )}
      {run?.report !== undefined && (
        <Box flexDirection="column">
          <Text bold>回報</Text>
          <Text wrap="wrap" {...look(el, 'md')}>
            {run.report}
          </Text>
        </Box>
      )}
      {run?.failed !== undefined && (
        <Box flexDirection="column">
          <Text bold color="error">
            失敗
          </Text>
          <Text wrap="wrap" {...look(el, 'md')}>
            {run.failed}
          </Text>
        </Box>
      )}
    </Box>
  )
}

/** While the main view shows a role's run: whose it is, where the prompt goes now, and the way back. */
function Watching({ el, who, act }: { el: Elements; who: string; act: Actions }) {
  const { Box, Text, Button } = el
  return (
    <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1}>
      <Text color="warning" wrap="wrap">
        左邊是{who}的執行過程。現在在輸入框按 Enter 會傳給它，回主對話再打字。
      </Text>
      <Button key="back-main" label="回主對話" variant="primary" onPress={() => act.backToMain()} />
    </Box>
  )
}

/**
 * What every builder is given, at the top of the memory tab: the rows pinned,
 * each with its way off, the cap, and a field to pin one by its id.
 */
function Pinned({ el, snap, act }: { el: Elements; snap: Snapshot; act: Actions }) {
  const { Box, Text, Button } = el
  const p = snap.pinned
  if (p === undefined) return null
  const full = p.rows.length >= p.max || p.tokens >= p.maxTokens
  return (
    <Box flexDirection="column" rowGap={ROW_GAP}>
      <Text bold>
        固定附上給每個全端{p.rows.length === 0 ? '' : `（${p.rows.length} 條・約 ${p.tokens.toLocaleString('en-US')} tok，${full ? '已滿' : `上限 ${p.max} 條／${p.maxTokens.toLocaleString('en-US')} tok`}）`}
      </Text>
      <Text dimColor wrap="wrap">每個新開工的全端都會收到這幾條，不看和任務像不像。全端和 Tech lead 存記憶時可以標「給每個全端」；取代固定的那條時，新的那條接著固定。</Text>
      {p.rows.length === 0 ? (
        <Text dimColor>還沒有固定附上的記憶。在下面輸入編號固定，或等全端、Tech lead 存記憶時標上。</Text>
      ) : (
        <Box flexDirection="column">
          {p.rows.map(m =>
            Row({
              el,
              cells: [
                ['12%', m.id, { color: 'suggestion' }],
                ['8%', MEMORY_TYPE_NAMES[m.type]],
                ['58%', m.text],
                ['12%', m.source, { dimColor: true }],
              ],
              tail: <Button key={`unpin-${m.id}`} label="取消" onPress={() => act.unpinMemory(m.id)} />,
            }),
          )}
        </Box>
      )}
      {full && <Text color="warning" wrap="wrap">已滿：全端或 Tech lead 再標「給每個全端」時，crew 照樣存成一般記憶，並請它先用 supersedes 取代一條。你可以在這裡取消幾條。</Text>}
      {Field({ el, id: 'pin-memory', label: '固定一條', placeholder: '編號，例如 LES-063', submit: '固定', what: '要固定的記憶', onSubmit: text => act.pinMemory(text) })}
    </Box>
  )
}

/** Under the test accounts file: a password that is an ordinary word is refused only where it reads as a login. */
const ACCOUNTS_HINT =
  '測試密碼如果是 admin、password、test 這類一般用字，或和帳號同一個字，crew 分不出它和畫面上的字，只有寫成像登入的樣子（例如「密碼 admin」「admin / admin」）才會擋。建議改用含數字的測試密碼（例如在字後面加幾個數字）。'

/**
 * What QA checks each finished feature in the running app with, in the
 * settings tab: the start command, the stop command, the URL, the test
 * accounts file, and how the checks went. While the app is not set, the
 * fields hold what QA found in the repo, saved only by the person.
 */
function AppCheck({ el, snap, view, act }: { el: Elements; snap: Snapshot; view: View; act: Actions }) {
  const { Box, Text } = el
  const s = snap.settings
  const ready = s?.startCommand !== undefined && s.appUrl !== undefined
  // QA's suggestion stays in each field not saved yet, while crew still asks how to start the app.
  const p = s?.proposal
  const startValue = s?.startCommand ?? p?.start
  const stopValue = s?.stopCommand ?? p?.stop
  const urlValue = s?.appUrl ?? p?.url
  const accountsValue = s?.accounts ?? p?.accounts
  const suggested = (s?.startCommand === undefined && p?.start !== undefined) || (s?.stopCommand === undefined && p?.stop !== undefined) || (s?.appUrl === undefined && p?.url !== undefined) || (s?.accounts === undefined && p?.accounts !== undefined)
  const line = (name: string, field: unknown) => (
    <Box flexDirection="row" columnGap={1}>
      <Box width={7} flexShrink={0}>
        <Text dimColor>{name}</Text>
      </Box>
      {field}
    </Box>
  )
  return (
    <Box flexDirection="column" rowGap={ROW_GAP}>
      {SettingRow({
        el,
        view,
        act,
        id: 'qa',
        name: 'QA 操作 app',
        body: (
          <Box flexDirection="column" rowGap={ROW_GAP}>
            {suggested && <Text color="suggestion">還沒存的欄位裡是 QA 從 repo 找到的建議值：每一欄按儲存才會用</Text>}
            {line('啟動', Field({ el, id: 'start-command', placeholder: 'npm run dev', value: startValue, submit: '儲存', what: 'app 的啟動指令', onSubmit: text => act.startCommand(text) }))}
            {line('關掉', Field({ el, id: 'stop-command', placeholder: '選填，例如 docker compose down', value: stopValue, submit: '儲存', what: '關掉 app 的指令', onSubmit: text => act.stopCommand(text) }))}
            {line('網址', Field({ el, id: 'app-url', placeholder: 'http://localhost:3000', value: urlValue, submit: '儲存', what: 'app 網址', onSubmit: text => act.appUrl(text) }))}
            {line('帳號檔', Field({ el, id: 'test-accounts', placeholder: '選填', value: accountsValue, submit: '儲存', what: '測試帳號的檔案', onSubmit: text => act.testAccounts(text) }))}
            <Box paddingLeft={8}>
              <Text dimColor wrap="wrap">{ACCOUNTS_HINT}</Text>
            </Box>
            {!ready && <Text color="warning">未設定：做完的功能等 QA 在 app 裡截好圖，才會交給你驗收</Text>}
            {ready && s?.stopCommand === undefined && p?.stop !== undefined && <Text color="warning">還差「關掉」：QA 說這個啟動指令會把 app 放到背景跑，存好關掉的指令 QA 才開始</Text>}
          </Box>
        ),
        help: '功能做完，crew 在 QA 的工作目錄用啟動指令開起 app（不經過 shell），QA 用瀏覽器照 test case 操作並截圖，做完就關掉。啟動指令會自己結束、把 app 放在背景跑（例如 docker compose up -d）時，填「關掉」的指令（例如 docker compose down）：crew 等網址有回應最多 10 分鐘，做完用它關掉；crew 只結束它自己開的程式，不動你原本開著的；執行時設好 COMPOSE_PROJECT_NAME，docker compose 開的容器和你自己的分開（compose 檔裡寫了固定名稱或 external 的 volume 例外，資料會共用）。網址只接受這台電腦的（localhost、127.0.0.1）。',
      })}
      {(snap.checks ?? []).map(c => (
        <Box key={`check-${c.feature}`} paddingLeft={NAME_WIDTH + 1}>
          <Text wrap="truncate-end">
            {c.feature}
            {c.title === undefined ? '' : ` ${c.title}`}：第 {c.round} 輪 {checkState(c)}
            {c.why === undefined ? '' : `（${c.why}）`}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

/** What the settings say of the test commands behind 「?」. */
const TESTS_HELP = `每個任務通過 review、每次合併後都跑。crew 每次跑之前，從 crew 分支最新的版本找專案的測試設定（每個資料夾 package.json 的 test script、go.mod、pytest 設定，不看 node_modules、vendor），用固定的寫法組成指令；專案裡寫的其他指令（README、Makefile、CI 設定）不照抄。你設定的先占位置，crew 不會改。最多 ${MAX_TEST_COMMANDS} 條，crew 照順序一條一條跑，每條各存一個紀錄檔；任何一條說失敗就是失敗。每一條都是一條指令、不經 shell、最多 10 分鐘，在全端的工作目錄直接執行，不會每次問你。沒跑到的 test case 在測試那一關（G6）算缺口，不算通過。指令設定好就要能直接跑：需要的資料庫、環境變數由專案自己的指令或腳本準備。你設定的存在這台機器上，不在 repo 裡；只能由你在這裡設定，crew 找到的關掉或恢復也一樣。`

/** A chip as a surface shows it: the page's coloured pill, the pane's bracketed word. */
function Chip({ el, text, tone }: { el: Elements; text: string; tone: string }) {
  const { Text } = el
  return el.web === true ? (
    <Text {...look(el, `chip ${tone}`)}>{text}</Text>
  ) : (
    <Text color={tone === 'run' ? 'suggestion' : tone === 'wait' ? 'warning' : undefined} dimColor={tone === 'todo' || tone === 'kind'}>
      ［{text}］
    </Text>
  )
}

/**
 * A command crew found, as a row: its place, the command, where it stands
 * (and whether it is new, or its tests name test case ids), 不要跑這條 or
 * 恢復, where it came from and which folder, how its last run went, and why.
 */
function FoundRowBox({ el, r, act }: { el: Elements; r: FoundRowView; act: Actions }) {
  const { Box, Text, Button } = el
  const runs = r.status === 'run'
  const warn = r.status === 'over' || r.broken !== undefined
  return (
    <Box key={`found-${r.key}`} flexDirection="column" rowGap={ROW_GAP} {...look(el, 'item')}>
      <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={ROW_GAP} {...look(el, 'item-head')}>
        <Text bold={runs} dimColor={!runs}>
          {r.n === undefined ? '–' : `${r.n}.`}
        </Text>
        <Text {...look(el, 'mono')} dimColor={!runs} strikethrough={r.status === 'replaced'} wrap="wrap">
          {r.cmd === '' ? `${r.dir} 的測試` : r.cmd}
        </Text>
        {Chip({ el, text: r.chip, tone: r.tone })}
        {r.broken !== undefined && Chip({ el, text: '跑不起來', tone: 'wait' })}
        {r.fresh === true && Chip({ el, text: '新找到', tone: 'kind' })}
        {r.tc === true && Chip({ el, text: '測試寫了 test case 編號', tone: 'kind' })}
        {runs && <Button key={`found-off-${r.key}`} label="不要跑這條" onPress={() => act.foundTest(r.key, false)} />}
        {r.status === 'off' && <Button key={`found-on-${r.key}`} label="恢復" onPress={() => act.foundTest(r.key, true)} />}
      </Box>
      <Text dimColor wrap="wrap">
        來源：{r.src}　資料夾：{r.dir}
      </Text>
      {runs && (
        <Text dimColor={r.last === undefined || r.last.exit === 0} color={r.last !== undefined && r.last.exit !== 0 ? 'warning' : undefined} wrap="wrap">
          {r.last === undefined ? '上次：還沒跑過' : `上次：commit ${r.last.sha}・exit ${r.last.exit}・跑了 ${r.last.took}・紀錄在 .crew/runs`}
        </Text>
      )}
      {r.why !== undefined && (
        <Text color={warn ? 'warning' : undefined} dimColor={!warn} wrap="wrap">
          {r.why}
        </Text>
      )}
    </Box>
  )
}

/**
 * The test commands: how many run this time and from where, with 跑測試;
 * those crew found in the project, a row each in the order they run (with
 * what to do when it found none, or more than it runs at once); and the
 * person's own, which go first for places and which crew never changes: a
 * row each with the command to change and 刪除, how crew's latest run of it
 * went, and a field to add one. With one command of theirs or none, the
 * field is the command, as it was before there could be several.
 */
function TestCommands({ el, snap, view, act }: { el: Elements; snap: Snapshot; view: View; act: Actions }) {
  const { Box, Text, Button } = el
  const one = snap.settings?.testCommand
  const list = snap.settings?.testCommands ?? (one === undefined ? [] : [one])
  const run = snap.settings?.testRun
  const found = snap.settings?.found
  const rows = found?.rows ?? []
  const crew = found?.crew ?? 0
  const total = crew + list.length
  const single = list.length <= 1
  const userRows: (string | undefined)[] = list.length === 0 ? [undefined] : [...list]
  const from = [crew > 0 ? `crew 找到的 ${crew} 條` : '', list.length > 0 ? `你設定的 ${list.length} 條` : ''].filter(x => x !== '').join('、')
  const sum = total === 0 ? '這次不跑測試' : `這次會照順序跑 ${total} 條：${from}`
  // Nothing crew found can run, and the person set none: the tests do not run, and the flow goes on.
  const none = found?.scanned === true && rows.every(r => r.status === 'norule' || r.status === 'bad')
  return (
    <Box flexDirection="column" rowGap={ROW_GAP}>
      {SettingRow({
        el,
        view,
        act,
        id: 'tests',
        name: '測試指令',
        body: [
          <Text key="tests-sum" color={total === 0 ? 'warning' : undefined} wrap="wrap">
            {sum}
          </Text>,
          <Button key="run-tests" label="跑測試" onPress={() => act.runTests()} />,
        ],
        help: TESTS_HELP,
      })}
      <Box flexDirection="column" rowGap={ROW_GAP} paddingLeft={NAME_WIDTH + 1} {...look(el, 'list under')}>
        <Text bold>crew 從專案找到的</Text>
        <Text dimColor wrap="wrap">
          每次跑測試前，從 crew 分支最新的版本重新找{found?.sha === undefined ? '' : `（上次找的是 commit ${found.sha}）`}。{rows.length > 0 ? 'crew 照下面的順序跑，不會改你設定的。' : ''}
        </Text>
        {found?.scanned !== true && (
          <Text dimColor wrap="wrap">
            還沒找過：第一次跑測試前會找。
          </Text>
        )}
        {none && (
          <Box flexDirection="column" rowGap={ROW_GAP} {...look(el, 'note')}>
            <Text bold wrap="wrap">
              crew 在這個專案找不到測試指令{list.length === 0 ? '，所以不跑測試' : '，只跑你設定的'}。
            </Text>
            <Text wrap="wrap">找過：每個資料夾 package.json 的 test script、go.mod、pytest 設定。</Text>
            {list.length === 0 && <Text wrap="wrap">沒有測試結果的 test case 在測試那一關（G6）算缺口，不算通過。流程照常往下走，不會問你。</Text>}
            {list.length === 0 && <Text wrap="wrap">需要的話，在下面自己加一條。</Text>}
          </Box>
        )}
        {found !== undefined && found.over > 0 && (
          <Box flexDirection="column" rowGap={ROW_GAP} {...look(el, 'note')}>
            <Text bold color="warning" wrap="wrap">
              找到 {rows.filter(r => r.status === 'run' || r.status === 'over').length} 條，一次最多跑 {MAX_TEST_COMMANDS} 條{list.length === 0 ? '' : `（你設定的 ${list.length} 條先占位置）`}。
            </Text>
            <Text wrap="wrap">先排測試寫了 test case 編號的資料夾，其餘照資料夾路徑排；沒排進去的 {found.over} 條這次不跑，裡面的 test case 在測試那一關算缺口。</Text>
            <Text wrap="wrap">要全部都跑：在根目錄 package.json 加一個會跑全部的 test script（例如 turbo run test），crew 就改成只跑那一條；或在下面自己設定。</Text>
          </Box>
        )}
        {found?.cut === true && (
          <Text color="warning" wrap="wrap">
            設定檔太多，crew 只讀了離根目錄最近的一部分：沒列在這裡的資料夾，在下面自己加一條。
          </Text>
        )}
        {rows.map(r => FoundRowBox({ el, r, act }))}
      </Box>
      <Box flexDirection="column" rowGap={ROW_GAP} paddingLeft={NAME_WIDTH + 1} {...look(el, 'under')}>
        <Box flexDirection="row" columnGap={1}>
          <Text bold>你自己設定的</Text>
          {Chip({ el, text: '優先', tone: 'run' })}
        </Box>
        <Text dimColor wrap="wrap">
          {list.length === 0 ? `${total === 0 ? '沒有設定。' : '沒有也可以，上面 crew 找到的會照跑。'}加在這裡的先占位置，跑同一個資料夾時用你的。` : 'crew 不會改這裡的指令。跑同一個資料夾時，用你的。'}
        </Text>
      </Box>
      {userRows.map((cmd, i) => {
        const last = cmd === undefined ? undefined : run?.parts.find(p => p.cmd === cmd)
        const replaces = found?.replaces?.[i + 1]
        return (
          <Box key={`tests-${i + 1}`} flexDirection="column" rowGap={ROW_GAP}>
            {SettingRow({
              el,
              view,
              act,
              id: `tests-${i + 1}`,
              name: '',
              body: [
                // Its place in the run: after crew's.
                cmd !== undefined && (
                  <Text key={`test-command-n-${i + 1}`} bold>
                    {crew + i + 1}.
                  </Text>
                ),
                Field({ el, id: single ? 'test-command' : `test-command-${i + 1}`, placeholder: 'npm --prefix backend test', value: cmd, submit: cmd === undefined ? '加一條' : '儲存', what: '測試指令', onSubmit: text => act.testCommand(single ? text : `set ${i + 1} ${text}`) }),
                cmd !== undefined && <Button key={`test-command-remove-${i + 1}`} label="刪除" onPress={() => act.testCommand(`remove ${i + 1}`)} />,
              ],
            })}
            {cmd !== undefined && (replaces !== undefined || run !== undefined) && (
              <Box paddingLeft={NAME_WIDTH + 1} {...look(el, 'under')}>
                <Text color={last === undefined || last.exit === 0 ? undefined : 'warning'} dimColor={last === undefined || last.exit === 0} wrap="wrap">
                  {replaces === undefined ? '' : `crew 看得出這條跑整個 ${replaces}，crew 找到的那條就不跑。`}
                  {run === undefined ? '' : last === undefined ? '還沒跑過' : `上次：commit ${run.sha}・exit ${last.exit}・跑了 ${last.took}・紀錄在 .crew/runs`}
                </Text>
              </Box>
            )}
          </Box>
        )
      })}
      {list.length >= 1 &&
        list.length < MAX_TEST_COMMANDS &&
        SettingRow({
          el,
          view,
          act,
          id: 'tests-add',
          name: '',
          body: [Field({ el, id: 'test-command-add', placeholder: 'npm --prefix backend test', submit: '加一條', what: '測試指令', onSubmit: text => act.testCommand(`add ${text}`) })],
        })}
    </Box>
  )
}

/**
 * The person's worktree prep command in the settings tab: the field, a trial
 * run in crew's own worktree, and how the runs went; what the script is given behind 「?」.
 */
function SetupCommand({ el, snap, view, act }: { el: Elements; snap: Snapshot; view: View; act: Actions }) {
  const { Box, Text, Button } = el
  const cmd = snap.settings?.setupCommand
  const setup = snap.settings?.setup
  const last = setup?.last
  return (
    <Box flexDirection="column" rowGap={ROW_GAP}>
      {SettingRow({
        el,
        view,
        act,
        id: 'setup',
        name: 'worktree 準備',
        body: [
          Field({ el, id: 'setup-command', placeholder: 'bash scripts/setup.sh', value: cmd, submit: '儲存', what: 'worktree 準備指令', onSubmit: text => act.setupCommand(text) }),
          cmd !== undefined && <Button key="setup-run" label="試跑" onPress={() => act.setupRun()} />,
        ],
        help: `每開一個 worktree 先跑它（裝套件、放 .env.local），跑完全端才開工；合回的任務改到套件設定檔時，crew 會在自己的分支再跑一次，試跑也是，這時有 CREW_AGAIN=1，所以它要能重跑。不經過 shell，最多 10 分鐘。指令拿得到 CREW_MAIN、CREW_BASE、CREW_WORKTREE、CREW_TASK。腳本用相對路徑時跑的是新 worktree 裡那一份，全端改得到；寫 repo 外的絕對路徑，跑的就只會是你寫的版本。只能由你在這裡設定。${cmd === undefined ? '還沒設定時，每個全端開工要自己準備環境。' : ''}`,
      })}
      <Box flexDirection="column" paddingLeft={NAME_WIDTH + 1}>
        {(setup?.running ?? []).map(r => (
          <Text key={`setup-running-${r.where}`} color="suggestion" wrap="truncate-end">
            準備中：{r.where} 的 worktree，{r.since} 開始
          </Text>
        ))}
        {last !== undefined && (
          <Text color={last.ok ? 'success' : 'warning'} wrap="wrap">
            上次：{last.where}・{last.exit}・{last.took}・{last.at}
            {last.ok ? '' : last.trial === true ? '。照輸出改好再試跑一次。' : last.merge === true ? (setup?.stuck === true ? '。合回先停住：照輸出改好、按［試跑］確認，再回覆「待你決定」裡 crew 的問題。' : '。照輸出改好、按［試跑］確認。') : '。全端照樣開工，crew 把最後 20 行輸出告訴它。'}
          </Text>
        )}
        {last?.tail !== undefined && <Text dimColor>{last.tail}</Text>}
        {last !== undefined && (
          <Text dimColor wrap="truncate-end">
            證據在 {last.log}
          </Text>
        )}
      </Box>
    </Box>
  )
}

function MemoryList({ el, snap, view, act }: { el: Elements; snap: Snapshot; view: View; act: Actions }) {
  const { Box, Text, Button } = el
  const fields = (
    <Box flexDirection="column" rowGap={ROW_GAP}>
      {SettingRow({ el, view, act, id: 'recall', name: '搜尋', body: Field({ el, id: 'recall', placeholder: '關鍵字或編號', submit: '搜尋', what: '搜尋', onSubmit: q => act.recall(q) }) })}
      {snap.recalled !== undefined && (
        <Box flexDirection="column" paddingLeft={NAME_WIDTH + 1}>
          <Text color="suggestion">找到（{snap.recalled.query}）：</Text>
          <Text>{snap.recalled.text}</Text>
        </Box>
      )}
      {SettingRow({ el, view, act, id: 'remember', name: '記下偏好', body: Field({ el, id: 'remember', placeholder: '文案用台灣用語', submit: '記下', what: '偏好', onSubmit: text => act.remember(text) }) })}
      {SettingRow({
        el,
        view,
        act,
        id: 'consolidate',
        name: '整理記憶',
        body: <Button key="consolidate" label="整理今天的記憶" onPress={() => act.consolidate()} />,
        help: '小模型把今天的紀錄整理成事實和教訓，不會產生決定。',
      })}
    </Box>
  )
  if (snap.memories.length === 0) {
    return (
      <Box flexDirection="column" gap={1}>
        {fields}
        <Text dimColor>還沒有記憶。角色的決定、發現的限制和你的偏好會存在這裡。</Text>
      </Box>
    )
  }
  return (
    <Box flexDirection="column" gap={1}>
      {Pinned({ el, snap, act })}
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
                ['8%', m.builders === true ? `${MEMORY_TYPE_NAMES[m.type]}・固定` : MEMORY_TYPE_NAMES[m.type], { dimColor: isOld }],
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

function Tokens({ el, snap, view, act }: { el: Elements; snap: Snapshot; view: View; act: Actions }) {
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
        {el.web === true && TodayBars({ el, snap })}
        <Box flexDirection="column">
          {Row({ el, cells: head, head: true })}
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
        {snap.audit !== undefined && AuditSection({ el, view, act, audit: snap.audit })}
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
      {snap.guard !== undefined ? GuardSection({ el, g: snap.guard, view, act, tuning: snap.tuning }) : snap.tuning !== undefined && TuningRow({ el, view, act, tuning: snap.tuning })}
      {used}
      {snap.alerts.length > 0 && Alerts({ el, alerts: snap.alerts })}
      {snap.actions.length > 0 && (
        <Box flexDirection="column" rowGap={ROW_GAP}>
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

/** Today's tokens by role, as the page's bar chart: the most at full width. */
function TodayBars({ el, snap }: { el: Elements; snap: Snapshot }) {
  const { Box, Text } = el
  const rows = snap.roles.filter(r => r.slot === undefined && r.today > 0).sort((a, b) => b.today - a.today)
  if (rows.length === 0) return null
  const most = Math.max(1, ...rows.map(r => r.today))
  return (
    <Box flexDirection="column" rowGap={LIST_GAP} {...look(el, 'bars')}>
      <Text dimColor {...look(el, 'cap')}>
        今天用掉的，依角色
      </Text>
      {rows.map(r => Bar({ el, name: ROLE_NAMES[r.id], pct: (r.today / most) * 100, n: tokens(r.today) }))}
    </Box>
  )
}

/** The reminders sent to the brain, each with when. */
function Alerts({ el, alerts }: { el: Elements; alerts: Snapshot['alerts'] }) {
  const { Box, Text } = el
  return (
    <Box flexDirection="column">
      <Text color="warning">提醒已送大腦（同一條件數字變差才再提醒，一小時最多一次）</Text>
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

/** The pane when crew could not draw it: says why, rather than an empty pane, and draws again at a press or crew's next change. */
export function PaneFailed({ el, error, redraw }: { el: Elements; error: unknown; redraw?: () => void }) {
  const { Box, Text, Button } = el
  return (
    <Box flexDirection="column" gap={1}>
      <Text color="error">{paneFailure(error)}</Text>
      {redraw === undefined ? (
        <Text dimColor>請回報這個問題。</Text>
      ) : (
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Button key="redraw" label="重畫" onPress={redraw} />
          <Text dimColor>crew 有新進度時也會自己重畫；一直畫不出來請回報這個問題。</Text>
        </Box>
      )}
    </Box>
  )
}

/** The whole pane: header, tabs and the open tab. */
export function CrewPane({ el, snap, view, act, isDemo = true, watching, tabs = true }: { el: Elements; snap: Snapshot; view: View; act: Actions; isDemo?: boolean; watching?: string; tabs?: boolean }) {
  const { Box } = el
  const page = view.pages.length > 0 ? snap.page : undefined
  const tab = page === undefined ? view.tab : undefined
  return (
    <Box flexDirection="column" gap={1}>
      {Header({ el, snap, view, act, isDemo, tabs })}
      {watching !== undefined && Watching({ el, who: watching, act })}
      {page?.type === 'item' && ItemPageView({ el, page, act })}
      {page?.type === 'run' && RunPageView({ el, page, act })}
      {page?.type === 'thread' && ThreadPageView({ el, snap, item: page.item, act })}
      {tab === 'overview' && Overview({ el, snap, view, act })}
      {tab === 'progress' && ProgressTab({ el, snap, view, act })}
      {tab === 'board' && Board({ el, snap, view, act })}
      {tab === 'threads' && Threads({ el, snap, view, act })}
      {tab === 'log' && LogTab({ el, snap, view, act })}
      {tab === 'memory' && MemoryList({ el, snap, view, act })}
      {tab === 'tokens' && Tokens({ el, snap, view, act })}
      {tab === 'models' && ModelsTab({ el, snap, view, act, isDemo })}
      {tab === 'settings' && Settings({ el, snap, view, act, isDemo })}
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

/** A role's row by name: 全端 2 for the second builder. */
const rowName = (r: RoleRow): string => (r.slot === undefined ? ROLE_NAMES[r.id] : `${ROLE_NAMES[r.id]} ${r.slot}`)

/** The one line above the prompt: what needs the person first, then the roles. */
export function bandText(snap: Snapshot, label = 'crew（設計稿）'): string {
  const roles = snap.roles
    .map(r => `${r.id === 'techlead' ? 'TL' : rowName(r)} ${r.state === 'working' ? r.doing.split(' ')[0] : ROLE_STATE_NAMES[r.state]}`)
    .join(' · ')
  const parts = [
    label,
    ...(snap.guard?.hold === undefined ? [] : [`⏸ crew 暫停中 · Claude 用量 ${percentWords(snap.guard.hold.percent)} · ${snap.guard.hold.resets} 後接著做`]),
    ...(snap.boardProblem === undefined ? [] : ['⚠ 看板讀不到']),
    ...(snap.takeover?.on === true ? takeoverWords(snap.takeover) : []),
    // With no PRD under way, the progress of a board an earlier one left is history, as in the pane's head.
    ...(snap.progress !== null && !waitsForWord(snap) ? [`進度 ${percentOf(snap.progress)}%（${snap.progress.done}/${snap.progress.total}）`] : []),
    ...(snap.alignment === undefined ? [] : [alignmentWord(snap.alignment)]),
    ...(snap.modelAsks !== undefined && snap.modelAsks.length > 0 ? [`⚠ 模型 ${snap.modelAsks.length}`] : []),
    `待你決定 ${waitingCount(snap)}`,
    ...(snap.pageDue === true ? ['待你決定頁等下一個動作更新'] : []),
    // A flow held for the person is said here too, for when the pane is closed.
    ...(snap.start?.resumable !== undefined ? ['⏸ 等你接續'] : []),
    ...(snap.carry !== undefined ? ['另一份 crew 有這個 repo 的進度'] : []),
    ...(snap.twin !== undefined ? [snap.twin === '另一個 Claude Code session' ? '⚠ 另一個 session 也開著 crew' : '⚠ 另一份 crew 也在做這個 repo'] : []),
    ...(snap.alerts.length > 0 ? [`⚠ ${snap.alerts.length} 則提醒`] : []),
    `今日 ${tokens(snap.today)} tok${snap.codexToday === undefined ? '' : ` · Codex ${tokens(snap.codexToday)}`}`,
    roles,
  ]
  return parts.join(' │ ')
}

/**
 * crew's web page as the pane tells of it: starting, up with its links (this
 * computer's carries the key the page trades for its token; the tailnet's, or
 * why there is none), or down and why. Off where crew starts none (no
 * surface, or tests).
 */
export type WebStatus =
  | { state: 'off' }
  | { state: 'starting' }
  | { state: 'up'; local: string; open: string; remote?: string; remoteWhy?: string }
  | { state: 'down'; why: string }

/** The page's tabs: 待你決定 first, then the pane's own. */
export type WebTab = CrewTab | 'decide'

/** Where the work stands, in one line, for the pane's head and the page's: held, not begun, or how far and who is at work. */
export function statusWords(snap: Snapshot): { chip?: string; text: string } {
  if (snap.guard?.hold !== undefined) return { chip: '暫停中', text: `Claude 用量 ${percentWords(snap.guard.hold.percent)}，${snap.guard.hold.resets} 重置後自動接續` }
  if (snap.takeover?.on === true && snap.takeover.draft !== undefined) return { chip: 'PRD 草稿', text: takeoverWords(snap.takeover)[0] ?? snap.takeover.draft.title }
  if (snap.prd === null) return { text: waitsForWord(snap) ? '大腦接手中，還沒有 PRD：在主對話說你要做什麼。' : '這個專案還沒有開始任何 PRD。在網頁上選一份 PRD 開始，或直接跟 Claude 說要用 crew 做哪一份 PRD。' }
  const working = snap.roles.filter(r => r.state === 'working').map(r => `${rowName(r)} 在做 ${r.doing.split(' ')[0] ?? ''}`.trim())
  const progress = snap.progress === null ? undefined : `進度 ${percentOf(snap.progress)}%（${snap.progress.done}/${snap.progress.total}）`
  const parts = [...(progress === undefined ? [] : [progress]), ...working.slice(0, 2), ...(working.length > 2 ? [`還有 ${working.length - 2} 位`] : [])]
  return { chip: working.length > 0 ? '開發中' : '待命', text: parts.length === 0 ? '沒有角色在做事' : parts.join('・') }
}

/**
 * One thing on 待你決定 as the pane lists it: its own key, a few words of it,
 * what it waits for, and the word that takes the page to it.
 */
export type PaneWait = { id: string; label: string; sub: string; go: string }

/** How many things the pane lists of 待你決定, and of the roles at work: the rest are on the page. */
const PANE_WAITS = 3
const PANE_ROLES = 8

/** The passed gates in one chip: runs in a row as one span (G0–G4), the runs apart joined. */
const passedGates = (gates: readonly Gate[]): string => {
  const runs: Gate[][] = []
  let run: Gate[] = []
  for (const g of gates) {
    if (g.state === 'pass') run.push(g)
    else if (run.length > 0) {
      runs.push(run)
      run = []
    }
  }
  if (run.length > 0) runs.push(run)
  return `${runs.map(r => (r.length === 1 ? (r[0] as Gate).id : `${(r[0] as Gate).id}–${(r[r.length - 1] as Gate).id}`)).join('、')} ✓`
}

/** The head's few words: who is at work, or what holds it; the page's head says the rest. */
const paneDoing = (snap: Snapshot): string => {
  // Held: the chip says so, and the line under the head says why.
  if (snap.guard?.hold !== undefined) return ''
  if (snap.takeover?.on === true && snap.takeover.draft !== undefined) return snap.takeover.draft.stage === 'confirm' ? '草稿等你確認' : '草稿審查中'
  if (snap.prd === null) return ''
  const working = snap.roles.filter(r => r.state === 'working')
  if (working.length === 0) return '沒有角色在做事'
  const first = working[0] as RoleRow
  // The item it is on when its work starts with one (TASK-263); the role's row below says the rest.
  const on = first.doing.match(/^[A-Z][A-Z0-9]*-\d+/)?.[0]
  return `${rowName(first)} ${on === undefined ? '在做事' : `在做 ${on}`}${working.length > 1 ? `・還有 ${working.length - 1} 位` : ''}`
}

/**
 * The pane while crew has a web page: the overview squeezed to the sidebar,
 * every line a press that takes crew's web page there (`go`, a word of go.ts):
 * the head, 待你決定's first few, the board against the PRD and crew's pulse,
 * the progress and its stages, the roles at work and those resting on one
 * line, the gates with the passed ones in one chip, the latest reminder, the
 * page's other tabs; then the page's links. While it starts, that it does;
 * stopped, why and 重開網頁, the rest drawn as before (a press starts it first).
 * A crew older than its files on disk says so (`behind`): how to take the new
 * one is on the page, as the pane writes no command to type.
 */
export function MinimalPane({ el, snap, web, behind = false, waits, restart, go, copy, closeApp = () => {} }: { el: Elements; snap: Snapshot; web: WebStatus; behind?: boolean; waits: readonly PaneWait[]; restart: () => void; go: (word: string) => void; copy: (text: string, surface?: string) => void; closeApp?: () => void }) {
  const { Box, Text, Button } = el
  const status = statusWords(snap)
  const total = Math.max(waitingAll(snap), waits.length)
  const draft = snap.takeover?.on === true && snap.takeover.draft !== undefined
  const title = draft ? (snap.takeover?.draft?.title ?? 'crew') : snap.prd === null ? 'crew' : `${snap.prd.id} ${snap.prd.title}`
  const chip = status.chip ?? (snap.prd === null && !draft ? '還沒開始' : undefined)
  const doing = paneDoing(snap)
  const p = snap.progress !== null && !waitsForWord(snap) ? snap.progress : null
  const pct = p === null ? 0 : percentOf(p)
  const latest = p?.recent[0]
  const busy = snap.roles.filter(r => r.state !== 'idle' || r.held !== undefined)
  const idle = snap.roles.filter(r => r.state === 'idle' && r.held === undefined)
  const keyOf = (r: RoleRow) => (r.slot === undefined ? r.id : `${r.id}-${r.slot}`)
  // A role with work or a report to show opens its details; one without, its row with 問 and 輪替.
  const roleWord = (r: RoleRow) => `overview~${r.task !== undefined || r.report !== undefined ? 'detail' : 'role'}~${keyOf(r)}`
  const passed = snap.gates.filter(g => g.state === 'pass')
  const alert = snap.alerts[0]
  const windows = snap.guard?.windows ?? []
  return (
    <Box flexDirection="column" rowGap={ROW_GAP}>
      <Button key="go-home" plain onPress={() => go('overview')}>
        <Text bold>{title}</Text> {chip === undefined ? '' : <Text color={chip === '暫停中' ? 'warning' : chip === '還沒開始' ? 'subtle' : 'suggestion'}>［{chip}］</Text>} {doing === '' ? '' : <Text dimColor>{doing}</Text>}
      </Button>
      {snap.guard?.hold !== undefined && (
        <Button key="go-hold" plain onPress={() => go('tokens')}>
          <Text color="warning">{status.text} ↗</Text>
        </Button>
      )}
      {snap.boardProblem !== undefined && (
        <Button key="go-board-problem" plain onPress={() => go('overview')}>
          <Text color="warning">⚠ 看板讀不到：{cut(snap.boardProblem.text, 80)} ↗</Text>
        </Button>
      )}
      {snap.twin !== undefined && (
        <Button key="go-twin" plain onPress={() => go('overview')}>
          <Text color="warning">{snap.twin === '另一個 Claude Code session' ? '⚠ 另一個 session 也開著 crew' : '⚠ 另一份 crew 也在做這個 repo'} ↗</Text>
        </Button>
      )}
      {behind && (
        <Button key="go-behind" plain onPress={() => go('overview')}>
          <Text color="warning">crew 有新版本還沒換上・換的方法在網頁上 ↗</Text>
        </Button>
      )}
      {web.state === 'down' && (
        <Box flexDirection="column" rowGap={ROW_GAP}>
          <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1}>
            <Text color="error" bold>
              網頁停了
            </Text>
            <Button key="web-restart" label="重開網頁" variant="primary" onPress={() => restart()} />
          </Box>
          <Text color="error" wrap="wrap">
            {web.why}
          </Text>
          <Text dimColor wrap="wrap">
            下面照常顯示；按任一項會先重開網頁，再打開那裡。
          </Text>
        </Box>
      )}
      {snap.prd === null && !draft && (
        <Button key="go-start" plain onPress={() => go('overview')}>
          <Text color="suggestion">{waitsForWord(snap) ? status.text : '還沒有 PRD。在網頁上開始第一份 ↗'}</Text>
        </Button>
      )}
      {total > 0 ? (
        <Box flexDirection="column" rowGap={LIST_GAP}>
          <Button key="go-decide" plain onPress={() => go('decide')}>
            <Text color="warning" bold>
              {total} 件事等你決定 ↗
            </Text>
          </Button>
          {waits.slice(0, PANE_WAITS).map(w => (
            <Button key={`go-wait-${w.id}`} plain onPress={() => go(w.go)}>
              {'  '}
              {w.label} <Text dimColor>{w.sub}</Text>
            </Button>
          ))}
          {total > Math.min(waits.length, PANE_WAITS) && (
            <Button key="go-wait-more" plain dimColor onPress={() => go('decide')}>
              {'  '}還有 {total - Math.min(waits.length, PANE_WAITS)} 件
            </Button>
          )}
        </Box>
      ) : (
        <Text dimColor>沒有事情等你決定</Text>
      )}
      {snap.acceptApp !== undefined && AcceptAppLine({ el, a: snap.acceptApp, close: closeApp })}
      {(snap.alignment !== undefined || snap.resident !== undefined || windows.length > 0) && (
        <Box flexDirection="column" rowGap={LIST_GAP}>
          {snap.alignment !== undefined && (
            <Button key="go-align" plain onPress={() => go('progress')}>
              <Text color={aligned(snap.alignment) ? 'success' : 'warning'}>
                對準 PRD {snap.alignment.covered}/{snap.alignment.total} {aligned(snap.alignment) ? '✓' : '⚠'}
              </Text>{' '}
              <Text dimColor>
                · PRD 更新於 {snap.alignment.prdChanged} · 即時檢查 {snap.alignment.checked}
              </Text>
            </Button>
          )}
          {(snap.resident !== undefined || windows.length > 0) && (
            <Button key="go-pulse" plain onPress={() => go('tokens')}>
              {snap.resident === undefined ? (
                ''
              ) : snap.resident.found === undefined ? (
                <Text dimColor>✓ 常駐・心跳 {snap.resident.checked}</Text>
              ) : (
                <Text color="warning">
                  ⚠ 常駐・心跳 {snap.resident.checked}發現：{cut(snap.resident.found, 60)}
                </Text>
              )}
              {windows.length > 0 ? (
                <Text dimColor>
                  {snap.resident === undefined ? '' : ' · '}Claude {windows.map(w => `${w.name} ${percentWords(w.percent)}`).join('・')}
                </Text>
              ) : (
                ''
              )}
            </Button>
          )}
        </Box>
      )}
      {p !== null && (
        <Box flexDirection="column" rowGap={LIST_GAP}>
          <Button key="go-progress" plain onPress={() => go('progress')}>
            <Text bold>整體進度 {pct}%</Text> <Text color="success">{bar(pct, 10)}</Text> <Text dimColor>{p.done}/{p.total} 項</Text>
          </Button>
          <Box flexDirection="row" flexWrap="wrap" rowGap={LIST_GAP} columnGap={1}>
            {p.stages.map((st, i) => {
              const label = `${st.label} ${st.state === 'done' ? '✓' : st.total === 0 ? '—' : `${st.done}/${st.total}`}`
              // The test results are the test gate's: its gaps, opened on the overview.
              const results = st.label === '測試結果'
              return (
                <Button key={results ? 'go-results' : `go-stage-${i}`} dimColor={st.state === 'pending'} onPress={() => go(results ? 'overview~gate~G6' : `progress~stage~${i}`)}>
                  <Text color={STAGE_COLORS[st.state]}>{label}</Text>
                </Button>
              )
            })}
          </Box>
          <Button key="go-today" plain onPress={() => go('log')}>
            目前在：{p.stages.filter(st => st.state === 'active').map(st => st.label).join('、') || '—'} · 今天完成 {p.daily.at(-1)?.done ?? 0} 項 <Text dimColor>（昨天 {p.daily.at(-2)?.done ?? 0} 項）</Text>
          </Button>
          {latest !== undefined && (
            <Button key="go-recent" plain onPress={() => go(`item~${latest.id}`)}>
              最近完成{' '}
              <Text dimColor>
                {latest.id} {cut(latest.title, 30)}（{ROLE_NAMES[latest.role]}，{latest.age}）
              </Text>
            </Button>
          )}
        </Box>
      )}
      {snap.roles.length > 0 &&
        (resting(snap) ? (
          <Text dimColor>{snap.roles.length} 個角色待命，沒有工作時不花 token。</Text>
        ) : (
          <Box flexDirection="column">
            <Text dimColor>角色</Text>
            <Box flexDirection="column" rowGap={LIST_GAP}>
              {busy.slice(0, PANE_ROLES).map(r => (
                <Box key={`role-${keyOf(r)}`} flexDirection="row" flexWrap="wrap" rowGap={LIST_GAP} columnGap={1}>
                  <Button key={`go-role-${keyOf(r)}`} plain onPress={() => go(roleWord(r))}>
                    <Text color={r.held === 'paused' ? 'warning' : STATE_COLORS[r.state]}>●</Text> {rowName(r)}{' '}
                    <Text dimColor>
                      {r.held === 'paused' ? '暫停' : ROLE_STATE_NAMES[r.state]} · {cut(r.held === 'finishing' ? `${r.doing}（這一輪做完就停）` : r.doing, 40)}
                      {r.route === undefined ? '' : ` · ${route(r.route)}`}
                      {r.slot === undefined ? ` · 今日 ${tokens(r.today)}` : ''}
                    </Text>
                  </Button>
                  {r.run !== undefined && <Button key={`go-run-${keyOf(r)}`} label="看執行過程" onPress={() => go(goWord(['run', r.id, ...(r.run?.item === undefined ? [] : [r.run.item])], 'overview'))} />}
                </Box>
              ))}
              {busy.length > PANE_ROLES && (
                <Button key="go-role-more" plain dimColor onPress={() => go('overview')}>
                  還有 {busy.length - PANE_ROLES} 個角色在做事
                </Button>
              )}
              {idle.length > 0 && (
                <Box flexDirection="row" flexWrap="wrap" rowGap={LIST_GAP} columnGap={1}>
                  <Text dimColor>閒著</Text>
                  {idle.map(r => (
                    <Button key={`go-idle-${keyOf(r)}`} label={rowName(r)} dimColor onPress={() => go(roleWord(r))} />
                  ))}
                </Box>
              )}
            </Box>
            {snap.awake !== undefined && <Text dimColor>● Mac 保持清醒中</Text>}
            {snap.checking !== undefined && (
              <Text dimColor wrap="wrap">
                {snap.checking.find === true ? `● QA 正在從 repo 找怎麼開 app（${snap.checking.feature}）` : `● QA 正在 app 裡操作 ${snap.checking.feature}（第 ${snap.checking.round} 輪）`}
              </Text>
            )}
          </Box>
        ))}
      {snap.gates.length > 0 && (
        <Box flexDirection="column">
          <Text dimColor>關卡</Text>
          <Box flexDirection="row" flexWrap="wrap" rowGap={LIST_GAP} columnGap={1}>
            {passed.length > 0 && (
              <Button key="go-gates" onPress={() => go(goWord(['overview', 'gates', (passed[0] as Gate).id], 'overview'))}>
                <Text color="success">{passedGates(snap.gates)}</Text>
              </Button>
            )}
            {snap.gates
              .filter(g => g.state !== 'pass')
              .map(g => (
                <Button key={`go-gate-${g.id}`} dimColor={g.state === 'pending'} onPress={() => go(goWord(['overview', 'gate', g.id], 'overview'))}>
                  <Text color={GATE_TEXT(g)[1]}>{GATE_TEXT(g)[0]}</Text>
                </Button>
              ))}
          </Box>
        </Box>
      )}
      {alert !== undefined && (
        <Button key="go-alert" plain onPress={() => go('tokens~alerts')}>
          <Text color="warning">⚠ 提醒已送大腦：{cut(alert.text, 60)}</Text>
          {snap.alerts.length > 1 ? <Text dimColor>（共 {snap.alerts.length} 則）</Text> : ''}
        </Button>
      )}
      <Box flexDirection="row" flexWrap="wrap" rowGap={LIST_GAP} columnGap={1}>
        {TABS.filter(([id]) => id !== 'overview' && id !== 'progress').map(([id, label]) => (
          <Button key={`go-tab-${id}`} label={label} onPress={() => go(id)} />
        ))}
      </Box>
      <Box flexDirection="column" rowGap={ROW_GAP}>
        <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1}>
          <Text dimColor>這台電腦</Text>
          {web.state === 'starting' && <Text dimColor>網頁啟動中…</Text>}
          {web.state === 'down' && <Text dimColor>網頁停了，按上面任一項會先重開</Text>}
          {web.state === 'up' && <Text wrap="wrap">{web.local}</Text>}
        </Box>
        {web.state === 'up' && (
          <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1} paddingLeft={2}>
            {/* A button, not a link: the desktop app opens only https links. It goes to the overview as every press here does: every crew tab open on this Mac is moved there, else one opens. */}
            <Button key="web-page-open" label="開啟 ↗" variant="primary" onPress={() => go('overview')} />
            <Button key="web-copy-local" label="複製" onPress={(press: { surface?: string } | undefined) => copy(web.open, press?.surface)} />
          </Box>
        )}
        <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1}>
          <Text dimColor>其他裝置</Text>
          {web.state !== 'up' ? (
            <Text dimColor>—</Text>
          ) : web.remote === undefined ? (
            <Text dimColor wrap="wrap">
              {web.remoteWhy ?? 'Tailscale 沒有連線。打開 Tailscale 後，這裡會出現連結。'}
            </Text>
          ) : (
            <Text wrap="wrap">{web.remote}</Text>
          )}
        </Box>
        {web.state === 'up' && web.remote !== undefined && (
          <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1} paddingLeft={2}>
            <Button key="web-copy-remote" label="複製" onPress={(press: { surface?: string } | undefined) => copy(web.remote ?? '', press?.surface)} />
            <Text dimColor>只有你的 Tailscale 帳號能開</Text>
          </Box>
        )}
      </Box>
    </Box>
  )
}

/**
 * The page's 待你決定: everything that waits for the person, each settled
 * where it is shown, as on the overview: the draft to confirm, the questions,
 * the designs, the features to accept, the questions on a role's model.
 */
export function DecideTab({ el, snap, view, act, embedded = false }: { el: Elements; snap: Snapshot; view: View; act: Actions; embedded?: boolean }) {
  const { Box, Text, Button } = el
  // On crew's web page the decide page is drawn below this column: the draft, the designs, the roles' questions and
  // the features to accept are decided there, and only what the page does not hold is here.
  // The brain's own questions are on the decide page too, all but its proposals on usage: answered there, not twice.
  const decisions = embedded ? snap.decisions.filter(d => d.kind !== 'review' && !(d.from === 'brain' && d.kind !== 'proposal')) : snap.decisions
  const waiting = embedded ? decisions.reduce((n, d) => n + (d.count ?? 1), 0) : waitingCount(snap)
  const accepts = !embedded && snap.accepts !== undefined && snap.accepts.rows.length > 0
  const asks = snap.modelAsks !== undefined && snap.modelAsks.length > 0
  const draft = !embedded && snap.takeover?.on === true && snap.takeover.draft !== undefined
  const nothing = !embedded && waiting === 0 && !accepts && !asks && !draft && snap.start?.resumable === undefined && snap.carry === undefined
  return (
    <Box flexDirection="column" gap={1}>
      {el.web !== true && <Text bold>待你決定</Text>}
      <Text dimColor wrap="wrap" {...look(el, 'cap')}>
        {el.web === true ? '按下去 crew 當場記下。只有在等這一題的任務會停，其他任務照常進行。' : '按下去 crew 當場記下。設計稿的畫面在待你決定頁上看。'}
      </Text>
      {!embedded && PageRow({ el, snap, act })}
      {snap.carry !== undefined && CarryCard({ el, c: snap.carry, act })}
      {snap.start?.resumable !== undefined && (
        <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1} {...look(el, 'item open')}>
          <Text color="suggestion">{snap.start.resumable}</Text>
          <Button key="resume" label="接續" variant="primary" onPress={() => act.resume()} />
          {snap.start.paused !== true && <Button key="not-now" label="先不要" onPress={() => act.notNow()} />}
        </Box>
      )}
      {draft && TakeoverScreen({ el, snap, act })}
      {asks && ModelAsks({ el, asks: snap.modelAsks ?? [], act })}
      {decisions.length > 0 && (
        <Box flexDirection="column" rowGap={LIST_GAP} {...look(el, 'list')}>
          <Text color="warning" {...look(el, 'h3')}>
            {embedded ? '其他要你回答或核准的' : '要你回答或核准的'}（{waiting}）
          </Text>
          {capped(view, 'decisions', decisions).rows.map(d => DecisionRow({ el, d, act }))}
          {MoreLine({ el, act, id: 'decisions', total: decisions.length, all: capped(view, 'decisions', decisions).all, noun: '項' })}
        </Box>
      )}
      {accepts && AcceptRows({ el, snap, act, view })}
      {snap.opened !== undefined && (
        <Box flexDirection="column" rowGap={ROW_GAP}>
          <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1}>
            <Text bold>
              {snap.opened.id} {snap.opened.title}
            </Text>
            <Button key="close-design" label="關閉" onPress={() => act.viewDesign(null)} />
          </Box>
          <Text wrap="wrap">{snap.opened.body}</Text>
        </Box>
      )}
      {nothing && <Text dimColor>沒有事情等你決定。</Text>}
    </Box>
  )
}

/**
 * How crew stands, for the page's overview: the board against the PRD, crew
 * staying on and Claude's windows, and where the decide page is. The pane says
 * it in its head; the page's head is its title, so it is said here once.
 */
function WebStatusCard({ el, snap }: { el: Elements; snap: Snapshot }) {
  const { Box, Text } = el
  const status = StatusLine({ el, snap })
  // The decide page's row says its link once it has one; while it is published again, the last link is here.
  const link = snap.pageLink !== undefined && snap.decidePage?.url === undefined && !snap.decisions.some(d => d.url !== undefined) ? snap.pageLink : undefined
  if (snap.alignment === undefined && status === null && link === undefined) return null
  return (
    <Box flexDirection="column" rowGap={ROW_GAP} {...look(el, 'card')}>
      <Text bold {...look(el, 'h3')}>
        crew 現況
      </Text>
      {snap.alignment !== undefined && Alignment({ el, a: snap.alignment })}
      {status}
      {link !== undefined && (
        <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1}>
          <Text dimColor>進度圖和已經決定的事在待你決定頁</Text>
          {ReviewLink({ el, url: link })}
        </Box>
      )}
    </Box>
  )
}

/** The demo's own row on the page: which scenario it shows, and the way out of it. */
function DemoRow({ el, view, act }: { el: Elements; view: View; act: Actions }) {
  const { Box, Text, Button } = el
  return (
    <Box flexDirection="row" flexWrap="wrap" rowGap={ROW_GAP} columnGap={1} {...look(el, 'states')}>
      <Text dimColor>示意情境</Text>
      {SCENARIOS.map(([id, label]) => (
        <Button key={`scenario-${id}`} label={label} variant={view.scenario === id ? 'primary' : 'secondary'} onPress={() => act.scenario(id)} />
      ))}
      <Button key="demo-close" label="關閉設計稿" onPress={() => act.demoOff()} />
    </Box>
  )
}

/**
 * The page's main column: the tab's name, then 待你決定 or one of the pane's
 * tabs with its sections as cards, or the page opened over it in a card. The
 * page's head says what the pane's does (the PRD, where it stands), so the
 * pane's head is not drawn again here.
 */
export function WebMain({ el, snap, view, act, isDemo, tab, embedded = false }: { el: Elements; snap: Snapshot; view: View; act: Actions; isDemo: boolean; tab: WebTab; embedded?: boolean }) {
  const { Box, Text } = el
  const page = view.pages.length > 0 ? snap.page : undefined
  const name = tab === 'decide' ? '待你決定' : (TABS.find(([id]) => id === tab)?.[1] ?? '')
  const body =
    page?.type === 'item'
      ? ItemPageView({ el, page, act })
      : page?.type === 'run'
        ? RunPageView({ el, page, act })
        : page?.type === 'thread'
          ? ThreadPageView({ el, snap, item: page.item, act })
          : tab === 'decide'
            ? DecideTab({ el, snap, view, act, embedded })
            : tab === 'overview'
              ? Overview({ el, snap, view, act })
              : tab === 'progress'
                ? ProgressTab({ el, snap, view, act })
                : tab === 'board'
                  ? Board({ el, snap, view, act })
                  : tab === 'threads'
                    ? Threads({ el, snap, view, act })
                    : tab === 'log'
                      ? LogTab({ el, snap, view, act })
                      : tab === 'memory'
                        ? MemoryList({ el, snap, view, act })
                        : tab === 'tokens'
                          ? Tokens({ el, snap, view, act })
                          : tab === 'models'
                            ? ModelsTab({ el, snap, view, act, isDemo })
                            : Settings({ el, snap, view, act, isDemo })
  return (
    <Box flexDirection="column" gap={1}>
      {isDemo && DemoRow({ el, view, act })}
      {page === undefined && (
        <Text bold {...look(el, 'h2')}>
          {name}
        </Text>
      )}
      {page === undefined && tab === 'overview' && WebStatusCard({ el, snap })}
      {page === undefined ? (
        asCards(body)
      ) : (
        <Box flexDirection="column" rowGap={ROW_GAP} {...look(el, 'card')}>
          {body}
        </Box>
      )}
    </Box>
  )
}
