#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$PROJECT_ROOT"

CONFIG_FILE="${GITCODE_CONFIG_FILE:-${SCRIPT_DIR}/deploy-release.conf}"
if [ -f "$CONFIG_FILE" ]; then
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
fi

TARGET="${GITCODE_TARGET:-}"
TAG_OVERRIDE="${GITCODE_TAG:-}"
NOTES_FILE="${GITCODE_NOTES_FILE:-}"
SKIP_BUILD=0

usage() {
  cat <<'EOF'
用法:
  pnpm run deploy:gitcode -- [选项]

选项:
  --target mac|win|mac-win|linux|all  本地构建的平台，macOS 默认 mac-win
  --mac / --win / --linux    平台快捷参数
  --tag v<version>           GitCode Release tag，默认取 package.json 版本
  --notes-file FILE          Release 发布说明文件
  --skip-build               直接上传 release/ 中已有产物
  --help                     显示帮助

环境变量:
  GITCODE_CONFIG_FILE        GitCode 配置文件路径
  GITCODE_OWNER              GitCode 用户/组织
  GITCODE_REPO               GitCode 镜像仓库
  GITCODE_TOKEN              GitCode Personal Access Token
EOF
}

while (($# > 0)); do
  case "$1" in
    --) shift ;;
    --target)
      [ $# -ge 2 ] || { echo "--target 缺少参数" >&2; exit 2; }
      TARGET="$2"
      shift 2
      ;;
    --target=*) TARGET="${1#*=}"; shift ;;
    --mac) TARGET=mac; shift ;;
    --win) TARGET=win; shift ;;
    --mac-win) TARGET=mac-win; shift ;;
    --linux) TARGET=linux; shift ;;
    --all) TARGET=all; shift ;;
    --tag)
      [ $# -ge 2 ] || { echo "--tag 缺少参数" >&2; exit 2; }
      TAG_OVERRIDE="$2"
      shift 2
      ;;
    --tag=*) TAG_OVERRIDE="${1#*=}"; shift ;;
    --notes-file)
      [ $# -ge 2 ] || { echo "--notes-file 缺少参数" >&2; exit 2; }
      NOTES_FILE="$2"
      shift 2
      ;;
    --notes-file=*) NOTES_FILE="${1#*=}"; shift ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [ -z "$TARGET" ]; then
  case "$(uname -s)" in
    Darwin) TARGET=mac-win ;;
    Linux) TARGET=linux ;;
    *) TARGET=mac ;;
  esac
fi
case "$TARGET" in
  mac|win|mac-win|linux|all) ;;
  *) echo "不支持的构建目标: $TARGET" >&2; exit 2 ;;
esac

: "${GITCODE_TOKEN:?请设置 GITCODE_TOKEN，或检查 scripts/deploy-release.conf}"
GITCODE_OWNER="${GITCODE_OWNER:-diamondfsd}"
GITCODE_REPO="${GITCODE_REPO:-deepseek-harness-desktop}"
GITHUB_REPO="${GITHUB_REPO:-diamondfsd/deepseek-harness-desktop}"
API_BASE="https://api.gitcode.com/api/v5/repos/${GITCODE_OWNER}/${GITCODE_REPO}"
DOWNLOAD_BASE="https://gitcode.com/${GITCODE_OWNER}/${GITCODE_REPO}/releases/download"
RELEASE_DIR="${PROJECT_ROOT}/release"

for command_name in curl node pnpm; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "缺少命令: ${command_name}" >&2
    exit 1
  }
done

json_value() {
  local json="$1"
  shift
  node -e '
    const [raw, ...path] = process.argv.slice(1)
    let value = JSON.parse(raw)
    for (const key of path) value = value?.[key]
    if (value !== undefined && value !== null) process.stdout.write(String(value))
  ' "$json" "$@"
}

file_size() {
  stat -f%z "$1" 2>/dev/null || stat -c%s "$1"
}

file_size_human() {
  local bytes="$1"
  if command -v numfmt >/dev/null 2>&1; then
    numfmt --to=iec "$bytes"
  else
    printf '%sB' "$bytes"
  fi
}

asset_exists() {
  node -e '
    const [raw, name] = process.argv.slice(1)
    const release = JSON.parse(raw)
    process.stdout.write(release.assets?.some(asset => asset.name === name) ? "1" : "0")
  ' "$1" "$2"
}

artifact_matches_target() {
  local name="$1"
  case "$TARGET:$name" in
    mac:*.dmg|mac:*.zip|win:*.exe|mac-win:*.dmg|mac-win:*.zip|mac-win:*.exe|linux:*.AppImage|linux:*.appimage|linux:*.deb|all:*.dmg|all:*.zip|all:*.exe|all:*.AppImage|all:*.appimage|all:*.deb)
      return 0
      ;;
    *) return 1 ;;
  esac
}

PKG_VERSION="$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version)")"
if [ "$SKIP_BUILD" -eq 0 ]; then
  pnpm run sync:version
  PKG_VERSION="$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version)")"
fi
TAG="${TAG_OVERRIDE:-v${PKG_VERSION}}"
TAG="${TAG#v}"
TAG="v${TAG}"

if [ -z "$NOTES_FILE" ] && [ -f "${PROJECT_ROOT}/RELEASE_NOTES_${TAG}.md" ]; then
  NOTES_FILE="${PROJECT_ROOT}/RELEASE_NOTES_${TAG}.md"
fi
if [ -n "$NOTES_FILE" ] && [ ! -f "$NOTES_FILE" ]; then
  echo "发布说明文件不存在: ${NOTES_FILE}" >&2
  exit 1
