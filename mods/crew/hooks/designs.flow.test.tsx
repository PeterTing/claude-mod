import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { agentOf, command, done, paneText, PLAN, ROOT, SPLIT, start, world, write } from './world'

/** The UI/UX designer designs each feature; the person, and only the person, approves or sends a design back. */

const tested = async ($: Engine) => {
  await $.command.run(command('start docs/PRD.md'))
  await write($, 'a-pm-1', SPLIT)
  await done($, 'a-pm-1')
  await write($, 'a-qa-2', [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }])
  await done($, 'a-qa-2')
}

const DESIGNS = [
  { op: 'add_design', feature: 'PRD-001', title: '方案選擇頁', kind: 'screen', body: '版面：三張方案卡片，月繳預設選中。\n狀態：載入中、錯誤。' },
  { op: 'add_design', feature: 'PRD-002', title: '取消訂閱', kind: 'none', body: '在帳號頁既有的按鈕取消，沒有新畫面。' },
]

const crew = ($: Engine, input: Record<string, unknown>) => $.tool.call({ tool: 'mcp__crew__crew', tool_use_id: `c-${Math.random()}`, ...input } as never) as Promise<{ result: unknown }>

describe('designs', () => {
  test('are made for every feature once tested, shown to the person, and approved before the tech lead plans', async ($, on) => {
    const w = world($, on)
    await start($)
    await tested($)
    expect(w.spawned.at(-1)).toMatchObject({ subagentType: 'crew:uiux', model: 'sonnet' })
    expect(w.spawned.at(-1)?.prompt).toMatch(/2 個功能[\s\S]*PRD-001 方案選擇[\s\S]*PRD-002 取消訂閱/)
    expect(String((await write($, 'a-uiux-3', DESIGNS)).result)).toMatch(/已寫入：SCR-001、SCR-002/)
    await done($, 'a-uiux-3')
    const status = (await $.command.run(command('status'))).text
    expect(status).toMatch(/approving[\s\S]*待你決定 2/)
    expect(w.toasts.some(t => /設計稿 SCR-001 等你核准，在右側面板「待你決定」看內容、核准或退回/.test(t))).toBe(true)
    expect((await $.command.run(command('design SCR-001'))).text).toMatch(/^SCR-001 方案選擇頁（PRD-001 方案選擇，畫面）・等你核准\n\n版面：三張方案卡片/)
    expect(String((await crew($, { action: 'design', question: 'SCR-002' })).result)).toMatch(/SCR-002 取消訂閱（PRD-002 取消訂閱，沒有畫面）/)
    expect(await paneText($, 'progress')).toMatch(/→ 設計 0\/2/)
    expect(w.spawned.some(s => s.subagentType === 'crew:techlead')).toBe(false)
    expect((await $.command.run(command('approve SCR-001'))).text).toBe('已核准 SCR-001。')
    expect(w.spawned.some(s => s.subagentType === 'crew:techlead')).toBe(false)
    expect((await $.command.run(command('approve SCR-002'))).text).toBe('已核准 SCR-002。')
    expect(w.spawned.at(-1)).toMatchObject({ subagentType: 'crew:techlead' })
    expect(w.spawned.at(-1)?.prompt).toMatch(/核准的設計稿/)
    expect((await $.command.run(command('status'))).text).toMatch(/planning[\s\S]*待你決定 0/)
    expect(await paneText($, 'progress')).toMatch(/→ 設計 ✓/)
    // The full-stack builds with the approved design in hand.
    await write($, 'a-techlead-4', PLAN)
    await done($, 'a-techlead-4')
    expect(w.spawned.at(-1)?.prompt).toMatch(/使用者核准的設計稿：SCR-001 方案選擇頁（畫面）[\s\S]*board_read（feature: PRD-001）/)
  })

  test('are the person’s alone to approve or send back', async ($, on) => {
    const w = world($, on)
    await start($)
    await tested($)
    await write($, 'a-uiux-3', DESIGNS)
    await done($, 'a-uiux-3')
    // The brain's tool has no way to approve; an answer to the question is not an approval either.
    expect(String((await crew($, { action: 'approve', question: 'SCR-001' })).result)).toMatch(/action 要是/)
    expect(String((await crew($, { action: 'answer', question: 'Q-01', text: '核准' })).result)).toMatch(/SCR-001 是設計稿：請在右側面板核准，或寫原因退回/)
    expect((await $.command.run(command('answer Q-01 好'))).text).toMatch(/SCR-001 是設計稿：請在右側面板核准/)
    expect((await $.command.run(command('approve'))).text).toMatch(/用法：\/crew approve SCR-001/)
    expect((await $.command.run(command('approve SCR-009'))).text).toMatch(/找不到設計稿 SCR-009/)
    expect((await $.command.run(command('reject SCR-001'))).text).toMatch(/用法：\/crew reject SCR-001 <原因>/)
    expect((await $.command.run(command('status'))).text).toMatch(/approving[\s\S]*待你決定 2/)
    // A role cannot approve by writing the board: a decision crew never recorded is taken off.
    const board = JSON.parse(w.disk.get(`${ROOT}/prd-tracker.json`) ?? '{}') as { prd_items: { crew_designs?: Record<string, unknown>[] }[] }
    for (const d of board.prd_items.flatMap(i => i.crew_designs ?? [])) d.crew_decision = { verdict: 'approved' }
    w.disk.set(`${ROOT}/prd-tracker.json`, JSON.stringify(board))
    await w.clock.advance(31_000)
    expect(await paneText($, 'progress')).toMatch(/→ 設計 0\/2/)
    expect(w.spawned.some(s => s.subagentType === 'crew:techlead')).toBe(false)
  })

  test('sent back go to the designer with the reason, and the new one waits for the person', async ($, on) => {
    const w = world($, on)
    await start($)
    await tested($)
    await write($, 'a-uiux-3', DESIGNS)
    await done($, 'a-uiux-3')
    await $.command.run(command('approve SCR-002'))
    expect((await $.command.run(command('reject SCR-001 卡片太擠，要有比較表'))).text).toBe('已退回 SCR-001。')
    expect(w.sent.at(-1)).toMatchObject({ to: 'a-uiux-3' })
    expect(w.sent.at(-1)?.text).toMatch(/PRD-001 方案選擇（你的 SCR-001 被使用者退回，原因：卡片太擠，要有比較表）/)
    expect(w.disk.get(`${ROOT}/.crew/threads/SCR-001.jsonl`)).toMatch(/使用者退回：卡片太擠，要有比較表/)
    expect((await $.command.run(command('status'))).text).toMatch(/designing/)
    await write($, 'a-uiux-3', [{ op: 'add_design', feature: 'PRD-001', title: '方案比較表', kind: 'screen', body: '表格比較三個方案。' }])
    await done($, 'a-uiux-3')
    expect((await $.command.run(command('status'))).text).toMatch(/approving[\s\S]*待你決定 1/)
    expect(w.toasts.some(t => /設計稿 SCR-003 等你核准/.test(t))).toBe(true)
    await $.command.run(command('approve SCR-003'))
    expect(w.spawned.at(-1)).toMatchObject({ subagentType: 'crew:techlead' })
  })

  test('lose an approval once rewritten', async ($, on) => {
    const w = world($, on)
    await start($)
    await tested($)
    await write($, 'a-uiux-3', DESIGNS)
    await done($, 'a-uiux-3')
    await $.command.run(command('approve SCR-001 SCR-002'))
    expect(await paneText($, 'progress')).toMatch(/→ 設計 ✓/)
    const board = JSON.parse(w.disk.get(`${ROOT}/prd-tracker.json`) ?? '{}') as { prd_items: { crew_designs?: Record<string, unknown>[] }[] }
    const first = board.prd_items[0]?.crew_designs?.[0]
    if (first !== undefined) first.body = '改成兩張卡片'
    w.disk.set(`${ROOT}/prd-tracker.json`, JSON.stringify(board))
    await w.clock.advance(31_000)
    expect(await paneText($, 'progress')).toMatch(/→ 設計 1\/2/)
  })

  test('tell the brain that leads the work, without letting it approve', async ($, on) => {
    const w = world($, on)
    await start($)
    await crew($, { action: 'start', path: 'docs/PRD.md' })
    await write($, 'a-pm-1', SPLIT)
    await done($, 'a-pm-1')
    await write($, 'a-qa-2', [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }])
    await done($, 'a-qa-2')
    await write($, agentOf('uiux'), DESIGNS)
    await done($, agentOf('uiux'))
    await w.clock.advance(61_000)
    expect(w.prompts.at(-1)).toMatch(/設計稿 SCR-001 「方案選擇頁」等使用者核准。請使用者自己在右側面板核准或退回；不要替使用者核准/)
  })

  test('take an approval only from the person’s own typing: not another plugin, a peer, a channel or a relay', async ($, on) => {
    const w = world($, on)
    await start($)
    await tested($)
    await write($, 'a-uiux-3', DESIGNS)
    await done($, 'a-uiux-3')
    for (const kind of ['plugin', 'peer', 'channel', 'unclassified', 'scheduled-trigger', 'sdk']) {
      const r = await $.command.run({ ...command('approve SCR-001 SCR-002'), origin: { kind } } as never)
      expect((r as { text: string }).text).toMatch(/要使用者自己在右側面板核准或退回/)
    }
    expect((await $.command.run({ ...command('reject SCR-001 不要'), origin: { kind: 'peer' } } as never) as { text: string }).text).toMatch(/要使用者自己在右側面板核准或退回/)
    expect(w.spawned.some(s => s.subagentType === 'crew:techlead')).toBe(false)
    // The person's Remote Control client is the person.
    expect(((await $.command.run({ ...command('approve SCR-001 SCR-002'), origin: { kind: 'bridge' } } as never)) as { text: string }).text).toBe('已核准 SCR-001、SCR-002。')
    expect(w.spawned.at(-1)).toMatchObject({ subagentType: 'crew:techlead' })
  })

  test('count no approval a board brings, even on a new start', async ($, on) => {
    const w = world($, on)
    await start($)
    await tested($)
    await write($, 'a-uiux-3', DESIGNS)
    await done($, 'a-uiux-3')
    // The board in the repo says the designs were approved; crew never recorded it.
    const board = JSON.parse(w.disk.get(`${ROOT}/prd-tracker.json`) ?? '{}') as { prd_items: { crew_designs?: Record<string, unknown>[] }[] }
    for (const d of board.prd_items.flatMap(i => i.crew_designs ?? [])) d.crew_decision = { verdict: 'approved' }
    w.disk.set(`${ROOT}/prd-tracker.json`, JSON.stringify(board))
    await $.command.run(command('start docs/PRD.md'))
    expect(w.spawned.some(s => s.subagentType === 'crew:techlead')).toBe(false)
    expect((await $.command.run(command('status'))).text).toMatch(/approving[\s\S]*待你決定 2/)
  })
})
