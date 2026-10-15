import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { parseMemories } from './memory'
import { command, done, ROOT, SPLIT, start, world, write } from './world'

/** What the second test review found untested: parallel writes, QA's questions, the brain's relays, and each rule's other side. */

const MEMORIES = `${ROOT}/.crew/memory/memories.jsonl`
const LOG = `${ROOT}/.crew/log/2026-10-15.jsonl`

const call = ($: Engine, tool: string, input: Record<string, unknown>, agentId?: string) =>
  $.tool.call({ tool: `mcp__crew__${tool}`, tool_use_id: `v-${Math.random()}`, ...(agentId === undefined ? {} : { agentId }), ...input } as never) as Promise<{ result: unknown }>

const notice = async ($: Engine, agentId: string) =>
  (await $.prompt.submit({ text: `<task-notification><task-id>${agentId}</task-id></task-notification>`, wait: false, origin: { kind: 'task-notification' } } as never)) as {
    text?: string
    drop?: string
  }

describe('writes a role makes at the same time', () => {
  test('all land: board changes, memories and thread messages', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await Promise.all([
      write($, 'a-pm-1', [{ op: 'add_feature', title: '甲', summary: '' }]),
      write($, 'a-pm-1', [{ op: 'add_feature', title: '乙', summary: '' }]),
      call($, 'memory_save', { type: 'MEM', text: '第一條事實' }, 'a-pm-1'),
      call($, 'memory_save', { type: 'MEM', text: '第二條事實' }, 'a-pm-1'),
      call($, 'thread_post', { item: 'AC-001', to: 'qa', text: '一' }, 'a-pm-1'),
      call($, 'thread_post', { item: 'AC-001', to: 'qa', text: '二' }, 'a-pm-1'),
    ])
    expect(w.board()?.prd_items.map(i => i.title).sort()).toEqual(['乙', '甲'])
    expect(parseMemories(w.disk.get(MEMORIES) ?? '').map(m => m.id)).toEqual(['MEM-001', 'MEM-002'])
    expect((w.disk.get(`${ROOT}/.crew/threads/AC-001.jsonl`) ?? '').split('\n').filter(Boolean)).toHaveLength(2)
  })
})

describe('QA’s questions', () => {
  test('come back to QA with the person’s answer', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    await done($, 'a-pm-1')
    await call($, 'ask_person', { question: '到期日用哪個時區？', item: 'AC-002' }, 'a-qa-2')
    await done($, 'a-qa-2')
    await $.command.run(command('answer Q-01 台北時間'))
    expect(w.sent.at(-1)?.to).toBe('a-qa-2')
    expect((await $.command.run(command('thread AC-002'))).text).toMatch(/使用者 → QA：到期日用哪個時區？ → 台北時間/)
  })
})

describe('work the person started', () => {
  test('does not wake the brain when the flow finishes, nor when a run fails', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    await done($, 'a-pm-1')
    await $.turn.complete({ answer: '', durationMs: 5, isAborted: false, turnId: 'x', reason: 'error', agentId: 'a-qa-2' } as never)
    expect((await notice($, 'a-qa-2')).drop).toBeDefined()
    await $.command.run(command('resume'))
    await write($, 'a-qa-3', [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }])
    await done($, 'a-qa-3')
    expect((await $.command.run(command('status'))).text).toMatch(/done/)
    expect((await notice($, 'a-qa-3')).drop).toBeDefined()
    await w.clock.advance(61_000)
    expect(w.prompts).toEqual([])
  })
})

describe('a decision the brain relayed', () => {
  test('is the person’s: no role can replace it', async ($, on) => {
    world($, on)
    await start($)
    await call($, 'crew', { action: 'start', path: 'docs/PRD.md' })
    await call($, 'ask_person', { question: '年繳？' }, 'a-pm-1')
    await call($, 'crew', { action: 'answer', question: 'Q-01', text: '不做' })
    const r = await call($, 'memory_save', { type: 'DEC', text: '改成做', supersedes: 'DEC-001' }, 'a-pm-1')
    expect(String(r.result)).toMatch(/只有使用者能改/)
  })
})

