import { describe, expect, test } from 'claude-code/testing'

import { searchMemories } from './memory'
import type { MemoryEntry } from './memory'

/**
 * Recall probe: the memories one live run of the todo-app PRD left behind
 * (2026-10-15), and questions a role or the person would ask about them.
 * Each question's answer must rank in the top three. The plan's bar is 18 of
 * 20: below it, keyword retrieval is not enough and crew needs vector search.
 */
const MEMORIES: MemoryEntry[] = [
  {
    "id": "DEC-001",
    "type": "DEC",
    "text": "AC-009 移出範圍：一條講了三種檢視，拆成三條",
    "refs": [
      "AC-009",
      "PRD-003"
    ],
    "roles": [],
    "source": "pm",
    "t": 1792060439289
  },
  {
    "id": "PREF-001",
    "type": "PREF",
    "text": "標題長度用字元數計算，一個 emoji 算一個字",
    "refs": [],
    "roles": [],
    "source": "person",
    "t": 1792060501279
  },
  {
    "id": "DEC-002",
    "type": "DEC",
    "text": "ASK-01：篩選檢視（全部/未完成/已完成）的「記住上次選擇」存在瀏覽器 localStorage，不存後端、不綁帳號。理由：PRD v1 沒有帳號或後端需求，重新整理後保留即可。同一瀏覽器有效，換瀏覽器或清除資料後不保留。此為 AC-010 的實作依據。",
    "refs": [
      "ASK-01",
      "PRD-003",
      "AC-010"
    ],
    "roles": [],
    "source": "pm",
    "t": 1792060507560
  },
  {
    "id": "DEC-003",
    "type": "DEC",
    "text": "標題只含空白字元視為空白，不能新增（PM 依 PRD 解讀，已套用於 AC-003）。",
    "refs": [
      "AC-003"
    ],
    "roles": [],
    "source": "整理 2026-10-15",
    "t": 1792060605170
  },
  {
    "id": "DEC-004",
    "type": "DEC",
    "text": "標題 100 字上限：剛好 100 字可新增，超過 100 字不可新增。字數依 PREF-001 用字元數計算，一個 emoji 算一個字。此為 PM 依 PRD「最多 100 字」字面的解讀，PRD 未明寫邊界。",
    "refs": [
      "AC-004",
      "AC-005",
      "PREF-001"
    ],
    "roles": [],
    "source": "整理 2026-10-15",
    "t": 1792060605178
  },
  {
    "id": "MEM-001",
    "type": "MEM",
    "text": "使用者第一次進入、尚未選過檢視時的預設檢視，PRD 沒有定義，尚未訂條件。QA 目前的 test case 假設預設為「全部」，這個假設還沒有經過確認。",
    "refs": [
      "PRD-003"
    ],
    "roles": [],
    "source": "整理 2026-10-15",
    "t": 1792060605180
  },
  {
    "id": "LES-001",
    "type": "LES",
    "text": "AC-010 的 test case 要明確涵蓋換瀏覽器情境（依 DEC-002：新瀏覽器沒有儲存紀錄，應顯示預設「全部」）。QA 初版只有間接對應，沒有明確寫出這個情境。",
    "refs": [
      "AC-010",
      "DEC-002"
    ],
    "roles": [],
    "source": "整理 2026-10-15",
    "t": 1792060605181
  },
  {
    "id": "LES-002",
    "type": "LES",
    "text": "標題長度相關的 test case 要測「一個 emoji 算一個字」（依 PREF-001）。QA 初版的 AC-004、AC-005 test case 沒有涵蓋這點。",
    "refs": [
      "AC-004",
      "AC-005",
      "PREF-001"
    ],
    "roles": [],
    "source": "整理 2026-10-15",
    "t": 1792060605182
  },
  {
    "id": "MEM-002",
    "type": "MEM",
    "text": "PM 拆分的功能與驗收條件對應：PRD-001 新增待辦對應 AC-001 到 AC-005；PRD-002 完成待辦對應 AC-006、AC-007；PRD-003 篩選待辦對應 AC-008、AC-010 到 AC-013。AC-009 已移出範圍，改由 AC-011 到 AC-013 取代（見 DEC-001）。",
    "refs": [
      "PRD-001",
      "PRD-002",
      "PRD-003",
      "AC-001",
      "AC-002",
      "AC-003",
      "AC-004",
      "AC-005",
      "AC-006",
      "AC-007",
      "AC-008",
      "AC-010",
      "AC-011",
      "AC-012",
      "AC-013",
      "AC-009",
      "DEC-001"
    ],
    "roles": [],
    "source": "整理 2026-10-15",
    "t": 1792061374858
  },
  {
    "id": "MEM-003",
    "type": "MEM",
    "text": "DEC-003 和 DEC-004 是 PM 對 PRD 的解讀（PRD 未明寫這些邊界），尚未經使用者確認，不是使用者決定。使用者確認前，相關 test case 應視為假設。",
    "refs": [
      "DEC-003",
      "DEC-004",
      "AC-003",
      "AC-004",
      "AC-005"
    ],
    "roles": [],
    "source": "整理 2026-10-15",
    "t": 1792061374863
  },
  {
    "id": "MEM-004",
    "type": "MEM",
    "text": "QA 已為 12 條驗收條件寫入 30 個 test case（SMK-001 到 SMK-030），每條至少 1 個。AC-010 目前 4 個 test case，其中換瀏覽器情境只有間接對應，尚未明確涵蓋。",
    "refs": [
      "SMK-001",
      "SMK-030",
      "AC-010"
    ],
    "roles": [],
    "source": "整理 2026-10-15",
    "t": 1792061374866
  },
  {
    "id": "MEM-005",
    "type": "MEM",
    "text": "使用者在 ASK-02、ASK-03、ASK-05 多次要求「不要查看板，只用你手上的資料」回答問題。之後回答使用者提問時，若使用者有此要求，只根據記憶與當下已知資料回答。",
    "refs": [
      "ASK-02",
      "ASK-03",
      "ASK-05"
    ],
    "roles": [],
    "source": "整理 2026-10-15",
    "t": 1792061374868
  }
]

