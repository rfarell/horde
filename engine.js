// The page's handle on the engine worker.
//
// horde.wasm is downloaded and compiled once; each evaluator configuration
// (network file and weight) runs in a fresh worker. A search blocks the worker
// for its whole budget and cannot be interrupted, so `cancel` terminates a
// busy worker and starts another from the compiled module and cached network
// bytes, which takes a few milliseconds; the new worker starts with empty
// search tables. Requests sent while a worker starts
// wait for it; requests in flight when it is terminated reject with an
// AbortError, which callers treat as "stale".

const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

function abortError(message = 'The request was abandoned.') {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export class EngineHost {
  // The ?v= queries match index.html; bump them together when these files change.
  constructor({ wasm = './horde.wasm?v=4', fallback = './horde-nosimd.wasm?v=4', workerUrl = './worker.js?v=4', onStatus = () => {} } = {}) {
    this.wasmUrl = wasm;
    this.fallbackUrl = fallback;
    this.workerUrl = workerUrl;
    this.onStatus = onStatus;
    this.module = null;
    this.moduleBytes = null;
    this.networks = new Map();
    this.config = null;
    this.evaluator = null;
    this.worker = null;
    this.ready = null;
    this.pending = new Map();
    this.searching = null;
    this.nextId = 1;
    this.loadMs = null;
  }

  /** Download and compile the module once; the SIMD build when supported. */
  async loadModule() {
    if (this.module) return this.module;
    const started = performance.now();
    const simd = WebAssembly.validate(SIMD_PROBE);
    const response = await fetch(simd ? this.wasmUrl : this.fallbackUrl);
    if (!response.ok) throw new Error(`The engine could not be downloaded (${response.status}).`);
    this.moduleBytes = await response.arrayBuffer();
    this.module = await WebAssembly.compile(this.moduleBytes);
    this.loadMs = performance.now() - started;
    this.simd = simd;
    return this.module;
  }

  async loadNetwork(url) {
    if (!url) return null;
    if (!this.networks.has(url)) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`The network ${url} could not be downloaded (${response.status}).`);
      this.networks.set(url, await response.arrayBuffer());
    }
    return this.networks.get(url);
  }

  /**
   * Select an evaluator: `network` is a URL or null for the handcrafted
   * evaluation, `weight` its share of the score, `name` its label. Resolves
   * with the evaluator metadata the engine reports.
   */
  async configure({ network = null, weight = 50, name = 'HCE' } = {}) {
    this.onStatus('loading');
    try {
      const [module, bytes] = await Promise.all([this.loadModule(), this.loadNetwork(network)]);
      this.config = { module, bytes, network, weight, name };
      this.terminate(abortError('The engine was reconfigured.'));
      const evaluator = await this.spawn();
      this.onStatus('ready');
      return evaluator;
    } catch (error) {
      this.onStatus('error', error);
      throw error;
    }
  }

  spawn() {
    const { module, bytes, network, weight, name } = this.config;
    const worker = new Worker(this.workerUrl, { type: 'module' });
    this.worker = worker;
    const ready = new Promise((resolve, reject) => {
      this.rejectReady = reject;
      worker.onmessage = ({ data }) => {
        if (data.type === 'ready') { this.evaluator = data.evaluator; resolve(data.evaluator); return; }
        if (data.type === 'error' && data.id === undefined) { reject(new Error(data.error)); return; }
        this.receive(worker, data);
      };
      worker.onerror = event => {
        const error = new Error(event.message || 'The engine worker failed.');
        reject(error);
        if (this.worker === worker) this.terminate(error);
      };
      const init = { type: 'init', network: bytes ? bytes.slice(0) : null, name: network || name, weight };
      try {
        worker.postMessage({ ...init, module });
      } catch {
        // Some browsers refuse to clone a compiled module; let the worker compile the bytes.
        worker.postMessage({ ...init, bytes: this.moduleBytes.slice(0) });
      }
    });
    this.ready = ready;
    // A worker that fails to start must not pin every later request to its failure.
    ready.catch(() => { if (this.ready === ready) this.ready = null; });
    return ready;
  }

  receive(worker, data) {
    if (worker !== this.worker) return;
    const request = this.pending.get(data.id);
    if (!request) return;
    if (data.type === 'info') { request.onInfo?.(data.data); return; }
    this.pending.delete(data.id);
    if (this.searching === data.id) this.searching = null;
    if (data.type === 'error') request.reject(new Error(data.error));
    else request.resolve(data.data);
  }

  terminate(error) {
    if (this.worker) { this.worker.terminate(); this.worker = null; }
    this.rejectReady?.(error);
    this.rejectReady = null;
    this.ready = null;
    this.searching = null;
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }

  /** Abandon a running search. Idle workers are kept; busy ones are replaced. */
  cancel() {
    if (this.searching === null || !this.config) return;
    this.terminate(abortError('The search was abandoned.'));
    this.spawn().catch(() => {});
  }

  async request(message, onInfo) {
    if (!this.config) throw new Error('Choose an engine first.');
    if (!this.ready) this.spawn().catch(() => {});
    try { await this.ready; } catch (error) { throw error.name === 'AbortError' ? error : abortError(error.message); }
    const worker = this.worker;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onInfo });
      if (message.type === 'search') this.searching = id;
      worker.postMessage({ ...message, id });
    });
  }

  state(fen, moves) { return this.request({ type: 'state', fen, moves }); }

  search({ fen, moves, timeMs, depth = 64 }, onInfo) {
    return this.request({ type: 'search', fen, moves, timeMs, depth }, onInfo);
  }

  importPgn(pgn) { return this.request({ type: 'import', pgn }); }

  /** Clear the search tables the worker keeps between searches. */
  newGame() { return this.request({ type: 'newGame' }); }
}
