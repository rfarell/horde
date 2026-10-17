// The Horde engine studio, served statically: the engine runs in a Web Worker
// (worker.js, horde.wasm) and the page talks to it through engine.js. The
// board, game and analysis behaviour follow web/app.js, which drives the same
// engine over the local HTTP server.
import { EngineHost } from './engine.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/1PP2PP1/PPPPPPPP/PPPPPPPP/PPPPPPPP/PPPPPPPP w kq - 0 1';
const STORAGE_KEY = 'horde-studio-web-v1';
const DEFAULT_ENGINE = 'bastion-3';
// The bundled engines. Networks play at weight 50, as they were trained and
// rated; engines.json adds descriptions and ratings when it loads.
const ENGINES = {
  hce: { label: 'HCE', network: null, weight: 0 },
  'bastion-1': { label: 'Bastion-1', network: './networks/bastion-1.nnue', weight: 50 },
  'bastion-2': { label: 'Bastion-2', network: './networks/bastion-2.nnue', weight: 50 },
  'bastion-3': { label: 'Bastion-3', network: './networks/bastion-3.nnue', weight: 50 },
  'student-250ms': { label: 'Student-250ms', network: './networks/student-250ms.nnue', weight: 50 }
};
const $ = id => document.getElementById(id);
const FILES = 'abcdefgh';
const PIECE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const icons = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  play: '<path d="m8 5 11 7-11 7V5Z"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  flip: '<path d="m4 8 4-4 4 4M8 4v14m12-2-4 4-4-4m4 4V6"/>',
  undo: '<path d="M4 10h9a6 6 0 0 1 0 12M4 10l5-5M4 10l5 5" transform="translate(0 -2)"/>',
  flag: '<path d="M5 21V3m0 1c5-4 9 4 14 0v10c-5 4-9-4-14 0"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-left': '<path d="m15 6-6 6 6 6"/>',
  'chevron-right': '<path d="m9 6 6 6-6 6"/>',
  'skip-back': '<path d="M5 5v14m13-13-7 6 7 6V6Z"/>',
  'skip-forward': '<path d="M19 5v14M6 6l7 6-7 6V6Z"/>',
  'arrow-up-right': '<path d="M6 18 18 6M6 6h12v12"/>',
  'arrow-right': '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  brackets: '<path d="M8 4H4v16h4m8-16h4v16h-4M10 8l4 8"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>'
};
for (const element of document.querySelectorAll('[data-icon]')) {
  element.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[element.dataset.icon] || ''}</svg>`;
}

// Original, local SVG pieces; the board has no network or font dependencies.
function pieceSVG(piece) {
  if (!piece) return '';
  const white = piece === piece.toUpperCase();
  const fill = white ? '#f8f6eb' : '#3b423c';
  const stroke = white ? '#394137' : '#222a23';
  const detail = white ? '#75806c' : '#858f7d';
  const shapes = {
    p: '<path d="M17.5 18.5c-2-1.5-3-3.6-3-5.9a7.5 7.5 0 0 1 15 0c0 2.3-1 4.4-3 5.9l2.5 3.8H15l2.5-3.8Z"/><path d="M17 23c.5 6-2.5 10-7 13l-1 4h26l-1-4c-4.5-3-7.5-7-7-13"/><path d="M10 36h24" fill="none" stroke-width="1" opacity=".4"/>',
    r: '<path d="M10 5h5v6h5V5h5v6h5V5h5l-2 13H12L10 5Z"/><path d="M14 18h17l-1 15 5 3 1 4H9l1-4 5-3-1-15Z"/><path d="M14 22h17M15 33h15M10 36h25" fill="none" stroke-width="1.3"/>',
    n: '<path d="M10 34c0-7 5-12 14-17l-7-1-5 7-6-3 3-10 8-5 5 1 2-4 5 7c10 6 10 17 5 25H10Z"/><path d="m13 12 5-2M25 10c5 5 6 12 2 19" fill="none" stroke-width="1.6"/><circle cx="18" cy="11" r="1.3" fill="'+stroke+'" stroke="none"/><path d="m10 34-2 6h29l-2-6H10Z"/>',
    b: '<path d="M22 5c-2 4-10 8-10 16 0 5 4 8 10 8s10-3 10-8c0-8-8-12-10-16Z"/><path d="m25 13-5 9" fill="none" stroke-width="2.4"/><circle cx="22" cy="4.5" r="2.3"/><path d="M17 28h10l2 6 5 2 1 4H9l1-4 5-2 2-6Z"/><path d="M11 36h22" fill="none" stroke-width="1.2"/>',
    q: '<path d="m9 13 7 8 6-12 6 12 7-8-5 18H14L9 13Z"/><circle cx="8" cy="11" r="3"/><circle cx="22" cy="7" r="3"/><circle cx="36" cy="11" r="3"/><path d="M14 30h16l-1 4 6 2 1 4H8l1-4 6-2-1-4Z"/><path d="M14 25h16M10 36h24" fill="none" stroke-width="1.2"/>',
    k: '<path d="M19 3h6v5h5v5h-5v5h-6v-5h-5V8h5V3Z"/><path d="M22 20c-7-9-18-4-15 4l8 9h14l8-9c3-8-8-13-15-4Z"/><path d="M15 32h14l1 3 5 2 1 3H8l1-3 5-2 1-3Z"/><path d="M22 20v10M12 37h20" fill="none" stroke-width="1.3"/>'
  };
  return `<svg class="piece ${white ? 'white-piece' : 'black-piece'}" viewBox="0 0 44 44" fill="${fill}" stroke="${stroke}" stroke-width="1.65" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><g>${shapes[piece.toLowerCase()] || ''}</g><path d="M12 38.3h20" fill="none" stroke="${detail}" stroke-width=".55" opacity=".3"/></svg>`;
}

const model = {
  startFen: START_FEN, line: [], cursor: 0, state: null,
  evaluatorKey: null, engine: DEFAULT_ENGINE, engineLoading: true, engineError: null,
  mode: 'play', humanSide: 'w', flipped: false, time: 250,
  selected: null, analysis: null, searching: false, loading: false,
  scores: new Map(), evaluations: new Map(), result: '*', resignedSide: null, reviewing: false, reviewProgress: 0, reviewTotal: 0
};
const host = new EngineHost();
let requestVersion = 0;
let searchVersion = 0;
let reviewVersion = 0;
let engineVersion = 0;
let toastTimeout;
let dragFrom = null;
let promotionCandidates = [];

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function squareIndex(square) { return FILES.indexOf(square[0]) + (Number(square[1]) - 1) * 8; }
function pieceAt(square) { return model.state?.board[squareIndex(square)] || null; }
function pieceSide(piece) { return piece === piece.toUpperCase() ? 'w' : 'b'; }
function currentMoves() { return model.line.slice(0, model.cursor).map(move => move.uci); }
function resignedAtCursor() { return !!model.resignedSide && model.cursor === model.line.length; }
function playEndedByResignation() { return model.mode === 'play' && resignedAtCursor(); }
function displayState() {
  if (!model.state || !playEndedByResignation()) return model.state;
  return { ...model.state, status: model.resignedSide === 'w' ? 'black-win' : 'white-win',
    reason: `${model.resignedSide === 'w' ? 'White' : 'Black'} resigned` };
}
function canMove() {
  return model.state?.status === 'playing' && !model.loading && !playEndedByResignation() &&
    (model.mode === 'analyze' || model.state.turn === model.humanSide);
}
function isEngineTurn() {
  return model.mode === 'play' && model.state?.status === 'playing' && !resignedAtCursor() &&
    model.state.turn !== model.humanSide && model.cursor === model.line.length;
}
function toast(message, error = false) {
  const element = $('toast');
  element.textContent = message;
  element.classList.toggle('error', error);
  element.classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => element.classList.remove('visible'), error ? 6500 : 2800);
}
function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      startFen: model.startFen, moves: model.line.map(move => move.uci), cursor: model.cursor,
      mode: model.mode, humanSide: model.humanSide, flipped: model.flipped, time: model.time, engine: model.engine,
      scores: Array.from(model.scores).slice(-300), result: model.result, resignedSide: model.resignedSide,
      evaluatorKey: model.evaluatorKey
    }));
  } catch { /* Private browsing and a full storage quota must not interrupt a game. */ }
}
function stopAnalysis() {
  searchVersion += 1;
  host.cancel();
  model.searching = false;
}
function stopReview() {
  reviewVersion += 1;
  host.cancel();
  model.reviewing = false;
}

async function position({ startFen = model.startFen, moves = model.line.map(m => m.uci), cursor = moves.length, preserveFuture = false, mode = model.mode, clearScores = false, autoAnalyze = true } = {}) {
  stopAnalysis();
  stopReview();
  const version = ++requestVersion;
  model.loading = true;
  model.selected = null;
  renderControls();
  $('board').classList.add('loading');
  try {
    const state = await host.state(startFen, moves.slice(0, cursor).join(' '));
    if (version !== requestVersion) return false;
    const oldLine = model.line;
    acceptEvaluator(state.evaluator);
    model.state = state;
    model.startFen = cursor === 0 ? state.fen : startFen;
    model.line = preserveFuture ? [...state.history, ...oldLine.slice(cursor)] : state.history;
    model.cursor = cursor;
    model.mode = mode;
    model.loading = false;
    model.analysis = null;
    if (clearScores) { model.scores.clear(); model.evaluations.clear(); model.reviewTotal = 0; model.reviewProgress = 0; }
    if (!preserveFuture) {
      model.resignedSide = null;
      if (cursor === model.line.length) model.result = resultFromStatus(state.status);
    }
    render();
    persist();
    if (autoAnalyze) analyze();
    return true;
  } catch (error) {
    if (version !== requestVersion) return false;
    model.loading = false;
    renderBoard();
    renderControls();
    $('board').classList.remove('loading');
    if (error.name === 'AbortError') return false;
    if (model.state) analyze();
    throw error;
  }
}
function safely(promise) { promise.catch(error => toast(error.message, true)); }

function acceptEvaluator(evaluator) {
  const key = JSON.stringify(evaluator || { kind: 'handcrafted' });
  if (model.evaluatorKey === key) return false;
  model.evaluatorKey = key;
  if (model.state) model.state.evaluator = evaluator;
  model.scores.clear(); model.evaluations.clear(); model.analysis = null;
  model.reviewTotal = 0; model.reviewProgress = 0;
  return true;
}

function renderBoard() {
  const board = $('board');
  board.classList.toggle('loading', model.loading);
  const legal = model.selected ? model.state?.legal.filter(move => move.from === model.selected) || [] : [];
  const targets = new Set(legal.map(move => move.to));
  const last = model.cursor > 0 ? model.line[model.cursor - 1]?.uci : null;
  const focused = document.activeElement?.dataset?.square;
  let html = '';
  for (let row = 0; row < 8; row++) {
    for (let column = 0; column < 8; column++) {
      const file = model.flipped ? 7 - column : column;
      const rank = model.flipped ? row : 7 - row;
      const square = `${FILES[file]}${rank + 1}`;
      const piece = model.state?.board[rank * 8 + file];
      const selected = square === model.selected;
      const classes = ['square', (file + rank) % 2 === 0 ? 'dark' : 'light'];
      if (piece) classes.push('has-piece');
      if (selected) classes.push('selected');
      if (targets.has(square)) classes.push('legal');
      if (last && (square === last.slice(0, 2) || square === last.slice(2, 4))) classes.push('last-move');
      if (model.state?.check && piece === (model.state.turn === 'w' ? 'K' : 'k')) classes.push('check');
      const label = `${square}${piece ? `, ${pieceSide(piece) === 'w' ? 'White' : 'Black'} ${PIECE_NAMES[piece.toLowerCase()]}` : ', empty'}${targets.has(square) ? ', legal destination' : ''}`;
      const draggable = !!(piece && canMove() && pieceSide(piece) === model.state.turn);
      html += `<button class="${classes.join(' ')}" data-square="${square}" aria-label="${label}" aria-pressed="${selected}" draggable="${draggable}" tabindex="${square === (focused || model.selected || (model.flipped ? 'h8' : 'a1')) ? '0' : '-1'}">${column === 0 ? `<span class="coordinate rank-coordinate">${rank + 1}</span>` : ''}${row === 7 ? `<span class="coordinate file-coordinate">${FILES[file]}</span>` : ''}${pieceSVG(piece)}</button>`;
    }
  }
  board.innerHTML = html;
  if (focused) board.querySelector(`[data-square="${focused}"]`)?.focus({ preventScroll: true });
  $('evaluation-bar').classList.toggle('flipped', model.flipped);
}

function renderPlayer(side, id) {
  const horde = side === 'w';
  const count = model.state?.board.filter(piece => piece && pieceSide(piece) === side).length;
  const isTurn = model.state?.turn === side && displayState()?.status === 'playing';
  const isHuman = model.mode === 'play' && model.humanSide === side;
  const engineName = ENGINES[model.engine]?.label || 'Horde engine';
  const detail = model.mode === 'analyze' ? (horde ? 'White · 36-pawn horde' : 'Black · Classical army') : isHuman ? 'You' : engineName;
  const turnLabel = model.searching && isEngineTurn() && isTurn ? 'Thinking' : isHuman ? 'Your turn' : 'To move';
  $(id).innerHTML = `<div class="player-identity"><div class="player-avatar">${pieceSVG(horde ? 'P' : 'k')}</div><div><div class="player-name">${horde ? 'The Horde' : 'The Army'}</div><div class="player-detail">${escapeHTML(detail)}</div></div></div><div class="player-right"><span class="player-count">${count ?? '—'} ${count === 1 ? 'piece' : 'pieces'}</span>${isTurn ? `<span class="player-turn ${model.searching && isEngineTurn() ? 'thinking' : ''}"><span class="status-dot"></span>${turnLabel}</span>` : ''}</div>`;
}

function renderControls() {
  const state = displayState();
  const engine = ENGINES[model.engine] || ENGINES[DEFAULT_ENGINE];
  const evaluatorDescription = state?.evaluator?.description || host.evaluator?.description || (engine.network ? `${engine.weight}% neural, ${100 - engine.weight}% handcrafted evaluation` : 'Handcrafted evaluation');
  $('evaluator-label').textContent = engine.label;
  $('evaluator-label').title = engine.description ? `${engine.description}. ${evaluatorDescription}` : evaluatorDescription;
  $('evaluator-description').textContent = evaluatorDescription;
  $('engine-note').textContent = model.engineError ? 'Engine unavailable' : model.engineLoading ? 'Loading WebAssembly engine…' : `WebAssembly in your browser${host.simd === false ? ' (no SIMD)' : ''}`;
  $('engine-dot').style.background = model.engineError ? '#da534c' : model.engineLoading ? 'var(--faint)' : '';
  $('engine-select').value = model.engine;
  const analyzing = model.mode === 'analyze';
  $('mode-play').classList.toggle('active', !analyzing);
  $('mode-analyze').classList.toggle('active', analyzing);
  $('mode-play').setAttribute('aria-selected', String(!analyzing));
  $('mode-analyze').setAttribute('aria-selected', String(analyzing));
  $('side-setting').hidden = analyzing;
  $('side-white').classList.toggle('active', model.humanSide === 'w');
  $('side-black').classList.toggle('active', model.humanSide === 'b');
  $('side-white').setAttribute('aria-pressed', String(model.humanSide === 'w'));
  $('side-black').setAttribute('aria-pressed', String(model.humanSide === 'b'));
  $('think-time').value = String(model.time);
  $('mode-description').textContent = analyzing ? 'Explore both sides. Every position is analyzed in your browser.' : model.humanSide === 'w' ? 'Command the pawns. Find a way through.' : 'Lead the army. Hold back the horde.';
  $('best-move').disabled = model.loading || !model.analysis?.bestMove || state?.status !== 'playing';
  $('undo').disabled = model.loading || !model.cursor;
  $('resign').hidden = analyzing;
  $('resign').disabled = model.loading || state?.status !== 'playing' || !!model.resignedSide || model.cursor !== model.line.length;
  $('first-move').disabled = $('previous-move').disabled = model.loading || model.cursor === 0;
  $('next-move').disabled = $('last-move').disabled = model.loading || model.cursor >= model.line.length;
  $('fen-open').disabled = !state;
  $('pgn-export').disabled = !state;
  $('search-indicator').classList.toggle('searching', model.searching || model.reviewing || model.engineLoading);
  $('search-status').textContent = model.engineError ? 'Unavailable' : model.engineLoading ? 'Loading' : model.reviewing ? 'Reviewing' : model.searching ? 'Searching' : state?.status && state.status !== 'playing' ? 'Game over' : model.analysis ? 'Complete' : 'Ready';
  $('review-game').disabled = model.loading || model.engineLoading || !model.line.length;
  $('review-game').classList.toggle('reviewing', model.reviewing);
  $('review-game').setAttribute('aria-pressed', String(model.reviewing));
  $('review-label').textContent = model.reviewing ? 'Stop review' : 'Review game';
  $('review-progress').textContent = model.reviewing ? `${model.reviewProgress} / ${model.reviewTotal} positions` : model.reviewTotal && model.reviewProgress === model.reviewTotal ? `${model.reviewTotal} positions reviewed` : 'Analyze every position';
  let status = 'Loading the engine…';
  if (model.engineError) status = model.engineError;
  else if (model.loading) status = 'Loading position…';
  else if (model.engineLoading && state) status = `Loading ${engine.label}…`;
  else if (state) {
    if (state.status !== 'playing') status = terminalDescription(state);
    else if (model.cursor < model.line.length) status = 'Reviewing game · move to branch from here';
    else if (analyzing) status = `${state.turn === 'w' ? 'White' : 'Black'} to move${state.check ? ' · Check' : ''}`;
    else if (isEngineTurn()) status = `${state.turn === 'w' ? 'The horde' : 'The army'} is thinking…`;
    else status = `Your move${state.check ? ' · Your king is in check' : ''}`;
  }
  $('position-status').textContent = status;
  $('position-dot').style.background = state?.status === 'playing' ? '' : 'var(--faint)';
  renderPlayer(model.flipped ? 'w' : 'b', 'top-player');
  renderPlayer(model.flipped ? 'b' : 'w', 'bottom-player');
}

function terminalDescription(state) {
  const title = state.status === 'white-win' ? 'The horde wins' : state.status === 'black-win' ? 'The army wins' : 'Draw';
  return state.reason ? `${title} · ${state.reason}` : title;
}
function resultFromStatus(status) { return ({ 'white-win': '1-0', 'black-win': '0-1', draw: '1/2-1/2' })[status] || '*'; }
function formatCount(value) {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}m`;
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 100000 ? 0 : 1)}k`;
  return String(value);
}
function scoreText(info) {
  if (!info) return '—';
  if (info.mate !== null && info.mate !== undefined) return `${info.mate < 0 ? '−' : '+'}M${Math.abs(info.mate)}`;
  const value = Number(info.score) / 100;
  return `${value < 0 ? '−' : '+'}${Math.abs(value).toFixed(2)}`;
}
function describeScore(info) {
  if (!info) return 'Finding the balance';
  if (info.mate !== null && info.mate !== undefined) return info.mate >= 0 ? 'Checkmate for the horde' : 'Winning line for the army';
  const score = Number(info.score);
  if (Math.abs(score) < 35) return 'An even position';
  return score > 0 ? (score > 200 ? 'Horde advantage' : 'The horde has an edge') : (score < -200 ? 'Army advantage' : 'The army has an edge');
}
function renderAnalysis() {
  const info = model.analysis;
  const state = displayState();
  const over = state && state.status !== 'playing';
  $('score').textContent = over ? (state.status === 'white-win' ? '1–0' : state.status === 'black-win' ? '0–1' : '½–½') : scoreText(info);
  $('score-description').textContent = over ? (state.status === 'white-win' ? 'The horde wins' : state.status === 'black-win' ? 'The army wins' : 'Drawn position') : describeScore(info);
  $('stat-depth').textContent = info?.depth ?? '—';
  $('stat-nodes').textContent = formatCount(info?.nodes);
  $('stat-nps').textContent = formatCount(info?.nps);
  $('stat-time').textContent = info ? (info.timeMs >= 1000 ? `${(info.timeMs / 1000).toFixed(2)}s` : `${Math.round(info.timeMs || 0)}ms`) : '—';
  const pv = info?.pv || [];
  if (pv.length) {
    const fen = state.fen.split(' ');
    let side = state.turn;
    let moveNumber = Number(fen[5]) || 1;
    $('pv').innerHTML = pv.slice(0, 8).map((move, index) => {
      const prefix = side === 'w' ? `${moveNumber}. ` : index === 0 ? `${moveNumber}… ` : '';
      if (side === 'b') moveNumber++;
      side = side === 'w' ? 'b' : 'w';
      return `<span class="pv-number">${prefix}</span>${escapeHTML(move.san || move.uci)}`;
    }).join(' ') + (pv.length > 8 ? ' …' : '');
    $('pv').title = pv.map(move => move.san || move.uci).join(' ');
  } else {
    $('pv').textContent = over ? 'This game has reached its conclusion.' : model.searching ? 'Searching for the strongest continuation…' : 'Analysis will appear here.';
    $('pv').title = '';
  }
  let whiteShare = 50;
  if (over) whiteShare = state.status === 'white-win' ? 100 : state.status === 'black-win' ? 0 : 50;
  else if (info) whiteShare = info.mate !== null && info.mate !== undefined ? (info.mate >= 0 ? 99 : 1) : 50 + 47 * Math.tanh(Number(info.score) / 650);
  $('evaluation-bar').querySelector('.evaluation-white').style.height = `${whiteShare}%`;
  $('evaluation-bar').setAttribute('aria-label', over ? terminalDescription(state) : info ? `White evaluation ${scoreText(info)} pawns. ${describeScore(info)}.` : 'Position evaluation pending');
  renderControls();
}

function moveRows() {
  const fields = model.startFen.split(' ');
  const firstMove = Number(fields[5]) || 1;
  const firstSide = fields[1] === 'b' ? 1 : 0;
  const rows = [];
  model.line.forEach((move, index) => {
    const number = firstMove + Math.floor((index + firstSide) / 2);
    let row = rows[rows.length - 1];
    if (!row || row.number !== number) { row = { number, w: null, b: null }; rows.push(row); }
    row[(index + firstSide) % 2 === 0 ? 'w' : 'b'] = { ...move, ply: index + 1 };
  });
  return rows;
}
function renderHistory() {
  const list = $('move-list');
  if (model.line.length) {
    const moveButton = move => {
      if (!move) return '<span></span>';
      const score = model.scores.get(move.fen);
      const info = model.evaluations.get(move.fen);
      const label = info ? scoreText(info) : Number.isFinite(score) ? `${score < 0 ? '−' : '+'}${(Math.abs(score) / 100).toFixed(1)}` : '';
      return `<button class="move-button ${move.ply === model.cursor ? 'active' : ''} ${move.ply > model.cursor ? 'future' : ''}" data-ply="${move.ply}" ${move.ply === model.cursor ? 'aria-current="step"' : ''} title="${escapeHTML(move.uci)}${label ? ` · White evaluation ${label}` : ''}"><span>${escapeHTML(move.san || move.uci)}</span>${label ? `<span class="move-eval">${label}</span>` : ''}</button>`;
    };
    list.innerHTML = moveRows().map(row => `<div class="move-row"><span class="move-number">${row.number}.</span>${moveButton(row.w)}${moveButton(row.b)}</div>`).join('');
    const active = list.querySelector('.active');
    if (active) {
      const top = active.offsetTop - list.offsetTop;
      if (top < list.scrollTop || top + active.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = Math.max(0, top - list.clientHeight / 2);
    }
  } else {
    list.innerHTML = '<div class="empty-history"><span class="empty-history-mark" aria-hidden="true">♙</span><p>Every pawn has potential.</p><span>Make your first move to begin.</span></div>';
  }
  $('move-counter').textContent = `${model.line.length} ${model.line.length === 1 ? 'ply' : 'plies'}`;
  $('move-position').textContent = model.cursor === 0 ? 'START POSITION' : `${model.cursor} / ${model.line.length} PLIES`;
  renderGraph();
}
function renderGraph() {
  const fens = [model.startFen, ...model.line.map(move => move.fen)];
  const points = [];
  const span = Math.max(1, model.line.length);
  fens.forEach((fen, ply) => {
    const score = model.scores.get(fen);
    if (Number.isFinite(score)) points.push({ x: 3 + (ply / span) * 334, y: 29 - 25 * Math.tanh(score / 650), ply });
  });
  let svg = '<defs><linearGradient id="graph-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#aeca82" stop-opacity=".17"/><stop offset="100%" stop-color="#aeca82" stop-opacity=".015"/></linearGradient></defs><line x1="0" y1="29" x2="340" y2="29" class="graph-zero"/>';
  if (points.length > 1) {
    const coords = points.map(point => `${point.x},${point.y}`).join(' ');
    svg += `<polygon points="${points[0].x},58 ${coords} ${points[points.length - 1].x},58" fill="url(#graph-fill)"/><polyline points="${coords}" class="graph-line"/>`;
  }
  const cursorX = 3 + (model.cursor / span) * 334;
  if (model.line.length) svg += `<line x1="${cursorX}" y1="2" x2="${cursorX}" y2="56" class="graph-cursor"/>`;
  const active = points.find(point => point.ply === model.cursor);
  if (active) svg += `<circle cx="${active.x}" cy="${active.y}" r="3.5" class="graph-dot"/>`;
  else if (points.length === 1) svg += `<circle cx="${points[0].x}" cy="${points[0].y}" r="2.5" class="graph-dot"/>`;
  $('eval-graph').innerHTML = svg;
  $('eval-graph').setAttribute('aria-label', `White evaluation across ${points.length} analyzed positions. Click to navigate the game.`);
  $('graph-caption').textContent = points.length > 1 ? `${points.length} positions analyzed` : 'Build a picture, move by move';
}
function render() { renderBoard(); renderControls(); renderAnalysis(); renderHistory(); }

function analyze() {
  stopAnalysis();
  stopReview();
  model.analysis = null;
  if (!model.state || model.loading || model.engineLoading || model.state.status !== 'playing' || playEndedByResignation()) { renderAnalysis(); return; }
  const version = searchVersion;
  const fen = model.state.fen;
  model.searching = true;
  renderAnalysis();
  const receive = info => {
    if (version !== searchVersion) return null;
    if (acceptEvaluator(info.evaluator)) { renderControls(); renderHistory(); }
    model.analysis = info;
    model.evaluations.set(fen, info);
    const score = info.mate !== null && info.mate !== undefined ? (info.mate < 0 ? -10000 : 10000) : Number(info.score);
    if (Number.isFinite(score)) model.scores.set(fen, score);
    renderAnalysis();
    renderGraph();
    return info;
  };
  host.search({ fen: model.startFen, moves: currentMoves().join(' '), timeMs: model.time, depth: 64 }, receive)
    .then(final => {
      if (version !== searchVersion) return;
      const info = receive(final);
      model.searching = false;
      renderAnalysis();
      renderHistory();
      persist();
      if (info?.bestMove && isEngineTurn()) {
        // Let the completed line paint, then move. The token prevents stale searches playing moves.
        requestAnimationFrame(() => { if (version === searchVersion && isEngineTurn()) safely(playMove(info.bestMove)); });
      }
    })
    .catch(error => {
      if (version !== searchVersion || error.name === 'AbortError') return;
      model.searching = false;
      renderControls();
      $('search-status').textContent = 'Unavailable';
      if (isEngineTurn()) $('position-status').textContent = 'Engine paused · change the time setting to retry';
      toast(error.message || 'The engine could not analyze this position.', true);
    });
}

async function reviewPosition(startFen, moves, time, version) {
  try {
    return await host.search({ fen: startFen, moves: moves.join(' '), timeMs: time, depth: 64 });
  } catch (error) {
    if (version !== reviewVersion || error.name === 'AbortError') return null;
    throw new Error(error.message || 'The game review could not be completed.');
  }
}
async function reviewGame() {
  if (model.reviewing) { stopReview(); renderControls(); toast('Review stopped. Completed evaluations are saved.'); return; }
  if (!model.line.length || model.loading || model.engineLoading) return;
  stopAnalysis(); stopReview();
  const version = reviewVersion;
  const startFen = model.startFen;
  const moves = model.line.map(move => move.uci);
  const fens = [startFen, ...model.line.map(move => move.fen)];
  const time = model.time;
  model.mode = 'analyze';
  model.reviewing = true;
  model.reviewProgress = 0;
  model.reviewTotal = fens.length;
  render();
  try {
    for (let ply = 0; ply < fens.length; ply++) {
      if (version !== reviewVersion) return;
      const info = await reviewPosition(startFen, moves.slice(0, ply), time, version);
      if (!info || version !== reviewVersion) return;
      if (acceptEvaluator(info.evaluator)) {
        render();
        if (ply > 0) throw new Error('The evaluator changed during review. Start the review again to use one evaluator throughout.');
      }
      model.reviewTotal = fens.length;
      const score = info.mate !== null && info.mate !== undefined ? (info.mate < 0 ? -10000 : 10000) : Number(info.score);
      if (Number.isFinite(score)) model.scores.set(fens[ply], score);
      model.evaluations.set(fens[ply], info);
      if (ply === model.cursor) model.analysis = info;
      model.reviewProgress = ply + 1;
      renderAnalysis(); renderHistory(); persist();
    }
    model.reviewing = false;
    renderControls();
    toast(`Reviewed all ${fens.length} positions. Select any move to explore.`);
  } catch (error) {
    if (version !== reviewVersion) return;
    stopReview(); renderControls(); toast(error.message, true);
  }
}

async function playMove(uci) {
  if (model.loading || model.state?.status !== 'playing' || playEndedByResignation()) return;
  if (!model.state.legal.some(move => move.uci === uci)) throw new Error('That move is no longer legal in this position.');
  const moves = [...currentMoves(), uci];
  await position({ moves, cursor: moves.length });
}
function selectSquare(square) {
  if (!canMove()) return;
  const piece = pieceAt(square);
  if (model.selected) {
    const candidates = model.state.legal.filter(move => move.from === model.selected && move.to === square);
    if (candidates.length) {
      if (candidates.length > 1) openPromotion(candidates);
      else safely(playMove(candidates[0].uci));
      return;
    }
  }
  model.selected = piece && pieceSide(piece) === model.state.turn && model.selected !== square ? square : null;
  renderBoard();
}
function openPromotion(candidates) {
  promotionCandidates = candidates;
  const names = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' };
  $('promotion-options').innerHTML = ['q', 'r', 'b', 'n'].filter(type => candidates.some(move => move.promotion === type || move.uci.endsWith(type))).map(type => `<button class="promotion-option" data-promotion="${type}">${pieceSVG(model.state.turn === 'w' ? type.toUpperCase() : type)}<span>${names[type]}</span></button>`).join('');
  $('promotion-dialog').showModal();
}
function navigate(cursor) {
  if (model.loading || cursor === model.cursor || cursor < 0 || cursor > model.line.length) return;
  safely(position({ cursor, preserveFuture: true }));
}
function setMode(mode) {
  if (model.mode === mode) return;
  model.mode = mode;
  model.selected = null;
  render();
  persist();
  analyze();
}
function setSide(side) {
  if (model.humanSide === side) return;
  model.humanSide = side;
  model.flipped = side === 'b';
  model.selected = null;
  render();
  persist();
  analyze();
}
function flip() { model.flipped = !model.flipped; renderBoard(); renderControls(); persist(); }
function resign() {
  if (model.mode !== 'play' || model.loading || model.state?.status !== 'playing' ||
      model.resignedSide || model.cursor !== model.line.length) return;
  stopAnalysis();
  stopReview();
  model.resignedSide = model.humanSide;
  model.result = model.humanSide === 'w' ? '0-1' : '1-0';
  model.selected = null;
  model.analysis = null;
  render();
  persist();
}

// Download the module and the chosen network, then start a worker for them.
async function configureEngine(name) {
  const engine = ENGINES[name] || ENGINES[DEFAULT_ENGINE];
  model.engine = ENGINES[name] ? name : DEFAULT_ENGINE;
  model.engineLoading = true;
  model.engineError = null;
  renderControls();
  const version = ++engineVersion;
  try {
    const evaluator = await host.configure({ network: engine.network, weight: engine.weight, name: engine.label });
    if (version !== engineVersion) return false;
    model.engineLoading = false;
    if (acceptEvaluator(evaluator)) renderHistory();
    renderControls();
    return true;
  } catch (error) {
    if (version !== engineVersion) return false;
    model.engineLoading = false;
    model.engineError = error.message || 'The engine could not be loaded in this browser.';
    renderControls();
    throw error;
  }
}
async function setEngine(name) {
  if (!ENGINES[name] || name === model.engine) return;
  stopAnalysis();
  stopReview();
  persist();
  const engine = ENGINES[name];
  const changed = await configureEngine(name);
  if (!changed) return;
  persist();
  render();
  toast(`${engine.label} ready${engine.rating ? ` · rated ${engine.rating}` : ''}.`);
  analyze();
}
async function loadCatalogue() {
  try {
    const response = await fetch('./engines.json');
    if (!response.ok) return;
    const catalogue = await response.json();
    for (const [name, entry] of Object.entries(catalogue.engines || {})) {
      if (!ENGINES[name]) continue;
      ENGINES[name].description = entry.description;
      ENGINES[name].rating = entry.rating;
      const option = $('engine-select').querySelector(`option[value="${name}"]`);
      if (option) { option.textContent = `${ENGINES[name].label}${entry.rating ? ` · ${entry.rating}` : ''}`; option.title = entry.description || ''; }
    }
    $('engine-select').title = catalogue.rating_source ? `Ratings: ${catalogue.rating_source}` : '';
    renderControls();
  } catch { /* The picker works without descriptions. */ }
}

$('board').addEventListener('click', event => {
  const square = event.target.closest('[data-square]')?.dataset.square;
  if (square) selectSquare(square);
});
$('board').addEventListener('keydown', event => {
  const square = event.target.closest('[data-square]')?.dataset.square;
  if (!square || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault(); event.stopPropagation();
  const buttons = Array.from($('board').children);
  const index = buttons.findIndex(button => button.dataset.square === square);
  const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8 }[event.key];
  const next = index + offset;
  if (next >= 0 && next < 64 && (Math.abs(offset) === 8 || Math.floor(index / 8) === Math.floor(next / 8))) {
    buttons[index].tabIndex = -1; buttons[next].tabIndex = 0; buttons[next].focus();
  }
});
$('board').addEventListener('dragstart', event => {
  const square = event.target.closest('[data-square]');
  const piece = square && pieceAt(square.dataset.square);
  if (!piece || !canMove() || pieceSide(piece) !== model.state.turn) { event.preventDefault(); return; }
  dragFrom = square.dataset.square;
  model.selected = dragFrom;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', dragFrom);
  const pieceElement = square.querySelector('.piece');
  if (pieceElement) {
    const rect = pieceElement.getBoundingClientRect();
    event.dataTransfer.setDragImage(pieceElement, rect.width / 2, rect.height / 2);
  }
  // Keep the source node mounted throughout the native drag operation.
  requestAnimationFrame(() => {
    if (!dragFrom) return;
    const legalTargets = new Set(model.state.legal.filter(move => move.from === dragFrom).map(move => move.to));
    for (const button of $('board').children) {
      const selected = button.dataset.square === dragFrom;
      button.classList.toggle('selected', selected);
      button.classList.toggle('dragging', selected);
      button.classList.toggle('legal', legalTargets.has(button.dataset.square));
      button.setAttribute('aria-pressed', String(selected));
    }
  });
});
$('board').addEventListener('dragover', event => {
  if (!dragFrom) return;
  const square = event.target.closest('[data-square]');
  if (!square) return;
  event.preventDefault(); event.dataTransfer.dropEffect = 'move';
  for (const old of $('board').querySelectorAll('.drag-over')) old.classList.remove('drag-over');
  square.classList.add('drag-over');
});
$('board').addEventListener('drop', event => {
  event.preventDefault();
  const square = event.target.closest('[data-square]')?.dataset.square;
  if (!dragFrom || !square) return;
  model.selected = dragFrom;
  dragFrom = null;
  selectSquare(square);
});
document.addEventListener('dragend', () => {
  if (dragFrom) { dragFrom = null; renderBoard(); }
  else for (const element of $('board').querySelectorAll('.dragging, .drag-over')) element.classList.remove('dragging', 'drag-over');
});
$('promotion-options').addEventListener('click', event => {
  const type = event.target.closest('[data-promotion]')?.dataset.promotion;
  if (!type) return;
  const move = promotionCandidates.find(candidate => candidate.promotion === type || candidate.uci.endsWith(type));
  $('promotion-dialog').close();
  if (move) safely(playMove(move.uci));
});
$('move-list').addEventListener('click', event => {
  const ply = event.target.closest('[data-ply]')?.dataset.ply;
  if (ply) navigate(Number(ply));
});
$('eval-graph').addEventListener('click', event => {
  if (!model.line.length) return;
  const bounds = $('eval-graph').getBoundingClientRect();
  const fraction = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
  navigate(Math.round(fraction * model.line.length));
});
$('mode-play').addEventListener('click', () => setMode('play'));
$('mode-analyze').addEventListener('click', () => setMode('analyze'));
$('side-white').addEventListener('click', () => setSide('w'));
$('side-black').addEventListener('click', () => setSide('b'));
$('engine-select').addEventListener('change', () => safely(setEngine($('engine-select').value)));
$('think-time').addEventListener('change', () => { model.time = Number($('think-time').value); persist(); analyze(); });
$('flip').addEventListener('click', flip);
$('resign').addEventListener('click', resign);
$('new-game').addEventListener('click', () => safely(position({ startFen: START_FEN, moves: [], cursor: 0, clearScores: true })));
$('first-move').addEventListener('click', () => navigate(0));
$('previous-move').addEventListener('click', () => navigate(model.cursor - 1));
$('next-move').addEventListener('click', () => navigate(model.cursor + 1));
$('last-move').addEventListener('click', () => navigate(model.line.length));
$('undo').addEventListener('click', () => {
  if (model.loading || !model.cursor) return;
  let cursor = model.cursor - 1;
  if (model.mode === 'play') {
    // Undo a full human+engine turn, or the human move if the engine is still thinking.
    const firstSide = model.startFen.split(' ')[1] === 'b' ? 1 : 0;
    const humanParity = model.humanSide === 'w' ? 0 : 1;
    while (cursor > 0 && (firstSide + cursor) % 2 !== humanParity) cursor--;
  }
  safely(position({ moves: currentMoves().slice(0, cursor), cursor }));
});
$('best-move').addEventListener('click', () => { if (model.analysis?.bestMove) safely(playMove(model.analysis.bestMove)); });
$('review-game').addEventListener('click', () => safely(reviewGame()));

document.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey || document.querySelector('dialog[open]') || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
  const navigation = { ArrowLeft: model.cursor - 1, ArrowRight: model.cursor + 1, Home: 0, End: model.line.length };
  if (event.key in navigation) { event.preventDefault(); navigate(navigation[event.key]); }
  else if (event.key.toLowerCase() === 'f') { event.preventDefault(); flip(); }
  else if (event.key === 'Escape') { model.selected = null; renderBoard(); }
});
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => $(button.dataset.close).close());
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
});

$('fen-open').addEventListener('click', () => {
  $('fen-input').value = model.state?.fen || START_FEN;
  $('fen-error').textContent = '';
  $('fen-dialog').showModal();
});
async function copyText(text) {
  if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; }
  const input = document.createElement('textarea');
  input.value = text; input.style.position = 'fixed'; input.style.opacity = '0';
  (document.querySelector('dialog[open]') || document.body).appendChild(input);
  input.select();
  const copied = document.execCommand('copy'); input.remove();
  if (!copied) throw new Error('Clipboard access is unavailable. Select and copy the FEN text directly.');
}
$('fen-copy').addEventListener('click', () => safely(copyText($('fen-input').value.trim()).then(() => toast('FEN copied to clipboard.'))));
$('fen-load').addEventListener('click', async () => {
  const fen = $('fen-input').value.trim();
  if (!fen) { $('fen-error').textContent = 'Enter a FEN position first.'; return; }
  $('fen-error').textContent = ''; $('fen-load').disabled = true;
  try {
    const loaded = await position({ startFen: fen, moves: [], cursor: 0, mode: 'analyze', clearScores: true });
    if (loaded) { $('fen-dialog').close(); toast('Position loaded for analysis.'); }
  } catch (error) { $('fen-error').textContent = error.message; }
  finally { $('fen-load').disabled = false; }
});
$('pgn-open').addEventListener('click', () => { $('pgn-error').textContent = ''; $('pgn-dialog').showModal(); });
$('pgn-file').addEventListener('change', async () => {
  const file = $('pgn-file').files[0];
  if (!file) return;
  if (file.size > 750 * 1024) { $('pgn-error').textContent = 'Please choose a single game smaller than 750 KB.'; return; }
  try { $('pgn-input').value = await file.text(); $('pgn-error').textContent = ''; }
  catch { $('pgn-error').textContent = 'Could not read this file.'; }
  $('pgn-file').value = '';
});
$('pgn-import').addEventListener('click', async () => {
  const pgn = $('pgn-input').value.trim();
  if (!pgn) { $('pgn-error').textContent = 'Paste a game or open a PGN file first.'; return; }
  $('pgn-import').disabled = true; $('pgn-error').textContent = '';
  try {
    stopAnalysis(); stopReview();
    const game = await host.importPgn(pgn);
    const moves = game.moves.map(move => typeof move === 'string' ? move : move.uci);
    const loaded = await position({ startFen: game.startFen, moves, cursor: moves.length, mode: 'analyze', clearScores: true });
    if (loaded) {
      model.result = game.result || resultFromStatus(model.state.status); persist();
      $('pgn-dialog').close(); toast(`Imported ${moves.length} plies. Use the arrow keys to explore.`);
    }
  } catch (error) { $('pgn-error').textContent = error.message; }
  finally { $('pgn-import').disabled = false; }
});
function exportPGN() {
  const now = new Date();
  const date = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
  const result = model.result || '*';
  const escapeTag = value => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const engine = ENGINES[model.engine]?.label || 'Horde engine';
  const headers = { Event: 'Horde game', Site: 'Horde engine studio', Date: date, Round: '-', White: model.mode === 'play' && model.humanSide === 'b' ? engine : 'The Horde', Black: model.mode === 'play' && model.humanSide === 'w' ? engine : 'The Army', Result: result, Variant: 'Horde', SetUp: '1', FEN: model.startFen };
  const text = Object.entries(headers).map(([key, value]) => `[${key} "${escapeTag(value)}"]`).join('\n');
  const words = moveRows().map(row => `${row.number}.${row.w ? ` ${row.w.san || row.w.uci}` : '..'}${row.b ? ` ${row.b.san || row.b.uci}` : ''}`).join(' ') + ` ${result}`;
  const wrapped = words.trim().match(/.{1,78}(?:\s|$)|\S+/g)?.map(line => line.trim()).join('\n') || result;
  const blob = new Blob([`${text}\n\n${wrapped}\n`], { type: 'application/x-chess-pgn;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = `horde-${date.replaceAll('.', '-')}.pgn`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('PGN exported.');
}
$('pgn-export').addEventListener('click', exportPGN);
window.addEventListener('pagehide', () => { stopAnalysis(); stopReview(); persist(); });

async function initialize() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { /* Ignore malformed local storage. */ }
  const restorable = saved && typeof saved.startFen === 'string' && Array.isArray(saved.moves) && saved.moves.every(move => typeof move === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move));
  if (restorable) {
    model.mode = saved.mode === 'analyze' ? 'analyze' : 'play';
    model.humanSide = saved.humanSide === 'b' ? 'b' : 'w';
    model.flipped = !!saved.flipped;
    model.time = [100, 250, 500, 1000, 3000, 10000].includes(saved.time) ? saved.time : 250;
    model.engine = ENGINES[saved.engine] ? saved.engine : DEFAULT_ENGINE;
    model.evaluatorKey = typeof saved.evaluatorKey === 'string' ? saved.evaluatorKey : null;
    if (Array.isArray(saved.scores)) model.scores = new Map(saved.scores.filter(entry => Array.isArray(entry) && typeof entry[0] === 'string' && Number.isFinite(entry[1])));
  }
  render();
  loadCatalogue();
  try { await configureEngine(model.engine); }
  catch (error) { toast(error.message, true); return; }
  if (restorable) {
    try {
      // Replay the full line once so later moves stay available when restoring an earlier cursor.
      await position({ startFen: saved.startFen, moves: saved.moves, autoAnalyze: false });
      model.result = saved.result || model.result;
      model.resignedSide = ['w', 'b'].includes(saved.resignedSide) ? saved.resignedSide : null;
      if (model.resignedSide) model.result = model.resignedSide === 'w' ? '0-1' : '1-0';
      const cursor = Math.max(0, Math.min(saved.moves.length, Number.isInteger(saved.cursor) ? saved.cursor : saved.moves.length));
      if (cursor < saved.moves.length) await position({ cursor, preserveFuture: true });
      else analyze();
      persist();
      return;
    } catch { toast('The saved game could not be restored. Starting a fresh board.', true); }
  }
  try { await position({ startFen: START_FEN, moves: [], cursor: 0 }); }
  catch (error) { toast(error.message, true); }
}
initialize();
