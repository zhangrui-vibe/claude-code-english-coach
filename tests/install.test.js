// End-to-end test for the install pipeline (install.sh on Unix, install.ps1
// on Windows). Each scenario runs the platform-appropriate installer into a
// fresh temp directory pointed at by HOME / USERPROFILE, then verifies that
// the four expected artifacts land at the right paths with content matching
// the repo source — and that the installed hook actually runs as a
// subprocess.
//
// Pure Node stdlib (no jest/vitest, no node_modules). Run with:
//   node tests/install.test.js
//
// The test never touches the developer's real ~/.claude/ — every sandbox is
// created via fs.mkdtempSync under os.tmpdir() and left there for the OS to
// recycle (do not rm -rf inside test code; sandboxes are observable for
// debugging on failure).

const { spawnSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const REPO_ROOT = path.join(__dirname, "..");
const IS_WIN = process.platform === "win32";

// --- helpers ---------------------------------------------------------------

function makeSandbox() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ecc-install-test-"));
}

function runInstaller(sandbox) {
  if (IS_WIN) {
    return spawnSync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", path.join(REPO_ROOT, "install.ps1")
    ], {
      env: { ...process.env, USERPROFILE: sandbox },
      encoding: "utf8"
    });
  }
  return spawnSync("bash", [path.join(REPO_ROOT, "install.sh")], {
    env: { ...process.env, HOME: sandbox },
    encoding: "utf8"
  });
}

function installedPath(sandbox, ...parts) {
  return path.join(sandbox, ".claude", ...parts);
}

function readUtf8(p) {
  return fs.readFileSync(p, "utf8");
}

function fileContentsMatch(installedFile, sourceFile) {
  // Read as bytes (no encoding decode) so CRLF/LF differences surface as a
  // real mismatch — both Copy-Item and cp preserve bytes exactly, so the
  // installed file should be byte-identical to what's in the working tree.
  const a = fs.readFileSync(installedFile);
  const b = fs.readFileSync(sourceFile);
  return a.equals(b);
}

function runHookSubprocess(installedHook, payload) {
  return new Promise(resolve => {
    const proc = spawn(process.execPath, [installedHook]);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", d => { stdout += d; });
    proc.stderr.on("data", d => { stderr += d; });
    proc.on("close", code => resolve({ code, stdout, stderr }));
    proc.stdin.end(typeof payload === "string" ? payload : JSON.stringify(payload));
  });
}

// --- assertion harness -----------------------------------------------------

let passed = 0;
let failed = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) {
    passed++;
    console.log(`PASS  ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}${detail ? "\n        " + detail : ""}`);
    failures.push(label);
  }
}

// --- scenarios -------------------------------------------------------------

async function scenarioFreshInstall() {
  console.log("\n=== Scenario 1: fresh install lands all artifacts ===");
  const sandbox = makeSandbox();
  const result = runInstaller(sandbox);

  check("installer exits with code 0",
    result.status === 0,
    `exit ${result.status}; stderr: ${(result.stderr || "").slice(0, 200)}`);

  const expected = [
    { installed: ["skills", "auto-english-coach", "SKILL.md"], source: ["skills", "auto-english-coach", "SKILL.md"] },
    { installed: ["skills", "english-reviewer", "SKILL.md"],   source: ["skills", "english-reviewer", "SKILL.md"] },
    { installed: ["hooks", "english-coach-prompt-submit.js"],  source: ["hooks", "english-coach-prompt-submit.js"] }
  ];

  for (const e of expected) {
    const installedFile = installedPath(sandbox, ...e.installed);
    const sourceFile = path.join(REPO_ROOT, ...e.source);
    check(`exists: .claude/${e.installed.join("/")}`,
      fs.existsSync(installedFile),
      `expected at ${installedFile}`);
    check(`content matches source: ${e.installed.join("/")}`,
      fs.existsSync(installedFile) && fileContentsMatch(installedFile, sourceFile),
      `byte-mismatch between installed and ${sourceFile}`);
  }

  // vocab.md is created (empty on Unix, BOM-only on Windows; either is fine)
  const vocab = installedPath(sandbox, "english", "vocab.md");
  check("exists: .claude/english/vocab.md",
    fs.existsSync(vocab),
    `expected at ${vocab}`);
  if (fs.existsSync(vocab)) {
    const content = readUtf8(vocab);
    check("vocab.md is empty (no leftover seed content)",
      content === "" || content === "﻿" || content.trim() === "",
      `unexpected vocab content: ${JSON.stringify(content.slice(0, 80))}`);
  }

  check("installer prints settings snippet to stdout",
    (result.stdout || "").includes("UserPromptSubmit"),
    `stdout did not contain "UserPromptSubmit"; head: ${(result.stdout || "").slice(0, 200)}`);

  console.log(`  sandbox: ${sandbox}`);
}

