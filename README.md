# trstcode

Your local command vault and project-aware runner.

## First version

- Save shell commands and small code snippets
- Detect common languages automatically
- Search and favorite saved entries
- Select a local project folder
- Run commands inside the selected folder
- Reuse commands from run history
- Persist the vault and history locally

GitHub authentication and repository sync are intentionally planned for a later phase.

## Development

Install the Tauri prerequisites, including Rust, then:

```sh
npm install
npm run tauri dev
```

Build the frontend only:

```sh
npm run build
```
