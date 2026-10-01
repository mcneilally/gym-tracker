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
      notes: String(o.notes || '').trim(), video: String(o.video || '').trim()
    };
  }

  /* Returns {days:[{id,name,exercises:[]}], errors:[]} from CSV-ish text */
  function parseProgramCSV(text) {
    var errors = [];
    text = String(text || '').trim();
    if (!text) return { days: [], errors: ['Nothing to import.'] };
    var rows = parseCSVRows(text, detectDelim(text));
    var head = rows[0].map(function (h) { return h.trim().toLowerCase(); });
    var known = ['day', 'exercise', 'sets', 'reps', 'weight', 'notes', 'video', 'type'];
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
      byName[key].exercises.push(makeExercise({ exercise: ex, sets: g('sets'), reps: g('reps') || '8-12', weight: g('weight'), notes: g('notes'), video: g('video'), type: g('type').toLowerCase() }));
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
            return makeExercise({ exercise: e.exercise || e.name, sets: e.sets, reps: reps, weight: e.weight, notes: e.notes, video: e.video, type: e.type });
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
        var dw = Math.max(0, roundPlate(tw * 0.9, 2.5));
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
      var nw = tw + inc;
      return Object.assign(base, { kind: 'add-weight', nextWeight: nw, nextReps: ex.repMin,
        text: 'Add ' + incLabel + ': go to ' + fmt(nw) + 'kg and aim for ' + ex.repMin + '+ reps.',
        reason: 'Every set hit the top of the ' + repsLabel(ex) + ' range (' + ex.repMax + ' reps) at ' + fmt(tw) + 'kg. That is the signal to add weight (' + incLabel + ' for ' + (ex.type === 'lower' ? 'lower' : 'upper') + '-body lifts).' });
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
  var api = { autoWeekdays: autoWeekdays, epley: epley, brzycki: brzycki, round1: round1, roundPlate: roundPlate, fmt: fmt, parseReps: parseReps, repsLabel: repsLabel,
    guessType: guessType, normName: normName, youtubeSearchUrl: youtubeSearchUrl, youtubeId: youtubeId,
    parseProgram: parseProgram, parseProgramCSV: parseProgramCSV, parseProgramJSON: parseProgramJSON, programToCSV: programToCSV,
    makeExercise: makeExercise, newId: newId, suggest: suggest, sessionE1RM: sessionE1RM, trend: trend, csvEscape: csvEscape };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GymLogic = api;
})(typeof self !== 'undefined' ? self : this);
