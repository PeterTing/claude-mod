import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { paneUi, PRD, ROOT, SPLIT, start, textOf, world } from './world'

/** The brain hears what needs it at once, and the roles' routine news every 30 minutes, in one message. */

const crew = ($: Engine, input: Record<string, unknown>) => $.tool.call({ tool: 'mcp__crew__crew', tool_use_id: `d-${Math.random()}`, ...input } as never) as Promise<{ result: unknown }>
const call = ($: Engine, tool: string, input: Record<string, unknown>, agentId?: string) =>
  $.tool.call({ tool: `mcp__crew__${tool}`, tool_use_id: `d-${Math.random()}`, ...(agentId === undefined ? {} : { agentId }), ...input } as never) as Promise<{ result: unknown }>

describe('the brain’s digest', () => {
  test('brings routine news every 30 minutes in one message, and what needs the brain at once', async ($, on) => {
    const w = world($, on)
    await start($)
    await crew($, { action: 'start', path: 'docs/PRD.md' })
    // Routine: the PRD changes, and the PM syncs the board on its own.
    w.disk.set(`${ROOT}/docs/PRD.md`, `${PRD}\n\n使用者可以改成年繳方案。`)
    await w.clock.advance(15_000)
    // At once: the PM has a question for the person.
    await call($, 'ask_person', { question: '年繳要不要打折？' }, 'a-pm-1')
    await w.clock.advance(60_000)
    expect(w.prompts.some(p => /有一件事要使用者決定/.test(p))).toBe(true)
    expect(w.prompts.some(p => /PRD 改了/.test(p))).toBe(false)
    let ui = await paneUi($)
    expect(await textOf(ui)).toMatch(/大腦摘要 還沒有送出，1 則等 \d\d:\d\d/)
    await ui.unmount()
    await w.clock.advance(30 * 60_000)
    const digests = w.prompts.filter(p => /例行回報/.test(p))
    expect(digests).toHaveLength(1)
    expect(digests[0]).toMatch(/過去 30 分鐘的例行回報（不用立刻處理）[\s\S]*PRD 改了/)
    ui = await paneUi($)
    expect(await textOf(ui)).toMatch(/大腦摘要 \d\d:\d\d 送出，0 則等 \d\d:\d\d/)
    await ui.unmount()
    // Nothing new: no empty digest.
    await w.clock.advance(30 * 60_000)
    expect(w.prompts.filter(p => /例行回報/.test(p))).toHaveLength(1)
  })

  test('carries what the heartbeat did about the work the brain leads', async ($, on) => {
    const w = world($, on)
    await start($)
    await crew($, { action: 'start', path: 'docs/PRD.md' })
    await call($, 'board_write', { ops: SPLIT }, 'a-pm-1')
    await $.turn.complete({ answer: '完成', durationMs: 5, isAborted: false, turnId: 't-pm', reason: 'answer', agentId: 'a-pm-1' } as never)
    // QA's run breaks off; the heartbeat wakes it.
    await $.turn.complete({ answer: '', durationMs: 5, isAborted: false, turnId: 't-qa', reason: 'error', agentId: 'a-qa-2' } as never)
    await w.clock.advance(30 * 60_000)
    const digests = w.prompts.filter(p => /例行回報/.test(p))
    expect(digests.at(-1)).toMatch(/流程停在「測試案例」，沒有角色在工作 → 已叫醒 QA 接續（第 1 次）/)
  })

  test('is not shown while the person leads the work and the brain has nothing waiting', async ($, on) => {
    world($, on)
    await start($)
    const ui = await paneUi($)
    expect(await textOf(ui)).not.toMatch(/大腦摘要/)
    await ui.unmount()
  })
})
