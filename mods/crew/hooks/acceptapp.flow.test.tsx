import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { agentOf, approve, APP_CMD, APP_URL, build, checked, command, designed, done, NOW, paneText, paneUi, PLAN, reportShots, ROOT, SPLIT, start, textOf, world, write } from './world'

/**
 * The app kept up for the person's acceptance: started only on their own
 * press of ［開 app 並打開這一頁］ on a 待你驗收 card (crew's web page, on this
 * computer), as QA's check starts it; shared with QA's checks; closed on
 * ［關掉 app］, once each feature it serves is decided, and when crew reloads.
 */

const planned = async ($: Engine) => {
  await $.command.run(command('start docs/PRD.md'))
  await write($, 'a-pm-1', SPLIT)
  await done($, 'a-pm-1')
  await write($, 'a-qa-2', [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }])
  await done($, 'a-qa-2')
  await designed($)
  await write($, 'a-techlead-4', PLAN)
  await done($, 'a-techlead-4')
}

const QA_DIR = `${ROOT}/.crew/work/prd-qa`
const STATE = `state:${ROOT}`

type Kept = { state: string; features: string[]; since: number; sha?: string; dir?: string; url?: string; pids?: string[]; log?: string; why?: string; checking?: string; background?: true }
type W = ReturnType<typeof world>

/** The app kept for acceptance, as crew saved it. */
const keptOf = (w: W): Kept | undefined => (w.store.get(STATE) as { acceptApp?: Kept } | undefined)?.acceptApp

/** The card of a feature on crew's decide page, as last written. */
const cardOf = (w: W, feature: string) => {
  const file = [...w.disk.keys()].filter(p => p.endsWith('/data.json') && p.includes('/designs/')).at(-1) ?? ''
  const data = JSON.parse(w.disk.get(file) ?? '{}') as { accept?: { feature: string; code: string; open?: { url?: string; start?: string; qaSha?: string; app?: { state: string; mine: boolean; sha?: string; why?: string; log?: string; checking?: string; background?: true; waits?: { tests: number; merges: number } } } }[] }
  return data.accept?.find(a => a.feature === feature)
}

/** Lets crew go on, a second of the clock at a time, until `cond` (or the most it waits). */
const until = async (w: W, cond: () => boolean, most = 90) => {
  for (let n = 0; n < most && !cond(); n++) await w.clock.advance(1_000)
}

let sent = 0
/**
 * The person presses on crew's web page (opened on this computer, or from
 * another device on the tailnet): the page sends crew its word, as a decision,
 * and gets crew's answer.
 */
const press = async (w: W, text: string, via: 'local' | 'tailnet' = 'local') => {
  sent += 1
  const id = `d-${sent}`
  const client = via === 'local' ? 'c-local-0001' : 'c-phone-0001'
  w.web.say({ t: 'hello', client, tab: 'decide', via })
  w.web.say({ t: 'decide', client, id, text, via })
  await until(w, () => w.web.answers().some(a => a.id === id), 30)
  return w.web.answers().find(a => a.id === id)
}

/** QA checked both features and they wait for the person, with crew's web page up. */
const handed = async ($: Engine, w: W) => {
  await start($)
  await planned($)
  await build($)
  await checked($)
  await until(w, () => w.web.started > 0, 5)
}

const crew = ($: Engine, input: Record<string, unknown>) => $.tool.call({ tool: 'mcp__crew__crew', tool_use_id: `c-${Math.random()}`, ...input } as never) as Promise<{ result: unknown }>

/** QA's reports as crew keeps them, by feature and round. */
const reportsOf = (w: W): { file: string; kept: { features: Record<string, Record<string, unknown>[]> } } => {
  const file = [...w.disk.keys()].find(p => p.endsWith('/acceptance.json')) ?? ''
  return { file, kept: JSON.parse(w.disk.get(file) ?? '{}') as { features: Record<string, Record<string, unknown>[]> } }
}

/** QA's last report on each feature (or `only`) as an older crew wrote it, read and not checked in the app: once the app is set again, crew checks it in the app. */
const markRead = (w: W, only?: string) => {
  const { file, kept } = reportsOf(w)
  for (const [f, rounds] of Object.entries(kept.features)) {
    if (only !== undefined && f !== only) continue
    const last = rounds.at(-1) ?? {}
    rounds[rounds.length - 1] = { ...last, read: true, items: (last.items as Record<string, unknown>[]).map(({ desktop: _d, phone: _p, api: _a, ...i }) => ({ ...i, how: '打開首頁' })) }
  }
  w.disk.set(file, JSON.stringify(kept))
}

/** How many QAs crew started to check in the app. */
const checkersOf = (w: W): number => w.spawned.filter(s => s.subagentType === 'crew:checker').length

/** A check the flow waits on now. */
const checking = (w: W): boolean => Object.values((w.store.get(STATE) as { flow?: { checks?: Record<string, { state?: string }> } } | undefined)?.flow?.checks ?? {}).some(c => c.state === 'running')

/** The person's tests run when nothing holds them: crew's test command, asked for now, runs. */
const testsRun = async ($: Engine, w: W): Promise<boolean> => {
  const ran = w.tests.runs.length
  await $.command.run(command('test'))
  await until(w, () => w.tests.runs.length > ran, 60)
  return w.tests.runs.length > ran
}

