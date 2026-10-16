#!/usr/bin/env bash
# Claude Code PostToolUse hook: after an edit to user-facing copy, run the advice-rule test.
# Input: the tool-call JSON on stdin. Exit 2 = feed stderr back to Claude so it fixes the copy.
set -uo pipefail
file=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).tool_input.file_path||"")}catch{console.log("")}})')
case "$file" in
  */detectors/family/*.yaml|*/playbooks/family/*.yaml) ;;
  *) exit 0 ;;
esac
cd "${CLAUDE_PROJECT_DIR:-.}/packages/engine" || exit 0
if ! out=$(npx vitest run src/__tests__/advice-rule.test.ts 2>&1); then
  echo "Advice-rule check failed (CLAUDE.md second rule: no personal recommendations or named providers)." >&2
  echo "$out" | grep -E "yaml:[0-9]+|AssertionError" >&2
  exit 2
fi
