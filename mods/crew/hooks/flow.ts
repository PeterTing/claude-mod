import { gateG1, gateG3, gateG4 } from './board'
import type { GateGap, Tracker } from './board'
import { gateG0, refsOf, requirementList } from './prd'
import type { Requirement } from './prd'
import { routeFor, tierFor } from './router'
import type { Route } from './router'

/**
 * The PM + QA slice as a pure state machine: the PRD becomes features and
 * criteria (G1), QA writes a test case for every criterion (G4), the gaps go
 * to the PM, the PM drops what is out of scope or keeps it for QA, and after
 * three rounds the person decides. Every gate is computed in code.
 */

export type FlowStage = 'idle' | 'splitting' | 'writing_tests' | 'confirming' | 'adding_tests' | 'planning' | 'done' | 'escalated'

/** The roles the flow gives work to. */
export type FlowRole = 'pm' | 'qa' | 'techlead'

export type FlowState = {
  stage: FlowStage
  /** Rounds of QA → PM → QA that still left gaps. */
  round: number
  /** Times the PM was sent back to the split. */
  retries: number
  /** Times the PM was sent back because the board did not answer the PRD (G0), counted apart from the split's. */
  aligning?: number
  /** The PRD change the PM was last told about, so a change is told once. */
  synced?: string
  /** The PM synced while QA was still at work: the flow waits for QA's run to end, then gives it what is new. */
  awaitingQa?: boolean
  /** Where an escalated flow picks up once the person answers. */
  resumeAt?: ResumeAt
}

type ResumeAt = 'splitting' | 'confirming' | 'planning'

export const INITIAL: FlowState = { stage: 'idle', round: 0, retries: 0 }

/** The stages in which a role is at work on the PRD: a new start waits, a restart resumes. */
export const RUNNING: readonly FlowStage[] = ['splitting', 'writing_tests', 'confirming', 'adding_tests', 'planning']

/** `requirements`: the PRD's requirements as it stands now, which G0 holds the board to; absent, G0 is not checked. */
export type FlowEvent =
  /** `board`: the board as it stands; one that already answers this PRD is checked, not split again. */
  | { type: 'start'; prd: { path: string; size: number; text?: string }; requirements?: readonly Requirement[]; board?: Tracker }
  /** `inbox`: items whose threads hold messages to that role it has not been woken for yet. */
  /** `qaWorking`: QA has a run under way right now, as crew sees its agents. */
  | { type: 'role_done'; role: FlowRole; board: Tracker; inbox?: Inbox; requirements?: readonly Requirement[]; qaWorking?: boolean }
  /**
   * The PRD file changed: what it added and removed since the board last
   * answered it. `key` names the change, told to the PM once; `unlinked`: the
   * board was made before crew numbered requirements, and none are linked yet.
   */
  | {
      type: 'prd_changed'
      board: Tracker
      requirements: readonly Requirement[]
      added: readonly Requirement[]
      removed: readonly Requirement[]
      key: string
      unlinked?: boolean
    }
  /** The person answered a question: the flow's own (`escalation`), or one a role asked with ask_person. */
  | { type: 'answered'; question: string; answer: string; role?: FlowRole; escalation?: boolean }
  /** Claude Code started again on a flow the last session left running: its roles are gone. */
  | { type: 'resume'; board: Tracker; prd: { path: string; size: number; text?: string }; requirements?: readonly Requirement[] }

export type FlowAction =
  | { type: 'spawn'; role: FlowRole; route: Route; prompt: string }
  /** `person`: the message carries the person's answer, not the flow's next step. */
  | { type: 'message'; role: FlowRole; item?: string; text: string; route: Route; person?: true }
  | { type: 'ask_person'; question: string; item?: string }
  | { type: 'status'; text: string }
  | { type: 'done'; text: string }

export type StepResult = { state: FlowState; actions: FlowAction[] }

export type Inbox = { pm?: readonly string[]; qa?: readonly string[]; techlead?: readonly string[] }

const MAX_ROUNDS = 3
const MAX_RETRIES = 2

const list = (gaps: readonly GateGap[]): string => gaps.map(g => `- ${g.id} ${g.title}`).join('\n')

const ids = (gaps: readonly GateGap[]): string => gaps.map(g => g.id).join('、')

const criteriaCount = (board: Tracker): number => gateG4(board).total

