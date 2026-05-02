# Tests

Zero-dependency tests for the english-coach hook and install pipeline. No `package.json`, no `node_modules` — both harnesses use only Node's built-in `child_process` and `fs`.

## Run

Hook unit tests (fast — runs the hook subprocess against synthetic JSON payloads):

```bash
node tests/hook.test.js
```

Install pipeline E2E (spawns the platform-appropriate installer into a temp `$HOME` and verifies real install + run):

```bash
node tests/install.test.js
```

Both exit 0 if all assertions pass, 1 if any fail. The install test auto-detects platform (`install.ps1` on Windows, `install.sh` on macOS / Linux) and never touches your real `~/.claude/` — every sandbox is a fresh `os.tmpdir()` directory left in place after the run for debugging.

## Adding a hook test

Append a new entry to the `tests` array in [hook.test.js](hook.test.js):

```js
{
  name: "human-readable description",
  payload: { prompt: "the prompt to feed the hook" },
  expect: "emit"  // or "skip"
}
```

`payload` can also be a raw string (used to test malformed-JSON handling).

## Adding an install scenario

Add an `async function scenarioMyCase()` to [install.test.js](install.test.js) and call it from `main()`. Use the existing helpers (`makeSandbox`, `runInstaller`, `installedPath`, `runHookSubprocess`, `check`) so failures keep reporting in the same format.
