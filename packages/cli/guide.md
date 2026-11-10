# How to use tadori

tadori is a ledger in git that links one sentence of a spec, through test cases and test run records, to findings and the measures that stop them from recurring, all by ID.
Rules for each phase show "where the gaps are". **Only a person can confirm a gap.**
Look up the meaning of a word with the `glossary` tool (gap, phase gate, remaining work, task and so on).

## start Getting started

1. Pick one folder for the project. It can be inside the project's repository (where the design documents and test sheets live) or a separate folder outside it.
   For a project you cannot show to outsiders, keep it outside the project's repository and use a git repository with no push target.
2. Put tadori's settings and the ledger in place. Either:
   - Desktop app: "File › Start new…", choose the folder, and press "Start"
   - Command: `tadori init <folder> --name <project name>`
   Existing files are not overwritten. Nothing is committed.
3. What gets created:
   - `.tadori/phases.tsv` phases (the starting draft is design, implementation, test, release; rewrite them to fit your company or project)
   - `.tadori/statuses.tsv` statuses of WBS tasks
   - `.tadori/rulesets/*.tsv` rules for each phase (at first only examples, as comments)
   - `ledger/items.tsv` the ledger (rows for design document chapters, test cases, findings and so on, and how they link)
   - `ledger/wbs.tsv` WBS tasks
   - `ledger/approvals.tsv` the record of approvals by people
4. To use tadori from an agent, register it with MCP:
   `claude mcp add tadori -- node <tadori>/packages/cli/dist/main.js mcp <project folder>`
   **After registering, restart Claude Code.** A session that is already running does not get the tools (they do not show in `/mcp` either).
   Until MCP is available, you can read the same guide with `tadori how-to [topic]`.
5. Write phases → WBS → ledger → rules in that order (topic: ledger, rules), then see the gaps with `tadori check` (topic: check).
   A phase with no rules shows as "No rules (not checked yet)". That does not mean it passed.

## ledger Writing the ledger

The files are TSV (tab-separated). Lines starting with `#` are comments and are skipped. Leave a cell empty when it has no value (do not fill it with `—` or `N/A`).

Columns of `ledger/items.tsv`:
- `id` the row's ID. Keep it short enough to say out loud in a meeting (e.g. DD-2.3, TC-07, F-02). Duplicates are rejected
- `kind` the kind of row (e.g. BD = basic design chapter, DD = detailed design section, TC = test case, RUN = test run record, F = finding). You can write how to read them in `.tadori/kinds.tsv`
- `title` the name
- `source` where the original is (e.g. `docs/detail-design.md §2.3`, `qa/test-spec.tsv`). **Write only the location, not the content** (do not create a second source of truth)
- `refs` IDs of the rows this row is based on. Separate several with `、` or `,`
- Other columns can be used by a rule's `field` (filled) or `only` (e.g. `change` with changes / no change). Write how to read them in `.tadori/columns.tsv`

Columns of `ledger/wbs.tsv`: `id` (starts with W), `phase` (phase ID), `name`, `start`, `end` (YYYY-MM-DD), `status` (an ID from `.tadori/statuses.tsv`).
Optional columns: `owner` and `issue` (the ID of the issue this work is for). They are used for each person's daily progress (topic: daily).
WBS tasks can also be traced as ledger rows (kind `W`). Do not copy them into the ledger.

**md-business verification sheets are read directly.** List them in `.tadori/sheets.tsv` (columns `path kind id title refs`) and each row of the sheet becomes a ledger row, without copying:
- `path` the sheet inside the project folder (a file whose first line is `#! md-business:test-spec-tsv/v1`)
- `kind` the ledger kind of its rows (e.g. `TC`)
- `id` `title` `refs` the names of the sheet's columns to use as the row ID, the name and the IDs it is based on (e.g. `Case ID`, `Item`, `Spec`). A row with no ID uses md-business's row ID (`r` + 12 hex digits)
- The other columns can be used by rules like any ledger column. Rows hidden in md-business are not read
- tadori never writes to the sheet. `item_update` / `item_remove` refuse these rows; change them in md-business

Columns of `ledger/approvals.tsv`: `rule` (the ID of an approval rule), `status` (`承認` (approved), or sent back and so on), `who`, `when`.
**This file is written by the person who approved. Agents do not write it.**

Links are decided only by the IDs written in the ledger. Nothing is linked by guessing.

## rules Writing rules

TSV files in `.tadori/rulesets/` (you may split them by phase). The columns are `id phase kind from to field only values owner label` (`values` can be left out when no rule uses it).

