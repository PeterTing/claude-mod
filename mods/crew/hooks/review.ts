/**
 * The person's decide page for a PRD: one artifact the brain publishes,
 * holding what waits for the person on that PRD. Its draft to confirm, its
 * designs to approve or send back (a clickable mockup for each screen, the
 * text of each without one) and the roles' questions to answer. The person
 * decides on the page, which says so in a comment the brain passes on to
 * crew. The page itself is a fixed shell: what it shows is read from the
 * files beside it, so an update sends only the data that changed. A mockup
 * is a role's HTML: it runs in a sandboxed frame of its own, with no way to
 * the page or to the person's comments. Pure.
 */

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
  at: string
  state: 'open' | 'answered'
  answer?: string
  /** The question as it was asked, which an answer names: one on a question asked again under the same number is refused. */
  code: string
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

/** What the page shows, kept in data.json beside it. */
export type PageData = { prd: string; at: string; draft?: PageDraft; designs: readonly ReviewDesign[]; questions: readonly PageQuestion[] }

/** The first words of each comment the page sends: what crew looks for. */
export const PAGE_HEADS = ['crew 設計稿決定', 'crew 回答', 'crew PRD 確認', 'crew PRD 要改'] as const

/** The longest reason the page sends a design back with. */
export const REASON_MAX = 500

/** The longest answer, and the longest change to the draft, the page sends. */
export const ANSWER_MAX = 500
export const CHANGE_MAX = 2000

export type PageMessage =
  | { kind: 'design'; id: string; verdict: 'approved' | 'rejected'; reason: string; code: string }
  | { kind: 'answer'; id: string; answer: string; code: string }
  | { kind: 'confirm'; rest: string; code: string }
  | { kind: 'change'; rest: string; code: string }

