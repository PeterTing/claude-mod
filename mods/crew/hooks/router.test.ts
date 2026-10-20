import { describe, expect, test } from 'claude-code/testing'

import { floorOf, routeFor, tierFor, tunedRoute } from './router'

describe('tierFor', () => {
  test('sizes a PRD split by how long the PRD is', () => {
    expect(tierFor({ kind: 'split_prd', size: 400 })).toBe('M')
    expect(tierFor({ kind: 'split_prd', size: 2_500 })).toBe('L')
    expect(tierFor({ kind: 'split_prd', size: 9_000 })).toBe('XL')
  })

  test('sizes test case writing by how many criteria there are', () => {
    expect(tierFor({ kind: 'write_tests', size: 6 })).toBe('S')
    expect(tierFor({ kind: 'write_tests', size: 20 })).toBe('M')
    expect(tierFor({ kind: 'write_tests', size: 45 })).toBe('L')
  })

  test('raises a task that touches a risky area', () => {
    expect(tierFor({ kind: 'write_tests', size: 6, text: '金流 webhook 驗簽' })).toBe('M')
    expect(tierFor({ kind: 'split_prd', size: 400, text: 'database migration for billing' })).toBe('L')
    expect(tierFor({ kind: 'split_prd', size: 9_000, text: 'auth' })).toBe('XL')
  })

  test('raises one tier for every two failures', () => {
    expect(tierFor({ kind: 'write_tests', size: 6, failures: 1 })).toBe('S')
    expect(tierFor({ kind: 'write_tests', size: 6, failures: 2 })).toBe('M')
    expect(tierFor({ kind: 'write_tests', size: 6, failures: 4 })).toBe('L')
  })

  test('treats short confirmations as small', () => {
    expect(tierFor({ kind: 'confirm_gaps', size: 2 })).toBe('S')
    expect(tierFor({ kind: 'confirm_gaps', size: 12 })).toBe('M')
  })
})

describe('routeFor', () => {
  test('maps each tier to its model, effort and context limit', () => {
    expect(routeFor('qa', 'S')).toEqual({ tier: 'S', model: 'sonnet', label: 'Sonnet', effort: 'medium', limit: 60_000 })
    expect(routeFor('qa', 'M')).toMatchObject({ model: 'sonnet', effort: 'high', limit: 100_000 })
    expect(routeFor('qa', 'L')).toMatchObject({ model: 'opus', effort: 'high', limit: 160_000 })
    expect(routeFor('qa', 'XL')).toMatchObject({ model: 'opus', effort: 'xhigh', limit: 256_000 })
  })

  test('keeps each role at or above its floor', () => {
    expect(routeFor('pm', 'S')).toMatchObject({ label: 'Sonnet', effort: 'high' })
    expect(routeFor('fullstack', 'S')).toMatchObject({ label: 'Sonnet', effort: 'high' })
    expect(routeFor('techlead', 'S')).toMatchObject({ label: 'Opus', effort: 'high' })
    expect(routeFor('techlead', 'XL')).toMatchObject({ label: 'Opus', effort: 'xhigh' })
    expect(routeFor('uiux', 'S')).toMatchObject({ label: 'Sonnet', effort: 'medium' })
  })

  test('keeps the tier’s context limit when a floor raises the model', () => {
    expect(routeFor('pm', 'S').limit).toBe(60_000)
    expect(routeFor('techlead', 'S').limit).toBe(60_000)
  })

  test('escalates past XL to Opus max', () => {
    expect(routeFor('fullstack', 'XL', { beyond: true })).toMatchObject({ label: 'Opus', effort: 'max', limit: 256_000 })
  })
})

describe('a route the brain tuned', () => {
  test('takes the model, effort and threshold the brain set for the role, and nothing else', () => {
    const base = routeFor('fullstack', 'S')
    expect(tunedRoute(base, undefined)).toEqual(base)
    expect(tunedRoute(base, { model: 'opus', effort: 'xhigh' })).toEqual({ ...base, model: 'opus', label: 'Opus', effort: 'xhigh' })
    expect(tunedRoute(base, { limit: 80_000 })).toEqual({ ...base, limit: 80_000 })
  })

  test('gives way to the step up a task that failed again takes', () => {
    const beyond = routeFor('fullstack', 'XL', { beyond: true })
    expect(tunedRoute(beyond, { model: 'sonnet', effort: 'high' })).toEqual(beyond)
  })

  test('never goes below the role’s floor', () => {
    expect(floorOf('fullstack', { model: 'haiku' })).toBe('Sonnet・high')
    expect(floorOf('fullstack', { effort: 'medium' })).toBe('Sonnet・high')
    expect(floorOf('techlead', { model: 'sonnet' })).toBe('Opus・high')
    expect(floorOf('qa', { model: 'sonnet', effort: 'medium' })).toBeUndefined()
    expect(floorOf('fullstack', { limit: 80_000 })).toBeUndefined()
  })
})
