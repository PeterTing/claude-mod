import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { CrewScenario, CrewTab } from '../types'
import { DEMO } from './demo'
import { bandText, CrewPane } from './views'
import type { Actions } from './views'

const PANE = 'crew'

const isDemo = atom({ plugin: 'crew', key: 'isDemo' } as const, false)
const tab = atom({ plugin: 'crew', key: 'tab' } as const, 'overview' as CrewTab)
const scenario = atom({ plugin: 'crew', key: 'scenario' } as const, 'normal' as CrewScenario)
const thread = atom({ plugin: 'crew', key: 'thread' } as const, null as string | null)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'crew',
      description: 'Crew, the resident product team. /crew demo shows the design preview with sample data.',
    })
    return next(e)
  })

  on('command.run', { command: 'crew' }, async ($, e) => {
    const args = e.args.trim().split(/\s+/)
    if (args[0] === 'demo' && args[1] === 'off') {
      await update($, isDemo, () => false)
      await $.ui.close({ id: PANE })
      return { text: '已關閉 crew 設計稿。' }
    }
    if (args[0] === 'demo') {
      await update($, isDemo, () => true)
      await update($, tab, () => 'overview')
      await update($, scenario, () => 'normal')
      await update($, thread, () => null)
      await $.ui.open({ id: PANE, title: 'Crew（設計稿）' })
      return { text: '已開啟 crew 設計稿：面板和輸入框上方那一行都是示意資料。/crew demo off 關閉。' }
    }
    return { text: 'crew 還在設計階段。/crew demo 打開設計稿，看面板和輸入框上方那一行。' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const el = $.ui.resolve(e)
    if (!(await read($, isDemo))) {
      return <el.Text dimColor>crew 還在設計階段。輸入 /crew demo 看設計稿。</el.Text>
    }
    const act: Actions = {
      tab: id => void update($, tab, () => id),
      scenario: id => void update($, scenario, () => id),
      thread: id => void update($, thread, () => id),
      reply: id => $.ui.toast(`設計稿：這裡會打開輸入框，讓你回覆 ${id}`),
    }
    const view = { tab: await read($, tab), scenario: await read($, scenario), thread: await read($, thread) }
    return CrewPane({ el, snap: DEMO[view.scenario], view, act })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isDemo))) return next(e)
    const { Text } = $.ui.resolve(e)
    return (
      <Text dimColor wrap="truncate-end">
        {bandText(DEMO[await read($, scenario)])}
      </Text>
    )
  })
}
