// Test harness for hooks/english-coach-prompt-submit.js (v6).
//
// v6 contract: DEFAULT-ALLOW for human-typed prompts; skip only on positive
// evidence the prompt was harness-injected. The hook reads the JSONL transcript
// at payload.transcript_path and inspects the latest type:"user" entry. Skip
// signals: isMeta:true (auto-resume), isSidechain:true (subagent execution),
// userType != "external" (system / non-human), or message.content containing
// tool_result parts (post-tool continuation).
//
// Pure Node stdlib (no jest/vitest, no node_modules). Run with:
//   node tests/hook.test.js
//
// Each test spawns the hook as a child process, optionally writes a synthetic
// transcript JSONL fixture under os.tmpdir() and injects its path into the
// payload, pipes the payload through stdin, and asserts on stdout. An empty
// stdout means the hook decided to skip; a non-empty stdout means it emitted
// an additionalContext payload.

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const HOOK = path.join(__dirname, "..", "hooks", "english-coach-prompt-submit.js");

// Write a synthetic transcript JSONL fixture and return its absolute path.
// Each entry in `entries` is one JSONL line. Sandbox dirs are intentionally
// not cleaned up so failures are debuggable; the OS recycles them.
function writeTranscriptFixture(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ecc-hook-tx-"));
  const p = path.join(dir, "session.jsonl");
  fs.writeFileSync(p, entries.map(e => JSON.stringify(e)).join("\n") + "\n");
  return p;
}

function runHook(payload) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [HOOK]);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", d => { stdout += d; });
    proc.stderr.on("data", d => { stderr += d; });
    proc.on("error", reject);
    proc.on("close", code => resolve({ code, stdout, stderr }));
    const input = typeof payload === "string" ? payload : JSON.stringify(payload);
    proc.stdin.end(input);
  });
}

