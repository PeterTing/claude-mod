import { describe, expect, test } from 'claude-code/testing'

import { baseOf, clash, isHot, ordered, schedule, waitsOf } from './schedule'
import type { Running, Work } from './schedule'

const build = (task: string, touches: string[], extra: Partial<Work> = {}): Work => ({ kind: 'build', task, touches, waitedOn: 0, order: Number(task.slice(-3)), ...extra })

describe('what may change the same files', () => {
  test('reads a path without its glob, its leading ./ or its trailing slash', () => {
    expect(baseOf('src/api/**')).toBe('src/api')
    expect(baseOf('./src/ui/')).toBe('src/ui')
    expect(baseOf('*.css')).toBe('')
  })

  test('takes two paths for the same files when one holds the other', () => {
    expect(clash(['src/api'], ['src/api/orders.ts'])).toBe(true)
    expect(clash(['src/api/orders.ts'], ['src/api/orders.ts'])).toBe(true)
    expect(clash(['src/api/orders.ts'], ['src/api/users.ts'])).toBe(false)
    // A name that only starts the same is another folder.
    expect(clash(['src/api'], ['src/apiv2/x.ts'])).toBe(false)
    // A glob over the whole repo holds everything.
    expect(clash(['**/*.ts'], ['src/a.ts'])).toBe(true)
  })

  test('has a job that did not say what it changes clash with every other', () => {
    expect(clash([], ['src/a.ts'])).toBe(true)
    expect(clash(['src/a.ts'], [])).toBe(true)
  })

  test('has two jobs that touch the files every part leans on clash, wherever they are', () => {
    expect(isHot('package.json')).toBe(true)
    expect(isHot('web/pnpm-lock.yaml')).toBe(true)
    expect(isHot('db/migrations/0003_orders.sql')).toBe(true)
    expect(isHot('prisma/schema.prisma')).toBe(true)
    expect(isHot('src/routes.ts')).toBe(true)
    expect(isHot('vite.config.ts')).toBe(true)
    expect(isHot('src/app/globals.css')).toBe(true)
    expect(isHot('src/api/orders.ts')).toBe(false)
    expect(clash(['package.json', 'src/a.ts'], ['web/package-lock.json', 'src/b.ts'])).toBe(true)
    expect(clash(['db/migrations'], ['src/b.ts'])).toBe(false)
  })
})

describe('the order work is taken in', () => {
  test('takes the review first, then a fix, then the build most waited on, then the plan’s order', () => {
    const work: Work[] = [build('TASK-003', ['c']), build('TASK-002', ['b'], { waitedOn: 2 }), { kind: 'fix', task: 'TASK-004', touches: ['d'], waitedOn: 0, order: 4 }, { kind: 'review', task: 'TASK-001', touches: ['a'], waitedOn: 0, order: 1 }]
    expect(ordered(work).map(w => w.task)).toEqual(['TASK-001', 'TASK-004', 'TASK-002', 'TASK-003'])
  })
})

