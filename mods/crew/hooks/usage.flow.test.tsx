import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { approve, command, designed, done, NOW, paneUi, PLAN, ROOT, SPLIT, start, textOf, world, write } from './world'

/** Token reminders crew sends the brain, and what the brain does about them: on its own, or once the person approves. */

const BEAT = 300_000
const DAY = '2026-10-15'

/** A day on which the full-stack took most of the tokens, and read little of them from the cache. */
const heavy = {
  pm: { input: 6_000, output: 4_000, cacheRead: 27_000, cacheWrite: 5_000, wakes: 6, rotations: 0 },
  fullstack: { input: 31_000, output: 22_000, cacheRead: 85_000, cacheWrite: 50_000, wakes: 14, rotations: 2 },
}

const crew = ($: Engine, input: Record<string, unknown>) => $.tool.call({ tool: 'mcp__crew__crew', tool_use_id: `u-${Math.random()}`, ...input } as never) as Promise<{ result: unknown }>

const tested = async ($: Engine) => {
  await $.command.run(command('start docs/PRD.md'))
  await write($, 'a-pm-1', SPLIT)
  await done($, 'a-pm-1')
  await write($, 'a-qa-2', [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }])
  await done($, 'a-qa-2')
  await designed($)
}

describe('token reminders', () => {
  test('tell the brain once an hour when a role takes over 40% of the day, or reads under 60% from the cache', { timeoutMs: 60_000 }, async ($, on) => {
    const w = world($, on)
    w.disk.set(`${ROOT}/.crew/usage/${DAY}.json`, JSON.stringify({ usage: heavy, tiers: {} }))
    await start($)
    await w.clock.advance(BEAT)
    const ui = await paneUi($)
    await ui.press({ key: 'tab-tokens' })
    const text = await textOf(ui)
    expect(text).toMatch(/提醒已送大腦（同一條件一小時最多一次）/)
    expect(text).toMatch(/全端今日佔 \d+%（超過 40%） · \d\d:\d\d/)
    expect(text).toMatch(/全端快取命中率 51%（低於 60%）/)
    // PM's share and rate are fine.
    expect(text).not.toMatch(/PM今日佔|PM快取/)
    await ui.unmount()
    await w.clock.advance(60_000)
    const told = w.prompts.filter(p => /全端今日佔/.test(p)).length
    expect(told).toBe(1)
    expect(w.prompts.find(p => /全端今日佔/.test(p))).toMatch(/tune[\s\S]*使用者設定先問使用者：你的處置會變成建議，他在面板核准才執行/)
    // Still the case at the next look: not told again within the hour, and told again once it is past.
    await w.clock.advance(BEAT)
    await w.clock.advance(60_000)
    expect(w.prompts.filter(p => /全端今日佔/.test(p)).length).toBe(1)
    await w.clock.advance(60 * 60_000)
    expect(w.prompts.filter(p => /全端今日佔/.test(p)).length).toBe(2)
  })

  test('tell the brain of a role’s tool output past 10K tokens', async ($, on) => {
    const w = world($, on)
    // The engine's Read, standing in: a file too big to read whole.
    on('tool.call', { tool: 'Read' }, () => ({ result: '一'.repeat(40_000) }))
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await $.tool.call({ tool: 'Read', tool_use_id: 'big', agentId: 'a-pm-1', file_path: `${ROOT}/docs/big.md` } as never)
    // The main conversation's own reads are not crew's to measure.
    await $.tool.call({ tool: 'Read', tool_use_id: 'mine', file_path: `${ROOT}/docs/big.md` } as never)
    await w.clock.advance(60_000)
    const told = w.prompts.filter(p => /工具輸出約/.test(p))
    expect(told).toHaveLength(1)
    expect(told[0]).toMatch(/PM 一次工具輸出約 \d+K token（超過 10K）：Read/)
  })

  test('tell of a role’s output just past 10K, not at 10K, and never of the main conversation’s', async ($, on) => {
    const w = world($, on)
    // A Read whose result is as many wide characters as the file's name says: 1.2 tokens each.
    on('tool.call', { tool: 'Read' }, (_$, e) => ({ result: '一'.repeat(Number(String((e as { file_path: string }).file_path).split('-').pop())) }))
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    const read = (n: number, agentId?: string) => $.tool.call({ tool: 'Read', tool_use_id: `r-${n}-${agentId ?? 'main'}`, ...(agentId === undefined ? {} : { agentId }), file_path: `${ROOT}/docs/big-${n}` } as never)
    const told = () => w.prompts.filter(p => /工具輸出約/.test(p)).length
    await read(50_000)
    await w.clock.advance(60_000)
    expect(told()).toBe(0)
    await read(8_333, 'a-pm-1')
    await w.clock.advance(60_000)
    expect(told()).toBe(0)
    await read(8_334, 'a-pm-1')
    await w.clock.advance(60_000)
    expect(told()).toBe(1)
  })

  test('say nothing on a day too small to tell', async ($, on) => {
    const w = world($, on)
    w.disk.set(`${ROOT}/.crew/usage/${DAY}.json`, JSON.stringify({ usage: { fullstack: { input: 3_000, output: 2_000, cacheRead: 1_000, cacheWrite: 4_000, wakes: 1, rotations: 0 } }, tiers: {} }))
    await start($)
    await w.clock.advance(BEAT + 60_000)
    const ui = await paneUi($)
    await ui.press({ key: 'tab-tokens' })
    expect(await textOf(ui)).not.toMatch(/提醒已送大腦/)
    await ui.unmount()
  })
})

