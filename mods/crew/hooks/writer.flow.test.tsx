import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { approve, build, command, designed, done, PLAN, ROOT, SPLIT, start, world, write } from './world'

/**
 * One board, one writer. Two Claude Codes on a repo write over each other's
 * board: one with a record of the PRD puts the marks of commits, reviews and
 * decisions on, the other one takes them off again (ai-awesome 2026-11-13, a
 * background session left open since 11-06 on another PRD and another copy of
 * crew). crew leaves the marks of a board aligned to another PRD alone, keeps
 * what it does not know through a write, and writes the board only while no
 * other copy of crew says it writes it.
 */

const BOARD = `${ROOT}/.crew/prd-tracker.json`
const WRITER = `${ROOT}/.crew/writer.json`

const planned = async ($: Engine) => {
  await $.command.run(command('start docs/PRD.md'))
  await write($, 'a-pm-1', SPLIT)
  await done($, 'a-pm-1')
  await write($, 'a-qa-2', [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }])
  await done($, 'a-qa-2')
  await designed($)
  await write($, 'a-techlead-4', PLAN)
  await done($, 'a-techlead-4')
}

type Task = { id: string; crew_commits?: string[]; crew_review?: unknown; [field: string]: unknown }
type Board = { crew_prd?: { path?: string }; prd_items: { id: string; tasks?: Task[]; crew_designs?: { id: string; crew_decision?: unknown }[]; [field: string]: unknown }[]; [field: string]: unknown }

const boardOf = (w: { disk: Map<string, string> }): Board => JSON.parse(w.disk.get(BOARD) ?? '{"prd_items":[]}') as Board
const tasksOf = (b: Board): Task[] => b.prd_items.flatMap(i => i.tasks ?? [])

/** Another PRD's board as the crew that follows it wrote it: its tasks built and reviewed, its designs decided, and fields this crew knows nothing of. */
const othersBoard = (w: { disk: Map<string, string> }): string => {
  const b = boardOf(w)
  const sha = (n: number) => `${String(n).padStart(4, '0')}`.padEnd(40, 'e')
  let n = 0
  const items = b.prd_items.map(item => ({
    ...item,
    crew_owner_note: `只有另一份 crew 知道的欄位 ${item.id}`,
    tasks: (item.tasks ?? []).map(t => {
      n += 1
      return { ...t, crew_layer: 'be', crew_part: '名單搜尋', crew_touches: ['src/x.py'], crew_commits: [sha(n), sha(n + 50)], crew_review: { sha: sha(n), verdict: 'approve' }, crew_unmerged: sha(n + 50) }
    }),
    crew_designs: (item.crew_designs ?? []).map(d => ({ ...d, crew_decision: { verdict: 'approved' } })),
  }))
  return `${JSON.stringify({ ...b, crew_prd: { ...(b.crew_prd ?? {}), path: 'docs/OTHER.md' }, migration_maps: { 'F-OLD': 'PRD-001' }, prd_items: items }, null, 2)}\n`
}

