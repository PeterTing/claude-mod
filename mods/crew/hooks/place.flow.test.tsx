import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { applyOps, newTracker } from './board'
import type { Op } from './board'
import { command, paneText, ROOT, SPLIT, start, world, write } from './world'

/** Where crew keeps its board: in .crew/, or at the root of a repo where crew made it there before 0.5.2. */

const IN_CREW = `${ROOT}/.crew/prd-tracker.json`
const AT_ROOT = `${ROOT}/prd-tracker.json`

/** A board crew made at the root before 0.5.2: starting a PRD wrote crew_prd into it. */
const LEGACY = `${JSON.stringify({ ...newTracker('repo'), crew_prd: { path: 'docs/PRD.md', requirements: [], synced_at: '2026-10-01' } }, null, 2)}\n`

/** The repo's own tracker, which crew could read as a board: features and all, but no crew_prd. */
const theirs = (): string => {
  const made = applyOps(newTracker('repo'), SPLIT as Op[], { by: 'pm', today: '2026-10-01', prefixes: { feature: 'PRD-', testCase: 'TC-' } })
  if (!made.ok) throw new Error(made.errors.join())
  return `${JSON.stringify(made.tracker, null, 2)}\n`
}

const call = ($: Engine, tool: string, input: Record<string, unknown>, agentId?: string) =>
  $.tool.call({ tool: `mcp__crew__${tool}`, tool_use_id: `p-${Math.random()}`, ...(agentId === undefined ? {} : { agentId }), ...input } as never) as Promise<{ result: unknown }>

const features = (text: string | undefined): string[] => (JSON.parse(text ?? '{}') as { prd_items?: { title: string }[] }).prd_items?.map(i => i.title) ?? []

