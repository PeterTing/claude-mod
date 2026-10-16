# crew

**Work in progress.** crew is a resident product-development team inside Claude Code. Your main conversation coordinates it.

```
/plugin install crew --marketplace PeterTing/claude-mod
```

Three roles run today:

- **PM** splits a PRD into features and acceptance criteria.
- **QA** writes a test case for every criterion.
- **Tech lead** breaks the criteria into tasks: what to build, for which criteria, and how big (S, M, L, XL). Gate **G3**, checked by code, needs a task for every criterion.

The team also handles:

- **Gaps:** test gaps go back to the PM, who drops each one with a reason or asks QA to test it. Criteria without a task go back to the tech lead, and then to you.
- **Questions between roles:** the tech lead asks the PM through a thread when it needs a trade-off, and gets the answer back.
- **Questions:** product questions come to you.
- **Memory:** the team keeps it in the repo, so a role can start from a clean context without forgetting.

UI/UX and full-stack come later in phase 4, and with them the code, review and test-run stages of each requirement. The plan is in [`docs/plans/crew-plan.zh-TW.html`](../../docs/plans/crew-plan.zh-TW.html).

## Two ways to run it

**Ask Claude.** Say something like 「請 crew 開始處理 docs/PRD.md」 or 「問 crew 的 PM 為什麼這樣拆」. Claude uses crew's `crew` tool.

For work Claude started, crew reports back to Claude:

- a role's reply
- a question that needs your decision
- the end of the flow

Claude then tells you in a sentence or two. Each report starts a turn of the main conversation, so it uses tokens.

**Use `/crew`.** Work started this way reports only in the pane, the line above the prompt and toasts. The main conversation is not woken.

| Command | What it does |
| --- | --- |
| `/crew start <PRD file>` | The PM splits the PRD, QA writes test cases, then the tech lead breaks the criteria into tasks. The PRD must be a file inside the repo. |
| `/crew answer <Q-nn> <answer>` | Answers a question a role asked you. The answer is saved as a decision. |
| `/crew ask <pm\|qa\|techlead> <question>` | Asks a role directly. Its reply lands in thread `ASK-nn`, and a toast tells you when it is there. |
| `/crew thread <id>` | Prints a thread, for example `ASK-01` or `AC-003`. |
| `/crew remember <text>` | Saves one of your preferences (`PREF`). Every role gets your preferences with its work. |
| `/crew recall <words or ids>` | Searches the team's memory. |
| `/crew rotate <pm\|qa\|techlead>` | The next time that role is woken, it starts from a fresh context. It gets the board's state, the related memories and its last report. |
| `/crew resume` | Starts the roles of an unfinished PRD again, for example after a role's run failed. |
| `/crew consolidate [YYYY-MM-DD]` | Haiku reads a day's log and saves facts and lessons nobody saved. This also runs by itself once a day for the previous day. |
| `/crew status` | One-line summary. |
| `/crew reset` | Forgets this session's flow and roles. The board, threads and memory are kept. |
| `/crew demo` | The design preview with sample data. `/crew demo off` closes it. |

**After upgrading from 0.1.0.** A board crew finished then has no tasks, so its progress counts the plan as not done. Run `/crew start <PRD file>` once: crew checks the board without a new split, and the tech lead plans the tasks.

**After a restart.** When Claude Code starts on a PRD crew left unfinished on this machine, the roles start again by themselves, and crew says how many questions are waiting for you.

## The board stays on the PRD, live

- **Every requirement is numbered.** crew reads the PRD itself. These are requirements:
  - in a section with a list: each list item, with its wrapped lines, and each table data row;
  - in a section without one: each paragraph, except one ending with a colon (a lead-in);
  - the text under the title, only when the rest of the PRD holds no requirement.

  These are not: front matter, code, comments, quotes, headings, breaks, lines that are only an image or a link, context sections (背景, 參考, 附錄, 概述, Background, References…), and the dated or versioned entries of a revision history (修訂紀錄, Change log). So write requirements as list items; a paragraph in a section with a list is not tracked.

  Each requirement gets a number from its words, such as `R-3fa2c1`. The number stays while other lines change or the spacing changes, and changes when its own words do. Anything crew takes for a requirement that is not one can be moved out of scope by the PM, with a reason. crew tracks up to 1,000 requirements per PRD.
- **The PM must cover every requirement.** The PM's features name the requirements they answer. Gate **G0**, checked by code against the PRD file as it stands, needs:
  - every requirement answered by a feature, or moved out of scope with a reason;
  - every feature answering a requirement that is still in the PRD.

  The split is not done until G0 passes.
- **A changed PRD is caught within seconds.** crew checks the PRD file every 10 seconds; the check itself calls no model. When it changes:
  - the pane and the line above the prompt show what changed;
  - the PM is told which requirements were added and removed, once per change;
  - the flow goes back to the split, and cannot finish until the board answers the PRD again; then QA writes tests for what is new only.

  It also runs when Claude Code starts, so an edit made while it was closed is caught too. An added requirement is told at once. A removed one is confirmed on the next check, about 10 seconds later, so a file caught half-saved is not taken for a real edit. A PRD with no requirements left is never sent to the PM.
