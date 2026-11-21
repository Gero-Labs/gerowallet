#!/usr/bin/env bash
# In-container build script (the image's entrypoint). See README.md.
#
#   build.sh [variant ...]   variants: st mt mt-simd mt-upstream   default: st mt
#
# Mounts expected:
#   /out                         bind mount; receives <variant>/ and HASHES.txt
#   /target                      named volume (cargo target dirs, one per variant)
#   /usr/local/cargo/registry    named volume (crates.io download cache)
#   /usr/local/cargo/git         named volume (git dependency cache)
set -euo pipefail

SRC=/src/midnight-ledger
OUT=${OUT:-/out}
TARGET_ROOT=${TARGET_ROOT:-/target}
STAGE=/tmp/stage

# Upstream's recipe (wasm-proving-demos/run.sh):
#   RUSTC_BOOTSTRAP=1 RUSTFLAGS='-C target-feature=+atomics,+bulk-memory' \
#     wasm-pack build --target web . -- -Z build-std=panic_abort,std
UPSTREAM_MT_FEATURES='+atomics,+bulk-memory'
# "flags minus atomics" for the single-threaded control.
ST_FEATURES='+bulk-memory'

# Deviation 1 (see README.md): upstream's flags alone no longer give a threaded
# module. Up to Rust 1.91 rustc added these linker arguments by itself whenever
# `atomics` was enabled; since 1.92 it does not, and the pinned toolchain is
# 1.95.0. Without them the memory is neither shared nor imported and
# wasm-bindgen adds no thread support at all. They are the arguments rustc 1.91
# passed, except for the maximum:
#   rustc used --max-memory=1073741824 (1 GiB). A shared memory must declare a
#   maximum; this build declares the wasm32 limit, 4 GiB (65536 pages). The
#   embedder may still pass its own WebAssembly.Memory with a smaller maximum.
MT_MAX_MEMORY=${MT_MAX_MEMORY:-4294967296}
MT_LINK_ARGS="-C link-arg=--shared-memory -C link-arg=--max-memory=${MT_MAX_MEMORY} -C link-arg=--import-memory -C link-arg=--export=__wasm_init_tls -C link-arg=--export=__tls_size -C link-arg=--export=__tls_align -C link-arg=--export=__tls_base"

# Deviation 2 (see README.md): two edits to wasm-bindgen-rayon's worker helper
# (snippets/wasm-bindgen-rayon-*/src/workerHelpers.js), a JS file, after the
# build. The .wasm is not affected by either.
#
# a) Stack given to every thread after the first. wasm-bindgen 0.2.108 hardcodes
#    2 MiB as the default; the only knob is the `thread_stack_size` field of the
#    init object, which the helper does not pass. 0 = leave it (2 MiB). Must be
#    a multiple of 65536.
MT_THREAD_STACK_SIZE=${MT_THREAD_STACK_SIZE:-8388608}
# b) The helper loads the main module with `import('../../..')`, a directory
#    import only a bundler can resolve. 1 = name the file instead, so the package
#    also runs as plain files (the other upstream helper, feature `no-bundler`,
#    starts its workers from blob: URLs, which an extension CSP forbids).
MT_EXPLICIT_MAIN_IMPORT=${MT_EXPLICIT_MAIN_IMPORT:-1}