fi
if [ -n "$NOTES_FILE" ]; then
  RELEASE_BODY="$(<"$NOTES_FILE")"
else
  RELEASE_BODY="$(printf 'DeepSeek Harness Desktop %s 发布.\n\nGitHub: https://github.com/%s/releases/tag/%s\n' "$TAG" "$GITHUB_REPO" "$TAG")"
fi

BUILD_MARKER="$(mktemp "${TMPDIR:-/tmp}/deepseek-harness-build.XXXXXX")"
trap 'rm -f "$BUILD_MARKER"' EXIT

if [ "$SKIP_BUILD" -eq 0 ]; then
  rm -f "${RELEASE_DIR}"/*.dmg "${RELEASE_DIR}"/*.zip "${RELEASE_DIR}"/*.exe \
    "${RELEASE_DIR}"/*.AppImage "${RELEASE_DIR}"/*.appimage "${RELEASE_DIR}"/*.deb 2>/dev/null || true
  touch "$BUILD_MARKER"
  case "$TARGET" in
    mac) pnpm run package:mac ;;
    win) pnpm run package:win ;;
    mac-win)
      pnpm run package:mac
      pnpm run package:win
      ;;
    linux) pnpm run package:linux ;;
    all)
      pnpm run package:mac
      pnpm run package:win
      pnpm run package:linux
      ;;
  esac
fi

FILES=()
if [ -d "$RELEASE_DIR" ]; then
  while IFS= read -r -d '' filepath; do
    filename="$(basename "$filepath")"
    artifact_matches_target "$filename" || continue
    if [ "$SKIP_BUILD" -eq 0 ] && [ ! "$filepath" -nt "$BUILD_MARKER" ]; then
      continue
    fi
    FILES+=("$filepath")
  done < <(find "$RELEASE_DIR" -maxdepth 1 -type f -print0 | sort -z)
fi

if [ "${#FILES[@]}" -eq 0 ]; then
  echo "未找到可上传的安装包，请先完成本地打包，或使用 --skip-build 上传 release/ 中已有产物。" >&2
  exit 1
fi

echo "目标仓库: ${GITCODE_OWNER}/${GITCODE_REPO}"
echo "Release: ${TAG}"
for filepath in "${FILES[@]}"; do
  size="$(file_size "$filepath")"
  echo "产物: $(basename "$filepath") ($(file_size_human "$size"))"
done

release_json=''
if release_json="$(curl -sS --fail -H "PRIVATE-TOKEN: ${GITCODE_TOKEN}" "${API_BASE}/releases/tags/${TAG}")"; then
  echo "GitCode Release 已存在，复用并补充附件。"
else
  release_payload="$(node -e '
    const [tag, name, body] = process.argv.slice(1)
    process.stdout.write(JSON.stringify({ tag_name: tag, name, body }))
  ' "$TAG" "DeepSeek Harness Desktop ${TAG#v}" "$RELEASE_BODY")"
  response_file="$(mktemp "${TMPDIR:-/tmp}/gitcode-release.XXXXXX")"
  status="$(curl -sS -o "$response_file" -w '%{http_code}' -X POST "${API_BASE}/releases" \
    -H "PRIVATE-TOKEN: ${GITCODE_TOKEN}" \
    -H 'Content-Type: application/json' \
    --data "$release_payload")" || true
  if [[ "$status" != 200 && "$status" != 201 && "$status" != 422 ]]; then
    echo "创建 GitCode Release 失败 (HTTP ${status}): $(<"$response_file")" >&2
    rm -f "$response_file"
    exit 1
  fi
  rm -f "$response_file"
  release_json="$(curl -sS --fail -H "PRIVATE-TOKEN: ${GITCODE_TOKEN}" "${API_BASE}/releases/tags/${TAG}")"
  echo "GitCode Release 已创建。"
fi

for filepath in "${FILES[@]}"; do
  filename="$(basename "$filepath")"
  if [ "$(asset_exists "$release_json" "$filename")" = '1' ]; then
    echo "跳过已存在附件: ${filename}"
    continue
  fi

  upload_json="$(curl -sS --fail --get "${API_BASE}/releases/${TAG}/upload_url" \
    -H "PRIVATE-TOKEN: ${GITCODE_TOKEN}" \
    --data-urlencode "file_name=${filename}")"
  upload_url="$(json_value "$upload_json" url)"
  if [ -z "$upload_url" ]; then
    echo "获取 ${filename} 上传地址失败: ${upload_json}" >&2
    exit 1
  fi

  header_args=()
  for header_name in Content-Type x-obs-meta-project-id x-obs-acl x-obs-callback; do
    header_value="$(node -e '
      const [raw, name] = process.argv.slice(1)
      const value = JSON.parse(raw).headers?.[name]
      if (value) process.stdout.write(String(value))
    ' "$upload_json" "$header_name")"
    [ -n "$header_value" ] && header_args+=(-H "${header_name}: ${header_value}")
  done
  [ "${#header_args[@]}" -gt 0 ] || header_args=(-H 'Content-Type: application/octet-stream')

  echo "上传 ${filename}..."
  status="$(curl --fail --progress-bar -X PUT "${header_args[@]}" \
    --data-binary "@${filepath}" "${upload_url}" -o /dev/null -w '%{http_code}')" || true
  if [[ "$status" != 2* ]]; then
    echo "上传 ${filename} 失败 (HTTP ${status})" >&2
    exit 1
  fi
  echo "上传完成: ${filename}"
done

echo "发布完成: ${DOWNLOAD_BASE}/${TAG}/"
