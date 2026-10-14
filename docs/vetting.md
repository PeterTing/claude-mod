# How community mods are vetted

Claude Code mods are **not sandboxed**. A mod runs inside Claude Code with your user's permissions: it can read and write any file you can, start programs, make network requests, see and rewrite every prompt and tool call, and approve a tool call before the permission prompt appears ([Anthropic: Manage mods for your organization](https://code.claude.com/docs/en/plugins/mods/admin)). Installing a mod means trusting its code, so every community mod in this marketplace is reviewed before it is listed.

## What a listing guarantees

- **Pinned to the reviewed commit.** Each community entry in [`.claude-plugin/marketplace.json`](../.claude-plugin/marketplace.json) uses a `github` or `git-subdir` source with a full 40-character `sha`. Installing from this marketplace gives you exactly the code that was reviewed, not whatever the author pushed later.
- **The verdict and reach are recorded** in [`COLLECTION.md`](../COLLECTION.md), together with the commit and review date.

Policy for updates: a pin moves to a newer upstream commit only after the diff since the pinned commit has been reviewed the same way.

Installing the same mod from its author's own marketplace gets the author's latest version, which this review does not cover.

## Review steps

Each mod is reviewed at one commit, statically: no code from the mod is executed or loaded into a Claude Code session. After the review, each listed mod is installed from this marketplace into an isolated Claude Code config directory, and the installed files are compared byte for byte with the reviewed commit.

1. **Inventory.** Shallow-clone the repository into an isolated directory and record the HEAD commit. List every file the plugin ships: manifest, `hooks/hooks.json` (the hooks module and any classic command hooks), `.mcp.json`, scripts, skills, agents, commands, `package.json` scripts and binaries.
2. **Engine's own analysis.** Run `claude plugin validate <plugin dir>`, Anthropic's static analyzer, which reads the source without running it and prints the events the mod hooks (`hooks:`), every `$` API method it calls (`calls:`) and the environment variables it reads or writes.
3. **Read all the code.** Every runtime file of the plugin, including local imports, is read in full and checked against the inventory. A vendored or minified library is instead rebuilt from its published release, plus any patches in the author's build script, and compared with the shipped bundle. The code is checked for:
   - `$.process.run` / `$.process.spawn`: which programs, with which arguments, and whether any argument comes from untrusted input (file names, tool input, prompts, network data).
   - `$.http.fetch`, and programs that reach the network: which hosts, and what data is sent.
   - `$.fs.read` / `$.fs.write`: which paths, and whether anything outside the stated feature is touched (shell rc files, `~/.ssh`, `~/.claude`, credentials).
   - `$.env.get` / `$.settings.read` / `$.env.set`: which variables and settings, and whether secrets are read.
   - Gating hooks: whether `tool.check` ever approves a call, whether `tool.call` rewrites input or answers with its own result, whether `prompt.submit` changes your text, and exactly what `prompt.compose` / `prompt.context` add to the system prompt.
   - `$.prompt.submit`, `$.model.*`: what is sent on your behalf and what it costs in tokens.
   - Red flags: obfuscation, encoded blobs, `eval` or dynamic code, download-and-run, hidden telemetry, persistence beyond the feature.
4. **Hygiene.** License, repository and author age, last commit, and whether the code does what the README says.

## Verdicts

| Verdict | Meaning |
| --- | --- |
| **Recommend** | No material risk found. Its reach matches its feature. |
| **Caution** | Acceptable, with caveats you should know before installing: for example, it spends tokens, adds standing text to the system prompt or to every prompt, rewrites your prompts, commands or tool output, holds your messages, or sends prompts for you. |
| **Reject** | Not listed: exfiltration, permission bypass, obfuscation, access the feature doesn't need, or code that couldn't be verified. |

A static review lowers risk but can't prove a mod is safe. Read the caveats, and remove a mod you no longer use.

## Reach levels

`COLLECTION.md` labels what each mod can touch, following the levels used by the [awesome-claude-code-mods](https://github.com/karanb192/awesome-claude-code-mods) scan:

| Level | The mod can |
| --- | --- |
| L0 | Draw and remember its own state only |
| L1 | Also read session data (usage, transcript, agents), files, settings or environment variables |
| L2 | Also write files, run programs or drive Claude (submit prompts, call models) |
| L3 | Also reach the network |
