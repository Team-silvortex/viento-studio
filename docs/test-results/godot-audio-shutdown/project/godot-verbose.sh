#!/bin/bash
real_godot=/home/chiharukiryu/.cache/io.viento.studio/toolchains/godot/4.7.2-stable/linux-x86_64/Godot_v4.7.2-stable_linux.x86_64
if [[ "$1" == '--version' ]]; then
  exec "$real_godot" "$@"
fi
exec "$real_godot" --verbose "$@"