async function scenarioVocabPreserved() {
  console.log("\n=== Scenario 2: existing vocab.md is preserved on re-install ===");
  const sandbox = makeSandbox();

  const first = runInstaller(sandbox);
  check("first install exit 0",
    first.status === 0,
    `exit ${first.status}; stderr: ${(first.stderr || "").slice(0, 200)}`);

  const vocab = installedPath(sandbox, "english", "vocab.md");
  const seed = "* **smoke**: existing user vocab | Context: \"sentinel for the preserve-on-reinstall test\"\n";
  fs.writeFileSync(vocab, seed, "utf8");

  const second = runInstaller(sandbox);
  check("second install exit 0 (idempotent)",
    second.status === 0,
    `exit ${second.status}; stderr: ${(second.stderr || "").slice(0, 200)}`);

  const after = readUtf8(vocab);
  check("vocab.md content preserved across re-install",
    after === seed,
    `vocab.md was overwritten or modified; got: ${JSON.stringify(after.slice(0, 120))}`);

  check("second install reports vocab was left intact",
    /already exists, leaving it/.test(second.stdout || ""),
    `expected "already exists, leaving it" in stdout; head: ${(second.stdout || "").slice(0, 200)}`);

  console.log(`  sandbox: ${sandbox}`);
}

async function scenarioInstalledHookRuns() {
  console.log("\n=== Scenario 3: installed hook runs and behaves correctly ===");
  const sandbox = makeSandbox();
  const result = runInstaller(sandbox);
  check("installer exit 0",
    result.status === 0,
    `exit ${result.status}; stderr: ${(result.stderr || "").slice(0, 200)}`);

  const installedHook = installedPath(sandbox, "hooks", "english-coach-prompt-submit.js");
  if (!fs.existsSync(installedHook)) {
    check("installed hook exists (prerequisite)", false, `not found at ${installedHook}`);
    return;
  }

  // v6: hook is default-allow; a plain English prompt with no transcript_path
  // emits because the hook can't prove agent-injection without metadata. This
  // validates that the installed hook honors the v6 contract end-to-end (not
  // just shouldSkip in isolation).
  const emitRun = await runHookSubprocess(installedHook, {
    prompt: "can you help me wire up the deploy job for staging please"
  });
  check("installed hook: plain English prompt emits valid additionalContext (v6 default-allow)",
    emitRun.code === 0 && emitRun.stdout.includes("hookSpecificOutput") && emitRun.stdout.includes("additionalContext"),
    `code=${emitRun.code}; stdout head: ${emitRun.stdout.slice(0, 200)}`);

  const skipRun = await runHookSubprocess(installedHook, {
    prompt: "/everything-claude-code:tdd-workflow add a skip rule for X"
  });
  check("installed hook: slash command exits 0 with empty stdout",
    skipRun.code === 0 && skipRun.stdout.length === 0,
    `code=${skipRun.code}; stdout: ${JSON.stringify(skipRun.stdout.slice(0, 200))}`);

  const badRun = await runHookSubprocess(installedHook, "not-valid-json{{{");
  check("installed hook: malformed JSON does not crash",
    badRun.code === 0 && badRun.stdout.length === 0,
    `code=${badRun.code}; stdout: ${JSON.stringify(badRun.stdout.slice(0, 200))}; stderr: ${badRun.stderr.slice(0, 200)}`);

  console.log(`  sandbox: ${sandbox}`);
}

