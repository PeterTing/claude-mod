import type { RenderPropsOf } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { MAX_REQUIREMENTS } from './prd'
import { BRAIN_SECTION } from './roles'
import { command, done, paneText, paneUi, ROOT, SPLIT, start, textOf, world, write } from './world'

/** The brain leading a repo: the person's switch, the prompt it gives the main conversation, and the PRD it drafts. */

const SETTINGS = `settings:${ROOT}`
const STATE = `state:${ROOT}`
const DRAFT = `${ROOT}/docs/crew/v2-PRD.md`
const DRAFT_TEXT = '# 待辦清單 v2\n\n## 背景\n\n- 給自己用\n- 限制：純前端\n\n## 需求\n\n- 可以編輯事項\n- 可以清除全部已完成\n'

const crew = ($: Engine, input: Record<string, unknown>) =>
  $.tool.call({ tool: 'mcp__crew__crew', tool_use_id: `c-${Math.random()}`, ...input } as never) as Promise<{ result: string }>

/** The facts the engine composes the main conversation's prompt from, with the tools it offers. */
const facts = (tools: string[], traits: string[] = []) => ({ model: 'm', promptModel: 'm', surfaces: ['terminal'], tools, outputStyle: null, traits })

/** The engine's own prompt under crew's hook: the test kit has none. */
const engineSections = (on: Parameters<typeof world>[1]) => on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' as const }] }))

const composed = async ($: Engine, tools = ['mcp__crew__crew'], traits: string[] = []) =>
  (await $.prompt.compose(facts(tools, traits) as never)).sections as { id: string; text: string; scope: string }[]

const band = async ($: Engine) => {
  const ui = await $.ui.mount({ plugin: 'crew', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false } as unknown as RenderPropsOf['AbovePrompt'] })
  const text = await textOf(ui)
  await ui.unmount()
  return text
}

const press = async ($: Engine, key: string, tab?: string) => {
  const ui = await paneUi($)
  if (tab !== undefined) await ui.press({ key: `tab-${tab}` })
  await ui.press({ key })
  await ui.unmount()
}

/** crew draws no line: the engine's own, which the test kit does not have, would be asked. */
const noBand = ($: Engine) => expect(band($)).rejects.toThrow(/no implementation for ui\.render/)

/** The person lets the brain lead, and the brain sends its draft to be reviewed. */
const drafted = async ($: Engine, w: ReturnType<typeof world>) => {
  await $.command.run(command('lead on'))
  w.disk.set(DRAFT, DRAFT_TEXT)
  return crew($, { action: 'draft', path: 'docs/crew/v2-PRD.md' })
}

describe('the person lets the brain lead a repo', () => {
  test('offers the switch on the start screen, keeps it on this machine and redraws the pane at once', async ($, on) => {
    const w = world($, on)
    await start($)
    const before = [...w.disk.keys()].sort()
    const ui = await paneUi($)
    expect((await ui.findAll({ type: 'Button' })).map(b => b.props.label)).toContain('讓大腦接手這個 repo')
    await ui.press({ key: 'takeover-on' })
    expect(w.store.get(SETTINGS)).toMatchObject({ takeover: true })
    expect(w.toasts.at(-1)).toMatch(/大腦接手這個 repo：從現在起由大腦主導/)
    expect(await textOf(ui)).toMatch(/大腦接手中：在主對話說你要做什麼。/)
    await ui.unmount()
    expect([...w.disk.keys()].sort()).toEqual(before)
  })

  test('takes /crew lead on and off, says when nothing changes, and how to use it', async ($, on) => {
    const w = world($, on)
    await start($)
    expect((await $.command.run(command('lead off'))).text).toMatch(/本來就沒有讓大腦接手/)
    expect((await $.command.run(command('lead on'))).text).toMatch(/從現在起由大腦主導/)
    expect((await $.command.run(command('lead on'))).text).toMatch(/已經由大腦接手/)
    expect((await $.command.run(command('lead off'))).text).toMatch(/大腦不再接手這個 repo/)
    expect(w.store.get(SETTINGS)).toMatchObject({ takeover: false })
    expect((await $.command.run(command('lead maybe'))).text).toMatch(/用法：\/crew lead on\|off/)
  })

  test('is the person’s alone: neither the brain’s tool nor a command another plugin runs can turn it on', async ($, on) => {
    const w = world($, on)
    await start($)
    expect((await crew($, { action: 'lead', text: 'on' })).result).toMatch(/action 要是/)
    const byPlugin = await $.command.run({ ...command('lead on'), origin: { kind: 'plugin', name: 'other' } } as never)
    expect(byPlugin.text).toBe('大腦接手要使用者自己在右側面板的「設定」分頁打開或關掉。')
    expect(w.store.get(SETTINGS)).toBeUndefined()
  })

  test('switches from the settings tab, both ways', async ($, on) => {
    const w = world($, on)
    await start($)
    expect(await paneText($, 'settings')).toMatch(/現在：不接手，你叫 crew 時它才做事/)
    await press($, 'takeover-on', 'settings')
    expect(await paneText($, 'settings')).toMatch(/現在：接手，這個 repo 每個 session 從第一句話起由大腦主導/)
    await press($, 'takeover-off', 'settings')
    expect(w.store.get(SETTINGS)).toMatchObject({ takeover: false })
    const settings = await paneText($, 'settings')
    expect(settings).toMatch(/現在：不接手，你叫 crew 時它才做事/)
    expect(settings).toMatch(/只影響這個 repo。設定存在這台電腦，不進 git/)
  })

  test('counts a store it cannot read as not leading', async ($, on) => {
    const w = world($, on)
    engineSections(on)
    w.store.set(SETTINGS, { takeover: true })
    await start($)
    w.broken.storeReads = 'settings:'
    expect((await composed($)).map(s => s.id)).not.toContain('crew:brain')
    expect((await crew($, { action: 'draft', path: 'docs/PRD.md' })).result).toMatch(/沒有讓大腦接手/)
    await noBand($)
  })
})

