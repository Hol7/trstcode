# trstcode project handbook

This is the operational reference for developing, testing, contributing to,
building and releasing trstcode. Run commands from the repository root unless a
section says otherwise.

## 1. Product and repository model

trstcode is a Tauri desktop application with a React and TypeScript interface
and a Rust native layer. It stores commands, code, scripts and notes locally and
can open a persistent terminal inside folder-backed workspaces.

The current `package.json` marks the source package as private. This prevents an
accidental npm publication; it does not decide whether the GitHub repository is
public or private.

A practical private-source structure is:

- Private source repository: application code, branches, pull requests and
  release automation.
- Public community repository: public issues, discussions, roadmap and download
  links.
- GitHub Releases or website storage: downloadable installers.

A single repository is also valid if the source will be public. Do not create a
second repository unless its access model solves a real need.

## 2. Required software

Install:

- Git
- Node.js LTS and npm
- Rust stable with Cargo
- The operating-system prerequisites from the Tauri documentation

Check the toolchain:

```bash
git --version
node --version
npm --version
rustc --version
cargo --version
```

Install project dependencies:

```bash
npm ci
```

Use `npm install` when intentionally adding or updating dependencies. Commit
both `package.json` and `package-lock.json` after a dependency change.

## 3. Creating the GitHub repository

Create the local Git repository only if the project is not already tracked:

```bash
git init
git branch -M main
git add .
git commit -m "Initial trstcode application"
```

With the GitHub CLI installed and authenticated, create a private source
repository and push the current project:

```bash
gh auth login
gh repo create trstcode --private --source=. --remote=origin --push
```

To connect an existing empty GitHub repository instead:

```bash
git remote add origin git@github.com:OWNER/trstcode.git
git push -u origin main
```

Check the connection:

```bash
git remote -v
git branch --show-current
```

Repository settings should protect `main`, require pull-request review for
contributors and prevent force pushes. Enable Actions so the release workflow
can create draft releases and upload assets.

## 4. Running the application locally

Run the complete desktop application with Tauri:

```bash
npm run tauri dev
```

Run only the web interface:

```bash
npm run dev
```

The web-only mode is useful for layout work, but native features such as the
folder picker and PTY terminal require the Tauri application.

Build and preview only the web interface:

```bash
npm run build
npm run preview
```

## 5. Quality checks

Before every pull request:

```bash
npm ci
npm run build
cd src-tauri
cargo check
```

Return to the repository root after the Rust check:

```bash
cd ..
```

For interface work, manually verify:

- Dark and light themes.
- French and English.
- Folder-backed and folder-free workspaces.
- Command creation and terminal execution.
- Code creation and CodeMirror editing.
- Notes and quick notes.
- Copy feedback and deletion confirmation.
- Wide, medium and narrow windows.
- Long workspace lists and many open project tabs.

Never test destructive commands against an important project or database.

## 6. Git workflow

Update the main branch before starting:

```bash
git switch main
git pull --ff-only
```

Create a focused branch:

```bash
git switch -c feature/short-description
```

Useful branch prefixes:

- `feature/` for product work
- `fix/` for bug fixes
- `docs/` for documentation
- `release/` for release preparation

Review changes:

```bash
git status
git diff
```

Commit:

```bash
git add .
git commit -m "Describe the change clearly"
git push -u origin feature/short-description
```

Open a pull request, complete the template, attach screenshots for visual
changes and wait for checks and review before merging.

## 7. Contribution process

Public contributors can:

- Report reproducible bugs.
- Suggest workflows and UX improvements.
- Improve documentation and translations.
- Test preview installers.

If the source remains private, a maintainer must explicitly invite a code
contributor. Access to a private repository must not be promised automatically.

Code contributors should:

1. Start from an approved issue.
2. Keep one concern per branch and pull request.
3. Avoid unrelated formatting or dependency changes.
4. Add reproduction and verification instructions.
5. Run the checks from section 4.
6. Explain user-facing behavior and attach screenshots when relevant.

See `CONTRIBUTING.md`, `SECURITY.md` and the files under
`.github/ISSUE_TEMPLATE/`.

## 8. Versioning

trstcode uses versions such as `0.1.0`:

- Patch: bug fix, for example `0.1.1`.
- Minor: backward-compatible functionality, for example `0.2.0`.
- Major: incompatible product or data change, for example `1.0.0`.

Before a release, update the same version in:

- `package.json`
- `package-lock.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`, when it contains the application package version

The Git tag must match that version with a `v` prefix: version `0.2.0` uses tag
`v0.2.0`.

## 9. Building desktop packages locally

Build installers for the operating system currently running:

```bash
npm ci
npm run desktop:build
```

Output is written under:

```text
src-tauri/target/release/bundle/
```

Typical output:

- macOS: `.app` and `.dmg`
- Windows: `.msi` and NSIS `.exe`
- Linux: AppImage and distribution-specific packages

Build only the macOS application bundle:

```bash
npm run desktop:build -- --bundles app
```

Native desktop installers should be produced on their matching operating
systems. Use the GitHub Actions matrix for repeatable macOS, Windows and Linux
builds.

## 10. Application icons

The current master icon is:

