# crew

**Work in progress.** crew is a resident product-development team inside Claude Code. Your main conversation coordinates it.

```
/plugin install crew --marketplace PeterTing/claude-mod
```

Five roles take a PRD to tested code, and you approve the designs:

1. **PM** splits a PRD into features and acceptance criteria.
2. **QA** writes a test case for every criterion.
3. **UI/UX** writes a design for every feature: a screen, with its layout, states, interactions and copy, or no screen, with why. You approve each one, or send it back with a reason (gate **G2**).
4. **Tech lead** breaks the criteria into tasks: what to build, for which criteria, and how big (S, M, L, XL). Gate **G3**, checked by code, needs a task for every criterion. The tech lead also reviews each task's code (gate **G5**).
5. **Full-stack** builds the tasks, one at a time, in crew's own git worktree and branch. Each commit's message starts with its task's id (`TASK-003: …`), and crew reads the commits to see what is built. The task's size picks the model: S and M run on Sonnet at high effort, L on Opus at high, XL on Opus at xhigh.

  What counts as built:
  - Only commits on crew's branch count, made after crew made the branch and on no other branch. A `TASK-001: …` in your own history is not crew's work.
  - crew remembers each commit it has seen, and the task it did, so a merge or a deleted branch does not undo it. A later task that takes the same id on a board made again is not counted built by the earlier task's commits.
  - A commit that an amend, a rebase or a reset takes off crew's branch no longer counts: the task is built by what the branch still holds. So after a squash merge, delete crew's branch rather than resetting it to your main branch: a reset takes crew's commits off it, and its tasks would be built again.
  - A task whose worktree still holds changes not committed is not counted built: the full-stack is asked to commit them, revert them, or add build output to `.gitignore`.
  - A commit makes a task under way. It is done once the tech lead approves its newest commit.

Then the code is checked twice:

