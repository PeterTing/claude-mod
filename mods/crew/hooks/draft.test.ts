import { describe, expect, test } from 'claude-code/testing'

import type { CrewDraft } from '../types'
import { draftDetail, draftOf, failedOf, MAX_SENDS, outcomeOf, pendingOf, reviewMark, reviewPrompt, reviewWord, sentDraft, sentOut, settledNote, takeoverOf, titleIn, withAsk, withOutcome } from './draft'

const sent = (): CrewDraft => withAsk(withAsk(sentDraft('docs/crew/v2-PRD.md', '待辦清單 v2', 3, 1), 'pm', 'ASK-01'), 'uiux', 'ASK-02')

describe('a reviewer’s ask', () => {
  test('names the draft and its thread first, gives the whole path, and asks for the count of gaps on the first line', () => {
    const pm = reviewPrompt('pm', 'docs/crew/v2-PRD.md', '/repo/docs/crew/v2-PRD.md', 'ASK-01')
    expect(pm.split('\n')[0]).toBe('審草稿 docs/crew/v2-PRD.md（ASK-01）')
    expect(pm).toContain('用 Read 讀 /repo/docs/crew/v2-PRD.md，找出需求寫不清楚')
    expect(pm).toContain('第一行只寫「缺口 N 個」，沒有就寫「沒有缺口」')
    expect(pm).toContain('提到檔案時用 repo 裡的相對路徑')
    expect(pm).toContain('不要改看板，也不要改任何檔案')
    expect(reviewPrompt('uiux', 'p.md', '/repo/p.md', 'ASK-02')).toContain('找出使用者會看到的部分')
  })
})

describe('what a review found', () => {
  test('reads the count of gaps from the first line only', () => {
    expect(outcomeOf('缺口 3 個\n- a\n- b\n- c')).toEqual({ found: '3 個缺口' })
    expect(outcomeOf('  缺口 0 個')).toEqual({ found: '沒有缺口' })
    expect(outcomeOf('沒有缺口')).toEqual({ found: '沒有缺口' })
    expect(outcomeOf('無法審查：找不到檔案\n缺口 2 個')).toEqual({ found: '回覆沒照格式', unsure: true })
    expect(outcomeOf('')).toEqual({ found: '回覆沒照格式', unsure: true })
  })

  test('is kept for its reviewer alone, with its thread, and replaces an earlier one', () => {
    const failed = withOutcome(sent(), 'pm', { found: '沒有送到', failed: true })
    expect(failed.reviews[0]).toEqual({ role: 'pm', ask: 'ASK-01', done: false, failed: true, found: '沒有送到' })
    expect(failed.reviews[1]).toEqual({ role: 'uiux', done: false, ask: 'ASK-02' })
    const again = withOutcome(failed, 'pm', { found: '回覆沒照格式', unsure: true })
    expect(again.reviews[0]).toEqual({ role: 'pm', ask: 'ASK-01', done: true, unsure: true, found: '回覆沒照格式' })
    expect(withOutcome(again, 'pm', { found: '2 個缺口' }).reviews[0]).toEqual({ role: 'pm', ask: 'ASK-01', done: true, found: '2 個缺口' })
  })

  test('says each review in a few words, with its mark', () => {
    expect([reviewMark({ done: true }), reviewWord({ done: true, found: '2 個缺口' })]).toEqual(['✓ ', '2 個缺口'])
    expect([reviewMark({ done: true, unsure: true }), reviewWord({ done: true })]).toEqual(['? ', '已回覆'])
    expect([reviewMark({ done: false, failed: true }), reviewWord({ done: false, failed: true })]).toEqual(['✗ ', '沒有審完'])
    expect([reviewMark({ done: false }), reviewWord({ done: false })]).toEqual(['', '審查中'])
  })

  test('tells reviewers at work from those that did not finish', () => {
    const d = withOutcome(sent(), 'pm', { found: '沒有送到', failed: true })
    expect(pendingOf(d).map(r => r.role)).toEqual(['uiux'])
    expect(failedOf(d).map(r => r.role)).toEqual(['pm'])
  })
})

