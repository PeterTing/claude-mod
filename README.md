# claude-mod

Security-reviewed **mods for Claude Code**, with mods made here to follow: live panes, bands above the prompt, status-line entries, toasts, slash commands, and hooks on tool calls or prompts that change how Claude Code looks and behaves.

[繁體中文](README.zh-TW.md)

This repository is a Claude Code plugin marketplace. It holds mods made here, in [`mods/`](mods/), and community mods that passed a [security review](docs/vetting.md), each pinned to the exact commit that was reviewed. Any of them installs with one line.

## Install a mod

At the prompt of a Claude Code terminal session (2.1.287 or later):

```
/plugin install <mod> --marketplace PeterTing/claude-mod
```

For example, `/plugin install usage-meter --marketplace PeterTing/claude-mod`.

Answer `y` to add the marketplace, then pick a scope (user scope is the default).

From a shell:

```
claude plugin install <mod> --marketplace PeterTing/claude-mod
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box → **Plugins** → **Add marketplace** with `PeterTing/claude-mod` → **Add plugin**.

## Reviewed community mods

Mods by other authors are not sandboxed: they run with your permissions. Each one listed here was reviewed in full before listing, and installing it from this marketplace gets exactly the reviewed commit. [`COLLECTION.md`](COLLECTION.md) has every mod's caveats, and [`docs/vetting.md`](docs/vetting.md) explains the review.

| Mod | What it does | Verdict |
| --- | --- | --- |
| `usage-meter` | 5-hour and 7-day plan usage bars above the prompt | Recommend |
| `context-bar` | Context window as a stacked bar by category | Recommend |
| `token-weather-usage` | Context, limits, cache time left and cost in one line | Recommend |
| `flightdeck` | Live dashboard pane for the model, permission checks and subagents | Recommend |
| `whats-agent-doing` | A box above the prompt saying what Claude is doing now | Recommend |
| `agent-radar` | One live line per running subagent | Recommend |
| `filetree` | File tree with git status that highlights files Claude touches | Recommend |
| `prompt-rail` | A rail of your past prompts to reread and jump to | Recommend |
| `human-in-the-loop` | Tasks only you can do, waiting in a pane until you answer | Caution |
| `prismantis` | Themed tables, code and Mermaid diagrams in replies | Caution |
| `leakstop` | Masks or holds secrets before they leak | Caution |
| `cache-tax` | Keeps the prompt cache warm during breaks | Caution |

**Caution** means the mod is acceptable but has trade-offs to read first, such as token cost, system-prompt additions or rewritten prompts.

## Mods made here

| Mod | What it does | Kind |
| --- | --- | --- |
| [`zh-reply`](mods/zh-reply) | Claude and its agents reply in Chinese (Traditional by default); a reply in another language is asked for again | System prompt, agent tasks, messages; sends a rewrite prompt |
| [`crew`](mods/crew) | A resident PM, QA, tech lead and full-stack work your PRD into features, acceptance criteria, test cases, tasks and code, bring gaps and questions back to you, and remember decisions in the repo. Work in progress | Spawns subagents that edit files and run commands under your permission mode, MCP tools, a pane; writes `prd-tracker.json` and `.crew/`; runs `git worktree add` and `git log` for its own branch `crew/<name>`; uses Haiku once a day |

## Repository layout

```
.claude-plugin/marketplace.json   # marketplace manifest: mods made here + pinned community mods
docs/vetting.md                   # how community mods are reviewed
mods/<mod-name>/
  .claude-plugin/plugin.json      # name, version, description
  hooks/hooks.json                # { "modules": ["./register.tsx"] }
  hooks/register.tsx              # the hooks module
  hooks/*.test.ts                 # behaviour tests
  README.md                       # what it does, screenshots, options
COLLECTION.md                     # reviewed community mods: verdicts, caveats, pinned commits
```

## Develop a mod

```sh
claude --plugin-dir mods/<mod-name>      # run Claude Code with the mod loaded (hot-reloads on save)
claude plugin validate mods/<mod-name>   # check the manifest and hooks module
claude plugin test mods/<mod-name>       # run the mod's *.test.ts files
claude plugin validate .                 # check the marketplace manifest
```

To add a mod: create `mods/<mod-name>/`, add an entry `{ "name": "<mod-name>", "source": "./mods/<mod-name>" }` to `plugins` in `.claude-plugin/marketplace.json`, add a row to the table above, and make sure `validate` and `test` both pass.

## Contributing

Issues and pull requests are welcome, whether it's a new mod, a fix, or a community mod you'd like added. For a community mod, include the repository URL, the plugin path, the license and one line on what it does; it is listed after it passes the [review](docs/vetting.md).

## License

[MIT](LICENSE) for this repository. Community mods are fetched from their authors' repositories and keep their own licenses.
