// Test harness for hooks/english-coach-prompt-submit.js
//
// Pure Node stdlib (no jest/vitest, no node_modules) to match the project's
// dependency-free stance. Run with:  node tests/hook.test.js
//
// Each test spawns the hook as a child process, pipes a JSON payload to its
// stdin, and asserts on stdout. An empty stdout means the hook decided to
// skip; a non-empty stdout means it emitted an additionalContext payload.

const { spawn } = require("child_process");
const path = require("path");

const HOOK = path.join(__dirname, "..", "hooks", "english-coach-prompt-submit.js");

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

const tests = [
  // --- Baseline: behaviors that must keep working ---
  {
    name: "pure English prompt -> emits coaching context",
    payload: { prompt: "can you help me wire up the deploy job for staging" },
    expect: "emit"
  },
  {
    name: "pure CJK prompt -> skip",
    payload: { prompt: "帮我把 staging 的部署任务接好" },
    expect: "skip"
  },
  {
    name: "mixed CJK+English prompt -> skip",
    payload: { prompt: "please 帮我 review the deploy script for staging" },
    expect: "skip"
  },
  {
    name: "short prompt under 12 chars -> skip",
    payload: { prompt: "go ahead" },
    expect: "skip"
  },
  {
    name: "fewer than 4 words -> skip",
    payload: { prompt: "this is fine" },
    expect: "skip"
  },
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

  // --- New: slash-command skip (the slash body is not user-authored English) ---
  {
    name: "slash command with no args -> skip",
    payload: { prompt: "/everything-claude-code:tdd-workflow" },
    expect: "skip"
  },
  {
    name: "slash command with English args -> skip",
    payload: { prompt: "/everything-claude-code:tdd-workflow please make the english coach skip slash commands" },
    expect: "skip"
  },
  {
    name: "slash command with leading whitespace -> skip",
    payload: { prompt: "   /clear and start fresh on this branch" },
    expect: "skip"
  },

  // --- New: re-quoted prior coach output (recursion / loop guard) ---
  {
    name: "prompt that quotes a previous Expression Upgrade -> skip",
    payload: {
      prompt: [
        "here is the previous reply for context:",
        "",
        "--- Expression Upgrade",
        "* Better phrasing: please ship the deploy",
        "* Key vocab logged: ship, deploy, staging"
      ].join("\n")
    },
    expect: "skip"
  }
];

async function main() {
  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    const { code, stdout, stderr } = await runHook(t.payload);
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
