# Project Instructions

## Packaging

- macOS builds must not be code signed or notarized.
- Keep `build.mac.identity` set to `null` and keep `CSC_IDENTITY_AUTO_DISCOVERY=false` in the packaging flow.
- Do not add a signing identity, provisioning profile, notarization credentials, or certificate-related CI secrets unless the project owner explicitly requests signed distribution.

## Version Synchronization

- The desktop package version must follow `apps/cli/package.json` in the resolved DeepSeek Harness upstream checkout.
- Use `pnpm run sync:version` to synchronize only the desktop `package.json` version; this command does not build installers.
- `pnpm run update` fast-forwards the upstream checkout, synchronizes the desktop version, and then packages the application. Use it for the normal upstream update flow.
- `pnpm run deploy:gitcode` synchronizes the version before a build automatically. When using `--skip-build`, it uploads existing artifacts and does not change the version.
- Do not manually edit the desktop version for a routine upstream release. If the upstream checkout cannot be resolved, configure `DSH_REPO`, `DSH_REPO_URL`, `DSH_REPO_REF`, or `DSH_REPO_CACHE` as documented below.

## Release Workflow

- GitHub is the source collaboration and CI release channel. Do not manually upload local installers to GitHub; `.github/workflows/release.yml` builds the Windows x64, macOS Intel, and macOS Apple Silicon packages.
- GitCode is the domestic source mirror and local installer distribution channel. The upstream dependency mirror is `https://gitcode.com/gh_mirrors/de/deepseek-harness.git`, and the desktop source/release repository is `diamondfsd/deepseek-harness-desktop`.
- Before a release, commit and push the source changes to GitHub, then run `pnpm run sync:gitcode` to fast-forward the same branch and tags to GitCode. The command refuses dirty worktrees. Use `pnpm run sync:gitcode -- --force` only to repair an explicitly diverged mirror.
- The normal local domestic release command is `pnpm run deploy:gitcode -- --target mac-win --tag v<version> --notes-file RELEASE_NOTES_v<version>.md`. It builds macOS ARM64 DMG/ZIP and Windows x64 NSIS locally, then uploads all installers to the same GitCode Release. Use `--target all` only when Linux AppImage/DEB packages are also required.
- Before a release, run `pnpm run sync:version` or use a release command that performs it automatically, then verify `package.json` matches the upstream CLI version. GitCode tags normally use `v<version>`.
- GitHub Actions reads the upstream CLI version and appends the Actions run number when no explicit build number is supplied. For example, upstream `0.1.0-rc.N` becomes package/release version `0.1.0-rc.N-build.<run>` and tag `v0.1.0-rc.N-build.<run>`. Do not look for the exact upstream version tag on GitHub unless the workflow was explicitly run with that tag/build number.
- Do not manually upload local installers to GitHub. Wait for the `Release Desktop App` workflow to finish and verify that Windows x64, macOS Intel, and macOS Apple Silicon assets are present in the generated GitHub Release.
- After a successful domestic release, verify the GitCode Release contains the expected DMG/ZIP/EXE assets and that the source mirror branch and release tag are synchronized.
- `scripts/deploy-release.conf` contains local GitCode credentials, is ignored by Git, and must never be committed. `scripts/deploy-release.conf.example` documents the required keys.
- GitCode upstream cloning defaults to `https://gitcode.com/gh_mirrors/de/deepseek-harness.git` with `git clone --depth 1`. `DSH_REPO` can override it for a local checkout, while `DSH_REPO_URL`, `DSH_REPO_REF`, and `DSH_REPO_CACHE` can override the automatic cache.
- `scripts/prepare-runtime.mjs` must keep the upstream tsdown package filters out of a single oversized Windows command line; preserve its platform-aware batching when updating the runtime build.
- Keep macOS packaging unsigned: preserve `build.mac.identity: null` and `CSC_IDENTITY_AUTO_DISCOVERY=false` in every local and CI packaging path.