```text
src-tauri/app-icon-master-v3.png
```

Regenerate all Tauri icon formats after replacing the master:

```bash
npm run tauri icon src-tauri/app-icon-master-v3.png
```

Generated assets are stored in `src-tauri/icons/`. Commit the master and the
generated icon files together.

## 11. Preparing a release

Start from a clean, current main branch:

```bash
git switch main
git pull --ff-only
git status
```

Update the version files, then run:

```bash
npm ci
npm run build
cd src-tauri
cargo check
cd ..
```

Optionally build and test the native application locally:

```bash
npm run desktop:build
```

Commit release preparation:

```bash
git add .
git commit -m "Prepare trstcode v0.2.0"
git push origin main
```

## 12. Creating and pushing a release tag

Create an annotated tag:

```bash
git tag -a v0.2.0 -m "trstcode v0.2.0"
```

Verify it:

```bash
git show v0.2.0
```

Push only that tag:

```bash
git push origin v0.2.0
```

The `.github/workflows/release.yml` workflow runs for tags matching `v*`. It
builds:

- macOS Apple Silicon
- macOS Intel
- Windows x64
- Linux x64

The workflow creates a draft prerelease. It does not publish the release
immediately.

If a tag has not been pushed, it can be replaced locally:

```bash
git tag -d v0.2.0
git tag -a v0.2.0 -m "trstcode v0.2.0"
```

Do not rewrite a published release tag. Fix the problem and publish a new patch
version instead.

## 13. Running the release workflow manually

In GitHub:

1. Open **Actions**.
2. Select **Build desktop release**.
3. Choose **Run workflow**.
4. Select the intended branch.

The workflow also runs automatically when a `v*` tag is pushed. A manual run is
useful for diagnosing the matrix, but the versioned tag is the canonical
release trigger.

## 14. Reviewing and publishing a GitHub Release

After the matrix completes:

1. Open the repository’s **Releases** page.
2. Open the generated draft.
3. Verify that macOS, Windows and Linux artifacts exist.
4. Download and test every available platform build.
5. Add concise release notes: highlights, fixes, known limitations and upgrade
   notes.
6. Verify version numbers and filenames.
7. Publish as a prerelease during preview development.
8. Publish as a normal release only when it is production-ready.

Never publish a release when one matrix build failed or the available artifacts
cannot be explained.

## 15. Signing and production distribution

Unsigned preview builds are suitable for internal testing but operating systems
may display warnings.

Production distribution should add:

- Apple Developer ID signing and notarization for macOS.
- A trusted code-signing certificate for Windows.
- Checksums and optional package signing for Linux.

Store certificates, passwords and API credentials as GitHub Actions secrets.
Never commit signing files, private keys, tokens or `.env` files.

## 16. Checksums

Generate a SHA-256 checksum on macOS or Linux:

```bash
shasum -a 256 path/to/artifact
```

On Windows PowerShell:

```powershell
Get-FileHash path\to\artifact -Algorithm SHA256
```

Publish checksums beside release assets so users can verify downloads.

## 17. Download statistics

Show GitHub release-asset download totals:

```bash
npm run release:stats -- OWNER/REPOSITORY
```

For a private repository:

```bash
GITHUB_TOKEN=your_token npm run release:stats -- OWNER/REPOSITORY
```

Do not commit or paste the token into documentation, screenshots or issues.

GitHub release counts measure asset downloads. Website visits, download-button
clicks and conversions require separate website analytics.

## 18. Rollback and release corrections

If a draft is wrong, leave it unpublished, correct the source and rerun with a
new version if necessary.

If a published application has a serious problem:

1. Mark the release as a prerelease or clearly document the problem.
2. Stop promoting its download link.
3. Fix and verify the issue.
4. Increment the patch version.
5. Publish a new tag and release.

Do not silently replace artifacts attached to an already published version.

## 19. Common commands

```bash
# Install exactly what the lockfile defines
npm ci

# Run the desktop application in development
npm run tauri dev

# Run only the web interface
npm run dev

# Validate and build the frontend
npm run build

# Compile-check the Rust application
cd src-tauri && cargo check

# Build native installers for the current operating system
npm run desktop:build

# Regenerate app icons
npm run tauri icon src-tauri/app-icon-master-v3.png

# Show GitHub release download totals
npm run release:stats -- OWNER/REPOSITORY

# Create and publish a version tag
git tag -a v0.2.0 -m "trstcode v0.2.0"
git push origin v0.2.0
```

## 20. Release checklist

- [ ] Version updated consistently.
- [ ] Dependencies installed with `npm ci`.
- [ ] Frontend build passes.
- [ ] Rust check passes.
- [ ] Dark/light and French/English checked.
- [ ] Commands and terminal checked in a folder-backed workspace.
- [ ] Code, notes and quick notes checked.
- [ ] Responsive layouts checked.
- [ ] Local native build tested when possible.
- [ ] Release commit pushed.
- [ ] Annotated `v*` tag pushed.
- [ ] Every GitHub Actions matrix job passed.
- [ ] Every platform artifact reviewed.
- [ ] Checksums available.
- [ ] Signing status clearly stated.
- [ ] Release notes completed.
- [ ] Draft reviewed before publication.
