# Pinned build environment for Midnight's zkir prover as WebAssembly
# (threaded + single-threaded control). See README.md.
#
# Everything is pinned: base image by digest, apt by snapshot date, release
# tarballs by SHA-256, the source by git commit, crates by the repo's Cargo.lock.

# rust:1.95.0-trixie (rustc 1.95.0 59807616e 2026-04-14, cargo 1.95.0, rustup 1.29.0).
# Upstream's flake pins fenix "stable" dated 2026-04-16, which is Rust 1.95.0.
FROM rust@sha256:f49565f188ee00bc2a18dd418183f2c5f23ef7d6e691890517ed341a598f67c3

SHELL ["/bin/bash", "-euo", "pipefail", "-c"]

ENV TZ=UTC LC_ALL=C.UTF-8 DEBIAN_FRONTEND=noninteractive

# --- apt, frozen at the same snapshot the base image was built from ----------
ARG DEBIAN_SNAPSHOT=20260518T000000Z
RUN sed -i \
      -e "s|http://deb.debian.org/debian-security|http://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT}|" \
      -e "s|http://deb.debian.org/debian\$|http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}|" \
      /etc/apt/sources.list.d/debian.sources; \
    cat /etc/apt/sources.list.d/debian.sources; \
    apt-get -o Acquire::Check-Valid-Until=false -o Acquire::Retries=5 update; \
    apt-get install -y --no-install-recommends clang-19 llvm-19 xz-utils ca-certificates git curl; \
    rm -rf /var/lib/apt/lists/*; \
    clang-19 --version; llvm-ar-19 --version | head -2

# clang compiles blst's portable C for wasm32 (cc-rs); rustc links with its own rust-lld.
ENV CC_wasm32_unknown_unknown=clang-19 \
    AR_wasm32_unknown_unknown=llvm-ar-19

# --- Rust: std sources for -Z build-std, and the wasm target ------------------
RUN rustup component add rust-src --toolchain 1.95.0; \
    rustup target add wasm32-unknown-unknown --toolchain 1.95.0; \
    rustup show; rustc -vV; cargo -V

# --- release binaries, verified by SHA-256 -----------------------------------
ARG WASM_PACK_VERSION=0.13.1
ARG WASM_PACK_SHA256=c539d91ccab2591a7e975bcf82c82e1911b03335c80aa83d67ad25ed2ad06539
ARG WASM_BINDGEN_VERSION=0.2.108
ARG WASM_BINDGEN_SHA256=d15d7e476feec78d0ec9edc27b8f77279ec7a3e6227756e7036e5cd2066800f4
ARG BINARYEN_VERSION=126
ARG BINARYEN_SHA256=e487e0eac1f02a6739816c617270b033e5d3f8ca90439301fd0286460322fd76
ARG WASM_TOOLS_VERSION=1.263.0
ARG WASM_TOOLS_SHA256=21c036c1740a0552124c79c6e2170cb61c5b016005671a6d5bc06cf642165431
ARG NODE_VERSION=22.23.5
ARG NODE_SHA256=cdeb8670a0c81f51b4dc4ac61919f9b1ad917b304bf8221eb939570663d240f8

RUN mkdir -p /opt/tools/bin /tmp/dl; cd /tmp/dl; \
    fetch() { curl -fsSL --retry 5 "$1" -o "$2"; echo "$3  $2" | sha256sum -c -; }; \
    fetch "https://github.com/wasm-bindgen/wasm-pack/releases/download/v${WASM_PACK_VERSION}/wasm-pack-v${WASM_PACK_VERSION}-x86_64-unknown-linux-musl.tar.gz" wasm-pack.tgz "${WASM_PACK_SHA256}"; \
    tar xzf wasm-pack.tgz --strip-components=1 -C /opt/tools/bin "wasm-pack-v${WASM_PACK_VERSION}-x86_64-unknown-linux-musl/wasm-pack"; \
    fetch "https://github.com/wasm-bindgen/wasm-bindgen/releases/download/${WASM_BINDGEN_VERSION}/wasm-bindgen-${WASM_BINDGEN_VERSION}-x86_64-unknown-linux-musl.tar.gz" wasm-bindgen.tgz "${WASM_BINDGEN_SHA256}"; \
    tar xzf wasm-bindgen.tgz --strip-components=1 -C /opt/tools/bin "wasm-bindgen-${WASM_BINDGEN_VERSION}-x86_64-unknown-linux-musl/wasm-bindgen"; \
    fetch "https://github.com/WebAssembly/binaryen/releases/download/version_${BINARYEN_VERSION}/binaryen-version_${BINARYEN_VERSION}-x86_64-linux.tar.gz" binaryen.tgz "${BINARYEN_SHA256}"; \
    mkdir -p /opt/binaryen; tar xzf binaryen.tgz --strip-components=1 -C /opt/binaryen; \
    ln -s /opt/binaryen/bin/wasm-opt /opt/tools/bin/wasm-opt; \
    fetch "https://github.com/bytecodealliance/wasm-tools/releases/download/v${WASM_TOOLS_VERSION}/wasm-tools-${WASM_TOOLS_VERSION}-x86_64-linux.tar.gz" wasm-tools.tgz "${WASM_TOOLS_SHA256}"; \
    tar xzf wasm-tools.tgz --strip-components=1 -C /opt/tools/bin "wasm-tools-${WASM_TOOLS_VERSION}-x86_64-linux/wasm-tools"; \
    fetch "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" node.txz "${NODE_SHA256}"; \
    mkdir -p /opt/node; tar xJf node.txz --strip-components=1 -C /opt/node; \
    ln -s /opt/node/bin/node /opt/tools/bin/node; \
    rm -rf /tmp/dl

ENV PATH=/opt/tools/bin:$PATH

RUN wasm-pack --version; wasm-bindgen --version; wasm-opt --version; wasm-tools --version; node --version

# --- source, by commit --------------------------------------------------------
# Tag ledger-9.1.0.1.
ARG LEDGER_REPO=https://github.com/midnightntwrk/midnight-ledger.git
ARG LEDGER_COMMIT=a2b30128ca4b660b73a068e29b56b48ede8c9a74
RUN git init -q /src/midnight-ledger; cd /src/midnight-ledger; \
    git remote add origin "${LEDGER_REPO}"; \
    git -c protocol.version=2 fetch -q --depth 1 origin "${LEDGER_COMMIT}"; \
    git -c advice.detachedHead=false checkout -q FETCH_HEAD; \
    test "$(git rev-parse HEAD)" = "${LEDGER_COMMIT}"; \
    git status --short | wc -l

ENV LEDGER_COMMIT=${LEDGER_COMMIT} \
    CARGO_INCREMENTAL=0 \
    CARGO_TERM_COLOR=never \
    WASM_PACK_CACHE=/tmp/wasm-pack-cache

COPY build.sh /recipe/build.sh
COPY sanity.mjs /recipe/sanity.mjs
WORKDIR /src/midnight-ledger
ENTRYPOINT ["/bin/bash", "/recipe/build.sh"]