const SOURCES =
  '每個 add_feature 的 sources 寫它對應的 PRD 需求編號（R-…），每一條需求都要有功能對應；不做的需求用 drop_requirement（id 填需求編號，reason 寫理由）。'

const splitPrompt = (path: string, requirements: readonly Requirement[] = [], answered: readonly string[] = []): string =>
  [
    `請把 ${path} 這份 PRD 拆成功能與驗收條件，寫進看板。`,
    '1. 先用 Read 讀 PRD。',
    '2. 用 board_write 一次送出：每個功能一個 add_feature，每個功能底下至少一條 add_criterion。驗收條件要可以驗證、一條只講一件事。',
    ...(requirements.length > 0 ? [`   ${SOURCES}`, `   crew 從 PRD 找出的需求：\n${requirementList(requirements)}`] : []),
    ...(answered.length > 0 ? [`   看板上已經有功能對應這些需求，不用重複：${answered.join('、')}`] : []),
    '3. PRD 沒寫清楚、需要產品決定的地方，用 ask_person 問，不要自己猜。',
    '4. 完成後用一句話回報拆了幾個功能、幾條驗收條件。',
  ].join('\n')

const linkPrompt = (requirements: readonly Requirement[], gaps: readonly { id: string; title: string }[]): string =>
  [
    '看板上的功能還沒有對應到 PRD 需求編號：看板是在 crew 替 PRD 需求編號之前建立的。請讓看板跟上 PRD：',
    '- 已有的功能：用 link_requirements 掛上它對應的需求編號。',
    `- 沒有功能對應的需求：加功能和驗收條件（${SOURCES}）。`,
    `crew 從 PRD 找出的需求：\n${requirementList(requirements)}`,
    ...(gaps.length > 0 ? [`看板現在對不上 PRD 的地方：\n${list(gaps)}`] : []),
    '做完用一句話回報。',
  ].join('\n')

const syncPrompt = (added: readonly Requirement[], removed: readonly Requirement[], gaps: readonly { id: string; title: string }[]): string =>
  [
    'PRD 改了，請讓看板跟上。',
    ...(added.length > 0 ? [`新增的需求：\n${requirementList(added)}`] : []),
    ...(removed.length > 0 ? [`移除的需求：\n${requirementList(removed)}`] : []),
    ...(gaps.length > 0 ? [`看板現在對不上 PRD 的地方：\n${list(gaps)}`] : []),
    `新需求：加功能和驗收條件（${SOURCES}），或用 link_requirements 掛到既有功能。已移除的需求：對應的功能用 drop_feature，或用 link_requirements 改掛到其他需求。做完用一句話回報。`,
  ].join('\n')

const testsPrompt = (count: number): string =>
  [
    `看板上有 ${count} 條驗收條件，請為每一條寫至少一個 test case。`,
    '1. 用 board_read 看全部的驗收條件。',
    '2. 用 board_write 的 add_test_case 寫，criteria 填它覆蓋的驗收條件編號；步驟具體、預期結果可以判斷對錯，包含邊界情況。',
    '3. 驗收條件寫得不清楚、無法測，用 thread_post 問 PM（item 填該驗收條件編號），不要硬寫。',
    '4. 完成後用一句話回報寫了幾個 test case。',
  ].join('\n')

const planPrompt = (count: number): string =>
  [
    `看板上有 ${count} 條驗收條件，QA 都寫好 test case 了。請把它們拆成實作任務。`,
    '1. 用 board_read 看全部的功能、驗收條件和 test case。',
    '2. 用 board_write 的 add_task 寫任務：feature 填功能編號，criteria 填這個任務做完後滿足的驗收條件編號，title 寫要做什麼，detail 寫要改哪些地方、和其他任務的先後，size 填 S、M、L 或 XL。每條驗收條件都要有任務對應。',
    '3. 技術上做不到、或需要 PM 取捨的，用 thread_post 問 PM（item 填驗收條件編號）；需要產品決定的用 ask_person。不要自己改驗收條件。',
    '4. 完成後用一句話回報拆了幾個任務。',
  ].join('\n')

const planGaps = (gaps: readonly GateGap[]): string =>
  [`看板上以下 ${gaps.length} 條驗收條件還沒有任務，請補上（先用 board_read 看已經拆好的，不要重複）：`, list(gaps)].join('\n')

