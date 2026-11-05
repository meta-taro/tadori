#!/usr/bin/env bash
# OSS 公開リポの個人情報混入チェック（product-baseline §32）
#
# 使い方:
#   .github/scripts/oss-privacy-check.sh <BASE> <HEAD>   # 範囲の commit + 差分を検査
#   .github/scripts/oss-privacy-check.sh                 # 未 commit の作業ツリー差分のみ検査
#
# 環境変数（すべて任意）:
#   OSS_ALLOWED_AUTHOR_EMAIL_REGEX  commit author/committer に許可するメールの ERE
#                                   既定: @users\.noreply\.github\.com$
#   OSS_ALLOWED_EMAIL_DOMAINS       追加行・commit message で許可するメールの許可リスト（空白区切り）
#                                   ドメインだけ書くとそのドメイン全体を許可する。
#                                   "@" を含めて書くとそのアドレスだけを許可する（推奨）
#   OSS_DENY_WORDS                  禁止語（実名等）を 1 行 1 語。CI では secrets から渡す
#   OSS_SCAN_ALL_FILES              1 なら、差分ではなく**追跡中の全ファイルの中身**を見る。
#                                   公開へ切り替える前の確認に使う（差分検査は最初の
#                                   commit の中身を含まないため）
#
# 設計上の約束:
#   - 検出しても「見つかった中身」をログへ出さない。CI ログは公開されるため、
#     そこへ実名やメールをそのまま印字すると検査自体が漏洩経路になる。
#     出力は「場所（file:line / commit）＋ 規則 ID ＋ マスク済み文字列」に限る。
set -uo pipefail

# 画面（GitHub の Merge ボタン）で作られる commit は、author は本人の noreply だが、
# **committer は GitHub 自身**（`GitHub <noreply@github.com>`）になる。
# これは個人のアドレスではなく web-flow の識別子なので、**このアドレス 1 個だけ**通す
# （`github.com` ドメイン全体ではない。2026-09-18、初めて PR を通した日に落ちた）。
ALLOWED_AUTHOR_RE="${OSS_ALLOWED_AUTHOR_EMAIL_REGEX:-(@users\.noreply\.github\.com|^noreply@github\.com)$}"
# noreply@anthropic.com は AI エージェントの Co-Authored-By 用の no-reply アドレスで、
# 個人ではない（§32 が止めたいのは実在の個人の名前とメール）。
# ドメイン全体ではなく、このアドレス 1 個だけを許可する。
ALLOWED_DOMAINS="${OSS_ALLOWED_EMAIL_DOMAINS:-example.com example.org example.net users.noreply.github.com noreply@anthropic.com}"
DENY_WORDS="${OSS_DENY_WORDS:-}"
SCAN_ALL="${OSS_SCAN_ALL_FILES:-}"

EMAIL_RE='[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
# 検査スクリプト自身は正規表現やドメイン例を含むため除外する
SELF_RE='^\.github/(scripts/oss-privacy-check\.sh|workflows/oss-privacy-check\.yml)$'

fail=0
note() { printf '%s\n' "$*" >&2; }

# メールを y***@***.com 形式へ落とす（公開ログへ原文を出さないため）
mask_email() {
  sed -E 's/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@[A-Za-z0-9.-]+\.([A-Za-z]{2,})/\1***@***.\2/g'
}

# 許可リストの項目は 2 通り。
#   "example.com"        … そのドメイン全体を許可する
#   "noreply@vendor.com" … そのアドレスだけを許可する（こちらのほうが穴が小さい）
# 住所の形に当てはまるが、実体はファイル名であるもの。
#
# `128x128@2x.png` は住所の形にそのまま当てはまる（2026-09-07 に実際に出た。
# アイコンを足した commit が、追加行でも commit message でも止まった）。
# **誤検出が続くと、検査そのものが信用されなくなる。**
#
# **本物の TLD と重なる拡張子は、ここに入れない**（`md` `sh` `rs` `py` `zip` `io` は
# どれも実在する TLD で、そこで終わる住所があり得る）。
# 迷ったら入れない。**見逃すより、誤って引っかけるほうが安全な検査**だから。
FILE_EXT="png jpg jpeg gif svg ico icns webp bmp tiff woff woff2 ttf otf eot \
js mjs cjs ts tsx jsx css scss html htm json yaml yml toml lock \
txt csv tsv pdf gz tar xml wasm map"

