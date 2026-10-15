import type {
  AgentSpawnInput,
  CommandRunInput,
  On,
  PromptOrigin,
  PromptSubmitInput,
  SessionSendInput,
  TurnCompleteInput,
} from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const ENGLISH = 'I fixed the login bug and added tests for the edge cases. Everything passes now.'
const CHINESE = '已經修好登入的問題，也補上邊界情況的測試，全部通過。'
const SIMPLIFIED = '这个问题已经修好了，我们还没有测试，等一下会补上。'
const TRADITIONAL = '這個問題已經修好了，我們還沒有測試，等一下會補上。'

const COMPOSE = {
  model: 'claude-opus-5-5',
  promptModel: 'claude-opus-5-5',
  surfaces: ['terminal'],
  tools: [],
  outputStyle: null,
  traits: [],
} as const

const turnEnd = (answer: string, more: Partial<TurnCompleteInput> = {}): TurnCompleteInput =>
  ({ answer, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer', ...more }) as TurnCompleteInput

const spawn = (prompt: string): AgentSpawnInput => ({
  tool_use_id: 'toolu_1',
  prompt,
  description: 'find the refresh',
  subagentType: 'Explore',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'claude-opus-5-5',
  background: false,
  fork: false,
})

const send = (text: string, agentId = 'a1', origin: SessionSendInput['origin'] = { kind: 'model' }): SessionSendInput => ({
  to: 'qa',
  text,
  origin,
  agentId,
})

const command = (name: string, args: string): CommandRunInput => ({
  command: name,
  args,
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 120 },
})

/** A prompt entering the session; the person typed it unless `more` says otherwise. */
const submit = ($: Engine, text: string, more: Partial<PromptSubmitInput> = {}) =>
  $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } as PromptOrigin, ...more })

/**
 * The engine beneath the plugin: it records each prompt that enters, answers
 * compose, turn starts and turn ends, and lets unawaited work settle.
 */
