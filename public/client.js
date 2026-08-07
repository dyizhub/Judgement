// Judgement — browser client (vanilla JS, no modules)
(function () {
  'use strict';

  var SUIT_SYMBOL = { H: '♥', D: '♦', C: '♣', S: '♠' };
  var SUIT_RED = { H: true, D: true, C: false, S: false };
  var RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  var BOT_TIER_LABEL = { 1: 'Easy', 2: 'Medium', 3: 'Hard', 4: 'Expert' };

  function rankLabel(r) { return RANK_LABEL[r] || String(r); }

  function cardKey(c) { return c.suit + '-' + c.rank; }

  function buildBotBadge(difficulty) {
    var badge = document.createElement('span');
    badge.className = 'badge-bot badge-tier-' + difficulty;
    badge.textContent = BOT_TIER_LABEL[difficulty] || 'Bot';
    return badge;
  }

  // ---------- Responsive helpers ----------
  function isMobile() {
    return window.matchMedia('(max-width: 640px)').matches;
  }

  // Touch devices get tap-to-arm / tap-again-to-play, so a stray finger can't
  // dump a card. Mice keep single-click — hover already previews the lift.
  function isTouch() {
    return window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  }
  var armedCardKey = null; // cardKey() of the card awaiting its confirming tap

  // ---------- WebSocket ----------
  var ws = null;
  var wsReady = false;
  var reconnectTimer = null;
  var explicitClose = false;

  function wsUrl() {
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
  }

  // The host sleeps a free instance after a quiet spell and takes ~30-60s to
  // wake. Without a word on screen that just looks like a broken game, so say
  // what's happening once a connection is visibly slow.
  var connStatusTimer = null;

  function setConnStatus(msg) {
    var el2 = document.getElementById('conn-status');
    if (!el2) return;
    if (msg) { el2.textContent = msg; el2.classList.remove('hidden'); }
    else { el2.textContent = ''; el2.classList.add('hidden'); }
  }

  function connect() {
    if (!connStatusTimer) {
      connStatusTimer = setTimeout(function () {
        connStatusTimer = null;
        if (!wsReady) setConnStatus('Waking up the server… this can take up to a minute if nobody has played recently.');
      }, 3000);
    }
    ws = new WebSocket(wsUrl());
    ws.onopen = function () {
      wsReady = true;
      if (connStatusTimer) { clearTimeout(connStatusTimer); connStatusTimer = null; }
      setConnStatus(null);
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      var session = getSession();
      if (session && session.code && session.playerId) {
        send({ type: 'join', code: session.code, name: session.name || '', playerId: session.playerId });
      }
    };
    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      handleMessage(msg);
    };
    ws.onclose = function () {
      wsReady = false;
      if (explicitClose) return;
      var session = getSession();
      if (session && state) {
        showToast('Connection lost — reconnecting…');
      }
      reconnectTimer = setTimeout(connect, 2000);
    };
    ws.onerror = function () {};
  }

  function send(obj) {
    if (ws && wsReady) {
      ws.send(JSON.stringify(obj));
    }
  }

  // ---------- Session storage ----------
  var SESSION_KEY = 'judgement_session';

  function getSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  function saveSession(playerId, code, name) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ playerId: playerId, code: code, name: name || '' }));
    } catch (e) {}
  }

  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  // ---------- State ----------
  var state = null;
  var prevState = null;
  var trickPauseTimer = null;
  var lastLastTrickKey = null;
  var scoreOverlayAutoOpened = false;

  // ---------- DOM refs ----------
  var el = {};
  function cacheEls() {
    el.screenHome = document.getElementById('screen-home');
    el.screenLobby = document.getElementById('screen-lobby');
    el.screenGame = document.getElementById('screen-game');

    el.inputName = document.getElementById('input-name');
    el.btnCreate = document.getElementById('btn-create');
    el.inputCode = document.getElementById('input-code');
    el.btnJoin = document.getElementById('btn-join');
    el.homeError = document.getElementById('home-error');

    el.lobbyCode = document.getElementById('lobby-code');
    el.lobbyPlayers = document.getElementById('lobby-players');
    el.lobbyHint = document.getElementById('lobby-hint');
    el.btnStart = document.getElementById('btn-start');
    el.lobbyError = document.getElementById('lobby-error');
    el.botControls = document.getElementById('bot-controls');
    el.botDifficulty = document.getElementById('bot-difficulty');
    el.btnAddBot = document.getElementById('btn-add-bot');

    el.roundLabel = document.getElementById('round-label');
    el.trumpLabel = document.getElementById('trump-label');
    el.btnScores = document.getElementById('btn-scores');

    el.tableArea = document.getElementById('table-area');
    el.trickArea = document.getElementById('trick-area');
    el.trickBanner = document.getElementById('trick-banner');

    el.myName = document.getElementById('my-name');
    el.myBidinfo = document.getElementById('my-bidinfo');
    el.myTurn = document.getElementById('my-turn');
    el.myHand = document.getElementById('my-hand');

    el.bidOverlay = document.getElementById('bid-overlay');
    el.bidHint = document.getElementById('bid-hint');
    el.bidButtons = document.getElementById('bid-buttons');

    el.scoreOverlay = document.getElementById('score-overlay');
    el.scoreTitle = document.getElementById('score-title');
    el.scoreTable = document.getElementById('score-table');
    el.btnNextRound = document.getElementById('btn-next-round');
    el.btnPlayAgain = document.getElementById('btn-play-again');
    el.btnCloseScores = document.getElementById('btn-close-scores');

    el.toast = document.getElementById('toast');
  }

  // ---------- Toast ----------
  var toastTimer = null;
  function showToast(message) {
    if (!el.toast) return;
    el.toast.textContent = message;
    el.toast.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.toast.classList.add('hidden');
    }, 3000);
  }

  function showError(message) {
    if (!state) {
      if (el.homeError) { el.homeError.textContent = message; }
    } else if (state.phase === 'lobby') {
      if (el.lobbyError) { el.lobbyError.textContent = message; }
    } else {
      showToast(message);
    }
  }

  // ---------- Message handling ----------
  function handleMessage(msg) {
    if (msg.type === 'error') {
      if (msg.message === 'Room not found.' && !state) {
        clearSession();
      }
      showError(msg.message);
      return;
    }
    if (msg.type === 'state') {
      onState(msg.state);
      return;
    }
  }

  // ---------- auto-move countdown ----------
  // The server sends the time remaining, not a timestamp, so a client with a
  // skewed clock still counts down correctly. We turn it into a local deadline
  // on arrival and tick from there.
  var autoMoveDeadline = null;
  var countdownTimer = null;
  var COUNTDOWN_VISIBLE_MS = 30000; // only warn during the final stretch

  function noteAutoMove(ms) {
    autoMoveDeadline = typeof ms === 'number' ? Date.now() + ms : null;
    if (!countdownTimer) countdownTimer = setInterval(paintCountdown, 500);
    paintCountdown();
  }

  // Browsers throttle timers in a backgrounded tab, so the countdown can be
  // stale the instant a player switches back. Repaint immediately on return
  // rather than leaving a wrong number on screen for up to half a second.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) paintCountdown();
  });

  function countdownText() {
    if (autoMoveDeadline === null) return null;
    var left = autoMoveDeadline - Date.now();
    if (left > COUNTDOWN_VISIBLE_MS || left < 0) return null;
    return String(Math.ceil(left / 1000)) + 's';
  }

  // Repaints just the countdown chips between state updates.
  function paintCountdown() {
    var text = countdownText();

    var mine = document.getElementById('my-countdown');
    if (mine) {
      var isMyTurn = state && state.turnIdx === state.youIdx &&
        (state.phase === 'bidding' || state.phase === 'playing');
      if (text && isMyTurn) { mine.textContent = text; mine.classList.remove('hidden'); }
      else mine.classList.add('hidden');
    }

    var seatChip = el.tableArea && el.tableArea.querySelector('.seat.active .seat-countdown');
    if (seatChip) {
      if (text) { seatChip.textContent = text; seatChip.classList.remove('hidden'); }
      else seatChip.classList.add('hidden');
    }

    var bidChip = document.getElementById('bid-countdown');
    if (bidChip) {
      var bidding = state && state.phase === 'bidding' && state.turnIdx === state.youIdx;
      if (text && bidding) { bidChip.textContent = 'Auto-bid in ' + text; bidChip.classList.remove('hidden'); }
      else bidChip.classList.add('hidden');
    }
  }

  function onState(newState) {
    var trickCompleted = false;
    var lastTrickKey = null;

    if (newState.lastTrick) {
      lastTrickKey = JSON.stringify(newState.lastTrick);
    }

    if (state && newState.trick && newState.trick.length === 0 && newState.lastTrick &&
        lastTrickKey !== lastLastTrickKey) {
      trickCompleted = true;
    }

    prevState = state;
    state = newState;
    noteAutoMove(newState.autoMoveInMs);

    if (newState.youId && newState.code) {
      saveSession(newState.youId, newState.code, (el.inputName && el.inputName.value) || '');
    }

    if (trickCompleted) {
      lastLastTrickKey = lastTrickKey;
      if (trickPauseTimer) { clearTimeout(trickPauseTimer); trickPauseTimer = null; }
      renderCompletedTrick(state);
      trickPauseTimer = setTimeout(function () {
        trickPauseTimer = null;
        render();
      }, 1500);
      // Still render the rest of the screen (bars, hand, etc.) minus trick area handled above
      renderShell();
    } else {
      lastLastTrickKey = lastTrickKey;
      if (trickPauseTimer) {
        // Trick pause in progress — keep the completed trick on the table.
        // The pending timeout will render this (latest) state when it fires.
        renderShell();
      } else {
        render();
      }
    }
  }

  // ---------- Screen routing ----------
  function routeScreen() {
    var phase = state ? state.phase : null;
    el.screenHome.classList.add('hidden');
    el.screenLobby.classList.add('hidden');
    el.screenGame.classList.add('hidden');

    if (!phase) {
      el.screenHome.classList.remove('hidden');
    } else if (phase === 'lobby') {
      el.screenLobby.classList.remove('hidden');
    } else {
      el.screenGame.classList.remove('hidden');
    }
  }

  // ---------- Render ----------
  function render() {
    routeScreen();
    if (!state) return;
    if (state.phase === 'lobby') {
      renderLobby();
      return;
    }
    renderGame();
  }

  // Render everything except leave the trick banner display alone (used during pause)
  function renderShell() {
    routeScreen();
    if (!state) return;
    if (state.phase === 'lobby') {
      renderLobby();
      return;
    }
    renderTopBar();
    renderSeats();
    renderMyArea();
    renderBidOverlay();
    renderScoreOverlay();
  }

  function renderLobby() {
    el.lobbyCode.textContent = state.code;
    el.lobbyPlayers.innerHTML = '';
    var isHost = state.youId === state.hostId;

    state.players.forEach(function (p) {
      var div = document.createElement('div');
      div.className = 'lobby-player';
      var text = document.createTextNode(p.name);
      div.appendChild(text);

      var right = document.createElement('span');
      right.className = 'lobby-player-right';

      if (p.id === state.hostId) {
        var badge = document.createElement('span');
        badge.className = 'badge-host';
        badge.textContent = 'Host';
        right.appendChild(badge);
      }
      if (p.isBot) {
        right.appendChild(buildBotBadge(p.difficulty));
        if (isHost) {
          var removeBtn = document.createElement('button');
          removeBtn.className = 'btn-remove-bot';
          removeBtn.textContent = '×';
          removeBtn.addEventListener('click', function () {
            send({ type: 'removeBot', playerId: p.id });
          });
          right.appendChild(removeBtn);
        }
      }
      div.appendChild(right);

      if (!p.connected) {
        div.classList.add('disconnected');
      }
      el.lobbyPlayers.appendChild(div);
    });

    var count = state.players.length;

    if (el.botControls) {
      if (isHost && state.phase === 'lobby') {
        el.botControls.classList.remove('hidden');
        el.btnAddBot.disabled = count >= 5;
      } else {
        el.botControls.classList.add('hidden');
      }
    }

    if (!isHost) {
      el.btnStart.classList.add('hidden');
      el.lobbyHint.textContent = 'Waiting for host to start…';
    } else {
      el.btnStart.classList.remove('hidden');
      if (count < 3) {
        el.btnStart.disabled = true;
        el.lobbyHint.textContent = 'Need at least 3 players to start (' + count + '/5).';
      } else if (count > 5) {
        el.btnStart.disabled = true;
        el.lobbyHint.textContent = 'Too many players (max 5).';
      } else {
        el.btnStart.disabled = false;
        el.lobbyHint.textContent = count + ' players ready (max 5).';
      }
    }
  }

  function renderGame() {
    renderTopBar();
    renderSeats();
    renderTrick();
    renderMyArea();
    renderBidOverlay();
    renderScoreOverlay();
  }

  function renderTopBar() {
    el.roundLabel.textContent = 'Round ' + state.round + ' of ' + state.totalRounds +
      ' · ' + state.round + ' card' + (state.round === 1 ? '' : 's');

    el.trumpLabel.classList.remove('suit-red', 'suit-black', 'no-trump');
    if (state.trump) {
      el.trumpLabel.textContent = 'Trump: ' + SUIT_SYMBOL[state.trump];
      el.trumpLabel.classList.add(SUIT_RED[state.trump] ? 'suit-red' : 'suit-black');
    } else {
      el.trumpLabel.textContent = 'No Trump';
      el.trumpLabel.classList.add('no-trump');
    }
  }

  function renderSeats() {
    // Remove only seat nodes — #trick-area and #trick-banner live inside #table-area
    el.tableArea.querySelectorAll('.seat').forEach(function (s) { s.remove(); });
    var n = state.players.length;
    var youIdx = state.youIdx;
    var opponents = [];
    for (var k = 1; k < n; k++) {
      opponents.push((youIdx + k) % n);
    }
    var m = opponents.length;
    var mobile = isMobile();

    if (mobile) {
      el.tableArea.classList.add('mobile');
    } else {
      el.tableArea.classList.remove('mobile');
    }

    opponents.forEach(function (idx, i) {
      var turnOrder = turnOrderOf(idx, n, state.dealerIdx);
      var p = state.players[idx];

      var seat = document.createElement('div');
      seat.className = 'seat';

      if (!mobile) {
        var t = m > 1 ? i / (m - 1) : 0.5; // 0..1 across arc
        var angleDeg = 200 - t * 220; // 200deg -> -20deg
        var angleRad = angleDeg * Math.PI / 180;
        var cx = 50, cy = 55, rx = 42, ry = 48;
        var left = cx + rx * Math.cos(angleRad);
        var top = cy - ry * Math.sin(angleRad);
        // At exactly 4 players the middle opponent lands at the ellipse's peak
        // (top ~7%), too close to #table-area's edge — its turn-order chip
        // (offset above the seat) gets clipped by overflow:hidden. Floor it.
        top = Math.max(top, 15);

        seat.style.left = left + '%';
        seat.style.top = top + '%';
        seat.style.transform = 'translate(-50%,-50%)';
      }

      if (state.turnIdx === idx) seat.classList.add('active');
      if (!p.connected) seat.classList.add('disconnected');

      var nameDiv = document.createElement('div');
      nameDiv.className = 'seat-name';
      nameDiv.textContent = p.name;
      if (p.isBot) {
        nameDiv.appendChild(buildBotBadge(p.difficulty));
      }
      if (state.dealerIdx === idx) {
        var chip = document.createElement('span');
        chip.className = 'dealer-chip';
        chip.textContent = 'D';
        nameDiv.appendChild(chip);
      }

      var orderChip = document.createElement('span');
      orderChip.className = 'turn-order-chip';
      orderChip.textContent = String(turnOrder);
      orderChip.title = 'Turn order: ' + turnOrder + ' of ' + n;
      seat.appendChild(orderChip);

      var divider = document.createElement('div');
      divider.className = 'seat-divider';

      var bidDiv = document.createElement('div');
      bidDiv.className = 'seat-bidinfo';
      var bid = state.bids[idx];
      var won = state.tricksWon[idx];
      fillBidInfo(bidDiv, bid, won);

      var countDiv = document.createElement('div');
      countDiv.className = 'seat-cardcount';
      countDiv.textContent = state.handCounts[idx] + ' card' + (state.handCounts[idx] === 1 ? '' : 's');

      seat.appendChild(nameDiv);
      seat.appendChild(divider);
      seat.appendChild(bidDiv);
      seat.appendChild(countDiv);

      // Filled in by paintCountdown between state updates.
      var seatCountdown = document.createElement('span');
      seatCountdown.className = 'seat-countdown hidden';
      seat.appendChild(seatCountdown);

      seat.dataset.idx = String(idx);
      seat.addEventListener('click', function () {
        toggleDevPeek(idx, seat);
      });

      el.tableArea.appendChild(seat);
    });

    refreshDevPeek();
  }

  // ---------- Dev-mode hand peek ----------
  // Server only includes state.opponentHands for players it has granted dev
  // access to — a non-dev client's state simply has no such field, so this
  // silently no-ops for everyone else. No visible affordance either way.
  var devPeekIdx = null;
  var devPeekEl = null;

  function closeDevPeek() {
    if (devPeekEl) { devPeekEl.remove(); devPeekEl = null; }
    devPeekIdx = null;
  }

  function toggleDevPeek(idx, seatEl) {
    if (!state.opponentHands) return;
    if (devPeekIdx === idx) { closeDevPeek(); return; }
    devPeekIdx = idx;
    renderDevPeek(seatEl);
  }

  // Re-render the open peek panel's content/position after every re-render
  // of the seats (new cards played, etc.) — or close it if it's no longer valid.
  function refreshDevPeek() {
    if (devPeekIdx === null) return;
    if (!state.opponentHands) { closeDevPeek(); return; }
    var seatEl = el.tableArea.querySelector('.seat[data-idx="' + devPeekIdx + '"]');
    if (!seatEl) { closeDevPeek(); return; }
    renderDevPeek(seatEl);
  }

  function renderDevPeek(seatEl) {
    if (devPeekEl) { devPeekEl.remove(); devPeekEl = null; }
    var hand = state.opponentHands[devPeekIdx];
    if (!hand) return;

    var panel = document.createElement('div');
    panel.className = 'dev-peek';
    hand.forEach(function (card) {
      panel.appendChild(buildCardEl(card));
    });
    document.body.appendChild(panel);

    var r = seatEl.getBoundingClientRect();
    var panelRect = panel.getBoundingClientRect();
    var left = r.left + r.width / 2 - panelRect.width / 2;
    left = Math.max(6, Math.min(left, window.innerWidth - panelRect.width - 6));

    var fitsBelow = r.bottom + 8 + panelRect.height <= window.innerHeight;
    var top = fitsBelow ? r.bottom + 8 : r.top - panelRect.height - 8;
    top = Math.max(6, top);

    panel.style.left = left + 'px';
    panel.style.top = top + 'px';

    devPeekEl = panel;
  }

  document.addEventListener('click', function (e) {
    if (devPeekIdx === null) return;
    if (devPeekEl && devPeekEl.contains(e.target)) return;
    if (e.target.closest && e.target.closest('.seat[data-idx="' + devPeekIdx + '"]')) return;
    closeDevPeek();
  });

  // 1-indexed turn order for this round: dealer's left (idx = (dealerIdx+1)%n) is seat 1.
  function turnOrderOf(idx, n, dealerIdx) {
    return ((idx - (dealerIdx + 1) + n) % n) + 1;
  }

  function fillBidInfo(container, bid, won) {
    container.innerHTML = '';
    if (bid === null || bid === undefined) {
      var pending = document.createElement('span');
      pending.className = 'bid-pending';
      pending.textContent = 'No bid yet';
      container.appendChild(pending);
      return;
    }
    function stat(label, value) {
      var s = document.createElement('span');
      s.className = 'stat';
      var l = document.createElement('span');
      l.className = 'stat-label';
      l.textContent = label;
      var v = document.createElement('span');
      v.className = 'stat-value';
      v.textContent = String(value);
      s.appendChild(l);
      s.appendChild(v);
      return s;
    }
    container.appendChild(stat('Bid', bid));
    var wonStat = stat('Won', won);
    if (won === bid) wonStat.classList.add('stat-met');
    else if (won > bid) wonStat.classList.add('stat-over');
    container.appendChild(wonStat);
  }

  function buildCardEl(card) {
    var div = document.createElement('div');
    div.className = 'card ' + (SUIT_RED[card.suit] ? 'red' : 'black');
    if (state && state.trump && card.suit === state.trump) div.classList.add('trump');
    var rankSpan = document.createElement('span');
    rankSpan.className = 'card-rank';
    rankSpan.textContent = rankLabel(card.rank);
    var suitSpan = document.createElement('span');
    suitSpan.className = 'card-suit';
    suitSpan.textContent = SUIT_SYMBOL[card.suit];
    div.appendChild(rankSpan);
    div.appendChild(suitSpan);
    return div;
  }

  function renderTrick() {
    el.trickArea.innerHTML = '';
    el.trickBanner.classList.add('hidden');
    el.trickBanner.textContent = '';
    (state.trick || []).forEach(function (entry) {
      var wrap = document.createElement('div');
      wrap.className = 'trick-card';
      wrap.appendChild(buildCardEl(entry.card));
      var label = document.createElement('div');
      label.className = 'trick-card-label';
      label.textContent = state.players[entry.playerIdx].name;
      wrap.appendChild(label);
      el.trickArea.appendChild(wrap);
    });
  }

  function renderCompletedTrick(s) {
    routeScreen();
    renderTopBar();
    renderSeats();
    el.trickArea.innerHTML = '';
    var lt = s.lastTrick;
    if (lt && lt.trick) {
      lt.trick.forEach(function (entry) {
        var wrap = document.createElement('div');
        wrap.className = 'trick-card';
        wrap.appendChild(buildCardEl(entry.card));
        var label = document.createElement('div');
        label.className = 'trick-card-label';
        label.textContent = s.players[entry.playerIdx].name;
        if (entry.playerIdx === lt.winnerIdx) wrap.classList.add('winning-card');
        wrap.appendChild(label);
        el.trickArea.appendChild(wrap);
      });
      el.trickBanner.textContent = s.players[lt.winnerIdx].name + ' wins the trick';
      el.trickBanner.classList.remove('hidden');
    }
    renderMyArea();
    renderBidOverlay();
    renderScoreOverlay();
  }

  function renderMyArea() {
    var youIdx = state.youIdx;
    var n = state.players.length;
    el.myName.textContent = state.players[youIdx].name +
      ' (Turn ' + turnOrderOf(youIdx, n, state.dealerIdx) + ' of ' + n + ')';

    var bid = state.bids[youIdx];
    var won = state.tricksWon[youIdx];
    fillBidInfo(el.myBidinfo, bid, won);

    var isMyTurn = state.turnIdx === youIdx;
    // Disarm as soon as it stops being your turn to play, before anything reads it.
    if (!(state.phase === 'playing' && isMyTurn)) armedCardKey = null;

    if (isMyTurn && (state.phase === 'bidding' || state.phase === 'playing')) {
      el.myTurn.classList.remove('hidden');
      // Tell the player about the confirming tap only once a card is armed.
      el.myTurn.textContent = armedCardKey && state.phase === 'playing'
        ? 'Tap again to play' : 'Your turn';
    } else {
      el.myTurn.classList.add('hidden');
      el.myTurn.textContent = 'Your turn';
    }

    el.myHand.innerHTML = '';
    var canPlay = state.phase === 'playing' && isMyTurn;
    var ledSuit = null;
    var mustFollow = false;
    if (canPlay && state.trick && state.trick.length > 0) {
      ledSuit = state.trick[0].card.suit;
      mustFollow = state.hand.some(function (c) { return c.suit === ledSuit; });
    }

    (state.hand || []).forEach(function (card) {
      var cardEl = buildCardEl(card);
      if (canPlay) {
        var legal = !ledSuit || !mustFollow || card.suit === ledSuit;
        cardEl.classList.add(legal ? 'playable' : 'unplayable');
        if (legal) {
          var key = cardKey(card);
          if (armedCardKey === key) cardEl.classList.add('armed');
          cardEl.addEventListener('click', function () {
            var play = function () {
              armedCardKey = null;
              send({ type: 'play', card: { suit: card.suit, rank: card.rank } });
            };
            if (!isTouch()) return play();
            // First tap arms the card, second commits it. Tapping a different
            // card just moves the arm.
            if (armedCardKey === key) return play();
            armedCardKey = key;
            renderMyArea();
          });
        }
      }
      el.myHand.appendChild(cardEl);
    });

    fitHand();
  }

  // Dynamically compresses the overlap between hand cards so a full hand
  // never overflows the available width, especially on narrow screens.
  function fitHand() {
    if (!el.myHand) return;
    var cards = el.myHand.querySelectorAll('.card');
    var n = cards.length;
    if (n < 2) {
      el.myHand.style.setProperty('--hand-overlap', '0px');
      return;
    }
    var containerWidth = el.myHand.clientWidth;
    if (!containerWidth) return; // hidden screen — skip without error

    var cardW = cards[0].getBoundingClientRect().width;
    var available = containerWidth - cardW;
    // Prefer fully-separated cards with a small gap; only overlap when the hand
    // genuinely can't fit, and never tighter than a readable sliver.
    var preferredStep = cardW + 8;
    var step = Math.min(preferredStep, available / (n - 1));
    step = Math.max(22, step);

    el.myHand.style.setProperty('--hand-overlap', (step - cardW) + 'px');
  }

  function renderBidOverlay() {
    var show = state.phase === 'bidding' && state.turnIdx === state.youIdx;
    if (!show) {
      el.bidOverlay.classList.add('hidden');
      // Clear the countdown and pass-back offer too, so a reopened overlay
      // never flashes the previous turn's content before its first repaint.
      var staleCountdown = document.getElementById('bid-countdown');
      if (staleCountdown) { staleCountdown.textContent = ''; staleCountdown.classList.add('hidden'); }
      var stalePassBack = document.getElementById('bid-passback');
      if (stalePassBack) { stalePassBack.innerHTML = ''; stalePassBack.classList.add('hidden'); }
      return;
    }
    el.bidOverlay.classList.remove('hidden');
    var bidTrump = document.getElementById('bid-trump');
    if (bidTrump) {
      bidTrump.classList.remove('suit-red', 'suit-black', 'no-trump');
      if (state.trump) {
        bidTrump.textContent = 'Trump: ' + SUIT_SYMBOL[state.trump];
        bidTrump.classList.add(SUIT_RED[state.trump] ? 'suit-red' : 'suit-black');
      } else {
        bidTrump.textContent = 'No Trump';
        bidTrump.classList.add('no-trump');
      }
    }
    var forbidden = state.forbiddenBid;
    el.bidHint.textContent = forbidden === null || forbidden === undefined
      ? 'Round ' + state.round + ' — bid 0 to ' + state.round
      : 'Round ' + state.round + ' — bid 0 to ' + state.round + ' (total can\'t equal ' + state.round + ')';
    el.bidButtons.innerHTML = '';
    for (var b = 0; b <= state.round; b++) {
      (function (bidVal) {
        var btn = document.createElement('button');
        btn.className = 'bid-btn';
        btn.textContent = String(bidVal);
        if (forbidden !== null && forbidden !== undefined && bidVal === forbidden) {
          btn.disabled = true;
          btn.classList.add('bid-btn-forbidden');
          btn.title = "Total bids can't add up to " + state.round;
        } else {
          btn.addEventListener('click', function () {
            send({ type: 'bid', bid: bidVal });
            el.bidOverlay.classList.add('hidden');
          });
        }
        el.bidButtons.appendChild(btn);
      })(b);
    }

    renderPassBack();
  }

  // Offer to hand the turn back to the player who bid just before you, so they
  // can change a bid they regret.
  function renderPassBack() {
    var host = document.getElementById('bid-passback');
    if (!host) return;
    host.innerHTML = '';
    var pb = state.passBack;
    if (!pb) { host.classList.add('hidden'); return; }
    host.classList.remove('hidden');

    if (!pb.available) {
      var note = document.createElement('div');
      note.className = 'passback-note';
      note.textContent = pb.reason === 'already-used'
        ? 'You have already sent the bid back this round.'
        : pb.toName + ' is disconnected.';
      host.appendChild(note);
      return;
    }

    var btn = document.createElement('button');
    btn.className = 'btn btn-secondary passback-btn';
    btn.textContent = '↩ Let ' + pb.toName + ' re-bid';
    btn.title = 'Send the turn back to ' + pb.toName + ' so they can change their bid';
    btn.addEventListener('click', function () {
      send({ type: 'passBack' });
    });
    host.appendChild(btn);
  }

  function renderScoreOverlay() {
    var isHost = state.youId === state.hostId;

    if (state.phase === 'roundEnd' || state.phase === 'gameEnd') {
      if (!scoreOverlayAutoOpened && !trickPauseTimer) {
        openScoreOverlay();
        scoreOverlayAutoOpened = true;
      }
    } else {
      // Leaving roundEnd/gameEnd (host advanced past the scoreboard) — close
      // the overlay automatically instead of leaving it for the player to dismiss.
      var wasScoreboardPhase = prevState && (prevState.phase === 'roundEnd' || prevState.phase === 'gameEnd');
      if (scoreOverlayAutoOpened && wasScoreboardPhase) {
        el.scoreOverlay.classList.add('hidden');
      }
      scoreOverlayAutoOpened = false;
    }

    buildScoreTable();

    if (state.phase === 'gameEnd') {
      var maxScore = Math.max.apply(null, state.scores);
      var winners = [];
      state.players.forEach(function (p, i) {
        if (state.scores[i] === maxScore) winners.push(p.name);
      });
      el.scoreTitle.textContent = 'Final Scores — ' + winners.join(' & ') + ' wins!';
    } else {
      el.scoreTitle.textContent = 'Scores';
    }

    if (state.phase === 'roundEnd' && isHost) {
      el.btnNextRound.classList.remove('hidden');
    } else {
      el.btnNextRound.classList.add('hidden');
    }

    if (state.phase === 'gameEnd' && isHost) {
      el.btnPlayAgain.classList.remove('hidden');
    } else {
      el.btnPlayAgain.classList.add('hidden');
    }
  }

  function openScoreOverlay() {
    el.scoreOverlay.classList.remove('hidden');
  }

  function buildScoreTable() {
    el.scoreTable.innerHTML = '';
    var n = state.players.length;

    var thead = document.createElement('thead');
    var tbody = document.createElement('tbody');
    var headRow = document.createElement('tr');
    var cornerTh = document.createElement('th');
    cornerTh.textContent = 'Round';
    headRow.appendChild(cornerTh);
    state.players.forEach(function (p) {
      var th = document.createElement('th');
      th.textContent = p.name;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    el.scoreTable.appendChild(thead);
    el.scoreTable.appendChild(tbody);

    state.scoreHistory.forEach(function (roundResult, ri) {
      var row = document.createElement('tr');
      var labelTd = document.createElement('td');
      labelTd.textContent = String(ri + 1);
      row.appendChild(labelTd);
      roundResult.forEach(function (r) {
        var td = document.createElement('td');
        var sign = r.delta >= 0 ? '+' : '';
        td.innerHTML = r.bid + '/' + r.won + ' <small>' + sign + r.delta + '</small>';
        row.appendChild(td);
      });
      tbody.appendChild(row);
    });

    var totalRow = document.createElement('tr');
    totalRow.className = 'score-total';
    var totalLabelTd = document.createElement('td');
    totalLabelTd.textContent = 'Total';
    totalRow.appendChild(totalLabelTd);
    for (var i = 0; i < n; i++) {
      var td2 = document.createElement('td');
      td2.textContent = String(state.scores[i]);
      totalRow.appendChild(td2);
    }
    tbody.appendChild(totalRow);
  }

  // ---------- Home / Lobby actions ----------
  function doCreate() {
    var name = (el.inputName.value || '').trim();
    if (!name) {
      showError('Enter your name first.');
      return;
    }
    el.homeError.textContent = '';
    send({ type: 'create', name: name });
  }

  function doJoin() {
    var name = (el.inputName.value || '').trim();
    if (!name) {
      showError('Enter your name first.');
      return;
    }
    var code = (el.inputCode.value || '').trim().toUpperCase();
    if (!code) {
      showError('Enter a room code.');
      return;
    }
    el.homeError.textContent = '';
    send({ type: 'join', code: code, name: name });
  }

  // ---------- Wire up events ----------
  function wireEvents() {
    el.btnCreate.addEventListener('click', doCreate);
    el.btnJoin.addEventListener('click', doJoin);

    el.inputName.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        el.inputCode.focus();
      }
    });
    el.inputCode.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        doJoin();
      }
    });

    el.btnStart.addEventListener('click', function () {
      send({ type: 'start' });
    });

    if (el.btnAddBot) {
      el.btnAddBot.addEventListener('click', function () {
        send({ type: 'addBot', difficulty: Number(el.botDifficulty.value) });
      });
    }

    el.btnScores.addEventListener('click', function () {
      el.scoreOverlay.classList.toggle('hidden');
    });

    el.btnCloseScores.addEventListener('click', function () {
      el.scoreOverlay.classList.add('hidden');
    });

    el.btnNextRound.addEventListener('click', function () {
      send({ type: 'nextRound' });
    });

    el.btnPlayAgain.addEventListener('click', function () {
      send({ type: 'playAgain' });
    });
  }

  // ---------- Responsive re-render on resize ----------
  var resizeTimer = null;
  function onViewportResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      resizeTimer = null;
      if (state && state.phase !== 'lobby') {
        render();
      }
    }, 150);
  }

  // ---------- Init ----------
  function init() {
    cacheEls();
    wireEvents();
    connect();

    window.addEventListener('resize', onViewportResize);
    window.addEventListener('orientationchange', onViewportResize);
    // Some browsers fire the media-query change without a usable resize event
    var mq = window.matchMedia('(max-width: 640px)');
    if (mq.addEventListener) mq.addEventListener('change', onViewportResize);
    else if (mq.addListener) mq.addListener(onViewportResize); // older Safari

    var session = getSession();
    if (session && session.name && el.inputName) {
      el.inputName.value = session.name;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