describe('what the brain hears once every reviewer settled', () => {
  test('where each reply is, and to ask the person', () => {
    const d = withOutcome(withOutcome(sent(), 'pm', { found: '2 個缺口' }), 'uiux', { found: '沒有缺口' })
    expect(settledNote(d)).toBe(
      'PM 和 UI/UX 都審完 PRD 草稿 docs/crew/v2-PRD.md 了（PM：2 個缺口，ASK-01；UI/UX：沒有缺口，ASK-02；原話用 thread_read 讀）。把缺口整理成問題問使用者，照回答改草稿，改好用 crew 工具 action=ready 請使用者確認。',
    )
  })

  test('to read a reply not in the asked form first', () => {
    const d = withOutcome(withOutcome(sent(), 'pm', { found: '回覆沒照格式', unsure: true }), 'uiux', { found: '沒有缺口' })
    expect(settledNote(d)).toContain('PM（ASK-01） 的回覆沒照格式：先用 thread_read 讀原話，確認真的審了；沒審就用 action=draft、path=docs/crew/v2-PRD.md 重新送審。')
    expect(settledNote({ ...d, sends: MAX_SENDS })).toContain('PM（ASK-01） 的回覆沒照格式：先用 thread_read 讀原話，確認真的審了；沒審的話，已送審 3 次，問使用者要不要照現在的草稿確認。')
  })

  test('to send again a review that did not finish', () => {
    const d = withOutcome(withOutcome(sent(), 'pm', { found: '這一輪沒有完成', failed: true }), 'uiux', { found: '1 個缺口' })
    const note = settledNote(d)
    expect(note).toBe('PRD 草稿 docs/crew/v2-PRD.md 的審查沒有全部完成（PM：沒有審完（這一輪沒有完成），ASK-01；UI/UX：1 個缺口，ASK-02）。PM 要重審：用 crew 工具 action=draft、path=docs/crew/v2-PRD.md 重新送審。')
  })

  test('to ask the person instead, once the draft went to review as often as it may', () => {
    const d = { ...withOutcome(withOutcome(sent(), 'pm', { found: '這一輪沒有完成', failed: true }), 'uiux', { found: '1 個缺口' }), sends: MAX_SENDS }
    expect(sentOut(d)).toBe(true)
    expect(sentOut({ sends: MAX_SENDS - 1 })).toBe(false)
    expect(sentOut({})).toBe(false)
    expect(settledNote(d)).toBe('PRD 草稿 docs/crew/v2-PRD.md 已送審 3 次，仍有審查沒有完成（PM：沒有審完（這一輪沒有完成），ASK-01；UI/UX：1 個缺口，ASK-02）。不要再送審：問使用者要不要照現在的草稿確認，要的話用 crew 工具 action=ready。')
  })

  test('as the brain asks for it after a restart: the path, the stage and each review with its thread', () => {
    const d = withOutcome(sent(), 'pm', { found: '1 個缺口' })
    expect(draftDetail(d)).toBe('PRD 草稿：docs/crew/v2-PRD.md（審查中；PM 1 個缺口 ASK-01、UI/UX 審查中 ASK-02）')
    expect(draftDetail({ ...withOutcome(d, 'uiux', { found: '沒有送到', failed: true }), stage: 'confirm' })).toBe('PRD 草稿：docs/crew/v2-PRD.md（等使用者確認；PM 1 個缺口 ASK-01、UI/UX 沒有審完（沒有送到） ASK-02）')
  })
})

describe('a draft kept for a restart', () => {
  test('comes back as it was, a review under way then marked as not finished', () => {
    const kept = withOutcome(sent(), 'pm', { found: '1 個缺口' })
    expect(draftOf(JSON.parse(JSON.stringify(kept)))).toEqual({ ...kept, reviews: [kept.reviews[0], { role: 'uiux', ask: 'ASK-02', done: false, failed: true, found: '重開前沒審完' }] })
  })

  test('keeps a draft waiting for the person, with its note, a doubtful review and one never sent', () => {
    const d: CrewDraft = { ...withOutcome(withOutcome(sent(), 'pm', { found: '回覆沒照格式', unsure: true }), 'uiux', { found: '沒有送到', failed: true }), stage: 'confirm', note: '已補', sends: 2 }
    expect(draftOf(JSON.parse(JSON.stringify(d)))).toEqual(d)
  })

  test('takes no other shape: one review of each reviewer, and the fields of a draft', () => {
    const d = sent()
    expect(draftOf({ ...d, reviews: [] })).toBeUndefined()
    expect(draftOf({ ...d, reviews: [d.reviews[0], d.reviews[0], d.reviews[1]] })).toBeUndefined()
    expect(draftOf({ ...d, reviews: [d.reviews[0]] })).toBeUndefined()
    expect(draftOf({ ...d, path: 7 })).toBeUndefined()
    expect(draftOf({ ...d, stage: 'done' })).toBeUndefined()
    expect(draftOf({ ...d, requirements: '3' })).toBeUndefined()
    expect(draftOf(null)).toBeUndefined()
    expect(draftOf({ ...d, reviews: [{ role: 'pm', done: 'yes' }, d.reviews[1]] })).toBeUndefined()
  })

  test('keeps a count of sendings only when it is one', () => {
    for (const sends of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, '2']) expect(draftOf({ ...sent(), sends })?.sends).toBeUndefined()
    expect(draftOf({ ...sent(), sends: 0 })?.sends).toBe(0)
  })
})

describe('a draft’s title, and the takeover the pane draws', () => {
  test('is its first heading, masked and cut, or its file name', () => {
    expect(titleIn('前言\n# 待辦清單 v2\n', 'docs/a.md')).toBe('待辦清單 v2')
    expect(titleIn('沒有標題', 'docs/crew/a-PRD.md')).toBe('a-PRD.md')
    expect(titleIn(`# ${'長'.repeat(80)}`, 'a.md').length).toBeLessThanOrEqual(61)
    expect(titleIn('# key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789', 'a.md')).not.toContain('abcdefghij')
  })

  test('shows the draft only while the brain has taken over, and waits only with no PRD under way', () => {
    const d = sent()
    expect(takeoverOf(true, null, d)).toEqual({ on: true, idle: true, draft: d })
    expect(takeoverOf(false, null, d)).toEqual({ on: false, idle: true })
    expect(takeoverOf(true, 'docs/PRD.md', undefined)).toEqual({ on: true, idle: false })
  })
})
