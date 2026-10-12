#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
version=v0.8.0-2
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) target=aarch64-apple-darwin ;;
  Linux-x86_64) target=x86_64-unknown-linux-gnu ;;
  Linux-aarch64) target=aarch64-unknown-linux-gnu ;;
  *) echo 'Install Arc Foundry from source for this platform: https://github.com/circlefin/arc-foundry'; exit 1 ;;
esac
archive="arc-foundry-${version}-${target}.tar.gz"
temp_dir=$(mktemp -d)
trap 'rm -rf "$temp_dir"' EXIT
base="https://github.com/circlefin/arc-foundry/releases/download/${version}"
curl --fail --location "$base/$archive" -o "$temp_dir/$archive"
curl --fail --location "$base/$archive.sha256" -o "$temp_dir/$archive.sha256"
(cd "$temp_dir" && shasum -a 256 -c "$archive.sha256")
mkdir -p .tools/arc
tar -xzf "$temp_dir/$archive" -C .tools/arc
.tools/arc/forge --version
git submodule update --init --recursive
