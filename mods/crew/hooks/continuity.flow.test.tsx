import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { applyOps, DEFAULT_PREFIXES, newTracker } from './board'
import type { Op } from './board'
import { HEARTBEAT_MS } from './live'
import { command, done, NOW, paneText, paneUi, PLAN, ROOT, SPLIT, start, textOf, world, write } from './world'

/** crew goes on where it stopped: after another account, from another copy of crew on this machine, and by the person's repair. */

const HOME = '/Users/tester'
const LOGIN = `${HOME}/.claude.json`
const STORES = `${HOME}/.claude/plugins/store`
const OTHER = `${STORES}/crew_claude-mod-de1e98275fb5.json`

/** Claude Code's login record, with what else it keeps: an MCP server's token and the account's address. */
const signedIn = (w: ReturnType<typeof world>, accountUuid: string) =>
  w.disk.set(LOGIN, JSON.stringify({ oauthAccount: { accountUuid, organizationUuid: 'org-1', emailAddress: 'tester@example.com' }, mcpServers: { s: { env: { TOKEN: 'sk-secret-value' } } } }))

const crew = ($: Engine, input: Record<string, unknown>) => $.tool.call({ tool: 'mcp__crew__crew', tool_use_id: `c-${Math.random()}`, ...input } as never) as Promise<{ result: unknown }>

const tested = async ($: Engine) => {
  await $.command.run(command('start docs/PRD.md'))
  await write($, 'a-pm-1', SPLIT)
  await done($, 'a-pm-1')
  await write($, 'a-qa-2', [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }])
  await done($, 'a-qa-2')
}

const DESIGNS = [
  { op: 'add_design', feature: 'PRD-001', title: '方案選擇頁', kind: 'screen', body: '版面：三張方案卡片。', html: '<p>mockup</p>' },
  { op: 'add_design', feature: 'PRD-002', title: '取消訂閱', kind: 'none', body: '沒有新畫面。' },
]

/** A board planned for the world PRD, as another session left it. */
const plannedBoard = (prd?: string) => {
  let t = newTracker('repo')
  for (const [by, ops] of [
    ['pm', SPLIT],
    ['qa', [{ op: 'add_test_case', criteria: ['AC-001', 'AC-002'], title: 't', steps: ['s'], expected: 'e' }]],
    ['techlead', PLAN],
  ] as const) {
    const r = applyOps(t, ops as unknown as Op[], { by, today: '2026-10-15', prefixes: DEFAULT_PREFIXES })
    if (!r.ok) throw new Error(r.errors.join())
    t = r.tracker
  }
  return JSON.stringify(prd === undefined ? t : { ...t, crew_prd: { path: prd, requirements: [], synced_at: '2026-10-15' } })
}

const BUILDING = { prdPath: 'docs/PRD.md', flow: { stage: 'building', round: 0, retries: 0, building: 'TASK-001' }, questions: [{ id: 'Q-01', question: '取消後退款嗎？', status: 'open', from: 'pm' }], lead: 'person' }

