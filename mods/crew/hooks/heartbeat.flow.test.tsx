import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { applyOps, DEFAULT_PREFIXES, newTracker } from './board'
import type { Op } from './board'
import { approve, build, command, designed, done, paneUi, PLAN, PRD, ROOT, SPLIT, start, textOf, world, write } from './world'

const call = ($: Engine, tool: string, input: Record<string, unknown>, agentId?: string) =>
  $.tool.call({ tool: `mcp__crew__${tool}`, tool_use_id: `h-${Math.random()}`, ...(agentId === undefined ? {} : { agentId }), ...input } as never) as Promise<{ result: unknown }>

const failed = ($: Engine, agentId: string, reason: 'error' | 'aborted') =>
  $.turn.complete({ answer: '', durationMs: 5, isAborted: reason === 'aborted', turnId: `t-${agentId}-${Math.random()}`, reason, agentId } as never)

/** crew's heartbeat: every five minutes it looks after its work in code, with no model call, and acts on what it finds. */

const BEAT = 300_000

/** The board a last session left: split, tested, planned, the full-stack on TASK-001. */
const leftBoard = () => {
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
  return t
}

describe('the heartbeat', () => {
  test('says when crew last looked, and when it looks next', async ($, on) => {
    world($, on)
    await start($)
    const ui = await paneUi($)
    expect(await textOf(ui)).toMatch(/常駐 ✓ 心跳 剛剛 · 下次 5 分鐘後/)
    await ui.unmount()
  })

  test('wakes the role a stopped flow needs once, then holds the flow for the person', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    await done($, 'a-pm-1')
    await failed($, 'a-qa-2', 'error')
    const before = w.spawned.length
    await w.clock.advance(BEAT)
    // QA's own agent is woken with a message: no new agent from the timer.
    expect(w.spawned).toHaveLength(before)
    expect(w.sent.at(-1)).toMatchObject({ to: 'a-qa-2' })
    let ui = await paneUi($)
    expect(await textOf(ui)).toMatch(/常駐 ⚠ 心跳 剛剛發現：流程停在「測試案例」，沒有角色在工作 → 已叫醒 QA 接續（第 1 次）/)
    await ui.unmount()
    // It stops again at the same place: the person decides.
    await failed($, 'a-qa-2', 'error')
    await w.clock.advance(BEAT)
    expect(w.spawned).toHaveLength(before)
    expect(w.toasts.some(t => /流程停在「測試案例」，叫醒過一次還是停住/.test(t))).toBe(true)
    ui = await paneUi($)
    expect(await textOf(ui)).toMatch(/流程停在「測試案例」，叫醒過一次還是停住。要再試一次嗎？/)
    // The person goes on: the roles start afresh, from the press.
    await ui.press({ key: 'resume' })
    expect(w.spawned).toHaveLength(before + 1)
    expect(w.spawned.at(-1)?.subagentType).toBe('crew:qa')
    await ui.unmount()
  })

  test('starts a role a timer needs afresh at crew’s next frame, never from the timer itself', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    await done($, 'a-pm-1')
    await failed($, 'a-qa-2', 'error')
    // QA is to start from a fresh context next time.
    await $.command.run(command('rotate qa'))
    const before = w.spawned.length
    await w.clock.advance(BEAT)
    // Started from the timer, the engine would take the role's whole run for crew's own code and skip
    // crew's hooks for it: its tools would answer nothing. It waits for a frame instead.
    expect(w.spawned).toHaveLength(before)
    // A start that waits is work under way: the next heartbeat neither holds the flow nor wakes it again, and says it still waits.
    await w.clock.advance(BEAT)
    expect(w.toasts.some(t => /叫醒過一次還是停住/.test(t))).toBe(false)
    const ui = await paneUi($)
    expect(await textOf(ui)).toMatch(/QA 排著，Claude Code 有下一個動作時開始/)
    // Any press in the pane is a frame of the engine's: even a tab.
    await ui.press({ key: 'tab-threads' })
    expect(w.spawned).toHaveLength(before + 1)
    expect(w.spawned.at(-1)?.subagentType).toBe('crew:qa')
    await ui.unmount()
    await $.command.run(command('status'))
    expect(w.spawned).toHaveLength(before + 1)
  })

  test('starts a waiting role once when the person goes on: the start the command makes takes its place', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    await done($, 'a-pm-1')
    await failed($, 'a-qa-2', 'error')
    await $.command.run(command('rotate qa'))
    const before = w.spawned.length
    await w.clock.advance(BEAT)
    expect(w.spawned).toHaveLength(before)
    await $.command.run(command('resume'))
    expect(w.spawned.slice(before).map(s => s.subagentType)).toEqual(['crew:qa'])
  })

  test('lets a start the timer left waiting go once the person resets: no role of the old work starts', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    await done($, 'a-pm-1')
    await failed($, 'a-qa-2', 'error')
    await $.command.run(command('rotate qa'))
    const before = w.spawned.length
    await w.clock.advance(BEAT)
    expect(w.spawned).toHaveLength(before)
    expect((await $.command.run(command('reset'))).text).toMatch(/已清掉/)
    await $.command.run(command('status'))
    expect(w.spawned).toHaveLength(before)
  })

  test('takes a commit made after the flow finished to the tech lead’s review', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    await done($, 'a-pm-1')
    await write($, 'a-qa-2', [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }])
    await done($, 'a-qa-2')
    await designed($)
    await write($, 'a-techlead-4', PLAN)
    await done($, 'a-techlead-4')
    await build($)
    expect((await $.command.run(command('status'))).text).toMatch(/done/)
    // The person fixes something on crew's branch themselves, outside any role's run.
    const sha = w.commit('TASK-001: 文案修正')
    await w.clock.advance(BEAT)
    expect(w.sent.at(-1)).toMatchObject({ to: 'a-techlead-4' })
    expect(w.sent.at(-1)?.text).toMatch(new RegExp(`請 review TASK-001[\\s\\S]*commit ${sha}`))
    const ui = await paneUi($)
    expect(await textOf(ui)).toMatch(/常駐 ⚠ 心跳 剛剛發現：流程完成後多了新的 commit → 已排給 Tech lead review/)
    await ui.unmount()
    await approve($, 'TASK-001')
  })

  test('reminds the person once of a question that waited two hours', { timeoutMs: 60_000 }, async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await call($, 'ask_person', { question: '年繳要不要做？' }, 'a-pm-1')
    await w.clock.advance(2 * 3_600_000 + BEAT)
    expect(w.toasts.filter(t => /Q-01 已經等你 2 小時/.test(t))).toHaveLength(1)
    await w.clock.advance(3 * BEAT)
    expect(w.toasts.filter(t => /Q-01 已經等你 2 小時/.test(t))).toHaveLength(1)
  })

  test('lets a hold go once the flow moves on without 接續, so the heartbeat looks after it again', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    await done($, 'a-pm-1')
    await write($, 'a-qa-2', [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }])
    await done($, 'a-qa-2')
    await designed($)
    await write($, 'a-techlead-4', PLAN)
    await done($, 'a-techlead-4')
    w.commit('TASK-001: 方案頁')
    await done($, 'a-fullstack-5')
    await approve($, 'TASK-001')
    w.commit('TASK-002: 取消流程')
    await done($, 'a-fullstack-5')
    // The run is asked for, and Claude Code reloads before it starts: the flow is held in testing.
    w.refuse.timers = 1
    await approve($, 'TASK-002')
    // The lost run is given up on, as a reloaded crew starts with none asked for.
    await w.clock.advance(60_000)
    await start($)
    const ui = await paneUi($)
    expect(await textOf(ui)).toMatch(/停在「測試結果」。要接續嗎？/)
    // The person runs the tests from the settings tab instead of 接續: they pass, and the flow is done.
    await ui.press({ key: 'tab-settings' })
    await ui.press({ key: 'run-tests' })
    await w.clock.advance(1)
    expect((await $.command.run(command('status'))).text).toMatch(/done/)
    await ui.press({ key: 'tab-overview' })
    expect(await textOf(ui)).not.toMatch(/要接續嗎|暫停中/)
    await ui.unmount()
    // Not held any more: a commit made after the finish goes to review at the next look.
    w.commit('TASK-001: 文案修正')
    await w.clock.advance(BEAT)
    expect(w.sent.at(-1)).toMatchObject({ to: 'a-techlead-4' })
  })

  test('wakes a stopped flow though the brain’s proposal on usage waits for the person', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    await done($, 'a-pm-1')
    await $.tool.call({ tool: 'mcp__crew__crew', tool_use_id: 'tn', action: 'tune', role: 'qa', limit: 80_000 } as never)
    await failed($, 'a-qa-2', 'error')
    const before = w.sent.length
    await w.clock.advance(BEAT)
    expect(w.sent.length).toBe(before + 1)
    expect(w.sent.at(-1)).toMatchObject({ to: 'a-qa-2' })
  })

  test('says a held flow on the line above the prompt, and in a notice, when the pane does not open', async ($, on) => {
    const w = world($, on)
    w.store.set(`settings:${ROOT}`, { openOnLoad: false, tuning: 'ask' })
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
    expect(w.panes).not.toContain('open:crew')
    expect(w.toasts.some(t => /上次的 docs\/PRD\.md 停在「實作」[\s\S]*打開 crew 面板/.test(t))).toBe(true)
    const band = await $.ui.mount({ plugin: 'crew', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 2, bodyColumns: 140 } } as never)
    expect(await textOf(band)).toMatch(/⏸ 等你接續/)
    await band.unmount()
  })

  test('does nothing for a flow the person holds', async ($, on) => {
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
    w.store.set(`state:${ROOT}`, { prdPath: 'docs/PRD.md', flow: { stage: 'building', round: 0, retries: 0, building: 'TASK-001' }, questions: [], lead: 'person' })
    await start($)
    await w.clock.advance(3 * BEAT)
    expect(w.spawned).toEqual([])
  })
  test('wakes a new flow that stops where an earlier one did once, rather than hold it at once', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    await done($, 'a-pm-1')
    await failed($, 'a-qa-2', 'error')
    await w.clock.advance(BEAT)
    // QA was woken there; the person resets and starts over, and it stops at the same place.
    await $.command.run(command('reset'))
    await $.command.run(command('start docs/PRD.md'))
    await done($, `a-pm-${w.spawned.length}`)
    expect(w.spawned.at(-1)?.subagentType).toBe('crew:qa')
    await failed($, `a-qa-${w.spawned.length}`, 'error')
    const sent = w.sent.length
    await w.clock.advance(BEAT)
    expect(w.sent.length).toBe(sent + 1)
    expect(w.toasts.some(t => /叫醒過一次還是停住/.test(t))).toBe(false)
  })

  test('does nothing while a role works', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await w.clock.advance(3 * BEAT)
    expect(w.spawned).toHaveLength(1)
    expect(w.sent).toEqual([])
    const ui = await paneUi($)
    expect(await textOf(ui)).not.toMatch(/停在|叫醒/)
    await ui.unmount()
  })

  test('starts no second run while a long test run is under way', async ($, on) => {
    const w = world($, on)
    w.tests.ms = 400_000
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    await done($, 'a-pm-1')
    await write($, 'a-qa-2', [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }])
    await done($, 'a-qa-2')
    await designed($)
    await write($, 'a-techlead-4', PLAN)
    await done($, 'a-techlead-4')
    for (const id of ['TASK-001', 'TASK-002']) {
      w.commit(`${id}: 完成 ${id}`)
      await done($, 'a-fullstack-5')
      await approve($, id)
    }
    await w.clock.advance(BEAT)
    await w.clock.advance(BEAT)
    expect(w.tests.runs).toHaveLength(1)
  })

  test('takes no PRD change on a held flow until the person goes on', async ($, on) => {
    const w = world($, on)
    w.disk.set(`${ROOT}/prd-tracker.json`, JSON.stringify(leftBoard()))
    w.store.set(`state:${ROOT}`, { prdPath: 'docs/PRD.md', flow: { stage: 'building', round: 0, retries: 0, building: 'TASK-001' }, questions: [], lead: 'person' })
    await start($)
    w.disk.set(`${ROOT}/docs/PRD.md`, `${PRD}\n\n使用者可以改成年繳方案。`)
    await w.clock.advance(30_000)
    expect(w.spawned).toEqual([])
    expect(w.toasts.some(t => /PRD 改了/.test(t))).toBe(false)
    const ui = await paneUi($)
    await ui.press({ key: 'resume' })
    await ui.unmount()
    await w.clock.advance(30_000)
    expect(w.toasts.some(t => /PRD 改了/.test(t))).toBe(true)
  })
  test('wakes the agent a look could not reach once a frame comes, rather than replace it, so an answer it took stays', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await call($, 'ask_person', { question: '年繳要不要打折？' }, 'a-pm-1')
    // The PRD changes while the PM splits; the look's message to it is not delivered this once.
    w.failSends.n = 1
    w.disk.set(`${ROOT}/docs/PRD.md`, `${PRD}\n\n使用者可以改成年繳方案。`)
    await w.clock.advance(10_000)
    expect(w.spawned).toHaveLength(1)
    // The person's answer goes to the PM, and then the change: the same agent takes both.
    await $.command.run(command('answer Q-01 不打折'))
    expect(w.spawned).toHaveLength(1)
    expect(w.sent.filter(m => m.to === 'a-pm-1').map(m => m.text).join('\n')).toMatch(/不打折[\s\S]*PRD 改了/)
  })
})
