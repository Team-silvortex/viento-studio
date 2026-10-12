#!/usr/bin/env bash
set -euo pipefail
export VIENTO_GODOT_BIN=/home/chiharukiryu/.cache/io.viento.studio/toolchains/godot/4.7.2-stable/linux-x86_64/Godot_v4.7.2-stable_linux.x86_64
export VIENTO_BEVY_BIN=/home/chiharukiryu/.cache/io.viento.studio/toolchains/bevy/0.19.1/linux-x86_64/viento-bevy-runtime-0.3.0-0f15d7ad897a
export VIENTO_BEVY_OLD_BIN=/home/chiharukiryu/.cache/io.viento.studio/toolchains/bevy/0.19.1/linux-x86_64/viento-bevy-runtime-0.2.0-69cb452d306e
export VIENTO_STUDIO_CORE_BIN=/home/chiharukiryu/cdev/viento-studio/desktop/.cache/scene3d-transform-core-target/debug/viento-core
export VIENTO_TEST_ARCHIVE_BINARY=/home/chiharukiryu/cdev/viento-studio/desktop/.cache/scene3d-transform-native-target/debug/examples/workspace-archive
export VIENTO_MOBILE_STORE_BIN=/home/chiharukiryu/cdev/viento-studio/desktop/.cache/scene3d-transform-native-target/debug/examples/mobile-storage
export VIENTO_CORE_TARGET_DIR=/home/chiharukiryu/cdev/viento-studio/desktop/.cache/scene3d-transform-wasm-target
src-tauri/binaries/viento-node-x86_64-unknown-linux-gnu scripts/check-project.mjs --app-only
