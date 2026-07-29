# trstcode distribution

## Recommended repository model

Use two repositories:

1. **Private `trstcode` source repository** — application code, private roadmap and release workflow.
2. **Public `trstcode-community` repository** — issue tracker, discussions, public documentation and download links.

GitHub does not provide public issue-only access to a private source repository. A separate public community repository lets anyone report bugs and propose ideas without exposing the source.

For public installer downloads while the source remains private, publish release binaries to a public distribution/community repository or to your website storage. Releases attached to a private repository require repository access.

## Building locally

```bash
npm ci
npm run desktop:build
```

The current operating system can build its own native packages:

- macOS: `.app` and `.dmg`
- Windows: `.msi` and NSIS `.exe`
- Linux: AppImage and distribution packages

Cross-platform artifacts should be produced by the GitHub Actions release matrix because native installers should be built on their matching operating systems.

## Publishing a preview

1. Update the version in `src-tauri/tauri.conf.json`.
2. Commit and push the release.
3. Create and push a tag such as `v0.1.0`.
4. The release workflow builds macOS Intel/Apple Silicon, Windows and Linux.
5. Review the draft release and its artifacts before publishing it.

Preview artifacts are currently unsigned. Public production distribution should add:

- Apple Developer ID signing and notarization for macOS.
- A trusted code-signing certificate for Windows.
- Optional signing/checksums for Linux.

## Counting downloads

GitHub exposes `download_count` for every release asset through its Releases API:

```bash
npm run release:stats -- OWNER/REPOSITORY
```

Set `GITHUB_TOKEN` when the release repository is private.

This counts completed GitHub release-asset downloads. For website behavior such as visits, operating-system button clicks and conversion rate, add a privacy-friendly web analytics tool and track a `download_clicked` event before redirecting to the GitHub asset.

## Contributions without fully open sourcing

- Keep source private and invite selected contributors as collaborators.
- Accept public bug reports and ideas in the community repository.
- Label suitable issues as contribution candidates.
- Give sponsors early builds, roadmap access or access to a sponsor-only private repository.
- Publish a clear contribution policy before accepting code.
