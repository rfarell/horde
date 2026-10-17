#!/usr/bin/env node
// Smoke test for the browser engine: instantiate horde.wasm with the imports
// worker.js uses, load Bastion-3 at weight 50, and compare the start position's
// state and a fixed-depth search with the native engine. Only the evaluator
// metadata (file label) may differ; moves, scores, node counts and principal
// variations must match exactly, since the compiled code is the same.
//
//   node site/test/wasm_smoke.mjs            (depth 7, bastion-3 and hce)
//   HORDE_DEPTH=9 node site/test/wasm_smoke.mjs
//
// Environment: HORDE_WASM (default site/horde.wasm), HORDE_BIN (default
// target/release/horde). Exit status 1 on any mismatch.

import { readFileSync, existsSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Horde, START_FEN } from '../horde.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const wasmPath = process.env.HORDE_WASM || resolve(root, 'site/horde.wasm');
const binary = process.env.HORDE_BIN || resolve(root, 'target/release/horde');
const depth = Number(process.env.HORDE_DEPTH || 7);
const network = 'engines/networks/bastion-3.nnue';

const CONFIGS = [
  { name: 'bastion-3', network, weight: 50 },
  { name: 'hce', network: null, weight: 0 }
];
const POSITIONS = [
  { label: 'startpos', fen: START_FEN, moves: '' },
  { label: 'startpos moves h4h5 d7d6', fen: START_FEN, moves: 'h4h5 d7d6' }
];

