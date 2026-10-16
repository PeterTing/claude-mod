import type { RenderPropsOf } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { applyOps, newTracker } from './board'
import { requirementsOf } from './prd'
import { command, done, paneText, PRD, REQ, ROOT, SPLIT, start, world, write } from './world'

/** The board held to the PRD as it stands, checked every few seconds without a model call. */

const PRD_PATH = `${ROOT}/docs/PRD.md`
const ADDED = '使用者可以改成年繳方案。'
const CHANGED = `${PRD}\n\n${ADDED}`
const NEW_REQ = requirementsOf(CHANGED).find(r => r.text === ADDED)?.id ?? ''

const notice = async ($: Engine, agentId: string) =>
  (await $.prompt.submit({ text: `<task-notification><task-id>${agentId}</task-id></task-notification>`, wait: false, origin: { kind: 'task-notification' } } as never)) as {
    text?: string
    drop?: string
  }

/** A finished first pass: split, every criterion with a test case. */
const finished = async ($: Engine) => {
  await $.command.run(command('start docs/PRD.md'))
  await write($, 'a-pm-1', SPLIT)
  await done($, 'a-pm-1')
  await write($, 'a-qa-2', [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }])
  await done($, 'a-qa-2')
}

describe('the board held to the PRD', () => {
  test('starts the PM with the PRD’s requirements and keeps them on the board', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    expect(w.spawned[0]?.prompt).toMatch(new RegExp(`${REQ}`))
    expect((w.board() as { crew_prd?: { requirements: { id: string }[] } } | null)?.crew_prd?.requirements.map(r => r.id)).toEqual([REQ])
  })

  test('says when crew last looked from the moment a PRD starts', async ($, on) => {
    world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    expect(await paneText($)).toMatch(/對準 PRD 0\/1 ⚠[^\n]*即時檢查 剛剛/)
  })

  test('keeps the PM on the split until every requirement has a feature', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', [
      { op: 'add_feature', title: '方案選擇', summary: '' },
      { op: 'add_criterion', feature: 'PRD-001', text: '可以選月繳方案' },
    ])
    await done($, 'a-pm-1')
    expect(w.spawned.map(s => s.subagentType)).toEqual(['crew:pm'])
    expect(w.sent.at(-1)?.text).toMatch(/看板還對不上 PRD[\s\S]*功能沒有對應的 PRD 需求：方案選擇/)
  })

  test('sees the PRD change within seconds, sends the PM to sync, and QA tests only what is new', async ($, on) => {
    const w = world($, on)
    await start($)
    await finished($)
    expect((await $.command.run(command('status'))).text).toMatch(/done/)
    w.disk.set(PRD_PATH, CHANGED)
    await w.clock.advance(10_000)
    expect(w.toasts.some(t => /PRD 改了（新增 1、移除 0 條需求）/.test(t))).toBe(true)
    expect(w.sent.at(-1)?.to).toBe('a-pm-1')
    expect(w.sent.at(-1)?.text).toMatch(new RegExp(`PRD 改了[\\s\\S]*${NEW_REQ}[\\s\\S]*改成年繳`))
    expect((await $.command.run(command('status'))).text).toMatch(/splitting[\s\S]*PRD 對不上 1/)
    // Later looks at the same PRD send the PM nothing more, and say nothing more.
    const sent = w.sent.length
    const toasts = w.toasts.length
    await w.clock.advance(31_000)
    expect(w.sent).toHaveLength(sent)
    expect(w.toasts).toHaveLength(toasts)

    await write($, 'a-pm-1', [
      { op: 'add_criterion', feature: 'PRD-001', text: '可以改成年繳' },
      { op: 'link_requirements', feature: 'PRD-001', requirements: [NEW_REQ] },
    ])
    await done($, 'a-pm-1')
    expect(w.sent.at(-1)?.to).toBe('a-qa-2')
    expect(w.sent.at(-1)?.text).toMatch(/AC-003 可以改成年繳/)
    expect(w.sent.at(-1)?.text).not.toMatch(/AC-001|AC-002/)
    expect((w.board() as { crew_prd?: { requirements: { id: string }[] } } | null)?.crew_prd?.requirements.map(r => r.id)).toEqual([REQ, NEW_REQ])
    expect((await $.command.run(command('status'))).text).toMatch(/對準 PRD ✓/)
  })

  test('picks up a PRD changed while Claude Code was closed', async ($, on) => {
    const w = world($, on)
    await start($)
    await finished($)
    // The PRD is edited while Claude Code is closed; the next session start looks at it first thing.
    w.disk.set(PRD_PATH, CHANGED)
    await start($)
    expect(w.sent.at(-1)?.to).toBe('a-pm-1')
    expect(w.sent.at(-1)?.text).toMatch(/PRD 改了/)
  })

  test('tells the brain when the work it leads meets a changed PRD', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.tool.call({ tool: 'mcp__crew__crew', tool_use_id: 'c', action: 'start', path: 'docs/PRD.md' } as never)
    await write($, 'a-pm-1', SPLIT)
    await done($, 'a-pm-1')
    await write($, 'a-qa-2', [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }])
    await done($, 'a-qa-2')
    expect((await notice($, 'a-qa-2')).text).toMatch(/完成/)
    w.disk.set(PRD_PATH, CHANGED)
    await w.clock.advance(11_000)
    await w.clock.advance(61_000)
    expect(w.prompts.at(-1)).toMatch(/PRD 改了/)
  })

  test('lists each PRD requirement with how far each stage is, and marks the stages not tracked yet', async ($, on) => {
    world($, on)
    await start($)
    await finished($)
    const text = await paneText($, 'progress')
    expect(text).toMatch(/PRD 需求[\s\S]*\n規格\n設計\n測試案例\n任務\n實作\nReview\n測試結果\n/)
    // Spec and test cases come from the board; the rest are not tracked yet, and never shown as done.
    expect(text).toMatch(new RegExp(`${REQ}\\n[^\\n]*\\n✓\\n—\\n✓ 2/2\\n—\\n—\\n—\\n—\\n`))
  })

  test('shows how the board stands against the PRD, and when crew last looked', async ($, on) => {
    const w = world($, on)
    await start($)
    await finished($)
    await w.clock.advance(11_000)
    const text = await paneText($)
    expect(text).toMatch(/對準 PRD 3\/3 ✓/)
    expect(text).toMatch(/即時檢查 剛剛/)
    w.disk.set(PRD_PATH, CHANGED)
    await w.clock.advance(11_000)
    const after = await paneText($)
    expect(after).toMatch(/對準 PRD 3\/4 ⚠ PRD 改了：新增 1、移除 0/)
    const ui = await $.ui.mount({
      plugin: 'crew',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'crew',
      props: { title: 'Crew', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 80 } } as unknown as RenderPropsOf['Pane'],
    })
    await ui.press({ key: 'gate-G0' })
    const g0 = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
    expect(g0).toMatch(/PRD 每條需求都有對應的功能/)
    expect(g0).toMatch(/3\/4/)
    expect(g0).toMatch(/PRD 需求沒有對應的功能：使用者可以改成年繳方案/)
    await ui.unmount()
    const band = await $.ui.mount({
      plugin: 'crew',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 2, bodyColumns: 160 } as unknown as RenderPropsOf['AbovePrompt'],
    })
    expect((await band.findAll({ type: 'Text' })).map(t => t.text).join('')).toMatch(/⚠ PRD 對不上 1/)
  })

  test('keeps the time it last looked fresh past a minute, and says when the PRD file changed', async ($, on) => {
    const w = world($, on)
    await start($)
    await finished($)
    await w.clock.advance(125_000)
    const text = await paneText($)
    expect(text).toMatch(/PRD 更新於 2 分鐘前/)
    expect(text).toMatch(/即時檢查 剛剛/)
  })

  test('goes on when the PRD is deleted, with the requirements last read, and says it cannot read the PRD', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    w.disk.delete(PRD_PATH)
    await done($, 'a-pm-1')
    expect(w.spawned.map(s => s.subagentType)).toEqual(['crew:pm', 'crew:qa'])
    expect((await $.command.run(command('status'))).text).toMatch(/讀不到 PRD/)
    expect(await paneText($)).toMatch(/讀不到 PRD：找不到 docs\/PRD\.md/)
    await w.clock.advance(10_000)
    expect(w.toasts.filter(t => /讀不到 PRD/.test(t))).toHaveLength(1)
  })

  test('does not read a PRD swapped for a link out of the repo, nor send or keep its text', async ($, on) => {
    const w = world($, on)
    await start($)
    await finished($)
    w.disk.set('/outside/secret.md', '- //registry.npmjs.org/:_authToken=npm_SECRETSECRETSECRET')
    w.disk.delete(PRD_PATH)
    w.links.set(PRD_PATH, '/outside/secret.md')
    await w.clock.advance(10_000)
    await w.clock.advance(10_000)
    expect(JSON.stringify(w.sent)).not.toMatch(/SECRET/)
    expect(JSON.stringify(w.spawned)).not.toMatch(/SECRET/)
    expect(w.disk.get(`${ROOT}/prd-tracker.json`)).not.toMatch(/SECRET/)
    expect(w.toasts.some(t => /docs\/PRD\.md 是連結，或指到 repo 外/.test(t))).toBe(true)
  })

  test('masks secrets in the PRD before its requirements go on the board', async ($, on) => {
    const w = world($, on)
    w.disk.set(PRD_PATH, '# 測試\n- 測試環境 API key：sk-ant-api03-abcdefghijklmnopqrstuvwx\n- 可以登入')
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    expect(w.disk.get(`${ROOT}/prd-tracker.json`)).not.toMatch(/sk-ant-api03-abc/)
  })

  test('refuses a PRD with no requirement crew can find', async ($, on) => {
    const w = world($, on)
    w.disk.set(PRD_PATH, '# 標題\n## 小節')
    await start($)
    expect((await $.command.run(command('start docs/PRD.md'))).text).toMatch(/找不到需求/)
    expect(w.spawned).toEqual([])
  })

  test('never sends the PM to remove every requirement when the PRD is caught empty', async ($, on) => {
    const w = world($, on)
    await start($)
    await finished($)
    const sent = w.sent.length
    w.disk.set(PRD_PATH, '')
    await w.clock.advance(20_000)
    expect(w.sent).toHaveLength(sent)
    expect((await $.command.run(command('status'))).text).toMatch(/done[\s\S]*PRD 裡找不到需求/)
    w.disk.set(PRD_PATH, PRD)
    await w.clock.advance(20_000)
    expect(w.sent).toHaveLength(sent)
    expect((await $.command.run(command('status'))).text).toMatch(/對準 PRD ✓/)
  })

  test('tells the PM about a big removal only once a second look sees the same PRD', async ($, on) => {
    const w = world($, on)
    await start($)
    await finished($)
    const sent = w.sent.length
    w.disk.set(PRD_PATH, '# 會員訂閱\n\n使用者可以選年繳方案。')
    await w.clock.advance(10_000)
    expect(w.sent).toHaveLength(sent)
    await w.clock.advance(10_000)
    expect(w.sent.at(-1)?.to).toBe('a-pm-1')
    expect(w.sent.at(-1)?.text).toMatch(/新增的需求[\s\S]*年繳[\s\S]*移除的需求[\s\S]*月繳/)
  })

  test('tells the PM about a change once, even when Claude Code reloads', async ($, on) => {
    const w = world($, on)
    await start($)
    await finished($)
    w.disk.set(PRD_PATH, CHANGED)
    await w.clock.advance(10_000)
    const told = w.sent.filter(m => /PRD 改了/.test(m.text)).length
    expect(told).toBe(1)
    await start($)
    await w.clock.advance(10_000)
    expect(w.sent.filter(m => /PRD 改了/.test(m.text))).toHaveLength(told)
    expect(w.toasts.filter(t => /PRD 改了/.test(t))).toHaveLength(1)
  })

  test('looks once at a time: a change two looks meet together is told once', async ($, on) => {
    const w = world($, on)
    await start($)
    await finished($)
    w.disk.set(PRD_PATH, CHANGED)
    await Promise.all([w.clock.advance(10_000), done($, 'a-qa-2')])
    expect(w.toasts.filter(t => /PRD 改了/.test(t))).toHaveLength(1)
    expect(w.sent.filter(m => /PRD 改了/.test(m.text))).toHaveLength(1)
  })

  test('keeps a PRD change seen while the board could not be read, and sends it once the board is back', async ($, on) => {
    const w = world($, on)
    await start($)
    await finished($)
    const board = w.disk.get(`${ROOT}/prd-tracker.json`) ?? ''
    w.disk.set(`${ROOT}/prd-tracker.json`, '{ broken')
    w.disk.set(PRD_PATH, CHANGED)
    await w.clock.advance(10_000)
    expect(w.sent.some(m => /PRD 改了/.test(m.text))).toBe(false)
    w.disk.set(`${ROOT}/prd-tracker.json`, board)
    await w.clock.advance(10_000)
    expect(w.sent.some(m => /PRD 改了/.test(m.text))).toBe(true)
  })

  test('starts a second PRD on the same board without the first one’s features holding it up', async ($, on) => {
    const w = world($, on)
    await start($)
    await finished($)
    const second = '# 帳單\n\n每月寄出電子發票。'
    w.disk.set(`${ROOT}/docs/BILLING.md`, second)
    const req2 = requirementsOf(second)[0]?.id ?? ''
    await $.command.run(command('start docs/BILLING.md'))
    // A new start sets the PM off again, as a new agent.
    expect(w.spawned.map(s => s.subagentType)).toEqual(['crew:pm', 'crew:qa', 'crew:pm'])
    await write($, 'a-pm-3', [
      { op: 'add_feature', title: '電子發票', summary: '', sources: [req2] },
      { op: 'add_criterion', feature: 'PRD-003', text: '每月寄出發票' },
    ])
    await done($, 'a-pm-3')
    expect(w.sent.some(m => /看板還對不上 PRD/.test(m.text))).toBe(false)
    expect((await $.command.run(command('status'))).text).toMatch(/adding_tests[\s\S]*對準 PRD ✓/)
  })

  test('brings a board made before crew numbered requirements in line, without calling it a PRD change', async ($, on) => {
    const w = world($, on)
    const old = applyOps(newTracker('x'), [{ op: 'add_feature', title: '方案選擇', summary: '' }, { op: 'add_criterion', feature: 'PRD-001', text: '可以選月繳方案' }], {
      by: 'pm',
      today: '2026-10-15',
      prefixes: { feature: 'PRD-', testCase: 'TC-' },
    })
    if (!old.ok) throw new Error(old.errors.join())
    w.disk.set(`${ROOT}/prd-tracker.json`, JSON.stringify(old.tracker))
    w.store.set(`state:${ROOT}`, { prdPath: 'docs/PRD.md', flow: { stage: 'done', round: 0, retries: 0 }, questions: [], lead: 'person' })
    await start($)
    expect(w.spawned.at(-1)?.prompt).toMatch(/還沒有對應到 PRD 需求編號[\s\S]*link_requirements/)
    const text = await paneText($)
    expect(text).not.toMatch(/PRD 改了/)
    expect(text).toMatch(/對準 PRD 0\/2 ⚠/)
  })

  test('keeps the threads of PRD requirements after a restart', async ($, on) => {
    const w = world($, on)
    await start($)
    await finished($)
    w.disk.set(PRD_PATH, CHANGED)
    await w.clock.advance(10_000)
    await start($)
    expect((await $.command.run(command(`thread ${NEW_REQ}`))).text).toMatch(/PRD 改了/)
  })
})
