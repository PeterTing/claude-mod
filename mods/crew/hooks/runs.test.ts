import { describe, expect, test } from 'claude-code/testing'

import type { TestCase } from './board'
import { combined, durationSaid, grepFiles, idPattern, kindOf, logOutput, namedIn, noResultsFrom, noResultsOf, outputTail, parseCommand, partLog, resultsOf, rootOf, runLogs, runSummary, skippedOf, suggestFor, summaryOf, testMark, testScriptIn } from './runs'
import type { PartOut, TestRoot } from './runs'

const IDS = ['TC-001', 'TC-002', 'TC-003', 'TC-004']

describe('the person’s test command', () => {
  test('is split into its words, quotes kept together', () => {
    expect(parseCommand('npm test')).toEqual({ ok: true, argv: ['npm', 'test'] })
    expect(parseCommand('  python3 -m pytest -v  ')).toEqual({ ok: true, argv: ['python3', '-m', 'pytest', '-v'] })
    expect(parseCommand(`node --test "tests/a b.test.js" 'x y'`)).toEqual({ ok: true, argv: ['node', '--test', 'tests/a b.test.js', 'x y'] })
  })

  test('is one command: no shell, so no pipes, chains, redirects or substitutions', () => {
    for (const bad of ['npm test | tee log', 'npm ci && npm test', 'npm test; rm -rf x', 'npm test > out', 'echo $(id)', 'echo `id`', 'npm test &', 'a "unclosed']) {
      const r = parseCommand(bad)
      expect(r.ok).toBe(false)
    }
    expect(parseCommand('')).toMatchObject({ ok: false })
  })

  test('is at most 64 words of 500 characters each', () => {
    expect(parseCommand(Array(64).fill('a').join(' ')).ok).toBe(true)
    expect(parseCommand(Array(65).fill('a').join(' '))).toMatchObject({ ok: false, error: '指令太長了。' })
    expect(parseCommand(`npm ${'x'.repeat(500)}`).ok).toBe(true)
    expect(parseCommand(`npm ${'x'.repeat(501)}`)).toMatchObject({ ok: false, error: '指令太長了。' })
  })
})

