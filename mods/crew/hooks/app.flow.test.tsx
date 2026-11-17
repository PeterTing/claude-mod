import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { TurnCompleteInput } from 'claude-code'

import { APP_YES, HEARTBEAT_MS } from './live'
import { accepted, agentOf, build, checked, command, designed, done, NOW, paneUi, PLAN, qaDone, reportShots, ROOT, SPLIT, start, world, write } from './world'

/** QA checks each finished feature in the app, with pictures: crew asks how to start it, and starts and stops only what is its own. */

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

type Question = { id: string; status: string; question: string; item?: string; app?: { proposal?: { start: string[]; url: string } } }
const questions = (w: { store: Map<string, unknown> }): Question[] => (w.store.get(`state:${ROOT}`) as { questions?: Question[] } | undefined)?.questions ?? []

/** The engine's next frames, here the brain's turns ending, until a QA run of the kind crew starts. */
const frames = async ($: Engine, w: ReturnType<typeof world>, until: () => boolean, most = 8) => {
  for (let n = 0; n < most && !until(); n++) {
    await w.clock.advance(10_000)
    await $.turn.complete({ answer: '好', durationMs: 5, isAborted: false, turnId: `turn-frame-${Math.random()}`, reason: 'answer' } as TurnCompleteInput)
  }
}

const setup = ($: Engine, agentId: string, over: Record<string, unknown> = {}) =>
  $.tool.call({
    tool: 'mcp__crew__app_setup',
    tool_use_id: `s-${Math.random()}`,
    agentId,
    start: 'npm run dev',
    url: 'http://localhost:3000',
    where_start: 'package.json 的 scripts.dev',
    where_url: 'README.md 的「本機開發」',
    accounts_none: '這個 app 不用登入',
    ...over,
  } as never) as Promise<{ result: unknown }>

const crew = ($: Engine, input: Record<string, unknown>) => $.tool.call({ tool: 'mcp__crew__crew', tool_use_id: `c-${Math.random()}`, ...input } as never) as Promise<{ result: unknown }>

