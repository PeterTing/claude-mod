import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { buildHead, importFile, importsOf } from './web'
import { approve, command, designed, done, paneUi, PLAN, ROOT, SPLIT, start, textOf, world, write } from './world'

/**
 * crew's version against its files on disk: Claude Code takes a new crew only
 * where it watches crew's folder, so a crew left on an old version says so;
 * and a reload of crew in the same conversation starts again by itself the
 * flow's Codex runs and test run it cut, where a restart of Claude Code waits
 * for the person's 接續.
 */

const LOOK = 30_000

/** crew's own files where crew looks for them: register.tsx imports board for code and model for its types alone. */
const lay = (w: ReturnType<typeof world>, root: string, board = 'export const a = 1\n') => {
  w.disk.set(`${root}/hooks/register.tsx`, "import { a } from './board'\nimport type { T } from './model'\nexport const register = a\n")
  w.disk.set(`${root}/hooks/board.ts`, board)
  w.disk.set(`${root}/hooks/model.ts`, 'export type T = 1\n')
  w.disk.set(`${root}/hooks/world.ts`, 'export const world = 1\n')
  w.disk.set(`${root}/web/server.py`, 'print(1)\n')
}

/** The values crew writes to one of its own, in order. */
const watched = (on: On, key: string): unknown[] => {
  const seen: unknown[] = []
  on('state.set', (_$, e, next) => {
    const x = e as unknown as { plugin: string; key: string; value: unknown }
    if (x.plugin === 'crew' && x.key === key) seen.push(x.value)
    return next(e)
  })
  return seen
}

/** Where crew looks for its own files: the folder of the register.tsx it read. */
const rootOf = (w: ReturnType<typeof world>): string => [...w.reads.keys()].find(p => p.endsWith('/hooks/register.tsx'))?.slice(0, -'/hooks/register.tsx'.length) ?? ''

/** crew started with its own files laid where it looks for them: the version it runs from then on. */
const rooted = async ($: Engine, w: ReturnType<typeof world>): Promise<string> => {
  await start($)
  const root = rootOf(w)
  lay(w, root)
  await start($)
  return root
}

/** A new version of crew on disk: a file it loads for code changed. */
const newVersion = (w: ReturnType<typeof world>, root: string) => w.disk.set(`${root}/hooks/board.ts`, 'export const a = 22\n')

/** A flow built, reviewed and asked to test, whose test run Claude Code's timers refuse: the flow is left testing. */
const leftTesting = async ($: Engine, w: ReturnType<typeof world>): Promise<string> => {
  const root = await rooted($, w)
  await $.command.run(command('start docs/PRD.md'))
  await write($, 'a-pm-1', SPLIT)
  await done($, 'a-pm-1')
  await write($, 'a-qa-2', [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }])
  await done($, 'a-qa-2')
  await designed($)
  await write($, 'a-techlead-4', PLAN)
  await done($, 'a-techlead-4')
  w.commit('TASK-001: 方案頁')
  await done($, 'a-fullstack-5')
  await approve($, 'TASK-001')
  w.commit('TASK-002: 取消流程')
  await done($, 'a-fullstack-5')
  w.refuse.timers = 1
  await approve($, 'TASK-002')
  await w.clock.advance(60_000)
  return root
}

type Codex = { run?: 'flow' | 'person'; paused?: 'person'; qa?: true; ask?: true }

/**
 * The PM at work on a Codex run that the module before this one held, as
 * crew's next write of its record says: a reload, or a restart, then ends it.
 * Its run the flow's or the person's; the flow held by the person; QA at
 * work beside it on Claude, as `a-qa-x`.
 */
