#!/usr/bin/env bash
# gate-honesty.sh -- the BAZR honesty gate
#
# Source: docs/relic-spec.md section 0, "Honesty constraints".
#   The relic score is a summary of survival signals, not a prediction of revival.
#   Hype vocabulary -- guaranteed / 100x / next pump and the like -- is kept out of the
#   code and out of the UI, everywhere.
#
# Usage
#   bash scripts/gate-honesty.sh            # scan this package
#   bash scripts/gate-honesty.sh <root>     # scan a different root (for control runs)
#   bash scripts/gate-honesty.sh --selftest # run the control group against the gate itself
#
# stdout is a fixed four lines (other people grep it). When there are violations the
# file:line:text hits come out before the verdict -- in output that gets truncated, the
# lines that matter have to come first.
#   [violation detail...]
#   scanned=<files examined>
#   exempted=<files excused, see below>
#   violations=<violating lines>
#   verdict=PASS|FAIL|SELF-FAIL
# Notes and reasons meant for a human all go to stderr.
#
# Exit code: 0=PASS  1=FAIL  2=SELF-FAIL
#
# Measurement discipline
#  - scanned=0 is not a pass. Having looked at nothing and having found nothing print the same thing -> SELF-FAIL + exit 2
#  - scanned-minus-exempted of 0 is not a pass either. If every candidate was excused,
#    nothing was actually read, and an exemption rule wide enough to swallow the tree has
#    to fail loudly instead of printing a perfect mark
#  - scanned is counted from the same list the real scan reads (the file list is built once and only it is read)
#  - excluding node_modules/ and build/ applies to the counting side and the reading side at once
#    (there is a single list, so the two cannot structurally diverge)
#  - grep -a really reads binaries as well (this closes the split where find counts a file and grep skips it)
#  - set -o pipefail is on and set -e is not. A legitimate zero hits (grep rc=1) must not kill the script
#  - a grep exit code of >=2 means "could not read", not "not there" -> SELF-FAIL + exit 2
#  - -c and -o are never combined (ugrep and GNU disagree on the value). Line counts use grep -c alone
#  - if reading one file twice gives two different values, the target changed mid-scan -> SELF-FAIL (concurrent sessions)
#  - every pattern carries word boundaries. Without them "shape in" matches "ape in" and
#    "management" matches "gem"; a gate that cries wolf gets switched off, and then it
#    protects nothing at all
#
# Exemptions. A quiet exemption is the same thing as a quiet pass, so every excused file is
# counted on stdout and named on stderr.
#  1. Control-group locations: anything under test/ or tests/, any *.test.* / *.spec.* code
#     file, and any gate-*.sh|mjs|js|py script. These are the files whose job is to name the
#     banned vocabulary in order to reject it -- an assertion such as
#     `const forbidden = /(guaranteed|100x)/i` is the ban being enforced, not broken. Counting
#     it as a violation makes writing the control group a punishable act, and then nobody
#     writes one. This file is in that set for the same reason: it carries the patterns.
#     Note that the rule needs a code extension and a dot separator, so a document such as
#     docs/relic-spec.md is NOT a test file and stays under the strictest reading.
#  2. Self-declared: any file containing the string bazr-honesty-allow-file on any line.
#     That is the project-wide marker for a file that has to enumerate the banned terms.
#  Neither exemption spreads to a neighbouring file. The control group below proves it.

set -u
set -o pipefail

MARKER='bazr-honesty-allow-file'

# Hype patterns. Used together with -i -- UI copy tends to shout these, as in "Guaranteed"
# or "MOON". Word boundaries are mandatory; see the discipline note above.
PAT="\\b(guaranteed|100x|1000x|moon ?shot|to the moon|moon|gem|gems|ape in|pump ?it|next pump|buy signal|risk ?free|can'?t lose|sure thing)\\b"

