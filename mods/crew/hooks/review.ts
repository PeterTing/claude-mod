/**
 * The person's decide page for a PRD: one artifact crew (or the brain)
 * publishes, holding what waits for the person on that PRD. Its draft to
 * confirm, its designs to approve or send back (a clickable mockup for each
 * screen, the text of each without one) and the roles' questions to answer;
 * once the PRD is under way, its progress map and its requirements, each
 * with the station it is on. The person decides on the page, which says so
 * in a comment the brain passes on to crew. The page itself is a fixed
 * shell: what it shows is read from the files beside it, so an update sends
 * only the data that changed. A mockup is a role's HTML: it runs in a
 * sandboxed frame of its own, with no way to the page or to the person's
 * comments. Pure.
 */

import type { PageProgress } from './progress'

export type ReviewDesign = {
  id: string
  title: string
  feature: string
  featureTitle: string
  kind: 'screen' | 'none'
  body: string
  /** waiting: the person's to decide; drawing: a screen whose mockup the designer has not made yet. */
  state: 'waiting' | 'drawing' | 'approved' | 'rejected'
  reason?: string
  /** The mockup's version and the file it is published as, for a screen that has one. */
  version?: number
  file?: string
  /** A screen whose mockup file does not match the version the board names: it can be sent back, not approved. */
  broken?: true
  /** The design as it stands, which a decision names: one made on another version is refused. */
  code: string
  /** On crew's web page: the mockup file as it lies, so marks added to an approved mockup are read again without reloading the page. */
  stamp?: string
}

/** A role's question to the person, as the page shows it: what it is about, and the choices the role gave. */
export type PageQuestion = {
  id: string
  /** Who asked, as the person knows them. */
  from: string
  question: string
  item?: string
  itemTitle?: string
  options?: readonly string[]
  /** A picture the role drew, shown in a sandboxed frame of its own, and what it shows. */
  picture?: { html: string; caption?: string }
  /** The numbers the question names, written out by crew. */
  mentions?: readonly { id: string; kind: string; text: string }[]
  at: string
  state: 'open' | 'answered'
  answer?: string
  /** The question as it was asked, which an answer names: one on a question asked again under the same number is refused. */
  code: string
  /** The brain filled it in on the draft itself: it is shown with the draft, and the draft's yes waits for it. */
  draft?: true
}

/** The brain's draft PRD as the page shows it: the reviews, and whether it waits for the person's yes. */
export type PageDraft = {
  path: string
  title: string
  requirements: number
  /** reviewing: PM and UI/UX are at it; confirm: the person's to confirm or change; changing: the brain changes it as the person asked. */
  state: 'reviewing' | 'confirm' | 'changing'
  reviews: readonly { who: string; found: string }[]
  note?: string
  change?: string
  /** The file the draft's text is in, beside the page. */
  file: string
  /** The draft as the person read it: a yes on a draft changed since is refused. */
  code: string
}

/** Where QA saw a thing on a screenshot of its own, in the page's pixels. */
export type PageBox = { x: number; y: number; width: number; height: number }

/** One thing for the person to look at on a feature handed to them: on the screen, or in what its API answers. */
export type PageAcceptItem = {
  criterion: string
  /** The criterion's words, written out by crew. */
  criterionText?: string
  ask: string
  /** What QA saw. */
  saw?: string
  /** How to get there and try it, when QA did not operate the app. */
  how?: string
  desktop?: { file: string; box?: PageBox }
  phone?: { file: string; box?: PageBox }
  api?: { request: string; response: string; lit: readonly string[] }
}

/**
 * A feature handed to the person to accept: what QA checked and how, the
 * things to look at, the approved screens to see them on, what they said last
 * time and what changed since, and how to open it themselves.
 */
export type PageAccept = {
  feature: string
  title: string
  /** waiting: theirs to look at; again: back after their changes; fixing: the tech lead and builders at their changes; passed: they passed it. */
  state: 'waiting' | 'again' | 'fixing' | 'passed'
  round: number
  /** `unset`: no start command or URL in 設定, so the card says how to set them up. */
  /** `unseen`: QA ran and confirmed none of the feature's test cases in the app, none of them left set to QA in the app; `why` says why. */
  qa: { app: boolean; why?: string; unset?: boolean; unseen?: boolean; cases?: { passed: number; total: number }; errors?: number }
  items: readonly PageAcceptItem[]
  screens: readonly { id: string; title: string; file: string }[]
  said?: string
  note?: string
  /** What the PM said of the person's words the tech lead took to it (data). */
  pm?: string
  changed?: readonly string[]
  /** `worktree` is shown from the project root; `worktreeAt` is its full path, which the copy button gives. */
  open?: { url?: string; accounts?: string; start?: string; worktree?: string; worktreeAt?: string }
  /** Where the feature is in the app, as QA found it: the page's address in the app, the way there from its menu, or why it has no page. */
  where?: { page?: string; menu?: string; none?: string }
  /**
   * The test cases the person set to confirm themselves when they accept the
   * feature: what to look at (its steps and what it should show), ticked by
   * them before 通過. `ticked`: confirmed when they passed it.
   */
  confirm?: readonly { id: string; title: string; steps: readonly string[]; expected: string; ticked?: true }[]
  /** The card as the person saw it: a decision on another round or state is refused. */
  code: string
}

/**
 * What the page shows, kept in data.json beside it: with the PRD under way and
 * its tasks planned, its progress map. `view`: the person chose to decide in
 * the pane, and the page is theirs to read, with no way to decide on it.
 */
export type PageData = { prd: string; at: string; draft?: PageDraft; designs: readonly ReviewDesign[]; questions: readonly PageQuestion[]; progress?: PageProgress; accept?: readonly PageAccept[]; view?: true }

/** The first words of each comment the page sends: what crew looks for. */
export const PAGE_HEADS = ['crew 設計稿決定', 'crew 回答', 'crew PRD 確認', 'crew PRD 要改', 'crew 驗收'] as const

/** How a comment begins that asks the brain about a question rather than answers it: the brain answers it there itself. */
export const ASK_HEAD = 'crew 提問'

/** The longest reason the page sends a design back with. */
export const REASON_MAX = 500

/** The longest answer, and the longest change to the draft, the page sends. */
export const ANSWER_MAX = 500
export const CHANGE_MAX = 2000

/** The most test cases the person's ticks on a 待你驗收 card are read for: the same hard cap as QA's report of a feature's cases. */
export const TICKS_MAX = 1000

export type PageMessage =
  | { kind: 'design'; id: string; verdict: 'approved' | 'rejected'; reason: string; code: string }
  | { kind: 'answer'; id: string; answer: string; code: string }
  | { kind: 'confirm'; rest: string; code: string }
  | { kind: 'change'; rest: string; code: string }
  /** `ticks`: the test cases the person ticked to confirm on the card as they passed it. */
  | { kind: 'accept'; id: string; verdict: 'passed' | 'changes'; said: string; code: string; ticks: readonly string[] }