describe('the prompt of the main conversation', () => {
  test('carries the brain’s part, last and on the session side, only while the brain leads', async ($, on) => {
    world($, on)
    engineSections(on)
    await start($)
    expect((await composed($)).map(s => s.id)).toEqual(['intro'])
    await $.command.run(command('lead on'))
    const sections = await composed($)
    expect(sections.map(s => s.id)).toEqual(['intro', 'crew:brain'])
    expect(sections.at(-1)).toEqual({ id: 'crew:brain', text: BRAIN_SECTION, scope: 'session' })
    expect(BRAIN_SECTION).toMatch(/^# crew 大腦/)
    expect(BRAIN_SECTION).toMatch(/「## 背景」裡的內容不會被算成需求/)
  })

  test('is not for the roles or a teammate’s render', async ($, on) => {
    world($, on)
    engineSections(on)
    await start($)
    await $.command.run(command('lead on'))
    expect((await composed($, ['Read', 'mcp__crew__board_read'])).map(s => s.id)).toEqual(['intro'])
    expect((await composed($, ['mcp__crew__crew'], ['teammate'])).map(s => s.id)).toEqual(['intro'])
  })
})

describe('a switch in a conversation under way', () => {
  test('tells the brain in the conversation, since its prompt was composed already: the last switch', async ($, on) => {
    const w = world($, on)
    engineSections(on)
    await start($)
    // Before the first turn, the prompt carries it: nothing to say.
    await $.command.run(command('lead on'))
    await $.command.run(command('lead off'))
    await w.clock.advance(61_000)
    expect(w.prompts).toEqual([])

    await composed($)
    await $.command.run(command('lead on'))
    await $.command.run(command('lead off'))
    await $.command.run(command('lead on'))
    await w.clock.advance(61_000)
    // A command's own hook may not submit a prompt: crew says it from a timer, and only the switch still news by then.
    const told = w.prompts.filter(p => /使用者剛/.test(p))
    expect(told.map(p => (/使用者剛關掉/.test(p) ? 'off' : 'on'))).toEqual(['on'])
    expect(told.at(-1)).toMatch(/^\[crew\] 使用者剛讓你接手這個 repo。從現在起照下面的方式工作/)
    expect(told.at(-1)).toContain(BRAIN_SECTION)
  })

  test('tells the brain it no longer leads', async ($, on) => {
    const w = world($, on)
    engineSections(on)
    await start($)
    await $.command.run(command('lead on'))
    await composed($)
    await press($, 'takeover-off', 'settings')
    await w.clock.advance(61_000)
    expect(w.prompts.some(p => /^\[crew\] 使用者剛關掉大腦接手：從現在起不再照「# crew 大腦」那段做/.test(p))).toBe(true)
  })

  test('still tells the brain after crew reloads: the conversation keeps its prompt', async ($, on) => {
    const w = world($, on)
    engineSections(on)
    await start($)
    await composed($)
    await start($)
    await $.command.run(command('lead on'))
    await w.clock.advance(1)
    expect(w.prompts.filter(p => /使用者剛讓你接手/.test(p))).toHaveLength(1)
  })

  test('says nothing to a new conversation (a /clear) before its first turn: its prompt will carry it', async ($, on) => {
    const w = world($, on)
    engineSections(on)
    await start($)
    await composed($)
    w.session.id = 'session-2'
    await $.command.run(command('lead on'))
    await w.clock.advance(61_000)
    expect(w.prompts).toEqual([])
    expect((await composed($)).map(s => s.id)).toContain('crew:brain')
  })

  test('says it at once from the pane when no role works', async ($, on) => {
    const w = world($, on)
    engineSections(on)
    await start($)
    await composed($)
    await press($, 'takeover-on', 'settings')
    await w.clock.advance(1)
    expect(w.submitted.filter(s => /^\[crew\] 使用者剛讓你接手/.test(s.text))).toHaveLength(1)
  })

  test('waits with the other notes while a role works, so a role’s notice cannot drop it', async ($, on) => {
    const w = world($, on)
    engineSections(on)
    await start($)
    await composed($)
    await crew($, { action: 'ask', role: 'pm', text: '現在進度？' })
    await press($, 'takeover-on', 'settings')
    await w.clock.advance(1)
    expect(w.submitted.filter(s => /使用者剛/.test(s.text))).toEqual([])
    const early = $.prompt.submit({ text: '<task-notification><task-id>a-pm-1</task-id></task-notification>', wait: false, origin: { kind: 'task-notification' } } as never) as Promise<{ text?: string }>
    await done($, 'a-pm-1', '還沒開始')
    expect((await early).text).toMatch(/使用者剛讓你接手這個 repo/)
  })
})

describe('the brain’s draft PRD', () => {
  test('is for a repo the brain leads', async ($, on) => {
    const w = world($, on)
    await start($)
    w.disk.set(DRAFT, DRAFT_TEXT)
    expect((await crew($, { action: 'draft', path: 'docs/crew/v2-PRD.md' })).result).toMatch(/這個 repo 沒有讓大腦接手/)
    expect((await crew($, { action: 'ready' })).result).toMatch(/這個 repo 沒有讓大腦接手/)
    expect(w.spawned).toEqual([])
  })

  test('goes to PM and UI/UX with the whole path, each with its own thread, and shows in the pane and the line', async ($, on) => {
    const w = world($, on)
    await start($)
    const r = await drafted($, w)
    expect(r.result).toBe('已請 PM 和 UI/UX 審 docs/crew/v2-PRD.md（2 條需求），審完會通知你。')
    expect(w.spawned.map(s => s.subagentType)).toEqual(['crew:pm', 'crew:uiux'])
    const pm = w.spawned[0]?.prompt ?? ''
    expect(pm).toMatch(/審草稿 docs\/crew\/v2-PRD\.md（ASK-01）\n大腦請你審這份 PRD 草稿。用 Read 讀 \/repo\/docs\/crew\/v2-PRD\.md，找出需求寫不清楚/)
    expect(w.spawned[1]?.prompt).toMatch(/（ASK-02）[\s\S]*找出使用者會看到的部分/)
    expect(pm).toMatch(/第一行只寫「缺口 N 個」/)
    const pane = await paneText($)
    expect(pane).toMatch(/大腦接手中 · PRD 草稿 待辦清單 v2/)
    expect(pane).toMatch(/PRD 草稿：docs\/crew\/v2-PRD\.md　待辦清單 v2（2 條需求）/)
    expect(pane).toMatch(/審查：PM 審查中 · UI\/UX 審查中/)
    expect(await band($)).toMatch(/PRD 草稿 待辦清單 v2 · PM 審查中 · UI\/UX 審查中/)
    expect((w.store.get(STATE) as { draft?: { path: string } }).draft?.path).toBe('docs/crew/v2-PRD.md')
  })

  test('says how to use it with no path', async ($, on) => {
    world($, on)
    await start($)
    await $.command.run(command('lead on'))
    expect((await crew($, { action: 'draft' })).result).toBe('用法：/crew draft <PRD 草稿路徑>')
  })

  test('takes no draft in a private place', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('lead on'))
    w.disk.set(`${ROOT}/.crew/x.md`, DRAFT_TEXT)
    expect((await crew($, { action: 'draft', path: '.crew/x.md' })).result).toMatch(/^PRD 要是文件檔/)
    expect(w.spawned).toEqual([])
  })

  test('takes no draft that is not there', async ($, on) => {
    world($, on)
    await start($)
    await $.command.run(command('lead on'))
    expect((await crew($, { action: 'draft', path: 'docs/crew/none.md' })).result).toBe('找不到 docs/crew/none.md。')
  })

  test('takes no draft without requirements, or with more than crew follows', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('lead on'))
    w.disk.set(`${ROOT}/docs/crew/empty.md`, '# 空的\n')
    expect((await crew($, { action: 'draft', path: 'docs/crew/empty.md' })).result).toBe('docs/crew/empty.md 裡找不到需求：每條需求寫成一個清單項目。')
    w.disk.set(`${ROOT}/docs/crew/big.md`, `# 大\n\n${Array.from({ length: MAX_REQUIREMENTS + 1 }, (_, i) => `- 需求 ${i}`).join('\n')}\n`)
    expect((await crew($, { action: 'draft', path: 'docs/crew/big.md' })).result).toMatch(/請拆成幾份 PRD/)
    expect(w.spawned).toEqual([])
  })

  test('waits for a flow under way and for a reviewer at work', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('lead on'))
    w.disk.set(DRAFT, DRAFT_TEXT)
    await crew($, { action: 'ask', role: 'uiux', text: '設計稿進度？' })
    expect((await crew($, { action: 'draft', path: 'docs/crew/v2-PRD.md' })).result).toMatch(/UI\/UX 正在工作，等它做完再送審/)
    await done($, 'a-uiux-1')
    await $.command.run(command('start docs/PRD.md'))
    expect((await crew($, { action: 'draft', path: 'docs/crew/v2-PRD.md' })).result).toMatch(/crew 正在進行（splitting）/)
  })

  test('hears each review, and tells the brain once both are in, with where each reply is', async ($, on) => {
    const w = world($, on)
    await start($)
    await drafted($, w)
    expect((await crew($, { action: 'ready' })).result).toMatch(/PM、UI\/UX 還在審/)
    await done($, 'a-pm-1', '缺口 2 個\n- 第 1 條：怎麼編輯？\n- 第 2 條：要確認嗎？')
    expect(await paneText($)).toMatch(/審查：PM ✓ 2 個缺口 · UI\/UX 審查中/)
    await done($, 'a-uiux-2', '沒有缺口')
    await w.clock.advance(61_000)
    const told = w.prompts.join('\n')
    expect(told).toMatch(/PM 和 UI\/UX 都審完 PRD 草稿 docs\/crew\/v2-PRD\.md 了（PM：2 個缺口，ASK-01；UI\/UX：沒有缺口，ASK-02；原話用 thread_read 讀）/)
    expect(told).toMatch(/改好用 crew 工具 action=ready 請使用者確認/)
    expect(told.match(/都審完/g)).toHaveLength(1)
    expect(await paneText($)).toMatch(/審完了，大腦會整理缺口，在主對話問你/)
  })

  test('marks a reply not in the asked form, and has the brain read it first', async ($, on) => {
    const w = world($, on)
    await start($)
    await drafted($, w)
    await done($, 'a-pm-1', '缺口 0 個')
    await done($, 'a-uiux-2', '無法審查：找不到檔案')
    expect(await paneText($)).toMatch(/審查：PM ✓ 沒有缺口 · UI\/UX \? 回覆沒照格式/)
    await w.clock.advance(61_000)
    expect(w.prompts.join('\n')).toMatch(/UI\/UX（ASK-02） 的回覆沒照格式：先用 thread_read 讀原話，確認真的審了；沒審就用 action=draft、path=docs\/crew\/v2-PRD\.md 重新送審/)
  })

  test('counts a review that did not finish as not done, and has the brain send it again', async ($, on) => {
    const w = world($, on)
    await start($)
    await drafted($, w)
    await $.turn.complete({ answer: '', durationMs: 5, isAborted: true, turnId: 't-pm', reason: 'aborted', agentId: 'a-pm-1' } as never)
    await done($, 'a-uiux-2', '缺口 1 個\n- x')
    const pane = await paneText($)
    expect(pane).toMatch(/審查：PM ✗ 這一輪沒有完成 · UI\/UX ✓ 1 個缺口/)
    expect(pane).toMatch(/有審查沒有完成：在主對話請大腦重新送審。/)
    expect((await crew($, { action: 'ready' })).result).toBe('PM 沒有審完：先用 action=draft、path=docs/crew/v2-PRD.md 重新送審。')
    await w.clock.advance(61_000)
    expect(w.prompts.join('\n')).toMatch(/審查沒有全部完成（PM：沒有審完（這一輪沒有完成），ASK-01；UI\/UX：1 個缺口，ASK-02）。PM 要重審：用 crew 工具 action=draft、path=docs\/crew\/v2-PRD\.md 重新送審/)
  })

  test('counts a reviewer crew could not start as not done', async ($, on) => {
    const w = world($, on, { denySpawn: 'no agents here', denySpawnOf: 'crew:uiux' })
    await start($)
    const r = await drafted($, w)
    expect(r.result).toMatch(/^已請 PM 審 docs\/crew\/v2-PRD\.md（2 條需求），審完會通知你。沒有送到：UI\/UX（/)
    expect(await paneText($)).toMatch(/UI\/UX ✗ 沒有送到/)
  })
})