- **A PRD is a document in the repo.** crew starts `.md`, `.markdown`, `.mdx`, `.txt`, `.rst`, `.adoc` and `.org` files, outside private places such as `.git`, `.crew`, `.ssh` and `.env*`, wherever a link leads. Its requirements go on the board, which is in git.
- **A PRD crew cannot read is called out.** The pane and the line above the prompt say so when the PRD is deleted, moved, swapped for a link, or holds no requirement. crew then keeps holding the board to the requirements it last read. Each new version of the PRD is checked before and after crew reads it: it must still be a file in the repo, reached through no link.
- **A board synced to another PRD is called out too.** A teammate's board, or another branch's, may be synced to another PRD. crew then says so and holds nothing to it until you choose: `/crew start` on the board's PRD to follow it, or on yours to move the board over.
- **Starting a PRD the board already mostly answers checks it, without a new split.** The board is held to the PRD as it stands: the PM fills what is missing, and QA tests what has no test case. A PRD the board answers less than half of is split, and the PM is told which requirements already have features.
- **A PRD change while QA is writing tests keeps that QA.** The PM syncs; when QA's run ends, QA is asked for the new criteria only.
- **The pane says how current it is.** It shows how the board stands against the PRD, when the PRD last changed, and when crew last looked.
- **Progress is counted per requirement.** The Progress tab lists each PRD requirement with how far each stage of its development is: spec, design, test cases, tasks, code, review, test results. Today crew fills in three stages from the board:
  - spec: every feature that answers the requirement has criteria;
  - test cases: those criteria have test cases, counted done only once the spec is;
  - tasks: those criteria have the tech lead's tasks, counted done only once the spec is.

  The other stages show `—` until the roles that do them are added, and never show as done before then. A requirement moved out of scope shows the reason instead.
- **One board, several PRDs.** Starting another PRD keeps the earlier one's requirement numbers on the board, so its features stay its own and do not hold up the new PRD's split. A board from before crew numbered requirements is not reported as a PRD change: the PM is asked to link its features to the requirements.

## Where things live

| Path | In git | What |
| --- | --- | --- |
| `prd-tracker.json` | yes | The board: features, acceptance criteria, test cases, decisions, and (`crew_prd`) the PRD requirements crew holds the board to, with secrets masked, plus the earlier PRDs' requirement numbers. |
| `.crew/threads/*.jsonl` | yes | Messages between roles, and between you and a role. Every message is appended; the pane shows the latest 50 per item. |
| `.crew/memory/memories.jsonl` | yes | Long-term memory: decisions (`DEC`), facts (`MEM`), lessons (`LES`), your preferences (`PREF`). |
| `.crew/memory/consolidated.json` | yes | The days the log has been tidied. |
| `.crew/log/*.jsonl` | no | The day's log, used for consolidation. |
| `.crew/usage/*.json` | no | Token use per day. |

The flow, the open questions and who started the work are not in the repo. crew keeps them in its own store on this machine, keyed by the repo's path. A repo you clone therefore cannot start work by itself.

crew adds `usage/` and `log/` to `.crew/.gitignore` and leaves your own rules there alone.

## Safety

- **Secrets are masked.** Anything that looks like a key, token, password, private key, JWT, connection-string password or bearer token is masked before it is written anywhere crew writes. Words in a rule, like 「密碼：至少 8 個字元」, are left alone. Masking works by pattern, so a secret in an unusual shape can still get through: keep secrets out of PRDs and answers.
- **crew never writes over what it cannot read, nor outside the repo.** A board it cannot parse (a merge conflict, a typo) is left as it is until you fix it. A file of crew's that is itself a link, or whose path leads out of the repo, is neither read nor written. That includes a file that links to another file inside the repo. A directory link on the way is followed only when it lands inside the repo. Either way crew tells you why.
- **Write tools take only crew's own callers.** Only crew's roles and the main conversation can write to the board, threads, questions or memory. Other agents and the roles a reset retired cannot.
- **Each role has its own permissions on the board.** The PM edits features and criteria; QA writes test cases.
- **Your words stay yours.** Roles cannot save or replace your preferences, nor a decision you made or the main conversation relayed for you. The daily tidy-up saves only facts and lessons, never decisions or preferences.
- **Answers are marked by who relayed them.** An answer Claude relays for you is saved as `brain Q-nn`, so it stays traceable.

## How memory works

- **Saved as it happens.** Roles save decisions, constraints and lessons with `memory_save`. Two kinds of decisions are saved automatically:
  - your answers
  - the PM's scope drops

  Decisions share the board's `DEC-` numbering.
- **Found by id and by words.** A message that mentions `AC-003` finds memories that reference `AC-003` or its feature. Other memories are ranked by BM25 over Chinese character pairs and English words. Your preferences always come along. Superseded memories are never returned.
- **Attached, not loaded.** Starting a role attaches up to about 800 tokens of related memories. So does waking one, but only with memories it has not seen yet. A wake also names the other items whose threads hold messages for the role.
- **Rotation.** A woken agent resends its whole conversation, so crew starts a fresh one instead when:
  - the role is past half its context limit
  - it moves to another model
  - you ask with `/crew rotate`

  This happens only when the role is idle: a role at work gets new messages in its inbox instead. The fresh agent gets the working set, the related memories, its recent thread lines and its last report.
- **Failed runs.** A run that ends in an error, an interrupt or a refusal does not move the flow on. Use `/crew resume`.
- **Compaction backstop.** If the engine compacts a role during one long run, the summary is told to keep ids, decisions and what is left of the task.

## Develop

```sh
claude plugin validate mods/crew
claude plugin test mods/crew
tsc -p mods/crew   # once Claude Code has loaded the mod and laid its types
```

`spikes/crew/` holds the phase 0 spike that checked the agent APIs crew depends on. It is not listed in the marketplace and is not meant to be installed.
