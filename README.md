# Horde in the browser

The engine compiled to WebAssembly, running in a Web Worker behind the same
board as `web/`. Everything is static: no server code, no build step at deploy
time, no third-party scripts. Pick an engine (HCE, Bastion-1, Bastion-2,
Bastion-3, Student-250ms), play either colour, undo, start a new game, import
and export PGN, review a game, and watch the search report each iteration.

## Files

| File | Role |
| --- | --- |
| `index.html`, `app.js`, `style.css` | The board. Forked from `web/`; `app.js` talks to the worker instead of `/api/...`. |
| `engine.js` | Downloads and compiles `horde.wasm` once, fetches networks, and manages the worker (one per evaluator configuration). |
| `worker.js` | Runs the engine: `state`, `search` and `import` requests, `info` messages during a search. |
| `horde.js` | DOM-free binding for `horde.wasm`, shared by the worker and the Node tests. |
| `horde.wasm` | The engine, built with `simd128` (220 KB). |
| `horde-nosimd.wasm` | Scalar fallback for browsers without WebAssembly SIMD (Safari before 16.4). `engine.js` picks one at load. |
| `networks/*.nnue` | The four bundled networks, 370 KB each, copied from `engines/networks/`. |
| `engines.json` | Descriptions and ratings for the picker, copied from `engines/engines.json`. |
| `_headers` | Cloudflare Pages response headers. |
| `build.sh` | Builds both modules, copies networks and catalogue, runs the smoke test. |
| `test/wasm_smoke.mjs` | Node test: wasm against the native engine, byte for byte. |
| `test/wasm_bench.mjs` | Node benchmark: nodes per second, wasm against native. |

## Build

```sh
rustup target add wasm32-unknown-unknown
cargo build --release --locked     # native engine, for the smoke test
site/build.sh
```

`build.sh` runs `cargo rustc --lib --target wasm32-unknown-unknown --crate-type cdylib`
twice: once with the flags in `.cargo/config.toml` (`+simd128`, stripped) and
once with `RUSTFLAGS` overriding them for the scalar module. No wasm-bindgen or
wasm-pack: `src/wasm.rs` exports a C ABI and `horde.js` reads and writes the
module's memory directly.

## Test

```sh
node site/test/wasm_smoke.mjs        # needs target/release/horde
node site/test/wasm_bench.mjs 11     # throughput at depth 11
```

The smoke test instantiates `horde.wasm` with the worker's imports, loads
Bastion-3 at weight 50 and then the handcrafted evaluation, and for two
positions compares the `state` document with `horde inspect` and every
iteration of a depth-7 search (best move, score, node count, principal
variation) with `go depth 7` over UCI. They must match exactly: the search is
deterministic at a fixed depth and the compiled code is the same.

## Run locally

```sh
cd site && python3 -m http.server 8000
```

Then open <http://127.0.0.1:8000/>. Any static server works; the page uses
relative URLs, so it can live under a subpath. A module worker and
`WebAssembly` are the only requirements (Chrome 80+, Firefox 114+, Safari 15+).

## Deploy to Cloudflare Pages

Direct upload, from the repository root:

```sh
npx wrangler login
npx wrangler pages project create horde --production-branch main   # once
npx wrangler pages deploy site --project-name horde
```

Or connect the repository in the Cloudflare dashboard (Workers & Pages, Create,
Pages, Connect to Git) with **no build command** and `site` as the build output
directory; every push to `main` then deploys. Run `site/build.sh` and commit
`site/horde.wasm`, `site/horde-nosimd.wasm` and `site/networks/` before
pushing, since Pages serves the folder as is.

`_headers` only adds `nosniff`, a referrer policy and frame denial. Pages
serves `.wasm` as `application/wasm` and revalidates every asset with an ETag,
so a redeploy never pairs a stale module with a new page. No cross-origin
isolation is needed: the page uses neither `SharedArrayBuffer` nor threads.

## How it works

`engine.js` fetches and compiles the module once and posts the compiled
`WebAssembly.Module` and the network bytes to a worker, which instantiates the
engine and loads the network (a few milliseconds). `search` blocks the worker
for its whole time budget, so there is no stop signal: to abandon a search
(the user moved, changed the time, or switched engine) the page terminates the
worker and starts another from the cached module and bytes. Requests in flight
when that happens reject with an `AbortError`, which the board treats as stale.
Each search uses a fresh 16 MB hash table, exactly as the local server does for
each analysis.

The exported surface (`src/wasm.rs`): `alloc`/`dealloc` for request buffers;
`load_network(bytes, name, weight)`, `unload_network()`, `set_nnue_weight(w)`;
`state(fen, moves)`; `search(fen, moves, time_ms, max_depth)`, which reports
each iteration through the imported `horde.on_info(ptr, len)`; `import_pgn`.
Every call returns 0 or 1 and leaves one JSON document behind
`result_ptr`/`result_len`. The search clock is the imported `horde.now_ms`,
`performance.now()` in the worker. The JSON is built by `src/api.rs`, the same
code the local server uses, so the two front ends see identical documents.

## Measurements

MacBook, Node 26, start position, depth 11 (same 1,750,511 nodes with
Bastion-3 at weight 50; 3,219,693 with HCE), best of four runs while the
machine was otherwise loaded:

| Build | Bastion-3 @50 | HCE |
| --- | --- | --- |
| native (`horde` over UCI) | 1.40–1.62 Mnps | 1.59–1.85 Mnps |
| wasm, `+simd128` | 1.14 Mnps | 1.57 Mnps |
| wasm, scalar | 0.65 Mnps | 1.46 Mnps |

SIMD is kept: it vectorizes the NNUE accumulator and output layers and gives
1.7x the scalar speed with a network loaded. In Chrome at 250 ms per move the
board reports about 1.1 Mnps with Bastion-3 and reaches depth 9 from the start
position. Loading: `horde.wasm` compiles in about 1 ms and a network parses in
about 4 ms; the first visit downloads 220 KB for the module and 370 KB per
network.
