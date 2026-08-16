# Project Instructions

## Packaging

- macOS builds must not be code signed or notarized.
- Keep `build.mac.identity` set to `null` and keep `CSC_IDENTITY_AUTO_DISCOVERY=false` in the packaging flow.
- Do not add a signing identity, provisioning profile, notarization credentials, or certificate-related CI secrets unless the project owner explicitly requests signed distribution.

## Release Workflow

- GitHub is the source collaboration and CI release channel. Do not manually upload local installers to GitHub; `.github/workflows/release.yml` builds the Windows x64, macOS Intel, and macOS Apple Silicon packages.
- GitCode is the domestic source mirror and local installer distribution channel. The upstream dependency mirror is `https://gitcode.com/gh_mirrors/de/deepseek-harness.git`, and the desktop source/release repository is `diamondfsd/deepseek-harness-desktop`.
- Before a release, commit and push the source changes to GitHub, then run `pnpm run sync:gitcode` to fast-forward the same branch and tags to GitCode. The command refuses dirty worktrees. Use `pnpm run sync:gitcode -- --force` only to repair an explicitly diverged mirror.
- The normal local domestic release command is `pnpm run deploy:gitcode -- --target mac-win --tag v<version> --notes-file RELEASE_NOTES_v<version>.md`. It builds macOS ARM64 DMG/ZIP and Windows x64 NSIS locally, then uploads all installers to the same GitCode Release. Use `--target all` only when Linux AppImage/DEB packages are also required.
- `scripts/deploy-release.conf` contains local GitCode credentials, is ignored by Git, and must never be committed. `scripts/deploy-release.conf.example` documents the required keys.
- GitCode upstream cloning defaults to `https://gitcode.com/gh_mirrors/de/deepseek-harness.git` with `git clone --depth 1`. `DSH_REPO` can override it for a local checkout, while `DSH_REPO_URL`, `DSH_REPO_REF`, and `DSH_REPO_CACHE` can override the automatic cache.
- `scripts/prepare-runtime.mjs` must keep the upstream tsdown package filters out of a single oversized Windows command line; preserve its platform-aware batching when updating the runtime build.
- Keep macOS packaging unsigned: preserve `build.mac.identity: null` and `CSC_IDENTITY_AUTO_DISCOVERY=false` in every local and CI packaging path.
