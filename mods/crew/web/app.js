/*
 * crew's web page. crew draws every frame with the pane's own views and pushes it
 * here as plain data; this page builds it with DOM calls (textContent and
 * createElement only, never HTML from a frame), sends presses back, and shows
 * whether it is connected. Nothing here decides anything: a press is crew's to do.
 */
'use strict'
;(function () {
  const ID = /^[A-Za-z0-9-]{8,64}$/
  // The one-time key, and where a press on crew's pane sent this new tab (a word of crew's).
  const KEY = /^#k=([A-Za-z0-9_-]{8,200})(?:&go=([A-Za-z0-9_.:@~-]{1,160}))?$/
  const PRESS_WAIT_MS = 15000
  const COVER_AFTER_MS = 2500
  const SAVED_MS = 2500
  const TOAST_MS = 8000

  const byId = id => document.getElementById(id)
  const ui = {
    title: byId('title'),
    chip: byId('chip'),
    status: byId('status'),
    saved: byId('saved'),
    live: byId('live'),
    liveText: byId('live-text'),
    share: byId('share'),
    sharePop: byId('share-pop'),
    shareWhy: byId('share-why'),
    shareRow: byId('share-row'),
    shareUrl: byId('share-url'),
    shareCopy: byId('share-copy'),
    demo: byId('demo'),
    build: byId('build'),
    buildCmd: byId('build-cmd'),
    buildCopy: byId('build-copy'),
    nav: byId('nav'),
    main: byId('main'),
    tree: byId('tree'),
    decide: byId('decide'),
    toasts: byId('toasts'),
    cover: byId('cover'),
    coverTitle: byId('cover-title'),
    coverText: byId('cover-text'),
    coverCap: byId('cover-cap'),
    coverRetry: byId('cover-retry'),
  }

  /** Storage that may be off (a private window): the page works without it, a reload just pairs again. */
  const kept = {
    get(where, name) {
      try {
        return window[where].getItem(name)
      } catch (e) {
        return null
      }
    },
    set(where, name, value) {
      try {
        if (value === null) window[where].removeItem(name)
        else window[where].setItem(name, value)
      } catch (e) {
        // Not kept: fine for this visit.
      }
    },
  }

  /** Random hex from the browser's generator, which works on plain http too (crypto.randomUUID does not). */
  const randomHex = bytes => {
    const b = new Uint8Array(bytes)
    crypto.getRandomValues(b)
    return Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
  }

  const state = {
    client: '',
    token: '',
    tab: 'decide',
    mark: '',
    frame: null,
    es: null,
    live: false,
    stopped: false,
    retry: 0,
    timer: 0,
    coverTimer: 0,
    lostAt: '',
    pending: new Map(),
    drafts: new Map(),
    remote: '',
    decide: null,
    // Where a press on crew's pane sent this tab, said to crew with the first connection; and the last place brought into view.
    go: '',
    goSeen: '',
  }

  const clientId = () => {
    let id = kept.get('sessionStorage', 'crew.client')
    if (!id || !ID.test(id)) {
      id = randomHex(16)
      kept.set('sessionStorage', 'crew.client', id)
    }
    return id
  }

  const post = (path, body) =>
    fetch(path, {
      method: 'POST',
      cache: 'no-store',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json', 'X-Crew': '1', 'X-Crew-Token': state.token || '' },
      body: JSON.stringify(body || {}),
    })

  // ---------- words on the page ----------

  const toast = text => {
    const t = document.createElement('div')
    t.className = 'toast'
    const p = document.createElement('span')
    p.textContent = String(text)
    const x = document.createElement('button')
    x.type = 'button'
    x.className = 'btn small plain'
    x.textContent = '關閉'
    x.addEventListener('click', () => t.remove())
    t.append(p, x)
    ui.toasts.append(t)
    while (ui.toasts.children.length > 4) ui.toasts.firstElementChild.remove()
    setTimeout(() => t.remove(), TOAST_MS)
  }

  let savedTimer = 0
  const saved = () => {
    ui.saved.hidden = false
    clearTimeout(savedTimer)
    savedTimer = setTimeout(() => (ui.saved.hidden = true), SAVED_MS)
  }

  const setLive = on => {
    state.live = on
    tellDecide({ crew: 'live', on })
    ui.live.classList.toggle('off', !on)
    ui.liveText.textContent = on ? '即時' : '連線中斷'
    if (on) {
      clearTimeout(state.coverTimer)
      state.coverTimer = 0
      if (!state.stopped) ui.cover.hidden = true
    } else if (!state.stopped && !state.coverTimer && ui.cover.hidden) {
      // A short drop (crew reloading) comes back on its own: the cover waits a moment first.
      state.coverTimer = setTimeout(() => {
        state.coverTimer = 0
        if (!state.live && !state.stopped) lost()
      }, COVER_AFTER_MS)
    }
  }

  const cover = (title, text, cap, retry) => {
    ui.coverTitle.textContent = title
    ui.coverText.textContent = text
    ui.coverCap.textContent = cap
    ui.coverRetry.hidden = !retry
    ui.cover.hidden = false
  }

  const lost = () =>
    cover(
      '和 crew 的連線中斷了',
      'crew 沒有回應：這個專案的 Claude Code session 可能已經關掉，或 crew 正在重新載入。',
      `在 Claude Code 重新打開這個專案的 session，這一頁會自己連回來，不用換連結。${state.lostAt ? `頁面上的內容停在 ${state.lostAt}。` : ''}`,
      true,
    )

  /** The link this page was opened with no longer works here: only the pane's newest link does. */
  const needLink = () => {
    state.stopped = true
    stop()
    kept.set('localStorage', 'crew.token', null)
    state.token = ''
    setLive(false)
    cover('這個連結要重新打開', '這一頁的通行碼已經失效，例如連結用過了、換了一個瀏覽器，或 crew 的設定重設過。', '在 Claude Code 的 crew 面板按［開啟 ↗］，會用新的連結打開這一頁。', false)
  }

  const denied = () => {
    state.stopped = true
    stop()
    setLive(false)
    cover('沒有權限', '這個 crew 只開放給這台 Mac 主人的 Tailscale 帳號。你現在登入的是另一個帳號。', '換成主人的帳號登入 Tailscale 後，重新整理這一頁。', false)
  }

  // ---------- the frame, built ----------

  const COLORS = {
    success: 'ok',
    green: 'ok',
    warning: 'warn',
    yellow: 'warn',
    error: 'bad',
    red: 'bad',
    suggestion: 'accent',
    permission: 'accent',
    claude: 'accent',
    blue: 'accent',
    cyan: 'accent',
    magenta: 'accent',
    subtle: 'dim',
    inactive: 'dim',
    gray: 'dim',
    grey: 'dim',
  }

  const num = v => (typeof v === 'number' && isFinite(v) ? v : undefined)
  // The steps the pane names for the room between rows (a graphical surface's small gaps), in the page's em.
  const STEPS = { xs: 0.2, sm: 0.35, md: 0.6, lg: 1 }
  const rows = v => (num(v) !== undefined ? `${v * 0.4}em` : typeof v === 'string' && Object.hasOwn(STEPS, v) ? `${STEPS[v]}em` : undefined)
  const cols = v => (num(v) !== undefined ? `${v}ch` : typeof v === 'string' && Object.hasOwn(STEPS, v) ? `${STEPS[v] * 2}ch` : undefined)
  const size = (v, unit) => (num(v) !== undefined ? `${v}${unit}` : typeof v === 'string' && /^\d{1,3}(\.\d+)?%$/.test(v) ? v : undefined)

  // The looks a view may ask for (a card, a chip, a table row): only these, by name.
  const LOOKS = new Set([
    'card', 'item', 'open', 'item-head', 'opts', 'note', 'list', 'chip', 'wait', 'ok', 'bad', 'kind', 'run', 'todo', 'mono', 'cap', 'big',
    'steps', 'step', 'done', 'now', 'grid2', 'role', 'busy', 'map', 'region', 'lit', 'part', 'gone', 'tr', 'th', 'td', 'log', 'logrow',
    'bars', 'barrow', 'meter', 'fill', 'n', 'states', 'under',
  ])
  const looksOf = p => (typeof p.cls === 'string' ? p.cls.split(' ').filter(c => LOOKS.has(c)) : [])

  const kids = (parent, list) => {
    if (!Array.isArray(list)) return
    for (const c of list) parent.append(build(c))
  }

  const box = n => {
    const el = document.createElement('div')
    el.className = 'b'
    const p = n.p || {}
    const looks = looksOf(p)
    el.classList.add(...looks)
    if (looks.includes('fill') && num(p.pct) !== undefined) el.style.width = `${Math.max(0, Math.min(100, p.pct))}%`
    if (p.dir === 'column' || p.dir === 'column-reverse') el.classList.add('col')
    if (p.wrap === 'wrap') el.classList.add('wrap')
    const st = el.style
    if (rows(p.gap) !== undefined) {
      st.rowGap = rows(p.gap)
      st.columnGap = cols(p.gap)
    }
    if (cols(p.cg) !== undefined) st.columnGap = cols(p.cg)
    if (rows(p.rg) !== undefined) st.rowGap = rows(p.rg)
    if (num(p.px) !== undefined) st.paddingInline = `${p.px}ch`
    if (num(p.pl) !== undefined) st.paddingLeft = `${p.pl}ch`
    if (num(p.pr) !== undefined) st.paddingRight = `${p.pr}ch`
    if (num(p.mb) !== undefined) st.marginBottom = `${p.mb * 0.4}em`
    // A width in cells is the terminal's, where a letter takes one: the page's letters are wider than its digit, so a cell is a little more.
    const minw = size(num(p.minw) !== undefined ? p.minw * 1.25 : p.minw, 'ch')
    if (minw) st.minWidth = minw
    const w = size(num(p.w) !== undefined ? p.w * 1.25 : p.w, 'ch')
    if (w) st.flexBasis = w
    if (num(p.grow) !== undefined) st.flexGrow = String(p.grow)
    if (num(p.shrink) !== undefined) st.flexShrink = String(p.shrink)
    if (typeof p.border === 'string' && p.border !== '') {
      el.classList.add('framed')
      const c = COLORS[p.bc]
      if (c) el.classList.add(`bc-${c}`)
    }
    kids(el, n.c)
    return el
  }

  const text = n => {
    const p = n.p || {}
    const looks = typeof p.cls === 'string' ? p.cls.split(' ') : []
    // A text a view marks as markdown (what a role wrote or was told) is laid out as such, when it is words only.
    if (looks.includes('md') && Array.isArray(n.c) && n.c.every(c => typeof c === 'string')) return markdown(n.c.join(''), p)
    // A heading the view names is one on the page too: h2 for a tab's name, h3 for a section's.
    const el = document.createElement(looks.includes('h2') ? 'h2' : looks.includes('h3') ? 'h3' : 'span')
    el.className = 't'
    el.classList.add(...looksOf(p))
    const c = COLORS[p.color]
    if (c) el.classList.add(`c-${c}`)
    if (p.dim === true) el.classList.add('c-dim')
    if (p.bold === true) el.classList.add('bold')
    if (p.italic === true) el.classList.add('italic')
    if (p.underline === true) el.classList.add('underline')
    if (p.strike === true) el.classList.add('strike')
    if (typeof p.wrap === 'string' && p.wrap.startsWith('truncate')) el.classList.add('trunc')
    kids(el, n.c)
    return el
  }

  const busy = (el, on) => {
    el.disabled = on
    if (on) el.setAttribute('aria-busy', 'true')
    else el.removeAttribute('aria-busy')
  }

  const pendingKey = key => {
    for (const p of state.pending.values()) if (p.key === key) return true
    return false
  }

  const button = n => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'btn'
    if (n.variant === 'primary') b.classList.add('primary')
    if (n.plain === true) b.classList.add('plain')
    if (n.dim === true) b.classList.add('dim')
    b.dataset.k = n.k
    if (typeof n.label === 'string' && n.label !== '') b.textContent = n.label
    else kids(b, n.c)
    if (pendingKey(n.k)) busy(b, true)
    b.addEventListener('click', () => press('press', n.k, undefined, b))
    return b
  }

  const input = n => {
    const f = document.createElement('form')
    f.className = 'field'
    const id = `in-${n.k}`
    if (typeof n.label === 'string' && n.label !== '') {
      const l = document.createElement('label')
      l.className = 'cap'
      l.htmlFor = id
      l.textContent = n.label
      f.append(l)
    }
    const i = document.createElement('input')
    i.type = 'text'
    i.id = id
    i.dataset.k = n.k
    i.maxLength = 10000
    i.autocomplete = 'off'
    if (typeof n.placeholder === 'string') i.placeholder = n.placeholder
    // A field with no label of its own is still named for a screen reader: by what it asks for.
    if (!(typeof n.label === 'string' && n.label !== '') && typeof n.placeholder === 'string') i.setAttribute('aria-label', n.placeholder)
    const draft = state.drafts.get(n.k)
    i.value = draft !== undefined ? draft : typeof n.value === 'string' ? n.value : ''
    i.addEventListener('input', () => state.drafts.set(n.k, i.value))
    const s = document.createElement('button')
    s.type = 'submit'
    s.className = 'btn primary'
    s.dataset.k = `${n.k}::submit`
    s.textContent = typeof n.submit === 'string' && n.submit !== '' ? n.submit : '送出'
    if (pendingKey(n.k)) busy(s, true)
    f.addEventListener('submit', ev => {
      ev.preventDefault()
      press('submit', n.k, i.value, s)
    })
    f.append(i, s)
    return f
  }

  const select = n => {
    const wrap = document.createElement('span')
    wrap.className = 'pick'
    const sel = document.createElement('select')
    sel.dataset.k = n.k
    if (typeof n.label === 'string' && n.label !== '') {
      const l = document.createElement('label')
      l.className = 'cap'
      l.textContent = n.label
      l.htmlFor = sel.id = `sel-${n.k}`
      wrap.append(l)
    }
    for (const o of Array.isArray(n.options) ? n.options : []) {
      const opt = document.createElement('option')
      opt.value = String(o.value)
      opt.textContent = typeof o.label === 'string' ? o.label : String(o.value)
      sel.append(opt)
    }
    if (typeof n.value === 'string') sel.value = n.value
    if (pendingKey(n.k)) busy(sel, true)
    sel.addEventListener('change', () => press('select', n.k, sel.value, sel))
    wrap.append(sel)
    return wrap
  }

  const link = n => {
    const a = document.createElement('a')
    if (typeof n.href === 'string' && /^https?:\/\//i.test(n.href)) {
      a.href = n.href
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
    }
    if (typeof n.label === 'string' && n.label !== '') a.textContent = n.label
    else kids(a, n.c)
    return a
  }

  const build = n => {
    if (typeof n === 'string') return document.createTextNode(n)
    if (n === null || typeof n !== 'object') return document.createTextNode('')
    if (n.t === 'box') return box(n)
    if (n.t === 'text') return text(n)
    if (n.t === 'button') return button(n)
    if (n.t === 'input') return input(n)
    if (n.t === 'select') return select(n)
    if (n.t === 'link') return link(n)
    return document.createTextNode('')
  }

  // ---------- markdown ----------

  /*
   * Markdown as the roles write it: headings, lists, code, quotes, tables, bold, code spans and links.
   * Built with createElement and textContent only, like the rest of the page: nothing in it is HTML.
   */
  const INLINE = /(`{1,16})([^`\n]+?)\1|\*\*([^*\n]+?)\*\*|\[([^[\]\n]{1,300})\]\((https?:\/\/[^\s)]{1,2000})\)|(https?:\/\/[A-Za-z0-9\-._~:/?#@!$&*+,;=%]{1,2000})|(^|[^\w*])\*([^*\s](?:[^*\n]*?[^*\s])?)\*(?=[^\w*]|$)/g
  // What ends a sentence after a link, counted from the end: no pattern that tries each start again.
  const trail = t => {
    let k = t.length
    while (k > 0 && '.,;:!?)]'.includes(t[k - 1])) k -= 1
    return t.slice(k)
  }

  const anchor = (href, words) => {
    const a = document.createElement('a')
    a.href = href
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.textContent = words
    return a
  }

  const inline = (parent, line) => {
    let at = 0
    INLINE.lastIndex = 0
    for (let m = INLINE.exec(line); m !== null; m = INLINE.exec(line)) {
      let start = m.index
      if (m[7] !== undefined) start += m[7].length
      if (start > at) parent.append(document.createTextNode(line.slice(at, start)))
      if (m[2] !== undefined) {
        const c = document.createElement('code')
        c.textContent = m[2]
        parent.append(c)
      } else if (m[3] !== undefined) {
        const b = document.createElement('strong')
        inline(b, m[3])
        parent.append(b)
        INLINE.lastIndex = m.index + m[0].length
      } else if (m[4] !== undefined) {
        parent.append(anchor(m[5], m[4]))
      } else if (m[6] !== undefined) {
        // A sentence's full stop after a link is the sentence's, not the link's.
        const tail = trail(m[6])
        const href = m[6].slice(0, m[6].length - tail.length)
        parent.append(anchor(href, href))
        if (tail) parent.append(document.createTextNode(tail))
      } else if (m[8] !== undefined) {
        const i = document.createElement('em')
        i.textContent = m[8]
        parent.append(i)
      }
      at = m.index + m[0].length
    }
    if (at < line.length) parent.append(document.createTextNode(line.slice(at)))
  }

  // Each pattern matches or fails in one pass over a line: a role's text with a long run of spaces cannot hold the page.
  const FENCE = /^\s{0,3}(```+|~~~+)(.*)$/
  const HEAD = /^\s{0,3}(#{1,6})\s+(.*)$/
  const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/
  const QUOTE = /^\s{0,3}>\s?(.*)$/
  const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/
  const ROW = /^\s*\|.*\|\s*$/

  const cells = line =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map(c => c.trim())

  /** A heading's words without the closing #s that only close it (`## Title ##`); `C#` keeps its own. */
  const headText = t => {
    let s = t.trimEnd()
    let j = s.length
    while (j > 0 && s[j - 1] === '#') j -= 1
    if (j < s.length && (j === 0 || /\s/.test(s[j - 1]))) s = s.slice(0, j).trimEnd()
    return s
  }

  /** The line under a table's head: cells of dashes, each maybe with a colon at either end. */
  const splitRow = line => {
    const c = cells(line)
    return c.length > 0 && c.every(x => /^:?-{2,}:?$/.test(x))
  }

  /** The blocks of some lines, appended to parent; depth keeps a quote inside a quote from going on forever. */
  const blocks = (parent, lines, depth) => {
    let i = 0
    let para = null
    const flush = () => (para = null)
    while (i < lines.length) {
      const line = lines[i]
      if (line.trim() === '') {
        flush()
        i += 1
        continue
      }
      const fence = FENCE.exec(line)
      if (fence && /^[\w+-]*$/.test(fence[2].trim())) {
        flush()
        const body = []
        i += 1
        while (i < lines.length && !(lines[i].trim().startsWith(fence[1][0].repeat(3)) && lines[i].trim().replace(/[`~]/g, '') === '')) body.push(lines[i++])
        i += 1
        const pre = document.createElement('pre')
        const code = document.createElement('code')
        code.textContent = body.join('\n')
        pre.append(code)
        parent.append(pre)
        continue
      }
      const head = HEAD.exec(line)
      if (head) {
        flush()
        const h = document.createElement(head[1].length <= 2 ? 'h4' : head[1].length === 3 ? 'h5' : 'h6')
        inline(h, headText(head[2]))
        parent.append(h)
        i += 1
        continue
      }
      if (RULE.test(line)) {
        flush()
        parent.append(document.createElement('hr'))
        i += 1
        continue
      }
      if (QUOTE.test(line) && depth < 4) {
        flush()
        const inner = []
        while (i < lines.length && QUOTE.test(lines[i])) inner.push(QUOTE.exec(lines[i++])[1])
        const q = document.createElement('blockquote')
        blocks(q, inner, depth + 1)
        parent.append(q)
        continue
      }
      if (ROW.test(line) && i + 1 < lines.length && splitRow(lines[i + 1])) {
        flush()
        const wrap = document.createElement('div')
        wrap.className = 'md-table'
        const table = document.createElement('table')
        const head = document.createElement('tr')
        for (const c of cells(line)) {
          const th = document.createElement('th')
          inline(th, c)
          head.append(th)
        }
        const thead = document.createElement('thead')
        thead.append(head)
        const tbody = document.createElement('tbody')
        i += 2
        while (i < lines.length && ROW.test(lines[i])) {
          const tr = document.createElement('tr')
          for (const c of cells(lines[i++])) {
            const td = document.createElement('td')
            inline(td, c)
            tr.append(td)
          }
          tbody.append(tr)
        }
        table.append(thead, tbody)
        wrap.append(table)
        parent.append(wrap)
        continue
      }
      if (ITEM.test(line)) {
        flush()
        i = list(parent, lines, i)
        continue
      }
      // Lines of one paragraph keep their breaks: the roles write them one thought a line.
      if (para === null) {
        para = document.createElement('p')
        parent.append(para)
      } else para.append(document.createElement('br'))
      inline(para, line.trim())
      i += 1
    }
  }

  /** A list from line i, nested by indent; the line after it is returned. */
  const list = (parent, lines, i) => {
    const stack = []
    while (i < lines.length) {
      const line = lines[i]
      const m = ITEM.exec(line)
      if (!m) {
        // A line indented under an item goes on that item; anything else ends the list.
        if (line.trim() !== '' && /^\s{2,}/.test(line) && stack.length > 0) {
          const li = stack[stack.length - 1].li
          if (li) {
            li.append(document.createElement('br'))
            inline(li, line.trim())
          }
          i += 1
          continue
        }
        if (line.trim() === '' && i + 1 < lines.length && ITEM.test(lines[i + 1])) {
          i += 1
          continue
        }
        break
      }
      let indent = m[1].replace(/\t/g, '  ').length
      const ordered = /\d/.test(m[2])
      // Lists go eight deep at most: deeper items sit at the eighth level.
      if (stack.length >= 8 && indent > stack[stack.length - 1].indent) indent = stack[stack.length - 1].indent
      while (stack.length > 0 && indent < stack[stack.length - 1].indent) stack.pop()
      let top = stack[stack.length - 1]
      if (!top || indent > top.indent || top.ordered !== ordered) {
        if (top && indent === top.indent) stack.pop()
        const l = document.createElement(ordered ? 'ol' : 'ul')
        if (ordered) {
          const n = parseInt(m[2], 10)
          if (n > 1) l.start = n
        }
        const host = stack.length > 0 && stack[stack.length - 1].li ? stack[stack.length - 1].li : parent
        host.append(l)
        top = { indent, ordered, el: l, li: null }
        stack.push(top)
      }
      const li = document.createElement('li')
      const task = /^\[([ xX])\]\s+(.*)$/.exec(m[3])
      if (task) {
        li.className = 'task'
        const box = document.createElement('span')
        box.className = task[1] === ' ' ? 'tick' : 'tick on'
        box.setAttribute('aria-hidden', 'true')
        box.textContent = task[1] === ' ' ? '☐' : '☑'
        li.append(box)
        inline(li, task[2])
      } else inline(li, m[3])
      top.el.append(li)
      top.li = li
      i += 1
    }
    return i
  }

  const MD_MAX = 200000
  const markdown = (source, p) => {
    const el = document.createElement('div')
    el.className = 't md'
    const c = COLORS[p.color]
    if (c) el.classList.add(`c-${c}`)
    if (p.dim === true) el.classList.add('c-dim')
    // Every line end JavaScript's `.` stops at is a line end here: a pattern's `(.*)$` then never has to try again.
    const lines = String(source).slice(0, MD_MAX).replace(/\r\n?|[\u2028\u2029]/g, '\n').split('\n')
    blocks(el, lines, 0)
    return el
  }

  // ---------- the decide page ----------

  /*
   * crew's decide page, from crew's own folder, in a frame of this page's origin: crew's own page, which shows
   * what a role wrote in HTML (a mockup, a question's picture) only in sandboxed frames of its own. Its
   * decisions come here as messages and go to crew with the token; crew's answer goes back the same way.
   */
  const DECIDE_SRC = /^\/decide\/[0-9a-f]{32}\/web\.html$/
  const DECIDE_ID = /^[A-Za-z0-9-]{1,40}$/
  const DECIDE_MAX = 12000

  const tellDecide = m => {
    const w = state.decide && state.decide.frame ? state.decide.frame.contentWindow : null
    if (w) w.postMessage(m, location.origin)
  }

  // The decide page sizes what it shows by this window's height, not its own frame's (which is as tall as the page).
  window.addEventListener('resize', () => tellDecide({ crew: 'viewport', h: window.innerHeight }))

  const showDecide = () => {
    const d = state.decide
    const on = d !== null && state.tab === 'decide' && !d.over
    ui.decide.hidden = !on
    if (!on || d.frame) return
    const f = document.createElement('iframe')
    f.className = 'decide-frame'
    f.title = '這份 PRD 等你決定的事'
    f.setAttribute('referrerpolicy', 'no-referrer')
    f.src = d.src
    d.frame = f
    ui.decide.replaceChildren(f)
  }

  const drawDecide = d => {
    const ok = d !== null && typeof d === 'object' && typeof d.src === 'string' && DECIDE_SRC.test(d.src)
    const was = state.decide
    if (!ok) {
      state.decide = null
      ui.decide.replaceChildren()
      ui.decide.hidden = true
      return
    }
    const path = typeof d.path === 'string' ? d.path : ''
    const mark = typeof d.mark === 'string' ? d.mark : ''
    const over = d.over === true
    if (was && was.src === d.src && was.path === path) {
      was.over = over
      // The same page with something new on it: it fetches its data again and keeps what the person was typing.
      if (was.mark !== mark) {
        was.mark = mark
        tellDecide({ crew: 'refresh' })
      }
    } else {
      ui.decide.replaceChildren()
      state.decide = { src: d.src, path, mark, over, frame: null, ready: false, show: null }
    }
    showDecide()
  }

  const decideSend = (id, text) => {
    const answer = m => tellDecide({ crew: 'sent', id, ...m })
    const no = words => answer({ ok: false, code: 'crew', text: words })
    if (!state.live) return no('現在和 crew 斷線，這個決定沒有送出。連回來之後再送一次。')
    post('/decide', { client: state.client, id, text })
      .then(async r => {
        if (r.status === 200) {
          let d = null
          try {
            d = await r.json()
          } catch (e) {
            d = null
          }
          const said = d && typeof d.text === 'string' ? d.text : ''
          if (d && d.ok === true) {
            // Taken and still being worked on past the wait: sent, not yet recorded; crew says the end on this page later.
            const slow = d.pending === true
            answer({ ok: true, text: said, ...(slow ? { pending: true } : {}) })
            if (!slow) saved()
            if (said) toast(said)
          } else no(said || 'crew 沒有記下這個決定，請再送一次。')
          return
        }
        if (r.status === 401) {
          no('這一頁的通行碼失效了，決定沒有送出。')
          return needLink()
        }
        if (r.status === 403) {
          no('這個帳號沒有權限送出決定。')
          return denied()
        }
        if (r.status === 409) {
          no('crew 還沒看到這一頁，等它連上之後再送一次。')
          return reconnect()
        }
        if (r.status === 504) return no('crew 20 秒內沒有回覆，它可能正在忙：等畫面更新看有沒有記下，沒有的話再送一次。')
        no(`決定沒有送出（${r.status}），請再送一次。`)
      })
      .catch(() => {
        no('決定沒有送出：和 crew 的連線斷了。')
        lose()
      })
  }

  window.addEventListener('message', ev => {
    const d = state.decide
    if (!d || !d.frame || ev.source !== d.frame.contentWindow || ev.origin !== location.origin) return
    const m = ev.data
    if (!m || typeof m !== 'object') return
    if (m.crew === 'ready') {
      tellDecide({ crew: 'live', on: state.live })
      tellDecide({ crew: 'viewport', h: window.innerHeight })
      // A thing a press on crew's pane named, waiting for the decide page to be there.
      d.ready = true
      if (d.show) {
        tellDecide(d.show)
        d.show = null
      }
    } else if (m.crew === 'size' && typeof m.h === 'number' && Number.isFinite(m.h)) {
      // As tall as what it shows: the decide page scrolls with this page, not inside a box of its own.
      d.frame.style.height = `${Math.max(120, Math.min(400000, Math.ceil(m.h)))}px`
    } else if (m.crew === 'send' && typeof m.id === 'string' && DECIDE_ID.test(m.id) && typeof m.text === 'string' && m.text !== '' && m.text.length <= DECIDE_MAX) decideSend(m.id, m.text)
  })

  // ---------- head, tabs, main ----------

  /** The version this page last saw, for a browser that keeps nothing between frames. */
  const seenBuild = { mark: null }

  /** The time a version loaded, as the person reads a clock; nothing for a time the frame did not give. */
  const clockAt = at => {
    if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0) return ''
    const d = new Date(at)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  /**
   * The crew this conversation runs: a banner while it is older than its files
   * (a crew from before this page sends no version at all), and a word once a
   * new one is in. The page's own files are read from disk each time, so the
   * banner shows even beside a crew too old to know of it.
   */
  const drawBuild = build => {
    const known = build !== null && typeof build === 'object' && typeof build.id === 'string'
    ui.build.hidden = known && build.behind !== true
    const id = !known ? '-' : build.id
    if (id === '') return
    const redo = known && typeof build.redo === 'string' ? build.redo : ''
    // The version and what it started again, as this page last saw them: kept for this tab, and in memory where the browser keeps nothing.
    const mark = `${id}|${redo}`
    const was = seenBuild.mark ?? kept.get('sessionStorage', 'crew.build')
    if (was === mark) return
    seenBuild.mark = mark
    kept.set('sessionStorage', 'crew.build', mark)
    // A page just opened only takes note; so does one beside a crew too old to say its version.
    if (was === null || !known) return
    const wasId = was.includes('|') ? was.slice(0, was.indexOf('|')) : was
    if (wasId !== id) {
      const at = clockAt(build.at)
      toast(`crew 換上新版了${at === '' ? '' : `（${at}）`}。${redo}`)
    } else if (redo !== '') toast(`crew：${redo}`)
  }

  // ---------- the tab's title, marked a moment after a press on crew's pane ----------

  /**
   * crew brings the browser forward with no say over which tab it shows (it scripts no browser): so for a few
   * seconds after a press moved this page, its title carries a mark, blinking a few times (steady for a person who
   * asked for less motion), and the person finds crew's tab in the tab bar. A press again starts the time anew; at
   * its end the title is the page's own again.
   */
  const TITLE_MARK = '● '
  const MARK_MS = 6000
  const BLINK_MS = 600
  const BLINKS = 3
  const titled = { base: document.title || 'crew', on: false, timers: [] }
  const showTitle = () => {
    document.title = titled.on ? `${TITLE_MARK}${titled.base}` : titled.base
  }
  const markTitle = () => {
    for (const t of titled.timers) clearTimeout(t)
    titled.timers = []
    titled.on = true
    showTitle()
    const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // Off and on again BLINKS times, ending on: then it stays until MARK_MS.
    if (!still) {
      for (let i = 1; i <= BLINKS * 2; i += 1) {
        titled.timers.push(
          setTimeout(() => {
            titled.on = i % 2 === 0
            showTitle()
          }, i * BLINK_MS),
        )
      }
    }
    titled.timers.push(
      setTimeout(() => {
        titled.on = false
        titled.timers = []
        showTitle()
      }, MARK_MS),
    )
  }

  const drawHead = head => {
    const title = typeof head.title === 'string' && head.title !== '' ? head.title : 'crew'
    ui.title.textContent = title
    // The page's own title: a mark a press put on it stays on top of it until its time is up.
    titled.base = `crew · ${title}`
    showTitle()
    ui.chip.hidden = !(typeof head.chip === 'string' && head.chip !== '')
    ui.chip.textContent = head.chip || ''
    ui.status.textContent = typeof head.text === 'string' ? head.text : ''
    ui.demo.hidden = head.demo !== true
    drawBuild(head.build)
    state.remote = typeof head.remote === 'string' && /^https?:\/\//.test(head.remote) ? head.remote : ''
    ui.shareRow.hidden = state.remote === ''
    ui.shareUrl.textContent = state.remote
    // Why there is no link, in crew's own words; crew says why each time, so the page guesses nothing.
    const why = typeof head.remoteWhy === 'string' && head.remoteWhy !== '' ? head.remoteWhy : '還沒有其他裝置的連結：crew 正在看 Tailscale。'
    ui.shareWhy.textContent = state.remote === '' ? why : '在手機或另一台電腦打開這個連結：'
  }

  const drawNav = nav => {
    const tabs = Array.isArray(nav.tabs) ? nav.tabs : []
    const now = typeof nav.tab === 'string' ? nav.tab : state.tab
    state.tab = now
    kept.set('sessionStorage', 'crew.tab', now)
    showDecide()
    ui.nav.replaceChildren()
    tabs.forEach((t, i) => {
      if (!Array.isArray(t) || typeof t[0] !== 'string') return
      const [id, label, count] = t
      const b = document.createElement('button')
      b.type = 'button'
      b.dataset.k = `nav:${id}`
      const name = document.createElement('span')
      name.textContent = String(label)
      b.append(name)
      if (typeof count === 'number' && count > 0) {
        const c = document.createElement('span')
        c.className = 'count'
        c.textContent = String(count)
        c.setAttribute('aria-label', `${count} 件`)
        b.append(c)
      }
      if (id === now) b.setAttribute('aria-current', 'page')
      b.addEventListener('click', () => {
        if (id === state.tab) return
        for (const o of ui.nav.querySelectorAll('[aria-current]')) o.removeAttribute('aria-current')
        b.setAttribute('aria-current', 'page')
        press('nav', id, undefined, null)
      })
      ui.nav.append(b)
      if (i === 0) {
        const sep = document.createElement('span')
        sep.className = 'sep'
        sep.setAttribute('aria-hidden', 'true')
        ui.nav.append(sep)
      }
    })
  }

  /** The control a person was on, found again in the new drawing: focus and a field's caret stay where they were. */
  const drawMain = body => {
    const active = document.activeElement
    const k = active && active.dataset ? active.dataset.k : undefined
    const caret = active && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : undefined
    const inMain = active && ui.tree.contains(active)
    ui.tree.replaceChildren(build(body))
    if (inMain && k !== undefined) {
      const again = Array.from(ui.tree.querySelectorAll('[data-k]')).find(e => e.dataset.k === k)
      if (again) {
        again.focus({ preventScroll: true })
        if (caret && typeof again.setSelectionRange === 'function') {
          try {
            again.setSelectionRange(caret[0], caret[1])
          } catch (e) {
            // A control without a caret.
          }
        }
      }
    }
  }

  const onFrame = f => {
    if (!f || typeof f !== 'object') return
    state.frame = f
    if (typeof f.mark === 'string') state.mark = f.mark
    if (typeof f.at === 'string') state.lostAt = f.at
    let wasSaved = false
    for (const a of Array.isArray(f.acks) ? f.acks : []) {
      const p = state.pending.get(a.id)
      if (!p) continue
      state.pending.delete(a.id)
      // Only a press that reached crew's own work says so: a view's move is no decision.
      if (a.ok === true && a.saved === true) wasSaved = true
      if (a.ok === true && p.kind === 'submit') state.drafts.delete(p.key)
    }
    if (f.head) drawHead(f.head)
    if (f.nav) drawNav(f.nav)
    if (f.body !== undefined) drawMain(f.body)
    if (f.decide !== undefined) drawDecide(f.decide)
    if (f.go !== undefined) applyGo(f.go)
    for (const t of Array.isArray(f.toasts) ? f.toasts : []) if (t && typeof t.text === 'string') toast(t.text)
    // crew's end of a decision it was still working on: the decide page finds its item by the send's id.
    for (const x of Array.isArray(f.decided) ? f.decided : []) {
      if (x && typeof x.id === 'string' && DECIDE_ID.test(x.id) && typeof x.ok === 'boolean') tellDecide({ crew: 'late', id: x.id, ok: x.ok, text: typeof x.text === 'string' ? x.text.slice(0, 400) : '' })
    }
    if (wasSaved) saved()
  }

  // ---------- where a press on crew's pane sent this page ----------

  const GO_ID = /^[A-Za-z0-9.-]{1,40}$/
  const THING = /^[A-Za-z0-9_-]{1,40}$/
  const FRAME_TABS = ['prd', 'accept', 'designs', 'questions']

  /** The thing the press named, lit a moment where it is drawn. */
  const light = el => {
    el.classList.add('go-lit')
    setTimeout(() => el.classList.remove('go-lit'), 2600)
  }

  /** The first words on the page that start so. */
  const byText = text => {
    for (const e of ui.tree.querySelectorAll('.t, h2, h3')) if ((e.textContent || '').trim().startsWith(text)) return e
    return null
  }

  /**
   * crew moved this page where a press on its pane said (the tab, the page over it, what is open): what the press
   * named is brought into view once, by crew's own control's key, by its words, or as a thing on the decide page.
   */
  const applyGo = g => {
    if (!g || typeof g !== 'object' || typeof g.id !== 'string' || !GO_ID.test(g.id)) return
    // Once: the same frame comes again when the page reconnects or reloads.
    if (state.goSeen === g.id || kept.get('sessionStorage', 'crew.go') === g.id) return
    state.goSeen = g.id
    kept.set('sessionStorage', 'crew.go', g.id)
    markTitle()
    const behavior = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    const keys = Array.isArray(g.keys) ? g.keys.filter(k => typeof k === 'string').slice(0, 8) : []
    const all = Array.from(ui.tree.querySelectorAll('[data-k]'))
    let target = null
    for (const k of keys) {
      target = all.find(e => e.dataset.k === k) || null
      if (target) break
    }
    if (!target && typeof g.text === 'string' && g.text !== '') target = byText(g.text.slice(0, 40))
    if (target) {
      const card = target.closest('.card, .item, .role, .region') || target
      card.scrollIntoView({ block: 'center', behavior })
      light(card)
      return
    }
    const fr = g.frame
    const d = state.decide
    if (fr && typeof fr === 'object' && FRAME_TABS.includes(fr.tab) && d && d.frame) {
      const show = { crew: 'show', tab: fr.tab, ...(typeof fr.id === 'string' && THING.test(fr.id) ? { id: fr.id } : {}) }
      if (d.ready) tellDecide(show)
      else d.show = show
      return
    }
    window.scrollTo({ top: 0, behavior })
  }

  // ---------- presses ----------

  const press = (kind, key, value, el) => {
    if (!state.live) {
      toast('現在和 crew 斷線，這個按鈕沒有送出。連回來之後再按一次。')
      return
    }
    const id = randomHex(8)
    state.pending.set(id, { key, kind, at: Date.now() })
    if (el) busy(el, true)
    const body = { client: state.client, key, kind, id, ...(value === undefined ? {} : { value: String(value).slice(0, 10000) }), ...(state.mark ? { frame: state.mark } : {}) }
    const undo = () => {
      state.pending.delete(id)
      if (el && el.isConnected) busy(el, false)
    }
    post('/press', body)
      .then(r => {
        if (r.status === 204) return
        undo()
        if (r.status === 401) return needLink()
        if (r.status === 403) return denied()
        if (r.status === 409) {
          toast('crew 還沒看到這一頁，等它連上之後再按一次。')
          return reconnect()
        }
        toast(`按鈕沒有送出（${r.status}），請再按一次。`)
      })
      .catch(() => {
        undo()
        toast('按鈕沒有送出：和 crew 的連線斷了。')
        lose()
      })
  }

  // A press crew never answered: the control is given back, and the person told.
  setInterval(() => {
    const now = Date.now()
    let late = false
    for (const [id, p] of state.pending) {
      if (now - p.at < PRESS_WAIT_MS) continue
      state.pending.delete(id)
      late = true
      for (const e of ui.tree.querySelectorAll('[data-k]')) if (e.dataset.k === p.key || e.dataset.k === `${p.key}::submit`) busy(e, false)
    }
    if (late) toast('crew 還沒處理完剛剛的按鈕，它可能正在忙。畫面更新後會看到結果；沒有的話再按一次。')
  }, 1000)

  // ---------- the connection ----------

  const stop = () => {
    clearTimeout(state.timer)
    if (state.es) {
      state.es.onerror = null
      state.es.close()
      state.es = null
    }
  }

  const lose = () => {
    stop()
    setLive(false)
    const wait = Math.min(10000, 1000 * 2 ** state.retry)
    state.retry = Math.min(state.retry + 1, 4)
    state.timer = setTimeout(hello, wait)
  }

  const reconnect = () => {
    stop()
    state.timer = setTimeout(hello, 300)
  }

  const connect = () => {
    stop()
    const url = `/events?client=${encodeURIComponent(state.client)}&tab=${encodeURIComponent(state.tab)}&t=${encodeURIComponent(state.token || '')}${state.go ? `&go=${encodeURIComponent(state.go)}` : ''}`
    const es = new EventSource(url)
    state.es = es
    es.onopen = () => {
      state.retry = 0
      // crew has the place: a reconnect later does not take the page there again.
      state.go = ''
      setLive(true)
    }
    es.onmessage = ev => {
      let f
      try {
        f = JSON.parse(ev.data)
      } catch (e) {
        return
      }
      onFrame(f)
    }
    es.onerror = () => {
      if (state.es === es) lose()
    }
  }

  async function hello() {
    if (state.stopped) return
    let r
    try {
      r = await post('/hello', {})
    } catch (e) {
      return lose()
    }
    if (r.status === 200) return connect()
    if (r.status === 401) return needLink()
    if (r.status === 403) return denied()
    lose()
  }

  // ---------- the share popover ----------

  ui.share.addEventListener('click', () => {
    const open = ui.sharePop.hidden
    ui.sharePop.hidden = !open
    ui.share.setAttribute('aria-expanded', String(open))
  })
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && !ui.sharePop.hidden) {
      ui.sharePop.hidden = true
      ui.share.setAttribute('aria-expanded', 'false')
      ui.share.focus()
    }
  })
  document.addEventListener('click', ev => {
    if (ui.sharePop.hidden) return
    if (ui.sharePop.contains(ev.target) || ui.share.contains(ev.target)) return
    ui.sharePop.hidden = true
    ui.share.setAttribute('aria-expanded', 'false')
  })

  /** The clipboard: the browser's own where the page is a secure origin, else a selected field copied the old way. */
  const copy = async text => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
        return true
      }
    } catch (e) {
      // The old way below.
    }
    const t = document.createElement('textarea')
    t.value = text
    t.setAttribute('readonly', '')
    t.className = 'offscreen'
    document.body.append(t)
    t.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch (e) {
      ok = false
    }
    t.remove()
    return ok
  }

  ui.shareCopy.addEventListener('click', async () => {
    if (state.remote === '') return
    toast((await copy(state.remote)) ? '連結已複製。' : '複製不了，請長按連結自己複製。')
  })

  ui.buildCopy.addEventListener('click', async () => {
    const done = text => {
      ui.buildCopy.textContent = text
      setTimeout(() => {
        ui.buildCopy.textContent = '複製 /reload-plugins'
      }, 1600)
    }
    if (await copy('/reload-plugins')) return done('已複製')
    // Not copied: the command is selected, for the person to copy themselves.
    try {
      const range = document.createRange()
      range.selectNodeContents(ui.buildCmd)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
    } catch (e) {
      // Nothing selected: the words still say what to type.
    }
    done('請手動選取')
  })

  ui.coverRetry.addEventListener('click', () => {
    state.retry = 0
    ui.cover.hidden = true
    reconnect()
  })

  // ---------- start ----------

  async function boot() {
    state.client = clientId()
    state.token = kept.get('localStorage', 'crew.token') || ''
    state.tab = kept.get('sessionStorage', 'crew.tab') || 'decide'
    const m = KEY.exec(location.hash)
    if (m) {
      state.go = m[2] || ''
      // The key leaves the address bar at once: it is not kept in history, bookmarks or a copied link.
      history.replaceState(null, '', location.pathname + location.search)
      try {
        const r = await post('/pair', { key: m[1] })
        if (r.ok) {
          const d = await r.json()
          if (d && typeof d.token === 'string') {
            state.token = d.token
            kept.set('localStorage', 'crew.token', d.token)
          }
        }
        // A key already used goes on with the token this browser kept, if any; /hello says whether it still works.
      } catch (e) {
        // The server is not up: /hello below says so.
      }
    }
    hello()
  }

  boot()
})()
