/**
 * The page of one item of the board or one requirement of the PRD: all crew
 * holds on it, whole, and the numbers it is linked to, for the person to read
 * what a row only names. Pure.
 */

import type { CrewLive } from '../types'
import { approvedNow, checkOf, criteriaOf, decisionOf, designsOf, g6PassedNow, liveTasksOf, METHOD_LABEL, methodOf, openProposalOf, resultOf, reviewOf, tasksOf, tipOf } from './board'
import type { Design, PrdItem, Task, TestCase, Tracker } from './board'
import { factsOf, reviewGap, reviewNote, runGap, stampOf, talkedOn } from './live'
import type { ItemFacts } from './live'
import { ITEM_STATUS_NAMES } from './model'
import type { ItemPage, PageLink, PageSection, RequirementRow, RoleId, Snapshot } from './model'
import type { Handed } from './logbook'
import { nameIn, names } from './logbook'
import { redact } from './memory'
import { goneWords, headlineOf, plainOf, refsOf, withoutOwnId } from './prd'
import type { Requirement } from './prd'

/** What each way of verifying a test case takes to pass, as its page says it. */
const METHOD_SAID: Record<'command' | 'qa' | 'accept', string> = {
  command: 'crew 跑測試指令（crew 找到的和你設定的），輸出有一行帶這個編號、寫通過才算通過',
  qa: 'QA 在 crew 開起來的 app 裡照步驟操作，回報通過並附截圖才算通過；這個功能的任務之後有新的 commit，就要重新操作',
  accept: '列在「待你驗收」卡片上，你驗收這個功能、勾選這一項才算通過；G6 不等這一項，但功能要你驗收才算完成',
}

export type PageSources = {
  board: Tracker | null
  live: CrewLive
  /** What the tabs show now: where each item stands, the threads and the requirement rows. */
  snap: Pick<Snapshot, 'items' | 'threads' | 'requirements' | 'roles'>
  /** The PRD's requirements as crew can read them, and those the board last answered. */
  requirements: readonly Requirement[]
  /** The work that started a role, from the log. */
  handedOut?: readonly Handed[]
  /** The items each role has a run kept on. */
  kept?: ReadonlyMap<RoleId, ReadonlySet<string>>
  now: number
}

const casesOf = (item: PrdItem): TestCase[] => (Array.isArray(item.test_cases) ? item.test_cases.filter(c => typeof c?.id === 'string') : [])

const liveTasks = (item: PrdItem): Task[] => tasksOf(item).filter(x => x.crew_dropped === undefined)

/**
 * Where a requirement's number comes from, in the person's words: the PRD's
 * own id, its list's number, or its place, and the heading's or the item's
 * number it goes on from; and why it has a section's name after it.
 */