describe('results by test case', () => {
  test('come from lines that name a test case and say how it went, in the common runners’ words', () => {
    const output = [
      // pytest -v
      'tests/test_calc.py::test_TC_001_add PASSED                     [ 25%]',
      'tests/test_calc.py::test_TC_002_sub FAILED                     [ 50%]',
      // unittest -v
      'test_tc_003_float (tests.test_calc.CalcTest.test_tc_003_float) ... ok',
      // node --test / jest / vitest
      '✖ TC-004 rounds (0.5ms)',
      '✔ unrelated test (0.1ms)',
    ].join('\n')
    expect(Object.fromEntries(resultsOf(output, IDS, 'TC-'))).toEqual({ 'TC-001': 'passed', 'TC-002': 'failed', 'TC-003': 'passed', 'TC-004': 'failed' })
  })

  test('read go, mocha-style and TAP lines too', () => {
    const output = ['--- PASS: TestTC001Add (0.00s)', '--- FAIL: TestTC002Sub (0.00s)', 'ok 3 - TC-003 float', 'not ok 4 - TC-004 rounds'].join('\n')
    expect(Object.fromEntries(resultsOf(output, IDS, 'TC-'))).toEqual({ 'TC-001': 'passed', 'TC-002': 'failed', 'TC-003': 'passed', 'TC-004': 'failed' })
  })

  test('count a failure over a pass, and nothing for a test case no line names with a result', () => {
    const output = ['✓ TC-001 add', 'FAILED tests/test_calc.py::test_TC_001_add - AssertionError', 'TC-002 is mentioned in a log line', '✓ TC-099 not on the board'].join('\n')
    expect(Object.fromEntries(resultsOf(output, IDS, 'TC-'))).toEqual({ 'TC-001': 'failed' })
    // A pass printed after the failure, as a retry or a summary does, does not undo it.
    expect(Object.fromEntries(resultsOf('✗ TC-002 sub\n✓ TC-002 sub (retry 1)', IDS, 'TC-'))).toEqual({ 'TC-002': 'failed' })
  })

  test('do not take a number that merely starts like a test case id', () => {
    expect(Object.fromEntries(resultsOf('✓ TC-0010 something\n✓ TC-1 short', IDS, 'TC-'))).toEqual({ 'TC-001': 'passed' })
    // TC-1 is TC-001 written short; TC-0010 is TC-010, which the board does not have.
  })

  test('take an id at the start of a word, or after a lower-case letter in a name like TestTC001, and no other', () => {
    expect(Object.fromEntries(resultsOf('✓ TestTC001Add\n✓ test_tc_002_sub', IDS, 'TC-'))).toEqual({ 'TC-001': 'passed', 'TC-002': 'passed' })
    // ATC-003 and 9TC-003 are other ids; etc_004 is a word that ends in tc, not TC-004.
    expect(Object.fromEntries(resultsOf('✓ ATC-003 a\n✓ 9TC-003 b\n✗ log etc_004 rotated', IDS, 'TC-'))).toEqual({})
  })

  test('go by the runner’s own mark at the start or end of the line, not by words in a test’s name', () => {
    const output = [
      '    ✓ TC-001 shows PAYMENT_FAILED banner when the card is declined (3 ms)',
      'tests/test_x.py::test_TC_002_error_state PASSED                 [ 50%]',
      'test_tc_003_handles_ERROR (tests.T.test_tc_003_handles_ERROR) ... ok',
      'test result: TC-004 not ok with the old wording',
      '  1) TC-004 fails in mocha, which marks failures by number',
    ].join('\n')
    // mocha numbers its failures: `1) TC-004 …` is TC-004 failing.
    expect(Object.fromEntries(resultsOf(output, IDS, 'TC-'))).toEqual({ 'TC-001': 'passed', 'TC-002': 'passed', 'TC-003': 'passed', 'TC-004': 'failed' })
  })

  test('take a skipped or to-do test for no result', () => {
    const output = ['ok 1 - TC-001 adds # SKIP not ready', 'not ok 2 - TC-002 subtracts # TODO later', 'ok 3 - TC-003 # skip', 'ok 4 - TC-004 adds'].join('\n')
    expect(Object.fromEntries(resultsOf(output, IDS, 'TC-'))).toEqual({ 'TC-004': 'passed' })
  })

  test('are tied to the test case as written: a change to its title, steps, expected result or criteria makes it another', () => {
    const tc = { id: 'TC-001', title: 'adds', steps: ['open', 'add'], expected: '2', acceptance_criteria: ['AC-001'] } as unknown as TestCase
    expect(testMark({ ...tc })).toBe(testMark(tc))
    for (const changed of [{ title: 'sums' }, { steps: ['open', 'sum'] }, { expected: '3' }, { acceptance_criteria: ['AC-002'] }]) {
      expect(testMark({ ...tc, ...changed } as TestCase)).not.toBe(testMark(tc))
    }
  })

  test('follow the board’s own test case prefix', () => {
    expect(Object.fromEntries(resultsOf('✓ T-001 a\n✗ T_002 b', ['T-001', 'T-002'], 'T-'))).toEqual({ 'T-001': 'passed', 'T-002': 'failed' })
  })
})