/** A comment as the page wrote it, read back; why not, when it is not one. A brain may join its lines with spaces. */
export const parsePage = (comment: string): PageMessage | string => {
  const text = comment.trim()
  // The page ends the comment with the code: words the person wrote that name a code of their own do not stand in for it.
  const tail = /\s代碼 ([0-9a-f]{6})$/.exec(text)
  const design = /^crew 設計稿決定：(核准|退回) (SCR-\d+)/.exec(text)
  const answer = /^crew 回答：(Q-\d+)(?=\s)/.exec(text)
  const confirm = /^crew PRD 確認：開始\s/.exec(text)
  const change = /^crew PRD 要改：/.exec(text)
  const accept = /^crew 驗收：(通過|要改) ([A-Za-z][A-Za-z0-9_]*-\d+)(?=\s|$)/.exec(text)
  if (text.startsWith(`${ASK_HEAD}：`)) return '這則是使用者問你的問題，不是決定：直接在那則留言下用白話回答，不要轉給 crew；那一題還等他回答'
  if (design === null && answer === null && confirm === null && change === null && accept === null) return `這則留言不是 crew 待你決定頁送出的（開頭要是 ${PAGE_HEADS.map(h => `「${h}」`).join('、')}）`
  if (tail === null) return '少了代碼，請在待你決定頁重新按一次'
  const code = tail[1] ?? ''
  const body = (head: RegExpExecArray): string => text.slice(head[0].length, tail.index).trim()
  if (design !== null) {
    const verdict = design[1] === '核准' ? 'approved' : 'rejected'
    const reason = verdict === 'rejected' ? (/原因：([\s\S]*)$/.exec(body(design))?.[1] ?? '').trim().slice(0, REASON_MAX) : ''
    if (verdict === 'rejected' && reason === '') return '退回要有原因'
    return { kind: 'design', id: design[2] ?? '', verdict, reason, code }
  }
  if (answer !== null) {
    const said = body(answer).slice(0, ANSWER_MAX).trim()
    if (said === '') return '回答是空的'
    return { kind: 'answer', id: answer[1] ?? '', answer: said, code }
  }
  if (accept !== null) {
    const verdict = accept[1] === '通過' ? 'passed' : 'changes'
    const said = verdict === 'changes' ? (/原話：([\s\S]*)$/.exec(body(accept))?.[1] ?? '').trim().slice(0, CHANGE_MAX) : ''
    if (verdict === 'changes' && said === '') return '要改要寫出改什麼'
    // What the person ticked to confirm, as the page lists it on the line after 通過.
    const ticked = verdict === 'passed' ? (/(?:^|\s)確認：([A-Za-z0-9_、, -]*)$/.exec(body(accept))?.[1] ?? '') : ''
    // Every one is kept up to TICKS_MAX: crew passes the feature only when each case set to 你驗收時確認 is ticked, and a
    // cap under that count would leave some never ticked.
    const ticks = [...new Set(ticked.match(/[A-Za-z][A-Za-z0-9_]*-\d+/g) ?? [])].slice(0, TICKS_MAX)
    return { kind: 'accept', id: accept[2] ?? '', verdict, said, code, ticks }
  }
  if (confirm !== null) return { kind: 'confirm', rest: body(confirm), code }
  return { kind: 'change', rest: body(change as RegExpExecArray), code }
}

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const STYLE = String.raw`<style>
/* Layout: tabs over what waits; the open design's mockup is the one large framed object. */
:root {
  --bg: #f6f7f9; --surface: #ffffff; --ink: #1b2230; --ink-2: #566074; --line: #dde1e8;
  --accent: #2f5fd0; --accent-soft: #e6edfb; --warn: #a15c00; --warn-soft: #fbf0dd; --ok: #1f7a4d; --ok-soft: #e2f3ea; --bad: #b3261e; --bad-soft: #fbe5e3;
  --dot: #d9dee6; --halo: rgba(47, 95, 208, .22);
  /* The mockup is the product's screen and is always drawn light: the light around it keeps one set of colors in both themes. */
  --ov-lit: #2f5fd0; --ov-glow: rgba(47, 95, 208, .16); --ov-glow-far: rgba(47, 95, 208, .05); --ov-ok: #1f7a4d; --ov-ok-soft: #e2f3ea; --ov-todo: #8a93a3; --ov-white: #ffffff;
  --sans: "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif;
  --mono: ui-monospace, "SFMono-Regular", Menlo, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #10141b; --surface: #171c25; --ink: #e4e8ef; --ink-2: #9aa4b5; --line: #2a313d;
  --accent: #8ea8ff; --accent-soft: #1e2840; --warn: #f0b35a; --warn-soft: #33270f; --ok: #77d19c; --ok-soft: #12291d; --bad: #ff8a80; --bad-soft: #3a1714;
  --dot: #252c38; --halo: rgba(142, 168, 255, .25);
  color-scheme: dark } }
:root[data-theme="dark"] {
  --bg: #10141b; --surface: #171c25; --ink: #e4e8ef; --ink-2: #9aa4b5; --line: #2a313d;
  --accent: #8ea8ff; --accent-soft: #1e2840; --warn: #f0b35a; --warn-soft: #33270f; --ok: #77d19c; --ok-soft: #12291d; --bad: #ff8a80; --bad-soft: #3a1714;
  --dot: #252c38; --halo: rgba(142, 168, 255, .25);
  color-scheme: dark }
body { background: var(--bg); color: var(--ink); font-family: var(--sans); font-size: 15px; line-height: 1.7; margin: 0; }
.wrap { max-width: 1200px; margin: 0 auto; padding-block: 24px 48px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); display: flex; flex-direction: column; gap: 16px; }
h1 { font-size: 1.5rem; line-height: 1.3; margin: 0; text-wrap: balance; }
h2 { font-size: 1.1rem; margin: 0; }
h3, h4 { margin: 6px 0 0; }
h3 { font-size: 1.05rem; }
h4 { font-size: .95rem; }
p { margin: 0; }
.cap { font-size: .85rem; color: var(--ink-2); }
/* In crew's web page this is a part of that page: no background, margins, tag or footer of its own; the window's height is the page's (--vh). */
html.web, html.web body { background: transparent; }
html.web .wrap { max-width: none; padding: 0 0 4px; }
html.web header .tag, html.web #foot { display: none; }
html.web h1 { font-size: 1.2rem; }
.tag { display: inline-block; font-size: .75rem; padding: 1px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-weight: 600; align-self: flex-start; }
.notice { background: var(--warn-soft); color: var(--warn); border-radius: 8px; padding: 10px 14px; font-size: .9rem; }
.notice:empty { display: none; }
.tabs { display: flex; gap: 4px; flex-wrap: wrap; border-bottom: 1px solid var(--line); }
.tabs button { font: inherit; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--ink-2); padding: 6px 12px; cursor: pointer; display: flex; gap: 6px; align-items: center; }
.tabs button[aria-selected="true"] { color: var(--ink); border-bottom-color: var(--accent); font-weight: 600; }
.panel { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.review { border: 2px dashed var(--accent); border-radius: 10px; background: var(--surface); display: grid; grid-template-columns: 280px minmax(0, 1fr); min-height: 560px; min-width: 0; overflow: hidden; overflow: clip; }
@media (max-width: 800px) { .review { grid-template-columns: 1fr; } }
/* What is up for acceptance is built, not a design: a solid frame, the dashed one stays the designs'. */
.review.built { border-style: solid; border-color: var(--line); }
/* Side by side, the design opened stays in view as the list beside it scrolls: clip, not hidden, lets it stick. */
@media (min-width: 801px) {
  .review > .detail { position: sticky; top: 0; align-self: start; max-height: calc(var(--vh, 1vh) * 100); overflow-y: auto; box-sizing: border-box; }
  .review iframe.mock { height: max(360px, min(calc(var(--vh, 1vh) * 72), calc(var(--vh, 1vh) * 100 - 300px))); min-height: 0; }
}
.nav { border-right: 1px solid var(--line); padding: 8px; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
@media (max-width: 800px) { .nav { border-right: 0; border-bottom: 1px solid var(--line); } }
.nav button { font: inherit; text-align: left; border: 0; background: transparent; color: var(--ink); border-radius: 6px; padding: 8px 10px; cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
.nav button[aria-current="true"] { background: var(--accent-soft); }
button:focus-visible, input:focus-visible, textarea:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.id { font-family: var(--mono); font-size: .78rem; color: var(--ink-2); display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.t { font-size: .9rem; line-height: 1.45; }
.chip { font-family: var(--sans); font-size: .72rem; padding: 0 7px; border-radius: 999px; white-space: nowrap; }
.chip.wait { background: var(--warn-soft); color: var(--warn); }
.chip.draw { background: var(--bg); color: var(--ink-2); border: 1px dashed var(--line); }
.chip.ok { background: var(--ok-soft); color: var(--ok); }
.chip.bad { background: var(--bad-soft); color: var(--bad); }
.chip.kind { background: var(--bg); color: var(--ink-2); border: 1px solid var(--line); }
.chip.sent { background: var(--accent-soft); color: var(--accent); }
.detail { padding: 16px; display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.head { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; }
.widths { display: flex; gap: 6px; flex-wrap: wrap; }
.widths button { font: inherit; font-size: .8rem; border: 1px solid var(--line); background: var(--bg); color: var(--ink); border-radius: 6px; padding: 2px 10px; cursor: pointer; }
.widths button[aria-pressed="true"] { background: var(--accent); color: var(--surface); border-color: var(--accent); }
.stage { background: var(--bg); border-radius: 8px; padding: 12px; display: flex; justify-content: center; overflow-x: auto; }
iframe.mock { width: 100%; height: calc(var(--vh, 1vh) * 72); min-height: 480px; border: 1px solid var(--line); border-radius: 8px; background: #fff; transition: width .2s; }
iframe.mock.narrow { width: 360px; flex: none; }
.placeholder { border: 1px dashed var(--line); border-radius: 8px; padding: 32px 16px; text-align: center; color: var(--ink-2); }
details { border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; }
summary { cursor: pointer; font-size: .9rem; color: var(--ink-2); }
.text { white-space: pre-wrap; overflow-wrap: anywhere; font-size: .9rem; }
.plain { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--bg); border-radius: 8px; padding: 14px; font-size: .92rem; }
.cols { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 16px; align-items: start; }
@media (max-width: 800px) { .cols { grid-template-columns: minmax(0, 1fr); } }
.doc { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 16px 18px; display: flex; flex-direction: column; gap: 8px; max-height: calc(var(--vh, 1vh) * 78); overflow: auto; overflow-wrap: anywhere; min-width: 0; }
.doc ul { margin: 0; padding-left: 1.3em; display: flex; flex-direction: column; gap: 2px; }
.doc li.sub { margin-left: 1.2em; }
.doc pre { font-family: var(--mono); font-size: .8rem; background: var(--bg); border-radius: 6px; padding: 8px 10px; margin: 0; overflow-x: auto; white-space: pre; }
.side { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.box { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.finding { display: flex; gap: 8px; align-items: baseline; font-size: .9rem; flex-wrap: wrap; }
.q { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
.q.done { opacity: .75; }
.meta { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; font-size: .82rem; color: var(--ink-2); }
.ctx { background: var(--bg); border-radius: 6px; padding: 8px 12px; font-size: .85rem; color: var(--ink-2); overflow-wrap: anywhere; }
.qtext { white-space: pre-wrap; overflow-wrap: anywhere; }
.qbody { display: flex; flex-direction: column; gap: 8px; overflow-wrap: anywhere; min-width: 0; }
.qbody .ask { font-size: 1.05rem; font-weight: 600; line-height: 1.5; }
.qbody h4 { margin: 4px 0 0; font-size: .9rem; color: var(--ink-2); letter-spacing: .02em; }
.qbody ul, .qbody ol { margin: 0; padding-left: 1.4em; display: flex; flex-direction: column; gap: 2px; }
.qbody li.sub { margin-left: 1.2em; }
.pic { border: 1px solid var(--line); border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; margin: 0; }
.pic figcaption { font-size: .8rem; color: var(--ink-2); padding: 6px 10px; border-bottom: 1px solid var(--line); background: var(--bg); }
/* A picture keeps a width a table reads at: on a phone it scrolls sideways inside its frame, not the page. */
.pic .scroll { overflow-x: auto; }
iframe.drawn { width: 100%; min-width: 480px; height: 240px; border: 0; background: #fff; display: block; }
.refs { border-top: 1px dashed var(--line); padding-top: 10px; display: flex; flex-direction: column; gap: 6px; }
.refs h4 { margin: 0; font-size: .82rem; color: var(--ink-2); font-weight: 600; }
.ref { display: grid; grid-template-columns: auto auto minmax(0, 1fr); gap: 4px 8px; align-items: baseline; font-size: .85rem; }
.ref .id { font-family: var(--mono); font-size: .78rem; color: var(--ink); }
.ref .chip { justify-self: start; }
@media (max-width: 520px) { .ref { grid-template-columns: auto minmax(0, 1fr); } .ref .txt { grid-column: 1 / -1; } }
.opts { display: flex; flex-direction: column; gap: 6px; }
.opts button { font: inherit; text-align: left; border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: 6px; padding: 6px 12px; cursor: pointer; }
.opts button[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); }
.opts button:disabled { opacity: .5; cursor: not-allowed; }
/* A page for reading lists the choices as text: the answer is given in the pane. */
ul.opts { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; }
ul.opts li { padding: 2px 0; }
.act { border-top: 1px solid var(--line); padding-top: 12px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.act button { font: inherit; font-size: .9rem; border-radius: 6px; padding: 4px 16px; cursor: pointer; border: 1px solid var(--line); background: var(--bg); color: var(--ink); }
.act button.primary { background: var(--accent); color: var(--surface); border-color: var(--accent); }
.act button:disabled, .act input:disabled, .act textarea:disabled { opacity: .5; cursor: not-allowed; }
.act input, .act textarea { font: inherit; font-size: .9rem; border: 1px solid var(--line); border-radius: 6px; padding: 4px 10px; background: var(--surface); color: var(--ink); flex: 1 1 220px; min-width: 0; }
.act textarea { min-height: 4.5em; resize: vertical; flex-basis: 100%; }
.said { font-size: .85rem; color: var(--ink-2); flex-basis: 100%; white-space: pre-wrap; }
.empty { border: 1px dashed var(--line); border-radius: 10px; padding: 28px 16px; text-align: center; color: var(--ink-2); }

/* The progress map: a route of stations in the order they are built. The one loud thing is the light on what is being built now. */
.pm { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.pm h3, .pm h4 { margin: 0; }
.pm h3 { font-size: 1rem; }
.pm h4 { font-size: .92rem; }
.pm code { font-family: var(--mono); font-size: .8em; background: var(--bg); border: 1px solid var(--line); border-radius: 4px; padding: 0 5px; overflow-wrap: anywhere; }
.top { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 16px 18px; display: grid; gap: 14px; min-width: 0; }
.where { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 14px; }
.where strong { font-size: 1.1rem; }
.where .cap { font-variant-numeric: tabular-nums; }
.strip { display: grid; gap: 3px; min-width: 0; }
.bars, .bar-labels { display: flex; gap: 2px; min-width: 0; }
.bars { height: 14px; }
.bseg { flex: var(--w) 1 0; min-width: 2px; border: 0; padding: 0; border-radius: 3px; background: var(--line); position: relative; overflow: hidden; cursor: pointer; }
.bseg i { position: absolute; top: 0; bottom: 0; left: 0; width: var(--f); background: var(--accent); }
.bseg.done i { background: var(--ok); }
.bseg.doing { box-shadow: 0 0 0 2px var(--halo); animation: segglow 1.8s ease-in-out infinite; }
@keyframes segglow { 0%, 100% { box-shadow: 0 0 0 1px var(--halo); } 50% { box-shadow: 0 0 0 4px var(--halo); } }
.bar-labels span { flex: var(--w) 1 0; min-width: 2px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: .75rem; color: var(--ink-2); text-align: center; font-variant-numeric: tabular-nums; }
.bar-labels span.cur { color: var(--accent); font-weight: 600; }
.now { display: grid; gap: 2px; min-width: 0; }
.now h3 { font-size: .85rem; color: var(--ink-2); font-weight: 600; margin-bottom: 2px; }
.nowrow { font: inherit; display: grid; grid-template-columns: 8px auto minmax(0, 1fr) auto; gap: 2px 10px; align-items: baseline; width: 100%; text-align: left; border: 0; background: transparent; padding: 5px 8px; border-radius: 6px; color: var(--ink); cursor: pointer; }
.nowrow:hover { background: var(--bg); }
.nowrow .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.nowrow .who { font-size: .82rem; color: var(--accent); white-space: nowrap; }
.dotp { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); align-self: center; display: inline-block; flex: none; animation: dotpulse 1.8s ease-in-out infinite; }
@keyframes dotpulse { 0%, 100% { box-shadow: 0 0 0 0 var(--halo); } 50% { box-shadow: 0 0 0 5px var(--halo); } }
@media (max-width: 560px) {
  .nowrow { grid-template-columns: 8px auto minmax(0, 1fr); }
  .nowrow .who { grid-column: 3; grid-row: 1; justify-self: end; }
  .nowrow .nm { grid-column: 2 / -1; grid-row: 2; white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
}
.linkish { font: inherit; border: 0; background: transparent; color: var(--accent); padding: 0; cursor: pointer; font-size: .85rem; text-align: left; text-decoration: underline; text-underline-offset: 3px; }
.morebtn { margin: 2px 0 0 26px; justify-self: start; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: .8rem; color: var(--ink-2); align-items: center; }
.legend span { display: inline-flex; gap: 6px; align-items: center; }
.sw { width: 18px; height: 12px; border-radius: 3px; display: inline-block; }
.sw.doing { border: 2px solid var(--accent); box-shadow: 0 0 0 3px var(--halo); }
.sw.part { border: 2px solid var(--accent); background: linear-gradient(to right, var(--accent) 45%, transparent 45%); }
.sw.done { background: var(--ok-soft); border: 1px solid var(--ok); }
.sw.todo { border: 2px dashed var(--ink-2); opacity: .7; }
.route { list-style: none; margin: 0; padding: 0; display: grid; }
.stn { position: relative; display: grid; grid-template-columns: 36px minmax(0, 1fr); column-gap: 8px; padding-bottom: 14px; }
.stn::before { content: ""; position: absolute; left: 17px; top: 30px; bottom: -10px; width: 2px; background: repeating-linear-gradient(to bottom, var(--ink-2) 0 4px, transparent 4px 9px); opacity: .45; }
.stn.done::before { background: var(--ok); opacity: .5; }
.stn:last-child::before { display: none; }
.knob { position: relative; z-index: 1; width: 22px; height: 22px; margin: 12px 0 0 7px; border-radius: 50%; display: grid; place-items: center; background: var(--bg); border: 2px dashed var(--ink-2); color: var(--surface); }
.stn.done .knob { background: var(--ok); border: 2px solid var(--ok); opacity: .8; }
.stn.part .knob { border: 3px solid var(--accent); background: linear-gradient(to top, var(--accent) 50%, var(--bg) 50%); }
.stn.doing .knob { border: 3px solid var(--accent); background: var(--surface); animation: knob 1.8s ease-in-out infinite; }
@keyframes knob { 0%, 100% { box-shadow: 0 0 0 3px var(--halo); } 50% { box-shadow: 0 0 0 9px transparent; } }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; display: grid; gap: 8px; min-width: 0; }
.stn.doing > .card { border-color: var(--accent); box-shadow: 0 0 0 3px var(--halo); }
.stn.done > .card { background: transparent; }
.sh { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; min-width: 0; }
.sh .n { font-weight: 700; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.sh h3 { font-size: 1.05rem; }
.stn.done .sh h3 { color: var(--ink-2); }
.acts { margin-left: auto; display: inline-flex; flex-wrap: wrap; gap: 6px; }
.gain { font-size: .92rem; }
.gain b { font-weight: 600; color: var(--ink-2); font-size: .8rem; margin-right: 8px; }
.lanes { margin: 0; display: grid; grid-template-columns: 4.5em minmax(0, 1fr); gap: 6px 12px; align-items: start; }
.lanes dt { font-size: .8rem; color: var(--ink-2); padding-top: 3px; }
.lanes dd { margin: 0; display: flex; flex-wrap: wrap; gap: 5px; min-width: 0; }
.nolane { color: var(--ink-2); font-size: .82rem; padding-top: 2px; opacity: .8; }
@media (max-width: 520px) { .lanes { grid-template-columns: 4em minmax(0, 1fr); gap: 6px 8px; } .top { padding: 12px 14px; } .card { padding: 10px 12px; } .stn { grid-template-columns: 30px minmax(0, 1fr); column-gap: 6px; } .stn::before { left: 14px; } .knob { margin-left: 4px; } }
.uses { font-size: .82rem; color: var(--ink-2); }
.pill { font: inherit; display: inline-flex; align-items: center; gap: 6px; max-width: 100%; border-radius: 999px; padding: 1px 10px; font-size: .84rem; line-height: 1.6; border: 1.5px solid var(--line); background: var(--surface); color: var(--ink); cursor: pointer; }
.pill .tx { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.pill .fr { font-variant-numeric: tabular-nums; font-size: .74rem; color: var(--accent); white-space: nowrap; }
.pill.done { border-color: transparent; background: var(--ok-soft); color: var(--ok); }
.pill.doing, .pill.part { border-color: var(--accent); }
.pill.todo { border-style: dashed; border-color: var(--ink-2); color: var(--ink-2); background: transparent; }
.ck { flex: none; }
.btn { font: inherit; display: inline-flex; align-items: center; justify-content: center; gap: 6px; border-radius: 6px; padding: 1px 12px; border: 1px solid var(--line); background: var(--bg); color: var(--ink); cursor: pointer; font-size: .84rem; align-self: flex-start; }
.chip.doing { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.chip.part { border: 1px solid var(--accent); color: var(--accent); font-weight: 600; }
.chip.done { background: var(--ok-soft); color: var(--ok); font-weight: 600; }
.chip.todo { border: 1px dashed var(--ink-2); color: var(--ink-2); }
.sdetail { display: grid; gap: 12px; min-width: 0; }
.dt-head { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: baseline; }
.dt-head h3 { font-size: 1.1rem; }
.back { font: inherit; border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: 6px; padding: 1px 10px; font-size: .84rem; cursor: pointer; }
.scope { font-size: .85rem; color: var(--ink-2); background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; }
.dt-grid { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 14px; align-items: start; min-width: 0; }
@media (max-width: 1080px) { .dt-grid { grid-template-columns: minmax(0, 1fr); } }
.canvas { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
.sec { display: grid; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--line); min-width: 0; }
.sec:last-child { border-bottom: 0; }
.sec-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; align-items: baseline; }
.ground { background-color: var(--bg); background-image: radial-gradient(var(--dot) 1px, transparent 1.2px); background-size: 16px 16px; padding: 16px; overflow-x: auto; border-radius: 8px; }
.ground iframe.mock { height: calc(var(--vh, 1vh) * 60); min-height: 420px; }
.icards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr)); gap: 8px; }
.icard { font: inherit; text-align: left; border: 1.5px solid var(--line); border-radius: 8px; padding: 10px 12px; background: var(--surface); color: var(--ink); display: grid; gap: 3px; align-content: start; cursor: pointer; }
.icard .layer { font-size: .74rem; color: var(--ink-2); }
.icard .nm { font-weight: 600; }
.icard .ct { font-size: .76rem; font-variant-numeric: tabular-nums; color: var(--ink-2); }
.icard.done { background: var(--ok-soft); border-color: transparent; }
.icard.done .ct { color: var(--ok); }
.icard.doing, .icard.part { border: 2px solid var(--accent); }
.icard.doing .ct, .icard.part .ct { color: var(--accent); font-weight: 600; }
.icard.todo { border-style: dashed; border-color: var(--ink-2); }
.icard.sel { outline: 2px solid var(--ink); outline-offset: 2px; }
/* The screen counts as one block for now: its frame is lit with the state of the station's screen work. */
.lit { position: relative; border-radius: 10px; padding: 6px; }
.lit::after { content: ""; position: absolute; inset: 0; border-radius: 10px; pointer-events: none; z-index: 3; }
.rtag { position: relative; z-index: 5; display: block; width: fit-content; max-width: 100%; margin-bottom: 6px; overflow: hidden; text-overflow: ellipsis; font-size: 11px; line-height: 18px; padding: 0 8px; border-radius: 999px; white-space: nowrap; font-weight: 600; font-variant-numeric: tabular-nums; }
.lit.doing::after { box-shadow: inset 0 0 0 2px var(--ov-lit), inset 0 0 0 5px var(--ov-glow); animation: breathe 1.8s ease-in-out infinite; }
.lit.doing .rtag { background: var(--ov-lit); color: var(--ov-white); }
@keyframes breathe { 0%, 100% { box-shadow: inset 0 0 0 2px var(--ov-lit), inset 0 0 0 4px var(--ov-glow); } 50% { box-shadow: inset 0 0 0 2px var(--ov-lit), inset 0 0 0 14px var(--ov-glow-far); } }
.lit.part::after { box-shadow: inset 0 0 0 2px var(--ov-lit); }
.lit.part .rtag { background: var(--ov-white); color: var(--ov-lit); box-shadow: 0 0 0 1px var(--ov-lit); }
.lit.done::after { box-shadow: inset 0 0 0 2px var(--ov-ok); }
.lit.done .rtag { background: var(--ov-ok-soft); color: var(--ov-ok); box-shadow: 0 0 0 1px var(--ov-ok); }
.lit.todo::after { border: 2px dashed var(--ov-todo); }
.lit.todo .rtag { background: var(--ov-white); color: var(--ov-todo); box-shadow: 0 0 0 1px var(--ov-todo); }
.sside { display: grid; gap: 12px; min-width: 0; }
.pbox { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.dhead { display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center; }
.facts { margin: 0; display: grid; grid-template-columns: 5em minmax(0, 1fr); gap: 4px 10px; font-size: .86rem; }
.facts dt { color: var(--ink-2); }
.facts dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.tgroup { display: grid; gap: 6px; }
.tgroup h4 { font-size: .85rem; color: var(--ink-2); font-weight: 600; }
.tasks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.tasks details { padding: 6px 10px; }
.tasks li.hit details { border-color: var(--accent); box-shadow: inset 3px 0 0 var(--accent); }
.tasks summary { color: var(--ink); display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0 8px; align-items: baseline; list-style: none; }
.tasks summary::-webkit-details-marker { display: none; }
.tasks summary .tt { font-size: .9rem; min-width: 0; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.tasks summary .st { grid-column: 2; font-size: .78rem; color: var(--ink-2); }
.tasks .st.doing { color: var(--accent); font-weight: 600; }
.tasks .st.done { color: var(--ok); }
.tasks .more { font-size: .85rem; color: var(--ink-2); padding: 6px 0 2px; display: grid; gap: 6px; }
.tasks .more .full { color: var(--ink); }
.tasks .more .spec { white-space: pre-wrap; overflow-wrap: anywhere; }
.rqlist { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.rq { display: grid; grid-template-columns: 3.2em minmax(0, 1fr); gap: 0 8px; align-items: baseline; }
.rq .rn { font-variant-numeric: tabular-nums; color: var(--ink-2); font-weight: 600; overflow-wrap: anywhere; }
.rt { display: grid; gap: 4px; min-width: 0; overflow-wrap: anywhere; }
.reqbox { border: 0; border-top: 1px solid var(--line); border-radius: 0; padding: 8px 0 0; font-size: .9rem; }
.reqbox summary { color: var(--accent); font-size: .85rem; }
.reqbox .rqlist { margin-top: 8px; }
.reqs { background: var(--surface); padding: 12px 16px; display: grid; gap: 10px; min-width: 0; }
.reqs > summary { font-weight: 600; color: var(--ink); font-size: .95rem; }
.reqs > summary .cap { font-weight: 400; margin-left: 10px; }
.reqs .rqlist > .rq + .rq { border-top: 1px solid var(--line); padding-top: 10px; }
.acs { list-style: none; margin: 2px 0 0; padding: 0; display: grid; gap: 8px; }
.ac { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 8px; align-items: baseline; font-size: .88rem; }
.ac .by { grid-column: 2; display: flex; flex-wrap: wrap; gap: 4px 8px; font-size: .8rem; color: var(--ink-2); align-items: baseline; }
.tref { font: inherit; border: 1px solid var(--line); background: var(--bg); color: var(--ink-2); border-radius: 4px; padding: 0 6px; font-family: var(--mono); font-size: .75rem; cursor: pointer; }
.tref.done { color: var(--ok); }
.tref.doing { color: var(--accent); border-color: var(--accent); }
.tref.todo { border-style: dashed; }
.prdview { display: grid; gap: 14px; }
.prdsec { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; display: grid; gap: 10px; }
.rq .at { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; }
.rq.flash { background: var(--accent-soft); border-radius: 6px; box-shadow: 0 0 0 6px var(--accent-soft); }
.shown { border-radius: 8px; box-shadow: 0 0 0 3px var(--accent), 0 0 0 9px var(--accent-soft); }
.jump { font: inherit; border: 1px solid var(--line); background: var(--bg); color: var(--ink); border-radius: 999px; padding: 1px 10px; font-size: .85rem; cursor: pointer; }
@media (max-width: 520px) {
  .ac { grid-template-columns: minmax(0, 1fr); }
  .ac .chip { justify-self: start; }
  .ac .by { grid-column: 1; }
}
@media (prefers-reduced-motion: reduce) {
  iframe.mock { transition: none; }
  .lit.doing::after { animation: none; box-shadow: inset 0 0 0 3px var(--ov-lit), inset 0 0 0 8px var(--ov-glow); }
  .stn.doing .knob { animation: none; box-shadow: 0 0 0 4px var(--halo); }
  .bseg.doing { animation: none; box-shadow: 0 0 0 3px var(--halo); }
  .dotp { animation: none; box-shadow: 0 0 0 3px var(--halo); }
}
/* 待你驗收: the screen first, the things to look at numbered on it and in the list beside it. */
.accq { display: flex; flex-direction: column; gap: 4px; background: var(--bg); border-radius: 8px; padding: 10px 12px; font-size: .9rem; }
.accq .said { color: var(--ink); }
.views { display: flex; gap: 6px; flex-wrap: wrap; }
.views button { font: inherit; font-size: .8rem; border: 1px solid var(--line); background: var(--bg); color: var(--ink); border-radius: 6px; padding: 2px 10px; cursor: pointer; }
.views button[aria-pressed="true"] { background: var(--accent); color: var(--surface); border-color: var(--accent); }
.shot { position: relative; display: inline-block; max-width: 100%; }
.shot img { display: block; max-width: 100%; height: auto; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
.shot .spot { position: absolute; background: transparent; border: 3px solid var(--ov-lit); border-radius: 4px; box-shadow: 0 0 0 4px var(--ov-glow); pointer-events: none; }
.shot .pin, .items .pin { display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 11px; background: var(--ov-lit); color: var(--ov-white); font-size: .75rem; font-weight: 700; flex: none; }
.shot .pin { position: absolute; transform: translate(-50%, -50%); }
.items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.items li > button.it { font: inherit; text-align: left; width: 100%; border: 1px dashed var(--line); background: var(--surface); color: var(--ink); border-radius: 8px; padding: 8px 10px; cursor: pointer; display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 4px 10px; }
.items li > button.it[aria-current="true"] { border: 2px solid var(--ov-lit); background: var(--accent-soft); }
.items .pin { background: var(--ov-todo); }
.items li > button.it[aria-current="true"] .pin { background: var(--ov-lit); }
.items .ask { font-weight: 600; }
.items .sub { grid-column: 2; font-size: .82rem; color: var(--ink-2); overflow-wrap: anywhere; }
.thumbs { display: flex; gap: 8px; flex-wrap: wrap; padding: 6px 0 0 32px; }
.thumbs .thumb { font: inherit; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: 8px; padding: 4px; cursor: pointer; max-width: 100%; }
.thumbs .thumb[aria-pressed="true"] { border: 2px solid var(--ov-lit); }
.thumbs .thumb:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.thumbs .thumb img { display: block; width: 128px; height: 80px; object-fit: cover; object-position: top left; border-radius: 4px; background: #fff; }
.thumbs .thumb.phone img { width: 46px; }
.thumbs .thumb.api { min-width: 0; max-width: 260px; padding: 6px 8px; }
.thumbs .thumb.api code { font-family: var(--mono); font-size: .75rem; overflow-wrap: anywhere; text-align: left; }
.thumbs .tl { font-size: .72rem; color: var(--ink-2); }
.thumbs-none { padding-left: 32px; }
@media (max-width: 520px) { .thumbs { padding-left: 0; } .thumbs-none { padding-left: 0; } .thumbs .thumb img { width: 104px; height: 66px; } .thumbs .thumb.phone img { width: 38px; } }
.items .fixit { font: inherit; font-size: .78rem; border: 0; background: transparent; color: var(--accent); cursor: pointer; padding: 2px 0 0 32px; }
.acc-where { border: 2px solid var(--ok); border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; background: var(--ok-soft); }
.acc-where h3 { margin: 0; font-size: 1rem; }
.acc-where .wrow { display: grid; grid-template-columns: 6.5em minmax(0, 1fr); gap: 4px 12px; align-items: start; }
.acc-where .wl { font-size: .82rem; color: var(--ink-2); padding-top: 2px; }
.acc-where .wv { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.acc-where code { font-family: var(--mono); font-size: .85rem; background: var(--surface); border: 1px solid var(--line); border-radius: 5px; padding: 0 5px; overflow-wrap: anywhere; }
.acc-where .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.acc-where button, .acc-where a.btn { font: inherit; font-size: .85rem; border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: 8px; padding: 3px 12px; cursor: pointer; text-decoration: none; }
.acc-where button:focus-visible, .acc-where a.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (max-width: 560px) { .acc-where .wrow { grid-template-columns: 1fr; } }
.items .how { grid-column: 2; font-size: .86rem; border-left: 3px solid var(--ok); padding-left: 8px; overflow-wrap: anywhere; }
.items .how b { color: var(--ok); font-weight: 600; }
details.mockd > summary { color: var(--ink); }
details.mockd > .panel { margin-top: 10px; }
pre.api { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--mono); font-size: .8rem; background: var(--bg); border-radius: 8px; padding: 10px 12px; }
pre.api mark { background: var(--accent-soft); color: var(--accent); border-radius: 3px; outline: 2px solid var(--ov-lit); }
.acc-act { display: flex; flex-direction: column; gap: 8px; }
.acc-act textarea { font: inherit; width: 100%; box-sizing: border-box; min-height: 72px; border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; background: var(--surface); color: var(--ink); }
.acc-act .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.acc-confirm { border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.acc-confirm legend { font-weight: 600; padding: 0 4px; }
.acc-confirm .tick label { display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
.acc-confirm .tick .steps { margin: 4px 0 0 22px; padding-left: 16px; }
.acc-confirm .tick .sub { margin: 2px 0 0 22px; }
.passed-list { display: flex; flex-direction: column; gap: 4px; }
</style>`

