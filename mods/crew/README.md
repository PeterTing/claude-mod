# crew

**Work in progress.** crew is a resident product-development team inside Claude Code. Your main conversation coordinates it.

```
/plugin install crew --marketplace PeterTing/claude-mod
```

Two roles run today:

- **PM** splits a PRD into features and acceptance criteria.
- **QA** writes a test case for every criterion.

The team also handles:

- **Gaps:** they go back to the PM, who drops each one with a reason or asks QA to test it.
- **Questions:** product questions come to you.
- **Memory:** the team keeps it in the repo, so a role can start from a clean context without forgetting.

UI/UX, full-stack and tech lead come in phase 4. The plan is in [`docs/plans/crew-plan.zh-TW.html`](../../docs/plans/crew-plan.zh-TW.html).

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
| `/crew start <PRD file>` | The PM splits the PRD, then QA writes test cases. The PRD must be a file inside the repo. |
| `/crew answer <Q-nn> <answer>` | Answers a question a role asked you. The answer is saved as a decision. |
| `/crew ask <pm\|qa> <question>` | Asks a role directly. Its reply lands in thread `ASK-nn`, and a toast tells you when it is there. |
| `/crew thread <id>` | Prints a thread, for example `ASK-01` or `AC-003`. |
| `/crew remember <text>` | Saves one of your preferences (`PREF`). Every role gets your preferences with its work. |
| `/crew recall <words or ids>` | Searches the team's memory. |
| `/crew rotate <pm\|qa>` | The next time that role is woken, it starts from a fresh context. It gets the board's state, the related memories and its last report. |
| `/crew resume` | Starts the roles of an unfinished PRD again, for example after a role's run failed. |
| `/crew consolidate [YYYY-MM-DD]` | Haiku reads a day's log and saves facts and lessons nobody saved. This also runs by itself once a day for the previous day. |
| `/crew status` | One-line summary. |
| `/crew reset` | Forgets this session's flow and roles. The board, threads and memory are kept. |
| `/crew demo` | The design preview with sample data. `/crew demo off` closes it. |

**After a restart.** When Claude Code starts on a PRD crew left unfinished on this machine, the roles start again by themselves, and crew says how many questions are waiting for you.

## Where things live

| Path | In git | What |
| --- | --- | --- |
| `prd-tracker.json` | yes | The board: features, acceptance criteria, test cases, decisions. |
| `.crew/threads/*.jsonl` | yes | Messages between roles, and between you and a role. Every message is appended; the pane shows the latest 50 per item. |
| `.crew/memory/memories.jsonl` | yes | Long-term memory: decisions (`DEC`), facts (`MEM`), lessons (`LES`), your preferences (`PREF`). |
| `.crew/memory/consolidated.json` | yes | The days the log has been tidied. |
| `.crew/log/*.jsonl` | no | The day's log, used for consolidation. |
| `.crew/usage/*.json` | no | Token use per day. |

The flow, the open questions and who started the work are not in the repo. crew keeps them in its own store on this machine, keyed by the repo's path. A repo you clone therefore cannot start work by itself.

crew adds `usage/` and `log/` to `.crew/.gitignore` and leaves your own rules there alone.

## Safety

- **Secrets are masked.** Anything that looks like a key, token, password, private key, JWT, connection-string password or bearer token is masked before it is written anywhere crew writes. Words in a rule, like 「密碼：至少 8 個字元」, are left alone. Masking works by pattern, so a secret in an unusual shape can still get through: keep secrets out of PRDs and answers.
- **crew never writes over what it cannot read, nor outside the repo.** A board it cannot parse (a merge conflict, a typo) is left as it is until you fix it. A file of crew's that is a link, or that leads out of the repo, is neither read nor written. That includes a link to another file inside the repo: crew does not follow links at all. Either way crew tells you why.
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
