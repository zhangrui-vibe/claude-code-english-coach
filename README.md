# claude-code-english-coach

An English coaching skill for AI coding assistants. Native install for **[Claude Code](https://claude.com/claude-code)**; porting notes included for **Codex**, **Antigravity**, and **OpenCode** at the bottom.

A pair of skills that improve your English while you vibe-code. The coach **automatically classifies each prompt** as human-typed or agent-injected by reading Claude Code's transcript metadata — you type nothing extra. Human prompts get an Expression Upgrade and a vocab entry; agent prompts (autonomous loops, scheduled cron ticks, post-compaction auto-resumes, subagent invocations) skip silently. A separate reviewer turns your accumulated vocab into recall quizzes when you want to practice.

> **Search keywords:** Claude Code skill, Claude Code hook, vibe coding English tutor, AI coding assistant English coach, Codex English helper, Antigravity skill, OpenCode plugin, vocabulary tracker for AI coding tools, transcript-driven hook classification.

```
You type a prompt                 Claude solves it as usual           At the end of the reply
        |                                  |                                   v
        v                                  v                          --- Expression Upgrade
[ UserPromptSubmit hook ]  ----injects---->                           * Better phrasing: ...
        | (only if the latest transcript                               * Key vocab logged: ...
        |  user-entry has no agent-source                                       |
        |  signal — isMeta / isSidechain /                                      v
        |  non-external userType / tool_result)                       ~/.claude/english/vocab.md
```

## What you get

| Component | What it does | When it runs |
|---|---|---|
| `auto-english-coach` skill | Appends a one-line "Expression Upgrade" and silently logs 2-3 vocab items | When the hook classifies the prompt as human-typed |
| `english-reviewer` skill | Picks 5 random items from your vocab log and runs an interactive recall quiz (fill-in-the-blank + production prompts) | On demand — invoke it manually |
| `english-coach-prompt-submit.js` hook | Default-allow: emits coaching for any prompt unless transcript metadata proves it was harness-injected (`isMeta`, `isSidechain`, non-`external` `userType`, or `tool_result` content) | UserPromptSubmit |

## How it classifies prompts

The hook reads the JSONL transcript at `payload.transcript_path` (Claude Code injects this on every UserPromptSubmit), tail-scans the last 64 KB for the most recent `type:"user"` entry, and inspects four metadata fields:

| Signal | Meaning | Action |
|---|---|---|
| `isMeta: true` | Auto-resume / harness-injected (e.g. `Continue from where you left off.`) | skip |
| `isSidechain: true` | Subagent execution | skip |
| `userType` is not `"external"` | System / non-human source | skip |
| `message.content` has a `tool_result` part | Post-tool continuation | skip |
| None of the above | Human-typed | **emit** |

Cheap sanity rules apply first (no transcript I/O for trivially-skip cases): prompts < 12 chars or < 4 words, prompts containing CJK characters, slash commands (`/foo` or `<command-message>...`), and re-quoted `--- Expression Upgrade` sections (recursion guard) all skip directly.

On uncertainty (no `transcript_path`, transcript unreadable, no entry found), the hook **defaults to allow** — coaching a real human prompt is the intended behavior, and a single wasted upgrade if Claude Code's schema changes is cheaper than silently losing coaching the user expected.

You can tune the skip signals and tail-read window at the top of [hooks/english-coach-prompt-submit.js](hooks/english-coach-prompt-submit.js).

## Install

### One-shot install (recommended)

```powershell
# Windows (PowerShell)
.\install.ps1
```

```bash
# macOS / Linux
bash install.sh
```

The installer copies the three skill/hook files into your Claude Code home (`~/.claude/`), creates an empty vocab log if you don't have one, and prints the JSON snippet to merge into your user settings.

### Manual install

1. Copy `skills/auto-english-coach/` and `skills/english-reviewer/` into `~/.claude/skills/`.
2. Copy `hooks/english-coach-prompt-submit.js` into `~/.claude/hooks/`.
3. Create `~/.claude/english/vocab.md` (empty or seed it with `data/vocab.example.md`).
4. Merge the contents of [settings-snippet.json](settings-snippet.json) into your `~/.claude/settings.json` under the `hooks` key. **Important:** if you already have a `UserPromptSubmit` array there, append — don't replace.

## Verify

After install, open Claude Code in any project and ask any substantial English question (≥4 words, no CJK):

```
can you summarize what this repo does in one paragraph?
```

The reply should end with a `--- Expression Upgrade` section and a new vocab entry should show up in `~/.claude/english/vocab.md`. After a session resume (Claude auto-injects "Continue from where you left off."), no upgrade section should appear — that prompt's transcript entry has `isMeta: true`, so the hook skips it.

If nothing happens on a normal English prompt:
- Run `/hooks` to force a settings reload.
- Confirm the script runs cleanly: `node ~/.claude/hooks/english-coach-prompt-submit.js < /dev/null` (should exit 0 silent — that's correct, since stdin is empty).
- Ensure your `~/.claude/settings.json` `UserPromptSubmit` entry actually points at `english-coach-prompt-submit.js` (not an older script left over from a previous install).
- Ensure no project-level `.claude/settings.json` is overriding the global hook.

## Practicing your accumulated vocab

In any Claude Code session: **invoke the `english-reviewer` skill** (e.g., type "review my english vocab"). It picks 5 random items from your vocab log and runs an interactive quiz.

If the file has fewer than 5 entries, the reviewer asks you to come back after a few more sessions.

## Vocab log format

One bullet per entry, no date, no IDs, **English only** so the file works for learners regardless of native language:

```markdown
* **[Word/Phrase]**: [short English definition or synonym] | Context: "[example sentence]"
```

Example:

```markdown
* **streamline**: simplify / make more efficient | Context: "We can streamline daily stand-ups by cutting status updates."
```

If you'd rather log in your own native language for personal use, edit `buildContext()` in [hooks/english-coach-prompt-submit.js](hooks/english-coach-prompt-submit.js) — the format string is one line.

## Architecture notes

- **Why structural classification instead of content heuristics or an explicit opt-in marker?** Earlier versions tried to skip agent-generated prompts by guessing from content — long-prompt-plus-marker regex, code-block ratios, blockquote ratios, multi-marker counts. That was reactive and never converged: every new agent class (loops, cron, heartbeat pings, auto-resumes) required another patch. A short-lived later version flipped to an explicit `:coach`/`--coach` opt-in marker, which eliminated agent-prompt token waste at the cost of asking the user to type a marker every turn. v6 reads Claude Code's transcript JSONL on each UserPromptSubmit and inspects the latest user-entry's metadata (`isMeta`, `isSidechain`, `userType`, `tool_result` content) — the harness already labels these distinctions; the hook just consults them. The user types nothing.
- **Why default-allow on uncertainty?** When the transcript can't be read or no matching entry is found, the cost of false-allow (one wasted upgrade) is far cheaper than the cost of false-skip (silently losing coaching the user expected). The structural skip rules only fire on positive evidence.
- **Why UserPromptSubmit (and not Stop)?** A `Stop` hook that re-prompts the model causes loops because the harness re-fires Stop after each block, and detecting "already coached" via transcript-tail scan is racy. UserPromptSubmit fires exactly once per user message and injects the instruction *before* the response, baking the upgrade into the main reply.
- **Why a Node script and not a one-line shell command?** Cross-platform (Windows + macOS + Linux), avoids quoting hell when embedded in JSON, easy to extend.
- **Why a single global vocab file?** Lets practice span every project you work on. If you want per-project logs, change `VOCAB_PATH` in the hook script to a relative path.

The original one-shot setup prompt that kicked off this project is preserved as historical context at [docs/original-spec.md](docs/original-spec.md), with notes on why the implementation diverged.

## Compatibility

Tested on:
- Claude Code (CLI + VS Code extension) on Windows 11 with PowerShell 5.1 and Node 20+
- Should work on macOS / Linux with bash and Node 18+ — the hook script uses only `fs`, `path`, and `os` from the standard library

## Limitations

- The hook injects instructions; the model still has to follow them. Occasionally on long, complex turns Claude may forget the upgrade section. Re-prompt with "and the upgrade?" if it matters.
- The classifier depends on Claude Code's transcript JSONL schema (`type`, `isMeta`, `isSidechain`, `userType`, `message.content`). That schema is observed-stable as of Claude Code 2.1, but it is not formally documented. If a future Claude Code release renames or removes any of those fields, the hook fails open to allow — you may briefly see coaching on agent prompts until the marker list is updated. The fix in that case is one line in `shouldSkip()`.
- `~/.claude/english/vocab.md` is shared across projects. If two Claude Code sessions write at exactly the same moment you can lose an entry. In practice the window is microseconds and hasn't been observed in real use.

## Porting to other AI coding tools

The two SKILL.md files are pure prompt content — they describe *what* the model should do and don't depend on any tool-specific API. The only tool-specific piece is the **trigger mechanism**: how to make the coaching instruction reach the model on every user turn.

| Tool | Status | How to port |
|---|---|---|
| **Claude Code** | Native | `UserPromptSubmit` hook in `~/.claude/settings.json`. See [install.sh](install.sh) / [install.ps1](install.ps1). |
| **Codex (OpenAI)** | Manual port | Codex doesn't have a hook event for prompt submission, and its transcript schema differs. Easiest path: paste the contents of `skills/auto-english-coach/SKILL.md` into your Codex `~/.codex/AGENTS.md` (or equivalent system prompt). The model is then responsible for noticing agent-injected vs. human prompts itself — without the hook-level guarantee Claude Code provides. |
| **Antigravity (Google)** | Manual port | Treat the SKILL.md content as a custom instruction at workspace level. The model is responsible for the source-classification logic in lieu of a hook. |
| **OpenCode** | Manual port | OpenCode supports custom agents and tools. Wrap [hooks/english-coach-prompt-submit.js](hooks/english-coach-prompt-submit.js) as a pre-prompt hook in the OpenCode config, or inline the SKILL.md content as a system message. |

PRs adding native installers for the other three tools are very welcome — the Node hook script (`fs`, `path`, `os` only) is the portable core.

## GitHub repo topics to set after `gh repo create`

Add these via the repo's "Topics" section to maximize discoverability:

```
claude-code
claude-code-skill
claude-code-hook
vibe-coding
ai-coding-assistant
english-tutor
english-coach
vocabulary-builder
language-learning
codex
antigravity
opencode
```

## License

MIT — see [LICENSE](LICENSE).

## Contributing

Issues and pull requests welcome. Especially valuable:
- Spanish / French / German variants of the coach (the architecture is language-agnostic)
- Native installers for Codex / Antigravity / OpenCode that wire the opt-in protocol into each tool's hook equivalent

Run the test harness before sending a PR:

```bash
node tests/hook.test.js
```

Zero dependencies — see [tests/README.md](tests/README.md) for adding cases.