const resumeToTl = (gaps: readonly GateGap[]): string =>
  [`Claude Code 重開過，任務拆到一半：以下 ${gaps.length} 條驗收條件還沒有任務，請補上（先用 board_read 看已經拆好的，不要重複）：`, list(gaps)].join('\n')

const gapsToPm = (gaps: readonly GateGap[]): string =>
  [
    `QA 寫完 test case，以下 ${gaps.length} 條驗收條件還沒有 test case：`,
    list(gaps),
    '每一條請決定：',
    '- 這一版不做：用 board_write 的 drop_criterion 移出範圍，reason 寫清楚。',
    '- 要做：用 thread_post 告訴 QA 要怎麼測（item 填驗收條件編號）。',
    '決定完用一句話回報。',
  ].join('\n')

const gapsToQa = (gaps: readonly GateGap[]): string =>
  [`PM 確認以下 ${gaps.length} 條驗收條件要做，請補上 test case（PM 的說明在各自的討論串，用 thread_read 看）：`, list(gaps)].join('\n')

const resumeToQa = (gaps: readonly GateGap[]): string =>
  [`Claude Code 重開過，test case 寫到一半：以下 ${gaps.length} 條驗收條件還沒有 test case，請補上（先用 board_read 看已經寫好的，不要重複）：`, list(gaps)].join('\n')

const threadNotice = (from: string, items: readonly string[]): string =>
  `${from} 在這些項目的討論串留言給你：${items.join('、')}。請先用 thread_read 看完再處理：要回覆就用 thread_post，要調整看板就用 board_write。做完用一句話回報。`

/** Sends the PM back to what the board does not answer in the PRD; the second time, the person decides. */
const realign = (state: FlowState, gaps: readonly GateGap[]): StepResult => {
  const tries = state.aligning ?? 0
  if (tries >= MAX_RETRIES - 1) return escalate({ ...state, aligning: tries + 1 }, `看板還對不上 PRD：${ids(gaps)}。要怎麼處理？`, gaps[0]?.id, 'splitting')
  return {
    state: { ...state, stage: 'splitting', aligning: tries + 1 },
    actions: [
      {
        type: 'message',
        role: 'pm',
        item: gaps[0]?.id,
        text: `看板還對不上 PRD，請補上：\n${list(gaps)}\n${SOURCES} 已有的功能可以用 link_requirements 掛上需求編號。`,
        route: routeFor('pm', tierFor({ kind: 'confirm_gaps', size: gaps.length })),
      },
    ],
  }
}

/**
 * Every criterion has a test case: done once each has a task as well, and only
 * while the board answers the PRD as it stands; until then the tech lead plans.
 */
const finish = (state: FlowState, board: Tracker, requirements?: readonly Requirement[]): StepResult => {
  const g0 = requirements === undefined ? undefined : gateG0(board, requirements)
  if (g0 !== undefined && g0.gaps.length > 0) return realign(state, g0.gaps)
  const g3 = gateG3(board)
  if (g3.gaps.length > 0) return plan(state, g3)
  const g4 = gateG4(board)
  return {
    state: { ...state, stage: 'done' },
    actions: [{ type: 'done', text: `PM＋QA＋Tech lead 完成：每條驗收條件都有 test case（G4 ${g4.covered}/${g4.total}）和任務（G3 ${g3.covered}/${g3.total}）。` }],
  }
}

const tlRoute = (size: number): Route => routeFor('techlead', tierFor({ kind: 'plan_tasks', size: Math.max(1, size) }))

/** The tech lead breaks the criteria without tasks into tasks: the whole board the first time, what is new after. */
const plan = (state: FlowState, g3: ReturnType<typeof gateG3>): StepResult => {
  const next: FlowState = { ...state, stage: 'planning', retries: 0 }
  if (g3.covered === 0) return { state: next, actions: [{ type: 'spawn', role: 'techlead', route: tlRoute(g3.total), prompt: planPrompt(g3.total) }] }
  return { state: next, actions: [{ type: 'message', role: 'techlead', item: g3.gaps[0]?.id, text: planGaps(g3.gaps), route: tlRoute(g3.gaps.length) }] }
}