describe('another account', () => {
  test('signed in to another account mid-session, crew makes the decide page anew under it and keeps nothing of the login record but a hash', async ($, on) => {
    const w = world($, on)
    w.env.set('HOME', HOME)
    signedIn(w, 'acct-a')
    await start($)
    await tested($)
    await write($, 'a-uiux-3', DESIGNS)
    await done($, 'a-uiux-3')
    await crew($, { action: 'published', text: 'https://claude.ai/artifact/old111', path: 'docs/PRD.md' })
    expect(w.store.get(`review:${ROOT}:docs/PRD.md`)).toHaveProperty('url', 'https://claude.ai/artifact/old111')
    const kept = String(w.store.get(`account:${ROOT}`))
    expect(kept).toMatch(/^[0-9a-f]{16}$/)
    // /login to another account: the next look sees it.
    const asked = w.prompts.length
    await w.clock.advance(1_000)
    signedIn(w, 'acct-b')
    await w.clock.advance(HEARTBEAT_MS)
    expect(w.toasts.some(t => /Claude Code 換了帳號。待你決定頁會在這個帳號發一個新的頁面，新連結放在面板；舊帳號的頁面沒有刪。/.test(t))).toBe(true)
    expect(w.store.get(`review:${ROOT}:docs/PRD.md`)).not.toHaveProperty('url')
    expect(String(w.store.get(`account:${ROOT}`))).toMatch(/^[0-9a-f]{16}$/)
    expect(String(w.store.get(`account:${ROOT}`))).not.toBe(kept)
    // The brain is asked for a new page with every file, not an update of the old account's.
    await w.clock.advance(61_000)
    const ask = w.prompts.slice(asked).find(p => /待你決定頁要發佈給使用者看/.test(p))
    expect(ask).toMatch(/"SCR-001\.json"/)
    expect(ask).not.toMatch(/old111/)
    // Seen once: the next look changes nothing.
    const toasts = w.toasts.length
    await w.clock.advance(HEARTBEAT_MS)
    expect(w.toasts.slice(toasts).some(t => /換了帳號/.test(t))).toBe(false)
    // Of the record, nothing but the hash is kept, logged or said.
    const said = JSON.stringify([[...w.store.values()], w.logs, w.toasts, w.prompts])
    expect(said).not.toMatch(/acct-[ab]|org-1|sk-secret-value|tester@example\.com/)
  })

  test('a restart signed in to another account makes the page anew too', async ($, on) => {
    const w = world($, on)
    w.env.set('HOME', HOME)
    signedIn(w, 'acct-a')
    await start($)
    await tested($)
    await write($, 'a-uiux-3', DESIGNS)
    await done($, 'a-uiux-3')
    await crew($, { action: 'published', text: 'https://claude.ai/artifact/old111', path: 'docs/PRD.md' })
    await w.clock.advance(1_000)
    signedIn(w, 'acct-b')
    await start($)
    expect(w.toasts.some(t => /Claude Code 換了帳號/.test(t))).toBe(true)
    expect(w.store.get(`review:${ROOT}:docs/PRD.md`)).not.toHaveProperty('url')
  })

  test('the usage guard holds for the old account till this one’s first reading, then lets go in words of the account', async ($, on) => {
    const w = world($, on)
    w.env.set('HOME', HOME)
    signedIn(w, 'acct-a')
    const resetsAt = new Date(NOW + 3 * 3_600_000).toISOString()
    w.limits.push({ kind: 'five_hour', percentUsed: 95, resetsAt })
    await start($)
    expect(await paneText($)).toMatch(/⏸ crew 暫停中：Claude 5 小時用量 95%/)
    await w.clock.advance(1_000)
    signedIn(w, 'acct-b')
    await w.clock.advance(HEARTBEAT_MS)
    expect(w.toasts.some(t => /用量保護改看這個帳號的用量，下一次回應後更新；原本因為用量暫停的 Claude 角色，照這個帳號的數字再決定要不要接著做/.test(t))).toBe(true)
    // What Claude Code reads out still is the old account's: crew does not take it as this one's.
    expect(await paneText($)).toMatch(/⏸ crew 暫停中/)
    w.limits.splice(0, 1, { kind: 'five_hour', percentUsed: 12, resetsAt })
    await $.session.measure({ changed: ['rateLimits'], rateLimits: [{ kind: 'five_hour', percentUsed: 12, resetsAt }], context: {} } as never)
    expect(await paneText($)).not.toMatch(/⏸ crew 暫停中/)
    expect(w.toasts.some(t => /這個帳號的 Claude 用量沒有到暫停線，crew 不再暫停/.test(t))).toBe(true)
  })
})

