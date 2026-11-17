import { describe, expect, test } from 'claude-code/testing'

import { paneUi, REQ, start, textOf, world, write } from './world'

/** The pane drawn while the surface asks again and again: one drawing at a time, never a stale one. */

describe('crew pane under many redraws', () => {
  test('a pile of redraws with a tab pressed among them lands on the tab pressed, and later changes still redraw', async ($, on) => {
    world($, on)
    await start($)
    const ui = await paneUi($)
    const variant = async (key: string) => (await ui.find({ key }))?.props.variant
    await Promise.all([...Array.from({ length: 20 }, () => ui.redraw()), ui.press({ key: 'tab-board' }), ...Array.from({ length: 20 }, () => ui.redraw())])
    expect(await variant('tab-board')).toBe('primary')
    expect(await variant('tab-overview')).toBe('secondary')
    // A change after the pile is drawn too: the drawing that joined others still follows what it shows.
    await ui.press({ key: 'tab-settings' })
    expect(await variant('tab-settings')).toBe('primary')
    await Promise.all(Array.from({ length: 10 }, () => ui.redraw()))
    expect(await variant('tab-settings')).toBe('primary')
    await ui.unmount()
  })

  test('a long board list shows its first 30, and all of them when asked', async ($, on) => {
    const w = world($, on)
    w.store.set('settings:/repo', { askBeforeSwitch: false })
    await start($)
    const ui = await paneUi($)
    await ui.press({ key: 'start' })
    await write($, 'a-pm-1', Array.from({ length: 35 }, (_, i) => ({ op: 'add_feature', title: `功能 ${i + 1}`, summary: 's', sources: [REQ] })))
    await ui.press({ key: 'tab-board' })
    const more = (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('more-board-'))
    expect(more).toHaveLength(1)
    const text = await textOf(ui)
    expect(text).toMatch(/（35）/)
    expect(text).toMatch(/顯示 30 \/ 35 項/)
    expect(text).toMatch(/功能 30/)
    expect(text).not.toMatch(/功能 31/)
    await ui.press({ key: more[0]?.key ?? '' })
    const all = await textOf(ui)
    expect(all).toMatch(/顯示全部 35 項/)
    expect(all).toMatch(/功能 35/)
    await ui.press({ key: more[0]?.key ?? '' })
    expect(await textOf(ui)).not.toMatch(/功能 31/)
    await ui.unmount()
  })
})
