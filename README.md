# trstcode

A project-aware command vault with a real persistent terminal.

## Current product flow

1. Open a local project folder.
2. Find a saved command or type one in the guided runner.
3. Review its risk level and active directory.
4. Run it in the project’s persistent terminal.
5. Reuse it from history or save it to the vault.

## Included

- Persistent PTY terminal with interactive input and streaming ANSI output
- Long-running processes, SSH, REPL, and development-server support
- Project-specific and global saved commands
- Search, favorites, tags, descriptions, editing, and deletion
- Clickable per-project command history
- Shell, SQL, Elixir, Ruby, TypeScript, Python, and JSON detection
- Basic JSON and SQL formatting
- Risk warnings for destructive, privileged, deployment, and secret-like commands
- Local-first storage

GitHub authentication and repository sync are intentionally deferred until the
local workflow and storage model are production-ready.

## Development

```sh
npm install
npm run tauri dev
```

Frontend build:

```sh
npm run build
```

Native compile check:

```sh
cd src-tauri
cargo check
```
