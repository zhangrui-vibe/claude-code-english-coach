#!/usr/bin/env bash
# auto-english-coach installer (macOS / Linux)
# Copies skill files and the hook script into ~/.claude/, then prints the
# settings.json snippet to merge by hand.

set -euo pipefail

CLAUDE_HOME="${HOME}/.claude"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Installing auto-english-coach into ${CLAUDE_HOME} ..."

# 1. Skill directories
for s in auto-english-coach english-reviewer; do
  mkdir -p "${CLAUDE_HOME}/skills/${s}"
  cp "${REPO_ROOT}/skills/${s}/SKILL.md" "${CLAUDE_HOME}/skills/${s}/"
  echo "  - skill: ${s}"
done

# 2. Hook script
mkdir -p "${CLAUDE_HOME}/hooks"
cp "${REPO_ROOT}/hooks/english-coach-prompt-submit.js" "${CLAUDE_HOME}/hooks/"
echo "  - hook:  english-coach-prompt-submit.js"

# 3. Vocab log (only if missing)
VOCAB_PATH="${CLAUDE_HOME}/english/vocab.md"
if [[ ! -f "${VOCAB_PATH}" ]]; then
  mkdir -p "$(dirname "${VOCAB_PATH}")"
  : > "${VOCAB_PATH}"
  echo "  - vocab: created empty vocab.md"
else
  echo "  - vocab: ${VOCAB_PATH} already exists, leaving it"
fi

# 4. Tell the user how to wire up the hook
cat <<'EOF'

Done. One manual step left: merge this block into ~/.claude/settings.json under the 'hooks' key.
(If you already have a UserPromptSubmit array there, APPEND; do not replace.)

EOF
cat "${REPO_ROOT}/settings-snippet.json"
echo ""
echo "After saving settings.json, run /hooks in Claude Code to reload."
