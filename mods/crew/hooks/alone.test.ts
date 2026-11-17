import { describe, expect, test } from 'claude-code/testing'

import { applyOps, designsOf, newTracker } from './board'
import type { Op, Task, Tracker } from './board'
import { doingOf, restoreSaid, step, waitingOf } from './flow'
import type { FlowAction, FlowState } from './flow'
import { withCommits, withResults, withReviews } from './git'
import { withDecisions } from './designs'

/**
 * A question on one task, or on one feature QA checked, holds only that task
 * or feature and what is set after it: the rest is built meanwhile. And before
 * the person is asked why a task is not getting done, the tech lead looks.
 */

const ctx = (by: string) => ({ by, today: '2026-10-15', prefixes: { feature: 'PRD-', testCase: 'TC-' } })
const tc = (criteria: string[]): Op => ({ op: 'add_test_case', criteria, title: 't', steps: ['s'], expected: 'e' })

const SPLIT3: readonly Op[] = [
  { op: 'add_feature', title: '方案選擇', summary: '' },
  { op: 'add_criterion', feature: 'PRD-001', text: '可以選月繳方案' },
  { op: 'add_criterion', feature: 'PRD-001', text: '可以看到價格' },
  { op: 'add_criterion', feature: 'PRD-001', text: '可以改方案' },
]

/** Three tasks, one per criterion, each changing its own folder (so they build side by side), placed after others as given. */
const three = (after: Record<string, string[]> = {}): Tracker => {
  const a = applyOps(newTracker('shop'), SPLIT3, ctx('pm'))
  if (!a.ok) throw new Error(a.errors.join('; '))
  const b = applyOps(a.tracker, [tc(['AC-001', 'AC-002', 'AC-003'])], ctx('qa'))
  if (!b.ok) throw new Error(b.errors.join('; '))
  const d = applyOps(b.tracker, [{ op: 'add_design', feature: 'PRD-001', title: '畫面', kind: 'none', body: '沒有畫面' } as Op], ctx('uiux'))
  if (!d.ok) throw new Error(d.errors.join('; '))
  const designed = withDecisions(d.tracker, new Map(d.tracker.prd_items.flatMap(i => designsOf(i)).map(x => [x.id, { verdict: 'approved' as const }]))) ?? d.tracker
  const p = applyOps(designed, [1, 2, 3].map(n => ({ op: 'add_task', feature: 'PRD-001', criteria: [`AC-00${n}`], title: `任務 ${n}`, detail: '', size: 'S' }) as Op), ctx('techlead'))
  if (!p.ok) throw new Error(p.errors.join('; '))
  const dirs: Record<string, string> = { 'TASK-001': 'src/a', 'TASK-002': 'src/b', 'TASK-003': 'src/c' }
  return {
    ...p.tracker,
    prd_items: p.tracker.prd_items.map(i => ({
      ...i,
      tasks: (i.tasks ?? []).map(t => {
        const task = t as Task
        return { ...task, crew_touches: [dirs[task.id] ?? 'src/x'], ...(after[task.id] === undefined ? {} : { crew_after: after[task.id] }) }
      }),
    })),
  }
}

const commits = (b: Tracker, shas: Record<string, string[]>): Tracker => withCommits(b, new Map(Object.entries(shas))) ?? b
const verdict = (b: Tracker, id: string, sha: string, v: 'approve' | 'changes', notes?: string): Tracker =>
  withReviews(b, new Map([[id, { sha, verdict: v, ...(notes === undefined ? {} : { notes }) }]])) ?? b

/** The tasks given committed and approved, each at its one commit, in one go: a board's reviews are marked all at once. */
const approvedAll = (b: Tracker, shas: Record<string, string>): Tracker =>
  withReviews(commits(b, Object.fromEntries(Object.entries(shas).map(([id, sha]) => [id, [sha]]))), new Map(Object.entries(shas).map(([id, sha]) => [id, { sha, verdict: 'approve' as const }]))) ?? b

const ROOM = { limit: 4 }
const asks = (actions: readonly FlowAction[]) => actions.filter((a): a is Extract<FlowAction, { type: 'ask_person' }> => a.type === 'ask_person')
const toBuilders = (actions: readonly FlowAction[]) => actions.filter(a => (a.type === 'spawn' || a.type === 'message') && a.role === 'fullstack').map(a => (a as { item?: string }).item)
/** The set-aside work crew puts back before the builder on `id` starts, as the flow hands it over. */
const restoreOf = (actions: readonly FlowAction[], id: string) =>
  (actions.find(a => (a.type === 'spawn' || a.type === 'message') && a.role === 'fullstack' && a.item === id) as { restore?: { task: string; shelf: { sha: string; also?: readonly { sha: string }[]; moved?: readonly { dir: string; files: readonly string[] }[] } } } | undefined)?.restore

/** Building all three side by side: TASK-001 on slot 1, TASK-002 on slot 2, TASK-003 on slot 3. */
const building = (b: Tracker): FlowState => {
  const r = step({ stage: 'planning', round: 0, retries: 0 }, { type: 'role_done', role: 'techlead', board: b, room: ROOM })
  expect(toBuilders(r.actions)).toEqual(['TASK-001', 'TASK-002', 'TASK-003'])
  return r.state
}