describe('QA in the app', () => {
  test('with no app set, QA finds how to start it, the person’s own press sets it, and each feature reaches them with pictures', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await build($)
    await frames($, w, () => agentOf('finder') !== 'a-finder-0')
    const finder = agentOf('finder')
    expect(w.spawned.find(s => s.subagentType === 'crew:finder')).toMatchObject({ cwd: QA_DIR })
    expect(w.spawned.find(s => s.subagentType === 'crew:finder')?.prompt).toMatch(/只讀這個工作目錄[\s\S]*app_setup/)
    // Nothing was handed over: no feature waits for the person without its pictures.
    expect((await $.command.run(command('status'))).text).not.toMatch(/accepting/)
    // Only the QA crew started to look may report, and each value is held to what the settings take.
    expect(String((await setup($, 'a-qa-2')).result)).toMatch(/app_setup 只給 crew 啟動、負責找 app 設定的 QA 用/)
    w.app.ports = ['3000']
    expect(String((await setup($, finder)).result)).toMatch(/port 3000 現在已經有程式在用/)
    w.app.ports = ['5432']
    expect(String((await setup($, finder, { url: 'https://example.com' })).result)).toMatch(/url 只能是這台電腦上的網址/)
    expect(String((await setup($, finder, { start: 'npm run dev && rm -rf /' })).result)).toMatch(/start 不能用/)
    expect(String((await setup($, finder, { start: `env API_KEY=sk-ant-api03-${'a'.repeat(40)} npm run dev` })).result)).toMatch(/看起來像密碼、token 或金鑰/)
    expect(String((await setup($, finder, { accounts: '.env' })).result)).toMatch(/accounts 不能用/)
    expect(String((await setup($, finder, { accounts: 'seed/users.json' })).result)).toMatch(/找不到 accounts 的 seed\/users\.json/)
    expect(String((await setup($, finder)).result)).toMatch(/收到/)
    await qaDone($, finder)
    const q = questions(w).find(x => x.app !== undefined && x.status === 'open')
    expect(q?.question).toMatch(/讓 QA 開 app 截圖[\s\S]*啟動指令\*\*：`npm run dev`[\s\S]*package\.json 的 scripts\.dev[\s\S]*app 網址\*\*：`http:\/\/localhost:3000`[\s\S]*測試帳號檔\*\*：還沒找到：這個 app 不用登入/)
    expect(q?.app?.proposal).toMatchObject({ start: ['npm', 'run', 'dev'], url: 'http://localhost:3000' })
    // The brain cannot set what crew runs on the person's computer, nor may a command it relays.
    expect(String((await crew($, { action: 'answer', question: q?.id, text: APP_YES })).result)).toMatch(/要使用者自己在「待你決定」按［照這樣設，開始補圖］[\s\S]*大腦轉達的回答 crew 不收/)
    expect(w.store.get(`start:${ROOT}`)).toBeUndefined()
    // The card is where its presses are: never a text question on the decide page, whose box would only take words.
    const page = [...w.disk.entries()].filter(([path]) => path.endsWith('/data.json')).map(([, text]) => text)
    expect(page.length).toBeGreaterThan(0)
    expect(page.some(text => text.includes(q?.id ?? '?') && /讓 QA 開 app 截圖/.test(text))).toBe(false)
    // The person's own press sets it, and QA checks each feature in the app.
    expect((await $.command.run(command(`answer ${q?.id ?? ''} ${APP_YES}`))).text).toMatch(/已照 QA 的建議設定 app/)
    expect(w.store.get(`start:${ROOT}`)).toEqual({ argv: ['npm', 'run', 'dev'] })
    expect(w.store.get(`url:${ROOT}`)).toEqual({ url: 'http://localhost:3000' })
    await accepted($)
    expect(w.app.starts[0]).toMatchObject({ argv: ['npm', 'run', 'dev'], cwd: QA_DIR, env: { CREW_QA: '1', BROWSER: 'none' } })
    // Docker Compose runs crew's app as a project of its own, never the person's stack of the same name.
    expect(w.app.starts[0]?.env?.COMPOSE_PROJECT_NAME).toMatch(/^crew-qa-[0-9a-f]{6}$/)
    expect(w.spawned.filter(s => s.subagentType === 'crew:checker').length).toBeGreaterThan(0)
    expect((await $.command.run(command('status'))).text).toMatch(/done/)
  })

  test('settles nothing on any other answer: the question stays, the flow waits for the app unstalled, and goes on once it is set', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await build($)
    await frames($, w, () => agentOf('finder') !== 'a-finder-0')
    await setup($, agentOf('finder'))
    await qaDone($, agentOf('finder'))
    const q = questions(w).find(x => x.app !== undefined && x.status === 'open')
    expect((await $.command.run(command(`answer ${q?.id ?? ''} 埠改成 3100`))).text).toMatch(/還開著：app 設定好才算回答[\s\S]*QA 建議的值已經填在欄位裡，按儲存才會用/)
    expect(w.store.get(`start:${ROOT}`)).toBeUndefined()
    expect(questions(w).find(x => x.id === q?.id)?.status).toBe('open')
    // Waiting for the person's settings is no stall: the heartbeat holds nothing for the person to take up again.
    await w.clock.advance(HEARTBEAT_MS * 3)
    expect((w.store.get(`state:${ROOT}`) as { paused?: string }).paused).toBeUndefined()
    expect(w.toasts.some(t => /叫醒過一次還是停住/.test(t))).toBe(false)
    // Set on the settings tab: QA checks with what the person set.
    await $.command.run(command('start-command npm run dev -- --port 3100'))
    await $.command.run(command('app-url http://localhost:3100'))
    expect(questions(w).find(x => x.id === q?.id)?.status).toBe('answered')
    await checked($)
    expect(w.app.starts[0]?.argv).toEqual(['npm', 'run', 'dev', '--', '--port', '3100'])
  })

  test('asks the person to set it on the settings tab when QA finds nothing, and asks no more', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await build($)
    await frames($, w, () => agentOf('finder') !== 'a-finder-0')
    await qaDone($, agentOf('finder'), 'repo 裡沒有啟動 app 的指令')
    const asked = questions(w).filter(x => x.app !== undefined)
    expect(asked).toHaveLength(1)
    expect(asked[0]?.question).toMatch(/請在「設定」分頁設定怎麼開 app[\s\S]*repo 裡沒有啟動 app 的指令[\s\S]*關掉 app 的指令/)
    await frames($, w, () => false, 4)
    expect(questions(w).filter(x => x.app !== undefined)).toHaveLength(1)
    expect(w.spawned.filter(s => s.subagentType === 'crew:finder')).toHaveLength(1)
    // Set on the settings tab: the question is moot, and QA checks.
    await $.command.run(command('start-command npm run dev'))
    await $.command.run(command('app-url http://localhost:3000'))
    expect(questions(w).find(x => x.app !== undefined)?.status).toBe('answered')
    await checked($)
    expect(w.spawned.some(s => s.subagentType === 'crew:checker')).toBe(true)
  })

  test('waits for an app its start command leaves in the background, and runs the stop command in QA’s worktree after', async ($, on) => {
    const w = world($, on)
    w.app.detached = true
    await start($)
    await $.command.run(command('start-command docker compose up -d'))
    await $.command.run(command('stop-command docker compose down'))
    await $.command.run(command('app-url http://localhost:3000'))
    await planned($)
    await build($)
    await accepted($)
    expect((await $.command.run(command('status'))).text).toMatch(/done/)
    expect(w.app.starts.length).toBeGreaterThan(0)
    expect(w.app.starts.every(s => s.argv.join(' ') === 'docker compose up -d' && s.cwd === QA_DIR)).toBe(true)
    expect(w.app.stops).toHaveLength(w.app.starts.length)
    expect(w.app.stops.every(s => s.argv.join(' ') === 'docker compose down' && s.cwd === QA_DIR)).toBe(true)
    // The stop command reaches the same Compose project the start command made.
    expect(w.app.stops.every(s => s.env?.COMPOSE_PROJECT_NAME !== undefined && s.env.COMPOSE_PROJECT_NAME === w.app.starts[0]?.env?.COMPOSE_PROJECT_NAME)).toBe(true)
    // The stop command took the app down: crew kills nothing.
    expect(w.app.calls.filter(c => c[0] === '/bin/kill')).toEqual([])
    const log = [...w.disk.keys()].filter(p => p.startsWith(`${ROOT}/.crew/runs/app-`)).map(p => w.disk.get(p) ?? '')
    expect(log.some(x => /\$ docker compose down\n# exit 0\nContainer app Removed/.test(x))).toBe(true)
  })

  test('says why when a start command ends with no stop command set: crew could not stop what it left running', async ($, on) => {
    const w = world($, on)
    w.app.detached = true
    await start($)
    await $.command.run(command('start-command docker compose up -d'))
    await $.command.run(command('app-url http://localhost:3000'))
    await planned($)
    await build($)
    await checked($)
    const asked = questions(w).find(x => x.status === 'open' && /QA 沒辦法在 app 裡實際操作/.test(x.question))
    expect(asked?.question).toMatch(/執行完就結束了[\s\S]*crew 是在 \/repo\/\.crew\/work\/prd-qa 執行的[\s\S]*COMPOSE_PROJECT_NAME=crew-qa-[0-9a-f]{6} docker compose down[\s\S]*「關掉 app 的指令」/)
    expect(w.spawned.some(s => s.subagentType === 'crew:checker')).toBe(false)
  })

  test('stops only what it started: a program that listened on the port before (Docker’s own) is left', async ($, on) => {
    const w = world($, on)
    w.app.others = ['777']
    await start($)
    await planned($)
    await build($)
    await accepted($)
    const kills = w.app.calls.filter(c => c[0] === '/bin/kill')
    expect(kills.length).toBeGreaterThan(0)
    expect(kills.every(c => c.includes('4242') && !c.includes('777'))).toBe(true)
  })

  test('asks the person each time the app cannot start, and tries again on each answer', async ($, on) => {
    const w = world($, on)
    w.app.fails = true
    await start($)
    await planned($)
    await build($)
    await checked($)
    const broke = () => questions(w).filter(x => /QA 沒辦法在 app 裡實際操作/.test(x.question))
    // Each feature waits for its pictures on its own question; the others go on meanwhile.
    expect(broke().map(q => [q.item, q.status])).toEqual([['PRD-001', 'open'], ['PRD-002', 'open']])
    expect(broke()[0]?.question).toMatch(/啟動指令執行完就結束了（exit 1）/)
    const starts = w.app.starts.length
    await $.command.run(command(`answer ${broke()[0]?.id ?? ''} 修好了`))
    await checked($)
    // Still broken: asked again, as often as it takes.
    expect(broke().map(q => [q.item, q.status])).toEqual([['PRD-001', 'answered'], ['PRD-002', 'open'], ['PRD-001', 'open']])
    expect(w.app.starts.length).toBe(starts + 1)
    // Fixed: QA checks each in the app, with pictures, and they reach the person.
    w.app.fails = false
    for (const q of broke().filter(x => x.status === 'open')) await $.command.run(command(`answer ${q.id} 這次真的修好了`))
    await accepted($)
    expect(w.spawned.filter(s => s.subagentType === 'crew:checker')).toHaveLength(2)
    expect((await $.command.run(command('status'))).text).toMatch(/done/)
  })

  test('checks again in the app a feature an older crew only read, once the app is set', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await build($)
    await checked($)
    const file = [...w.disk.keys()].find(p => p.endsWith('/acceptance.json')) ?? ''
    const kept = JSON.parse(w.disk.get(file) ?? '{}') as { features: Record<string, Record<string, unknown>[]> }
    // As an older crew kept it: QA read the code, with no pictures.
    for (const rounds of Object.values(kept.features)) {
      const last = rounds.at(-1) ?? {}
      rounds[rounds.length - 1] = { ...last, read: true, items: (last.items as Record<string, unknown>[]).map(({ desktop: _d, phone: _p, api: _a, ...i }) => ({ ...i, how: '打開首頁' })) }
    }
    w.disk.set(file, JSON.stringify(kept))
    const before = w.spawned.filter(s => s.subagentType === 'crew:checker').length
    // The person sets the app again: each feature QA only read is checked in the app, the next round.
    await $.command.run(command('app-url http://localhost:3000'))
    await checked($)
    const again = w.spawned.filter(s => s.subagentType === 'crew:checker').slice(before)
    expect(again.length).toBe(Object.keys(kept.features).length)
    expect(again.every(s => /第 2 輪/.test(s.prompt))).toBe(true)
    const now = JSON.parse(w.disk.get(file) ?? '{}') as { features: Record<string, { read?: true; round: number }[]> }
    expect(Object.values(now.features).every(r => r.at(-1)?.read === undefined && r.at(-1)?.round === 2)).toBe(true)
  })

  test('waits for the stop command QA proposed with a start command that leaves the app in the background, set on the settings tab', async ($, on) => {
    const w = world($, on)
    w.app.detached = true
    await start($)
    await planned($)
    await build($)
    await frames($, w, () => agentOf('finder') !== 'a-finder-0')
    await setup($, agentOf('finder'), { start: 'docker compose up -d', stop: 'docker compose down', where_stop: 'README.md 的「關掉」' })
    await qaDone($, agentOf('finder'))
    const q = questions(w).find(x => x.app !== undefined && x.status === 'open')
    expect(q?.question).toMatch(/關掉 app 的指令\*\*：`docker compose down`[\s\S]*還有關掉 app 的指令，都存好之後 QA 才開始/)
    // Saved one field at a time, the stop command last: crew starts nothing it could not stop.
    await $.command.run(command('start-command docker compose up -d'))
    expect((await $.command.run(command('app-url http://localhost:3000'))).text).toMatch(/還差「關掉 app 的指令」[\s\S]*QA 建議 docker compose down/)
    await frames($, w, () => false, 3)
    // Nor does anything else that takes the flow on start it meanwhile: a resume, the heartbeat, the room.
    await $.command.run(command('resume'))
    await w.clock.advance(HEARTBEAT_MS)
    const room = await paneUi($)
    await room.press({ key: 'tab-settings' })
    await room.press({ key: 'agents-2' })
    await room.unmount()
    await frames($, w, () => false, 3)
    expect(w.app.starts).toHaveLength(0)
    expect(questions(w).find(x => x.id === q?.id)?.status).toBe('open')
    await $.command.run(command('stop-command docker compose down'))
    expect(questions(w).find(x => x.id === q?.id)?.status).toBe('answered')
    await accepted($)
    expect(w.app.starts.length).toBeGreaterThan(0)
    expect(w.app.stops).toHaveLength(w.app.starts.length)
  })

  test('keeps a quoted word of QA’s command whole, on the card and when the person takes it', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await build($)
    await frames($, w, () => agentOf('finder') !== 'a-finder-0')
    expect(String((await setup($, agentOf('finder'), { start: 'env "NODE_OPTIONS=--max-old-space-size=4096 --inspect" npm run dev' })).result)).toMatch(/收到/)
    await qaDone($, agentOf('finder'))
    const q = questions(w).find(x => x.app !== undefined && x.status === 'open')
    expect(q?.question).toContain('`env "NODE_OPTIONS=--max-old-space-size=4096 --inspect" npm run dev`')
    await $.command.run(command(`answer ${q?.id ?? ''} ${APP_YES}`))
    expect(w.store.get(`start:${ROOT}`)).toEqual({ argv: ['env', 'NODE_OPTIONS=--max-old-space-size=4096 --inspect', 'npm', 'run', 'dev'] })
    // The settings tab shows it as typed, its quotes kept: saved again as it is, it stays the same command.
    const ui = await paneUi($)
    await ui.press({ key: 'tab-settings' })
    expect((await ui.find({ key: 'start-command' }))?.props.value).toBe('env "NODE_OPTIONS=--max-old-space-size=4096 --inspect" npm run dev')
    await ui.unmount()
  })

  test('sends back to QA a command crew could not keep as it is: a word with both kinds of quotes', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await build($)
    await frames($, w, () => agentOf('finder') !== 'a-finder-0')
    expect(String((await setup($, agentOf('finder'), { start: `echo a"b'c"d'e"f'` })).result)).toMatch(/start 有一個字同時含單引號和雙引號，crew 沒辦法照原樣存[\s\S]*改好之後再用 app_setup 送一次/)
    expect(String((await setup($, agentOf('finder'), { stop: `echo a"b'c"d'e"f'` })).result)).toMatch(/stop 有一個字同時含單引號和雙引號/)
    expect(String((await setup($, agentOf('finder'))).result)).toMatch(/收到/)
  })

  test('tells apart a test accounts file only on crew’s branch: crew reads the accounts from the person’s checkout', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await build($)
    await frames($, w, () => agentOf('finder') !== 'a-finder-0')
    w.disk.set(`${QA_DIR}/seed/users.json`, '[]')
    expect(String((await setup($, agentOf('finder'), { accounts: 'seed/users.json', where_accounts: 'seed 資料夾' })).result)).toMatch(/收到/)
    await qaDone($, agentOf('finder'))
    const q = questions(w).find(x => x.app !== undefined && x.status === 'open')
    expect(q?.question).toMatch(/測試帳號檔\*\*：還沒找到：seed\/users\.json 只在 crew 的分支上，你自己的 checkout 裡還沒有/)
    await $.command.run(command(`answer ${q?.id ?? ''} ${APP_YES}`))
    expect(w.store.get(`accounts:${ROOT}`)).toBeUndefined()
  })

  test('checks again in the app a feature handed over with no report of its round, once the app is set', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await build($)
    await checked($)
    // As an older crew left it: the check passed, and no report of it is kept.
    const file = [...w.disk.keys()].find(p => p.endsWith('/acceptance.json')) ?? ''
    const ids = Object.keys((JSON.parse(w.disk.get(file) ?? '{}') as { features: Record<string, unknown> }).features)
    w.disk.set(file, JSON.stringify({ features: {} }))
    const before = w.spawned.filter(s => s.subagentType === 'crew:checker').length
    await $.command.run(command('app-url http://localhost:3000'))
    await checked($)
    const again = w.spawned.filter(s => s.subagentType === 'crew:checker').slice(before)
    expect(again.length).toBe(ids.length)
    expect(again.every(s => /第 2 輪/.test(s.prompt))).toBe(true)
  })

  test('takes no feature as having no pictures from a reports file it cannot read now: one read halfway through its write', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await build($)
    await checked($)
    const file = [...w.disk.keys()].find(p => p.endsWith('/acceptance.json')) ?? ''
    w.disk.set(file, '{"features": {"PRD-001": [')
    const before = w.spawned.filter(s => s.subagentType === 'crew:checker').length
    await $.command.run(command('app-url http://localhost:3000'))
    await checked($)
    expect(w.spawned.filter(s => s.subagentType === 'crew:checker').length).toBe(before)
  })

  test('lets go at once of a check waiting for its frame when the usage guard pauses the roles: the app stopped, and checked again at the reset', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await $.command.run(command('start-command npm run dev'))
    await $.command.run(command('app-url http://localhost:3000'))
    await build($)
    // The app is up and QA waits for the engine's next frame, which does not come: the person is away.
    const running = () => Object.values((w.store.get(`state:${ROOT}`) as { flow?: { checks?: Record<string, { state?: string }> } }).flow?.checks ?? {}).some(c => c.state === 'running')
    for (let i = 0; i < 10 && !w.app.up; i++) await w.clock.advance(2_000)
    expect(w.app.up).toBe(true)
    expect(running()).toBe(true)
    const resetsAt = new Date(NOW + 3 * 3_600_000).toISOString()
    w.limits.push({ kind: 'five_hour', percentUsed: 95, resetsAt })
    await $.session.measure({ changed: ['rateLimits'], rateLimits: [{ kind: 'five_hour', percentUsed: 95, resetsAt }], context: {} } as never)
    await w.clock.advance(2 * 60_000)
    // Let go with no frame: the app stopped (its port free, the Mac no longer kept awake for it), QA never started.
    expect(w.app.up).toBe(false)
    expect(running()).toBe(false)
    await w.clock.advance(20 * 60_000)
    expect(w.app.starts).toHaveLength(1)
    expect(w.spawned.filter(s => s.subagentType === 'crew:checker')).toHaveLength(0)
    // The guard lets go: the feature is checked then, in the app.
    w.limits.splice(0, 1, { kind: 'five_hour', percentUsed: 12, resetsAt })
    await $.session.measure({ changed: ['rateLimits'], rateLimits: [{ kind: 'five_hour', percentUsed: 12, resetsAt }], context: {} } as never)
    await checked($)
    expect(w.spawned.filter(s => s.subagentType === 'crew:checker').length).toBeGreaterThan(0)
    expect(w.app.starts.length).toBeGreaterThan(1)
  })

  test('looks for how to start the app only while the usage guard lets the roles work, and wakes nobody for it meanwhile', async ($, on) => {
    const w = world($, on)
    await start($)
    await planned($)
    await build($)
    // QA's look was asked for and waits for a frame when the usage guard pauses the roles.
    const resetsAt = new Date(NOW + 3 * 3_600_000).toISOString()
    w.limits.push({ kind: 'five_hour', percentUsed: 95, resetsAt })
    await $.session.measure({ changed: ['rateLimits'], rateLimits: [{ kind: 'five_hour', percentUsed: 95, resetsAt }], context: {} } as never)
    const wakes = () => w.submitted.filter(x => /叫醒排著的角色/.test(x.text)).length
    const woke = wakes()
    await w.clock.advance(20 * 60_000)
    await frames($, w, () => false, 3)
    await w.clock.advance(20 * 60_000)
    expect(w.spawned.filter(s => s.subagentType === 'crew:finder')).toHaveLength(0)
    expect(wakes()).toBe(woke)
    // The guard lets go: QA looks then, once.
    w.limits.splice(0, 1, { kind: 'five_hour', percentUsed: 12, resetsAt })
    await $.session.measure({ changed: ['rateLimits'], rateLimits: [{ kind: 'five_hour', percentUsed: 12, resetsAt }], context: {} } as never)
    await frames($, w, () => agentOf('finder') !== 'a-finder-0')
    expect(w.spawned.filter(s => s.subagentType === 'crew:finder')).toHaveLength(1)
  })
})