const SCRIPT = String.raw`<script>
(function () {
  var main = document.getElementById('main');
  var notice = document.getElementById('notice');
  var tabsBox = document.getElementById('tabs');
  var data = null;
  var comments = null;
  var can = 'loading';
  // What the person sent, typed and picked, kept through a redraw and, in this browser, through a new
  // version of the page. A send waits in sentAt, with the code of what it was about, until data.json
  // shows crew recorded it.
  var sent = {};
  var sentAt = {};
  // Sends crew took but is still working on past the page's wait (crew's web page): said as sent, not yet as recorded.
  // Taken by crew and still being worked on, by the id of the send: crew says its end later (crewLate).
  var stillWorking = {};
  // A decision crew took and then could not finish: its words, until the item is decided again or changes.
  var lateNo = {};
  var drafts = {};
  var picked = {};
  // The code of the item each draft and pick was made for: an item asked again drops them.
  var codes = {};
  var html = {};
  // The version (code:stamp) each kept mockup was read for: one for another version is dropped with new data.
  var htmlKey = {};
  var narrow = false;
  var tab = null;
  var open = null;
  var STATES = { waiting: ['等你核准', 'wait'], drawing: ['UI/UX 補畫中', 'draw'], approved: ['你核准了', 'ok'], rejected: ['你退回了', 'bad'] };
  var ACC = { waiting: ['等你驗收', 'wait'], again: ['修好了，再看一次', 'wait'], fixing: ['照你說的修改中', 'draw'], passed: ['你通過了', 'ok'] };
  // The feature open on 待你驗收, how its screen is shown (設計稿, QA 桌機, QA 手機), and the thing lit on it, by feature.
  var accOpen = null;
  var accMode = {};
  var accLit = {};
  // What the person ticked to confirm on each feature's card, kept across redraws until they pass it.
  var accTicks = {};
  // A thumbnail was pressed: the screen above comes into view once drawn.
  var accFocus = false;
  // The design under a card QA did not open the app for, opened by the person: kept open across redraws.
  var accMockOpen = {};
  var accResize = null;
  // On crew's own web page this page runs in a frame of that page's: a decision goes to crew through it and is recorded at once.
  var WEB = !!document.querySelector('meta[name="crew-surface"][content="web"]');
  function W(web, other) { return WEB ? web : other; }
  function Wk(key, web, other, chip) {
    if (!(WEB && stillWorking[key])) return W(web, other);
    // Two minutes on and no result came: the result may be lost, so say how to see it or send again.
    if (late(key)) return chip ? '已送出，還沒有結果' : 'crew 超過兩分鐘還沒說結果：按［重新決定］再送一次。';
    return chip ? '已送出，crew 處理中' : 'crew 收到了，還在處理；處理完這一頁會更新。';
  }

  function el(tag, attrs) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) if (arguments[i] != null) n.append(arguments[i]);
    return n;
  }
  function disable(box, off) { Array.prototype.forEach.call(box.querySelectorAll('button, input, textarea'), function (x) { x.disabled = off; }); }

  // The person chose the pane: the page is theirs to read, and says where they decide.
  var VIEW = '你選了在面板決定：這一頁照樣更新，只給你看。核准、退回和回答，請在 Claude Code 右側面板「待你決定」做；要改回在這一頁決定，在那裡按［改回網頁決定］。';
  function channel() {
    if (can === 'available' || can === 'loading') return '';
    if (WEB && window.parent === window) return '這一頁要在 crew 網頁的「待你決定」裡看和決定：在 Claude Code 的 crew 面板按［開啟 ↗］打開 crew 網頁。';
    if (WEB) return '和 crew 的連線中斷了（Claude Code 的這個 session 關掉了，或 crew 正在重新載入），現在送不出決定。連回來之後這一頁會自己恢復，再按一次就好。';
    if (can === 'no_session') return '現在沒有 Claude Code 收得到你的決定：開著這個 repo 的 Claude Code（crew 的大腦），再重新整理這一頁；或在 Claude Code 右側面板「待你決定」按［改在面板決定］。';
    if (can === 'writers_only') return '你只能看這一頁，不能在這裡決定。';
    if (can === 'forbidden') return '這一頁不能替你留言（你沒有允許，或沒有權限），所以送不出決定：在 Claude Code 右側面板「待你決定」按［改在面板決定］，在那裡決定。';
    return '這個畫面沒辦法把決定送給 Claude Code：在 Claude Code 右側面板「待你決定」按［改在面板決定］，在那裡決定。';
  }

  // One comment to the brain under the box it is about, ending with the code of what the person saw.
  function send(key, body, code, box, said, done) {
    said.textContent = '送出中…';
    disable(box, true);
    delete lateNo[key];
    comments.anchorFor(box).then(function (anchor) {
      return comments.sendToClaude({ anchor: anchor, text: body + '\n代碼 ' + code });
    }).then(function (r) {
      sent[key] = done || true;
      sentAt[key] = { at: Date.now(), code: code };
      if (r && r.pending === true) stillWorking[key] = typeof r.id === 'string' ? r.id : true;
      else delete stillWorking[key];
      // It was sent: a fault in drawing it is not a send that failed.
      try { draw(); } catch (e) { if (window.console) console.error(e); }
      // crew recorded it already: the page reads what it shows now.
      if (WEB) setTimeout(reload, 300);
    }, function (e) {
      if (failed(e, said)) disable(box, can !== 'available');
    });
  }
  // Says why a comment was not sent; false when the page stops offering sends for good.
  function failed(e, said) {
    var code = e && e.code;
    // crew itself said no, and why: the item changed since, it was decided already, and the like.
    if (code === 'crew') { said.textContent = (e && e.message) || 'crew 沒有記下，請再按一次。'; return true; }
    // Refused for this view for good: the page stops offering the send.
    if (code === 'forbidden' || code === 'not_granted') { can = 'forbidden'; draw(); return false; }
    if (code === 'claude_unavailable') recheck();
    said.textContent = code === 'rate_limited' ? '送得太快了，等一下再按。'
      : code === 'claude_unavailable' ? W('送不到 crew：和 crew 的連線中斷了，或 crew 沒有回應。連回來之後再按一次。', '送不到 Claude Code：開著這個 repo 的 Claude Code 再按一次。')
      : code === 'consent_required' ? '要先允許這一頁替你留言，才能送出。'
      : '沒有送出（' + (code || (e && e.message) || '不明原因') + '），請再按一次。';
    return true;
  }
  // Why the buttons are off, when they are.
  function idle(said) {
    if (can === 'available') return false;
    said.textContent = can === 'loading' ? W('正在連上 crew…', '正在確認能不能把決定送給 Claude Code…') : channel();
    return true;
  }

  // ---- PRD draft ----
  var prdText = null;
  function strip(s) { return s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\x60([^\x60]+)\x60/g, '$1'); }
  function doc(text) {
    var box = el('div', { class: 'doc', tabindex: '0', 'aria-label': 'PRD 草稿全文' });
    var list = null, para = [], fence = null, table = null;
    function flushPara() { if (para.length) { box.append(el('p', { text: strip(para.join(' ')) })); para = []; } }
    function flushTable() { if (table !== null) { box.append(el('pre', { text: table.join('\n') })); table = null; } }
    function flush() { flushPara(); flushTable(); list = null; }
    text.split('\n').forEach(function (line) {
      if (fence !== null) {
        if (/^\s*\x60\x60\x60/.test(line)) { box.append(el('pre', { text: fence.join('\n') })); fence = null; } else fence.push(line);
        return;
      }
      if (/^\s*\x60\x60\x60/.test(line)) { flush(); fence = []; return; }
      var h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) { flush(); box.append(el(h[1].length <= 2 ? 'h3' : 'h4', { text: strip(h[2]) })); return; }
      if (/^\s*\|/.test(line)) { flushPara(); list = null; if (table === null) table = []; table.push(line.trim()); return; }
      flushTable();
      var li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
      if (li) {
        flushPara();
        if (list === null) { list = el('ul'); box.append(list); }
        list.append(el('li', { class: li[1].length >= 2 ? 'sub' : '', text: strip(li[3]) }));
        return;
      }
      if (line.trim() === '') { flush(); return; }
      list = null;
      para.push(line.trim());
    });
    flush();
    if (fence !== null) box.append(el('pre', { text: fence.join('\n') }));
    return box;
  }
  function drawDraft(panel) {
    var d = data.draft;
    // What the brain filled in itself comes first: the yes waits for it, and the PRD is there to look things up in.
    var mine = draftQs();
    // An answer sent is not yet taken: the yes waits until crew records it and the brain changes the draft to match.
    var openQs = mine.filter(function (q) { return q.state === 'open'; });
    var unsent = openQs.filter(function (q) { return !sent['q:' + q.id]; });
    var full = el('div');
    if (prdText === null) {
      full.append(el('div', { class: 'placeholder', text: '讀取草稿中…' }));
      var wantPrd = d.code;
      fetch(d.file, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).then(function (j) {
        // Read for a draft the page has since moved past: the newer one is read by the page as it draws it.
        if (!data.draft || data.draft.code !== wantPrd) return;
        prdText = typeof j.text === 'string' ? j.text : '';
        draw();
      }).catch(function () {
        full.textContent = '';
        full.append(el('div', { class: 'placeholder', text: '讀不到草稿（' + d.file + '），' + W('重新整理整個網頁看看；還是一樣，在 Claude Code 對大腦說一聲。', '請大腦重新發佈這一頁。') }));
      });
    } else full.append(doc(prdText));
    var reviews = el('div', { class: 'box' }, el('h2', { text: '審查結果' }));
    d.reviews.forEach(function (r) { reviews.append(el('div', { class: 'finding' }, el('span', { class: 'chip kind', text: r.who }), el('span', { text: r.found }))); });
    if (d.note) reviews.append(el('p', { class: 'cap', text: '大腦：' + d.note }));
    var box = el('div', { class: 'box', 'aria-label': 'PRD 草稿的決定' });
    var said = el('p', { class: 'said', role: 'status' });
    var first = unsent.length ? '先回答上面 ' + unsent.length + ' 題，再按確認。' : '回答已送出：等 crew 記下、大腦照回答改好草稿，才能確認。';
    if (sent.prd && d.state === 'confirm') {
      said.textContent = sent.prd === 'confirm' ? Wk('prd', 'crew 記下了你的確認；開始之後這一頁會更新。', '已送出確認，等 Claude Code 收下交給 crew；開始之後這一頁會更新。') : Wk('prd', 'crew 記下了要改的地方；大腦改好之後這一頁會再請你確認。', '已送出要改的地方，等 Claude Code 收下；大腦改好之後這一頁會更新。');
      box.append(el('div', { class: 'act' }, said, again('prd')));
    } else if (d.state === 'reviewing') {
      box.append(el('p', { class: 'cap', text: 'PM 和 UI/UX 審查中。審完之後大腦會整理缺口問你，改好再請你在這裡確認。' }));
    } else if (d.state === 'changing') {
      box.append(el('p', { text: '你要改：' + d.change }), el('p', { class: 'cap', text: '大腦正在照你說的改，改好會再請你確認。' }));
    } else if (data.view) {
      box.append(el('p', { class: 'said', text: openQs.length ? '先在 Claude Code 右側面板「待你決定」回答上面 ' + openQs.length + ' 題；大腦照回答改好草稿，才能確認開始。' : '等你確認：在 Claude Code 右側面板「待你決定」按［確認，開始］，或對大腦說要改的地方。' }));
    } else {
      var change = el('textarea', { id: 'prd-change', maxlength: '2000', placeholder: '要改的地方：寫哪一段、改成什麼', 'aria-label': '要改的地方', oninput: function () { drafts.prd = change.value; keep(); } });
      change.value = drafts.prd || '';
      var yes = el('button', { type: 'button', class: 'primary', text: '確認，開始', onclick: function () {
        if (openQs.length) { said.textContent = first; return; }
        send('prd', 'crew PRD 確認：開始 ' + d.path, d.code, box, said, 'confirm');
      } });
      var ask = el('button', { type: 'button', text: '送出要改的地方', onclick: function () {
        var t = change.value.trim();
        if (t === '') { said.textContent = '要改的地方要寫內容。'; change.focus(); return; }
        send('prd', 'crew PRD 要改：' + d.path + '\n' + t, d.code, box, said, 'change');
      } });
      var act = el('div', { class: 'act' }, yes, change, ask, said);
      box.append(el('p', { class: 'cap', text: '確認之後，PM 先把它拆成功能和驗收條件。' }), act);
      if (idle(said)) disable(act, true);
      else if (openQs.length) { yes.disabled = true; said.textContent = first; }
    }
    panel.append(el('div', { class: 'head' }, el('h2', { text: d.title }), el('span', { class: 'cap', text: d.path + ' · ' + d.requirements + ' 條需求' })));
    if (mine.length) {
      panel.append(el('div', { class: 'box' },
        el('h2', { text: '確認之前，要你拍板的 ' + mine.length + ' 題' }),
        el('p', { class: 'cap', text: '這幾題是審查找到的缺口，和大腦把你的決定寫成需求時自己補上的做法，都還沒問過你。其他需求照你之前說的寫，不用逐條看；要看在下面展開整份 PRD。' })));
      drawQuestions(panel, mine);
    }
    panel.append(box);
    var whole = fold('prd:whole', !mine.length, el('summary', {}, '整份 PRD 草稿', el('span', { class: 'cap', text: d.requirements + ' 條需求' + (mine.length ? '，給你參考，不用逐條看' : '') })));
    whole.classList.add('reqs');
    whole.append(el('div', { class: 'cols' }, full, reviews));
    panel.append(whole);
  }

  // ---- Questions ----
  // A question as the role wrote it: its first line is what to decide, then headings, lists and **bold**. Text only, never HTML.
  function inline(parent, s) {
    s.split(/(\*\*[^*\n]+\*\*)/).forEach(function (part) {
      if (/^\*\*[^*\n]+\*\*$/.test(part)) parent.append(el('strong', { text: part.slice(2, -2) }));
      else if (part) parent.append(document.createTextNode(part.replace(/\x60([^\x60]+)\x60/g, '$1')));
    });
    return parent;
  }
  var ITEM = /^(\s*)([-*•]|\d+[.)、])\s+(.*)$/;
  function rich(text) {
    var box = el('div', { class: 'qbody' });
    var lines = text.split('\n');
    var i = 0;
    while (i < lines.length && lines[i].trim() === '') i++;
    // The first line says what to decide; a question written as one long paragraph has no such line.
    var first = (lines[i] || '').trim().replace(/^#{1,6}\s+/, '');
    if (first !== '' && first.length <= 120 && !ITEM.test(lines[i])) { box.append(inline(el('p', { class: 'ask' }), first)); i++; }
    var list = null, para = null;
    for (; i < lines.length; i++) {
      var line = lines[i], t = line.trim();
      if (t === '') { list = null; para = null; continue; }
      var h = /^#{1,6}\s+(.*)$/.exec(t);
      var li = ITEM.exec(line);
      // A short line of its own over a list is that list's heading: 背景, 現在的情況, 各選項的差別.
      var next = lines[i + 1] || '';
      var label = !h && !li && t.length <= 24 && !/[。！？!?，,；;]$/.test(t) && ITEM.test(next);
      if (h || label) { list = null; para = null; box.append(inline(el('h4'), (h ? h[1] : t).replace(/[:：]$/, ''))); continue; }
      if (li) {
        para = null;
        var ordered = /\d/.test(li[2]);
        if (list === null || list.tagName !== (ordered ? 'OL' : 'UL')) {
          list = el(ordered ? 'ol' : 'ul');
          if (ordered) list.setAttribute('start', String(parseInt(li[2], 10) || 1));
          box.append(list);
        }
        list.append(inline(el('li', { class: li[1].length >= 2 ? 'sub' : '' }), li[3]));
        continue;
      }
      list = null;
      if (para === null) { para = el('p'); box.append(para); } else para.append(el('br'));
      inline(para, t);
    }
    return box;
  }
  // The role's picture runs in a frame of its own, as a mockup does: it reaches neither the page nor the person's comments.
  // Ahead of it, so nothing it leaves open swallows them: a policy that loads nothing from the network, and a script that
  // says how tall it is drawn. The page holds the frame to that, within bounds, and keeps it through a redraw.
  var HEAD = '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; img-src data:; font-src data:">'
    + '<script>(function(){function s(){parent.postMessage({crewPicture:document.documentElement.getBoundingClientRect().height},"*")}addEventListener("load",function(){s();if(window.ResizeObserver)new ResizeObserver(s).observe(document.documentElement)});setTimeout(s,300)})()<\/script>';
  var frames = [];
  var heights = {};
  function tall(h) { return Math.max(80, Math.min(720, Math.ceil(h))) + 'px'; }
  window.addEventListener('message', function (e) {
    var h = e.data && typeof e.data.crewPicture === 'number' && isFinite(e.data.crewPicture) ? e.data.crewPicture : null;
    if (h === null) return;
    frames.forEach(function (f) { if (f.contentWindow === e.source) { f.style.height = tall(h); heights[f.getAttribute('data-q')] = h; } });
  });
  function picture(q) {
    var f = el('iframe', { class: 'drawn', sandbox: 'allow-scripts', title: q.id + ' 的附圖', referrerpolicy: 'no-referrer', 'data-q': q.id });
    if (heights[q.id] !== undefined) f.style.height = tall(heights[q.id]);
    // The page's own doctype goes first, so the role's is dropped.
    f.srcdoc = HEAD + q.picture.html.replace(/^\s*<!doctype[^>]*>/i, '');
    frames = frames.filter(function (x) { return x.isConnected; }).concat([f]);
    return el('figure', { class: 'pic' }, el('figcaption', { text: '附圖' + (q.picture.caption ? '：' + q.picture.caption : '') + '（' + q.from + ' 畫的）' }), el('div', { class: 'scroll' }, f));
  }
  function mentions(q) {
    var box = el('div', { class: 'refs' }, el('h4', { text: '提到的項目（crew 從看板、PRD 和記憶附上原文）' }));
    q.mentions.forEach(function (m) {
      box.append(el('div', { class: 'ref' }, el('span', { class: 'id', text: m.id }), el('span', { class: 'chip kind', text: m.kind }), el('span', { class: 'txt', text: m.text })));
    });
    return box;
  }
  // Questions asked back to the brain from this view: what the card says until the person answers.
  var asked = {};
  var ASKED = W('問題送給大腦了：它會在 Claude Code 的對話裡回答你。這一題還等你回答。', '問題送出了：大腦會在這張卡的留言下回覆你。這一題還等你回答。');
  function draftQs() { return data.draft ? data.questions.filter(function (q) { return q.draft === true; }) : []; }
  // The questions tab holds those not on the draft; the draft tab, its own, passed in as only.
  function drawQuestions(panel, only) {
    var qs = (only || data.questions.filter(function (q) { return !(data.draft && q.draft === true); })).slice().sort(function (a, b) { return (a.state === 'open' ? 0 : 1) - (b.state === 'open' ? 0 : 1); });
    if (qs.length === 0) { panel.append(el('div', { class: 'empty', text: '現在沒有角色問你的問題。' })); return; }
    qs.forEach(function (q) {
      var key = 'q:' + q.id;
      var box = el('section', { class: 'q' + (q.state === 'open' ? '' : ' done'), 'aria-label': q.id });
      var chip = q.state !== 'open' ? el('span', { class: 'chip ok', text: '已回答' }) : sent[key] ? el('span', { class: 'chip sent', text: Wk(key, 'crew 已記下', '已送出回答，等收下', true) }) : el('span', { class: 'chip wait', text: '等你回答' });
      box.append(el('div', { class: 'meta' }, el('span', { class: 'id', text: q.id }), el('span', { text: q.from + ' 問的' }), el('span', { text: q.at }), chip));
      if (q.item) box.append(el('div', { class: 'ctx', text: q.item + (q.itemTitle ? '　' + q.itemTitle : '') }));
      box.append(rich(q.question));
      if (q.picture && q.picture.html) box.append(picture(q));
      var refs = q.mentions && q.mentions.length ? mentions(q) : null;
      if (q.state !== 'open') { box.append(el('p', { class: 'cap', text: '你回答了：' + (q.answer || '') })); if (refs) box.append(refs); panel.append(box); return; }
      if (sent[key]) { box.append(el('div', { class: 'act' }, el('p', { class: 'said', text: Wk(key, 'crew 記下了，已交給' + q.from + '；這一頁更新中…', '已送出，等 Claude Code 收下交給' + q.from + '；記好之後這一頁會更新。') }), again(key))); if (refs) box.append(refs); panel.append(box); return; }
      if (data.view) {
        if (q.options && q.options.length) {
          var listed = el('ul', { class: 'opts', 'aria-label': '選項' });
          q.options.forEach(function (o, i) { listed.append(el('li', { text: 'ABCD'.charAt(i) + '　' + o })); });
          box.append(listed);
        }
        box.append(el('div', { class: 'act' }, el('p', { class: 'said', text: '等你在 Claude Code 右側面板「待你決定」回答。' })));
        if (refs) box.append(refs);
        panel.append(box);
        return;
      }
      var said = el('p', { class: 'said', role: 'status' });
      var other = el('input', { type: 'text', id: 'answer-' + q.id, maxlength: '500', placeholder: q.options && q.options.length ? '其他：自己寫回答，或寫下想問大腦的' : '你的回答，或寫下想問大腦的', 'aria-label': q.id + ' 的回答或提問', oninput: function () { drafts[key] = other.value; picked[key] = undefined; mark(); keep(); } });
      other.value = drafts[key] || '';
      var opts = null;
      function mark() { if (opts) Array.prototype.forEach.call(opts.children, function (b, i) { b.setAttribute('aria-pressed', String(picked[key] === i)); }); }
      if (q.options && q.options.length) {
        opts = el('div', { class: 'opts', role: 'group', 'aria-label': '選項' });
        q.options.forEach(function (o, i) {
          opts.append(el('button', { type: 'button', 'aria-pressed': 'false', text: 'ABCD'.charAt(i) + '　' + o, onclick: function () { picked[key] = i; other.value = ''; drafts[key] = ''; mark(); keep(); } }));
        });
        box.append(opts);
        mark();
      }
      var go = el('button', { type: 'button', class: 'primary', text: '送出回答', onclick: function () {
        var a = picked[key] !== undefined ? q.options[picked[key]] : other.value.trim();
        if (!a) { said.textContent = q.options && q.options.length ? '選一個選項，或自己寫回答。' : '回答要寫內容。'; return; }
        send(key, 'crew 回答：' + q.id + '\n' + a, q.code, box, said);
      } });
      // A question back is not an answer: the brain answers it under this card, and the question still waits for the person.
      var back = el('button', { type: 'button', text: '問大腦', onclick: function () {
        var t = other.value.trim();
        if (!t) { said.textContent = '先在框裡寫下想問的，再按［問大腦］。'; other.focus(); return; }
        said.textContent = '送出中…';
        back.disabled = true;
        comments.anchorFor(box).then(function (anchor) {
          return comments.sendToClaude({ anchor: anchor, text: 'crew 提問：' + q.id + '\n' + t + '\n代碼 ' + q.code });
        }).then(function () {
          other.value = ''; drafts[key] = ''; asked[key] = true; keep();
          said.textContent = ASKED;
          back.disabled = false;
        }, function (e) { if (failed(e, said)) back.disabled = false; });
      } });
      var act = el('div', { class: 'act' }, other, go, back, said);
      box.append(act);
      if (refs) box.append(refs);
      if (idle(said)) { disable(act, true); if (opts) disable(opts, true); }
      else if (asked[key]) said.textContent = ASKED;
      panel.append(box);
    });
  }

  // ---- Designs ----
  function designChip(d) {
    if (sent['d:' + d.id]) return el('span', { class: 'chip sent', text: sent['d:' + d.id] === 'approved' ? Wk('d:' + d.id, 'crew 已記下核准', '已送出核准，等收下', true) : Wk('d:' + d.id, 'crew 已記下退回', '已送出退回，等收下', true) });
    var s = STATES[d.state];
    return el('span', { class: 'chip ' + s[1], text: s[0] });
  }
  function kind(d) { return el('span', { class: 'chip kind', text: d.kind === 'screen' ? '畫面' : '沒有畫面' }); }
  // Which version of a design's file the page is on: a mockup read for another is not kept.
  function fileKey(id) {
    var d = ((data && data.designs) || []).filter(function (x) { return x.id === id; })[0];
    return d ? d.code + ':' + (d.stamp || '') : '';
  }
  function frame(d) {
    var f = el('iframe', { class: 'mock' + (narrow ? ' narrow' : ''), sandbox: 'allow-scripts', title: d.id + ' 的 mockup', referrerpolicy: 'no-referrer' });
    var want = fileKey(d.id);
    if (html[d.id] !== undefined) f.srcdoc = html[d.id];
    else fetch(d.file, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).then(function (j) {
      if (fileKey(d.id) !== want) return;
      html[d.id] = typeof j.html === 'string' ? j.html : '';
      htmlKey[d.id] = want;
      f.srcdoc = html[d.id];
    }).catch(function () {
      f.replaceWith(el('div', { class: 'placeholder', text: '讀不到這份 mockup（' + d.file + '），' + W('重新整理整個網頁看看；還是一樣，在 Claude Code 對大腦說一聲。', '請大腦重新發佈這一頁。') }));
    });
    return f;
  }
  function widths(stage) {
    function set(n) {
      narrow = n;
      var f = stage.querySelector('iframe');
      if (f) f.classList.toggle('narrow', n);
      wide.setAttribute('aria-pressed', String(!n));
      thin.setAttribute('aria-pressed', String(n));
    }
    var wide = el('button', { type: 'button', 'aria-pressed': String(!narrow), text: '桌面', onclick: function () { set(false); } });
    var thin = el('button', { type: 'button', 'aria-pressed': String(narrow), text: '360px', onclick: function () { set(true); } });
    return el('div', { class: 'widths', role: 'group', 'aria-label': '寬度' }, wide, thin);
  }
  function designActions(d, box) {
    var key = 'd:' + d.id;
    var said = el('span', { class: 'said' });
    if (sent[key]) { said.textContent = Wk(key, 'crew 記下了；這一頁更新中…', '已送出，等 Claude Code 收下交給 crew；記好之後這一頁會更新。'); return el('div', { class: 'act' }, said, again(key)); }
    if (d.state === 'approved') return el('div', { class: 'act' }, el('span', { class: 'said', text: '你核准了這一版。' }));
    if (d.state === 'rejected') return el('div', { class: 'act' }, el('span', { class: 'said', text: '你退回了：' + (d.reason || '沒有寫原因') + '。UI/UX 會照原因重畫一份新的。' }));
    if (d.state === 'drawing') return el('div', { class: 'act' }, el('span', { class: 'said', text: 'UI/UX 還在畫這份的 mockup；畫好之後這一頁會更新，才能核准或退回。' }));
    if (data.view) return el('div', { class: 'act' }, el('span', { class: 'said', text: d.broken ? '這份的 mockup 檔和看板上的版本對不上，不能核准；在 Claude Code 右側面板寫原因退回，UI/UX 會重畫。' : '等你在 Claude Code 右側面板「待你決定」核准或退回。' }));
    var reason = el('input', { type: 'text', id: 'reason-' + d.id, maxlength: '500', placeholder: '退回原因：要改什麼', 'aria-label': '退回原因', oninput: function () { drafts[key] = reason.value; keep(); } });
    reason.value = drafts[key] || '';
    var head = 'crew 設計稿決定：';
    var ver = d.version ? '（第 ' + d.version + ' 版）' : '';
    var approve = el('button', { type: 'button', class: 'primary', text: '核准', onclick: function () { send(key, head + '核准 ' + d.id + ver, d.code, box, said, 'approved'); } });
    var reject = el('button', { type: 'button', text: '退回', onclick: function () {
      var r = reason.value.trim();
      if (r === '') { said.textContent = '退回要寫原因。'; reason.focus(); return; }
      send(key, head + '退回 ' + d.id + ver + '\n原因：' + r, d.code, box, said, 'rejected');
    } });
    var act = el('div', { class: 'act' }, approve, reason, reject, said);
    if (idle(said)) disable(act, true);
    else if (d.broken) { approve.disabled = true; said.textContent = '這份的 mockup 檔和看板上的版本對不上，不能核准；可以寫原因退回，UI/UX 會重畫。'; }
    return act;
  }
  function drawDesigns(panel) {
    var designs = data.designs;
    if (!designs.some(function (d) { return d.id === open; })) open = (designs.filter(function (d) { return d.state === 'waiting' && !sent['d:' + d.id]; })[0] || designs[0]).id;
    var nav = el('nav', { class: 'nav', 'aria-label': '設計稿' });
    designs.forEach(function (d) {
      nav.append(el('button', { type: 'button', 'aria-current': String(d.id === open), onclick: function () { open = d.id; draw(); recheck(); showDetail(); } },
        el('span', { class: 'id' }, d.id, kind(d), designChip(d)),
        el('span', { class: 't', text: d.title })));
    });
    var detail = el('div', { class: 'detail' });
    var d = designs.filter(function (x) { return x.id === open; })[0];
    var box = el('section', { 'aria-label': d.id + ' ' + d.title });
    box.style.display = 'flex'; box.style.flexDirection = 'column'; box.style.gap = '14px';
    box.append(el('div', { class: 'head' }, el('h2', { text: d.id + ' ' + d.title }), kind(d), designChip(d), d.version ? el('span', { class: 'cap', text: '第 ' + d.version + ' 版' }) : null));
    box.append(el('p', { class: 'cap', text: '功能：' + d.feature + ' ' + d.featureTitle }));
    var text = el('details', {}, el('summary', { text: '看文字說明' }), el('div', { class: 'text', text: d.body }));
    if (d.kind === 'none') box.append(el('div', { class: 'plain', text: d.body }));
    else if (d.file) {
      var stage = el('div', { class: 'stage' });
      stage.append(frame(d));
      box.append(widths(stage), stage, text);
    } else box.append(el('div', { class: 'placeholder', text: d.broken ? '這份的 mockup 檔和看板上的版本對不上（可能被改過），所以不顯示。' : 'UI/UX 還在畫這份的 mockup。' }), text);
    box.append(designActions(d, box));
    detail.append(box);
    panel.append(el('div', { class: 'review' }, nav, detail));
  }


  // ---- 待你驗收 ----
  // A feature handed to the person: its screen first, the things to look at numbered and lit on it, and their 通過 or 要改.
  // The approved mockup lights the element UI/UX marked for a criterion (data-crew-check); QA's screenshots, the box QA measured.
  var LIGHT = '<scr' + 'ipt>(function(){var pins=[];function clear(){pins.forEach(function(p){p.remove()});pins=[];[].forEach.call(document.querySelectorAll("[data-crew-lit]"),function(e){e.style.outline=e.getAttribute("data-crew-lit");e.style.outlineOffset="";e.removeAttribute("data-crew-lit")})}'
    + 'function seen(e){var r=e.getBoundingClientRect();return r.width>0&&r.height>0}function sel(a,id){return "["+a+"~=\\""+String(id).replace(/[^A-Za-z0-9_-]/g,"")+"\\"]"}'
    // A frame just shown (a folded design opened, a first load) may not have its size yet: what is marked but not on screen is tried again, and again when the frame is resized, before it is told as not marked.
    + 'var want=null,tries=0,timer=0,shown=null;function light(){if(!want)return;var d=want;clear();var q=sel("data-crew-check",d.crewLight);var es=[].slice.call(document.querySelectorAll(q));if(shown!==d.crewLight&&es.length&&!es.some(seen)){shown=d.crewLight;var s=document.querySelector(sel("data-crew-show",d.crewLight));if(s)s.click()}clearTimeout(timer);'
    + 'timer=setTimeout(function(){if(want!==d)return;var lit=[].slice.call(document.querySelectorAll(q)).filter(seen);if(!lit.length&&es.length&&tries<8){tries+=1;timer=setTimeout(light,150);return}lit.forEach(function(e,i){e.setAttribute("data-crew-lit",e.style.outline||"");e.style.outline="3px solid #2f5fd0";e.style.outlineOffset="2px";if(i===0){e.scrollIntoView({block:"center"});var r=e.getBoundingClientRect();var p=document.createElement("div");p.textContent=String(d.n);p.style.cssText="position:absolute;z-index:2147483647;background:#2f5fd0;color:#fff;font:700 12px/22px system-ui;width:22px;height:22px;border-radius:11px;text-align:center;pointer-events:none;left:"+(r.left+scrollX-11)+"px;top:"+(r.top+scrollY-11)+"px";document.body.appendChild(p);pins.push(p)}});parent.postMessage({crewLit:lit.length,crewFor:d.crewLight},"*")},80)}'
    + 'addEventListener("message",function(m){var d=m.data;if(!d||typeof d.crewLight!=="string")return;want=d;tries=0;light()});addEventListener("resize",function(){if(want&&!pins.length){tries=0;light()}})})();</scr' + 'ipt>';
  var accFrame = null;
  var accNote = null;
  var accNoteSay = '';
  var accLight = null;
  window.addEventListener('message', function (e) {
    if (!accFrame || e.source !== accFrame.contentWindow || !e.data || typeof e.data.crewLit !== 'number') return;
    if (accNote) accNote.textContent = e.data.crewLit > 0 ? '' : accNoteSay;
  });
  function accChip(a) {
    if (sent['a:' + a.feature]) return el('span', { class: 'chip sent', text: sent['a:' + a.feature] === 'passed' ? Wk('a:' + a.feature, 'crew 已記下通過', '已送出通過，等收下', true) : Wk('a:' + a.feature, 'crew 已記下要改', '已送出要改，等收下', true) });
    var s = ACC[a.state] || ACC.waiting;
    return el('span', { class: 'chip ' + s[1], text: s[0] });
  }
  // QA's screenshots are the real screen and come first; the approved design, which the app may not match, comes last.
  function accModes(a) {
    var m = [];
    if (a.items.some(function (it) { return it.desktop; })) m.push(['desktop', 'QA 桌機']);
    if (a.items.some(function (it) { return it.phone; })) m.push(['phone', 'QA 手機']);
    if (a.items.some(function (it) { return it.api; })) m.push(['api', 'QA 呼叫的 API']);
    if (a.screens.length) m.push(['design', m.length ? '設計稿（核准時）' : '設計稿']);
    return m;
  }
  function litApi(text, fields) {
    var box = el('pre', { class: 'api' });
    var words = fields.filter(function (f) { return f; });
    if (!words.length) { box.textContent = text; return box; }
    var esc = words.map(function (w) { return w.replace(/[.*+?^$\x7b}()|[\]\\]/g, '\\$&'); });
    text.split(new RegExp('(' + esc.join('|') + ')')).forEach(function (part) {
      if (words.indexOf(part) >= 0) box.append(el('mark', { text: part })); else if (part) box.append(part);
    });
    return box;
  }
  function accStage(a, n) {
    var it = a.items[n];
    var modes = accModes(a);
    var mode = accMode[a.feature];
    if (!modes.some(function (m) { return m[0] === mode; })) mode = modes.length ? modes[0][0] : null;
    var wrap = el('div', { class: 'panel acc-stage' });
    if (!mode) return wrap;
    var bar = el('div', { class: 'views', role: 'group', 'aria-label': '看哪一個畫面' });
    modes.forEach(function (m) { bar.append(el('button', { type: 'button', 'aria-pressed': String(m[0] === mode), text: m[1], onclick: function () { accMode[a.feature] = m[0]; draw(); } })); });
    wrap.append(bar);
    var stage = el('div', { class: 'stage' });
    accFrame = null;
    accLight = null;
    accNote = el('p', { class: 'cap' });
    if (mode === 'design') {
      var shots = modes.some(function (m) { return m[0] === 'desktop' || m[0] === 'phone'; });
      accNoteSay = a.qa.app ? '設計稿上沒有標出這一件的位置：看下面的清單' + (shots ? '，或切到 QA 的截圖。' : '。') : '設計稿上沒有標出這一件的位置：看上面每一件的「怎麼看」。';
      if (shots) wrap.append(el('p', { class: 'cap', text: '這是核准時的設計稿，不是 app 的實際畫面；實際畫面看 QA 的截圖。' }));
      var d = a.screens[0];
      var f = el('iframe', { class: 'mock', sandbox: 'allow-scripts', title: d.id + ' ' + d.title + '（標出第 ' + (n + 1) + ' 件）', referrerpolicy: 'no-referrer' });
      var lightUp = function () { if (it && f.contentWindow) f.contentWindow.postMessage({ crewLight: it.criterion, n: n + 1 }, '*'); };
      f.addEventListener('load', lightUp);
      var put = function (h) { f.srcdoc = h + LIGHT; };
      var want = fileKey(d.id);
      if (html[d.id] !== undefined) put(html[d.id]);
      else fetch(d.file, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).then(function (j) {
        if (fileKey(d.id) !== want) return;
        html[d.id] = typeof j.html === 'string' ? j.html : '';
        htmlKey[d.id] = want;
        put(html[d.id]);
      }).catch(function () { f.replaceWith(el('div', { class: 'placeholder', text: '讀不到這份設計稿（' + d.file + '），' + W('重新整理整個網頁看看；還是一樣，在 Claude Code 對大腦說一聲。', '請大腦重新發佈這一頁。') })); });
      accFrame = f;
      accLight = lightUp;
      stage.append(f);
      wrap.append(stage);
      if (a.screens.length > 1) wrap.append(el('p', { class: 'cap', text: '這個功能還有其他畫面：' + a.screens.slice(1).map(function (s) { return s.id + ' ' + s.title; }).join('、') + '（在「設計稿」分頁看）。' }));
      wrap.append(accNote);
      return wrap;
    }
    if (mode === 'api') {
      var withApi = it && it.api ? it : a.items.filter(function (x) { return x.api; })[0];
      wrap.append(el('p', { class: 'cap', text: 'QA 送出的請求' }), litApi(withApi.api.request, []), el('p', { class: 'cap', text: '拿到的回應（要你看的欄位標出來了）' }), litApi(withApi.api.response, withApi.api.lit || []));
      return wrap;
    }
    var shotOf = function (x) { return x ? (mode === 'desktop' ? x.desktop : x.phone) : null; };
    var sh = shotOf(it) || shotOf(a.items.filter(function (x) { return shotOf(x); })[0]);
    var holder = el('div', { class: 'shot' });
    var img = el('img', { src: 'checks/' + sh.file, alt: 'QA 的' + (mode === 'desktop' ? '桌機' : '手機') + '截圖' });
    holder.append(img);
    var place = function () {
      Array.prototype.forEach.call(holder.querySelectorAll('.spot, .pin'), function (x) { x.remove(); });
      if (!sh.box || !img.naturalWidth) return;
      var k = img.clientWidth / img.naturalWidth;
      holder.append(el('div', { class: 'spot', style: 'left:' + sh.box.x * k + 'px;top:' + sh.box.y * k + 'px;width:' + sh.box.width * k + 'px;height:' + sh.box.height * k + 'px' }));
      holder.append(el('span', { class: 'pin', text: String(n + 1), style: 'left:' + sh.box.x * k + 'px;top:' + sh.box.y * k + 'px' }));
    };
    img.addEventListener('load', place);
    // One listener for the page: each draw replaces the last one's, so redraws do not pile them up.
    if (accResize) window.removeEventListener('resize', accResize);
    accResize = place;
    window.addEventListener('resize', place);
    stage.append(holder);
    wrap.append(stage);
    if (shotOf(it) !== sh) wrap.append(el('p', { class: 'cap', text: '第 ' + (n + 1) + ' 件沒有這個寬度的截圖，先顯示別件的。' }));
    return wrap;
  }
  // One thing's own pictures, small: its desktop and phone screenshots, or the API QA called. Pressed, the screen above shows it large.
  function accThumbs(a, it, i) {
    if (!a.qa.app) return null;
    var row = el('div', { class: 'thumbs', role: 'group', 'aria-label': '第 ' + (i + 1) + ' 件的截圖' });
    var show = function (mode) {
      return function () {
        accLit[a.feature] = i;
        accMode[a.feature] = mode;
        accFocus = true;
        draw();
      };
    };
    var cur = (accLit[a.feature] || 0) === i;
    // The view the screen above shows, as it picks it: the one pressed last, or the first this feature has.
    var modes = accModes(a);
    var shown = accMode[a.feature];
    if (!modes.some(function (m) { return m[0] === shown; })) shown = modes.length ? modes[0][0] : null;
    [['desktop', '桌機'], ['phone', '手機']].forEach(function (m) {
      var sh = it[m[0]];
      if (!sh || !sh.file) return;
      row.append(el('button', { type: 'button', class: 'thumb ' + m[0], 'aria-pressed': String(cur && shown === m[0]), 'aria-label': '放大第 ' + (i + 1) + ' 件的' + m[1] + '截圖', onclick: show(m[0]) },
        el('img', { src: 'checks/' + sh.file, alt: '', loading: 'lazy' }),
        el('span', { class: 'tl', text: m[1] })));
    });
    if (it.api) {
      var first = String(it.api.request || '').split('\n')[0];
      row.append(el('button', { type: 'button', class: 'thumb api', 'aria-pressed': String(cur && shown === 'api'), 'aria-label': '看第 ' + (i + 1) + ' 件 QA 呼叫的 API', onclick: show('api') },
        el('span', { class: 'tl', text: 'API' }),
        el('code', { text: first.length > 60 ? first.slice(0, 60) + '…' : first }),
        it.api.lit && it.api.lit.length ? el('span', { class: 'cap', text: '看：' + it.api.lit.join('、') }) : null));
    }
    if (!row.childNodes.length) return el('p', { class: 'cap thumbs-none', text: '這一件 QA 沒有附截圖。' });
    return row;
  }
  function accItems(a, n, ta) {
    var ol = el('ol', { class: 'items' });
    a.items.forEach(function (it, i) {
      var b = el('button', { type: 'button', class: 'it', 'aria-current': String(i === n), onclick: function () { accLit[a.feature] = i; draw(); } },
        el('span', { class: 'pin', text: String(i + 1) }),
        el('span', { class: 'ask', text: it.ask }),
        it.how ? el('span', { class: 'how' }, el('b', { text: '怎麼看：' }), it.how) : null,
        it.saw ? el('span', { class: 'sub', text: 'QA 看到：' + it.saw }) : null,
        el('span', { class: 'sub', text: it.criterion + (it.criterionText ? ' ' + it.criterionText : '') }));
      var li = el('li', {}, b);
      // Each thing to look at with its own pictures: pressed, the screen above shows it large, at that width.
      var thumbs = accThumbs(a, it, i);
      if (thumbs) li.append(thumbs);
      if (ta && (a.state === 'waiting' || a.state === 'again')) li.append(el('button', { type: 'button', class: 'fixit', text: '這項要改', onclick: function () {
        var head = '第 ' + (i + 1) + ' 件（' + it.ask + '）：';
        ta.value = (ta.value ? ta.value.replace(/\s+$/, '') + '\n' : '') + head;
        drafts['a:' + a.feature] = ta.value; codes['a:' + a.feature] = a.code; keep();
        ta.focus();
      } }));
      ol.append(li);
    });
    return ol;
  }
  function accActions(a, box) {
    var key = 'a:' + a.feature;
    var said = el('span', { class: 'said' });
    if (sent[key]) { said.textContent = Wk(key, 'crew 記下了；這一頁更新中…', '已送出，等 Claude Code 收下交給 crew；記好之後這一頁會更新。'); return { node: el('div', { class: 'act' }, said, again(key)) }; }
    if (a.state === 'passed') return { node: el('div', { class: 'act' }, accConfirm(a, {}), el('span', { class: 'said', text: '你通過了這個功能。' })) };
    if (a.state === 'fixing') return { node: el('div', { class: 'act' }, el('span', { class: 'said', text: 'Tech lead 照你說的開修正任務，排在還沒開工的任務前面；改好、QA 再看過之後，會回到這裡給你看。' })) };
    if (data.view) return { node: el('div', { class: 'act' }, el('span', { class: 'said', text: '在 Claude Code 右側面板總覽的「待你驗收」按通過或要改。' })) };
    var ta = el('textarea', { id: 'accept-' + a.feature, maxlength: '2000', placeholder: '要改的地方：哪一件、改成什麼。按上面的「這項要改」會先幫你寫好是第幾件。', 'aria-label': '要改的地方', oninput: function () { drafts[key] = ta.value; codes[key] = a.code; keep(); } });
    ta.value = drafts[key] || '';
    // What the person confirms themselves: each ticked before 通過, sent with it; 通過 waits for every one.
    var confirm = a.confirm || [];
    var ticks = accTicks[a.feature] || (accTicks[a.feature] = {});
    var pass = el('button', { type: 'button', class: 'primary', text: '通過', onclick: function () {
      var left = confirm.filter(function (c) { return !ticks[c.id]; });
      if (left.length) { said.textContent = '還有 ' + left.length + ' 項「你驗收時確認」沒有勾：' + left.map(function (c) { return c.id; }).join('、') + '。每一項都看過、沒問題就勾選；哪一項不行，就寫在下面按「要改」。'; return; }
      send(key, 'crew 驗收：通過 ' + a.feature + (confirm.length ? '\n確認：' + confirm.map(function (c) { return c.id; }).join('、') : ''), a.code, box, said, 'passed');
    } });
    var change = el('button', { type: 'button', text: '要改', onclick: function () {
      var w = ta.value.trim();
      if (w === '') { said.textContent = '要改的話，寫出要改什麼。'; ta.focus(); return; }
      send(key, 'crew 驗收：要改 ' + a.feature + '\n原話：' + w, a.code, box, said, 'changes');
    } });
    var act = el('div', { class: 'acc-act' }, accConfirm(a, ticks), el('div', { class: 'row' }, pass, el('span', { class: 'cap', text: confirm.length ? '每一件都看過、下面要你確認的每一項都勾好，就按通過。' : '每一件都看過、沒問題就按通過。' })), ta, el('div', { class: 'row' }, change, said));
    if (idle(said)) disable(act, true);
    return { node: act, ta: ta };
  }
  // The test cases the person set to confirm themselves when they accept: what to look at, each with its own tick.
  function accConfirm(a, ticks) {
    var confirm = a.confirm || [];
    if (!confirm.length) return null;
    var done = a.state === 'passed';
    var box = el('fieldset', { class: 'acc-confirm' }, el('legend', { text: '你驗收時確認（' + confirm.length + ' 項）' }),
      el('p', { class: 'cap', text: done ? '你通過這個功能時確認了這些。' : '這些 test case 沒有自動測試，要你自己確認：照步驟看過、和預期一樣就勾選。每一項都勾好才能按通過；哪一項不行，就寫在下面按「要改」。' }));
    confirm.forEach(function (c) {
      var id = 'tick-' + a.feature + '-' + c.id;
      var input = el('input', { type: 'checkbox', id: id, onchange: function () { ticks[c.id] = input.checked; } });
      input.checked = done ? !!c.ticked : !!ticks[c.id];
      if (done) input.disabled = true;
      var steps = el('ol', { class: 'steps' });
      (c.steps || []).forEach(function (st) { steps.append(el('li', { text: st })); });
      box.append(el('div', { class: 'tick' },
        el('label', { for: id }, input, el('b', { text: ' ' + c.id + ' ' }), c.title),
        c.steps && c.steps.length ? steps : null,
        el('p', { class: 'sub', text: '要看到：' + c.expected })));
    });
    return box;
  }
  // The page in the app, from the app's address the person set and the path QA found: one on that same site only.
  function pageHref(url, page) {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null;
    try {
      var base = new URL(url);
      if (typeof page !== 'string' || !/^\/(?!\/)[^\s\\]*$/.test(page)) return base.href;
      var u = new URL(page, base);
      return u.origin === base.origin ? u.href : base.href;
    } catch (e) { return null; }
  }
  function copyText(t, node, said) {
    var pick = function () {
      try { var r = document.createRange(); r.selectNodeContents(node); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); said.textContent = '已選取：按 ⌘C 或 Ctrl+C 複製'; } catch (e) {}
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { said.textContent = '已複製'; }, pick);
      else pick();
    } catch (e) { pick(); }
  }
  // Where to look, first on the card: the version QA looked at, and the page it is on, so the person finds the real screen.
  function accWhere(a) {
    var open = a.open || {};
    var where = a.where || {};
    var box = el('div', { class: 'acc-where', role: 'group', 'aria-label': '去哪裡看' }, el('h3', { text: '去哪裡看' }));
    var ver = el('div', { class: 'wv' }, el('p', { text: '這個功能在 crew 的分支上，還沒合回你平常用的分支' + (open.worktree ? '：要從 crew 的工作目錄啟動 app 才看得到。' : '。') }));
    if (open.worktree) {
      var dir = el('code', { text: open.worktree });
      var copied = el('span', { class: 'cap' });
      ver.append(el('p', {}, dir), el('div', { class: 'row' }, el('button', { type: 'button', text: '複製路徑', onclick: function () { copyText(open.worktreeAt || open.worktree, dir, copied); } }), copied));
    }
    box.append(el('div', { class: 'wrow' }, el('span', { class: 'wl', text: '哪個版本' }), ver));
    var pg = el('div', { class: 'wv' });
    var href = pageHref(open.url, where.page);
    if (where.page || where.menu) {
      var line = el('p', {});
      if (where.page) line.append(el('code', { text: where.page }));
      if (where.page && where.menu) line.append('：');
      if (where.menu) line.append(where.menu);
      pg.append(line);
    } else if (where.none) pg.append(el('p', { text: where.none }));
    else pg.append(el('p', { class: 'cap', text: 'QA 這一輪沒有寫這個功能在哪一頁：先照下面每一件的「怎麼看」找。' }));
    if (href) {
      var away = /^https?:\/\/(localhost|[a-z0-9-]+\.localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//i.test(href) && !/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(location.hostname);
      pg.append(el('div', { class: 'row' }, el('a', { class: 'btn', href: href, target: '_blank', rel: 'noopener noreferrer', text: where.page && href !== pageHref(open.url, '') ? '打開這一頁 ↗' : '打開 app ↗' }), away ? el('span', { class: 'cap', text: '這個連結只在跑 app 的那台電腦上打得開。' }) : null));
    }
    else if (!where.none) pg.append(el('p', { class: 'cap', text: 'crew 還不知道這個 app 的網址，所以這裡沒有連結。' + W('在 crew 網頁的「設定」填好 app 的網址和啟動指令，這裡就會變成連結；這一輪沒有截圖，app 設定好後 QA 會實際操作並補圖。', '在面板的「設定」填好 app 的網址和啟動指令，這裡就會變成連結；這一輪沒有截圖，app 設定好後 QA 會實際操作並補圖。') }));
    box.append(el('div', { class: 'wrow' }, el('span', { class: 'wl', text: '哪一頁' }), pg));
    return box;
  }
  function drawAccept(panel) {
    var order = { waiting: 0, again: 0, fixing: 1, passed: 2 };
    var list = (data.accept || []).slice().sort(function (x, y) { return order[x.state] - order[y.state]; });
    if (!list.some(function (a) { return a.feature === accOpen; })) accOpen = (list.filter(accWaits)[0] || list[0]).feature;
    var nav = el('nav', { class: 'nav', 'aria-label': '待你驗收的功能' });
    list.forEach(function (a) {
      nav.append(el('button', { type: 'button', 'aria-current': String(a.feature === accOpen), onclick: function () { accOpen = a.feature; draw(); recheck(); } },
        el('span', { class: 'id' }, a.feature, accChip(a)),
        el('span', { class: 't', text: a.title })));
    });
    var a = list.filter(function (x) { return x.feature === accOpen; })[0];
    var n = Math.min(accLit[a.feature] || 0, Math.max(0, a.items.length - 1));
    var detail = el('div', { class: 'detail' });
    var box = el('section', { 'aria-label': a.feature + ' ' + a.title });
    box.style.display = 'flex'; box.style.flexDirection = 'column'; box.style.gap = '14px';
    box.append(el('div', { class: 'head' }, el('h2', { text: a.feature + ' ' + a.title }), accChip(a), a.round > 1 ? el('span', { class: 'cap', text: '第 ' + a.round + ' 輪' }) : null));
    var qa = a.qa.app
      ? 'QA 用 crew 分支的版本把 app 開起來，用瀏覽器實際操作過（桌機 1440、手機 390）' + (a.qa.cases ? '，test case 通過 ' + a.qa.cases.passed + '/' + a.qa.cases.total : '') + (a.qa.errors ? '，瀏覽器有 ' + a.qa.errors + ' 個錯誤訊息' : '') + '。'
      : a.qa.unseen
      ? 'QA 這一輪沒有在 app 裡確認任何 test case：' + (a.qa.why || '這個功能的 test case 在 app 裡都沒辦法操作') + '。'
      : '這一輪沒有截圖（' + (a.qa.why || '那時還沒有設定 app 的啟動指令和網址') + '）' + (a.items.length ? '：下面是 QA 看過驗收條件和程式後，要你看的地方和怎麼看。' : '。') + (a.qa.unset ? W('在 crew 網頁的「設定」設定好怎麼開 app，QA 會實際操作、補上每一件的截圖。', '在面板的「設定」設定好怎麼開 app，QA 會實際操作、補上每一件的截圖。') : 'app 已經設定好：QA 會再實際操作一次，補上每一件的截圖。');
    box.append(el('p', { class: 'cap', text: qa }));
    box.append(accWhere(a));
    if (a.said || a.note || a.pm || (a.changed && a.changed.length)) {
      var q = el('div', { class: 'accq' });
      if (a.said) q.append(el('span', { class: 'said', text: '你上次說：「' + a.said + '」' }));
      if (a.changed && a.changed.length) q.append(el('span', { text: '這次改了：' + a.changed.join('；') }));
      if (a.pm && !a.note) q.append(el('span', { text: 'Tech lead 把你說的一部分轉給 PM，PM 說：' + a.pm }));
      if (a.note) q.append(el('span', { text: a.note }));
      box.append(q);
    }
    var acts = accActions(a, box);
    // QA's screenshots are the real screen: on top. Without them the screen is the approved design, which the app may not match: after the list, folded.
    if (a.items.length && a.qa.app) box.append(accStage(a, n));
    // Only a card that is theirs to look at now says 要你看的; one being changed or already passed names its list for what it was.
    var turn = a.state === 'waiting' || a.state === 'again';
    if (a.items.length || turn) box.append(el('h3', { text: (turn ? '要你看的 ' : a.state === 'fixing' ? '上一輪要你看的 ' : '你看過的 ') + a.items.length + ' 件' }));
    if (a.items.length) box.append(accItems(a, n, acts.ta)); else if (turn) box.append(el('p', { class: 'cap', text: 'QA 這一輪沒有列出要你看的地方。' }));
    if (a.items.length && !a.qa.app) {
      var st = accStage(a, n);
      var relight = accLight;
      if (st.childNodes.length) {
        var sc = a.screens[0];
        var dm = el('details', { class: 'mockd' }, el('summary', { id: 'mockd-' + a.feature, text: '設計稿' + (sc ? ' ' + sc.id + ' ' + sc.title : '') + '（核准時的樣子，不是 app 的實際畫面）' }), st);
        if (accMockOpen[a.feature]) dm.open = true;
        // Lit while folded, the design found nothing to show: opened, it is lit again.
        dm.addEventListener('toggle', function () { accMockOpen[a.feature] = dm.open; if (dm.open && relight) relight(); });
        box.append(dm);
      }
    }
    if (a.open && (a.open.url || a.open.start)) {
      var o = el('div', { class: 'text' });
      var lines = [];
      if (a.open.start) lines.push('啟動指令：' + a.open.start);
      if (a.open.url) lines.push('網址：' + a.open.url);
      if (a.open.accounts) lines.push('測試帳號在：' + a.open.accounts);
      o.textContent = lines.join('\n');
      box.append(el('details', {}, el('summary', { text: '想自己打開來操作' }), o));
    }
    box.append(acts.node);
    detail.append(box);
    panel.append(el('div', { class: 'review built' }, nav, detail));
    if (accFocus) {
      accFocus = false;
      var big = panel.querySelector('.acc-stage');
      var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (big && big.scrollIntoView) big.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
    }
  }

  // ---- Progress ----
  // crew works the lights out; the page only draws them. A station or a piece of one, opened, stays open through an update and the reload a new version brings (keep).
  var WORD = { doing: '正在做', part: '做了一部分', done: '完成', todo: '還沒開始' };
  var STEP = { building: '在做', fixing: '修改中', review: 'Tech lead review 中', waiting: '等 Tech lead review', changes: 'review 要修改，等全端', merging: 'review 通過，等 crew 合回' };
  var LANE = { ui: '畫面', be: '後端', infra: '基礎建設', none: '還沒分層' };
  var pview = { st: null, sel: null, hl: null };
  var nowOpen = false;
  var opened = {};
  function P() { return data.progress; }
  function byId(list, id) { return list.filter(function (x) { return (x.id || x.key) === id; })[0]; }
  function task(id) { return byId(P().tasks, id); }
  function station(k) { return byId(P().stations, k); }
  function item(k) { var found = null; P().stations.forEach(function (s) { s.items.forEach(function (it) { if (it.key === k) found = it; }); }); return found; }
  function light(ids) {
    var ts = ids.map(task).filter(Boolean);
    if (ts.length === 0) return 'todo';
    if (ts.every(function (t) { return t.state === 'done'; })) return 'done';
    if (ts.some(function (t) { return t.state === 'doing'; })) return 'doing';
    return ts.some(function (t) { return t.state === 'done'; }) ? 'part' : 'todo';
  }
  function doneOf(ids) { return ids.map(task).filter(function (t) { return t && t.state === 'done'; }).length; }
  function count(ids) { return doneOf(ids) + '/' + ids.length; }
  // Which builder is on it: several may build side by side.
  function taskWord(t) { return t.state === 'done' ? 'review 通過' : t.state === 'todo' ? '還沒開始' : t.step === 'building' || t.step === 'fixing' ? (t.by || '全端') + STEP[t.step] : STEP[t.step] || '正在做'; }
  function stLabel(k) { var s = station(k); return k === 'base' ? '地基' : k === 'launch' ? '上線前' : s ? '第 ' + s.n + ' 站' : k; }
  function stFull(k) { var s = station(k); return k === 'base' ? '地基：開工前的共用工作' : k === 'launch' ? '上線前要好的事' : s ? '第 ' + s.n + ' 站「' + s.name + '」' : k; }
  function check() {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'ck'); svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('width', '12'); svg.setAttribute('height', '12'); svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M3.5 8.5l3 3 6-7'); path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '2.4'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
    return svg;
  }
  function dot() { return el('i', { class: 'dotp', 'aria-hidden': 'true' }); }
  function chip(st, ids, word) { return el('span', { class: 'chip ' + st, text: (word || (st === 'done' ? '完成' : WORD[st])) + (ids && ids.length ? ' ' + count(ids) : '') }); }
  // A <details> keeps whether the person opened it through a redraw.
  function fold(key, open, summary) {
    var d = el('details', { 'data-key': key }, summary);
    d.open = opened[key] !== undefined ? opened[key] : !!open;
    d.addEventListener('toggle', function () { opened[key] = d.open; keep(); });
    return d;
  }
  function go(st, sel, hl) {
    tab = 'progress';
    pview = { st: st, sel: sel || null, hl: hl || null };
    draw();
    var row = hl ? document.querySelector('[data-row="' + hl + '"]') : null;
    if (row && row.scrollIntoView) row.scrollIntoView({ block: 'center' });
    else if (onScreenTop(main) < 0) main.scrollIntoView({ block: 'start' });
  }
  // On crew's web page the frame is as tall as the page, so the detail does not stay in view: a pick low in a long list scrolls up to it.
  function showDetail() {
    if (!WEB) return;
    var dt = document.querySelector('.review > .detail');
    if (dt && onScreenTop(dt) < 0) dt.scrollIntoView({ block: 'start' });
  }
  // Where an element's top is on the person's screen: in crew's web page this page is as tall as its content, and the page around it scrolls.
  function onScreenTop(e) {
    var t = e.getBoundingClientRect().top;
    try { if (window.frameElement) t += window.frameElement.getBoundingClientRect().top; } catch (x) {}
    return t;
  }
  function openTask(id) { var t = task(id); if (t) go(t.station, null, id); }

  function top() {
    var p = P();
    var cur = p.stations.filter(function (s) { return s.state === 'doing'; })[0];
    var next = cur ? null : p.stations.filter(function (s) { return s.state !== 'done'; })[0];
    var stDone = p.stations.filter(function (s) { return s.state === 'done'; }).length;
    var box = el('div', { class: 'top' });
    box.append(el('div', { class: 'where' },
      el('strong', { text: cur ? '現在在' + stFull(cur.key) : next ? '下一站是' + stFull(next.key) : '全部完成' }),
      el('span', { class: 'cap', text: '完成 ' + p.done + '/' + p.total + ' 件任務，' + p.stations.length + ' 站完成 ' + stDone + ' 站' })));
    var bars = el('div', { class: 'bars' });
    var labels = el('div', { class: 'bar-labels' });
    p.stations.forEach(function (s) {
      var w = String(Math.max(s.tasks.length, 1));
      var b = el('button', { type: 'button', class: 'bseg ' + s.state, 'aria-label': stFull(s.key) + '，' + WORD[s.state] + ' ' + count(s.tasks), title: stFull(s.key) + '：' + WORD[s.state] + ' ' + count(s.tasks), onclick: function () { go(s.key); } }, el('i'));
      b.style.setProperty('--w', w);
      b.style.setProperty('--f', (s.tasks.length ? s.done / s.tasks.length * 100 : 0) + '%');
      bars.append(b);
      var l = el('span', { class: cur && cur.key === s.key ? 'cur' : '', text: s.n });
      l.style.setProperty('--w', w);
      labels.append(l);
    });
    box.append(el('div', { class: 'strip', role: 'group', 'aria-label': '整條路線，一格是一站，寬度是任務數' }, bars, labels));
    var active = p.tasks.filter(function (t) { return t.state === 'doing'; });
    var now = el('div', { class: 'now' }, el('h3', { text: '現在在做（' + active.length + ' 件）' }));
    if (active.length === 0) now.append(el('p', { class: 'cap', text: '現在沒有任務在做。' }));
    (nowOpen ? active : active.slice(0, 3)).forEach(function (t) {
      now.append(el('button', { type: 'button', class: 'nowrow', title: t.id + ' ' + t.title, onclick: function () { openTask(t.id); } },
        dot(), el('span', { class: 'id', text: t.id }), el('span', { class: 'nm', text: t.title }), el('span', { class: 'who', text: taskWord(t) })));
    });
    if (active.length > 3) now.append(el('button', { type: 'button', class: 'linkish morebtn', text: nowOpen ? '收起' : '還有 ' + (active.length - 3) + ' 件', onclick: function () { nowOpen = !nowOpen; draw(); } }));
    box.append(now);
    box.append(el('p', { class: 'cap', text: '有新進度時 crew 會更新這一頁；開著的話 20 秒內換新。' }));
    return box;
  }
  function legend() {
    var box = el('div', { class: 'legend', 'aria-label': '圖例' });
    ['doing', 'part', 'done', 'todo'].forEach(function (k) { box.append(el('span', {}, el('i', { class: 'sw ' + k, 'aria-hidden': 'true' }), WORD[k])); });
    return box;
  }
  function pill(it) {
    var b = el('button', { type: 'button', class: 'pill ' + it.state, title: it.name + '：' + WORD[it.state], onclick: function () { go(it.key.split(':')[0], it.key); } });
    if (it.state === 'done') b.append(check()); else if (it.state === 'doing') b.append(dot());
    b.append(el('span', { class: 'tx', text: it.name }));
    if ((it.state === 'part' || it.state === 'doing') && it.tasks.length > 1) b.append(el('span', { class: 'fr', text: count(it.tasks) }));
    return b;
  }
  function lanesOf(s) {
    var dl = el('dl', { class: 'lanes' });
    ['ui', 'be', 'infra', 'none'].forEach(function (l) {
      var its = s.items.filter(function (it) { return it.lane === l; });
      if (l === 'none' && its.length === 0) return;
      var dd = el('dd');
      if (its.length) its.forEach(function (it) { dd.append(pill(it)); }); else dd.append(el('span', { class: 'nolane', text: '這一站不用' }));
      dl.append(el('dt', { text: LANE[l] }), dd);
    });
    return dl;
  }
  function reqList(ids) {
    var ol = el('ol', { class: 'rqlist' });
    ids.forEach(function (id) {
      var r = byId(P().requirements, id);
      if (r) ol.append(el('li', { class: 'rq' }, el('span', { class: 'rn', text: r.label || '' }), el('span', { class: 'rt', text: r.text })));
    });
    return ol;
  }
  function stationCard(s) {
    var card = el('div', { class: 'card' },
      el('div', { class: 'sh' }, el('span', { class: 'n', text: s.n }), el('h3', { text: s.name }), chip(s.state, s.tasks),
        el('span', { class: 'acts' }, el('button', { type: 'button', class: 'btn', text: '看這一站', onclick: function () { go(s.key); } }))));
    if (s.gain) card.append(el('p', { class: 'gain' }, el('b', { text: '做完你可以' }), s.gain));
    if (s.reqs.length) {
      var rb = fold('rb:' + s.key, false, el('summary', { text: (s.reqLabel || '需求') + '（' + s.reqs.length + ' 條）' }));
      rb.className = 'reqbox';
      rb.append(reqList(s.reqs));
      card.append(rb);
    }
    if (s.tasks.length) card.append(lanesOf(s)); else card.append(el('p', { class: 'cap', text: 'Tech lead 還沒替這一站排任務。' }));
    if (s.needs.length) card.append(el('p', { class: 'uses', text: '要先有：' + s.needs.map(function (n) { return n.name + '（' + stLabel(n.station) + '，' + WORD[n.state] + '）'; }).join('、') }));
    return el('li', { class: 'stn ' + s.state }, el('span', { class: 'knob', 'aria-hidden': 'true' }, s.state === 'done' ? check() : null), card);
  }
  function route() {
    var ol = el('ol', { class: 'route', 'aria-label': '開發路線，照開發順序' });
    P().stations.forEach(function (s) { ol.append(stationCard(s)); });
    return ol;
  }

  function fact(dl, k, v) { dl.append(el('dt', { text: k }), typeof v === 'string' ? el('dd', { text: v }) : el('dd', {}, v)); }
  function statusText(t) {
    if (t.state === 'done') return 'review 通過' + (t.sha ? '，commit ' + t.sha : '');
    if (t.state === 'todo') return '還沒開始：前面的任務 review 通過後，全端照編號接著做';
    return taskWord(t) + (t.sha ? '，commit ' + t.sha : '，還沒有 commit') + (t.notes ? '。Tech lead：' + t.notes : '');
  }
  function taskRows(ids, hit) {
    var ul = el('ul', { class: 'tasks' });
    ids.map(task).filter(Boolean).forEach(function (t) {
      var more = el('div', { class: 'more' }, el('span', { class: 'full', text: t.title }));
      if (t.detail) more.append(el('span', { class: 'spec', text: t.detail }));
      var dl = el('dl', { class: 'facts' });
      var cs = t.criteria.map(function (c) { var x = byId(P().criteria, c); return c + (x ? ' ' + x.text : ''); });
      fact(dl, '滿足', cs.length ? cs.join('\n') : '不直接對應驗收條件；是後面共用的工作');
      dl.lastChild.style.whiteSpace = 'pre-wrap';
      fact(dl, '要等', t.after.length ? t.after.map(function (a) { var w = task(a); return a + (w ? '（' + taskWord(w) + '）' : ''); }).join('、') : '不用等');
      var touch = el('span');
      if (t.touches.length) t.touches.forEach(function (f, i) { if (i) touch.append(' '); touch.append(el('code', { text: f })); }); else touch.textContent = 'Tech lead 還沒寫';
      fact(dl, '會動到', touch);
      var it = item(t.item);
      fact(dl, '做哪一塊', it ? it.name + '（' + LANE[it.lane] + '）' : '');
      if (t.size) fact(dl, '大小', t.size);
      fact(dl, '狀態', statusText(t));
      more.append(dl);
      var d = fold('t:' + t.id, pview.hl === t.id, el('summary', {}, el('span', { class: 'id', text: t.id }), el('span', { class: 'tt', text: t.title }), el('span', { class: 'st ' + t.state, text: taskWord(t) })));
      if (pview.hl === t.id) d.open = true;
      d.append(more);
      ul.append(el('li', { 'data-row': t.id, class: hit && hit.indexOf(t.id) >= 0 ? 'hit' : '' }, d));
    });
    return ul;
  }
  function allTasks(s, hit) {
    var box = el('div', { class: 'pbox' }, el('h4', { text: '這一站的全部任務（' + s.tasks.length + ' 件）' }));
    [['doing', '正在做'], ['todo', '還沒開始'], ['done', '完成']].forEach(function (g) {
      var list = s.tasks.filter(function (id) { var t = task(id); return t && t.state === g[0]; });
      if (list.length) box.append(el('div', { class: 'tgroup' }, el('h4', { text: g[1] + '（' + list.length + '）' }), taskRows(list, hit)));
    });
    if (!s.tasks.length) box.append(el('p', { class: 'cap', text: '還沒有任務。' }));
    return box;
  }
  function selPanel(s) {
    var it = pview.sel ? item(pview.sel) : null;
    if (!it) return el('div', { class: 'pbox' }, el('h4', { text: stFull(s.key) }), el('p', { class: 'cap', text: '點左邊的一塊，看它要做什麼、做到哪。' }));
    var box = el('div', { class: 'pbox' }, el('div', { class: 'dhead' }, chip(it.state, null), el('span', { class: 'cap', text: LANE[it.lane] })), el('h3', { text: it.name }));
    var dl = el('dl', { class: 'facts' });
    fact(dl, '排在', stFull(it.key.split(':')[0]));
    fact(dl, '做到哪', (it.state === 'done' ? '完成' : WORD[it.state]) + ' ' + count(it.tasks));
    box.append(dl, taskRows(it.tasks, null));
    return box;
  }
  function screenOf(s) {
    var ds = (data.designs || []).filter(function (d) { return d.feature === s.key && d.kind === 'screen'; });
    return ds.filter(function (d) { return d.state === 'approved' && d.file; })[0] || (ds.length ? { pending: true } : null);
  }
  function detail() {
    var s = station(pview.st);
    var head = el('div', { class: 'dt-head' }, el('button', { type: 'button', class: 'back', text: '回到路線', onclick: function () { pview = { st: null, sel: null, hl: null }; draw(); } }), el('h3', { text: stFull(s.key) }), chip(s.state, s.tasks), s.reqLabel ? el('span', { class: 'cap', text: s.reqLabel }) : null);
    var box = el('div', { class: 'sdetail' }, head);
    if (s.gain) box.append(el('p', { class: 'gain' }, el('b', { text: '做完你可以' }), s.gain));
    var c = { done: 0, doing: 0, todo: 0 };
    s.tasks.forEach(function (id) { var t = task(id); if (t) c[t.state]++; });
    box.append(el('p', { class: 'scope', text: '這是這一站的全部，不只正在做的：' + s.tasks.length + ' 件任務，完成 ' + c.done + '、正在做 ' + c.doing + '、還沒開始 ' + c.todo + '。' }));
    if (s.reqs.length || s.criteria.length) {
      var acs = s.criteria.map(function (id) { return byId(P().criteria, id); }).filter(Boolean);
      var met = acs.filter(function (a) { return a.state === 'done'; }).length;
      var reqs = fold('rq:' + s.key, true, el('summary', {}, '這一站要做到的需求', el('span', { class: 'cap', text: (s.reqLabel ? s.reqLabel + '，' : '') + s.reqs.length + ' 條；驗收條件 ' + acs.length + ' 條，完成 ' + met + ' 條' })));
      reqs.className = 'reqs';
      if (s.reqs.length) reqs.append(reqList(s.reqs));
      if (acs.length) {
        var ul = el('ul', { class: 'acs' });
        acs.forEach(function (a) {
          var by = el('span', { class: 'by' }, '由');
          if (a.tasks.length) a.tasks.forEach(function (id) { var t = task(id); by.append(el('button', { type: 'button', class: 'tref ' + (t ? t.state : 'todo'), text: id, title: t ? t.title + '：' + taskWord(t) : id, onclick: function () { openTask(id); } })); });
          else by.append('（還沒有任務）');
          by.append('做；QA 測試案例 ' + a.cases + ' 條');
          ul.append(el('li', { class: 'ac' }, chip(a.state, null), el('span', {}, el('span', { class: 'id', text: a.id }), ' ' + a.text), by));
        });
        reqs.append(el('h4', { text: '驗收條件（PM 寫的）' }), ul);
      }
      // A draft of the PRD shows its requirements in its own tab: the requirements tab is not there to go to.
      if (s.reqs.length && !data.draft) reqs.append(el('p', { class: 'cap' }, '需求是 PRD 原文。', el('button', { type: 'button', class: 'linkish', text: '在「PRD 需求」看這幾條', onclick: function () { tab = 'reqs'; flashReq = s.reqs[0]; draw(); } })));
      box.append(reqs);
    }
    var canvas = el('div', { class: 'canvas' });
    var sc = screenOf(s);
    var ui = [];
    s.items.forEach(function (it) { if (it.lane === 'ui') ui = ui.concat(it.tasks); });
    if (sc && sc.pending) canvas.append(el('div', { class: 'sec' }, el('p', { class: 'cap', text: '這一站的畫面設計稿還沒核准，在「設計稿」分頁。' })));
    else if (sc) {
      var st = ui.length ? light(ui) : 'todo';
      var lit = el('div', { class: 'lit ' + st }, el('span', { class: 'rtag', text: '整頁：' + (ui.length ? (st === 'done' ? '完成' : WORD[st]) + ' ' + count(ui) : '畫面還沒排任務') }), frame(sc));
      canvas.append(el('div', { class: 'sec' }, el('div', { class: 'sec-head' }, el('h4', { text: '畫面：' + sc.title + '（' + sc.id + '）' }), el('span', { class: 'cap', text: 'UI/UX 的設計稿；外框是這一站畫面工作的狀態，整頁先算一塊' })), el('div', { class: 'ground' }, lit)));
    } else if (s.kind !== 'feature') canvas.append(el('div', { class: 'sec' }, el('p', { class: 'cap', text: s.key === 'base' ? '這一站沒有畫面，是後面每一站共用的工作。' : '這一站沒有畫面，是正式上線前一定要好的工作。' })));
    var cards = el('div', { class: 'icards' });
    s.items.forEach(function (it) {
      cards.append(el('button', { type: 'button', class: 'icard ' + it.state + (pview.sel === it.key ? ' sel' : ''), onclick: function () { pview.sel = it.key; pview.hl = null; draw(); } },
        el('span', { class: 'layer', text: LANE[it.lane] }), el('span', { class: 'nm', text: it.name }), el('span', { class: 'ct', text: (it.state === 'done' ? '完成' : WORD[it.state]) + ' ' + count(it.tasks) })));
    });
    canvas.append(el('div', { class: 'sec' }, el('div', { class: 'sec-head' }, el('h4', { text: '這一站要做的每一塊' }), el('span', { class: 'cap', text: '同一塊的任務合在一起' })), s.items.length ? cards : el('p', { class: 'cap', text: '還沒有任務。' })));
    var it = pview.sel ? item(pview.sel) : null;
    var hit = it ? it.tasks : pview.hl ? [pview.hl] : null;
    box.append(el('div', { class: 'dt-grid' }, canvas, el('div', { class: 'sside' }, selPanel(s), allTasks(s, hit))));
    return box;
  }
  function drawProgress(panel) {
    if (pview.st && !station(pview.st)) pview = { st: null, sel: null, hl: null };
    var box = el('div', { class: 'pm' }, top(), legend(), pview.st ? detail() : route());
    panel.append(box);
  }

  // The PRD's requirements, each with the station it is on and how far it got.
  var flashReq = null;
  function drawReqs(panel) {
    var box = el('div', { class: 'pm prdview' }, el('p', { class: 'scope', text: 'PRD 的每一條需求，標出排在哪一站、做到哪；點站名回到進度圖的那一站。' }));
    var sections = [], at = {};
    P().requirements.forEach(function (r) {
      var k = r.gone ? '已不在現在的 PRD' : r.section || '需求';
      if (at[k] === undefined) { at[k] = sections.length; sections.push({ name: k, list: [] }); }
      sections[at[k]].list.push(r);
    });
    var flash = null;
    sections.forEach(function (sec) {
      var ol = el('ol', { class: 'rqlist' });
      sec.list.forEach(function (r) {
        var where = el('p', { class: 'at' });
        r.stations.forEach(function (k) { where.append(el('button', { type: 'button', class: 'jump', text: stFull(k), onclick: function () { go(k); } })); });
        if (r.dropped !== undefined) where.append(el('span', { class: 'chip todo', text: '移出範圍：' + r.dropped }));
        else if (r.gone) where.append(el('span', { class: 'chip todo', text: '已不在現在的 PRD' + (r.was ? '（原本是需求 ' + r.was + '）' : '') }));
        else if (!r.stations.length) where.append(el('span', { class: 'chip todo', text: '還沒有排進任何一站' }));
        else where.append(el('span', { class: 'chip ' + r.state, text: (r.state === 'done' ? '完成' : WORD[r.state]) + ' ' + r.done + '/' + r.total }));
        var li = el('li', { class: 'rq' + (flashReq === r.id ? ' flash' : ''), id: 'req-' + r.id }, el('span', { class: 'rn', text: r.label || '' }), el('div', { class: 'rt' }, el('p', { text: r.text }), where));
        if (flashReq === r.id) flash = li;
        ol.append(li);
      });
      box.append(el('section', { class: 'prdsec' }, el('h3', { text: sec.name }), ol));
    });
    panel.append(box);
    if (flash && flash.scrollIntoView) setTimeout(function () { flash.scrollIntoView({ block: 'center' }); }, 0);
    flashReq = null;
  }

  // ---- Tabs ----
  function accWaits(a) { return (a.state === 'waiting' || a.state === 'again') && !sent['a:' + a.feature]; }
  function waiting() {
    var n = { prd: 0, designs: 0, questions: 0, accept: 0 };
    (data.accept || []).forEach(function (a) { if (accWaits(a)) n.accept++; });
    if (data.draft && data.draft.state === 'confirm' && !sent.prd) n.prd = 1;
    data.designs.forEach(function (d) { if (d.state === 'waiting' && !sent['d:' + d.id]) n.designs++; });
    data.questions.forEach(function (q) { if (q.state === 'open' && !sent['q:' + q.id]) { if (data.draft && q.draft === true) n.prd++; else n.questions++; } });
    return n;
  }
  function tabs() {
    var list = [];
    if (data.progress) list.push(['progress', '進度圖']);
    if ((data.accept || []).length) list.push(['accept', '待你驗收']);
    if (data.draft) list.push(['prd', 'PRD 草稿']);
    else if (data.progress) list.push(['reqs', 'PRD 需求']);
    if (data.designs.length) list.push(['designs', '設計稿']);
    if (data.questions.some(function (q) { return !(data.draft && q.draft === true); })) list.push(['questions', '問題']);
    return list;
  }
  // ---- Sent, until crew records it ----
  // A comment the page sends does not always reach Claude Code, even an idle one: past this, the page says what to do.
  var LATE_MS = 120000;
  function pending() { return Object.keys(sentAt); }
  function late(key) { return sentAt[key] !== undefined && Date.now() - sentAt[key].at >= LATE_MS; }
  // The item a key is about while it still waits on the person, with that code when one is given.
  function still(key, code) {
    var id = key.slice(2);
    if (key.charAt(0) === 'a') {
      var a = (data.accept || []).filter(function (x) { return x.feature === id; })[0];
      return a && (a.state === 'waiting' || a.state === 'again') && (code === undefined || a.code === code) ? a : null;
    }
    var item = key === 'prd' ? data.draft : key.charAt(0) === 'q' ? data.questions.filter(function (q) { return q.id === id; })[0] : data.designs.filter(function (d) { return d.id === id; })[0];
    var open = key === 'prd' ? 'confirm' : key.charAt(0) === 'q' ? 'open' : 'waiting';
    return item && item.state === open && (code === undefined || item.code === code) ? item : null;
  }
  // What data.json now shows decided, or changed since the send or the typing, waits no more.
  function settle() {
    // A page for reading shows nothing as sent from it: what is still to decide is decided in the pane.
    if (data.view) { pending().forEach(function (key) { delete sentAt[key]; delete sent[key]; delete stillWorking[key]; }); lateNo = {}; }
    Object.keys(lateNo).forEach(function (key) { if (!still(key, lateNo[key].code)) delete lateNo[key]; });
    pending().forEach(function (key) {
      if (!still(key, sentAt[key].code)) { delete sentAt[key]; delete sent[key]; delete stillWorking[key]; }
    });
    Object.keys(codes).forEach(function (key) {
      if (!still(key, codes[key])) { delete drafts[key]; delete picked[key]; delete codes[key]; }
    });
  }
  // A new version of the page reloads it, even while the person is deciding: what they typed, picked
  // or sent and crew has not recorded is kept in this browser, for the same item with the same code.
  // Each artifact has its own browser storage: one key serves the page whatever its PRD is called.
  var STORE = 'crew-decide';
  function keep() {
    if (data === null) return;
    var out = {};
    Object.keys(drafts).concat(Object.keys(picked), Object.keys(sent)).forEach(function (key) {
      var item = out[key] ? null : still(key, sentAt[key] ? sentAt[key].code : codes[key]);
      if (!item) return;
      if (codes[key] === undefined) codes[key] = item.code;
      var x = { code: sentAt[key] ? sentAt[key].code : codes[key] };
      if (drafts[key]) x.draft = drafts[key];
      if (typeof picked[key] === 'number') x.picked = picked[key];
      if (sent[key]) { x.sent = sent[key]; x.at = sentAt[key].at; if (stillWorking[key]) x.working = stillWorking[key]; }
      if (x.draft || x.picked !== undefined || x.sent) out[key] = x;
    });
    try { localStorage.setItem(STORE, JSON.stringify({ items: out })); } catch (e) {}
    // What is on screen comes back after the reload a new version brings, in this tab alone: the tab, the design, the
    // progress station and piece, and what is unfolded. Opened afresh, the page starts where it starts.
    var view = { tab: tab, open: open, st: pview.st, sel: pview.sel, hl: pview.hl, opened: opened, now: nowOpen, acc: accOpen };
    try { sessionStorage.setItem(STORE, JSON.stringify(view)); } catch (e) {}
  }
  function restore() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) {}
    var view = null;
    try { view = JSON.parse(sessionStorage.getItem(STORE) || 'null'); } catch (e) {}
    if (view !== null && typeof view === 'object') {
      if (typeof view.tab === 'string') tab = view.tab;
      if (typeof view.open === 'string') open = view.open;
      var at = function (x) { return typeof x === 'string' ? x : null; };
      pview = { st: at(view.st), sel: at(view.sel), hl: at(view.hl) };
      if (view.opened && typeof view.opened === 'object') Object.keys(view.opened).slice(0, 300).forEach(function (k) { if (typeof view.opened[k] === 'boolean') opened[k] = view.opened[k]; });
      nowOpen = view.now === true;
      if (typeof view.acc === 'string') accOpen = view.acc;
    }
    if (saved === null || typeof saved !== 'object') return;
    var items = saved.items && typeof saved.items === 'object' ? saved.items : {};
    Object.keys(items).forEach(function (key) {
      var x = items[key];
      if (!x || typeof x.code !== 'string' || !still(key, x.code)) return;
      codes[key] = x.code;
      if (typeof x.draft === 'string') drafts[key] = x.draft;
      if (typeof x.picked === 'number') picked[key] = x.picked;
      if (x.sent) {
        sent[key] = x.sent;
        sentAt[key] = { at: typeof x.at === 'number' ? x.at : Date.now(), code: x.code };
        if (x.working === true || (typeof x.working === 'string' && x.working.length <= 40)) stillWorking[key] = x.working;
      }
    });
  }
  // crew's end of a decision it was still working on when the page stopped waiting: done, the item says recorded until
  // the page shows it; not done, the item can be decided again and crew's words say why.
  function crewLate(id, ok, text) {
    var key = Object.keys(stillWorking).filter(function (k) { return stillWorking[k] === id; })[0];
    if (key === undefined) return;
    delete stillWorking[key];
    if (!ok) {
      lateNo[key] = { text: String(text).slice(0, 400) || 'crew 沒有記下這個決定。', code: sentAt[key] ? sentAt[key].code : codes[key] };
      delete sent[key];
      delete sentAt[key];
    }
    if (data === null) return;
    keep();
    draw();
  }
  // A send no update has shown recorded for two minutes can be made again: what was typed is still there.
  function again(key) {
    if (!late(key)) return null;
    return el('button', { type: 'button', text: '重新決定', onclick: function () { delete sent[key]; delete sentAt[key]; delete stillWorking[key]; draw(); } });
  }
  function tally() {
    var n = waiting();
    var total = n.prd + n.designs + n.questions + n.accept;
    var m = pending().length;
    var parts = [];
    if (total) parts.push('等你決定 ' + total + ' 件');
    // On crew's web page: sent and still worked on, sent and no result for two minutes, or recorded and on its way to this page.
    var noResult = pending().filter(function (k) { return stillWorking[k] && late(k); }).length;
    var working = pending().filter(function (k) { return stillWorking[k] && !late(k); }).length;
    if (m) parts.push(W(noResult ? '已送出 ' + m + ' 件，' + noResult + ' 件還沒有結果' : working ? '已送出 ' + m + ' 件，crew 處理中' : 'crew 已記下 ' + m + ' 件，這一頁更新中', '已送出 ' + m + ' 件，等 Claude Code 收下'));
    if (!parts.length) parts.push('現在沒有等你決定的事');
    document.getElementById('counts').textContent = parts.join(' · ') + ' · 更新於 ' + data.at;
    var slow = pending().filter(function (k) { return late(k) && !stillWorking[k]; }).length;
    if (data.view) document.getElementById('foot').textContent = '這一頁由 crew 產生，只給你看：要決定的事請在 Claude Code 右側面板「待你決定」做。';
    var lost = Object.keys(lateNo).map(function (k) { return lateNo[k].text; });
    notice.textContent = data.view ? VIEW : channel() || (lost.length ? lost.join(' ') + '（那一項可以再決定一次。）' : '') || (noResult && WEB ? '有 ' + noResult + ' 件送出超過兩分鐘，crew 還沒說結果：在那一項按［重新決定］再送一次。' : '') || (slow && WEB ? '有 ' + slow + ' 件 crew 記下超過兩分鐘，這一頁還沒顯示：重新整理整個網頁看看；還是一樣，在 Claude Code 對大腦說一聲。' : slow ? '有 ' + slow + ' 件送出超過兩分鐘，這一頁還沒更新：這一頁的留言不一定送得到 Claude Code，它閒著時也可能沒收到。在 Claude Code 右側面板「待你決定」按［我在頁面上決定好了］，或對 Claude Code 說一句話，它會先讀這一頁的留言再交給 crew。決定已經留言在這一頁，先不用再送；大腦在留言下回覆說 crew 沒收，再按那一項的［重新決定］。' : '');
  }
  function shape(j) {
    var p = j.progress && Array.isArray(j.progress.stations) && Array.isArray(j.progress.tasks) ? j.progress : null;
    // On crew's web page the person always decides here: the pane's choice is the claude.ai page's alone.
    return { prd: String(j.prd || ''), at: String(j.at || ''), draft: j.draft || null, designs: j.designs || [], questions: j.questions || [], progress: p, accept: Array.isArray(j.accept) ? j.accept : [], view: !WEB && j.view === true };
  }
  // New data from crew, however it was read: what was read of a draft or a mockup that changed since is dropped with it, so what
  // the page shows is always the version a decision on it names (crew's web page is not loaded again for a new version).
  function take(j) {
    var next = shape(j);
    if (JSON.stringify(next) === JSON.stringify(data)) return;
    var now = {};
    (next.designs || []).forEach(function (d) { now[d.id] = d.code + ':' + (d.stamp || ''); });
    Object.keys(html).forEach(function (id) { if (htmlKey[id] !== now[id]) { delete html[id]; delete htmlKey[id]; } });
    if (!data.draft || !next.draft || data.draft.code !== next.draft.code) prdText = null;
    data = next;
    settle();
    redraw();
  }
  // crew's web page names one thing to show, for a press on crew's pane: its tab, and the card of that number.
  var showWant = null;
  function crewShow(m) {
    showWant = m;
    if (data) showNow();
  }
  function showNow() {
    var m = showWant;
    showWant = null;
    if (!m || !data) return;
    var want = typeof m.tab === 'string' ? m.tab : null;
    var id = typeof m.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(m.id) ? m.id : null;
    // The brain's question on its draft sits on the draft's tab.
    var q = id ? data.questions.filter(function (x) { return x.id === id; })[0] : null;
    if (want === 'questions' && q && data.draft && q.draft === true) want = 'prd';
    if (want === 'designs' && id && data.designs.some(function (d) { return d.id === id; })) open = id;
    if (want === 'accept' && id && (data.accept || []).some(function (a) { return a.feature === id; })) accOpen = id;
    if (want && tabs().some(function (t) { return t[0] === want; })) tab = want;
    draw();
    var target = null;
    if (id && (want === 'questions' || want === 'prd')) target = main.querySelector('section[aria-label="' + id + '"]');
    if (!target && (want === 'designs' || want === 'accept') && tab === want) target = main.querySelector('section');
    if (!target && want === 'prd' && tab === 'prd') target = main.querySelector('.box');
    var at = target || (tabsBox.hidden ? main : tabsBox);
    if (at.scrollIntoView) setTimeout(function () { at.scrollIntoView({ block: 'start' }); }, 0);
    if (target) {
      target.classList.add('shown');
      setTimeout(function () { target.classList.remove('shown'); }, 2600);
    }
  }
  // crew says the page's data changed (web): read it now.
  function reload() {
    if (data === null) return;
    fetch('data.json', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).then(take).catch(function () {});
  }
  // While something waits, or the PRD is under way, data.json is read again: what crew recorded shows without reloading the page.
  function poll() {
    if (data === null || (pending().length === 0 && !data.progress && !(data.accept || []).length)) return;
    if (pending().filter(late).length !== drawnLate) redraw(); else tally();
    fetch('data.json', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).then(take).catch(function () {});
  }
  // A redraw the person did not ask for keeps the field they are typing in, and where in it.
  function redraw() {
    var at = document.activeElement;
    var id = at && at.id;
    var from = at && at.selectionStart;
    var to = at && at.selectionEnd;
    draw();
    var back = id ? document.getElementById(id) : null;
    if (back) { back.focus(); try { if (typeof from === 'number') back.setSelectionRange(from, to); } catch (e) {} }
  }

  var drawnLate = 0;
  function draw() {
    var list = tabs();
    var n = waiting();
    tally();
    drawnLate = pending().filter(late).length;
    if (!list.some(function (t) { return t[0] === tab; })) {
      var first = list.filter(function (t) { return n[t[0]] > 0; })[0] || list[0];
      tab = first ? first[0] : null;
    }
    keep();
    tabsBox.textContent = '';
    tabsBox.hidden = list.length < 2;
    list.forEach(function (t, i) {
      var b = el('button', { type: 'button', role: 'tab', id: 'tab-' + t[0], 'aria-selected': String(t[0] === tab), 'aria-controls': 'main', tabindex: t[0] === tab ? '0' : '-1', onclick: function () { if (t[0] === 'progress' && tab === 'progress') pview = { st: null, sel: null, hl: null }; tab = t[0]; draw(); recheck(); } }, t[1], n[t[0]] ? el('span', { class: 'chip wait', text: String(n[t[0]]) }) : null);
      b.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        tab = list[(i + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length][0];
        draw();
        var f = document.getElementById('tab-' + tab);
        if (f) f.focus();
      });
      tabsBox.append(b);
    });
    main.textContent = '';
    if (tab === null) { main.append(el('div', { class: 'empty', text: '這個 PRD 現在沒有等你決定的事。有新的問題或設計稿時，這一頁會更新。' })); return; }
    main.setAttribute('aria-labelledby', 'tab-' + tab);
    if (tab === 'progress') drawProgress(main);
    else if (tab === 'reqs') drawReqs(main);
    else if (tab === 'prd') drawDraft(main);
    else if (tab === 'designs') drawDesigns(main);
    else if (tab === 'accept') drawAccept(main);
    else drawQuestions(main);
  }

  // Whether a decision can reach Claude Code changes after load: asked again on each move and when the page is shown again.
  function recheck() {
    if (comments === null || comments === undefined || can === 'forbidden') return;
    comments.canSendToClaude().catch(function () { return 'off'; }).then(function (state) {
      state = state || 'off';
      if (state !== can && can !== 'forbidden') { can = state; if (data) draw(); }
    });
  }

  // crew's web page, as this page's way to crew: what comments are on claude.ai. It speaks only with the page that holds
  // this frame (its window, at its address); a role's mockup or picture inside this page is another window and is not heard.
  function bridge() {
    var waits = {};
    var live = 'loading';
    var n = 0;
    var home = location.protocol + '//' + location.host;
    // Opened by itself, not in crew's web page: nobody takes its decisions, and it says where to open it.
    if (window.parent === window) live = 'no_session';
    function tell(m) { if (window.parent !== window) try { window.parent.postMessage(m, home); } catch (e) {} }
    window.addEventListener('message', function (e) {
      if (window.parent === window || e.source !== window.parent || e.origin !== home || !e.data || typeof e.data !== 'object') return;
      var m = e.data;
      if (m.crew === 'live') {
        var now = m.on === true ? 'available' : 'no_session';
        if (now !== live) { live = now; recheck(); }
      } else if (m.crew === 'sent' && typeof m.id === 'string' && waits[m.id]) {
        var w = waits[m.id];
        delete waits[m.id];
        if (m.ok === true) w.ok(m.pending === true ? { pending: true, id: m.id } : undefined);
        else w.no({ code: typeof m.code === 'string' ? m.code : 'crew', message: typeof m.text === 'string' ? m.text : '' });
      } else if (m.crew === 'viewport' && typeof m.h === 'number' && isFinite(m.h)) {
        document.documentElement.style.setProperty('--vh', Math.max(3, Math.min(60, m.h / 100)) + 'px');
      } else if (m.crew === 'late' && typeof m.id === 'string' && typeof m.ok === 'boolean') crewLate(m.id, m.ok, typeof m.text === 'string' ? m.text : '');
      else if (m.crew === 'refresh') reload();
      else if (m.crew === 'show') crewShow(m);
    });
    tell({ crew: 'ready' });
    // As tall as what it shows: crew's page sizes the frame to it, so the two scroll as one page.
    var wrapEl = document.querySelector('.wrap');
    var sizeTold = -1;
    var sizeUp = function () {
      if (!wrapEl) return;
      var h = Math.ceil(wrapEl.getBoundingClientRect().height);
      if (h > 0 && h !== sizeTold) { sizeTold = h; tell({ crew: 'size', h: h }); }
    };
    if (window.parent !== window && wrapEl) {
      if (window.ResizeObserver) new ResizeObserver(sizeUp).observe(wrapEl);
      else setInterval(sizeUp, 500);
      sizeUp();
    }
    return {
      anchorFor: function () { return Promise.resolve(null); },
      canSendToClaude: function () { return Promise.resolve(live); },
      sendToClaude: function (x) {
        return new Promise(function (ok, no) {
          n += 1;
          var id = 'd' + Date.now().toString(36) + n;
          waits[id] = { ok: ok, no: no };
          tell({ crew: 'send', id: id, text: String(x.text) });
          // The page answers within its own wait: past this, crew is taken not to have answered.
          setTimeout(function () { if (waits[id]) { delete waits[id]; no({ code: 'claude_unavailable' }); } }, 30000);
        });
      },
    };
  }

  // A new version reloads the page: data.json then says what crew recorded, and this browser what the person had not finished.
  function start() {
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') { recheck(); poll(); } });
    setInterval(poll, 20000);
    fetch('data.json', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).then(function (j) {
      data = shape(j);
      restore();
      // What a reload brings back is held to what data.json now says: a page for reading shows nothing as sent.
      settle();
      draw();
      if (showWant) showNow();
    }).catch(function () {
      main.textContent = '';
      main.append(el('div', { class: 'empty', text: '讀不到這一頁的資料（data.json），' + W('重新整理整個網頁看看；還是一樣，在 Claude Code 對大腦說一聲。', '請大腦重新發佈這一頁。') }));
    });
    var reach = WEB ? Promise.resolve(bridge()) : window.claude && typeof window.claude.use === 'function' ? window.claude.use('comments') : Promise.resolve(null);
    reach.then(function (c) {
      comments = c;
      if (c === null) return 'off';
      return c.canSendToClaude().catch(function () { return 'off'; });
    }).catch(function () { return 'off'; }).then(function (state) { can = state || 'off'; if (data) draw(); });
  }
  start();
})();
</script>`

