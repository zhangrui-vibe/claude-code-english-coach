// UserPromptSubmit hook for the auto-english-coach skill.
//
// Reads the harness's stdin payload and decides whether to inject a
// coaching instruction. v5 design: DEFAULT-DENY — the hook skips ANY
// prompt unless the user explicitly opts in via ":coach " prefix or
// " --coach" suffix. This eliminates the v2-v4 heuristic guessing
// game (which was reactive and never converged on coverage) and
// guarantees zero model tokens are spent on prompts the user did not
// personally request coaching for.
//
// Cross-platform: uses os.homedir() so the same file works on Windows,
// macOS, and Linux. No hard-coded paths.

const path = require("path");
const os = require("os");

const VOCAB_PATH = path.join(os.homedir(), ".claude", "english", "vocab.md")
  .replace(/\\/g, "/"); // forward slashes read more cleanly in the prompt

const cjkRegex = /[一-鿿぀-ヿ가-힯]/;

const MIN_CHARS = 12;
const MIN_WORDS = 4;

// Opt-in markers: case-insensitive, whitespace-tolerant.
//   Prefix:  ":coach <prompt>"      — leading whitespace tolerated
//   Suffix:  "<prompt> --coach"    — trailing whitespace tolerated
// Both require at least one space separating the marker from the body so
// a bare ":coach" or "--coach" inside other words doesn't accidentally
// trigger the opt-in.
const OPT_IN_PREFIX = /^\s*:coach\s+/i;
const OPT_IN_SUFFIX = /\s+--coach\s*$/i;

// Returns the user's prompt body with the opt-in marker stripped, or null
// if no opt-in marker was present (in which case shouldSkip returns true).
function extractOptIn(prompt) {
  if (!prompt || typeof prompt !== "string") return null;
  const prefixMatch = prompt.match(OPT_IN_PREFIX);
  if (prefixMatch) return prompt.slice(prefixMatch[0].length).trim();
  const suffixMatch = prompt.match(OPT_IN_SUFFIX);
  if (suffixMatch) return prompt.slice(0, prompt.length - suffixMatch[0].length).trim();
  return null;
}

function shouldSkip(prompt) {
  // Default-deny: emit only when the user explicitly opts in.
  const body = extractOptIn(prompt);
  if (body === null) return true;
  // Sanity rules apply AFTER the opt-in marker is stripped.
  if (body.length < MIN_CHARS) return true;
  if (cjkRegex.test(body)) return true;
  if (body.split(/\s+/).length < MIN_WORDS) return true;
  // Recursion guard: if the user pasted a previous Expression Upgrade
  // alongside the opt-in marker, don't coach the recursion target.
  if (body.includes("--- Expression Upgrade")) return true;
  return false;
}

function buildContext() {
  return [
    "[auto-english-coach] The user explicitly opted in to English coaching by including a ':coach' prefix or ' --coach' suffix in their prompt above.",
    "After your main response, append a minimalist '--- Expression Upgrade' section based on the user's prompt — strip the ':coach' / '--coach' opt-in marker before coaching; coach the rest.",
    "Produce: 1) one rewritten sentence combining technical precision with casual Slack-style improvements,",
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
