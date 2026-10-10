#!/usr/bin/env bash
# Decide which CI work a change actually needs, so private-repo Actions minutes (a free monthly
# allowance) are not spent building 4 GB images for a docs edit.
#
# Prints key=value lines (append to $GITHUB_OUTPUT):
#   code=true|false           anything other than docs/markdown changed
#   api_image=true|false      Dockerfile, deps, lockfile or smoke script changed
#   judge_image=true|false    infra/local-judge changed
#   encoder_image=true|false  infra/encoder-service changed
#
# Inputs (env): CI_BASE_SHA = commit to diff against. For a pull request the checkout is the merge
# commit, so `diff CI_BASE_SHA HEAD` is exactly the PR's changes. Unset, all zeros, or a failed
# fetch => everything is true (fail safe: never skip work because we could not tell).
# CI_FORCE_ALL=true forces everything (schedule / manual runs).
set -euo pipefail

emit() { echo "$1=$2"; }

all_true() {
  emit code true; emit api_image true; emit judge_image true; emit encoder_image true
  exit 0
}

[ "${CI_FORCE_ALL:-false}" = "true" ] && all_true

base="${CI_BASE_SHA:-}"
case "$base" in ''|0000000000000000000000000000000000000000) all_true ;; esac

# Cheap: fetch only the base commit. On failure, fall back to running everything.
git fetch --no-tags --depth=1 origin "$base" >/dev/null 2>&1 || all_true

files="$(git diff --name-only "$base" HEAD 2>/dev/null)" || all_true
[ -n "$files" ] || { emit code false; emit api_image false; emit judge_image false; emit encoder_image false; exit 0; }

# Changed files that matter for code (anything that is not documentation-only).
code=false
api_image=false
judge_image=false
encoder_image=false
while IFS= read -r f; do
  case "$f" in
    *.md|docs/*|LICENSE|.github/dependabot.yml) ;;      # documentation-only
    *) code=true ;;
  esac
  case "$f" in
    apps/api/Dockerfile|apps/api/package.json|package.json|pnpm-lock.yaml|scripts/boot-smoke.sh|.github/workflows/images.yml|.dockerignore) api_image=true ;;
  esac
  case "$f" in
    infra/local-judge/*|.github/workflows/images.yml) judge_image=true ;;
  esac
  case "$f" in
    infra/encoder-service/*|.github/workflows/images.yml) encoder_image=true ;;
  esac
done <<< "$files"

emit code "$code"; emit api_image "$api_image"; emit judge_image "$judge_image"; emit encoder_image "$encoder_image"