/** QA reads both features again (as an older crew only read them): crew checks each again in the app, the next round. */
const checkAgain = async ($: Engine, w: W) => {
  const file = [...w.disk.keys()].find(p => p.endsWith('/acceptance.json')) ?? ''
  const kept = JSON.parse(w.disk.get(file) ?? '{}') as { features: Record<string, Record<string, unknown>[]> }
  for (const rounds of Object.values(kept.features)) {
    const last = rounds.at(-1) ?? {}
    rounds[rounds.length - 1] = { ...last, read: true, items: (last.items as Record<string, unknown>[]).map(({ desktop: _d, phone: _p, api: _a, ...i }) => ({ ...i, how: '打開首頁' })) }
  }
  w.disk.set(file, JSON.stringify(kept))
  await $.command.run(command(`app-url ${APP_URL}`))
  await checked($)
}

describe('the app kept for acceptance', () => {
  test('starts only on the person’s own press on this computer, as QA’s check starts it, and closes on ［關掉 app］', async ($, on) => {
    const w = world($, on, { web: true })
    await handed($, w)
    const checks = w.app.starts.length
    expect(checks).toBeGreaterThan(0)
    expect(w.app.up).toBe(false)
    // The brain cannot press it for them, whatever it relays.
    expect(String((await crew($, { action: 'decide', text: 'crew 驗收 app：開 PRD-001', question: '1' })).result)).toMatch(/只在 crew 網頁|crew 網頁/)
    // Nor from another device: the app runs, and its page opens, on this computer.
    expect((await press(w, 'crew 驗收 app：開 PRD-001', 'tailnet'))?.text).toMatch(/只能在跑 crew 的這台電腦上開/)
    await w.clock.advance(5_000)
    expect(w.app.starts).toHaveLength(checks)
    expect(keptOf(w)).toBeUndefined()
    // The person's own press on this computer: QA's start command, in QA's worktree, with QA's environment.
    expect((await press(w, 'crew 驗收 app：開 PRD-001'))?.text).toMatch(/crew 開始開 app 了/)
    await until(w, () => keptOf(w)?.state === 'up')
    expect(w.app.starts).toHaveLength(checks + 1)
    expect(w.app.starts.at(-1)).toMatchObject({ argv: APP_CMD.split(' '), cwd: QA_DIR, env: { CREW_QA: '1', BROWSER: 'none' } })
    expect(w.app.starts.at(-1)?.env?.COMPOSE_PROJECT_NAME).toBe(w.app.starts[0]?.env?.COMPOSE_PROJECT_NAME)
    const kept = keptOf(w)
    expect(kept).toMatchObject({ state: 'up', features: ['PRD-001'], dir: QA_DIR, url: APP_URL, pids: ['4242'] })
    // At the commit QA checked the feature on: the card says it, with ［關掉 app］ on the page and the link to open.
    const card = cardOf(w, 'PRD-001')
    expect(card?.open?.app).toMatchObject({ state: 'up', mine: true, sha: kept?.sha?.slice(0, 7) })
    expect(card?.open?.qaSha).toBe(kept?.sha?.slice(0, 7))
    expect(card?.open?.url).toBe(APP_URL)
    // The pane says it too, with its own ［關掉 app］.
    expect(await paneText($)).toMatch(new RegExp(`驗收用的 app 開著（${kept?.sha?.slice(0, 7) ?? '?'}）：PRD-001`))
    // A press on another card while it is up: that feature is served too, and its page opens at once.
    expect((await press(w, 'crew 驗收 app：開 PRD-002'))?.text).toMatch(/驗收用的 app 開著（[0-9a-f]{7}）：打開 PRD-002 的頁面/)
    expect(w.app.starts).toHaveLength(checks + 1)
    expect(keptOf(w)?.features).toEqual(['PRD-001', 'PRD-002'])
    // ［關掉 app］: crew stops what it started, and keeps what it printed.
    expect((await press(w, 'crew 驗收 app：關'))?.text).toMatch(/已關掉驗收用的 app/)
    expect(w.app.up).toBe(false)
    expect(w.app.calls.filter(c => c[0] === '/bin/kill').at(-1)).toContain('4242')
    expect(keptOf(w)).toBeUndefined()
    const log = [...w.disk.keys()].filter(p => p.startsWith(`${ROOT}/.crew/runs/accept-app-`) && p.endsWith('.log'))
    expect(log).toHaveLength(1)
    expect(w.disk.get(log[0] ?? '')).toMatch(/^\$ npm run dev\n# \/repo\/\.crew\/work\/prd-qa @ [0-9a-f]{7}\n# http:\/\/localhost:3000\n[\s\S]*ready on http:\/\/localhost:3000/)
    expect(cardOf(w, 'PRD-001')?.open?.app).toBeUndefined()
  })

  test('starts nothing over a program crew did not start at the URL: the card says it may be the person’s own, and keeps the link', async ($, on) => {
    const w = world($, on, { web: true })
    await handed($, w)
    const checks = w.app.starts.length
    // The person's own app answers there.
    w.app.up = true
    await press(w, 'crew 驗收 app：開 PRD-001')
    await until(w, () => keptOf(w)?.state === 'theirs')
    expect(keptOf(w)?.state).toBe('theirs')
    expect(w.app.starts).toHaveLength(checks)
    expect(cardOf(w, 'PRD-001')?.open).toMatchObject({ url: APP_URL, app: { state: 'theirs', mine: true } })
    // ［不用了］ stops nothing of theirs.
    const kills = w.app.calls.filter(c => c[0] === '/bin/kill').length
    expect((await press(w, 'crew 驗收 app：關'))?.text).toMatch(/那個 app 不是 crew 開的，crew 沒有關它/)
    expect(w.app.up).toBe(true)
    expect(w.app.calls.filter(c => c[0] === '/bin/kill')).toHaveLength(kills)
    expect(keptOf(w)).toBeUndefined()
  })

  test('closes once each feature it serves is decided: passed or sent back', async ($, on) => {
    const w = world($, on, { web: true })
    await handed($, w)
    await press(w, 'crew 驗收 app：開 PRD-001')
    await until(w, () => keptOf(w)?.state === 'up')
    await press(w, 'crew 驗收 app：開 PRD-002')
    // One passed: the app goes on serving the other.
    expect((await press(w, `crew 驗收：通過 PRD-001\n代碼 ${cardOf(w, 'PRD-001')?.code ?? ''}`))?.ok).toBe(true)
    await w.clock.settle()
    expect(keptOf(w)).toMatchObject({ state: 'up', features: ['PRD-002'] })
    expect(w.app.up).toBe(true)
    // The other sent back: nothing left to serve, so crew closes it.
    expect((await press(w, `crew 驗收：要改 PRD-002\n原話：按鈕文字改成「取消訂閱」\n代碼 ${cardOf(w, 'PRD-002')?.code ?? ''}`))?.ok).toBe(true)
    await until(w, () => keptOf(w) === undefined, 10)
    expect(keptOf(w)).toBeUndefined()
    expect(w.app.up).toBe(false)
    expect(w.app.calls.filter(c => c[0] === '/bin/kill').at(-1)).toContain('4242')
  })

  test('the pane’s ［關掉 app］ stops it', async ($, on) => {
    const w = world($, on, { web: true })
    await handed($, w)
    await press(w, 'crew 驗收 app：開 PRD-001')
    await until(w, () => keptOf(w)?.state === 'up')
    const ui = await paneUi($)
    expect(await textOf(ui)).toMatch(/驗收用的 app 開著/)
    await ui.press({ key: 'acc-app-close' })
    await w.clock.settle()
    await ui.unmount()
    expect(keptOf(w)).toBeUndefined()
    expect(w.app.up).toBe(false)
  })

  test('QA’s check uses it as it runs at the same commit, and it stays up after', async ($, on) => {
    const w = world($, on, { web: true })
    await handed($, w)
    await press(w, 'crew 驗收 app：開 PRD-001')
    await until(w, () => keptOf(w)?.state === 'up')
    const starts = w.app.starts.length
    const sha = keptOf(w)?.sha
    const checkers = w.spawned.filter(s => s.subagentType === 'crew:checker').length
    await checkAgain($, w)
    // Each feature checked again, on the app as it runs: no 「網址已經有程式在回應」, nothing started or stopped.
    expect(w.spawned.filter(s => s.subagentType === 'crew:checker').length).toBe(checkers + 2)
    expect(w.app.starts).toHaveLength(starts)
    expect(w.app.up).toBe(true)
    expect(keptOf(w)).toMatchObject({ state: 'up', sha, features: ['PRD-001'] })
    expect(keptOf(w)?.checking).toBeUndefined()
    const asked = ((w.store.get(STATE) as { questions?: { question: string }[] }).questions ?? []).filter(q => /網址已經有程式在回應|QA 沒辦法在 app 裡實際操作/.test(q.question))
    expect(asked).toEqual([])
  })

  test('QA’s check at another commit: crew stops it, moves QA’s worktree there, starts it again, and the card says the commit', async ($, on) => {
    const w = world($, on, { web: true })
    await handed($, w)
    await press(w, 'crew 驗收 app：開 PRD-001')
    await until(w, () => keptOf(w)?.state === 'up')
    const starts = w.app.starts.length
    const kills = () => w.app.calls.filter(c => c[0] === '/bin/kill').length
    const killed = kills()
    const was = keptOf(w)?.sha ?? ''
    const tip = w.commit('PRD-001: 修文案')
    await checkAgain($, w)
    // Stopped once and started once at the new commit; both checks then use it as it runs.
    expect(w.app.starts).toHaveLength(starts + 1)
    expect(kills()).toBe(killed + 1)
    expect(w.app.starts.at(-1)).toMatchObject({ argv: APP_CMD.split(' '), cwd: QA_DIR })
    expect(w.app.up).toBe(true)
    expect(keptOf(w)).toMatchObject({ state: 'up', sha: tip })
    expect(tip).not.toBe(was)
    expect(cardOf(w, 'PRD-001')?.open?.app).toMatchObject({ state: 'up', sha: tip.slice(0, 7) })
    // Closed: nothing of it left running.
    await press(w, 'crew 驗收 app：關')
    expect(w.app.up).toBe(false)
    expect(kills()).toBe(killed + 2)
  })

  test('crew’s test runs wait while it is up, and the card and the pane say how many', async ($, on) => {
    const w = world($, on, { web: true })
    await handed($, w)
    await press(w, 'crew 驗收 app：開 PRD-001')
    await until(w, () => keptOf(w)?.state === 'up')
    const ran = w.tests.runs.length
    await $.command.run(command('test'))
    await w.clock.advance(5_000)
    expect(w.tests.runs.length).toBe(ran)
    expect(await paneText($)).toMatch(/1 個合回／測試在等你關掉 app/)
    await w.clock.advance(1_000)
    expect(cardOf(w, 'PRD-001')?.open?.app?.waits).toEqual({ tests: 1, merges: 0 })
    await press(w, 'crew 驗收 app：關')
    await until(w, () => w.tests.runs.length > ran, 20)
    expect(w.tests.runs.length).toBeGreaterThan(ran)
    expect(await paneText($)).not.toMatch(/在等你關掉 app/)
  })

  test('the app the load before kept is stopped once crew loads again', async ($, on) => {
    const w = world($, on, { web: true })
    // As the load before left it: up for PRD-001, in QA's worktree.
    w.store.set(STATE, { prdPath: 'docs/PRD.md', flow: { stage: 'done', round: 0, retries: 0 }, questions: [], lead: 'person', acceptApp: { state: 'up', features: ['PRD-001'], since: NOW - 60_000, dir: QA_DIR, url: APP_URL, pids: ['4242'], sha: 'c0ffee'.padEnd(40, '0') } })
    w.app.up = true
    w.app.since = NOW - 60_000
    await start($)
    await until(w, () => keptOf(w) === undefined, 10)
    expect(keptOf(w)).toBeUndefined()
    expect(w.app.calls.filter(c => c[0] === '/bin/kill').at(-1)).toContain('4242')
    expect(w.app.up).toBe(false)
  })

  test('Claude Code ending stops what crew kept up', async ($, on) => {
    const w = world($, on, { web: true })
    // What lies beneath the plugins answers the end, as Claude Code does.
    on('session.end', (_$, e) => ({ sessionId: (e as { sessionId: string }).sessionId }) as never)
    await handed($, w)
    await press(w, 'crew 驗收 app：開 PRD-001')
    await until(w, () => keptOf(w)?.state === 'up')
    await $.session.end({ reason: 'prompt_input_exit', sessionId: 'session-1', resume: {} } as never)
    expect(w.app.calls.filter(c => c[0] === '/bin/kill').at(-1)).toEqual(['/bin/kill', '-TERM', '4242'])
  })
})

describe('the app kept for acceptance, closed or decided while QA’s check runs on it', () => {
  test('closed while a check moves it to another commit: the check goes on with it, crew stops it as the check ends, and tests run after', async ($, on) => {
    const w = world($, on, { web: true })
    await handed($, w)
    await press(w, 'crew 驗收 app：開 PRD-001')
    await until(w, () => keptOf(w)?.state === 'up')
    w.commit('PRD-001: 修文案')
    // The app takes 20 seconds to answer: the person presses while crew moves it.
    w.app.upDelay = 20_000
    const checkers = checkersOf(w)
    markRead(w)
    await $.command.run(command(`app-url ${APP_URL}`))
    await until(w, () => keptOf(w)?.state === 'starting' && keptOf(w)?.checking !== undefined, 60)
    const feature = keptOf(w)?.checking ?? ''
    expect(feature).toMatch(/^PRD-00[12]$/)
    // The check's now: the person is told it stops once QA is done, and the card says 關掉中 till then, with nothing to press.
    expect((await press(w, 'crew 驗收 app：關'))?.text).toBe(`QA 正在用它檢查 ${feature}，檢查完 crew 就關掉。`)
    expect(keptOf(w)).toMatchObject({ state: 'closing', checking: feature })
    await w.clock.advance(1_000)
    expect(cardOf(w, 'PRD-001')?.open?.app).toMatchObject({ state: 'closing', checking: feature })
    expect(await paneText($)).toMatch(new RegExp(`驗收用的 app 關掉中：QA 正在用它檢查 ${feature}，檢查完 crew 就關掉`))
    // Pressed again, or ［開 app］ meanwhile: nothing changes.
    expect((await press(w, 'crew 驗收 app：關'))?.text).toBe(`QA 正在用它檢查 ${feature}，檢查完 crew 就關掉。`)
    expect((await press(w, 'crew 驗收 app：開 PRD-001'))?.text).toMatch(new RegExp(`等 QA 檢查完 ${feature} 就會關掉`))
    // QA checks both features, the first on the app as moved, the second on its own; each stops as its check ends.
    await checked($)
    expect(checkersOf(w)).toBe(checkers + 2)
    expect(checking(w)).toBe(false)
    expect(w.app.up).toBe(false)
    expect(keptOf(w)).toBeUndefined()
    expect(cardOf(w, 'PRD-001')?.open?.app).toBeUndefined()
    // QA's worktree and the app's port are free: the person's tests run.
    expect(await testsRun($, w)).toBe(true)
  })

  test('the only feature it serves passed while a check moves it: it closes as that check ends', async ($, on) => {
    const w = world($, on, { web: true })
    await handed($, w)
    await press(w, 'crew 驗收 app：開 PRD-001')
    await until(w, () => keptOf(w)?.state === 'up')
    w.commit('PRD-002: 修文案')
    w.app.upDelay = 20_000
    const checkers = checkersOf(w)
    markRead(w, 'PRD-002')
    await $.command.run(command(`app-url ${APP_URL}`))
    await until(w, () => keptOf(w)?.state === 'starting' && keptOf(w)?.checking === 'PRD-002', 60)
    expect((await press(w, `crew 驗收：通過 PRD-001\n代碼 ${cardOf(w, 'PRD-001')?.code ?? ''}`))?.ok).toBe(true)
    await until(w, () => keptOf(w)?.state === 'closing', 10)
    expect(keptOf(w)).toMatchObject({ state: 'closing', checking: 'PRD-002' })
    await checked($)
    expect(checkersOf(w)).toBe(checkers + 1)
    expect(checking(w)).toBe(false)
    expect(w.app.up).toBe(false)
    expect(keptOf(w)).toBeUndefined()
    expect(await testsRun($, w)).toBe(true)
  })

  test('closed as a check starts on it at the same commit: it stays up for QA, and stops as the check ends', async ($, on) => {
    const w = world($, on, { web: true })
    await handed($, w)
    await press(w, 'crew 驗收 app：開 PRD-001')
    await until(w, () => keptOf(w)?.state === 'up')
    const starts = w.app.starts.length
    const checkers = checkersOf(w)
    markRead(w, 'PRD-002')
    await $.command.run(command(`app-url ${APP_URL}`))
    // crew's look at the commit the check needs (its first, past the command's own) takes a while: the person presses meanwhile.
    w.slow.git = { has: 'refs/heads/crew/prd^{commit}', ms: 20_000, held: 0 }
    await until(w, () => w.slow.git.held > 0, 30)
    expect(w.slow.git.held).toBe(1)
    expect(keptOf(w)?.checking).toBeUndefined()
    expect((await press(w, 'crew 驗收 app：關'))?.text).toBe('QA 正在用它檢查 PRD-002，檢查完 crew 就關掉。')
    expect(keptOf(w)).toMatchObject({ state: 'closing', checking: 'PRD-002' })
    // Up till QA is done with it, then stopped: nothing started over.
    await until(w, () => checkersOf(w) > checkers, 30)
    if (checkersOf(w) === checkers) await $.turn.complete({ answer: '好', durationMs: 5, isAborted: false, turnId: 'turn-close-start', reason: 'answer' } as never)
    expect(w.app.up).toBe(true)
    await checked($)
    expect(checkersOf(w)).toBe(checkers + 1)
    expect(w.app.starts).toHaveLength(starts)
    expect(checking(w)).toBe(false)
    expect(w.app.up).toBe(false)
    expect(keptOf(w)).toBeUndefined()
    expect(await testsRun($, w)).toBe(true)
  })

  test('closed between QA taking its worktree and the check looking at the app: the check runs on that app, not over it', async ($, on) => {
    const w = world($, on, { web: true })
    await handed($, w)
    await press(w, 'crew 驗收 app：開 PRD-001')
    await until(w, () => keptOf(w)?.state === 'up')
    const starts = w.app.starts.length
    const checkers = checkersOf(w)
    markRead(w, 'PRD-002')
    // The check reads the stop command just after it takes QA's worktree: that read takes a while, and the person presses meanwhile.
    w.slow.key = { prefix: `stop:${ROOT}`, ms: 20_000, held: 0 }
    await $.command.run(command(`app-url ${APP_URL}`))
    await until(w, () => w.slow.key.held > 0, 30)
    expect((await press(w, 'crew 驗收 app：關'))?.text).toBe('QA 正在用它檢查 PRD-002，檢查完 crew 就關掉。')
    await checked($)
    expect(checkersOf(w)).toBe(checkers + 1)
    // QA's worktree was not moved under the app, nor 「網址已經有程式在回應」 asked.
    expect(w.app.starts).toHaveLength(starts)
    const asked = ((w.store.get(STATE) as { questions?: { question: string }[] }).questions ?? []).filter(q => /網址已經有程式在回應/.test(q.question))
    expect(asked).toEqual([])
    expect(w.app.up).toBe(false)
    expect(keptOf(w)).toBeUndefined()
    expect(await testsRun($, w)).toBe(true)
  })

  test('closed while QA is at work on it: up till QA is done, then stopped', async ($, on) => {
    const w = world($, on, { web: true })
    await handed($, w)
    await press(w, 'crew 驗收 app：開 PRD-001')
    await until(w, () => keptOf(w)?.state === 'up')
    const checkers = checkersOf(w)
    markRead(w, 'PRD-002')
    await $.command.run(command(`app-url ${APP_URL}`))
    for (let n = 0; n < 10 && checkersOf(w) === checkers; n++) {
      await w.clock.advance(10_000)
      await $.turn.complete({ answer: '好', durationMs: 5, isAborted: false, turnId: `turn-qa-${n}`, reason: 'answer' } as never)
    }
    expect(checkersOf(w)).toBe(checkers + 1)
    expect((await press(w, 'crew 驗收 app：關'))?.text).toBe('QA 正在用它檢查 PRD-002，檢查完 crew 就關掉。')
    expect(w.app.up).toBe(true)
    await w.clock.advance(1_000)
    expect(cardOf(w, 'PRD-001')?.open?.app).toMatchObject({ state: 'closing', checking: 'PRD-002' })
    await checked($)
    expect(w.app.up).toBe(false)
    expect(keptOf(w)).toBeUndefined()
  })

  test('closed while QA is at work on it, then Claude Code ends: what crew started there is stopped, though no longer kept', async ($, on) => {
    const w = world($, on, { web: true })
    on('session.end', (_$, e) => ({ sessionId: (e as { sessionId: string }).sessionId }) as never)
    await handed($, w)
    await press(w, 'crew 驗收 app：開 PRD-001')
    await until(w, () => keptOf(w)?.state === 'up')
    const checkers = checkersOf(w)
    markRead(w, 'PRD-002')
    await $.command.run(command(`app-url ${APP_URL}`))
    for (let n = 0; n < 10 && checkersOf(w) === checkers; n++) {
      await w.clock.advance(10_000)
      await $.turn.complete({ answer: '好', durationMs: 5, isAborted: false, turnId: `turn-qa-${n}`, reason: 'answer' } as never)
    }
    expect((await press(w, 'crew 驗收 app：關'))?.text).toBe('QA 正在用它檢查 PRD-002，檢查完 crew 就關掉。')
    const kills = w.app.calls.filter(c => c[0] === '/bin/kill').length
    await $.session.end({ reason: 'prompt_input_exit', sessionId: 'session-1', resume: {} } as never)
    expect(w.app.calls.filter(c => c[0] === '/bin/kill')).toHaveLength(kills + 1)
    expect(w.app.calls.filter(c => c[0] === '/bin/kill').at(-1)).toEqual(['/bin/kill', '-TERM', '4242'])
  })
})

describe('the app kept for acceptance, on its own', () => {
  test('a crash is on the card at once, not at the next heartbeat', async ($, on) => {
    const w = world($, on, { web: true })
    await handed($, w)
    await press(w, 'crew 驗收 app：開 PRD-001')
    await until(w, () => keptOf(w)?.state === 'up')
    // It ends by itself.
    w.app.up = false
    w.app.stop?.()
    await until(w, () => keptOf(w)?.state === 'failed', 5)
    expect(keptOf(w)).toMatchObject({ state: 'failed' })
    expect(keptOf(w)?.why).toMatch(/app 自己結束了/)
  })

  test('each test run waiting is counted: the one at the app and the one queued behind it', async ($, on) => {
    const w = world($, on, { web: true })
    await handed($, w)
    await press(w, 'crew 驗收 app：開 PRD-001')
    await until(w, () => keptOf(w)?.state === 'up')
    await $.command.run(command('test'))
    await w.clock.advance(3_000)
    await $.command.run(command('test'))
    await w.clock.advance(3_000)
    expect(cardOf(w, 'PRD-001')?.open?.app?.waits).toEqual({ tests: 2, merges: 0 })
    expect(await paneText($)).toMatch(/2 個合回／測試在等你關掉 app/)
  })

  test('a merge waiting for it is counted, and the full-stack’s work in crew’s worktree is said to wait too', async ($, on) => {
    const w = world($, on, { web: true })
    // Builders side by side, each task on a branch of its own: crew merges each back once the tech lead approves it.
    w.store.set(`settings:${ROOT}`, { agents: 4 })
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    await done($, 'a-pm-1')
    await write($, 'a-qa-2', [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }])
    await done($, 'a-qa-2')
    await designed($)
    await write($, 'a-techlead-4', [
      { op: 'add_task', feature: 'PRD-001', criteria: ['AC-001'], title: '方案頁', detail: '', size: 'S', touches: ['src/plan.ts'] },
      { op: 'add_task', feature: 'PRD-002', criteria: ['AC-002'], title: '取消流程', detail: '', size: 'S', touches: ['src/cancel.ts'] },
    ])
    await done($, 'a-techlead-4')
    w.commit('TASK-001: 方案頁', 'crew/prd-task-001')
    await done($, 'a-fullstack-5')
    w.commit('TASK-002: 取消流程', 'crew/prd-task-002')
    await done($, 'a-fullstack-6')
    await approve($, 'TASK-001')
    for (let n = 0; n < 5; n++) await w.clock.advance(1)
    await approve($, 'TASK-002')
    for (let n = 0; n < 5; n++) await w.clock.advance(1)
    await checked($)
    await until(w, () => w.web.started > 0, 5)
    await press(w, 'crew 驗收 app：開 PRD-001')
    await until(w, () => keptOf(w)?.state === 'up')
    // The other feature is sent back: its fix task is built on a branch of its own and approved while the app is up.
    expect((await press(w, `crew 驗收：要改 PRD-002\n原話：按鈕文字改成「取消訂閱」\n代碼 ${cardOf(w, 'PRD-002')?.code ?? ''}`))?.ok).toBe(true)
    await w.clock.settle()
    await write($, agentOf('techlead'), [{ op: 'add_task', feature: 'PRD-002', criteria: ['AC-002'], title: '改按鈕文字', detail: '', size: 'S', touches: ['src/cancel.ts'] }])
    await done($, agentOf('techlead'))
    await w.clock.settle()
    w.commit('TASK-003: 改按鈕文字', 'crew/prd-task-003')
    await done($, agentOf('fullstack'))
    await w.clock.settle()
    await approve($, 'TASK-003', agentOf('techlead'))
    await w.clock.advance(2_000)
    // Its merge waits for the app: the card and the pane count it, and say the full-stack's work in crew's worktree waits too.
    expect((w.git.branches.get('crew/prd') ?? [])[0]?.subject).not.toBe('crew: 合回 TASK-003')
    expect(cardOf(w, 'PRD-001')?.open?.app?.waits).toEqual({ tests: 0, merges: 1 })
    expect(await paneText($)).toMatch(/1 個合回／測試在等你關掉 app，全端在 crew 工作目錄的工作也會等/)
    // Closed: the merge goes in.
    await press(w, 'crew 驗收 app：關')
    await until(w, () => (w.git.branches.get('crew/prd') ?? [])[0]?.subject === 'crew: 合回 TASK-003', 20)
    expect((w.git.branches.get('crew/prd') ?? [])[0]?.subject).toBe('crew: 合回 TASK-003')
  })

  test('starts at the commit QA checked the feature pressed for, not the one it served before', async ($, on) => {
    const w = world($, on, { web: true })
    await handed($, w)
    // QA checked PRD-002 on a later commit.
    const later = w.commit('PRD-002: 修文案')
    const { file, kept } = reportsOf(w)
    const rounds = kept.features['PRD-002'] ?? []
    rounds[rounds.length - 1] = { ...(rounds.at(-1) ?? {}), sha: later }
    w.disk.set(file, JSON.stringify(kept))
    const first = (kept.features['PRD-001'] ?? []).at(-1)?.sha
    expect(first).not.toBe(later)
    // The app failed for PRD-001, and the person presses for PRD-002.
    w.app.fails = true
    await press(w, 'crew 驗收 app：開 PRD-001')
    await until(w, () => keptOf(w)?.state === 'failed')
    w.app.fails = false
    await press(w, 'crew 驗收 app：開 PRD-002')
    await until(w, () => keptOf(w)?.state === 'up')
    expect(keptOf(w)).toMatchObject({ state: 'up', sha: later })
    expect(cardOf(w, 'PRD-002')?.open?.qaSha).toBe(later.slice(0, 7))
  })

  test('closed just as it answers, before crew knew what it started: what started there is ended too', async ($, on) => {
    const w = world($, on, { web: true })
    await handed($, w)
    // crew's look at what listens there, once the app answers, takes a while: the person presses meanwhile.
    w.slow.run = { argv0: '/bin/ps', ms: 20_000, held: 0 }
    await press(w, 'crew 驗收 app：開 PRD-001')
    await until(w, () => w.slow.run.held > 0, 30)
    expect(keptOf(w)?.state).toBe('starting')
    await press(w, 'crew 驗收 app：關')
    await until(w, () => !w.app.up, 40)
    expect(w.app.up).toBe(false)
    expect(w.app.calls.filter(c => c[0] === '/bin/kill').at(-1)).toContain('4242')
    expect(keptOf(w)).toBeUndefined()
  })

  test('Claude Code going on in another conversation (/resume) leaves it up', async ($, on) => {
    const w = world($, on, { web: true })
    on('session.end', (_$, e) => ({ sessionId: (e as { sessionId: string }).sessionId }) as never)
    await handed($, w)
    await press(w, 'crew 驗收 app：開 PRD-001')
    await until(w, () => keptOf(w)?.state === 'up')
    const kills = w.app.calls.filter(c => c[0] === '/bin/kill').length
    await $.session.end({ reason: 'resume', sessionId: 'session-1', resume: {} } as never)
    expect(w.app.calls.filter(c => c[0] === '/bin/kill')).toHaveLength(kills)
    expect(w.app.up).toBe(true)
  })
})

