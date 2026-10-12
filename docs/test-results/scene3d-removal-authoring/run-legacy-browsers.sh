#!/usr/bin/env bash
set -euo pipefail
base_removal=/tmp/viento-scene3d-removal-71u64wrk
export VIENTO_STUDIO_CORE_BIN="$base_removal/target/core/debug/viento-core"
export VIENTO_TEST_ARCHIVE_BINARY="$base_removal/targets/native/debug/examples/workspace-archive"
export VIENTO_MOBILE_STORE_BIN="$base_removal/targets/native/debug/examples/mobile-storage"
for kind_removal in copy objects preview; do
 export XDG_CONFIG_HOME="$base_removal/legacy-config/$kind_removal"
 export XDG_CACHE_HOME="$base_removal/legacy-cache/$kind_removal"
 export VIENTO_SCENE3D_OUTPUT="$base_removal/project/docs/test-results/scene3d-removal-authoring/browser-$kind_removal"
 mkdir -p "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME"
 src-tauri/binaries/viento-node-x86_64-unknown-linux-gnu "scripts/tests/scene3d-$kind_removal-smoke.mjs" > "docs/test-results/scene3d-removal-authoring/browser-$kind_removal.log" 2>&1
 done
