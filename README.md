# tadori（辿り）

> ⚠ **MVP です。**架空の見本の案件で、判定（`check`・`why`）と手元で開く画面（`serve`）が動きます。
> 方向性は [PRD.md](PRD.md)、決めたことと理由は [docs/decisions.md](docs/decisions.md) にあります。

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

commit の前に型の検査・テスト・置き場所の検査を走らせるには（このリポジトリで 1 回だけ）:

```bash
git config core.hooksPath .githooks
```

環境変数・秘密情報は要りません（`.env` は使いません）。

## するもの

| コマンド | 出すもの |
|---|---|
| `tadori check [案件]` | 工程ごとの漏れと人の承認待ち。漏れがあれば終了コード 1（CI でも使える）。`--log` でチェックの記録に 5W1H で足す |
| `tadori why <ID> [案件]` | その 1 件から上下に辿った全部と、線が切れている所 |
| `tadori serve [案件]` | 手元（127.0.0.1）で画面を開く。関門（タイムライン／カード）・WBS・ルールセット・チェックの記録・つながりを辿る・設定 |

```bash
node packages/cli/dist/main.js check examples/lend-v12
node packages/cli/dist/main.js why F-02 examples/lend-v12
node packages/cli/dist/main.js serve examples/lend-v12 --port 4870
```

画面で設定や WBS のステータスを変えると、TSV に書き戻します。案件のフォルダがそれ自身の git リポジトリなら commit します。
**push はしません。**各担当が自分のクローンで中身を確かめてから push してください。

## 案件のフォルダの置き方

台帳はすべて git 上の TSV です。tadori が無くても人が読めます。

```text
.tadori/project.tsv        案件の名前
.tadori/phases.tsv         工程の並び（企業・プロダクトごとに違う）
.tadori/statuses.tsv       WBS のステータスの設定
.tadori/rulesets/*.tsv     工程ごとのルールセット（判定は covered / refers / filled / approval）
.tadori/checks.tsv         チェックの記録（5W1H）
ledger/items.tsv           台帳（設計書の章・節、commit、観点、試験ケース、試験の記録、指摘、再発防止）
ledger/wbs.tsv             WBS の作業
ledger/approvals.tsv       人の承認の記録（人が書く）
```

見本は [examples/lend-v12](examples/lend-v12)（架空の「備品貸出アプリ 改修 v1.2」）です。
**実案件のデータはこのリポジトリに入れません。**実案件の台帳は、その案件のリポジトリに置きます。

## リポジトリの中身

```text
packages/core   判定の核（台帳を読み、漏れ・関門・1 件の辿りを出す）。実行時の依存なし
packages/cli    tadori コマンドと、手元のサーバー
packages/ui     画面（tadori serve がそのまま配る）
examples/       架空の見本の案件
```

```bash
pnpm verify       # 型の検査とテスト
```

## やらないこと

- 課題管理・試験の実行・文書の編集画面（それぞれ既存の道具を使います）
- 品質の点数化・割合
- 外の道具（GitHub・GitLab・課題管理）との同期

## 一緒に使う道具

- [md-business](https://github.com/meta-taro/md-business) — 仕様と検証シート
- [git-qa](https://github.com/meta-taro/git-qa) — 試験の実施と証跡

## 次の段

- MCP の口（画面でできることをエージェントからも。人の承認だけは口を作らない）
- 画面の TypeScript 化、資料の版と差分の画面、デスクトップアプリとして包む

## ライセンス

MIT

## 開発ルール

人と AI エージェントが一緒に開発します。ルールは [CLAUDE.md](CLAUDE.md) と
[`.claude/rules/product-baseline.md`](.claude/rules/product-baseline.md) にあります。
