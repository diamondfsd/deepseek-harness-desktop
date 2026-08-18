# deepseek-harness-desktop

这是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Electron 桌面封装项目。它使用 Electron 和 Vite，将主仓库的 Web 应用及运行时一起打包成桌面应用，用户打开应用即可使用，不需要手动执行 `pnpm install`、`pnpm run build` 或 `pnpm dsh web`。

本项目只负责桌面窗口、运行时部署和安装包生成，DeepSeek Harness 的核心功能及 Web UI 仍以主仓库为准。

## 仓库地址

当前桌面项目在 GitHub 和 GitCode 维护同一份源码，用户可以按网络环境选择：

| 内容 | GitHub | GitCode 国内镜像 |
|------|--------|----------------|
| 源码仓库 | [diamondfsd/deepseek-harness-desktop](https://github.com/diamondfsd/deepseek-harness-desktop) | [diamondfsd/deepseek-harness-desktop](https://gitcode.com/diamondfsd/deepseek-harness-desktop) |
| 桌面版 Release | [GitHub Releases](https://github.com/diamondfsd/deepseek-harness-desktop/releases) | [GitCode Releases](https://gitcode.com/diamondfsd/deepseek-harness-desktop/releases) |

GitHub 适合海外用户和开发协作；GitCode 适合中国大陆用户下载源码和安装包。两边的 `main` 分支由 `pnpm run sync:gitcode` 保持同步；GitHub 安装包沿用 Actions 发布，GitCode 安装包使用下方的本地发布命令上传。

## 相关链接

- [DeepSeek Harness 主仓库](https://github.com/deepseek-ai/deepseek-harness)
- [DeepSeek Harness Releases](https://github.com/deepseek-ai/deepseek-harness/releases)
- [官方文档](https://github.com/deepseek-ai/deepseek-harness/tree/master/docs)
- [问题反馈](https://github.com/deepseek-ai/deepseek-harness/issues)
- [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions)
- [DeepSeek 官网](https://www.deepseek.com/)

## 技术栈

- Electron `43.4.0`
- Vite `7.3.6`
- electron-vite `5.0.0`
- electron-builder `26.15.3`
- Node.js `>=22.12.0`
- pnpm `11`

## 上游仓库获取

构建不依赖任何特定用户的本地目录。上游仓库按以下顺序解析：

1. 如果设置了 `DSH_REPO`，使用指定的本地 checkout。
2. 如果项目旁边存在合法的 `deepseek-harness` checkout，复用它。
3. 否则自动从国内 GitCode 镜像以 `depth=1` 克隆到用户缓存目录 `~/.cache/deepseek-harness-desktop/deepseek-harness`。

默认上游地址是 `https://gitcode.com/gh_mirrors/de/deepseek-harness.git`。可以用环境变量覆盖：

```sh
DSH_REPO=/path/to/deepseek-harness pnpm run package:mac
DSH_REPO_URL=https://github.com/deepseek-ai/deepseek-harness.git DSH_REPO_REF=master pnpm run package:mac
```

构建过程中会在上游 checkout 内安装依赖并构建运行时；首次构建需要网络访问 GitCode，之后复用缓存。运行 `pnpm run update` 会对当前解析到的上游 checkout 执行快进更新，将桌面包版本同步为上游 CLI 版本后重新打包。

## 开发和打包

```sh
pnpm install
pnpm run dev
```

生成 macOS 安装包：

```sh
pnpm run package:mac
```

生成目录版应用进行本地测试：

```sh
pnpm run package:dir
```

Windows 和 Linux 请分别执行 `pnpm run package:win` 或 `pnpm run package:linux`。所有产物都会生成到 `release/` 目录。

打包前会从主仓库构建运行时，并将运行时依赖一起放入安装包。因此最终用户不需要安装 Node.js、pnpm，也不需要打开终端执行命令。

## GitHub Actions 发布

仓库中的 `Release Desktop App` 工作流会从 DeepSeek Harness 主仓库读取 `apps/cli/package.json` 的版本，并分别构建 Windows x64、macOS Intel 和 macOS Apple Silicon 安装包，最后创建一个 GitHub Release。

推送到 `main` 分支会自动运行工作流，并使用 GitHub Actions 的运行序号作为 `build.n`。例如上游版本为 `0.1.0-rc.N`，第 `3` 次运行会生成 `0.1.0-rc.N-build.3` / `v0.1.0-rc.N-build.3`。

也可以在 GitHub 的 Actions 页面手动运行工作流：

1. `upstream_ref` 填写主仓库分支或标签，默认是 `master`。
2. `build_number` 可选；不填写时同样使用 GitHub Actions 运行序号。

也可以直接推送 `v*` 标签触发发布，例如 `v0.1.0-rc.N-build.1`。这种方式会使用标签本身作为安装包版本。

## Listen 和数据目录

桌面应用启动时会在本机启动 DeepSeek Harness Web 服务。服务固定绑定到 `127.0.0.1`，端口使用 `0` 由操作系统自动分配，每次启动端口可能不同；Electron 会自动连接该服务，用户不需要手动访问端口。

服务只监听本机回环地址，不直接暴露到局域网。应用关闭时会自动停止该 Web 服务。

用户数据保存在 Electron 的 `userData/harness` 目录中，包括设置、凭据、会话和存储数据。主仓库目录只作为构建源目录，不作为用户数据目录。

## 跟进主仓库更新

推荐使用一条命令拉取主仓库的最新提交并重新打包：

```sh
pnpm run update
```

该命令会在默认主仓库中执行 `git pull --ff-only`，然后执行完整的桌面打包流程。`--ff-only` 不会自动创建合并提交；如果本地主仓库无法快进更新，命令会停止并保留现场。

如果使用其他主仓库：

```sh
DSH_REPO=/path/to/deepseek-harness pnpm run update
```

只检查当前主仓库版本而不拉取或打包：

```sh
pnpm run sync
```

只同步桌面包版本而不构建：

```sh
pnpm run sync:version
```

主版本、功能和兼容性以 [DeepSeek Harness 主仓库](https://github.com/deepseek-ai/deepseek-harness) 的版本和发布说明为准。桌面项目的 `version` 只控制安装包版本，不代表独立的 Harness 功能版本；每次主仓库更新后都应重新执行 `pnpm run update` 并重新分发安装包。

## 发布到 GitCode

本地发布命令会先从当前上游 checkout 同步桌面包版本，再构建当前平台安装包，最后创建或复用 GitCode Release 并上传 `release/` 中的安装包；源码 README 随 `sync:gitcode` 一起同步，不会被发布脚本单独改写：

```sh
pnpm run deploy:gitcode -- --target mac-win
```

默认目标 `mac-win` 会本地构建 macOS ARM64 和 Windows x64，并一起上传到同一个 Release；也可以选择 `mac`、`win`、`linux` 或 `all`。GitCode 配置放在被忽略的 `scripts/deploy-release.conf` 中，可参考 `scripts/deploy-release.conf.example`；也可以使用 `GITCODE_CONFIG_FILE` 指向其他配置文件。默认镜像仓库为 `diamondfsd/deepseek-harness-desktop`。

将当前源码仓库同步到同一个 GitCode 仓库：

```sh
pnpm run sync:gitcode
pnpm run deploy:gitcode -- --target mac-win
```

`sync:gitcode` 只推送已提交的当前分支和 tags；工作区存在未提交改动时会停止，避免 GitHub 和 GitCode 的源码状态不一致。首次使用时，请先在 GitCode 创建 `deepseek-harness-desktop` 空仓库，再执行同步命令。只有在 GitCode 仓库被单独改动、需要重新对齐到 GitHub 时才使用 `pnpm run sync:gitcode -- --force`。

## 许可

DeepSeek Harness 由 DeepSeek 开发，使用 [MIT License](https://github.com/deepseek-ai/deepseek-harness/blob/master/LICENSE) 发布。本项目打包并分发 DeepSeek Harness 运行时，随项目保留上游 MIT 许可声明，完整文本见 [LICENSE](LICENSE)。第三方依赖的许可信息以主仓库的 [THIRD_PARTY_NOTICES.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/THIRD_PARTY_NOTICES.md) 为准。

## 免责声明

本项目是桌面打包层，不是 DeepSeek Harness 主仓库的替代品。主仓库仍处于快速迭代阶段，更新可能包含不兼容变更；使用前请查看主仓库的版本说明和文档。