const PROBES: [string, string[]][] = [
  ["AC-009 為什麼移出範圍？", ["DEC-001"]],
  ["講三種檢視的那條條件為什麼拆開？", ["DEC-001"]],
  ["標題字數怎麼算？", ["PREF-001", "DEC-004"]],
  ["emoji 算幾個字？", ["PREF-001", "DEC-004", "LES-002"]],
  ["篩選檢視存在哪裡？", ["DEC-002"]],
  ["重新整理後要記住上次選的檢視，用什麼存？", ["DEC-002"]],
  ["localStorage 的決定", ["DEC-002"]],
  ["換瀏覽器之後還會記得上次的檢視嗎？", ["DEC-002", "LES-001"]],
  ["AC-010 的 test case 還缺什麼？", ["LES-001", "MEM-004"]],
  ["只有空白字元的標題可以新增嗎？", ["DEC-003"]],
  ["AC-003 空白怎麼判斷？", ["DEC-003"]],
  ["剛好 100 字可以新增嗎？", ["DEC-004"]],
  ["AC-005 的上限邊界", ["DEC-004", "MEM-003"]],
  ["第一次進來預設顯示哪個檢視？", ["MEM-001"]],
  ["PRD-003 的預設檢視有定義嗎？", ["MEM-001"]],
  ["QA 一共寫了幾個 test case？", ["MEM-004"]],
  ["哪些解讀還沒經過使用者確認？", ["MEM-003"]],
  ["AC-004 的 test case 要注意什麼？", ["LES-002", "DEC-004"]],
  ["使用者要求只用手上的資料回答", ["MEM-005"]],
  ["DEC-002 的理由是什麼", ["DEC-002"]],
]

describe('recall probe', () => {
  test('finds the right memory in the top three for every question', () => {
    const misses = PROBES.filter(([question, expected]) => {
      const top = searchMemories(MEMORIES, { text: question, limit: 3 }).map(h => h.entry.id)
      return !expected.some(id => top.includes(id))
    }).map(([question]) => question)
    // 20/20 on 2026-10-15; a miss here is a retrieval regression.
    expect(misses).toEqual([])
  })
})
