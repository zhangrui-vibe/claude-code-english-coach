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
  },

  // --- New v2: pasted agent text + code-/quote-dominated prompts ---
  {
    name: "long prompt with agent-pattern marker -> skip",
    payload: {
      prompt: "some context here that goes on for a while. ".repeat(38) + "My recommendation: B then D."
    },
    expect: "skip"
  },
  {
    name: "prompt dominated by code block -> skip",
    payload: {
      prompt: "what does this do?\n```js\n" + "function example(arg) { return arg + 1; }\n".repeat(20) + "```"
    },
    expect: "skip"
  },
  {
    name: "prompt dominated by markdown blockquote -> skip",
    payload: {
      prompt: [
        "> The observer-enabled mode burns Haiku tokens every 5 minutes.",
        "> If you don't want background spending, leave enabled false.",
        "> My recommendation: B then D — fix the silent failure first.",
        "> Then list known projects to confirm the registry.",
        "> The ROI of full auto-learning is real but only if observations land.",
        "> Which path do you want to take?",
        "> Want me to dig into the silent observation-capture failure?",
        "> Or look at the project-scoped instincts registry instead?",
        "thoughts?"
      ].join("\n")
    },
    expect: "skip"
  },

  // --- New v2: regression guards (small code or long user prose still emits) ---
  {
    name: "short user question with small code snippet -> emit",
    payload: {
      prompt: "can you explain what this snippet does in our context?\n```js\nfoo();\n```"
    },
    expect: "emit"
  },
  {
    name: "long user prose without agent markers -> emit",
    payload: {
      prompt: "I have been thinking about how we should structure the deployment pipeline for our staging environment and there are several angles to consider here. ".repeat(13)
    },
    expect: "emit"
  },

  // --- New v3: short pasted-agent paragraphs caught by multi-marker count ---
  // Smoking-gun reproducer: the verbatim continuous-learning-v2 agent paragraph
  // the user reported. ~530 chars (under LONG_PROMPT_CHARS=1500), but contains
  // three distinct markers (My recommendation:, Which path do you want, burns
  // Haiku tokens). Should skip because of multi-marker presence.
  {
    name: "short pasted agent paragraph with multiple markers -> skip",
    payload: {
      prompt: [
        "The observer-enabled mode burns Haiku tokens every 5 minutes analyzing observations. If you don't want background spending, leave enabled: false and rely on manual instinct creation.",
        "",
        "My recommendation: B then D. Fix the silent observation-capture failure first (otherwise enabling the analyzer just runs on empty input), then list known projects to confirm the registry. The ROI of full auto-learning is real but only if observations actually land on disk. Which path do you want to take?"
      ].join("\n")
    },
    expect: "skip"
  },
  // Regression guard: a single accidental marker in a short user prompt should
  // NOT trigger skip — only multi-marker prompts do.
  {
    name: "short user prompt with single accidental marker -> emit",
    payload: {
      prompt: "yo, my recommendation: let's just push this through tomorrow morning and see what breaks"
    },
    expect: "emit"
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
