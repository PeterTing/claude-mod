# claude-mod

自製與蒐集的 **Claude Code mod**：即時面板（pane）、輸入框上方的資訊列、狀態列、toast 通知、slash command，以及攔截工具呼叫或 prompt 的 hook，改變 Claude Code 的外觀與行為。

[English](README.md)

這個 repo 本身就是一個 Claude Code plugin marketplace。[`mods/`](mods/) 底下的每個 mod 都能用一行指令安裝；[`COLLECTION.md`](COLLECTION.md) 則整理網路上其他作者發布的好用 mod。

## 安裝 mod

在 Claude Code 終端機的輸入框輸入：

```
/plugin install <mod> --marketplace PeterTing/claude-mod
```

按 `y` 加入 marketplace，再選安裝範圍（預設為 user scope）。

從 shell 安裝：

```
claude plugin install <mod> --marketplace PeterTing/claude-mod
```

桌面版 app 不支援 `/plugin`：點輸入框旁的 **+** → **Plugins** → **Add marketplace** 輸入 `PeterTing/claude-mod` → **Add plugin**。

## Mod 清單

| Mod | 功能 | 類型 |
| --- | --- | --- |
| _尚無_ | | |

## 社群 mod

其他作者的 mod 列在 [`COLLECTION.md`](COLLECTION.md)，附原始 repo 連結、授權與安裝方式。只有在授權允許時才會把程式碼複製進 `mods/`，並保留原授權與作者署名。

## Repo 結構

```
.claude-plugin/marketplace.json   # marketplace 清單：列出 mods/ 裡的每個 mod
mods/<mod-name>/
  .claude-plugin/plugin.json      # 名稱、版本、說明
  hooks/hooks.json                # { "modules": ["./register.tsx"] }
  hooks/register.tsx              # hooks 模組
  hooks/*.test.ts                 # 行為測試
  README.md                       # 功能、截圖、設定
COLLECTION.md                     # 社群 mod 精選清單
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

歡迎開 issue 或 PR：新 mod、修正，或推薦想收錄的社群 mod 都可以。推薦社群 mod 時請附來源網址、授權，以及一句話說明功能。

## 授權

[MIT](LICENSE)。`COLLECTION.md` 收錄的社群 mod 依其原授權。
