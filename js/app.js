/*
 * Letters! — game logic
 * Plain browser JS, no build step. State is kept in memory and mirrored
 * to localStorage so a refresh or accidental close doesn't lose the game.
 */
(function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────
  const TOPICS = window.LETTERS_TOPICS || [];
  const STATE_KEY = 'letters-game/state/v1';
  const PREFS_KEY = 'letters-game/prefs/v1';
  const DECK_KEY = 'letters-game/deck/v1';
  const TARGETS = [5, 10, 15, 20];
  const DEFAULT_TARGET = 15;
  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 30;
  const TRICKY = ['Q', 'X', 'Z'];
  const CARD_COLORS = ['mint', 'peach', 'lavender', 'sky', 'lemon', 'pink'];
  const RING_LENGTH = 163.36; // 2 * PI * 26
  const RECENT_LETTERS = 8;   // a letter won't come back until this many others have been dealt

  // How many copies of each letter go into the letter bag. Weighted so
  // friendly letters come up more often than awkward ones.
  const LETTER_WEIGHTS = {
    A: 4, B: 3, C: 4, D: 3, E: 3, F: 3, G: 3, H: 3, I: 2, J: 2, K: 2, L: 3,
    M: 4, N: 2, O: 2, P: 4, Q: 1, R: 3, S: 5, T: 4, U: 1, V: 1, W: 3, X: 1,
    Y: 1, Z: 1
  };

  // ── Helpers ────────────────────────────────────────────
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  function vibrate(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* ignore */ }
  }

  function loadJSON(key) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }
  function saveJSON(key, value) {
    try {
      if (value === null || value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* storage unavailable: play on without persistence */ }
  }

  function normalizeTarget(n) {
    n = Number(n);
    return TARGETS.includes(n) ? n : DEFAULT_TARGET;
  }

  // ── Setup preferences (what the Judge picked on the setup screen) ──
  const defaultPrefs = () => ({
    players: [],          // [{ id, name }]
    mode: 'classic',      // 'classic' | 'casual'
    target: DEFAULT_TARGET,
    judgeId: null,
    rotateJudge: false,
    timer: 0,             // seconds, 0 = off
    tricky: false
  });
  let prefs = Object.assign(defaultPrefs(), loadJSON(PREFS_KEY) || {});
  if (!Array.isArray(prefs.players)) prefs.players = [];
  prefs.target = normalizeTarget(prefs.target);

  // ── Live game state ────────────────────────────────────
  let game = loadJSON(STATE_KEY); // null when no game in progress
  let timerHandle = null;
  let toastHandle = null;
  let confettiRaf = null;

  function savePrefs() { saveJSON(PREFS_KEY, prefs); }
  function saveGame() { saveJSON(STATE_KEY, game); saveDeck(); }

  // ── Screen routing ─────────────────────────────────────
  function show(name) {
    $$('.screen').forEach((s) => s.classList.toggle('active', s.dataset.screen === name));
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    if (name !== 'game') stopTimer();
    if (name !== 'victory' && name !== 'summary') stopConfetti();
  }

  // ── Home ───────────────────────────────────────────────
  function renderHome() {
    $('#btn-resume').classList.toggle('hidden', !(game && game.phase === 'game'));
    show('home');
  }

  // ── Setup ──────────────────────────────────────────────
  // Casual mode works with no names at all: the phone just deals cards and
  // whoever's holding it taps "Next card". Classic needs at least 2 players.
  function canStart() {
    const n = prefs.players.length;
    if (prefs.mode === 'casual') return n === 0 || n >= MIN_PLAYERS;
    return n >= MIN_PLAYERS;
  }

  function renderSetup() {
    const chips = $('#player-chips');
    chips.innerHTML = prefs.players.map((p, i) => `
      <span class="chip ${'tile-' + CARD_COLORS[i % CARD_COLORS.length]}">
        ${escapeHtml(p.name)}
        <button type="button" class="chip-remove" data-action="remove-player" data-id="${p.id}" aria-label="Remove ${escapeHtml(p.name)}">×</button>
      </span>`).join('');

    const n = prefs.players.length;
    const casual = prefs.mode === 'casual';
    $('#player-count').textContent = `${n} / ${MAX_PLAYERS}`;
    $('#players-optional').classList.toggle('hidden', !casual);
    const hint = $('#player-hint');
    if (n === 0 && casual) hint.textContent = 'Names are optional in Casual. Just hit Start and pass the phone around!';
    else if (n === 0) hint.textContent = 'Add at least 2 players to start. The Judge plays too!';
    else if (n < MIN_PLAYERS && casual) hint.textContent = 'Add one more player, or remove the name to play without names.';
    else if (n < MIN_PLAYERS) hint.textContent = `Add ${MIN_PLAYERS - n} more player to start.`;
    else if (n >= MAX_PLAYERS) hint.textContent = 'That is a full house! 30 players max.';
    else hint.textContent = 'Tap × to remove someone.';

    $('#input-player').disabled = n >= MAX_PLAYERS;
    $('#btn-start').disabled = !canStart();

    // Mode
    $$('[data-action="set-mode"]').forEach((b) => {
      const on = b.dataset.value === prefs.mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on);
    });
    $('#classic-sub').textContent = `First to ${prefs.target} Letters`;
    $('#target-field').classList.toggle('hidden', casual);
    $$('[data-action="set-target"]').forEach((b) => {
      const on = Number(b.dataset.value) === prefs.target;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on);
    });

    // Judge (only matters once there are names)
    $('#panel-judge').classList.toggle('hidden', n === 0);
    if (!prefs.players.some((p) => p.id === prefs.judgeId)) {
      prefs.judgeId = prefs.players.length ? prefs.players[0].id : null;
    }
    const sel = $('#select-judge');
    sel.innerHTML = prefs.players.length
      ? prefs.players.map((p) => `<option value="${p.id}" ${p.id === prefs.judgeId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')
      : '<option value="">Add players first</option>';
    sel.disabled = prefs.players.length === 0;
    $('#toggle-rotate').checked = !!prefs.rotateJudge;

    // Extras
    $$('[data-action="set-timer"]').forEach((b) => {
      const on = Number(b.dataset.value) === Number(prefs.timer);
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on);
    });
    $('#toggle-tricky').checked = !!prefs.tricky;

    savePrefs();
  }

  function addPlayer(rawName) {
    const name = rawName.trim().replace(/\s+/g, ' ').slice(0, 20);
    if (!name) return false;
    if (prefs.players.length >= MAX_PLAYERS) { toast('30 players is the max!'); return false; }
    if (prefs.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      toast(`${name} is already in the game`);
      return false;
    }
    prefs.players.push({ id: uid(), name });
    if (!prefs.judgeId) prefs.judgeId = prefs.players[0].id;
    renderSetup();
    return true;
  }

  function removePlayer(id) {
    prefs.players = prefs.players.filter((p) => p.id !== id);
    renderSetup();
  }

  // ── Decks ──────────────────────────────────────────────
  // The topic and letter bags live outside any single game, so a rematch or
  // a brand-new game keeps dealing from where the last one left off instead
  // of reshuffling and handing out the same cards again.
  function loadDeck(tricky) {
    const d = loadJSON(DECK_KEY) || {};
    const topicBag = (d.topicCount === TOPICS.length && Array.isArray(d.topicBag))
      ? d.topicBag.filter((i) => Number.isInteger(i) && i >= 0 && i < TOPICS.length)
      : [];
    const letterBag = (d.tricky === !!tricky && Array.isArray(d.letterBag)) ? d.letterBag : [];
    const recentLetters = Array.isArray(d.recentLetters) ? d.recentLetters : [];
    return { topicBag, letterBag, recentLetters };
  }

  function saveDeck() {
    if (!game) return;
    saveJSON(DECK_KEY, {
      topicCount: TOPICS.length,
      topicBag: game.topicBag,
      letterBag: game.letterBag,
      tricky: !!game.tricky,
      recentLetters: game.recentLetters
    });
  }

  function buildLetterBag(includeTricky) {
    const bag = [];
    Object.keys(LETTER_WEIGHTS).forEach((letter) => {
      if (!includeTricky && TRICKY.includes(letter)) return;
      for (let i = 0; i < LETTER_WEIGHTS[letter]; i++) bag.push(letter);
    });
    return shuffle(bag);
  }

  function drawLetter() {
    if (!Array.isArray(game.recentLetters)) game.recentLetters = [];
    const recent = game.recentLetters;
    let idx = -1;
    for (let attempt = 0; attempt < 2 && idx < 0; attempt++) {
      if (!game.letterBag.length) game.letterBag = buildLetterBag(game.tricky);
      // Take the top-most letter that hasn't been dealt recently.
      for (let i = game.letterBag.length - 1; i >= 0; i--) {
        if (!recent.includes(game.letterBag[i])) { idx = i; break; }
      }
      // Everything left in the bag was dealt recently: top it up and look again.
      if (idx < 0) game.letterBag = buildLetterBag(game.tricky).concat(game.letterBag);
    }
    if (idx < 0) idx = game.letterBag.length - 1;
    const letter = game.letterBag.splice(idx, 1)[0];
    recent.push(letter);
    while (recent.length > RECENT_LETTERS) recent.shift();
    return letter;
  }

  function drawTopics() {
    if (game.topicBag.length < 2) {
      // Leftovers go on top so they're dealt first, then a fresh shuffle.
      game.topicBag = shuffle(TOPICS.map((_, i) => i)).concat(game.topicBag);
    }
    return [game.topicBag.pop(), game.topicBag.pop()];
  }

  function newCard() {
    const prev = game.card;
    let color = CARD_COLORS[Math.floor(Math.random() * CARD_COLORS.length)];
    if (prev && color === prev.color) color = CARD_COLORS[(CARD_COLORS.indexOf(color) + 1) % CARD_COLORS.length];
    game.card = { letter: drawLetter(), topics: drawTopics(), chosen: null, color };
    game.cardNumber += 1;
  }

  // ── Game lifecycle ─────────────────────────────────────
  function setupFromPrefs() {
    return {
      mode: prefs.mode,
      target: normalizeTarget(prefs.target),
      players: prefs.players.map((p) => ({ id: p.id, name: p.name })),
      judgeId: prefs.judgeId,
      rotateJudge: !!prefs.rotateJudge,
      timer: Number(prefs.timer) || 0,
      tricky: !!prefs.tricky
    };
  }

  function startGame(setup) {
    setup = setup || setupFromPrefs();
    const n = setup.players.length;
    if (setup.mode === 'classic' && n < MIN_PLAYERS) return;
    if (setup.mode === 'casual' && n === 1) return;

    let judgeIndex = setup.players.findIndex((p) => p.id === setup.judgeId);
    if (judgeIndex < 0) judgeIndex = 0;
    const deck = loadDeck(setup.tricky);

    game = {
      phase: 'game',
      mode: setup.mode,
      target: normalizeTarget(setup.target),
      players: setup.players.map((p) => ({ id: p.id, name: p.name, score: 0 })),
      judgeIndex,
      rotateJudge: n ? !!setup.rotateJudge : false,
      timer: Number(setup.timer) || 0,
      tricky: !!setup.tricky,
      letterBag: deck.letterBag,
      topicBag: deck.topicBag,
      recentLetters: deck.recentLetters,
      card: null,
      cardNumber: 0,
      cardsAwarded: 0,
      history: [],
      winnerId: null
    };
    newCard();
    saveGame();
    renderGame(true);
    show('game');
    startTimer();
  }

  // Straight into a no-names Casual game from the home screen.
  function quickPlay() {
    prefs.mode = 'casual';
    savePrefs();
    startGame(Object.assign(setupFromPrefs(), { mode: 'casual', players: [] }));
  }

  function rematch() {
    if (!game) return renderSetup(), show('setup');
    // Same players, same settings, fresh scores. Keep prefs in sync too.
    if (game.players.length) {
      prefs.players = game.players.map((p) => ({ id: p.id, name: p.name }));
      prefs.judgeId = game.players[game.judgeIndex] ? game.players[game.judgeIndex].id : game.players[0].id;
    }
    prefs.mode = game.mode;
    prefs.target = normalizeTarget(game.target);
    prefs.rotateJudge = game.rotateJudge;
    prefs.timer = game.timer;
    prefs.tricky = game.tricky;
    savePrefs();
    startGame({
      mode: game.mode,
      target: game.target,
      players: game.players.map((p) => ({ id: p.id, name: p.name })),
      judgeId: game.players[game.judgeIndex] ? game.players[game.judgeIndex].id : null,
      rotateJudge: game.rotateJudge,
      timer: game.timer,
      tricky: game.tricky
    });
  }

  function resumeGame() {
    if (!game || game.phase !== 'game') return renderHome();
    renderGame(true);
    show('game');
    startTimer();
  }

  function endGame() {
    if (!game) return renderHome();
    stopTimer();
    if (game.mode === 'classic') {
      // Ending early: show standings with whoever is leading on top.
      const leader = game.players.slice().sort((a, b) => b.score - a.score)[0];
      game.phase = 'ended';
      saveGame();
      renderVictory(leader, false);
    } else {
      game.phase = 'ended';
      saveGame();
      renderSummary();
    }
  }

  const freePlay = () => !!game && game.players.length === 0;
  function currentJudge() { return game.players[game.judgeIndex] || null; }

  function advanceJudge() {
    if (!game.rotateJudge || !game.players.length) return;
    game.judgeIndex = (game.judgeIndex + 1) % game.players.length;
  }

  function award(playerId) {
    if (!game || game.phase !== 'game') return;
    const player = game.players.find((p) => p.id === playerId);
    if (!player) return;
    const judge = currentJudge();
    if (judge && player.id === judge.id) { toast('The Judge can\'t win their own card!'); return; }

    stopTimer();
    game.history.push({
      playerId,
      card: game.card,
      judgeIndex: game.judgeIndex,
      cardNumber: game.cardNumber
    });
    if (game.history.length > 20) game.history.shift();

    game.cardsAwarded += 1;
    if (game.mode === 'classic') player.score += 1;

    vibrate(30);
    flashPlayer(playerId);

    if (game.mode === 'classic' && player.score >= game.target) {
      game.phase = 'won';
      game.winnerId = player.id;
      saveGame();
      setTimeout(() => renderVictory(player, true), 450);
      return;
    }

    advanceJudge();
    newCard();
    saveGame();

    const msg = game.mode === 'classic'
      ? `${player.name} got a Letter! (${player.score}/${game.target})`
      : `Nice one, ${player.name}!`;
    setTimeout(() => { renderGame(true); startTimer(); toast(msg, true); }, 220);
  }

  function undo() {
    if (!game || !game.history.length || game.phase !== 'game') return;
    const last = game.history.pop();
    const player = game.players.find((p) => p.id === last.playerId);
    if (player && game.mode === 'classic') player.score = Math.max(0, player.score - 1);
    game.cardsAwarded = Math.max(0, game.cardsAwarded - 1);
    // Put the current (unplayed) card's letter and topics back in the bags.
    if (game.card) {
      game.letterBag.push(game.card.letter);
      game.topicBag.push(...game.card.topics);
      const recent = game.recentLetters || [];
      if (recent[recent.length - 1] === game.card.letter) recent.pop();
    }
    game.card = last.card;
    game.judgeIndex = last.judgeIndex;
    game.cardNumber = last.cardNumber;
    saveGame();
    hideToast();
    renderGame(true);
    startTimer();
    toast('Undone. Same card, try again!');
  }

  // "Skip card" with players, "Next card" when playing without names.
  function nextCard() {
    if (!game || game.phase !== 'game') return;
    stopTimer();
    newCard();
    saveGame();
    renderGame(true);
    startTimer();
  }

  function chooseTopic(index) {
    if (!game || !game.card) return;
    game.card.chosen = game.card.chosen === index ? null : index;
    saveGame();
    renderCard(false);
  }

  function setJudge(playerId) {
    const idx = game.players.findIndex((p) => p.id === playerId);
    if (idx < 0) return;
    game.judgeIndex = idx;
    saveGame();
    renderGame(false);
    toast(`${game.players[idx].name} is now the Judge`);
  }

  // ── Rendering: game ────────────────────────────────────
  function renderGame(dealAnimation) {
    if (!game) return;
    const free = freePlay();
    const badge = $('#judge-badge');
    badge.classList.toggle('static', free);
    $('.judge-icon', badge).textContent = free ? '🎉' : '⚖️';
    $('.judge-label', badge).textContent = free ? 'Casual play' : 'Judge';
    $('#judge-name').classList.toggle('hidden', free);
    if (!free) $('#judge-name').textContent = currentJudge().name;
    $('#btn-scores').classList.toggle('hidden', game.mode !== 'classic');
    $('#award-heading').textContent = game.mode === 'classic' ? 'Who got it?' : 'Who shouted it first?';
    $('#award-area').classList.toggle('hidden', free);
    $('#next-area').classList.toggle('hidden', !free);
    renderCard(dealAnimation);
    if (!free) renderPlayers();
  }

  function renderCard(dealAnimation) {
    const card = $('#game-card');
    const c = game.card;
    CARD_COLORS.forEach((col) => card.classList.remove('c-' + col));
    card.classList.add('c-' + c.color);
    card.classList.remove('times-up');
    if (dealAnimation) {
      card.classList.remove('deal');
      void card.offsetWidth; // restart the animation
      card.classList.add('deal');
    }

    $('#card-count').textContent = `Card ${game.cardNumber}`;
    $('#card-letter').textContent = c.letter;
    $('#card-topics').innerHTML = c.topics.map((t, i) => {
      const chosen = c.chosen === i;
      const dimmed = c.chosen !== null && !chosen;
      return `
        <button type="button" class="topic ${chosen ? 'chosen' : ''} ${dimmed ? 'dimmed' : ''}" data-action="choose-topic" data-index="${i}" aria-pressed="${chosen}">
          <span class="topic-or">${i === 0 ? 'A' : 'B'}</span>
          <span>${escapeHtml(TOPICS[t] || '…')}</span>
        </button>`;
    }).join('');
  }

  function renderPlayers() {
    const judge = currentJudge();
    const topScore = Math.max(0, ...game.players.map((p) => p.score));
    $('#player-grid').innerHTML = game.players.map((p) => {
      const isJudge = !!judge && p.id === judge.id;
      const isLeader = game.mode === 'classic' && topScore > 0 && p.score === topScore && !isJudge;
      const pct = clamp(Math.round((p.score / game.target) * 100), 0, 100);
      return `
        <button type="button" class="player-btn ${isJudge ? 'is-judge' : ''} ${isLeader ? 'leader' : ''}"
                data-action="award" data-id="${p.id}" ${isJudge ? 'aria-disabled="true"' : ''}>
          <span class="name">${escapeHtml(p.name)}</span>
          ${isJudge
            ? '<span class="score">⚖️ Judge</span>'
            : game.mode === 'classic'
              ? `<span class="score">${p.score} / ${game.target}</span><span class="bar"><i style="width:${pct}%"></i></span>`
              : ''}
        </button>`;
    }).join('');
  }

  function flashPlayer(playerId) {
    const btn = $(`.player-btn[data-id="${playerId}"]`);
    if (btn) { btn.classList.remove('just-won'); void btn.offsetWidth; btn.classList.add('just-won'); }
  }

  // ── Rendering: victory / summary ───────────────────────
  function renderVictory(winner, reachedTarget) {
    stopTimer();
    hideToast();
    const sorted = game.players.slice().sort((a, b) => b.score - a.score);
    $('#victory-name').textContent = winner ? winner.name : '—';
    $('#victory-sub').textContent = reachedTarget
      ? `collected ${game.target} Letters!`
      : `was leading with ${winner ? winner.score : 0} Letter${winner && winner.score === 1 ? '' : 's'}`;
    $('.victory-kicker', $('#screen-victory')).textContent = reachedTarget ? 'We have a winner!' : 'Game over';
    $('#standings').innerHTML = sorted.map((p, i) => `
      <li>
        <span class="rank ${'tile-' + CARD_COLORS[i % CARD_COLORS.length]}">${i + 1}</span>
        <span class="who">${escapeHtml(p.name)}</span>
        <span class="pts">${p.score} ${p.score === 1 ? 'Letter' : 'Letters'}</span>
      </li>`).join('');
    show('victory');
    if (reachedTarget) { vibrate([40, 60, 40, 60, 80]); confetti(); }
  }

  function renderSummary() {
    hideToast();
    const n = freePlay() ? game.cardNumber : game.cardsAwarded;
    $('#summary-sub').textContent = n === 1 ? 'You played 1 card' : `You played ${n} cards`;
    $('#summary-title').textContent = n >= 30 ? 'Marathon round!' : n >= 15 ? 'Great round!' : 'Nice round';
    $('#summary-players').textContent = freePlay() ? 'Add Players' : 'Change Players';
    show('summary');
    confetti(80);
  }

  // ── Timer ──────────────────────────────────────────────
  function startTimer() {
    stopTimer();
    const el = $('#timer');
    if (!game || !game.timer) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden', 'urgent', 'done');
    const total = game.timer;
    let remaining = total;
    const ring = $('#timer-ring');
    const text = $('#timer-text');
    ring.style.transition = 'none';
    ring.style.strokeDashoffset = '0';
    text.textContent = remaining;
    // Kick the transition on the next frame so the ring drains smoothly.
    requestAnimationFrame(() => {
      ring.style.transition = '';
      ring.style.strokeDashoffset = String(RING_LENGTH / total);
    });
    timerHandle = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        text.textContent = 'Time!';
        el.classList.add('done', 'urgent');
        ring.style.strokeDashoffset = String(RING_LENGTH);
        $('#game-card').classList.add('times-up');
        vibrate([80, 40, 80]);
        stopTimer(false);
        return;
      }
      text.textContent = remaining;
      ring.style.strokeDashoffset = String(RING_LENGTH * (1 - (remaining - 1) / total));
      el.classList.toggle('urgent', remaining <= 5);
    }, 1000);
  }

  function stopTimer(hide) {
    if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
    if (hide !== false) { const el = $('#timer'); if (el && (!game || !game.timer)) el.classList.add('hidden'); }
  }

  // ── Bottom sheet ───────────────────────────────────────
  function openSheet(title, bodyHtml) {
    $('#sheet-title').textContent = title;
    $('#sheet-body').innerHTML = bodyHtml;
    $('#sheet').classList.remove('hidden');
  }
  function closeSheet() { $('#sheet').classList.add('hidden'); }

  function openMenu() {
    const free = freePlay();
    openSheet('Menu', `
      <div class="menu-list">
        ${free ? '' : '<button class="menu-item" data-action="open-judge-picker"><span class="emoji">⚖️</span> Change the Judge</button>'}
        ${game.mode === 'classic' ? '<button class="menu-item" data-action="open-scores"><span class="emoji">🏆</span> Scoreboard</button>' : ''}
        ${free ? '' : `<button class="menu-item" data-action="toggle-rotate-live"><span class="emoji">🔁</span> Pass the phone: <strong>${game.rotateJudge ? 'On' : 'Off'}</strong></button>`}
        <button class="menu-item" data-action="open-howto-sheet"><span class="emoji">📖</span> How to play</button>
        <button class="menu-item danger" data-action="confirm-end"><span class="emoji">🏁</span> End game</button>
      </div>`);
  }

  function openJudgePicker() {
    if (freePlay()) return;
    openSheet('Who is the Judge?', `
      <div class="menu-list">
        ${game.players.map((p, i) => `
          <button class="menu-item ${i === game.judgeIndex ? 'active' : ''}" data-action="set-judge" data-id="${p.id}">
            <span class="emoji">${i === game.judgeIndex ? '⚖️' : '🙋'}</span> ${escapeHtml(p.name)}
          </button>`).join('')}
      </div>`);
  }

  function openScores() {
    const judge = currentJudge();
    const sorted = game.players.slice().sort((a, b) => b.score - a.score);
    openSheet('Scoreboard', `
      <ol class="standings">
        ${sorted.map((p, i) => `
          <li>
            <span class="rank ${'tile-' + CARD_COLORS[i % CARD_COLORS.length]}">${i + 1}</span>
            <span class="who">${escapeHtml(p.name)}${judge && p.id === judge.id ? ' ⚖️' : ''}</span>
            <span class="pts">${p.score} / ${game.target}</span>
          </li>`).join('')}
      </ol>
      <p class="hint">First to ${game.target} Letters wins. ${game.cardsAwarded} card${game.cardsAwarded === 1 ? '' : 's'} awarded so far.</p>`);
  }

  function confirmEnd() {
    openSheet('End this game?', `
      <p class="hint">${game.mode === 'classic' ? `Nobody has reached ${game.target} yet. You can see the standings and start a rematch.` : 'You can start a new round any time.'}</p>
      <button class="btn btn-danger" data-action="end-game">End game</button>
      <button class="btn btn-ghost" data-action="close-sheet">Keep playing</button>`);
  }

  function openHowtoSheet() {
    const free = freePlay();
    const last = game.mode === 'classic'
      ? `Stuck? Skip the card. First to ${game.target} Letters wins!`
      : free ? 'No scores in Casual: just tap <b>Next card</b> and keep it moving.' : 'No scores in Casual. Stuck? Skip the card and keep it moving.';
    openSheet('How to play', `
      <ol class="howto">
        <li><span class="howto-num tile-mint">1</span><div>${free ? 'Whoever is holding the phone' : 'The Judge'} reads the letter and <b>one</b> of the two topics out loud.</div></li>
        <li><span class="howto-num tile-peach">2</span><div>Everyone else shouts a word that fits the topic and starts with that letter.</div></li>
        <li><span class="howto-num tile-lavender">3</span><div>${free ? 'First correct answer wins the card. Bragging rights only!' : 'The Judge taps the first player with a correct answer to award the Letter.'}</div></li>
        <li><span class="howto-num tile-sky">4</span><div>${last}</div></li>
      </ol>`);
  }

  // ── Toast ──────────────────────────────────────────────
  function toast(text, withUndo) {
    const el = $('#toast');
    $('#toast-text').textContent = text;
    $('#toast-action').classList.toggle('hidden', !withUndo);
    el.classList.remove('hidden');
    if (toastHandle) clearTimeout(toastHandle);
    toastHandle = setTimeout(hideToast, withUndo ? 4500 : 2200);
  }
  function hideToast() { $('#toast').classList.add('hidden'); if (toastHandle) { clearTimeout(toastHandle); toastHandle = null; } }

  // ── Confetti ───────────────────────────────────────────
  function stopConfetti() {
    if (confettiRaf) { cancelAnimationFrame(confettiRaf); confettiRaf = null; }
    const canvas = $('#confetti');
    const ctx = canvas.getContext('2d');
    if (ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); }
    canvas.classList.remove('on');
  }

  function confetti(count) {
    stopConfetti();
    const canvas = $('#confetti');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.scale(dpr, dpr);
    canvas.classList.add('on');
    const colors = ['#BFEFDC', '#FFD3B6', '#DCCFFF', '#BFE3FF', '#FFF1A8', '#FFC9DD', '#7FD4B4', '#FF9DC0'];
    const W = window.innerWidth, H = window.innerHeight;
    const pieces = Array.from({ length: count || 160 }, () => ({
      x: Math.random() * W, y: -20 - Math.random() * H * 0.5,
      w: 6 + Math.random() * 8, h: 8 + Math.random() * 10,
      vx: (Math.random() - 0.5) * 2.2, vy: 2 + Math.random() * 3.5,
      rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.25,
      color: colors[Math.floor(Math.random() * colors.length)]
    }));
    const start = performance.now();
    function frame(now) {
      const t = now - start;
      ctx.clearRect(0, 0, W, H);
      let alive = false;
      pieces.forEach((p) => {
        p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.vy += 0.03;
        if (p.y < H + 30) alive = true;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      if (alive && t < 6000) confettiRaf = requestAnimationFrame(frame);
      else stopConfetti();
    }
    confettiRaf = requestAnimationFrame(frame);
  }

  // ── Events ─────────────────────────────────────────────
  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    // Clicking the sheet backdrop (not its contents) closes the sheet.
    if (target.id === 'sheet' && e.target !== target) return;

    const action = target.dataset.action;
    switch (action) {
      case 'go-home': renderHome(); break;
      case 'go-howto': show('howto'); break;
      case 'go-setup': renderSetup(); show('setup'); setTimeout(() => $('#input-player').focus({ preventScroll: true }), 50); break;
      case 'resume': resumeGame(); break;
      case 'quick-play': quickPlay(); break;
      case 'remove-player': removePlayer(target.dataset.id); break;
      case 'set-mode': prefs.mode = target.dataset.value; renderSetup(); break;
      case 'set-target': prefs.target = normalizeTarget(target.dataset.value); renderSetup(); break;
      case 'set-timer': prefs.timer = Number(target.dataset.value); renderSetup(); break;
      case 'start-game': startGame(); break;

      case 'choose-topic': chooseTopic(Number(target.dataset.index)); break;
      case 'award': award(target.dataset.id); break;
      case 'skip-card': hideToast(); nextCard(); break;
      case 'undo': undo(); break;

      case 'open-menu': openMenu(); break;
      case 'open-judge-picker': openJudgePicker(); break;
      case 'open-scores': openScores(); break;
      case 'open-howto-sheet': openHowtoSheet(); break;
      case 'set-judge': closeSheet(); setJudge(target.dataset.id); break;
      case 'toggle-rotate-live': game.rotateJudge = !game.rotateJudge; saveGame(); openMenu(); toast(game.rotateJudge ? 'The Judge will rotate after every card' : 'The Judge stays put'); break;
      case 'confirm-end': confirmEnd(); break;
      case 'end-game': closeSheet(); endGame(); break;
      case 'close-sheet': closeSheet(); break;

      case 'rematch': rematch(); break;
      default: break;
    }
  });

  $('#form-add-player').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#input-player');
    if (addPlayer(input.value)) input.value = '';
    input.focus({ preventScroll: true });
  });

  $('#select-judge').addEventListener('change', (e) => { prefs.judgeId = e.target.value; savePrefs(); });
  $('#toggle-rotate').addEventListener('change', (e) => { prefs.rotateJudge = e.target.checked; savePrefs(); });
  $('#toggle-tricky').addEventListener('change', (e) => { prefs.tricky = e.target.checked; savePrefs(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#sheet').classList.contains('hidden')) closeSheet();
  });

  // Keep the timer honest if the tab was backgrounded: just restart the round timer.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && game && game.phase === 'game' && $('#screen-game').classList.contains('active')) {
      startTimer();
    }
  });

  // ── Boot ───────────────────────────────────────────────
  if (game && game.phase === 'won' && game.winnerId) {
    const w = game.players.find((p) => p.id === game.winnerId);
    renderVictory(w, true);
  } else if (game && game.phase === 'game') {
    renderHome(); // offer Resume rather than dropping straight into a card
  } else {
    if (game && game.phase === 'ended') { /* keep for rematch */ }
    renderHome();
  }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
    });
  }

  // Expose a tiny debug handle for the console.
  window.Letters = { get state() { return game; }, get prefs() { return prefs; }, topics: TOPICS };
})();