describe('schedule', () => {
  test('starts unrelated builds at once, up to the limit, in the lowest free slots', () => {
    const work = [build('TASK-001', ['src/a.ts']), build('TASK-002', ['src/b.ts']), build('TASK-003', ['src/c.ts'])]
    expect(schedule(work, [], { limit: 2, waitingReview: 0 }).map(s => [s.work.task, s.slot])).toEqual([
      ['TASK-001', 1],
      ['TASK-002', 2],
    ])
  })

  test('counts the tech lead’s review in the limit, and runs one review at a time', () => {
    const work: Work[] = [{ kind: 'review', task: 'TASK-001', touches: [], waitedOn: 0, order: 1 }, { kind: 'review', task: 'TASK-002', touches: [], waitedOn: 0, order: 2 }, build('TASK-003', ['src/c.ts'])]
    // A limit of one is the serial flow: the review, and the build waits.
    expect(schedule(work, [], { limit: 1, waitingReview: 2 }).map(s => [s.work.task, s.slot])).toEqual([['TASK-001', 0]])
    expect(schedule(work, [], { limit: 3, waitingReview: 2 }).map(s => [s.work.task, s.slot])).toEqual([
      ['TASK-001', 0],
      ['TASK-003', 1],
    ])
  })

  test('starts nothing at a limit of none, as when the usage guard stops the roles', () => {
    expect(schedule([build('TASK-001', ['a'])], [], { limit: 0, waitingReview: 0 })).toEqual([])
  })

  test('keeps a job from starting beside one that may change the same files', () => {
    const running: Running[] = [{ task: 'TASK-001', slot: 1, touches: ['src/api'] }]
    const work = [build('TASK-002', ['src/api/orders.ts']), build('TASK-003', ['src/ui/cart.tsx'])]
    expect(schedule(work, running, { limit: 4, waitingReview: 0 }).map(s => s.work.task)).toEqual(['TASK-003'])
  })

  test('keeps two jobs that clash from starting together in one round', () => {
    const work = [build('TASK-001', ['package.json', 'src/a.ts']), build('TASK-002', ['pnpm-lock.yaml', 'src/b.ts']), build('TASK-003', ['src/c.ts'])]
    expect(schedule(work, [], { limit: 4, waitingReview: 0 }).map(s => s.work.task)).toEqual(['TASK-001', 'TASK-003'])
  })

  test('runs a build that did not say what it changes alone', () => {
    expect(schedule([build('TASK-001', []), build('TASK-002', ['src/b.ts'])], [], { limit: 4, waitingReview: 0 }).map(s => s.work.task)).toEqual(['TASK-001'])
    expect(schedule([build('TASK-002', [])], [{ task: 'TASK-001', slot: 1, touches: ['src/a.ts'] }], { limit: 4, waitingReview: 0 })).toEqual([])
  })

  test('lets a review run beside any build: it only reads', () => {
    const work: Work[] = [{ kind: 'review', task: 'TASK-002', touches: [], waitedOn: 0, order: 2 }]
    expect(schedule(work, [{ task: 'TASK-001', slot: 1, touches: [] }], { limit: 2, waitingReview: 1 }).map(s => s.slot)).toEqual([0])
  })

  test('holds new builds, not fixes, while more than two tasks wait for review', () => {
    const work: Work[] = [build('TASK-004', ['d']), { kind: 'fix', task: 'TASK-005', touches: ['e'], waitedOn: 0, order: 5 }]
    expect(schedule(work, [{ task: 'TASK-001', slot: 0, touches: [] }], { limit: 4, waitingReview: 3 }).map(s => s.work.task)).toEqual(['TASK-005'])
  })

  test('sends a fix back to the slot that built the task when that slot is free, and to another when not', () => {
    const fix: Work = { kind: 'fix', task: 'TASK-002', touches: ['b'], waitedOn: 0, order: 2, home: 3 }
    expect(schedule([fix], [], { limit: 4, waitingReview: 0 })[0]?.slot).toBe(3)
    expect(schedule([fix], [{ task: 'TASK-009', slot: 3, touches: ['z'] }], { limit: 4, waitingReview: 0 })[0]?.slot).toBe(1)
  })

  test('gives new work a slot no waiting task keeps, and a kept one only when no other is free', () => {
    expect(schedule([build('TASK-003', ['c'])], [{ task: 'TASK-002', slot: 2, touches: ['b'] }], { limit: 4, waitingReview: 0, kept: [1] })[0]?.slot).toBe(3)
    expect(schedule([build('TASK-003', ['c'])], [{ task: 'TASK-002', slot: 2, touches: ['b'] }], { limit: 4, waitingReview: 0 })[0]?.slot).toBe(1)
    const full = Array.from({ length: 7 }, (_, i) => ({ task: `TASK-1${i}`, slot: i + 2, touches: [`z${i}`] }))
    expect(schedule([build('TASK-003', ['c'])], full, { limit: 9, waitingReview: 0, kept: [1] })[0]?.slot).toBe(1)
  })

  test('starts nothing more for a task already under way', () => {
    expect(schedule([{ kind: 'review', task: 'TASK-001', touches: [], waitedOn: 0, order: 1 }], [{ task: 'TASK-001', slot: 2, touches: ['a'] }], { limit: 4, waitingReview: 1 })).toEqual([])
  })
})

describe('why work waits', () => {
  test('names the usage guard, not a full room, when its line holds the work', () => {
    const work = [build('TASK-001', ['src/a.ts']), build('TASK-002', ['src/b.ts'])]
    expect(waitsOf(work, [], { limit: 0, waitingReview: 0, usage: 'pause' }).map(w => w.why)).toEqual([
      'Claude 用量到了暫停線，crew 先不開新的工作，重置後接著做',
      'Claude 用量到了暫停線，crew 先不開新的工作，重置後接著做',
    ])
    const running: Running[] = [{ task: 'TASK-001', slot: 1, touches: ['src/a.ts'] }]
    expect(waitsOf(work, running, { limit: 1, waitingReview: 0, usage: 'warn' })).toEqual([{ task: 'TASK-002', why: 'Claude 用量到了提醒線，crew 一次只跑 1 個 agent（Tech lead 的 review 算在內），現在 1 個在工作' }])
    expect(waitsOf(work, running, { limit: 1, waitingReview: 0 })).toEqual([{ task: 'TASK-002', why: '同時最多 1 個 agent（Tech lead 的 review 算在內），都在工作' }])
  })
})
