// UserPromptSubmit hook for the auto-english-coach skill.
//
// v6 design: STRUCTURAL CLASSIFICATION via the Claude Code transcript.
// Default-ALLOW for human-typed prompts; skip only on POSITIVE evidence
// the prompt was harness-injected. The hook reads the JSONL transcript
// at payload.transcript_path and inspects the latest type:"user" entry.
//
// Skip signals (any one of these triggers skip):
//   - isMeta: true        → auto-resume / harness-injected
//   - isSidechain: true   → subagent execution
//   - userType != external → system / non-human source
//   - message.content has a tool_result part → post-tool continuation
//
// Sanity rules apply first (no transcript I/O for trivial-skip cases):
//   - prompt < 12 chars or < 4 words
//   - prompt contains CJK characters
//   - prompt re-quotes a previous "--- Expression Upgrade" (recursion guard)
//
// On uncertainty (no transcript_path, transcript unreadable, no entry
// found), the hook DEFAULTS TO ALLOW — coaching a real human prompt is
// the intended behavior; the false-allow cost is one wasted upgrade if
// Claude Code's schema changes. False-skip on a real human prompt is
// worse: silent loss of expected coaching.
//
// Cross-platform: uses os.homedir(). No hard-coded paths.

const fs = require("fs");
const path = require("path");
const os = require("os");

const VOCAB_PATH = path.join(os.homedir(), ".claude", "english", "vocab.md")
  .replace(/\\/g, "/"); // forward slashes read more cleanly in the prompt

const cjkRegex = /[一-鿿぀-ヿ가-힯]/;

const MIN_CHARS = 12;
const MIN_WORDS = 4;
// Tail-read just enough to find the latest user entry. Recent Claude Code
// sessions have entries in the low-KB range; 64KB is safely larger than any
// single entry while staying small enough that file I/O is sub-millisecond.
const TRANSCRIPT_TAIL_BYTES = 64 * 1024;

// Read the tail of the transcript JSONL and return the most recent entry of
// type "user" (the entry corresponding to the prompt currently being
// classified, assuming Claude Code writes the entry before firing the hook).
// Returns null on any error or if no user entry is found.
function findLatestUserEntry(transcriptPath) {
  if (!transcriptPath || typeof transcriptPath !== "string") return null;
  let buf;
  try {
    const stat = fs.statSync(transcriptPath);
    const start = Math.max(0, stat.size - TRANSCRIPT_TAIL_BYTES);
    const fd = fs.openSync(transcriptPath, "r");
    buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
  } catch (_err) {
    return null;
  }
  const lines = buf.toString("utf8").split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry && entry.type === "user") return entry;
    } catch (_) {
      // Partial line at the tail-read boundary — ignore and keep looking.
    }
  }
  return null;
}

function shouldSkip(payload) {
  const prompt = payload && payload.prompt;
  // Sanity rules first — cheap, no I/O.
  if (!prompt || typeof prompt !== "string") return true;
  const trimmed = prompt.trim();
  if (trimmed.length < MIN_CHARS) return true;
  if (cjkRegex.test(trimmed)) return true;
  if (trimmed.split(/\s+/).length < MIN_WORDS) return true;
  if (trimmed.includes("--- Expression Upgrade")) return true;
  // Slash commands and Claude Code's expanded command-message wrapper carry
  // skill/command body text, not user English prose. Skip regardless of any
  // transcript metadata — these are never coachable user input.
  if (trimmed.startsWith("/")) return true;
  if (trimmed.startsWith("<command-message>")) return true;

  // Transcript-driven structural classification.
  // Default-allow: skip only on positive evidence of non-human source.
  const entry = findLatestUserEntry(payload.transcript_path);
  if (entry) {
    if (entry.isMeta === true) return true;
    if (entry.isSidechain === true) return true;
    if (entry.userType && entry.userType !== "external") return true;
    const c = entry.message && entry.message.content;
    if (Array.isArray(c) && c.some(p => p && p.type === "tool_result")) return true;
  }
  return false;
}

function buildContext() {
  return [
    "[auto-english-coach] After your main response, append a minimalist '--- Expression Upgrade' section based on the user's English prompt above:",
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

    if (shouldSkip(payload)) process.exit(0);

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