describe('the overall result of a run', () => {
  test('reads the runner’s totals from the whole output, with the exit code', () => {
    // vitest prints its totals on stdout, before what went to stderr.
    const vitest = ' ✓ src/a.test.ts (25 tests) 120ms\n\x1b[2m Test Files \x1b[22m \x1b[1m\x1b[32m199 passed\x1b[39m\x1b[22m (199)\n\x1b[2m      Tests \x1b[22m \x1b[1m\x1b[32m4870 passed\x1b[39m\x1b[22m (4870)\n   Duration  412.3s\n\nstderr | warning: something'
    expect(runSummary(vitest, 0)).toBe('exit 0；Test Files 199 passed (199)；Tests 4870 passed (4870)')
    const jest = 'Test Suites: 1 failed, 11 passed, 12 total\nTests:       2 failed, 80 passed, 82 total\nSnapshots:   0 total\nTime:        3.2 s'
    expect(runSummary(jest, 1)).toBe('exit 1；Test Suites: 1 failed, 11 passed, 12 total；Tests: 2 failed, 80 passed, 82 total；Snapshots: 0 total')
    expect(runSummary('==== 3 failed, 41 passed in 2.01s ====', 1)).toBe('exit 1；3 failed, 41 passed in 2.01s')
  })

  test('says so when the output has no totals', () => {
    expect(runSummary('Segmentation fault', 139)).toBe('exit 139，輸出裡找不到測試總數')
    expect(runSummary('')).toBe('輸出裡找不到測試總數')
  })

  test('does not take a test’s name or a warning that holds a count for the totals', () => {
    const noise = ' ✓ TC-003 shows 3 errors on the form\nwarning: 2 errors were ignored\nTests are flaky sometimes\n2 errors found in config\n3 failed to compile\n1 skipped because of env\ntests 5\n'
    expect(runSummary(noise, 1)).toBe('exit 1，輸出裡找不到測試總數')
    expect(runSummary(`${noise}\n  5 passing (12ms)\n  1 failing`, 1)).toBe('exit 1；5 passing (12ms)；1 failing')
    expect(runSummary('test result: ok. 5 passed; 0 failed; 0 ignored', 0)).toBe('exit 0；test result: ok. 5 passed; 0 failed; 0 ignored')

    // bun, node:test, deno and RSpec end with their own totals.
    expect(runSummary('(pass) a > b [1ms]\n\n 1075 pass\n 0 fail\nRan 1075 tests across 39 files. [44.89s]', 0)).toBe('exit 0；1075 pass；0 fail；Ran 1075 tests across 39 files. [44.89s]')
    expect(runSummary('# tests 10\n# suites 2\n# pass 9\n# fail 1\n# cancelled 0', 1)).toBe('exit 1；# tests 10；# pass 9；# fail 1')
    expect(runSummary('ok | 5 passed | 0 failed (12ms)', 0)).toBe('exit 0；ok | 5 passed | 0 failed (12ms)')
    expect(runSummary('Finished in 0.1 seconds\n5 examples, 1 failure', 1)).toBe('exit 1；5 examples, 1 failure')
  })
})

