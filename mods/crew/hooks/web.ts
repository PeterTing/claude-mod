/**
 * crew's web page, crew's side: the pane's own views drawn on elements of the
 * page's, plain data the page builds with DOM calls; the handlers of a drawing
 * kept for its presses; and the port a repo's page lives on.
 *
 * Everything here is pure: the server's life and the presses are register.tsx's.
 */
import type { Elements } from './views'

/** One node of a page's frame: a string, or an element by its kind with what it draws. */
export type WebNode =
  | string
  | { t: 'box'; p: Record<string, string | number | boolean>; c: WebNode[] }
  | { t: 'text'; p: Record<string, string | number | boolean>; c: WebNode[] }
  | { t: 'button'; k: string; label?: string; variant?: string; dim?: true; plain?: true; c?: WebNode[] }
  | { t: 'input'; k: string; label?: string; placeholder?: string; value?: string; submit?: string }
  | { t: 'select'; k: string; label?: string; value?: string; options: { value: string; label?: string }[] }
  | { t: 'link'; href: string; label?: string; c?: WebNode[] }

/** What a drawing's controls do, by key: a press, a field's Enter, a pick. */
export type WebHandlers = {
  press: Map<string, () => unknown>
  submit: Map<string, (value: string) => unknown>
  select: Map<string, (value: string) => unknown>
}

export const newHandlers = (): WebHandlers => ({ press: new Map(), submit: new Map(), select: new Map() })

/** A child as the page takes it: strings and numbers as text, nodes as they are; anything else (a stray engine element) as its text, if any. */
const childOf = (c: unknown): WebNode | undefined => {
  if (c === null || c === undefined || c === false || c === true) return undefined
  if (typeof c === 'string') return c
  if (typeof c === 'number') return String(c)
  if (typeof c === 'object' && typeof (c as { t?: unknown }).t === 'string') return c as WebNode
  return undefined
}

const kids = (children: unknown): WebNode[] => {
  const out: WebNode[] = []
  const walk = (c: unknown) => {
    if (Array.isArray(c)) c.forEach(walk)
    else {
      const n = childOf(c)
      if (n !== undefined) out.push(n)
    }
  }
  walk(children)
  return out
}

/** The layout a Box asks for, by the page's short names; anything else it carries is the engine's alone. */
const BOX_PROPS: Record<string, string> = {
  flexDirection: 'dir',
  flexWrap: 'wrap',
  gap: 'gap',
  columnGap: 'cg',
  rowGap: 'rg',
  paddingLeft: 'pl',
  paddingRight: 'pr',
  paddingX: 'px',
  marginBottom: 'mb',
  minWidth: 'minw',
  width: 'w',
  flexGrow: 'grow',
  flexShrink: 'shrink',
  borderStyle: 'border',
  borderColor: 'bc',
}

const TEXT_PROPS: Record<string, string> = {
  color: 'color',
  dimColor: 'dim',
  bold: 'bold',
  italic: 'italic',
  underline: 'underline',
  strikethrough: 'strike',
  wrap: 'wrap',
}

const picked = (props: Record<string, unknown>, names: Record<string, string>): Record<string, string | number | boolean> => {
  const out: Record<string, string | number | boolean> = {}
  for (const [from, to] of Object.entries(names)) {
    const v = props[from]
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[to] = v
  }
  // The page's own look (a card, a chip, a table row), which only the page's views ask for: words and spaces only.
  if (typeof props.cls === 'string' && /^[a-z0-9 -]{1,80}$/.test(props.cls)) out.cls = props.cls
  // How full a bar is, in percent.
  if (typeof props.pct === 'number' && Number.isFinite(props.pct)) out.pct = Math.max(0, Math.min(100, props.pct))
  return out
}

/**
 * The elements the pane's views draw with, made for the page: each returns
 * plain data, and each control's handler is kept by its key for the press
 * that comes back. A control without a key gets one by its place.
 */
