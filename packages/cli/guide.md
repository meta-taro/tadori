# tadori の使い方

tadori は、仕様の 1 文から試験ケース・実施の記録・指摘・再発防止までを ID でつなぐ、git 上の台帳です。
工程ごとのルールで「どこが漏れているか」を出します。**漏れを認めるのは人です。**
言葉の意味は道具 `glossary` で引けます（漏れ・完了判定・残課題・タスクなど）。

## start はじめ方

1. 案件のフォルダを 1 つ決めます。設計書や試験シートのある案件のリポジトリの中でも、外の別のフォルダでもかまいません。
   外の人に見せられない案件は、案件のリポジトリの外に置き、push 先の無い git にします。
2. tadori の設定と台帳を置きます。どちらか一方で：
   - デスクトップアプリ：「ファイル › 新しく始める…」でフォルダを選び、「始める」を押す
   - コマンド：`tadori init <フォルダ> --name <案件の名前>`
   すでにあるファイルは書き換えません。commit もしません。
3. 置かれるもの：
   - `.tadori/phases.tsv` 工程（叩き台は 設計・実装・試験・リリース。会社や案件に合わせて書き換える）
   - `.tadori/statuses.tsv` WBS のタスクのステータス
   - `.tadori/rulesets/*.tsv` 工程ごとのルール（最初は例がコメントで入っているだけ）
   - `ledger/items.tsv` 台帳（設計書の章・試験ケース・指摘などの行と、そのつながり）
   - `ledger/wbs.tsv` WBS のタスク
   - `ledger/approvals.tsv` 人の承認の記録
4. 工程 → WBS → 台帳 → ルールの順に書き（topic: ledger・rules）、`tadori check` で漏れを見ます（topic: check）。
   ルールが 1 つも無い工程は「ルールなし（まだ判定していません）」と出ます。通ったという意味ではありません。

## ledger 台帳の書き方

TSV（タブ区切り）です。`#` で始まる行はコメントとして読み飛ばします。値が無いセルは空のままにします（`—` や `N/A` で埋めない）。

`ledger/items.tsv` の列：
- `id` 行の ID。会議で口に出して言える短いものにする（例：DD-2.3・TC-07・F-02）。重複は止まります
- `kind` 行の種類（例：BD=基本設計の章、DD=詳細設計の節、TC=試験ケース、RUN=実施の記録、F=指摘）。読み方は `.tadori/kinds.tsv` に書けます
- `title` 名前
- `source` 原本の場所（例：`docs/detail-design.md §2.3`・`qa/test-spec.tsv`）。**中身は写さず、場所だけを書く**（正本を 2 つにしない）
- `refs` この行が元にしている行の ID。`、` か `,` で区切って複数書けます
- ほかの列はルールの `field`（filled）や `only` で使えます（例：`change` に 変わる／変わらない）。読み方は `.tadori/columns.tsv`

`ledger/wbs.tsv` の列：`id`（W で始める）・`phase`（工程の ID）・`name`・`start`・`end`（YYYY-MM-DD）・`status`（`.tadori/statuses.tsv` の ID）。
WBS のタスクは台帳の行（種類 `W`）としても辿れます。台帳へ書き写さないでください。

`ledger/approvals.tsv` の列：`rule`（approval のルールの ID）・`status`（`承認` か、差し戻しなど）・`who`・`when`。
**ここは承認した人が書きます。エージェントは書きません。**

つながりは台帳に書かれた ID だけで決まります。推測でつなぎません。

## rules ルールの書き方

`.tadori/rulesets/` の中の TSV（工程ごとに分けてよい）。列は `id phase kind from to field only owner label`。

`kind` は 4 種類：
- `covered` from の種類のどの行にも、それを元にした to の種類の行がある（例：観点 V ごとに試験ケース TC がある）
- `refers` from の種類のどの行も、to の種類の行を元にしている（例：どの基本設計の章 BD にも WBS のタスク W が紐づいている）
- `filled` from の種類のどの行にも、field の列の値が入っている（例：詳細設計の節 DD に change が書いてある）
- `approval` 人の承認が要る。tadori は `ledger/approvals.tsv` を見るだけで、代わりに承認しない

