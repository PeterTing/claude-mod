import { describe, expect, test } from 'claude-code/testing'
import { logOf } from './logbook'

const line = (t: number, e: Record<string, unknown>) => JSON.stringify({ t, ...e })

describe('the log tab with builders side by side', () => {
  const lines = [
    line(1, { kind: 'start', role: 'fullstack', model: 'Sonnet・high' }),
    line(2, { kind: 'start', role: 'fullstack', slot: 2, model: 'Opus 5.5・high' }),
    line(3, { kind: 'post', item: 'TASK-002', from: 'crew', to: 'fullstack', slot: 2, text: 'TASK-002 review 要改：補上錯誤處理' }),
    line(4, { kind: 'compact', role: 'fullstack', slot: 2, trigger: 'auto' }),
    line(5, { kind: 'wake', role: 'fullstack', slot: 2, model: 'Sonnet・high' }),
  ]
  const log = logOf(lines, 10).reverse()

  test('each builder keeps its own model: a second builder on another model is no move', () => {
    const moves = log.filter(e => e.word === '換模型')
    expect(moves.map(e => [e.who, e.text])).toEqual([['全端 2', 'Opus 5.5・high → Sonnet・high']])
  })

  test('work handed to a builder by message and its context compacted name the builder', () => {
    expect(log.find(e => e.item === 'TASK-002')?.who).toBe('crew → 全端 2')
    expect(log.find(e => e.word === '壓縮 context')?.who).toBe('全端 2')
  })
})