looks_like_file() {
  local tail
  tail="$(printf '%s' "${1##*.}" | tr 'A-Z' 'a-z')"
  case " $FILE_EXT " in
    *" $tail "*) return 0 ;;
  esac
  return 1
}

allowed_email() {
  local e="$1" d el al
  d="${e##*@}"
  el="$(printf '%s' "$e" | tr 'A-Z' 'a-z')"
  for a in $ALLOWED_DOMAINS; do
    al="$(printf '%s' "$a" | tr 'A-Z' 'a-z')"
    case "$al" in
      *@*) [ "$el" = "$al" ] && return 0 ;;
      *)   [ "$(printf '%s' "$d" | tr 'A-Z' 'a-z')" = "$al" ] && return 0 ;;
    esac
  done
  return 1
}

# 走査の結果をファイルへ受け、**落ちたら止める**。
#
# `< <(awk ...)` は awk が死んでも気づけない。実際、`awk -v` に改行を渡して
# awk が死んだのに、検査は「OK」で終わった（2026-09-06）。
# **安全網が黙って死ぬのがいちばん悪い。**
scan_to() {
  local target="$1"
  shift
  if ! "$@" > "$target"; then
    note "NG [scanner-failed] 走査が失敗しました。**検査を通したことにしません。**"
    fail=1
  fi
}

# 追加行からメールを拾う。**同じ行に複数あっても取りこぼさない。**
scan_emails() {
  # 拡張子の一覧は **shell 側の `FILE_EXT` が正本**。ここに書き写さない。
  printf '%s\n' "$added" | awk -F'\t' -v self="$SELF_RE" -v exts="$FILE_EXT" '
    # 末尾がファイルの拡張子なら、住所ではなくファイル名。
    function looks_like_file(found,   tail) {
      tail = tolower(found)
      sub(/^.*\./, "", tail)
      return (tail in EXT)
    }
    BEGIN {
      split(exts, parts, /[ \t\n]+/)
      for (i in parts) if (parts[i] != "") EXT[parts[i]] = 1
    }
    $1 ~ self { next }
    {
      line = $3
      while (match(line, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z][A-Za-z]+/)) {
        found = substr(line, RSTART, RLENGTH)
        line = substr(line, RSTART + RLENGTH)
        if (looks_like_file(found)) continue
        key = $1 "\t" $2 "\t" found
        if (!(key in seen)) { seen[key] = 1; print key }
      }
    }
  '
}

# 追加行から禁止語を拾う。**原文は出さない。何番目の語かだけを返す。**
#
# ## 英数字だけの語は、語の区切りを見る
#
# 日本語には語の区切りが無いので、既定は部分一致にしてある。
# だが**英数字の短い語**をそのまま部分一致にすると、lock ファイルのような
# 機械生成の文字列に偶然含まれて誤検出になる
# （実際に `cpu: [ppc64]` の行が引っかかった。2026-09-07）。
#
# **誤検出が続くと、検査そのものが信用されなくなる。**
# 英数字だけの語は前後が英数字でないことを求め、日本語を含む語は部分一致のまま。
#
# 正規表現は使わない。**禁止語に記号が入っていても壊れないため。**
scan_deny_words() {
  printf '%s\n' "$added" | awk -F'\t' -v self="$SELF_RE" -v wordsfile="$1" '
    function alnum(c) { return (c >= "a" && c <= "z") || (c >= "0" && c <= "9") }
    function bounded(hay, needle,   from, at, before, after) {
      from = 1
      while (1) {
        at = index(substr(hay, from), needle)
        if (at == 0) return 0
        at = at + from - 1
        before = (at == 1) ? "" : substr(hay, at - 1, 1)
        after = substr(hay, at + length(needle), 1)
        if (!alnum(before) && !alnum(after)) return 1
        from = at + 1
      }
    }
    BEGIN {
      n = 0
      while ((getline line < wordsfile) > 0) {
        n++
        w[n] = tolower(line)
        # 日本語を含まない語か（英数字と記号だけでできているか）。
        ascii[n] = (w[n] ~ /^[ -~]*$/)
      }
    }
    $1 ~ self { next }
    {
      lower = tolower($3)
      for (i = 1; i <= n; i++) {
        if (w[i] == "") continue
        if (ascii[i]) {
          if (bounded(lower, w[i])) print $1 "\t" $2 "\t" i
          continue
        }
        if (index(lower, w[i]) > 0) print $1 "\t" $2 "\t" i
      }
    }
  '
}