describe('the brain’s actions on usage', () => {
  test('wait for the person by default: the brain proposes, the person approves in the pane, and the role’s next work takes it', async ($, on) => {
    const w = world($, on)
    w.disk.set(`${ROOT}/.crew/usage/${DAY}.json`, JSON.stringify({ usage: heavy, tiers: {} }))
    await start($)
    await tested($)
    const r = String((await crew($, { action: 'tune', role: 'fullstack', model: 'opus', effort: 'xhigh', text: '全端修了三次還沒過' })).result)
    expect(r).toMatch(/已提出建議，等使用者核准（Q-\d+）/)
    let ui = await paneUi($)
    const text = await textOf(ui)
    const id = /(Q-\d+) 大腦建議：全端之後的工作改用 Opus・xhigh/.exec(text)?.[1] ?? ''
    expect(id).not.toBe('')
    expect(await ui.find({ key: `reject-${id}` })).toBeDefined()
    // The brain cannot settle its own proposal by answering it.
    expect(String((await crew($, { action: 'answer', question: id, text: '核准' })).result)).toMatch(/大腦的建議要使用者自己在右側面板核准/)
    expect(await textOf(ui)).toMatch(new RegExp(`${id} 大腦建議`))
    await ui.press({ key: `approve-${id}` })
    await ui.unmount()
    // Recorded as a decision, and shown with the numbers before it.
    const memories = w.disk.get(`${ROOT}/.crew/memory/memories.jsonl`) ?? ''
    expect(memories).toMatch(/"type":"DEC"[^\n]*全端之後的工作改用 Opus・xhigh/)
    ui = await paneUi($)
    await ui.press({ key: 'tab-tokens' })
    expect(await textOf(ui)).toMatch(/DEC-\d+ 全端之後的工作改用 Opus・xhigh[\s\S]*處置前 今日佔 \d+% · 命中率 51% · context 0K → 之後的數字等下一輪/)
    await ui.unmount()
    // The full-stack's next work runs on Opus, though its tasks are small.
    await write($, 'a-techlead-4', PLAN)
    await done($, 'a-techlead-4')
    expect(w.spawned.at(-1)).toMatchObject({ subagentType: 'crew:fullstack', model: 'opus' })
  })

  test('take effect at once when the person lets the brain act on its own, and a proposal sent back changes nothing', async ($, on) => {
    const w = world($, on)
    await start($)
    await tested($)
    // Asked first: the person says no.
    await crew($, { action: 'tune', role: 'fullstack', limit: 80_000, text: '全端 context 太大' })
    let ui = await paneUi($)
    const id = /(Q-\d+) 大腦建議：全端的輪替門檻改成 80K/.exec(await textOf(ui))?.[1] ?? ''
    await ui.press({ key: `reject-${id}` })
    expect(await textOf(ui)).not.toMatch(/大腦建議/)
    await ui.press({ key: 'tab-settings' })
    await ui.press({ key: 'tuning-auto' })
    await ui.unmount()
    expect(w.store.get(`settings:${ROOT}`)).toMatchObject({ tuning: 'auto' })
    const r = String((await crew($, { action: 'tune', role: 'fullstack', limit: 80_000, text: '全端 context 太大' })).result)
    expect(r).toMatch(/已處置（DEC-\d+）：全端的輪替門檻改成 80K/)
    ui = await paneUi($)
    expect(await textOf(ui)).not.toMatch(/大腦建議/)
    await ui.unmount()
  })

  test('are the brain’s and the person’s alone: a role cannot tune, and nothing skips a gate', async ($, on) => {
    world($, on)
    await start($)
    await tested($)
    const byRole = String((await $.tool.call({ tool: 'mcp__crew__crew', tool_use_id: 'x', agentId: 'a-pm-1', action: 'tune', role: 'fullstack', model: 'haiku' } as never) as { result: unknown }).result)
    expect(byRole).not.toMatch(/已提出建議|已處置/)
    const bad = String((await crew($, { action: 'tune', role: 'fullstack' })).result)
    expect(bad).toMatch(/要換的模型、effort 或輪替門檻/)
    // The person's floors stand, whichever way the brain acts.
    const low = String((await crew($, { action: 'tune', role: 'fullstack', model: 'haiku' })).result)
    expect(low).toMatch(/低於全端的下限 Sonnet・high/)
  })
  test('keep a proposal waiting, and an action once approved, for a restart', async ($, on) => {
    const w = world($, on)
    await start($)
    await tested($)
    await crew($, { action: 'tune', role: 'fullstack', model: 'opus', text: '全端修了三次還沒過' })
    type Saved = { tunings?: { id: string; pending?: boolean }[]; tuned?: Record<string, unknown>; questions: { id: string; item?: string }[] }
    let saved = w.store.get(`state:${ROOT}`) as Saved
    const id = saved.tunings?.find(t => t.pending === true)?.id ?? ''
    expect(id).toMatch(/^Q-\d+$/)
    expect(saved.questions.some(q => q.id === id && q.item === 'tune')).toBe(true)
    const ui = await paneUi($)
    await ui.press({ key: `approve-${id}` })
    await ui.unmount()
    saved = w.store.get(`state:${ROOT}`) as Saved
    expect(saved.tuned?.fullstack).toEqual({ model: 'opus' })
    expect(saved.tunings?.some(t => t.pending === true)).toBe(false)
  })

  test('keep an action the brain took on its own for a restart, at once', async ($, on) => {
    const w = world($, on)
    w.store.set(`settings:${ROOT}`, { openOnLoad: true, tuning: 'auto' })
    await start($)
    expect(String((await crew($, { action: 'tune', role: 'fullstack', effort: 'max', text: 'x' })).result)).toMatch(/已處置（DEC-\d+）/)
    const saved = w.store.get(`state:${ROOT}`) as { tuned?: Record<string, unknown>; tunings?: { id: string }[] }
    expect(saved.tuned?.fullstack).toEqual({ effort: 'max' })
    expect(saved.tunings?.map(t => t.id)).toEqual([expect.stringMatching(/^DEC-\d+$/)])
  })

  test('let the person settle a proposal kept over a restart, and keep an action taken before it', async ($, on) => {
    const w = world($, on)
    w.store.set(`state:${ROOT}`, {
      prdPath: null,
      flow: { stage: 'idle', round: 0, retries: 0 },
      questions: [
        { id: 'Q-01', question: '大腦建議：全端之後的工作改用 Opus', item: 'tune', from: 'brain', t: NOW, status: 'open' },
        { id: 'Q-02', question: '大腦建議：QA 之後的工作改用 Opus', item: 'tune', from: 'brain', t: NOW, status: 'open' },
      ],
      lead: 'person',
      tuned: { pm: { model: 'opus' } },
      tunings: [
        { id: 'Q-01', pending: true, role: 'fullstack', text: '全端之後的工作改用 Opus', change: { model: 'opus' }, reason: 'x', before: '今日佔 80%', wakes: 0, at: NOW },
        // An action whose numbers at the time came back broken: shown without them.
        { id: 'DEC-001', role: 'pm', text: 'PM 之後的工作改用 Opus', change: { model: 'opus' }, reason: 'x', before: '今日佔 50%', wakes: 0, at: NOW, base: { day: DAY, role: { input: 'x' }, total: 'x' } },
      ],
    })
    await start($)
    const ui = await paneUi($)
    expect(await textOf(ui)).toMatch(/Q-01 大腦建議/)
    await ui.press({ key: 'reject-Q-01' })
    expect(await textOf(ui)).not.toMatch(/Q-01 大腦建議/)
    // A proposal whose record a restart did not keep can be sent back too: it is out of date.
    await ui.press({ key: 'reject-Q-02' })
    expect(w.toasts.at(-1)).toMatch(/Q-02 的建議已經失效/)
    expect(await textOf(ui)).not.toMatch(/大腦建議/)
    await ui.unmount()
    let tokens = await paneUi($)
    await tokens.press({ key: 'tab-tokens' })
    expect(await textOf(tokens)).toMatch(/DEC-001 PM 之後的工作改用 Opus[\s\S]*處置前 今日佔 50%/)
    await tokens.unmount()
    // The PM's tuning, taken before the restart, still runs its work.
    await $.command.run(command('start docs/PRD.md'))
    expect(w.spawned.at(-1)).toMatchObject({ subagentType: 'crew:pm', model: 'opus' })
    // Once it ran, the numbers after its action are whole ones.
    await write($, 'a-pm-1', SPLIT)
    await done($, 'a-pm-1')
    tokens = await paneUi($)
    await tokens.press({ key: 'tab-tokens' })
    const after = /DEC-001[^\n]*\n[^\n]*/.exec(await textOf(tokens))?.[0] ?? ''
    expect(after).toMatch(/處置前 今日佔 50%/)
    expect(after).not.toMatch(/NaN|undefined/)
    await tokens.unmount()
  })

  test('change nothing when a proposal is sent back', async ($, on) => {
    const w = world($, on)
    await start($)
    await tested($)
    await crew($, { action: 'tune', role: 'fullstack', model: 'opus', text: '全端修了三次還沒過' })
    const ui = await paneUi($)
    const id = /(Q-\d+) 大腦建議/.exec(await textOf(ui))?.[1] ?? ''
    await ui.press({ key: `reject-${id}` })
    await ui.unmount()
    expect(w.disk.get(`${ROOT}/.crew/memory/memories.jsonl`) ?? '').not.toMatch(/全端之後的工作改用 Opus/)
    await write($, 'a-techlead-4', PLAN)
    await done($, 'a-techlead-4')
    expect(w.spawned.at(-1)).toMatchObject({ subagentType: 'crew:fullstack', model: 'sonnet' })
  })

  test('take a proposal approved only by the person: not by a command a peer or another plugin runs', async ($, on) => {
    const w = world($, on)
    await start($)
    await tested($)
    const id = /(Q-\d+)/.exec(String((await crew($, { action: 'tune', role: 'fullstack', model: 'opus', text: 'x' })).result))?.[1] ?? ''
    const peer = (await $.command.run({ ...command(`approve ${id}`), origin: { kind: 'peer' } } as never)) as { text: string }
    expect(peer.text).toMatch(/大腦的建議要使用者自己在右側面板核准或不要/)
    await write($, 'a-techlead-4', PLAN)
    await done($, 'a-techlead-4')
    expect(w.spawned.at(-1)).toMatchObject({ subagentType: 'crew:fullstack', model: 'sonnet' })
  })

  test('reach a role whose agent is still alive: its next work runs on the tuned model', async ($, on) => {
    const w = world($, on)
    w.store.set(`settings:${ROOT}`, { openOnLoad: true, tuning: 'auto' })
    await start($)
    await tested($)
    await write($, 'a-techlead-4', PLAN)
    await done($, 'a-techlead-4')
    expect(w.spawned.at(-1)).toMatchObject({ subagentType: 'crew:fullstack', model: 'sonnet' })
    await crew($, { action: 'tune', role: 'fullstack', model: 'opus', text: 'x' })
    w.commit('TASK-001: 方案頁')
    await done($, 'a-fullstack-5')
    await approve($, 'TASK-001')
    expect(w.spawned.at(-1)).toMatchObject({ subagentType: 'crew:fullstack', model: 'opus' })
  })
  test('show the switch and the brain’s actions on a day with no use yet', async ($, on) => {
    const w = world($, on)
    w.store.set(`settings:${ROOT}`, { openOnLoad: true, tuning: 'auto' })
    await start($)
    // No role has run today: the brain still tunes ahead of the work.
    expect(String((await crew($, { action: 'tune', role: 'fullstack', model: 'opus', text: 'x' })).result)).toMatch(/DEC-\d+/)
    const ui = await paneUi($)
    await ui.press({ key: 'tab-tokens' })
    const text = await textOf(ui)
    expect(text).toMatch(/今天還沒有用量/)
    expect(text).toMatch(/大腦處置：自動/)
    expect(text).toMatch(/DEC-\d+ 全端之後的工作改用 Opus/)
    expect(await ui.find({ key: 'tuning-ask' })).toBeDefined()
    await ui.unmount()
  })
  test('take only a crew role, a model and effort crew knows, and a whole limit from 20K to 1M', async ($, on) => {
    world($, on)
    await start($)
    const tune = async (input: Record<string, unknown>) => String((await crew($, { action: 'tune', ...input })).result)
    expect(await tune({ role: 'designer', model: 'opus' })).toMatch(/role 要是 pm、qa、uiux、techlead 或 fullstack/)
    for (const change of [{ model: 'gpt-5' }, { effort: 'ultra' }, { limit: 19_999 }, { limit: 1_000_001 }, { limit: 50_000.5 }, { limit: '80000' }]) {
      expect(await tune({ role: 'qa', ...change })).toMatch(/請說要換的模型、effort 或輪替門檻/)
    }
    expect(await tune({ role: 'qa', limit: 20_000 })).toMatch(/已提出建議/)
    expect(await tune({ role: 'qa', limit: 1_000_000 })).toMatch(/已提出建議/)
  })
  test('apply a proposal kept over a restart once the person approves it', async ($, on) => {
    const w = world($, on)
    w.store.set(`state:${ROOT}`, {
      prdPath: null,
      flow: { stage: 'idle', round: 0, retries: 0 },
      questions: [{ id: 'Q-01', question: '大腦建議：PM 之後的工作改用 Opus', item: 'tune', from: 'brain', t: NOW, status: 'open' }],
      lead: 'person',
      tunings: [{ id: 'Q-01', pending: true, role: 'pm', text: 'PM 之後的工作改用 Opus', change: { model: 'opus' }, reason: 'x', before: '今日佔 80%', wakes: 0, at: NOW }],
    })
    await start($)
    const ui = await paneUi($)
    await ui.press({ key: 'approve-Q-01' })
    expect(await textOf(ui)).not.toMatch(/Q-01 大腦建議/)
    await ui.unmount()
    expect(w.toasts.some(t => /已執行大腦的建議/.test(t))).toBe(true)
    await $.command.run(command('start docs/PRD.md'))
    expect(w.spawned.at(-1)).toMatchObject({ subagentType: 'crew:pm', model: 'opus' })
  })

  test('read back no tuning below the person’s floor, nor of a shape crew never wrote', async ($, on) => {
    const w = world($, on)
    const t = (id: string, role: string, change: Record<string, unknown>, more: Record<string, unknown> = {}) => ({ id, role, text: id, change, reason: '', before: '', wakes: 0, at: NOW, ...more })
    w.store.set(`state:${ROOT}`, {
      prdPath: null,
      flow: { stage: 'idle', round: 0, retries: 0 },
      questions: [],
      lead: 'person',
      tuned: { pm: { model: 'haiku' }, qa: { limit: 5 }, uiux: { model: 'opus', extra: 1 }, designer: { model: 'opus' }, techlead: { effort: 'ultra' }, fullstack: { limit: 50_000.5 } },
      tunings: [
        t('DEC-1', 'pm', { model: 'haiku' }),
        t('bad', 'qa', { model: 'opus' }),
        t('DEC-2', 'designer', { model: 'opus' }),
        t('DEC-3', 'qa', { model: 'gpt' }),
        t('DEC-4', 'qa', { limit: 1_000_001 }),
        t('DEC-5', 'qa', { model: 'opus' }, { at: 'now' }),
        t('DEC-6', 'qa', { model: 'opus', speed: 'fast' }),
      ],
    })
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    // The PM runs on its own route, sonnet: haiku is below its floor.
    expect(w.spawned.at(-1)).toMatchObject({ subagentType: 'crew:pm', model: 'sonnet' })
    const ui = await paneUi($)
    await ui.press({ key: 'tab-tokens' })
    expect(await textOf(ui)).not.toMatch(/DEC-\d|bad/)
    await ui.unmount()
  })

  test('take a typed approve of a role’s question for no out-of-date proposal', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await $.tool.call({ tool: 'mcp__crew__ask_person', tool_use_id: 'q', agentId: 'a-pm-1', question: '年繳要做嗎？' } as never)
    expect((await $.command.run(command('approve Q-01'))).text).toMatch(/不是等你核准的大腦建議/)
    const ui = await paneUi($)
    expect(await textOf(ui)).toMatch(/Q-01/)
    await ui.unmount()
    void w
  })
})
