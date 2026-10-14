# Community mods

Mods by other authors that passed a security review. Each one is pinned in this marketplace to the exact commit that was reviewed, so installing it from here gets that code and nothing newer. [How mods are vetted](docs/vetting.md) explains the review, the verdicts and the reach levels.

Reviewed 2026-10-14 against Claude Code 2.1.299. Every install below was tested from this marketplace, and the installed files were compared byte for byte with the reviewed commit.

```
/plugin install <mod> --marketplace PeterTing/claude-mod
```

Answer `y` to add the marketplace, then pick a scope. Mods need Claude Code 2.1.287 or later.

| Mod | What it does | Verdict | Reach | Author | Reviewed commit |
| --- | --- | --- | --- | --- | --- |
| `usage-meter` | 5-hour and 7-day plan usage bars above the prompt, reset countdown, session cost | Recommend | L1 | [hamzafer](https://github.com/hamzafer/claude-code-mods/tree/87f108479bbf52d6e356fa9218390adbd11df2b9/mods/usage-meter) | `87f1084` |
| `context-bar` | Context window as a stacked bar by category, with the compaction point | Recommend | L1 | [hamzafer](https://github.com/hamzafer/claude-code-mods/tree/87f108479bbf52d6e356fa9218390adbd11df2b9/mods/context-bar) | `87f1084` |
| `token-weather-usage` | One line with context, plan limits against elapsed time, cache time left, cost and agents | Recommend | L1 | [augiefra](https://github.com/augiefra/claude-mods/tree/00ac406f776edbed64f3f78a8f0eb997623698c0/plugins/token-weather-usage) | `00ac406` |
| `flightdeck` | Live dashboard pane: model vitals, permission checks, subagents, session log | Recommend | L1 | [scasella](https://github.com/scasella/claude-flightdeck/tree/6150b9f40b0a36e42c22d39f03ddb81aaefe1844) | `6150b9f` |
| `whats-agent-doing` | A box above the prompt saying what Claude is doing right now | Recommend | L1 | [tzafrir](https://github.com/tzafrir/whats-agent-doing/tree/1efd306948e2cb1866a02fe65f0cdbfb0c3da277) | `1efd306` |
| `agent-radar` | One live line per running subagent; `/radar` for details | Recommend | L1 | [hamzafer](https://github.com/hamzafer/claude-code-mods/tree/87f108479bbf52d6e356fa9218390adbd11df2b9/mods/agent-radar) | `87f1084` |
| `filetree` | IDE-style file tree with git status that highlights files Claude touches | Recommend | L2 | [data-goblin](https://github.com/data-goblin/claude-code-filetree/tree/bc10246a3d5e9ced85ddd591affcd0a65036c2dc) | `bc10246` |
| `prompt-rail` | A rail of your past prompts; hover to reread, click to jump | Recommend | L2 | [oikon48](https://github.com/oikon48/prompt-rail/tree/2ac50fb87fc426fed89ba0f09f1784ef6f289ae8/plugins/prompt-rail) | `2ac50fb` |
| `human-in-the-loop` | Claude assigns you tasks only you can do; they wait in a pane until you answer | Caution | L2 | [tzafrir](https://github.com/tzafrir/human-in-the-loop/tree/644f9441a3a3aad80fbd4708a6a50c6caeaf8cd7) | `644f944` |
| `prismantis` | Themed tables, code, Mermaid diagrams and charts in replies, with copy buttons | Caution | L2 | [NahumLitvin](https://github.com/NahumLitvin/prismantis/tree/2553620fecbe4d81730c9a222349ec0a5687f673) | `2553620` (v0.18.3) |
| `leakstop` | Masks or holds secrets before they are written, printed or committed | Caution | L2 | [AlexandreMartinezOlmos](https://github.com/AlexandreMartinezOlmos/claude-code-leakstop/tree/a273213c82be23a8b0cb696340c579ec2095d7c1/leakstop) | `a273213` |
| `cache-tax` | Keeps the prompt cache warm during breaks; warns once before a cold send | Caution | L2 | [karanb192](https://github.com/karanb192/cache-tax/tree/06cac47ec125a41a4aeeb78a6b006bec8cc6d6ed) | `06cac47` |

None of the twelve calls `$.http` or `$.mcp`, runs a program that reaches the network, approves a tool call on its own, or contains obfuscated code. Only two start a model request on their own: cache-tax's warming pings and human-in-the-loop's answers, both through Claude Code itself.

The only minified code is prismantis's vendored Prism 1.30.0 and beautiful-mermaid 1.1.3 bundles. Both were rebuilt from the npm releases plus the patches in the author's build script. The Mermaid bundle is byte-identical; the Prism bundle differs only in the bundler's own `__commonJS` helper, which rethrows errors.

## Notes per mod

### Usage and context

- **usage-meter**: reads the session's usage only. No files, programs, network or environment variables.
- **context-bar**: reads the session's usage and keeps one show/hide flag. No files, programs or network.
- **token-weather-usage**: reads the session's usage and a few locale and prompt-caching environment variables (no secrets). It keeps subagent descriptions and token counts in its own store for up to 8 idle days.

### Watching Claude work

- **flightdeck**: hooks permission checks and tool calls but only observes; it always passes on Claude Code's own decision unchanged. The first 70 characters of each prompt are shown in its pane.
- **whats-agent-doing**: shows the start of each prompt, and up to 60 characters of a Bash command when the command has no description. Keep that in mind when sharing your screen.
- **agent-radar**: shows up to 50 characters of a subagent's Bash command, unmasked, on screen. Nothing is stored or sent.

### Productivity

- **filetree**:
  - Runs read-only `git`, `find` and `du` in the project, plus small helpers: `uname`, a font-check shell script, and `touch` / `rm -f` on its own marker files in your temp directory.
  - If `HERDR_ENV` is set, it runs `herdr --version`, or the binary that `HERDR_BIN_PATH` names.
  - Arguments are absolute paths or fixed strings.
  - Double-clicking a file opens it with your OS default app, as Finder would. Space opens Quick Look on macOS. "Open with" runs a command you configure.
  - While a file is selected, its path is added to each prompt (documented).
- **prompt-rail**: reads the session transcript; for transcripts over 4 MiB it streams new bytes with `tail`. It keeps only prompt text, ids and file paths in memory, and the transcript paths of recent sessions in its own store.
- **human-in-the-loop** (Caution):
  - Adds three sentences to the system prompt telling Claude to file anything only you can do, including review and approval requests, as a task. This may conflict with workflow rules in your own `CLAUDE.md`.
  - Its tools and guidance add roughly 1K tokens to every request.
  - When you answer a task in the pane, it sends your answer to Claude as a prompt in your name. If Claude was mid-reply, it also sends one fixed line saying so.
  - It rewrites prompts that start with `Answer to #N:`, and attaches pending answers to your next prompt.
  - It lists your open tasks in Claude's context, and keeps tasks and answers in its own store across sessions.

### Appearance

- **prismantis** (Caution):
  - By default it adds about 630 tokens of formatting hints to every prompt, including prompts that other plugins send. Turn them off in `/config` → prismantis → "Diagram hints".
  - It redraws tool rows in the transcript. A collapsed Bash row shows only the command's first line, or Claude's description in quiet mode; expand the row to see the full command. Set `toolRows: false` if you review transcripts closely.
  - It runs `osascript` (macOS) or `copyq` only when you press the copy-as-HTML button. With the LaTeX option on (off by default), it runs `ratex-render` from your `PATH`, which was not reviewed.

### Security and cost

- **leakstop** (Caution):
  - It masks secrets in your prompts and in tool output, including large outputs saved to files. It holds or blocks a command that contains a secret, and replaces the command only when you choose "Show names only". It never stores a secret's value.
  - Before the permission prompt it runs `git diff`, `git log -p` and `find` in the directory Claude names, to look for secrets. Git honours that repository's own config.
  - The built-in Grep tool is not covered.
  - Its fingerprints are unsalted hashes, so a weak password that appears in a block message could be guessed.
- **cache-tax** (Caution):
  - Warming sends a short request asking for a one-word reply, which re-reads your whole context. By the mod's own price table that is about $0.04 (Sonnet 5) to $0.20 (Fable 5) per ping on a 200K context. Under a subscription it uses your plan's limits instead.
  - By default it pings every 50 minutes while you're idle. `/keepwarm` can set an interval as short as 1 minute.
  - It turns itself on for 3 hours after it detects a cold cache write, and a long agentic turn can trigger that too. `/keepwarm off` stops it.
  - After a long idle with a large context, it holds your first message once to show the cost; send it again to go ahead.

## Reviewed, not listed

| Mod | Why it is not listed |
| --- | --- |
| blast-radius ([hamzafer/claude-code-mods](https://github.com/hamzafer/claude-code-mods)) | Its preview step runs commands before the permission prompt in a way that can change files you didn't approve, and pressing Cancel doesn't undo it. Details were reported privately to the author. It will be reconsidered once a fix is reviewed. |
| [secrets-veil](https://github.com/yonatangross/orchestkit/tree/5469225a7d9d141ed3d5992f04566f351a49e611/mods/secrets-veil) (yonatangross) | Its prefix rules also match ordinary identifiers such as `props_list`, so Claude can see altered code and write the masked text back into your files. It also relies on undocumented Claude Code internals. |
| [cache-guard](https://github.com/Agulhas-Labs/claude-plugins/tree/0f840e513a48d9d3ccdab6d351e2fadda1f56ee0/plugins/cache-guard) (Agulhas-Labs) | Overlaps `cache-tax`. It also ships unsandboxed Python hooks, and at session start it points Claude at the newest handoff file in the project, which a cloned repository could supply. |

## Suggest a mod

Open an issue with the mod's repository URL, the plugin path, the license and one line on what it does. It is listed after it passes the [review](docs/vetting.md).
