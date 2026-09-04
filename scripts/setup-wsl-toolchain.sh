#!/usr/bin/env bash
# =============================================================================
# VERITY — WSL Cairo toolchain bootstrap (reproducible, version-pinned).
#
# Why WSL?
#   Starknet Foundry (snforge/sncast) publishes NO native Windows binaries for
#   v0.63.0 (verified against the GitHub release assets on 2026-09-03).
#   The officially supported Windows path is WSL (or Docker). Ubuntu-24.04 is
#   used here. Scarb still ships a native Windows build (x86_64-pc-windows-msvc),
#   but keeping BOTH Cairo tools in the same Linux environment avoids PATH and
#   toolchain skew between `scarb` and `snforge test`.
#
# Pinned versions (see docs/STRK20_INTEGRATION.md §"Compatibility baseline"):
#   Scarb            2.20.1   (current stable, matches spec baseline)
#   Starknet Foundry 0.63.0   (current stable; snforge_std 0.63.0 is the version
#                               the official starknet-privacy workspace pins)
#   Cairo edition     2024_07
#
# Usage:
#   wsl -d Ubuntu-24.04 -- bash /mnt/c/<path-to-repo>/scripts/setup-wsl-toolchain.sh
# =============================================================================
set -euo pipefail

SCARB_VERSION="2.20.1"
FOUNDRY_VERSION="0.63.0"
SCARB_ARCH="x86_64-unknown-linux-gnu"
FOUNDRY_ARCH="x86_64-unknown-linux-musl"

BIN_DIR="$HOME/.local/bin"
SCARB_DIR="$HOME/.scarb"
FOUNDRY_DIR="$HOME/.starknet-foundry"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

mkdir -p "$BIN_DIR" "$SCARB_DIR" "$FOUNDRY_DIR" "$WORK_DIR"
cd "$WORK_DIR"

log() { printf '\n=== %s ===\n' "$*"; }

log "Downloading Scarb ${SCARB_VERSION} (${SCARB_ARCH})"
curl --fail --location --silent --show-error \
  -o scarb.tar.gz \
  "https://github.com/software-mansion/scarb/releases/download/v${SCARB_VERSION}/scarb-v${SCARB_VERSION}-${SCARB_ARCH}.tar.gz"
tar -xzf scarb.tar.gz -C "$SCARB_DIR" --strip-components=1
ln -sf "$SCARB_DIR/bin/scarb" "$BIN_DIR/scarb"

log "Downloading Starknet Foundry ${FOUNDRY_VERSION} (${FOUNDRY_ARCH})"
curl --fail --location --silent --show-error \
  -o foundry.tar.gz \
  "https://github.com/foundry-rs/starknet-foundry/releases/download/v${FOUNDRY_VERSION}/starknet-foundry-v${FOUNDRY_VERSION}-${FOUNDRY_ARCH}.tar.gz"

# Extract while locating the actual bin/ prefix inside the archive.
# `grep -m1` closes the pipe after the first match, which can raise SIGPIPE in
# `tar` (exit 141 with `pipefail`); the `|| true` guard keeps the pipeline from
# aborting the script. Extracts into the PERSISTENT $FOUNDRY_DIR, never into
# $WORK_DIR (the trap on EXIT would otherwise leave the symlinks dangling).
FOUNDRY_BIN_REL="$(tar -tzf foundry.tar.gz 2>/dev/null | grep -m1 '/bin/snforge$' || true)"
FOUNDRY_PREFIX="${FOUNDRY_BIN_REL%/bin/snforge}"
tar -xzf foundry.tar.gz -C "$FOUNDRY_DIR"
ln -sf "$FOUNDRY_DIR/$FOUNDRY_PREFIX/bin/snforge" "$BIN_DIR/snforge"
ln -sf "$FOUNDRY_DIR/$FOUNDRY_PREFIX/bin/sncast" "$BIN_DIR/sncast"

# Persist PATH for WSL users of this distro.
PROFILE="$HOME/.bashrc"
if ! grep -q "$BIN_DIR" "$PROFILE"; then
  printf '\nexport PATH="%s:$PATH"\n' "$BIN_DIR" >> "$PROFILE"
fi
export PATH="$BIN_DIR:$PATH"

log "Verifying installed toolchain versions"
scarb --version
snforge --version
sncast --version

log "Installed into:"
echo "  $BIN_DIR/scarb   -> $SCARB_DIR/bin/scarb"
echo "  $BIN_DIR/snforge -> $FOUNDRY_DIR/$FOUNDRY_PREFIX/bin/snforge"
echo "  $BIN_DIR/sncast  -> $FOUNDRY_DIR/$FOUNDRY_PREFIX/bin/sncast"