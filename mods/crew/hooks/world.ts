import type { CommandRunInput, On, RenderPropsOf, SessionStartInput, TurnCompleteInput } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { Tracker } from './board'

/**
 * crew end to end inside the kit: a repo on an in-memory disk, the PM and QA
 * played by the test through the same tool calls and turn ends a session has.
 */

export const ROOT = '/repo'
export const NOW = Date.UTC(2026, 9, 15, 6, 0, 0)

export const PRD = '# 會員訂閱\n\n使用者可以選月繳方案，可以隨時取消，取消後用到期末。'

export type Spawn = { subagentType: string; name?: string; description: string; model?: string; prompt: string }

export const world = (engine: Engine, on: On, { deliver = true } = {}) => {
  mock.clock(on, { now: NOW })
  const disk = new Map<string, string>([[`${ROOT}/docs/PRD.md`, PRD]])
  const spawned: Spawn[] = []
  const sent: { to: string; text: string }[] = []
  const toasts: string[] = []
  const registered = { tools: [] as string[], agents: [] as string[] }
  /** What the small model is asked, and the replies it gives in turn. */
  const completions: { model: string; prompt: string; system?: string }[] = []
  /** What crew submitted to the main conversation. */
  const prompts: string[] = []
  const replies: string[] = []
  on('fs.exists', (_$, e) => ({ value: disk.has(e.path) || [...disk.keys()].some(p => p.startsWith(`${e.path}/`)) }))
  on('fs.read', (_$, e) => (disk.has(e.path) ? { value: disk.get(e.path) ?? '' } : { deny: `ENOENT ${e.path}` }))
  on('fs.write', (_$, e) => {
    disk.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.list', (_$, e) => {
    const dir = e.path.endsWith('/') ? e.path : `${e.path}/`
    const names = new Set([...disk.keys()].filter(p => p.startsWith(dir)).map(p => p.slice(dir.length).split('/')[0] ?? ''))
    return { value: [...names].map(name => ({ name, kind: disk.has(`${dir}${name}`) ? ('file' as const) : ('dir' as const), size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('model.complete', (_$, e) => {
    completions.push({ model: e.model, prompt: e.prompt, ...(e.system === undefined ? {} : { system: e.system }) })
    return { value: { isAnswered: true as const, text: replies.shift() ?? '[]', usage: { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  /** Registrations and spawns, in the order they happened. */
  const order: string[] = []
  on('tool.register', (_$, e) => {
    order.push(`tool:${e.name}`)
    registered.tools.push(e.name)
    return { value: { tool: `mcp__crew__${e.name}` } }
  })
  on('agent.register', (_$, e) => {
    order.push(`agent:${e.name}`)
    registered.agents.push(e.name)
    return { value: { agent: `crew:${e.name}` } }
  })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  const logs: string[] = []
  on('ui.log', (_$, e) => {
    logs.push(String((e as { text?: unknown }).text ?? JSON.stringify(e)))
    return { value: undefined }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  // The kit hands a plugin's spawn down as the Agent tool's input, and keeps the agent id to the engine:
  // the plugin finds its agent in the list instead, as it would behind a hook that kept the id back.
  on('agent.spawn', (_$, e) => {
    const input = e as unknown as { subagent_type?: string; subagentType?: string; name?: string; description: string; model?: string; prompt: string }
    order.push(`spawn:${input.subagentType ?? input.subagent_type ?? ''}`)
    spawned.push({
      subagentType: input.subagentType ?? input.subagent_type ?? '',
      description: input.description,
      prompt: input.prompt,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.model === undefined ? {} : { model: input.model }),
    })
    return { model: input.model ?? 'claude-sonnet-5-5' }
  })
  on('agent.list', () => ({
    value: spawned.map((s, i) => ({ id: `a-${s.subagentType.replace('crew:', '')}-${i + 1}`, spawnedBy: 'crew', type: s.subagentType, status: 'running', description: s.description })),
  }))
  // Resuming a finished agent asks whether its type is offered, as the engine does.
  on('session.send', async (_$, e) => {
    sent.push({ to: String(e.to), text: e.text })
    const offer = (await engine.agent.offer({ agent: 'crew:pm', description: 'crew PM', source: 'plugin', provider: { plugin: 'crew', tier: 'user' } } as never)) as { isOffered: boolean }
    if (!offer.isOffered) return { isDelivered: false, reason: "Agent type 'crew:pm' is not offered in this session." }
    return deliver ? { isDelivered: true } : { isDelivered: false, reason: 'Agent could not be resumed' }
  })
  on('agent.offer', () => ({ isOffered: true }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_$, e) => {
    if (e.origin.kind === 'plugin') prompts.push(e.text)
    return { text: e.text }
  })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  const board = () => JSON.parse(disk.get(`${ROOT}/prd-tracker.json`) ?? 'null') as Tracker | null
  return { disk, spawned, sent, toasts, registered, board, completions, replies, order, prompts, logs }
}

export const start = ($: Engine) => $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as SessionStartInput)

export const command = (args: string): CommandRunInput => ({
  command: 'crew',
  args,
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 140 },
})

export const write = ($: Engine, agentId: string, ops: unknown[]) =>
  $.tool.call({ tool: 'mcp__crew__board_write', tool_use_id: `t-${Math.random()}`, agentId, ops } as never) as Promise<{ result: unknown }>

export const done = ($: Engine, agentId: string, answer = '完成') =>
  $.turn.complete({ answer, durationMs: 5, isAborted: false, turnId: `turn-${agentId}`, reason: 'answer', agentId } as TurnCompleteInput)

export const SPLIT = [
  { op: 'add_feature', title: '方案選擇', summary: '選月繳' },
  { op: 'add_feature', title: '取消訂閱', summary: '用到期末' },
  { op: 'add_criterion', feature: 'PRD-001', text: '可以選月繳方案' },
  { op: 'add_criterion', feature: 'PRD-002', text: '取消後仍可使用到期末' },
]


/** The pane's text on one tab. */
export const paneText = async ($: Engine, tab?: string) => {
  const ui = await $.ui.mount({
    plugin: 'crew',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'crew',
    props: { title: 'Crew', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 80 } } as unknown as RenderPropsOf['Pane'],
  })
  if (tab !== undefined) {
    await ui.press({ key: `tab-${tab}` })
  }
  const text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
  await ui.unmount()
  return text
}
