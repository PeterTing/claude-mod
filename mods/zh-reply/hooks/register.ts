import { atom, read, update } from 'claude-code'
import type { PromptOrigin, Register } from 'claude-code'

import type { ZhReplyRefused } from '../types'
import { asksForAnotherLanguage, judge } from './detect'
import type { Variant, Verdict } from './detect'

const PLUGIN = 'zh-reply'
const SECTION = 'zh-reply:language'
/** How many sender→recipient pairs the resend escape remembers. */
const REFUSED_MAX = 20

const isOff = atom({ plugin: 'zh-reply', key: 'isOff' } as const, false)
const caught = atom({ plugin: 'zh-reply', key: 'caught' } as const, 0)
const rewriteTurn = atom({ plugin: 'zh-reply', key: 'rewriteTurn' } as const, null as string | null)
const wantsOther = atom({ plugin: 'zh-reply', key: 'wantsOther' } as const, false)
const remindNext = atom({ plugin: 'zh-reply', key: 'remindNext' } as const, false)
const awaitingPerson = atom({ plugin: 'zh-reply', key: 'awaitingPerson' } as const, false)
const refused = atom({ plugin: 'zh-reply', key: 'refused' } as const, {} as ZhReplyRefused)

type Miss = Exclude<Verdict, { ok: true }>['reason']

type Texts = {
  rule: string
  spawn: string
  rewrite: (miss: Miss) => string
  refuse: (miss: Miss) => string
  remind: string
  toastRewrite: string
  toastRemind: string
  command: string
  status: (off: boolean, caught: number) => string
}

const TEXTS: Record<Variant, Texts> = {
  'zh-TW': {
    rule:
      'Language: Always reply to the user in Traditional Chinese (繁體中文, Taiwan usage). This includes progress updates, questions, summaries, and messages you send to other agents. Keep code, commands, file paths, identifiers, error messages and quoted text in their original language, and put a passage meant to stay in another language (a commit message, an English doc draft) in a code block. This rule covers what you say, not what you write into files: write file contents, code comments, commit messages and docs in the language the project already uses. Use another language only when the user explicitly asks for it.',
    spawn:
      '（請用繁體中文回覆，給其他 agent 的訊息也一樣；程式碼、指令、路徑和引用的原文維持原樣。寫進檔案的內容、程式註解、commit message 和文件，沿用專案原本的語言。）',
    rewrite: miss =>
      miss === 'simplified'
        ? '上一則回覆用了簡體字。請用繁體中文（台灣用語）把同樣的內容重新說一次；程式碼、指令、路徑和引用的原文維持原樣。'
        : '上一則回覆沒有用繁體中文。請用繁體中文把同樣的內容重新說一次；程式碼、指令、路徑和引用的原文維持原樣。',
    refuse: miss =>
      miss === 'simplified'
        ? '這則訊息用了簡體字，沒有送出。請改用繁體中文重寫後再送。'
        : '這則訊息不是繁體中文，沒有送出。請改用繁體中文重寫後再送；程式碼、指令和路徑維持原樣。',
    remind: '（zh-reply）上一則回覆沒有用繁體中文。請之後都用繁體中文回覆。',
    toastRewrite: 'zh-reply：回覆不是繁體中文，已請 Claude 重寫',
    toastRemind: 'zh-reply：回覆不是繁體中文，下一則訊息會提醒 Claude',
    command: '強制用繁體中文回覆：/zh-reply off 關閉、/zh-reply on 開啟',
    status: (off, n) =>
      `${off ? '已關閉' : '已開啟'}（繁體中文）。這個 session 攔到 ${n} 次不是中文的回覆或訊息。用 /zh-reply ${off ? 'on 開啟' : 'off 關閉'}。`,
  },
  'zh-CN': {
    rule:
      'Language: Always reply to the user in Simplified Chinese (简体中文). This includes progress updates, questions, summaries, and messages you send to other agents. Keep code, commands, file paths, identifiers, error messages and quoted text in their original language, and put a passage meant to stay in another language (a commit message, an English doc draft) in a code block. This rule covers what you say, not what you write into files: write file contents, code comments, commit messages and docs in the language the project already uses. Use another language only when the user explicitly asks for it.',
    spawn:
      '（请用简体中文回复，发给其他 agent 的消息也一样；代码、命令、路径和引用的原文保持原样。写进文件的内容、代码注释、commit message 和文档，沿用项目原本的语言。）',
    rewrite: miss =>
      miss === 'traditional'
        ? '上一条回复用了繁体字。请用简体中文把同样的内容重新说一遍；代码、命令、路径和引用的原文保持原样。'
        : '上一条回复没有用简体中文。请用简体中文把同样的内容重新说一遍；代码、命令、路径和引用的原文保持原样。',
    refuse: miss =>
      miss === 'traditional'
        ? '这条消息用了繁体字，没有发出。请改用简体中文重写后再发。'
        : '这条消息不是简体中文，没有发出。请改用简体中文重写后再发；代码、命令和路径保持原样。',
    remind: '（zh-reply）上一条回复没有用简体中文。请之后都用简体中文回复。',
    toastRewrite: 'zh-reply：回复不是简体中文，已请 Claude 重写',
    toastRemind: 'zh-reply：回复不是简体中文，下一条消息会提醒 Claude',
    command: '强制用简体中文回复：/zh-reply off 关闭、/zh-reply on 开启',
    status: (off, n) =>
      `${off ? '已关闭' : '已开启'}（简体中文）。这个 session 拦到 ${n} 次不是中文的回复或消息。用 /zh-reply ${off ? 'on 开启' : 'off 关闭'}。`,
  },
}

