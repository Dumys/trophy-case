#!/bin/bash
# Simulates a working day of hook events against an isolated state dir.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$HERE/../ach/trophy.js"
export TROPHY_CASE_DIR="$HERE/tmp-sim"
rm -rf "$TROPHY_CASE_DIR"

hook() { # $1 event, $2 json
  printf '%s' "$2" | node "$T" --hook "$1"
}

SID='"session_id":"sim-1","cwd":"/home/dev/my-app"'

echo "--- session starts, first prompt, first tools ---"
hook SessionStart "{$SID,\"source\":\"startup\"}"
hook UserPromptSubmit "{$SID,\"prompt\":\"please fix the login bug\"}"
hook PostToolUse "{$SID,\"tool_name\":\"Read\",\"tool_input\":{\"file_path\":\"/etc/hostname\"}}"
hook PostToolUse "{$SID,\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"/app/src/login.ts\",\"old_string\":\"a\",\"new_string\":\"b\"}}"

echo "--- a commit lands ---"
hook PostToolUse "{$SID,\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git commit -m 'fix login'\"}}"

echo "--- polite x10 → hidden courtesy unlock ---"
for i in $(seq 1 9); do hook UserPromptSubmit "{$SID,\"prompt\":\"спасибо! now please run tests $i\"}"; done

echo "--- 100 tools → centurion ---"
for i in $(seq 1 100); do hook PostToolUse "{$SID,\"tool_name\":\"Grep\",\"tool_input\":{}}"; done

echo "--- 5 languages → polyglot ---"
for ext in py go rs rb css; do
  hook PostToolUse "{$SID,\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"/app/x.$ext\",\"content\":\"x\"}}"
done

echo "--- failures x5 in 10min → rage ---"
for i in $(seq 1 5); do hook PostToolUseFailure "{$SID,\"tool_name\":\"Bash\",\"tool_input\":{}}"; done

echo "--- friday push at 19:00? (only fires on real Friday evening) ---"
hook PostToolUse "{$SID,\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git push origin main\"}}"

echo; echo "=== CABINET ==="
node "$T" --cabinet
echo "=== WRAPPED ==="
node "$T" --wrapped
