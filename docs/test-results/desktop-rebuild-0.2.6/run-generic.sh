#!/usr/bin/env bash
set -euo pipefail
cd "${VIENTO_TEST_REPO:?set the repository path}"
: "${VIENTO_TEST_DRIVER_DIR:?set the prepared driver directory}"
export PATH="${VIENTO_TEST_REPO}/dist/handoff-0.0.1/tools/input/usr/bin:$PATH"
export LD_LIBRARY_PATH="${VIENTO_TEST_REPO}/dist/handoff-0.0.1/tools/input/usr/lib/x86_64-linux-gnu"
export VIENTO_TEST_XDOTOOL="${VIENTO_TEST_REPO}/dist/handoff-0.0.1/tools/input/usr/bin/xdotool"
export VIENTO_TEST_SCREENSHOT_DIR="${VIENTO_TEST_SCREENSHOT_DIR:?set a fresh evidence directory}"
export VIENTO_TEST_GENERIC_CREATE="${VIENTO_TEST_REPO}/src-tauri/target/release/examples/workspace-archive"
export VIENTO_TEST_FIELDS=1 VIENTO_TEST_LANGUAGE=1 VIENTO_EXPECT_APP_VERSION=0.2.6
python3 "${VIENTO_TEST_DRIVER_DIR}/native-generic-smoke.py" dist/handoff-0.0.1/tools/bin/tauri-driver dist/handoff-0.0.1/tools/webkit/usr/bin/WebKitWebDriver "${1:?set package binary}"
