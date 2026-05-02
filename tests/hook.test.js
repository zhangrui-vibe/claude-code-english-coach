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
  // --- v5 default-deny: ANY prompt without an opt-in marker skips ---
  // Note: the v2-v4 content heuristics are gone. The hook no longer tries
  // to guess agent-vs-human from the prompt; instead it skips by default and
  // emits only when the user explicitly opts in via ":coach " prefix or
  // " --coach" suffix.
  {
    name: "plain English prompt without opt-in -> skip (default-deny)",
    payload: { prompt: "can you help me wire up the deploy job for staging" },
    expect: "skip"
  },
  {
    name: "long English prompt without opt-in -> skip",
    payload: {
      prompt: "I have been thinking about how we should structure the deployment pipeline for our staging environment and there are several angles to consider here. ".repeat(13)
    },
    expect: "skip"
  },
  {
    name: "slash command without opt-in -> skip",
    payload: { prompt: "/everything-claude-code:tdd-workflow please do X" },
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

  // --- v5 default-deny: regression cases that v2-v4 cared about all skip
  // automatically now, no special rule needed ---
  {
    name: "smoking-gun heartbeat agent ping without opt-in -> skip",
    payload: { prompt: "Heartbeat 10: 3/96 still. 10 min on RB888/3min cell. Holding pattern. Still waiting on your call between A/B/C/D." },
    expect: "skip"
  },
  {
    name: "smoking-gun continuous-learning agent paragraph without opt-in -> skip",
    payload: {
      prompt: [
        "The observer-enabled mode burns Haiku tokens every 5 minutes analyzing observations. If you don't want background spending, leave enabled: false and rely on manual instinct creation.",
        "",
        "My recommendation: B then D. Fix the silent observation-capture failure first, then list known projects to confirm the registry. Which path do you want to take?"
      ].join("\n")
    },
    expect: "skip"
  },
  {
    name: "code-block-dominant prompt without opt-in -> skip",
    payload: { prompt: "what does this do?\n```js\n" + "function example(arg) { return arg + 1; }\n".repeat(20) + "```" },
    expect: "skip"
  },
  {
    name: "post-compaction auto-resume 'Continue from where you left off.' -> skip",
    payload: { prompt: "Continue from where you left off." },
    expect: "skip"
  },

  // --- v5 opt-in: ":coach " prefix emits coaching for the rest of the prompt ---
  {
    name: ":coach prefix + English -> emit",
    payload: { prompt: ":coach can you help me wire up the deploy job for staging" },
    expect: "emit"
  },
  {
    name: ":COACH prefix is case-insensitive -> emit",
    payload: { prompt: ":COACH can you help me wire up the deploy job" },
    expect: "emit"
  },
  {
    name: "leading whitespace before :coach is tolerated -> emit",
    payload: { prompt: "   :coach can you help me wire up the deploy job" },
    expect: "emit"
  },

  // --- v5 opt-in: " --coach" suffix is the alternate trigger ---
  {
    name: "--coach suffix + English -> emit",
    payload: { prompt: "can you help me wire up the deploy job for staging --coach" },
    expect: "emit"
  },
  {
    name: "--COACH suffix is case-insensitive, trailing whitespace tolerated -> emit",
    payload: { prompt: "can you help me wire up the deploy job --COACH   " },
    expect: "emit"
  },

  // --- v5 sanity rules still apply AFTER stripping the opt-in marker ---
  {
    name: ":coach + CJK body -> skip (CJK rule still applies after strip)",
    payload: { prompt: ":coach 帮我把 staging 的部署任务接好" },
    expect: "skip"
  },
  {
    name: ":coach + too-short body (<12 chars) -> skip",
    payload: { prompt: ":coach yes do" },
    expect: "skip"
  },
  {
    name: ":coach + too-few-words body (<4 words) -> skip",
    payload: { prompt: ":coach this is fine" },
    expect: "skip"
  },
  {
    name: ":coach with no body at all -> skip",
    payload: { prompt: ":coach" },
    expect: "skip"
  },
  {
    name: ":coach + previously-generated Expression Upgrade -> skip (recursion guard)",
    payload: { prompt: ":coach --- Expression Upgrade\n* Better phrasing: ship the deploy\n* Key vocab logged: ship, deploy, staging" },
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
