import type { CommandRunInput, On, RenderPropsOf } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
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

/** The engine beneath: a pane that opens and closes. */
const stage = (on: On) => {
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
}

const demoOn = ($: Engine) => $.command.run(command('demo'))

describe('/crew demo', () => {
  test('says how to open the preview before it is on', async $ => {
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(pane(surface))
      expect(await shown(ui)).toMatch(/\/crew demo/)
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
      expect(text).toMatch(/14\/16/)
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
    expect(line.indexOf('待你決定 1')).toBeLessThan(line.indexOf('PM'))
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
      expect(await shown(ui)).toMatch(/\/crew demo/)
      await ui.unmount()
    }
  })
})
