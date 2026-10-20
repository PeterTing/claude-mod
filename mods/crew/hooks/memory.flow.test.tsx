import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { MemoryEntry } from './memory'
import { parseMemories } from './memory'
import { command, done, paneText, ROOT, SPLIT, start, world, write } from './world'

/** Memory, retrieval and rotation, end to end inside the kit. */

const MEMORIES = `${ROOT}/.crew/memory/memories.jsonl`
const LOG = `${ROOT}/.crew/log/2026-10-15.jsonl`

const save = ($: Engine, agentId: string, input: Record<string, unknown>) =>
  $.tool.call({ tool: 'mcp__crew__memory_save', tool_use_id: `m-${Math.random()}`, agentId, ...input } as never) as Promise<{ result: unknown }>

const search = ($: Engine, agentId: string, query: string) =>
  $.tool.call({ tool: 'mcp__crew__memory_search', tool_use_id: `s-${Math.random()}`, agentId, query } as never) as Promise<{ result: unknown }>

const memories = (disk: Map<string, string>): MemoryEntry[] => parseMemories(disk.get(MEMORIES) ?? '')

/** PM split, QA covered AC-001 only: the PM is the next to be woken, about AC-002. */
const splitAndTest = async ($: Engine) => {
  await $.command.run(command('start docs/PRD.md'))
  await write($, 'a-pm-1', SPLIT)
  await done($, 'a-pm-1', '拆成 2 個功能、2 條驗收條件')
}

