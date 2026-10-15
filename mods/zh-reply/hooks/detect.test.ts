import { describe, expect, test } from 'claude-code/testing'

import { asksForAnotherLanguage, count, judge, prose } from './detect'

const CHINESE_OK = { ok: true, reason: 'chinese' }

describe('judge, zh-TW', () => {
  test('passes Traditional Chinese', () => {
    expect(judge('已經修好登入的問題，也補上測試，全部通過。', 'zh-TW')).toEqual(CHINESE_OK)
  })

  test('passes Chinese full of technical terms', () => {
    const text = '我把 useState 換成 useReducer，因為 state 太多，也補了 unit test 和 e2e test，CI 已經過了。'
    expect(judge(text, 'zh-TW')).toEqual(CHINESE_OK)
  })

  test('passes Chinese whose English is all in code, links, paths and quotes', () => {
    const text = [
      '原因在這裡：',
      '```ts',
      'export function login(user: User): Promise<Session> { return api.post("/login", user) }',
      '```',
      '> Error: Cannot read properties of undefined (reading "token") at Session.refresh',
      '請看 `src/auth/session.ts` 和 https://example.com/docs/auth/refresh-tokens-explained 的說明。',
    ].join('\n')
    expect(judge(text, 'zh-TW')).toEqual(CHINESE_OK)
  })

  test('passes a Chinese reply that lists changed files', () => {
    const text = '完成。\n\n變更檔案：\n- src/components/LoginForm.tsx\n- src/hooks/useSession.ts\n- src/api/auth.ts\n- tests/auth/session.test.ts'
    expect(judge(text, 'zh-TW')).toEqual(CHINESE_OK)
  })

  test('passes a Chinese reply with commands, flags and config keys', () => {
    const text = '請執行 npm run build && npm run test -- --coverage，再把 --max-old-space-size 調大，或在 vite.config.ts 設 build.chunkSizeWarningLimit。'
    expect(judge(text, 'zh-TW')).toEqual(CHINESE_OK)
  })

  test('passes a Chinese status table with English status words', () => {
    const text = '| 項目 | 狀態 |\n| --- | --- |\n| 登入流程 | Verified |\n| 匯出報表 | Not covered |\n| 金流設定 | Risk |'
    expect(judge(text, 'zh-TW')).toEqual(CHINESE_OK)
  })

  test('passes a Chinese explanation that lists English test names', () => {
    const text = [
      '以下 3 個測試失敗，原因是 token 過期時沒有重新整理：',
      '- should refresh the token when it expires',
      '- returns 401 for an invalid session',
      '- logs out the user after timeout',
    ].join('\n')
    expect(judge(text, 'zh-TW')).toEqual(CHINESE_OK)
  })

  test('flags an English reply', () => {
    const text = 'I fixed the login bug and added tests for the edge cases. Everything passes now.'
    expect(judge(text, 'zh-TW')).toEqual({ ok: false, reason: 'not-chinese' })
  })

  test('flags an English reply that names files', () => {
    const text = 'I updated src/auth/session.ts and the tests now pass for the edge cases.'
    expect(judge(text, 'zh-TW')).toEqual({ ok: false, reason: 'not-chinese' })
  })

  test('flags English with a Chinese word or two', () => {
    const text = 'I fixed the 登入 bug in the auth module and added tests for the edge cases.'
    expect(judge(text, 'zh-TW')).toEqual({ ok: false, reason: 'not-chinese' })
  })

  test('flags terse English with no function words once it is long enough', () => {
    const text = 'Done. Changes: refactored auth module, updated tests, fixed lint errors, bumped deps.'
    expect(judge(text, 'zh-TW')).toEqual({ ok: false, reason: 'not-chinese' })
  })

  test('flags six English words when one is a function word', () => {
    expect(judge('Fixed the bug in auth module', 'zh-TW')).toEqual({ ok: false, reason: 'not-chinese' })
    expect(judge('Refactored auth module, updated tests, fixed lint.', 'zh-TW')).toEqual({ ok: true, reason: 'too-short' })
  })

  test('lets a short English reply through', () => {
    expect(judge('Done. All tests pass.', 'zh-TW')).toEqual({ ok: true, reason: 'too-short' })
    expect(judge('', 'zh-TW')).toEqual({ ok: true, reason: 'too-short' })
  })

  test('lets a reply that is only code through', () => {
    const text = '```sh\nnpm install --save-dev typescript eslint prettier vitest @types/node\n```'
    expect(judge(text, 'zh-TW')).toEqual({ ok: true, reason: 'too-short' })
  })

  test('flags Simplified Chinese', () => {
    expect(judge('这个问题已经修好了，我们还没有测试，等一下会补上。', 'zh-TW')).toEqual({ ok: false, reason: 'simplified' })
  })

  test('flags Japanese', () => {
    expect(judge('このバグを修正しました。テストも追加しました。', 'zh-TW')).toEqual({ ok: false, reason: 'not-chinese' })
  })

  test('flags Korean', () => {
    expect(judge('로그인 버그를 수정했고 테스트도 추가했습니다.', 'zh-TW')).toEqual({ ok: false, reason: 'not-chinese' })
  })
})