describe('the app kept for acceptance, for a report from before crew kept its commit', () => {
  test('the commit comes from crew’s log of the check, and the app starts there', async ($, on) => {
    const w = world($, on, { web: true })
    await handed($, w)
    // As crew 0.7.8 kept them: no commit with the reports; a later commit on crew's branch since.
    const { file, kept } = reportsOf(w)
    const checkedOn = String((kept.features['PRD-001'] ?? []).at(-1)?.sha ?? '')
    for (const rounds of Object.values(kept.features)) for (const r of rounds) delete r.sha
    w.disk.set(file, JSON.stringify(kept))
    w.commit('PRD-002: 修文案')
    await press(w, 'crew 驗收 app：開 PRD-001')
    await until(w, () => keptOf(w)?.state === 'up')
    expect(keptOf(w)?.sha).toBe(checkedOn)
    expect(cardOf(w, 'PRD-001')?.open?.qaSha).toBe(checkedOn.slice(0, 7))
  })

  test('with nothing in the log either: the card says so, and the app starts at crew’s branch as it is', async ($, on) => {
    const w = world($, on, { web: true })
    await handed($, w)
    // Nor does crew's log say it: the check started more than two days before the report (as crew reads it).
    const { file, kept } = reportsOf(w)
    for (const rounds of Object.values(kept.features)) for (const r of rounds) Object.assign(r, { sha: undefined, at: Number(r.at) + 3 * 86_400_000 })
    w.disk.set(file, JSON.stringify(kept))
    const tip = w.commit('PRD-002: 修文案')
    await press(w, 'crew 驗收 app：開 PRD-001')
    await until(w, () => keptOf(w)?.state === 'up')
    expect(keptOf(w)?.sha).toBe(tip)
    expect(cardOf(w, 'PRD-001')?.open?.qaSha).toBeUndefined()
  })
})

