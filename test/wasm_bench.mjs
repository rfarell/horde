#!/usr/bin/env node
// Throughput of horde.wasm against the native engine: a fixed-depth search of
// the start position with Bastion-3 at weight 50 and with the handcrafted
// evaluation. Both engines visit the same nodes, so nodes per second compares
// the code generation alone.
//
//   node site/test/wasm_bench.mjs [depth]           (default depth 11)
//   HORDE_WASM=path/to/horde.wasm node site/test/wasm_bench.mjs

import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Horde, START_FEN } from '../horde.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const wasmPath = process.env.HORDE_WASM || resolve(root, 'site/horde.wasm');
const binary = process.env.HORDE_BIN || resolve(root, 'target/release/horde');
const depth = Number(process.argv[2] || 11);
const network = 'engines/networks/bastion-3.nnue';

const engine = await Horde.instantiate(await WebAssembly.compile(readFileSync(wasmPath)));

function nativeSearch(withNetwork) {
  return new Promise(resolvePromise => {
    const child = spawn(binary, ['uci'], { cwd: root, stdio: ['pipe', 'pipe', 'inherit'] });
    let output = '';
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.includes('bestmove')) {
        child.stdin.write('quit\n');
        const lines = output.trim().split('\n');
        const info = lines.filter(line => line.startsWith('info depth')).pop().split(' ');
        const field = name => Number(info[info.indexOf(name) + 1]);
        resolvePromise({ nodes: field('nodes'), ms: field('time'), nps: field('nps') });
      }
    });
    const commands = ['uci'];
    if (withNetwork) commands.push(`setoption name EvalFile value ${network}`, 'setoption name UseNNUE value true', 'setoption name NNUEWeight value 50');
    commands.push('ucinewgame', 'position startpos', `go depth ${depth}`);
    child.stdin.write(commands.join('\n') + '\n');
  });
}

function wasmSearch() {
  // Warm once (first allocation of the 16 MB hash grows the memory), then time.
  engine.search(START_FEN, '', { timeMs: 0, depth: Math.min(depth, 6) });
  const start = performance.now();
  const result = engine.search(START_FEN, '', { timeMs: 0, depth });
  const ms = performance.now() - start;
  return { nodes: result.nodes, ms, nps: Math.round(result.nodes / ms * 1000) };
}

console.log(`${wasmPath} (${readFileSync(wasmPath).length} bytes), start position, depth ${depth}`);
for (const [label, withNetwork] of [['bastion-3 @50', true], ['hce', false]]) {
  if (withNetwork) engine.loadNetwork(readFileSync(resolve(root, network)), network, 50); else engine.unloadNetwork();
  const wasm = wasmSearch();
  const native = await nativeSearch(withNetwork);
  const ratio = (wasm.nps / native.nps * 100).toFixed(0);
  console.log(`${label.padEnd(14)} wasm ${String(wasm.nodes).padStart(9)} nodes in ${wasm.ms.toFixed(0).padStart(5)} ms = ${String(wasm.nps).padStart(8)} nodes/s | native ${String(native.nodes).padStart(9)} nodes in ${String(native.ms).padStart(5)} ms = ${String(native.nps).padStart(8)} nodes/s | wasm/native ${ratio}%`);
  if (wasm.nodes !== native.nodes) console.log(`  node count differs (${wasm.nodes} vs ${native.nodes})`);
}