/** The tech lead's run ended: new criteria go to QA first; the PM answers the tech lead's questions; gaps go back, then to the person. */
const afterPlan = (state: FlowState, board: Tracker, inbox: Inbox = {}, requirements?: readonly Requirement[]): StepResult => {
  const g4 = gateG4(board)
  if (g4.gaps.length > 0) {
    return {
      state: { ...state, stage: 'adding_tests' },
      actions: [{ type: 'message', role: 'qa', item: g4.gaps[0]?.id, text: newCriteria(g4.gaps), route: routeFor('qa', tierFor({ kind: 'add_tests', size: g4.gaps.length })) }],
    }
  }
  const g3 = gateG3(board)
  const forPm = inbox.pm ?? []
  if (forPm.length > 0 && state.round < MAX_ROUNDS) {
    return {
      state: { ...state, stage: 'planning', round: state.round + 1 },
      actions: [{ type: 'message', role: 'pm', item: forPm[0], text: threadNotice('Tech lead', forPm), route: routeFor('pm', tierFor({ kind: 'confirm_gaps', size: forPm.length })) }],
    }
  }
  if (g3.gaps.length === 0) return finish(state, board, requirements)
  if (state.retries >= MAX_RETRIES - 1 || state.round >= MAX_ROUNDS) {
    return escalate({ ...state, retries: state.retries + 1 }, `這些驗收條件還是沒有任務：${ids(g3.gaps)}。要怎麼處理？`, g3.gaps[0]?.id, 'planning')
  }
  return {
    state: { ...state, stage: 'planning', retries: state.retries + 1 },
    actions: [{ type: 'message', role: 'techlead', item: g3.gaps[0]?.id, text: planGaps(g3.gaps), route: tlRoute(g3.gaps.length) }],
  }
}

/** The PM's run ended while the tech lead plans: its answers, or the plan's gaps, go back to the tech lead. */
const afterPmInPlanning = (state: FlowState, board: Tracker, inbox: Inbox = {}, requirements?: readonly Requirement[]): StepResult => {
  const g4 = gateG4(board)
  const forTl = inbox.techlead ?? []
  if (g4.gaps.length > 0) return afterPlan(state, board, {}, requirements)
  if (forTl.length > 0) {
    return { state, actions: [{ type: 'message', role: 'techlead', item: forTl[0], text: threadNotice('PM', forTl), route: tlRoute(forTl.length) }] }
  }
  const g3 = gateG3(board)
  if (g3.gaps.length === 0) return finish(state, board, requirements)
  return { state, actions: [{ type: 'message', role: 'techlead', item: g3.gaps[0]?.id, text: planGaps(g3.gaps), route: tlRoute(g3.gaps.length) }] }
}

const escalate = (state: FlowState, question: string, item: string | undefined, resumeAt: ResumeAt): StepResult => ({
  state: { ...state, stage: 'escalated', resumeAt },
  actions: [{ type: 'ask_person', question, ...(item === undefined ? {} : { item }) }],
})

const afterSplit = (state: FlowState, board: Tracker, requirements?: readonly Requirement[], qaWorking = false): StepResult => {
  const g1 = gateG1(board)
  const g0 = requirements === undefined ? { gaps: [] } : gateG0(board, requirements)
  if (g1.total > 0 && g1.gaps.length === 0 && g0.gaps.length === 0) {
    // QA is still writing the test cases it was given: its run ends first, and then it gets what is new.
    if (qaWorking) return { state: { ...state, stage: 'adding_tests', retries: 0, aligning: 0, awaitingQa: true }, actions: [] }
    const g4 = gateG4(board)
    // A board QA has tested before needs tests for what is new only.
    if (g4.covered > 0) {
      if (g4.gaps.length === 0) return finish({ ...state, retries: 0, aligning: 0 }, board, requirements)
      return {
        state: { ...state, stage: 'adding_tests', retries: 0, aligning: 0 },
        actions: [{ type: 'message', role: 'qa', item: g4.gaps[0]?.id, text: newCriteria(g4.gaps), route: routeFor('qa', tierFor({ kind: 'add_tests', size: g4.gaps.length })) }],
      }
    }
    const count = criteriaCount(board)
    return {
      state: { ...state, stage: 'writing_tests', aligning: 0 },
      actions: [{ type: 'spawn', role: 'qa', route: routeFor('qa', tierFor({ kind: 'write_tests', size: count })), prompt: testsPrompt(count) }],
    }
  }
  // Every feature has criteria, but the board does not answer the PRD yet.
  if (g1.total > 0 && g1.gaps.length === 0) return realign(state, g0.gaps)
  if (state.retries >= MAX_RETRIES - 1) {
    const what = g1.total === 0 ? 'PM 兩次都沒有在看板上建立任何功能。' : `這些功能還是沒有驗收條件：${ids(g1.gaps)}。`
    return escalate({ ...state, retries: state.retries + 1 }, `拆 PRD 卡住了：${what}要怎麼處理？`, g1.gaps[0]?.id, 'splitting')
  }
  const route = routeFor('pm', tierFor({ kind: 'confirm_gaps', size: Math.max(1, g1.gaps.length) }))
  const text =
    g1.total === 0
      ? '看板還是空的。請用 board_write 建立功能和驗收條件。'
      : `這些功能還沒有驗收條件，請補上，或用 drop_feature 移出範圍：\n${list(g1.gaps)}`
  return {
    state: { ...state, retries: state.retries + 1 },
    actions: [{ type: 'message', role: 'pm', ...(g1.gaps[0] === undefined ? {} : { item: g1.gaps[0].id }), text, route }],
  }
}

