# Original Spec — Historical

> **This file is preserved for context only. The current architecture is described in [../README.md](../README.md). Do not follow the install steps below — Step 4 references a `claude config add customInstructions` subcommand that does not exist in Claude Code.**

This was the original prompt the project author sent to Claude Code as a one-shot setup request. We kept it because it captures the *intent* nicely, but the implementation diverged in three important ways:

1. **No `customInstructions` setting.** The Claude Code CLI does not have a `claude config add customInstructions ...` subcommand. To make a behavior fire automatically after every turn, you need a hook configured in `~/.claude/settings.json` — the harness executes hooks; memory and preferences cannot.

2. **`UserPromptSubmit` instead of `Stop`.** A `Stop` hook that re-prompts the model causes loops because the harness re-fires Stop after each block. The current implementation uses a `UserPromptSubmit` hook that injects the coaching instruction *before* the response is generated, baking the upgrade into the main reply in a single round-trip. See [../hooks/english-coach-prompt-submit.js](../hooks/english-coach-prompt-submit.js).

3. **English-only vocab format.** The original spec used `[Word/Phrase]: [Chinese Meaning] | Context: ...`. The released format drops the Chinese translation in favor of a short English definition so the file is portable across native languages.

---

## Original prompt (verbatim)

**Copy and paste the following prompt to Claude Code:**

```text
Please help me set up an automated "Background English Tutor" workflow. I need you to execute terminal commands to create specific directories, write two Skill configurations, and update my global Claude Code settings.

Please perform the following steps sequentially. All comments and logs must be in English.

### Step 1: Initialize Directories and Files
Run bash commands to create the necessary directories and the global vocabulary log file:
- Create directory: `~/.claude/skills/auto-english-coach`
- Create directory: `~/.claude/skills/english-reviewer`
- Create directory: `~/.claude/english`
- Create an empty file: `~/.claude/english/vocab.md`

### Step 2: Create the Auto-Coach Skill
Create a file at `~/.claude/skills/auto-english-coach/SKILL.md` with the exact content below:

---
name: auto-english-coach
description: Automatically evaluates the user's English prompt, provides a brief language upgrade, and silently logs vocabulary to a central file.
---

# Auto English Coach

You are a background English coach.

## Workflow
1. **Analyze:** Silently analyze the user's original English prompt. Identify 1-2 areas for improvement (focusing on technical precision or casual daily Slack communication style).
2. **Execute Logging:** Use your file tools to SILENTLY append 2-3 high-value vocabulary words or collocations from your analysis to `~/.claude/english/vocab.md`.
   - Use this format for logging: `* **[Word/Phrase]**: [Chinese Meaning] | Context: [Brief usage scenario]`
3. **Output Feedback:** At the very end of your main technical response, append a minimalist section called `--- Expression Upgrade`.

## Output Format Constraints
Keep the user-facing output extremely concise to avoid disrupting the main workflow.

--- Expression Upgrade
* **Better phrasing:** [1 rewritten sentence combining formal and casual improvements]
* **Key vocab logged:** [List only the 2-3 words you logged to the file, e.g., "bandwidth, tackle, root cause"]


### Step 3: Create the Reviewer Skill
Create a file at `~/.claude/skills/english-reviewer/SKILL.md` with the exact content below:

---
name: english-reviewer
description: Triggered when the user wants to review and practice their logged English vocabulary.
---

# English Reviewer

You are an interactive English tutor.

## Workflow
1. **Read Data:** Use your file tools to read the contents of `~/.claude/english/vocab.md`.
2. **Select:** Randomly select 5 items from the list that the user has accumulated.
3. **Quiz Generation:** Generate an interactive quiz for the user based on those 5 items.
   - Ask the user to translate a Chinese sentence (relevant to daily stand-ups, system design, or casual tech chats) into English using the target words.
   - Wait for the user's input.
4. **Feedback:** Once the user answers, correct their grammar, suggest native phrasing, and provide encouragement.

If the vocab file is empty, inform the user to continue their daily tasks so you can collect more data.


### Step 4: Configure Global Instructions
Execute the following bash command to add a global custom instruction to Claude Code. This ensures the coach runs automatically after every task across all projects:

`claude config add customInstructions "After fully completing my technical coding/engineering request, ALWAYS automatically invoke the 'auto-english-coach' skill to briefly upgrade my English expression and log the vocabulary. Do this silently without asking for permission."`

Please confirm once all steps are successfully executed.
```
