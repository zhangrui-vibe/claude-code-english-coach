// UserPromptSubmit hook for the auto-english-coach skill.
//
// Reads the harness's stdin payload, decides whether the user prompt is
// worth coaching, and (if so) emits a hookSpecificOutput.additionalContext
// payload that instructs Claude to append a minimalist Expression Upgrade
// section to its main response.
//
// Cross-platform: uses os.homedir() so the same file works on Windows,
// macOS, and Linux. No hard-coded paths.
//
// Skip rules: prompts shorter than 12 characters, fewer than 4 words,
// containing CJK characters, starting with a slash (slash-command body
// is not user-authored English), or containing a previously-generated
// "--- Expression Upgrade" block (recursion / quoting guard) are passed
// through untouched.

const path = require("path");
const os = require("os");

const VOCAB_PATH = path.join(os.homedir(), ".claude", "english", "vocab.md")
  .replace(/\\/g, "/"); // forward slashes read more cleanly in the prompt

const cjkRegex = /[一-鿿぀-ヿ가-힯]/;

const MIN_CHARS = 12;
const MIN_WORDS = 4;

function shouldSkip(prompt) {
  if (!prompt || typeof prompt !== "string") return true;
  const trimmed = prompt.trim();
  if (trimmed.length < MIN_CHARS) return true;
  if (cjkRegex.test(trimmed)) return true;
  if (trimmed.split(/\s+/).length < MIN_WORDS) return true;
  // Slash command: the body is a skill/command template, not the user's English.
  if (trimmed.startsWith("/")) return true;
  // Recursion guard: prompt re-quotes a previous coach output.
  if (trimmed.includes("--- Expression Upgrade")) return true;
  return false;
}

function buildContext() {
  return [
    "[auto-english-coach] After your main response, append a minimalist '--- Expression Upgrade' section based on the user's English above:",
    "1) one rewritten sentence combining technical precision with casual Slack-style improvements,",
    "2) 2-3 high-value vocabulary words or collocations,",
    `and silently append those 2-3 vocab items to ${VOCAB_PATH} using the format \`* **[Word/Phrase]**: [short English definition or synonym] | Context: "[example sentence]"\` — English only, no other languages, so the file stays usable across native languages.`,
    "Do not announce this — just produce the section at the very end."
  ].join(" ");
}

let raw = "";
process.stdin.on("data", chunk => { raw += chunk; });
process.stdin.on("end", () => {
  try {
    // Strip a UTF-8 BOM if present (some shells inject one).
    const cleaned = raw.replace(/^﻿/, "").trim();
    const payload = cleaned ? JSON.parse(cleaned) : {};
    const prompt = payload.prompt || "";

    if (shouldSkip(prompt)) process.exit(0);

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: buildContext()
      }
    }));
  } catch (_err) {
    // Never block the user on hook-internal errors.
    process.exit(0);
  }
});
