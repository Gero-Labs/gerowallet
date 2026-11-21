#!/usr/bin/env bash
# Builds the multi-threaded Midnight prover package with the pinned recipe in
# this folder, inside Docker, and leaves it in <out dir>/mt.
#
#   bash scripts/midnight-zkir-mt/build-in-docker.sh <out dir> [variant ...]
#
# Variants are build.sh's: mt (default), st (the single-threaded control built
# the same way), mt-simd. Nothing is installed on the host; the image and three
# named volumes (cargo registry, git cache, target) are left in Docker.
# `node scripts/midnight-zkir-mt.mjs --build` runs this and then checks the
# result against the pins in src/chains/midnight/midnightZkirThreads.ts.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
out=${1:?usage: build-in-docker.sh <out dir> [variant ...]}
shift || true
variants=("$@")
if [ ${#variants[@]} -eq 0 ]; then variants=(mt); fi

mkdir -p "$out"
out=$(cd "$out" && pwd)
image=gero-zkir-mt-build:ledger-9.1.0.1

# Git Bash on Windows rewrites /paths in arguments; Docker needs them as they are.
export MSYS_NO_PATHCONV=1
if command -v cygpath >/dev/null 2>&1; then
  here_host=$(cygpath -w "$here")
  out_host=$(cygpath -w "$out")
else
  here_host=$here
  out_host=$out
fi

docker build -t "$image" "$here_host"
docker run --rm \
  -v gero-zkir-mt-target:/target \
  -v gero-zkir-mt-cargo-registry:/usr/local/cargo/registry \
  -v gero-zkir-mt-cargo-git:/usr/local/cargo/git \
  -v "$out_host:/out" \
  "$image" "${variants[@]}"

echo "built: $out/${variants[0]}"