# 走査の結果をファイルへ受け、**落ちたら止める**。
#
# `< <(awk ...)` は awk が死んでも気づけない。実際、`awk -v` に改行を渡して
# awk が死んだのに、検査は「OK」で終わった（2026-09-06）。
# **安全網が黙って死ぬのがいちばん悪い。**
scan_to() {
  local target="$1"
  shift
  if ! "$@" > "$target"; then
    note "NG [scanner-failed] 走査が失敗しました。**検査を通したことにしません。**"
    fail=1
  fi
}

# --- 範囲の解決 -------------------------------------------------------------
BASE="${1:-}"
HEAD_REF="${2:-HEAD}"
RANGE=""
resolve_base() {
  # 指定された base が使えるならそれを使う
  if [ -n "$BASE" ] && ! printf '%s' "$BASE" | grep -Eq '^0{7,40}$'; then
    if git rev-parse --verify --quiet "$BASE^{commit}" >/dev/null; then
      printf '%s' "$BASE"
      return 0
    fi
  fi
  # 新規ブランチの push（base が全ゼロ）等では既定ブランチとの merge-base へフォールバックする。
  # ここを諦めると「ブランチを新規に切った初回 push」が commit 検査を素通りしてしまう。
  for r in origin/HEAD origin/main origin/master origin/develop main master develop; do
    if git rev-parse --verify --quiet "$r^{commit}" >/dev/null; then
      mb="$(git merge-base "$r" "$HEAD_REF" 2>/dev/null)" || continue
      [ -n "$mb" ] && { printf '%s' "$mb"; return 0; }
    fi
  done
  return 1
}

if BASE_RESOLVED="$(resolve_base)"; then
  if [ "$BASE_RESOLVED" != "${BASE:-}" ]; then
    note "INFO base '${BASE:-未指定}' を解決できないため ${BASE_RESOLVED:0:8}（既定ブランチとの merge-base）へフォールバックしました"
  fi
  BASE="$BASE_RESOLVED"
  RANGE="$BASE..$HEAD_REF"
else
  note "INFO base を解決できないため commit 検査をスキップし、作業ツリー差分のみ検査します"
fi

if [ -z "$DENY_WORDS" ]; then
  note "INFO OSS_DENY_WORDS が空のため禁止語検査はスキップします（fork からの PR では GitHub 仕様上 secrets が渡らず常に空になります）"
fi

# --- 1. commit の author / committer（メール + 表示名） ---------------------
if [ -n "$RANGE" ]; then
  while IFS='|' read -r sha ae ce an cn; do
    [ -z "${sha:-}" ] && continue
    for e in "$ae" "$ce"; do
      if ! printf '%s' "$e" | grep -Eq "$ALLOWED_AUTHOR_RE"; then
        note "NG [author-email] ${sha:0:8} : $(printf '%s' "$e" | mask_email) が許可パターン外"
        fail=1
      fi
    done
    # 表示名（user.name）は実名がそのまま入りやすく、かつメール検査では拾えない
    if [ -n "$DENY_WORDS" ]; then
      for n in "$an" "$cn"; do
        i=0
        while IFS= read -r w; do
          i=$((i + 1))
          [ -z "$w" ] && continue
          if printf '%s' "$n" | grep -qiF -- "$w"; then
            note "NG [author-name] ${sha:0:8} : 表示名が禁止語 #$i に一致"
            fail=1
          fi
        done <<< "$DENY_WORDS"
      done
    fi
  done < <(git log --format='%H|%ae|%ce|%an|%cn' "$RANGE")
fi