const afterTests = (state: FlowState, board: Tracker, inbox: Inbox = {}, requirements?: readonly Requirement[]): StepResult => {
  const g4 = gateG4(board)
  const forPm = inbox.pm ?? []
  // A run QA started before the PRD changed: what the PM added since is QA's to test, not the PM's to explain.
  if (state.awaitingQa === true) {
    const { awaitingQa: _, ...rest } = state
    if (g4.gaps.length > 0) {
      return {
        state: { ...rest, stage: 'adding_tests' },
        actions: [{ type: 'message', role: 'qa', item: g4.gaps[0]?.id, text: newCriteria(g4.gaps), route: routeFor('qa', tierFor({ kind: 'add_tests', size: g4.gaps.length })) }],
      }
    }
    return afterTests(rest, board, inbox, requirements)
  }
  if (g4.gaps.length === 0) {
    // Everything is covered, but QA asked the PM something: one more round, bounded like the others.
    if (forPm.length === 0 || state.round >= MAX_ROUNDS) return finish(state, board, requirements)
    return {
      state: { ...state, stage: 'confirming', round: state.round + 1 },
      actions: [{ type: 'message', role: 'pm', item: forPm[0], text: threadNotice('QA', forPm), route: routeFor('pm', tierFor({ kind: 'confirm_gaps', size: forPm.length })) }],
    }
  }
  if (state.round >= MAX_ROUNDS) {
    return escalate(
      state,
      `來回 ${MAX_ROUNDS} 輪後，這些驗收條件還是沒有 test case：${ids(g4.gaps)}。要移出範圍，還是由你說明怎麼測？`,
      g4.gaps[0]?.id,
      'confirming',
    )
  }
  const route = routeFor('pm', tierFor({ kind: 'confirm_gaps', size: g4.gaps.length }))
  return {
    state: { ...state, stage: 'confirming', round: state.round + 1 },
    actions: [{ type: 'message', role: 'pm', item: g4.gaps[0]?.id, text: gapsToPm(g4.gaps), route }],
  }
}

const afterConfirm = (state: FlowState, board: Tracker, inbox: Inbox = {}, requirements?: readonly Requirement[]): StepResult => {
  const g4 = gateG4(board)
  const forQa = inbox.qa ?? []
  if (g4.gaps.length === 0) {
    if (forQa.length === 0) return finish(state, board, requirements)
    return {
      state: { ...state, stage: 'adding_tests' },
      actions: [{ type: 'message', role: 'qa', item: forQa[0], text: threadNotice('PM', forQa), route: routeFor('qa', tierFor({ kind: 'add_tests', size: forQa.length })) }],
    }
  }
  const route = routeFor('qa', tierFor({ kind: 'add_tests', size: g4.gaps.length }))
  return {
    state: { ...state, stage: 'adding_tests' },
    actions: [{ type: 'message', role: 'qa', item: g4.gaps[0]?.id, text: gapsToQa(g4.gaps), route }],
  }
}

const answerText = (question: string, answer: string): string =>
  `你之前的問題：${question}\n使用者的決定：${answer}\n請照這個決定處理看板，完成後用一句話回報。`

