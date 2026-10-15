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
    expect(w.disk.get(LOG)).not.toMatch(/sk-ant-api03/)
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
