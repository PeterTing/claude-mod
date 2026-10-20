import type { CommandRunInput, On, RenderPropsOf } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const

const command = (args: string): CommandRunInput => ({
  command: 'crew',
  args,
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 140 },
})

const pane = (surface: (typeof SURFACES)[number]) => ({
  plugin: 'crew',
  surface,
  component: 'Pane' as const,
  requestId: 'crew',
  // The kit lays the pane's own `view` handle in; the test gives the rest.
  props: { title: 'Crew', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 60 } } as unknown as RenderPropsOf['Pane'],
})

const band = (surface: (typeof SURFACES)[number]) => ({
  plugin: 'crew',
  surface,
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 2, bodyColumns: 140 } as unknown as RenderPropsOf['AbovePrompt'],
})

/** Every text the drawing shows, joined, to look for a phrase in. */
const shown = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')

/** The engine beneath: a pane that opens and closes, and a clock. */
const stage = (on: On) => {
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  mock.clock(on, { now: Date.UTC(2026, 9, 20, 6, 0, 0) })
}

const demoOn = ($: Engine) => $.command.run(command('demo'))

/** The engine beneath, and the notices the pane's controls give. */
const staged = (on: On): string[] => {
  stage(on)
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  return toasts
}

describe('/crew demo', () => {
  test('offers to start a PRD in the pane before anything is on', async ($, on) => {
    stage(on)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(pane(surface))
      expect(await shown(ui)).toMatch(/crew 已載入，還沒有開始的 PRD/)
      expect(await ui.find({ key: 'start' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('opens the overview, marked as a design preview', async ($, on) => {
    stage(on)
    const opened = await demoOn($)
    expect(opened.text).toMatch(/設計稿/)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(pane(surface))
      const text = await shown(ui)
      expect(text).toMatch(/設計稿・示意資料/)
      for (const role of ['PM', 'UI/UX', '全端', 'QA', 'Tech lead']) expect(text).toContain(role)
      for (const id of ['G1', 'G2', 'G3', 'G4', 'G5', 'G6']) expect(await ui.find({ key: `gate-${id}` })).toBeDefined()
      expect(text).toMatch(/待你決定/)
      expect(text).toMatch(/輪替中/)
      await ui.unmount()
    }
  })

  test('opens on the overall progress: how much there is, how much is done, and where the team is', async ($, on) => {
    stage(on)
    await demoOn($)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(pane(surface))
      const text = await shown(ui)
      expect(text).toMatch(/整體進度/)
      expect(text).toMatch(/31\/50 項/)
      // The same seven stages as each requirement's row, in its order.
      expect(text).toMatch(/規格 ✓[\s\S]*設計 ✓[\s\S]*測試案例 10\/12[\s\S]*任務 4\/5[\s\S]*實作 5\/14[\s\S]*Review 3\/14[\s\S]*測試結果 1\/8/)
      expect(text).toMatch(/62%/)
      expect(text).toMatch(/目前在/)
      expect(text).toMatch(/今天完成 7 項/)
      expect(text).toMatch(/最近完成/)
      await ui.unmount()
    }
  })

  test('breaks progress down by feature and by day on the progress tab', async ($, on) => {
    stage(on)
    await demoOn($)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(pane(surface))
      await ui.press({ key: 'tab-progress' })
      const text = await shown(ui)
      expect(text).toMatch(/F-01 方案選擇/)
      expect(text).toMatch(/100%/)
      expect(text).toMatch(/F-04 年繳方案/)
      expect(text).toMatch(/移出 v1/)
      expect(text).toMatch(/每天完成/)
      await ui.press({ key: 'tab-overview' })
      await ui.unmount()
    }
  })

  test('opens a gate’s detail: what it checks, who fills and confirms it, coverage and each gap', async ($, on) => {
    stage(on)
    await demoOn($)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(pane(surface))
      await ui.press({ key: 'gate-G4' })
      const text = await shown(ui)
      expect(text).toMatch(/每條驗收條件都有 test case/)
      expect(text).toMatch(/QA 補.*PM 確認/)
      // 14 of 16 is 87.5%: shown as 87, never rounded up toward done.
      expect(text).toMatch(/14\/16（87%）/)
      expect(text).toMatch(/AC-07/)
      expect(text).toMatch(/AC-09/)
      expect(text).toMatch(/程式計算/)

      await ui.press({ key: 'gate-G1' })
      const g1 = await shown(ui)
      expect(g1).toMatch(/每個功能都有驗收條件/)
      expect(g1).toMatch(/沒有缺口/)

      await ui.press({ key: 'gate-close' })
      expect(await shown(ui)).not.toMatch(/每個功能都有驗收條件/)
      await ui.unmount()
    }
  })

  test('lists each PRD requirement with how far each stage of its development is', async ($, on) => {
    stage(on)
    await demoOn($)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(pane(surface))
      await ui.press({ key: 'tab-progress' })
      const text = await shown(ui)
      expect(text).toMatch(/PRD 需求/)
      expect(text).toMatch(/\n規格\n設計\n測試案例\n任務\n實作\nReview\n測試結果\n/)
      expect(text).toMatch(/R-9b3c12\n[^\n]*\n✓\n✓\n✓ 6\/6\n✓\n◐ 3\/5\n○\n◐ 2\/6\n/)
      expect(text).toMatch(/R-07d4e9\n[^\n]*\n✓\n✓\n✓ 5\/5\n✓\n◐ 1\/3\n⟳\n/)
      expect(text).toMatch(/R-2f6b55[\s\S]*移出範圍：移出 v1/)
      await ui.unmount()
    }
  })

  test('jumps from a gap to its thread', async ($, on) => {
    stage(on)
    await demoOn($)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(pane(surface))
      await ui.press({ key: 'gate-G4' })
      await ui.press({ key: 'gap-thread-AC-07' })
      const text = await shown(ui)
      expect(text).toMatch(/AC-09 移出 v1/)
      await ui.press({ key: 'thread-back' })
      await ui.press({ key: 'tab-overview' })
      await ui.press({ key: 'gate-close' })
      await ui.unmount()
    }
  })

  test('shows the board with each item’s complexity and model', async ($, on) => {
    stage(on)
    await demoOn($)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(pane(surface))
      await ui.press({ key: 'tab-board' })
      const text = await shown(ui)
      expect(text).toMatch(/TASK-15/)
      expect(text).toMatch(/XL/)
      expect(text).toMatch(/Opus・xhigh/)
      expect(text).toMatch(/升級/)
      await ui.unmount()
    }
  })

  test('opens an item’s thread', async ($, on) => {
    stage(on)
    await demoOn($)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(pane(surface))
      await ui.press({ key: 'tab-threads' })
      await ui.press({ key: 'thread-AC-07' })
      const text = await shown(ui)
      expect(text).toMatch(/AC-09 移出 v1/)
      expect(text).toMatch(/DEC-14/)
      await ui.press({ key: 'thread-back' })
      expect(await ui.find({ key: 'thread-SCR-04' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('lists memories, with superseded ones marked', async ($, on) => {
    stage(on)
    await demoOn($)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(pane(surface))
      await ui.press({ key: 'tab-memory' })
      const text = await shown(ui)
      expect(text).toMatch(/DEC-14/)
      expect(text).toMatch(/已被 DEC-14 取代/)
      expect(text).toMatch(/目前帶著/)
      await ui.unmount()
    }
  })

  test('shows token use per role and per complexity tier, with the brain’s actions', async ($, on) => {
    stage(on)
    await demoOn($)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(pane(surface))
      await ui.press({ key: 'tab-tokens' })
      const text = await shown(ui)
      expect(text).toMatch(/命中率/)
      expect(text).toMatch(/XL/)
      expect(text).toMatch(/大腦處置/)
      await ui.unmount()
    }
  })

  test('shows crew’s checks while it stays on: the heartbeat, a restart and the brain’s digest', async ($, on) => {
    stage(on)
    await demoOn($)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(pane(surface))
      const calm = await shown(ui)
      expect(calm).toMatch(/常駐 ✓ 心跳 2 分鐘前 · 下次 3 分鐘後 · 大腦摘要 12:30 送出，2 則等 13:00/)
      // The line is on every tab, as the PRD's is.
      await ui.press({ key: 'tab-board' })
      expect(await shown(ui)).toMatch(/常駐 ✓/)
      await ui.press({ key: 'tab-overview' })
      await ui.press({ key: 'scenario-attention' })
      const found = await shown(ui)
      expect(found).toMatch(/常駐 ⚠ 心跳 1 分鐘前發現：crew 的分支在角色工作以外多了 1 個 commit（TASK-12）→ 已排給 Tech lead review/)
      expect(found).toMatch(/重開接續：13:02 從 building 接續（全端，TASK-15）/)
      await ui.press({ key: 'scenario-empty' })
      expect(await shown(ui)).toMatch(/常駐 ✓ 心跳 剛剛 · 下次 5 分鐘後/)
      await ui.press({ key: 'scenario-normal' })
      await ui.unmount()
    }
  })

  test('shows each reminder sent to the brain with its time, and each of the brain’s actions with the numbers before and since', async ($, on) => {
    stage(on)
    await demoOn($)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(pane(surface))
      await ui.press({ key: 'tab-tokens' })
      const calm = await shown(ui)
      // Asking first is the default; two buttons switch it, as /crew tuning does.
      expect(calm).toMatch(/大腦處置：先問你（大腦提出建議，你核准才執行）/)
      expect(await ui.find({ key: 'tuning-auto' })).toBeDefined()
      expect(await ui.find({ key: 'tuning-ask' })).toBeDefined()
      expect(calm).toMatch(/大腦處置（不能為了省 token 跳過關卡、測試或 review）/)
      expect(calm).toMatch(/DEC-15 全端輪替，門檻 100K → 80K[\s\S]*處置前 命中率 52% · context 96K → 現在 命中率 81% · context 8K/)
      await ui.press({ key: 'scenario-attention' })
      const loud = await shown(ui)
      expect(loud).toMatch(/提醒已送大腦（同一條件一小時最多一次）/)
      expect(loud).toMatch(/全端今日佔 46%（超過 40%） · 12:41/)
      expect(loud).toMatch(/全端快取命中率 52%（低於 60%）/)
      // Asked first: the brain's proposal waits for the person, with the numbers it would act on.
      expect(loud).toMatch(/建議 全端下一個項目改用 Sonnet・high[\s\S]*處置前 今日佔 46% → 等你核准/)
      expect(await ui.find({ key: 'approve-Q-04' })).toBeDefined()
      expect(await ui.find({ key: 'reject-Q-04' })).toBeDefined()
      // Under what waits for the person, the brain's proposal takes the same two buttons; a role's question its reply.
      await ui.press({ key: 'tab-overview' })
      expect(await shown(ui)).toMatch(/Q-04 大腦建議：全端下一個項目改用 Sonnet・high/)
      expect(await ui.find({ key: 'approve-Q-04' })).toBeDefined()
      expect(await ui.find({ key: 'answer-Q-03' })).toBeDefined()
      await ui.press({ key: 'scenario-normal' })
      await ui.unmount()
    }
  })

  test('opens on a situation and a tab named in the command', async ($, on) => {
    stage(on)
    expect((await $.command.run(command('demo attention tokens'))).text).toMatch(/設計稿/)
    const ui = await $.ui.mount(pane('terminal'))
    const text = await shown(ui)
    expect(text).toMatch(/提醒已送大腦/)
    expect(text).toMatch(/命中率/)
    await ui.unmount()
    expect((await $.command.run(command('demo calm'))).text).toMatch(/用法：\/crew demo \[normal\|empty\|attention\|restart\] \[overview\|progress\|board\|threads\|memory\|tokens\|settings\]/)
  })

  test('switches to the empty and attention situations', async ($, on) => {
    stage(on)
    await demoOn($)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(pane(surface))
      await ui.press({ key: 'scenario-empty' })
      expect(await shown(ui)).toMatch(/還沒有 PRD/)
      await ui.press({ key: 'scenario-attention' })
      const text = await shown(ui)
      expect(text).toMatch(/卡住/)
      expect(text).toMatch(/提醒已送大腦/)
      await ui.press({ key: 'scenario-normal' })
      await ui.unmount()
    }
  })

  test('shows an empty state on every tab before there is a PRD', async ($, on) => {
    stage(on)
    await demoOn($)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(pane(surface))
      await ui.press({ key: 'scenario-empty' })
      for (const [tab, phrase] of [
        ['tab-board', /看板是空的/],
        ['tab-threads', /還沒有討論/],
        ['tab-memory', /還沒有記憶/],
        ['tab-tokens', /今天還沒有用量/],
        ['tab-progress', /還沒有項目/],
      ] as const) {
        await ui.press({ key: tab })
        expect(await shown(ui)).toMatch(phrase)
      }
      await ui.press({ key: 'tab-overview' })
      await ui.press({ key: 'scenario-normal' })
      await ui.unmount()
    }
  })

  test('puts what needs the person first in the line above the prompt', async ($, on) => {
    stage(on)
    await demoOn($)
    const ui = await $.ui.mount(pane('terminal'))
    await ui.press({ key: 'scenario-attention' })
    await ui.unmount()
    const line = await shown(await $.ui.mount(band('terminal')))
    expect(line).toMatch(/待你決定 3/)
    expect(line.indexOf('待你決定 3')).toBeLessThan(line.indexOf('PM'))
    expect(line).toMatch(/⚠ PRD 對不上 2[\s\S]*⚠ 3 則提醒/)
  })

  test('shows one line above the prompt while the preview is on, and none after', async ($, on) => {
    stage(on)
    await demoOn($)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(band(surface))
      const text = await shown(ui)
      expect(text).toMatch(/crew/)
      expect(text).toMatch(/設計稿/)
      expect(text).toMatch(/待你決定 1/)
      expect(text).toMatch(/進度 62%/)
      await ui.unmount()
    }
    const off = await $.command.run(command('demo off'))
    expect(off.text).toMatch(/關閉/)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(pane(surface))
      expect(await shown(ui)).toMatch(/crew 已載入，還沒有開始的 PRD/)
      await ui.unmount()
    }
  })
})