describe('a task that waits holds only itself', () => {
  test('a builder with no commit twice: the tech lead looks first, then the person is asked with both their words, and only that task waits', () => {
    const b = three()
    let s = building(b)
    const slotOf = (id: string) => s.jobs?.[id]?.slot ?? 0
    const one = slotOf('TASK-001')
    // TASK-001's first run ends with nothing committed: it is asked again, with what to say if it cannot.
    const first = step(s, { type: 'role_done', role: 'fullstack', board: b, slot: one, room: ROOM, report: '要先決定價格格式' })
    expect((first.actions.find(a => a.type === 'message') as { text: string }).text).toMatch(/做不了就在回報裡寫清楚卡在哪裡/)
    s = first.state
    // The second: no question to the person yet. The tech lead looks, with the builder's words and crew's view of the worktree.
    const second = step(s, { type: 'role_done', role: 'fullstack', board: b, slot: one, room: ROOM, report: '測試一直連不到資料庫', facts: '分支：crew/task-001\n沒有沒 commit 的修改' })
    expect(second.state.stage).toBe('building')
    expect(asks(second.actions)).toEqual([])
    const look = second.actions.find(a => a.type === 'message' && a.role === 'techlead') as { text: string; item?: string } | undefined
    expect(look?.item).toBe('TASK-001')
    expect(look?.text).toMatch(/「測試一直連不到資料庫」/)
    expect(look?.text).toMatch(/分支：crew\/task-001/)
    expect(look?.text).toMatch(/set_task[\s\S]*after/)
    expect(second.state.jobs?.['TASK-001']).toMatchObject({ asking: true, look: { state: 'told' } })
    expect(second.state.talking).toBe(true)
    expect(waitingOf(second.state, b)).toContainEqual({ task: 'TASK-001', why: 'Tech lead 正在查它為什麼一直做不完' })
    s = second.state
    // The tech lead's run ends: its words go to TASK-001's builder.
    const told = step(s, { type: 'role_done', role: 'techlead', board: b, room: ROOM, report: '測試要用 sqlite 的記憶體資料庫，設定在 test/setup.ts' })
    expect(told.state.jobs?.['TASK-001']).toMatchObject({ look: { state: 'answered', tl: '測試要用 sqlite 的記憶體資料庫，設定在 test/setup.ts' } })
    expect(toBuilders(told.actions)).toEqual(['TASK-001'])
    expect((told.actions.find(a => a.type === 'message' && a.role === 'fullstack') as { text: string }).text).toMatch(/sqlite/)
    s = told.state
    // It fails once more: now the person is asked, with what each said, and only TASK-001 waits.
    const asked = step(s, { type: 'role_done', role: 'fullstack', board: b, slot: slotOf('TASK-001'), room: ROOM, report: 'sqlite 也裝不起來，沙箱擋住了 npm install' })
    expect(asked.state.stage).toBe('building')
    const q = asks(asked.actions)
    expect(q).toHaveLength(1)
    expect(q[0]).toMatchObject({ item: 'TASK-001', alone: true })
    expect(q[0]?.question).toMatch(/全端最後說：「sqlite 也裝不起來，沙箱擋住了 npm install」/)
    expect(q[0]?.question).toMatch(/Tech lead 查過後說：「測試要用 sqlite/)
    expect(q[0]?.question).toMatch(/只有 TASK-001 和排在它後面的任務等你回答，其他任務照常進行/)
    expect(q[0]?.question).not.toMatch(/兩次|沒有 commit/)
    expect(asked.state.jobs?.['TASK-001']).toMatchObject({ wait: { at: 'building', by: 'crew' } })
    expect(asked.state.jobs?.['TASK-001']?.slot).toBeUndefined()
    s = asked.state
    // The other builders go on meanwhile: TASK-002 commits and is reviewed.
    const other = step(s, { type: 'role_done', role: 'fullstack', board: commits(b, { 'TASK-002': ['bbb0002'] }), slot: slotOf('TASK-002'), room: ROOM })
    expect(other.state.stage).toBe('building')
    expect(other.actions.some(a => a.type === 'review' && a.task === 'TASK-002')).toBe(true)
    expect(toBuilders(other.actions)).not.toContain('TASK-001')
    expect(waitingOf(other.state, b).find(w => w.task === 'TASK-001')?.why).toMatch(/^等你回答（crew 問的）$/)
    // The person answers: TASK-001 goes on with it, counted afresh, and its question is not the flow's.
    const answered = step({ ...other.state, reviewing: undefined }, { type: 'answered', question: q[0]?.question ?? '', answer: '先跳過資料庫測試，用 mock', escalation: true, item: 'TASK-001', board: b, room: ROOM })
    expect(answered.state.stage).toBe('building')
    expect(answered.state.jobs?.['TASK-001']?.wait).toBeUndefined()
    expect(answered.state.jobs?.['TASK-001']).toMatchObject({ retries: 0 })
    expect(answered.state.jobs?.['TASK-001']?.look).toBeUndefined()
    const resumed = answered.actions.find(a => (a.type === 'spawn' || a.type === 'message') && a.role === 'fullstack' && (a as { item?: string }).item === 'TASK-001') as { text?: string; prompt?: string } | undefined
    expect(resumed?.text ?? resumed?.prompt).toMatch(/先跳過資料庫測試，用 mock/)
  })

  test('a builder that asked the person waits for the answer: no retry is counted, nobody tells it to commit, and the rest goes on', () => {
    const b = three()
    let s = building(b)
    const one = s.jobs?.['TASK-001']?.slot ?? 0
    const r = step(s, { type: 'role_done', role: 'fullstack', board: b, slot: one, room: ROOM, open: { 'TASK-001': 'fullstack' }, report: '我問了使用者要月繳還是年繳' })
    expect(r.state.stage).toBe('building')
    expect(r.state.jobs?.['TASK-001']).toMatchObject({ retries: 0, wait: { at: 'building', by: 'fullstack' } })
    expect(r.actions).toEqual([])
    expect(waitingOf(r.state, b).find(w => w.task === 'TASK-001')?.why).toBe('等你回答（全端問的）')
    s = r.state
    // Its slot is free for other work; the others keep building.
    expect(s.jobs?.['TASK-002']?.slot).toBeDefined()
    // The person answers the builder's question: it goes on with the answer.
    const a = step(s, { type: 'answered', question: '月繳還是年繳？', answer: '月繳', role: 'fullstack', item: 'TASK-001', board: b, room: ROOM })
    expect(a.state.jobs?.['TASK-001']?.wait).toBeUndefined()
    const back = a.actions.find(x => (x.type === 'spawn' || x.type === 'message') && x.role === 'fullstack') as { item?: string; text?: string; prompt?: string } | undefined
    expect(back?.item).toBe('TASK-001')
    expect(back?.text ?? back?.prompt).toMatch(/月繳/)
    expect(a.state.jobs?.['TASK-001']?.slot).toBeDefined()
  })

  test('a task that waits keeps its builder: work started meanwhile takes another slot, and the answer goes back to the same builder', () => {
    const b = three()
    const r0 = step({ stage: 'planning', round: 0, retries: 0 }, { type: 'role_done', role: 'techlead', board: b, room: { limit: 2 } })
    expect(toBuilders(r0.actions)).toEqual(['TASK-001', 'TASK-002'])
    const one = r0.state.jobs?.['TASK-001']?.slot ?? 0
    // TASK-001's builder asked the person: TASK-003 starts meanwhile, in a slot of its own.
    const r = step(r0.state, { type: 'role_done', role: 'fullstack', board: b, slot: one, room: { limit: 2 }, open: { 'TASK-001': 'fullstack' } })
    const three3 = r.actions.find(a => (a.type === 'spawn' || a.type === 'message') && (a as { item?: string }).item === 'TASK-003') as { slot?: number } | undefined
    expect(three3?.slot).toBeDefined()
    expect(three3?.slot).not.toBe(one)
    // The answer, once there is room, wakes the builder that knows TASK-001, not a fresh one.
    const a = step(r.state, { type: 'answered', question: '月繳還是年繳？', answer: '月繳', role: 'fullstack', item: 'TASK-001', board: b, room: ROOM })
    expect(a.actions.find(x => (x.type === 'spawn' || x.type === 'message') && x.role === 'fullstack')).toMatchObject({ type: 'message', item: 'TASK-001', slot: one })
  })

  test('a task set after the one waiting waits for it; one set after nothing starts', () => {
    const b = three({ 'TASK-002': ['TASK-001'] })
    const r = step({ stage: 'planning', round: 0, retries: 0 }, { type: 'role_done', role: 'techlead', board: b, room: ROOM })
    expect(toBuilders(r.actions)).toEqual(['TASK-001', 'TASK-003'])
    const one = r.state.jobs?.['TASK-001']?.slot ?? 0
    const waits = step(r.state, { type: 'role_done', role: 'fullstack', board: b, slot: one, room: ROOM, open: { 'TASK-001': 'fullstack' } })
    // Nothing can start: TASK-002 waits on TASK-001, which waits for the person. That is no stuck plan to ask about.
    expect(asks(waits.actions)).toEqual([])
    expect(waits.state.stage).toBe('building')
    expect(waitingOf(waits.state, b)).toContainEqual({ task: 'TASK-002', why: '等 TASK-001 先做完' })
  })

  test('a review with no verdict twice asks the person about that task alone, and the answer goes with its next review', () => {
    const b = commits(three(), { 'TASK-001': ['aaa0001'] })
    const s: FlowState = { stage: 'building', round: 0, retries: 0, reviewing: { task: 'TASK-001', sha: 'aaa0001', retries: 1 }, jobs: { 'TASK-001': { home: 1, retries: 0, reviews: 0 } } }
    const r = step(s, { type: 'role_done', role: 'techlead', board: b, room: ROOM, report: 'review_submit 一直回錯誤' })
    expect(r.state.stage).toBe('building')
    expect(r.state.reviewing).toBeUndefined()
    const q = asks(r.actions)
    expect(q[0]).toMatchObject({ item: 'TASK-001', alone: true })
    expect(q[0]?.question).toMatch(/Tech lead 最後說：「review_submit 一直回錯誤」/)
    expect(r.state.jobs?.['TASK-001']).toMatchObject({ wait: { at: 'reviewing', by: 'crew' } })
    // The other tasks are built meanwhile.
    expect(toBuilders(r.actions)).toEqual(['TASK-002', 'TASK-003'])
    const a = step(r.state, { type: 'answered', question: q[0]?.question ?? '', answer: '再試一次，用 approve', escalation: true, item: 'TASK-001', board: b, room: ROOM })
    const review = a.actions.find(x => x.type === 'review') as { task: string; text: string } | undefined
    expect(review?.task).toBe('TASK-001')
    expect(review?.text).toMatch(/再試一次，用 approve[\s\S]*review_submit 送出結論[\s\S]*請 review TASK-001/)
    expect(a.state.jobs?.['TASK-001']?.note).toBeUndefined()
  })

  test('a review that sent a task back past three times asks the person about it alone, with the tech lead’s last words', () => {
    const b = verdict(commits(three(), { 'TASK-001': ['aaa0004'] }), 'TASK-001', 'aaa0004', 'changes', '錯誤訊息還是英文')
    const s: FlowState = { stage: 'building', round: 0, retries: 0, reviewing: { task: 'TASK-001', sha: 'aaa0004' }, jobs: { 'TASK-001': { home: 1, retries: 0, reviews: 3, own: true } } }
    const r = step(s, { type: 'role_done', role: 'techlead', board: b, room: ROOM })
    expect(r.state.stage).toBe('building')
    const q = asks(r.actions)
    expect(q).toHaveLength(1)
    expect(q[0]?.question).toMatch(/最後一次要改的是：「錯誤訊息還是英文」/)
    expect(r.state.jobs?.['TASK-001']).toMatchObject({ wait: { by: 'crew' }, reviews: 4 })
    expect(toBuilders(r.actions)).toEqual(['TASK-002', 'TASK-003'])
    // Answered, its changes are made, counted afresh.
    const a = step(r.state, { type: 'answered', question: q[0]?.question ?? '', answer: '改成中文就好', escalation: true, item: 'TASK-001', board: b, room: ROOM })
    expect(a.state.jobs?.['TASK-001']).toMatchObject({ reviews: 1, slot: expect.any(Number) })
    const fix = a.actions.find(x => x.type === 'message' || x.type === 'spawn') as { text?: string; prompt?: string; item?: string } | undefined
    expect(fix?.item).toBe('TASK-001')
    expect(fix?.text ?? fix?.prompt).toMatch(/改成中文就好/)
  })

  test('an answer by the question’s id reaches the task it was asked on; a late one, the task done since, takes nothing', () => {
    const b = three()
    const s: FlowState = { stage: 'building', round: 0, retries: 0, jobs: { 'TASK-001': { home: 1, retries: 2, reviews: 0, wait: { at: 'building', by: 'crew', id: 'Q-07' } } } }
    // Another question on the same task (the builder's own) is not this one.
    const other = step(s, { type: 'answered', id: 'Q-08', question: 'q', answer: 'a', escalation: true, item: 'TASK-001', board: b, room: ROOM })
    expect(other.state.jobs?.['TASK-001']?.wait).toBeDefined()
    const right = step(s, { type: 'answered', id: 'Q-07', question: 'q', answer: '照你說的', escalation: true, item: 'TASK-001', board: b, room: ROOM })
    expect(right.state.jobs?.['TASK-001']?.wait).toBeUndefined()
    // Done and merged since: its question is closed, and a late answer goes to no role.
    const merged = verdict(commits(b, { 'TASK-001': ['aaa0001'] }), 'TASK-001', 'aaa0001', 'approve')
    const gone = step(s, { type: 'role_done', role: 'pm', board: merged, room: ROOM })
    expect(gone.actions).toContainEqual(expect.objectContaining({ type: 'settle_ask', id: 'Q-07' }))
    const late = step(gone.state, { type: 'answered', id: 'Q-07', question: 'q', answer: 'a', escalation: true, item: 'TASK-001', board: merged, room: ROOM })
    expect(late.actions).toEqual([{ type: 'status', text: 'TASK-001 已經不在等這一題了，你的回答留在 TASK-001 的討論串上。' }])
  })

  test('a look cut short by a restart is asked of the tech lead again; a question waited on stays waited on', () => {
    const b = three()
    const s: FlowState = {
      stage: 'building',
      round: 0,
      retries: 0,
      talking: true,
      jobs: {
        'TASK-001': { home: 1, retries: 2, reviews: 0, asking: true, look: { state: 'told', report: '卡住了' } },
        'TASK-002': { home: 2, retries: 0, reviews: 0, wait: { at: 'building', by: 'fullstack' } },
      },
    }
    const r = step(s, { type: 'resume', board: b, prd: { path: 'docs/PRD.md', size: 10 }, room: ROOM } as never)
    const look = r.actions.find(a => a.type === 'message' && a.role === 'techlead') as { item?: string; text: string } | undefined
    expect(look?.item).toBe('TASK-001')
    expect(look?.text).toMatch(/「卡住了」/)
    expect(toBuilders(r.actions)).toEqual(['TASK-003'])
    expect(r.state.jobs?.['TASK-002']?.wait).toEqual({ at: 'building', by: 'fullstack' })
  })

  test('a fix QA asked for that keeps ending without it goes to the tech lead, then the person, as a task does', () => {
    const b = approvedAll(three(), { 'TASK-001': 'aaa0001', 'TASK-002': 'bbb0002', 'TASK-003': 'ccc0003' })
    const tips = 'TASK-001:aaa0001,TASK-002:bbb0002,TASK-003:ccc0003'
    const s: FlowState = {
      stage: 'building',
      round: 0,
      retries: 0,
      checks: { 'PRD-001': { round: 1, tips, state: 'failed', why: 'x', fix: { task: 'TASK-001', tip: 'aaa0001', text: 'QA 修正', out: true } } },
      jobs: { 'TASK-001': { slot: 1, home: 1, fixing: 'aaa0001', qa: 'PRD-001', retries: 1, reviews: 0 } },
    }
    const room = { limit: 1 }
    // The second run with nothing committed: the tech lead is told at once, though every task is done.
    const r = step(s, { type: 'role_done', role: 'fullstack', board: b, room, app: true, report: '按鈕的事件綁不上' })
    expect(r.state.jobs?.['TASK-001']?.look?.state).toBe('told')
    expect(r.actions).toContainEqual(expect.objectContaining({ type: 'message', role: 'techlead', item: 'TASK-001' }))
    // Its words go to the builder with the fix.
    const tl = step(r.state, { type: 'role_done', role: 'techlead', board: b, room, app: true, report: '要先等畫面載入完再綁' })
    const back = tl.actions.find(a => (a.type === 'spawn' || a.type === 'message') && a.role === 'fullstack') as { item?: string; text?: string; prompt?: string } | undefined
    expect(back?.item).toBe('TASK-001')
    expect(back?.text ?? back?.prompt).toMatch(/要先等畫面載入完再綁/)
    // One more run without it: the person, with both their words.
    const again = step(tl.state, { type: 'role_done', role: 'fullstack', board: b, room, app: true, report: '還是綁不上' })
    const q = asks(again.actions)
    expect(q).toHaveLength(1)
    expect(q[0]?.question).toMatch(/還是綁不上[\s\S]*要先等畫面載入完再綁/)
  })

  test('the tech lead’s look answers only the task it looked at: another builder’s question to it waits for its own run', () => {
    const b = three()
    const s: FlowState = {
      stage: 'building',
      round: 0,
      retries: 0,
      jobs: {
        'TASK-001': { home: 1, retries: 2, reviews: 0, own: true, look: { state: 'owed', report: '卡住了' } },
        'TASK-002': { slot: 2, home: 2, retries: 0, reviews: 0, own: true },
        'TASK-003': { slot: 3, home: 3, retries: 0, reviews: 0, own: true },
      },
    }
    const told = step(s, { type: 'look', board: b, room: ROOM })
    expect(told.actions).toContainEqual(expect.objectContaining({ type: 'message', role: 'techlead', item: 'TASK-001' }))
    // TASK-002's builder asks the tech lead on a thread meanwhile.
    const asked = step(told.state, { type: 'role_done', role: 'fullstack', board: b, slot: 2, room: ROOM, inbox: { techlead: ['TASK-002'] } })
    expect(asked.state.jobs?.['TASK-002']?.asking).toBe(true)
    const r = step(asked.state, { type: 'role_done', role: 'techlead', board: b, room: ROOM, report: 'TASK-001 要用記憶體資料庫', inbox: { techlead: ['TASK-002'] } })
    // TASK-001 hears it; TASK-002 does not take it for its own answer, and the tech lead is told of its thread.
    const to = (id: string) => r.actions.find(a => (a.type === 'spawn' || a.type === 'message') && a.role === 'fullstack' && (a as { item?: string }).item === id) as { text?: string; prompt?: string } | undefined
    expect(to('TASK-001')?.text ?? to('TASK-001')?.prompt).toMatch(/記憶體資料庫/)
    expect(to('TASK-002')).toBeUndefined()
    expect(r.state.jobs?.['TASK-002']?.asking).toBe(true)
    expect(r.actions).toContainEqual(expect.objectContaining({ type: 'message', role: 'techlead', item: 'TASK-002' }))
  })

  test('a task the tech lead set after another on its look waits for it, with what it was told', () => {
    const b = three({ 'TASK-001': ['TASK-002'] })
    const s: FlowState = {
      stage: 'building',
      round: 0,
      retries: 0,
      talking: true,
      jobs: {
        'TASK-001': { home: 1, retries: 2, reviews: 0, own: true, asking: true, look: { state: 'told', report: '卡住了' } },
        'TASK-002': { slot: 2, home: 2, retries: 0, reviews: 0, own: true },
      },
    }
    const r = step(s, { type: 'role_done', role: 'techlead', board: b, room: ROOM, report: 'TASK-001 在等 TASK-002 的資料表，我把它排在後面了' })
    expect(toBuilders(r.actions)).not.toContain('TASK-001')
    expect(r.state.jobs?.['TASK-001']?.say).toMatch(/資料表/)
    expect(waitingOf(r.state, b)).toContainEqual({ task: 'TASK-001', why: '等 TASK-002 先做完' })
  })

  test('a feature whose check waits for the person holds only itself: the next feature is checked meanwhile', () => {
    const SPLIT2: readonly Op[] = [
      { op: 'add_feature', title: '方案', summary: '' },
      { op: 'add_criterion', feature: 'PRD-001', text: '可以選方案' },
      { op: 'add_feature', title: '取消', summary: '' },
      { op: 'add_criterion', feature: 'PRD-002', text: '可以取消' },
    ]
    const a = applyOps(newTracker('shop'), SPLIT2, ctx('pm'))
    if (!a.ok) throw new Error(a.errors.join('; '))
    const t = applyOps(a.tracker, [tc(['AC-001', 'AC-002'])], ctx('qa'))
    if (!t.ok) throw new Error(t.errors.join('; '))
    const d = applyOps(t.tracker, ['PRD-001', 'PRD-002'].map(f => ({ op: 'add_design', feature: f, title: '畫面', kind: 'none', body: '沒有畫面' }) as Op), ctx('uiux'))
    if (!d.ok) throw new Error(d.errors.join('; '))
    const designed = withDecisions(d.tracker, new Map(d.tracker.prd_items.flatMap(i => designsOf(i)).map(x => [x.id, { verdict: 'approved' as const }]))) ?? d.tracker
    const p = applyOps(designed, [{ op: 'add_task', feature: 'PRD-001', criteria: ['AC-001'], title: '方案', detail: '', size: 'S' } as Op, { op: 'add_task', feature: 'PRD-002', criteria: ['AC-002'], title: '取消', detail: '', size: 'S' } as Op], ctx('techlead'))
    if (!p.ok) throw new Error(p.errors.join('; '))
    const b = approvedAll(p.tracker, { 'TASK-001': 'aaa0001', 'TASK-002': 'bbb0002' })
    const s: FlowState = { stage: 'building', round: 0, retries: 0, checks: { 'PRD-001': { round: 3, tips: 'TASK-001:aaa0001', state: 'running' } } }
    const r = step(s, { type: 'checked', feature: 'PRD-001', board: b, failed: [{ criterion: 'AC-001', what: '按鈕沒反應' }], room: ROOM, app: true })
    expect(asks(r.actions)).toHaveLength(1)
    expect(r.actions).toContainEqual(expect.objectContaining({ type: 'check', feature: 'PRD-002' }))
  })

  test('a task with its commit whose runs keep leaving changes not committed: the tech lead hears that, not that no commit was found', () => {
    const b = commits(three(), { 'TASK-001': ['aaa0001'] })
    const s: FlowState = { stage: 'building', round: 0, retries: 0, jobs: { 'TASK-001': { slot: 1, home: 1, retries: 1, reviews: 0, own: true } } }
    const r = step(s, { type: 'role_done', role: 'fullstack', board: b, room: ROOM, unclean: true, report: 'dist/ 不知道要不要 commit' })
    const tl = r.actions.find(a => a.type === 'message' && a.role === 'techlead') as { text: string } | undefined
    expect(tl?.text).toMatch(/已經有以「TASK-001: 」開頭的 commit，但每一輪結束時工作目錄都還有沒 commit 的修改/)
    expect(tl?.text).not.toMatch(/找不到/)
  })

  test('in crew’s own worktree, a task waiting with its work half done has crew set the work aside: the next task is built meanwhile, and the builder puts it back first', () => {
    const b = three()
    const room = { limit: 1 }
    const r0 = step({ stage: 'planning', round: 0, retries: 0 }, { type: 'role_done', role: 'techlead', board: b, room })
    expect(toBuilders(r0.actions)).toEqual(['TASK-001'])
    // Its builder asked the person, leaving changes not committed: crew sets them aside, and nothing is built there till it has.
    const r = step(r0.state, { type: 'role_done', role: 'fullstack', board: b, room, open: { 'TASK-001': 'fullstack' }, unclean: true })
    expect(toBuilders(r.actions)).toEqual([])
    expect(r.actions).toContainEqual({ type: 'shelve', task: 'TASK-001' })
    expect(waitingOf(r.state, b).find(w => w.task === 'TASK-002')?.why).toMatch(/crew 正在把 TASK-001 改到一半的修改收起來/)
    // Asked once: another event meanwhile asks no second setting aside.
    expect(step(r.state, { type: 'look', board: b, room }).actions.filter(a => a.type === 'shelve')).toEqual([])
    const sha = 'f'.repeat(40)
    const ref = `refs/crew/shelf/TASK-001/${sha.slice(0, 12)}`
    // Set aside: the next task is built in the clean worktree.
    const set = step(r.state, { type: 'shelved', board: b, task: 'TASK-001', sha, ref, room })
    expect(toBuilders(set.actions)).toEqual(['TASK-002'])
    expect(set.state.jobs?.['TASK-001']).toMatchObject({ shelf: { sha, ref }, wait: { at: 'building', by: 'fullstack' } })
    expect(set.state.jobs?.['TASK-001']?.dirty).toBeUndefined()
    // The answer before crew has said: it waits on the task, not taken on under crew's hands; once set aside, TASK-001 goes
    // first, and its builder hears to put the work back before it goes on.
    const early = step(r.state, { type: 'answered', question: '月繳還是年繳？', answer: '月繳', role: 'fullstack', item: 'TASK-001', board: b, room })
    expect(toBuilders(early.actions)).toEqual([])
    const back = step(early.state, { type: 'shelved', board: b, task: 'TASK-001', sha, ref, room })
    expect(toBuilders(back.actions)).toEqual(['TASK-001'])
    const told = back.actions.find(a => (a.type === 'spawn' || a.type === 'message') && a.role === 'fullstack') as { text?: string; prompt?: string }
    expect(told.text ?? told.prompt).toMatch(/月繳/)
    expect(restoreOf(back.actions, 'TASK-001')).toMatchObject({ task: 'TASK-001', shelf: { sha, ref } })
    // Kept till the run it was told in ends: a run lost to a restart tells the next builder again.
    expect(back.state.jobs?.['TASK-001']?.shelf).toMatchObject({ sha, sent: true })
    const lost = step(back.state, { type: 'resume', board: b, prd: { path: 'docs/PRD.md', size: 10 }, room })
    const again = lost.actions.find(a => (a.type === 'spawn' || a.type === 'message') && a.role === 'fullstack' && a.item === 'TASK-001') as { text?: string; prompt?: string } | undefined
    expect(again).toBeDefined()
    expect(restoreOf(lost.actions, 'TASK-001')?.shelf.sha).toBe(sha)
    // A run that left the work in the worktree has it back; one that left neither it nor a commit did not put it back: it is told again.
    const dirty = step(back.state, { type: 'role_done', role: 'fullstack', board: b, room, open: { 'TASK-001': 'fullstack' }, unclean: true })
    expect(dirty.state.jobs?.['TASK-001']?.shelf).toBeUndefined()
    const left = step(back.state, { type: 'role_done', role: 'fullstack', board: b, room, open: { 'TASK-001': 'fullstack' } })
    expect(left.state.jobs?.['TASK-001']?.shelf).toEqual({ sha, ref, tip: '' })
    // crew could not set it aside: the worktree waits for TASK-001, the person hears why, and so does the status.
    const failed = step(r.state, { type: 'shelved', board: b, task: 'TASK-001', error: 'index.lock 存在', room })
    expect(toBuilders(failed.actions)).toEqual([])
    expect(failed.actions).toContainEqual(expect.objectContaining({ type: 'status', text: expect.stringMatching(/沒辦法把 TASK-001 改到一半[\s\S]*index\.lock 存在/) }))
    expect(waitingOf(failed.state, b).find(w => w.task === 'TASK-002')?.why).toMatch(/TASK-001 改到一半的修改還在 crew 的工作目錄（crew 收不起來：index\.lock 存在）/)
    expect(failed.actions.filter(a => a.type === 'shelve')).toEqual([])
    // Left clean, the next task is built at once, with nothing to set aside.
    const clean = step(r0.state, { type: 'role_done', role: 'fullstack', board: b, room, open: { 'TASK-001': 'fullstack' } })
    expect(toBuilders(clean.actions)).toEqual(['TASK-002'])
    expect(clean.actions.filter(a => a.type === 'shelve')).toEqual([])
  })

  test('a review in which the tech lead asked the person waits for that answer, asked once, and it goes with the next review', () => {
    const b = commits(three(), { 'TASK-001': ['aaa0001'] })
    const s: FlowState = { stage: 'building', round: 0, retries: 0, reviewing: { task: 'TASK-001', sha: 'aaa0001' }, jobs: { 'TASK-001': { home: 1, retries: 0, reviews: 0, own: true } } }
    const r = step(s, { type: 'role_done', role: 'techlead', board: b, room: ROOM, open: { 'TASK-001': 'techlead' }, report: '我問了使用者錯誤訊息要不要中文' })
    expect(asks(r.actions)).toEqual([])
    expect(r.state.jobs?.['TASK-001']?.wait).toEqual({ at: 'reviewing', by: 'techlead' })
    expect(r.actions.some(x => x.type === 'review')).toBe(false)
    const a = step(r.state, { type: 'answered', question: '錯誤訊息要中文嗎？', answer: '要中文', role: 'techlead', item: 'TASK-001', board: b, room: ROOM })
    const reviews = a.actions.filter(x => x.type === 'review') as { task: string; text: string }[]
    expect(reviews).toHaveLength(1)
    expect(reviews[0]?.text).toMatch(/要中文[\s\S]*請 review TASK-001/)
    expect(a.actions.some(x => x.type === 'message' && x.role === 'techlead')).toBe(false)
  })

  test('a fix of crew’s test run that keeps ending without it goes to the tech lead, not round the tests, then the person; the tests wait for it', () => {
    const b0 = approvedAll(three(), { 'TASK-001': 'aaa0001', 'TASK-002': 'bbb0002', 'TASK-003': 'ccc0003' })
    const failing = withResults(b0, new Map([['TC-001', { result: 'failed' as const, sha: 'run0001', run: 'r1' }]])) ?? b0
    const room = { limit: 1 }
    const r = step({ stage: 'testing', round: 0, retries: 0 }, { type: 'tests_ran', board: failing, output: 'FAILED test_TC_001', room })
    expect(toBuilders(r.actions)).toEqual(['TASK-001'])
    const once = step(r.state, { type: 'role_done', role: 'fullstack', board: failing, room, report: '找不到錯誤' })
    expect(toBuilders(once.actions)).toEqual(['TASK-001'])
    const twice = step(once.state, { type: 'role_done', role: 'fullstack', board: failing, room, report: '測試連不到資料庫' })
    expect(twice.actions.some(a => a.type === 'run_tests')).toBe(false)
    expect(twice.actions).toContainEqual(expect.objectContaining({ type: 'message', role: 'techlead', item: 'TASK-001' }))
    // Its words go to the builder with the fix; the tests are not run again meanwhile.
    const tl = step(twice.state, { type: 'role_done', role: 'techlead', board: failing, room, report: '測試要先跑 docker compose up db' })
    const back = tl.actions.find(a => (a.type === 'spawn' || a.type === 'message') && a.role === 'fullstack') as { item?: string; text?: string; prompt?: string } | undefined
    expect(back?.item).toBe('TASK-001')
    expect(back?.text ?? back?.prompt).toMatch(/docker compose up db/)
    expect(tl.actions.some(a => a.type === 'run_tests')).toBe(false)
    // One more run without it: the person, with both their words; the tests wait for their answer.
    const again = step(tl.state, { type: 'role_done', role: 'fullstack', board: failing, room, report: '還是連不到' })
    expect(asks(again.actions)).toHaveLength(1)
    expect(asks(again.actions)[0]?.question).toMatch(/還是連不到[\s\S]*docker compose up db/)
    expect(again.actions.some(a => a.type === 'run_tests')).toBe(false)
    expect(again.state.jobs?.['TASK-001']?.wait).toBeDefined()
    expect(step(again.state, { type: 'look', board: failing, room }).actions.some(a => a.type === 'run_tests')).toBe(false)
    // Their answer goes to the builder with the fix.
    const ans = step(again.state, { type: 'answered', question: asks(again.actions)[0]?.question ?? '', answer: '先跳過資料庫測試', escalation: true, item: 'TASK-001', board: failing, room })
    const fix = ans.actions.find(a => (a.type === 'spawn' || a.type === 'message') && a.role === 'fullstack') as { item?: string; text?: string; prompt?: string } | undefined
    expect(fix?.item).toBe('TASK-001')
    expect(fix?.text ?? fix?.prompt).toMatch(/先跳過資料庫測試/)
  })

  test('a fix QA asked for that waits for the person holds only its feature: the next feature is checked meanwhile, or crew asks how to start the app', () => {
    const SPLIT2: readonly Op[] = [
      { op: 'add_feature', title: '方案', summary: '' },
      { op: 'add_criterion', feature: 'PRD-001', text: '可以選方案' },
      { op: 'add_feature', title: '取消', summary: '' },
      { op: 'add_criterion', feature: 'PRD-002', text: '可以取消' },
    ]
    const a = applyOps(newTracker('shop'), SPLIT2, ctx('pm'))
    if (!a.ok) throw new Error(a.errors.join('; '))
    const t = applyOps(a.tracker, [tc(['AC-001', 'AC-002'])], ctx('qa'))
    if (!t.ok) throw new Error(t.errors.join('; '))
    const d = applyOps(t.tracker, ['PRD-001', 'PRD-002'].map(f => ({ op: 'add_design', feature: f, title: '畫面', kind: 'none', body: '沒有畫面' }) as Op), ctx('uiux'))
    if (!d.ok) throw new Error(d.errors.join('; '))
    const designed = withDecisions(d.tracker, new Map(d.tracker.prd_items.flatMap(i => designsOf(i)).map(x => [x.id, { verdict: 'approved' as const }]))) ?? d.tracker
    const p = applyOps(designed, [{ op: 'add_task', feature: 'PRD-001', criteria: ['AC-001'], title: '方案', detail: '', size: 'S' } as Op, { op: 'add_task', feature: 'PRD-002', criteria: ['AC-002'], title: '取消', detail: '', size: 'S' } as Op], ctx('techlead'))
    if (!p.ok) throw new Error(p.errors.join('; '))
    const b = approvedAll(p.tracker, { 'TASK-001': 'aaa0001', 'TASK-002': 'bbb0002' })
    const s: FlowState = {
      stage: 'building',
      round: 0,
      retries: 0,
      checks: { 'PRD-001': { round: 1, tips: 'TASK-001:aaa0001', state: 'failed', why: 'x', fix: { task: 'TASK-001', tip: 'aaa0001', text: 'QA 修正', out: true } } },
      jobs: { 'TASK-001': { home: 1, fixing: 'aaa0001', qa: 'PRD-001', retries: 2, reviews: 0, wait: { at: 'building', by: 'crew' }, look: { state: 'answered', report: '綁不上', tl: '先等載入' } } },
    }
    const inApp = step(s, { type: 'look', board: b, room: ROOM, app: true })
    expect(inApp.actions).toContainEqual(expect.objectContaining({ type: 'check', feature: 'PRD-002' }))
    expect(inApp.state.jobs?.['TASK-001']?.wait).toBeDefined()
    // With no app to start, nothing is checked: crew asks how to start it, once, for the next feature.
    const asking = step(s, { type: 'look', board: b, room: ROOM })
    expect(asking.actions).toEqual([{ type: 'find_app', feature: 'PRD-002' }])
    expect(asking.state.jobs?.['TASK-001']?.wait).toBeDefined()
  })

  test('a run of another role while the tech lead looks at a task answers neither it nor a builder waiting on the tech lead; the tech lead’s run then answers the one it looked at, and is asked again of the other', () => {
    const b = three()
    const s: FlowState = {
      stage: 'building',
      round: 0,
      retries: 0,
      talking: true,
      jobs: {
        'TASK-001': { home: 1, retries: 2, reviews: 0, own: true, asking: true, look: { state: 'told', report: '卡住了' } },
        'TASK-002': { home: 2, retries: 0, reviews: 0, own: true, asking: true },
      },
    }
    const pm = step(s, { type: 'role_done', role: 'pm', board: b, room: ROOM, report: '我把 AC-002 改清楚了' })
    expect(toBuilders(pm.actions).filter(id => id === 'TASK-001' || id === 'TASK-002')).toEqual([])
    expect(pm.state.jobs?.['TASK-001']).toMatchObject({ asking: true, look: { state: 'told' } })
    expect(pm.state.jobs?.['TASK-001']?.say).toBeUndefined()
    expect(pm.state.jobs?.['TASK-002']?.asking).toBe(true)
    // The tech lead's run: TASK-001 hears its words; TASK-002's question, its thread read meanwhile, is asked of it again.
    const tl = step(pm.state, { type: 'role_done', role: 'techlead', board: b, room: ROOM, report: '要先建資料表' })
    const to = (id: string) => tl.actions.find(a => (a.type === 'spawn' || a.type === 'message') && a.role === 'fullstack' && (a as { item?: string }).item === id) as { text?: string; prompt?: string } | undefined
    expect(to('TASK-001')?.text ?? to('TASK-001')?.prompt).toMatch(/要先建資料表/)
    expect(tl.state.jobs?.['TASK-002']?.asking).toBe(true)
    expect(tl.actions).toContainEqual(expect.objectContaining({ type: 'message', role: 'techlead', item: 'TASK-002' }))
  })

  test('in crew’s own worktree, a task the tech lead sets after another, its half-done work set aside, lets that one be built', () => {
    const b = three()
    const room = { limit: 1 }
    const r0 = step({ stage: 'planning', round: 0, retries: 0 }, { type: 'role_done', role: 'techlead', board: b, room })
    const once = step(r0.state, { type: 'role_done', role: 'fullstack', board: b, room, unclean: true, report: '要先有資料表' })
    const twice = step(once.state, { type: 'role_done', role: 'fullstack', board: b, room, unclean: true, report: '資料表還沒有' })
    expect(twice.actions).toContainEqual({ type: 'shelve', task: 'TASK-001' })
    const sha = 'a'.repeat(40)
    const shelved = step(twice.state, { type: 'shelved', board: b, task: 'TASK-001', sha, ref: `refs/crew/shelf/TASK-001/${sha.slice(0, 12)}`, room })
    expect(shelved.actions).toContainEqual(expect.objectContaining({ type: 'message', role: 'techlead', item: 'TASK-001' }))
    // The tech lead sets TASK-001 after TASK-002: TASK-002 is built in the clean worktree, and TASK-001 says what it waits for.
    const after = three({ 'TASK-001': ['TASK-002'] })
    const tl = step(shelved.state, { type: 'role_done', role: 'techlead', board: after, room, report: 'TASK-001 要等 TASK-002 的資料表' })
    expect(toBuilders(tl.actions)).toEqual(['TASK-002'])
    expect(waitingOf(tl.state, after)).toContainEqual({ task: 'TASK-001', why: '等 TASK-002 先做完' })
    // crew could not set it aside: nothing can be built, and the person hears the real reason, not only the order.
    const failed = step(twice.state, { type: 'shelved', board: b, task: 'TASK-001', error: 'index.lock 存在', room })
    const told = step(failed.state, { type: 'role_done', role: 'techlead', board: after, room, report: 'TASK-001 要等 TASK-002' })
    expect(told.state.stage).toBe('escalated')
    expect(asks(told.actions)[0]?.question ?? (told.actions.find(a => a.type === 'ask_person') as { question?: string } | undefined)?.question).toMatch(/TASK-001 改到一半、還沒 commit 的修改還在 crew 的工作目錄（crew 想先收起來，但沒有成功：index\.lock 存在）[\s\S]*TASK-002 不能在這些修改上面開工/)
  })

  test('a task out of the plan whose half-done work crew set aside lets go of the worktree, and the person hears where the work is', () => {
    const b = three()
    const sha = 'b'.repeat(40)
    const ref = `refs/crew/shelf/TASK-009/${sha.slice(0, 12)}`
    const s: FlowState = { stage: 'building', round: 0, retries: 0, jobs: { 'TASK-009': { home: 1, retries: 0, reviews: 0, dirty: true, shelving: true } } }
    expect(waitingOf(s, b).find(w => w.task === 'TASK-001')?.why).toMatch(/crew 正在把 TASK-009 改到一半的修改收起來/)
    const r = step(s, { type: 'shelved', board: b, task: 'TASK-009', sha, ref, room: { limit: 1 } })
    expect(r.state.jobs?.['TASK-009']).toBeUndefined()
    expect(r.actions).toContainEqual(expect.objectContaining({ type: 'status', text: expect.stringContaining(`TASK-009 已經不在計畫裡，它之前改到一半、還沒 commit 的修改，crew 收在 ${ref}`) }))
    expect(toBuilders(r.actions)).toEqual(['TASK-001'])
  })

  test('another task’s review goes on while a task’s half-done work keeps crew’s worktree', () => {
    const b = commits(three(), { 'TASK-002': ['bbb0002'] })
    const s: FlowState = {
      stage: 'building',
      round: 0,
      retries: 0,
      jobs: { 'TASK-001': { home: 1, retries: 0, reviews: 0, dirty: true, unshelved: 'index.lock 存在', wait: { at: 'building', by: 'fullstack' } }, 'TASK-002': { home: 1, retries: 0, reviews: 0 } },
    }
    const r = step(s, { type: 'look', board: b, room: { limit: 1 } })
    expect(r.actions).toContainEqual(expect.objectContaining({ type: 'review', task: 'TASK-002' }))
    expect(toBuilders(r.actions)).toEqual([])
  })

  test('a task the tech lead is looking at is not shown as being built', () => {
    expect(doingOf({ stage: 'building', round: 0, retries: 0, jobs: { 'TASK-001': { retries: 2, reviews: 0, asking: true, look: { state: 'told', report: '' } } } }, 'TASK-001')).toBeUndefined()
    expect(doingOf({ stage: 'building', round: 0, retries: 0, jobs: { 'TASK-001': { retries: 0, reviews: 0, asking: true } } }, 'TASK-001')).toEqual({ step: 'building' })
  })
})

