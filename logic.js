/* Pure logic: 1RM, rep parsing, CSV, coach. Works in browser (window.GymLogic) and node (module.exports). */
(function (root) {
  'use strict';

  function epley(w, r) { w = +w; r = +r; if (!(w > 0) || !(r > 0)) return 0; return r === 1 ? w : w * (1 + r / 30); }
  function brzycki(w, r) { w = +w; r = +r; if (!(w > 0) || !(r > 0) || r >= 37) return 0; return r === 1 ? w : w * 36 / (37 - r); }
  function round1(x) { return Math.round(x * 10) / 10; }
  function roundPlate(x, step) { step = step || 2.5; return Math.round(x / step) * step; }
  function fmt(n) { return (Math.round(n * 100) / 100).toString(); }

  function parseReps(s) {
    if (typeof s === 'number') return { min: s, max: s };
    s = String(s == null ? '' : s).trim();
    var m = s.match(/^(\d+)\s*[-–—to]+\s*(\d+)$/i);
    if (m) { var a = +m[1], b = +m[2]; return { min: Math.min(a, b), max: Math.max(a, b) }; }
    m = s.match(/^(\d+)/);
    if (m) return { min: +m[1], max: +m[1] };
    return { min: 8, max: 12 };
  }
  function repsLabel(ex) { return ex.repMin === ex.repMax ? String(ex.repMin) : ex.repMin + '–' + ex.repMax; }

  var LOWER_RE = /squat|deadlift|rdl|romanian|lunge|leg|hip thrust|glute|calf|calves|step.?up|hamstring|good morning|split squat/i;
  function guessType(name) { return LOWER_RE.test(name || '') ? 'lower' : 'upper'; }
  function normName(n) { return String(n || '').trim().toLowerCase().replace(/\s+/g, ' '); }

  function youtubeSearchUrl(name) {
    return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(String(name).trim()).replace(/%20/g, '+') + '+form+tutorial';
  }
  function youtubeId(url) {
    var m = String(url || '').match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|v\/))([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  /* ---------- CSV ---------- */
  function detectDelim(text) {
    var first = text.split(/\r?\n/).find(function (l) { return l.trim(); }) || '';
    var counts = { '\t': 0, ',': 0, ';': 0 };
    var q = false;
    for (var i = 0; i < first.length; i++) { var c = first[i]; if (c === '"') q = !q; else if (!q && counts[c] !== undefined) counts[c]++; }
    var best = ',', bc = -1;
    Object.keys(counts).forEach(function (k) { if (counts[k] > bc) { bc = counts[k]; best = k; } });
    return bc > 0 ? best : ',';
  }
  function parseCSVRows(text, delim) {
    var rows = [], row = [], cur = '', q = false;
    text = text.replace(/^\uFEFF/, '');
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); cur = '';
        if (row.some(function (x) { return x.trim() !== ''; })) rows.push(row);
        row = [];
      } else cur += c;
    }
    row.push(cur);
    if (row.some(function (x) { return x.trim() !== ''; })) rows.push(row);
    return rows;
  }
  function csvEscape(v) { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }

  var uid = 0;
  function newId(p) { uid++; return (p || 'id') + Date.now().toString(36) + uid.toString(36) + Math.random().toString(36).slice(2, 5); }

  function makeExercise(o) {
    var r = parseReps(o.reps);
    var name = String(o.exercise || o.name || '').trim();
    return {
      id: newId('e'), name: name,
      sets: Math.max(1, parseInt(o.sets, 10) || 3),
      repMin: o.repMin != null ? o.repMin : r.min, repMax: o.repMax != null ? o.repMax : r.max,
      weight: Math.max(0, parseFloat(String(o.weight || '0').replace(',', '.')) || 0),
      type: o.type === 'lower' || o.type === 'upper' ? o.type : guessType(name),
      notes: String(o.notes || '').trim(), video: String(o.video || '').trim(),
      muscle: String(o.muscle || '').trim(), backoff: !!o.backoff, backoffPct: +o.backoffPct || 6, rest: parseInt(o.rest, 10) || 0, nextReps: null, blockStart: null
    };
  }

  /* Returns {days:[{id,name,exercises:[]}], errors:[]} from CSV-ish text */
  function parseProgramCSV(text) {
    var errors = [];
    text = String(text || '').trim();
    if (!text) return { days: [], errors: ['Nothing to import.'] };
    var rows = parseCSVRows(text, detectDelim(text));
    var head = rows[0].map(function (h) { return h.trim().toLowerCase(); });
    var known = ['day', 'exercise', 'sets', 'reps', 'weight', 'notes', 'video', 'type', 'muscle'];
    var hasHead = head.indexOf('exercise') >= 0 || head.indexOf('day') >= 0;
    var idx = {};
    if (hasHead) { head.forEach(function (h, i) { if (known.indexOf(h) >= 0) idx[h] = i; }); rows.shift(); }
    else { ['day', 'exercise', 'sets', 'reps', 'weight', 'notes'].forEach(function (h, i) { idx[h] = i; }); }
    if (idx.exercise === undefined) return { days: [], errors: ['No "exercise" column found. Expected: day, exercise, sets, reps, weight, notes'] };
    var days = [], byName = {};
    rows.forEach(function (r, n) {
      function g(k) { return idx[k] === undefined ? '' : (r[idx[k]] || '').trim(); }
      var ex = g('exercise');
      if (!ex) { errors.push('Row ' + (n + 2) + ': no exercise name, skipped.'); return; }
      var dn = g('day') || 'Day 1';
      var key = dn.toLowerCase();
      if (!byName[key]) { byName[key] = { id: newId('d'), name: dn, exercises: [] }; days.push(byName[key]); }
      byName[key].exercises.push(makeExercise({ exercise: ex, sets: g('sets'), reps: g('reps') || '8-12', weight: g('weight'), notes: g('notes'), video: g('video'), type: g('type').toLowerCase(), muscle: g('muscle') }));
    });
    if (!days.length) errors.push('No valid rows found.');
    return { days: days, errors: errors };
  }

  function parseProgramJSON(text) {
    var data = JSON.parse(text);
    if (data && data.program) data = data.program; // full backup
    var days = Array.isArray(data) ? data : data.days;
    if (!Array.isArray(days)) throw new Error('JSON must be {"days":[...]} or a backup file.');
    return {
      name: data.name,
      days: days.map(function (d) {
        return {
          id: newId('d'), name: String(d.name || d.day || 'Day'),
          exercises: (d.exercises || []).map(function (e) {
            var reps = e.reps != null ? e.reps : (e.repMin != null ? (e.repMin === e.repMax ? e.repMin : e.repMin + '-' + e.repMax) : '8-12');
            return makeExercise({ exercise: e.exercise || e.name, sets: e.sets, reps: reps, weight: e.weight, notes: e.notes, video: e.video, type: e.type, muscle: e.muscle, backoff: e.backoff, backoffPct: e.backoffPct, rest: e.rest });
          })
        };
      }), errors: []
    };
  }

  function parseProgram(text) {
    text = String(text || '').trim();
    if (text[0] === '{' || text[0] === '[') {
      try { return parseProgramJSON(text); } catch (e) { return { days: [], errors: ['JSON problem: ' + e.message] }; }
    }
    return parseProgramCSV(text);
  }

  function programToCSV(program) {
    var lines = ['day,exercise,sets,reps,weight,notes'];
    program.days.forEach(function (d) {
      d.exercises.forEach(function (e) {
        lines.push([d.name, e.name, e.sets, repsLabel(e), e.weight, e.notes].map(csvEscape).join(','));
      });
    });
    return lines.join('\n') + '\n';
  }

  /* ---------- Coach ---------- */
  /* history: chronological (oldest -> newest) array of {sets:[{w,r}] (done only), recovery:'poor'|'ok'|'good'}
     ex: {sets, repMin, repMax, type, weight} */
  function topWeight(sets) { return sets.reduce(function (m, s) { return Math.max(m, +s.w || 0); }, 0); }
  function totalReps(sets) { return sets.reduce(function (m, s) { return m + (+s.r || 0); }, 0); }

  /* Load-scaled weight step. Light isolation/dumbbell loads get small jumps; never more than ~15% at once. */
  var DB_RE = /dumbbell|\bdb\b/i;
  var DB_EVEN_RE = /dumbbell|\bdb\b|lateral raise|rear delt fly|bicep curl/i;
  /* The user's gym only has even-kg dumbbells */
  function isDumbbell(ex) { if (!ex) return false; var n = String(ex.name || '');
    if (/dumbbell|\bdb\b/i.test(n) || /per\s+dumbbell/i.test(String(ex.notes || ''))) return true;
    if (/cable|machine|band/i.test(n)) return false;
    return DB_EVEN_RE.test(n); }
  function deloadPlain(w) { w = +w || 0; if (!(w > 0)) return 0; var d = roundPlate(w * 0.9, 2.5); if (d >= w) d = Math.floor(w * 0.9 * 2) / 2; if (d >= w) d = Math.max(0, w - 0.5); return Math.max(0, d); }
  function evenDown(w) { w = +w || 0; return Math.max(0, Math.floor(w / 2 + 1e-9) * 2); }
  function nextEven(w) { return evenDown(w) + 2; }
  function deloadEven(w) { w = +w || 0; if (!(w > 0)) return 0; var d = evenDown(w * 0.9); if (d >= w) d = Math.max(0, evenDown(w) - 2); return d; }
  function nextWeightFor(w, ex) {
    if (isDumbbell(ex)) return nextEven(w);
    w = +w || 0; var db = DB_RE.test((ex && ex.name) || ''), lower = ex && ex.type === 'lower', step;
    if (w < 15) step = 1; else if (w <= 40) step = db ? 2 : 2.5; else step = lower ? 5 : 2.5;
    var cap = w * 0.15;
    if (step > cap) step = Math.max(db ? 1 : 0.5, Math.floor(cap * 2) / 2);
    var nw = w + step;
    if (db) nw = Math.max(Math.floor(w) + 1, Math.round(nw)); // dumbbells come in whole kg
    return Math.round(nw * 100) / 100;
  }
  function suggest(history, ex) {
    var inc = ex.type === 'lower' ? 5 : 2.5;
    var incLabel = fmt(inc) + 'kg';
    history = (history || []).filter(function (h) { return h.sets && h.sets.length; });
    if (!history.length) {
      return { kind: 'start', nextWeight: ex.weight || 0, nextReps: ex.repMin, nextSets: ex.sets,
        text: 'First time logging this one. Start at ' + fmt(ex.weight || 0) + 'kg for ' + ex.sets + ' × ' + repsLabel(ex) + '.',
        reason: 'No history yet, so I am using your programme target. Pick a weight where the last rep of each set feels like you had 1–2 left in the tank.' };
    }
    var last = history[history.length - 1];
    var tw = topWeight(last.sets);
    var minR = Math.min.apply(null, last.sets.map(function (s) { return +s.r || 0; }));
    var missed = function (h) { return h.sets.some(function (s) { return (+s.r || 0) < ex.repMin; }); };
    var isTop = last.sets.length >= ex.sets && last.sets.every(function (s) { return (+s.r || 0) >= ex.repMax; });
    var base = { nextSets: Math.max(ex.sets, last.sets.length) };

    if (missed(last)) {
      var streak = 0;
      for (var i = history.length - 1; i >= 0 && missed(history[i]); i--) streak++;
      if (streak >= 2) {
        var dw = isDumbbell(ex) ? deloadEven(tw) : deloadPlain(tw);
        return Object.assign(base, { kind: 'deload', nextWeight: dw, nextReps: ex.repMin,
          text: 'Drop to ' + fmt(dw) + 'kg (a 10% deload) and rebuild.',
          reason: 'You fell short of ' + ex.repMin + ' reps in ' + streak + ' sessions in a row at ' + fmt(tw) + 'kg. A short deload clears fatigue so you can climb back past it.' });
      }
      return Object.assign(base, { kind: 'hold', nextWeight: tw, nextReps: ex.repMin,
        text: 'Hold ' + fmt(tw) + 'kg and aim for at least ' + ex.repMin + ' reps on every set.',
        reason: 'One or more sets finished below ' + ex.repMin + ' reps. One off session is normal; if it happens again next time I will suggest a 10% deload.' });
    }
    if (isTop) {
      if (tw === 0) {
        return Object.assign(base, { kind: 'bodyweight', nextWeight: 0, nextReps: ex.repMax + 1,
          text: 'Bodyweight target hit. Add ' + incLabel + ' (belt/vest/dumbbell) or push for ' + (ex.repMax + 1) + ' reps.',
          reason: 'Every set reached the top of the ' + repsLabel(ex) + ' range.' });
      }
      var nw = nextWeightFor(tw, ex); inc = Math.round((nw - tw) * 100) / 100; incLabel = fmt(inc) + 'kg';
      return Object.assign(base, { kind: 'add-weight', nextWeight: nw, nextReps: ex.repMin,
        text: 'Add ' + incLabel + ': go to ' + fmt(nw) + 'kg and aim for ' + ex.repMin + '+ reps.',
        reason: 'Every set hit the top of the ' + repsLabel(ex) + ' range (' + ex.repMax + ' reps) at ' + fmt(tw) + 'kg. That is the signal to add a small step (' + incLabel + ', scaled to the load) on top of what you actually lifted.' });
    }
    // in range: check for stall
    if (history.length >= 3) {
      var l3 = history.slice(-3);
      var sameW = l3.every(function (h) { return topWeight(h.sets) === tw; });
      var noGain = totalReps(l3[2].sets) <= totalReps(l3[0].sets);
      if (sameW && noGain) {
        if (last.recovery === 'good') {
          return Object.assign(base, { kind: 'add-set', nextWeight: tw, nextReps: ex.repMin, nextSets: Math.min(ex.sets + 2, Math.max(ex.sets, last.sets.length) + 1),
            text: 'Stalled at ' + fmt(tw) + 'kg. Add one extra set next time, same weight.',
            reason: 'Your total reps have not gone up over the last 3 sessions, but you reported good recovery. More volume is a better lever than more weight right now.' });
        }
        return Object.assign(base, { kind: 'hold-stalled', nextWeight: tw, nextReps: Math.min(ex.repMax, minR + 1),
          text: 'Progress has stalled at ' + fmt(tw) + 'kg. Keep the weight and focus on cleaner reps, sleep and food.',
          reason: 'Total reps have not improved over 3 sessions and recovery was not marked "good", so I would not add more volume yet. Log recovery as "Good" after a well-rested session and I may suggest an extra set.' });
      }
    }
    var target = Math.min(ex.repMax, minR + 1);
    return Object.assign(base, { kind: 'add-rep', nextWeight: tw, nextReps: target,
      text: 'Stay at ' + fmt(tw) + 'kg and aim for ' + target + ' reps on every set.',
      reason: 'All sets were inside the ' + repsLabel(ex) + ' range but not all at the top (your lowest set was ' + minR + '). Add a rep first; once every set hits ' + ex.repMax + ' we add weight.' });
  }

  /* 1RM summary over history entries [{date, sets}] */
  function sessionE1RM(sets) {
    var best = { epley: 0, brzycki: 0, w: 0, r: 0 };
    sets.forEach(function (s) {
      var e = epley(s.w, s.r);
      if (e > best.epley) best = { epley: e, brzycki: brzycki(s.w, s.r), w: +s.w, r: +s.r };
    });
    return best;
  }
  function trend(points) { // points: numbers chronological; % change of last vs avg of first-up-to-3 of last 6
    var p = points.slice(-6);
    if (p.length < 2) return null;
    var first = p[0], lastv = p[p.length - 1];
    if (!first) return null;
    return (lastv - first) / first * 100;
  }

  /* spread n workout days across Mon(0)..Sun(6) */
  var WD_PATTERNS = { 1: [0], 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5], 7: [0, 1, 2, 3, 4, 5, 6] };
  function autoWeekdays(days) {
    var pat = WD_PATTERNS[Math.min(7, Math.max(1, days.length))] || [];
    days.forEach(function (d, i) { if (d.weekday == null) d.weekday = pat[i] != null ? pat[i] : i % 7; });
    return days;
  }

  /* ---------- Phases: 4-week blocks (3 build + 1 deload) ---------- */
  var PHASE_WEEKS = 4;
  function phaseType(week) { return week >= PHASE_WEEKS ? 'deload' : 'build'; }
  function phaseLabel(p) { return 'Block ' + p.block + ' · Week ' + p.week + ' of ' + PHASE_WEEKS + ' · ' + (phaseType(p.week) === 'deload' ? 'Deload' : 'Build'); }
  function phaseFromWeek(week) { week = Math.max(1, parseInt(week, 10) || 1); return { block: Math.floor((week - 1) / PHASE_WEEKS) + 1, week: ((week - 1) % PHASE_WEEKS) + 1 }; }
    /* A full week is done when every programme day has been logged in that (absolute) week, since the phase last changed. */
  function weekDaysDone(sessions, week, since) {
    var seen = {};
    (sessions || []).forEach(function (s) { if (s.week === week && (s.date || 0) >= (since || 0)) seen[s.dayId || s.dayName] = 1; });
    return Object.keys(seen).length;
  }
  function shouldAdvance(sessions, week, since, dayCount) { return dayCount > 0 && weekDaysDone(sessions, week, since) >= dayCount; }
  function absWeek(block, pweek) { return (block - 1) * PHASE_WEEKS + pweek; }
  function sessionBlock(s) { return s.block || phaseFromWeek(s.week).block; }

  /* Deload: ~10% lighter (rounded to 2.5kg; 1kg for tiny loads so it never rounds UP), one fewer set (min 2) */
  function deloadTarget(ex) {
    var w = +ex.weight || 0, sets = Math.max(1, parseInt(ex.sets, 10) || 3), dw = 0;
    if (w > 0 && isDumbbell(ex)) dw = deloadEven(w);
    else if (w > 0) dw = deloadPlain(w);
    return { weight: dw, sets: Math.max(Math.min(sets, 2), sets - 1) };
  }
  /* Back-off weight for sets 2+ of a top-set structure: pct% lighter, rounded to 2.5kg, always below the top set */
  function backoffWeight(top, pct) {
    top = +top || 0; if (!(top > 0)) return 0;
    var w = roundPlate(top * (1 - (pct || 6) / 100), 2.5);
    if (w >= top) w = Math.max(0, top - 2.5);
    return w;
  }
  function targetOf(ex) { return { weight: +ex.weight || 0, reps: ex.nextReps != null ? ex.nextReps : ex.repMin, sets: ex.sets }; }
  /* The sets a session should start with, from the programme target (base or deload) */
  function plannedSets(ex, opts) {
    var deload = !!(opts && opts.deload), t = deload ? deloadTarget(ex) : { weight: +ex.weight || 0, sets: ex.sets };
    var reps = deload ? ex.repMin : (ex.nextReps != null ? ex.nextReps : ex.repMin), sets = [];
    for (var i = 0; i < t.sets; i++) sets.push({ w: ex.backoff && i > 0 ? backoffWeight(t.weight, ex.backoffPct) : t.weight, r: reps, done: false });
    return { sets: sets, weight: t.weight, nSets: t.sets, reps: reps, backoff: !!ex.backoff, backoffWeight: ex.backoff ? backoffWeight(t.weight, ex.backoffPct) : null, deload: deload };
  }
  function planText(ex, pl) {
    var rl = pl.reps + (pl.deload ? '' : '+');
    var base = pl.backoff && pl.nSets > 1
      ? 'Top set ' + fmt(pl.weight) + 'kg × ' + rl + ', then ' + (pl.nSets - 1) + ' back-off × ' + fmt(pl.backoffWeight) + 'kg'
      : pl.nSets + ' × ' + rl + (pl.weight ? ' @ ' + fmt(pl.weight) + 'kg' : ' bodyweight');
    return (pl.deload ? 'Deload week: ' : '') + base + (pl.deload ? ' (about 10% lighter, one set fewer)' : '');
  }
  /* Applying a coach suggestion = updating the programme target for the next session. Returns a change record or null. */
  function applySuggestion(ex, s) {
    if (!s || s.kind === 'start') return null;
    var before = targetOf(ex);
    ex.weight = s.nextWeight; ex.nextReps = s.nextReps; ex.sets = s.nextSets;
    var after = targetOf(ex);
    if (before.weight === after.weight && before.reps === after.reps && before.sets === after.sets) return null;
    return { before: before, after: after, kind: s.kind };
  }
  /* already handled if targets match the suggestion, or the coach was already applied for the latest logged session */
  function isApplied(ex, s, lastSid) {
    if (!s) return true;
    if (lastSid && ex.appliedSid === lastSid) return true;
    var t = targetOf(ex);
    return t.weight === s.nextWeight && t.reps === s.nextReps && t.sets === s.nextSets;
  }
  function describeChange(c) {
    var out = [];
    if (c.kind === 'programme') return c.note || 'Programme changed';
    if (c.kind === 'swapped') return (c.note || 'Swapped exercise') + ' → ' + c.exName + ' (' + c.after.sets + ' × ' + c.after.reps + ' @ ' + fmt(c.after.weight) + 'kg)';
    if (c.before.weight !== c.after.weight) out.push(fmt(c.before.weight) + ' → ' + fmt(c.after.weight) + 'kg');
    if (c.before.sets !== c.after.sets) out.push(c.before.sets + ' → ' + c.after.sets + ' sets');
    if (c.before.reps !== c.after.reps) out.push('reps ' + c.before.reps + ' → ' + c.after.reps);
    return out.join(', ');
  }
  /* Best weight actually lifted (>= repMin reps) for an exercise in a block, excluding deload sessions */
  function bestWorkingWeight(sessions, name, block, repMin) {
    var n = normName(name), best = 0;
    (sessions || []).forEach(function (s) {
      if (sessionBlock(s) !== block || s.deload) return;
      (s.exercises || []).forEach(function (e) {
        if (normName(e.name) !== n) return;
        (e.sets || []).forEach(function (x) { if (x.done !== false && (+x.r || 0) >= (repMin || 1) && +x.w > best) best = +x.w; });
      });
    });
    return best;
  }
  /* Next block's starting weight: slightly above the block's starting weight (+2.5 upper / +5 lower, capped near 10% on light loads),
     or the best working weight actually achieved if that is higher. */
  function nextBlockWeight(start, type, achieved) {
    start = +start || 0; if (!(start > 0)) return 0;
    var inc = type === 'lower' ? 5 : 2.5;
    inc = Math.min(inc, Math.max(1, Math.round(start * 0.1)));
    var w = Math.max(start + inc, +achieved || 0);
    return start >= 40 ? roundPlate(w, 2.5) : Math.round(w * 2) / 2;
  }


  /* ---------- History + change log (pure, shared by app and tests) ---------- */
  /* chronological history for an exercise. forCoach=true leaves out deload sessions so a light week never drives the coach. */
  function historyFor(sessions, name, forCoach, block) {
    var n = normName(name), out = [];
    (sessions || []).forEach(function (s) {
      if (forCoach && s.deload) return;
      if (block != null && sessionBlock(s) !== block) return;
      (s.exercises || []).forEach(function (e) {
        if (normName(e.name) !== n) return;
        var done = (e.sets || []).filter(function (x) { return x.done && +x.r > 0; });
        if (done.length) out.push({ date: s.date, week: s.week, block: s.block, pweek: s.pweek, deload: !!s.deload, dayName: s.dayName, sid: s.id, recovery: s.recovery || 'ok',
          sets: done.map(function (x) { return { w: +x.w, r: +x.r }; }) });
      });
    });
    return out;
  }
  function metaOf(ex) { return { sets: ex.sets || 3, repMin: ex.repMin || 8, repMax: ex.repMax || 12, type: ex.type || guessType(ex.name), weight: ex.weight || 0, name: ex.name || '', notes: ex.notes || '' }; }
  function suggestFor(ex, sessions, block) { return suggest(historyFor(sessions, ex.name, true, block), metaOf(ex)); }
  /* One-off correction for the old +2.5-on-lifted-weight bug (7kg target, 8kg lifted -> 10.5kg). */
  function fixLateralRaise(days, changes) {
    var out = null;
    (days || []).forEach(function (d) { (d.exercises || []).forEach(function (e) {
      if (out || normName(e.name) !== normName('Dumbbell lateral raise') || +e.weight !== 10.5) return;
      var last = null; (changes || []).forEach(function (c) { if (c.exId === e.id || normName(c.exName) === normName(e.name)) last = c; });
      if (!last || last.undone || last.kind !== 'add-weight' || !last.before || !last.after || +last.before.weight !== 7 || +last.after.weight !== 10.5) return;
      var before = { weight: e.weight, reps: e.nextReps != null ? e.nextReps : e.repMin, sets: e.sets };
      e.weight = 9;
      out = { id: newId('c'), date: Date.now(), exId: e.id, exName: e.name, kind: 'corrected', source: 'coach', before: before, after: { weight: 9, reps: before.reps, sets: e.sets }, undone: false };
      (changes || []).push(out);
    }); });
    return out;
  }
  function changeEntry(ex, c, source) {
    return { id: newId('c'), date: Date.now(), exId: ex.id, exName: ex.name, kind: c.kind, source: source, before: c.before, after: c.after, prevSid: c.prevSid, undone: false };
  }
  /* Apply the coach suggestion for one programme exercise. Returns a log entry or null (nothing to change). */
  function applyForExercise(ex, sessions, source, opts) {
    var hh = historyFor(sessions, ex.name, true, opts && opts.block), lastSid = hh.length ? hh[hh.length - 1].sid : null;
    if (lastSid && ex.appliedSid === lastSid) return null; // never apply twice for the same session
    var s = suggestFor(ex, sessions, opts && opts.block), oldStart = ex.blockStart, c = applySuggestion(ex, s);
    var prevSid = ex.appliedSid; ex.appliedSid = lastSid;
    if (!c) return null;
    c.prevSid = prevSid;
    // week 1 of a block is the calibration week: if the weight settles lower, the block's base moves down with it
    if (opts && opts.calibrate && ex.blockStart != null && ex.weight > 0 && ex.weight < ex.blockStart) { c.before.blockStart = oldStart; ex.blockStart = ex.weight; }
    return changeEntry(ex, c, source || 'manual');
  }
  function findExercise(days, id, name) {
    var hit = null, n = normName(name);
    (days || []).forEach(function (d) { (d.exercises || []).forEach(function (e) { if (!hit && e.id === id) hit = e; if (!hit && e.alt && e.alt.id === id) hit = e.alt; }); });
    if (!hit && name) (days || []).forEach(function (d) { (d.exercises || []).forEach(function (e) { if (!hit && normName(e.name) === n) hit = e; if (!hit && e.alt && normName(e.alt.name) === n) hit = e.alt; }); });
    return hit;
  }
  /* After a finished session: apply the coach suggestion to each exercise trained (never in a deload week). */
  function applySessionSuggestions(session, days, sessions, source) {
    var out = [];
    if (!session || session.deload) return out;
    (session.exercises || []).forEach(function (e) {
      var ex = findExercise(days, e.id, e.name); if (!ex) return;
      var entry = applyForExercise(ex, sessions, source || 'auto', { calibrate: session.pweek === 1, block: sessionBlock(session) }); if (entry) out.push(entry);
    });
    return out;
  }
  function changeIsCurrent(entry, ex) { var t = targetOf(ex), a = entry.after; return !!a && t.weight === a.weight && t.reps === a.reps && t.sets === a.sets; }
  /* Undo a logged change (restores the target as it was before). Returns true if something was restored. */
  function undoChange(entry, days) {
    if (!entry || entry.undone) return false;
    var ex = findExercise(days, entry.exId, entry.exName); if (!ex) return false;
    ex.weight = entry.before.weight; ex.nextReps = entry.before.reps; ex.sets = entry.before.sets;
    if (entry.before.blockStart != null) ex.blockStart = entry.before.blockStart;
    ex.appliedSid = entry.prevSid || null;
    entry.undone = true; return true;
  }
  /* End of a block: every exercise starts the next block slightly higher (or at the best working weight achieved). */
  function rolloverBlock(days, sessions, prevBlock) {
    var out = [];
    (days || []).forEach(function (d) { (d.exercises || []).forEach(function (ex) {
      var start = ex.blockStart != null ? ex.blockStart : ex.weight;
      var ach = bestWorkingWeight(sessions, ex.name, prevBlock, ex.repMin);
      var nw = nextBlockWeight(start, ex.type, ach);
      var before = Object.assign(targetOf(ex), { blockStart: start });
      ex.weight = nw; ex.blockStart = nw; ex.nextReps = null;
      var after = Object.assign(targetOf(ex), { blockStart: nw });
      if (before.weight !== after.weight || before.reps !== after.reps)
        out.push({ id: newId('c'), date: Date.now(), exId: ex.id, exName: ex.name, kind: 'new-block', source: 'block', before: before, after: after, undone: false });
    }); });
    return out;
  }

  /* Chest-supported machine row (replaced the barbell bent-over row on Day 1). */
  function chestRow() {
    var e = makeExercise({ exercise: 'Plate-loaded chest-supported row', sets: 3, reps: '8-10', weight: 70, type: 'upper', muscle: 'Back, lats, rear delts', rest: 120,
      notes: 'T-bar style, chest on pad. Log total plates (35kg each side = 70). Form first. Rest 2 min.' });
    e.video = youtubeSearchUrl('Plate loaded chest supported row'); return e;
  }
  /* One-off: swap 'Barbell bent-over row' on Day 1 for the chest-supported row. New id so history stays separate. */
  function swapBentOverRow(days, changes) {
    var d = (days || []).filter(function (x) { return /^day 1\b/i.test(x.name || ''); })[0] || (days || [])[0];
    if (!d || !d.exercises) return null;
    for (var i = 0; i < d.exercises.length; i++) {
      var o = d.exercises[i];
      if (normName(o.name) !== normName('Barbell bent-over row')) continue;
      var n = chestRow();
      if (n.blockStart == null) n.blockStart = n.weight; n.nextReps = null;
      d.exercises[i] = n;
      var c = { id: newId('c'), date: Date.now(), exId: n.id, exName: n.name, kind: 'swapped', source: 'coach', note: 'Swapped from ' + o.name,
        before: { weight: o.weight, reps: o.nextReps != null ? o.nextReps : o.repMin, sets: o.sets }, after: { weight: n.weight, reps: n.repMin, sets: n.sets }, undone: false, noUndo: true };
      (changes || []).push(c); return c;
    }
    return null;
  }

  /* One-time migration: round dumbbell targets down to even kg */
  function evenDumbbells(days, changes) {
    var out = [];
    (days || []).forEach(function (d) { (d.exercises || []).forEach(function (ex) {
      var w = +ex.weight || 0; if (!isDumbbell(ex) || !(w > 0)) return;
      var nw = evenDown(w); if (nw === w) return;
      var before = targetOf(ex); ex.weight = nw;
      var c = { id: newId('c'), date: Date.now(), exId: ex.id, exName: ex.name, kind: 'corrected', source: 'coach', note: 'Rounded to even-kg dumbbells', before: before, after: targetOf(ex), undone: false };
      (changes || []).push(c); out.push(c);
    }); });
    return out;
  }

  /* Alternatives: an exercise may carry one `alt` exercise (own id, name, target -> own history). Swapping exchanges them in place. */
  function swapAlt(ex) {
    if (!ex || !ex.alt) return false;
    var cur = {}; Object.keys(ex).forEach(function (k) { if (k !== 'alt') cur[k] = ex[k]; });
    var nx = ex.alt; Object.keys(ex).forEach(function (k) { delete ex[k]; });
    Object.keys(nx).forEach(function (k) { if (k !== 'alt') ex[k] = nx[k]; });
    ex.alt = cur; return true;
  }
  function makeFlyAlt() {
    var e = makeExercise({ exercise: 'Low-incline dumbbell fly', sets: 2, reps: '12', weight: 10, type: 'upper', muscle: 'Upper chest', rest: 60,
      notes: 'Bench ~30°. Weight per dumbbell. Slight bend in the elbows, stretch wide, squeeze up. Use when the cables are busy.' });
    e.video = youtubeSearchUrl('incline dumbbell fly form tutorial'); return e;
  }
  /* One-time migration: give Cable fly (low-to-high) its dumbbell alternative */
  function addFlyAlt(days) {
    var n = 0;
    (days || []).forEach(function (d) { (d.exercises || []).forEach(function (ex) {
      var names = [ex.name, ex.alt && ex.alt.name].map(normName);
      if (names.indexOf(normName('Cable fly (low-to-high)')) < 0 || names.indexOf(normName('Low-incline dumbbell fly')) >= 0) return;
      ex.alt = makeFlyAlt(); n++;
    }); });
    return n;
  }

  /* ---------- One-time migration: 4-day Push/Pull with optional leg finishers ---------- */
  function pushPullDays(oldDays) {
    var pool = {};
    (oldDays || []).forEach(function (d) { (d.exercises || []).forEach(function (e) {
      pool[normName(e.name)] = e; if (e.alt) pool[normName(e.alt.name)] = pool[normName(e.alt.name)] || Object.assign({ _fromAlt: true }, e.alt);
    }); });
    function take(name, o) {
      o = o || {};
      var src = pool[normName(name)], e;
      if (src) { e = JSON.parse(JSON.stringify(src)); delete e._fromAlt; delete e.alt; }
      else { e = makeExercise({ exercise: name, sets: o.s, reps: o.r, weight: o.w, type: o.t, notes: o.note, muscle: o.m, rest: o.rest }); e.video = youtubeSearchUrl((o.q || name) + ' form tutorial'); e.blockStart = e.weight; }
      if (o.s != null) e.sets = o.s;
      if (o.r != null) { var r = parseReps(o.r); if (e.repMin !== r.min || e.repMax !== r.max) e.nextReps = null; e.repMin = r.min; e.repMax = r.max; }
      if (src && o.w != null && e.weight !== o.w) { e.weight = o.w; e.blockStart = o.w; e.nextReps = null; }
      if (o.finisher) { e.finisher = true; e.optional = true; e.type = 'lower'; } else { delete e.finisher; delete e.optional; }
      if (o.note && src) e.notes = o.note;
      if (o.alt) { var a = o.alt; e.alt = a; }
      return e;
    }
    function fly() { var f = pool[normName('Low-incline dumbbell fly')] ? take('Low-incline dumbbell fly') : makeFlyAlt(); f.sets = 2; f.repMin = f.repMax = 12; if (!(f.weight > 0)) f.weight = 10; delete f.alt; return f; }
    var flyEx = fly(), cableFly = take('Cable fly (low-to-high)', { s: 2, r: '12' });
    flyEx.alt = cableFly; flyEx.notes = 'Bench ~30°. Weight per dumbbell. Slight bend in the elbows, stretch wide, squeeze up. Swap to cable fly if cables are free.';
    var dbLat = take('Dumbbell lateral raise');
    var cabLat = take('Cable lateral raise', { s: 3, r: '10-12', w: 5, note: 'Cable, one arm at a time. Build back up to 12 reps. Rest 60s.' });
    cabLat.alt = dbLat;
    var FN = 'Optional leg finisher – hidden while “Legs paused (knee)” is on. ';
    return [
      { id: newId('d'), name: 'Push A – Heavy', weekday: 0, exercises: [
        take('Barbell bench press'), take('Incline dumbbell press'),
        take('Seated dumbbell shoulder press', { s: 3, r: '8-10', w: 20, t: 'upper', m: 'Shoulders, triceps', rest: 120, q: 'Seated dumbbell shoulder press', note: 'Weight per dumbbell. Bench upright. Rest 90–120s.' }),
        take('Dumbbell lateral raise'), take('Skull crushers (EZ bar)'),
        take('Leg extension', { s: 2, r: '12', w: 80, finisher: true, note: FN + 'Smooth, pain-free range. Rest 60s.' })] },
      { id: newId('d'), name: 'Pull A – Heavy', weekday: 1, exercises: [
        take('Plate-loaded chest-supported row'), take('Wide lat pulldown'), take('Rear delt fly'), take('Dumbbell bicep curl'),
        take('Leg curl', { s: 2, r: '10', finisher: true, note: FN + 'Machine. Rest 60s.' })] },
      { id: newId('d'), name: 'Push B – Volume', weekday: 3, exercises: [
        take('Flat dumbbell bench press'), flyEx, cabLat, take('Tricep dips'),
        take('Leg press (volume)', { s: 2, r: '12', w: 170, finisher: true, note: FN + 'Controlled, no deep knee bend. Rest 90s.' })] },
      { id: newId('d'), name: 'Pull B – Volume', weekday: 4, exercises: [
        take('Seated cable row'), take('Chest-supported dumbbell row', { w: Math.min(28, evenDown((pool[normName('Chest-supported dumbbell row')] || {}).weight || 28)) || 28 }),
        take('Close-grip pulldown', { s: 3, r: '10', w: 60, t: 'upper', m: 'Lats, mid back, biceps', rest: 90, q: 'Close grip lat pulldown', note: 'V-handle or close grip. Rest 90s.' }),
        take('Hammer curl', { s: 3, r: '10', w: 14, t: 'upper', m: 'Biceps, forearms', rest: 60, q: 'Dumbbell hammer curl', note: 'Weight per dumbbell. Rest 60s.' }),
        take('Calf raise', { finisher: true, note: FN + 'Standing, two feet. Rest 45–60s.' }),
        take('Barbell hip thrust', { s: 2, r: '10', w: 60, finisher: true, note: FN + 'Barbell. Rest 90s.' })] }
    ];
  }
  function migratePushPull(state) {
    var old = state.program.days;
    state.program = { name: 'Alastair – Block 1 (Push/Pull)', days: pushPullDays(old) };
    state.nextDayIdx = 0;
    (state.changes = state.changes || []).push({ id: newId('c'), date: Date.now(), exId: '', exName: 'Programme', kind: 'programme', source: 'coach',
      note: 'Switched to 4-day Push/Pull (Mon/Tue/Thu/Fri) with optional leg finishers', before: {}, after: {}, undone: false, noUndo: true });
    return state;
  }
  function visibleExercises(day, legsPaused) { return (day.exercises || []).filter(function (e) { return !(legsPaused && e.finisher); }); }

  /* ---------- Built-in programme: Alastair – Block 1 ---------- */
  function builtinAlastairBlock1() {
    function X(o) {
      var e = makeExercise({ exercise: o.n, sets: o.s, reps: o.r, weight: o.w, type: o.t, notes: o.note, muscle: o.m, backoff: o.bo, rest: o.rest });
      e.video = youtubeSearchUrl(o.q || o.n);
      if (o.alt) e.alt = makeFlyAlt();
      return e;
    }
    var days = [
      { id: newId('d'), name: 'Day 1 – Heavy', weekday: 0, exercises: [
        X({ n: 'Leg press (heavy)', s: 3, r: '6', w: 210, t: 'lower', m: 'Quads, glutes', bo: true, rest: 150, q: 'Leg press', note: 'Top set then back-off sets ~6% lighter. Rest 2–3 min.' }),
        X({ n: 'Barbell bench press', s: 3, r: '6-8', w: 87.5, t: 'upper', m: 'Chest, triceps, front delts', bo: true, rest: 150, note: 'Top set then back-off sets ~6% lighter. Rest 2–3 min.' }),
        chestRow(),
        X({ n: 'Leg curl', s: 3, r: '8-10', w: 77.5, t: 'lower', m: 'Hamstrings', rest: 75, q: 'Seated leg curl machine', note: 'Machine. Rest 60–90s.' }),
        X({ n: 'Dumbbell lateral raise', s: 3, r: '10', w: 7, t: 'upper', m: 'Side delts', rest: 60, note: 'Light and controlled. Rest 60–90s.' }),
        X({ n: 'Dumbbell bicep curl', s: 3, r: '8-10', w: 14, t: 'upper', m: 'Biceps', rest: 60, note: 'Weight per dumbbell. Rest 60–90s.' })] },
      { id: newId('d'), name: 'Day 2 – Volume', weekday: 2, exercises: [
        X({ n: 'Incline dumbbell press', s: 3, r: '8-10', w: 30, t: 'upper', m: 'Upper chest, front delts, triceps', rest: 120, note: 'Weight per dumbbell. Rest 2–3 min.' }),
        X({ n: 'Seated cable row', s: 3, r: '8-10', w: 77.5, t: 'upper', m: 'Back, biceps', rest: 120, note: 'Rest 90–120s.' }),
        X({ n: 'Leg extension', s: 3, r: '8-10', w: 95, t: 'lower', m: 'Quads', rest: 75, q: 'Leg extension machine', note: 'Option: one leg at a time, machine only (reduce the weight to suit). Rest 60–90s.' }),
        X({ n: 'Barbell hip thrust', s: 3, r: '10', w: 60, t: 'lower', m: 'Glutes, hamstrings', rest: 120, q: 'Barbell hip thrust', note: 'Barbell. Start at 60 and find your level in week 1. Rest 90–120s.' }),
        X({ n: 'Skull crushers (EZ bar)', s: 3, r: '10', w: 25, t: 'upper', m: 'Triceps', rest: 75, q: 'EZ bar skull crushers', note: 'Elbows still, lower to forehead. Rest 60–90s.' }),
        X({ n: 'Calf raise', s: 3, r: '12', w: 0, t: 'lower', m: 'Calves', rest: 60, q: 'Standing calf raise', note: 'Machine or standing, two feet. Add load when 12 reps is easy. Rest 60–90s.' }),
        X({ n: 'Rear delt fly', s: 3, r: '12', w: 6, t: 'upper', m: 'Rear delts, upper back', rest: 60, q: 'Rear delt fly', note: 'Light, squeeze at the top. Rest 60–90s.' })] },
      { id: newId('d'), name: 'Day 3 – Mixed', weekday: 4, exercises: [
        X({ n: 'Leg press (volume)', s: 3, r: '10', w: 190, t: 'lower', m: 'Quads, glutes', rest: 150, q: 'Leg press', note: 'Rest 2–3 min.' }),
        X({ n: 'Flat dumbbell bench press', s: 3, r: '8-10', w: 34, t: 'upper', m: 'Chest, triceps', rest: 120, q: 'Dumbbell bench press', note: 'Weight per dumbbell. Rest 2–3 min.' }),
        X({ n: 'Wide lat pulldown', s: 3, r: '8-10', w: 65, t: 'upper', m: 'Lats, biceps', rest: 90, q: 'Wide grip lat pulldown', note: 'Rest 90–120s.' }),
        X({ n: 'Chest-supported dumbbell row', s: 3, r: '10', w: 26, t: 'upper', m: 'Mid back, lats, rear delts', rest: 90, note: 'Weight per dumbbell, both arms together. Rest 90s.' }),
        X({ n: 'Single-leg machine leg curl', s: 3, r: '10-12', w: 72.5, t: 'lower', m: 'Hamstrings', rest: 75, q: 'Single leg curl machine', note: 'One leg at a time, machine only. Reps are per leg; weight is the stack load for one leg, so adjust it in week 1. Rest 60–90s.' }),
        X({ n: 'Cable lateral raise', s: 3, r: '12', w: 7, t: 'upper', m: 'Side delts', rest: 60, note: 'Dumbbells work too. Rest 60–90s.' }),
        X({ n: 'Tricep dips', s: 3, r: '10', w: 0, t: 'upper', m: 'Triceps, chest', rest: 90, q: 'Tricep dips', note: 'Bodyweight. Rest 60–90s.' }),
        X({ n: 'Cable fly (low-to-high)', s: 2, r: '12', w: 12, t: 'upper', m: 'Upper chest', rest: 60, q: 'Low to high cable fly', note: 'Upper-chest angle. Rest 60–90s.', alt: true })] }
    ];
    return { name: 'Alastair – Block 1', days: days };
  }
  var api = { autoWeekdays: autoWeekdays, epley: epley, brzycki: brzycki, round1: round1, roundPlate: roundPlate, fmt: fmt, parseReps: parseReps, repsLabel: repsLabel,
    guessType: guessType, normName: normName, youtubeSearchUrl: youtubeSearchUrl, youtubeId: youtubeId,
    parseProgram: parseProgram, parseProgramCSV: parseProgramCSV, parseProgramJSON: parseProgramJSON, programToCSV: programToCSV,
    makeExercise: makeExercise, newId: newId,
    PHASE_WEEKS: PHASE_WEEKS, phaseType: phaseType, phaseLabel: phaseLabel, phaseFromWeek: phaseFromWeek, weekDaysDone: weekDaysDone, absWeek: absWeek,
    shouldAdvance: shouldAdvance, deloadTarget: deloadTarget, backoffWeight: backoffWeight, targetOf: targetOf, plannedSets: plannedSets, planText: planText,
    applySuggestion: applySuggestion, isApplied: isApplied, describeChange: describeChange, bestWorkingWeight: bestWorkingWeight, nextBlockWeight: nextBlockWeight,
    builtinAlastairBlock1: builtinAlastairBlock1, pushPullDays: pushPullDays, migratePushPull: migratePushPull, visibleExercises: visibleExercises,
    historyFor: historyFor, suggestFor: suggestFor, metaOf: metaOf, applyForExercise: applyForExercise, applySessionSuggestions: applySessionSuggestions,
    changeIsCurrent: changeIsCurrent, undoChange: undoChange, rolloverBlock: rolloverBlock, findExercise: findExercise, suggest: suggest, nextWeightFor: nextWeightFor, fixLateralRaise: fixLateralRaise, swapBentOverRow: swapBentOverRow, evenDumbbells: evenDumbbells, swapAlt: swapAlt, addFlyAlt: addFlyAlt, isDumbbell: isDumbbell, chestRow: chestRow, sessionE1RM: sessionE1RM, trend: trend, csvEscape: csvEscape };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GymLogic = api;
})(typeof self !== 'undefined' ? self : this);
