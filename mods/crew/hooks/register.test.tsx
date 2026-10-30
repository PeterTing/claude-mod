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
      // Each item weighed by its size, with the count beside it.
      expect(text).toMatch(/58%\n依難易度加權 · 31\/50 項/)
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
      // How the weights go, and the plain count beside them.
      expect(text).toMatch(/58%\n依難易度加權 · 31\/50 項[\s\S]*加權：每一項照它的難易度算，易 1・中 2・難 4・極難 8；Tech lead 還沒評的算中。\n難易度看難不難，不看範圍大小/)
      // Done items count at how hard they turned out, so a rating raised can take the percentage down.
      expect(text).toMatch(/做完的照最後的難易度算，\n所以調高時百分比可能往下掉。不加權是 31\/50 項。\n最近調整：TASK-12 難 → 中：Tech lead 重評，範圍大但都照現成的 API 寫法 · 進度 57% → 58%/)
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
      expect(text).toMatch(/極難 Opus 5.5・xhigh/)
      // How hard, not how big: each with the tech lead's word on why.
      expect(text).toMatch(/難：範圍小（2 個檔），但驗簽和重送要照金流商的規格，錯了會重複扣款/)
      expect(text).toMatch(/中：範圍大（8 個檔），但都照現成的 API 寫法/)
      expect(text).toMatch(/難易度看難不難，不看範圍大小/)
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
      expect(text).toMatch(/依難易度：易 38K · 中 121K · 難 176K · 極難 77K/)
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
      expect(calm).toMatch(/DEC-15 UI\/UX 輪替，門檻 100K → 80K[\s\S]*處置前 命中率 52% · context 96K → 現在 命中率 81% · context 8K/)
      await ui.press({ key: 'scenario-attention' })
      const loud = await shown(ui)
      expect(loud).toMatch(/提醒已送大腦（同一條件一小時最多一次）/)
      expect(loud).toMatch(/UI\/UX 今日佔 Claude 的 73%（超過 40%） · 12:41/)
      expect(loud).toMatch(/全端快取命中率 52%（低於 60%）/)
      // Asked first: the brain's proposal waits for the person, with the numbers it would act on.
      expect(loud).toMatch(/建議 全端輪替門檻 160K → 120K[\s\S]*處置前 命中率 52% · context 96K → 等你核准/)
      expect(await ui.find({ key: 'approve-Q-04' })).toBeDefined()
      expect(await ui.find({ key: 'reject-Q-04' })).toBeDefined()
      // Under what waits for the person, the brain's proposal takes the same two buttons; a role's question its reply.
      await ui.press({ key: 'tab-overview' })
      expect(await shown(ui)).toMatch(/Q-04 大腦建議：全端輪替門檻 160K → 120K/)
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
    expect((await $.command.run(command('demo calm'))).text).toMatch(/用法：\/crew demo \[normal\|empty\|attention\|restart\|leading\|drafting\|confirm\|codex\|quota\] \[overview\|progress\|board\|threads\|memory\|tokens\|models\|settings\]/)
  })

  test('says in 設定 which file holds the board', async ($, on) => {
    stage(on)
    await $.command.run(command('demo normal settings'))
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(pane(surface))
      expect(await shown(ui)).toMatch(/看板\n檔案：\.crew\/prd-tracker\.json\n測試指令\n/)
      await ui.unmount()
    }
  })

  test('says in 設定 where crew\'s web page is, and opens it there', async ($, on) => {
    const toasts = staged(on)
    await $.command.run(command('demo normal settings'))
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(pane(surface))
      const text = await shown(ui)
      expect(text).toMatch(/網頁\nhttp:\/\/127\.0\.0\.1:47321\/\ncrew 啟動時\n這個網址只有這台電腦打得開/)
      // The phone through Tailscale: this machine on the tailnet, and the phones paired with it.
      expect(text).toMatch(/手機\nTailscale ✓ 已連上 · 這台電腦 macbook\nhttps:\/\/macbook\.tail0c3f\.ts\.net\/\n已配對：iPhone · 昨天配對\n只有你 tailnet 裡、用你的帳號登入的裝置連得到。crew 用 tailscale serve，\n不用 funnel，不會公開到網路上。/)
      expect((await ui.find({ key: 'tailnet-on' })) as unknown).toMatchObject({ props: { variant: 'primary' } })
      await ui.press({ key: 'pair-device' })
      expect(toasts.at(-1)).toMatch(/設計稿：實際會顯示一組配對碼（例如 482-913），10 分鐘內在手機輸入/)
      await ui.press({ key: 'unpair-iphone' })
      expect(toasts.at(-1)).toMatch(/設計稿：實際會移除 iPhone，它要再配對一次才連得到/)
      await ui.press({ key: 'tailnet-off' })
      expect(toasts.at(-1)).toMatch(/設計稿：實際會停掉 tailscale serve，網頁只限這台電腦/)
      // No cadence to set: crew reckons the bottlenecks after each piece of work, in code.
      expect(text).toMatch(/瓶頸每件工作做完就重算，有新的才告訴大腦，沒有頻率要設/)
      expect(await ui.find({ key: 'audit-every' })).toBeUndefined()
      expect(text).toMatch(/換模型另外由「模型」分頁的「大腦換模型前」管/)
      expect((await ui.find({ key: 'web-on-start' })) as unknown).toMatchObject({ props: { variant: 'primary' } })
      await ui.press({ key: 'web-open' })
      expect(toasts.at(-1)).toMatch(/設計稿：實際會在瀏覽器打開 crew 的網頁/)
      await ui.press({ key: 'web-not-on-start' })
      expect(toasts.at(-1)).toMatch(/設計稿：實際會讓 crew 啟動時不打開網頁/)
      await ui.unmount()
    }
  })

  test('says on Token where the day\'s tokens went, and what costs the most across sessions', async ($, on) => {
    stage(on)
    await $.command.run(command('demo normal tokens'))
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(pane(surface))
      const text = await shown(ui)
      expect(text).toMatch(/去向（今天）\n工具結果 140K · 任務與看板 64K · 輸出 49K · 記憶包 31K\n角色說明 35K · Codex 固定開銷 93K/)
      expect(text).toMatch(/大腦每一輪：MCP 工具說明 46K/)
      // Ranked by tokens, each with what is done about it and whose it is to do.
      expect(text).toMatch(/瓶頸（近 7 天，3 個 session，依 token 排）\n1 大腦每一輪都帶 MCP 工具說明 46K\n {2}4048K · 46K × 88 輪，大腦 context 的 44%\n {2}! 要你處理：/)
      expect(text).toMatch(/◐ 處置中：crew 給 Codex 精簡的設定/)
      expect(text).toMatch(/✓ 已處置：DEC-18 先用 Grep 找位置再讀/)
      expect(text).toMatch(/每一次執行都記在 \.crew\/usage\/，不進 git，跨 session 留著/)
      // Reckoned in code after each piece of work; the brain hears only of a new one, or one handled that grew again.
      expect(text).toMatch(/每件工作做完，crew 用程式重算一次瓶頸，不花 token。\n只有出現新的瓶頸，或處置過的又變大，才把那一條告訴大腦；/)
      expect(text).toMatch(/上次告訴大腦：記憶包用到的只有 23%（新的瓶頸）· 40 分鐘前/)
      await ui.unmount()
    }
  })

  test('says on 模型 how each role picks its model, on either engine', async ($, on) => {
    const toasts = staged(on)
    await $.command.run(command('demo normal models'))
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(pane(surface))
      const text = await shown(ui)
      expect(text).toMatch(/Codex ✓ 已登入（ChatGPT 帳號）· codex-cli 0\.162\.1/)
      expect(text).toMatch(/登入或額度恢復後，crew 會自己發現，不用重開 Claude Code/)
      // crew's default: the brain picks the engine, and each engine's floor has the steps its work climbs.
      expect((await ui.find({ key: 'mode-pm-auto' })) as unknown).toMatchObject({ props: { variant: 'primary' } })
      expect((await ui.find({ key: 'mode-pm-fixed' })) as unknown).toMatchObject({ props: { variant: 'secondary' } })
      expect(text).toMatch(/PM\n現在 Claude：大腦選的，Claude 額度還夠\n預設引擎:\n {2}易–中 Sonnet 5.5・high · 難 Opus 5.5・high · 極難 xhigh · 再失敗 Fable 5.1・xhigh\n {2}易–中 Terra・high · 難 Sol・high · 極難 xhigh · 再失敗 Astra・xhigh/)
      // Asking first covers every move, on either engine, a climb for harder work included.
      expect(text).toMatch(/大腦換模型前\n換引擎、模型或 effort，Claude 和 Codex 都先在「模型的事」問你：\n依難易度往上升、失敗後升級、Codex 不能用時改用 Claude，都算。\n等你回答的時候，那個角色停著。\n自己挑選的角色不會被換；它卡住時，不管開關都會問你。/)
      expect(text).toMatch(/全端\n現在 Codex：大腦選的，Claude 額度留給 Tech lead/)
      expect(text).toMatch(/易–極難 Sol・xhigh · 再失敗 Astra・xhigh/)
      expect(text).toMatch(/易 60K · 中 100K · 難 160K · 極難 256K/)
      // A threshold by the work's size the brain tuned says so, and which decision did.
      expect(text).toMatch(/UI\/UX\n現在 Claude：大腦選的，Claude 額度還夠\n預設引擎:\n(?:.*\n){2}大腦調成 80K（DEC-15）\n全端\n/)
      expect((await ui.find({ key: 'ask-switch-on' })) as unknown).toMatchObject({ props: { variant: 'primary' } })
      if (surface === 'terminal') {
        // Nothing under 6.1 Sol・xhigh is offered to the full-stack on Codex; Claude offers its three.
        const pick = async (key: string) => ((await ui.find({ key })) as unknown as { props: { value: string; options: { value: string }[] } }).props
        expect((await pick('floor-fullstack-codex-model')).options.map(o => o.value)).toEqual(['gpt-6.1-sol', 'gpt-6-astra'])
        expect((await pick('floor-fullstack-codex-effort')).options.map(o => o.value)).toEqual(['xhigh', 'max'])
        expect((await pick('floor-pm-codex-model')).options.map(o => o.value)).toEqual(['gpt-6-luna', 'gpt-6.1-terra', 'gpt-6.1-sol', 'gpt-6-astra'])
        expect((await pick('floor-pm-claude-model')).options.map(o => o.value)).toEqual(['haiku', 'sonnet', 'opus', 'fable'])
        expect((await pick('floor-pm-claude-model')).value).toBe('sonnet')
        expect((await pick('limit-techlead')).value).toBe('200000')
        expect((await pick('limit-fullstack')).value).toBe('tier')
        expect((await pick('limit-pm')).value).toBe('tier')
        await ui.select({ key: 'floor-fullstack-codex-model', value: 'gpt-6-astra' })
        expect(toasts.at(-1)).toMatch(/設計稿：實際會把 全端 在 Codex 上的下限改成 6 Astra/)
        await ui.select({ key: 'floor-pm-claude-model', value: 'opus' })
        expect(toasts.at(-1)).toMatch(/設計稿：實際會把 PM 在 Claude 上的下限改成 Opus/)
        await ui.select({ key: 'limit-pm', value: '100000' })
        expect(toasts.at(-1)).toMatch(/設計稿：實際會把 PM 的輪替門檻固定在 100K/)
      }
      await ui.press({ key: 'mode-qa-fixed' })
      expect(toasts.at(-1)).toMatch(/設計稿：實際會讓 QA 固定用你選的模型，不升級，大腦也不換/)
      await ui.press({ key: 'ask-switch-off' })
      expect(toasts.at(-1)).toMatch(/設計稿：實際會讓大腦自己換模型，事後記成決定/)
      await ui.press({ key: 'codex-check' })
      expect(toasts.at(-1)).toMatch(/設計稿：實際會重新檢查這台電腦的 Codex/)
      await ui.unmount()
    }
  })

  test('fixes a role on one model, and asks about it apart from the rest when it cannot run there', async ($, on) => {
    const toasts = staged(on)
    await $.command.run(command('demo codex models'))
    const ui = await $.ui.mount(pane('terminal'))
    const text = await shown(ui)
    expect(text).toMatch(/Codex ✗ 還沒登入/)
    expect(text).toMatch(/codex login --with-api-key。key 只交給 Codex，不要貼進對話/)
    // The full-stack, fixed on Codex, waits; the roles on crew's default go on with Claude.
    expect((await ui.find({ key: 'fixed-fullstack-codex' })) as unknown).toMatchObject({ props: { variant: 'primary' } })
    expect(text).toMatch(/全端\n停著：Codex 現在不能用，在「模型的事」決定/)
    expect(text).toMatch(/固定用 6\.1 Sol・xhigh：不升級，大腦也不換；一直失敗時 crew 會問你/)
    expect(text).toMatch(/PM\n現在 Claude：大腦選的，Claude 額度還夠/)
    // The question on its model stands apart from what else waits for the person.
    await ui.press({ key: 'tab-overview' })
    const overview = await shown(ui)
    expect(overview).toMatch(/模型的事（1）\nM-01 Codex 還沒登入。全端固定用 Codex，TASK-12 停著。要改用 Claude（Sonnet 5.5・high）做嗎？\ncrew · 剛剛\n在你自己的終端機執行 codex login，登入後 crew 會自己發現，不用重開。/)
    expect(overview).toMatch(/待你決定（1）\nQ-03/)
    expect((await ui.find({ key: 'model-yes-M-01' })) as unknown).toMatchObject({ props: { label: '改用 Claude' } })
    expect((await ui.find({ key: 'model-no-M-01' })) as unknown).toMatchObject({ props: { label: '等我登入' } })
    await ui.press({ key: 'model-no-M-01' })
    expect(toasts.at(-1)).toMatch(/設計稿：實際會照「等我登入」處理 M-01/)
    await ui.unmount()
    expect(await shown(await $.ui.mount(band('terminal')))).toMatch(/⚠ 模型 1 │ 待你決定 1/)
    // Out of quota: asked on its own too, with when it comes back.
    await $.command.run(command('demo quota overview'))
    const quota = await $.ui.mount(pane('terminal'))
    expect(await shown(quota)).toMatch(/M-01 Codex 額度用完了，約 15:40 重置。QA 固定用 Codex，TC-31 停著。/)
    expect((await quota.find({ key: 'model-yes-M-01' })) as unknown).toMatchObject({ props: { label: '這段時間改用 Claude' } })
    await quota.press({ key: 'tab-models' })
    const models = await shown(quota)
    expect(models).toMatch(/Codex ⚠ 額度用完，約 15:40 重置/)
    // With asking off, the brain moved the full-stack on its own and noted it; QA, fixed on Codex, is still asked about.
    expect((await quota.find({ key: 'ask-switch-off' })) as unknown).toMatchObject({ props: { variant: 'primary' } })
    expect(models).toMatch(/大腦換模型前\n不用問：大腦自己換引擎、模型或 effort，事後記成決定。\n自己挑選的角色不會被換；它卡住時，不管開關都會問你。/)
    expect(models).toMatch(/全端\n現在 Claude：大腦選的，Codex 額度用完（DEC-21）/)
    await quota.unmount()
    // Asking on: a climb after failures waits as a question too.
    await $.command.run(command('demo attention overview'))
    const climb = await $.ui.mount(pane('terminal'))
    expect(await shown(climb)).toMatch(/M-03 全端的 TASK-15 測試失敗 2 次，要從 6\.1 Sol・xhigh 升到 6 Astra・xhigh 嗎？\ncrew · 1 分鐘前/)
    expect((await climb.find({ key: 'model-yes-M-03' })) as unknown).toMatchObject({ props: { label: '升級' } })
    expect((await climb.find({ key: 'model-no-M-03' })) as unknown).toMatchObject({ props: { label: '照舊' } })
    await climb.press({ key: 'tab-progress' })
    expect(await shown(climb)).toMatch(/最近調整：TASK-15 難 → 極難：測試失敗 2 次 · 進度 60% → 58%/)
    await climb.unmount()
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
      expect(text).toMatch(/TASK-15 測試失敗 2 次，升級等你決定（M-03）/)
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
    // A question on a model is counted apart, ahead of the rest.
    expect(line).toMatch(/⚠ 模型 3 │ 待你決定 3/)
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
      expect(text).toMatch(/進度 58%/)
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

  test('says which PRD a start begins, and on a phone lists the PRDs as buttons to pick from', async ($, on) => {
    staged(on)
    await demo($, 'empty overview')
    const desk = await $.ui.mount(pane('terminal'))
    expect(await shown(desk)).toMatch(/會開始：docs\/PRD\.md　會員訂閱 v1/)
    await desk.unmount()
    const phone = await $.ui.mount({ ...pane('desktop'), surface: 'mobile' as never })
    expect(await shown(phone)).toMatch(/會開始：docs\/PRD\.md　會員訂閱 v1/)
    for (const key of ['prd-option-0', 'prd-option-1', 'start']) expect(await phone.find({ key })).toBeDefined()
    await phone.unmount()
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
