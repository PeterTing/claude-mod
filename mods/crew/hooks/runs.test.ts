import { describe, expect, test } from 'claude-code/testing'

import type { TestCase } from './board'
import { parseCommand, resultsOf, testMark } from './runs'

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