describe('the person’s yes to the draft', () => {
  const reviewed = async ($: Engine, w: ReturnType<typeof world>) => {
    await drafted($, w)
    await done($, 'a-pm-1', '缺口 1 個\n- x')
    await done($, 'a-uiux-2', '沒有缺口')
  }

  test('waits for the brain’s ready, which reads the draft as it is now', async ($, on) => {
    const w = world($, on)
    await start($)
    expect((await $.command.run(command('lead on'))).text).toMatch(/主導/)
    expect((await crew($, { action: 'ready' })).result).toMatch(/還沒有送審的 PRD 草稿/)
    await reviewed($, w)
    w.disk.set(DRAFT, `${DRAFT_TEXT}- 刪除前要確認\n`)
    const r = await crew($, { action: 'ready', text: 'PM 1 個缺口已補，sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789' })
    expect(r.result).toMatch(/^面板已顯示「PRD 草稿等你確認」：docs\/crew\/v2-PRD\.md（3 條需求）。使用者在主對話說可以，你就用 action=start、path=docs\/crew\/v2-PRD\.md 開始/)
    const pane = await paneText($)
    expect(pane).toMatch(/PRD 草稿等你確認：docs\/crew\/v2-PRD\.md　待辦清單 v2（3 條需求）/)
    expect(pane).toMatch(/大腦：PM 1 個缺口已補/)
    expect(pane).not.toMatch(/sk-ant-api03-abcdefghij/)
    expect(await band($)).toMatch(/PRD 草稿等你確認：待辦清單 v2/)
    const ui = await paneUi($)
    expect((await ui.findAll({ type: 'Button' })).map(b => b.props.label)).toContain('確認，開始')
    await ui.unmount()
  })

  test('starts the flow from the pane, reporting to the brain, and the draft is done', async ($, on) => {
    const w = world($, on)
    await start($)
    await reviewed($, w)
    await crew($, { action: 'ready' })
    await press($, 'confirm-draft')
    expect(w.toasts.at(-1)).toMatch(/crew 開始：PM 正在拆 docs\/crew\/v2-PRD\.md/)
    expect((w.board()?.crew_prd as { path?: string } | undefined)?.path).toBe('docs/crew/v2-PRD.md')
    const saved = w.store.get(STATE) as { lead: string; draft?: unknown }
    expect(saved.lead).toBe('brain')
    expect(saved.draft).toBeUndefined()
    await w.clock.advance(61_000)
    expect(w.prompts.join('\n')).toMatch(/使用者自己開始了「docs\/crew\/v2-PRD\.md」：PM 正在拆功能和驗收條件。/)
  })

  test('starts on the brain’s word too; with no draft there is nothing to confirm', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('lead on'))
    const ui = await paneUi($)
    expect((await ui.findAll({ type: 'Button' })).map(b => b.props.label)).not.toContain('確認，開始')
    await ui.unmount()
    await reviewed($, w)
    await crew($, { action: 'ready' })
    expect((await crew($, { action: 'start', path: 'docs/crew/v2-PRD.md' })).result).toMatch(/crew 開始/)
    expect((w.store.get(STATE) as { draft?: unknown }).draft).toBeUndefined()
  })

  test('a reset lets the draft go', async ($, on) => {
    const w = world($, on)
    await start($)
    await drafted($, w)
    await $.command.run(command('reset'))
    expect(await paneText($)).not.toMatch(/PRD 草稿/)
    expect((w.store.get(STATE) as { draft?: unknown }).draft).toBeUndefined()
  })
})

