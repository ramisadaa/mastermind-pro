/* Pure game rules. Browser and Node compatible; no DOM or storage dependency. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MastermindEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MODES = Object.freeze({
    focus: Object.freeze({ length: 3, attempts: 8, title: 'تركيز' }),
    classic: Object.freeze({ length: 4, attempts: 8, title: 'كلاسيكي' }),
    expert: Object.freeze({ length: 5, attempts: 8, title: 'محترف' })
  });

  function generateSecret(length, random) {
    if (!Number.isInteger(length) || length < 1 || length > 10) throw new RangeError('Invalid code length');
    const pool = '0123456789'.split('');
    const next = random || Math.random;
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, length);
  }

  function evaluate(guess, secret) {
    if (guess.length !== secret.length) throw new RangeError('Code lengths must match');
    let exact = 0;
    const guessCounts = {};
    const secretCounts = {};
    for (let i = 0; i < secret.length; i++) {
      if (guess[i] === secret[i]) exact++;
      guessCounts[guess[i]] = (guessCounts[guess[i]] || 0) + 1;
      secretCounts[secret[i]] = (secretCounts[secret[i]] || 0) + 1;
    }
    let present = 0;
    for (const digit of Object.keys(guessCounts)) present += Math.min(guessCounts[digit], secretCounts[digit] || 0);
    return { exact, misplaced: present - exact, absent: secret.length - present };
  }

  function validCode(code, length) {
    return Array.isArray(code) && code.length === length && code.every(d => typeof d === 'string' && /^[0-9]$/.test(d)) && new Set(code).size === length;
  }

  function createRound(mode, secret) {
    const config = MODES[mode];
    if (!config) throw new RangeError('Unknown mode');
    const code = secret ? secret.slice() : generateSecret(config.length);
    if (!validCode(code, config.length)) throw new Error('Secret must contain unique digits');
    return { mode, secret: code, guess: Array(config.length).fill(''), attempts: [], status: 'playing', elapsed: 0, started: false };
  }

  function submit(round) {
    if (round.status !== 'playing') return { error: 'finished' };
    if (!validCode(round.guess, MODES[round.mode].length)) return { error: 'incomplete' };
    const guess = round.guess.join('');
    if (round.attempts.some(a => a.guess === guess)) return { error: 'duplicate' };
    const score = evaluate(round.guess, round.secret);
    round.attempts.push({ guess, ...score });
    if (score.exact === round.secret.length) round.status = 'won';
    else if (round.attempts.length >= MODES[round.mode].attempts) round.status = 'lost';
    round.guess = Array(round.secret.length).fill('');
    return { ...score, status: round.status };
  }

  function placeDigit(round, digit, target) {
    if (round.status !== 'playing' || !/^[0-9]$/.test(digit) || !Number.isInteger(target) || target < 0 || target >= round.guess.length) return false;
    const previous = round.guess.indexOf(digit);
    if (previous === target) return true;
    if (previous !== -1) round.guess[previous] = round.guess[target];
    round.guess[target] = digit;
    round.started = true;
    return true;
  }

  function restoreRound(value) {
    if (!value || !MODES[value.mode]) return null;
    const config = MODES[value.mode];
    if (!validCode(value.secret, config.length) || !Array.isArray(value.guess) || value.guess.length !== config.length || !value.guess.every(d => d === '' || (typeof d === 'string' && /^[0-9]$/.test(d)))) return null;
    const filled = value.guess.filter(Boolean);
    if (new Set(filled).size !== filled.length || !Array.isArray(value.attempts) || value.attempts.length > config.attempts || !Number.isFinite(value.elapsed) || value.elapsed < 0) return null;
    const round = createRound(value.mode, value.secret);
    for (const attempt of value.attempts) {
      if (!attempt || typeof attempt.guess !== 'string' || !validCode(attempt.guess.split(''), config.length) || round.status !== 'playing') return null;
      round.guess = attempt.guess.split('');
      if (submit(round).error) return null;
    }
    round.guess = round.status === 'playing' ? value.guess.slice() : Array(config.length).fill('');
    round.elapsed = Math.floor(value.elapsed);
    round.started = Boolean(value.started) || round.attempts.length > 0 || filled.length > 0;
    return round;
  }
  return Object.freeze({ MODES, generateSecret, evaluate, validCode, createRound, submit, placeDigit, restoreRound });
});