/**
 * The work crew sets aside in its own worktree goes on with the fix it belongs to, survives a restart before the
 * flow heard, and lets the person, the tech lead and the next builder know what they need: what was set aside,
 * where to read it, and what stayed.
 */
describe('work crew set aside', () => {
  /** Two features with one task each, both committed and approved: done, so what comes now is QA's fixes or the tests'. */
  const two = (): Tracker => {
    const split: readonly Op[] = [
      { op: 'add_feature', title: '方案', summary: '' },
      { op: 'add_criterion', feature: 'PRD-001', text: '可以選方案' },
      { op: 'add_feature', title: '取消', summary: '' },
      { op: 'add_criterion', feature: 'PRD-002', text: '可以取消' },
    ]
    const a = applyOps(newTracker('shop'), split, ctx('pm'))
    if (!a.ok) throw new Error(a.errors.join('; '))
    const t = applyOps(a.tracker, [tc(['AC-001', 'AC-002'])], ctx('qa'))
    if (!t.ok) throw new Error(t.errors.join('; '))
    const d = applyOps(t.tracker, ['PRD-001', 'PRD-002'].map(f => ({ op: 'add_design', feature: f, title: '畫面', kind: 'none', body: '沒有畫面' }) as Op), ctx('uiux'))
    if (!d.ok) throw new Error(d.errors.join('; '))
    const designed = withDecisions(d.tracker, new Map(d.tracker.prd_items.flatMap(i => designsOf(i)).map(x => [x.id, { verdict: 'approved' as const }]))) ?? d.tracker
    const p = applyOps(designed, [{ op: 'add_task', feature: 'PRD-001', criteria: ['AC-001'], title: '方案', detail: '', size: 'S' } as Op, { op: 'add_task', feature: 'PRD-002', criteria: ['AC-002'], title: '取消', detail: '', size: 'S' } as Op], ctx('techlead'))
    if (!p.ok) throw new Error(p.errors.join('; '))
    return approvedAll(p.tracker, { 'TASK-001': 'aaa0001', 'TASK-002': 'bbb0002' })
  }
  const one = { limit: 1 }
  const sha = '1234567890abcdef1234567890abcdef12345678'
  const ref = `refs/crew/shelf/TASK-001/${sha.slice(0, 12)}`
  const statuses = (actions: readonly FlowAction[]) => actions.filter((a): a is Extract<FlowAction, { type: 'status' }> => a.type === 'status').map(a => a.text)
  const toFs = (actions: readonly FlowAction[], id: string) => actions.find(a => (a.type === 'spawn' || a.type === 'message') && a.role === 'fullstack' && a.item === id) as { text?: string; prompt?: string } | undefined
  const said = (a: { text?: string; prompt?: string } | undefined) => a?.text ?? a?.prompt ?? ''

  test('a fix QA asked for on a done task keeps its job once its half-done work is set aside: the answer goes out with the word to put the work back', () => {
    const b = two()
    const s: FlowState = {
      stage: 'building',
      round: 0,
      retries: 0,
      checks: { 'PRD-001': { round: 1, tips: 'TASK-001:aaa0001', state: 'failed', why: 'x', fix: { task: 'TASK-001', tip: 'aaa0001', text: 'QA 修正：按鈕沒反應', out: true } } },
      jobs: { 'TASK-001': { home: 1, fixing: 'aaa0001', qa: 'PRD-001', retries: 0, reviews: 0, wait: { at: 'building', by: 'crew', id: 'Q-01' }, dirty: true, shelving: true } },
    }
    const set = step(s, { type: 'shelved', board: b, task: 'TASK-001', sha, ref, room: one, app: true })
    expect(set.state.jobs?.['TASK-001']).toMatchObject({ qa: 'PRD-001', wait: { id: 'Q-01' }, shelf: { sha, ref } })
    expect(statuses(set.actions).join('\n')).not.toMatch(/已經做完並合回/)
    const a = step(set.state, { type: 'answered', id: 'Q-01', question: '按鈕要做什麼？', answer: '照 QA 的改', escalation: true, item: 'TASK-001', board: b, room: one, app: true })
    expect(statuses(a.actions).join('\n')).not.toMatch(/已經不在等這一題/)
    expect(said(toFs(a.actions, 'TASK-001'))).toMatch(/照 QA 的改/)
    expect(restoreOf(a.actions, 'TASK-001')?.shelf.sha).toBe(sha)
  })

  test('a fix of crew’s test run that asked the person with work half done keeps its job once that is set aside; the tests wait for it', () => {
    const b = approvedAll(three(), { 'TASK-001': 'aaa0001', 'TASK-002': 'bbb0002', 'TASK-003': 'ccc0003' })
    const s: FlowState = { stage: 'building', round: 0, retries: 0, runs: 1, jobs: { 'TASK-001': { slot: 1, home: 1, fixing: 'aaa0001', tips: 'TASK-001:aaa0001', retries: 0, reviews: 0 } } }
    const r = step(s, { type: 'role_done', role: 'fullstack', board: b, room: one, unclean: true, open: { 'TASK-001': 'fullstack' } })
    expect(r.actions).toContainEqual({ type: 'shelve', task: 'TASK-001' })
    const set = step(r.state, { type: 'shelved', board: b, task: 'TASK-001', sha, ref, room: one })
    expect(set.state.jobs?.['TASK-001']).toMatchObject({ tips: 'TASK-001:aaa0001', wait: { at: 'building', by: 'fullstack' }, shelf: { sha } })
    expect(set.actions.some(a => a.type === 'run_tests')).toBe(false)
    expect(statuses(set.actions).join('\n')).not.toMatch(/已經做完並合回/)
  })

  test('a fix of crew’s test run that crew could not set aside goes on with its own half-done work once the tech lead answered', () => {
    const b = commits(three(), { 'TASK-001': ['aaa0001'] })
    const done = approvedAll(b, { 'TASK-001': 'aaa0001', 'TASK-002': 'bbb0002', 'TASK-003': 'ccc0003' })
    const s: FlowState = {
      stage: 'building',
      round: 0,
      retries: 0,
      runs: 1,
      jobs: { 'TASK-001': { home: 1, fixing: 'aaa0001', tips: 'TASK-001:aaa0001', retries: 2, reviews: 0, dirty: true, unshelved: 'index.lock 存在', look: { state: 'answered', report: 'r', tl: '用假資料' }, say: 'Tech lead 回覆了：用假資料。請接著做' } },
    }
    const l = step(s, { type: 'look', board: done, room: one })
    expect(said(toFs(l.actions, 'TASK-001'))).toMatch(/用假資料/)
    expect(l.actions.some(a => a.type === 'run_tests')).toBe(false)
  })

  test('a fix of crew’s test run waits while another task’s half-done work is in crew’s worktree, to be set aside first', () => {
    const b = two()
    const s: FlowState = {
      stage: 'building',
      round: 0,
      retries: 0,
      runs: 1,
      checks: { 'PRD-001': { round: 1, tips: 'TASK-001:aaa0001', state: 'failed', why: 'x', fix: { task: 'TASK-001', tip: 'aaa0001', text: 'QA 修正', out: true } } },
      jobs: {
        'TASK-001': { home: 1, fixing: 'aaa0001', qa: 'PRD-001', retries: 0, reviews: 0, wait: { at: 'building', by: 'fullstack' }, dirty: true },
        'TASK-002': { home: 1, fixing: 'bbb0002', tips: 'TASK-002:bbb0002', retries: 2, reviews: 0, look: { state: 'answered', report: 'r', tl: 't' }, say: 'Tech lead 回覆了' },
      },
    }
    const l = step(s, { type: 'look', board: b, room: one, app: true })
    expect(toFs(l.actions, 'TASK-002')).toBeUndefined()
    expect(l.actions).toContainEqual({ type: 'shelve', task: 'TASK-001' })
    // Set aside: the test fix goes to the builder in the clean worktree.
    const set = step(l.state, { type: 'shelved', board: b, task: 'TASK-001', sha, ref, room: one, app: true })
    expect(said(toFs(set.actions, 'TASK-002'))).toMatch(/Tech lead 回覆了/)
  })

  test('a restart while crew sets work aside asks again, and crew’s word with no board to read is kept for the next event', () => {
    const b = three()
    const s: FlowState = { stage: 'building', round: 0, retries: 0, jobs: { 'TASK-001': { home: 1, retries: 0, reviews: 0, wait: { at: 'building', by: 'fullstack' }, dirty: true, shelving: true } } }
    const r = step(s, { type: 'resume', board: b, prd: { path: 'docs/PRD.md', size: 10 }, room: one })
    expect(r.actions).toContainEqual({ type: 'shelve', task: 'TASK-001' })
    expect(r.state.jobs?.['TASK-001']?.shelving).toBe(true)
    const heard = step(r.state, { type: 'shelved', task: 'TASK-001', sha, ref, room: one })
    expect(heard.actions).toEqual([])
    expect(heard.state.jobs?.['TASK-001']).toMatchObject({ shelf: { sha, ref } })
    expect(heard.state.jobs?.['TASK-001']?.shelving).toBeUndefined()
    expect(heard.state.jobs?.['TASK-001']?.dirty).toBeUndefined()
    const next = step(heard.state, { type: 'look', board: b, room: one })
    expect(toBuilders(next.actions)).toEqual(['TASK-002'])
  })

  const sha2 = 'abcdef1234567890abcdef1234567890abcdef12'
  const ref2 = `refs/crew/shelf/TASK-001/${sha2.slice(0, 12)}`

  test('what the task’s own .gitignore hid, moved out of git’s way, is said, the next task is built, and it goes back with the work', () => {
    const b = three()
    const dir = `/r/.crew/shelved/TASK-001-${sha.slice(0, 12)}`
    const s: FlowState = { stage: 'building', round: 0, retries: 0, jobs: { 'TASK-001': { home: 1, retries: 0, reviews: 0, wait: { at: 'building', by: 'fullstack' }, dirty: true, shelving: true } } }
    const set = step(s, { type: 'shelved', board: b, task: 'TASK-001', sha, ref, moved: { dir, files: ['dist', '.env'] }, room: one })
    expect(set.state.jobs?.['TASK-001']?.dirty).toBeUndefined()
    expect(set.state.jobs?.['TASK-001']?.shelf).toMatchObject({ sha, moved: [{ dir, files: ['dist', '.env'] }] })
    expect(statuses(set.actions).join('\n')).toContain(`被它的 .gitignore 忽略的檔案（dist、.env），crew 沒有收進 git，而是原樣搬到 ${dir}`)
    expect(toBuilders(set.actions)).toEqual(['TASK-002'])
    // Answered while TASK-002 has the one slot: once it is free, the builder takes TASK-001 up, and crew puts both back first.
    const a = step(set.state, { type: 'answered', question: 'q', answer: '照原本的做', role: 'fullstack', item: 'TASK-001', board: b, room: one })
    const free = step({ ...a.state, jobs: { 'TASK-001': a.state.jobs?.['TASK-001'] ?? { retries: 0, reviews: 0 } } }, { type: 'look', board: b, room: one })
    expect(restoreOf(free.actions, 'TASK-001')?.shelf).toMatchObject({ sha, moved: [{ dir, files: ['dist', '.env'] }] })
    expect(said(toFs(free.actions, 'TASK-001'))).toMatch(/照原本的做/)
  })

  test('work set aside again while the job holds what crew set aside before goes after it: the builder puts back both, in order', () => {
    const b = three()
    const s: FlowState = {
      stage: 'building',
      round: 0,
      retries: 0,
      jobs: { 'TASK-001': { home: 1, retries: 0, reviews: 0, wait: { at: 'building', by: 'fullstack' }, dirty: true, shelving: true, shelf: { sha, ref, tip: '' } } },
    }
    const set = step(s, { type: 'shelved', board: b, task: 'TASK-001', sha: sha2, ref: ref2, files: ['vendor/x.c'], room: one })
    expect(set.state.jobs?.['TASK-001']?.shelf).toMatchObject({ sha, ref, also: [{ sha: sha2, ref: ref2, files: ['vendor/x.c'] }] })
    expect(statuses(set.actions).join('\n')).toMatch(new RegExp(`${ref}[\\s\\S]*vendor/x\\.c[\\s\\S]*${ref2}`))
    const a = step(set.state, { type: 'answered', question: 'q', answer: '好', role: 'fullstack', item: 'TASK-001', board: b, room: one })
    const free = step({ ...a.state, jobs: { 'TASK-001': a.state.jobs?.['TASK-001'] ?? { retries: 0, reviews: 0 } } }, { type: 'look', board: b, room: one })
    expect(restoreOf(free.actions, 'TASK-001')?.shelf).toMatchObject({ sha, also: [{ sha: sha2 }] })
  })

  test('part set aside and part not: the job keeps what was, the worktree waits for the task, and the person hears where the part is', () => {
    const b = three()
    const s: FlowState = { stage: 'building', round: 0, retries: 0, jobs: { 'TASK-001': { home: 1, retries: 0, reviews: 0, wait: { at: 'building', by: 'fullstack' }, dirty: true, shelving: true } } }
    const set = step(s, { type: 'shelved', board: b, task: 'TASK-001', sha, ref, error: '還有 git 收不起來的修改留在工作目錄：vendor/lib', room: one })
    expect(set.state.jobs?.['TASK-001']).toMatchObject({ shelf: { sha, ref }, dirty: true, unshelved: '還有 git 收不起來的修改留在工作目錄：vendor/lib' })
    expect(statuses(set.actions).join('\n')).toMatch(new RegExp(`vendor/lib[\\s\\S]*已經收起來的部分在 ${ref}`))
    expect(toBuilders(set.actions)).toEqual([])
  })

  test('what the builder hears first of crew putting its work back: back, with conflicts, what it left, or how to put it back itself', () => {
    const dir = `/r/.crew/shelved/TASK-001-${sha.slice(0, 12)}`
    const shelf = { sha, ref, also: [{ sha: sha2, ref: ref2, files: ['vendor/x.c'] }], moved: [{ dir, files: ['node_modules', '.env'] }] }
    expect(restoreSaid('TASK-001', shelf, { ok: true })).toMatch(new RegExp(`^crew 已經把 TASK-001 上一輪改到一半、還沒 commit 的修改放回工作目錄了（原本收在 ${ref}[^）]*被 \\.gitignore 忽略的檔案也搬回來了）[\\s\\S]*git reset -q --[\\s\\S]*照常接著做完並 commit。$`))
    expect(restoreSaid('TASK-001', shelf, { ok: true, conflicts: ['src/a.ts'], kept: [{ file: '.env', why: '工作目錄已經有同名的，crew 沒有覆蓋' }], left: [{ sha: sha2, why: '前面放回的修改有衝突，先解決再放這一份' }] })).toMatch(
      new RegExp(`放回時這些檔案有衝突：src/a\\.ts[\\s\\S]*git stash apply ${sha2}[\\s\\S]*這些沒有搬回來，還在 ${dir}：\\.env（工作目錄已經有同名的，crew 沒有覆蓋）`),
    )
    const own = restoreSaid('TASK-001', shelf, { ok: false, why: 'index.lock 存在' })
    expect(own).toMatch(new RegExp(`^crew 沒辦法自己把 TASK-001 上一輪改到一半的修改放回工作目錄（index\\.lock 存在），請你來放：[\\s\\S]*git stash apply ${sha}[\\s\\S]*git stash apply ${sha2}[\\s\\S]*mv '${dir}/node_modules' 'node_modules'`))
  })

  test('a run told to put the work back that left no commit and a clean worktree did not: the next run is told again, and so is the person', () => {
    const b = three()
    const s: FlowState = {
      stage: 'building',
      round: 0,
      retries: 0,
      jobs: { 'TASK-001': { slot: 1, home: 1, retries: 0, reviews: 0, shelf: { sha, ref, tip: '', sent: true } } },
    }
    const r = step(s, { type: 'role_done', role: 'fullstack', board: b, room: one, report: '還沒開始' })
    expect(restoreOf(r.actions, 'TASK-001')?.shelf.sha).toBe(sha)
    expect(r.state.jobs?.['TASK-001']?.shelf).toEqual({ sha, ref, tip: '', sent: true })
    // A run that left a commit has the work in it.
    const committed = step(s, { type: 'role_done', role: 'fullstack', board: commits(b, { 'TASK-001': ['aaa0001'] }), room: one })
    expect(committed.state.jobs?.['TASK-001']?.shelf).toBeUndefined()
    // Still not put back once the tech lead looked: the person hears where the work is.
    const looked: FlowState = {
      stage: 'building',
      round: 0,
      retries: 0,
      jobs: { 'TASK-001': { slot: 1, home: 1, retries: 2, reviews: 0, look: { state: 'answered', report: 'r', tl: '先放回來' }, shelf: { sha, ref, tip: '', sent: true } } },
    }
    const asked = step(looked, { type: 'role_done', role: 'fullstack', board: b, room: one, report: '放不回來' })
    expect(asks(asked.actions)[0]?.question).toMatch(new RegExp(`crew 收在 ${ref}（commit ${sha.slice(0, 7)}），全端還沒有放回來`))
  })

  test('a job put away with work crew set aside (its task out of the plan) says where the work is', () => {
    const b = three()
    const ref9 = `refs/crew/shelf/TASK-009/${sha.slice(0, 12)}`
    const s: FlowState = { stage: 'building', round: 0, retries: 0, jobs: { 'TASK-009': { home: 1, retries: 0, reviews: 0, shelf: { sha, ref: ref9, tip: '' } } } }
    const r = step(s, { type: 'look', board: b, room: one })
    expect(r.state.jobs?.['TASK-009']).toBeUndefined()
    expect(statuses(r.actions).join('\n')).toContain(`TASK-009 已經不在計畫裡，它之前改到一半、還沒 commit 的修改，crew 收在 ${ref9}`)
    expect(statuses(step(r.state, { type: 'look', board: b, room: one }).actions).join('\n')).not.toMatch(/TASK-009/)
  })

  test('a fix of crew’s test run a builder is at holds the tests and its job through another event', () => {
    const b = approvedAll(three(), { 'TASK-001': 'aaa0001', 'TASK-002': 'bbb0002', 'TASK-003': 'ccc0003' })
    const s: FlowState = { stage: 'building', round: 0, retries: 0, runs: 1, jobs: { 'TASK-001': { slot: 1, home: 1, fixing: 'aaa0001', tips: 'TASK-001:aaa0001', retries: 0, reviews: 0 } } }
    const r = step(s, { type: 'look', board: b, room: one })
    expect(r.actions.some(a => a.type === 'run_tests')).toBe(false)
    expect(r.state.stage).toBe('building')
    expect(r.state.jobs?.['TASK-001']?.slot).toBe(1)
  })

  test('the hand-over to the person while the tech lead looks at a QA fix keeps that look: its end sends the fix back with its words', () => {
    const b0 = two()
    const b = withResults(b0, new Map(b0.prd_items.flatMap(i => i.test_cases.map(c => [c.id, { result: 'passed' as const, sha: 'run0001', run: 'r1' }] as const)))) ?? b0
    const s: FlowState = {
      stage: 'building',
      round: 0,
      retries: 0,
      talking: true,
      checks: {
        'PRD-001': { round: 1, tips: 'TASK-001:aaa0001', state: 'failed', why: 'x', fix: { task: 'TASK-001', tip: 'aaa0001', text: 'QA 修正', out: true } },
        'PRD-002': { round: 1, tips: 'TASK-002:bbb0002', state: 'running' },
      },
      jobs: { 'TASK-001': { home: 1, fixing: 'aaa0001', qa: 'PRD-001', retries: 2, reviews: 0, asking: true, look: { state: 'told', report: 'r' } } },
    }
    const c = step(s, { type: 'checked', feature: 'PRD-002', board: b, ok: true, room: one, app: true } as never)
    expect(c.state.talking).toBe(true)
    const t = step(c.state, { type: 'role_done', role: 'techlead', board: b, room: one, app: true, report: '原因是按鈕的事件沒有綁，照這樣改' })
    expect(said(toFs(t.actions, 'TASK-001'))).toMatch(/原因是按鈕的事件沒有綁/)
    expect(t.state.jobs?.['TASK-001']?.look?.state).toBe('answered')
  })

  test('the hand-over to the person while the tech lead answers a QA fix’s builder keeps that answer coming: its end sends it to the builder', () => {
    const b0 = two()
    const b = withResults(b0, new Map(b0.prd_items.flatMap(i => i.test_cases.map(c => [c.id, { result: 'passed' as const, sha: 'run0001', run: 'r1' }] as const)))) ?? b0
    const s: FlowState = {
      stage: 'building',
      round: 0,
      retries: 0,
      talking: true,
      checks: {
        'PRD-001': { round: 1, tips: 'TASK-001:aaa0001', state: 'failed', why: 'x', fix: { task: 'TASK-001', tip: 'aaa0001', text: 'QA 修正', out: true } },
        'PRD-002': { round: 1, tips: 'TASK-002:bbb0002', state: 'running' },
      },
      jobs: { 'TASK-001': { home: 1, fixing: 'aaa0001', qa: 'PRD-001', retries: 0, reviews: 0, asking: true } },
    }
    const c = step(s, { type: 'checked', feature: 'PRD-002', board: b, ok: true, room: one, app: true } as never)
    expect(c.state.talking).toBe(true)
    const t = step(c.state, { type: 'role_done', role: 'techlead', board: b, room: one, app: true, report: '按鈕改用 submit 事件' })
    expect(said(toFs(t.actions, 'TASK-001'))).toMatch(/按鈕改用 submit 事件/)
  })

  test('the tech lead’s answer on a fix of crew’s test run, told something else at once, keeps the tests back till the fix goes out with it', () => {
    const b = approvedAll(three(), { 'TASK-001': 'aaa0001', 'TASK-002': 'bbb0002', 'TASK-003': 'ccc0003' })
    const s: FlowState = {
      stage: 'building',
      round: 0,
      retries: 0,
      runs: 1,
      talking: true,
      jobs: { 'TASK-001': { home: 1, fixing: 'aaa0001', tips: 'TASK-001:aaa0001', retries: 2, reviews: 0, asking: true, look: { state: 'told', report: 'r' } } },
    }
    const t = step(s, { type: 'role_done', role: 'techlead', board: b, room: one, report: '測試要先建資料表', inbox: { techlead: ['TASK-002'] } })
    expect(t.actions.some(a => a.type === 'run_tests')).toBe(false)
    expect(t.state.jobs?.['TASK-001']?.say).toMatch(/測試要先建資料表/)
    const n = step(t.state, { type: 'role_done', role: 'techlead', board: b, room: one, report: '好' })
    expect(said(toFs(n.actions, 'TASK-001'))).toMatch(/測試要先建資料表/)
    expect(n.actions.some(a => a.type === 'run_tests')).toBe(false)
  })

  test('the person’s answer to the could-not-set-aside question has crew try again; the same reason is not said twice', () => {
    const b = three({ 'TASK-001': ['TASK-002'] })
    const s: FlowState = { stage: 'building', round: 0, retries: 0, talking: true, jobs: { 'TASK-001': { home: 1, retries: 2, reviews: 0, dirty: true, unshelved: 'git add 沒有成功：x', look: { state: 'answered', report: 'r', tl: 't' }, say: 'x' } } }
    const e = step(s, { type: 'role_done', role: 'techlead', board: b, room: one, report: '看過了' })
    const q = asks(e.actions)[0]?.question ?? ''
    expect(q).toMatch(/crew 想先收起來，但沒有成功：git add 沒有成功：x/)
    expect(q).toMatch(/crew 會再收一次、再看一次工作目錄/)
    expect(q).not.toMatch(/commit 或還原/)
    const a = step(e.state, { type: 'answered', id: 'Q-05', question: q, answer: '我處理好了', escalation: true, item: 'TASK-001', board: b, room: one })
    expect(a.actions).toContainEqual({ type: 'shelve', task: 'TASK-001' })
    // Failing the same way again is not said again; clean now, the task lets go of the worktree.
    const same = step(a.state, { type: 'shelved', board: b, task: 'TASK-001', error: 'git add 沒有成功：x', room: one })
    expect(statuses(same.actions)).toEqual([])
    const again = step(a.state, { type: 'shelved', board: b, task: 'TASK-001', room: one })
    expect(again.state.jobs?.['TASK-001']?.dirty).toBeUndefined()
    expect(again.state.jobs?.['TASK-001']?.unshelved).toBeUndefined()
  })

  test('the tech lead setting a task with work half done after another while crew sets it aside is no stuck plan', () => {
    const b = three({ 'TASK-001': ['TASK-002'] })
    const s: FlowState = { stage: 'building', round: 0, retries: 0, talking: true, jobs: { 'TASK-001': { home: 1, retries: 2, reviews: 0, asking: true, dirty: true, look: { state: 'told', report: 'r', unclean: true } } } }
    const r = step(s, { type: 'role_done', role: 'techlead', board: b, room: one, report: '加進 after 了' })
    expect(r.state.stage).toBe('building')
    expect(asks(r.actions)).toEqual([])
    expect(r.actions).toContainEqual({ type: 'shelve', task: 'TASK-001' })
    const set = step(r.state, { type: 'shelved', board: b, task: 'TASK-001', sha, ref, room: one })
    expect(toBuilders(set.actions)).toEqual(['TASK-002'])
  })

  test('crew tries again to set aside work a builder at work there kept with any role’s next run end or crew’s look, and after the task’s own run ends', () => {
    const b = three()
    const busy: FlowState = { stage: 'building', round: 0, retries: 0, jobs: { 'TASK-001': { home: 1, retries: 0, reviews: 0, wait: { at: 'building', by: 'fullstack' }, dirty: true, unshelved: '全端正在 crew 的工作目錄工作' } } }
    expect(step(busy, { type: 'role_done', role: 'pm', board: b, room: one }).actions).toContainEqual({ type: 'shelve', task: 'TASK-001' })
    // And at crew's own look: the person's run there ending feeds the flow no run's end.
    expect(step(busy, { type: 'look', board: b, room: one }).actions).toContainEqual({ type: 'shelve', task: 'TASK-001' })
    // Its own word on it is no reason to ask again at once.
    expect(step({ ...busy, jobs: { 'TASK-001': { ...busy.jobs?.['TASK-001'], shelving: true } as never } }, { type: 'shelved', board: b, task: 'TASK-001', busy: true, room: one }).actions.filter(a => a.type === 'shelve')).toEqual([])
    // Could not, and the task went on in place: its next run ending with work half done is set aside afresh.
    const failed: FlowState = { stage: 'building', round: 0, retries: 0, jobs: { 'TASK-001': { slot: 1, home: 1, retries: 0, reviews: 0, unshelved: 'index.lock 存在' } } }
    const r = step(failed, { type: 'role_done', role: 'fullstack', board: b, room: one, unclean: true, open: { 'TASK-001': 'fullstack' } })
    expect(r.actions).toContainEqual({ type: 'shelve', task: 'TASK-001' })
  })
})