const world = (on: On, { dropPluginPrompts = false } = {}) => {
  const clock = mock.clock(on)
  const submitted: { text: string; context: readonly string[] }[] = []
  on('prompt.submit', ($, e) => {
    submitted.push({ text: e.text, context: e.context ?? [] })
    if (dropPluginPrompts && e.origin.kind === 'plugin') return { drop: 'blocked by a settings hook' }
    return { text: e.text, context: e.context }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' }] }))
  return { submitted, settle: () => clock.settle() }
}

/** The rewrite prompts the plugin sent, out of everything that entered. */
const rewrites = (submitted: readonly { text: string }[]) => submitted.filter(s => s.text.startsWith('上一'))

/** Another plugin that rewords every prompt the plugin under test sends. */
const REWORDING_PLUGIN = {
  name: 'reworder',
  register: (on: On) => {
    on('prompt.submit', ($, e, next) =>
      e.origin.kind === 'plugin' && e.origin.name === 'zh-reply' ? next({ ...e, text: e.text.replaceAll('。', '. ') }) : next(e),
    )
  },
}

/** Another plugin that spawns an agent whose answer it parses. */
const OTHER_PLUGIN = {
  name: 'other',
  register: (on: On) => {
    on('command.run', { command: 'other-spawn' }, async $ => {
      await $.agent.spawn({ prompt: 'Return JSON only.' })
      return { text: 'spawned' }
    })
  },
}

describe('system prompt', () => {
  test('adds the Traditional Chinese rule last, after the cache boundary', async ($, on) => {
    world(on)
    const { sections } = await $.prompt.compose(COMPOSE)
    const last = sections.at(-1)
    expect(last).toMatchObject({ id: 'zh-reply:language', scope: 'session' })
    expect(last?.text).toMatch(/繁體中文/)
    expect(last?.text).toMatch(/commit messages/)
    expect(sections[0]?.id).toBe('intro')
  })

  test('adds the Simplified Chinese rule for zh-CN', { options: { variant: 'zh-CN' } }, async ($, on) => {
    world(on)
    const { sections } = await $.prompt.compose(COMPOSE)
    expect(sections.at(-1)?.text).toMatch(/简体中文/)
  })

  test('adds the rule to a teammate with scope all', async ($, on) => {
    world(on)
    const { sections } = await $.prompt.compose({ ...COMPOSE, traits: ['teammate'] })
    expect(sections.map(s => s.id)).toContain('zh-reply:language')
  })

  test('leaves a teammate out with scope main, and keeps the main conversation', { options: { scope: 'main' } }, async ($, on) => {
    world(on)
    const teammate = await $.prompt.compose({ ...COMPOSE, traits: ['teammate'] })
    expect(teammate.sections.map(s => s.id)).not.toContain('zh-reply:language')
    const main = await $.prompt.compose(COMPOSE)
    expect(main.sections.map(s => s.id)).toContain('zh-reply:language')
  })
})

describe('spawned agents', () => {
  const recordSpawns = (on: On) => {
    const prompts: string[] = []
    on('agent.spawn', ($, e) => {
      prompts.push(e.prompt)
      return { model: 'sonnet', agentId: 'a1' }
    })
    return prompts
  }

  test('asks each agent to reply in Chinese and keep files in the project language', async ($, on) => {
    const prompts = recordSpawns(on)
    await $.agent.spawn(spawn('Find where the session token is refreshed.'))
    expect(prompts[0]).toStartWith('Find where the session token is refreshed.')
    expect(prompts[0]).toMatch(/繁體中文/)
    expect(prompts[0]).toMatch(/commit message/)
  })

  test('leaves agents alone with scope main', { options: { scope: 'main' } }, async ($, on) => {
    const prompts = recordSpawns(on)
    await $.agent.spawn(spawn('Find where the session token is refreshed.'))
    expect(prompts).toEqual(['Find where the session token is refreshed.'])
  })

  test('leaves agents alone while it is off', async ($, on) => {
    const prompts = recordSpawns(on)
    await $.command.run(command('zh-reply', 'off'))
    await $.agent.spawn(spawn('Find where the session token is refreshed.'))
    expect(prompts).toEqual(['Find where the session token is refreshed.'])
  })

  test('leaves agents another plugin spawns alone', { plugins: [OTHER_PLUGIN] }, async ($, on) => {
    const prompts = recordSpawns(on)
    await $.command.run(command('other-spawn', ''))
    expect(prompts).toEqual(['Return JSON only.'])
  })
})

describe('messages between agents', () => {
  const recordSends = (on: On) => {
    const delivered: string[] = []
    on('session.send', ($, e) => {
      delivered.push(`${e.agentId}:${e.text}`)
      return { isDelivered: true }
    })
    return delivered
  }

  test('sends an English message back once, then lets the identical resend through', async ($, on) => {
    const delivered = recordSends(on)
    const first = await $.session.send(send(ENGLISH))
    expect(first.isDelivered).toBe(false)
    expect(first.reason).toMatch(/繁體中文/)
    expect(delivered).toHaveLength(0)

    expect((await $.session.send(send(ENGLISH))).isDelivered).toBe(true)
    expect((await $.session.send(send(CHINESE))).isDelivered).toBe(true)
    expect(delivered).toEqual([`a1:${ENGLISH}`, `a1:${CHINESE}`])
  })

  test('keeps each sender apart when several send at once', async ($, on) => {
    const delivered = recordSends(on)
    expect((await $.session.send(send(ENGLISH, 'a1'))).isDelivered).toBe(false)
    expect((await $.session.send(send(ENGLISH, 'b1'))).isDelivered).toBe(false)
    expect((await $.session.send(send(ENGLISH, 'a1'))).isDelivered).toBe(true)
    expect((await $.session.send(send(ENGLISH, 'b1'))).isDelivered).toBe(true)
    expect(delivered).toEqual([`a1:${ENGLISH}`, `b1:${ENGLISH}`])
  })

  test('with scope main, checks only what the main conversation sends', { options: { scope: 'main' } }, async ($, on) => {
    recordSends(on)
    const { agentId: _, ...fromMain } = send(ENGLISH)
    expect((await $.session.send(fromMain)).isDelivered).toBe(false)
    expect((await $.session.send(send(ENGLISH, 'a1'))).isDelivered).toBe(true)
  })

  test('remembers the last 20 senders for the resend escape', async ($, on) => {
    recordSends(on)
    for (let i = 0; i <= 20; i += 1) {
      expect((await $.session.send(send(ENGLISH, `a${i}`))).isDelivered).toBe(false)
    }
    expect((await $.session.send(send(ENGLISH, 'a0'))).isDelivered).toBe(false)
    expect((await $.session.send(send(ENGLISH, 'a20'))).isDelivered).toBe(true)
  })

  test('lets another plugin send what it likes', async ($, on) => {
    recordSends(on)
    const sent = await $.session.send(send(ENGLISH, 'a1', { kind: 'plugin', name: 'crew' }))
    expect(sent.isDelivered).toBe(true)
  })

  test('lets everything through while it is off', async ($, on) => {
    recordSends(on)
    await $.command.run(command('zh-reply', 'off'))
    expect((await $.session.send(send(ENGLISH))).isDelivered).toBe(true)
  })

  test('words the refusal in Simplified Chinese for zh-CN', { options: { variant: 'zh-CN' } }, async ($, on) => {
    recordSends(on)
    const sent = await $.session.send(send(ENGLISH))
    expect(sent.reason).toMatch(/简体中文/)
  })
})

describe('main conversation', () => {
  test('asks once for a rewrite, and leaves the rewrite turn alone', async ($, on) => {
    const { submitted, settle } = world(on)
    await $.turn.complete(turnEnd(ENGLISH))
    await settle()
    expect(rewrites(submitted)).toHaveLength(1)
    expect(submitted[0]?.text).toMatch(/繁體中文/)

    await $.turn.start({ text: submitted[0]?.text ?? '', turnId: 'r1' })
    await $.turn.complete(turnEnd(ENGLISH, { turnId: 'r1' }))
    await settle()
    expect(rewrites(submitted)).toHaveLength(1)

    await submit($, '繼續')
    await $.turn.complete(turnEnd(ENGLISH, { turnId: 't3' }))
    await settle()
    expect(rewrites(submitted)).toHaveLength(2)
  })

  test('asks for at most one rewrite until the person writes again', async ($, on) => {
    const { submitted, settle } = world(on, { dropPluginPrompts: true })
    await $.turn.complete(turnEnd(ENGLISH))
    await settle()
    await $.turn.complete(turnEnd(ENGLISH, { turnId: 't2' }))
    await settle()
    expect(rewrites(submitted)).toHaveLength(1)

    await submit($, '繼續')
    await $.turn.complete(turnEnd(ENGLISH, { turnId: 't3' }))
    await settle()
    expect(rewrites(submitted)).toHaveLength(2)
  })

  test('stops after one rewrite even when another plugin changes the rewrite prompt', { plugins: [REWORDING_PLUGIN] }, async ($, on) => {
    const { submitted, settle } = world(on)
    await $.turn.complete(turnEnd(ENGLISH))
    await settle()
    for (const turnId of ['r1', 'r2', 'r3', 'r4']) {
      await $.turn.start({ text: submitted.at(-1)?.text ?? '', turnId })
      await $.turn.complete(turnEnd(ENGLISH, { turnId }))
      await settle()
    }
    expect(rewrites(submitted)).toHaveLength(1)
    expect(submitted[0]?.text).not.toContain('。')
  })

  test('marks only a main-conversation turn as the rewrite turn', async ($, on) => {
    const { submitted, settle } = world(on)
    await $.turn.complete(turnEnd(ENGLISH))
    await settle()
    await $.turn.start({ text: submitted[0]?.text ?? '', turnId: 'x1', agentId: 'a1' })
    await submit($, '繼續')
    await $.turn.complete(turnEnd(ENGLISH, { turnId: 'x1' }))
    await settle()
    expect(rewrites(submitted)).toHaveLength(2)
  })

  test('asks for Traditional characters when a reply is in Simplified Chinese', async ($, on) => {
    const { submitted, settle } = world(on)
    await $.turn.complete(turnEnd(SIMPLIFIED))
    await settle()
    expect(submitted[0]?.text).toMatch(/簡體/)
  })

  test('asks in Simplified Chinese for zh-CN', { options: { variant: 'zh-CN' } }, async ($, on) => {
    const { submitted, settle } = world(on)
    await $.turn.complete(turnEnd(ENGLISH))
    await settle()
    await submit($, '继续')
    await $.turn.complete(turnEnd(TRADITIONAL, { turnId: 't2' }))
    await settle()
    expect(rewrites(submitted)[0]?.text).toMatch(/简体中文/)
    expect(rewrites(submitted)[1]?.text).toMatch(/繁体字/)
  })

  test('leaves Chinese replies, short replies and interrupted turns alone', async ($, on) => {
    const { submitted, settle } = world(on)
    await $.turn.complete(turnEnd(CHINESE))
    await $.turn.complete(turnEnd('Done.'))
    await $.turn.complete(turnEnd(ENGLISH, { reason: 'aborted', isAborted: true }))
    await settle()
    expect(submitted).toHaveLength(0)
  })

  test('leaves a subagent turn to the line it was spawned with', async ($, on) => {
    const { submitted, settle } = world(on)
    await $.turn.complete(turnEnd(ENGLISH, { agentId: 'a1' }))
    await settle()
    expect(submitted).toHaveLength(0)
  })

  test('respects a prompt that asks for another language, until the next prompt', async ($, on) => {
    const { submitted, settle } = world(on)
    await submit($, '請用英文寫一段 release note')
    await $.turn.complete(turnEnd(ENGLISH))
    await settle()
    expect(rewrites(submitted)).toHaveLength(0)

    await submit($, '好，接著修下一個 bug')
    await $.turn.complete(turnEnd(ENGLISH, { turnId: 't2' }))
    await settle()
    expect(rewrites(submitted)).toHaveLength(1)
  })

  test('keeps the running turn’s request when a prompt is typed over it', async ($, on) => {
    const { submitted, settle } = world(on)
    await submit($, '請用英文寫一段 release note')
    await submit($, '寫完順便跑測試', { turnId: 't1' })
    await $.turn.complete(turnEnd(ENGLISH))
    await settle()
    expect(rewrites(submitted)).toHaveLength(0)
  })

  test('reads a slash command’s arguments for a request', async ($, on) => {
    const { submitted, settle } = world(on)
    await submit($, '/release-note 請用英文寫', { command: { name: 'release-note', args: '請用英文寫' } })
    await $.turn.complete(turnEnd(ENGLISH))
    await settle()
    expect(rewrites(submitted)).toHaveLength(0)
  })

  test('leaves a reply in the script the person asked for alone', async ($, on) => {
    const { submitted, settle } = world(on)
    await submit($, '請用簡體中文寫給大陸同事')
    await $.turn.complete(turnEnd(SIMPLIFIED))
    await settle()
    expect(rewrites(submitted)).toHaveLength(0)
  })

  test('keeps checking when the person asks for the configured script', async ($, on) => {
    const { submitted, settle } = world(on)
    await submit($, '請用繁體中文回答：什麼是 race condition？')
    await $.turn.complete(turnEnd(SIMPLIFIED))
    await settle()
    expect(rewrites(submitted)).toHaveLength(1)
    expect(rewrites(submitted)[0]?.text).toMatch(/簡體字/)
  })

  test('checks a prompt that only mentions a script as usual', async ($, on) => {
    const { submitted, settle } = world(on)
    await submit($, '這個字的簡體寫法是什麼？')
    await $.turn.complete(turnEnd('「登入」的簡體寫法是「登录」，其他字都一樣。'))
    await settle()
    expect(rewrites(submitted)).toHaveLength(0)

    await submit($, '為什麼 i18n 檔用簡體？')
    await $.turn.complete(turnEnd(ENGLISH, { turnId: 't2' }))
    await settle()
    expect(rewrites(submitted)).toHaveLength(1)
    expect(rewrites(submitted)[0]?.text).toMatch(/繁體中文/)
  })

  test('takes no request from hidden prompts or prompts other plugins frame', async ($, on) => {
    const { submitted, settle } = world(on)
    await submit($, '請用英文寫', { isMeta: true })
    await submit($, '請用英文寫', { origin: { kind: 'plugin', name: 'other' } })
    await $.turn.complete(turnEnd(ENGLISH))
    await settle()
    expect(rewrites(submitted)).toHaveLength(1)
  })

  test('takes a request from a prompt another plugin sends in the person’s name', async ($, on) => {
    const { submitted, settle } = world(on)
    await submit($, '請用英文寫', { origin: { kind: 'plugin', name: 'other', asUser: true } })
    await $.turn.complete(turnEnd(ENGLISH))
    await settle()
    expect(rewrites(submitted)).toHaveLength(0)
  })

  test('remind mode reminds the model with the next prompt instead', { options: { enforce: 'remind' } }, async ($, on) => {
    const { submitted, settle } = world(on)
    await $.turn.complete(turnEnd(ENGLISH))
    await settle()
    expect(submitted).toHaveLength(0)

    await submit($, '繼續')
    expect(submitted[0]?.context.join('\n')).toMatch(/繁體中文/)

    await submit($, '再繼續')
    expect(submitted[1]?.context).toHaveLength(0)
  })

  test('remind mode holds the reminder while the person asks for another language', { options: { enforce: 'remind' } }, async ($, on) => {
    const { submitted, settle } = world(on)
    await $.turn.complete(turnEnd(ENGLISH))
    await settle()

    await submit($, '請用英文寫一段 release note')
    expect(submitted[0]?.context).toHaveLength(0)
    await $.turn.complete(turnEnd(ENGLISH, { turnId: 't2' }))

    await submit($, '繼續')
    expect(submitted[1]?.context.join('\n')).toMatch(/繁體中文/)
  })
})

describe('requests and the turns they cover', () => {
  test('a turn the person did not start is checked against the configured script', async ($, on) => {
    const { submitted, settle } = world(on)
    await submit($, '請用簡體中文寫給大陸同事')
    await $.turn.complete(turnEnd(SIMPLIFIED))
    await submit($, '<task-notification>done</task-notification>', { isMeta: true, origin: { kind: 'task-notification' } })
    await $.turn.complete(turnEnd(SIMPLIFIED, { turnId: 't2' }))
    await settle()
    expect(rewrites(submitted)).toHaveLength(1)
    expect(rewrites(submitted)[0]?.text).toMatch(/簡體字/)
  })

  test('a request for another language does not cover a turn the person did not start', async ($, on) => {
    const { submitted, settle } = world(on)
    await submit($, '請用英文寫一段 release note')
    await $.turn.complete(turnEnd(ENGLISH))
    await submit($, 'teammate qa finished', { origin: { kind: 'peer' } })
    await $.turn.complete(turnEnd(ENGLISH, { turnId: 't2' }))
    await settle()
    expect(rewrites(submitted)).toHaveLength(1)
  })

  test('a translation into the other script is not checked', async ($, on) => {
    const { submitted, settle } = world(on)
    await submit($, '把登入頁的 UI 文案翻譯成簡體中文')
    await $.turn.complete(turnEnd('以下是簡體中文版本，要我直接寫進 locales 嗎？\n```json\n{"login": "登录"}\n```'))
    await settle()
    expect(rewrites(submitted)).toHaveLength(0)
  })

  test('takes requests from scheduled, channel and Slack prompts', async ($, on) => {
    const { submitted, settle } = world(on)
    const kinds = ['scheduled-trigger', 'channel', 'slack-ping'] as const
    for (const [i, kind] of kinds.entries()) {
      await submit($, '請用英文寫', { origin: { kind } as PromptOrigin })
      await $.turn.complete(turnEnd(ENGLISH, { turnId: `t${i}` }))
    }
    await settle()
    expect(rewrites(submitted)).toHaveLength(0)
  })

  test('remind mode keeps the reminder for the next prompt that is not a slash command', { options: { enforce: 'remind' } }, async ($, on) => {
    const { submitted, settle } = world(on)
    await $.turn.complete(turnEnd(ENGLISH))
    await settle()
    await submit($, '/compact', { command: { name: 'compact', args: '' } })
    expect(submitted[0]?.context).toHaveLength(0)
    await submit($, '繼續')
    expect(submitted[1]?.context.join('\n')).toMatch(/繁體中文/)
  })
})

describe('/zh-reply', () => {
  test('turns it off and on for the session, and reports what it caught', async ($, on) => {
    const { submitted, settle } = world(on)

    const off = await $.command.run(command('zh-reply', 'off'))
    expect(off.text).toMatch(/已關閉/)
    const { sections } = await $.prompt.compose(COMPOSE)
    expect(sections.map(s => s.id)).not.toContain('zh-reply:language')
    await $.turn.complete(turnEnd(ENGLISH))
    await settle()
    expect(submitted).toHaveLength(0)

    const back = await $.command.run(command('zh-reply', 'on'))
    expect(back.text).toMatch(/已開啟/)
    await $.turn.complete(turnEnd(ENGLISH, { turnId: 't2' }))
    await settle()
    expect(submitted).toHaveLength(1)

    const status = await $.command.run(command('zh-reply', ''))
    expect(status.text).toMatch(/已開啟/)
    expect(status.text).toMatch(/攔到 1 次/)
  })
})
