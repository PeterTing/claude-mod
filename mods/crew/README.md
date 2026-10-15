# crew

**Work in progress.** crew is a resident product-development team inside Claude Code. Your main conversation coordinates it.

Two roles run today:

- **PM** splits a PRD into features and acceptance criteria.
- **QA** writes a test case for every criterion.

The team also handles:

- **Gaps:** they go back to the PM, who drops each one with a reason or asks QA to test it.
- **Questions:** product questions come to you.
- **Memory:** the team keeps it in the repo, so a role can start from a clean context without forgetting.

UI/UX, full-stack and tech lead come in phase 4. The plan is in [`docs/plans/crew-plan.zh-TW.html`](../../docs/plans/crew-plan.zh-TW.html).

## Try it

Run it in a repository that holds a PRD:

```sh
claude --plugin-dir /path/to/claude-mod/mods/crew
```

If the repository has `schemas/prd-tracker.schema.json`, crew numbers features and test cases with that schema's prefixes.

| Command | What it does |
| --- | --- |
| `/crew start <PRD file>` | The PM splits the PRD, then QA writes test cases. Progress shows in the pane and on the line above the prompt. |
| `/crew answer <Q-nn> <answer>` | Answers a question a role asked you. The answer is saved as a decision. |
| `/crew ask <pm\|qa> <question>` | Asks a role directly. Its reply lands in thread `ASK-nn`, and a toast tells you when it is there. |
| `/crew thread <id>` | Prints a thread, for example `ASK-01` or `AC-003`. |
| `/crew remember <text>` | Saves one of your preferences (`PREF`). Every role gets it with related work. |
| `/crew recall <words or ids>` | Searches the team's memory. |
| `/crew rotate <pm\|qa>` | The next time that role is woken, it starts from a fresh context. It gets the board's state, the related memories and its last report. |
| `/crew consolidate [YYYY-MM-DD]` | Haiku reads a day's log and saves what nobody saved. This also runs once a day by itself. |
| `/crew status` | One-line summary. |
| `/crew reset` | Forgets this session's crew state. The board, threads and memory files are kept. |
| `/crew demo` | The design preview with sample data. `/crew demo off` closes it. |

### What to look for

- **No interruptions.** The main conversation is never woken by the roles: their reports are handled by crew.
- **Memory tab.** The pane's 記憶 tab lists the saved memories and what each role is carrying.
- **Token tab.** It shows tokens per role, wakes, rotations, and the average size of the memories attached to each start or wake.
- **Recall after rotation.** After `/crew rotate pm`, run `/crew ask pm` about an earlier decision. The fresh PM answers from memory, not from its old conversation.

## Where things live

| Path | In git | What |
| --- | --- | --- |
| `prd-tracker.json` | yes | The board: features, acceptance criteria, test cases, decisions. |
| `.crew/threads/*.jsonl` | yes | Messages between roles, and between you and a role. |
| `.crew/memory/memories.jsonl` | yes | Long-term memory: decisions (`DEC`), facts (`MEM`), lessons (`LES`), your preferences (`PREF`). |
| `.crew/log/*.jsonl` | no | The day's log, used for consolidation. |
| `.crew/usage/*.json` | no | Token use per day. |

Anything that looks like a key, token or password is masked before it is written.

## How memory works

- **Saved as it happens.** Roles save decisions, constraints and lessons with `memory_save`. Two kinds of decisions are saved automatically:
  - your answers
  - the PM's scope drops

  Decisions share the board's `DEC-` numbering.
- **Found by id and by words.** A message that mentions `AC-003` finds memories that reference `AC-003` or its feature. Other memories are ranked by BM25 over Chinese character pairs and English words. Superseded memories are never returned.
- **Attached, not loaded.** Starting a role attaches up to about 800 tokens of related memories. So does waking one, but only with memories it has not seen yet.
- **Rotation.** A woken agent resends its whole conversation, so crew starts a fresh one instead when:
  - the role is past half its context limit
  - it moves to another model
  - you ask with `/crew rotate`

  The fresh agent gets the working set, the related memories, its recent thread lines and its last report.
- **Compaction backstop.** If the engine compacts a role during one long run, the summary is told to keep ids, decisions and what is left of the task.

## Develop

```sh
claude plugin validate mods/crew
claude plugin test mods/crew
tsc -p mods/crew   # once Claude Code has loaded the mod and laid its types
```

`spikes/crew/` holds the phase 0 spike that checked the agent APIs crew depends on.
