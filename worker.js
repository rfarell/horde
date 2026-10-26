// Web Worker that runs the Horde engine. One instance of horde.wasm serves one
// evaluator configuration and keeps its search tables from one search to the
// next, as the native engine does within a game; the page (engine.js)
// terminates and respawns the worker to abandon a search, because a search
// blocks this thread until its time or depth budget is spent.
//
// Messages in:  {type:'init', module|bytes, network, name, weight}
//               {id, type:'state', fen, moves}
//               {id, type:'search', fen, moves, timeMs, depth}
//               {id, type:'import', pgn}
//               {id, type:'newGame'}
// Messages out: {type:'ready', evaluator} | {type:'error', error}
//               {id, type:'info', data} (each completed search iteration)
//               {id, type:'result', data} | {id, type:'error', error}

import { Horde } from './horde.js?v=4';

let engine = null;

self.onmessage = async ({ data }) => {
  const id = data.id;
  try {
    if (data.type === 'init') {
      engine = await Horde.instantiate(data.module || data.bytes);
      const evaluator = data.network
        ? engine.loadNetwork(new Uint8Array(data.network), data.name, data.weight)
        : engine.unloadNetwork();
      self.postMessage({ type: 'ready', evaluator });
      return;
    }
    if (!engine) throw new Error('The engine is not loaded yet.');
    if (data.type === 'state') {
      self.postMessage({ id, type: 'result', data: engine.state(data.fen, data.moves) });
    } else if (data.type === 'import') {
      self.postMessage({ id, type: 'result', data: engine.importPgn(data.pgn) });
    } else if (data.type === 'newGame') {
      self.postMessage({ id, type: 'result', data: engine.newGame() });
    } else if (data.type === 'search') {
      const result = engine.search(data.fen, data.moves, {
        timeMs: data.timeMs,
        depth: data.depth,
        onInfo: info => self.postMessage({ id, type: 'info', data: info })
      });
      self.postMessage({ id, type: 'result', data: result });
    } else {
      throw new Error(`Unknown request ${data.type}`);
    }
  } catch (error) {
    self.postMessage({ id, type: 'error', error: error?.message || String(error) });
  }
};
