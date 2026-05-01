# Tests

Zero-dependency tests for the `english-coach-prompt-submit.js` hook.

## Run

```bash
node tests/hook.test.js
```

Exits 0 if all tests pass, 1 if any fail. No `package.json`, no `node_modules` — uses only Node's built-in `child_process`.

## Adding a test

Append a new entry to the `tests` array in [hook.test.js](hook.test.js):

```js
{
  name: "human-readable description",
  payload: { prompt: "the prompt to feed the hook" },
  expect: "emit"  // or "skip"
}
```

`payload` can also be a raw string (used to test malformed-JSON handling).
