import { describe, expect, test } from 'claude-code/testing'

import { parseCommand, resultsOf } from './runs'

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
  })

  test('do not take a number that merely starts like a test case id', () => {
    expect(Object.fromEntries(resultsOf('✓ TC-0010 something\n✓ TC-1 short', IDS, 'TC-'))).toEqual({ 'TC-001': 'passed' })
    // TC-1 is TC-001 written short; TC-0010 is TC-010, which the board does not have.
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

  test('follow the board’s own test case prefix', () => {
    expect(Object.fromEntries(resultsOf('✓ T-001 a\n✗ T_002 b', ['T-001', 'T-002'], 'T-'))).toEqual({ 'T-001': 'passed', 'T-002': 'failed' })
  })
})