describe('why a test case has no result', () => {
  const SMK = ['SMK-001', 'SMK-002', 'SMK-003', 'SMK-004', 'SMK-005', 'SMK-006', 'SMK-007', 'SMK-008']

  test('a skipped or to-do test is told apart, in the common runners’ words, with the line it was on', () => {
    const out = [
      ' ↓ src/a.test.ts > SMK-001 needs the database',
      ' ○ skipped SMK-002 later',
      'ok 3 - SMK-003 # SKIP no database',
      '--- SKIP: TestSMK004 (0.00s)',
      'tests/test_a.py::test_SMK_005 SKIPPED (no database)',
      'test_SMK_006 (t.T) ... skipped "x"',
      '✓ SMK-007 passes',
      'SKIPPED [1] tests/test_b.py:3: SMK-008 no database',
      ' ✓ SMK-009 a skipped word in a test’s name is no skip',
    ].join('\n')
    const found = skippedOf(out, [...SMK, 'SMK-009'], 'SMK-')
    expect([...found.keys()]).toEqual(['SMK-001', 'SMK-002', 'SMK-003', 'SMK-004', 'SMK-005', 'SMK-006', 'SMK-008'])
    expect(found.get('SMK-003')).toBe('ok 3 - SMK-003 # SKIP no database')
  })

  test('the test files that name a test case come from git grep, by its id as the board writes it', () => {
    expect(idPattern('SMK-')).toBe('SMK[-_ ]?0*[0-9]+')
    expect(idPattern('-')).toBeUndefined()
    const grep = 'backend/api/src/a.test.ts\0SMK-001\nbackend/api/src/a.test.ts\0smk_1\nfrontend/b.test.ts\0SMK-002\nfrontend/b.test.ts\0SMK-099\n'
    expect(Object.fromEntries(namedIn(grep, ['SMK-001', 'SMK-002'], 'SMK-'))).toEqual({ 'SMK-001': ['backend/api/src/a.test.ts'], 'SMK-002': ['frontend/b.test.ts'] })
    expect(namedIn('', ['SMK-001'], 'SMK-').size).toBe(0)
  })

  test('a file’s runner is the deepest folder that holds it; crew suggests a command by what that folder has', () => {
    const roots: TestRoot[] = [{ dir: '', kind: 'npm', test: true }, { dir: 'backend/api', kind: 'npm', test: true }, { dir: 'backend/api', kind: 'py' }, { dir: 'svc', kind: 'go' }]
    expect(rootOf('backend/api/src/a.test.ts', roots)).toEqual({ dir: 'backend/api', kind: 'npm', test: true })
    expect(rootOf('frontend/b.test.ts', roots)).toEqual({ dir: '', kind: 'npm', test: true })
    expect(rootOf('svc/pkg/x_test.go', roots)).toEqual({ dir: 'svc', kind: 'go' })
    expect(rootOf('a.test.ts', [])).toBeUndefined()
    expect(suggestFor({ dir: 'backend/api', kind: 'npm', test: true })).toBe('npm --prefix backend/api test')
    expect(suggestFor({ dir: '', kind: 'npm', test: true })).toBe('npm test')
    // npm with no test script of its own: crew cannot tell what runs the tests there.
    expect(suggestFor({ dir: 'tools', kind: 'npm', test: false })).toBeUndefined()
    expect(suggestFor({ dir: 'svc', kind: 'go' })).toBe('go -C svc test -v ./...')
    expect(suggestFor({ dir: '', kind: 'go' })).toBe('go test -v ./...')
    // Python: the design suggests no command, only the folder (how a repo runs pytest varies too much to guess).
    expect(suggestFor({ dir: 'py lib', kind: 'py' })).toBeUndefined()
    expect(kindOf('backend/package.json')).toBe('npm')
    expect(kindOf('go.mod')).toBe('go')
    expect(kindOf('svc/pyproject.toml')).toBe('py')
    expect(testScriptIn('{"scripts":{"test":"vitest run"}}')).toBe(true)
    expect(testScriptIn('{"scripts":{"test":"echo \\"Error: no test specified\\" && exit 1"}}')).toBe(false)
    expect(testScriptIn('{"scripts":{}}')).toBe(false)
    expect(testScriptIn('not json')).toBe(false)
  })

  test('each reason apart: unreached by folder with the command to add, skipped, unnamed, missing', () => {
    const roots: TestRoot[] = [{ dir: 'frontend', kind: 'npm', test: true }, { dir: 'backend/api', kind: 'npm', test: true }, { dir: 'svc', kind: 'go' }, { dir: 'tools', kind: 'npm', test: false }]
    const named = new Map([
      ['SMK-001', ['backend/api/src/a.test.ts']],
      ['SMK-002', ['frontend/src/b.test.ts']],
      ['SMK-003', ['frontend/src/c.test.ts']],
      ['SMK-005', ['svc/pkg/x_test.go']],
      ['SMK-006', ['tools/t.test.js']],
      ['SMK-007', ['backend/api/src/c.integration.test.ts']],
    ])
    const output = [' ✓ src/b.test.ts (3 tests)', ' ↓ src/c.test.ts > SMK-003 needs the database', 'ok  \texample.com/svc/pkg\t0.1s'].join('\n')
    const ids = ['SMK-001', 'SMK-002', 'SMK-003', 'SMK-004', 'SMK-005', 'SMK-006', 'SMK-007']
    const r = noResultsOf({ ids, output, prefix: 'SMK-', named, roots, commands: ['npm --prefix frontend test'] })
    expect(r.none).toEqual({
      'SMK-001': { why: 'unreached', dir: 'backend/api' },
      'SMK-002': { why: 'unnamed' },
      'SMK-003': { why: 'skipped' },
      'SMK-004': { why: 'missing' },
      // The output names a go package, but with no module path read crew cannot tie it to svc: no command reaches svc.
      'SMK-005': { why: 'unreached', dir: 'svc' },
      'SMK-006': { why: 'unreached', dir: 'tools' },
      'SMK-007': { why: 'unreached', dir: 'backend/api' },
    })
    expect(r.dirs).toEqual({ 'backend/api': { suggest: 'npm --prefix backend/api test' }, svc: { suggest: 'go -C svc test -v ./...' }, tools: {} })
    expect(r.skips).toEqual([{ ids: ['SMK-003'], why: '↓ src/c.test.ts > SMK-003 needs the database' }])
    // The command crew would suggest is one of the person's already: that folder was run, so the output just did not list it.
    const set = noResultsOf({ ids: ['SMK-001'], output: '', prefix: 'SMK-', named, roots, commands: ['npm --prefix frontend test', 'npm  --prefix backend/api test'] })
    expect(set).toEqual({ none: { 'SMK-001': { why: 'unnamed' } }, dirs: {} })
    // A test file outside every runner's folder: its own folder, with nothing to suggest.
    expect(noResultsOf({ ids: ['SMK-001'], output: '', prefix: 'SMK-', named, roots: [], commands: [] })).toEqual({ none: { 'SMK-001': { why: 'unreached', dir: 'backend/api/src' } }, dirs: { 'backend/api/src': {} } })
  })

  test('a runner that lists only the files that failed (vitest by default) still ran the others in its folder', () => {
    // As artogo's frontend printed it: one failed file listed under the run's folder, the passed ones not at all.
    const output = [' RUN  v4.1.11 /repo/frontend', ' ❯ |node-and-file-environments| src/__tests__/conventions.test.ts (132 tests | 4 failed) 57186ms', '     × SMK-441 畫面字串', ' Test Files  1 failed | 187 passed (188)'].join('\n')
    const roots: TestRoot[] = [{ dir: '', kind: 'npm', test: false }, { dir: 'frontend', kind: 'npm', test: true }, { dir: 'backend/api', kind: 'npm', test: true }]
    const named = new Map([
      ['SMK-024', ['frontend/src/lib/officialRefundTime.test.ts']],
      ['SMK-442', ['frontend/src/__tests__/conventions.test.ts']],
      ['SMK-391', ['backend/api/src/a.test.ts']],
    ])
    const files = ['frontend/src/lib/officialRefundTime.test.ts', 'frontend/src/__tests__/conventions.test.ts', 'backend/api/src/a.test.ts']
    // The command is not crew's suggestion word for word: the folder counts as run by the file the output names.
    const r = noResultsOf({ ids: ['SMK-024', 'SMK-442', 'SMK-391'], output, prefix: 'SMK-', named, roots, commands: ['npm --prefix frontend run test:ci'], files })
    expect(r.none).toEqual({ 'SMK-024': { why: 'unnamed' }, 'SMK-442': { why: 'unnamed' }, 'SMK-391': { why: 'unreached', dir: 'backend/api' } })
    expect(r.dirs).toEqual({ 'backend/api': { suggest: 'npm --prefix backend/api test' } })
    // With none of the frontend's files in the output, a script crew cannot read may or may not have run them: unclear, not unreached.
    const quiet = noResultsOf({ ids: ['SMK-024'], output: ' Test Files  188 passed (188)', prefix: 'SMK-', named, roots, commands: ['npm --prefix frontend run test:ci'], files })
    expect(quiet.none).toEqual({ 'SMK-024': { why: 'unclear', dir: 'frontend' } })
    // A file the output names in a folder of its own runner says nothing of the folder that holds it.
    const nested: TestRoot[] = [...roots, { dir: 'frontend/tools', kind: 'npm', test: true }]
    const inner = noResultsOf({ ids: ['SMK-024'], output: ' ✓ src/t.test.ts (1 test)', prefix: 'SMK-', named, roots: nested, commands: [], files: ['frontend/tools/src/t.test.ts', ...files] })
    expect(inner.none).toEqual({ 'SMK-024': { why: 'unreached', dir: 'frontend' } })
  })

  test('the test files git grep found anything in, each once', () => {
    expect(grepFiles('a/x.test.ts\0SMK-001\na/x.test.ts\0SMK-002\nb/y_test.go\0smk_3\n\nno nul here\n\0SMK-004\n')).toEqual(['a/x.test.ts', 'b/y_test.go'])
    expect(grepFiles('')).toEqual([])
  })

  test('a stored record of the reasons is read back as crew wrote it, anything else left out', () => {
    expect(noResultsFrom({ none: { 'SMK-001': { why: 'unreached', dir: 'x' }, 'SMK-002': { why: 'gone' }, 'SMK-003': 'skipped' }, dirs: { x: { suggest: 'npm test', covered: true, extra: 1 }, y: 3 }, skips: 7 })).toEqual({
      none: { 'SMK-001': { why: 'unreached', dir: 'x' } },
      dirs: { x: { suggest: 'npm test' } },
    })
    expect(noResultsFrom({})).toEqual({})
  })
})