describe('another copy of crew', () => {
  test('a repo worked on with another copy is offered on the overview, brought over by the person alone, the other copy left as it was', async ($, on) => {
    const w = world($, on)
    w.env.set('HOME', HOME)
    w.disk.set(`${ROOT}/.crew/prd-tracker.json`, plannedBoard())
    w.disk.set(
      OTHER,
      JSON.stringify({
        [`state:${ROOT}`]: BUILDING,
        [`tests:${ROOT}`]: { argv: ['npx', 'vitest', 'run'] },
        [`setup:${ROOT}`]: { argv: ['bash', `${HOME}/prep.sh`] },
        [`settings:${ROOT}`]: { agents: 3 },
        [`setupRuns:${ROOT}`]: { open: { [`${ROOT}/.crew/work/prd`]: { since: 1, lanes: [] } }, left: { [`${ROOT}/.crew/work/prd`]: ['node_modules'] } },
        'state:/elsewhere': BUILDING,
      }),
    )
    const before = w.disk.get(OTHER)
    await start($)
    expect(w.spawned).toEqual([])
    const ui = await paneUi($)
    const offered = await textOf(ui)
    expect(offered).toMatch(/這個 repo 的進度在另一份 crew 裡（從 claude-mod 裝的那一份）/)
    expect(offered).toMatch(/docs\/PRD\.md 停在「實作」，1 件事等你決定。/)
    // This copy has a test command of its own, which stays: only the prep command comes over.
    expect(offered).toMatch(/會一起接過來：準備指令 bash \/Users\/tester\/prep\.sh、設計稿的決定、待你決定頁和 crew 分支的紀錄。另一份 crew 的紀錄不會改。/)
    expect(offered).not.toMatch(/vitest/)
    // The brain cannot bring it over: it runs the person's commands.
    expect(String((await crew($, { action: 'resume' })).result)).toMatch(/從 claude-mod 裝的那一份 crew 有 docs\/PRD\.md 的進度：要使用者自己在面板按［接過來］/)
    expect(w.store.get(`state:${ROOT}`)).toBeUndefined()
    await ui.press({ key: 'carry' })
    expect(w.store.get(`state:${ROOT}`)).toMatchObject({ prdPath: 'docs/PRD.md' })
    expect(w.store.get(`tests:${ROOT}`)).toEqual({ argv: ['npm', 'test'] })
    expect(w.store.get(`setup:${ROOT}`)).toEqual({ argv: ['bash', `${HOME}/prep.sh`] })
    // This copy's own setting stays: only what it lacks comes over. A prep under way was the other process's.
    expect(w.store.get(`settings:${ROOT}`)).toEqual({ agents: 1 })
    expect(w.store.get(`setupRuns:${ROOT}`)).toEqual({ left: { [`${ROOT}/.crew/work/prd`]: ['node_modules'] } })
    expect(w.store.get('state:/elsewhere')).toBeUndefined()
    expect(w.disk.get(OTHER)).toBe(before)
    // As after a restart: the flow waits for the person's 接續, and nothing was spent.
    const carried = await textOf(ui)
    expect(carried).toMatch(/上次的 docs\/PRD\.md 停在「實作」（全端 TASK-001）。要接續嗎？/)
    expect(carried).not.toMatch(/另一份 crew 裡/)
    expect(w.spawned).toEqual([])
    await ui.press({ key: 'resume' })
    // crew's worktree is made, and the prep command that came over runs in it before the builder starts.
    expect(w.tests.runs.map(r => r.argv.join(' '))).toContain(`bash ${HOME}/prep.sh`)
    await w.clock.advance(1_000)
    await ui.press({ key: 'tab-overview' })
    await ui.unmount()
    expect(w.spawned.some(s => s.subagentType === 'crew:fullstack')).toBe(true)
  })

  test('the person says no: not offered again, and a board with a PRD of its own is rebuilt from', async ($, on) => {
    const w = world($, on)
    w.env.set('HOME', HOME)
    w.disk.set(`${ROOT}/.crew/prd-tracker.json`, plannedBoard('docs/PRD.md'))
    w.disk.set(OTHER, JSON.stringify({ [`state:${ROOT}`]: BUILDING }))
    await start($)
    const ui = await paneUi($)
    expect(await textOf(ui)).toMatch(/這個 repo 的進度在另一份 crew 裡/)
    expect(JSON.stringify(await ui.find({ key: 'carry-no' }))).toMatch(/不要，從看板重建/)
    await ui.press({ key: 'carry-no' })
    await ui.unmount()
    // Started again from the board: crew now has the PRD, its own.
    expect(w.store.get(`state:${ROOT}`)).toMatchObject({ prdPath: 'docs/PRD.md' })
    expect(w.store.get(`carryDeclined:${ROOT}`)).toMatch(/crew_claude-mod-de1e98275fb5\.json\|docs\/PRD\.md\|building/)
    await start($)
    expect(await paneText($)).not.toMatch(/另一份 crew 裡/)
  })
})