describe('the brain’s draft across a restart and over an earlier board', () => {
  test('keeps the draft; a review the last session left unfinished is marked so', async ($, on) => {
    const w = world($, on)
    // What crew kept when Claude Code closed, PM's review in and UI/UX's under way.
    w.store.set(SETTINGS, { takeover: true })
    w.store.set(STATE, {
      prdPath: null,
      flow: { stage: 'idle', round: 0, retries: 0 },
      questions: [],
      lead: 'person',
      draft: {
        path: 'docs/crew/v2-PRD.md',
        title: '待辦清單 v2',
        requirements: 2,
        stage: 'reviewing',
        reviews: [
          { role: 'pm', done: true, found: '1 個缺口', ask: 'ASK-01' },
          { role: 'uiux', done: false, ask: 'ASK-02' },
        ],
      },
    })
    w.disk.set(DRAFT, DRAFT_TEXT)
    await start($)
    const pane = await paneText($)
    expect(pane).toMatch(/審查：PM ✓ 1 個缺口 · UI\/UX ✗ 重開前沒審完/)
    expect(pane).toMatch(/有審查沒有完成：在主對話請大腦重新送審。/)
    expect((await crew($, { action: 'status' })).result).toMatch(/PRD 草稿：docs\/crew\/v2-PRD\.md（審查中；PM 1 個缺口 ASK-01、UI\/UX 沒有審完（重開前沒審完） ASK-02）/)
  })

  test('drops a kept draft that has another shape', async ($, on) => {
    const w = world($, on)
    w.store.set(SETTINGS, { takeover: true })
    w.store.set(STATE, { prdPath: null, flow: { stage: 'idle', round: 0, retries: 0 }, questions: [], lead: 'person', draft: { path: 7, title: 't', requirements: 1, stage: 'reviewing', reviews: [] } })
    await start($)
    expect(await paneText($)).toMatch(/大腦接手中：在主對話說你要做什麼。/)
    expect(await paneText($)).not.toMatch(/PRD 草稿/)
  })

  test('shows the brain waiting, and then its draft, over the board an earlier PRD left', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('lead on'))
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    await done($, 'a-pm-1')
    await $.command.run(command('reset'))
    expect(w.board()).not.toBeNull()
    const idle = await paneText($)
    expect(idle.split('\n')[0]).toBe('大腦接手中 · 還沒有 PRD')
    expect(idle).not.toMatch(/整體進度/)
    expect(idle).toMatch(/大腦接手中：在主對話說你要做什麼。/)
    const line = await band($)
    expect(line).toMatch(/大腦接手中 · 還沒有 PRD/)
    expect(line).not.toMatch(/進度|對準 PRD/)
    w.disk.set(DRAFT, DRAFT_TEXT)
    await crew($, { action: 'draft', path: 'docs/crew/v2-PRD.md' })
    const pane = await paneText($)
    expect(pane.split('\n')[0]).toBe('大腦接手中 · PRD 草稿 待辦清單 v2')
    expect(pane).toMatch(/審查：PM 審查中 · UI\/UX 審查中/)
    expect(await band($)).toMatch(/PRD 草稿 待辦清單 v2/)
  })

  test('shows a PRD under way, not the brain waiting, while one runs', async ($, on) => {
    world($, on)
    await start($)
    await $.command.run(command('lead on'))
    await $.command.run(command('start docs/PRD.md'))
    const pane = await paneText($)
    expect(pane.split('\n')[0]).toMatch(/docs\/PRD\.md · 進度/)
    expect(pane).not.toMatch(/大腦接手中/)
    expect(await band($)).not.toMatch(/大腦接手中/)
  })

  test('shows the next draft over a PRD that is done', async ($, on) => {
    const w = world($, on)
    w.store.set(SETTINGS, { takeover: true })
    w.store.set(STATE, { prdPath: 'docs/PRD.md', flow: { stage: 'done', round: 0, retries: 0 }, questions: [], lead: 'brain' })
    await start($)
    w.disk.set(DRAFT, DRAFT_TEXT)
    expect((await crew($, { action: 'draft', path: 'docs/crew/v2-PRD.md' })).result).toMatch(/已請 PM 和 UI\/UX 審/)
    expect(await band($)).toMatch(/PRD 草稿 待辦清單 v2/)
    expect(await paneText($)).toMatch(/PRD 草稿：docs\/crew\/v2-PRD\.md/)
  })

  test('shows no line above the prompt with no PRD and the brain not leading', async ($, on) => {
    world($, on)
    await start($)
    await noBand($)
  })
})

