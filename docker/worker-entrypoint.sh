#!/bin/sh
set -eu

sync_config() {
  source_dir=$1
  target_dir=$2
  mkdir -p "$target_dir"
  mkdir -p "$target_dir/sessions"

  for filename in auth.json config.toml; do
    if [ -f "$source_dir/$filename" ]; then
      rm -f "$target_dir/$filename"
      ln -s "$source_dir/$filename" "$target_dir/$filename"
    else
      rm -f "$target_dir/$filename"
    fi
  done
}

sync_config /host-config/.codex /root/.codex
sync_config /host-config/.grok /root/.grok

exec "$@"
