# crew

**Design preview.** Nothing here runs a team yet: `/crew demo` shows the pane and the line above the prompt with sample data, so the layout can be confirmed before the real thing is built. The plan is in [`docs/plans/crew-plan.zh-TW.html`](../../docs/plans/crew-plan.zh-TW.html).

crew will be a resident product-development team inside Claude Code: a PM, a UI/UX designer, a full-stack engineer, a QA engineer and a tech lead, coordinated by your main conversation. The team works a PRD as a board (`prd-tracker.json`), talks in threads attached to board items, keeps its memory in the repo, and picks each item's model and effort by how complex the item is.

## Try the preview

From this repository:

```sh
claude --plugin-dir mods/crew
```

Then type `/crew demo`. The pane opens beside the conversation with five tabs (Overview, Board, Threads, Memory, Token) and three sample situations (normal, just started, needs attention). `/crew demo off` closes it.

Everything shown is sample data and is marked 設計稿・示意資料.

## Develop

```sh
claude plugin validate mods/crew
claude plugin test mods/crew
```

`spikes/crew/` holds the phase 0 spike that checked the agent APIs crew depends on.