const onCodex = (on: On, how: Codex = {}) => {
  const armed: { on: boolean; change?: (l: Record<string, any>) => Record<string, any> } = { on: false }
  on('state.set', (_$, e, next) => {
    type Live = { roles: Record<string, Record<string, unknown>>; agents: Record<string, string>; paused?: string }
    const x = e as unknown as { plugin: string; key: string; value: Live }
    if (x.plugin !== 'crew' || x.key !== 'live') return next(e)
    // A later change, once, at crew's next write of its record.
    if (armed.change !== undefined) {
      const change = armed.change
      armed.change = undefined
      return next({ ...x, value: change(x.value as unknown as Record<string, any>) } as never)
    }
    if (!armed.on) return next(e)
    armed.on = false
    const l = x.value
    const roles = { ...l.roles, pm: { ...l.roles.pm, state: 'working', engine: 'codex', agentId: 'codex-pm-9', run: how.run ?? 'flow', doing: '拆 PRD' }, ...(how.qa ? { qa: { ...l.roles.qa, state: 'working', engine: 'claude', agentId: 'a-qa-x', run: 'person', doing: '回答你的問題' } } : {}) }
    const agents = { ...l.agents, 'codex-pm-9': 'pm', ...(how.qa ? { 'a-qa-x': 'qa' } : {}) }
    const questions = how.ask ? [...(l as unknown as { questions: unknown[] }).questions, { id: 'Q-01', question: '方案頁要放幾種方案？', from: 'uiux', status: 'open', t: 0 }] : (l as unknown as { questions: unknown[] }).questions
    return next({ ...x, value: { ...l, agents, roles, questions, ...(how.paused === undefined ? {} : { paused: how.paused }) } } as never)
  })
  return armed
}

/** The PM at work on Codex in a PRD just started, as the heartbeat next writes crew's record. */
const codexAtWork = async ($: Engine, w: ReturnType<typeof world>, on: On, how: Codex = {}) => {
  const codex = onCodex(on, how)
  const root = await rooted($, w)
  await $.command.run(command('start docs/PRD.md'))
  codex.on = true
  await w.clock.advance(300_000)
  expect(codex.on).toBe(false)
  return { root, codex }
}

/**
 * A restart of Claude Code: crew's state starts empty, as a new process's
 * does, and holds only what crew writes from then on. crew's store (the
 * flow, the questions) is still on disk.
 */
const forget = (on: On) => {
  const gone = { on: false, written: new Set<string>() }
  on('state.get', async (_$, e, next) => {
    const x = e as unknown as { plugin: string; key: string }
    const r = (await next(e)) as unknown as Record<string, unknown>
    if (!gone.on || x.plugin !== 'crew' || gone.written.has(x.key)) return r as never
    // Nothing kept, at the version a write must name.
    if (typeof r.version === 'number') return { ...r, value: undefined } as never
    const v = r.value as Record<string, unknown>
    return { ...r, value: { ...v, value: undefined } } as never
  })
  on('state.set', (_$, e, next) => {
    const x = e as unknown as { plugin: string; key: string }
    if (gone.on && x.plugin === 'crew') gone.written.add(x.key)
    return next(e)
  })
  return gone
}

/** crew's word to start the cut work again, read as last looked at long ago: crew was switched off meanwhile. */
const staleWord = (on: On) => {
  const armed = { on: false }
  on('state.get', async (_$, e, next) => {
    const x = e as unknown as { plugin: string; key: string }
    const r = (await next(e)) as unknown as Record<string, any>
    if (!armed.on || x.plugin !== 'crew' || x.key !== 'reloadRedo') return r as never
    const read = typeof r.version === 'number' ? r : r.value
    if (read?.value === null || read?.value === undefined) return r as never
    const old = { ...read, value: { ...read.value, at: 0 } }
    return (typeof r.version === 'number' ? old : { ...r, value: old }) as never
  })
  return armed
}

/** The toasts raised from here on. */
const since = (w: ReturnType<typeof world>) => {
  const from = w.toasts.length
  return () => w.toasts.slice(from)
}

