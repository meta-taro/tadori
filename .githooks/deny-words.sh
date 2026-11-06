#!/usr/bin/env bash
# 手元にだけ置く禁止語の一覧（委託先・顧客・人の名前など）を読む。
# 一覧そのものは公開できないので、リポジトリの外に置く：
#   既定 ~/.config/oss-guard/deny-words.txt（1 行 1 語。# で始まる行は飛ばす）
#   別の場所なら OSS_DENY_WORDS_FILE で指す
# 一覧が無ければ空を返す（CI では secrets から OSS_DENY_WORDS を渡す）
file="${OSS_DENY_WORDS_FILE:-$HOME/.config/oss-guard/deny-words.txt}"
[ -f "$file" ] && grep -v -e '^#' -e '^[[:space:]]*$' "$file" | tr -d '\r'
exit 0
