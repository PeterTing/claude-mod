import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { agentOf, command, done, paneText, paneUi, PLAN, ROOT, SPLIT, start, textOf, world, write } from './world'

/** The UI/UX designer designs each feature; the person, and only the person, approves or sends a design back. */

const tested = async ($: Engine) => {
  await $.command.run(command('start docs/PRD.md'))
  await write($, 'a-pm-1', SPLIT)
  await done($, 'a-pm-1')
  await write($, 'a-qa-2', [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }])
  await done($, 'a-qa-2')
}

const DESIGNS = [
  { op: 'add_design', feature: 'PRD-001', title: '方案選擇頁', kind: 'screen', body: '版面：三張方案卡片，月繳預設選中。\n狀態：載入中、錯誤。', html: '<p>mockup</p>' },
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
    expect(w.toasts.some(t => /設計稿 SCR-001 等你核准，大腦更新待你決定頁後在「待你決定」按［開待你決定頁］/.test(t))).toBe(true)
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
    const board = JSON.parse(w.disk.get(`${ROOT}/.crew/prd-tracker.json`) ?? '{}') as { prd_items: { crew_designs?: Record<string, unknown>[] }[] }
    for (const d of board.prd_items.flatMap(i => i.crew_designs ?? [])) d.crew_decision = { verdict: 'approved' }
    w.disk.set(`${ROOT}/.crew/prd-tracker.json`, JSON.stringify(board))
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
    await write($, 'a-uiux-3', [{ op: 'add_design', feature: 'PRD-001', title: '方案比較表', kind: 'screen', body: '表格比較三個方案。', html: '<p>mockup</p>' }])
    await done($, 'a-uiux-3')
    expect((await $.command.run(command('status'))).text).toMatch(/approving[\s\S]*待你決定 1/)
    expect(w.toasts.some(t => /設計稿 SCR-003 等你核准/.test(t))).toBe(true)
    await $.command.run(command('approve SCR-003'))
    expect(w.spawned.at(-1)).toMatchObject({ subagentType: 'crew:techlead' })
  })

  test('stop waiting for the person once moved out, on the board or by hand', async ($, on) => {
    const w = world($, on)
    await start($)
    await tested($)
    await write($, 'a-uiux-3', DESIGNS)
    await done($, 'a-uiux-3')
    type Kept = { questions: { item?: string; status: string; answer?: string }[] }
    const kept = () => (w.store.get(`state:${ROOT}`) as Kept).questions
    const waiting = () => kept().filter(q => q.status === 'open').map(q => q.item)
    expect(waiting()).toEqual(['SCR-001', 'SCR-002'])
    await write($, 'a-uiux-3', [{ op: 'drop_design', id: 'SCR-001', reason: '外框不一致，重畫' }])
    expect(waiting()).toEqual(['SCR-002'])
    expect(kept().find(q => q.item === 'SCR-001')?.answer).toBe('設計稿已移出，不用核准：外框不一致，重畫')
    expect(await paneText($)).not.toMatch(/設計稿 SCR-001/)
    // Moved out by hand, or by a crew from before: the next look stops the wait too.
    const board = JSON.parse(w.disk.get(`${ROOT}/.crew/prd-tracker.json`) ?? '{}') as { prd_items: { id: string; crew_dropped?: string }[] }
    const feature = board.prd_items.find(i => i.id === 'PRD-002')
    if (feature !== undefined) feature.crew_dropped = '這次不做'
    w.disk.set(`${ROOT}/.crew/prd-tracker.json`, JSON.stringify(board))
    await w.clock.advance(5 * 60_000 + 1_000)
    expect(waiting()).toEqual([])
    expect(kept().find(q => q.item === 'SCR-002')?.answer).toBe('設計稿已移出，不用核准：這次不做')
  })

  test('go on once the last one waiting is moved out: a feature left with none goes back to the designer', async ($, on) => {
    const w = world($, on)
    await start($)
    await tested($)
    await write($, 'a-uiux-3', DESIGNS)
    await done($, 'a-uiux-3')
    await $.command.run(command('approve SCR-002'))
    const sent = w.sent.length
    await write($, 'a-uiux-3', [{ op: 'drop_design', id: 'SCR-001', reason: '外框不一致，重畫' }])
    expect((await $.command.run(command('status'))).text).toMatch(/designing/)
    expect(w.sent.slice(sent).some(m => m.to === 'a-uiux-3' && /PRD-001/.test(m.text))).toBe(true)
  })

  test('go on, on the clock, once a hand edit moves the last one out: with all approved the tech lead plans', async ($, on) => {
    const w = world($, on)
    await start($)
    await tested($)
    await write($, 'a-uiux-3', DESIGNS)
    await done($, 'a-uiux-3')
    await $.command.run(command('approve SCR-001'))
    const board = JSON.parse(w.disk.get(`${ROOT}/.crew/prd-tracker.json`) ?? '{}') as { prd_items: { id: string; crew_dropped?: string }[] }
    const feature = board.prd_items.find(i => i.id === 'PRD-002')
    if (feature !== undefined) feature.crew_dropped = '這次不做'
    w.disk.set(`${ROOT}/.crew/prd-tracker.json`, JSON.stringify(board))
    await w.clock.advance(31_000)
    // On the clock, the tech lead starts in the conversation's next frame: the flow has gone on to planning.
    expect((await $.command.run(command('status'))).text).toMatch(/planning/)
  })

  test('go on only from the decisions the person made, not from one written on the board', async ($, on) => {
    const w = world($, on)
    await start($)
    await tested($)
    await write($, 'a-uiux-3', DESIGNS)
    await done($, 'a-uiux-3')
    const board = JSON.parse(w.disk.get(`${ROOT}/.crew/prd-tracker.json`) ?? '{}') as { prd_items: { crew_designs?: Record<string, unknown>[] }[] }
    for (const d of board.prd_items.flatMap(i => i.crew_designs ?? [])) d.crew_decision = { verdict: 'approved' }
    w.disk.set(`${ROOT}/.crew/prd-tracker.json`, JSON.stringify(board))
    await write($, 'a-qa-2', [{ op: 'add_test_case', criteria: ['AC-001'], title: 't2', steps: ['s'], expected: 'e' }])
    await w.clock.advance(31_000)
    expect((await $.command.run(command('status'))).text).toMatch(/approving[\s\S]*待你決定 2/)
    expect(w.spawned.some(s => s.subagentType === 'crew:techlead')).toBe(false)
  })

  test('wait to be told after a restart, when the last one waiting was moved out while Claude Code was off', async ($, on) => {
    const w = world($, on)
    await start($)
    await tested($)
    await write($, 'a-uiux-3', DESIGNS)
    await done($, 'a-uiux-3')
    await $.command.run(command('approve SCR-001'))
    const board = JSON.parse(w.disk.get(`${ROOT}/.crew/prd-tracker.json`) ?? '{}') as { prd_items: { id: string; crew_dropped?: string }[] }
    const feature = board.prd_items.find(i => i.id === 'PRD-002')
    if (feature !== undefined) feature.crew_dropped = '這次不做'
    w.disk.set(`${ROOT}/.crew/prd-tracker.json`, JSON.stringify(board))
    await start($)
    expect(await paneText($)).toMatch(/要接續嗎/)
    await w.clock.advance(31_000)
    // Nothing runs, and nothing is spent, until the person goes on.
    expect((await $.command.run(command('status'))).text).toMatch(/approving/)
    expect(w.spawned.some(s => s.subagentType === 'crew:techlead')).toBe(false)
    await $.command.run(command('resume'))
    expect(w.spawned.at(-1)).toMatchObject({ subagentType: 'crew:techlead' })
  })

  test('ask about a design drawn again while the person was deciding', async ($, on) => {
    const w = world($, on)
    await start($)
    await tested($)
    await write($, 'a-uiux-3', DESIGNS)
    await done($, 'a-uiux-3')
    await $.command.run(command('approve SCR-002'))
    await write($, 'a-uiux-3', [
      { op: 'add_design', feature: 'PRD-001', title: '方案比較表', kind: 'screen', body: '表格比較三個方案。', html: '<p>v2</p>' },
      { op: 'drop_design', id: 'SCR-001', reason: '改成比較表' },
    ])
    type Kept = { questions: { item?: string; status: string }[] }
    expect((w.store.get(`state:${ROOT}`) as Kept).questions.filter(q => q.status === 'open').map(q => q.item)).toEqual(['SCR-003'])
    expect(w.toasts.some(t => /設計稿 SCR-003 等你核准/.test(t))).toBe(true)
    await $.command.run(command('approve SCR-003'))
    expect(w.spawned.at(-1)).toMatchObject({ subagentType: 'crew:techlead' })
  })

  test('keep waiting while the board is another checkout\'s, and find the questions where they were on the way back', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    await done($, 'a-pm-1')
    await write($, 'a-qa-2', [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }])
    const older = w.disk.get(`${ROOT}/.crew/prd-tracker.json`) ?? ''
    await done($, 'a-qa-2')
    await write($, 'a-uiux-3', DESIGNS)
    await done($, 'a-uiux-3')
    const current = w.disk.get(`${ROOT}/.crew/prd-tracker.json`) ?? ''
    const spawned = w.spawned.length
    type Kept = { questions: { item?: string; status: string }[] }
    const waiting = () => (w.store.get(`state:${ROOT}`) as Kept).questions.filter(q => q.status === 'open').map(q => q.item)
    // A branch whose board is from before the designs, or the board's changes stashed.
    w.disk.set(`${ROOT}/.crew/prd-tracker.json`, older)
    await w.clock.advance(61_000)
    expect(waiting()).toEqual(['SCR-001', 'SCR-002'])
    expect((await $.command.run(command('status'))).text).toMatch(/approving/)
    expect(w.spawned.length).toBe(spawned)
    w.disk.set(`${ROOT}/.crew/prd-tracker.json`, current)
    await w.clock.advance(61_000)
    expect(waiting()).toEqual(['SCR-001', 'SCR-002'])
    expect((await $.command.run(command('status'))).text).toMatch(/approving[\s\S]*待你決定 2/)
  })

  test('let the person close the question of a design gone from the board, and go on', async ($, on) => {
    const w = world($, on)
    await start($)
    await tested($)
    await write($, 'a-uiux-3', DESIGNS)
    await done($, 'a-uiux-3')
    await $.command.run(command('approve SCR-002'))
    // Taken off the board by hand, not moved out: crew cannot tell it from another checkout's board, so it keeps waiting.
    const board = JSON.parse(w.disk.get(`${ROOT}/.crew/prd-tracker.json`) ?? '{}') as { prd_items: { id: string; crew_designs?: { id: string }[] }[] }
    const feature = board.prd_items.find(i => i.id === 'PRD-001')
    if (feature !== undefined) feature.crew_designs = (feature.crew_designs ?? []).filter(d => d.id !== 'SCR-001')
    w.disk.set(`${ROOT}/.crew/prd-tracker.json`, JSON.stringify(board))
    await w.clock.advance(61_000)
    type Kept = { questions: { item?: string; status: string; answer?: string }[] }
    const kept = () => (w.store.get(`state:${ROOT}`) as Kept).questions
    expect(kept().filter(q => q.status === 'open').map(q => q.item)).toEqual(['SCR-001'])
    const sent = w.sent.length
    expect(await paneText($)).toMatch(/設計稿 SCR-001 不在目前的看板上（可能切了分支，或看板被改過）/)
    expect((await $.command.run(command('approve SCR-001'))).text).toMatch(/SCR-001 不在目前的看板上，這題關掉了；沒有設計稿的功能會交給 UI\/UX 重畫/)
    expect(kept().find(q => q.item === 'SCR-001')).toMatchObject({ status: 'answered', answer: '設計稿不在目前的看板上，使用者關掉了這題。' })
    // PRD-001 is left with no design: it goes back to the designer.
    expect((await $.command.run(command('status'))).text).toMatch(/designing/)
    expect(w.sent.slice(sent).some(m => m.to === 'a-uiux-3' && /PRD-001/.test(m.text))).toBe(true)
    // A design never asked about is still not found.
    expect((await $.command.run(command('approve SCR-009'))).text).toMatch(/找不到設計稿 SCR-009（或它已經移出）/)
  })

  test('keep a design gone from the board out of the decide page row, where the person can close it', async ($, on) => {
    const w = world($, on)
    await start($)
    await tested($)
    await write($, 'a-uiux-3', DESIGNS)
    await done($, 'a-uiux-3')
    await crew($, { action: 'published', text: 'https://claude.ai/artifact/abc123', path: 'docs/PRD.md' })
    const board = JSON.parse(w.disk.get(`${ROOT}/.crew/prd-tracker.json`) ?? '{}') as { prd_items: { id: string; crew_designs?: { id: string }[] }[] }
    const feature = board.prd_items.find(i => i.id === 'PRD-001')
    if (feature !== undefined) feature.crew_designs = (feature.crew_designs ?? []).filter(d => d.id !== 'SCR-001')
    w.disk.set(`${ROOT}/.crew/prd-tracker.json`, JSON.stringify(board))
    await w.clock.advance(11_000)
    const ui = await paneUi($)
    const text = await textOf(ui)
    // The page row counts only what the page shows; the gone one is a row of its own.
    expect(text).toMatch(/待你決定頁：設計稿 1 份等你核准/)
    expect(text).toMatch(/設計稿 SCR-001 不在目前的看板上/)
    type Kept = { questions: { id: string; item?: string; status: string }[] }
    const q = (w.store.get(`state:${ROOT}`) as Kept).questions.find(x => x.item === 'SCR-001')
    await ui.press({ key: `approve-${q?.id}` })
    await ui.unmount()
    expect((w.store.get(`state:${ROOT}`) as Kept).questions.find(x => x.item === 'SCR-001')?.status).toBe('answered')
    expect(w.toasts.some(t => /SCR-001 不在目前的看板上，這題關掉了/.test(t))).toBe(true)
  })

  test('send a mockup back, unmasked and unwritten, when it looks like it holds a secret', async ($, on) => {
    const w = world($, on)
    await start($)
    await tested($)
    const screen = (html: string) => ({ op: 'add_design', feature: 'PRD-001', title: '方案選擇頁', kind: 'screen', body: '版面：三張方案卡片。', html })
    // Code the mask would break: sent back, not mangled.
    const code = String((await write($, 'a-uiux-3', [screen('<button id="b">比較</button><script>let compareSeq = 0; b.onclick = () => { const token=++compareSeq; }</script>'), DESIGNS[1]])).result)
    expect(code).toMatch(/board_write 沒有生效：mockup 裡有看起來像密鑰的寫法/)
    expect(code).toMatch(/add_design PRD-001：…[\s\S]*const token=\[已遮罩\]/)
    expect(w.disk.get(`${ROOT}/.crew/designs/docs-PRD/SCR-001.json`)).toBeUndefined()
    // A secret in the page's words: sent back without the value.
    const text = String((await write($, 'a-uiux-3', [screen('<p>測試帳號密碼：!QAZ2wsx</p>')])).result)
    expect(text).toMatch(/共 1 處[\s\S]*測試帳號密碼：\[已遮罩\]/)
    expect(text).not.toMatch(/QAZ2wsx/)
    // A mask the page already had is not listed as the secret.
    const had = String((await write($, 'a-uiux-3', [screen('<p>範例：密碼：[已遮罩]</p><p>測試帳號密碼：!QAZ2wsx</p>')])).result)
    expect(had).toMatch(/共 1 處/)
    expect(had.match(/^- add_design.*$/gm)).toEqual([expect.stringMatching(/測試帳號密碼：\[已遮罩\]$/)])
    // A secret next to a mask the page had is sent back too, not masked quietly.
    const next = String((await write($, 'a-uiux-3', [screen('<pre>{"password":"[已遮罩]Hunter2024"}</pre>')])).result)
    expect(next).toMatch(/board_write 沒有生效[\s\S]*共 1 處/)
    expect(next).not.toMatch(/Hunter2024/)
    // Cards alike: the one with the secret is the one counted and listed.
    const card = (v: string) => `<div class="card"><p>帳號：demo</p><p>密碼：${v}</p></div>`
    const cards = String((await write($, 'a-uiux-3', [screen(card('abc') + card('[已遮罩]') + card('Hunter2024!'))])).result)
    expect(cards).toMatch(/共 1 處，用/)
    expect(cards.match(/^- add_design.*$/gm)).toHaveLength(1)
    expect(JSON.stringify(JSON.parse(w.disk.get(`${ROOT}/.crew/prd-tracker.json`) ?? '{}'))).not.toMatch(/SCR-001/)
    // Rewritten, it is written as it stands.
    const html = '<button id="b">比較</button><p>密碼：********</p><script>let compareSeq = 0; b.onclick = () => { const seq=++compareSeq; }</script>'
    expect(String((await write($, 'a-uiux-3', [screen(html), DESIGNS[1]])).result)).toMatch(/已寫入：SCR-001、SCR-002/)
    expect((JSON.parse(w.disk.get(`${ROOT}/.crew/designs/docs-PRD/SCR-001.json`) ?? '{}') as { html?: string }).html).toBe(html)
  })

  test('lose an approval once rewritten', async ($, on) => {
    const w = world($, on)
    await start($)
    await tested($)
    await write($, 'a-uiux-3', DESIGNS)
    await done($, 'a-uiux-3')
    await $.command.run(command('approve SCR-001 SCR-002'))
    expect(await paneText($, 'progress')).toMatch(/→ 設計 ✓/)
    const board = JSON.parse(w.disk.get(`${ROOT}/.crew/prd-tracker.json`) ?? '{}') as { prd_items: { crew_designs?: Record<string, unknown>[] }[] }
    const first = board.prd_items[0]?.crew_designs?.[0]
    if (first !== undefined) first.body = '改成兩張卡片'
    w.disk.set(`${ROOT}/.crew/prd-tracker.json`, JSON.stringify(board))
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
    expect(w.prompts.at(-1)).toMatch(/待你決定頁要發佈給使用者看（2 份設計稿等使用者核准）[\s\S]*不要替使用者決定/)
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
    const board = JSON.parse(w.disk.get(`${ROOT}/.crew/prd-tracker.json`) ?? '{}') as { prd_items: { crew_designs?: Record<string, unknown>[] }[] }
    for (const d of board.prd_items.flatMap(i => i.crew_designs ?? [])) d.crew_decision = { verdict: 'approved' }
    w.disk.set(`${ROOT}/.crew/prd-tracker.json`, JSON.stringify(board))
    await $.command.run(command('start docs/PRD.md'))
    expect(w.spawned.some(s => s.subagentType === 'crew:techlead')).toBe(false)
    expect((await $.command.run(command('status'))).text).toMatch(/approving[\s\S]*待你決定 2/)
  })
})