export function webElements(handlers: WebHandlers): Required<Elements> {
  let auto = 0
  const keyOf = (props: Record<string, unknown>, kind: string): string => (typeof props.key === 'string' && props.key !== '' ? props.key : `auto-${kind}-${(auto += 1)}`)
  return {
    web: true,
    Box: (props: Record<string, unknown>): WebNode => ({ t: 'box', p: picked(props, BOX_PROPS), c: kids(props.children) }),
    Text: (props: Record<string, unknown>): WebNode => ({ t: 'text', p: picked(props, TEXT_PROPS), c: kids(props.children) }),
    Button: (props: Record<string, unknown>): WebNode => {
      const k = keyOf(props, 'button')
      if (typeof props.onPress === 'function') handlers.press.set(k, props.onPress as () => unknown)
      const c = kids(props.children)
      return {
        t: 'button',
        k,
        ...(typeof props.label === 'string' ? { label: props.label } : {}),
        ...(typeof props.variant === 'string' ? { variant: props.variant } : {}),
        ...(props.dimColor === true ? { dim: true as const } : {}),
        ...(props.plain === true ? { plain: true as const } : {}),
        ...(c.length > 0 ? { c } : {}),
      }
    },
    Input: (props: Record<string, unknown>): WebNode => {
      const k = keyOf(props, 'input')
      if (typeof props.onSubmit === 'function') handlers.submit.set(k, props.onSubmit as (v: string) => unknown)
      return {
        t: 'input',
        k,
        ...(typeof props.label === 'string' ? { label: props.label } : {}),
        ...(typeof props.placeholder === 'string' ? { placeholder: props.placeholder } : {}),
        ...(typeof props.value === 'string' ? { value: props.value } : {}),
        ...(typeof props.submitLabel === 'string' ? { submit: props.submitLabel } : {}),
      }
    },
    Select: (props: Record<string, unknown>): WebNode => {
      const k = keyOf(props, 'select')
      if (typeof props.onSelect === 'function') handlers.select.set(k, props.onSelect as (v: string) => unknown)
      const options = Array.isArray(props.options)
        ? (props.options as unknown[]).flatMap(o => {
            const opt = o as { value?: unknown; label?: unknown }
            return typeof opt?.value === 'string' ? [{ value: opt.value, ...(typeof opt.label === 'string' ? { label: opt.label } : {}) }] : []
          })
        : []
      return {
        t: 'select',
        k,
        options,
        ...(typeof props.label === 'string' ? { label: props.label } : {}),
        ...(typeof props.value === 'string' ? { value: props.value } : {}),
      }
    },
    Link: (props: Record<string, unknown>): WebNode => {
      const c = kids(props.children)
      return { t: 'link', href: typeof props.href === 'string' ? props.href : '', ...(typeof props.label === 'string' ? { label: props.label } : {}), ...(c.length > 0 ? { c } : {}) }
    },
  }
}

/**
 * A view's sections as the page draws them: each column of the view's own
 * column that has no look of its own becomes a card, a row (a bar of buttons)
 * and a line of words stay as they are.
 */
export function asCards(node: unknown): unknown {
  if (typeof node !== 'object' || node === null || (node as { t?: unknown }).t !== 'box') return node
  const b = node as { t: 'box'; p: Record<string, string | number | boolean>; c: WebNode[] }
  return {
    ...b,
    c: b.c.map(c =>
      typeof c === 'object' && c.t === 'box' && c.p.cls === undefined && (c.p.dir === 'column' || c.p.border !== undefined) ? { ...c, p: { ...c.p, cls: 'card' } } : c,
    ),
  }
}

/** The page's own nodes, for what it shows above the pane's views. */
export const webBox = (p: Record<string, string | number | boolean>, ...c: unknown[]): WebNode => ({ t: 'box', p, c: kids(c) })
export const webText = (p: Record<string, string | number | boolean>, ...c: unknown[]): WebNode => ({ t: 'text', p, c: kids(c) })

/** Ports crew's pages take: away from the common ones, one per repo by its path. */
export const WEB_PORT_FIRST = 7400
export const WEB_PORT_SPAN = 400