# Files whose reason for existing is to name the banned vocabulary.
EXEMPT_RE='(^|/)tests?/|(^|/)[^/]*\.(test|spec)\.(js|mjs|cjs|jsx|ts|tsx)$|(^|/)gate-[^/]*\.(sh|mjs|js|py)$'

TARGET_DIRS=("src" "scripts" "test")
TARGET_FILES=("manifest.json" "README.md")

scan() {
  local root_in="$1"

  if [ ! -d "$root_in" ]; then
    printf 'scanned=0\nexempted=0\nviolations=0\nverdict=SELF-FAIL\n'
    echo "SELF-FAIL: the scan root is not a directory: ${root_in}" >&2
    return 2
  fi

  (
    cd "$root_in" || {
      printf 'scanned=0\nexempted=0\nviolations=0\nverdict=SELF-FAIL\n'
      echo "SELF-FAIL: cannot enter the scan root: ${root_in}" >&2
      exit 2
    }
    root="$PWD"

    self_fail() { # $1=scanned $2=exempted $3=violations $4=reason
      printf 'scanned=%s\nexempted=%s\nviolations=%s\nverdict=SELF-FAIL\n' "$1" "$2" "$3"
      echo "SELF-FAIL: ${4}" >&2
      exit 2
    }

    grep_bin="$(command -v grep || true)"
    echo "note: root=${root}" >&2
    echo "note: grep=${grep_bin:-<none>} ($("${grep_bin:-grep}" --version 2>/dev/null | head -1))" >&2
    echo "note: targets=src/ scripts/ test/ manifest.json README.md / excluded=node_modules build .git" >&2

    # ---- Build the target list exactly once. The scan below reads nothing but this list. ----
    files=()
    for d in "${TARGET_DIRS[@]}"; do
      [ -d "$d" ] || continue
      while IFS= read -r -d '' f; do
        files+=("${f#./}")
      done < <(find "$d" \( -name node_modules -o -name build -o -name .git \) -prune -o -type f -print0 \
                 | LC_ALL=C sort -z)
    done
    for f in "${TARGET_FILES[@]}"; do
      [ -f "$f" ] && files+=("$f")
    done

    scanned="${#files[@]}"
    if [ "$scanned" -eq 0 ]; then
      self_fail 0 0 0 "there are 0 files to scan. Scanning an empty tree gives every check a perfect mark -- this zero is not a pass. root=${root}"
    fi

    # ---- Split the one list into read and excused. Both sides come from the same list, so
    #      the counted set and the read set cannot drift apart. ----
    kept=()
    exempt_paths=()
    for f in "${files[@]}"; do
      why=""
      if [[ $f =~ $EXEMPT_RE ]]; then
        why="control-group location"
      else
        "$grep_bin" -a -q -F -e "$MARKER" -- "$f"
        mrc=$?
        if [ "$mrc" -ge 2 ]; then
          self_fail "$scanned" "${#exempt_paths[@]}" 0 "grep rc=${mrc} while looking for the allow marker in ${f} -- this 0 does not mean 'not there', it means 'could not read'"
        fi
        [ "$mrc" -eq 0 ] && why="self-declared ${MARKER}"
      fi

      if [ -n "$why" ]; then
        exempt_paths+=("$f")
        echo "note: exempt: ${f} (${why})" >&2
      else
        kept+=("$f")
      fi
    done

    exempted="${#exempt_paths[@]}"
    effective="${#kept[@]}"
    if [ "$effective" -eq 0 ]; then
      self_fail "$scanned" "$exempted" 0 "every one of the ${scanned} candidate files was exempt, so nothing was actually read. An exemption rule that swallows the whole tree is not a pass. root=${root}"
    fi

    # ---- The scan ----
    violations=0
    detail=""
    for f in "${kept[@]}"; do
      hits="$("$grep_bin" -a -n -H -i -E -- "$PAT" "$f")"
      rc=$?
      if [ "$rc" -ge 2 ]; then
        self_fail "$scanned" "$exempted" "$violations" "grep rc=${rc} on ${f} -- this 0 does not mean 'not there', it means 'could not read'"
      fi
      [ "$rc" -eq 1 ] && continue

      # Line counts come from grep -c on its own (-c and -o are never combined)
      cnt="$("$grep_bin" -a -c -i -E -- "$PAT" "$f")"
      rc2=$?
      if [ "$rc2" -ge 2 ]; then
        self_fail "$scanned" "$exempted" "$violations" "grep -c rc=${rc2} on ${f} -- could not read"
      fi
      # If reading one file twice gives two different values, the target changed mid-scan (concurrent sessions)
      shown="$(printf '%s\n' "$hits" | wc -l)"
      if [ "$cnt" != "$shown" ]; then
        self_fail "$scanned" "$exempted" "$violations" "two measurements of the same file disagree (${f}: grep -c=${cnt} / detail=${shown}). The target changed mid-scan -- this value was taken of a half-written state"
      fi

      violations=$((violations + cnt))
      detail+="${hits}"$'\n'
    done

    # ---- Output: violation detail ahead of the verdict ----
    if [ "$violations" -gt 0 ]; then
      printf '%s' "$detail"
    fi
    echo "scanned=${scanned}"
    echo "exempted=${exempted}"
    echo "violations=${violations}"
    if [ "$violations" -gt 0 ]; then
      echo "verdict=FAIL"
      echo "FAIL: hype vocabulary is still present. docs/relic-spec.md section 0 -- the relic score is a summary of survival signals, not a prediction of revival." >&2
      exit 1
    fi
    echo "verdict=PASS"
    exit 0
  )
}