describe('judge, zh-CN', () => {
  test('passes Simplified Chinese', () => {
    expect(judge('这个问题已经修好了，我们还没有测试，等一下会补上。', 'zh-CN')).toEqual(CHINESE_OK)
  })

  test('flags Traditional Chinese', () => {
    expect(judge('這個問題已經修好了，我們還沒有測試，等一下會補上。', 'zh-CN')).toEqual({ ok: false, reason: 'traditional' })
  })
})

describe('count', () => {
  test('counts plain English words and leaves out code-like tokens', () => {
    const c = count('Run (the) **build** in src/app.ts with --watch, useState and e2e; I think it is fine.')
    // Run the build in with and I think it is fine: 11 words, 7 of them function words
    expect(c.words).toBe(11)
    expect(c.functionWords).toBe(7)
  })
})

describe('prose', () => {
  test('drops code, inline code, links, paths, quotes and tags', () => {
    const text = 'a `b` c\n```\nd\n```\n> e\n[f](https://g.example/h) /usr/local/bin <i>j</i>'
    expect(prose(text).replace(/\s+/g, ' ').trim()).toBe('a c [f] j')
  })
})

describe('asksForAnotherLanguage, zh-TW', () => {
  const asks = (text: string) => asksForAnotherLanguage(text, 'zh-TW')

  test('sees a request to reply in another language', () => {
    for (const text of [
      '請用英文回答',
      '請用英文',
      '請用英文，謝謝',
      '用英文寫一段 release note',
      '幫我寫成日文',
      '英文回答就好',
      '英文就好',
      '給我英文版',
      '請講英文',
      '英文說明一下',
      '請以英文撰寫',
      '寫一封英文 email 給客戶',
      '沒問題，不過請用英文回答',
      'reply in English please',
      'English please',
      'Please use English',
      'write me an English summary',
      'Can you answer in Japanese?',
    ]) {
      expect(asks(text)).toBe(true)
    }
  })

  test('sees a request to reply in Simplified Chinese', () => {
    for (const text of ['請用簡體中文回答', '用简体中文写给大陆同事', '改用簡體', '請以簡體中文回答', '簡體中文回覆', 'reply in Simplified Chinese']) {
      expect(asks(text)).toBe(true)
    }
  })

  test('keeps checking a request for Traditional Chinese or plain Chinese', () => {
    for (const text of [
      '請用繁體中文回答',
      '用繁體中文解釋這段 code',
      '請用繁體中文回答，不要用簡體',
      '請改用繁體中文',
      'write it in Traditional Chinese',
      'Please answer in Chinese',
      'explain this in Chinese',
      '把這段英文翻譯成中文',
      '把這段翻譯成繁體中文',
    ]) {
      expect(asks(text)).toBe(false)
    }
  })

  test('sees a translation into another language', () => {
    for (const text of ['把這段翻譯成英文', 'Translate this into Japanese', '把登入頁的 UI 文案翻譯成簡體中文', 'translate the strings to Simplified Chinese']) {
      expect(asks(text)).toBe(true)
    }
  })

  test('ignores a negated request', () => {
    for (const text of ['不要用英文回答', '請不要用英文', '不用英文', '不用英文回答', '別再用英文了', "don't reply in English"]) {
      expect(asks(text)).toBe(false)
    }
  })

  test('ignores a prompt that only mentions a language or script', () => {
    for (const text of [
      'README 是英文的，不用改',
      '以英文為主的 README 要更新',
      '修好這個 bug',
      'why is the English README out of date?',
      'fix the translation loader bug',
      'the Simplified Chinese docs are wrong',
      '改成英文變數名稱',
      'why is this error message in English?',
      'the README is written in English',
      '這個字的簡體寫法是什麼？',
      '找出專案裡用簡體字的檔案',
      '把用簡體寫的註解改成繁體',
      'README 的簡體說明要更新',
      '為什麼 i18n 檔用簡體？',
      '檢查 locales 裡有沒有用簡體的字串',
      '這個 PR 把繁體說明拿掉了',
      '這份文件是英文寫的，幫我摘要',
      '英文寫的 log 看不懂，幫我解釋',
    ]) {
      expect(asks(text)).toBe(false)
    }
  })
})

describe('asksForAnotherLanguage, zh-CN', () => {
  const asks = (text: string) => asksForAnotherLanguage(text, 'zh-CN')

  test('sees a request for Traditional Chinese or another language', () => {
    for (const text of ['請用繁體中文回答', 'reply in Traditional Chinese', '翻译成繁体中文', '请用英文回答']) {
      expect(asks(text)).toBe(true)
    }
  })

  test('keeps checking a request for Simplified Chinese or plain Chinese', () => {
    for (const text of ['请用简体中文回答', 'reply in Simplified Chinese', 'explain this in Chinese', '繁体说明要更新']) {
      expect(asks(text)).toBe(false)
    }
  })
})