let failures = 0;
function check(condition, message) {
  if (condition) console.log(`  ok   ${message}`);
  else { failures += 1; console.log(`  FAIL ${message}`); }
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

for (const path of [wasmPath, binary]) {
  if (!existsSync(path)) { console.error(`missing ${path}; build first`); process.exit(2); }
}

// Instantiate the module and time it.
const bytes = readFileSync(wasmPath);
let t0 = performance.now();
const module = await WebAssembly.compile(bytes);
const compileMs = performance.now() - t0;
t0 = performance.now();
const engine = await Horde.instantiate(module);
const instantiateMs = performance.now() - t0;
console.log(`horde.wasm: ${bytes.length} bytes, compile ${compileMs.toFixed(1)} ms, instantiate ${instantiateMs.toFixed(1)} ms`);

// Native UCI session helper.
class Uci {
  constructor() {
    this.child = spawn(binary, ['uci'], { cwd: root, stdio: ['pipe', 'pipe', 'inherit'] });
    this.buffer = '';
    this.lines = [];
    this.waiters = [];
    this.child.stdout.on('data', chunk => {
      this.buffer += chunk;
      let index;
      while ((index = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + 1);
        const waiter = this.waiters.shift();
        if (waiter) waiter(line); else this.lines.push(line);
      }
    });
  }
  send(command) { this.child.stdin.write(command + '\n'); }
  line() {
    if (this.lines.length) return Promise.resolve(this.lines.shift());
    return new Promise(resolve => this.waiters.push(resolve));
  }
  async ask(command) { this.send(command); return this.line(); }
  async until(prefix) {
    const lines = [];
    for (;;) {
      const line = await this.line();
      lines.push(line);
      if (line.startsWith(prefix)) return lines;
    }
  }
  quit() { this.send('quit'); return new Promise(resolve => this.child.on('exit', resolve)); }
}

function parseInfo(line) {
  const words = line.split(' ');
  const info = { pv: [] };
  for (let i = 1; i < words.length; i++) {
    const key = words[i];
    if (key === 'depth') info.depth = Number(words[++i]);
    else if (key === 'nodes') info.nodes = Number(words[++i]);
    else if (key === 'score') {
      const kind = words[++i];
      const value = Number(words[++i]);
      if (kind === 'cp') { info.cp = value; info.mate = null; } else { info.cp = null; info.mate = value; }
    } else if (key === 'pv') { info.pv = words.slice(i + 1); break; }
  }
  return info;
}

// The wasm search document is White-relative; UCI scores are for the side to move.
function fromDocument(document, turn) {
  const sign = turn === 'w' ? 1 : -1;
  return {
    depth: document.depth,
    nodes: document.nodes,
    cp: document.mate === null ? document.score * sign : null,
    mate: document.mate === null ? null : document.mate * sign,
    pv: document.pv.map(move => move.uci),
    bestMove: document.bestMove
  };
}

for (const config of CONFIGS) {
  console.log(`\n== ${config.name} (depth ${depth}) ==`);
  let metadata;
  if (config.network) {
    const networkBytes = readFileSync(resolve(root, config.network));
    t0 = performance.now();
    metadata = engine.loadNetwork(networkBytes, config.network, config.weight);
    console.log(`  network loaded in ${(performance.now() - t0).toFixed(1)} ms: ${metadata.label}, ${metadata.description}`);
    check(metadata.kind === 'blend' && metadata.nnueWeight === config.weight, 'evaluator metadata describes the blend');
  } else {
    metadata = engine.unloadNetwork();
    check(metadata.kind === 'handcrafted', 'evaluator metadata is handcrafted');
  }

  const uci = new Uci();
  uci.send('uci');
  await uci.until('uciok');
  if (config.network) {
    check((await uci.ask(`setoption name EvalFile value ${config.network}`)).startsWith('info string NNUE loaded'), 'native loaded the network');
    check((await uci.ask('setoption name UseNNUE value true')) === 'info string NNUE evaluation active', 'native enabled NNUE');
    check((await uci.ask(`setoption name NNUEWeight value ${config.weight}`)) === `info string NNUEWeight set to ${config.weight}`, 'native set the weight');
  }

  for (const position of POSITIONS) {
    console.log(`  -- ${position.label}`);
    // State: compare with `horde inspect`, which prints the same document without evaluator metadata.
    const state = engine.state(position.fen, position.moves);
    const inspectArgs = ['inspect', 'startpos'];
    if (position.moves) inspectArgs.push('moves', ...position.moves.split(' '));
    const native = JSON.parse(execFileSync(binary, inspectArgs, { cwd: root, encoding: 'utf8' }));
    const { evaluator, ...rest } = state;
    check(same(rest, native), `state matches native inspect (${native.legal.length} legal moves, status ${native.status})`);
    check(same(evaluator, metadata), 'state carries the evaluator metadata');

    // Search: compare every iteration and the best move.
    const infos = [];
    t0 = performance.now();
    const final = engine.search(position.fen, position.moves, { timeMs: 0, depth, onInfo: info => infos.push(info) });
    const wasmMs = performance.now() - t0;
    uci.send('ucinewgame');
    uci.send(`position startpos${position.moves ? ' moves ' + position.moves : ''}`);
    uci.send(`go depth ${depth}`);
    const lines = await uci.until('bestmove');
    const nativeInfos = lines.filter(line => line.startsWith('info depth')).map(parseInfo);
    const nativeBest = lines[lines.length - 1].split(' ')[1];
    const nativeFinal = nativeInfos[nativeInfos.length - 1];
    const nativeNps = Number(lines[lines.length - 2].split(' ')[lines[lines.length - 2].split(' ').indexOf('nps') + 1]);

    const wasmFinal = fromDocument(final, state.turn);
    check(wasmFinal.bestMove === nativeBest, `best move ${wasmFinal.bestMove} matches native ${nativeBest}`);
    check(wasmFinal.depth === nativeFinal.depth, `depth ${wasmFinal.depth}`);
    check(wasmFinal.cp === nativeFinal.cp && wasmFinal.mate === nativeFinal.mate, `score cp ${wasmFinal.cp} mate ${wasmFinal.mate} matches native cp ${nativeFinal.cp} mate ${nativeFinal.mate}`);
    check(wasmFinal.nodes === nativeFinal.nodes, `nodes ${wasmFinal.nodes} match native ${nativeFinal.nodes}`);
    check(same(wasmFinal.pv, nativeFinal.pv), `pv ${wasmFinal.pv.join(' ')}`);
    check(infos.length === nativeInfos.length, `${infos.length} iterations reported through on_info (native ${nativeInfos.length})`);
    const iterationsMatch = infos.every((info, i) => {
      const w = fromDocument(info, state.turn);
      const n = nativeInfos[i];
      return n && w.depth === n.depth && w.nodes === n.nodes && w.cp === n.cp && w.mate === n.mate && same(w.pv, n.pv);
    });
    check(iterationsMatch, 'every iteration matches native depth, score, nodes and pv');
    check(infos.every(info => same(info.evaluator, metadata)), 'iterations carry the evaluator metadata');
    const wasmNps = Math.round(final.nodes / Math.max(wasmMs, 1) * 1000);
    console.log(`  wasm ${wasmMs.toFixed(0)} ms, ${wasmNps} nodes/s (final document nps ${final.nps}); native ${nativeNps} nodes/s`);
  }
  await uci.quit();
}

// PGN import goes through the same code as the server's /api/import.
console.log('\n== pgn import ==');
const game = engine.importPgn('[Variant "Horde"]\n\n1.a5 {comment} (1. b6) 1...b6 $1 2.axb6!? ; line comment\n *');
check(game.moves.length === 3 && game.moves[2].uci === 'a5b6', 'PGN with comments and variations imports');
let rejected = false;
try { engine.importPgn('[Variant "Standard"]\n1. e4'); } catch (error) { rejected = /Horde/.test(error.message); }
check(rejected, 'non-Horde PGN is rejected with the engine error');

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