describe('the pane, which does everything with no command', () => {
  const demo = ($: Engine, at: string) => $.command.run(command(`demo ${at}`))

  test('starts crew when it loads with no PRD: a PRD picked or typed, or not now', async ($, on) => {
    const toasts = staged(on)
    await demo($, 'empty overview')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(pane(surface))
      expect(await shown(ui)).toMatch(/crew 已載入，還沒有開始的 PRD/)
      for (const key of ['start', 'not-now']) expect(await ui.find({ key })).toBeDefined()
      // The first PRD found is picked to start with; no role has work to be asked about yet.
      expect((await ui.find({ key: 'prd-pick' })) as unknown).toMatchObject({ props: { value: 'docs/PRD.md' } })
      expect(await ui.find({ key: 'ask-pm' })).toBeUndefined()
      await ui.select({ key: 'prd-pick', value: 'docs/PRD.md' })
      expect(toasts.at(-1)).toMatch(/設計稿：選了 docs\/PRD\.md/)
      await ui.press({ key: 'start' })
      expect(toasts.at(-1)).toMatch(/設計稿：實際會用選好的 PRD 開始，PM 先把它拆成功能和驗收條件/)
      await ui.input({ key: 'prd-path', text: 'specs/v2.md' })
      expect(toasts.at(-1)).toMatch(/設計稿：實際會用 specs\/v2\.md 開始/)
      await ui.unmount()
    }
  })

  test('offers to go on with an unfinished PRD when crew loads again', async ($, on) => {
    staged(on)
    await demo($, 'restart overview')
    const ui = await $.ui.mount(pane('terminal'))
    expect(await shown(ui)).toMatch(/上次的 PRD-001 會員訂閱 v1 停在「實作」（全端 TASK-12）/)
    for (const key of ['resume', 'not-now']) expect(await ui.find({ key })).toBeDefined()
    await ui.unmount()
  })

  test('answers, approves and sends back what waits for the person', async ($, on) => {
    const toasts = staged(on)
    await demo($, 'attention overview')
    const ui = await $.ui.mount(pane('terminal'))
    // A role's question: answered in a field under it.
    await ui.input({ key: 'answer-Q-03', text: '第一版先不做年繳' })
    expect(toasts.at(-1)).toMatch(/設計稿：實際會把回答交給 PM/)
    // The brain's proposal: approved or not with a press.
    for (const key of ['approve-Q-04', 'reject-Q-04']) expect(await ui.find({ key })).toBeDefined()
    // A design: read, approved, or sent back with a reason.
    for (const key of ['view-SCR-04', 'approve-Q-05']) expect(await ui.find({ key })).toBeDefined()
    await ui.input({ key: 'reject-Q-05', text: '要有比較表' })
    expect(toasts.at(-1)).toMatch(/設計稿：實際會把 SCR-04 退回給 UI\/UX，原因：要有比較表/)
    await ui.unmount()
  })

  test('asks a role or rotates it from its row', async ($, on) => {
    const toasts = staged(on)
    await demo($, 'normal overview')
    const ui = await $.ui.mount(pane('terminal'))
    for (const role of ['pm', 'uiux', 'fullstack', 'qa', 'techlead']) {
      expect(await ui.find({ key: `ask-${role}` })).toBeDefined()
      expect(await ui.find({ key: `rotate-${role}` })).toBeDefined()
    }
    expect(await ui.find({ key: 'ask-pm-text' })).toBeUndefined()
    await ui.press({ key: 'ask-pm' })
    await ui.input({ key: 'ask-pm-text', text: '年繳要做嗎？' })
    expect(toasts.at(-1)).toMatch(/設計稿：實際會把問題交給 PM/)
    await ui.unmount()
  })

  test('sets crew up on its settings tab, and resets only once confirmed', async ($, on) => {
    staged(on)
    await demo($, 'normal settings')
    const ui = await $.ui.mount(pane('terminal'))
    const text = await shown(ui)
    expect(text).toMatch(/測試指令/)
    expect(text).toMatch(/現在：打開這個面板/)
    expect((await ui.find({ key: 'test-command' })) as unknown).toMatchObject({ props: { value: 'python3 -m pytest -v' } })
    for (const key of ['run-tests', 'tuning-auto', 'tuning-ask', 'open-on-load', 'not-on-load', 'resume', 'reset', 'consolidate', 'demo-off']) {
      expect(await ui.find({ key })).toBeDefined()
    }
    expect(await ui.find({ key: 'reset-confirm' })).toBeUndefined()
    await ui.press({ key: 'reset' })
    expect(await shown(ui)).toMatch(/重設後看板、討論和記憶都會留著/)
    expect(await ui.find({ key: 'reset-confirm' })).toBeDefined()
    await ui.unmount()
  })

  test('searches memory and saves a preference on the memory tab', async ($, on) => {
    const toasts = staged(on)
    await demo($, 'normal memory')
    const ui = await $.ui.mount(pane('terminal'))
    await ui.input({ key: 'recall', text: '金流' })
    expect(toasts.at(-1)).toMatch(/設計稿：實際會找出和「金流」有關的記憶/)
    await ui.input({ key: 'remember', text: '文案用台灣用語' })
    expect(toasts.at(-1)).toMatch(/設計稿：實際會記下偏好：文案用台灣用語/)
    await ui.unmount()
  })

  test('shows no command where the pane can do it', async ($, on) => {
    staged(on)
    for (const situation of ['normal', 'empty', 'attention', 'restart']) {
      for (const tab of ['overview', 'progress', 'board', 'threads', 'memory', 'tokens', 'settings']) {
        await demo($, `${situation} ${tab}`)
        const ui = await $.ui.mount(pane('terminal'))
        expect(await shown(ui)).not.toMatch(/\/crew/)
        await ui.unmount()
      }
    }
  })

  test('says where to type on a surface with no text field, and keeps its buttons', async ($, on) => {
    staged(on)
    await demo($, 'attention overview')
    const ui = await $.ui.mount({ ...pane('desktop'), surface: 'mobile' as never })
    const text = await shown(ui)
    expect(text).toMatch(/回答請在電腦上的面板輸入/)
    expect(await ui.find({ key: 'approve-Q-04' })).toBeDefined()
    await ui.unmount()
  })
})
