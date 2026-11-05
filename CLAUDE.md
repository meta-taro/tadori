# tadori

> このリポジトリは、人と AI エージェント（Claude Code）が一緒に開発することを前提に構成されています。
> AI エージェントは以下を必ず守ってください。

## 必読

- **`.claude/rules/product-baseline.md`** — 開発のベースルール。**最優先で従うこと**。
- **`PRD.md`** — このプロダクトの方向性・仕様。
- **`.claude/roadmap.md`** — 段と進め方。**いまは MVP（手元で起動する）の確認と、その次の段**。
- **`.claude/decisions.md`** — 決定と、その理由（D1〜D9）。外の人向けの理由は `docs/decisions.md`。
- **`.claude/issues/`** — 着手すべきローカル Issue。

> 上の 3 つと `.claude/project-status.md` は**作業の記録なので git に入れません**（`.gitignore` の `/.claude/*`）。
> 手元の `.claude/` と、非公開の `oss-notes/tadori/` に同じものがあります。直したら両方へ反映すること。

## この製品に固有の禁止事項（最優先）

1. **実案件のデータをこのリポジトリに入れない。**仕様の文・試験ケース・指摘・証跡・
   画面名・顧客名・案件名のどれも。**見本は架空の案件で作る**（D3 / D7）。
   台帳は実案件の側のリポジトリに置く。`ledger.local/` と `*.local.tsv` は gitignore 済み。
2. **新しい正本を作らない。**検証シートは md-business、実施の証跡は git-qa の run.json が正本。
   tadori は読んでつなぐだけ（PRD §7）。同じ情報をもう 1 か所に書き写す列を足さない。
3. **列の形を机上で決めない。**実データを起こして 2 件目で崩れないことを確かめてから固める（PRD §5）。
4. **「漏れを埋めた」と判定しない。**tadori が出すのは漏れの一覧まで。
   「確かにそこが漏れていた」と認めるのは人（PRD §0）。MCP にも人の承認の口を作らない。
5. **点数・割合を作らない。**画面が出すのは漏れの中身と件数・承認待ち・ステータス・遅れた日数という事実だけ（PRD §6・`docs/decisions.md`）。

## 守ることの要点（詳細は product-baseline.md）

- **pnpm のみ使用**（npm / yarn 禁止）。
- 実装前に計画を立てる。小さい段で作業。**テストを後回しにしない／落ちるテストを消さない。**
- **commit は AI、push は人間。**人間の確認なしに push しない。
- 秘密情報（鍵・トークン）は **AI が作らない・置かない・貼らない。**
- 進捗は `.claude/project-status.md` に随時記録。**テストが無い状態で「完了」と書かない。**
- **public リポジトリです。**コード・文書・commit history に個人名・個人メールアドレスを
  残さないこと（`.github/workflows/oss-privacy-check.yml` が検出します）。

## いまやること — MVP の次

| # | 内容 |
|---|---|
| 1 | オーナーが手元で MVP を起動して確かめる（`pnpm install` → `pnpm dev`） |
| 2 | MCP の口とエージェントのパネル（専用カーソル・強調・指さして聞く） |
| 3 | 画面のテスト（Playwright）と TypeScript 化 |
| 4 | md-business・git-qa へ頼む：「動かない ID」2 つ（D4）・リンクで文書と版を開く入口・WBS の型 |

**止めどころ**: 2 案件分の指摘を起こして、人が「確かにそこが漏れていた」と言えたか（D5）。
言えなければ archive します。

## 進捗管理

- `.claude/project-status.md` … 現在の段・完了/未完了・次タスク・既知問題
- `.claude/decisions.md` … 技術的決定と、その理由

## 日課（AI エージェント向け）

### セッション開始時

1. `git pull --ff-only`
2. `gh issue list --state open` ＋ `gh issue list --state closed --limit 10`
   （**close 済 Issue にも後追いで指示や訂正が入ることがあるため、必ず両方見る**）
3. open Issue は全件 `gh issue view <番号> --json title,body,comments,author,createdAt --jq '.'` で本文＋コメントを確認
   （`--comments` は出力が空のまま exit 0 することがあり、「読んだが何も無かった」と区別できないため使わない）
4. 何を確認し、どれから着手するかを返す

### Issue への反応（着手前）

- 新規 Issue・新規コメントには、**着手前に最低 1 回反応する**（「読みました。〇〇から着手します。」）
- 「承知しました」だけを返さない。**できていないなら、できていないと認め、対策と日付を出す。**
  前提がおかしいと思うなら異議・代案を出す。

### セッション終了時

1. `.claude/project-status.md` に進捗を記録（テストが無い状態で「完了」と書かない）
2. 完了した Issue は `gh issue close <番号> --comment "..."`