describe('the hardening of the takeover', () => {
  test('a role at work gets the switch with the other notes, and a later switch replaces it', async ($, on) => {
    const w = world($, on)
    engineSections(on)
    await start($)
    await composed($)
    await crew($, { action: 'ask', role: 'pm', text: '現在進度？' })
    await press($, 'takeover-on', 'settings')
    await done($, 'a-pm-1', '還沒開始')
    await press($, 'takeover-off', 'settings')
    await w.clock.advance(61_000)
    const told = w.prompts.filter(p => /使用者剛/.test(p))
    expect(told).toHaveLength(1)
    expect(told[0]).toMatch(/^\[crew\] 使用者剛關掉大腦接手/)
  })

  test('says nothing to a session nothing draws (-p)', async ($, on) => {
    world($, on)
    engineSections(on)
    await start($)
    await $.command.run(command('lead on'))
    const headless = (await $.prompt.compose({ ...facts(['mcp__crew__crew']), surfaces: [] } as never)).sections
    expect(headless.map(x => x.id)).toEqual(['intro'])
  })

  test('takes a prompt measured for /context as no turn of the conversation', async ($, on) => {
    const w = world($, on)
    engineSections(on)
    await start($)
    await composed($, ['mcp__crew__crew'], ['analysis'])
    await $.command.run(command('lead on'))
    await w.clock.advance(61_000)
    expect(w.prompts).toEqual([])
  })

  test('turned off, lets the draft go: reviews come back as plain replies, the file stays', async ($, on) => {
    const w = world($, on)
    await start($)
    await drafted($, w)
    await $.command.run(command('lead off'))
    expect(await paneText($)).not.toMatch(/PRD 草稿/)
    expect((w.store.get(STATE) as { draft?: unknown }).draft).toBeUndefined()
    expect(w.disk.has(DRAFT)).toBe(true)
    await done($, 'a-pm-1', '缺口 1 個\n- x')
    await done($, 'a-uiux-2', '沒有缺口')
    await w.clock.advance(61_000)
    const told = w.prompts.join('\n')
    expect(told).toMatch(/PM 回覆了 ASK-01/)
    expect(told).not.toMatch(/都審完/)
  })

  test('the brain starts its draft only once the person was asked to confirm it', async ($, on) => {
    const w = world($, on)
    await start($)
    await drafted($, w)
    await done($, 'a-pm-1', '沒有缺口')
    await done($, 'a-uiux-2', '沒有缺口')
    expect((await crew($, { action: 'start', path: 'docs/crew/v2-PRD.md' })).result).toBe('docs/crew/v2-PRD.md 還沒請使用者確認：先用 action=ready，等使用者說可以再開始。')
    expect(w.board()).toBeNull()
    await crew($, { action: 'ready' })
    expect((await crew($, { action: 'start', path: 'docs/crew/v2-PRD.md' })).result).toMatch(/crew 開始/)
  })

  test('a reviewer of the draft writes no board and makes no decision', async ($, on) => {
    const w = world($, on)
    await start($)
    await drafted($, w)
    const write = await $.tool.call({ tool: 'mcp__crew__board_write', tool_use_id: 'w1', agentId: 'a-pm-1', ops: [{ op: 'add_feature', title: 'x', summary: 'y', priority: 'P0', sources: [] }] } as never) as { result: string }
    expect(write.result).toBe('你在審 PRD 草稿：這一輪只回覆缺口，不改看板，也不記決定。')
    const decide = await $.tool.call({ tool: 'mcp__crew__memory_save', tool_use_id: 'm1', agentId: 'a-uiux-2', type: 'DEC', text: '用卡片' } as never) as { result: string }
    expect(decide.result).toBe('你在審 PRD 草稿：這一輪只回覆缺口，不改看板，也不記決定。')
    const fact = await $.tool.call({ tool: 'mcp__crew__memory_save', tool_use_id: 'm2', agentId: 'a-uiux-2', type: 'MEM', text: '目前沒有設計稿' } as never) as { result: string }
    expect(fact.result).not.toMatch(/你在審 PRD 草稿/)
    expect(w.board()).toBeNull()
  })

  test('sends one draft to review three times at most, then has the brain ask the person', async ($, on) => {
    const w = world($, on)
    await start($)
    await drafted($, w)
    // Sent again, the same reviewers are asked again.
    for (let n = 0; n < 2; n += 1) {
      await done($, 'a-pm-1', '無法審查')
      await done($, 'a-uiux-2', '無法審查')
      expect((await crew($, { action: 'draft', path: 'docs/crew/v2-PRD.md' })).result).toMatch(/^已請 PM 和 UI\/UX 審/)
    }
    await done($, 'a-pm-1', '無法審查')
    await done($, 'a-uiux-2', '無法審查')
    expect((await crew($, { action: 'draft', path: 'docs/crew/v2-PRD.md' })).result).toBe('docs/crew/v2-PRD.md 已經送審 3 次：不要再送審；問使用者要不要照現在的草稿確認，要的話用 action=ready。')
  })

  test('sending again makes what the earlier sending found old news', async ($, on) => {
    const w = world($, on)
    await start($)
    await drafted($, w)
    await done($, 'a-pm-1', '無法審查')
    await done($, 'a-uiux-2', '沒有缺口')
    await crew($, { action: 'draft', path: 'docs/crew/v2-PRD.md' })
    await w.clock.advance(61_000)
    expect(w.prompts.join('\n')).not.toMatch(/都審完/)
  })

  test('waits for a PRD that waits on the person, as for one under way', async ($, on) => {
    const w = world($, on)
    w.store.set(SETTINGS, { takeover: true })
    w.store.set(STATE, { prdPath: 'docs/PRD.md', flow: { stage: 'approving', round: 0, retries: 0 }, questions: [], lead: 'brain' })
    await start($)
    w.disk.set(DRAFT, DRAFT_TEXT)
    expect((await crew($, { action: 'draft', path: 'docs/crew/v2-PRD.md' })).result).toBe('crew 正在進行（approving），等這一輪完成再送審新的草稿。')
  })

  test('ready reads the draft again: its title and count as they are now, and says when it cannot', async ($, on) => {
    const w = world($, on)
    await start($)
    await drafted($, w)
    await done($, 'a-pm-1', '沒有缺口')
    await done($, 'a-uiux-2', '沒有缺口')
    w.disk.set(DRAFT, '# 待辦清單 v3\n\n## 需求\n\n- 一\n- 二\n- 三\n- 四\n')
    await crew($, { action: 'ready', text: '長'.repeat(300) })
    const pane = await paneText($)
    expect(pane).toMatch(/PRD 草稿等你確認：docs\/crew\/v2-PRD\.md　待辦清單 v3（4 條需求）/)
    const said = pane.split('\n').find(l => l.startsWith('大腦：')) ?? ''
    expect(said.length).toBeLessThanOrEqual('大腦：'.length + 201)
    w.disk.delete(DRAFT)
    expect((await crew($, { action: 'ready' })).result).toBe('找不到 docs/crew/v2-PRD.md。')
  })

  test('works the same when the person sends the draft with /crew draft', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('lead on'))
    w.disk.set(DRAFT, DRAFT_TEXT)
    expect((await $.command.run(command('draft docs/crew/v2-PRD.md'))).text).toMatch(/^已請 PM 和 UI\/UX 審/)
    expect(w.spawned[0]?.prompt).toMatch(/審草稿 docs\/crew\/v2-PRD\.md（ASK-01）/)
    expect((await $.command.run(command('thread ASK-01'))).text).toMatch(/審 PRD 草稿 docs\/crew\/v2-PRD\.md/)
    await done($, 'a-pm-1', '缺口 1 個\n- x')
    await done($, 'a-uiux-2', '沒有缺口')
    await w.clock.advance(61_000)
    const told = w.prompts.join('\n')
    expect(told).toMatch(/PM 和 UI\/UX 都審完 PRD 草稿 docs\/crew\/v2-PRD\.md 了（PM：1 個缺口，ASK-01；UI\/UX：沒有缺口，ASK-02/)
    // The person asked: each reply is theirs, in its thread, not the brain's to hear one by one.
    expect(told).not.toMatch(/PM 回覆了 ASK-01/)
  })

  test('status says the brain waits, and its draft', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('lead on'))
    expect((await crew($, { action: 'status' })).result).toMatch(/大腦接手中 · 還沒有 PRD/)
    w.disk.set(DRAFT, DRAFT_TEXT)
    await crew($, { action: 'draft', path: 'docs/crew/v2-PRD.md' })
    expect((await crew($, { action: 'status' })).result).toMatch(/\nPRD 草稿：docs\/crew\/v2-PRD\.md（審查中；PM 審查中 ASK-01、UI\/UX 審查中 ASK-02）$/)
  })

  test('the start screen while the brain waits: no picker during a draft, no not-now, a quiet start button', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('lead on'))
    let ui = await paneUi($)
    let text = await textOf(ui)
    expect(text).not.toMatch(/crew 已載入，還沒有開始的 PRD/)
    expect(text).toMatch(/已經有寫好的 PRD，也可以直接選：/)
    const buttons = await ui.findAll({ type: 'Button' })
    expect(buttons.find(b => b.key === 'start')?.props.variant).toBe('secondary')
    expect(buttons.some(b => b.key === 'not-now')).toBe(false)
    await ui.unmount()
    w.disk.set(DRAFT, DRAFT_TEXT)
    await crew($, { action: 'draft', path: 'docs/crew/v2-PRD.md' })
    ui = await paneUi($)
    text = await textOf(ui)
    expect(text).toMatch(/審完後，大腦會整理缺口，在主對話問你。/)
    expect(text).not.toMatch(/已經有寫好的 PRD|或輸入路徑/)
    expect((await ui.findAll({ type: 'Button' })).some(b => b.key === 'start')).toBe(false)
    await ui.unmount()
  })

  test('warns of a review that did not finish only once the others are in', async ($, on) => {
    const w = world($, on)
    await start($)
    await drafted($, w)
    await $.turn.complete({ answer: '', durationMs: 5, isAborted: true, turnId: 't-pm', reason: 'aborted', agentId: 'a-pm-1' } as never)
    expect(await paneText($)).not.toMatch(/有審查沒有完成/)
    await done($, 'a-uiux-2', '沒有缺口')
    expect(await paneText($)).toMatch(/有審查沒有完成：在主對話請大腦重新送審。/)
  })

  test('a restart keeps a draft waiting for the person: the button, the brain’s word, a doubtful review and one never sent', async ($, on) => {
    const w = world($, on)
    w.store.set(SETTINGS, { takeover: true })
    w.store.set(STATE, {
      prdPath: null,
      flow: { stage: 'idle', round: 0, retries: 0 },
      questions: [],
      lead: 'person',
      draft: {
        path: 'docs/crew/v2-PRD.md',
        title: '待辦清單 v2',
        requirements: 2,
        stage: 'confirm',
        note: '缺口都補了',
        reviews: [
          { role: 'pm', done: true, unsure: true, found: '回覆沒照格式', ask: 'ASK-01' },
          { role: 'uiux', done: false, failed: true, found: '沒有送到' },
        ],
      },
    })
    w.disk.set(DRAFT, DRAFT_TEXT)
    await start($)
    const ui = await paneUi($)
    const text = await textOf(ui)
    expect(text).toMatch(/審查：PM \? 回覆沒照格式 · UI\/UX ✗ 沒有送到/)
    expect(text).toMatch(/大腦：缺口都補了/)
    expect((await ui.findAll({ type: 'Button' })).map(b => b.props.label)).toContain('確認，開始')
    await ui.unmount()
  })

  test('a reload keeps the reviews under way as they are', async ($, on) => {
    const w = world($, on)
    await start($)
    await drafted($, w)
    await start($)
    expect(await paneText($)).toMatch(/審查：PM 審查中 · UI\/UX 審查中/)
    await done($, 'a-pm-1', '沒有缺口')
    expect(await paneText($)).toMatch(/審查：PM ✓ 沒有缺口 · UI\/UX 審查中/)
  })

  test('the preview draws the brain’s three situations, and its controls only say what they would do', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('demo leading'))
    expect(await paneText($)).toMatch(/大腦接手中：在主對話說你要做什麼。/)
    await $.command.run(command('demo drafting'))
    expect(await paneText($)).toMatch(/審查：PM ✓ 2 個缺口 · UI\/UX 審查中/)
    await $.command.run(command('demo confirm'))
    expect(await paneText($)).toMatch(/大腦：兩邊共 3 個缺口，已照你的回答補進草稿/)
    await press($, 'confirm-draft')
    expect(w.toasts.at(-1)).toMatch(/^設計稿：實際會用這份 PRD 草稿開始/)
    await $.command.run(command('demo empty'))
    await press($, 'takeover-on')
    expect(w.toasts.at(-1)).toMatch(/^設計稿：實際會讓大腦接手這個 repo/)
    expect(w.store.get(SETTINGS)).toBeUndefined()
  })
})

