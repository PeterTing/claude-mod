/**
 * The browser brought forward after a press on the pane moved crew's tabs on
 * this Mac: macOS brings the default browser forward by its bundle id
 * (`open -b`), which asks no permission and scripts no app. The browser shows
 * the tab it was on, which may not be crew's; every crew tab on this Mac has
 * moved by then, so whichever the person turns to is at the place pressed.
 *
 * The default browser is read from LaunchServices' own settings (read only),
 * and brought forward only while it runs: `open -b` would start one, with no
 * crew tab in it. Whatever goes wrong, crew's tabs have moved: the caller tells
 * the person where.
 *
 * Brought forward, the person is told nothing (the caller toasts only when it
 * was not), though the window may well show another tab: `open -b` cannot pick
 * a tab, and picking one would mean scripting the browser, which needs the
 * person's leave for all of it. Instead each page a press moved marks its own
 * title for a few seconds (web/app.js, markTitle), so crew's tab stands out in
 * the tab bar.
 */

/** A bundle id as `open -b` takes it: letters, digits, dots and dashes. */
const BUNDLE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,254}$/

/** How long each command here may take. */
const QUICK_MS = 5_000

/** What became of it: the browser brought forward by `open -b`, or not, and why in a few words (for the debug log). */
export type Front = { by: 'open' | 'none'; why: string }

/**
 * The default browser's bundle id, from LaunchServices' own settings (as
 * `plutil -convert json` writes them): the app that handles `http`, else
 * `https`. Nothing when they name none, as on a Mac never asked to change it.
 */
export function browserOf(settings: unknown): string | undefined {
  const handlers = (settings as { LSHandlers?: unknown } | null)?.LSHandlers
  if (!Array.isArray(handlers)) return undefined
  for (const scheme of ['http', 'https']) {
    const h = handlers.find(x => typeof x === 'object' && x !== null && (x as { LSHandlerURLScheme?: unknown }).LSHandlerURLScheme === scheme) as { LSHandlerRoleAll?: unknown; LSHandlerRoleViewer?: unknown } | undefined
    const id = h?.LSHandlerRoleAll ?? h?.LSHandlerRoleViewer
    if (typeof id === 'string' && BUNDLE.test(id)) return id
  }
  return undefined
}

/** One command's output, or why it gave none; its arguments go as a list, never through a shell. */
async function run($: any, argv: string[]): Promise<{ ok: true; out: string } | { ok: false; why: string }> {
  try {
    const r = await $.process.run(argv, { timeoutMs: QUICK_MS })
    return r.exitCode === 0 ? { ok: true, out: String(r.stdout ?? '') } : { ok: false, why: `exit ${r.exitCode}` }
  } catch (err) {
    return { ok: false, why: `failed ${String(err).slice(0, 80)}` }
  }
}

/** The default browser, read from LaunchServices' settings file (read only). */
async function defaultBrowser($: any): Promise<string | undefined> {
  const home = String((await $.env.get('HOME')) ?? '')
  if (!home.startsWith('/')) return undefined
  const r = await run($, ['/usr/bin/plutil', '-convert', 'json', '-o', '-', `${home}/Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist`])
  if (!r.ok) return undefined
  try {
    return browserOf(JSON.parse(r.out))
  } catch {
    return undefined
  }
}

/** Whether an app runs now, by its bundle id: macOS's own list says it, asking no permission. */
async function running($: any, app: string): Promise<boolean> {
  const r = await run($, ['/usr/bin/lsappinfo', 'find', `bundleid=${app}`])
  return r.ok && r.out.includes('ASN:')
}

/** The default browser brought forward by `open -b` while it runs; nothing else, and nothing asked of the person. */
export async function bringForward($: any): Promise<Front> {
  const app = await defaultBrowser($)
  if (app === undefined) return { by: 'none', why: 'no default browser' }
  if (!(await running($, app))) return { by: 'none', why: `${app} is not running` }
  const r = await run($, ['/usr/bin/open', '-b', app])
  return r.ok ? { by: 'open', why: app } : { by: 'none', why: `open: ${r.why}` }
}