/** QA checked both features and they wait for the person: the app's start command leaves it in the background, and its stop command ends it. */
const handedInBackground = async ($: Engine, w: W) => {
  w.app.detached = true
  await start($)
  await $.command.run(command('start-command docker compose up -d'))
  await $.command.run(command('stop-command docker compose down'))
  await $.command.run(command(`app-url ${APP_URL}`))
  await planned($)
  await build($)
  await checked($)
  await until(w, () => w.web.started > 0, 5)
}

describe('the app kept for acceptance, left in the background by its start command (docker compose up -d)', () => {
  test('stays up past a decision on another feature and the heartbeat, and the card says it runs in the background', async ($, on) => {
    const w = world($, on, { web: true })
    await handedInBackground($, w)
    const stops = w.app.stops.length
    await press(w, 'crew 驗收 app：開 PRD-001')
    await until(w, () => keptOf(w)?.state !== 'starting', 120)
    expect(keptOf(w)).toMatchObject({ state: 'up', features: ['PRD-001'] })
    // Another feature passed: crew looks at the app, which its command left running.
    expect((await press(w, `crew 驗收：通過 PRD-002\n代碼 ${cardOf(w, 'PRD-002')?.code ?? ''}`))?.ok).toBe(true)
    await w.clock.advance(2_000)
    expect(keptOf(w)?.state).toBe('up')
    // Past the heartbeat, and crew's looks at its URL.
    for (let n = 0; n < 40; n++) await w.clock.advance(10_000)
    expect(keptOf(w)?.state).toBe('up')
    expect(w.app.up).toBe(true)
    expect(w.app.stops).toHaveLength(stops)
    // The card says it runs in the background, and what that means for Claude Code ending.
    expect(keptOf(w)?.background).toBe(true)
    expect(cardOf(w, 'PRD-001')?.open?.app).toMatchObject({ state: 'up', background: true })
  })

  test('once its URL answers no more, crew runs the stop command within a minute, and the card says why', async ($, on) => {
    const w = world($, on, { web: true })
    await handedInBackground($, w)
    await press(w, 'crew 驗收 app：開 PRD-001')
    await until(w, () => keptOf(w)?.state !== 'starting', 120)
    expect(keptOf(w)?.state).toBe('up')
    const stops = w.app.stops.length
    // Its containers went down by themselves.
    w.app.up = false
    for (let n = 0; n < 70 && keptOf(w)?.state === 'up'; n++) await w.clock.advance(1_000)
    expect(keptOf(w)).toMatchObject({ state: 'failed' })
    expect(keptOf(w)?.why).toMatch(/app 自己結束了（http:\/\/localhost:3000 沒有回應了）/)
    expect(w.app.stops).toHaveLength(stops + 1)
  })

  test('QA’s check of another feature takes it at once, moving it to the commit the check needs', async ($, on) => {
    const w = world($, on, { web: true })
    await handedInBackground($, w)
    await press(w, 'crew 驗收 app：開 PRD-001')
    await until(w, () => keptOf(w)?.state !== 'starting', 120)
    const checkers = checkersOf(w)
    markRead(w, 'PRD-002')
    await $.command.run(command(`app-url ${APP_URL}`))
    for (let n = 0; n < 4 && checkersOf(w) === checkers; n++) {
      await w.clock.advance(10_000)
      await $.turn.complete({ answer: '好', durationMs: 5, isAborted: false, turnId: `turn-bg-${n}`, reason: 'answer' } as never)
    }
    expect(checkersOf(w)).toBe(checkers + 1)
    expect(keptOf(w)).toMatchObject({ state: 'up', checking: 'PRD-002' })
    expect(w.app.up).toBe(true)
  })

  test('closed by the person: the stop command takes it down', async ($, on) => {
    const w = world($, on, { web: true })
    await handedInBackground($, w)
    await press(w, 'crew 驗收 app：開 PRD-001')
    await until(w, () => keptOf(w)?.state !== 'starting', 120)
    const stops = w.app.stops.length
    expect((await press(w, 'crew 驗收 app：關'))?.text).toMatch(/已關掉驗收用的 app/)
    expect(w.app.stops).toHaveLength(stops + 1)
    expect(w.app.stops.at(-1)?.argv.join(' ')).toBe('docker compose down')
    expect(w.app.up).toBe(false)
    expect(keptOf(w)).toBeUndefined()
  })
})