describe('the takeover’s last review round', () => {
  test('three sendings with a review that did not finish leave the draft for the person to confirm as it is', async ($, on) => {
    const w = world($, on)
    await start($)
    await drafted($, w)
    for (let n = 1; n <= 3; n += 1) {
      await $.turn.complete({ answer: '', durationMs: 5, isAborted: true, turnId: `t-${n}`, reason: 'aborted', agentId: 'a-pm-1' } as never)
      await done($, 'a-uiux-2', '沒有缺口')
      if (n < 3) {
        expect((await crew($, { action: 'ready' })).result).toBe('PM 沒有審完：先用 action=draft、path=docs/crew/v2-PRD.md 重新送審。')
        expect((await crew($, { action: 'draft', path: 'docs/crew/v2-PRD.md' })).result).toMatch(/^已請 PM 和 UI\/UX 審/)
      }
    }
    expect(await paneText($)).toMatch(/有審查沒有完成，已經送審 3 次：在主對話告訴大腦要不要照現在的草稿確認。/)
    await w.clock.advance(61_000)
    expect(w.prompts.join('\n')).toMatch(/PRD 草稿 docs\/crew\/v2-PRD\.md 已送審 3 次，仍有審查沒有完成（PM：沒有審完（這一輪沒有完成），ASK-0\d；UI\/UX：沒有缺口，ASK-0\d）。不要再送審：問使用者要不要照現在的草稿確認/)
    expect((await crew($, { action: 'ready', text: 'PM 沒審完，使用者決定照現在的草稿' })).result).toMatch(/^面板已顯示「PRD 草稿等你確認」/)
    expect(await paneText($)).toMatch(/審查：PM ✗ 這一輪沒有完成 · UI\/UX ✓ 沒有缺口/)
  })

  test('a sending that reached no reviewer does not count', async ($, on) => {
    const w = world($, on, { denySpawn: 'no agents here' })
    await start($)
    await $.command.run(command('lead on'))
    w.disk.set(DRAFT, DRAFT_TEXT)
    for (let n = 0; n < 4; n += 1) {
      expect((await crew($, { action: 'draft', path: 'docs/crew/v2-PRD.md' })).result).toMatch(/^沒有送到：PM（[\s\S]*）、UI\/UX（/)
    }
    await w.clock.advance(61_000)
    expect(w.prompts.join('\n')).not.toMatch(/審查沒有全部完成/)
  })
})

