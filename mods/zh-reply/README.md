# zh-reply

Makes Claude reply in Chinese, Traditional (Taiwan usage) by default, and holds its subagents and teammates to the same rule. When a reply still comes back in another language, it asks Claude to say it again in Chinese.

```
/plugin install zh-reply --marketplace PeterTing/claude-mod
```

## What it does

| Where | How |
| --- | --- |
| The main conversation and in-process teammates | Adds one rule to the end of the system prompt: reply in Chinese; keep code, commands, paths, identifiers and quoted text as they are; put a passage meant to stay in another language (a commit message, an English doc draft) in a code block; and write files, comments, commit messages and docs in the language the project already uses. |
| Agents Claude spawns | Adds one line to the end of each agent's task asking for Chinese, with the same carve-out for files, comments, commit messages and docs. Agents that another plugin spawns, workflow agents and resumed agents are left alone. |
| Messages Claude sends (SendMessage) | A message to another agent or session, from the main conversation or from an agent, that is not in Chinese is sent back once with a note to rewrite it. The same sender sending the same text to the same recipient again goes through. Messages other plugins send are left alone. |
| A reply that is not in Chinese | When the main conversation's reply is mostly English, Japanese or Korean, or written in the other Chinese script, it asks Claude to say it again in Chinese. It asks at most once for each prompt you send, so it cannot loop. |

### What counts as Chinese

Only prose counts. Code blocks, inline code, quoted lines (`>`), links, URLs, HTML tags and paths are left out. English counts by its function words (the, and, is, to, of…), and paths, flags, file names, identifiers and numbers are not counted as words. So file lists, commands and English status words inside a Chinese reply don't make it English, and neither do English test names or error messages as long as the reply has Chinese sentences of its own around them. A reply with no Chinese passes when it has fewer than six plain English words, or fewer than eight with no function word among them.

### When you ask for another language

A prompt that asks to be answered in another language or in the other Chinese script ("請用英文…", "英文就好", "給我英文版", "請用簡體中文回答", "reply in English", "Please use English"), or asks for a translation into one ("翻譯成簡體中文", "translate this into Japanese"), is left to that language: its turn is not checked, so a reply in what you asked for is never rewritten. Asking for the configured script ("請用繁體中文回答") or for plain Chinese ("explain this in Chinese", "翻譯成中文") keeps the check on, since that is exactly when a reply drifting into the other script matters. A prompt that only mentions a language ("這個字的簡體寫法是什麼？", "英文寫的 log 看不懂") is not a request, and neither is "不要用英文", "別再用英文了" or "don't reply in English".

A request covers the turn your prompt starts. A prompt you type while Claude is still working keeps the running turn's request unless it makes one of its own. A turn you did not start, such as a finished background task or a teammate's message, is checked as usual.

## Command

| Command | What it does |
| --- | --- |
| `/zh-reply` | Shows whether it is on and how many replies and messages it caught this session |
| `/zh-reply off` | Turns it off for this session |
| `/zh-reply on` | Turns it back on |

## Options

Set them with `/plugin configure zh-reply@claude-mod` in Claude Code, or `claude plugin configure zh-reply@claude-mod` from a shell.

| Option | Values | Default |
| --- | --- | --- |
| `variant` | `zh-TW` Traditional Chinese, `zh-CN` Simplified Chinese | `zh-TW` |
| `enforce` | `rewrite` asks Claude to say it again (one extra turn); `remind` shows a notice and reminds Claude with your next prompt | `rewrite` |
| `scope` | `all` the main conversation, agents and teammates; `main` the main conversation only | `all` |

## Costs and limits

- The rule adds roughly 140 tokens to the system prompt (about 600 characters). It sits after the cache boundary and does not change, so it is cached with the rest. `/zh-reply off` and `on` add or remove it, which makes the next request write the prompt cache again once.
- Each spawned agent's task gets roughly 90 more tokens (one 90-character line).
- A rewrite is one extra turn: Claude rereads the conversation, mostly from the prompt cache, and writes the reply again. There is at most one for each prompt you send. Use `enforce: remind` if you'd rather not spend that.
- English prose outside a quote block or code block can trigger a rewrite, for example a commit message drafted in the reply, English test names under a one-line Chinese heading, or eight or more bare words such as commands left outside a code block. The rule asks Claude to put such passages in a code block.
- Some prompts that only talk about an English version or English names ("把 README 英文版同步到最新", "use English variable names") are read as asking for English, so that one turn is not checked. The system-prompt rule still applies.
- An agent's final report is held to the rule only by the line in its task. It is not checked or rewritten afterwards.
- If one of its hooks fails, that step is skipped and Claude Code goes on as if the mod were not there.
- Where an organization manages Claude Code, it may run only the plugins it lists. There this mod does nothing at all, or everything except the system-prompt rule.

## Reach

L2 in this repository's [reach levels](../../docs/vetting.md#reach-levels): it adds text to the system prompt and to spawned agents' tasks, sends one prompt for a rewrite, and sends an agent's message back once. It reads no files, runs no programs, makes no network requests and reads no environment variables.

Its state lasts for the session only: the on/off switch, a count of what it caught, the id of the rewrite turn, whether it already asked for a rewrite since your last prompt, whether your last prompt asked for another language, whether a reminder is pending, and the text of up to 20 agent messages it sent back, kept so that an identical resend goes through.

## Develop

```sh
claude plugin validate mods/zh-reply
claude plugin test mods/zh-reply
claude --plugin-dir mods/zh-reply
```
