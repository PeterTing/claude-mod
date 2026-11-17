/**
 * crew publishing a PRD's decide page itself with the Artifact tool, rather
 * than asking the brain to: the call it makes, how a permission check is
 * matched to that call and nothing else, what the tool answered, and when a
 * refused update may go again. The person chose this (2026-11-03): crew lets
 * through only its own page. Pure.
 */

/** The fixed words of a new page: who it is for and what it holds. */
const DESCRIPTION = '這個 PRD 等你決定的事和進度：PRD 草稿、設計稿、角色的問題，以及開發進度圖。'

/** The Artifact call that publishes the page: its shell, the files that changed, and the page's link once it has one. */
export type PublishInput = {
  action: 'publish'
  file_path: string
  files?: Record<string, string>
  url?: string
  capabilities?: { comments: Record<string, never> }
  icon?: string
  description?: string
}

/** The call for a page: a new one declares comments (the person decides through them), an icon and a line; an update names its link. */
export const publishInput = (dir: string, files: readonly string[], url: string | undefined): PublishInput => ({
  action: 'publish',
  file_path: `${dir}/index.html`,
  ...(files.length === 0 ? {} : { files: Object.fromEntries(files.map(f => [f, `${dir}/${f}`])) }),
  ...(url === undefined ? { capabilities: { comments: {} }, icon: 'checklist', description: DESCRIPTION } : { url }),
})

/** A call's fields in one order, so the same call reads the same however its keys were laid out. */
export const callKey = (input: unknown): string => {
  const sorted = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sorted)
      : typeof v === 'object' && v !== null
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map(k => [k, sorted((v as Record<string, unknown>)[k])]),
          )
        : v
  return JSON.stringify(sorted(input))
}

/** The paths a publish call sends: the page and each file beside it. */
export const pathsOf = (input: unknown): string[] => {
  const v = input as { file_path?: unknown; files?: unknown } | null
  if (typeof v !== 'object' || v === null || typeof v.file_path !== 'string') return []
  const files = typeof v.files === 'object' && v.files !== null ? Object.values(v.files as Record<string, unknown>) : []
  return [v.file_path, ...files.map(f => (typeof f === 'string' ? f : typeof f === 'object' && f !== null && typeof (f as { from?: unknown }).from === 'string' ? (f as { from: string }).from : ''))]
}

/** The page's link and version from the tool's answer, or why it was not published. */
export type Published = { url: string; version?: string } | { failed: string }

const ARTIFACT = /https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9_-]+/

type Answer = { deny?: unknown; isError?: unknown; text?: unknown; result?: unknown }

/** Why the tool did not do what it was asked, or nothing when it did: for a read as for a publish. */
export const refusedOf = (answer: unknown): string | undefined => {
  const a = answer as Answer | null
  if (typeof a !== 'object' || a === null) return 'Artifact 工具沒有回應'
  const text = typeof a.text === 'string' ? a.text : ''
  if (a.deny !== undefined) return `被擋下：${typeof a.deny === 'string' ? a.deny : '權限不允許'}`
  if (a.isError === true) return text === '' ? 'Artifact 工具回報錯誤' : text
  return undefined
}

/** The version a file listing names as live, or nothing where it names none. */
export const listedVersion = (answer: unknown): string | undefined => {
  const v = (answer as { result?: { file_list?: { ver?: unknown } } } | null)?.result?.file_list?.ver
  return typeof v === 'string' && v !== '' ? v : undefined
}

/**
 * Whether a refused update may go again unchanged. After Claude Code starts
 * again the tool takes an update only once the session has seen the live page:
 * it says so when the live page is the one sent ("publish again and it goes
 * through"), and otherwise hands over the difference and asks for the same
 * content twice more. crew sends it again then only when the live version is
 * the one crew published last (`own`): nobody else's work is on it to keep.
 * Two publishes at once (crew reloaded while one was under way) leave one with
 * a write conflict, which the tool says to retry.
 */
export const resendable = (failed: string, own: boolean): boolean =>
  /publish again and it goes through|\[write_conflict\]/.test(failed) || lookupOf(failed) || (own && /hadn't viewed the live version|publish it again unchanged/.test(failed))

/** Whether the tool says a page's link is gone for this account: deleted, or another account's (Claude Code signed in to another one). */
export const goneOf = (failed: string): boolean => /artifact not found|artifact-deleted|was deleted, or you no longer have write access|dropped its link/.test(failed)

/** Whether auto mode's reviewer could not look the page up and asks for the same call once more: no word on the page itself. */
export const lookupOf = (failed: string): boolean => /Repeat the identical Artifact call once/.test(failed)

/** Whether the tool held an update back only because the live page is not one this session saw: someone who reads what differs can still publish it. */
export const unseenOf = (failed: string): boolean => /hadn't viewed the live version|haven't viewed the latest version|identical content already refused/.test(failed)

export const publishedOf = (answer: unknown): Published => {
  const refused = refusedOf(answer)
  if (refused !== undefined) return { failed: refused }
  const a = answer as Answer
  const text = typeof a.text === 'string' ? a.text : ''
  const r = a.result as { url?: unknown; version?: unknown } | undefined
  const url = typeof r?.url === 'string' && ARTIFACT.test(r.url) ? r.url : ARTIFACT.exec(text)?.[0]
  if (url === undefined) return { failed: text === '' ? 'Artifact 工具沒有回連結' : `Artifact 工具沒有回連結：${text.slice(0, 200)}` }
  return { url, ...(typeof r?.version === 'string' ? { version: r.version } : {}) }
}
