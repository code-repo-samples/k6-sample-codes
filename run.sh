#!/usr/bin/env bash
# One command per generator VM:  ./run.sh <profile> [machine-id] [report-name]
#   ./run.sh smoke                          quick check, prints the report path
#   ./run.sh endurance gen1 endurance-run   5 h soak on this VM
# On a multi-VM run set SKIP_REPORT=1 on each VM, copy the JSON files
# from every VM into ONE folder, then run:  node report.js --dir <folder> --name <report-name>
set -euo pipefail
cd "$(dirname "$0")"

PROFILE="${1:-smoke}"
MACHINE="${2:-$(hostname)}"
NAME="${3:-k6-report}"
DIR="${REPORT_DIR:-./results}"

mkdir -p "$DIR"
k6 run k6-test.js -e RUN_PROFILE="$PROFILE" -e K6_MACHINE_ID="$MACHINE" \
    -e REPORT_NAME="$NAME" -e REPORT_DIR="$DIR" "${@:4}"

if [ "${SKIP_REPORT:-0}" != "1" ]; then
    node report.js --dir "$DIR" --name "$NAME"
fi