describe('two copies at once', () => {
  test('another copy at work on this repo meanwhile is said once on the pane and to the brain, while it goes on', async ($, on) => {
    const w = world($, on)
    w.env.set('HOME', HOME)
    w.disk.set(`${ROOT}/.crew/prd-tracker.json`, plannedBoard('docs/PRD.md'))
    w.store.set(`state:${ROOT}`, { ...BUILDING, lead: 'brain' })
    w.disk.set(OTHER, JSON.stringify({ [`state:${ROOT}`]: { ...BUILDING, flow: { stage: 'designing', round: 0, retries: 0 } } }))
    await start($)
    // Seen as it was: not yet at work.
    await w.clock.advance(HEARTBEAT_MS)
    expect(w.toasts.some(t => /另一份 crew/.test(t))).toBe(false)
    // It writes its record meanwhile: another Claude Code runs it on this repo.
    w.disk.set(OTHER, JSON.stringify({ [`state:${ROOT}`]: { ...BUILDING, flow: { stage: 'designing', round: 1, retries: 0 } } }))
    const asked = w.prompts.length
    await w.clock.advance(HEARTBEAT_MS)
    const said = w.toasts.filter(t => /另一份 crew（從 claude-mod 裝的那一份）也在做這個 repo/.test(t))
    expect(said).toHaveLength(1)
    expect(await paneText($)).toMatch(/⚠ 另一份 crew（從 claude-mod 裝的那一份）也在做這個 repo：兩份會互相蓋掉看板和設計稿的決定。/)
    await w.clock.advance(61_000)
    expect(w.prompts.slice(asked).some(p => /也在做這個 repo.*請使用者自己決定關哪一個/s.test(p))).toBe(true)
    // Still at work: said on the pane, not toasted again.
    w.disk.set(OTHER, JSON.stringify({ [`state:${ROOT}`]: { ...BUILDING, flow: { stage: 'designing', round: 2, retries: 0 } } }))
    await w.clock.advance(HEARTBEAT_MS)
    expect(w.toasts.filter(t => /也在做這個 repo/.test(t))).toHaveLength(1)
    // Closed: the pane stops saying it half an hour on.
    await w.clock.advance(31 * 60_000)
    expect(await paneText($)).not.toMatch(/也在做這個 repo/)
  })
})

describe('the person’s repair', () => {
  test('says each look and goes on, as 接續 does, after a restart', async ($, on) => {
    const w = world($, on)
    w.disk.set(`${ROOT}/.crew/prd-tracker.json`, plannedBoard('docs/PRD.md'))
    w.store.set(`state:${ROOT}`, BUILDING)
    // crew's branch is there, its worktree gone: deleted by hand, still on git's list.
    w.git.branches.set('crew/prd', [{ sha: 'c0ffee'.padEnd(40, '0'), subject: 'init' }])
    w.git.worktrees.set(`${ROOT}/.crew/work/prd`, 'crew/prd')
    w.store.set(`work:${ROOT}:docs/PRD.md`, { branch: 'crew/prd', dir: `${ROOT}/.crew/work/prd`, base: 'c0ffee'.padEnd(40, '0'), seen: {} })
    await start($)
    expect(w.spawned).toEqual([])
    const said = (await $.command.run(command('repair'))).text
    expect(said).toMatch(/^crew 修復：/)
    expect(said).toMatch(/✓ 重新開了 worktree：crew 的分支（照樣先跑準備指令）/)
    expect(said).toMatch(/接續 docs\/PRD\.md（building）/)
    expect(w.git.worktrees.has(`${ROOT}/.crew/work/prd`)).toBe(true)
  })

  test('the tech lead’s run saying the files of tasks, lost to a restart, is asked again on 接續', async ($, on) => {
    const w = world($, on)
    w.store.set(`settings:${ROOT}`, { agents: 4 })
    w.disk.set(`${ROOT}/.crew/prd-tracker.json`, plannedBoard('docs/PRD.md'))
    // As the last session left it: the tech lead was saying the files of both, and the first was being built.
    const flow = { stage: 'building', round: 0, retries: 0, talking: true, placing: ['TASK-001', 'TASK-002'], jobs: { 'TASK-001': { retries: 0, reviews: 0, slot: 1, home: 1, own: true } } }
    w.store.set(`state:${ROOT}`, { prdPath: 'docs/PRD.md', flow, questions: [], lead: 'person' })
    await start($)
    const ui = await paneUi($)
    await ui.press({ key: 'resume' })
    await ui.unmount()
    await w.clock.advance(1_000)
    const asked = [...w.sent.map(m => m.text), ...w.spawned.filter(s => s.subagentType === 'crew:techlead').map(s => s.prompt)].join('\n')
    expect(asked).toMatch(/沒寫會改哪些檔案[\s\S]*TASK-001、TASK-002/)
  })

  test('rebuilds from the board a PRD neither copy of crew holds', async ($, on) => {
    const w = world($, on)
    w.disk.set(`${ROOT}/.crew/prd-tracker.json`, plannedBoard('docs/PRD.md'))
    await start($)
    // The brain cannot: it would spend tokens and run the person's commands on its own word.
    expect(String((await crew($, { action: 'resume' })).result)).toMatch(/看板上有做到一半的 docs\/PRD\.md，這份 crew 沒有它的紀錄：要使用者自己/)
    expect(w.store.get(`state:${ROOT}`)).toBeUndefined()
    const said = (await $.command.run(command('repair'))).text
    expect(said).toMatch(/✓ 從看板重建 docs\/PRD\.md/)
    expect(w.store.get(`state:${ROOT}`)).toMatchObject({ prdPath: 'docs/PRD.md' })
  })
})
