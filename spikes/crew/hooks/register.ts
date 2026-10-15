import type { Register } from 'claude-code'

/**
 * Phase 0 spike for crew. One headless run walks S1–S8 and writes every
 * observation to <cwd>/crew-spike.jsonl:
 *
 *   S1 a plugin-defined agent type spawned as a named teammate, its model and effort
 *   S2 the teammate calls this plugin's tool, and the call carries its agentId
 *   S3 per-request usage (context size) for the teammate's loop
 *   S4 stopping the teammate with TaskStop and respawning it under the same name
 *   S5 a delivery to the teammate can carry appended text (memory injection)
 *   S6 session.compact for an agent loop (logged if it ever fires)
 *   S7 the teammate's fixed cost: a lean agent against one with default tools and CLAUDE.md
 *   S8 rewriting effort, then model, on a step, and what that does to the prompt cache
 */

const MARK = 'MEM-SPIKE-7: the staging database is called aurora-blue.'

const spike = {
  logPath: '',
  lines: [] as string[],
  phase: 'start',
  started: false,
  echoId: undefined as string | undefined,
  echoWakes: 0,
  crewIds: new Set<string>(),
  dropNotifications: true,
}

async function log($: any, kind: string, data: unknown) {
  spike.lines.push(JSON.stringify({ t: Date.now(), phase: spike.phase, kind, data }))
  if (spike.logPath !== '') await $.fs.write(spike.logPath, `${spike.lines.join('\n')}\n`)
}

async function spawnEcho($: any, type: string, prompt: string) {
  const r = await $.agent.spawn({ subagentType: type, name: 'echo', description: 'crew spike echo', prompt })
  await log($, 'spawn.result', { type, r })
  if (r.agentId !== undefined) spike.crewIds.add(r.agentId)
  return r
}

async function sendEcho($: any, text: string) {
  await log($, 'send.result', await $.session.send({ to: 'echo', text }))
}