/** A repo's first port, by its path: the same repo gets the same one each time, so a page kept open finds it again. */
export function webPortOf(root: string): number {
  let h = 2166136261
  for (let i = 0; i < root.length; i += 1) {
    h ^= root.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return WEB_PORT_FIRST + (h % WEB_PORT_SPAN)
}

/** The port after a busy one, round within crew's span. */
export const nextWebPort = (port: number): number => WEB_PORT_FIRST + ((port - WEB_PORT_FIRST + 1) % WEB_PORT_SPAN)

/** A port crew's server may say it listens on: a whole number a user's program can take (1024–65535), so it goes into an address or a script as it is. */
export const validPort = (port: unknown): port is number => typeof port === 'number' && Number.isInteger(port) && port >= 1024 && port <= 65_535

/** A frame's text, as a short fingerprint: a page is sent a frame only when it changed. */
export function frameMark(text: string): string {
  let a = 2166136261
  let b = 5381
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 16777619) >>> 0
    b = (Math.imul(b, 33) + c) >>> 0
  }
  return `${text.length.toString(36)}.${a.toString(36)}.${b.toString(36)}`
}

/**
 * The files of crew's own folder a module imports for its code, by name
 * (`./board` is `board`): an import of types alone is gone once the module is
 * compiled, so Claude Code loads no file for it and a change to it reloads
 * nothing.
 */