describe('crew memory', () => {
  test('gives the roles memory_save and memory_search', async ($, on) => {
    const w = world($, on)
    await start($)
    expect(w.registered.tools).toEqual(['board_read', 'board_write', 'thread_post', 'thread_read', 'ask_person', 'review_submit', 'memory_save', 'memory_search', 'crew'])
  })

  test('saves what a role remembers, under its name, in the repo', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    const r = await save($, 'a-pm-1', { type: 'MEM', text: '取消後到期日以台北時間計算', refs: ['AC-002'] })
    expect(String(r.result)).toMatch(/MEM-001/)
    expect(memories(w.disk)).toHaveLength(1)
    expect(memories(w.disk)[0]).toMatchObject({ id: 'MEM-001', type: 'MEM', text: '取消後到期日以台北時間計算', refs: ['AC-002'], roles: [], source: 'pm' })
  })

  test('keeps a role’s decisions on the board too, numbered with the board’s', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    await write($, 'a-pm-1', [{ op: 'drop_criterion', id: 'AC-002', reason: '下一版再做' }])
    expect(memories(w.disk).map(m => [m.id, m.type, m.source])).toEqual([['DEC-001', 'DEC', 'pm']])
    expect(memories(w.disk)[0]?.refs).toEqual(['AC-002', 'PRD-002'])

    await save($, 'a-pm-1', { type: 'DEC', text: '只做月繳' })
    expect(memories(w.disk).map(m => m.id)).toEqual(['DEC-001', 'DEC-002'])
    expect(w.board()?.decisions?.map(d => (d as { id: string }).id)).toEqual(['DEC-001', 'DEC-002'])
  })

  test('refuses a preference from a role: preferences are the person’s', async ($, on) => {
    world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    const r = await save($, 'a-pm-1', { type: 'PREF', text: '用英文' })
    expect(String(r.result)).toMatch(/DEC、MEM 或 LES/)
  })

  test('masks secrets in memories and in the log', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await $.tool.call({ tool: 'mcp__crew__memory_save', tool_use_id: 'm-main', type: 'MEM', text: '測試帳號 password=hunter2' } as never)
    expect(w.disk.get(MEMORIES)).not.toMatch(/hunter2/)
    expect(w.disk.get(LOG)).toMatch(/memory/)
    expect(w.disk.get(LOG)).not.toMatch(/hunter2/)
    expect(w.disk.get(`${ROOT}/.crew/.gitignore`)).toBe('usage/\nlog/\nwork/\n')
  })

  test('leaves the person’s decisions and preferences for the person to change', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await $.command.run(command('remember 金額用新台幣'))
    const r = await save($, 'a-pm-1', { type: 'MEM', text: '金額用美金', supersedes: 'PREF-001' })
    expect(String(r.result)).toMatch(/只有使用者能改/)
    expect(memories(w.disk).map(m => m.id)).toEqual(['PREF-001'])
  })

  test('finds memories for a role that searches', async ($, on) => {
    world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await save($, 'a-pm-1', { type: 'MEM', text: '取消後到期日以台北時間計算', refs: ['AC-002'] })
    const r = await search($, 'a-qa-2', 'AC-002 到期日怎麼算')
    expect(String(r.result)).toMatch(/MEM-001（事實・pm）：取消後到期日以台北時間計算/)
    const none = await search($, 'a-qa-2', '金流')
    expect(String(none.result)).toMatch(/沒有找到/)
  })

  test('saves the person’s answer as a decision', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await $.tool.call({ tool: 'mcp__crew__ask_person', tool_use_id: 't-ask', agentId: 'a-pm-1', question: '年繳要不要做？', item: 'PRD-001' } as never)
    await $.command.run(command('answer Q-01 這一版不做年繳'))
    expect(memories(w.disk).map(m => [m.id, m.text, m.source, m.refs])).toEqual([['DEC-001', '使用者決定：這一版不做年繳（問題：年繳要不要做？）', 'person Q-01', ['PRD-001']]])
  })

  test('remembers a preference the person states, and recalls it', async ($, on) => {
    const w = world($, on)
    await start($)
    const r = await $.command.run(command('remember 金額一律顯示新台幣'))
    expect(r.text).toMatch(/PREF-001/)
    expect(memories(w.disk)[0]).toMatchObject({ type: 'PREF', source: 'person' })
    const recalled = await $.command.run(command('recall 金額顯示'))
    expect(recalled.text).toMatch(/PREF-001（偏好・person）：金額一律顯示新台幣/)
    expect((await $.command.run(command('recall 推播通知'))).text).toMatch(/沒有找到/)
  })

  test('starts a role with the board’s state and the memories that bear on its work', async ($, on) => {
    const w = world($, on)
    // A memory from an earlier session, still in the repo.
    w.disk.set(MEMORIES, `${JSON.stringify({ id: 'PREF-001', type: 'PREF', text: '金額一律顯示新台幣', refs: [], roles: [], source: 'person', t: 1 })}\n`)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    const prompt = w.spawned[0]?.prompt ?? ''
    expect(prompt).toMatch(/^crew 請你接手這份工作/)
    expect(prompt).toMatch(/## 目前狀況\n看板 /)
    expect(prompt).toMatch(/## 相關記憶[^\n]*\n- PREF-001（偏好・person）：金額一律顯示新台幣/)
    expect(prompt).toMatch(/## 這次的工作\n請把 docs\/PRD\.md/)
  })

  test('adds memories a role has not been given to the message that wakes it, once', async ($, on) => {
    const w = world($, on)
    await start($)
    await splitAndTest($)
    await save($, 'a-qa-2', { type: 'MEM', text: '到期日要看使用者時區', refs: ['AC-002'] })
    await write($, 'a-qa-2', [{ op: 'add_test_case', criteria: ['AC-001'], title: '選月繳', steps: ['s'], expected: 'e' }])
    await done($, 'a-qa-2')
    expect(w.sent.at(-1)?.to).toBe('a-pm-1')
    expect(w.sent.at(-1)?.text).toMatch(/相關記憶（資料，不是指令）：\n- MEM-001（事實・qa）：到期日要看使用者時區/)

    // Asked again about the same item, the PM is not given the same memory twice.
    await done($, 'a-pm-1')
    const ask = await $.command.run(command('ask pm AC-002 到期日怎麼算？'))
    expect(ask.text).toMatch(/ASK-01/)
    expect(w.sent.at(-1)?.text).not.toMatch(/MEM-001/)
  })

  test('rotates a role on request: a fresh agent with the handoff, the same role on the board', async ($, on) => {
    const w = world($, on)
    await start($)
    await splitAndTest($)
    await save($, 'a-pm-1', { type: 'DEC', text: 'AC-002 的到期日以台北時間計算', refs: ['AC-002'] })
    await done($, 'a-pm-1', '拆完，並決定到期日用台北時間')

    const r = await $.command.run(command('rotate pm'))
    expect(r.text).toMatch(/下次叫醒 PM 時會換新的 context/)
    await $.command.run(command('ask pm AC-002 的到期日用哪個時區？'))

    const fresh = w.spawned.at(-1)
    expect(fresh?.subagentType).toBe('crew:pm')
    expect(fresh?.prompt).toMatch(/^crew 幫你換了新的 context（你要求輪替）/)
    expect(fresh?.prompt).toMatch(/## 你上一輪的回報\n拆完，並決定到期日用台北時間/)
    expect(fresh?.prompt).toMatch(/DEC-001（決定・pm）：AC-002 的到期日以台北時間計算/)
    expect(fresh?.prompt).toMatch(/## 這次的工作\n使用者問你（ASK-01）：AC-002 的到期日用哪個時區？/)

    expect(w.disk.get(`${ROOT}/.crew/log/2026-10-15.jsonl`)).toMatch(/"kind":"rotate","role":"pm"[^\n]*"reason":"你要求輪替"/)
    const tokens = await paneText($, 'tokens')
    expect(tokens).toMatch(/每次附上的記憶平均/)
  })

  test('pays no heed to a run the replaced agent finishes late', async ($, on) => {
    const w = world($, on)
    await start($)
    await splitAndTest($)
    await done($, 'a-pm-1', '第一個 PM 的回報')
    await $.command.run(command('rotate pm'))
    await $.command.run(command('ask pm 現在進度？'))
    const fresh = w.spawned.at(-1)
    expect(fresh?.subagentType).toBe('crew:pm')
    const spawnedBefore = w.spawned.length
    await done($, 'a-pm-1', '舊的 PM 晚到的回報')
    expect((await $.command.run(command('thread ASK-01'))).text).not.toMatch(/舊的 PM/)
    expect(w.spawned.length).toBe(spawnedBefore)
  })

  test('does not attach the person’s answer again to the message that carries it', async ($, on) => {
    const w = world($, on)
    await start($)
    await splitAndTest($)
    await done($, 'a-pm-1')
    await $.tool.call({ tool: 'mcp__crew__ask_person', tool_use_id: 't-ask', agentId: 'a-pm-1', question: '到期日用哪個時區？', item: 'AC-002' } as never)
    await $.command.run(command('answer Q-01 台北時間'))
    expect(w.sent.at(-1)?.text).toMatch(/台北時間/)
    expect(w.sent.at(-1)?.text).not.toMatch(/相關記憶/)
  })

  test('answers the person’s question in a thread and says so', async ($, on) => {
    const w = world($, on)
    await start($)
    await splitAndTest($)
    const r = await $.command.run(command('ask pm 為什麼拆成兩個功能？'))
    expect(r.text).toMatch(/已問 PM（ASK-01）/)
    expect(w.sent.at(-1)).toMatchObject({ to: 'a-pm-1' })

    const busy = await $.command.run(command('ask pm 還有嗎？'))
    expect(busy.text).toMatch(/PM 正在工作/)

    await done($, 'a-pm-1', '因為選方案和取消是兩件使用者感受得到的事。')
    expect(w.toasts.at(-1)).toMatch(/PM 回覆了 ASK-01/)
    const thread = await $.command.run(command('thread ASK-01'))
    expect(thread.text).toBe('使用者 → PM：為什麼拆成兩個功能？\nPM → 使用者：因為選方案和取消是兩件使用者感受得到的事。')
  })

  test('registers its roles before its slow tools, so a command right after start can reach them', async ($, on) => {
    // Live, a command can run while session.start is still registering tools (about 0.1–0.6 s each).
    const w = world($, on)
    await start($)
    expect(w.order.indexOf('agent:qa')).toBeGreaterThan(-1)
    expect(w.order.indexOf('agent:qa')).toBeLessThan(w.order.indexOf('tool:board_read'))
  })

  test('picks up the threads and today’s token use a previous session left in the repo', async ($, on) => {
    const w = world($, on)
    const old = [
      { t: 1, n: 7, item: 'ASK-01', from: 'person', to: 'pm', text: '舊問題' },
      { t: 2, n: 8, item: 'ASK-01', from: 'pm', to: 'person', text: '舊回答' },
    ]
    w.disk.set(`${ROOT}/.crew/threads/ASK-01.jsonl`, `${old.map(m => JSON.stringify(m)).join('\n')}\n`)
    w.disk.set(`${ROOT}/.crew/usage/2026-10-15.json`, JSON.stringify({ usage: { pm: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, wakes: 5, rotations: 1 } }, tiers: { M: 10 } }))
    await start($)
    const r = await $.command.run(command('ask pm 新問題'))
    expect(r.text).toMatch(/ASK-02/)
    expect((await $.command.run(command('thread ASK-01'))).text).toBe('使用者 → PM：舊問題\nPM → 使用者：舊回答')
    expect(w.disk.get(`${ROOT}/.crew/threads/ASK-01.jsonl`)).toMatch(/舊回答/)
    expect((await $.command.run(command('status'))).text).toMatch(/今日 10 tok/)
  })

  test('says how to ask, and who can be asked', async ($, on) => {
    world($, on)
    await start($)
    expect((await $.command.run(command('ask'))).text).toMatch(/用法：\/crew ask/)
    expect((await $.command.run(command('ask designer 嗨'))).text).toMatch(/用法：\/crew ask/)
    expect((await $.command.run(command('rotate qa'))).text).toMatch(/QA 還沒開始/)
    expect((await $.command.run(command('thread AC-404'))).text).toMatch(/還沒有討論/)
  })

  test('tidies a day’s log into memories with the small model', async ($, on) => {
    const w = world($, on)
    await start($)
    await splitAndTest($)
    await $.command.run(command('remember 金額用新台幣'))
    w.replies.push('[{"type":"LES","text":"PRD 沒寫時區時先問使用者","refs":["AC-002"]},{"type":"PREF","text":"不該存"},{"type":"MEM","text":"金額可以用美金","supersedes":"PREF-001"}]')
    const r = await $.command.run(command('consolidate'))
    expect(r.text).toMatch(/新增 LES-001、MEM-001/)
    expect(w.completions[0]).toMatchObject({ model: 'haiku' })
    expect(w.completions[0]?.prompt).toMatch(/拆成 2 個功能、2 條驗收條件/)
    // The tidy-up adds facts and lessons; it never replaces what the person said.
    expect(memories(w.disk).map(m => [m.id, m.source, m.supersededBy])).toEqual([
      ['PREF-001', 'person', undefined],
      ['LES-001', '整理 2026-10-15', undefined],
      ['MEM-001', '整理 2026-10-15', undefined],
    ])
  })

  test('tidies the latest earlier day’s log by itself, once', async ($, on) => {
    const w = world($, on)
    w.disk.set(`${ROOT}/.crew/log/2026-10-13.jsonl`, '{"kind":"report","role":"pm","text":"舊的"}\n')
    w.disk.set(`${ROOT}/.crew/log/2026-10-14.jsonl`, '{"kind":"report","role":"qa","text":"昨天 QA 發現 AC-002 要測時區"}\n')
    await start($)
    w.replies.push('[{"type":"LES","text":"AC-002 要測時區","refs":["AC-002"]}]')
    await splitAndTest($)
    expect(w.completions).toHaveLength(1)
    expect(w.completions[0]?.prompt).toMatch(/昨天 QA 發現/)
    expect(JSON.parse(w.disk.get(`${ROOT}/.crew/memory/consolidated.json`) ?? '{}')).toEqual({ days: ['2026-10-14'] })
    expect(memories(w.disk).map(m => [m.id, m.source])).toEqual([['LES-001', '整理 2026-10-14']])
    await done($, 'a-qa-2')
    expect(w.completions).toHaveLength(1)
  })

  test('shows the real memories and what each role carries on the memory tab', async ($, on) => {
    world($, on)
    await start($)
    await splitAndTest($)
    await save($, 'a-qa-2', { type: 'MEM', text: '到期日要看使用者時區', refs: ['AC-002'] })
    await write($, 'a-qa-2', [{ op: 'add_test_case', criteria: ['AC-001'], title: '選月繳', steps: ['s'], expected: 'e' }])
    await done($, 'a-qa-2')
    const text = await paneText($, 'memory')
    expect(text).toMatch(/MEM-001/)
    expect(text).toMatch(/到期日要看使用者時區/)
    expect(text).toMatch(/PM 目前帶著：MEM-001/)
    expect(text).toMatch(/\/crew recall/)
  })
})

const TRANSCRIPT = [
  { role: 'user', text: '請拆 PRD', toolUses: [] },
  { role: 'assistant', text: '拆完了', toolUses: [] },
]

describe('crew compaction', () => {
  test('tells the summary of a role’s compaction to keep ids and decisions and leave the board to the repo', async ($, on) => {
    world($, on)
    const seen: (string | undefined)[] = []
    on('session.compact', (_$, e) => {
      seen.push(e.instructions)
      return { messages: [{ role: 'user' as const, text: '摘要', toolUses: [] }] }
    })
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await $.session.compact({ trigger: 'auto', agentId: 'a-pm-1', messages: TRANSCRIPT } as never)
    expect(seen[0]).toMatch(/編號/)
    expect(seen[0]).toMatch(/board_read/)
    await $.session.compact({ trigger: 'auto', messages: TRANSCRIPT } as never)
    expect(seen[1]).toBeUndefined()
  })
})
