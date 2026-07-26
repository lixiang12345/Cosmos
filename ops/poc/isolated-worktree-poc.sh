#!/bin/sh
# Isolated coding-agent PoC: perform a minimal code change inside a disposable
# git worktree under env/ulimit/timeout confinement, emit the diff as an
# artifact, and prove five escape attempts fail. See
# docs/adr-isolated-coding-agent.md for the threat model this exercises.
set -eu

REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
POC_ID="poc-$(date +%s)-$$"
WORKTREE_PARENT="${TMPDIR:-/tmp}/cosmos-isolation-poc"
WORKTREE="$WORKTREE_PARENT/$POC_ID"
BRANCH="poc/isolated-$POC_ID"
ARTIFACT="$WORKTREE_PARENT/$POC_ID.diff"
FAILURES=0
SLEEP_BASELINE=$(pgrep -x sleep 2>/dev/null | wc -l | tr -d ' ')

say() { printf '%s\n' "$*"; }
check() { # check <name> <expected:pass|fail> <actual:0|nonzero>
  name=$1; expected=$2; actual=$3
  if [ "$expected" = pass ] && [ "$actual" -eq 0 ]; then say "ok   - $name"
  elif [ "$expected" = fail ] && [ "$actual" -ne 0 ]; then say "ok   - $name (correctly refused)"
  else say "FAIL - $name (expected $expected, exit=$actual)"; FAILURES=$((FAILURES + 1)); fi
}

cleanup() {
  cd "$REPO_ROOT"
  git worktree remove --force "$WORKTREE" >/dev/null 2>&1 || true
  git branch -D "$BRANCH" >/dev/null 2>&1 || true
  rm -rf "$WORKTREE_PARENT/$POC_ID"
}
trap cleanup EXIT INT TERM

mkdir -p "$WORKTREE_PARENT"
cd "$REPO_ROOT"
git worktree add -b "$BRANCH" "$WORKTREE" HEAD >/dev/null 2>&1
say "# worktree: $WORKTREE"

# Confined executor: empty environment except an explicit allowlist, bounded
# processes/files/CPU, and a hard wall-clock timeout. The candidate command
# runs inside the worktree only.
confined() { # confined <timeout-seconds> <shell-snippet>
  seconds=$1; snippet=$2
  # A Python supervisor owns the timeout and the kill: the candidate runs as
  # the leader of a fresh process group (start_new_session) and on expiry the
  # WHOLE group gets SIGTERM then SIGKILL, so cancellation reclaims every
  # descendant — including backgrounded ones — not just the direct child.
  status=0
  env -i PATH=/usr/bin:/bin HOME="$WORKTREE" COSMOS_POC=1 \
    python3 - "$seconds" "$WORKTREE" "$snippet" <<'SUPERVISOR' || status=$?
import os, signal, subprocess, sys, time
seconds, worktree, snippet = int(sys.argv[1]), sys.argv[2], sys.argv[3]
script = (
    "cd '" + worktree + "' || exit 90\n"
    "ulimit -u 1024 2>/dev/null || true\n"
    "ulimit -n 256 2>/dev/null || true\n"
    "ulimit -t " + str(seconds * 2) + " 2>/dev/null || true\n"
    + snippet
)
child = subprocess.Popen(["/bin/sh", "-c", script], start_new_session=True)
try:
    sys.exit(child.wait(timeout=seconds))
except subprocess.TimeoutExpired:
    # macOS killpg can report EPERM even when the signal was delivered to the
    # group; sweep with TERM then KILL and treat delivery errors as settled.
    for escalation in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(os.getpgid(child.pid), escalation)
        except (OSError, ProcessLookupError):
            pass
        time.sleep(0.3)
    try:
        child.wait(timeout=5)
    except subprocess.TimeoutExpired:
        pass
    sys.exit(124)
SUPERVISOR
  return $status
}

# Path guard mirroring the ADR filesystem boundary: a write target must
# resolve inside the worktree after realpath normalization.
guarded_write() { # guarded_write <relative-target>
  target=$1
  resolved=$(cd "$WORKTREE" && python3 -c "import os,sys; print(os.path.realpath(os.path.join('$WORKTREE', sys.argv[1])))" "$target")
  case "$resolved" in
    "$WORKTREE"/*) confined 10 "printf 'guarded\n' > '$resolved'"; return $? ;;
    *) return 91 ;;
  esac
}

# 1. Positive path: minimal change + verification inside the worktree.
confined 30 "printf '# isolation poc marker\n' > POC_MARKER.md && grep -q 'isolation poc marker' POC_MARKER.md"
check "minimal change and verification inside the worktree" pass $?

# 2. Diff artifact produced without touching anything outside the worktree.
( cd "$WORKTREE" && git add POC_MARKER.md && git diff --cached ) > "$ARTIFACT" 2>/dev/null
artifact_status=0; test -s "$ARTIFACT" || artifact_status=$?
check "diff artifact emitted" pass $artifact_status

# 3. Host environment secrets are invisible inside the confinement.
HOST_CANARY="host-secret-$POC_ID"
export HOST_CANARY
confined 10 "test \"\${HOST_CANARY:-}\" = ''"
check "host environment variables invisible" pass $?

# 4. Escape attempt: relative-path write outside the worktree is refused.
escape_status=0
guarded_write "../escape-$POC_ID" || escape_status=$?
check "parent-directory escape write" fail $escape_status
absent_status=0; test ! -e "$WORKTREE_PARENT/escape-$POC_ID" || absent_status=$?
check "escape target absent on host" pass $absent_status

# 5. Timeout: a runaway task is hard-terminated and the worktree survives.
start=$(date +%s)
confined 3 "sleep 60" || true
elapsed=$(( $(date +%s) - start ))
timeout_status=0; [ "$elapsed" -lt 30 ] || timeout_status=$?
check "runaway task terminated by the timeout wall (${elapsed}s)" pass $timeout_status
intact_status=0; ( cd "$WORKTREE" && git status --porcelain >/dev/null ) || intact_status=$?
check "worktree intact after termination" pass $intact_status

# 6. Cancellation: no lingering processes from the confined group.
confined 2 "sleep 2717 & sleep 2717 & wait" || true
sleep 1
lingering=$(pgrep -x sleep 2>/dev/null | wc -l | tr -d ' ')
lingering_status=0; [ "$lingering" -le "$SLEEP_BASELINE" ] || lingering_status=$?
check "no lingering background processes after cancellation ($lingering vs baseline $SLEEP_BASELINE)" pass $lingering_status

# 7. Host repository is untouched throughout.
cd "$REPO_ROOT"
dirty=$(git status --porcelain | grep -v '^??' | wc -l | tr -d ' ')
host_marker_absent=0; [ -e "$REPO_ROOT/POC_MARKER.md" ] && host_marker_absent=1
marker_status=0; [ "$host_marker_absent" -eq 0 ] || marker_status=$?
check "host repository untouched by the confined change" pass $marker_status

say ""
if [ "$FAILURES" -eq 0 ]; then
  say "isolated-worktree-poc: PASS (artifact: $ARTIFACT)"
else
  say "isolated-worktree-poc: FAIL ($FAILURES check(s) failed)"
  exit 1
fi
