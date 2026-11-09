# tadori（辿り）

> ⚠ **MVP です。**架空の見本の案件で、判定（`check`・`why`）と手元で開く画面（`serve`）が動きます。
> 方向性は [PRD.md](PRD.md)、決めたことと理由は [docs/decisions.md](docs/decisions.md)、
> 画面と文書で使う言葉は [用語集（glossary.tsv）](packages/ui/static/glossary.tsv) にあります。
> 紹介とダウンロードのページ：https://meta-taro.github.io/tadori/

**仕様の 1 文から、試験ケース・実施の証跡・指摘・再発防止までを ID でつなぐ、git 上の台帳。**
工程ごとにルールセットを持ち、「どこが漏れているか」を出します。漏れを認めるのは人です。

## なぜ作るか

不具合が出たとき、「当時気づけたのか」「なぜ試験で拾えなかったのか」を説明するには、
設計書・試験書・課題票・レビュー・会話ログの 4〜5 か所を掘り返すことになります。
**記録はあります。記録どうしのつながりが人の頭の中にしかありません。**

AI に開発を任せる比率が上がるほど、AI が何を根拠に「確かめた」と言ったのかを
後から辿れることが要ります。

## 動かす

Node.js 22 以上と pnpm が要ります。

```bash
pnpm install
pnpm dev          # ビルドして、架空の見本の案件で画面を開く → http://127.0.0.1:4870/
```

デスクトップアプリ（Tauri）として開くには、Rust も要ります。

```bash
pnpm --filter @tadori/desktop dev   # 窓が開き、案件のフォルダ（.tadori のあるフォルダ）を選ぶ。次からは前回の案件を開く
```

窓は裏で `tadori serve` を起こし、その画面を映すだけです（判定は CLI と同じ核）。

インストーラー（macOS の Apple シリコン・Intel、Windows の x64・ARM）は、`v` で始まるタグ（例：`v0.1.0`）を push すると GitHub Actions が作り、下書きのリリースに付けます。中身を確かめてから公開してください。手元で作るなら `pnpm --filter @tadori/desktop bundle` です。

commit の前に型の検査・テスト・置き場所の検査、個人や委託先の名前の検査を走らせるには（このリポジトリで 1 回だけ）。
名前の一覧は公開できないので、リポジトリの外の `~/.config/oss-guard/deny-words.txt` に 1 行 1 語で書きます:

```bash
git config core.hooksPath .githooks
```

環境変数・秘密情報は要りません（`.env` は使いません）。

画面の裏の server の中で例外が起きたら、時刻・API・例外の要点を PC の手元に残します（Windows は `%LOCALAPPDATA%	adorilogs`、macOS は `~/Library/Logs/tadori`、`TADORI_LOG_DIR` で変えられます）。送られてきた本文（案件の中身）は残しません。エージェントは MCP の `server_errors` で読めます。

新しい版の確認：ヘルプの「バージョンと更新」と、起動したとき（1 日に 1 回）に、GitHub の公開リリースの最新の版だけを見に行きます。案件の中身は送りません。外へ出られない環境では `TADORI_UPDATE_CHECK=off` で切れます。新しい版があれば配布のページを開けるようにするだけで、入れ替えは人が行います。

## するもの

| コマンド | 出すもの |
|---|---|
| `tadori init [案件] [--name 名前]` | 試す案件のリポジトリに、最小の設定（`.tadori/`）と台帳（`ledger/`）を置く。あるファイルは書き換えない。ルールは例をコメントで置くだけ（ルールが無い工程は「ルールなし」と出し、通ったようには見せない） |
| `tadori check [案件]` | 工程ごとの漏れと人の承認待ち。漏れがあれば終了コード 1（CI でも使える）。`--log` でチェックの記録に 5W1H で足す |
| `tadori daily [案件] [--who 担当] [--date 日付]` | 人単位の 1 日の進行（今日・次の作業日・相談・補足）。形は案件ごとに設定できる。画面の「1 日の進行」と MCP の `daily` も同じもの |
| `tadori how-to [話題]` | 使い方（MCP の `how_to` と同じ中身）。話題は start・ledger・rules・check・screen・links・agent-rules |
| `tadori why <ID> [案件]` | その 1 件から上下に辿った全部と、線が切れている所 |
| `tadori serve [案件]` | 手元（127.0.0.1）で画面を開く。リリースまでの残課題（タイムライン／カード）・WBS・ルールセット・チェックの記録・つながりを辿る・設定 |
| `tadori mcp [案件]` | MCP の口（標準入出力）。道具は使い方（`how_to`）・用語（`glossary`）・残課題（`get_remaining`）・漏れ（`list_leaks`）・つながり（`trace`）・台帳の行を探す（`find_items`）・画面の専用カーソル（`screen`）・1 日の進行・書く道具（台帳・WBS・ルール・人の表・工程・記録つきの check・案件の切り替え。使い方は how_to の write）。人の承認を書く道具は無い。`--screen` で操作する画面の場所を変えられる |

