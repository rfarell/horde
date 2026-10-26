// Binding for horde.wasm, the Horde engine compiled to WebAssembly.
//
// No DOM: worker.js and the Node tests both use it. The module exports plain
// C-ABI functions (see src/wasm.rs). Text crosses the boundary as pointer and
// length in buffers reserved with `alloc`; every call leaves one JSON document
// behind `result_ptr`/`result_len` and returns 0 on success or 1 on error.

export const START_FEN = 'rnbqkbnr/pppppppp/8/1PP2PP1/PPPPPPPP/PPPPPPPP/PPPPPPPP/PPPPPPPP w kq - 0 1';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class Horde {
  /**
   * Instantiate the engine from a compiled `WebAssembly.Module`, raw bytes
   * (`ArrayBuffer`/`Uint8Array`) or a `Response`. Returns a ready `Horde`
   * with the handcrafted evaluation selected.
   */
  static async instantiate(source) {
    const engine = new Horde();
    const imports = engine.imports();
    let instance;
    if (source instanceof WebAssembly.Module) {
      instance = await WebAssembly.instantiate(source, imports);
    } else if (typeof Response !== 'undefined' && source instanceof Response) {
      instance = (await WebAssembly.instantiateStreaming(source, imports)).instance;
    } else {
      instance = (await WebAssembly.instantiate(source, imports)).instance;
    }
    engine.attach(instance);
    return engine;
  }

  constructor() {
    this.exports = null;
    this.onInfo = null;
  }

  /** The import object the module expects: the clock and the info callback. */
  imports() {
    return {
      horde: {
        now_ms: () => performance.now(),
        on_info: (ptr, len) => {
          if (!this.onInfo) return;
          const text = decoder.decode(new Uint8Array(this.exports.memory.buffer, ptr, len));
          this.onInfo(JSON.parse(text));
        }
      }
    };
  }

  attach(instance) {
    this.exports = instance.exports;
  }

  /** Select a HORNNUE3 network (bytes) at `weight` percent; `name` labels it. */
  loadNetwork(bytes, name, weight) {
    const network = this.write(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    const label = this.write(encoder.encode(name));
    try {
      return this.call('load_network', network.ptr, network.len, label.ptr, label.len, weight);
    } finally {
      this.release(network);
      this.release(label);
    }
  }

  /** Return to the handcrafted evaluation. */
  unloadNetwork() {
    return this.call('unload_network');
  }

  /** Change the loaded network's share of the evaluation, 0 to 100. */
  setWeight(weight) {
    return this.call('set_nnue_weight', weight);
  }

  /** Board, legal moves, status and history after `moves` (UCI, space separated) from `fen`. */
  state(fen = START_FEN, moves = '') {
    return this.withText([fen, moves], (f, m) => this.call('state', f.ptr, f.len, m.ptr, m.len));
  }

  /**
   * Search the position. `timeMs` 0 means no time limit; `depth` 0 means 64.
   * `onInfo` receives each completed iteration. Returns the final iteration
   * with `bestMove`. The call blocks the calling thread for the whole search.
   */
  search(fen = START_FEN, moves = '', { timeMs = 1000, depth = 64, onInfo = null } = {}) {
    this.onInfo = onInfo;
    try {
      return this.withText([fen, moves], (f, m) => this.call('search', f.ptr, f.len, m.ptr, m.len, timeMs, depth));
    } finally {
      this.onInfo = null;
    }
  }

  /** Forget the search tables and histories kept from earlier searches, before a new game. */
  newGame() {
    return this.call('new_game');
  }

  /** Parse one Horde PGN game into `startFen`, `moves`, `result` and `tags`. */
  importPgn(pgn) {
    return this.withText([pgn], p => this.call('import_pgn', p.ptr, p.len));
  }

  call(name, ...args) {
    const code = this.exports[name](...args);
    const { memory, result_ptr, result_len } = this.exports;
    const text = decoder.decode(new Uint8Array(memory.buffer, result_ptr(), result_len()));
    const document = JSON.parse(text);
    if (code !== 0) throw new Error(document.error || `${name} failed`);
    return document;
  }

  write(bytes) {
    const len = bytes.byteLength;
    const ptr = this.exports.alloc(len);
    // Re-read the buffer after alloc: growing memory detaches earlier views.
    new Uint8Array(this.exports.memory.buffer, ptr, len).set(bytes);
    return { ptr, len };
  }

  release({ ptr, len }) {
    this.exports.dealloc(ptr, len);
  }

  withText(texts, body) {
    const buffers = texts.map(text => this.write(encoder.encode(text)));
    try {
      return body(...buffers);
    } finally {
      for (const buffer of buffers) this.release(buffer);
    }
  }
}
