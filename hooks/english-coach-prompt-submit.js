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
// is not user-authored English), containing a previously-generated
// "--- Expression Upgrade" block (recursion / quoting guard), longer
// than 1500 chars and containing an agent-style phrasing marker
// (pasted agent prose), containing two or more distinct agent-style
// phrasing markers regardless of length (short pasted agent paragraph),
// or dominated by triple-backtick code fences (>50% by length) or
// markdown blockquote lines (>30% of non-empty lines) are passed
// through untouched.

const path = require("path");
const os = require("os");

const VOCAB_PATH = path.join(os.homedir(), ".claude", "english", "vocab.md")
  .replace(/\\/g, "/"); // forward slashes read more cleanly in the prompt

const cjkRegex = /[一-鿿぀-ヿ가-힯]/;

const MIN_CHARS = 12;
const MIN_WORDS = 4;

// v2 thresholds: pasted-agent-text and code-/quote-dominance.
const LONG_PROMPT_CHARS = 1500;
const CODE_BLOCK_RATIO_THRESHOLD = 0.5;
const BLOCKQUOTE_RATIO_THRESHOLD = 0.3;
// v3 threshold: a short paragraph with two or more distinct agent-style
// markers is almost always a paste; one isolated marker in casual user
// phrasing is plausible and should not skip.
const MIN_AGENT_MARKER_COUNT = 2;

// Phrasing markers that strongly suggest the long text is pasted agent prose
// rather than the user's own writing. Each marker is a multi-word phrase or
// includes punctuation, so substring matching is precise enough without word
// boundaries (and \b can't anchor against ":" or "—" anyway). Extend
// cautiously — additions here are user-visible behavior changes.
const AGENT_PATTERN_MARKERS = /(My recommendation:|Which path do you want|trade-?off:|leave \S+ false|Want me to|Push into Phase|wrapped —|guarded behind|burns? \w+ tokens?|Heartbeat \d+:|Holding pattern|your call between)/i;

function codeBlockRatio(text) {
  const fenceMatches = [...text.matchAll(/```[\s\S]*?```/g)];
  const inFence = fenceMatches.reduce((sum, m) => sum + m[0].length, 0);
  return text.length === 0 ? 0 : inFence / text.length;
}

function blockquoteRatio(text) {
  const lines = text.split(/\r?\n/);
  const nonEmpty = lines.filter(l => l.trim().length > 0);
  if (nonEmpty.length === 0) return 0;
  const quoted = nonEmpty.filter(l => /^\s*>\s/.test(l)).length;
  return quoted / nonEmpty.length;
}

function agentMarkerCount(text) {
  const re = new RegExp(AGENT_PATTERN_MARKERS.source, "gi");
  const distinct = new Set();
  // Use m[0] (the full match) for dedup so adding inner capture groups to
  // AGENT_PATTERN_MARKERS in the future does not silently break this counter.
  for (const m of text.matchAll(re)) {
    distinct.add(m[0].toLowerCase());
  }
  return distinct.size;
}

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
  // Long prompt + agent-pattern marker: almost certainly pasted agent prose.
  if (trimmed.length > LONG_PROMPT_CHARS && AGENT_PATTERN_MARKERS.test(trimmed)) return true;
  // Short prompt with multiple distinct markers: short pasted agent paragraph.
  if (agentMarkerCount(trimmed) >= MIN_AGENT_MARKER_COUNT) return true;
  // Code-block-dominant: user is pasting code, not writing English.
  if (codeBlockRatio(trimmed) > CODE_BLOCK_RATIO_THRESHOLD) return true;
  // Blockquote-dominant: user is quoting prior text rather than writing their own.
  if (blockquoteRatio(trimmed) > BLOCKQUOTE_RATIO_THRESHOLD) return true;
  return false;
}

function buildContext() {
  return [
    "[auto-english-coach] After your main response, append a minimalist '--- Expression Upgrade' section based ONLY on the user's own authored English in the prompt above.",
    "Explicitly ignore quoted/pasted prior agent responses, code blocks, log output, command output, or any embedded '--- Expression Upgrade' sections — coach only what the user themselves wrote.",
    "Before logging any vocab, internally identify the EXACT substring of the user's authored English (typically a short directive or question, often at the end of the prompt). Every vocab item you log MUST be a word or collocation that appears literally in that substring; if a candidate word is not in the substring, pick a different one from the substring or skip vocab entirely this turn.",
    "If after that exclusion there is no user-authored English worth coaching, produce no Expression Upgrade section.",
    "Otherwise produce: 1) one rewritten sentence combining technical precision with casual Slack-style improvements,",
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
