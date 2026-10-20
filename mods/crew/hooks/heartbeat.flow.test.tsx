import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { applyOps, DEFAULT_PREFIXES, newTracker } from './board'
import type { Op } from './board'
import { approve, build, command, designed, done, paneUi, PLAN, ROOT, SPLIT, start, textOf, world, write } from './world'

const call = ($: Engine, tool: string, input: Record<string, unknown>, agentId?: string) =>
  $.tool.call({ tool: `mcp__crew__${tool}`, tool_use_id: `h-${Math.random()}`, ...(agentId === undefined ? {} : { agentId }), ...input } as never) as Promise<{ result: unknown }>

const failed = ($: Engine, agentId: string, reason: 'error' | 'aborted') =>
  $.turn.complete({ answer: '', durationMs: 5, isAborted: reason === 'aborted', turnId: `t-${agentId}-${Math.random()}`, reason, agentId } as never)

/** crew's heartbeat: every five minutes it looks after its work in code, with no model call, and acts on what it finds. */

const BEAT = 300_000

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
    expect(w.spawned).toHaveLength(before + 1)
    expect(w.spawned.at(-1)?.subagentType).toBe('crew:qa')
    let ui = await paneUi($)
    expect(await textOf(ui)).toMatch(/常駐 ⚠ 心跳 剛剛發現：流程停在「測試案例」，沒有角色在工作 → 已叫醒 QA 接續（第 1 次）/)
    await ui.unmount()
    // It stops again at the same place: the person decides.
    await failed($, 'a-qa-3', 'error')
    await w.clock.advance(BEAT)
    expect(w.spawned).toHaveLength(before + 1)
    expect(w.toasts.some(t => /流程停在「測試案例」，叫醒過一次還是停住/.test(t))).toBe(true)
    ui = await paneUi($)
    expect(await textOf(ui)).toMatch(/流程停在「測試案例」，叫醒過一次還是停住。要再試一次嗎？/)
    await ui.press({ key: 'resume' })
    expect(w.spawned).toHaveLength(before + 2)
    await ui.unmount()
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

  test('reminds the person once of a question that waited two hours', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await call($, 'ask_person', { question: '年繳要不要做？' }, 'a-pm-1')
    await w.clock.advance(2 * 3_600_000 + BEAT)
    expect(w.toasts.filter(t => /Q-01 已經等你 2 小時/.test(t))).toHaveLength(1)
    await w.clock.advance(3 * BEAT)
    expect(w.toasts.filter(t => /Q-01 已經等你 2 小時/.test(t))).toHaveLength(1)
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
})
