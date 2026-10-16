import type { RenderPropsOf } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

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
    await w.clock.advance(11_000)
    expect(w.toasts.some(t => /PRD 改了（新增 1、移除 0 條需求）/.test(t))).toBe(true)
    expect(w.sent.at(-1)?.to).toBe('a-pm-1')
    expect(w.sent.at(-1)?.text).toMatch(new RegExp(`PRD 改了[\\s\\S]*${NEW_REQ}[\\s\\S]*改成年繳`))
    expect((await $.command.run(command('status'))).text).toMatch(/splitting[\s\S]*PRD 對不上 1/)
    // A second look at the same PRD does not send the PM again.
    const sent = w.sent.length
    await w.clock.advance(11_000)
    expect(w.sent).toHaveLength(sent)

    await write($, 'a-pm-1', [
      { op: 'add_criterion', feature: 'PRD-001', text: '可以改成年繳' },
      { op: 'link_requirements', feature: 'PRD-001', requirements: [NEW_REQ] },
    ])
    await done($, 'a-pm-1')
    expect(w.sent.at(-1)?.to).toBe('a-qa-2')
    expect(w.sent.at(-1)?.text).toMatch(/AC-003 可以改成年繳/)
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

  test('lists each PRD requirement with how far its development is, on the progress tab', async ($, on) => {
    world($, on)
    await start($)
    await finished($)
    const text = await paneText($, 'progress')
    expect(text).toMatch(new RegExp(`PRD 需求[\\s\\S]*${REQ}`))
    expect(text).toMatch(/規格 ✓[\s\S]*測試 ✓ 2\/2/)
  })

  test('shows how the board stands against the PRD, and when crew last looked', async ($, on) => {
    const w = world($, on)
    await start($)
    await finished($)
    await w.clock.advance(11_000)
    const text = await paneText($)
    expect(text).toMatch(/對準 PRD 3\/3 ✓/)
    expect(text).toMatch(/即時檢查 剛剛/)
    const ui = await $.ui.mount({
      plugin: 'crew',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'crew',
      props: { title: 'Crew', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 80 } } as unknown as RenderPropsOf['Pane'],
    })
    expect(await ui.find({ key: 'gate-G0' })).toBeDefined()
    await ui.unmount()
    w.disk.set(PRD_PATH, CHANGED)
    await w.clock.advance(11_000)
    const after = await paneText($)
    expect(after).toMatch(/對準 PRD 3\/4 ⚠ PRD 改了：新增 1、移除 0/)
    const band = await $.ui.mount({
      plugin: 'crew',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 2, bodyColumns: 160 } as unknown as RenderPropsOf['AbovePrompt'],
    })
    expect((await band.findAll({ type: 'Text' })).map(t => t.text).join('')).toMatch(/⚠ PRD 對不上 1/)
  })
})
