import { describe, expect, test } from 'claude-code/testing'

import { applyOps, newTracker, tasksOf } from './board'
import type { Op, Tracker } from './board'
import { branchOf, commitsByTask, commitsOf, marksOf, recordSeen, SUBJECT, taskMark, withCommits, workdirOf } from './git'

const ctx = (by: string) => ({ by, today: '2026-10-16', prefixes: { feature: 'PRD-', testCase: 'TC-' } })

const planned = (): Tracker => {
  const a = applyOps(newTracker('x'), [{ op: 'add_feature', title: '方案', summary: '' }, { op: 'add_criterion', feature: 'PRD-001', text: '可以選月繳' }], ctx('pm'))
  if (!a.ok) throw new Error(a.errors.join())
  const b = applyOps(a.tracker, [
    { op: 'add_task', feature: 'PRD-001', criteria: ['AC-001'], title: '方案頁', detail: '', size: 'S' },
    { op: 'add_task', feature: 'PRD-001', criteria: ['AC-001'], title: '方案 API', detail: '', size: 'M' },
  ] as Op[], ctx('techlead'))
  if (!b.ok) throw new Error(b.errors.join())
  return b.tracker
}

describe('where the full-stack works', () => {
  test('is a branch and a worktree named after the PRD', () => {
    expect(branchOf('docs/PRD.md')).toBe('crew/prd')
    expect(branchOf('docs/會員 訂閱 v2.md')).toBe('crew/v2')
    expect(branchOf('specs/Billing_Plan.markdown')).toBe('crew/billing-plan')
    expect(branchOf('docs/中文.md')).toMatch(/^crew\/prd-[0-9a-f]{6}$/)
    expect(workdirOf('/repo', 'docs/PRD.md')).toBe('/repo/.crew/work/prd')
  })
})

describe('commits that do a task', () => {
  test('are the ones whose subject starts with the task ids', () => {
    const log = [
      'aaaaaaa1\tTASK-001: 方案頁',
      'bbbbbbb2\tTASK-001, TASK-002：方案頁接上 API',
      'ccccccc3\tfix: 不是任務 TASK-003',
      'ddddddd4\tTASK-12 不是 crew 的格式',
      'eeeeeee5\t[TASK-004] 方括號也算',
      '',
    ].join('\n')
    const map = commitsByTask(log)
    expect(Object.fromEntries(map)).toEqual({ 'TASK-001': ['aaaaaaa1', 'bbbbbbb2'], 'TASK-002': ['bbbbbbb2'], 'TASK-004': ['eeeeeee5'] })
    expect(SUBJECT.test('TASK-001: x')).toBe(true)
  })
})

describe('the board’s record of them', () => {
  test('marks each task with the commits that do it, and says when nothing changed', () => {
    const board = planned()
    const marked = withCommits(board, new Map([['TASK-001', ['aaaaaaa1']]]))
    expect(marked).not.toBeNull()
    expect(tasksOf(marked!.prd_items[0]!).map(t => t.crew_commits)).toEqual([['aaaaaaa1'], undefined])
    expect(withCommits(marked!, new Map([['TASK-001', ['aaaaaaa1']]]))).toBeNull()
    // A commit that went away (a rewritten branch) takes the mark with it.
    expect(tasksOf(withCommits(marked!, new Map())!.prd_items[0]!).map(t => t.crew_commits)).toEqual([undefined, undefined])
  })
})

describe('crew’s record of what it saw done', () => {
  const retitled = (board: Tracker, title: string): Tracker => ({
    ...board,
    prd_items: board.prd_items.map(item => ({ ...item, tasks: (item.tasks ?? []).map(t => ((t as { id?: string }).id === 'TASK-001' ? { ...(t as object), title } : t)) })),
  })

  test('ties each commit to the tasks it did, as they stood when crew first saw it', () => {
    const board = planned()
    const first = tasksOf(board.prd_items[0]!)[0]!
    const seen = recordSeen({}, commitsOf('aaaaaaa1\tTASK-001: 方案頁\nccccccc3\tTASK-009: 看板上沒有這個任務'), board)
    expect(seen).toEqual({ aaaaaaa1: { 'TASK-001': taskMark(first) }, ccccccc3: {} })
    expect(Object.fromEntries(marksOf(board, seen))).toEqual({ 'TASK-001': ['aaaaaaa1'] })
    // A newer commit joins, newest first; one already seen changes nothing.
    const more = recordSeen(seen, commitsOf('bbbbbbb2\tTASK-001: 方案頁樣式\naaaaaaa1\tTASK-001: 方案頁'), board)
    expect(Object.fromEntries(marksOf(board, more))).toEqual({ 'TASK-001': ['bbbbbbb2', 'aaaaaaa1'] })
    expect(recordSeen(more, commitsOf('aaaaaaa1\tTASK-001: 方案頁'), board)).toBe(more)
  })

  test('does not count a commit for another task that later takes the same id', () => {
    const seen = recordSeen({}, commitsOf('aaaaaaa1\tTASK-001: 方案頁'), planned())
    // The board was made again: its TASK-001 is another task now, and the old commit is still on the branch.
    const other = retitled(planned(), '登入頁')
    expect(marksOf(other, seen).size).toBe(0)
    const again = recordSeen(seen, commitsOf('bbbbbbb2\tTASK-001: 登入頁\naaaaaaa1\tTASK-001: 方案頁'), other)
    expect(Object.fromEntries(marksOf(other, again))).toEqual({ 'TASK-001': ['bbbbbbb2'] })
  })

  test('keeps a task’s mark while only its size or detail changes', () => {
    const board = planned()
    const seen = recordSeen({}, commitsOf('aaaaaaa1\tTASK-001: 方案頁'), board)
    const resized = { ...board, prd_items: board.prd_items.map(item => ({ ...item, tasks: (item.tasks ?? []).map(t => ({ ...(t as object), size: 'L', detail: '加上年繳' })) })) }
    expect(Object.fromEntries(marksOf(resized as Tracker, seen))).toEqual({ 'TASK-001': ['aaaaaaa1'] })
  })
})
