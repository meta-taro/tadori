// CLI・server・MCP の言葉の日本語の辞書（鍵は英語の文。{名前} は差し込む値）。
// 英語の文を変えたら、ここの鍵も同じに直す（直さないと、その文だけ英語で出る）
export const JA_CLI: Readonly<Record<string, string>> = {
  // ---- format.ts（tadori check・why） ----
  'Owner: {owner}  ': '担当：{owner}　',
  'How to fix: {fix}': '直し方：{fix}',
  '{name}  (as of {today})': '{name}  （{today} 時点）',
  'Gaps {count}': '漏れ {count}',
  'Pending approval {count} ({ids})': '承認待ち {count}（{ids}）',
  'Nothing left': '残りなし',
  'No rules (not checked yet)': 'ルールなし（まだ判定していません）',
  '  ← started before the {phase} phase gate': '  ← {phase}の完了判定より前に着手',
  '  {days} days late': '  {days} 日遅れ',
  '{rule} pending approval ({status})  How to fix: {fix}': '{rule} 承認待ち（{status}）　直し方：{fix}',
  '■ Gaps not in any phase': '■ どの工程にも属さない漏れ',
  'Gaps: {leaks} / Pending approval: {waits}': '漏れ {leaks} 件 / 承認待ち {waits} 件',
  '    ✗ No upstream {kind} ({rule})  ← broken here': '    ✗ 上流の{kind} が無い（{rule}）  ← ここで切れている',
  '    ✗ No {kind} ({rule})  ← broken here': '    ✗ {kind} が無い（{rule}）  ← ここで切れている',
  '{mark} {kind} {id}  {title}  ({source})': '{mark} {kind} {id}  {title}  （{source}）',
  '      Gap {rule}: {message}': '      漏れ {rule}：{message}',
  'synced {at}{who}': '反映 {at}{who}',
  'no sync record': '反映の記録なし',
  'Source of truth: {url} ({synced}{stale})': '正本：{url}（{synced}{stale}）',
  ', stale': '・古い',
  // ---- daily-format.ts（1 日の進行の既定の形。案件が設定した値は訳さない） ----
  'Today ({date}): {count}': '今日（{date}）{count} 件',
  'Next working day ({date})': '次の作業日（{date}）',
  'Questions': '相談',
  'Notes': '補足',
  'Today': '今日',
  'Next working day': '次の作業日',
  'Ledger upkeep': '台帳の整備',
  'Done': '済',
  'In progress': '作業中',
  'Planned': '予定',
  'Upkeep': '整備',
  'Checked': '確認',
  '[{tag}] ': '［{tag}］',
  '{who}: ': '{who}：',
  ' <{badge}>': '〈{badge}〉',
  'Sun': '日',
  'Mon': '月',
  'Tue': '火',
  'Wed': '水',
  'Thu': '木',
  'Fri': '金',
  'Sat': '土',
  ' ({list})': '（{list}）',
  'Issue {id}: {title} ({source})': '課題 {id}：{title}（{source}）',
  'Issue {id}': '課題 {id}',
  '{start}–{end}': '{start}〜{end}',
  '{wbs}: {name} ({detail})': '{wbs}：{name}（{detail}）',
  '{label}: {url}': '{label}：{url}',
  // ---- daily.ts（1 日の進行の入力の誤り・commit の文） ----
  'Draft daily progress ({date})': '1 日の進行の下書きを作った（{date}）',
  'Add a line to daily progress ({date})': '1 日の進行に行を足した（{date}）',
  'Edit daily progress line {id} ({date})': '1 日の進行の行 {id} を直した（{date}）',
  'Remove daily progress line {id} ({date})': '1 日の進行の行 {id} を消した（{date}）',
  '{key} is required': '{key} を書いてください',
  '{key} must be a string': '{key} は文字で渡してください',
  '{key} is too long (up to {max} characters)': '{key} が長すぎます（{max} 文字まで）',
  'section must be one of {list}': 'section は {list} のどれかにしてください',
  'tag must be one of {list} (empty for no tag)': 'tag は {list} のどれか（空なら印なし）にしてください',
  'links must be [{ "label": display name, "url": URL }]': 'links は [{ "label": 表示名, "url": URL }] の形で渡してください',
  'links can have up to {max} items': 'links は {max} 件までです',
  'badges must be [{ "text": text, "tone": none / wait / hole / ok }]': 'badges は [{ "text": 文字, "tone": none / wait / hole / ok }] の形で渡してください',
  'badges can have up to {max} items': 'badges は {max} 件までです',
  'badges item {no}: the text must be 1–{max} characters and must not contain "|"': 'badges の {no} 件目：文字は 1〜{max} 字で、「|」は使えません',
  'badges item {no}: tone must be one of {list}': 'badges の {no} 件目：tone は {list} のどれかです',
  'Badge text, up to 40 characters (e.g. late, waiting for review, due 11/12). You decide the value; tadori does not judge it': 'バッジの文字。40 字まで（例：遅延・確認待ち・期限 11/12）。中身はエージェントか人が決めます。tadori は値を判定しません',
  'Color meaning: none = plain / wait = waiting / hole = needs attention / ok = good (default none)': '色の意味：none＝ふつう / wait＝待ち / hole＝要注意 / ok＝よい（省くと none）',
  'Small badges for the line, shown apart from the text on the screen and after the text in the written daily progress. When editing, pass all of them again (an empty array clears them)': '行の小さな札。画面では本文とは別に色で出し、文では本文のうしろに出します。直すときは全部を渡し直します（空の配列で消えます）',
  'links item {no}: the display name must be 1–{max} characters and must not contain "|"': 'links の {no} 件目：表示名は 1〜{max} 文字で、「|」を含めないでください',
  'links item {no}: not a valid URL': 'links の {no} 件目：URL として読めません',
  'links item {no}: the URL must be http or https and must not contain spaces': 'links の {no} 件目：URL は http か https で、空白を含めないでください',
  'links item {no}: anchor must be up to {max} characters and must not contain "|" or " > "': 'links の {no} 件目：anchor は {max} 文字までで、「|」「 > 」を含めないでください',
  'links item {no}: nth must be an integer from 1 to {max}': 'links の {no} 件目：nth は 1〜{max} の整数で渡してください',
  'Link "{label}": the word "{anchor}" is not in the text (the screen shows "{label} ↗" at the end of the line instead)': 'リンク「{label}」の語「{anchor}」が本文に見つかりません（画面では行末に「{label} ↗」で出します）',
  'Link "{label}": occurrence {nth} of the word "{anchor}" is not in the text (the screen shows "{label} ↗" at the end of the line instead)': 'リンク「{label}」の語「{anchor}」の {nth} 回目が本文に見つかりません（画面では行末に「{label} ↗」で出します）',
  'Send a JSON object': 'JSON のオブジェクトで渡してください',
  'No line {id} on {date}': '{date} に行 {id} はありません',
  'text cannot be empty (use daily_remove to delete the whole line)': '本文は空にできません（行ごと消すなら daily_remove を使ってください）',
  // ---- agent.ts（画面の専用カーソルへの指示の誤り） ----
  '{key} must be non-empty text': '{key} を文字で書いてください',
  'Send the instruction as a JSON object': '指示は JSON のオブジェクトで送ってください',
  'Unknown action: {action} (available: {list})': '知らない動きです：{action}（使えるのは {list}）',
  "value must be a person's name as text (empty for everyone)": 'value は人の名前を文字で（空なら全員）',
  'hash must be a place on the screen starting with # (e.g. #rules)': 'hash は # で始まる画面の中の場所にしてください（例：#rules）',
  // ---- check-log.ts・update-check.ts・watch.ts ----
  'Add check records ({why})': 'チェックの記録を追加（{why}）',
  'GitHub returned {status}': 'GitHub が {status} を返しました',
  'Could not check for a new version ({reason}). Check your network connection': '新しい版があるか確かめられませんでした（{reason}）。ネットワークを確かめてください',
  'Could not check for a new version (the release version is unreadable)': '新しい版があるか確かめられませんでした（リリースの版が読めません）',
  'tadori serve: cannot watch the project folder (the screen reloads only when you return to it): {reason}': 'tadori serve: 案件のフォルダを見張れません（画面に戻ったときだけ読み直します）：{reason}',
  // ---- server.ts（画面へ返す誤り・commit の文） ----
  'The request body is too large': '送られた内容が大きすぎます',
  'Could not read it as JSON': 'JSON として読めませんでした',
  'This write did not come from the tadori screen': 'tadori の画面からの書き込みではありません',
  'Writes from other sites are not accepted': 'ほかのサイトからの書き込みは受けません',
  'Send it as JSON': 'JSON で送ってください',
  'Only calls from this machine (127.0.0.1) are accepted': '手元（127.0.0.1）以外からの呼び出しは受けません',
  'The URL is malformed': 'URL の書き方が正しくありません',
  'Send an array of phases': '工程の配列を送ってください',
  'Phase {no} has the wrong shape (id, name and order are required)': '{no} 番目の工程の形が違います（id・name・order が要ります）',
  'Send an array of statuses': 'ステータスの配列を送ってください',
  'Status {no} has the wrong shape (id, name and tone are required)': '{no} 番目のステータスの形が違います（id・name・tone が要ります）',
  'Not found': '見つかりません',
  'No tadori screen is open. Open the screen, then send again': 'tadori の画面が開いていません。画面を開いてから送ってください',
  'Give the date as YYYY-MM-DD': '日付は YYYY-MM-DD で渡してください',
  'No such operation': 'その操作はありません',
  'That ID is not in the ledger': 'その ID は台帳にありません',
  'Put the rule ID in the URL (to add one, POST to /api/rules)': 'ルールの ID を URL に書いてください（足すときは /api/rules に POST）',
  'Could not save the rule': 'ルールを保存できません',
  'Could not save the phase settings': '工程の設定を保存できません',
  'Change the phase settings': '工程の設定を変更',
  'Could not save the status settings': 'ステータスの設定を保存できません',
  'Change the status settings': 'ステータスの設定を変更',
  'That status is not in the settings': '設定に無いステータスです',
  'That task is not in the WBS': 'そのタスクは WBS にありません',
  'tadori serve: could not log the error: {reason}': 'tadori serve: 例外を記録に残せませんでした：{reason}',
  'Could not read the project': '案件を読めませんでした',
  'Something went wrong inside the server: {reason}': 'サーバーの中で問題が起きました：{reason}',
  // ---- mcp-write.ts（MCP の書く道具。説明はエージェントが読む） ----
  'Committed (a person pushes)': 'commit しました（push は人）',
  'No project is open. Open one with open_project': '開く案件が決まっていません。open_project で開いてください',
  '{done}. {commit}': '{done}。{commit}',
  'Nothing was written (the files are unchanged):\n- {problems}': '書きませんでした（ファイルは元のまま）：\n- {problems}',
  'Row ID': '行の ID',
  'Kind (e.g. DD, TC, RUN)': '種類（例：DD・TC・RUN）',
  'Name': '名前',
  'Where the original lives (do not copy its contents)': '原本の場所（中身は写さない）',
  'IDs of the rows this one is based on (only IDs in the ledger)': '元にしている行の ID（台帳にあるものだけ）',
  'Other columns (e.g. {"change":"yes"})': 'そのほかの列（例：{"change":"変わる"}）',
  'Task ID (starts with W)': '作業の ID（W で始める）',
  'Phase ID': '工程の ID',
  'Task name': '作業の名前',
  'Start date YYYY-MM-DD': '開始日 YYYY-MM-DD',
  'End date YYYY-MM-DD': '終了日 YYYY-MM-DD',
  'Status (one from the settings)': '状態（設定にあるもの）',
  'Owner (for two or more, "A・B")': '担当（2 人以上は「A・B」）',
  'Issue ID (a ledger row)': '課題の ID（台帳の行）',
  'Rule ID': 'ルールの ID',
  'covered, refers, filled, allowed or approval, or note (a written agreement that is not checked)': 'covered・refers・filled・allowed・approval か、note（判定しない、書くときの約束）',
  'Source kind': '元の種類',
  'Target kind': '先の種類',
  'Column that filled and allowed check': 'filled・allowed で見る列',
  'Narrow the targets with "column=value", "column=a|b" (any of them) or "column!=value"': '対象を絞る「列名=値」「列名=値1|値2」（どれか）「列名!=値」',
  'For allowed: the values the column may hold, separated by | (e.g. OK|NG)': 'allowed で、列に書いてよい値を | で区切る（例：OK|NG）',
  'Owner who fixes it (a role)': '直す担当（役割）',
  'One sentence for people to read': '人が読む一文',
  'Add a row to the ledger (ledger/items.tsv). refs may only use IDs already in the ledger (never link by guessing). Put only the location of the original in source; do not copy its contents.':
    '台帳（ledger/items.tsv）に行を足す。refs は台帳にある ID だけ（推測でつながない）。source には原本の場所だけを書き、中身を写さない。',
  'Added {id} to the ledger': '台帳に {id} を足しました',
  'Edit a ledger row (only the fields you pass change). If you checked the source of truth and brought the row up to date, set synced_by to your name (or the name of the person who asked). The tool fills in the date and time.':
    '台帳の行を直す（渡した項目だけ変わる）。正本を見て手元へ反映したなら synced_by に自分（または頼んだ人）の名前を付ける。日時は道具が入れる。',
  'Who synced it from the source of truth (writes the current date and time and this name into the synced_at and synced_by columns)':
    '正本から反映した人（付けると synced_at・synced_by 列に、いまの日時とこの名前を書く）',
  'Edited {id} in the ledger': '台帳の {id} を直しました',
  'Call this after comparing a ledger row with the source of truth and confirming the local row matches it (the contents do not change). Writes the current date and time into synced_at and who into synced_by. On the screen, rows with an old sync stand out.':
    '台帳の行を正本と見比べて、手元がいまの正本どおりだと確かめたときに呼ぶ（中身は変えない）。synced_at にいまの日時、synced_by に who を書く。画面では、反映が古い行が目立つ。',
  'Who checked it (an agent uses its own name)': '確かめた人（エージェントなら自分の名前）',
  'who (the person who checked) is required': 'who（確かめた人）が要ります',
  'Recorded that {id} in the ledger was synced from the source of truth': '台帳の {id} に、正本から反映した記録を付けました',
  "Remove a ledger row. A row that other rows' refs or a WBS issue point to is not removed (that would break the links).":
    '台帳の行を消す。ほかの行の refs や WBS の issue が指している行は消さない（つながりが切れるため）。',
  'Removed {id} from the ledger': '台帳の {id} を消しました',
  'Add a task to the WBS (ledger/wbs.tsv).': 'WBS（ledger/wbs.tsv）に作業を足す。',
  'Added {id} to the WBS': 'WBS に {id} を足しました',
  'Edit the status, dates, owner, issue and so on of a WBS task (it commits right away, so the "day the status changed" in daily progress stays correct).':
    'WBS の作業の状態・日付・担当・課題などを直す（その場で commit するので、1 日の進行の「状態が変わった日」がずれない）。',
  'Edited {id} in the WBS': 'WBS の {id} を直しました',
  'Add a rule (.tadori/rulesets/rules.tsv). The check kinds are covered, refers, filled, allowed and approval. A note rule is a written agreement (how to write a briefing, a promise between people and agents) that is read, not checked; it needs no phase.': 'ルールを足す（.tadori/rulesets/rules.tsv）。判定は covered・refers・filled・allowed・approval。note は判定しない、書くときの約束（カンペの書き方・人とエージェントの間の約束など）で、読むだけ。工程は要らない。',
  'Added rule {id}': 'ルール {id} を足しました',
  'Edit a rule (in the file it is written in).': 'ルールを直す（書かれているファイルのまま）。',
  'Edited rule {id}': 'ルール {id} を直しました',
  'Remove a rule.': 'ルールを消す。',
  'Removed rule {id}': 'ルール {id} を消しました',
  "Add or edit a person in the people table (.tadori/members.tsv). roles are the person's roles (written the same way as a rule's owner); git is their git author name.":
    '人の表（.tadori/members.tsv）に人を足すか直す。roles はその人の役割（ルールの担当と同じ書き方）、git は git の作者名。',
  "The person's name (written the same way as a WBS owner)": '人の名前（WBS の担当と同じ書き方）',
  'git author name': 'git の作者名',
  'Edited {name} in the people table': '人の表の {name} を直しました',
  'Remove a person from the people table.': '人の表から人を消す。',
  "The person's name": '人の名前',
  'Removed {name} from the people table': '人の表から {name} を消しました',
  'Add a phase, or edit its name or order (.tadori/phases.tsv). A phase that is in use cannot be removed.': '工程を足すか、名前・順番を直す（.tadori/phases.tsv）。使われている工程は消せない。',
  'Phase ID (letters and digits)': '工程の ID（英数字）',
  'Phase name': '工程の名前',
  'Order (smaller comes first)': '並び（小さいほど前）',
  'Edited phase {id}': '工程 {id} を直しました',
  'Edit phase {id}': '工程 {id} を直した',
  'Run check. With log, add the results to the check records (.tadori/checks.tsv, 5W1H) and commit. who is the person who checked (an agent uses its own name); why is the reason.':
    'check を回す。log を付けると、チェックの記録（.tadori/checks.tsv・5W1H）に足して commit する。who は確かめた人（エージェントなら自分の名前）、why は理由。',
  'Who checked': '確かめた人',
  'Reason (e.g. before the evening meeting)': '理由（例：夕会の前）',
  'Added the check records. {commit}': 'チェックの記録を足しました。{commit}',
  "List the project open now and the desktop app's recent projects.": 'いま開いている案件と、デスクトップアプリの最近の案件を並べる。',
  ' (open now)': '（いま開いている）',
  'No projects. Open one with open_project': '案件がありません。open_project で開いてください',
  'Switch the project this MCP server works on (a folder that has .tadori). Later tools read and write that project.': 'この MCP の口で扱う案件を替える（.tadori のあるフォルダ）。以後の道具はその案件を読み書きする。',
  'Project folder': '案件のフォルダ',
  '{dir} has no .tadori. To start a new project, use tadori init': '{dir} には .tadori がありません。新しく始めるなら tadori init で',
  'Opened {dir}': '{dir} を開きました',
  // ---- mcp.ts（MCP の読む道具・1 日の進行・画面・用語・例外。説明はエージェントが読む） ----
  'Start with a project folder (e.g. tadori mcp examples/lend-v12)': '案件のフォルダを指定して起動してください（例：tadori mcp examples/lend-v12）',
  'No term matches "{query}". Leave query empty to get every term.': '「{query}」に合う言葉がありません。query を空にすると、全部の言葉を返します。',
  '- **{term}**: {meaning}': '- **{term}**：{meaning}',
  ' (screen: {where})': '（画面：{where}）',
  '  e.g. {example}': '　例：{example}',
  'Return the remaining work per phase (gaps and pending human approvals), days late, and whether work started before the previous phase gate. Same content as the screen\'s "Remaining work until release". No percentages or scores.':
    '工程ごとの残課題（漏れと人の承認待ち）・遅れた日数・前の完了判定より前に着手しているかを返す。画面の「リリースまでの残課題」と同じ中身。割合や点数は出さない。',
  'Return the list of gaps (places where a link or column a rule requires is missing). Pass a phase ID (e.g. dd) as phase to get only the gaps of that phase\'s rules.':
    '漏れ（ルールが求めるつながりや列が無い所）の一覧を返す。phase に工程の ID（例：dd）を渡すと、その工程のルールの漏れだけにする。',
  'Phase ID (e.g. bd, dd, it). Empty for all': '工程の ID（例：bd・dd・it）。空なら全部',
  'No gaps': '漏れはありません',
  'Follow the upstream and downstream links from one ledger row (a finding, a test case, a design section, etc.) and return where they break (✗). Links are judged only by ledger IDs, never by guessing. Only a person can confirm "yes, that was a gap", so show the result to a person and let them judge.':
    '台帳の 1 行（指摘・試験ケース・設計書の章など）から上流と下流のつながりを辿り、切れている所（✗）を返す。つながりは台帳の ID だけで判定し、推測でつながない。「確かにそこが漏れていた」と認めるのは人なので、結果は人に見せて判断してもらうこと。',
  'ID of the row to start from (e.g. F-02)': '辿り始めの行の ID（例：F-02）',
  '{id} is not in the ledger. Search with find_items': '{id} は台帳にありません。find_items で探してください',
  'Search ledger rows by ID or name (separate words with spaces to require all of them). Use it to find an ID to pass to trace.':
    '台帳の行を ID か名前で探す（空白で区切ると、全部を含むもの）。trace に渡す ID を見つけるのに使う。',
  'Words to search for (e.g. overdue, TC-07)': '探す言葉（例：延滞、TC-07）',
  'No row matches "{query}"': '「{query}」に合う行がありません',
  '- {id} ({kind}) {title}': '- {id}（{kind}）{title}',
  '{count} more. Add words to narrow it down': 'ほか {count} 件。言葉を足して絞ってください',
  'today = Today / next = Next working day / consult = Questions / upkeep = Ledger upkeep (not work on deliverables)':
    'today＝今日 / next＝次の作業日 / consult＝相談 / upkeep＝台帳の整備（成果物の作業ではないもの）',
  'Date (YYYY-MM-DD). Empty for today': '日付（YYYY-MM-DD）。空なら今日',
  'Text (without the number or the trailing WBS. Put places and URLs in the notes)': '本文（番号と末尾の WBS は付けない。場所や URL は補足へ）',
  'IDs of the related WBS tasks (e.g. W-03)': 'つながる WBS の ID（例：W-03）',
  'Display name (e.g. QA sheet, MR, design doc 3.2.5)': '表示名（例：QA表・MR・設計書 3.2.5）',
  'An http or https URL': 'http か https の URL',
  'A word in the text. The screen turns that word into the link (not shown at the end of the line). If the word is not in the text, it shows "display name ↗" at the end of the line':
    '本文の中の語。画面ではその語をリンクにする（行末には出さない）。本文に無ければ行末に「表示名 ↗」で出す',
  'Which occurrence, when the same word appears more than once (default 1)': '同じ語が何回も出るとき、何回目か（既定 1）',
  'The places in the source of truth touched by this work. The screen shows "display name ↗" at the end of the line and opens it on click. Not included in the text read aloud; shown in the notes. When editing, pass all of them again':
    'その作業でさわった正本の場所。画面では行の末尾に「表示名 ↗」で出て押すと開く。読み上げる文には入れず、補足に出す。直すときは全件を渡し直す',
  'A short remark to add to the notes (read when asked)': '補足に足す一言（聞かれたら読むもの）',
  'Line tag: done = finished / doing = in progress / plan = planned / upkeep = ledger upkeep / checked = checked (empty for no tag)':
    '行の印：done＝やり終えた / doing＝作業中 / plan＝予定 / upkeep＝台帳の整備 / checked＝確かめた（空なら印なし）',
  'Give date as YYYY-MM-DD': 'date は YYYY-MM-DD で渡してください',
  'Note: {warning}': '注意：{warning}',
  'Return a person\'s "daily progress" (Today, Next working day, Questions, Notes) and the list of lines (with [ID]). Pass an owner as who to get only that person\'s lines. It combines a draft built from the inputs (WBS status changes, ledger diffs, check records) with lines that people or agents edited. To edit the text or write a question, use daily_update / daily_add.':
    '人単位の「1 日の進行」を返す（今日・次の作業日・相談・補足）と、行の一覧（[ID] 付き）。who に担当を渡すと、その人の分だけ。材料（WBS の状態の変化・台帳の差分・チェックの記録）から作った下書きと、人やエージェントが直した行を合わせたもの。文を直す・相談を書くのは daily_update / daily_add で。',
  'Owner. Empty for everyone': '担当。空なら全員',
  'no owner': '担当なし',
  ' (added line)': '（足した行）',
  ' (edited line)': '（直した行）',
  'saved in the file': 'ファイルに置いてある',
  'a draft not saved yet; save it with daily_generate': 'まだ置いていない下書き。daily_generate で置く',
  '{text}\n\nLines ({where}):\n{rows}': '{text}\n\n行の一覧（{where}）：\n{rows}',
  'Build a draft from the inputs, save it to the per-day file (.tadori/daily/YYYY-MM-DD.tsv) and commit. Rebuilding never overwrites edited, added or removed lines.':
    '材料から下書きを作り、日ごとのファイル（.tadori/daily/YYYY-MM-DD.tsv）に置いて commit する。作り直しても、直した行・足した行・消した行は上書きしない。',
  'Saved the draft for {date}. {commit}': '{date} の下書きを置きました。{commit}',
  'Add a line to daily progress (a question, or work that does not show up in the inputs). Added lines stay when the draft is rebuilt.':
    '1 日の進行に行を足す（相談や、材料に出ない作業）。足した行は作り直しても残る。',
  'Added [{id}]. {commit}': '[{id}] を足しました。{commit}',
  'Edit a daily progress line (id is the [ID] from daily). Only the fields you pass change. Passing an empty string (an empty array for links, badges and wbs) clears that field (the text cannot be cleared; use daily_remove to delete the line). An automatic line becomes an "edited line" and is not overwritten when the draft is rebuilt.':
    '1 日の進行の行を直す（id は daily の [ID]）。渡した項目だけ変わる。空文字（links・badges・wbs は空の配列）を渡すと、その欄を空にする（本文は空にできない。行ごと消すなら daily_remove）。自動の行は「直した行」になり、作り直しても上書きされない。',
  'Edited [{id}]. {commit}': '[{id}] を直しました。{commit}',
  'Remove a daily progress line (id is the [ID] from daily). An automatic line does not come back when the draft is rebuilt.':
    '1 日の進行の行を消す（id は daily の [ID]）。自動の行は、作り直しても戻ってこない。',
  'Removed [{id}]. {commit}': '[{id}] を消しました。{commit}',
  'The how-to document was not found (no guidePath was given)': '使い方の文書が見つかりません（guidePath が渡されていません）',
  'tadori is not running ({url}). Open the desktop app or start it with tadori serve': 'tadori が立ち上がっていません（{url}）。デスクトップアプリを開くか、tadori serve で立ち上げてください',
  'Could not reach the screen ({status})': '画面へ届けられませんでした（{status}）',
  'Delivered to {count} screen(s). The dedicated cursor moves on the person\'s screen': '画面（{count} つ）へ届けました。人の画面で、専用カーソルが動きます',
  'Return how to use tadori (getting started, writing the ledger and rules, checking, guiding a person on the screen, what agents must follow). Leave topic empty for the list of topics. When you first use tadori, read start and agent-rules.':
    'tadori の使い方を返す（はじめ方・台帳とルールの書き方・確かめ方・画面の案内の仕方・エージェントが守ること）。topic を空にすると話題の一覧。初めて使うときは start と agent-rules を読むこと。',
  'Topic (start, ledger, rules, check, daily, write, screen, links, sources, agent-rules). Empty for the list': '話題（start・ledger・rules・check・daily・write・screen・links・sources・agent-rules）。空なら一覧',
  'Show things to a person by operating the tadori screen they have open with a dedicated on-screen cursor (the person\'s mouse is not used). action is point, click, type (into a field), go (move to another view), say (a short remark) or filter (filter the screen by person: a name in value, empty for everyone). See how_to screen. You can only press what a person could press on the screen. Windows dialogs cannot be operated, so ask the person.':
    '人が開いている tadori の画面を、画面の中の専用カーソルで操作して見せる（人のマウスは使わない）。action は point（指す）・click（押す）・type（欄に打つ）・go（画面を移る）・say（一言）・filter（画面を人で絞る。value に人の名前、空なら全員）。使い方は how_to の screen。押せるのは人が画面で押せるものだけ。Windows のダイアログは操作できないので人に頼むこと。',
  'Text or button name shown on the screen (e.g. Rulesets, File, Search)': '画面に出ている文字・ボタンの名前（例：ルールセット・ファイル・探す）',
  'Text to type for type. For filter, a person\'s name (empty for everyone)': 'type で打つ文字。filter では人の名前（空なら全員）',
  'Where go moves to (e.g. #rules, #trace-F-02)': 'go の移り先（例：#rules・#trace-F-02）',
  'A short remark to show the person (shown on a yellow note)': '人に見せる一言（黄色の札に出る）',
  'Return the meaning of the words used on the tadori screen and in its documents (phase, phase gate, remaining work, task, gap, pending approval, link, etc.) and where they appear on the screen. Use these words when you explain the screen to a person. Leave query empty to get every term.':
    'tadori の画面と文書で使う言葉（工程・完了判定・残課題・タスク・漏れ・承認待ち・つながりなど）の意味と、画面のどこに出るかを返す。人に画面を説明するときは、ここの言葉を使うこと。query を空にすると全部の言葉を返す。',
  'Words to search for (separate with spaces to require all). e.g. gap, task late': '探す言葉（空白で区切ると、全部を含むものだけ）。例：漏れ、タスク 遅れ',
  'Return, newest first, the errors raised inside tadori serve behind the screen (the ones the screen showed as "Something went wrong inside the server"). Only the time, API, error type and message, and where it failed (the top lines of the call stack) are kept; request bodies are not. Show the result to a person before fixing anything.':
    '画面の裏で動いている tadori serve の中で起きた例外（画面に「サーバーの中で問題が起きました」と出たもの）を、新しい順に返す。時刻・API・例外の種類と文・落ちた所（呼び出しの頭の数行）だけで、送られた本文は残していない。直すときは、この結果を人に見せてから。',
  'How many (default 10, max 50)': '何件まで（既定 10・最大 50）',
  'No server errors recorded (log location: {dir})': 'server の例外の記録はありません（記録の場所：{dir}）',
  '- {at} {method} {path} (project: {project})': '- {at} {method} {path}（案件：{project}）',
  '{count} server errors (newest first, log location: {dir})': 'server の例外 {count} 件（新しい順・記録の場所：{dir}）',
  'Unknown tool: {name}': '知らない道具です：{name}',
  '{tool} failed: {reason}': '{tool} に失敗しました：{reason}',
  'Unknown method: {method}': '知らないメソッドです：{method}',
  // ---- main.ts（CLI の使い方と出力） ----
  [`Usage:
  tadori init [project folder] [--name project name]
  tadori check [project folder] [--log --who name --why reason] [--today YYYY-MM-DD]
  tadori why <ID> [project folder]
  tadori serve [project folder] [--port {port}] [--today YYYY-MM-DD]
  tadori daily [project folder] [--who owner] [--date YYYY-MM-DD]
  tadori how-to [topic]
  tadori mcp [project folder] [--screen http://127.0.0.1:4873]

  init   Put the minimum settings (.tadori/) and ledger (ledger/) into a project folder to try. Existing files are not changed
  check  Show the gaps and pending approvals per phase. Exit code 1 if there are gaps (works in CI too)
         With --log, add the results to the check records (.tadori/checks.tsv) as 5W1H
  why    Follow links up and down from one row and show where they break
  serve  Start the screen on this machine (127.0.0.1)
  daily  Daily progress per person (Today, Next working day, Questions, Notes). --who filters by owner
  how-to Show how to use tadori (same content as MCP how_to). Topics: start, ledger, rules, check, daily, write, screen, links, sources, agent-rules
  mcp    Open the MCP server on standard input/output (how-to, glossary, remaining work, gaps, links, ledger search, the dedicated screen cursor)
         --screen is where the screen operated by the dedicated cursor lives (default: the desktop app at http://127.0.0.1:4873)

  --lang en|ja  Language of messages (default: TADORI_LANG, then the OS language)`]: `使い方:
  tadori init [案件のフォルダ] [--name 案件の名前]
  tadori check [案件のフォルダ] [--log --who 名前 --why 理由] [--today YYYY-MM-DD]
  tadori why <ID> [案件のフォルダ]
  tadori serve [案件のフォルダ] [--port {port}] [--today YYYY-MM-DD]
  tadori daily [案件のフォルダ] [--who 担当] [--date YYYY-MM-DD]
  tadori how-to [話題]
  tadori mcp [案件のフォルダ] [--screen http://127.0.0.1:4873]

  init   試す案件のフォルダに、最小の設定（.tadori/）と台帳（ledger/）を置く。あるファイルは書き換えない
  check  工程ごとの漏れと承認待ちを出す。漏れがあれば終了コード 1（CI でも使える）
         --log を付けると、チェックの記録（.tadori/checks.tsv）に 5W1H で足す
  why    1 件から上下に辿り、線が切れている所を出す
  serve  手元（127.0.0.1）で画面を立ち上げる
  daily  人単位の 1 日の進行（今日・次の作業日・相談・補足）。--who で担当を絞る
  how-to 使い方を出す（MCP の how_to と同じ中身）。話題：start・ledger・rules・check・daily・write・screen・links・sources・agent-rules
  mcp    MCP の口を標準入出力で開く（使い方・用語・残課題・漏れ・つながり・台帳の行を探す・画面の専用カーソル）
         --screen は専用カーソルで操作する画面の場所（既定はデスクトップアプリの http://127.0.0.1:4873）

  --lang en|ja  言葉の言語（既定は TADORI_LANG、無ければ OS の言語）`,
  '--lang must be en or ja: {value}': '--lang は en か ja にしてください：{value}',
  'Write --today as YYYY-MM-DD: {value}': '--today は YYYY-MM-DD で書いてください：{value}',
  '  created          {path}': '  置いた　　　　　{path}',
  '  exists, untouched {path}': '  あるので触らない　{path}',
  'Next steps:\n  1. Rewrite the phases in .tadori/phases.tsv to fit this project\n  2. Write rules in .tadori/rulesets/ (no gaps are reported until there are rules)\n  3. Write ledger rows and the WBS in ledger/, then open the screen with tadori serve {dir}\nNothing was committed. Check the contents, then commit':
    '次にすること：\n  1. .tadori/phases.tsv の工程を、この案件に合わせて書き換える\n  2. .tadori/rulesets/ にルールを書く（ルールが無いうちは、漏れは出ません）\n  3. ledger/ に台帳の行と WBS を書き、tadori serve {dir} で画面を開く\ncommit はしていません。中身を確かめてから commit してください',
  ' (no push destination is set)': '（push 先が設定されていません）',
  ' ({count} commits not pushed yet. Check the contents, then push)': '（push していない commit が {count} 件。中身を確かめてから push してください）',
  'Added the check records and committed{note}': 'チェックの記録を足して commit しました{note}',
  'Added the check records ({reason})': 'チェックの記録を足しました（{reason}）',
  'Give the ID to follow (e.g. tadori why F-02)': '辿る ID を指定してください（例：tadori why F-02）',
  '{id} is not in the ledger': '{id} は台帳にありません',
  '--port is not valid: {value}': '--port が正しくありません：{value}',
  'Checking for new versions is turned off (TADORI_UPDATE_CHECK=off)': '新しい版の確認は切ってあります（TADORI_UPDATE_CHECK=off）',
  'tadori started: {url}\nProject: {dir}\nPress Ctrl+C to stop': 'tadori を立ち上げました：{url}\n案件：{dir}\n止めるときは Ctrl+C',
  'Write --date as YYYY-MM-DD: {value}': '--date は YYYY-MM-DD で書いてください：{value}',
  'Unknown command: {command}': '知らないコマンドです：{command}',
  'Category ID from .tadori/rule-groups.tsv (empty to remove)': '分類の ID（.tadori/rule-groups.tsv の id。空で外す）',
  'Return the rules: the checked rules per phase, and the written agreements (kind note) that are read, not checked. Pass a category ID as group to get only that category (an empty string returns rules without a category). Read the agreements before writing, and follow them.': 'ルールを返す。工程ごとの判定のルールと、判定しない書くときの約束（種類 note）。group に分類の ID を渡すと、その分類だけ（空文字なら分類の無いルール）。書く前に約束を読んで、それに従うこと。',
  'Category ID from .tadori/rule-groups.tsv. Omit for all; an empty string for rules without a category': '分類の ID（.tadori/rule-groups.tsv）。省くと全部、空文字なら分類の無いルール',
  'Only this kind (e.g. note). Omit for all': 'この種類だけ（例：note）。省くと全部',
  'No category': '分類なし',
  '{name} · local': '{name}・ローカル',
  'No matching rules': '合うルールがありません',
  '- {id} [{group}] {kind}{phase}: {label}': '- {id}［{group}］{kind}{phase}：{label}',
  '{file} changed after approval: {commit} {date}': '承認のあとに {file} が変わった：{commit} {date}',
  '■ WBS statuses not in .tadori/statuses.tsv (counted as started and not done)': '■ .tadori/statuses.tsv に無い WBS の状態（「始まっていて、終わっていない」として数えています）',
  '"{status}": {ids}': '「{status}」：{ids}',
  'How to fix: add the status to .tadori/statuses.tsv (the 1st row means not started yet, tone ok means done), or write a status that is there in ledger/wbs.tsv': '直し方：.tadori/statuses.tsv にその状態を足す（1 行目は「まだ始めていない」、tone が ok は「終わった」）か、ledger/wbs.tsv にその表にある状態を書く',
  'Built from commit {commit} at {builtAt}': '組んだ commit：{commit}（{builtAt}）',
  'The commit it was built from is not known (no build-info.json)': '組んだ commit は分かりません（build-info.json がありません）',
  'The source changed after this was built. Run pnpm build, then reconnect the MCP (/mcp) to use the new code': '組んだあとに元のコードが変わっています。新しいコードを使うには pnpm build してから MCP をつなぎ直してください（/mcp）',
  'Return the version of this tadori MCP, the commit it was built from and when, and whether it needs rebuilding. Use it to tell whether a fix is in the MCP you are talking to.': 'この tadori の MCP の版・組んだ commit と日時・組み直しが要るかを返す。いま話している MCP に直しが入っているかを見分けるのに使う。',
  'seconds must be a number from {min} to {max}': 'seconds は {min}〜{max} の数にしてください',
  'How many seconds to keep the remark on the screen (1–60). Leave it out and the screen decides from the length (at least 5 seconds, longer for long remarks)': '一言を画面に出しておく秒数（1〜60）。省くと画面が文の長さで決める（最低 5 秒・長い文ほど長く）',
}
