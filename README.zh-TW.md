# claude-mod

經過安全審查的 **Claude Code mod**（自製 mod 陸續加入）：即時面板（pane）、輸入框上方的資訊列、狀態列、toast 通知、slash command，以及攔截工具呼叫或 prompt 的 hook，改變 Claude Code 的外觀與行為。

[English](README.md)

這個 repo 本身就是一個 Claude Code plugin marketplace，收錄兩種 mod：在這裡自製的（放在 [`mods/`](mods/)），以及通過[安全審查](docs/vetting.md)的社群 mod。社群 mod 都鎖定在審查過的那個 commit。每個 mod 都能用一行指令安裝。

## 安裝 mod

在 Claude Code 終端機（2.1.287 以上）的輸入框輸入：

```
/plugin install <mod> --marketplace PeterTing/claude-mod
```

例如：`/plugin install usage-meter --marketplace PeterTing/claude-mod`。

按 `y` 加入 marketplace，再選安裝範圍（預設為 user scope）。

從 shell 安裝：

```
claude plugin install <mod> --marketplace PeterTing/claude-mod
```

桌面版 app 不支援 `/plugin`：點輸入框旁的 **+** → **Plugins** → **Add marketplace** 輸入 `PeterTing/claude-mod` → **Add plugin**。

## 審查過的社群 mod

mod 沒有 sandbox，會以你的權限執行。下面每個 mod 收錄前都完整審查過；從這個 marketplace 安裝，拿到的就是審查過的那個 commit。每個 mod 的注意事項見 [`COLLECTION.md`](COLLECTION.md)，審查方法見 [`docs/vetting.md`](docs/vetting.md)。

| Mod | 功能 | 判定 |
| --- | --- | --- |
| `usage-meter` | 輸入框上方顯示 5 小時與 7 天方案用量條 | 推薦 |
| `context-bar` | context window 依類別顯示成堆疊長條 | 推薦 |
| `token-weather-usage` | 一行看 context、用量上限、cache 剩餘時間與花費 | 推薦 |
| `flightdeck` | 即時儀表板面板：模型狀態、權限檢查、subagent | 推薦 |
| `whats-agent-doing` | 輸入框上方的小框，顯示 Claude 正在做什麼 | 推薦 |
| `agent-radar` | 每個執行中的 subagent 一行即時狀態 | 推薦 |
| `filetree` | 帶 git 狀態的檔案樹，標出 Claude 正在讀寫的檔案 | 推薦 |
| `prompt-rail` | 歷史 prompt 列表，可重讀、點擊跳轉 | 推薦 |
| `human-in-the-loop` | 只有你能做的事變成待辦，留在面板直到你回覆 | 注意 |
| `prismantis` | 回覆中的表格、程式碼、Mermaid 圖表套主題渲染 | 注意 |
| `leakstop` | 在 secret 外洩前遮罩或攔下 | 注意 |
| `cache-tax` | 休息時讓 prompt cache 保持溫熱 | 注意 |

**注意**表示可以用，但有取捨要先看過，例如會花 token、會在 system prompt 加內容，或會改寫 prompt。

## 自製 mod

| Mod | 功能 | 類型 |
| --- | --- | --- |
| [`zh-reply`](mods/zh-reply) | Claude 和它的 agent 都用中文回覆（預設繁體）；回覆不是中文時請它重說一次 | system prompt、agent 任務、訊息；會代你送出重寫要求 |

## Repo 結構

```
.claude-plugin/marketplace.json   # marketplace 清單：自製 mod + 鎖定 commit 的社群 mod
docs/vetting.md                   # 社群 mod 的審查方法
mods/<mod-name>/
  .claude-plugin/plugin.json      # 名稱、版本、說明
  hooks/hooks.json                # { "modules": ["./register.tsx"] }
  hooks/register.tsx              # hooks 模組
  hooks/*.test.ts                 # 行為測試
  README.md                       # 功能、截圖、設定
COLLECTION.md                     # 審查過的社群 mod：判定、注意事項、鎖定的 commit
```

## 開發 mod

```sh
claude --plugin-dir mods/<mod-name>      # 載入 mod 啟動 Claude Code（存檔即熱重載）
claude plugin validate mods/<mod-name>   # 檢查 manifest 與 hooks 模組
claude plugin test mods/<mod-name>       # 執行 mod 的 *.test.ts
claude plugin validate .                 # 檢查 marketplace manifest
```

新增 mod：建立 `mods/<mod-name>/`，在 `.claude-plugin/marketplace.json` 的 `plugins` 加上 `{ "name": "<mod-name>", "source": "./mods/<mod-name>" }`，在上方表格加一列，並確認 `validate` 與 `test` 都通過。

## 貢獻

歡迎開 issue 或 PR：新 mod、修正，或推薦想收錄的社群 mod 都可以。推薦社群 mod 時請附 repo 網址、plugin 路徑、授權，以及一句話說明功能；通過[審查](docs/vetting.md)後才會收錄。

## 授權

本 repo 為 [MIT](LICENSE)。社群 mod 從原作者的 repo 取得，依其原授權。