# ---- Control group -----------------------------------------------------------------
# Watching only for the alarm and never for the silence lets a detector that always fails
# pass as well. Both directions are checked here, and every exemption gets a paired case
# proving it does not spread to the file next door.
selftest() {
  local d ok=0 fail=0
  d="$(mktemp -d)" || return 2

  chk() { # $1=label $2=expected exit $3=actual exit
    if [ "$2" = "$3" ]; then ok=$((ok + 1)); echo "  ok   $1 (exit=$3)"
    else fail=$((fail + 1)); echo "  FAIL $1 (expected exit=$2, got $3)"; fi
  }

  # (1) does it fire on a real violation
  mkdir -p "$d/dirty/src"
  printf '%s\n' 'export const copy = "a guaranteed 100x, straight to the moon";' > "$d/dirty/src/a.js"
  scan "$d/dirty" >/dev/null 2>&1; chk "fires on hype copy" 1 $?

  # (2) does it stay silent on clean input
  mkdir -p "$d/clean/src"
  printf '%s\n' 'export const copy = "A summary of survival signals, not a prediction.";' > "$d/clean/src/a.js"
  scan "$d/clean" >/dev/null 2>&1; chk "silent on clean copy" 0 $?

  # (3) substring regression -- the reason every pattern carries word boundaries.
  #     "shape in" is not "ape in" and "management" is not "gem".
  mkdir -p "$d/fp/src"
  printf '%s\n' '// Checks that it holds to the wire shape in docs/api-contract.md' > "$d/fp/src/a.js"
  printf '%s\n' 'const managementFee = 0; // landscape in view, escape into detail' >> "$d/fp/src/a.js"
  scan "$d/fp" >/dev/null 2>&1; chk "no substring false positives" 0 $?

  # (4) user-facing files at the root are really read
  mkdir -p "$d/rootfile/src"
  printf '%s\n' 'export const ok = 1;' > "$d/rootfile/src/a.js"
  printf '%s\n' 'This token is a guaranteed 100x.' > "$d/rootfile/README.md"
  scan "$d/rootfile" >/dev/null 2>&1; chk "README.md is scanned" 1 $?

  # (5) the control group's own assertions are excused
  mkdir -p "$d/exempt/src" "$d/exempt/test"
  printf '%s\n' 'export const ok = 1;' > "$d/exempt/src/a.js"
  printf '%s\n' 'const forbidden = /\b(guaranteed|100x|moon|gem)\b/i;' > "$d/exempt/test/a.test.js"
  scan "$d/exempt" >/dev/null 2>&1; chk "test assertions excused" 0 $?

  # (6) and the excuse does not spread to the file next door
  mkdir -p "$d/spill/src" "$d/spill/test"
  printf '%s\n' 'const forbidden = /\b(guaranteed|100x)\b/i;' > "$d/spill/test/a.test.js"
  printf '%s\n' 'export const tagline = "a guaranteed 100x";' > "$d/spill/src/ui.js"
  scan "$d/spill" >/dev/null 2>&1; chk "exemption does not spill from test/" 1 $?

  # (7) a file may excuse itself with the marker
  mkdir -p "$d/marker/src"
  printf '%s\n' 'export const ok = 1;' > "$d/marker/src/a.js"
  printf '// bazr-honesty-%s: denylist constant below\n' 'allow-file' > "$d/marker/src/denylist.js"
  printf '%s\n' 'export const BANNED = ["guaranteed", "moon", "gem", "100x"];' >> "$d/marker/src/denylist.js"
  scan "$d/marker" >/dev/null 2>&1; chk "self-declared marker excused" 0 $?

  # (8) and that excuse does not spread either
  mkdir -p "$d/markerspill/src"
  printf '// bazr-honesty-%s: denylist constant below\n' 'allow-file' > "$d/markerspill/src/denylist.js"
  printf '%s\n' 'export const BANNED = ["guaranteed", "100x"];' >> "$d/markerspill/src/denylist.js"
  printf '%s\n' 'export const tagline = "a guaranteed 100x";' > "$d/markerspill/src/ui.js"
  scan "$d/markerspill" >/dev/null 2>&1; chk "marker does not spill" 1 $?

  # (9) a gate script is excused wherever it lives
  mkdir -p "$d/gate/src" "$d/gate/scripts"
  printf '%s\n' 'export const ok = 1;' > "$d/gate/src/a.js"
  printf '%s\n' 'PAT="guaranteed|100x|moon|gem"' > "$d/gate/scripts/gate-other.sh"
  scan "$d/gate" >/dev/null 2>&1; chk "gate-*.sh excused" 0 $?

  # (10) but a script that merely starts with the same letters is not a gate
  mkdir -p "$d/notgate/scripts"
  printf '%s\n' 'echo "a guaranteed 100x"' > "$d/notgate/scripts/gateway.sh"
  scan "$d/notgate" >/dev/null 2>&1; chk "gateway.sh is not excused" 1 $?

  # (11) a specification document is not a test file. Prose about the product is exactly
  #      where the strictest reading belongs.
  mkdir -p "$d/specdoc/src"
  printf '%s\n' 'This token is a guaranteed 100x.' > "$d/specdoc/src/relic-spec.md"
  scan "$d/specdoc" >/dev/null 2>&1; chk "*-spec.md is not excused" 1 $?

  # (12) nothing to read is a block, not a pass
  scan "$d/does-not-exist" >/dev/null 2>&1; chk "missing root -> SELF-FAIL" 2 $?
  mkdir -p "$d/empty"
  scan "$d/empty" >/dev/null 2>&1; chk "empty root -> SELF-FAIL" 2 $?

  # (13) an exemption rule that swallows everything is a block too
  mkdir -p "$d/allexempt/test"
  printf '%s\n' 'const forbidden = /\b(guaranteed|100x)\b/i;' > "$d/allexempt/test/a.test.js"
  scan "$d/allexempt" >/dev/null 2>&1; chk "all files exempt -> SELF-FAIL" 2 $?

  rm -rf "$d"
  echo "selftest ok=${ok} fail=${fail}"
  [ "$fail" -eq 0 ] || return 1
  return 0
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "${1:-}" = "--selftest" ]; then
  selftest
  exit $?
fi

if [ "$#" -ge 1 ]; then
  scan "$1"
else
  scan "$(dirname "$SCRIPT_DIR")"
fi
exit $?
