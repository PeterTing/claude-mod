/** The last refused text per sender and recipient (`<sender>→<recipient>`), at most 20. */
export type ZhReplyRefused = Readonly<Record<string, string>>

declare module 'claude-code' {
  interface PluginState {
    'zh-reply': {
      /** `/zh-reply off` turned it off for this session. */
      isOff: boolean
      /** Replies and messages caught in another language this session. */
      caught: number
      /** The turn this plugin's rewrite prompt started; its answer is not judged again. */
      rewriteTurn: string | null
      /** The person's last prompt asked for another language or script, or a translation. */
      wantsOther: boolean
      /** remind mode: remind the model with the person's next prompt. */
      remindNext: boolean
      /** A rewrite was asked for since the person's last prompt; no other is until they write again. */
      awaitingPerson: boolean
      /** Agent messages sent back once, so an identical resend goes through. */
      refused: ZhReplyRefused
    }
  }
}