describe('the takeover’s smaller guards', () => {
  test('a switch whose timer another plugin refuses still reaches the brain with the other notes', async ($, on) => {
    const w = world($, on)
    engineSections(on)
    await start($)
    await composed($)
    w.refuse.timers = 1
    await $.command.run(command('lead on'))
    await w.clock.advance(1)
    expect(w.prompts).toEqual([])
    await w.clock.advance(61_000)
    expect(w.prompts.filter(p => /使用者剛讓你接手/.test(p))).toHaveLength(1)
  })

  test('turned off mid-review, the reviewers still write no board until their run ends', async ($, on) => {
    const w = world($, on)
    await start($)
    await drafted($, w)
    await $.command.run(command('lead off'))
    const write = await $.tool.call({ tool: 'mcp__crew__board_write', tool_use_id: 'w1', agentId: 'a-pm-1', ops: [{ op: 'add_feature', title: 'x', summary: 'y', priority: 'P0', sources: [] }] } as never) as { result: string }
    expect(write.result).toBe('你在審 PRD 草稿：這一輪只回覆缺口，不改看板，也不記決定。')
    expect(w.board()).toBeNull()
  })

  test('turned off, what the reviews found is old news', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('lead on'))
    w.disk.set(DRAFT, DRAFT_TEXT)
    await $.command.run(command('draft docs/crew/v2-PRD.md'))
    await done($, 'a-pm-1', '沒有缺口')
    await done($, 'a-uiux-2', '沒有缺口')
    await $.command.run(command('lead off'))
    await w.clock.advance(61_000)
    expect(w.prompts.join('\n')).not.toMatch(/都審完/)
  })

  test('a reset lets a notice that waits for a run go at once', async ($, on) => {
    const w = world($, on)
    await start($)
    await crew($, { action: 'ask', role: 'pm', text: '進度？' })
    let gone = false
    const early = $.prompt.submit({ text: '<task-notification><task-id>a-pm-1</task-id></task-notification>', wait: false, origin: { kind: 'task-notification' } } as never).then(r => {
      gone = true
      return r
    })
    await $.command.run(command('reset'))
    await w.clock.advance(0)
    await Promise.resolve()
    expect(gone).toBe(true)
    await early
  })

  test('says so when the switch cannot be kept', async ($, on) => {
    const w = world($, on)
    await start($)
    w.broken.store = 'settings:'
    expect((await $.command.run(command('lead on'))).text).toMatch(/^沒有存到設定：/)
  })

  test('the settings tab marks the switch as it stands', async ($, on) => {
    world($, on)
    await start($)
    const variants = async () => {
      const ui = await paneUi($)
      await ui.press({ key: 'tab-settings' })
      const buttons = await ui.findAll({ type: 'Button' })
      await ui.unmount()
      return [buttons.find(b => b.key === 'takeover-on')?.props.variant, buttons.find(b => b.key === 'takeover-off')?.props.variant]
    }
    expect(await variants()).toEqual(['secondary', 'primary'])
    await $.command.run(command('lead on'))
    expect(await variants()).toEqual(['primary', 'secondary'])
  })
})

