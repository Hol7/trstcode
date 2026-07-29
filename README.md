# trstcode

A local developer workspace for commands, code, scripts, notes, and real terminal sessions.

## Current product flow

1. Create an empty workspace or open a local project folder.
2. Save commands, long code/scripts, or plain notes.
3. Navigate between open workspaces using project tabs.
4. Read code with Shiki syntax highlighting and edit it in an IDE-style CodeMirror editor.
5. In folder-backed projects, review and run commands in a persistent terminal.

## Included

- Persistent PTY terminal with interactive input and streaming ANSI output
- Long-running processes, SSH, REPL, and development-server support
- Folder-backed projects and folder-free organizational workspaces
- Navigable tabs for multiple open projects
- Commands, long code/scripts, and notes as separate entry types
- Shiki syntax highlighting with explicit language selection
- CodeMirror editor with line numbers, folding, indentation, undo/redo and language-aware editing
- Direct editing for code and quick notes
- French and English interface with persistent light and dark themes
- Project-specific and global entries
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

Native installer for the current operating system:

```sh
npm run desktop:build
```

Native compile check:

```sh
cd src-tauri
cargo check
```

See [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md) for cross-platform releases,
download statistics and the recommended private-source/public-community GitHub
structure. See [CONTRIBUTING.md](CONTRIBUTING.md) before proposing changes.
