#!/bin/bash
# tests-ui/prepare.sh — build a throwaway database for the browser tests.
# ---------------------------------------------------------------------------
# The UI tests create a customer, an invoice, a payment and a bill payment, so
# they must NEVER run against your real expense-tracker.db.
#
# This script does exactly what was done while developing them:
#   • copies the project database to /tmp/smartspend-tests/ui.db  (a copy — your
#     file is opened read-only and is not modified),
#   • adds the business demo records to the copy,
#   • prints the command that starts a server on that copy (port 3100).
#
# Usage:   bash tests-ui/prepare.sh
#          PORT=3100 SMARTSPEND_DB=/tmp/smartspend-tests/ui.db npm start
#          node tests-ui/ui2.js
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORK_DIR="${SMARTSPEND_TEST_DIR:-/tmp/smartspend-tests}"
TARGET="$WORK_DIR/ui.db"

mkdir -p "$WORK_DIR"

if [ -f "$PROJECT_DIR/expense-tracker.db" ]; then
  cp "$PROJECT_DIR/expense-tracker.db" "$TARGET"
  echo "Copied your database to $TARGET (your file was not touched)."
else
  echo "No expense-tracker.db yet — the copy will be created empty by the server."
  rm -f "$TARGET"
fi

rm -f "$TARGET-wal" "$TARGET-shm"

cd "$PROJECT_DIR"
SMARTSPEND_DB="$TARGET" node scripts/seed-business-demo.js | tail -3

cat <<TXT

Ready. Now run, in two terminals:

  PORT=3100 SMARTSPEND_DB=$TARGET npm start
  node tests-ui/ui2.js          # 74 checks  (creates data — re-run prepare.sh after)
  node tests-ui/features.js     # 22 checks
  node tests-ui/authtest.js     # 21 checks
  node tests-ui/authtest2.js    # 14 checks
  node tests-ui/previewtest.js  #  9 checks (sandboxed iframe)

Add BASE=http://localhost:3100 if you changed the port.
TXT
