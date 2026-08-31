#!/usr/bin/env bash
# pr-gc.sh — reclaim everything the review server leaves in a user's clone.
#
#   ./pr-gc.sh <clone-path> [max-age-days]
#
# The server leaks two things into the user's repo: worktree admin records under
# .git/worktrees, and refs under refs/prreview/. Neither is removed by anything
# git does on its own, and a worktree whose directory has been deleted keeps its
# branch claimed forever (see the .pr-review-84 record found live in iam-mono).
#
# Run this on server start and after every session close. It only ever touches
# worktrees whose path is inside the server's own cache dir, and refs under
# refs/prreview/ — never the user's own worktrees, branches or remotes.

set -euo pipefail
CLONE=${1:?clone path}
MAX_AGE_DAYS=${2:-7}
BR_CACHE=${BR_CACHE:-$HOME/.cache/better-review}

echo "gc: $CLONE (cache=$BR_CACHE, max-age=${MAX_AGE_DAYS}d)"

# 1. Worktrees we own: path under $BR_CACHE. Anything else is the user's.
git -C "$CLONE" worktree list --porcelain -z 2>/dev/null |
  tr '\0' '\n' | awk '/^worktree /{print $2}' |
  while read -r w; do
    case "$w" in
      "$BR_CACHE"/*) ;;
      *) continue ;;                       # not ours — leave strictly alone
    esac
    if [ ! -d "$w" ]; then
      echo "  stale record -> $w"
    elif [ -n "$(find "$w" -maxdepth 0 -mtime "+$MAX_AGE_DAYS" 2>/dev/null)" ]; then
      echo "  aged out -> $w"
    else
      continue
    fi
    git -C "$CLONE" worktree remove --force "$w" 2>/dev/null || true
  done

# 2. Do NOT run `git worktree prune`. It is unscoped: it reaps every dangling
#    admin record in the repo, including ones other tools (or the user) created.
#    Verified the hard way — an unscoped prune here removed an unrelated
#    `.pr-review-84` record left behind by a different tool. Nothing was lost
#    (prune never deletes branches or commits), but it is not ours to reap.
#    `worktree remove --force` in step 1 already drops the admin record for the
#    worktrees we own, which is the whole of our responsibility.

# 3. Our refs. Cheap to refetch, and they pin objects against gc.
git -C "$CLONE" for-each-ref 'refs/prreview/**' --format='%(refname)' |
  while read -r ref; do
    git -C "$CLONE" update-ref -d "$ref" && echo "  dropped $ref"
  done

echo "gc: done. remaining worktrees:"
git -C "$CLONE" worktree list