describe('the board’s one writer', () => {
  test('leaves the marks of a board aligned to another PRD as they are, however long it looks', { timeoutMs: 60_000 }, async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    // Another crew, following another PRD, aligns the board to its own and marks its own record on it.
    const theirs = othersBoard(w)
    w.disk.set(BOARD, theirs)
    // A decision of this PRD's stays in memory: that board's decisions are that PRD's.
    const saved = await $.tool.call({ tool: 'mcp__crew__memory_save', tool_use_id: 'm-dec', agentId: 'a-pm-1', type: 'DEC', text: '只做月繳' } as never) as { result: unknown }
    expect(String(saved.result)).toMatch(/DEC-/)
    // crew looks at the board and git every 10 seconds, and at least every half minute.
    await w.clock.advance(65_000)
    expect(w.disk.get(BOARD)).toBe(theirs)
    const tasks = tasksOf(boardOf(w))
    expect(tasks.length).toBe(2)
    expect(tasks.every(t => (t.crew_commits ?? []).length === 2 && t.crew_review !== undefined && t.crew_unmerged !== undefined)).toBe(true)
    expect(boardOf(w).prd_items.flatMap(i => i.crew_designs ?? []).every(d => d.crew_decision !== undefined)).toBe(true)
  })

  test('refuses a board_write on a board aligned to another PRD, and changes nothing', { timeoutMs: 60_000 }, async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    const theirs = othersBoard(w)
    w.disk.set(BOARD, theirs)
    const r = await write($, 'a-techlead-4', [{ op: 'set_task', id: 'TASK-001', layer: 'ui' }])
    expect(String(r.result)).toMatch(/board_write 沒有生效：看板對準的是另一份 PRD「docs\/OTHER\.md」，crew 追的是「docs\/PRD\.md」/)
    expect(w.disk.get(BOARD)).toBe(theirs)
  })

  test('keeps every mark and every field it does not know through a read, a change and a save', { timeoutMs: 60_000 }, async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await build($)
    // What a later crew or another tool keeps on the board, unknown to this one.
    const b = boardOf(w)
    w.disk.set(
      BOARD,
      `${JSON.stringify({ ...b, migration_maps: { 'F-OLD': 'PRD-001' }, prd_items: b.prd_items.map(i => ({ ...i, crew_owner_note: '別的工具的欄位', tasks: (i.tasks ?? []).map(t => ({ ...t, crew_touches: ['src/x.py'], crew_future: { kept: true } })) })) }, null, 2)}\n`,
    )
    const before = tasksOf(boardOf(w)).map(t => [t.id, t.crew_commits, t.crew_review])
    expect(before.every(([, commits, review]) => Array.isArray(commits) && commits.length > 0 && review !== undefined)).toBe(true)
    // Read, changed and saved: the tech lead moves one task to another layer.
    expect(String((await write($, 'a-techlead-4', [{ op: 'set_task', id: 'TASK-001', layer: 'ui' }])).result)).not.toMatch(/沒有生效/)
    await w.clock.advance(65_000)
    const after = boardOf(w)
    expect(tasksOf(after).map(t => [t.id, t.crew_commits, t.crew_review])).toEqual(before)
    expect(tasksOf(after).find(t => t.id === 'TASK-001')?.crew_layer).toBe('ui')
    expect(after.migration_maps).toEqual({ 'F-OLD': 'PRD-001' })
    expect(after.prd_items.every(i => i.crew_owner_note === '別的工具的欄位')).toBe(true)
    expect(tasksOf(after).every(t => JSON.stringify(t.crew_touches) === '["src/x.py"]' && JSON.stringify(t.crew_future) === '{"kept":true}')).toBe(true)
  })

  test('writes nothing on the board while another copy of crew says it writes it, keeps its own record, and puts its marks on a minute after that copy goes', { timeoutMs: 60_000 }, async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    // crew wrote the board: it is the writer.
    const mine = JSON.parse(w.disk.get(WRITER) ?? '{}') as { holder?: string; session?: string; at?: number }
    expect(mine).toMatchObject({ session: 'session-1' })
    expect(typeof mine.holder).toBe('string')
    expect(w.disk.get(`${ROOT}/.crew/.gitignore`)).toMatch(/^writer\.json$/m)
    // The full-stack commits a task: crew marks it on the board, and the tech lead is to review it.
    w.commit('TASK-001: 完成 TASK-001')
    await done($, 'a-fullstack-5')
    expect(tasksOf(boardOf(w)).find(t => t.id === 'TASK-001')?.crew_commits?.length).toBe(1)
    // Another copy of crew takes the board over and says so, every few seconds.
    const other = async () => w.disk.set(WRITER, `${JSON.stringify({ holder: 'another-copy-of-crew', session: 'bg-0611abcdef', at: w.clock.now() })}\n`)
    await other()
    const held = w.disk.get(BOARD)
    const r = await write($, 'a-pm-1', [{ op: 'add_criterion', feature: 'PRD-001', text: '可以改成年繳' }])
    expect(String(r.result)).toMatch(/board_write 沒有生效：另一份 crew（另一個安裝來源的.*最近一次在對話 bg-0611a 裡寫）正在寫這份看板.*關掉那一份 crew 在這個專案開著的每一個對話/)
    expect(w.disk.get(BOARD)).toBe(held)
    // Told once, as a notice: not again for each refused write.
    expect(w.toasts.filter(t => /最近一次在對話 bg-0611a 裡寫）正在寫這份看板/.test(t)).length).toBe(1)
    // The tech lead approves it meanwhile: crew keeps the review in its own record, and the board stays as the other copy has it, however often crew looks.
    expect(String((await approve($, 'TASK-001')).result)).not.toMatch(/沒有記下/)
    for (let n = 0; n < 3; n++) {
      await w.clock.advance(10_000)
      await other()
    }
    expect(w.disk.get(BOARD)).toBe(held)
    expect(tasksOf(boardOf(w)).find(t => t.id === 'TASK-001')?.crew_review).toBeUndefined()
    expect(JSON.parse(w.disk.get(WRITER) ?? '{}')).toMatchObject({ holder: 'another-copy-of-crew' })
    // That copy is closed: a minute without its word, and crew writes the board again with what it kept.
    await w.clock.advance(61_000)
    const task = tasksOf(boardOf(w)).find(t => t.id === 'TASK-001')
    expect(task?.crew_commits?.length).toBe(1)
    expect(task?.crew_review).toMatchObject({ verdict: 'approve' })
    expect(JSON.parse(w.disk.get(WRITER) ?? '{}')).toMatchObject({ holder: mine.holder, session: 'session-1' })
    expect(String((await write($, 'a-pm-1', [{ op: 'add_criterion', feature: 'PRD-001', text: '可以改成年繳' }])).result)).not.toMatch(/沒有生效/)
  })

  test('is one writer in every Claude Code that runs this copy of crew: another conversation, a restart, a reload, a /clear', { timeoutMs: 60_000 }, async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    const first = JSON.parse(w.disk.get(WRITER) ?? '{}') as { holder: string; at: number }
    // It says so again while it follows the PRD.
    await w.clock.advance(45_000)
    const renewed = JSON.parse(w.disk.get(WRITER) ?? '{}') as { holder: string; at: number }
    expect(renewed.holder).toBe(first.holder)
    expect(renewed.at).toBeGreaterThan(first.at + 15_000)
    // The word of another Claude Code that runs this same copy (a second conversation, or this one before a restart): the same writer, never refused.
    w.disk.set(WRITER, `${JSON.stringify({ holder: first.holder, session: 'earlier-claude-code', at: w.clock.now() })}\n`)
    expect(String((await write($, 'a-pm-1', SPLIT)).result)).not.toMatch(/沒有生效/)
    expect(JSON.parse(w.disk.get(WRITER) ?? '{}')).toMatchObject({ holder: first.holder, session: 'session-1' })
    expect(w.toasts.some(t => /正在寫這份看板/.test(t))).toBe(false)
    // A reload, then a /clear: the same writer, at once.
    await start($)
    expect(String((await write($, 'a-pm-1', [{ op: 'add_criterion', feature: 'PRD-001', text: '可以改成年繳' }])).result)).not.toMatch(/沒有生效/)
    w.session.id = 'session-2'
    await start($)
    expect(String((await write($, 'a-pm-1', [{ op: 'add_criterion', feature: 'PRD-002', text: '取消後可以再訂' }])).result)).not.toMatch(/沒有生效/)
    expect(JSON.parse(w.disk.get(WRITER) ?? '{}')).toMatchObject({ holder: first.holder })
  })

  test('takes no word for a writer that is not one: a file it cannot read, or a time far ahead', { timeoutMs: 60_000 }, async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    w.disk.set(WRITER, 'not json')
    expect(String((await write($, 'a-pm-1', SPLIT)).result)).not.toMatch(/沒有生效/)
    w.disk.set(WRITER, `${JSON.stringify({ holder: 'from-the-future', session: 'x', at: (w.clock.now()) + 3_600_000 })}\n`)
    expect(String((await write($, 'a-pm-1', [{ op: 'add_criterion', feature: 'PRD-001', text: '可以改成年繳' }])).result)).not.toMatch(/沒有生效/)
  })
})