export function importsOf(text: string): string[] {
  const names = new Set<string>()
  for (const m of text.matchAll(/^(?:import|export)\s+(?!type\s)[^'";]*?\bfrom\s+'\.\/([\w.-]+)'/gm)) if (m[1] !== undefined) names.add(m[1])
  for (const m of text.matchAll(/^import\s+'\.\/([\w.-]+)'/gm)) if (m[1] !== undefined) names.add(m[1])
  return [...names]
}

/** An import's name as a file of the folder: `board` is board.ts, else board.tsx; a name with its own ending is that file. */
export function importFile(name: string, files: ReadonlySet<string>): string | undefined {
  for (const file of [`${name}.ts`, `${name}.tsx`, name]) if (files.has(file)) return file
  return undefined
}

/**
 * crew's version as a frame's head carries it to the page: the version this
 * load runs and when it loaded, whether the files on disk moved on (`late`),
 * and what the load started again of the work it cut. A page sent a head with
 * no build, as a crew from before this one sends, shows its banner.
 */
export function buildHead(b: { id: string; at: number; redo: string }, late: boolean): { id: string; at: number; behind?: true; redo?: string } {
  return { id: b.id, at: b.at, ...(late && b.id !== '' ? { behind: true as const } : {}), ...(b.redo === '' ? {} : { redo: b.redo }) }
}

/** One line of the server's output, as crew reads it; anything else is not the server's. */
export type WebEvent =
  | { t: 'ready'; port: number; tailnet: boolean; push: string; key: string; secret?: string; cap?: string }
  | { t: 'key'; key: string }
  /** `go`: where a press on the pane sent the new tab (a word of go.ts), carried on its address. */
  | { t: 'hello'; client: string; tab: string; via: 'local' | 'tailnet'; go?: string }
  | { t: 'bye'; client: string }
  | { t: 'press'; client: string; key: string; kind: 'press' | 'submit' | 'select' | 'nav'; id: string; via: 'local' | 'tailnet'; value?: string; frame?: string }
  /** A decision from the decide page, in the words the page writes it (as a comment on claude.ai would hold it). */
  | { t: 'decide'; client: string; id: string; text: string; via: 'local' | 'tailnet' }
  | { t: 'error'; what: string; port?: number; detail?: string }
  | { t: 'tailnet_error'; detail?: string }
  | { t: 'log'; text: string }

const CLIENT_ID = /^[A-Za-z0-9-]{8,64}$/

/** The server's lines out of what its output pieces held, and what is left of a line not yet ended. */
export function webLines(held: string, text: string): { events: WebEvent[]; rest: string } {
  const all = held + text
  const parts = all.split('\n')
  const rest = parts.pop() ?? ''
  const events: WebEvent[] = []
  for (const line of parts) {
    if (line.trim() === '') continue
    let ev: unknown
    try {
      ev = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof ev !== 'object' || ev === null || typeof (ev as { t?: unknown }).t !== 'string') continue
    const e = ev as Record<string, unknown>
    // A start that names no port it could listen on is no start: said as the server's error, so crew says why and offers 重開網頁.
    if (e.t === 'ready' && !validPort(e.port)) {
      events.push({ t: 'error', what: 'ready' })
      continue
    }
    if ((e.t === 'hello' || e.t === 'bye' || e.t === 'press' || e.t === 'decide') && (typeof e.client !== 'string' || !CLIENT_ID.test(e.client))) continue
    if (e.t === 'decide' && (typeof e.id !== 'string' || !/^[A-Za-z0-9-]{1,40}$/.test(e.id) || typeof e.text !== 'string' || e.text.length > 12_000)) continue
    if (e.t === 'press' && (typeof e.key !== 'string' || typeof e.id !== 'string' || !['press', 'submit', 'select', 'nav'].includes(String(e.kind)))) continue
    // A place on a new tab's address the server let through, checked again: one that is not a word is dropped, the tab still comes.
    if (e.t === 'hello' && e.go !== undefined && (typeof e.go !== 'string' || !/^[A-Za-z0-9_.:@~-]{1,160}$/.test(e.go))) delete e.go
    events.push(ev as WebEvent)
  }
  // A line that never ends is the server's fault: past a megabyte it is dropped.
  return { events, rest: rest.length > 1_000_000 ? '' : rest }
}

/** What `tailscale status --json` says of this machine, as crew needs it. */
export type TailnetSelf = { ip: string; names: string[]; owner: string; https: boolean }

/**
 * Why `tailnetSelf` found no machine, in the person's words: Tailscale not
 * running (and what it says it is doing), no IPv4 address, or no account.
 */
export function tailnetWhy(status: unknown): string {
  if (typeof status !== 'object' || status === null) return 'Tailscale 的回應讀不懂。'
  const s = status as { BackendState?: unknown; Self?: unknown; User?: unknown }
  if (s.BackendState !== 'Running') {
    const state = typeof s.BackendState === 'string' && /^[A-Za-z]{1,32}$/.test(s.BackendState) ? s.BackendState : '不明'
    return state === 'NeedsLogin' ? 'Tailscale 還沒登入。' : state === 'Stopped' ? 'Tailscale 是關著的。' : `Tailscale 現在不是連線中（它說：${state}）。`
  }
  const self = s.Self as { TailscaleIPs?: unknown; UserID?: unknown } | undefined
  const ips = Array.isArray(self?.TailscaleIPs) ? (self.TailscaleIPs as unknown[]) : []
  if (!ips.some(x => typeof x === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(x))) return 'Tailscale 連上了，但沒有給這台 Mac IPv4 位址。'
  return 'Tailscale 連上了，但讀不到這台 Mac 登入的帳號。'
}

/** Text Tailscale or the system wrote, without what would say who or where: addresses, account names, machine names. */
export const maskNet = (text: string): string =>
  text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, '<帳號>')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<位址>')
    .replace(/\b[0-9a-f]{1,4}(?::[0-9a-f]{0,4}){2,7}\b/gi, '<位址>')
    .replace(/\b[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.ts\.net\b/gi, '<名稱>')

/** This machine on the tailnet: its IPv4 address, its MagicDNS name, the account logged in; undefined unless Tailscale runs. */
export function tailnetSelf(status: unknown): TailnetSelf | undefined {
  if (typeof status !== 'object' || status === null) return undefined
  const s = status as { BackendState?: unknown; Self?: unknown; User?: unknown; CertDomains?: unknown }
  if (s.BackendState !== 'Running') return undefined
  const self = s.Self as { TailscaleIPs?: unknown; DNSName?: unknown; UserID?: unknown } | undefined
  const ips = Array.isArray(self?.TailscaleIPs) ? (self.TailscaleIPs as unknown[]).filter((x): x is string => typeof x === 'string') : []
  const ip = ips.find(x => /^\d+\.\d+\.\d+\.\d+$/.test(x))
  if (ip === undefined) return undefined
  const users = (s.User ?? {}) as Record<string, { LoginName?: unknown }>
  const owner = users[String(self?.UserID)]?.LoginName
  if (typeof owner !== 'string' || owner === '') return undefined
  const dns = typeof self?.DNSName === 'string' ? self.DNSName.replace(/\.$/, '').toLowerCase() : ''
  return { ip, names: dns === '' ? [] : [dns], owner, https: Array.isArray(s.CertDomains) && s.CertDomains.length > 0 }
}