const numberWords = (r: Requirement): string => {
  if (r.gone === true) return `這一條${goneWords(r)}：PRD 改寫或刪掉了它，看板還沒跟上。`
  if (r.label === undefined) return ''
  const section = r.section === '' ? '' : `這條在「${plainOf(r.section)}」底下。`
  // The number as the PRD writes it or crew reckons it, before a name or a place was put after it for another with the same.
  const bare = r.label.replace(/ #\d+$/, '').split('（')[0] ?? r.label
  if (r.labelFrom === 'own') return `PRD 裡寫的編號是 ${bare}。${section}${bare === r.label ? '' : `另一條也寫 ${bare}，所以這條寫成 ${r.label}。`}`
  const dot = bare.lastIndexOf('.')
  const prefix = dot < 0 ? '' : bare.slice(0, dot)
  const nth = bare.slice(dot + 1)
  const over = r.labelUnder === 'heading' ? `前面接上章節號 ${prefix}` : r.labelUnder === 'item' ? `前面接上它上一層 ${prefix} 的編號` : ''
  const among = r.labelUnder === 'heading' ? `在章節 ${prefix} 裡` : r.labelUnder === 'item' ? `在 ${prefix} 底下` : prefix === '' ? '在整份 PRD 裡' : ''
  // A table row that starts with a dotted number crew did not take for its own: say what crew took it for.
  const first = r.text.includes(' | ') ? (r.text.split(' | ')[0] ?? '').replace(/^(\*\*|__|\x60)(.+)\1$/, '$2') : ''
  // An item that starts with one crew did not take: not after the heading's number, or a count, a version or a date.
  const lead = first === '' ? (/^\d{1,3}(?:\.\d{1,3})+(?![\d.])/.exec(r.text)?.[0] ?? '') : ''
  const kept = /^\d{1,3}(?:\.\d{1,3})+$/.test(first)
    ? `這一列第一格的 ${first} 是表格的內容（像版本號），不是這條需求的編號：crew 照它${among}的順序，叫它 ${bare}。`
    : lead !== ''
      ? `這一條開頭的 ${lead} 不像這條需求的編號（沒有接在章節號後面，或是數量、版本、日期）：crew 照它${among}的順序，叫它 ${bare}。`
      : undefined
  const how =
    kept !== undefined
      ? kept
      : r.labelFrom === 'list'
      ? over === ''
        ? `PRD 的清單裡就是 ${bare}。`
        : `PRD 的清單裡是第 ${nth} 項，${over}，所以是 ${bare}。`
      : `${r.labelFrom === 'recount' ? 'PRD 這一組的編號有重複或缺漏' : 'PRD 沒有替這條編號'}：crew 照它${among}的順序${r.labelFrom === 'recount' ? '重新數' : ''}，叫它 ${bare}。`
  const shared = bare === r.label ? '' : `另一條也算出 ${bare}，所以這條寫成 ${r.label}。`
  return `${how}${section}${shared}`
}

/** The numbers of the board a text names, each once, not the item's own: pressed, they open too. */
const namedIn = (text: string, self: string, link: (id: string) => PageLink | undefined): PageLink[] => {
  const ids = [...new Set(text.match(/[A-Za-z][A-Za-z0-9_]*-[0-9A-Za-z]+/g) ?? [])].filter(id => id !== self)
  return ids.flatMap(id => {
    const found = link(id)
    return found === undefined ? [] : [found]
  })
}

/** The page of a number, or what it says when neither the board nor the PRD holds it. */
export const itemPageOf = ({ board, live, snap, requirements, handedOut = [], kept = new Map(), now }: PageSources, id: string): ItemPage => {
  const facts: Map<string, ItemFacts> = factsOf(board, requirements, snap.items, [])
  const ran = (board?.prd_items ?? []).some(i => casesOf(i).some(c => resultOf(c) !== undefined))
  const caseResult = (c: TestCase): string => (g6PassedNow(c) ? '通過' : runGap(c, live.flow, ran))
  const link = (other: string, note?: string): PageLink | undefined => {
    const f = facts.get(other)
    if (f === undefined) return undefined
    const status = note ?? f.status
    const req = f.kind === 'PRD 需求' ? requirements.find(r => r.id === other) : undefined
    const title = f.kind === 'PRD 需求' ? headlineOf(req === undefined ? f.title : withoutOwnId(req)) : f.title
    return { id: other, title, ...(req?.label === undefined ? {} : { shown: req.label }), ...(status === undefined ? {} : { note: status }) }
  }
  const links = (ids: readonly string[], noteOf?: (id: string) => string | undefined): PageLink[] => ids.flatMap(x => link(x, noteOf?.(x)) ?? [])
  const named = (text: string): PageSection[] => {
    const found = namedIn(text, id, x => link(x))
    return found.length === 0 ? [] : [{ title: '提到的項目', links: found }]
  }
  const features = board?.prd_items ?? []
  const allCases = features.flatMap(casesOf)
  const row = snap.items.find(i => i.id === id)
  const said = facts.get(id)
  const head = {
    type: 'item' as const,
    id,
    kind: said?.kind ?? '項目',
    title: said?.title ?? '看板和 PRD 都沒有這個編號',
    ...(said?.status === undefined ? {} : { status: said.status }),
    ...(row === undefined ? {} : { owner: row.owner, route: row.route }),
    ...(talkedOn(live.threads[id]) ? { thread: true as const } : {}),
  }
  // A task's run is the one on that task, live only while the role is on it; any other page's, the role's newest.
  const lastRun = (role: RoleId, item?: string) => {
    // A builder after the first is the one on this task, when one is.
    const row = (item === undefined ? undefined : snap.roles.find(r => r.id === role && r.slot !== undefined && names(r.doing, item))) ?? snap.roles.find(r => r.id === role && r.slot === undefined)
    const run = row?.run
    if (run === undefined) return []
    if (item === undefined) return [{ role, run }]
    return [{ role, run: { agentId: run.agentId, item, ...(run.live === true && names(row?.doing ?? '', item) ? { live: true as const } : {}) } }]
  }
  const belongs = (item: PrdItem) => {
    const up = link(item.id)
    const reqs = links(refsOf(item))
    return { ...(up === undefined || item.id === id ? {} : { feature: up }), ...(reqs.length === 0 ? {} : { requirements: reqs }) }
  }

  const casesFor = (ids: readonly string[]): TestCase[] => {
    return allCases.filter(c => (c.acceptance_criteria ?? []).some(a => ids.includes(a)))
  }

  const designRows = (item: PrdItem): PageLink[] => {
    return links(designsOf(item).filter(d => d.crew_dropped === undefined).map(d => d.id))
  }

  const featurePage = (item: PrdItem): ItemPage => {
    const criteria = criteriaOf(item).map(c => c.id)
    const summary = typeof item.summary === 'string' ? item.summary : ''
    return {
      ...head,
      ...belongs(item),
      sections: [
        ...(summary === '' ? [] : [{ title: '內容', text: summary }]),
        { title: '驗收條件', links: links(criteria), empty: '還沒有驗收條件' },
        { title: '設計稿', links: designRows(item), empty: '沒有設計稿' },
        { title: '任務', links: links(liveTasks(item).map(x => x.id)), empty: '還沒有任務' },
        { title: '測試案例', links: casesOf(item).flatMap(c => link(c.id, caseResult(c)) ?? []), empty: '還沒有測試案例' },
      ],
      runs: lastRun('pm'),
    }
  }

  const criterionPage = (item: PrdItem, text: string): ItemPage => {
    const doing = liveTasks(item).filter(x => x.acceptance_criteria.includes(id))
    const status = (x: Task) => {
      const on = snap.items.find(i => i.id === x.id)
      return on === undefined ? undefined : ITEM_STATUS_NAMES[on.status]
    }
    return {
      ...head,
      ...belongs(item),
      sections: [
        ...named(text),
        { title: '由哪些任務做', links: doing.flatMap(x => link(x.id, status(x)) ?? []), empty: '還沒有任務' },
        {
          title: '測試案例',
          hint: 'QA 寫的步驟和預期結果',
          links: casesFor([id]).flatMap(c => {
            const l = link(c.id, caseResult(c))
            return l === undefined ? [] : [{ ...l, lines: stepsOf(c) }]
          }),
          empty: '還沒有測試案例',
        },
      ],
      runs: lastRun('pm'),
    }
  }

  const designPage = (item: PrdItem, d: Design): ItemPage => {
    const mockup = d.crew_mockup
    return {
      ...head,
      ...belongs(item),
      ...(live.review?.url === undefined ? {} : { url: live.review.url }),
      sections: [
        { title: d.kind === 'screen' ? '畫面的規格' : '為什麼沒有畫面', text: d.body },
        ...named(d.body),
        ...(mockup === undefined ? [] : [{ title: '可以點的畫面', lines: [`第 ${mockup.version} 版，在待你決定頁上看${live.review?.url === undefined ? '。現在沒有開著的待你決定頁，要看的話請大腦重新發佈' : ''}`] }]),
      ],
      runs: lastRun('uiux'),
    }
  }

  const taskPage = (item: PrdItem, x: Task): ItemPage => {
    const commits = x.crew_commits ?? []
    const review = reviewOf(x)
    const reviewed = review !== undefined || (live.flow.stage === 'reviewing' && live.flow.reviewing?.task === x.id)
    const saidNow = reviewNote(x, live.flow)
    // What crew told the roles on this task: its messages, the work that started a role, and that work where the log has no word of it yet.
    const told = [
      ...(live.threads[x.id] ?? []).filter(m => m.kind === 'route' && m.from === 'crew').map(m => ({ t: m.t, to: m.to as unknown, slot: m.slot, text: m.text })),
      ...handedOut.filter(h => names(h.text.split('\n')[0] ?? '', x.id)),
    ]
    const started = live.roles.fullstack.task
    const given = told.length > 0
      ? [...told].sort((a, b) => b.t - a.t).slice(0, 5).map(m => `${stampOf(m.t, now)}　crew → ${nameIn(m.to, m.slot)}\n${m.text}`)
      : started !== undefined && names(started.split('\n')[0] ?? '', x.id)
        ? [redact(started)]
        : []
    return {
      ...head,
      ...belongs(item),
      sections: [
        { title: '要做的事', hint: 'Tech lead 寫的完整規格', text: typeof x.detail === 'string' && x.detail !== '' ? x.detail : '（Tech lead 沒有寫）' },
        ...named(x.detail ?? '').filter(s => (s.links ?? []).some(l => !x.acceptance_criteria.includes(l.id))),
        { title: '對應的驗收條件', links: links(x.acceptance_criteria), empty: '沒有對應的驗收條件' },
        { title: '測試案例', links: casesFor(x.acceptance_criteria).flatMap(c => link(c.id, caseResult(c)) ?? []), empty: '還沒有測試案例' },
        { title: '設計稿', links: designRows(item), empty: '這個功能沒有設計稿' },
        {
          title: 'Commit 和 Review',
          lines: commits.length === 0
            ? ['還沒有 commit']
            : [
                `commit ${commits.map(c => c.slice(0, 7)).join('、')}（最新的在前面）`,
                ...(saidNow === undefined ? [] : [saidNow]),
                ...(review === undefined ? [] : [`Tech lead 上次看的是 commit ${review.sha.slice(0, 7)}${review.sha === tipOf(x) ? '，就是最新的' : '，之後又有新的 commit'}`]),
                // Changes asked for are in the line above; an approval's or an old review's words are here.
                ...(review?.notes === undefined || saidNow?.includes(review.notes) === true ? [] : [`Tech lead 的意見：${review.notes}`]),
              ],
        },
        ...(given.length === 0 ? [] : [{ title: 'crew 交代的內容', lines: given }]),
      ],
      // A task nobody has worked on has no run to show.
      runs: [...(commits.length > 0 || [live.roles.fullstack, ...Object.values(live.slots ?? {})].some(r => names(r.doing, x.id)) || kept.get('fullstack')?.has(x.id) === true ? lastRun('fullstack', x.id) : []), ...(reviewed ? lastRun('techlead', x.id) : [])],
    }
  }

  const stepsOf = (c: TestCase): string[] => {
    const steps = Array.isArray(c.steps) ? c.steps.filter((s): s is string => typeof s === 'string') : []
    return [...(steps.length === 0 ? [] : [`步驟：${steps.map((s, i) => `${i + 1}. ${s}`).join(' ')}`]), ...(typeof c.expected === 'string' && c.expected !== '' ? [`預期：${c.expected}`] : [])]
  }

  const casePage = (item: PrdItem, c: TestCase): ItemPage => {
    const steps = Array.isArray(c.steps) ? c.steps.filter((s): s is string => typeof s === 'string') : []
    const result = resultOf(c)
    return {
      ...head,
      ...belongs(item),
      status: caseResult(c),
      sections: [
        { title: '步驟', lines: steps.map((s, i) => `${i + 1}. ${s}`), empty: 'QA 沒有寫步驟' },
        { title: '預期結果', text: typeof c.expected === 'string' && c.expected !== '' ? c.expected : '（QA 沒有寫）' },
        ...(typeof c.fixture === 'string' && c.fixture !== '' ? [{ title: '測試資料', text: c.fixture }] : []),
        { title: '驗證的驗收條件', links: links(c.acceptance_criteria ?? []), empty: '沒有對應的驗收條件' },
        { title: '驗證方式', lines: methodLines(c) },
        ...evidenceOf(c),
        ...(result === undefined ? [] : [{ title: '上次跑測試指令的結果', lines: [`${result.result === 'passed' ? '通過' : '失敗'}，commit ${result.sha.slice(0, 7)}${result.stale === true ? '，之後又有新的 commit' : ''}${result.by === undefined ? '' : `，指令：${result.by}`}`, `完整輸出：.crew/runs/${result.run}.log`] }]),
      ],
      runs: lastRun('qa'),
      verify: { method: methodOf(c) },
    }
  }

  // How the test case is verified, as the person set it, and QA's proposal of another way waiting for them.
  const methodLines = (c: TestCase): string[] => {
    const m = methodOf(c)
    const p = openProposalOf(c)
    return [
      `${METHOD_LABEL[m]}：${METHOD_SAID[m]}`,
      ...(m === 'command' ? [] : ['這是你設定的；要改回「測試指令」，按下面的按鈕。']),
      ...(p === undefined ? [] : [`QA 提議改用「${METHOD_LABEL[p.method]}」，理由：${p.reason}（等你在待你決定確認）`]),
    ]
  }
  // The evidence of the other way: QA's result with its commit and screenshot, or the person's tick when they passed the feature.
  const evidenceOf = (c: TestCase): { title: string; lines: string[] }[] => {
    const e = checkOf(c)
    if (e === undefined) return []
    if (e.method === 'accept') return [{ title: '你驗收時確認', lines: ['你通過這個功能時勾選了這一項。'] }]
    return [
      {
        title: 'QA 實際操作的結果',
        lines: [
          `${e.result === 'passed' ? '通過' : '沒過'}${e.round === undefined ? '' : `，第 ${e.round} 輪`}${e.sha === undefined ? '' : `，commit ${e.sha.slice(0, 7)}`}${e.stale === true ? '：這個功能的任務之後又有 commit，要 QA 重新操作' : ''}`,
          ...(e.shot === undefined ? [] : [`截圖：${e.shot}`]),
          ...(e.note === undefined ? [] : [`QA 寫的：${e.note}`]),
        ],
      },
    ]
  }

  const designNote = (f: PrdItem | undefined): string => {
    const designs = f === undefined ? [] : designsOf(f).filter(d => d.crew_dropped === undefined)
    if (designs.length === 0) return '沒有設計稿'
    const approved = designs.filter(d => decisionOf(d)?.verdict === 'approved').length
    return approved === designs.length ? `設計稿 ${designs.map(d => d.id).join('、')} 都核准了` : `設計稿 ${approved}/${designs.length} 核准`
  }

  const requirementPage = (r: Requirement): ItemPage => {
    const rowOf: RequirementRow | undefined = snap.requirements?.find(x => x.id === id)
    const answering = features.filter(f => f.crew_dropped === undefined && refsOf(f).includes(id))
    const criteria = answering.flatMap(criteriaOf).map(c => c.id)
    const serving = answering.flatMap(f => liveTasks(f).filter(x => x.acceptance_criteria.some(a => criteria.includes(a))))
    const cases = casesFor(criteria)
    const planned = new Set(serving.flatMap(x => x.acceptance_criteria))
    const count = (key: keyof RequirementRow['layers']) => rowOf?.layers[key].note ?? ''
    const out = rowOf?.dropped
    return {
      ...head,
      kind: r.label === undefined ? 'PRD 需求' : `PRD 需求 ${r.label}`,
      title: headlineOf(withoutOwnId(r)),
      // Named by the PRD's own number; crew's id is said under 編號.
      ...(r.label === undefined ? {} : { idHidden: true as const }),
      ...(out === undefined && r.gone !== true ? {} : { status: [...(r.gone === true ? [goneWords(r)] : []), ...(out === undefined ? [] : [`移出範圍：${out}`])].join('；') }),
      sections: [
        { title: 'PRD 怎麼寫', text: plainOf(r.text) },
        {
          title: '編號',
          text: `${numberWords(r)}${id} 是 crew 內部代號：角色把功能接到這條需求時用，你不用記。`,
        },
        { title: '規格', hint: '回答這條需求的功能', links: links(answering.map(f => f.id)), empty: '還沒有功能回答這條需求' },
        { title: `設計 ${count('design')}`.trim(), hint: '有核准設計稿的功能', links: links(answering.map(f => f.id), f => designNote(answering.find(x => x.id === f))), empty: '還沒有功能回答這條需求' },
        { title: `測試案例 ${count('cases')}`.trim(), hint: '已經有測試案例的驗收條件', links: links(criteria, a => { const n = casesFor([a]).length; return n === 0 ? '還沒有測試案例' : `${n} 個測試案例` }), empty: '還沒有驗收條件' },
        { title: `任務 ${count('tasks')}`.trim(), hint: '已經有任務的驗收條件', links: links(criteria, a => (planned.has(a) ? '有任務' : '還沒有任務')), empty: '還沒有驗收條件' },
        { title: `實作 ${count('code')}`.trim(), hint: '已經 commit 的任務', links: serving.flatMap(x => link(x.id, (x.crew_commits ?? []).length > 0 ? `commit ${(x.crew_commits ?? [])[0]?.slice(0, 7) ?? ''}` : '還沒有 commit') ?? []), empty: '還沒有任務' },
        { title: `Review ${count('review')}`.trim(), hint: '最新 commit 被 Tech lead 核准的任務', links: serving.flatMap(x => link(x.id, approvedNow(x) ? 'review 通過' : reviewGap(x, live.flow)) ?? []), empty: '還沒有任務' },
        { title: `測試結果 ${count('runs')}`.trim(), hint: '最新一次跑測試通過的測試案例', lines: board !== null && liveTasksOf(board).some(x => !approvedNow(x)) ? ['看板上全部任務 review 過才會跑測試'] : [], links: cases.flatMap(c => link(c.id, caseResult(c)) ?? []), empty: '還沒有測試案例' },
      ],
    }
  }

  for (const item of features) {
    if (item.id === id) return featurePage(item)
    const criterion = criteriaOf(item).find(c => c.id === id)
    if (criterion !== undefined) return criterionPage(item, criterion.text)
    const design = designsOf(item).find(d => d.id === id)
    if (design !== undefined) return designPage(item, design)
    const task = tasksOf(item).find(x => x.id === id)
    if (task !== undefined) return taskPage(item, task)
    const testCase = casesOf(item).find(c => c.id === id)
    if (testCase !== undefined) return casePage(item, testCase)
  }
  const requirement = requirements.find(r => r.id === id)
  return requirement === undefined ? { ...head, sections: [] } : requirementPage(requirement)
}
