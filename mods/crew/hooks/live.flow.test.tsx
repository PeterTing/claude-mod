import type { CommandRunInput, On, PromptOrigin, RenderPropsOf, SessionStartInput, TurnCompleteInput } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { Tracker } from './board'

/**
 * crew end to end inside the kit: a repo on an in-memory disk, the PM and QA
 * played by the test through the same tool calls and turn ends a session has.
 */

const ROOT = '/repo'
const NOW = Date.UTC(2026, 9, 15, 6, 0, 0)

const PRD = '# 會員訂閱\n\n使用者可以選月繳方案，可以隨時取消，取消後用到期末。'

type Spawn = { subagentType: string; name?: string; description: string; model?: string; prompt: string }

const world = (engine: Engine, on: On, { deliver = true } = {}) => {
  mock.clock(on, { now: NOW })
  const disk = new Map<string, string>([[`${ROOT}/docs/PRD.md`, PRD]])
  const spawned: Spawn[] = []
  const sent: { to: string; text: string }[] = []
  const toasts: string[] = []
  const registered = { tools: [] as string[], agents: [] as string[] }
  on('fs.exists', (_$, e) => ({ value: disk.has(e.path) }))
  on('fs.read', (_$, e) => (disk.has(e.path) ? { value: disk.get(e.path) ?? '' } : { deny: `ENOENT ${e.path}` }))
  on('fs.write', (_$, e) => {
    disk.set(e.path, e.text)
    return { value: undefined }
  })
  on('tool.register', (_$, e) => {
    registered.tools.push(e.name)
    return { value: { tool: `mcp__crew__${e.name}` } }
  })
  on('agent.register', (_$, e) => {
    registered.agents.push(e.name)
    return { value: { agent: `crew:${e.name}` } }
  })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  // The kit hands a plugin's spawn down as the Agent tool's input, and keeps the agent id to the engine:
  // the plugin finds its agent in the list instead, as it would behind a hook that kept the id back.
  on('agent.spawn', (_$, e) => {
    const input = e as unknown as { subagent_type?: string; subagentType?: string; name?: string; description: string; model?: string; prompt: string }
    spawned.push({
      subagentType: input.subagentType ?? input.subagent_type ?? '',
      description: input.description,
      prompt: input.prompt,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.model === undefined ? {} : { model: input.model }),
    })
    return { model: input.model ?? 'claude-sonnet-5-5' }
  })
  on('agent.list', () => ({
    value: spawned.map((s, i) => ({ id: `a-${s.subagentType.replace('crew:', '')}-${i + 1}`, spawnedBy: 'crew', type: s.subagentType, status: 'running', description: s.description })),
  }))
  // Resuming a finished agent asks whether its type is offered, as the engine does.
  on('session.send', async (_$, e) => {
    sent.push({ to: String(e.to), text: e.text })
    const offer = (await engine.agent.offer({ agent: 'crew:pm', description: 'crew PM', source: 'plugin', provider: { plugin: 'crew', tier: 'user' } } as never)) as { isOffered: boolean }
    if (!offer.isOffered) return { isDelivered: false, reason: "Agent type 'crew:pm' is not offered in this session." }
    return deliver ? { isDelivered: true } : { isDelivered: false, reason: 'Agent could not be resumed' }
  })
  on('agent.offer', () => ({ isOffered: true }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  const board = () => JSON.parse(disk.get(`${ROOT}/prd-tracker.json`) ?? 'null') as Tracker | null
  return { disk, spawned, sent, toasts, registered, board }
}

const start = ($: Engine) => $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as SessionStartInput)

const command = (args: string): CommandRunInput => ({
  command: 'crew',
  args,
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 140 },
})

const write = ($: Engine, agentId: string, ops: unknown[]) =>
  $.tool.call({ tool: 'mcp__crew__board_write', tool_use_id: `t-${Math.random()}`, agentId, ops } as never) as Promise<{ result: unknown }>

const done = ($: Engine, agentId: string) =>
  $.turn.complete({ answer: '完成', durationMs: 5, isAborted: false, turnId: `turn-${agentId}`, reason: 'answer', agentId } as TurnCompleteInput)

