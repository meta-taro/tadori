# tadori

**English** | [日本語](README.ja.md)

> Under active development (the desktop app, CLI and MCP server work today).
> Direction: [PRD.md](PRD.md) (Japanese). Decisions and the reasons behind them: [docs/decisions.md](docs/decisions.md) (Japanese).
> Website and downloads: https://meta-taro.github.io/tadori/

**A ledger on git that links every sentence of a spec to its test cases, test evidence, findings and preventive actions — by ID.**
Each project phase has its own ruleset, and tadori shows *where the links are missing* ("gaps"). Deciding that a gap was really a gap is always left to a person.

## Why

When a defect slips through, explaining "could we have caught it back then?" and "why didn't testing find it?" means digging through four or five places: design documents, test specs, issue tickets, reviews and chat logs.
**The records exist. The links between them only live in people's heads.**

The more development is delegated to AI agents, the more you need to be able to trace, after the fact, what an agent based its "I checked it" on.

## Run it

You need Node.js 22+ and pnpm.

```bash
pnpm install
pnpm dev:en       # build, then open the screen on the fictional sample project (English) → http://127.0.0.1:4870/
pnpm dev          # the same sample, written in Japanese
```

To open it as a desktop app (Tauri) you also need Rust.

```bash
pnpm --filter @tadori/desktop dev   # a window opens; pick a project folder (one that contains .tadori). Next time it reopens the last project
```

The window just starts `tadori serve` in the background and shows its screen (the checks run on the same core as the CLI).

Installers (macOS Apple silicon / Intel, Windows x64 / ARM) are built by GitHub Actions when you push a tag starting with `v` (e.g. `v0.1.0`), and attached to a draft release. Check the contents before publishing. To build locally: `pnpm --filter @tadori/desktop bundle`.

To run the type check, tests, placement check and the personal/client-name check before every commit (once per clone). The name list cannot be public, so it lives outside the repository in `~/.config/oss-guard/deny-words.txt`, one word per line:

```bash
git config core.hooksPath .githooks
```

No environment variables or secrets are needed (no `.env`).

