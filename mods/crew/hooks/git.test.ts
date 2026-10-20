import { describe, expect, test } from 'claude-code/testing'

import { applyOps, newTracker, tasksOf } from './board'
import type { Op, Tracker } from './board'
import { branchOf, commitsByTask, commitsOf, marksOf, recordSeen, resultsMarkOf, reviewsOf, SUBJECT, taskMark, withCommits, withResults, withReviews, workdirOf } from './git'
import { testMark } from './runs'

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
    // A commit that undoes a task, or only mentions one, does not do it.
    expect(SUBJECT.test('Revert "TASK-001: 方案頁"')).toBe(false)
    expect(SUBJECT.test('fix: TASK-001 的錯字')).toBe(false)
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

describe('crew’s record of the tech lead’s reviews', () => {
  test('marks a task with the review crew recorded for that very task, of a commit it saw doing it', () => {
    const board = planned()
    const first = tasksOf(board.prd_items[0]!)[0]!
    const commits = new Map([['TASK-001', ['bbbbbbb2', 'aaaaaaa1']]])
    const reviewed = {
      'TASK-001': { sha: 'aaaaaaa1', verdict: 'approve' as const, mark: taskMark(first) },
      // Another task's review under the same id, or of a commit crew never saw doing it, counts for nothing.
      'TASK-002': { sha: 'ccccccc3', verdict: 'approve' as const, mark: 'ffffff' },
    }
    const reviews = reviewsOf(board, reviewed, commits)
    expect(Object.fromEntries(reviews)).toEqual({ 'TASK-001': { sha: 'aaaaaaa1', verdict: 'approve' } })
    expect(reviewsOf(board, { 'TASK-001': { ...reviewed['TASK-001'], sha: 'eeeeeee5' } }, commits).size).toBe(0)
    const marked = withReviews(board, reviews)
    expect(tasksOf(marked!.prd_items[0]!).map(t => t.crew_review)).toEqual([{ sha: 'aaaaaaa1', verdict: 'approve' }, undefined])
    expect(withReviews(marked!, reviews)).toBeNull()
    // A review a board brought, which crew never recorded, is taken off.
    expect(tasksOf(withReviews(marked!, new Map())!.prd_items[0]!).map(t => t.crew_review)).toEqual([undefined, undefined])
  })
})

describe('crew’s record of its latest test run', () => {
  const tested = (): Tracker => {
    const r = applyOps(planned(), [
      { op: 'add_test_case', criteria: ['AC-001'], title: '選月繳', steps: ['s'], expected: 'e' },
      { op: 'add_test_case', criteria: ['AC-001'], title: '換方案', steps: ['s'], expected: 'e' },
    ] as Op[], ctx('qa'))
    if (!r.ok) throw new Error(r.errors.join())
    return r.tracker
  }

  test('marks each test case with its result in that very case, out of date once crew’s branch moved on', () => {
    const board = tested()
    const [tc1, tc2] = board.prd_items[0]!.test_cases
    const ran = { sha: 'aaaaaaa1', at: 1, exit: 1, run: '20261020-120000', results: { 'TC-001': { result: 'passed' as const, mark: testMark(tc1!) }, 'TC-002': { result: 'failed' as const, mark: 'ffffff' } } }
    // TC-002's result was for another case under the same id: it counts for nothing.
    expect(Object.fromEntries(resultsMarkOf(board, ran, 'aaaaaaa1'))).toEqual({ 'TC-001': { result: 'passed', sha: 'aaaaaaa1', run: '20261020-120000' } })
    expect(Object.fromEntries(resultsMarkOf(board, ran, 'bbbbbbb2'))).toEqual({ 'TC-001': { result: 'passed', sha: 'aaaaaaa1', run: '20261020-120000', stale: true } })
    expect(resultsMarkOf(board, undefined, 'aaaaaaa1').size).toBe(0)
    void tc2
  })

  test('sets the case’s result and the dashboard’s automated_status from it, and takes off a result crew never recorded', () => {
    const board = tested()
    const fresh = withResults(board, new Map([['TC-001', { result: 'passed' as const, sha: 'a', run: 'r' }]]))!
    expect(fresh.prd_items[0]!.test_cases.map(c => [c.crew_result, c.automated_status])).toEqual([
      [{ result: 'passed', sha: 'a', run: 'r' }, 'passed'],
      [undefined, 'not_run'],
    ])
    expect(withResults(fresh, new Map([['TC-001', { result: 'passed' as const, sha: 'a', run: 'r' }]]))).toBeNull()
    const stale = withResults(fresh, new Map([['TC-001', { result: 'passed' as const, sha: 'a', run: 'r', stale: true as const }]]))!
    expect(stale.prd_items[0]!.test_cases[0]!.automated_status).toBe('not_run')
    // Once crew has no result for the case, the board stops saying it passed.
    const gone = withResults(fresh, new Map())!
    expect(gone.prd_items[0]!.test_cases[0]).toMatchObject({ automated_status: 'not_run' })
    expect(gone.prd_items[0]!.test_cases[0]!.crew_result).toBeUndefined()
  })
})