// v6.1: validate that the *installed* hook honors transcript-driven
// classification end-to-end (not just shouldSkip in isolation).
// scenarioInstalledHookRuns above only exercises payloads without
// transcript_path; this scenario writes a real-shaped JSONL fixture and
// probes the deployed bytes against it.
async function scenarioInstalledHookClassifiesTranscript() {
  console.log("\n=== Scenario 4: installed hook classifies prompts via transcript metadata (v6.1) ===");
  const sandbox = makeSandbox();
  const result = runInstaller(sandbox);
  check("installer exit 0",
    result.status === 0,
    `exit ${result.status}; stderr: ${(result.stderr || "").slice(0, 200)}`);

  const installedHook = installedPath(sandbox, "hooks", "english-coach-prompt-submit.js");
  if (!fs.existsSync(installedHook)) {
    check("installed hook exists (prerequisite)", false, `not found at ${installedHook}`);
    return;
  }

  // Build a 2-entry transcript: one human-marked prompt, one isMeta:true
  // auto-resume. Both have non-CJK English text long enough to pass sanity
  // rules so we exercise the transcript codepath.
  const humanPrompt = "can you help me wire up the deploy job for staging please end to end";
  const autoResumePrompt = "Continue from where you left off this is a long enough sentence";
  const transcriptEntries = [
    {
      type: "user",
      isMeta: false,
      isSidechain: false,
      userType: "external",
      message: { role: "user", content: [{ type: "text", text: humanPrompt }] }
    },
    {
      type: "user",
      isMeta: true,
      isSidechain: false,
      userType: "external",
      message: { role: "user", content: [{ type: "text", text: autoResumePrompt }] }
    }
  ];
  const txDir = fs.mkdtempSync(path.join(os.tmpdir(), "ecc-install-tx-"));
  const transcriptPath = path.join(txDir, "session.jsonl");
  fs.writeFileSync(transcriptPath, transcriptEntries.map(e => JSON.stringify(e)).join("\n") + "\n");

  // Probe 1: human prompt with matching transcript entry -> emit
  const humanRun = await runHookSubprocess(installedHook, {
    prompt: humanPrompt,
    transcript_path: transcriptPath
  });
  check("installed hook: human prompt with matching transcript entry emits coaching",
    humanRun.code === 0 && humanRun.stdout.includes("hookSpecificOutput") && humanRun.stdout.includes("additionalContext"),
    `code=${humanRun.code}; stdout head: ${humanRun.stdout.slice(0, 200)}`);

  // Probe 2: prompt matches the isMeta:true entry -> skip
  const autoRun = await runHookSubprocess(installedHook, {
    prompt: autoResumePrompt,
    transcript_path: transcriptPath
  });
  check("installed hook: prompt matching isMeta:true entry triggers skip",
    autoRun.code === 0 && autoRun.stdout.length === 0,
    `code=${autoRun.code}; stdout: ${JSON.stringify(autoRun.stdout.slice(0, 200))}`);

  // Probe 3: prompt with no matching entry -> default-allow -> emit
  const noMatchRun = await runHookSubprocess(installedHook, {
    prompt: "this prompt does not match any transcript entry default allow path verified",
    transcript_path: transcriptPath
  });
  check("installed hook: prompt with no matching entry defaults to allow (emit)",
    noMatchRun.code === 0 && noMatchRun.stdout.includes("hookSpecificOutput"),
    `code=${noMatchRun.code}; stdout head: ${noMatchRun.stdout.slice(0, 200)}`);

  console.log(`  sandbox: ${sandbox}`);
  console.log(`  transcript: ${transcriptPath}`);
}

// --- main ------------------------------------------------------------------

async function main() {
  console.log(`Install pipeline E2E (platform: ${process.platform})`);
  console.log(`Installer: ${IS_WIN ? "install.ps1 via powershell.exe" : "install.sh via bash"}`);

  await scenarioFreshInstall();
  await scenarioVocabPreserved();
  await scenarioInstalledHookRuns();
  await scenarioInstalledHookClassifiesTranscript();

  console.log("");
  console.log(`${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) {
    console.log("Failures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => {
  console.error("Test harness error:", err);
  process.exit(2);
});