const SPLIT = [
  { op: 'add_feature', title: '方案選擇', summary: '選月繳' },
  { op: 'add_feature', title: '取消訂閱', summary: '用到期末' },
  { op: 'add_criterion', feature: 'PRD-001', text: '可以選月繳方案' },
  { op: 'add_criterion', feature: 'PRD-002', text: '取消後仍可使用到期末' },
]

describe('crew, PM and QA', () => {
  test('registers its tools and its two roles when the session starts', async ($, on) => {
    const w = world($, on)
    await start($)
    expect(w.registered.tools).toEqual(['board_read', 'board_write', 'thread_post', 'thread_read', 'ask_person'])
    expect(w.registered.agents).toEqual(['pm', 'qa'])
  })

  test('walks a PRD from split to every criterion covered', async ($, on) => {
    const w = world($, on)
    await start($)

    const started = await $.command.run(command('start docs/PRD.md'))
    expect(started.text).toMatch(/PM 正在拆 docs\/PRD\.md/)
    expect(w.spawned[0]).toMatchObject({ subagentType: 'crew:pm', model: 'sonnet' })
    // Unnamed, so a team-enabled session runs it as a background agent, not a teammate.
    expect(w.spawned[0]?.name).toBeUndefined()
    expect(w.spawned[0]?.prompt).toMatch(/docs\/PRD\.md/)
    expect(w.board()?.mode).toBe('local-only')
    expect(w.disk.get(`${ROOT}/.crew/.gitignore`)).toBe('usage/\n')

    const wrote = await write($, 'a-pm-1', SPLIT)
    expect(String(wrote.result)).toMatch(/已寫入：PRD-001、PRD-002、AC-001、AC-002/)
    await done($, 'a-pm-1')
    expect(w.spawned[1]).toMatchObject({ subagentType: 'crew:qa', model: 'sonnet' })

    await write($, 'a-qa-2', [{ op: 'add_test_case', criteria: ['AC-001'], title: '選月繳', steps: ['選月繳'], expected: '扣款成功' }])
    await done($, 'a-qa-2')
    expect(w.sent.at(-1)?.to).toBe('a-pm-1')
    expect(w.sent.at(-1)?.text).toMatch(/AC-002 取消後仍可使用到期末/)
    expect(w.disk.get(`${ROOT}/.crew/threads/AC-002.jsonl`)).toMatch(/AC-002/)

    await $.tool.call({ tool: 'mcp__crew__thread_post', tool_use_id: 't-post', agentId: 'a-pm-1', item: 'AC-002', to: 'qa', text: '要做：取消後到期前登入仍可使用' } as never)
    await done($, 'a-pm-1')
    expect(w.sent.at(-1)?.to).toBe('a-qa-2')
    const thread = await $.tool.call({ tool: 'mcp__crew__thread_read', tool_use_id: 't-read', agentId: 'a-qa-2', item: 'AC-002' } as never)
    expect(String((thread as { result: unknown }).result)).toMatch(/pm → qa：要做/)

    await write($, 'a-qa-2', [{ op: 'add_test_case', criteria: ['AC-002'], title: '取消後仍可用', steps: ['取消', '登入'], expected: '可以使用' }])
    await done($, 'a-qa-2')
    expect(w.toasts.at(-1)).toMatch(/G4 2\/2/)

    const tracker = w.board()
    expect(tracker?.prd_items.flatMap(i => i.test_cases.map(c => c.id))).toEqual(['TC-001', 'TC-002'])
    expect(tracker?.summary).toMatchObject({ total_prds: 2, total_test_cases: 2 })
  })

  test('counts as done only what moves progress: a feature’s first criterion, a criterion’s first test case', async ($, on) => {
    world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    await done($, 'a-pm-1')
    await write($, 'a-qa-2', [
      { op: 'add_test_case', criteria: ['AC-001'], title: '選月繳', steps: ['s'], expected: 'e' },
      { op: 'add_test_case', criteria: ['AC-001'], title: '選月繳，餘額不足', steps: ['s'], expected: 'e' },
    ])
    const status = await $.command.run(command('status'))
    expect(status.text).toMatch(/進度 75%（3\/4）/)
    const ui = await $.ui.mount({
      plugin: 'crew',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'crew',
      props: { title: 'Crew', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 60 } } as unknown as RenderPropsOf['Pane'],
    })
    const text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
    expect(text).toMatch(/今天完成 3 項/)
  })

  test('wakes the PM for a question QA left in a thread, and counts each role’s wakes', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    await done($, 'a-pm-1')
    await write($, 'a-qa-2', [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: '全部', steps: ['s'], expected: 'e' }])
    await $.tool.call({ tool: 'mcp__crew__thread_post', tool_use_id: 't-q', agentId: 'a-qa-2', item: 'AC-002', to: 'pm', text: '到期日用哪個時區？' } as never)
    await done($, 'a-qa-2')
    expect(w.sent.at(-1)).toMatchObject({ to: 'a-pm-1' })
    expect(w.sent.at(-1)?.text).toMatch(/AC-002[\s\S]*thread_read/)
    const status = await $.command.run(command('status'))
    expect(status.text).toMatch(/confirming/)

    await done($, 'a-pm-1')
    const after = await $.command.run(command('status'))
    expect(after.text).toMatch(/done/)
  })

  test('starts the role again with the message when it cannot be woken', async ($, on) => {
    const w = world($, on, { deliver: false })
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    await done($, 'a-pm-1')
    await write($, 'a-qa-2', [{ op: 'add_test_case', criteria: ['AC-001'], title: '選月繳', steps: ['s'], expected: 'e' }])
    await done($, 'a-qa-2')
    expect(w.spawned).toHaveLength(3)
    expect(w.spawned[2]).toMatchObject({ subagentType: 'crew:pm' })
    expect(w.spawned[2]?.prompt).toMatch(/AC-002[\s\S]*board_read/)
  })

  test('hides the roles from the main model only', async ($, on) => {
    world($, on)
    await start($)
    const offer = await $.agent.offer({ agent: 'crew:pm', description: 'crew PM', source: 'plugin', provider: { plugin: 'crew', tier: 'user' } } as never)
    expect((offer as { isOffered: boolean }).isOffered).toBe(false)
  })

  test('lists the questions already waiting for the person when a role reads the board', async ($, on) => {
    world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    await $.tool.call({ tool: 'mcp__crew__ask_person', tool_use_id: 't-ask', agentId: 'a-pm-1', question: '超過 100 字怎麼處理？' } as never)
    const read = await $.tool.call({ tool: 'mcp__crew__board_read', tool_use_id: 't-read', agentId: 'a-pm-1' } as never)
    expect(String((read as { result: unknown }).result)).toMatch(/等使用者回答[\s\S]*Q-01 超過 100 字怎麼處理？/)
  })

  test('takes a role’s completion notice at the mailbox, before it becomes a prompt', async ($, on) => {
    world($, on)
    on('session.receive', (_$, e) => ({ text: e.text }))
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    const r = await $.session.receive({ text: '<task-notification><task-id>a-pm-1</task-id></task-notification>', origin: { kind: 'task-notification' } } as never)
    expect(typeof (r as { consumed?: string }).consumed).toBe('string')
  })

  test('keeps each role to its own kind of change', async ($, on) => {
    world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    await done($, 'a-pm-1')
    const r = await write($, 'a-qa-2', [{ op: 'add_feature', title: '偷加功能', summary: '' }])
    expect(String(r.result)).toMatch(/沒有生效[\s\S]*QA 不能做 add_feature/)
  })

  test('tells a role what is wrong with ops it wrote', async ($, on) => {
    world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    const r = await write($, 'a-pm-1', [{ op: 'add_criterion', feature: 'PRD-001' }])
    expect(String(r.result)).toMatch(/第 1 筆 add_criterion 缺少 text/)
  })

  test('drops a role’s completion notice so the main conversation is not woken', async ($, on) => {
    world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    const r = await $.prompt.submit({ text: '<task-notification><task-id>a-pm-1</task-id></task-notification>', wait: false, origin: { kind: 'task-notification' } as PromptOrigin, isMeta: true })
    expect(typeof (r as { drop?: string }).drop).toBe('string')
    const other = await $.prompt.submit({ text: '<task-notification><task-id>a-other</task-id></task-notification>', wait: false, origin: { kind: 'task-notification' } as PromptOrigin, isMeta: true })
    expect(other.drop).toBeUndefined()
  })

  test('keeps a role’s team-mailbox message from the main conversation, and lets others through', async ($, on) => {
    world($, on)
    on('session.receive', (_$, e) => ({ text: e.text }))
    await start($)
    const fromCrew = await $.session.receive({ text: 'QA 寫完了 26 個 test case', origin: { kind: 'peer', teammate: 'crew-qa', isVerified: true } } as never)
    expect(typeof (fromCrew as { consumed?: string }).consumed).toBe('string')
    const fromOther = await $.session.receive({ text: 'hello', origin: { kind: 'peer', teammate: 'researcher', isVerified: true } } as never)
    expect((fromOther as { consumed?: string }).consumed).toBeUndefined()
    const toAgent = await $.session.receive({ text: 'x', origin: { kind: 'peer', teammate: 'crew-pm', isVerified: true }, agentId: 'a-qa-2' } as never)
    expect((toAgent as { consumed?: string }).consumed).toBeUndefined()
  })

  test('drops a peer prompt that names a crew role', async ($, on) => {
    world($, on)
    await start($)
    const r = await $.prompt.submit({ text: 'Message from @crew-qa: done', wait: false, origin: { kind: 'peer' } as PromptOrigin })
    expect(typeof (r as { drop?: string }).drop).toBe('string')
    const other = await $.prompt.submit({ text: 'Message from @researcher: done', wait: false, origin: { kind: 'peer' } as PromptOrigin })
    expect((other as { drop?: string }).drop).toBeUndefined()
  })

  test('passes a question to the person and their answer back to the role', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    const asked = await $.tool.call({ tool: 'mcp__crew__ask_person', tool_use_id: 't-ask', agentId: 'a-pm-1', question: '年繳要不要做？', item: 'PRD-001' } as never)
    expect(String((asked as { result: unknown }).result)).toMatch(/Q-01/)
    expect(w.toasts.at(-1)).toMatch(/\/crew answer Q-01/)

    const status = await $.command.run(command('status'))
    expect(status.text).toMatch(/待你決定 1/)

    const answered = await $.command.run(command('answer Q-01 這一版不做年繳'))
    expect(answered.text).toMatch(/轉給 PM/)
    expect(w.sent.at(-1)).toMatchObject({ to: 'a-pm-1' })
    expect(w.sent.at(-1)?.text).toMatch(/年繳要不要做？[\s\S]*這一版不做年繳/)

    const again = await $.command.run(command('answer Q-01 再答一次'))
    expect(again.text).toMatch(/用法/)
  })

  test('draws the pane and the line above the prompt from the real board', async ($, on) => {
    world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({
        plugin: 'crew',
        surface,
        component: 'Pane',
        requestId: 'crew',
        props: { title: 'Crew', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 60 } } as unknown as RenderPropsOf['Pane'],
      })
      const text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
      expect(text).not.toMatch(/設計稿/)
      expect(text).toMatch(/整體進度/)
      expect(text).toMatch(/第 4 階段加入/)
      expect(await ui.find({ key: 'gate-G1' })).toBeDefined()
      await ui.unmount()
    }
    const band = await $.ui.mount({
      plugin: 'crew',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 2, bodyColumns: 140 } as unknown as RenderPropsOf['AbovePrompt'],
    })
    const line = (await band.findAll({ type: 'Text' })).map(t => t.text).join('')
    expect(line).toMatch(/^crew │ 進度/)
  })

  test('says what is missing when the PRD path is wrong or absent', async ($, on) => {
    world($, on)
    await start($)
    expect((await $.command.run(command('start'))).text).toMatch(/用法/)
    expect((await $.command.run(command('start docs/NOPE.md'))).text).toMatch(/找不到 docs\/NOPE\.md/)
  })
})
