# claude-code-english-coach

An English coaching skill for AI coding assistants. Native install for **[Claude Code](https://claude.com/claude-code)**; porting notes included for **Codex**, **Antigravity**, and **OpenCode** at the bottom.

A pair of skills that quietly improve your English while you vibe-code. The coach watches your prompts, suggests one upgraded phrasing per turn, and logs vocabulary to a single Markdown file. A separate reviewer turns that file into recall quizzes when you want to practice.

> **Search keywords:** Claude Code skill, Claude Code hook, vibe coding English tutor, AI coding assistant English coach, Codex English helper, Antigravity skill, OpenCode plugin, vocabulary tracker for AI coding tools.

```
You ask Claude something          Claude solves it as usual           At the end of the reply
        |                                  |                                   v
        v                                  v                          --- Expression Upgrade
[ UserPromptSubmit hook ]  ----injects---->                           * Better phrasing: ...
                                                                      * Key vocab logged: ...
                                                                                |
                                                                                v
                                                                      ~/.claude/english/vocab.md
```

## What you get

| Component | What it does | When it runs |
|---|---|---|
| `auto-english-coach` skill | Appends a one-line "Expression Upgrade" to every meaningful English prompt and silently logs 2-3 vocab items | Auto, via the hook |
| `english-reviewer` skill | Picks 5 random items from your vocab log and runs an interactive recall quiz (fill-in-the-blank + production prompts) | On demand — invoke it manually |
| `english-coach-prompt-submit.js` hook | Inspects each prompt; injects coaching instructions into Claude's context only when the prompt is real English worth coaching | UserPromptSubmit |

## Skip rules (reduce noise)

The hook stays quiet when the prompt is:
- Shorter than 12 characters or fewer than 4 words ("yes", "go ahead", "ok thanks")
- Pure CJK (Chinese / Japanese / Korean — falls through to your normal Claude flow), or contains any CJK characters
- A slash command (starts with `/`, e.g. `/clear` or `/some-skill args`) — the slash body is a skill / command template, not your writing
- A re-submitted `--- Expression Upgrade` section (recursion / quoting guard)
- Long (>1500 chars) and contains agent-style phrasing ("My recommendation:", "Which path do you want", "wrapped —", "guarded behind", etc.) — likely pasted agent output
- Contains two or more distinct agent-style markers regardless of length — short pasted agent paragraphs (a single accidental marker in casual user phrasing still emits)
- More than 50% inside triple-backtick code blocks — you're pasting code, not writing English
- More than 30% of non-empty lines start with `> ` — you're quoting prior text
- Malformed input

You can tune these thresholds in [hooks/english-coach-prompt-submit.js](hooks/english-coach-prompt-submit.js). The model is also instructed to coach only the user's own authored English within an otherwise-eligible prompt — so pasted code, log lines, or quoted agent text inside your prompt will not show up in the upgrade section.

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

After install, open Claude Code in any project and ask something substantial in English (≥4 words). The reply should end with a `--- Expression Upgrade` section and the new vocab should show up in `~/.claude/english/vocab.md`.

If nothing happens:
- Run `/hooks` to force a settings reload.
- Confirm the script is executable: `node ~/.claude/hooks/english-coach-prompt-submit.js < /dev/null` (should exit 0 silent).
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

- **Why UserPromptSubmit (and not Stop)?** A `Stop` hook that re-prompts the model causes loops because the harness re-fires Stop after each block, and detecting "already coached" via transcript-tail scan is racy. UserPromptSubmit fires exactly once per real user message and injects the instruction *before* the response, baking the upgrade into the main reply.
- **Why a Node script and not a one-line shell command?** Cross-platform (Windows + macOS + Linux), avoids quoting hell when embedded in JSON, easy to extend with detection rules.
- **Why a single global vocab file?** Lets practice span every project you work on. If you want per-project logs, change `VOCAB_PATH` in the hook script to a relative path.

The original one-shot setup prompt that kicked off this project is preserved as historical context at [docs/original-spec.md](docs/original-spec.md), with notes on why the implementation diverged.

## Compatibility

Tested on:
- Claude Code (CLI + VS Code extension) on Windows 11 with PowerShell 5.1 and Node 20+
- Should work on macOS / Linux with bash and Node 18+ — the hook script uses only `fs`, `path`, and `os` from the standard library

## Limitations

- The hook injects instructions; the model still has to follow them. Occasionally on long, complex turns Claude may forget the upgrade section. Re-prompt with "and the upgrade?" if it matters.
- The skip heuristics are word-count and CJK-based — they don't catch mixed-language prompts (English with one phrase in another script) or technically-perfect-but-stylistically-clumsy English. PRs welcome.
- `~/.claude/english/vocab.md` is shared across projects. If two Claude Code sessions write at exactly the same moment you can lose an entry. In practice the window is microseconds and hasn't been observed in real use.

## Porting to other AI coding tools

The two SKILL.md files are pure prompt content — they describe *what* the model should do and don't depend on any tool-specific API. The only tool-specific piece is the **trigger mechanism**: how to make the coaching instruction reach the model on every user turn.

| Tool | Status | How to port |
|---|---|---|
| **Claude Code** | Native | `UserPromptSubmit` hook in `~/.claude/settings.json`. See [install.sh](install.sh) / [install.ps1](install.ps1). |
| **Codex (OpenAI)** | Manual port | Codex doesn't have a hook event for prompt submission. Easiest path: paste the contents of `skills/auto-english-coach/SKILL.md` into your Codex `~/.codex/AGENTS.md` (or equivalent system prompt). The coach runs on every turn but you lose the auto-skip heuristics. |
| **Antigravity (Google)** | Manual port | Treat the SKILL.md content as a custom instruction at workspace level. Skip-rule logic would need to live in the model's prompt rather than a separate hook. |
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
- Better skip heuristics
- Spanish / French / German variants of the coach (the architecture is language-agnostic)

Run the test harness before sending a PR:

```bash
node tests/hook.test.js
```

Zero dependencies — see [tests/README.md](tests/README.md) for adding cases.
