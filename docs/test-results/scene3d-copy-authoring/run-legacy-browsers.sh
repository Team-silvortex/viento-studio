#!/usr/bin/env bash
set -euo pipefail
stage_copy=/tmp/viento-scene3d-copy-jxe_q12r/project
copy_base=/tmp/viento-scene3d-copy-jxe_q12r
cd "$stage_copy"
export VIENTO_STUDIO_CORE_BIN="$copy_base/targets/core/debug/viento-core"
export VIENTO_TEST_ARCHIVE_BINARY="$copy_base/targets/native-small/debug/examples/workspace-archive"
export VIENTO_MOBILE_STORE_BIN="$copy_base/targets/native-small/debug/examples/mobile-storage"
for copy_legacy in objects translation distribution preview; do
 export XDG_CONFIG_HOME="$copy_base/browser-config/$copy_legacy"
 export XDG_CACHE_HOME="$copy_base/browser-cache/$copy_legacy"
 export VIENTO_SCENE3D_OUTPUT="$stage_copy/docs/test-results/scene3d-copy-authoring/browser-$copy_legacy"
 mkdir -p "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME"
 src-tauri/binaries/viento-node-x86_64-unknown-linux-gnu "scripts/tests/scene3d-$copy_legacy-smoke.mjs" > "docs/test-results/scene3d-copy-authoring/browser-$copy_legacy.log" 2>&1
 done