// A test entry may include an optional `transcript` array. If present, the
// harness writes the entries to a temp JSONL and injects transcript_path
// into the payload before piping it to the hook.
const tests = [
  // === Sanity rules — apply regardless of transcript ===
  {
    name: "empty payload -> skip",
    payload: {},
    expect: "skip"
  },
  {
    name: "malformed JSON stdin -> skip (no crash)",
    payload: "not json{{{",
    expect: "skip"
  },
  {
    name: "short prompt under 12 chars -> skip",
    payload: { prompt: "yes do it" },
    expect: "skip"
  },
  {
    name: "fewer than 4 words -> skip",
    payload: { prompt: "this is fine" },
    expect: "skip"
  },
  {
    name: "pure CJK -> skip",
    payload: { prompt: "帮我把部署接好这件事情" },
    expect: "skip"
  },
  {
    name: "mixed CJK+English -> skip",
    payload: { prompt: "please 帮我 review the deploy script for staging" },
    expect: "skip"
  },
  {
    name: "recursion guard: prompt re-quotes a previous Expression Upgrade -> skip",
    payload: {
      prompt: [
        "see this previous reply for context:",
        "",
        "--- Expression Upgrade",
        "* Better phrasing: ship the deploy",
        "* Key vocab logged: ship, deploy, staging"
      ].join("\n")
    },
    expect: "skip"
  },

  // === Default-allow when transcript is unavailable ===
  {
    name: "no transcript_path in payload -> emit (trust the prompt as human)",
    payload: { prompt: "can you fix the deploy script for staging please" },
    expect: "emit"
  },
  {
    name: "transcript_path points to nonexistent file -> emit (default-allow on read error)",
    payload: {
      prompt: "can you fix the deploy script for staging please",
      transcript_path: "/nonexistent/path/that/will/never/exist/session.jsonl"
    },
    expect: "emit"
  },
  {
    name: "empty transcript file -> emit (no entry to classify; default-allow)",
    transcript: [],
    payload: { prompt: "can you fix the deploy script for staging please" },
    expect: "emit"
  },

  // === Transcript-driven SKIP cases ===
  {
    name: "transcript last user-entry has isMeta=true -> skip (auto-resume)",
    transcript: [
      {
        type: "user",
        isMeta: true,
        isSidechain: false,
        userType: "external",
        message: { role: "user", content: [{ type: "text", text: "Continue from where you left off." }] }
      }
    ],
    payload: { prompt: "Continue from where you left off this is a long enough prompt" },
    expect: "skip"
  },
  {
    name: "transcript last user-entry has isSidechain=true -> skip (subagent execution)",
    transcript: [
      {
        type: "user",
        isSidechain: true,
        userType: "external",
        message: { role: "user", content: [{ type: "text", text: "subagent task content" }] }
      }
    ],
    payload: { prompt: "subagent task content please run this analysis end to end" },
    expect: "skip"
  },
  {
    name: "transcript last user-entry has userType != external -> skip",
    transcript: [
      {
        type: "user",
        isSidechain: false,
        userType: "system",
        message: { role: "user", content: [{ type: "text", text: "system-generated prompt body" }] }
      }
    ],
    payload: { prompt: "system-generated prompt body that is long enough for sanity rules" },
    expect: "skip"
  },
  {
    name: "transcript last user-entry has tool_result content -> skip (post-tool continuation)",
    transcript: [
      {
        type: "user",
        isSidechain: false,
        userType: "external",
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_xyz" }] }
      }
    ],
    payload: { prompt: "tool result re-injection text long enough for sanity rules to pass" },
    expect: "skip"
  },

  // === Transcript-driven EMIT cases ===
  {
    name: "transcript last user-entry is plain human prompt -> emit",
    transcript: [
      {
        type: "user",
        isSidechain: false,
        userType: "external",
        message: { role: "user", content: [{ type: "text", text: "fix the deploy script" }] }
      }
    ],
    payload: { prompt: "can you fix the deploy script for staging please" },
    expect: "emit"
  },
  {
    name: "transcript last user-entry has isMeta=false explicitly -> emit",
    transcript: [
      {
        type: "user",
        isMeta: false,
        isSidechain: false,
        userType: "external",
        message: { role: "user", content: [{ type: "text", text: "fix the issue" }] }
      }
    ],
    payload: { prompt: "fix the issue with the deploy script for staging please" },
    expect: "emit"
  },

  // === v6.1 false-negative reproducers ===
  // (1) After a tool-using turn, the latest type:"user" entry is a tool_result
  // re-injection. The user's actual prompt is in an earlier entry. v6 picks
  // the latest (tool_result) and skips. v6.1 must content-match the prompt to
  // the earlier text entry and emit.
  {
    name: "tool_result entry is latest, but matching prompt is in earlier entry -> emit",
    transcript: [
      {
        type: "user",
        isSidechain: false,
        userType: "external",
        message: { role: "user", content: [{ type: "text", text: "can you fix the deploy script for staging please" }] }
      },
      {
        type: "user",
        isSidechain: false,
        userType: "external",
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_xyz" }] }
      }
    ],
    payload: { prompt: "can you fix the deploy script for staging please" },
    expect: "emit"
  },
  // (2) The harness fired UserPromptSubmit before transcribing the new prompt;
  // the latest type:"user" entry is a previous-turn auto-resume (isMeta:true)
  // whose text doesn't match the current prompt. v6 picks the auto-resume
  // entry and skips. v6.1 must find no content match -> default-allow -> emit.
  {
    name: "latest entry has isMeta:true but text doesn't match current prompt -> emit",
    transcript: [
      {
        type: "user",
        isMeta: true,
        isSidechain: false,
        userType: "external",
        message: { role: "user", content: [{ type: "text", text: "Continue from where you left off." }] }
      }
    ],
    payload: { prompt: "what is the next step we should take on the deploy pipeline" },
    expect: "emit"
  },
  // (3) Defensive: the new prompt has no matching entry anywhere in the
  // transcript (fires-before-write simulation). The only entry present is an
  // older unrelated prompt with no skip signals. Both v6 and v6.1 should emit
  // here, but the test pins the behavior so a future regression that uses
  // "latest entry" with a stale skip signal would be caught.
  {
    name: "prompt has no matching transcript entry -> emit (fires-before-write)",
    transcript: [
      {
        type: "user",
        isMeta: false,
        isSidechain: false,
        userType: "external",
        message: { role: "user", content: [{ type: "text", text: "older prompt body content unrelated" }] }
      }
    ],
    payload: { prompt: "completely different new prompt that the harness has not written yet" },
    expect: "emit"
  }
];

async function main() {
  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    let resolvedPayload = t.payload;
    if (Array.isArray(t.transcript)) {
      const txPath = writeTranscriptFixture(t.transcript);
      // payload may be a string (malformed-JSON case) — only inject for object payloads
      if (resolvedPayload && typeof resolvedPayload === "object") {
        resolvedPayload = { ...resolvedPayload, transcript_path: txPath };
      }
    }
    const { code, stdout, stderr } = await runHook(resolvedPayload);
    const skipped = stdout.length === 0;
    const got = skipped ? "skip" : "emit";
    const ok = got === t.expect && code === 0;
    if (ok) {
      passed++;
      console.log(`PASS  ${t.name}`);
    } else {
      failed++;
      console.log(`FAIL  ${t.name}`);
      console.log(`        expected ${t.expect}, got ${got} (exit ${code})`);
      if (stderr.trim()) console.log(`        stderr: ${stderr.trim()}`);
      if (!skipped) console.log(`        stdout: ${stdout.slice(0, 200)}${stdout.length > 200 ? "..." : ""}`);
    }
  }
  console.log("");
  console.log(`${passed} passed, ${failed} failed, ${tests.length} total`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => {
  console.error("Test harness error:", err);
  process.exit(2);
});