/** Every rewrite prompt this plugin can send, to know the turn it starts. */
const REWRITES = (['zh-TW', 'zh-CN'] as const).flatMap(v =>
  (['not-chinese', 'simplified', 'traditional'] as const).map(miss => TEXTS[v].rewrite(miss)),
)

/** A prompt the person typed, or one another plugin sent in their name. */
const isPerson = (origin: PromptOrigin): boolean => {
  switch (origin.kind) {
    case 'composer':
    case 'bridge':
    case 'sdk':
    case 'channel':
    case 'slack-ping':
    case 'scheduled-trigger':
      return true
    case 'plugin':
      return origin.name !== PLUGIN && origin.asUser === true
    default:
      return false
  }
}

export const register: Register = (on, options) => {
  const variant: Variant = options.variant === 'zh-CN' ? 'zh-CN' : 'zh-TW'
  const isRemindMode = options.enforce === 'remind'
  const isMainOnly = options.scope === 'main'
  const text = TEXTS[variant]

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'zh-reply', description: text.command })
    return next(e)
  })

  on('command.run', { command: 'zh-reply' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off' || arg === 'on') {
      await update($, isOff, () => arg === 'off')
    }
    return { text: text.status(await read($, isOff), await read($, caught)) }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if ((isMainOnly && e.traits.includes('teammate')) || (await read($, isOff))) return composed
    return { sections: [...composed.sections, { id: SECTION, text: text.rule, scope: 'session' as const }] }
  })

  on('agent.spawn', async ($, e, next) => {
    const isOthers = next.origin.plugin !== 'engine'
    // A workflow's or a resumed agent's task cannot be rewritten.
    const isFixed = e.workflow !== undefined || e.resume !== undefined
    if (isMainOnly || isOthers || isFixed || (await read($, isOff))) return next(e)
    return next({ ...e, prompt: `${e.prompt}\n\n${text.spawn}` })
  })

  on('session.send', async ($, e, next) => {
    const isAgent = e.agentId !== undefined
    if ((isMainOnly && isAgent) || e.origin.kind === 'plugin' || (await read($, isOff))) return next(e)
    const verdict = judge(e.text, variant)
    if (verdict.ok) return next(e)

    const key = `${e.agentId ?? 'main'}→${e.to}`
    if ((await read($, refused))[key] === e.text) {
      await update($, refused, ({ [key]: _, ...rest }) => rest)
      return next(e)
    }
    await update($, refused, all => {
      const kept = Object.entries(all).filter(([k]) => k !== key).slice(-(REFUSED_MAX - 1))
      return { ...Object.fromEntries(kept), [key]: e.text }
    })
    await update($, caught, n => n + 1)
    return { isDelivered: false as const, reason: text.refuse(verdict.reason) }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.isMeta || !isPerson(e.origin)) {
      const isOwn = e.origin.kind === 'plugin' && e.origin.name === PLUGIN
      // A turn the person did not start (a finished task, an agent's message) is checked as usual.
      if (e.turnId === undefined && !isOwn) {
        await update($, wantsOther, () => false)
      }
      return next(e)
    }
    await update($, awaitingPerson, () => false)
    // A slash command's text is its whole line, arguments included.
    const asked = asksForAnotherLanguage(e.text, variant)
    // A prompt typed while a turn runs keeps that turn's request unless it makes its own.
    if (asked || e.turnId === undefined) {
      await update($, wantsOther, () => asked)
    }
    if (e.command !== undefined || asked || !(await read($, remindNext)) || (await read($, isOff))) {
      return next(e)
    }
    await update($, remindNext, () => false)
    return next({ ...e, context: [...(e.context ?? []), text.remind] })
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined && REWRITES.some(rewrite => e.text.includes(rewrite))) {
      await update($, rewriteTurn, () => e.turnId)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    if (e.turnId === (await read($, rewriteTurn))) {
      await update($, rewriteTurn, () => null)
      return next(e)
    }
    if (e.reason !== 'answer' || (await read($, wantsOther)) || (await read($, isOff))) return next(e)

    const verdict = judge(e.answer, variant)
    if (verdict.ok) return next(e)

    await update($, caught, n => n + 1)
    if (isRemindMode) {
      await update($, remindNext, () => true)
      $.ui.toast(text.toastRemind)
      return next(e)
    }
    // At most one rewrite for each prompt of the person's, whatever becomes of its text.
    if (await read($, awaitingPerson)) return next(e)
    await update($, awaitingPerson, () => true)
    // Not awaited: the prompt starts its own turn only once this one has ended.
    // turn.start marks that turn so its answer is not counted again.
    $.prompt.submit({ text: text.rewrite(verdict.reason) }).catch(() => undefined)
    $.ui.toast(text.toastRewrite)
    return next(e)
  })
}
