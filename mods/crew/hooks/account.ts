/**
 * Which Claude account Claude Code is signed in to, as crew tells one from
 * another: a hash of the account and organization ids in the login record,
 * nothing else. The record holds other settings too (MCP servers' among
 * them): crew takes the two ids and keeps, shows and sends none of the rest.
 * Pure but for the hash.
 */

/** The account's ids in the login record's text, or 'none' when it is signed in without an account (an API key); undefined when unreadable. */
export const accountIdsOf = (text: string): string | undefined => {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    // Never the parser's words: they may quote the file.
    return undefined
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined
  const account = (data as { oauthAccount?: unknown }).oauthAccount
  if (typeof account !== 'object' || account === null) return 'none'
  const { accountUuid, organizationUuid } = account as { accountUuid?: unknown; organizationUuid?: unknown }
  if (typeof accountUuid !== 'string' || accountUuid === '') return 'none'
  return `${accountUuid}|${typeof organizationUuid === 'string' ? organizationUuid : ''}`
}

/** The account as crew keeps it: 16 hex digits of a SHA-256 of its ids. */
export async function accountHash(text: string): Promise<string | undefined> {
  const ids = accountIdsOf(text)
  if (ids === undefined) return undefined
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`crew-account:${ids}`))
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Where Claude Code keeps the login record: in its config folder when one is set, else beside the home folder's .claude. */
export const loginRecordOf = (configDir: string | undefined, home: string | undefined): string | undefined =>
  configDir !== undefined && configDir !== '' ? `${configDir}/.claude.json` : home !== undefined && home !== '' ? `${home}/.claude.json` : undefined

/** Where the plugins' stores are: under Claude Code's config folder. */
export const storesOf = (configDir: string | undefined, home: string | undefined): string | undefined =>
  configDir !== undefined && configDir !== '' ? `${configDir}/plugins/store` : home !== undefined && home !== '' ? `${home}/.claude/plugins/store` : undefined
