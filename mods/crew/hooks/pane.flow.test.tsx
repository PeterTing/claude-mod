import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { applyOps, DEFAULT_PREFIXES, newTracker } from './board'
import type { Op } from './board'
import { approve, build, designed, done, paneUi, PLAN, ROOT, SPLIT, start, textOf, tested, world, write } from './world'

/** crew run from its pane alone: no command typed. */

const planned = async ($: Engine) => {
  const ui = await paneUi($)
  await ui.press({ key: 'start' })
  await ui.unmount()
  await write($, 'a-pm-1', SPLIT)
  await done($, 'a-pm-1')
  await write($, 'a-qa-2', [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }])
  await done($, 'a-qa-2')
  await designed($)
  await write($, 'a-techlead-4', PLAN)
  await done($, 'a-techlead-4')
}

describe('crew from its pane', () => {
  test('opens when Claude Code starts, offers the PRDs in the repo, and starts the one picked', async ($, on) => {
    const w = world($, on)
    w.disk.set(`${ROOT}/docs/specs/checkout.md`, '# 結帳流程\n\n- 可以用信用卡付款')
    w.disk.set(`${ROOT}/README.md`, '# repo')
    // A hidden folder's file is no PRD to offer, and nothing it holds is read.
    w.disk.set(`${ROOT}/docs/.private/plan.md`, '# 內部計畫')
    await start($)
    expect(w.panes).toContain('open:crew')
    const ui = await paneUi($)
    expect(await textOf(ui)).toMatch(/crew 已載入，還沒有開始的 PRD/)
    const pick = (await ui.find({ key: 'prd-pick' })) as unknown as { props: { value: string; options: { value: string; label: string }[] } }
    // PRDs first, then the other documents; a README is no PRD.
    expect(pick.props.options.map(o => o.value)).toEqual(['docs/PRD.md', 'docs/specs/checkout.md'])
    expect(w.reads.get(`${ROOT}/docs/.private/plan.md`) ?? 0).toBe(0)
    expect(pick.props.options[0]?.label).toMatch(/docs\/PRD\.md　會員訂閱/)
    await ui.select({ key: 'prd-pick', value: 'docs/specs/checkout.md' })
    await ui.press({ key: 'start' })
    expect(w.spawned.at(-1)).toMatchObject({ subagentType: 'crew:pm' })
    expect(w.spawned.at(-1)?.prompt).toMatch(/docs\/specs\/checkout\.md/)
    await ui.unmount()
  })

  test('a control whose work fails says so, as crew’s own answer to the press', async ($, on) => {
    const w = world($, on)
    await start($)
    const ui = await paneUi($)
    await ui.press({ key: 'tab-settings' })
    w.broken.store = 'settings:'
    await ui.press({ key: 'tuning-auto' })
    expect(w.toasts.at(-1)).toMatch(/crew：沒有完成：.*ENOSPC/)
    expect(w.toasts.join('\n')).not.toMatch(/沒有接上|還在處理/)
    await ui.unmount()
  })

  test('starts a PRD typed in the field', async ($, on) => {
    const w = world($, on)
    await start($)
    const ui = await paneUi($)
    await ui.input({ key: 'prd-path', text: 'docs/PRD.md' })
    expect(w.spawned.at(-1)).toMatchObject({ subagentType: 'crew:pm' })
    await ui.unmount()
  })

  test('closes for the session when the person says not now, and stays closed on load once set so', async ($, on) => {
    const w = world($, on)
    await start($)
    let ui = await paneUi($)
    await ui.press({ key: 'not-now' })
    expect(w.panes.at(-1)).toBe('close:crew')
    expect(w.spawned).toEqual([])
    await ui.unmount()
    // On the settings tab: not on load. The next start opens nothing.
    ui = await paneUi($)
    await ui.press({ key: 'tab-settings' })
    await ui.press({ key: 'not-on-load' })
    await ui.unmount()
    const before = w.panes.length
    await start($)
    expect(w.panes.slice(before)).toEqual([])
  })

  test('offers to go on with an unfinished PRD when Claude Code starts, and goes on only when asked', async ($, on) => {
    const w = world($, on)
    // The last session left the full-stack building TASK-001: the board and crew's record say so.
    let t = newTracker('repo')
    for (const [by, ops] of [
      ['pm', SPLIT],
      ['qa', [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }]],
      ['techlead', PLAN],
    ] as const) {
      const r = applyOps(t, ops as unknown as Op[], { by, today: '2026-10-15', prefixes: DEFAULT_PREFIXES })
      if (!r.ok) throw new Error(r.errors.join())
      t = r.tracker
    }
    w.disk.set(`${ROOT}/prd-tracker.json`, JSON.stringify(t))
    w.store.set(`state:${ROOT}`, { prdPath: 'docs/PRD.md', flow: { stage: 'building', round: 0, retries: 0, building: 'TASK-001' }, questions: [], lead: 'person' })
    await start($)
    // Nothing starts, and nothing is spent, before the person says so.
    expect(w.spawned).toEqual([])
    const ui = await paneUi($)
    expect(await textOf(ui)).toMatch(/上次的 docs\/PRD\.md 停在「實作」（全端 TASK-001）。要接續嗎？/)
    await ui.press({ key: 'not-now' })
    expect(w.spawned).toEqual([])
    expect(await textOf(ui)).toMatch(/停在「實作」（全端 TASK-001），暫停中。/)
    // The person holds it: the brain cannot go on for them.
    const r = (await $.tool.call({ tool: 'mcp__crew__crew', tool_use_id: 'go', action: 'resume' } as never)) as { result: unknown }
    expect(String(r.result)).toMatch(/流程暫停中：要使用者自己在右側面板按［接續］/)
    // Nor ask a role: nothing is spent before the person says so.
    const asked = (await $.tool.call({ tool: 'mcp__crew__crew', tool_use_id: 'ask', action: 'ask', role: 'pm', text: '進度如何？' } as never)) as { result: unknown }
    expect(String(asked.result)).toMatch(/流程暫停中/)
    expect(w.spawned).toEqual([])
    expect(await ui.find({ key: 'not-now' })).toBeUndefined()
    await ui.press({ key: 'resume' })
    expect(w.spawned.map(s => s.subagentType)).toEqual(['crew:fullstack'])
    expect(await textOf(ui)).not.toMatch(/暫停中|要接續嗎/)
    await ui.unmount()
  })

  test('keeps a held flow held when the brain relays an answer: the person answers in the pane, and that goes on', async ($, on) => {
    const w = world($, on)
    let t = newTracker('repo')
    for (const [by, ops] of [
      ['pm', SPLIT],
      ['qa', [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }]],
      ['techlead', PLAN],
    ] as const) {
      const r = applyOps(t, ops as unknown as Op[], { by, today: '2026-10-15', prefixes: DEFAULT_PREFIXES })
      if (!r.ok) throw new Error(r.errors.join())
      t = r.tracker
    }
    w.disk.set(`${ROOT}/prd-tracker.json`, JSON.stringify(t))
    const question = { id: 'Q-01', question: '金額上限多少？', from: 'fullstack', status: 'open', t: 0 }
    w.store.set(`state:${ROOT}`, { prdPath: 'docs/PRD.md', flow: { stage: 'building', round: 0, retries: 0, building: 'TASK-001' }, questions: [question], lead: 'person' })
    await start($)
    const r = (await $.tool.call({ tool: 'mcp__crew__crew', tool_use_id: 'a', action: 'answer', question: 'Q-01', text: '一萬' } as never)) as { result: unknown }
    expect(String(r.result)).toMatch(/流程暫停中/)
    expect(w.spawned).toEqual([])
    const ui = await paneUi($)
    expect(await textOf(ui)).toMatch(/要接續嗎/)
    await ui.input({ key: 'answer-Q-01', text: '一萬' })
    expect(w.spawned.map(s => s.subagentType)).toEqual(['crew:fullstack'])
    await ui.unmount()
  })

  test('answers a role’s question, and approves or sends back a design, in the pane', async ($, on) => {
    const w = world($, on)
    await start($)
    let ui = await paneUi($)
    await ui.press({ key: 'start' })
    await ui.unmount()
    await write($, 'a-pm-1', SPLIT)
    await $.tool.call({ tool: 'mcp__crew__ask_person', tool_use_id: 'q', agentId: 'a-pm-1', question: '年繳要做嗎？' } as never)
    await done($, 'a-pm-1')
    ui = await paneUi($)
    await ui.input({ key: 'answer-Q-01', text: '第一版先不做' })
    expect(w.sent.some(m => m.to === 'a-pm-1' && /第一版先不做/.test(m.text))).toBe(true)
    await ui.unmount()
    await write($, 'a-qa-2', [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }])
    await done($, 'a-qa-2')
    // The designer's designs wait for the person: read, approve one, send the other back with a reason.
    await write($, 'a-uiux-3', [
      { op: 'add_design', feature: 'PRD-001', title: '方案頁', kind: 'screen', body: '三張方案卡片' },
      { op: 'add_design', feature: 'PRD-002', title: '取消頁', kind: 'none', body: '後台處理' },
    ])
    await done($, 'a-uiux-3')
    ui = await paneUi($)
    const text = await textOf(ui)
    const asks = [...text.matchAll(/(Q-\d+) 設計稿 (SCR-\d+)/g)].map(m => [m[1], m[2]])
    expect(asks.map(a => a[1])).toEqual(['SCR-001', 'SCR-002'])
    await ui.press({ key: 'view-SCR-001' })
    expect(await textOf(ui)).toMatch(/三張方案卡片/)
    await ui.press({ key: `approve-${asks[0]?.[0]}` })
    await ui.input({ key: `reject-${asks[1]?.[0]}`, text: '要有確認步驟' })
    await ui.unmount()
    const board = JSON.parse(w.disk.get(`${ROOT}/prd-tracker.json`) ?? '{}') as { prd_items: { crew_designs?: { id: string; crew_decision?: { verdict: string; reason?: string } }[] }[] }
    expect(board.prd_items.flatMap(i => i.crew_designs ?? []).map(d => [d.id, d.crew_decision?.verdict, d.crew_decision?.reason])).toEqual([
      ['SCR-001', 'approved', undefined],
      ['SCR-002', 'rejected', '要有確認步驟'],
    ])
  })

  test('asks a role and rotates it from its row', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    const ui = await paneUi($)
    await ui.press({ key: 'ask-pm' })
    await ui.input({ key: 'ask-pm-text', text: '年繳什麼時候做？' })
    expect(w.sent.some(m => /年繳什麼時候做？/.test(m.text)) || w.spawned.some(s => /年繳什麼時候做？/.test(s.prompt))).toBe(true)
    await ui.press({ key: 'rotate-qa' })
    expect(w.toasts.some(t => /QA/.test(t) && /輪替|重開/.test(t))).toBe(true)
    await ui.unmount()
  })

  test('sets the test command and runs the tests on the settings tab, and resets only once confirmed', async ($, on) => {
    const w = world($, on)
    w.store.delete(`tests:${ROOT}`)
    await start($)
    await planned($)
    await build($)
    expect(w.tests.runs).toEqual([])
    const ui = await paneUi($)
    await ui.press({ key: 'tab-settings' })
    await ui.input({ key: 'test-command', text: 'python3 -m pytest -v' })
    await tested()
    expect(w.tests.runs.map(r => r.argv)).toEqual([['python3', '-m', 'pytest', '-v']])
    await ui.press({ key: 'run-tests' })
    await tested()
    expect(w.tests.runs).toHaveLength(2)
    await ui.press({ key: 'reset' })
    expect(w.store.get(`state:${ROOT}`)).toMatchObject({ prdPath: 'docs/PRD.md' })
    await ui.press({ key: 'reset-confirm' })
    expect((w.store.get(`state:${ROOT}`) as { prdPath?: unknown } | undefined)?.prdPath ?? null).toBeNull()
    await ui.unmount()
  })

  test('searches memory and saves a preference on the memory tab', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await $.tool.call({ tool: 'mcp__crew__memory_save', tool_use_id: 'm', agentId: 'a-techlead-4', type: 'MEM', text: '金流用 Stripe Billing' } as never)
    const ui = await paneUi($)
    await ui.press({ key: 'tab-memory' })
    await ui.input({ key: 'recall', text: '金流' })
    expect(await textOf(ui)).toMatch(/找到[\s\S]*金流用 Stripe Billing/)
    await ui.input({ key: 'remember', text: '文案用台灣用語' })
    expect(w.disk.get(`${ROOT}/.crew/memory/memories.jsonl`)).toMatch(/文案用台灣用語/)
    await ui.unmount()
  })

  test('tells the person what to do in the pane, never a command to type', async ($, on) => {
    const w = world($, on)
    w.store.delete(`tests:${ROOT}`)
    await start($)
    await planned($)
    await build($)
    await approve($, 'TASK-001')
    const told = [...w.toasts, ...w.shown].filter(t => /\/crew /.test(t))
    expect(told).toEqual([])
    const ui = await paneUi($)
    for (const tab of ['overview', 'progress', 'board', 'threads', 'memory', 'tokens', 'settings']) {
      await ui.press({ key: `tab-${tab}` })
      expect(await textOf(ui)).not.toMatch(/\/crew/)
    }
    await ui.unmount()
  })
})