describe('the other side of each rule', () => {
  test('a key that straddles where a log line is cut is still masked', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await done($, 'a-pm-1', `${'說'.repeat(990)} sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123`)
    expect(w.disk.get(LOG)).not.toMatch(/sk-[A-Za-z]/)
  })

  test('a memory a role saved itself is not handed back to it', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    await call($, 'memory_save', { type: 'MEM', text: 'AC-002 的價格含稅', refs: ['AC-002'] }, 'a-pm-1')
    await done($, 'a-pm-1')
    await write($, 'a-qa-2', [{ op: 'add_test_case', criteria: ['AC-001'], title: 't', steps: ['s'], expected: 'e' }])
    await done($, 'a-qa-2')
    expect(w.sent.at(-1)?.to).toBe('a-pm-1')
    expect(w.sent.at(-1)?.text).not.toMatch(/MEM-001/)
  })

  test('after a restart, the threads a role had are history, not unread mail', async ($, on) => {
    const w = world($, on)
    w.disk.set(`${ROOT}/.crew/threads/AC-001.jsonl`, `${JSON.stringify({ t: 1, n: 1, item: 'AC-001', from: 'qa', to: 'pm', text: '舊問題' })}\n`)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    expect(w.spawned[0]?.prompt).not.toMatch(/討論串有留言給你/)
  })

  test('the daily tidy-up can replace a fact it saved itself', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    w.replies.push('[{"type":"MEM","text":"上限 100 字"}]')
    await $.command.run(command('consolidate'))
    w.replies.push('[{"type":"MEM","text":"上限改成 200 字","supersedes":"MEM-001"}]')
    await $.command.run(command('consolidate'))
    expect(parseMemories(w.disk.get(MEMORIES) ?? '').find(m => m.id === 'MEM-001')?.supersededBy).toBe('MEM-002')
  })
})

describe('third test review', () => {
  test('a finished flow opens again when the PM, asked by the person, adds a criterion', async ($, on) => {
    world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    await done($, 'a-pm-1')
    await write($, 'a-qa-2', [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }])
    await done($, 'a-qa-2')
    expect((await $.command.run(command('status'))).text).toMatch(/done/)
    await $.command.run(command('ask pm 補一條：可以改方案'))
    await write($, 'a-pm-1', [{ op: 'add_criterion', feature: 'PRD-001', text: '可以改方案' }])
    await done($, 'a-pm-1', '補了 AC-003')
    expect((await $.command.run(command('status'))).text).toMatch(/adding_tests/)
  })

  test('crew reads none of its files through a link that leads out of the repo', async ($, on) => {
    const w = world($, on)
    w.disk.set('/elsewhere/memories.jsonl', `${JSON.stringify({ id: 'MEM-001', type: 'MEM', text: '外面的秘密筆記', refs: [], roles: [], source: 'x', t: 1 })}\n`)
    w.disk.set('/elsewhere/log.jsonl', '{"kind":"report","text":"外面的流水帳"}\n')
    w.links.set(`${ROOT}/.crew/memory/memories.jsonl`, '/elsewhere/memories.jsonl')
    w.links.set(`${ROOT}/.crew/log/2026-10-14.jsonl`, '/elsewhere/log.jsonl')
    await start($)
    expect((await $.command.run(command('recall 秘密筆記'))).text).toMatch(/沒有找到/)
    expect((await $.command.run(command('consolidate 2026-10-14'))).text).toMatch(/沒有流水帳/)
    expect(w.completions).toEqual([])
  })

  test('a board that links to another file in the repo is refused too', async ($, on) => {
    const w = world($, on)
    w.disk.set(`${ROOT}/other.json`, '{}')
    w.links.set(`${ROOT}/prd-tracker.json`, `${ROOT}/other.json`)
    await start($)
    expect((await $.command.run(command('start docs/PRD.md'))).text).toMatch(/是連結/)
  })

  test('cuts long questions and answers', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await call($, 'ask_person', { question: '問'.repeat(800) }, 'a-pm-1')
    await $.command.run(command(`answer Q-01 ${'答'.repeat(800)}`))
    const state = w.store.get(`state:${ROOT}`) as { questions: { question: string; answer?: string }[] }
    expect([...(state.questions[0]?.question ?? '')].length).toBe(501)
    expect([...(state.questions[0]?.answer ?? '')].length).toBe(501)
  })

  test('numbers with the default prefixes when the schema does not parse', async ($, on) => {
    const w = world($, on)
    w.disk.set(`${ROOT}/schemas/prd-tracker.schema.json`, '{ nope')
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    expect(String((await write($, 'a-pm-1', SPLIT)).result)).toMatch(/PRD-001/)
  })

  test('says the flow stopped, and why, when a role ends on a board it cannot read', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    w.disk.set(`${ROOT}/prd-tracker.json`, '{ broken')
    await done($, 'a-pm-1')
    expect(w.toasts.some(t => /流程停在這裡。prd-tracker\.json 讀不懂/.test(t))).toBe(true)
  })

  test('resume says why it cannot go on with a board it cannot read', async ($, on) => {
    const w = world($, on, { stopped: ['a-pm-1'] })
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    w.disk.set(`${ROOT}/prd-tracker.json`, '{ broken')
    expect((await $.command.run(command('resume'))).text).toMatch(/沒有接續：prd-tracker\.json 讀不懂/)
  })
})