const answered = (state: FlowState, event: Extract<FlowEvent, { type: 'answered' }>): StepResult => {
  const role = event.role ?? 'pm'
  const message: FlowAction = {
    type: 'message',
    role,
    text: answerText(event.question, event.answer),
    route: routeFor(role, tierFor({ kind: 'confirm_gaps', size: 1 })),
  }
  // A role's own question is the person's answer for that role to take in, even while the flow waits;
  // only the answer to the flow's own question takes a waiting flow on: with the tech lead for its plan,
  // otherwise with the PM, who resumes the split and the gaps.
  if (state.stage !== 'escalated' || event.escalation !== true) return { state, actions: [{ ...message, person: true }] }
  const resumeAt = state.resumeAt ?? 'confirming'
  const to: FlowRole = resumeAt === 'planning' ? 'techlead' : 'pm'
  const resumed: FlowAction = { ...message, role: to, route: to === 'techlead' ? tlRoute(1) : routeFor('pm', tierFor({ kind: 'confirm_gaps', size: 1 })) }
  const { resumeAt: _, ...rest } = state
  return {
    state: { ...rest, stage: resumeAt, round: resumeAt === 'splitting' ? rest.round : 0, retries: resumeAt === 'confirming' ? rest.retries : 0, ...(resumeAt === 'splitting' ? { aligning: 0 } : {}) },
    actions: [resumed],
  }
}

const newCriteria = (gaps: readonly GateGap[]): string =>
  [`看板上以下 ${gaps.length} 條驗收條件還沒有 test case，請補上（先用 board_read 看已經寫好的，不要重複）：`, list(gaps)].join('\n')

const resumeSplit = (path: string, requirements: readonly Requirement[] = []): string =>
  `${splitPrompt(path, requirements)}\n\nClaude Code 重開過，這份 PRD 之前拆到一半：先用 board_read 看看板，已經在看板上的不要重複，把還沒拆的拆完；已經拆完就直接回報。`

/** Picks up a flow whose roles went away with the last session, from what the board shows. */
const resume = (was: FlowState, event: Extract<FlowEvent, { type: 'resume' }>): StepResult => {
  // A QA run the flow waited for went with the last session: QA is asked afresh below.
  const { awaitingQa: _, ...state } = was
  const g4 = gateG4(event.board)
  switch (state.stage) {
    case 'splitting':
      // The board cannot tell a finished split from one cut short, so the PM finishes it.
      return {
        state,
        actions: [
          {
            type: 'spawn',
            role: 'pm',
            route: routeFor('pm', tierFor({ kind: 'split_prd', size: event.prd.size, ...(event.prd.text === undefined ? {} : { text: event.prd.text }) })),
            prompt: resumeSplit(event.prd.path, event.requirements),
          },
        ],
      }
    case 'writing_tests':
    case 'adding_tests':
      if (g4.gaps.length === 0) return afterTests(state, event.board, {}, event.requirements)
      return {
        state,
        actions: [{ type: 'message', role: 'qa', item: g4.gaps[0]?.id, text: resumeToQa(g4.gaps), route: routeFor('qa', tierFor({ kind: 'add_tests', size: g4.gaps.length })) }],
      }
    case 'planning': {
      const g3 = gateG3(event.board)
      if (g4.gaps.length > 0 || g3.gaps.length === 0) return afterPlan(state, event.board, {}, event.requirements)
      if (g3.covered === 0) return plan(state, g3)
      return { state, actions: [{ type: 'message', role: 'techlead', item: g3.gaps[0]?.id, text: resumeToTl(g3.gaps), route: tlRoute(g3.gaps.length) }] }
    }
    case 'confirming':
      if (g4.gaps.length === 0) return afterConfirm(state, event.board, {}, event.requirements)
      return {
        state,
        actions: [{ type: 'message', role: 'pm', item: g4.gaps[0]?.id, text: gapsToPm(g4.gaps), route: routeFor('pm', tierFor({ kind: 'confirm_gaps', size: g4.gaps.length })) }],
      }
    default:
      return { state, actions: [] }
  }
}

/**
 * The PRD file changed. The board goes back to the PM to sync and the flow runs
 * again from the split, with fresh rounds: QA finishing meanwhile waits for the
 * PM, and then tests only what is new. A flow that waits for the person keeps
 * waiting, and the PM is told. Each change is told once; before any PRD was
 * started there is nothing to sync.
 */
