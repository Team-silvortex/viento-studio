#!/bin/sh
# System media codecs complement the portable application.
export GST_PLUGIN_PATH_1_0="${GST_PLUGIN_PATH_1_0:+$GST_PLUGIN_PATH_1_0:}/usr/lib/x86_64-linux-gnu/gstreamer-1.0"
# Local trusted Godot default; explicit caller configuration remains authoritative.
if [ -z "${VIENTO_GODOT_BIN+x}" ] && [ -x /home/chiharukiryu/.cache/io.viento.studio/toolchains/godot/4.7.2-stable/linux-x86_64/Godot_v4.7.2-stable_linux.x86_64 ]; then
  export VIENTO_GODOT_BIN=/home/chiharukiryu/.cache/io.viento.studio/toolchains/godot/4.7.2-stable/linux-x86_64/Godot_v4.7.2-stable_linux.x86_64
fi
exec /home/chiharukiryu/.local/opt/viento-studio/Viento-Studio.AppImage "$@"
