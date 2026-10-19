/* Mastermind / UI, local persistence, pointer drag & drop, keyboard and effects. */
'use strict';

// Kept deliberately for Rami's testing. A copy is logged for every new/restored round.
let myRandomArr = [];

(function () {
  const E = window.MastermindEngine;
  const $ = id => document.getElementById(id);
  const ui = Object.fromEntries([
    'modeSelect', 'newGameBtn', 'secretCode', 'secretDescription', 'remainingCount',
    'timer', 'attemptProgress', 'resultBanner', 'resultTitle', 'resultDescription',
    'resultEyebrow', 'resultIcon', 'playAgainBtn', 'composer', 'attemptNumber',
    'clearBtn', 'guessSlots', 'digitBank', 'submitBtn', 'gameNotice', 'historyCount',
    'historyList', 'historyEmpty', 'winsStat', 'rateStat', 'bestStat', 'soundBtn',
    'themeBtn', 'helpBtn', 'helpDialog', 'restartDialog', 'confirmRestartBtn',
    'roundLabel', 'confettiCanvas'
  ].map(id => [id, $(id)]));
  const STORAGE = 'rami.mastermind.v1';
  let storageOK = true;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORAGE) || '{}') || {}; }
  catch (_) { storageOK = false; }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
  const rawStats = saved.stats || {};
  const natural = n => Number.isSafeInteger(n) && n >= 0;
  const stats = {
    wins: natural(rawStats.wins) ? rawStats.wins : 0,
    losses: natural(rawStats.losses) ? rawStats.losses : 0,
    best: {}
  };
  for (const key of Object.keys(E.MODES)) {
    if (Number.isInteger(rawStats.best?.[key]) && rawStats.best[key] >= 1 && rawStats.best[key] <= 8) stats.best[key] = rawStats.best[key];
  }
  const settings = { theme: saved.settings?.theme === 'dark' ? 'dark' : 'light', sound: saved.settings?.sound === true };
  let round = E.restoreRound(saved.round) || E.createRound('focus');
  let activeSlot = Math.max(0, round.guess.indexOf(''));
  let clockStarted = Date.now();
  let elapsedAtStart = round.elapsed;
  let pendingMode = null;
  let busy = false;
  let drag = null;
  let suppressClickUntil = 0;
  let audioContext = null;
  let confettiFrame = null;
  let previousFocus = null;
  let lastSavedSecond = 0;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    svg.setAttribute('aria-hidden', 'true');
    return svg;
  }

  function updateElapsed() {
    if (round.started && round.status === 'playing' && !document.hidden) {
      round.elapsed = elapsedAtStart + Math.max(0, Math.floor((Date.now() - clockStarted) / 1000));
    }
  }

  function persist() {
    updateElapsed();
    try { localStorage.setItem(STORAGE, JSON.stringify({ settings, stats, round })); }
    catch (_) {
      if (storageOK) notice('تعذّر حفظ التقدّم؛ يمكنك إكمال هذه الجولة بشكل طبيعي.', 'error');
      storageOK = false;
    }
  }

  function startClock() {
    if (!round.started) {
      clockStarted = Date.now();
      elapsedAtStart = round.elapsed;
      round.started = true;
    }
  }

  function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    return String(minutes).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
  }

  function notice(text, kind) {
    ui.gameNotice.textContent = text;
    ui.gameNotice.className = 'game-notice' + (kind ? ' ' + kind : '');
  }

  function logSecret() {
    myRandomArr = round.secret.slice();
    console.log(myRandomArr);
  }

  function applySettings() {
    document.documentElement.dataset.theme = settings.theme;
    document.querySelector('meta[name="theme-color"]').content = settings.theme === 'dark' ? '#101d1a' : '#f5f4ef';
    ui.themeBtn.setAttribute('aria-pressed', String(settings.theme === 'dark'));
    ui.themeBtn.setAttribute('aria-label', settings.theme === 'dark' ? 'تفعيل الوضع الفاتح' : 'تفعيل الوضع الداكن');
    ui.soundBtn.replaceChildren(icon(settings.sound ? 'sound' : 'mute'));
    ui.soundBtn.setAttribute('aria-pressed', String(settings.sound));
    ui.soundBtn.setAttribute('aria-label', settings.sound ? 'كتم الصوت' : 'تشغيل الصوت');
  }

  function tone(kind) {
    if (!settings.sound) return;
    try {
      const AudioClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioClass) return;
      audioContext ||= new AudioClass();
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
      const notes = kind === 'win' ? [523.25, 659.25, 783.99, 1046.5] : kind === 'lose' ? [261.6, 220, 174.6] : kind === 'error' ? [185] : kind === 'submit' ? [392, 523.25] : [480];
      notes.forEach((frequency, index) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const time = audioContext.currentTime + index * .12;
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(.0001, time);
        gain.gain.exponentialRampToValueAtTime(.055, time + .015);
        gain.gain.exponentialRampToValueAtTime(.0001, time + .15);
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(time);
        oscillator.stop(time + .18);
      });
    } catch (_) { /* Sound is optional; the game continues without it. */ }
  }

  function renderStats() {
    ui.winsStat.textContent = stats.wins;
    const total = stats.wins + stats.losses;
    ui.rateStat.textContent = total ? Math.round(stats.wins / total * 100) + '%' : '—';
    ui.bestStat.textContent = stats.best[round.mode] || '—';
    ui.bestStat.setAttribute('aria-label', 'أفضل عدد محاولات في مستوى ' + E.MODES[round.mode].title + ': ' + (stats.best[round.mode] || 'لا توجد نتيجة بعد'));
  }

  function renderSecret() {
    const revealed = round.status !== 'playing';
    ui.secretCode.replaceChildren();
    round.secret.forEach(digit => {
      const cell = document.createElement('span');
      cell.className = 'secret-cell';
      if (revealed) cell.textContent = digit;
      else cell.appendChild(icon('lock'));
      ui.secretCode.appendChild(cell);
    });
    ui.secretCode.classList.toggle('revealed', revealed);
    ui.secretCode.setAttribute('aria-label', revealed ? 'الرمز السري: ' + round.secret.join(' ') : 'الرمز السري مخفي، ' + round.secret.length + ' خانات');
    ui.secretDescription.textContent = revealed ? 'هذا هو الرمز. كل محاولة كانت خطوة.' : 'أرقام مختلفة. ترتيب واحد صحيح.';
  }

  function renderGuess() {
    ui.guessSlots.className = 'guess-slots length-' + round.secret.length;
    if (ui.guessSlots.children.length !== round.secret.length) {
      ui.guessSlots.replaceChildren();
      round.guess.forEach((_, index) => {
        const slot = document.createElement('button');
        slot.type = 'button';
        slot.dataset.slot = index;
        slot.dataset.position = String(index + 1).padStart(2, '0');
        slot.addEventListener('click', () => {
          if (Date.now() < suppressClickUntil || round.status !== 'playing') return;
          activeSlot = index;
          renderGuess();
        });
        ui.guessSlots.appendChild(slot);
      });
    }
    Array.from(ui.guessSlots.children).forEach((slot, index) => {
      const digit = round.guess[index];
      slot.className = 'guess-slot' + (digit ? ' filled' : '') + (activeSlot === index ? ' active' : '');
      slot.disabled = round.status !== 'playing' || busy;
      slot.setAttribute('aria-label', 'الخانة ' + (index + 1) + (digit ? '، الرقم ' + digit : '، فارغة'));
      slot.setAttribute('aria-pressed', String(activeSlot === index));
      slot.tabIndex = activeSlot === index ? 0 : -1;
      if (digit) slot.textContent = digit;
      else {
        const dash = document.createElement('span');
        dash.className = 'slot-empty';
        dash.setAttribute('aria-hidden', 'true');
        slot.replaceChildren(dash);
      }
    });
    for (const button of ui.digitBank.children) {
      const used = round.guess.includes(button.dataset.digit);
      button.classList.toggle('is-used', used);
      button.setAttribute('aria-label', 'الرقم ' + button.dataset.digit + (used ? '، مستخدم، انقر لنقله' : ''));
      button.disabled = round.status !== 'playing' || busy;
    }
    ui.submitBtn.disabled = round.status !== 'playing' || busy;
    ui.submitBtn.classList.toggle('ready', round.guess.every(Boolean));
    ui.clearBtn.disabled = round.status !== 'playing' || !round.guess.some(Boolean) || busy;
  }

  function renderHistory() {
    ui.historyList.replaceChildren();
    ui.historyEmpty.hidden = round.attempts.length > 0;
    round.attempts.forEach((attempt, index) => {
      const row = document.createElement('li');
      row.className = 'history-row';
      row.setAttribute('aria-label', 'المحاولة ' + (index + 1) + ': ' + attempt.guess.split('').join(' ') + '. ' + attempt.exact + ' صحيح بمكانه، ' + attempt.misplaced + ' صحيح بمكان آخر، ' + attempt.absent + ' غير موجود.');
      const guessCell = document.createElement('div');
      guessCell.className = 'history-guess';
      const number = document.createElement('span');
      number.className = 'history-index';
      number.textContent = String(index + 1).padStart(2, '0');
      const digits = document.createElement('span');
      digits.className = 'history-digits';
      digits.dir = 'ltr';
      attempt.guess.split('').forEach(digit => {
        const tile = document.createElement('span');
        tile.className = 'history-digit';
        tile.textContent = digit;
        digits.appendChild(tile);
      });
      guessCell.append(number, digits);
      row.appendChild(guessCell);
      ['exact', 'misplaced', 'absent'].forEach(key => {
        const cell = document.createElement('div');
        cell.className = 'score-cell';
        const score = document.createElement('span');
        score.className = 'score-number ' + key + (attempt[key] === 0 ? ' zero' : '');
        score.textContent = attempt[key];
        cell.appendChild(score);
        row.appendChild(cell);
      });
      ui.historyList.appendChild(row);
    });
  }

  function renderRound() {
    const config = E.MODES[round.mode];
    ui.modeSelect.value = round.mode;
    ui.remainingCount.textContent = config.attempts - round.attempts.length;
    ui.timer.textContent = formatTime(round.elapsed);
    ui.attemptNumber.textContent = String(Math.min(round.attempts.length + 1, config.attempts)).padStart(2, '0');
    ui.historyCount.textContent = round.attempts.length + ' / ' + config.attempts;
    ui.roundLabel.textContent = round.status === 'won' ? 'اكتمل التحدّي ✓' : round.status === 'lost' ? 'انتهت المحاولات' : round.started ? 'التحدّي مستمر' : 'جولة جديدة';
    ui.attemptProgress.replaceChildren();
    for (let i = 0; i < config.attempts; i++) {
      const bar = document.createElement('span');
      if (i < round.attempts.length) bar.className = round.status === 'won' ? 'won' : 'used';
      ui.attemptProgress.appendChild(bar);
    }
    ui.attemptProgress.setAttribute('aria-label', 'استخدمت ' + round.attempts.length + ' من ' + config.attempts + ' محاولات');
    renderSecret();
    renderGuess();
    renderHistory();
    renderStats();
    const ended = round.status !== 'playing';
    ui.resultBanner.hidden = !ended;
    ui.composer.hidden = ended;
    if (ended) {
      const won = round.status === 'won';
      ui.resultBanner.classList.toggle('lost', !won);
      ui.resultIcon.replaceChildren(icon(won ? 'trophy' : 'restart'));
      ui.resultTitle.textContent = won ? 'تفكيرك وصل للحل!' : 'انتهت الجولة… والفكرة باقية.';
      ui.resultEyebrow.textContent = won ? 'رمز محلول' : 'فرصة جديدة للتفكير';
      ui.resultDescription.textContent = won ? 'اكتشفت الرمز في ' + round.attempts.length + ' محاولات، خلال ' + formatTime(round.elapsed) + '.' : 'كشفت لك الرمز في الأعلى. جرّب تحدّيًا جديدًا واستفد من تجربتك.';
    }
  }

  function selectNextEmpty(from) {
    for (let offset = 1; offset <= round.guess.length; offset++) {
      const next = (from + offset) % round.guess.length;
      if (!round.guess[next]) { activeSlot = next; return; }
    }
  }

  function place(digit, index, advance = true) {
    if (busy || round.status !== 'playing') return;
    startClock();
    if (!E.placeDigit(round, digit, index)) return;
    activeSlot = index;
    if (advance) selectNextEmpty(index);
    renderGuess();
    ui.roundLabel.textContent = 'التحدّي مستمر';
    notice(round.guess.every(Boolean) ? 'اكتملت الخانات. تحقّق من فكرتك.' : 'يمكنك نقل الرقم المستخدم إلى خانة أخرى، أو تبديل خانتين.');
    tone('tap');
    persist();
  }

  function clearDigit(backwards) {
    if (round.status !== 'playing' || busy) return;
    if (backwards && !round.guess[activeSlot]) activeSlot = Math.max(0, activeSlot - 1);
    round.guess[activeSlot] = '';
    renderGuess();
    persist();
  }

  function shake() {
    ui.guessSlots.classList.remove('shake');
    void ui.guessSlots.offsetWidth;
    ui.guessSlots.classList.add('shake');
  }

  function submitGuess() {
    if (busy || round.status !== 'playing') return;
    updateElapsed();
    const result = E.submit(round);
    if (result.error) {
      const message = result.error === 'duplicate' ? 'جرّبت هذا الترتيب من قبل. استفد من نتيجته وغيّر تخمينك.' : 'أكمل جميع الخانات بأرقام مختلفة قبل التحقّق.';
      notice(message, 'error');
      shake();
      tone('error');
      return;
    }
    if (!round.started) startClock();
    activeSlot = 0;
    if (round.status !== 'playing') {
      if (round.status === 'won') {
        stats.wins++;
        stats.best[round.mode] = Math.min(stats.best[round.mode] || 99, round.attempts.length);
      } else stats.losses++;
      renderRound();
      notice(round.status === 'won' ? 'رائع! جميع الأرقام صحيحة وفي أماكنها.' : 'انتهت المحاولات الثماني. الرمز السري ظاهر الآن.', round.status === 'won' ? 'success' : '');
      tone(round.status === 'won' ? 'win' : 'lose');
      if (round.status === 'won') celebrate();
      ui.playAgainBtn.focus({ preventScroll: true });
    } else {
      renderRound();
      notice(result.exact + ' صحيح في المكان الصحيح، ' + result.misplaced + ' صحيح في المكان الخطأ، ' + result.absent + ' غير موجود.');
      tone('submit');
      ui.guessSlots.children[0].focus({ preventScroll: true });
    }
    persist();
  }

  function showDialog(dialog) {
    previousFocus = document.activeElement;
    dialog.showModal();
  }

  function closeDialog(dialog) {
    dialog.close();
  }

  function newRound(mode) {
    cleanupDrag();
    stopConfetti();
    round = E.createRound(mode);
    activeSlot = 0;
    elapsedAtStart = 0;
    clockStarted = Date.now();
    lastSavedSecond = 0;
    pendingMode = null;
    busy = false;
    renderRound();
    notice('رمز جديد ينتظرك. لديك 8 محاولات لاكتشافه.');
    persist();
    logSecret();
    ui.guessSlots.children[0].focus({ preventScroll: true });
  }

  function requestNewRound(mode) {
    const hasProgress = round.status === 'playing' && (round.attempts.length > 0 || round.guess.some(Boolean));
    if (!hasProgress) { newRound(mode); return; }
    pendingMode = mode;
    ui.modeSelect.value = round.mode;
    showDialog(ui.restartDialog);
  }

  function cleanupDrag() {
    if (!drag) return;
    drag.source.classList.remove('is-dragging');
    drag.ghost?.remove();
    document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
    try { if (drag.source.hasPointerCapture(drag.pointerId)) drag.source.releasePointerCapture(drag.pointerId); } catch (_) {}
    drag = null;
  }

  function pointerDown(event) {
    if (round.status !== 'playing' || busy || drag || event.button !== 0) return;
    const source = event.target.closest('.digit-button, .guess-slot');
    if (!source || source.disabled) return;
    const sourceIndex = source.dataset.slot !== undefined ? Number(source.dataset.slot) : -1;
    const digit = sourceIndex >= 0 ? round.guess[sourceIndex] : source.dataset.digit;
    if (!digit) return;
    drag = { source, sourceIndex, digit, pointerId: event.pointerId, x: event.clientX, y: event.clientY, active: false, ghost: null };
    try { source.setPointerCapture(event.pointerId); } catch (_) {}
  }

  function pointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 7) return;
    event.preventDefault();
    if (!drag.active) {
      drag.active = true;
      drag.source.classList.add('is-dragging');
      drag.ghost = document.createElement('div');
      drag.ghost.className = 'drag-ghost';
      drag.ghost.textContent = drag.digit;
      drag.ghost.setAttribute('aria-hidden', 'true');
      document.body.appendChild(drag.ghost);
    }
    drag.ghost.style.left = event.clientX + 'px';
    drag.ghost.style.top = event.clientY + 'px';
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.guess-slot');
    document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
    if (target) target.classList.add('drop-target');
  }

  function pointerUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (drag.active) {
      event.preventDefault();
      suppressClickUntil = Date.now() + 450;
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.guess-slot');
      if (target) place(drag.digit, Number(target.dataset.slot), false);
      else if (drag.sourceIndex >= 0 && document.elementFromPoint(event.clientX, event.clientY)?.closest('#digitBank')) {
        round.guess[drag.sourceIndex] = '';
        activeSlot = drag.sourceIndex;
        renderGuess();
        persist();
      }
    }
    cleanupDrag();
  }

  function stopConfetti() {
    if (confettiFrame !== null) cancelAnimationFrame(confettiFrame);
    confettiFrame = null;
    const context = ui.confettiCanvas.getContext('2d');
    context?.clearRect(0, 0, ui.confettiCanvas.width, ui.confettiCanvas.height);
  }

  function celebrate() {
    if (reduceMotion.matches) return;
    stopConfetti();
    const canvas = ui.confettiCanvas;
    const context = canvas.getContext('2d');
    if (!context) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const colors = ['#d9ef8b', '#ef8456', '#36826b', '#e8d0a0'];
    const particles = Array.from({ length: 100 }, () => ({ x: width / 2, y: height * .25, vx: (Math.random() - .5) * 15, vy: Math.random() * -12 - 3, rotation: Math.random() * 6, spin: (Math.random() - .5) * .18, size: 4 + Math.random() * 5, color: colors[Math.floor(Math.random() * colors.length)] }));
    let start = 0;
    let last = 0;
    function frame(time) {
      if (!start) start = time;
      const delta = Math.min((time - (last || time)) / 16.667, 2);
      last = time;
      context.clearRect(0, 0, width, height);
      const alpha = Math.max(0, 1 - Math.max(0, time - start - 1900) / 1500);
      particles.forEach(particle => {
        particle.x += particle.vx * delta;
        particle.y += particle.vy * delta;
        particle.vy += .16 * delta;
        particle.rotation += particle.spin * delta;
        context.save();
        context.translate(particle.x, particle.y);
        context.rotate(particle.rotation);
        context.globalAlpha = alpha;
        context.fillStyle = particle.color;
        context.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size * .6);
        context.restore();
      });
      if (time - start < 3400) confettiFrame = requestAnimationFrame(frame);
      else stopConfetti();
    }
    confettiFrame = requestAnimationFrame(frame);
  }

  '0123456789'.split('').forEach(digit => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'digit-button';
    button.dataset.digit = digit;
    button.textContent = digit;
    button.addEventListener('click', () => {
      if (Date.now() < suppressClickUntil) return;
      place(digit, activeSlot);
    });
    ui.digitBank.appendChild(button);
  });
  ui.submitBtn.addEventListener('click', submitGuess);
  ui.clearBtn.addEventListener('click', () => {
    round.guess.fill('');
    activeSlot = 0;
    renderGuess();
    notice('تم مسح التخمين الحالي. لم تُستهلك أي محاولة.');
    persist();
  });
  ui.newGameBtn.addEventListener('click', () => requestNewRound(round.mode));
  ui.playAgainBtn.addEventListener('click', () => newRound(round.mode));
  ui.modeSelect.addEventListener('change', () => requestNewRound(ui.modeSelect.value));
  ui.confirmRestartBtn.addEventListener('click', () => {
    const mode = pendingMode || round.mode;
    ui.restartDialog.close();
    newRound(mode);
  });
  ui.helpBtn.addEventListener('click', () => showDialog(ui.helpDialog));
  document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => closeDialog(button.closest('dialog'))));
  [ui.helpDialog, ui.restartDialog].forEach(dialog => {
    dialog.addEventListener('click', event => {
      const rect = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) closeDialog(dialog);
    });
    dialog.addEventListener('close', () => {
      pendingMode = null;
      if (previousFocus?.isConnected && !previousFocus.disabled) previousFocus.focus({ preventScroll: true });
      previousFocus = null;
    });
  });
  ui.themeBtn.addEventListener('click', () => {
    settings.theme = settings.theme === 'light' ? 'dark' : 'light';
    applySettings();
    persist();
  });
  ui.soundBtn.addEventListener('click', () => {
    settings.sound = !settings.sound;
    applySettings();
    tone('tap');
    persist();
  });

  ui.composer.addEventListener('pointerdown', pointerDown);
  window.addEventListener('pointermove', pointerMove, { passive: false });
  window.addEventListener('pointerup', pointerUp);
  window.addEventListener('pointercancel', cleanupDrag);
  window.addEventListener('blur', cleanupDrag);
  document.addEventListener('keydown', event => {
    if (ui.helpDialog.open || ui.restartDialog.open || round.status !== 'playing' || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest('select,input,textarea,[contenteditable="true"]')) return;
    const bankOrSlot = event.target.closest('.digit-button,.guess-slot');
    if (event.target.closest('button,a') && !bankOrSlot) return;
    let digit = event.key;
    const arabic = '٠١٢٣٤٥٦٧٨٩'.indexOf(digit);
    const eastern = '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit);
    if (arabic >= 0) digit = String(arabic);
    else if (eastern >= 0) digit = String(eastern);
    if (/^[0-9]$/.test(digit)) {
      event.preventDefault();
      place(digit, activeSlot);
    } else if (event.key === 'Enter' && (!bankOrSlot || bankOrSlot.classList.contains('guess-slot'))) {
      event.preventDefault();
      submitGuess();
    } else if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      clearDigit(event.key === 'Backspace');
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      activeSlot = (activeSlot + (event.key === 'ArrowRight' ? 1 : -1) + round.guess.length) % round.guess.length;
      renderGuess();
      ui.guessSlots.children[activeSlot].focus({ preventScroll: true });
    } else if (event.key === 'Escape') {
      cleanupDrag();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // Capture the final visible interval before pausing the thinking timer.
      if (round.started && round.status === 'playing') round.elapsed = elapsedAtStart + Math.max(0, Math.floor((Date.now() - clockStarted) / 1000));
      persist();
      cleanupDrag();
      stopConfetti();
    } else {
      elapsedAtStart = round.elapsed;
      clockStarted = Date.now();
    }
  });
  window.addEventListener('pagehide', persist);
  window.setInterval(() => {
    if (document.hidden || round.status !== 'playing' || !round.started) return;
    updateElapsed();
    ui.timer.textContent = formatTime(round.elapsed);
    if (round.elapsed - lastSavedSecond >= 5) { lastSavedSecond = round.elapsed; persist(); }
  }, 1000);

  applySettings();
  renderRound();
  logSecret();
  if (E.restoreRound(saved.round)) notice(round.status === 'playing' ? 'أهلًا بعودتك. استعدنا جولتك، أكمل من حيث توقفت.' : 'هذه نتيجة جولتك السابقة. جاهز لتحدٍّ جديد؟');
  if (!storageOK) notice('التخزين المحلي غير متاح؛ الجولة تعمل، لكن قد لا تُحفظ بعد الإغلاق.', 'error');
})();