```bash
node packages/cli/dist/main.js check examples/lend-v12
node packages/cli/dist/main.js why F-02 examples/lend-v12
node packages/cli/dist/main.js serve examples/lend-v12 --port 4870
```

画面で設定や WBS のステータスを変えると、TSV に書き戻します。案件のフォルダがそれ自身の git リポジトリなら commit します。
**push はしません。**各担当が自分のクローンで中身を確かめてから push してください。

### エージェントから使う（MCP）

Claude Code なら、ビルドしたあとに次の 1 行でつなげます（パスは手元に合わせてください）。

```bash
claude mcp add tadori -- node /path/to/tadori/packages/cli/dist/main.js mcp /path/to/案件のフォルダ
```

つないだエージェントは、まず `how_to`（使い方）の `start` と `agent-rules`（守ること）を読みます。使い方の中身は [packages/cli/guide.md](packages/cli/guide.md) です。
`screen` を使うと、人が開いている tadori の画面を、画面の中の専用カーソルで操作して見せられます（人のマウスは使いません）。

## 案件のフォルダの置き方

台帳はすべて git 上の TSV です。tadori が無くても人が読めます。

```text
.tadori/project.tsv        案件の名前
.tadori/phases.tsv         工程の並び（企業・プロダクトごとに違う）
.tadori/statuses.tsv       WBS のステータスの設定
.tadori/kinds.tsv          台帳の種類の読み方（無くてもよい。例：TC → 試験ケース）
.tadori/columns.tsv        台帳の列の読み方（無くてもよい。例：change → 改修後の対応）
.tadori/sources.tsv        正本（外の文書・シート・課題）の URL と、反映が古いとする日数（無くてもよい。台帳の source 列の先頭の名前で引く。tadori how-to sources）
.tadori/links.tsv          ほかの道具を開く URL の雛形（無くてもよい。差し込み：{path}・{repopath}・{abspath}・{line}・{id}。例は examples/lend-v12/.tadori/links.tsv）
                           差し込み：{path} 案件の中の場所 / {abspath} 手元の絶対パス / {line} 行番号 / {id} 行の ID。javascript: などは使えない
.tadori/rulesets/*.tsv     工程ごとのルールセット（判定は covered / refers / filled / approval。owner 列に担当の役割）
.tadori/checks.tsv         チェックの記録（5W1H）
ledger/items.tsv           台帳（設計書の章・節、commit、観点、試験ケース、試験の記録、指摘、再発防止）
ledger/wbs.tsv             WBS のタスク
ledger/approvals.tsv       人の承認の記録（人が書く）
```

見本は [examples/lend-v12](examples/lend-v12)（架空の「備品貸出アプリ 改修 v1.2」）です。
**実案件のデータはこのリポジトリに入れません。**実案件の台帳は、その案件のリポジトリに置きます。

## リポジトリの中身

```text
packages/core   判定の核（台帳を読み、漏れ・完了判定・つながりの辿りを出す）。実行時の依存なし
packages/cli    tadori コマンドと、手元のサーバー
packages/ui     画面（tadori serve がそのまま配る）
packages/desktop デスクトップアプリ（Tauri 2）。裏で tadori serve を起こし、その画面を窓に映す
site/           紹介のサイト（GitHub Pages。ビルドの要らない HTML）
examples/       架空の見本の案件
```

```bash
pnpm verify       # 型の検査とテスト
pnpm e2e          # 画面のテスト（Playwright。架空の見本を開いて確かめる。Windows では入っている Edge を使う）
```

## やらないこと

- 課題管理・試験の実行・文書の編集画面（それぞれ既存の道具を使います）
- 品質の点数化・割合
- 外の道具（GitHub・GitLab・課題管理）との同期

## 一緒に使う道具

- [md-business](https://github.com/meta-taro/md-business) — 仕様と検証シート
- [git-qa](https://github.com/meta-taro/git-qa) — 試験の実施と証跡

## 次の段

- MCP の口を広げる（台帳やルールを書く道具はこれから。人の承認だけは口を作らない）
- 画面の TypeScript 化、資料の版と差分の画面、デスクトップアプリとして包む

## ライセンス

MIT

## 開発ルール

人と AI エージェントが一緒に開発します。ルールは [CLAUDE.md](CLAUDE.md) と
[`.claude/rules/product-baseline.md`](.claude/rules/product-baseline.md) にあります。
