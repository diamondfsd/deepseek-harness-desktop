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

: "${GITCODE_TOKEN:?请设置 GITCODE_TOKEN，或检查 scripts/deploy-release.conf}"
GITCODE_OWNER="${GITCODE_OWNER:-diamondfsd}"
GITCODE_REPO="${GITCODE_REPO:-deepseek-harness-desktop}"
GITCODE_BRANCH="${GITCODE_BRANCH:-$(git branch --show-current)}"
GITCODE_URL="https://gitcode.com/${GITCODE_OWNER}/${GITCODE_REPO}.git"
PUSH_OPTIONS=()

while (($# > 0)); do
  case "$1" in
    --) shift ;;
    --force) PUSH_OPTIONS+=(--force); shift ;;
    --help|-h)
      echo '用法: pnpm run sync:gitcode [-- --force]'
      exit 0
      ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$GITCODE_BRANCH" ]; then
  echo '当前处于 detached HEAD，无法确定要同步的分支。' >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo '工作区存在未提交改动，请先提交后再同步到 GitCode。' >&2
  exit 1
fi

ASKPASS_FILE="$(mktemp "${TMPDIR:-/tmp}/deepseek-gitcode-askpass.XXXXXX")"
trap 'rm -f "$ASKPASS_FILE"' EXIT
cat > "$ASKPASS_FILE" <<'EOF'
#!/bin/sh
case "$1" in
  *Username*) printf '%s\n' "${GITCODE_OWNER:-gitcode}" ;;
  *) printf '%s\n' "${GITCODE_TOKEN}" ;;
esac
EOF
chmod 700 "$ASKPASS_FILE"

git_push() {
  if [ "${#PUSH_OPTIONS[@]}" -gt 0 ]; then
    GIT_ASKPASS="$ASKPASS_FILE" \
    GIT_TERMINAL_PROMPT=0 \
    GITCODE_OWNER="$GITCODE_OWNER" \
    GITCODE_TOKEN="$GITCODE_TOKEN" \
    git push "${PUSH_OPTIONS[@]}" "$@"
  else
    GIT_ASKPASS="$ASKPASS_FILE" \
    GIT_TERMINAL_PROMPT=0 \
    GITCODE_OWNER="$GITCODE_OWNER" \
    GITCODE_TOKEN="$GITCODE_TOKEN" \
    git push "$@"
  fi
}

echo "同步源码: ${GITCODE_URL} (${GITCODE_BRANCH})"
git_push "$GITCODE_URL" "HEAD:${GITCODE_BRANCH}"
echo '同步 tags...'
git_push "$GITCODE_URL" --tags
echo "GitCode 源码同步完成: ${GITCODE_OWNER}/${GITCODE_REPO}"