describe('the app kept for acceptance, closed as a check ends or across a restart', () => {
  test('closed while crew writes the log of the check that ran on it: stopped all the same, and the tests run after', async ($, on) => {
    const w = world($, on, { web: true })
    await handed($, w)
    await press(w, 'crew 驗收 app：開 PRD-001')
    await until(w, () => keptOf(w)?.state === 'up')
    const checkers = checkersOf(w)
    markRead(w, 'PRD-002')
    await $.command.run(command(`app-url ${APP_URL}`))
    for (let n = 0; n < 10 && checkersOf(w) === checkers; n++) {
      await w.clock.advance(10_000)
      await $.turn.complete({ answer: '好', durationMs: 5, isAborted: false, turnId: `turn-w-${n}`, reason: 'answer' } as never)
    }
    const checker = agentOf('checker')
    await reportShots($, checker)
    // The check's end writes its log a while: the person closes the app meanwhile.
    w.slow.writes = { prefix: `${ROOT}/.crew/runs/app-PRD-002-`, ms: 20_000 }
    const ending = done($, checker)
    await w.clock.advance(1_000)
    expect((await press(w, 'crew 驗收 app：關'))?.text).toBe('QA 正在用它檢查 PRD-002，檢查完 crew 就關掉。')
    w.slow.writes = { prefix: '', ms: 0 }
    await w.clock.advance(30_000)
    await ending
    await w.clock.advance(5_000)
    expect(w.app.up).toBe(false)
    expect(keptOf(w)).toBeUndefined()
    expect(await testsRun($, w)).toBe(true)
  })

  test('closing as Claude Code ended unseen (no session end): the next load stops what it left', async ($, on) => {
    const w = world($, on, { web: true })
    // As the load before saved it: closed while QA's check of PRD-002 ran on it, and Claude Code gone before the check ended.
    w.store.set(STATE, { prdPath: 'docs/PRD.md', flow: { stage: 'done', round: 0, retries: 0 }, questions: [], lead: 'person', acceptApp: { state: 'closing', features: ['PRD-001'], since: NOW - 60_000, dir: QA_DIR, url: APP_URL, pids: ['4242'], checking: 'PRD-002' } })
    w.app.up = true
    w.app.since = NOW - 60_000
    await start($)
    await until(w, () => keptOf(w) === undefined, 10)
    expect(keptOf(w)).toBeUndefined()
    expect(w.app.calls.filter(c => c[0] === '/bin/kill').at(-1)).toContain('4242')
    expect(w.app.up).toBe(false)
  })
})

describe('the app kept for acceptance, with crew’s web page off', () => {
  test('no word the brain relays opens it', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await build($)
    await checked($)
    const checks = w.app.starts.length
    expect(String((await crew($, { action: 'decide', text: 'crew 驗收 app：開 PRD-001', question: '1' })).result)).toMatch(/只能由使用者在 crew 網頁上自己按，不能轉給 crew/)
    await w.clock.advance(5_000)
    expect(w.app.starts).toHaveLength(checks)
    expect(keptOf(w)).toBeUndefined()
  })
})