describe('the board', () => {
  test('is .crew/prd-tracker.json in a repo with none: crew makes it there, and says so in 設定', async ($, on) => {
    const w = world($, on)
    await start($)
    expect(await paneText($, 'settings')).toMatch(/看板\n檔案：\.crew\/prd-tracker\.json\n測試指令/)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    expect(features(w.disk.get(IN_CREW))).toHaveLength(2)
    expect(w.disk.has(AT_ROOT)).toBe(false)
    expect((await $.command.run(command('reset'))).text).toMatch(/看板（\.crew\/prd-tracker\.json）、討論串和記憶/)
  })

  test('leaves the repo’s own prd-tracker.json at the root alone, though crew could read it: not read, not warned of, not changed', async ($, on) => {
    const w = world($, on)
    const kept = theirs()
    w.disk.set(AT_ROOT, kept)
    await start($)
    const shown = await paneText($)
    expect(shown).toMatch(/還沒有開始的 PRD/)
    expect(shown).not.toMatch(/⚠|PRD-001/)
    expect(await paneText($, 'settings')).toMatch(/檔案：\.crew\/prd-tracker\.json\n測試指令/)
    await $.command.run(command('start docs/PRD.md'))
    expect(w.spawned.map(s => s.subagentType)).toEqual(['crew:pm'])
    await write($, 'a-pm-1', [{ op: 'add_feature', title: '只在 crew 的看板', summary: 's', priority: 'P0', sources: [] }])
    expect(features(w.disk.get(IN_CREW))).toEqual(['只在 crew 的看板'])
    expect(w.disk.get(AT_ROOT)).toBe(kept)
  })

  test('stays at the root of a repo where crew made it before 0.5.2, and 設定 says why', async ($, on) => {
    const w = world($, on)
    w.disk.set(AT_ROOT, LEGACY)
    await start($)
    expect(await paneText($, 'settings')).toMatch(/看板\n檔案：prd-tracker\.json\n這個 repo 的看板是 crew 0\.5\.2 以前建在根目錄的，繼續沿用，不搬家。\n測試指令/)
    // Before a PRD starts, the pane's header names the board by its file.
    expect(await paneText($)).toMatch(/repo prd-tracker\.json · 進度 0%/)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    expect(features(w.disk.get(AT_ROOT))).toHaveLength(2)
    expect(w.disk.has(IN_CREW)).toBe(false)
    expect((await $.command.run(command('reset'))).text).toMatch(/看板（prd-tracker\.json）、討論串和記憶/)
  })

  test('takes .crew/prd-tracker.json over a crew board at the root when both are there', async ($, on) => {
    const w = world($, on)
    w.disk.set(AT_ROOT, LEGACY)
    w.disk.set(IN_CREW, theirs())
    await start($)
    expect(await paneText($, 'settings')).toMatch(/檔案：\.crew\/prd-tracker\.json\n測試指令/)
    // The root board has nothing done; the one in .crew/ has.
    expect(await paneText($)).toMatch(/repo \.crew\/prd-tracker\.json · 進度 25%/)
  })

  test('is looked for again the next session when the root file could not be read', async ($, on) => {
    const w = world($, on)
    w.disk.set(AT_ROOT, LEGACY)
    w.broken.reads = AT_ROOT
    await start($)
    expect(await paneText($, 'settings')).toMatch(/檔案：\.crew\/prd-tracker\.json\n測試指令/)
    w.broken.reads = ''
    await start($)
    expect(await paneText($, 'settings')).toMatch(/檔案：prd-tracker\.json\n這個 repo/)
  })

  test('is not looked for through a root prd-tracker.json that links out of the repo', async ($, on) => {
    const w = world($, on)
    w.disk.set('/elsewhere/prd-tracker.json', LEGACY)
    w.links.set(AT_ROOT, '/elsewhere/prd-tracker.json')
    await start($)
    expect(await paneText($, 'settings')).toMatch(/檔案：\.crew\/prd-tracker\.json\n測試指令/)
    expect(await paneText($)).not.toMatch(/⚠/)
  })

  test('stays at the root when crew’s root board holds a merge conflict, and the pane names that file', async ($, on) => {
    const w = world($, on)
    const broken = `<<<<<<< HEAD\n${LEGACY}=======\n{}\n>>>>>>> theirs\n`
    w.disk.set(AT_ROOT, broken)
    await start($)
    expect(await paneText($)).toMatch(/⚠ prd-tracker\.json 讀不懂（可能有 merge 衝突或格式錯誤）。請先修好；crew 沒有改動它。/)
    expect((await $.command.run(command('start docs/PRD.md'))).text).toMatch(/沒有開始：prd-tracker\.json 讀不懂/)
    expect(w.disk.get(AT_ROOT)).toBe(broken)
    expect(w.disk.has(IN_CREW)).toBe(false)
  })

  test('names .crew/prd-tracker.json when that file is not a board crew can read', async ($, on) => {
    const w = world($, on)
    w.disk.set(IN_CREW, '{"project":"repo"}\n')
    await start($)
    // In crew's own folder, the file is the person's to fix or move.
    expect(await paneText($)).toMatch(/⚠ \.crew\/prd-tracker\.json 不是 crew 的看板格式（沒有 prd_items 清單）。crew 不讀也不改它，請修好或移走這個檔案，crew 才能開始。/)
    expect((await $.command.run(command('start docs/PRD.md'))).text).toMatch(/沒有開始：\.crew\/prd-tracker\.json 不是 crew 的看板格式/)
    expect(w.disk.get(IN_CREW)).toBe('{"project":"repo"}\n')
  })

  test('takes up a crew board that turns up at the root before crew made its own, as on a branch that has one', async ($, on) => {
    const w = world($, on)
    await start($)
    w.disk.set(AT_ROOT, LEGACY)
    await start($)
    expect(await paneText($, 'settings')).toMatch(/檔案：prd-tracker\.json\n這個 repo/)
  })

  test('stays in .crew/ once crew made its board there: a crew board that turns up at the root later is not taken up', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    // A teammate on an earlier crew starts a PRD and commits its board at the root.
    w.disk.set(AT_ROOT, LEGACY)
    await start($)
    expect(await paneText($, 'settings')).toMatch(/檔案：\.crew\/prd-tracker\.json\n測試指令/)
    await write($, 'a-pm-1', SPLIT)
    expect(features(w.disk.get(IN_CREW))).toHaveLength(2)
    expect(w.disk.get(AT_ROOT)).toBe(LEGACY)
  })

  test('stays at the root for a repo crew found its board there, though a .crew/prd-tracker.json turns up later', async ($, on) => {
    const w = world($, on)
    w.disk.set(AT_ROOT, LEGACY)
    await start($)
    w.disk.set(IN_CREW, theirs())
    await start($)
    expect(await paneText($, 'settings')).toMatch(/檔案：prd-tracker\.json\n這個 repo/)
    await $.command.run(command('start docs/PRD.md'))
    expect(JSON.parse(w.disk.get(AT_ROOT) ?? '{}')).toMatchObject({ crew_prd: { path: 'docs/PRD.md' } })
    // Nor while the root board cannot be read to tell.
    w.broken.reads = AT_ROOT
    await start($)
    expect(await paneText($, 'settings')).toMatch(/檔案：prd-tracker\.json\n這個 repo/)
  })

  test('follows a root board moved into .crew/, and keeps to .crew/ from then on', async ($, on) => {
    const w = world($, on)
    w.disk.set(AT_ROOT, LEGACY)
    await start($)
    // git mv prd-tracker.json .crew/prd-tracker.json
    w.disk.delete(AT_ROOT)
    w.disk.set(IN_CREW, LEGACY)
    await start($)
    expect(await paneText($, 'settings')).toMatch(/檔案：\.crew\/prd-tracker\.json\n測試指令/)
    expect(w.store.get(`board:${ROOT}`)).toBe('crew')
    // The repo's own tracker turns up at the root later: crew's board stays in .crew/.
    w.disk.set(AT_ROOT, theirs())
    await start($)
    expect(await paneText($, 'settings')).toMatch(/檔案：\.crew\/prd-tracker\.json\n測試指令/)
  })

  test('follows a root board copied into .crew/ once the root file is the repo’s own again', async ($, on) => {
    const w = world($, on)
    w.disk.set(AT_ROOT, LEGACY)
    await start($)
    w.disk.set(IN_CREW, LEGACY)
    w.disk.set(AT_ROOT, theirs())
    await start($)
    expect(await paneText($, 'settings')).toMatch(/檔案：\.crew\/prd-tracker\.json\n測試指令/)
  })

  test('stays at the root it took up when the root file is no longer crew’s and nothing is in .crew/, and says so without asking it moved', async ($, on) => {
    const w = world($, on)
    w.disk.set(AT_ROOT, LEGACY)
    await start($)
    w.disk.set(AT_ROOT, '{"project":"repo"}\n')
    await start($)
    const shown = await paneText($)
    expect(shown).toMatch(/⚠ prd-tracker\.json 不是 crew 的看板格式（沒有 prd_items 清單）。crew 不讀也不改它，所以在這個 repo 還沒辦法開始。/)
    expect(shown).not.toMatch(/移走/)
  })

  test('names the root file when the board crew took up there becomes a link', async ($, on) => {
    const w = world($, on)
    w.disk.set(AT_ROOT, LEGACY)
    await start($)
    w.disk.set(`${ROOT}/other.json`, LEGACY)
    w.links.set(AT_ROOT, `${ROOT}/other.json`)
    await start($)
    expect(await paneText($)).toMatch(/⚠ prd-tracker\.json 是連結或指到 repo 外，crew 不讀也不寫它。/)
  })

  test('names the root file when resume finds the board crew took up there gone', async ($, on) => {
    const w = world($, on, { stopped: ['a-pm-1'] })
    w.disk.set(AT_ROOT, LEGACY)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    w.disk.delete(AT_ROOT)
    expect((await $.command.run(command('resume'))).text).toMatch(/沒有接續：找不到看板 prd-tracker\.json。/)
  })

  test('stays in .crew/ once crew wrote its board there, on a branch that has only a crew board at the root', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    // Another branch: no board in .crew/, and a teammate's board from an earlier crew at the root.
    w.disk.delete(IN_CREW)
    w.disk.set(AT_ROOT, LEGACY)
    await start($)
    expect(await paneText($, 'settings')).toMatch(/檔案：\.crew\/prd-tracker\.json\n測試指令/)
    // Back on the branch with both: crew's own board is the one.
    w.disk.set(IN_CREW, theirs())
    await start($)
    expect(await paneText($, 'settings')).toMatch(/檔案：\.crew\/prd-tracker\.json\n測試指令/)
  })

  test('says the root board was moved into .crew/ while Claude Code runs, and writes neither until it starts again', async ($, on) => {
    const w = world($, on)
    w.disk.set(AT_ROOT, LEGACY)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    // git mv prd-tracker.json .crew/prd-tracker.json, with crew running.
    const moved = w.disk.get(AT_ROOT) ?? ''
    const said = /看板已經搬到 \.crew\/prd-tracker\.json，重新啟動 Claude Code 後 crew 就會改用它。/
    // The pane draws between the move's two halves: the board is gone, and not yet in .crew/.
    w.disk.delete(AT_ROOT)
    expect(await paneText($)).not.toMatch(said)
    w.disk.set(IN_CREW, moved)
    expect(await paneText($)).toMatch(said)
    const settings = await paneText($, 'settings')
    expect(settings).toMatch(/檔案：prd-tracker\.json\n看板已經搬到 \.crew\/prd-tracker\.json，重新啟動 Claude Code 後 crew 就會改用它。\n測試指令/)
    expect(settings).not.toMatch(/不搬家/)
    expect(String((await write($, 'a-pm-1', [{ op: 'add_feature', title: '帳單', summary: 's', priority: 'P0', sources: [] }])).result)).toMatch(said)
    expect(w.disk.has(AT_ROOT)).toBe(false)
    expect(w.disk.get(IN_CREW)).toBe(moved)
    await start($)
    expect(await paneText($, 'settings')).toMatch(/檔案：\.crew\/prd-tracker\.json\n測試指令/)
    expect(features(w.disk.get(IN_CREW))).toHaveLength(2)
  })

  test('keeps a read under way when crew starts again from taking the board for one it cannot read', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    w.slow.store = 1_000
    w.slow.stat = { path: IN_CREW, ms: 60 }
    // The PM reads the board; crew starts again while the read looks at the file.
    const reading = call($, 'board_read', {}, 'a-pm-1')
    await w.clock.advance(10)
    const restarted = start($)
    for (let i = 0; i < 5; i += 1) await w.clock.advance(100)
    await w.clock.advance(2_000)
    await restarted
    w.slow.stat = { path: '', ms: 0 }
    expect(String((await reading).result)).toMatch(/PRD-001/)
    expect(String((await call($, 'board_read', {}, 'a-pm-1')).result)).toMatch(/PRD-001/)
    expect((await $.command.run(command('status'))).text).not.toMatch(/⚠ 看板讀不到/)
  })

  for (const at of [130, 190, 250]) {
    test(`keeps to a root board when crew starts again ${at} ms into a write to it`, async ($, on) => {
      const w = world($, on)
      w.disk.set(AT_ROOT, LEGACY)
      await start($)
      await $.command.run(command('start docs/PRD.md'))
      await write($, 'a-pm-1', SPLIT)
      w.slow.stat = { path: AT_ROOT, ms: 60 }
      w.slow.store = 1_000
      const writing = write($, 'a-pm-1', [{ op: 'add_feature', title: '帳單', summary: 's', priority: 'P0', sources: [] }])
      await w.clock.advance(at)
      const restarted = start($)
      for (let i = 0; i < 30; i += 1) await w.clock.advance(100)
      await restarted
      w.slow.stat = { path: '', ms: 0 }
      w.slow.store = 0
      // Written to the root board, or refused while crew started again: never moved off it.
      expect(String((await writing).result)).toMatch(/PRD-003|重新載入/)
      expect(features(w.disk.get(AT_ROOT)).length).toBeGreaterThanOrEqual(2)
      expect(w.disk.has(IN_CREW)).toBe(false)
      expect(w.store.get(`board:${ROOT}`)).toBe('root')
      expect(await paneText($, 'settings')).toMatch(/檔案：prd-tracker\.json\n這個 repo/)
      await start($)
      expect(await paneText($, 'settings')).toMatch(/檔案：prd-tracker\.json\n這個 repo/)
    })
  }

  test('keeps to a root board when crew starts again while the write to it is on disk’s way', async ($, on) => {
    const w = world($, on)
    w.disk.set(AT_ROOT, LEGACY)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    w.slow.write = { path: AT_ROOT, ms: 300 }
    w.slow.store = 1_000
    const writing = write($, 'a-pm-1', [{ op: 'add_feature', title: '帳單', summary: 's', priority: 'P0', sources: [] }])
    await w.clock.advance(100)
    const restarted = start($)
    for (let i = 0; i < 20; i += 1) await w.clock.advance(100)
    await restarted
    w.slow.write = { path: '', ms: 0 }
    w.slow.store = 0
    expect(String((await writing).result)).toMatch(/PRD-003/)
    expect(features(w.disk.get(AT_ROOT))).toHaveLength(3)
    expect(w.store.get(`board:${ROOT}`)).toBe('root')
    expect(await paneText($, 'settings')).toMatch(/檔案：prd-tracker\.json\n這個 repo/)
  })

  test('does not bring a root board back when it is moved into .crew/ and crew starts again during a write to it', async ($, on) => {
    const w = world($, on)
    w.disk.set(AT_ROOT, LEGACY)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    w.slow.stat = { path: AT_ROOT, ms: 60 }
    w.slow.store = 1_000
    const writing = write($, 'a-pm-1', [{ op: 'add_feature', title: '帳單', summary: 's', priority: 'P0', sources: [] }])
    await w.clock.advance(190)
    // git mv prd-tracker.json .crew/prd-tracker.json, and crew starts again.
    const moved = w.disk.get(AT_ROOT) ?? ''
    w.disk.delete(AT_ROOT)
    w.disk.set(IN_CREW, moved)
    const restarted = start($)
    for (let i = 0; i < 30; i += 1) await w.clock.advance(100)
    await restarted
    w.slow.stat = { path: '', ms: 0 }
    w.slow.store = 0
    expect(String((await writing).result)).toMatch(/重新載入/)
    expect(w.disk.has(AT_ROOT)).toBe(false)
    expect(w.disk.get(IN_CREW)).toBe(moved)
    expect(await paneText($, 'settings')).toMatch(/檔案：\.crew\/prd-tracker\.json\n測試指令/)
  })

  test('takes nothing but a root board from crew’s store: anything else there leaves it to the disk', async ($, on) => {
    const w = world($, on)
    w.store.set(`board:${ROOT}`, 'elsewhere')
    await start($)
    expect(await paneText($, 'settings')).toMatch(/檔案：\.crew\/prd-tracker\.json\n測試指令/)
  })

  test('looks on disk when crew’s store cannot be read', async ($, on) => {
    const w = world($, on)
    w.broken.storeReads = 'board:'
    w.disk.set(AT_ROOT, LEGACY)
    await start($)
    expect(await paneText($, 'settings')).toMatch(/檔案：prd-tracker\.json\n這個 repo/)
  })

  test('is read and written only once crew has found it again: a role’s work while crew restarts is never written over', async ($, on) => {
    const w = world($, on)
    await start($)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    w.slow.store = 500
    // crew starts again, as on a reload, and the PM reads and writes while crew still looks for the board.
    const restarted = start($)
    const reading = call($, 'board_read', {}, 'a-pm-1')
    const writing = write($, 'a-pm-1', [{ op: 'add_feature', title: '帳單', summary: 's', priority: 'P0', sources: [] }])
    await w.clock.advance(1_000)
    await restarted
    expect(String((await reading).result)).toMatch(/PRD-001/)
    expect(String((await writing).result)).toMatch(/PRD-003/)
    expect(features(w.disk.get(IN_CREW))).toHaveLength(3)
  })

  test('is found again each session when crew’s store cannot keep where it is', async ($, on) => {
    const w = world($, on)
    w.broken.store = 'board:'
    w.disk.set(AT_ROOT, LEGACY)
    await start($)
    expect(await paneText($, 'settings')).toMatch(/檔案：prd-tracker\.json\n/)
    await $.command.run(command('start docs/PRD.md'))
    await write($, 'a-pm-1', SPLIT)
    expect(features(w.disk.get(AT_ROOT))).toHaveLength(2)
    await start($)
    expect(await paneText($, 'settings')).toMatch(/檔案：prd-tracker\.json\n/)
  })
})
