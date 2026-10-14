# claude-mod

Hand-made and curated **mods for Claude Code**: live panes, bands above the prompt, status-line entries, toasts, slash commands, and hooks on tool calls or prompts that change how Claude Code looks and behaves.

[繁體中文](README.zh-TW.md)

This repository is a Claude Code plugin marketplace. Every mod in [`mods/`](mods/) can be installed with one line, and [`COLLECTION.md`](COLLECTION.md) keeps a curated list of good mods published by other people.

## Install a mod

At the prompt of a Claude Code terminal session:

```
/plugin install <mod> --marketplace PeterTing/claude-mod
```

Answer `y` to add the marketplace, then pick a scope (user scope is the default).

From a shell:

```
claude plugin install <mod> --marketplace PeterTing/claude-mod
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box → **Plugins** → **Add marketplace** with `PeterTing/claude-mod` → **Add plugin**.

## Mods

| Mod | What it does | Kind |
| --- | --- | --- |
| _none yet_ | | |

## Community mods

Mods by other authors are listed in [`COLLECTION.md`](COLLECTION.md) with a link to the original repository, its license, and how to install it from the source. Code from other authors is only copied into `mods/` when its license allows that, and the copy keeps the original license and credit.

## Repository layout

```
.claude-plugin/marketplace.json   # marketplace manifest: lists every mod in mods/
mods/<mod-name>/
  .claude-plugin/plugin.json      # name, version, description
  hooks/hooks.json                # { "modules": ["./register.tsx"] }
  hooks/register.tsx              # the hooks module
  hooks/*.test.ts                 # behaviour tests
  README.md                       # what it does, screenshots, options
COLLECTION.md                     # curated list of mods from the community
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

Issues and pull requests are welcome, whether it's a new mod, a fix, or a community mod you'd like added to the collection. For a collection entry, include the source URL, the license, and one line on what the mod does.

## License

[MIT](LICENSE). Community mods listed in `COLLECTION.md` keep their own licenses.
