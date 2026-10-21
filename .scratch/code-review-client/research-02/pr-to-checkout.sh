#!/usr/bin/env bash
# pr-to-checkout.sh — reference implementation of the PR -> local checkout sequence.
#
#   ./pr-to-checkout.sh <owner> <repo> <pr-number> [clone-path]
#
# Proves out the sequence the local server should run. Read-only with respect to
# the user's working tree: it never checks out, never switches branches, never
# writes to refs/heads or refs/remotes. It adds refs under refs/prreview/ and a
# detached worktree under $BR_CACHE.
#
# Exit codes: 0 ok, 2 fatal (no clone / no access), 3 recoverable-but-unresolved.

set -euo pipefail

OWNER=${1:?owner}; REPO=${2:?repo}; PR=${3:?pr number}
BR_CACHE=${BR_CACHE:-$HOME/.cache/better-review}
CLONE=${4:-}

log() { printf '\033[2m[%s]\033[0m %s\n' "$(date +%T)" "$*" >&2; }

# ---------------------------------------------------------------- 1. metadata
log "1. PR metadata (1 API call)"
META=$(gh api "/repos/$OWNER/$REPO/pulls/$PR")
jq_() { printf '%s' "$META" | jq -r "$1"; }   # printf, NOT echo: zsh echo eats \escapes

HEAD_SHA=$(jq_ .head.sha)
BASE_REF=$(jq_ .base.ref)
BASE_SHA=$(jq_ .base.sha)          # tip of base branch at read time - NOT the merge base
HEAD_REPO=$(jq_ '.head.repo.full_name // "«deleted fork»"')
IS_FORK=$(jq_ '.head.repo.fork // false')
log "   head=$HEAD_SHA ($HEAD_REPO, fork=$IS_FORK)  base=$BASE_REF@$BASE_SHA"

# ------------------------------------------------------- 2. locate the clone
if [ -z "$CLONE" ]; then
  log "2. locating clone for $OWNER/$REPO"
  CLONE=$(
    find "$HOME/code" -mindepth 2 -maxdepth 2 -name .git -type d 2>/dev/null |
    while read -r g; do
      r=${g%/.git}
      u=$(git -C "$r" remote get-url origin 2>/dev/null) || continue
      # normalise all four URL shapes to owner/repo
      n=$(printf '%s' "$u" | sed -E 's#^(git@|ssh://git@|https://)([^:/]+)[:/]##; s#\.git$##')
      [ "$n" = "$OWNER/$REPO" ] && { printf '%s' "$r"; break; }
    done
  )
fi
[ -n "$CLONE" ] || { log "FATAL: no local clone for $OWNER/$REPO"; exit 2; }
log "   clone=$CLONE"

# ------------------------------------- 3. fetch PR head + base (no checkout)
# refs/pull/N/head lives in the BASE repo even for fork PRs, so one fetch from
# origin covers forks, deleted branches and merged PRs alike.
log "3. fetch refs/pull/$PR/head + base branch into refs/prreview/ (0 API calls)"
git -C "$CLONE" fetch --no-tags --no-write-fetch-head --quiet origin \
  "+refs/pull/$PR/head:refs/prreview/$PR/head" \
  "+refs/heads/$BASE_REF:refs/prreview/$PR/base"

# ------------------------------------------------- 4. THE MERGE BASE (locally)
# This is the whole ballgame. GitHub's PR view is a THREE-DOT diff:
#   merge-base(base, head) .. head
# base.sha drifts ahead of the merge base as the base branch moves, so diffing
# against base.sha (two-dot) invents changes the PR never made.
log "4. merge base"
MERGE_BASE=$(git -C "$CLONE" merge-base "refs/prreview/$PR/base" "refs/prreview/$PR/head")
log "   merge-base = $MERGE_BASE   (base.sha was $BASE_SHA)"
[ "$MERGE_BASE" = "$BASE_SHA" ] && log "   (they happen to coincide here)" \
                                || log "   *** base.sha != merge-base: two-dot would be WRONG ***"

# ----------------------------------------------------------- 5. changed files
log "5. changed files, computed locally from the merge base (0 API calls)"
git -C "$CLONE" diff --merge-base --name-status -M --find-renames \
  "refs/prreview/$PR/base" "refs/prreview/$PR/head" > "$BR_CACHE/tmp-status.txt" 2>/dev/null ||
git -C "$CLONE" diff --name-status -M "$MERGE_BASE" "refs/prreview/$PR/head" > "$BR_CACHE/tmp-status.txt"
log "   $(wc -l < "$BR_CACHE/tmp-status.txt") changed files"

# --------------------------------------------------------------- 6. commits
# git log MERGE_BASE..head  (TWO-dot). Note the trap: for `git log`, A...B means
# symmetric difference and would wrongly include commits from the base side.
log "6. commit list with full messages (0 API calls)"
NCOMMITS=$(git -C "$CLONE" rev-list --count "$MERGE_BASE..refs/prreview/$PR/head")
log "   $NCOMMITS commits (API reported $(jq_ .commits); API caps at 250)"

# ------------------------------------------------------------- 7. worktree
# --detach is mandatory: a named branch cannot be checked out in two worktrees,
# and the branch under review is very often the one the user already has out.
WT="$BR_CACHE/worktrees/$OWNER-$REPO/pr-$PR"
log "7. worktree at $WT"
if [ -d "$WT" ]; then
  CUR=$(git -C "$WT" rev-parse HEAD 2>/dev/null || echo none)
  if [ "$CUR" = "$HEAD_SHA" ]; then log "   reusing (already at head)"
  else log "   moving $CUR -> $HEAD_SHA"; git -C "$WT" checkout --detach --quiet "$HEAD_SHA"; fi
else
  mkdir -p "$(dirname "$WT")"
  git -C "$CLONE" worktree add --detach --quiet "$WT" "$HEAD_SHA"
fi

# ------------------------------------------- 8. make it language-server ready
# Go/Rust resolve deps from a machine-global module cache: nothing to do.
# Node resolves from a repo-local node_modules that a fresh worktree does not
# have, so tsserver would see ~unresolvable imports everywhere. Symlink the main
# clone's installs across - instant, and correct whenever the lockfile matches.
log "8. language-server prerequisites"
if [ -f "$WT/package.json" ]; then
  LOCK_WT=$(git -C "$CLONE" rev-parse "refs/prreview/$PR/head:pnpm-lock.yaml" 2>/dev/null || echo -)
  LOCK_MAIN=$( [ -f "$CLONE/pnpm-lock.yaml" ] && git -C "$CLONE" hash-object "$CLONE/pnpm-lock.yaml" || echo = )
  [ "$LOCK_WT" = "$LOCK_MAIN" ] && log "   lockfile matches main clone -> symlink is sound" \
                                || log "   WARNING lockfile differs -> symlinked deps may be stale"
  find "$CLONE" -maxdepth 3 -name node_modules -type d -not -path '*/node_modules/*' 2>/dev/null |
  while read -r nm; do
    rel=${nm#"$CLONE"/}; tgt="$WT/$rel"
    [ -d "$(dirname "$tgt")" ] && ln -sfn "$nm" "$tgt" && log "   linked $rel"
  done
fi

log "DONE. worktree=$WT  merge_base=$MERGE_BASE  head=$HEAD_SHA"
printf '%s\n' "$WT"