/** The page's shell, as the Artifact tool publishes a page: its title and style first, then the content it reads from data.json. */
export const pageShell = (prd: string): string => shellOf(prd, false)

/**
 * The same page for crew's own web page, framed by that page on its own origin:
 * a whole document, marked so it sends decisions through the page.
 */
export const webShell = (prd: string): string =>
  [
    '<!doctype html>',
    '<html lang="zh-Hant-TW" class="web">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="crew-surface" content="web">',
    '<meta name="referrer" content="no-referrer">',
    `<title>${escapeHtml(prd)} 待你決定</title>`,
    STYLE,
    '</head>',
    '<body>',
    bodyOf(prd, true),
    '</body>',
    '</html>',
  ].join('\n')

const shellOf = (prd: string, web: boolean): string => [`<title>${escapeHtml(prd)} 待你決定</title>`, STYLE, bodyOf(prd, web)].join('\n')

const bodyOf = (prd: string, web: boolean): string =>
  [
    '<div class="wrap">',
    '  <header style="display:flex;flex-direction:column;gap:8px">',
    '    <span class="tag">待你決定</span>',
    `    <h1>${escapeHtml(prd)}</h1>`,
    '    <p class="cap" id="counts">讀取中…</p>',
    '  </header>',
    '  <p class="notice" id="notice" role="status"></p>',
    '  <div class="tabs" id="tabs" role="tablist" aria-label="分頁"></div>',
    '  <div class="panel" id="main" role="tabpanel"></div>',
    web
      ? '  <p class="cap" id="foot">在這裡按的決定直接交給 crew，當場記下。這一頁由 crew 產生。</p>'
      : '  <p class="cap" id="foot">在這裡按的決定，會在那一項下面用你的名字留一則留言，送給 Claude Code（crew 的大腦），由它交給 crew 記下；crew 記下之前，這一頁顯示「等收下」。這一頁由 crew 產生。</p>',
    '</div>',
    SCRIPT,
  ].join('\n')