/** A comment as the page wrote it, read back; why not, when it is not one. A brain may join its lines with spaces. */
export const parsePage = (comment: string): PageMessage | string => {
  const text = comment.trim()
  // The page ends the comment with the code: words the person wrote that name a code of their own do not stand in for it.
  const tail = /\s代碼 ([0-9a-f]{6})$/.exec(text)
  const design = /^crew 設計稿決定：(核准|退回) (SCR-\d+)/.exec(text)
  const answer = /^crew 回答：(Q-\d+)(?=\s)/.exec(text)
  const confirm = /^crew PRD 確認：開始\s/.exec(text)
  const change = /^crew PRD 要改：/.exec(text)
  if (design === null && answer === null && confirm === null && change === null) return `這則留言不是 crew 待你決定頁送出的（開頭要是 ${PAGE_HEADS.map(h => `「${h}」`).join('、')}）`
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
  if (confirm !== null) return { kind: 'confirm', rest: body(confirm), code }
  return { kind: 'change', rest: body(change as RegExpExecArray), code }
}

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const STYLE = String.raw`<style>
/* Layout: tabs over what waits; the open design's mockup is the one large framed object. */
:root {
  --bg: #f6f7f9; --surface: #ffffff; --ink: #1b2230; --ink-2: #566074; --line: #dde1e8;
  --accent: #2f5fd0; --accent-soft: #e6edfb; --warn: #a15c00; --warn-soft: #fbf0dd; --ok: #1f7a4d; --ok-soft: #e2f3ea; --bad: #b3261e; --bad-soft: #fbe5e3;
  --sans: "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif;
  --mono: ui-monospace, "SFMono-Regular", Menlo, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #10141b; --surface: #171c25; --ink: #e4e8ef; --ink-2: #9aa4b5; --line: #2a313d;
  --accent: #8ea8ff; --accent-soft: #1e2840; --warn: #f0b35a; --warn-soft: #33270f; --ok: #77d19c; --ok-soft: #12291d; --bad: #ff8a80; --bad-soft: #3a1714;
  color-scheme: dark } }
:root[data-theme="dark"] {
  --bg: #10141b; --surface: #171c25; --ink: #e4e8ef; --ink-2: #9aa4b5; --line: #2a313d;
  --accent: #8ea8ff; --accent-soft: #1e2840; --warn: #f0b35a; --warn-soft: #33270f; --ok: #77d19c; --ok-soft: #12291d; --bad: #ff8a80; --bad-soft: #3a1714;
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
.tag { display: inline-block; font-size: .75rem; padding: 1px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-weight: 600; align-self: flex-start; }
.notice { background: var(--warn-soft); color: var(--warn); border-radius: 8px; padding: 10px 14px; font-size: .9rem; }
.notice:empty { display: none; }
.tabs { display: flex; gap: 4px; flex-wrap: wrap; border-bottom: 1px solid var(--line); }
.tabs button { font: inherit; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--ink-2); padding: 6px 12px; cursor: pointer; display: flex; gap: 6px; align-items: center; }
.tabs button[aria-selected="true"] { color: var(--ink); border-bottom-color: var(--accent); font-weight: 600; }
.panel { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.review { border: 2px dashed var(--accent); border-radius: 10px; background: var(--surface); display: grid; grid-template-columns: 280px minmax(0, 1fr); min-height: 560px; min-width: 0; overflow: hidden; }
@media (max-width: 800px) { .review { grid-template-columns: 1fr; } }
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
iframe.mock { width: 100%; height: 72vh; min-height: 480px; border: 1px solid var(--line); border-radius: 8px; background: #fff; transition: width .2s; }
iframe.mock.narrow { width: 360px; flex: none; }
.placeholder { border: 1px dashed var(--line); border-radius: 8px; padding: 32px 16px; text-align: center; color: var(--ink-2); }
details { border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; }
summary { cursor: pointer; font-size: .9rem; color: var(--ink-2); }
.text { white-space: pre-wrap; overflow-wrap: anywhere; font-size: .9rem; }
.plain { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--bg); border-radius: 8px; padding: 14px; font-size: .92rem; }
.cols { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 16px; align-items: start; }
@media (max-width: 800px) { .cols { grid-template-columns: minmax(0, 1fr); } }
.doc { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 16px 18px; display: flex; flex-direction: column; gap: 8px; max-height: 78vh; overflow: auto; overflow-wrap: anywhere; min-width: 0; }
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
.opts { display: flex; flex-direction: column; gap: 6px; }
.opts button { font: inherit; text-align: left; border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: 6px; padding: 6px 12px; cursor: pointer; }
.opts button[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); }
.opts button:disabled { opacity: .5; cursor: not-allowed; }
.act { border-top: 1px solid var(--line); padding-top: 12px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.act button { font: inherit; font-size: .9rem; border-radius: 6px; padding: 4px 16px; cursor: pointer; border: 1px solid var(--line); background: var(--bg); color: var(--ink); }
.act button.primary { background: var(--accent); color: var(--surface); border-color: var(--accent); }
.act button:disabled, .act input:disabled, .act textarea:disabled { opacity: .5; cursor: not-allowed; }
.act input, .act textarea { font: inherit; font-size: .9rem; border: 1px solid var(--line); border-radius: 6px; padding: 4px 10px; background: var(--surface); color: var(--ink); flex: 1 1 220px; min-width: 0; }
.act textarea { min-height: 4.5em; resize: vertical; flex-basis: 100%; }
.said { font-size: .85rem; color: var(--ink-2); flex-basis: 100%; white-space: pre-wrap; }
.empty { border: 1px dashed var(--line); border-radius: 10px; padding: 28px 16px; text-align: center; color: var(--ink-2); }
@media (prefers-reduced-motion: reduce) { iframe.mock { transition: none; } }
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
  var drafts = {};
  var picked = {};
  // The code of the item each draft and pick was made for: an item asked again drops them.
  var codes = {};
  var html = {};
  var narrow = false;
  var tab = null;
  var open = null;
  var STATES = { waiting: ['等你核准', 'wait'], drawing: ['UI/UX 補畫中', 'draw'], approved: ['你核准了', 'ok'], rejected: ['你退回了', 'bad'] };

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

  function channel() {
    if (can === 'available' || can === 'loading') return '';
    if (can === 'no_session') return '現在沒有 Claude Code 收得到你的決定：開著這個 repo 的 Claude Code（crew 的大腦），再重新整理這一頁；或在 Claude Code 右側面板「待你決定」按［改在面板決定］。';
    if (can === 'writers_only') return '你只能看這一頁，不能在這裡決定。';
    if (can === 'forbidden') return '這一頁不能替你留言（你沒有允許，或沒有權限），所以送不出決定：在 Claude Code 右側面板「待你決定」按［改在面板決定］，在那裡決定。';
    return '這個畫面沒辦法把決定送給 Claude Code：在 Claude Code 右側面板「待你決定」按［改在面板決定］，在那裡決定。';
  }

  // One comment to the brain under the box it is about, ending with the code of what the person saw.
  function send(key, body, code, box, said, done) {
    said.textContent = '送出中…';
    disable(box, true);
    comments.anchorFor(box).then(function (anchor) {
      return comments.sendToClaude({ anchor: anchor, text: body + '\n代碼 ' + code });
    }).then(function () {
      sent[key] = done || true;
      sentAt[key] = { at: Date.now(), code: code };
      draw();
    }).catch(function (e) {
      var code = e && e.code;
      // Refused for this view for good: the page stops offering the send.
      if (code === 'forbidden' || code === 'not_granted') { can = 'forbidden'; draw(); return; }
      if (code === 'claude_unavailable') recheck();
      said.textContent = code === 'rate_limited' ? '送得太快了，等一下再按。'
        : code === 'claude_unavailable' ? '送不到 Claude Code：開著這個 repo 的 Claude Code 再按一次。'
        : code === 'consent_required' ? '要先允許這一頁替你留言，才能送出。'
        : '沒有送出（' + (code || (e && e.message) || '不明原因') + '），請再按一次。';
      disable(box, can !== 'available');
    });
  }
  // Why the buttons are off, when they are.
  function idle(said) {
    if (can === 'available') return false;
    said.textContent = can === 'loading' ? '正在確認能不能把決定送給 Claude Code…' : channel();
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
    var left = el('div');
    if (prdText === null) {
      left.append(el('div', { class: 'placeholder', text: '讀取草稿中…' }));
      fetch(d.file, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).then(function (j) {
        prdText = typeof j.text === 'string' ? j.text : '';
        draw();
      }).catch(function () {
        left.textContent = '';
        left.append(el('div', { class: 'placeholder', text: '讀不到草稿（' + d.file + '），請大腦重新發佈這一頁。' }));
      });
    } else left.append(doc(prdText));
    var side = el('div', { class: 'side' });
    var reviews = el('div', { class: 'box' }, el('h2', { text: '審查結果' }));
    d.reviews.forEach(function (r) { reviews.append(el('div', { class: 'finding' }, el('span', { class: 'chip kind', text: r.who }), el('span', { text: r.found }))); });
    if (d.note) reviews.append(el('p', { class: 'cap', text: '大腦：' + d.note }));
    side.append(reviews);
    var box = el('div', { class: 'box', 'aria-label': 'PRD 草稿的決定' });
    var said = el('p', { class: 'said', role: 'status' });
    if (sent.prd && d.state === 'confirm') {
      said.textContent = sent.prd === 'confirm' ? '已送出確認，等 Claude Code 收下交給 crew；開始之後這一頁會更新。' : '已送出要改的地方，等 Claude Code 收下；大腦改好之後這一頁會更新。';
      box.append(el('div', { class: 'act' }, said, again('prd')));
    } else if (d.state === 'reviewing') {
      box.append(el('p', { class: 'cap', text: 'PM 和 UI/UX 審查中。審完之後大腦會整理缺口問你，改好再請你在這裡確認。' }));
    } else if (d.state === 'changing') {
      box.append(el('p', { text: '你要改：' + d.change }), el('p', { class: 'cap', text: '大腦正在照你說的改，改好會再請你確認。' }));
    } else {
      var change = el('textarea', { id: 'prd-change', maxlength: '2000', placeholder: '要改的地方：寫哪一段、改成什麼', 'aria-label': '要改的地方', oninput: function () { drafts.prd = change.value; keep(); } });
      change.value = drafts.prd || '';
      var yes = el('button', { type: 'button', class: 'primary', text: '確認，開始', onclick: function () {
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
    }
    side.append(box);
    panel.append(el('div', { class: 'head' }, el('h2', { text: d.title }), el('span', { class: 'cap', text: d.path + ' · ' + d.requirements + ' 條需求' })), el('div', { class: 'cols' }, left, side));
  }

  // ---- Questions ----
  function drawQuestions(panel) {
    var qs = data.questions.slice().sort(function (a, b) { return (a.state === 'open' ? 0 : 1) - (b.state === 'open' ? 0 : 1); });
    if (qs.length === 0) { panel.append(el('div', { class: 'empty', text: '現在沒有角色問你的問題。' })); return; }
    qs.forEach(function (q) {
      var key = 'q:' + q.id;
      var box = el('section', { class: 'q' + (q.state === 'open' ? '' : ' done'), 'aria-label': q.id });
      var chip = q.state !== 'open' ? el('span', { class: 'chip ok', text: '已回答' }) : sent[key] ? el('span', { class: 'chip sent', text: '已送出回答，等收下' }) : el('span', { class: 'chip wait', text: '等你回答' });
      box.append(el('div', { class: 'meta' }, el('span', { class: 'id', text: q.id }), el('span', { text: q.from + ' 問的' }), el('span', { text: q.at }), chip));
      if (q.item) box.append(el('div', { class: 'ctx', text: q.item + (q.itemTitle ? '　' + q.itemTitle : '') }));
      box.append(el('p', { class: 'qtext', text: q.question }));
      if (q.state !== 'open') { box.append(el('p', { class: 'cap', text: '你回答了：' + (q.answer || '') })); panel.append(box); return; }
      if (sent[key]) { box.append(el('div', { class: 'act' }, el('p', { class: 'said', text: '已送出，等 Claude Code 收下交給' + q.from + '；記好之後這一頁會更新。' }), again(key))); panel.append(box); return; }
      var said = el('p', { class: 'said', role: 'status' });
      var other = el('input', { type: 'text', id: 'answer-' + q.id, maxlength: '500', placeholder: q.options && q.options.length ? '其他：自己寫' : '你的回答', 'aria-label': q.id + ' 的回答', oninput: function () { drafts[key] = other.value; picked[key] = undefined; mark(); keep(); } });
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
      var act = el('div', { class: 'act' }, other, go, said);
      box.append(act);
      if (idle(said)) { disable(act, true); if (opts) disable(opts, true); }
      panel.append(box);
    });
  }

  // ---- Designs ----
  function designChip(d) {
    if (sent['d:' + d.id]) return el('span', { class: 'chip sent', text: sent['d:' + d.id] === 'approved' ? '已送出核准，等收下' : '已送出退回，等收下' });
    var s = STATES[d.state];
    return el('span', { class: 'chip ' + s[1], text: s[0] });
  }
  function kind(d) { return el('span', { class: 'chip kind', text: d.kind === 'screen' ? '畫面' : '沒有畫面' }); }
  function frame(d) {
    var f = el('iframe', { class: 'mock' + (narrow ? ' narrow' : ''), sandbox: 'allow-scripts', title: d.id + ' 的 mockup', referrerpolicy: 'no-referrer' });
    if (html[d.id] !== undefined) f.srcdoc = html[d.id];
    else fetch(d.file, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).then(function (j) {
      html[d.id] = typeof j.html === 'string' ? j.html : '';
      f.srcdoc = html[d.id];
    }).catch(function () {
      f.replaceWith(el('div', { class: 'placeholder', text: '讀不到這份 mockup（' + d.file + '），請大腦重新發佈這一頁。' }));
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
    if (sent[key]) { said.textContent = '已送出，等 Claude Code 收下交給 crew；記好之後這一頁會更新。'; return el('div', { class: 'act' }, said, again(key)); }
    if (d.state === 'approved') return el('div', { class: 'act' }, el('span', { class: 'said', text: '你核准了這一版。' }));
    if (d.state === 'rejected') return el('div', { class: 'act' }, el('span', { class: 'said', text: '你退回了：' + (d.reason || '沒有寫原因') + '。UI/UX 會照原因重畫一份新的。' }));
    if (d.state === 'drawing') return el('div', { class: 'act' }, el('span', { class: 'said', text: 'UI/UX 還在畫這份的 mockup；畫好之後這一頁會更新，才能核准或退回。' }));
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
      nav.append(el('button', { type: 'button', 'aria-current': String(d.id === open), onclick: function () { open = d.id; draw(); recheck(); } },
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

  // ---- Tabs ----
  function waiting() {
    var n = { prd: 0, designs: 0, questions: 0 };
    if (data.draft && data.draft.state === 'confirm' && !sent.prd) n.prd = 1;
    data.designs.forEach(function (d) { if (d.state === 'waiting' && !sent['d:' + d.id]) n.designs++; });
    data.questions.forEach(function (q) { if (q.state === 'open' && !sent['q:' + q.id]) n.questions++; });
    return n;
  }
  function tabs() {
    var list = [];
    if (data.draft) list.push(['prd', 'PRD 草稿']);
    if (data.designs.length) list.push(['designs', '設計稿']);
    if (data.questions.length) list.push(['questions', '問題']);
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
    var item = key === 'prd' ? data.draft : key.charAt(0) === 'q' ? data.questions.filter(function (q) { return q.id === id; })[0] : data.designs.filter(function (d) { return d.id === id; })[0];
    var open = key === 'prd' ? 'confirm' : key.charAt(0) === 'q' ? 'open' : 'waiting';
    return item && item.state === open && (code === undefined || item.code === code) ? item : null;
  }
  // What data.json now shows decided, or changed since the send or the typing, waits no more.
  function settle() {
    pending().forEach(function (key) {
      if (!still(key, sentAt[key].code)) { delete sentAt[key]; delete sent[key]; }
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
      if (sent[key]) { x.sent = sent[key]; x.at = sentAt[key].at; }
      if (x.draft || x.picked !== undefined || x.sent) out[key] = x;
    });
    // The tab and design on screen come back too: a reload mid-answer does not move the person elsewhere.
    try { localStorage.setItem(STORE, JSON.stringify({ items: out, tab: tab, open: open })); } catch (e) {}
  }
  function restore() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) {}
    if (saved === null || typeof saved !== 'object') return;
    if (typeof saved.tab === 'string') tab = saved.tab;
    if (typeof saved.open === 'string') open = saved.open;
    var items = saved.items && typeof saved.items === 'object' ? saved.items : {};
    Object.keys(items).forEach(function (key) {
      var x = items[key];
      if (!x || typeof x.code !== 'string' || !still(key, x.code)) return;
      codes[key] = x.code;
      if (typeof x.draft === 'string') drafts[key] = x.draft;
      if (typeof x.picked === 'number') picked[key] = x.picked;
      if (x.sent) { sent[key] = x.sent; sentAt[key] = { at: typeof x.at === 'number' ? x.at : Date.now(), code: x.code }; }
    });
  }
  // A send no update has shown recorded for two minutes can be made again: what was typed is still there.
  function again(key) {
    if (!late(key)) return null;
    return el('button', { type: 'button', text: '重新決定', onclick: function () { delete sent[key]; delete sentAt[key]; draw(); } });
  }
  function tally() {
    var n = waiting();
    var total = n.prd + n.designs + n.questions;
    var m = pending().length;
    var parts = [];
    if (total) parts.push('等你決定 ' + total + ' 件');
    if (m) parts.push('已送出 ' + m + ' 件，等 Claude Code 收下');
    if (!parts.length) parts.push('現在沒有等你決定的事');
    document.getElementById('counts').textContent = parts.join(' · ') + ' · 更新於 ' + data.at;
    var slow = pending().filter(late).length;
    notice.textContent = channel() || (slow ? '有 ' + slow + ' 件送出超過兩分鐘，這一頁還沒更新：這一頁的留言不一定送得到 Claude Code，它閒著時也可能沒收到。在 Claude Code 右側面板「待你決定」按［我在頁面上決定好了］，或對 Claude Code 說一句話，它會先讀這一頁的留言再交給 crew。決定已經留言在這一頁，先不用再送；大腦在留言下回覆說 crew 沒收，再按那一項的［重新決定］。' : '');
  }
  // While something waits, data.json is read again: what crew recorded shows without reloading the page.
  function poll() {
    if (data === null || pending().length === 0) return;
    if (pending().filter(late).length !== drawnLate) redraw(); else tally();
    fetch('data.json', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).then(function (j) {
      var next = { prd: String(j.prd || ''), at: String(j.at || ''), draft: j.draft || null, designs: j.designs || [], questions: j.questions || [] };
      if (JSON.stringify(next) === JSON.stringify(data)) return;
      data = next;
      settle();
      redraw();
    }).catch(function () {});
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
      var b = el('button', { type: 'button', role: 'tab', id: 'tab-' + t[0], 'aria-selected': String(t[0] === tab), 'aria-controls': 'main', tabindex: t[0] === tab ? '0' : '-1', onclick: function () { tab = t[0]; draw(); recheck(); } }, t[1], n[t[0]] ? el('span', { class: 'chip wait', text: String(n[t[0]]) }) : null);
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
    if (tab === null) { main.append(el('div', { class: 'empty', text: '這個 PRD 現在沒有等你決定的事。有新的問題或設計稿時，大腦會更新這一頁。' })); return; }
    main.setAttribute('aria-labelledby', 'tab-' + tab);
    if (tab === 'prd') drawDraft(main);
    else if (tab === 'designs') drawDesigns(main);
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

  // A new version reloads the page: data.json then says what crew recorded, and this browser what the person had not finished.
  function start() {
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') { recheck(); poll(); } });
    setInterval(poll, 20000);
    fetch('data.json', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).then(function (j) {
      data = { prd: String(j.prd || ''), at: String(j.at || ''), draft: j.draft || null, designs: j.designs || [], questions: j.questions || [] };
      restore();
      draw();
    }).catch(function () {
      main.textContent = '';
      main.append(el('div', { class: 'empty', text: '讀不到這一頁的資料（data.json），請大腦重新發佈這一頁。' }));
    });
    var reach = window.claude && typeof window.claude.use === 'function' ? window.claude.use('comments') : Promise.resolve(null);
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
export const pageShell = (prd: string): string =>
  [
    `<title>${escapeHtml(prd)} 待你決定</title>`,
    STYLE,
    '<div class="wrap">',
    '  <header style="display:flex;flex-direction:column;gap:8px">',
    '    <span class="tag">待你決定</span>',
    `    <h1>${escapeHtml(prd)}</h1>`,
    '    <p class="cap" id="counts">讀取中…</p>',
    '  </header>',
    '  <p class="notice" id="notice" role="status"></p>',
    '  <div class="tabs" id="tabs" role="tablist" aria-label="分頁"></div>',
    '  <div class="panel" id="main" role="tabpanel"></div>',
    '  <p class="cap">在這裡按的決定，會在那一項下面用你的名字留一則留言，送給 Claude Code（crew 的大腦），由它交給 crew 記下；crew 記下之前，這一頁顯示「等收下」。這一頁由 crew 產生。</p>',
    '</div>',
    SCRIPT,
  ].join('\n')
