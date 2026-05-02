# claude-code-english-coach

An English coaching skill for AI coding assistants. Native install for **[Claude Code](https://claude.com/claude-code)**; porting notes included for **Codex**, **Antigravity**, and **OpenCode** at the bottom.

A pair of skills that improve your English while you vibe-code, but only when you ask. The coach fires **only when you opt in** with a `:coach` prefix or `--coach` suffix in your prompt — every other prompt is skipped silently and costs zero model tokens. A separate reviewer turns your accumulated vocab into recall quizzes when you want to practice.

> **Search keywords:** Claude Code skill, Claude Code hook, vibe coding English tutor, AI coding assistant English coach, Codex English helper, Antigravity skill, OpenCode plugin, vocabulary tracker for AI coding tools, opt-in language coaching.

```
You type ":coach <your prompt>"   Claude solves it as usual           At the end of the reply
        |                                  |                                   v
        v                                  v                          --- Expression Upgrade
[ UserPromptSubmit hook ]  ----injects---->                           * Better phrasing: ...
        | (only if :coach / --coach                                    * Key vocab logged: ...
        |  marker is present —                                                  |
        |  default-deny otherwise)                                              v
                                                                      ~/.claude/english/vocab.md
```

## What you get

| Component | What it does | When it runs |
|---|---|---|
| `auto-english-coach` skill | Appends a one-line "Expression Upgrade" and silently logs 2-3 vocab items | When the hook detects the `:coach` / `--coach` opt-in marker |
| `english-reviewer` skill | Picks 5 random items from your vocab log and runs an interactive recall quiz (fill-in-the-blank + production prompts) | On demand — invoke it manually |
| `english-coach-prompt-submit.js` hook | Default-deny: skips every prompt unless it carries an opt-in marker, then strips the marker and emits coaching instructions for the rest | UserPromptSubmit |

## How to invoke (opt-in)

Add one of two markers to a prompt you want coached. Everything else stays untouched.

```
:coach can you wire up the deploy job for staging?
```

```
can you wire up the deploy job for staging? --coach
```

Both markers are case-insensitive and tolerate leading/trailing whitespace. The marker is stripped before the rest of the prompt is coached, so the model never sees `:coach` itself in the upgrade output.

The hook still skips silently — even with an opt-in marker — when, after stripping the marker, the body is:

- Shorter than 12 characters or fewer than 4 words
- Pure CJK (Chinese / Japanese / Korean)
- A re-quote of a previous `--- Expression Upgrade` section (recursion guard)

Outside those sanity rules the design is structural: **no marker → no coaching → zero tokens spent**. There are no content heuristics. Agent-generated prompts (autonomous loops, scheduled cron ticks, post-compaction "Continue from where you left off" auto-resumes, subagent invocations) are skipped automatically because none of them carry the opt-in marker. You can tune the markers and sanity thresholds in [hooks/english-coach-prompt-submit.js](hooks/english-coach-prompt-submit.js).

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

After install, open Claude Code in any project and ask something substantial in English **with an opt-in marker** — for example:

```
:coach can you summarize what this repo does in one paragraph?
```

The reply should end with a `--- Expression Upgrade` section and a new vocab entry should show up in `~/.claude/english/vocab.md`. A plain prompt without `:coach` or `--coach` should produce no upgrade section at all (that's the v5 default-deny posture).

If nothing happens on a marker-carrying prompt:
- Run `/hooks` to force a settings reload.
- Confirm the script runs cleanly: `node ~/.claude/hooks/english-coach-prompt-submit.js < /dev/null` (should exit 0 silent — that's correct, since stdin is empty).
- Ensure no project-level `.claude/settings.json` is replacing the global `UserPromptSubmit` array.

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

- **Why opt-in (`:coach`/`--coach`) instead of automatic content heuristics?** Earlier versions tried to skip agent-generated prompts by guessing from content — long-prompt-plus-marker regex, code-block ratios, blockquote ratios, multi-marker counts, etc. That approach was reactive and never converged on coverage: every new agent class (autonomous loops, schedule cron ticks, heartbeat ops pings, post-compaction auto-resumes) required another patch, and tokens kept getting wasted in the gaps. v5 flips the default: the hook skips by default and emits only when the user includes an explicit marker. Failure mode is silent (no upgrade, free) instead of polluting (coached agent prose, paid).
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
- Opt-in is explicit by design — you have to remember to add `:coach` or `--coach`. That tradeoff is intentional (it eliminates token waste on non-human prompts) but it means the coach won't catch every prompt you might have wanted reviewed. Re-submit with a marker if you change your mind.
- `~/.claude/english/vocab.md` is shared across projects. If two Claude Code sessions write at exactly the same moment you can lose an entry. In practice the window is microseconds and hasn't been observed in real use.

## Porting to other AI coding tools

The two SKILL.md files are pure prompt content — they describe *what* the model should do and don't depend on any tool-specific API. The only tool-specific piece is the **trigger mechanism**: how to make the coaching instruction reach the model on every user turn.

| Tool | Status | How to port |
|---|---|---|
| **Claude Code** | Native | `UserPromptSubmit` hook in `~/.claude/settings.json`. See [install.sh](install.sh) / [install.ps1](install.ps1). |
| **Codex (OpenAI)** | Manual port | Codex doesn't have a hook event for prompt submission. Easiest path: paste the contents of `skills/auto-english-coach/SKILL.md` into your Codex `~/.codex/AGENTS.md` (or equivalent system prompt). The opt-in protocol still works — the model checks for `:coach` / `--coach` in each prompt itself, just without the hook-level guarantee. |
| **Antigravity (Google)** | Manual port | Treat the SKILL.md content as a custom instruction at workspace level. The model checks for the opt-in marker in the prompt rather than a separate hook. |
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