export const register: Register = on => {
  on('session.start', async ($: any, e: any, next: any) => {
    spike.logPath = `${e.cwd}/crew-spike.jsonl`
    const tool = await $.tool.register({
      name: 'note',
      description: 'Record one short note for the crew spike. Call it exactly as instructed.',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      isDeferred: false,
    })
    await log($, 'tool.register', tool)
    const lean = await $.agent.register({
      name: 'echo',
      description: 'Crew spike test agent. Only used by the crew-spike plugin.',
      prompt: 'You are a test agent for a plugin spike. Do exactly what each message asks, using the note tool when told, then end your turn with the single word the message asks for. Be brief.',
      tools: ['mcp__crew-spike__note'],
      model: 'haiku',
      effort: 'low',
      omitClaudeMd: true,
      autoCompactWindow: 100000,
    })
    await log($, 'agent.register lean', lean)
    const full = await $.agent.register({
      name: 'echo-full',
      description: 'Crew spike baseline agent with default tools and CLAUDE.md.',
      prompt: 'You are a test agent for a plugin spike. Reply with the single word the message asks for.',
      model: 'haiku',
      effort: 'low',
    })
    await log($, 'agent.register full', full)
    const dev = await $.agent.register({
      name: 'echo-dev',
      description: 'Crew spike agent with the tools a working role needs.',
      prompt: 'You are a test agent for a plugin spike. Reply with the single word the message asks for.',
      tools: ['Read', 'Edit', 'Write', 'Bash', 'mcp__crew-spike__note'],
      model: 'haiku',
      effort: 'low',
      omitClaudeMd: true,
    })
    await log($, 'agent.register dev', dev)
    return next(e)
  })

  on('prompt.submit', async ($: any, e: any, next: any) => {
    const isCrewNotice =
      e.origin?.kind === 'task-notification' && [...spike.crewIds].some(id => String(e.text).includes(id))
    await log($, 'prompt.submit', { origin: e.origin, isMeta: e.isMeta, turnId: e.turnId, isCrewNotice, text: String(e.text).slice(0, 160) })
    if (isCrewNotice && spike.dropNotifications) {
      return { drop: 'crew: a routine agent update, folded into the digest' }
    }
    const r = await next(e)
    if (!spike.started && e.origin?.kind !== 'plugin' && (await $.env.get('CREW_SPIKE_BASELINE')) === '1') {
      spike.started = true
      spike.phase = 'S7'
      for (const type of ['crew-spike:echo', 'crew-spike:echo-dev', 'crew-spike:echo-full']) {
        const b = await $.agent.spawn({ subagentType: type, name: type.split(':')[1], description: 'crew spike baseline', prompt: 'Reply with the single word DEV.' })
        await log($, 'spawn.result', { type, r: b })
      }
      return r
    }
    if (!spike.started && e.origin?.kind !== 'plugin') {
      spike.started = true
      spike.phase = 'S1'
      const spawned = await spawnEcho($, 'crew-spike:echo', 'Call the note tool with the text "hello from echo". Then reply DONE1.')
      spike.echoId = spawned.agentId
    }
    return r
  })

  on('agent.spawn', async ($: any, e: any, next: any) => {
    const r = await next(e)
    await log($, 'agent.spawn', {
      origin: next.origin,
      subagentType: e.subagentType,
      name: e.name,
      isTeammate: e.isTeammate,
      background: e.background,
      model: e.model,
      parentModel: e.parentModel,
      result: r,
    })
    return r
  })

  on('tool.call', { tool: 'mcp__crew-spike__note' }, async ($: any, e: any) => {
    await log($, 'note', { agentId: e.agentId, input: e.input ?? e })
    return { result: 'noted' }
  })

  on('turn.step', async function* ($: any, e: any, next: any) {
    let input = e
    if (e.agentId !== undefined && e.agentId === spike.echoId) {
      if (spike.phase === 'S8-effort') input = { ...e, effort: 'medium' }
      if (spike.phase === 'S8-model') input = { ...e, model: 'claude-sonnet-5-5' }
    }
    await log($, 'step.in', { agentId: e.agentId, model: input.model, effort: input.effort, messageCount: e.messageCount, asked: { model: e.model, effort: e.effort } })
    const stream = next(input)
    for await (const chunk of stream) {
      if (chunk.kind === 'stop') {
        await log($, 'step.stop', { agentId: e.agentId, stopReason: chunk.stopReason, usage: chunk.usage })
      }
      yield chunk
    }
    return await stream.result
  })

  on('session.send', async ($: any, e: any, next: any) => {
    const r = await next(e)
    await log($, 'session.send', { to: e.to, origin: e.origin, agentId: e.agentId, text: String(e.text).slice(0, 200), result: r })
    return r
  })

  on('session.receive', async ($: any, e: any, next: any) => {
    const isForEcho = e.agentId !== undefined && e.agentId === spike.echoId
    const text = spike.phase === 'S5' && isForEcho ? `${e.text}\n\n[crew memory] ${MARK}` : e.text
    const r = await next({ ...e, text })
    await log($, 'session.receive', { agentId: e.agentId, origin: e.origin, injected: text !== e.text, text: String(text).slice(0, 300) })
    return r
  })

  on('turn.start', async ($: any, e: any, next: any) => {
    if (e.agentId !== undefined) await log($, 'turn.start', { agentId: e.agentId, text: String(e.text).slice(0, 400) })
    return next(e)
  })

  on('session.compact', async ($: any, e: any, next: any) => {
    await log($, 'session.compact', { agentId: e.agentId, trigger: e.trigger, messages: e.messages?.length })
    return next(e)
  })

  on('turn.complete', async ($: any, e: any, next: any) => {
    const r = await next(e)
    await log($, 'turn.complete', { agentId: e.agentId, reason: e.reason, usage: e.usage, answer: String(e.answer).slice(0, 300) })
    if (e.agentId === undefined || e.agentId !== spike.echoId) {
      if (e.agentId !== undefined && spike.phase === 'S7' && String(e.answer).includes('DEV')) {
        spike.phase = 'done'
        await log($, 'agents', await $.agent.list())
        $.prompt.submit({ text: 'The crew spike is finished. Reply with the single word FINISHED.' }).catch(() => undefined)
      }
      return r
    }
    spike.echoWakes += 1
    await log($, 'agents', await $.agent.list())
    if (spike.echoWakes === 1) {
      spike.phase = 'S5'
      await sendEcho($, 'Read the line that starts with [crew memory] in this message, then call the note tool with the name of the staging database it mentions. Then reply DONE2.')
    } else if (spike.echoWakes === 2) {
      spike.phase = 'S8-effort'
      await sendEcho($, 'Call the note tool with the text "effort check". Then reply DONE3.')
    } else if (spike.echoWakes === 3) {
      spike.phase = 'S8-model'
      await sendEcho($, 'Call the note tool with the text "model check". Then reply DONE4.')
    } else if (spike.echoWakes === 4) {
      spike.phase = 'S4'
      const stopped = await $.tool.call({ tool: 'TaskStop', task_id: spike.echoId }).catch((err: unknown) => ({ error: String(err) }))
      await log($, 'TaskStop', stopped)
      await log($, 'agents after stop', await $.agent.list())
      const again = await spawnEcho($, 'crew-spike:echo', 'You were restarted. Call the note tool with the text "respawned". Then reply DONE5.')
      spike.echoId = again.agentId
      spike.echoWakes = 4
      spike.phase = 'S4-respawned'
    } else {
      spike.phase = 'S7'
      await log($, 'agents', await $.agent.list())
      const full = await $.agent.spawn({ subagentType: 'crew-spike:echo-full', name: 'echo-full', description: 'crew spike baseline', prompt: 'Reply with the single word BASELINE.' })
      if (full.agentId !== undefined) spike.crewIds.add(full.agentId)
      await log($, 'spawn.result', { type: 'crew-spike:echo-full', r: full })
      const dev = await $.agent.spawn({ subagentType: 'crew-spike:echo-dev', name: 'echo-dev', description: 'crew spike dev baseline', prompt: 'Reply with the single word DEV.' })
      if (dev.agentId !== undefined) spike.crewIds.add(dev.agentId)
      await log($, 'spawn.result', { type: 'crew-spike:echo-dev', r: dev })
    }
    return r
  })
}