describe('crew’s version', () => {
  test('follows the imports for code, not those for types alone', () => {
    const text = "import { a, b } from './board'\nimport type { T } from './model'\nimport {\n  c,\n  type D,\n} from './views'\nexport { e } from './live'\nexport type { F } from './flow'\nimport x from 'claude-code'\nimport './side'\n"
    expect(importsOf(text)).toEqual(['board', 'views', 'live', 'side'])
    const files = new Set(['board.ts', 'views.tsx', 'live.ts', 'side.ts', 'register.tsx'])
    expect(importFile('board', files)).toBe('board.ts')
    expect(importFile('views', files)).toBe('views.tsx')
    expect(importFile('register.tsx', files)).toBe('register.tsx')
    expect(importFile('gone', files)).toBeUndefined()
  })

  test('is out of date once its files on disk have differed for a minute, and up to date again once they are back', async ($, on) => {
    const w = world($, on)
    const outdated = watched(on, 'outdated')
    await start($)
    await w.clock.advance(1)
    const root = [...w.reads.keys()].find(p => p.endsWith('/hooks/register.tsx'))?.slice(0, -'/hooks/register.tsx'.length)
    expect(root).toBeDefined()
    // No files to read where the test lays none: crew never says it is out of date.
    await w.clock.advance(4 * LOOK)
    expect(outdated.filter(v => v === true)).toEqual([])
    lay(w, root ?? '')
    // The files crew loaded, read when it starts: what register.tsx imports for code, and the page's server; not types alone, nor a test's world.
    await start($)
    await w.clock.advance(1)
    expect(w.reads.get(`${root}/hooks/board.ts`)).toBe(1)
    expect(w.reads.get(`${root}/web/server.py`)).toBe(1)
    expect(w.reads.has(`${root}/hooks/model.ts`)).toBe(false)
    expect(w.reads.has(`${root}/hooks/world.ts`)).toBe(false)
    // Unchanged files are looked at, not read again.
    await w.clock.advance(2 * LOOK)
    expect(w.reads.get(`${root}/hooks/board.ts`)).toBe(1)
    // A file Claude Code did not load changes: not a new version.
    w.disk.set(`${root}/hooks/model.ts`, 'export type T = 22\n')
    w.disk.set(`${root}/hooks/world.ts`, 'export const world = 22\n')
    await w.clock.advance(4 * LOOK)
    expect(outdated.at(-1)).toBe(false)
    // One that it loaded changes: a minute later, and not before, crew is out of date.
    w.disk.set(`${root}/hooks/board.ts`, 'export const a = 22\n')
    await w.clock.advance(2 * LOOK)
    expect(outdated.filter(v => v === true)).toEqual([])
    await w.clock.advance(LOOK)
    expect(outdated.at(-1)).toBe(true)
    // Read once more when it changed, not on every look.
    await w.clock.advance(2 * LOOK)
    expect(w.reads.get(`${root}/hooks/board.ts`)).toBe(2)
    // Back to the text crew loaded: up to date at the next look.
    w.disk.set(`${root}/hooks/board.ts`, 'export const a = 1\n')
    await w.clock.advance(LOOK)
    expect(outdated.at(-1)).toBe(false)
    // So is a crew that loaded the new files: a reload takes them, and crew starts up to date.
    w.disk.set(`${root}/hooks/board.ts`, 'export const a = 22\n')
    await w.clock.advance(3 * LOOK)
    expect(outdated.at(-1)).toBe(true)
    await start($)
    expect(outdated.at(-1)).toBe(false)
    await w.clock.advance(4 * LOOK)
    expect(outdated.at(-1)).toBe(false)
  })

  test('reads a new version once, though it imports other files than the one loaded', async ($, on) => {
    const w = world($, on)
    const outdated = watched(on, 'outdated')
    const root = await rooted($, w)
    const reg = `${root}/hooks/register.tsx`
    const loaded = w.reads.get(reg) ?? 0
    w.disk.set(`${root}/hooks/extra.ts`, 'export const b = 2\n')
    w.disk.set(reg, "import { a } from './board'\nimport { b } from './extra'\nimport type { T } from './model'\nexport const register = a + b\n")
    await w.clock.advance(LOOK)
    expect(w.reads.get(reg)).toBe(loaded + 1)
    expect(w.reads.get(`${root}/hooks/extra.ts`)).toBe(1)
    // Looked at, not read again, while it stays as it is: and crew says it is out of date.
    await w.clock.advance(6 * LOOK)
    expect(w.reads.get(reg)).toBe(loaded + 1)
    expect(outdated.at(-1)).toBe(true)
    // The new version's own file changes: read once more.
    w.disk.set(`${root}/hooks/extra.ts`, 'export const b = 22\n')
    await w.clock.advance(LOOK)
    expect(w.reads.get(`${root}/hooks/extra.ts`)).toBe(2)
  })

  test('a new version of crew loaded in the same Claude Code runs again by itself the tests it cut, and says so once', { timeoutMs: 60_000 }, async ($, on) => {
    const w = world($, on)
    const root = await leftTesting($, w)
    const runs = w.tests.runs.length
    const said = since(w)
    newVersion(w, root)
    await start($)
    await w.clock.advance(1)
    expect(w.tests.runs).toHaveLength(runs + 1)
    expect(said().filter(t => /換上新版了|接續/.test(t))).toEqual([expect.stringMatching(/^crew 換上新版了（\d\d:\d\d）。測試重新開始。$/)])
    const ui = await paneUi($)
    expect(await textOf(ui)).not.toMatch(/要接續嗎/)
    await ui.unmount()
  })

  test('a load of the same version (an enable, a respawn, a reload of unchanged files) waits for 接續 before the tests run again', { timeoutMs: 60_000 }, async ($, on) => {
    const w = world($, on)
    await leftTesting($, w)
    const runs = w.tests.runs.length
    const said = since(w)
    await start($)
    await w.clock.advance(1)
    expect(w.tests.runs).toHaveLength(runs)
    expect(said().some(t => /換上新版了/.test(t))).toBe(false)
    const ui = await paneUi($)
    expect(await textOf(ui)).toMatch(/停在「測試結果」。要接續嗎？/)
    await ui.unmount()
  })

  test('a restart of Claude Code waits for 接續 before the tests run again, a new version on disk or not', { timeoutMs: 60_000 }, async ($, on) => {
    const w = world($, on)
    const fresh = forget(on)
    const root = await leftTesting($, w)
    const runs = w.tests.runs.length
    newVersion(w, root)
    w.session.id = 'session-2'
    fresh.on = true
    await start($)
    await w.clock.advance(1)
    expect(w.tests.runs).toHaveLength(runs)
    expect(w.toasts.some(t => /換上新版了/.test(t))).toBe(false)
    const ui = await paneUi($)
    expect(await textOf(ui)).toMatch(/停在「測試結果」。要接續嗎？/)
    await ui.unmount()
  })

  test('a new version of crew starts again by itself the flow’s Codex run its load cut, and says so once', async ($, on) => {
    const w = world($, on)
    const { root } = await codexAtWork($, w, on)
    const spawned = w.spawned.length
    const said = since(w)
    newVersion(w, root)
    await start($)
    await w.clock.advance(1)
    // One word for the run cut and started again, with no 接續 to press.
    expect(said().filter(t => /這一輪沒有完成|換上新版了|接續/.test(t))).toEqual([expect.stringMatching(/^crew 換上新版了（\d\d:\d\d）。PM 剛才在 Codex 上的那一輪重新開始。$/)])
    // Started from the reload, the PM's run waits for a frame of the engine's, as a heartbeat's start does: a press is one.
    expect(w.spawned).toHaveLength(spawned)
    const ui = await paneUi($)
    expect(await textOf(ui)).not.toMatch(/要接續嗎/)
    await ui.press({ key: 'tab-threads' })
    expect(w.spawned).toHaveLength(spawned + 1)
    expect(w.spawned.at(-1)?.subagentType).toBe('crew:pm')
    await ui.unmount()
  })

  test('a new version waits for the roles still at work before it starts again the Codex run its load cut', async ($, on) => {
    const w = world($, on)
    const { root } = await codexAtWork($, w, on, { qa: true })
    const spawned = w.spawned.length
    const said = since(w)
    newVersion(w, root)
    await start($)
    await w.clock.advance(1)
    expect(said().filter(t => /這一輪沒有完成|換上新版了|接續/.test(t))).toEqual([expect.stringMatching(/^crew 換上新版了（\d\d:\d\d）。PM 剛才在 Codex 上的那一輪等其他角色這一輪做完就重新開始。$/)])
    // QA still at work: frames come and go, and the PM's run is not started.
    await w.clock.advance(60_000)
    const ui = await paneUi($)
    await ui.press({ key: 'tab-threads' })
    expect(w.spawned).toHaveLength(spawned)
    // QA done: no word that the flow stopped, as crew already said what comes; at the next look the PM's run starts again, said once more.
    await done($, 'a-qa-x')
    expect(said().some(t => /流程停住了/.test(t))).toBe(false)
    await w.clock.advance(20_000)
    expect(said().filter(t => /PM 剛才在 Codex 上的那一輪重新開始/.test(t))).toEqual(['crew：PM 剛才在 Codex 上的那一輪重新開始。'])
    await ui.press({ key: 'tab-progress' })
    expect(w.spawned.slice(spawned).some(s => s.subagentType === 'crew:pm')).toBe(true)
    expect(await textOf(ui)).not.toMatch(/要接續嗎/)
    await ui.unmount()
  })

  test('a reload while the Codex run cut waits keeps crew’s word, and says it once', async ($, on) => {
    const w = world($, on)
    const { root } = await codexAtWork($, w, on, { qa: true })
    const spawned = w.spawned.length
    const said = since(w)
    newVersion(w, root)
    await start($)
    await w.clock.advance(1)
    // The same files again (a respawn, a reload): nothing said again, the word stands.
    await start($)
    await w.clock.advance(1)
    expect(said().filter(t => /換上新版了|等其他角色/.test(t))).toHaveLength(1)
    await done($, 'a-qa-x')
    await w.clock.advance(20_000)
    expect(said().filter(t => /PM 剛才在 Codex 上的那一輪重新開始/.test(t))).toEqual(['crew：PM 剛才在 Codex 上的那一輪重新開始。'])
    const ui = await paneUi($)
    await ui.press({ key: 'tab-threads' })
    expect(w.spawned.slice(spawned).some(s => s.subagentType === 'crew:pm')).toBe(true)
    await ui.unmount()
  })

  test('a reset lets go of the Codex run cut that waited: the new flow is not taken for it', async ($, on) => {
    const w = world($, on)
    const { root } = await codexAtWork($, w, on, { qa: true })
    const said = since(w)
    newVersion(w, root)
    await start($)
    await w.clock.advance(1)
    expect((await $.command.run(command('reset'))).text).toMatch(/已清掉/)
    await $.command.run(command('start docs/PRD.md'))
    const pm = `a-pm-${w.spawned.length}`
    expect(w.spawned.at(-1)?.subagentType).toBe('crew:pm')
    // The new PM's run fails: the flow stops, crew says so as for any failed run, and the run cut before the reset is not what starts.
    await $.turn.complete({ answer: '', durationMs: 5, isAborted: false, turnId: 'turn-pm-x', reason: 'error', agentId: pm } as never)
    await w.clock.advance(60_000)
    expect(said().some(t => /^crew：PM 這一輪沒有完成（error）。在面板的「設定」分頁按［接續］重新開始。$/.test(t))).toBe(true)
    expect(said().some(t => /PM 剛才在 Codex 上的那一輪重新開始/.test(t))).toBe(false)
  })

  test('a new version waiting on the person says so, rather than on other roles', async ($, on) => {
    const w = world($, on)
    const { root } = await codexAtWork($, w, on, { ask: true })
    const said = since(w)
    newVersion(w, root)
    await start($)
    await w.clock.advance(1)
    expect(said().filter(t => /換上新版了/.test(t))).toEqual([expect.stringMatching(/^crew 換上新版了（\d\d:\d\d）。PM 剛才在 Codex 上的那一輪等你回答「待你決定」的事之後重新開始。$/)])
  })

  test('a reload of the same files while the cut run waits on the person says again what it waits for', async ($, on) => {
    const w = world($, on)
    const { root } = await codexAtWork($, w, on, { qa: true, ask: true })
    const said = since(w)
    newVersion(w, root)
    await start($)
    await w.clock.advance(1)
    // The same files again: no news, but the person is the one the run cut waits for, so crew says it once more.
    await start($)
    await w.clock.advance(1)
    expect(said().filter(t => /PM 剛才在 Codex 上的那一輪/.test(t))).toEqual([
      expect.stringMatching(/^crew 換上新版了（\d\d:\d\d）。PM 剛才在 Codex 上的那一輪等你回答「待你決定」的事之後重新開始。$/),
      'crew：PM 剛才在 Codex 上的那一輪等你回答「待你決定」的事之後重新開始。',
    ])
  })

  test('a run cut that got going again meanwhile is not started for crew’s word', async ($, on) => {
    const w = world($, on)
    const { root, codex: patch } = await codexAtWork($, w, on, { qa: true })
    const said = since(w)
    newVersion(w, root)
    await start($)
    await w.clock.advance(1)
    // The PM got going again and finished meanwhile; then QA is done and the flow stops.
    patch.change = l => ({ ...l, roles: { ...l.roles, pm: { ...l.roles.pm, state: 'idle', doing: '—' } } })
    await done($, 'a-qa-x')
    await w.clock.advance(60_000)
    expect(said().some(t => /PM 剛才在 Codex 上的那一輪重新開始/.test(t))).toBe(false)
  })

  test('a reload keeps crew’s word only for the runs cut that still wait', async ($, on) => {
    const w = world($, on)
    const { root, codex: patch } = await codexAtWork($, w, on, { qa: true })
    const said = since(w)
    newVersion(w, root)
    await start($)
    await w.clock.advance(1)
    patch.change = l => ({ ...l, roles: { ...l.roles, pm: { ...l.roles.pm, state: 'idle', doing: '—' } } })
    await done($, 'a-qa-x')
    // Reloaded before crew's next look: the PM's run is no longer one to start again.
    await start($)
    await w.clock.advance(60_000)
    expect(said().some(t => /PM 剛才在 Codex 上的那一輪重新開始/.test(t))).toBe(false)
  })

  test('a reload while crew’s word stands takes the flow’s Codex run it cuts along, with no 接續 asked for', async ($, on) => {
    const w = world($, on)
    const { root, codex: patch } = await codexAtWork($, w, on, { qa: true })
    const said = since(w)
    newVersion(w, root)
    await start($)
    await w.clock.advance(1)
    // QA goes on to the flow's work on Codex; then the same files load again.
    patch.change = l => ({ ...l, agents: { ...l.agents, 'codex-qa-7': 'qa' }, roles: { ...l.roles, qa: { ...l.roles.qa, state: 'working', engine: 'codex', agentId: 'codex-qa-7', run: 'flow', doing: '寫 test case' } } })
    await done($, 'a-qa-x')
    await start($)
    await w.clock.advance(1)
    expect(said().some(t => /QA 這一輪沒有完成[\s\S]*按［接續］/.test(t))).toBe(false)
    expect(said().filter(t => /^crew：.*重新開始。$/.test(t))).toEqual(['crew：PM、QA 剛才在 Codex 上的那一輪重新開始。'])
  })

  test('crew’s word does not outlive crew switched off: a later load waits for 接續', async ($, on) => {
    const w = world($, on)
    const stale = staleWord(on)
    const { root } = await codexAtWork($, w, on, { qa: true })
    const said = since(w)
    newVersion(w, root)
    await start($)
    await w.clock.advance(1)
    stale.on = true
    await start($)
    stale.on = false
    await done($, 'a-qa-x')
    await w.clock.advance(60_000)
    expect(said().some(t => /PM 剛才在 Codex 上的那一輪重新開始/.test(t))).toBe(false)
  })

  test('the heartbeat starts the cut run as crew said it would, when it is the first to find the flow stopped', async ($, on) => {
    const w = world($, on)
    const { root } = await codexAtWork($, w, on, { qa: true })
    const said = since(w)
    newVersion(w, root)
    await start($)
    await w.clock.advance(1)
    // QA is done just after one of crew's looks: the heartbeat comes before the next.
    await w.clock.advance(280_000)
    await done($, 'a-qa-x')
    await w.clock.advance(20_000)
    expect(said().filter(t => /PM 剛才在 Codex 上的那一輪重新開始|^crew：接續/.test(t))).toEqual(['crew：PM 剛才在 Codex 上的那一輪重新開始。'])
  })

  test('crew’s word stays fresh while the cut run waits: a reload ten minutes on still starts it', async ($, on) => {
    const w = world($, on)
    const { root } = await codexAtWork($, w, on, { qa: true })
    const said = since(w)
    newVersion(w, root)
    await start($)
    await w.clock.advance(1)
    // QA at work for ten minutes, past the two minutes a word nobody looks at outlives; then the same files load again.
    await w.clock.advance(600_000)
    await start($)
    await w.clock.advance(1)
    await done($, 'a-qa-x')
    await w.clock.advance(20_000)
    expect(said().filter(t => /PM 剛才在 Codex 上的那一輪重新開始/.test(t))).toEqual(['crew：PM 剛才在 Codex 上的那一輪重新開始。'])
  })

  test('a cut run the heartbeat finds gone on without it leaves the flow to be woken as any other', async ($, on) => {
    const w = world($, on)
    const { root, codex: patch } = await codexAtWork($, w, on, { qa: true })
    const said = since(w)
    newVersion(w, root)
    await start($)
    await w.clock.advance(1)
    // The PM got going again and finished meanwhile; QA is done just after one of crew's looks, so the heartbeat comes first.
    await w.clock.advance(280_000)
    patch.change = l => ({ ...l, roles: { ...l.roles, pm: { ...l.roles.pm, state: 'idle', doing: '—' } } })
    await done($, 'a-qa-x')
    await w.clock.advance(20_000)
    expect(said().filter(t => /PM 剛才在 Codex 上的那一輪重新開始|^crew：接續/.test(t))).toEqual([expect.stringMatching(/^crew：接續 /)])
  })

  test('a cut run that comes to wait on the person says so while it waits', async ($, on) => {
    const w = world($, on)
    const { root, codex: patch } = await codexAtWork($, w, on, { qa: true })
    const said = since(w)
    newVersion(w, root)
    await start($)
    await w.clock.advance(1)
    // QA is done, and a question for the person is open: the run cut now waits on the person, not on other roles.
    patch.change = l => ({ ...l, questions: [...l.questions, { id: 'Q-01', question: '方案頁要放幾種方案？', from: 'uiux', status: 'open', t: 0 }] })
    await done($, 'a-qa-x')
    await w.clock.advance(20_000)
    expect(said().filter(t => /PM 剛才在 Codex 上的那一輪/.test(t))).toEqual([
      expect.stringMatching(/^crew 換上新版了（\d\d:\d\d）。PM 剛才在 Codex 上的那一輪等其他角色這一輪做完就重新開始。$/),
      'crew：PM 剛才在 Codex 上的那一輪等你回答「待你決定」的事之後重新開始。',
    ])
  })

  test('a cut run that cannot start again says why in crew’s own words', async ($, on) => {
    const w = world($, on)
    const { root } = await codexAtWork($, w, on)
    const said = since(w)
    // The board is gone: crew's resume refuses, as it would on 接續.
    w.disk.delete(`${ROOT}/.crew/prd-tracker.json`)
    newVersion(w, root)
    await start($)
    await w.clock.advance(1)
    const words = said().filter(t => /換上新版了/.test(t))
    expect(words).toEqual([expect.stringMatching(/^crew 換上新版了（\d\d:\d\d）。PM 剛才在 Codex 上的那一輪沒有自己重新開始：.+要接著做就按［接續］。$/)])
    expect(words[0]).not.toMatch(/沒有接續/)
  })

  test('a new version does not start again a Codex run the person asked for', async ($, on) => {
    const w = world($, on)
    const { root } = await codexAtWork($, w, on, { run: 'person' })
    const spawned = w.spawned.length
    const said = since(w)
    newVersion(w, root)
    await start($)
    await w.clock.advance(1)
    expect(said().some(t => /PM 這一輪沒有完成：crew 的程式重新載入了[\s\S]*按［接續］重新開始/.test(t))).toBe(true)
    expect(said().some(t => /換上新版了/.test(t))).toBe(false)
    const ui = await paneUi($)
    await ui.press({ key: 'tab-threads' })
    expect(w.spawned).toHaveLength(spawned)
    await ui.unmount()
  })

  test('a new version does not start again the work of a flow the person held', async ($, on) => {
    const w = world($, on)
    const { root } = await codexAtWork($, w, on, { paused: 'person' })
    const spawned = w.spawned.length
    const said = since(w)
    newVersion(w, root)
    await start($)
    await w.clock.advance(1)
    expect(said().some(t => /PM 這一輪沒有完成：crew 的程式重新載入了[\s\S]*按［接續］重新開始/.test(t))).toBe(true)
    expect(said().some(t => /換上新版了/.test(t))).toBe(false)
    const ui = await paneUi($)
    await ui.press({ key: 'tab-threads' })
    expect(w.spawned).toHaveLength(spawned)
    await ui.unmount()
  })

  test('a load of the same version in another conversation leaves the Codex run it cut for the person to start again', async ($, on) => {
    const w = world($, on)
    await codexAtWork($, w, on)
    const spawned = w.spawned.length
    const said = since(w)
    w.session.id = 'session-2'
    await start($)
    await w.clock.advance(1)
    expect(said().some(t => /PM 這一輪沒有完成：crew 的程式重新載入了[\s\S]*在面板的「設定」分頁按［接續］重新開始/.test(t))).toBe(true)
    expect(said().some(t => /換上新版了/.test(t))).toBe(false)
    // Nothing starts by itself: the 接續 the word names is on the settings tab.
    const ui = await paneUi($)
    await ui.press({ key: 'tab-settings' })
    expect(w.spawned).toHaveLength(spawned)
    expect(JSON.stringify(await ui.find({ key: 'resume' }))).toMatch(/接續/)
    await ui.unmount()
  })

  test('carries the version to the page: the banner where the disk moved on, what started again', () => {
    expect(buildHead({ id: 'v1', at: 5, redo: '' }, false)).toEqual({ id: 'v1', at: 5 })
    expect(buildHead({ id: 'v1', at: 5, redo: '測試重新開始。' }, true)).toEqual({ id: 'v1', at: 5, behind: true, redo: '測試重新開始。' })
    // A version crew could not read is never said to be behind.
    expect(buildHead({ id: '', at: 5, redo: '' }, true)).toEqual({ id: '', at: 5 })
  })

  test('says on the pane beside the page, with no command to type, that crew is out of date', async ($, on) => {
    const w = world($, on)
    // crew's page up, as crew records it: the pane is the short one beside the page.
    on('state.set', (_$, e, next) => {
      const x = e as unknown as { plugin: string; key: string; value: unknown }
      if (x.plugin !== 'crew' || x.key !== 'webStatus') return next(e)
      return next({ ...x, value: { state: 'up', local: 'http://127.0.0.1:7400/', open: 'http://127.0.0.1:7400/#k=test' } } as never)
    })
    await start($)
    await w.clock.advance(1)
    const root = [...w.reads.keys()].find(p => p.endsWith('/hooks/register.tsx'))?.slice(0, -'/hooks/register.tsx'.length)
    lay(w, root ?? '')
    await start($)
    await w.clock.advance(1)
    const ui = await paneUi($)
    expect(await textOf(ui)).toMatch(/沒有事情等你決定/)
    expect(await textOf(ui)).not.toMatch(/新版本還沒換上/)
    w.disk.set(`${root}/hooks/board.ts`, 'export const a = 22\n')
    await w.clock.advance(3 * LOOK)
    const text = await textOf(ui)
    expect(text).toMatch(/crew 有新版本還沒換上・換的方法在網頁上/)
    expect(text).not.toMatch(/reload-plugins|\/crew/)
    await ui.unmount()
  })
})