If an exception happens inside the background server, tadori keeps the time, the API and a summary of the error on your machine (Windows: `%LOCALAPPDATA%\tadori\logs`, macOS: `~/Library/Logs/tadori`; override with `TADORI_LOG_DIR`). Request bodies (your project's content) are never recorded. Agents can read the log with the MCP tool `server_errors`.

Update check: *Help › Version and updates* and, once a day at startup, tadori looks up the latest public release on GitHub — nothing about your project is sent. Turn it off with `TADORI_UPDATE_CHECK=off` in offline environments. When a newer version exists, tadori only offers to open the download page; installing it is up to you.

## Language

English and Japanese. The app's screens, messages, the CLI, the MCP tools and the usage guide follow your OS / browser language (Japanese → Japanese, anything else → English). Switch it from the desktop app's *View* menu, with `--lang en|ja` on the CLI, or with `TADORI_LANG=en|ja`. Everything you write in a project (phase names, column names, the daily-report wording, …) is kept exactly as you wrote it.

## Commands

| Command | What it does |
|---|---|
| `tadori init [project] [--name name]` | Puts a minimal configuration (`.tadori/`) and ledger (`ledger/`) into a project repository. Existing files are never overwritten. Rules are only added as commented examples (a phase without rules shows "no rules", never "passed") |
| `tadori check [project]` | Gaps and pending human approvals per phase. Exits with code 1 when there are gaps (usable in CI). `--log` appends a who/what/when/where/why/how record to the check log |
| `tadori daily [project] [--who person] [--date date]` | Per-person daily progress (today, next working day, questions, notes). The wording is configurable per project. Same content as the *Daily* screen and the MCP tool `daily` |
| `tadori how-to [topic]` | Usage guide (same as the MCP tool `how_to`). Topics: start, ledger, rules, check, daily, write, screen, links, sources, agent-rules |
| `tadori why <ID> [project]` | Everything upstream and downstream of one item, and where the chain breaks |
| `tadori serve [project]` | Opens the screen locally (127.0.0.1): remaining work to release (timeline / cards), WBS, rulesets, check log, trace, settings |
| `tadori mcp [project]` | MCP server over stdio. Tools: usage (`how_to`), glossary, remaining work (`get_remaining`), gaps (`list_leaks`), trace, `find_items`, the in-app agent cursor (`screen`), daily progress, write tools (ledger, WBS, rules, people, phases, logged check, project switching — see `how_to write`), and `server_errors`. There is deliberately **no tool that records a human approval**. `--screen` changes which screen the cursor drives |

```bash
node packages/cli/dist/main.js check examples/lend-v12
node packages/cli/dist/main.js why F-02 examples/lend-v12
node packages/cli/dist/main.js serve examples/lend-v12 --port 4870
```

Changes made on the screen (settings, WBS status, rules, daily progress) are written back to the TSV files, and committed if the project folder is its own git repository.
**tadori never pushes.** Each person checks the contents in their own clone and pushes.

### Use it from an agent (MCP)

With Claude Code, after building, connect it with one line (adjust the paths):

```bash
claude mcp add tadori -- node /path/to/tadori/packages/cli/dist/main.js mcp /path/to/your-project
```

A connected agent first reads `how_to` → `start` and `agent-rules` (the rules it must follow). The guide itself is [packages/cli/guide.md](packages/cli/guide.md).
With `screen`, the agent can operate the tadori screen a person has open, using its own cursor inside the app (it never takes over the person's mouse).

## Project folder layout

The whole ledger is TSV on git. People can read it without tadori.

```text
.tadori/project.tsv        project name
.tadori/phases.tsv         order of phases (differs per company / product)
.tadori/statuses.tsv       WBS status settings
.tadori/kinds.tsv          display names of ledger kinds (optional, e.g. TC → test case)
.tadori/columns.tsv        display names of ledger columns (optional)
.tadori/sources.tsv        URLs of the sources of truth (external docs, sheets, issues) and when a synced row counts as stale (optional; see `tadori how-to sources`)
.tadori/links.tsv          URL templates for opening other tools (optional; placeholders {path}, {repopath}, {abspath}, {line}, {id}, {rowid}; javascript: etc. are rejected)
.tadori/sheets.tsv         md-business verification sheets read as ledger rows, without copying (optional; tadori how-to ledger)
.tadori/rulesets/*.tsv     rulesets per phase (checks: covered / refers / filled / allowed / approval; note = a written agreement that is read, not checked; owner = role responsible)
.tadori/rule-groups.tsv    rule categories (optional; id, name, order). A rule's group column points here
.tadori/checks.tsv         check log (who, what, when, where, why, how)
.tadori/daily/*.tsv        daily progress, one file per day
ledger/items.tsv           the ledger (design sections, commits, test viewpoints, test cases, test runs, findings, preventive actions)
ledger/wbs.tsv             WBS tasks
ledger/approvals.tsv       human approvals (written by people)
```

The samples are [examples/lend-v12-en](examples/lend-v12-en) (a fictional "Equipment Lending App v1.2", in English) and the same project written in Japanese, [examples/lend-v12](examples/lend-v12).
**Real project data never goes into this repository.** Keep a real project's ledger in that project's own repository.

## Repository layout

```text
packages/core     the checking core (reads the ledger, finds gaps, phase gates, traces). No runtime dependencies
packages/cli      the tadori command and the local server
packages/ui       the screen (served as-is by tadori serve)
packages/desktop  the desktop app (Tauri 2). Starts tadori serve in the background and shows its screen
site/             the website (GitHub Pages, plain HTML, no build step)
examples/         the fictional sample project
```

```bash
pnpm verify       # type check and tests
pnpm e2e          # screen tests (Playwright; opens the sample project. On Windows it uses the installed Edge)
pnpm harness      # pre-release checks: runs the built CLI, MCP (a real stdio process) and serve (real HTTP) the way users do
pnpm harness:bundle  # the same checks against the copy that goes into the installers (packages/desktop/src-tauri/tadori)
pnpm release:check  # all of the above. Runs before every push (.githooks/pre-push) and before installers are built
```

## Out of scope

- Issue tracking, running tests, or editing documents (use the tools you already have)
- Quality scores or percentages
- Syncing with external tools (GitHub, GitLab, issue trackers)

## Works with

- [md-business](https://github.com/meta-taro/md-business) — specs and verification sheets
- [git-qa](https://github.com/meta-taro/git-qa) — running tests and keeping evidence

## Roadmap

https://meta-taro.github.io/tadori/roadmap.html

## License

MIT

## How this repository is developed

People and AI agents develop it together. The rules are in [CLAUDE.md](CLAUDE.md) and [`.claude/rules/product-baseline.md`](.claude/rules/product-baseline.md) (Japanese).