There are 5 values for `kind`:
- `covered` every row of the from kind has a row of the to kind based on it (e.g. every viewpoint V has a test case TC)
- `refers` every row of the from kind is based on a row of the to kind (e.g. every basic design chapter BD is tied to a WBS task W)
- `filled` every row of the from kind has a value in the field column (e.g. every detailed design section DD has change written)
- `allowed` every row of the from kind holds one of `values` in the field column (`a|b`, e.g. a test run RUN has `OK|NG` as its result). Empty cells are left to `filled`
- `approval` needs approval by a person. tadori only reads `ledger/approvals.tsv` and never approves on anyone's behalf

Other columns:
- `only` narrows the target rows by `column=value` (e.g. require a commit only for sections with `change=変わる` (changes)). `column=a|b` matches any of them, `column!=value` (or `column!=a|b`) matches the other rows
- `owner` who fixes the gap (e.g. design owner, verification owner). Shown on the screen and in `list_leaks`
- `label` one sentence for people to read (e.g. every viewpoint has a test case)

Example:
```
id	phase	kind	from	to	field	only	owner	label
R8	it	covered	V	TC			Verification owner	Every viewpoint has a test case
R4	dd	filled	DD		change		Design owner	Each detailed design section states what changes after the update
R2	bd	approval					Review owner	The review owner approved the basic design document
```
If refs contains an ID that is not in the ledger, the built-in rule `ID` reports it as a gap.

## check Checking

- `tadori check <folder>` gaps and pending approvals for each phase. Exit code 1 if there is a gap (works in CI too)
- `tadori check <folder> --log --who <name> --why <reason>` adds the result to the check log (`.tadori/checks.tsv`, 5W1H) and commits if the project is a git repository. A person pushes
- `tadori why <ID> <folder>` traces up and down from one row and shows where the line is broken
- MCP tools: `get_remaining` (remaining work), `list_leaks` (gaps, owners and how to fix), `trace` (trace), `find_items` (find rows)

Each gap comes with an "owner" and "how to fix" (which column of which line in which file to write what, so the gap goes away).
After fixing, run check again and make sure the gap is gone.

## daily Daily progress per person

Apart from the remaining work per product, tadori shows "daily progress" **per person** (what was done today, what to do on the next working day, things to discuss).