- **Review.** Once a task is committed, the tech lead reviews it with the diff crew attaches, and sends its verdict with `review_submit`: approve, or the changes to make. crew pins the verdict to the commit the tech lead read, and keeps it on this machine. A newer commit makes the review out of date, and the task is reviewed again. Changes go back to the full-stack, and its next commit is reviewed; after three rounds of changes, you decide.
- **Test runs.** Once every task is approved, crew runs your test command (set in the pane's 設定 tab) in its worktree. Each test case passes or fails by the lines of the output that name it, such as `✓ TC-003 …`, `test_TC_003 … ok` or `--- FAIL: TestTC003`, so tests carry the id of the test case they check (gate **G6**). A result is pinned to the commit it ran on, and the output is kept as evidence in `.crew/runs/`. crew runs the tests only on a clean worktree at the newest commit, so a result is that commit's: keep build and test output (`__pycache__/`, `coverage/`…) in `.gitignore`, or crew asks you first. A test the runner skips (TAP's `# SKIP`) has no result. Failures go to the full-stack on the task they serve; its fix is reviewed and the tests run again. After three runs, or when the command cannot run, you decide.

The team also handles:

- **Gaps:** test gaps go back to the PM, who drops each one with a reason or asks QA to test it. Criteria without a task go back to the tech lead, and then to you.
- **Questions between roles:** the tech lead and the designer ask the PM through a thread when they need a trade-off, and get the answer back.
- **Questions:** product questions come to you.
- **Memory:** the team keeps it in the repo, so a role can start from a clean context without forgetting.

The plan, with what each phase checked, is in [`docs/plans/crew-plan.zh-TW.html`](../../docs/plans/crew-plan.zh-TW.html).

## Run it from its pane

When Claude Code starts, crew's pane opens on the right (in a terminal 144 columns wide or more; 110 once you have opened it). Everything crew does on your word is a button, a picker or a field there; no command is needed.

- **Start.** Pick a PRD from the repo (files with PRD, spec or 需求 in their path come first) or type its path, then 開始. 這次不用 closes the pane for this session.
- **After a restart.** A PRD crew left unfinished is held: the pane says where it stopped and asks 接續 or 先不要. Nothing runs, and nothing is spent, until you go on: 接續, or your own answer to a question or 跑測試. While a flow is held, Claude cannot go on for you: it cannot resume it, relay an answer, run the tests or ask a role. A flow is held the same way after 先不要, and when the heartbeat woke it once and it stopped at the same place again.
- **待你決定.** Answer a role's question in the field under it. Read a design, approve it, or send it back with a reason. Approve the brain's proposals, or not.
- **Each role's row.** 問 opens a field to ask that role; 輪替 has it start from a fresh context the next time it is woken.
- **記憶.** Search the team's memory, and save a preference.
- **設定.** The PRD to follow; the test command and 跑測試; how the brain acts on usage (先問你 by default, or 自動); whether the pane opens when Claude Code starts; 接續 and 重設流程 (asked twice); 整理今天的記憶.

A press or a field in the pane is yours alone: no plugin or model can raise one, so it counts as typed by you. On a phone (Remote Control) the pane has buttons but no fields; type the commands below there.

**Or ask Claude.** Say something like 「請 crew 開始處理 docs/PRD.md」 or 「問 crew 的 PM 為什麼這樣拆」. Claude uses crew's `crew` tool. For work Claude started, crew tells Claude at once what needs it: a question for you, a design to approve, a usage reminder, a flow that stopped, the end of the work. Routine news (a step along the way, a PRD change the PM syncs on its own) goes to Claude in one message every 30 minutes. Each message starts a turn of the main conversation, so it uses tokens. Work started from the pane reports only in the pane, the line above the prompt and toasts.

## crew looks after its work

- **A heartbeat every 5 minutes**, in code, with no model call:
  - A running flow with nobody at work and nothing waiting for you: crew wakes the role its stage waits on, once. If it stops at the same place again, the pane asks whether to try again.
  - A finished flow takes on only what came after the finish: a newer commit goes to the tech lead's review, a test result out of date to a new run. Work an older board never had (designs, test runs, unbuilt tasks) waits for you.
  - A question you left for two hours is brought up once.
  - The pane's 常駐 line says when crew last looked, what it found and did, and where a restart went on from. The look when Claude Code starts only marks the time.
  - A role the heartbeat, the PRD check or a test run needs to start afresh starts at Claude Code's next action (a command, a prompt, a tool call, a role's turn end, any press in the pane), not from the timer itself: the engine runs an agent a timer starts as crew's own code and skips crew's hooks for it, so it could use none of crew's tools. In a quiet session it waits for your next action, and the 常駐 line says so. Waking a role whose agent is still there works from the timer.
- **Token reminders**, worked out in code, each condition at most once an hour: a role over 40% of the day; a role reading under 60% from the cache (both only on a day, and a role, over 50K tokens); a role past its context threshold; two senders going back and forth on one item more than six times; a role's single tool output over 10K tokens. Claude hears of each, and the Token tab lists them with the time.
- **What Claude may do about usage.** With the `crew` tool's `tune`, Claude can set a role's model, effort or rotation threshold for its work from now on, never below the floor you set for that role. By default it asks you first: its proposal waits under 待你決定. Switch to 自動 in 設定 to let it act on its own. Either way each action is kept as a decision, and the Token tab shows the role's numbers before and since. Nothing skips a gate, a test or a review to save tokens.

## Commands

For a phone, or if you prefer typing. Each does what its pane control does.

| Command | What it does |
| --- | --- |
| `/crew start <PRD file>` | The PM splits the PRD, QA writes test cases, the designer designs each feature for you to approve, the tech lead plans tasks, the full-stack builds them, the tech lead reviews them, and crew runs your tests. The PRD must be a file inside the repo. |
| `/crew design <SCR-nnn>` | Shows a design: its feature, whether it has a screen, where it stands, and what it says. |
| `/crew approve <SCR-nnn> […]` | Approves designs. Only you can: Claude cannot approve for you, and an answer to the question is not an approval. |
| `/crew reject <SCR-nnn> <reason>` | Sends a design back; the designer gets your reason. |
| `/crew approve <Q-nn>`, `/crew reject <Q-nn>` | Approves Claude's proposal on usage, or not. |
| `/crew test-command <command>` | Sets the test command crew runs, such as `npm test` or `python3 -m pytest -v`. Only you can set it. With no command it shows the one set; `off` clears it. |
| `/crew test` | Runs the tests now. Claude can ask for a run too, but never set the command. |
| `/crew answer <Q-nn> <answer>` | Answers a question a role asked you. The answer is saved as a decision. |
| `/crew ask <pm\|qa\|uiux\|techlead\|fullstack> <question>` | Asks a role directly. Its reply lands in thread `ASK-nn`, and a toast tells you when it is there. |
| `/crew thread <id>` | Prints a thread, for example `ASK-01` or `AC-003`. |
| `/crew remember <text>` | Saves one of your preferences (`PREF`). Every role gets your preferences with its work. |
| `/crew recall <words or ids>` | Searches the team's memory. |
| `/crew rotate <pm\|qa\|uiux\|techlead\|fullstack>` | The next time that role is woken, it starts from a fresh context. It gets the board's state, the related memories and its last report. |
| `/crew resume` | Starts the roles of an unfinished PRD again: after a restart, or after a role's run failed. |
| `/crew consolidate [YYYY-MM-DD]` | Haiku reads a day's log and saves facts and lessons nobody saved. This also runs by itself once a day for the previous day. |
| `/crew status` | One-line summary. |
| `/crew reset` | Forgets this session's flow and roles. The board, threads and memory are kept. |
| `/crew demo [normal\|empty\|attention\|restart] [overview\|progress\|board\|threads\|memory\|tokens\|settings]` | The design preview with sample data, opened on a situation and tab if you name them. Close it with the pane's 關閉設計稿, or `/crew demo off`. |

**After upgrading from 0.1.0.** A board crew finished then has no tasks, so its progress counts the plan as not done. Start the PRD again once, from the pane: crew checks the board without a new split, and the tech lead plans the tasks.

**After upgrading from 0.2.0.** A board crew finished then has tasks with no code. crew does not start building them on a turn of its own. The full-stack starts on them the next time the flow runs to its end: after you start the PRD again, or after a question that has one role pass work to another.

**After upgrading from 0.3.0.** A board crew finished then has code that was never reviewed, no designs and no test runs. The next time the flow runs to its end, after you start the PRD again, the designer designs each feature for you to approve, the tech lead reviews each task, and crew runs your tests. Set your test command first, in the pane's 設定 tab.

**After upgrading from 0.4.** When Claude Code starts on a PRD crew left unfinished, it no longer starts the roles again by itself: the pane asks you first.

**After upgrading from 0.5.1.** crew keeps its board in `.crew/prd-tracker.json`. A repo where an earlier crew already made its board at the root keeps it there, as long as there is no `.crew/prd-tracker.json` yet: crew tells its board from the repo's own `prd-tracker.json` by `crew_prd`, which starting a PRD writes. A root board crew made without a PRD ever started on it has none, and is left as the repo's. The pane's 設定 tab says which file holds the board. To move a root board into `.crew/`, `git mv prd-tracker.json .crew/prd-tracker.json`: crew follows it the next time Claude Code starts, and until then says so and writes neither file.

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
- **A board synced to another PRD is called out too.** A teammate's board, or another branch's, may be synced to another PRD. crew then says so and holds nothing to it until you choose, in the pane's 設定 tab: the board's PRD to follow it, or yours to move the board over.
- **Starting a PRD the board already mostly answers checks it, without a new split.** The board is held to the PRD as it stands: the PM fills what is missing, and QA tests what has no test case. A PRD the board answers less than half of is split, and the PM is told which requirements already have features.
- **A PRD change while QA is writing tests keeps that QA.** The PM syncs; when QA's run ends, QA is asked for the new criteria only.
- **The pane says how current it is.** It shows how the board stands against the PRD, when the PRD last changed, and when crew last looked.
- **Progress is counted per requirement.** The Progress tab lists each PRD requirement with how far each stage of its development is, all from the board, git and crew's own records:
  - spec: every feature that answers the requirement has criteria;
  - design: those features have a design you approved;
  - test cases: those criteria have test cases, counted done only once the spec is;
  - tasks: those criteria have the tech lead's tasks, counted done only once the spec is;
  - code: those tasks have a commit on crew's branch; done once the tech lead approved each task's newest commit;
  - review: those tasks approved at their newest commit; `⟳` when an approval is out of date;
  - test results: those criteria's test cases passed in crew's latest run, on the newest commit; `⟳` once a commit came after the run.

  A requirement moved out of scope shows the reason instead. The overall row above the table uses the same seven stages, in the same order. Overall progress counts a design as done once approved, code once reviewed, and a test case once passed, so it reaches 100% only when all of that is true; every percentage is rounded down. A task the tech lead planned shows in the recent work as `排定：<title>`: the plan is what was finished, not the task.
- **One board, several PRDs.** Starting another PRD keeps the earlier one's requirement numbers on the board, so its features stay its own and do not hold up the new PRD's split. A board from before crew numbered requirements is not reported as a PRD change: the PM is asked to link its features to the requirements.

## Where things live

| Path | In git | What |
| --- | --- | --- |
| `.crew/prd-tracker.json` | yes | The board: features, acceptance criteria, test cases, decisions, and (`crew_prd`) the PRD requirements crew holds the board to, with secrets masked, plus the earlier PRDs' requirement numbers. In a repo where crew made its board at the root before 0.5.2, it stays at `prd-tracker.json`. |
| `.crew/threads/*.jsonl` | yes | Messages between roles, and between you and a role. Every message is appended; the pane shows the latest 50 per item. |
| `.crew/memory/memories.jsonl` | yes | Long-term memory: decisions (`DEC`), facts (`MEM`), lessons (`LES`), your preferences (`PREF`). |
| `.crew/memory/consolidated.json` | yes | The days the log has been tidied. |
| `.crew/log/*.jsonl` | no | The day's log, used for consolidation. |
| `.crew/usage/*.json` | no | Token use per day. |
| `.crew/runs/*.log` | no | Each test run's evidence: the command, the folder, the commit, the exit code and everything it printed, with secrets masked. |
| `.crew/work/<name>/` | no | The full-stack's git worktree for a PRD, on branch `crew/<name>`, named after the PRD file. It is a second copy of your code: add `.crew/` to the ignore lists of your test runner, linter and type-checker (Vitest, Jest, ESLint and a `tsconfig.json` that includes `**/*` all pick it up otherwise). The other roles' searches in your checkout see it too. |

Where the board is kept, the flow, the open questions, who started the work, your test command, and, for each PRD, crew's branch, the commits it has seen, the tech lead's reviews, crew's latest test run and your decisions on designs are not in the repo. crew keeps them in its own store on this machine, keyed by the repo's path. A repo you clone therefore cannot start work by itself, and the marks a board carries (commits, reviews, test results, approved designs) count for nothing until crew has recorded them itself. On another machine, crew starts without that record: the board shows no code built there until crew sees the commits on its own branch. Where crew keeps the board is kept too, so it never moves under the work on another branch: `.crew/` once crew wrote its board there, the root once crew took a board up there, until that board is moved into `.crew/`.

crew adds `usage/`, `log/`, `work/` and `runs/` to `.crew/.gitignore` and leaves your own rules there alone.

## Safety

- **Secrets are masked.** Anything that looks like a key, token, password, private key, JWT, connection-string password or bearer token is masked before it is written anywhere crew writes. Words in a rule, like 「密碼：至少 8 個字元」, are left alone. Masking works by pattern, so a secret in an unusual shape can still get through: keep secrets out of PRDs and answers.
- **crew never writes over what it cannot read, nor outside the repo.** A board it cannot parse (a merge conflict, a typo) is left as it is until you fix it. So is a board with a part crew cannot read, such as a feature whose `test_cases` is not a list: the pane says which part, the line above the prompt and `/crew status` show 「⚠ 看板讀不到」, and the work stops there. A feature with no criteria or test case list yet is read as having none, and crew adds the empty list when it next writes the board. A `prd-tracker.json` at the repo's root is the repo's own, read by its own tools, unless crew made it there before 0.5.2: crew reads it only to tell whose it is, never writes it, and keeps its board in `.crew/`. A file in the board's place that is not crew's board, one with no `prd_items` list, is neither read nor written either, and crew cannot start until it is fixed or moved. A file of crew's that is itself a link, or whose path leads out of the repo, is neither read nor written. That includes a file that links to another file inside the repo. A directory link on the way is followed only when it lands inside the repo. Either way crew tells you why.
- **Write tools take only crew's own callers.** Only crew's roles and the main conversation can write to the board, threads, questions or memory. Other agents and the roles a reset retired cannot.
- **Each role has its own permissions on the board.** The PM edits features and criteria; QA writes test cases; the designer writes designs; the tech lead plans tasks and sends reviews. The full-stack cannot write the board at all.
- **Some decisions are yours alone.** Approving or sending back a design, setting the test command, and approving Claude's proposals on usage take your own press or field in the pane, a `/crew` command you type at the prompt yourself, or one you send from your Remote Control client. Claude's `crew` tool cannot do them, and neither can another plugin, another Claude session, a channel relay, a schedule, an answer to a question, or anything written on the board.
- **Claude's actions on usage keep to your floors.** A model or effort below the floor you set for a role is refused, whether Claude asks you first or acts on its own; and nothing skips a gate, a test or a review to save tokens.
- **Your test command runs without asking each time.** crew runs it in its worktree on crew's branch, by its words, with no shell (no pipes or `&&`), for at most ten minutes, with your environment and `CI=true` (so a runner does not wait in watch mode). It runs code the full-stack wrote, outside your Claude Code permission prompts, with whatever keys your environment holds, so set it only for a repo whose code you are willing to run. A command a repo or a board carries is never run: crew keeps yours on this machine. A run that breaks down on the way (a full disk, a reload) says so instead of leaving the flow waiting, and opening Claude Code on a flow that stopped while testing runs the command again once you press 接續.
- **Test output stays out of git.** The evidence in `.crew/runs/` is masked and ignored by git. The end of a failing run's output goes to the full-stack alone, never into the repo's threads, since it may hold values masking does not recognize.
- **The full-stack works in crew's worktree, not your checkout.**
  - It starts in `.crew/work/<name>`, a git worktree on branch `crew/<name>` that crew makes from your checkout's commit. It is told to leave your checkout and branches alone and not to push: merging is yours.
  - That is an instruction, not a fence. The full-stack edits files and runs commands under your Claude Code permission mode, like any agent, and crew says so once when the build starts.
  - After each of its runs, crew checks your checkout: new changes, another branch or another commit, and your other branches. It also notices a change to its own files (the board and the memory) that crew itself did not make; one made a link, moved out of the repo or unreadable counts as changed and is not read. If anything moved, crew says what, since it cannot tell whether you or the full-stack did it.
  - A commit on crew's branch that changes the board or `.crew/` is pointed out to the tech lead, who is told to have it undone, and to you.
  - A `crew/<name>` branch crew did not make is not used: crew makes one with a new name beside it. Nor is one that holds neither the commit crew last saw on it nor, in its own reflog, a move from it, such as a branch deleted and then checked out again from a remote: crew reads none of its commits and says so. An amend, a rebase or a reset of crew's branch keeps it crew's.
  - crew itself runs only `git rev-parse`, `git symbolic-ref`, `git status`, `git worktree add`, `git log` (with `-g` for the branch's reflog), `git merge-base`, `git for-each-ref` and `git show` (the diff for a review), with the repo's hooks and file monitor off, and your test command. A folder that is not a git repo, or one with no commit yet, stops the full-stack, and crew says why.
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
  - you press 輪替 on its row in the pane

  This happens only when the role is idle: a role at work gets new messages in its inbox instead. The fresh agent gets the working set, the related memories, its recent thread lines and its last report.
- **Failed runs.** A run that ends in an error, an interrupt or a refusal does not move the flow on. crew's heartbeat wakes the role once within five minutes; press 接續 in the pane to go on sooner.
- **Compaction backstop.** If the engine compacts a role during one long run, the summary is told to keep ids, decisions and what is left of the task.

## Develop

```sh
claude plugin validate mods/crew
claude plugin test mods/crew
tsc -p mods/crew   # once Claude Code has loaded the mod and laid its types
```

`spikes/crew/` holds the phase 0 spike that checked the agent APIs crew depends on. It is not listed in the marketplace and is not meant to be installed.
