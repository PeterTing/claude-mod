import type { PromptOrigin, RenderPropsOf } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { build, command, designed, done, PLAN, ROOT, SPLIT, start, world, write } from './world'

describe('crew, PM and QA', () => {
  test('registers its tools and its roles when the session starts', async ($, on) => {
    const w = world($, on)
    await start($)
    expect(w.registered.tools).toEqual(['board_read', 'board_write', 'thread_post', 'thread_read', 'ask_person', 'review_submit', 'memory_save', 'memory_search', 'crew'])
    expect(w.registered.agents).toEqual(['pm', 'qa', 'uiux', 'techlead', 'fullstack'])
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
    expect(w.disk.get(`${ROOT}/.crew/.gitignore`)).toBe('usage/\nlog/\nwork/\nruns/\n')

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
    // Every criterion tested: the designer designs each feature, and the person approves the designs.
    expect(w.spawned[2]).toMatchObject({ subagentType: 'crew:uiux', model: 'sonnet' })
    await designed($)
    // Every design approved: the tech lead breaks the criteria into tasks.
    expect(w.spawned[3]).toMatchObject({ subagentType: 'crew:techlead', model: 'opus' })
    expect(w.spawned[3]?.prompt).toMatch(/2 條驗收條件[\s\S]*add_task/)
    await write($, 'a-techlead-4', PLAN)
    await done($, 'a-techlead-4')
    // Every criterion planned: the full-stack builds the tasks, one at a time.
    expect(w.spawned[4]).toMatchObject({ subagentType: 'crew:fullstack', model: 'sonnet' })
    expect(w.spawned[4]?.prompt).toMatch(/TASK-001[\s\S]*工作目錄：\/repo\/\.crew\/work\/prd（分支 crew\/prd）/)
    await build($)
    expect(w.toasts.at(-1)).toMatch(/G4 2\/2[\s\S]*G3 2\/2[\s\S]*G5 2\/2/)

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
    // The PRD's requirement, two features with criteria, one criterion with a test case; two designs, two criteria to plan, two cases to run.
    expect(status.text).toMatch(/進度 36%（4\/11）/)
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
    expect((await $.command.run(command('status'))).text).toMatch(/designing/)
    await designed($)
    expect((await $.command.run(command('status'))).text).toMatch(/planning/)
    await write($, 'a-techlead-4', PLAN)
    await done($, 'a-techlead-4')
    await build($)
    const after = await $.command.run(command('status'))
    expect(after.text).toMatch(/done/)
    const usage = JSON.parse(w.disk.get(`${ROOT}/.crew/usage/2026-10-15.json`) ?? '{}') as { usage: Record<string, { wakes: number }> }
    expect([usage.usage.pm?.wakes, usage.usage.qa?.wakes]).toEqual([2, 1])
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
    expect(w.spawned[2]?.prompt).toMatch(/^crew 幫你換了新的 context（原本的對話叫不醒[\s\S]*## 目前狀況\n[\s\S]*還沒有：AC-002[\s\S]*## 這次的工作\n[\s\S]*AC-002 取消後仍可使用到期末/)
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
      // The real board, not the design preview: no preview label, and the designer's row is a real one.
      expect(text).not.toMatch(/（設計稿）|示意資料/)
      expect(text).toMatch(/整體進度/)
      expect(text).toMatch(/UI\/UX\n待命/)
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