variants=("$@")
if [ ${#variants[@]} -eq 0 ]; then variants=(st mt); fi

echo "== toolchain"
rustc -vV
cargo -V
wasm-pack --version
wasm-bindgen --version
wasm-opt --version
"${CC_wasm32_unknown_unknown}" --version | head -1
echo "source commit: $(git -C "$SRC" rev-parse HEAD)"
test "$(git -C "$SRC" rev-parse HEAD)" = "$LEDGER_COMMIT"

build() {
  local name=$1 crate=$2 rustflags=$3
  echo
  echo "== building $name ($crate)"
  echo "   RUSTFLAGS=$rustflags"
  rm -rf "${STAGE:?}/$name"
  mkdir -p "$STAGE"
  (
    cd "$SRC/$crate"
    RUSTC_BOOTSTRAP=1 \
    RUSTFLAGS="$rustflags" \
    CARGO_TARGET_DIR="$TARGET_ROOT/$name" \
      wasm-pack build --mode no-install --target web --out-dir "$STAGE/$name" . \
        -- --locked -Z build-std=panic_abort,std
  )
}

patch_worker_helper() {
  local dir=$1 glue=$2 helper
  helper=$(find "$dir/snippets" -name workerHelpers.js)
  [ "$(echo "$helper" | wc -l)" -eq 1 ] && [ -f "$helper" ] || { echo "workerHelpers.js not found exactly once" >&2; exit 1; }
  [ -f "$dir/$glue" ] || { echo "glue $glue not found" >&2; exit 1; }
  replace_once() { # file, exact text, replacement: fails unless the text is there exactly once
    [ "$(grep -cF -- "$2" "$1")" -eq 1 ] || { echo "unexpected $(basename "$1"): '$2' not found exactly once" >&2; exit 1; }
    sed -i "s|$2|$3|" "$1"
    grep -nF -- "$3" "$1"
  }
  local changed=0
  if [ "$MT_THREAD_STACK_SIZE" != 0 ]; then
    [ $((MT_THREAD_STACK_SIZE % 65536)) -eq 0 ] || { echo "MT_THREAD_STACK_SIZE must be a multiple of 65536" >&2; exit 1; }
    replace_once "$helper" \
      'init: { module_or_path: module, memory },' \
      "init: { module_or_path: module, memory, thread_stack_size: ${MT_THREAD_STACK_SIZE} },"
    changed=1
  fi
  if [ "$MT_EXPLICIT_MAIN_IMPORT" = 1 ]; then
    replace_once "$helper" \
      "const pkg = await import('../../..');" \
      "const pkg = await import('../../../${glue}');"
    changed=1
  fi
  if [ "$changed" = 1 ]; then
    # The helper is Apache-2.0 (wasm-bindgen-rayon); a changed file has to say so.
    # The crate ships it with CRLF line ends, so the notice uses them too.
    printf '\r\n// Modified from wasm-bindgen-rayon 1.3.0 src/workerHelpers.js by the build recipe\r\n// (recipe/build.sh, patch_worker_helper): the worker init object may carry\r\n// thread_stack_size, and the main module is imported by file name.\r\n' >> "$helper"
    tail -c 250 "$helper" | tr -d '\r'
  fi
}

for v in "${variants[@]}"; do
  case "$v" in
    st)
      build st zkir-wasm "-C target-feature=${ST_FEATURES}"
      ;;
    mt)
      build mt wasm-proving-demos/zkir-mt "-C target-feature=${UPSTREAM_MT_FEATURES} ${MT_LINK_ARGS}"
      patch_worker_helper "$STAGE/mt" midnight_zkir_wasm_mt.js
      ;;
    mt-upstream)
      # Upstream's recipe with nothing added, for reference only: with Rust
      # 1.95.0 this is NOT a threaded module (see Deviation 1).
      build mt-upstream wasm-proving-demos/zkir-mt "-C target-feature=${UPSTREAM_MT_FEATURES}"
      ;;
    mt-simd)
      build mt-simd wasm-proving-demos/zkir-mt "-C target-feature=${UPSTREAM_MT_FEATURES},+simd128 ${MT_LINK_ARGS}"
      patch_worker_helper "$STAGE/mt-simd" midnight_zkir_wasm_mt.js
      ;;
    *) echo "unknown variant: $v" >&2; exit 2 ;;
  esac
done

# The build must not have touched the source tree (Cargo.lock in particular).
if [ -n "$(git -C "$SRC" status --porcelain)" ]; then
  echo "source tree was modified by the build:" >&2
  git -C "$SRC" status --porcelain >&2
  exit 1
fi

mkdir -p "$OUT"
for v in "${variants[@]}"; do
  rm -rf "${OUT:?}/$v"
  cp -r "$STAGE/$v" "$OUT/$v"
done

# SHA-256, size in bytes, path: every file under /out except this list itself.
(
  cd "$OUT"
  find . -type f ! -name HASHES.txt -printf '%P\n' | LC_ALL=C sort | while IFS= read -r f; do
    printf '%s  %10d  %s\n' "$(sha256sum "$f" | cut -d' ' -f1)" "$(stat -c %s "$f")" "$f"
  done > HASHES.txt
)
echo
echo "== wasm files"
grep '\.wasm$' "$OUT/HASHES.txt"