const prdChanged = (state: FlowState, event: Extract<FlowEvent, { type: 'prd_changed' }>): StepResult => {
  if (state.stage === 'idle' || state.synced === event.key) return { state, actions: [] }
  const gaps = gateG0(event.board, event.requirements).gaps
  const message: FlowAction = {
    type: 'message',
    role: 'pm',
    item: event.added[0]?.id ?? gaps[0]?.id ?? 'crew',
    text: event.unlinked === true ? linkPrompt(event.requirements, gaps) : syncPrompt(event.added, event.removed, gaps),
    route: routeFor('pm', tierFor({ kind: 'confirm_gaps', size: Math.max(1, event.added.length + event.removed.length) })),
  }
  if (state.stage === 'escalated') return { state: { ...state, synced: event.key }, actions: [message] }
  return { state: { stage: 'splitting', round: 0, retries: 0, aligning: 0, synced: event.key }, actions: [message] }
}

/** The PRD's requirements some feature in scope on the board already answers. */
export const answeredOf = (board: Tracker, requirements: readonly Requirement[]): string[] => {
  const linked = new Set(board.prd_items.filter(i => i.crew_dropped === undefined).flatMap(refsOf))
  return requirements.filter(r => linked.has(r.id)).map(r => r.id)
}

/** One event in, the next state and what to do out. */
export const step = (state: FlowState, event: FlowEvent): StepResult => {
  if (event.type === 'answered') return answered(state, event)
  if (event.type === 'resume') return resume(state, event)
  if (event.type === 'start') {
    if (RUNNING.includes(state.stage)) {
      return { state, actions: [{ type: 'status', text: 'PM＋QA 正在進行，等這一輪完成再開始新的。' }] }
    }
    // A board that already answers most of this PRD is checked and brought up to date, not split again;
    // that check is not one of the PM's retries.
    const answered = event.board === undefined || event.requirements === undefined ? [] : answeredOf(event.board, event.requirements)
    if (event.board !== undefined && event.requirements !== undefined && answered.length > 0 && answered.length * 2 >= event.requirements.length) {
      const r = afterSplit({ stage: 'splitting', round: 0, retries: 0 }, event.board, event.requirements)
      return r.state.stage === 'splitting' ? { ...r, state: { ...r.state, aligning: 0, retries: 0 } } : r
    }
    const tier = tierFor({ kind: 'split_prd', size: event.prd.size, ...(event.prd.text === undefined ? {} : { text: event.prd.text }) })
    return {
      state: { stage: 'splitting', round: 0, retries: 0 },
      actions: [{ type: 'spawn', role: 'pm', route: routeFor('pm', tier), prompt: splitPrompt(event.prd.path, event.requirements, answered) }],
    }
  }
  if (event.type === 'prd_changed') return prdChanged(state, event)
  const { role, board } = event
  const inbox = event.inbox ?? {}
  if (role === 'pm' && state.stage === 'splitting') return afterSplit(state, board, event.requirements, event.qaWorking === true)
  const { requirements } = event
  if (role === 'qa' && (state.stage === 'writing_tests' || state.stage === 'adding_tests')) return afterTests(state, board, inbox, requirements)
  if (role === 'pm' && state.stage === 'confirming') return afterConfirm(state, board, inbox, requirements)
  if (role === 'techlead' && state.stage === 'planning') return afterPlan(state, board, inbox, requirements)
  if (role === 'pm' && state.stage === 'planning') return afterPmInPlanning(state, board, inbox, requirements)
  // A finished board can open again: the PM adds criteria after an answer, or one role writes to the other;
  // a PM turn that left the board short of the PRD sends the PM back to it.
  if (state.stage === 'done') {
    const g0 = role === 'pm' && requirements !== undefined ? gateG0(board, requirements) : undefined
    if (g0 !== undefined && g0.gaps.length > 0) return realign(state, g0.gaps)
    if (role === 'pm' && (gateG4(board).gaps.length > 0 || (inbox.qa ?? []).length > 0)) return afterConfirm(state, board, inbox, requirements)
    if (role === 'qa' && (inbox.pm ?? []).length > 0) return afterTests(state, board, inbox, requirements)
    if (role === 'techlead' && (gateG3(board).gaps.length > 0 || (inbox.pm ?? []).length > 0)) return afterPlan(state, board, inbox, requirements)
    if (role !== 'techlead' && (inbox.techlead ?? []).length > 0) {
      const forTl = inbox.techlead ?? []
      return { state: { ...state, stage: 'planning' }, actions: [{ type: 'message', role: 'techlead', item: forTl[0], text: threadNotice(role === 'pm' ? 'PM' : 'QA', forTl), route: tlRoute(forTl.length) }] }
    }
  }
  return { state, actions: [] }
}