ほかの列：
- `only` 対象の行を `列名=値` で絞る（例：`change=変わる` の節だけ commit を求める）
- `owner` 漏れを直す担当（例：設計担当・検証担当）。画面と `list_leaks` に出ます
- `label` 人が読む一文（例：観点ごとに試験ケースがある）

例：
```
id	phase	kind	from	to	field	only	owner	label
R8	it	covered	V	TC			検証担当	観点ごとに試験ケースがある
R4	dd	filled	DD		change		設計担当	詳細設計の節に改修後の対応が書いてある
R2	bd	approval					レビュー担当	基本設計書をレビュー担当が承認した
```
台帳に無い ID を refs に書くと、組み込みのルール `ID` が漏れとして出します。

## check 確かめ方

- `tadori check <フォルダ>` 工程ごとの漏れと承認待ち。漏れがあれば終了コード 1（CI でも使える）
- `tadori check <フォルダ> --log --who <名前> --why <理由>` 結果をチェックの記録（`.tadori/checks.tsv`・5W1H）に足し、案件が git リポジトリなら commit します。push は人
- `tadori why <ID> <フォルダ>` 1 行から上下に辿り、線が切れている所を出す
- MCP の道具：`get_remaining`（残課題）・`list_leaks`（漏れと担当と直し方）・`trace`（辿る）・`find_items`（行を探す）

漏れごとに「担当」と「直し方（どのファイルの何行目の、どの列に何を書けば消えるか）」が出ます。
直したら、もう一度 check して、漏れが消えたことを確かめてください。

## screen 画面を見せながら案内する

人の画面（tadori のデスクトップアプリかブラウザ）を、**画面の中の専用カーソル**で操作して見せられます。人のマウスは使いません（奪いません）。
道具 `screen` に、次のどれかを渡します：
- `{ "action": "point", "target": "ルールセット", "message": "ここにルールがあります" }` 指して黄色の枠で示す
- `{ "action": "click", "target": "ルールセット" }` 押す
- `{ "action": "type", "target": "探す", "value": "DD-2.3" }` 欄に打つ
- `{ "action": "go", "hash": "#trace-F-02" }` 画面を移る（`#phases` `#rules` `#log` `#trace-<ID>` `#browse` `#settings` `#glossary`）
- `{ "action": "say", "message": "ここが漏れです" }` 一言だけ出す

`target` は画面に出ている文字・ボタンの名前で探します（ぴったり同じ名前を先に）。
押せるのは人が画面で押せるものだけです。Windows のダイアログ（フォルダ選びなど）は操作できないので、人に頼んでください。
デスクトップアプリは `http://127.0.0.1:4873`、別の番号で開いているときは MCP を `--screen http://127.0.0.1:<番号>` で起こします。

## links ほかの道具を開く

`.tadori/links.tsv`（列 `tool url`）に URL の雛形を書くと、漏れの横の md / qa のアイコンが押せるようになります。
差し込める値：`{path}`（案件のフォルダからの場所）・`{repopath}`（git リポジトリの最上位からの場所）・`{abspath}`・`{line}`・`{id}`。
例：`md-business	md-business://open?repo=github.com/<持ち主>/<リポジトリ>&path={repopath}&line={line}`
`javascript:` `data:` `file:` などの雛形は読み込みで止めます。

## agent-rules エージェントが守ること

- **漏れを埋めたと判定しない。** tadori が出すのは漏れの一覧まで。「確かにそこが漏れていた」「直った」と認めるのは人
- **承認しない。** `ledger/approvals.tsv` は承認した人が書く。MCP にも承認の口は無い
- **試験の結果欄を代わりに書かない。** 合否は実物を見た人が書く
- **割合や点数を作らない。** 伝えるのは漏れの中身と件数・承認待ち・ステータス・遅れた日数という事実だけ
- **台帳に原本の中身を写さない。** source には場所だけ。正本は原本の道具（md-business・git-qa など）にある
- **つながりを推測で足さない。** refs に書くのは、元にしたと分かっている行の ID だけ
- **commit まで。push は人が中身を確かめてから。**
- 人に画面を説明するときは `glossary` の言葉を使う（漏れ・完了判定・残課題・タスク・つながりを辿る）