describe('the takeover’s paths through links and drops', () => {
  test('keeps a draft by where it really is: through a folder link it is one draft, confirmed as one', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('lead on'))
    w.links.set(`${ROOT}/spec`, `${ROOT}/docs`)
    w.disk.set(DRAFT, DRAFT_TEXT)
    expect((await crew($, { action: 'draft', path: 'spec/crew/v2-PRD.md' })).result).toMatch(/^已請 PM 和 UI\/UX 審 docs\/crew\/v2-PRD\.md/)
    await done($, 'a-pm-1', '沒有缺口')
    await done($, 'a-uiux-2', '沒有缺口')
    expect((await crew($, { action: 'start', path: 'docs/crew/v2-PRD.md' })).result).toMatch(/還沒請使用者確認/)
  })

  test('a switch dropped on its way waits for the brain with the other notes, once', async ($, on) => {
    const w = world($, on)
    w.drops.match = /^\[crew\] 使用者剛讓你接手/
    w.drops.times = 1
    engineSections(on)
    await start($)
    await composed($)
    await $.command.run(command('lead on'))
    await w.clock.advance(61_000)
    expect(w.prompts.filter(p => /使用者剛讓你接手/.test(p))).toHaveLength(1)
    expect(w.drops.times).toBe(0)
  })
})