- Screen: "Daily progress" on the left (choose the owner and the date. The text can be edited in place. "Make a draft", "Add", "Remove", "Copy text")
- Command: `tadori daily <folder> --who <owner> --date <YYYY-MM-DD>` (read only)
- MCP: `daily` (read; also shows each line's [ID]), `daily_generate` (make a draft and save it), `daily_add`, `daily_update`, `daily_remove`
- Attach the location of the source of truth you touched in that work with `links` on `daily_add` / `daily_update` (`[{ "label": "QA sheet", "url": "https://…" }]`, http and https only, up to 8). On the screen it shows as "QA sheet ↗" at the end of the line and opens when pressed. It is not part of the text read out, and appears in the notes as "QA sheet: URL". To change them, pass all of them again
- Put small badges on a line with `badges` on `daily_add` / `daily_update` (`[{ "text": "late", "tone": "hole" }]`, up to 8; tone is none, wait, hole or ok). **You decide what they say** (late, waiting for review, due 11/12 …); tadori does not judge them, and they work without a WBS. The screen shows them apart from the text in the tone color; the text shows them after the line. To change them, pass all of them again (an empty array clears them)
- To turn a word in the text itself into a link, add `anchor` (the word in the text) to the links element, and `nth` (which occurrence) if the same word appears more than once. In the "text form" on the screen that word becomes a link and nothing is added at the end of the line. If the word is not found in the text, it shows as "label ↗" at the end of the line and the tool's reply tells you. It still appears in the notes as "label: URL"
- For a ledger row whose source location is written as a plain URL (e.g. `Issue tracker https://…`), that URL becomes the link to the source of truth without going through the locator in sources.tsv
- A line given an `issue`, whether added or edited, starts with "issue number short title" just like the automatic lines

**The material for the draft** is only the records inside the project's repository (it does not sync with outside tools).
- Changes in WBS status
- Ledger diffs (rows added or edited that day)
- That day's check log (`.tadori/checks.tsv`)

Adding or editing ledger rows normally shows under a separate heading, **ledger upkeep**, apart from today's work (so it is not mistaken for finishing the deliverable).
For kinds where adding a row is itself "the work done", such as response records or test records, add a `work` column to `.tadori/kinds.tsv` and mark it (`yes`); then they show as today's work.
For ledger diffs, the commit author is taken as the owner. If the WBS owners and git names do not match, write the mapping in `.tadori/members.tsv` (columns `name` (owner) and `git` (git author name)).

**They are stored** in one file per day, `.tadori/daily/YYYY-MM-DD.tsv` (committed on every save; a person pushes).
Lines that a person or an agent edited, added or removed are not overwritten when the draft is made again. Only automatic lines nobody touched are rebuilt from new material.

Lines a person added or edited under "Next workday" on the previous workday (the latest earlier day that has a daily file) also appear under "Today" as plans. The previous day keeps its own lines. On the new day these lines behave like automatic lines: edit or remove them and the change stays.

The WBS (`ledger/wbs.tsv`) and the ledger have optional columns.
- WBS `owner`: the owner. For 2 or more people, separate them (any of ・、, /. You can filter by either name)
- WBS `issue`: the ID of the issue this work is for (a ledger row). Work for the same issue is merged into one line. Nothing is merged by guessing
- `short` on the ledger's issue row: a short name. The text uses `short`, and the formal name (title) goes in the notes

The day a status changed is read from the WBS git history (the content of each commit). Edits not committed yet count as today's changes.
**Changes from before tadori was introduced (before the WBS was put in git) do not show.** That is why you see "0 today" right after introducing it. Commit status changes on the same day.

**The text form can be decided per project.** In `.tadori/daily-format.tsv` (columns `key`, `value`), write only what you want to change. Anything not written uses the default form. The defaults follow the language (English below; in Japanese they are `今日（{date}）{count} 件`, `［{tag}］` and so on — see guide.ja.md). Values you write are never translated.

| key | default | meaning |
|---|---|---|
| `today` | `Today ({date}): {count}` | heading for today ({date} = M/D weekday, {count} = number of items) |
| `next` | `Next working day ({date})` | heading for the next working day |
| `consult` | `Questions` | heading for things to discuss |
| `notes` | `Notes` | heading for the notes |
| `wbs` | `{id}` | how to write a WBS number ({id} = the ID as is, {num} = without the leading W and separators) |
| `continued` | (empty) | mark put in front of work that continues on the next working day (if it has no separator, add one space) |
| `numbering` | `continuous` | how lines are numbered. `continuous` = one sequence across headings, `per-section` = from 1 under each heading (notes are split by heading name) |
| `today_label`, `next_label`, `consult_label` | `Today`, `Next working day`, `Questions` | names used to split the notes when `per-section` |
| `upkeep` | `Ledger upkeep` | heading for adding or editing ledger rows (after things to discuss, before the notes; kept apart from today's work) |
| `upkeep_mode` | `show` | whether to show ledger upkeep (`show`, `hide`) |
| `tag_done`, `tag_doing`, `tag_plan`, `tag_upkeep`, `tag_checked` | `Done`, `In progress`, `Planned`, `Upkeep`, `Checked` | words for the mark at the start of a line (empty means that mark is not shown). The mark follows where the line came from: changed to done today = done, changed to an in-between status = doing, next working day = plan, ledger upkeep = upkeep, check log = checked. People and agents can change it per line |
| `tag_format` | `[{tag}] ` | how the mark is written |
| `who_format` | `{who}: ` | how the owner name is written at the start of a line in text not filtered by owner (everyone's). Empty means it is not added |
| `badge_format` | ` <{badge}>` | how a line badge is written after the text (once per badge). Empty means badges are left out of the text (the screen still shows them) |
| `intro` | (empty) | explanation shown at the top of the "Daily progress" screen (empty means tadori's default explanation) |
| `group_after` | `3` | on a day when more ledger rows of the same kind than this were added or edited, they are merged per kind into one line, "added N rows of …" (the IDs go to the notes) |

Work is merged into one line only when lines with the same issue, the same owner and the same continuation (work that continues, or work that starts) are next to each other. So when you filter by owner, other people's work does not get mixed in.

Only the skeleton is fixed: headings go today → next working day → things to discuss → notes, numbering is continuous, no locations inside the text, and formal names and locations go in the notes under the same number.
**This is a draft.** Rewording the text so the content is clear, reordering it and writing things to discuss are for a person or an agent.

## write Writing tools (MCP)

Do not edit the ledger or setting TSVs directly; write with the tools below. Each one checks the shape and the IDs before writing, reads the project again after writing, and reverts and refuses any write that would make it unreadable. Once written, it commits (a person pushes).

- Ledger: `item_add`, `item_update`, `item_remove` (refs only to IDs in the ledger. A row other rows point to cannot be removed)
- Record of syncing from the source of truth: after checking the source of truth and fixing the local row, add `synced_by` (who synced) to `item_update`. If you only confirmed "it matches the current source of truth" without changing anything, use `item_synced` (`id`, `who`). The tool fills in the time (`synced_at` and `synced_by` columns)
- WBS: `task_add`, `task_update` (status, dates, owner, issue. It commits right away, so "the day a status changed" in daily progress does not drift)
- Rules: `rule_add`, `rule_update`, `rule_remove`
- People table: `member_set`, `member_remove` (each person's roles and git author name)
- Phases: `phase_set` (a phase in use cannot be removed)
- Check: `run_check` (with `log`, adds to the check log in 5W1H)
- Project: `list_projects`, `open_project` (switch the project this MCP connection handles)
- Exceptions in the server behind the screen: `server_errors` (when the screen says "Something went wrong inside the server", read where and what failed, newest first. The record is kept locally on the PC, not in the project folder)
- Owner filter on the screen: `filter` of `screen`

**There is no tool that writes approvals by people.** Approvals (`ledger/approvals.tsv`) are written by the person who approved.

## screen Guiding while showing the screen

You can operate a person's screen (the tadori desktop app or browser) with the **agent cursor inside the screen** to show them things. The person's mouse is not used (not taken over).
Pass one of the following to the `screen` tool:
- `{ "action": "point", "target": "Ruleset", "message": "The rules are here" }` point at it and outline it in yellow
- `{ "action": "click", "target": "Ruleset" }` press it
- `{ "action": "type", "target": "Find", "value": "DD-2.3" }` type into a field
- `{ "action": "go", "hash": "#trace-F-02" }` move to a view (`#phases` `#rules` `#log` `#trace-<ID>` `#browse` `#settings` `#glossary`)
- `{ "action": "say", "message": "This is the gap" }` show a short message only
- `{ "action": "filter", "value": "Design owner" }` narrow every view to that person (or role). An empty `value` goes back to everyone

`target` is found by the text or button name shown on the screen (exact matches first).
You can only press what a person can press on the screen. Windows dialogs (such as choosing a folder) cannot be operated, so ask the person.
The desktop app is at `http://127.0.0.1:4873`. If it is open on another port, start MCP with `--screen http://127.0.0.1:<port>`.

## links Opening other tools

Write URL templates in `.tadori/links.tsv` (columns `tool url`) and the md / qa icons next to a gap become clickable.
Values you can insert: `{path}` (location from the project folder), `{repopath}` (location from the top of the git repository), `{abspath}`, `{line}`, `{id}`, `{rowid}` (the md-business row ID of a verification sheet row). A parameter whose inserted value is empty is left out of the link.
Example: `md-business	md-business://open?repo=github.com/<owner>/<repository>&path={repopath}&line={line}&id={rowid}` (md-business uses `id=` before `line=`, and opens the sheet with that row selected)
Templates such as `javascript:` `data:` `file:` are rejected when loading.

## sources Links to the source of truth, and when it was synced

The ledger is a local copy; the source of truth (documents, sheets, issues) lives in outside tools. Write the sources of truth in `.tadori/sources.tsv` (columns `name url locator stale_days`), and rows whose ledger `source` column starts with that name get a link to the source of truth (the trace card on the screen, daily progress, `find_items`, `trace`, `tadori why`).
- `locator`: URL template that jumps to the exact place. `{url}` = the URL, `{loc}` = the text after the name, `{num}` = the first number in it. Empty means the URL as is
- `stale_days`: how many days after syncing from the source of truth a row is shown as "stale" (default 14). Rows with no sync record (`synced_at`) are also shown as stale
- Example: with `Issue sheet	https://issues.example.com/p	{url}/{num}	7`, a row whose `source` is `Issue sheet #12` opens `https://issues.example.com/p/12`

tadori does not sync with the source of truth. For a row shown as stale, a person or an agent compares it with the source of truth; if they fixed it, record it with `item_update` (with `synced_by`), and if it is fine as is, with `item_synced`.
Write URLs only in the project's `.tadori/sources.tsv` (never in tadori itself).

## agent-rules What agents must follow

- **Do not decide that a gap has been filled.** tadori only goes as far as listing the gaps. Only a person can say "yes, that really was a gap" or "it is fixed"
- **Do not approve.** `ledger/approvals.tsv` is written by the person who approved. MCP has no way to approve either
- **Do not fill in test result fields for someone else.** Pass or fail is written by the person who saw the real thing
- **Do not make percentages or scores.** Report only facts: what the gaps are and how many, pending approvals, statuses, and days late
- **Do not copy the content of originals into the ledger.** source holds only the location. The source of truth is in the original's tool (md-business, git-qa and so on)
- **Do not add links by guessing.** refs holds only the IDs of rows you know it is based on
- **Commit, but do not push. A person pushes after checking the content.**
- When explaining the screen to a person, use the words from `glossary` (gap, phase gate, remaining work, task, trace)
