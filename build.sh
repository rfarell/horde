#!/bin/sh
# Build the browser engine and assemble this folder for static hosting.
#
# Produces site/horde.wasm (SIMD, the default), site/horde-nosimd.wasm (for
# browsers without WebAssembly SIMD), copies the bundled networks and the
# engine catalogue, and runs the Node smoke test against the native engine when
# target/release/horde exists. Needs the wasm32-unknown-unknown target:
#     rustup target add wasm32-unknown-unknown
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

build() {
  cargo rustc --release --locked --lib --target wasm32-unknown-unknown --crate-type cdylib
  cp target/wasm32-unknown-unknown/release/horde.wasm "site/$1"
}

# .cargo/config.toml enables simd128 for the wasm target; RUSTFLAGS in the
# environment replaces those flags, which gives the scalar fallback.
build horde.wasm
RUSTFLAGS="-C strip=symbols" build horde-nosimd.wasm

mkdir -p site/networks
cp engines/networks/*.nnue site/networks/
cp engines/engines.json site/engines.json

ls -l site/horde.wasm site/horde-nosimd.wasm site/networks/*.nnue

if [ -x target/release/horde ]; then
  node site/test/wasm_smoke.mjs
else
  echo "Skipping the smoke test: build target/release/horde first (cargo build --release --locked)."
fi