# --- 2. commit message ------------------------------------------------------
if [ -n "$RANGE" ]; then
  while read -r sha; do
    [ -z "${sha:-}" ] && continue
    msg="$(git log -1 --format='%B' "$sha")"
    while read -r found; do
      [ -z "${found:-}" ] && continue
      looks_like_file "$found" && continue
      allowed_email "$found" && continue
      note "NG [message-email] ${sha:0:8} : $(printf '%s' "$found" | mask_email)"
      fail=1
    done < <(printf '%s' "$msg" | grep -Eo "$EMAIL_RE" | sort -u)

    if [ -n "$DENY_WORDS" ]; then
      i=0
      while IFS= read -r w; do
        i=$((i + 1))
        [ -z "$w" ] && continue
        if printf '%s' "$msg" | grep -qiF -- "$w"; then
          note "NG [message-denyword] ${sha:0:8} : 禁止語 #$i に一致"
          fail=1
        fi
      done <<< "$DENY_WORDS"
    fi
  done < <(git log --format='%H' "$RANGE")
fi

# --- 3. 追加行（差分） ------------------------------------------------------
# commit 済みの範囲差分と、未 commit（staged + unstaged）の差分を両方見る。
# CI では後者が空になり、ローカルの commit 前チェックでは前者が空になる。
diff_out=""
if [ -n "$RANGE" ]; then
  diff_out="$(git diff --unified=0 "$BASE" "$HEAD_REF")"
fi
diff_out="$diff_out
$(git diff --unified=0 HEAD)"

added="$(printf '%s\n' "$diff_out" | awk '
  /^\+\+\+ /   { f = substr($0, 7); next }
  /^@@ /       { split($0, a, " "); split(substr(a[3], 2), b, ","); ln = b[1]; next }
  /^\+/        { print f "\t" ln "\t" substr($0, 2); ln++; next }
')"

# **公開の前は、差分ではなく中身そのものを見る。**
# 差分検査は最初の commit の中身を含まないので、そこだけ素通りする。
if [ "$SCAN_ALL" = "1" ]; then
  note "INFO 追跡中の全ファイルの中身を検査します（差分ではなく）"
  added="$(git ls-files -z | xargs -0 -n 50 grep -Hn '' 2>/dev/null | awk -F: '
    { file = $1; line = $2; $1 = ""; $2 = ""; sub(/^::/, ""); print file "\t" line "\t" $0 }
  ')"
fi

# **1 行ごとに grep を起こさない。** 追加行は数千行になることがあり（lock ファイル等）、
# 1 行につき subshell を起こすと commit 前の検査が数分かかる。
# awk 1 本で走査し、**見つかったものだけ**を shell で扱う。
if [ -n "$added" ]; then
  hits="$(mktemp)"

  # 3-1. メール
  scan_to "$hits" scan_emails
  while IFS=$'\t' read -r f ln found; do
    [ -z "${found:-}" ] && continue
    allowed_email "$found" && continue
    note "NG [added-email] $f:$ln : $(printf '%s' "$found" | mask_email)"
    fail=1
  done < "$hits"

  # 3-2. 禁止語
  #
  # **`awk -v` に改行を含む値は渡せない**（awk が死に、しかも検査は「OK」で終わる）。
  # 一時ファイルで渡す。
  if [ -n "$DENY_WORDS" ]; then
    words_file="$(mktemp)"
    printf '%s\n' "$DENY_WORDS" > "$words_file"

    scan_to "$hits" scan_deny_words "$words_file"
    while IFS=$'\t' read -r f ln i; do
      [ -z "${i:-}" ] && continue
      note "NG [added-denyword] $f:$ln : 禁止語 #$i に一致"
      fail=1
    done < "$hits"
    rm -f "$words_file"
  fi

  rm -f "$hits"
fi

# --- 結果 -------------------------------------------------------------------
if [ "$fail" -ne 0 ]; then
  note ""
  note "個人情報の混入が疑われます（product-baseline §32）。"
  note "  - 追加行が原因: 当該行を修正して commit し直す"
  note "  - commit author/message が原因: history に焼き付くため rebase での書き換えが要る。"
  note "    公開後に気づいた場合は force push の可否を含めてリポジトリのオーナーへ Issue で確認する"
  exit 1
fi

note "OK 個人情報の混入は検出されませんでした"
