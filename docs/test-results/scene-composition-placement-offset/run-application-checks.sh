#!/usr/bin/env bash
set -euo pipefail
export VIENTO_CORE_TARGET_DIR=/tmp/viento-placement-offset-wasm-target
export VIENTO_STUDIO_CORE_BIN=/tmp/viento-placement-offset-core-target/debug/viento-core
export VIENTO_TEST_ARCHIVE_BINARY=/tmp/viento-placement-offset-native-target/debug/examples/workspace-archive
export VIENTO_MOBILE_STORE_BIN=/tmp/viento-placement-offset-native-target/debug/examples/mobile-storage
export VIENTO_GODOT_BIN=/home/chiharukiryu/.cache/io.viento.studio/toolchains/godot/4.7.2-stable/linux-x86_64/Godot_v4.7.2-stable_linux.x86_64
export VIENTO_BEVY_BIN=/home/chiharukiryu/.cache/io.viento.studio/toolchains/bevy/0.19.1/linux-x86_64/viento-bevy-runtime-0.3.0-0f15d7ad897a
export VIENTO_BEVY_OLD_BIN=/home/chiharukiryu/.cache/io.viento.studio/toolchains/bevy/0.19.1/linux-x86_64/viento-bevy-runtime-0.2.0-69cb452d306e
if [ "$1" = app ]; then
  src-tauri/binaries/viento-node-x86_64-unknown-linux-gnu scripts/check-project.mjs --app-only
elif [ "$1" = focus ]; then
  src-tauri/binaries/viento-node-x86_64-unknown-linux-gnu --test --test-concurrency=2 scripts/tests/scene-composition*.test.mjs scripts/tests/studio-core-composition*.test.mjs scripts/tests/scene-layout-canvas.test.mjs
else
  exit 2
fi