describe('a run of several test commands', () => {
  const part = (cmd: string, exit: number, output: string, ms = 1000): PartOut => ({ cmd, exit, ms, output })
  const TOTALS = 'Tests  3 passed (3)'

  test('takes each test case’s result from whichever command printed it, a failure in any winning', () => {
    const all = combined([part('npm --prefix frontend test', 1, `✓ TC-001\n✗ TC-002\n${TOTALS}`), part('npm --prefix backend test', 0, `✓ TC-002\n✓ TC-003\n${TOTALS}`)], IDS, 'TC-', 4000)
    expect(Object.fromEntries(all.results)).toEqual({ 'TC-001': 'passed', 'TC-002': 'failed', 'TC-003': 'passed' })
    expect(all.exit).toBe(1)
    expect(all.counted).toBe(true)
  })

  test('ends with the exit code of a command that may have stopped short, which no totals then cover', () => {
    // The backend's command stopped before any test: the run did not go to its end, whatever the frontend's did.
    const cut = combined([part('a', 0, `✓ TC-001\n${TOTALS}`), part('b', 2, 'Error: cannot find module')], IDS, 'TC-', 4000)
    expect([cut.exit, cut.counted]).toEqual([2, false])
    // A command that failed a test of its own explains its exit code; the run went to its end.
    const failed = combined([part('a', 0, `✓ TC-001\n${TOTALS}`), part('b', 1, `✗ TC-002\n${TOTALS}`)], IDS, 'TC-', 4000)
    expect([failed.exit, failed.counted]).toEqual([1, true])
    // Not 0 with results and totals but no test case failed: an untold failure, the first exit code not 0.
    const untold = combined([part('a', 3, `✓ TC-001\n${TOTALS}`), part('b', 0, `✓ TC-002\n${TOTALS}`)], IDS, 'TC-', 4000)
    expect([untold.exit, untold.counted]).toEqual([3, true])
    // One command reads as it did before there could be several.
    const one = combined([part('a', 0, '✓ TC-001')], IDS, 'TC-', 4000)
    expect([one.exit, one.counted, one.summary]).toEqual([0, false, runSummary('✓ TC-001', 0)])
    expect(combined([], IDS, 'TC-', 4000)).toMatchObject({ exit: 0, counted: false, summary: '' })
  })

  test('says the overall result in a line per command, and gives the full-stack a share of each one’s output', () => {
    const all = combined([part('npm --prefix frontend test', 0, `✓ TC-001\n${TOTALS}`), part('npm --prefix backend test', 1, `${'x'.repeat(5000)}\n✗ TC-002`)], IDS, 'TC-', 1000)
    expect(all.summary).toBe('1. npm --prefix frontend test：exit 0；Tests 3 passed (3)\n2. npm --prefix backend test：exit 1，輸出裡找不到測試總數')
    expect(all.output).toMatch(/^## \[1\/2\] \$ npm --prefix frontend test（exit 0）\n✓ TC-001/)
    expect(all.output).toMatch(/## \[2\/2\] \$ npm --prefix backend test（exit 1）\nx+\n✗ TC-002$/)
    expect(all.output.length).toBeLessThanOrEqual(1000)
    expect(summaryOf(all.sums.slice(0, 1))).toBe('exit 0；Tests 3 passed (3)')
    expect(outputTail([{ cmd: 'a', exit: 0, output: 'abcdef' }], 3)).toBe('def')
  })

  test('keeps one command’s log as before; with several, a log each and the run’s own pointing to them', () => {
    expect(runLogs([part('npm test', 0, 'ok')], '/w', 'abc', 0, 'r1')).toEqual([{ name: 'r1', text: '$ npm test\n# /w\n# commit abc\n# exit 0\n\nok' }])
    const logs = runLogs([part('a', 0, 'one', 165_000), part('b', 1, 'two', 4_000)], '/w（合回後）', 'abc', 1, 'r1')
    expect(logs.map(l => l.name)).toEqual(['r1', partLog('r1', 0), partLog('r1', 1)])
    expect(logs[0]?.text).toBe('$ a\n$ b\n# /w（合回後）\n# commit abc\n# exit 1\n\n每一條測試指令的紀錄：\n1. .crew/runs/r1-1.log（exit 0・2 分 45 秒）\n2. .crew/runs/r1-2.log（exit 1・4 秒）\n')
    expect(logs[2]?.text).toBe('$ b\n# /w（合回後）\n# commit abc\n# exit 1\n\ntwo')
    expect(logOutput(logs[2]?.text ?? '')).toBe('two')
    expect(logOutput('no head')).toBe('')
    expect([durationSaid(0), durationSaid(59_400), durationSaid(60_000), durationSaid(165_000)]).toEqual(['0 秒', '59 秒', '1 分', '2 分 45 秒'])
  })
})
