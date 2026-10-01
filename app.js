(function () {
  'use strict';
  var L = window.GymLogic;
  var KEY = 'gymtracker.v1';
  var DAY = 86400000;

  /* ============ state ============ */
  function defaults() {
    return { v: 2, program: { name: 'My programme', days: [] }, week: 1, nextDayIdx: 0, sessions: [], active: null, changes: [], phaseSince: 0,
      videos: {}, settings: { name: 'Alastair', restOn: true, restSecs: 90, sound: true, step: 2.5, autoApply: true, autoPhase: true }, lastBackup: 0, seeded: false, created: Date.now() };
  }
  function normalise(s) {
    var d = defaults();
    s = s && typeof s === 'object' ? s : {};
    Object.keys(d).forEach(function (k) { if (s[k] === undefined) s[k] = d[k]; });
    s.settings = Object.assign({}, d.settings, s.settings);
    if (!s.program || !Array.isArray(s.program.days)) s.program = d.program;
    if (!Array.isArray(s.sessions)) s.sessions = [];
    if (!s.videos || typeof s.videos !== 'object') s.videos = {};
    L.autoWeekdays(s.program.days);
    s.week = Math.max(1, parseInt(s.week, 10) || 1);
    s.nextDayIdx = Math.max(0, parseInt(s.nextDayIdx, 10) || 0);
    if (!Array.isArray(s.changes)) s.changes = [];
    s.phaseSince = +s.phaseSince || 0;
    // forward-fill per-exercise fields added in v2 (muscle, back-off, rest, calibrated reps, block base weight)
    s.program.days.forEach(function (d) { (d.exercises || []).forEach(function (e) {
      if (e.muscle == null) e.muscle = ''; if (e.backoff == null) e.backoff = false; if (!e.backoffPct) e.backoffPct = 6;
      if (e.rest == null) e.rest = 0; if (e.nextReps === undefined) e.nextReps = null; if (e.blockStart == null) e.blockStart = e.weight || 0;
    }); });
    // v1 -> v2: before, the coach set each session's targets on the fly from history. Now targets live on the programme, so carry them over once.
    if ((+s.v || 1) < 2) {
      if (s.sessions.length) s.program.days.forEach(function (d) { (d.exercises || []).forEach(function (e) {
        var c = L.applyForExercise(e, s.sessions, 'migrate'); if (c) s.changes.push(c);
      }); });
      s.v = 2;
    }
    return s;
  }
  function load() { try { return normalise(JSON.parse(localStorage.getItem(KEY))); } catch (e) { return defaults(); } }
  var state = load();
  var saveFailed = false;
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); saveFailed = false; }
    catch (e) { if (!saveFailed) toast('⚠️ Could not save! Storage full or blocked. Export a backup now.'); saveFailed = true; }
  }
  var ui = { tab: 'home', stack: [], selDate: null, calOff: 0, wtab: 'list', progEx: null, openVideo: {}, openHist: {} };

  /* ============ helpers ============ */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtDate(t) { return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
  function fmtDateLong(t) { return new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); }
  function fmtSets(sets) { return sets.map(function (s) { return L.fmt(s.w) + '×' + s.r; }).join(', '); }
  function num(v) { var n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : 0; }
  var toastT;
  function toast(msg) { var t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, 3200); }
  function days() { return state.program.days; }
  function clampDay() { if (state.nextDayIdx >= days().length) state.nextDayIdx = 0; }
  function videoUrl(name) { var pe = findProgEx(name); return state.videos[L.normName(name)] || (pe && pe.video) || L.youtubeSearchUrl(name); }
  function hasCustomVideo(name) { return !!state.videos[L.normName(name)]; }
  function findProgEx(name) {
    var n = L.normName(name);
    for (var i = 0; i < days().length; i++) for (var j = 0; j < days()[i].exercises.length; j++) if (L.normName(days()[i].exercises[j].name) === n) return days()[i].exercises[j];
    return null;
  }
  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function readFile(file) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsText(file); }); }

  /* ============ history / coach glue ============ */
  function historyFor(name) { return L.historyFor(state.sessions, name, false); }
  function coachHist(name) { return L.historyFor(state.sessions, name, true, phase().block); } // deload weeks never drive the coach
  function phase() { return L.phaseFromWeek(state.week); }
  function isDeloadNow() { return L.phaseType(phase().week) === 'deload'; }
  function wkTxt(absWeek) { var p = L.phaseFromWeek(absWeek); return 'B' + p.block + ' Wk ' + p.week; }
  function logChanges(list) { if (list && list.length) { state.changes = state.changes.concat(list).slice(-150); } }
  /* move to another week; crossing into a new block raises every exercise's starting weight */
  function setWeek(n, source) {
    n = Math.max(1, n | 0); var ob = phase().block, nb = L.phaseFromWeek(n).block, started = 0;
    for (var b = ob; b < nb; b++) { var ch = L.rolloverBlock(days(), state.sessions, b); logChanges(ch); started += ch.length; }
    state.week = n; state.phaseSince = Date.now();
    return { newBlock: nb > ob, raised: started };
  }
  function phaseBannerHTML() {
    var p = phase(), dl = isDeloadNow(), done = L.weekDaysDone(state.sessions, state.week, state.phaseSince), need = days().length;
    return '<div class="banner phase ' + (dl ? 'deload' : 'build') + '"><div class="row between"><b>' + esc(L.phaseLabel(p)) + '</b><button class="sm" data-act="editweek">Change</button></div>' +
      '<div class="small">' + (dl ? 'Reset week: weights about 10% lighter and one set fewer. Recover, move well, no grinding.' : p.week === 1 ? 'Calibration week: find your weights on the “find your level” lifts.' : 'Build week: follow the coach and add reps or weight.') +
      (need ? ' · ' + Math.min(done, need) + '/' + need + ' sessions this week' : '') + (state.settings.autoPhase ? '' : ' · auto-advance off') + '</div></div>';
  }
  function metaFor(name, fallback) {
    var p = findProgEx(name) || fallback || {};
    return { sets: p.sets || 3, repMin: p.repMin || 8, repMax: p.repMax || 12, type: p.type || L.guessType(name), weight: p.weight || 0 };
  }
  function shortDay(n) { return String(n).replace(/\s*[-–—:]\s*.*$/, ''); }
  function lastLine(h) {
    if (!h) return '<span class="dim">No previous session yet.</span>';
    var b = L.sessionE1RM(h.sets);
    return 'Last time <b>' + wkTxt(h.week) + ' · ' + esc(shortDay(h.dayName)) + '</b> (' + fmtDate(h.date) + '): <b>' + esc(fmtSets(h.sets)) + '</b> · e1RM ' + L.round1(b.epley) + 'kg';
  }

  /* ============ session ============ */
  function startSession(dayIdx) {
    var day = days()[dayIdx]; if (!day || !day.exercises.length) { toast('That day has no exercises yet.'); return; }
    var dl = isDeloadNow(), ph = phase();
    var exs = day.exercises.map(function (ex) {
      var pl = L.plannedSets(ex, { deload: dl });
      return { id: ex.id, name: ex.name, type: ex.type || L.guessType(ex.name), notes: ex.notes || '', muscle: ex.muscle || '', rest: ex.rest || 0, backoff: !!ex.backoff,
        target: { sets: pl.nSets, repMin: ex.repMin, repMax: ex.repMax, weight: pl.weight, baseSets: ex.sets, baseWeight: ex.weight }, plan: L.planText(ex, pl), sets: pl.sets };
    });
    state.active = { id: L.newId('s'), date: Date.now(), week: state.week, block: ph.block, pweek: ph.week, deload: dl, dayId: day.id, dayIdx: dayIdx, dayName: day.name, exercises: exs };
    save(); ui.tab = 'workouts'; ui.stack = [{ t: 'workout', d: dayIdx }, { t: 'exercise', d: dayIdx, e: 0 }]; render(); window.scrollTo(0, 0);
  }
  var lastFinish = null;
  function finishSession(recovery) {
    var a = state.active; if (!a) return;
    a.recovery = recovery; a.finished = true; a.endDate = Date.now();
    a.exercises.forEach(function (e) { e.sets = e.sets.filter(function (s) { return s.done; }); });
    a.exercises = a.exercises.filter(function (e) { return e.sets.length; });
    state.sessions.push(a); state.active = null;
    var applied = [];
    if (state.settings.autoApply && !a.deload) { applied = L.applySessionSuggestions(a, days(), state.sessions, 'auto'); logChanges(applied); }
    var idx = a.dayIdx + 1; if (idx >= days().length) idx = 0;
    var adv = null;
    if (state.settings.autoPhase && state.week === a.week && L.shouldAdvance(state.sessions, a.week, state.phaseSince, days().length)) adv = setWeek(a.week + 1, 'auto');
    state.nextDayIdx = idx; ui.stack = []; ui.tab = 'home'; ui.selDate = null;
    lastFinish = { applied: applied, adv: adv, deload: !!a.deload, endDate: a.endDate };
    stopRest(); save();
    showSummary(a);
  }
  function sessionDoneCount(a) { return a.exercises.reduce(function (n, e) { return n + e.sets.filter(function (s) { return s.done; }).length; }, 0); }

  /* ============ rest timer ============ */
  var rest = null, restInt = null;
  function startRest(secs) {
    rest = { end: Date.now() + secs * 1000, fired: false };
    clearInterval(restInt); restInt = setInterval(tickRest, 250); tickRest();
  }
  function stopRest() { rest = null; clearInterval(restInt); var r = $('#rest'); r.hidden = true; }
  function beep() {
    try {
      var C = window.AudioContext || window.webkitAudioContext, c = new C(), o = c.createOscillator(), g = c.createGain();
      o.connect(g); g.connect(c.destination); o.frequency.value = 880; g.gain.value = 0.2; o.start(); o.stop(c.currentTime + 0.25);
      setTimeout(function () { c.close(); }, 600);
    } catch (e) { }
  }
  function tickRest() {
    var r = $('#rest'); if (!rest) return;
    var left = Math.ceil((rest.end - Date.now()) / 1000);
    r.hidden = false;
    if (left <= 0) {
      if (!rest.fired) { rest.fired = true; if (navigator.vibrate) navigator.vibrate([300, 100, 300]); if (state.settings.sound) beep(); setTimeout(function () { if (rest && rest.fired) stopRest(); }, 15000); }
      r.className = 'over'; r.innerHTML = '<div class="t">Rest over – go! 💪</div><button class="sm" data-rest="stop">OK</button>'; return;
    }
    r.className = '';
    var m = Math.floor(left / 60), s = left % 60;
    r.innerHTML = '<div class="t">⏱ ' + m + ':' + (s < 10 ? '0' : '') + s + '</div><button class="sm" data-rest="-15">−15</button><button class="sm" data-rest="+15">+15</button><button class="sm" data-rest="stop">Skip</button>';
  }
  $('#rest').addEventListener('click', function (e) {
    var b = e.target.closest('[data-rest]'); if (!b || !rest) return; var v = b.dataset.rest;
    if (v === 'stop') stopRest(); else { rest.end += (v === '+15' ? 15000 : -15000); rest.fired = false; tickRest(); }
  });

  /* ============ modal ============ */
  function openModal(html, mount) {
    var m = $('#modal'); m.innerHTML = '<div class="sheet">' + html + '</div>'; m.hidden = false;
    if (mount) mount(m.firstChild);
  }
  function closeModal() { var m = $('#modal'); m.hidden = true; m.innerHTML = ''; }
  $('#modal').addEventListener('click', function (e) { if (e.target.id === 'modal' || e.target.closest('[data-act=closemodal]')) closeModal(); });



  var summaryA = null;
  function refreshSummaryOrRender() { if (!$('#modal').hidden && summaryA) showSummary(summaryA); else render(); }
  function showSummary(a) {
    summaryA = a;
    var h = '<h2>Nice work! 🎉</h2><div class="dim small">' + esc(a.dayName) + ' · ' + esc(wkTxt(a.week)) + ' saved.</div>';
    if (a.deload) h += '<div class="banner deload small">Deload session: targets for next block are unchanged by this week.</div>';
    a.exercises.forEach(function (e) {
      var meta = metaFor(e.name, e.target), hist = historyFor(e.name), prev = hist.length > 1 ? hist[hist.length - 2] : null;
      var best = L.sessionE1RM(e.sets), prevBest = prev ? L.sessionE1RM(prev.sets).epley : 0;
      var pr = prev && best.epley > prevBest + 0.05;
      h += '<div class="card" style="margin-top:10px"><b>' + esc(e.name) + '</b> ' + (pr ? '<span class="pill" style="background:var(--ok);color:#04210f">New e1RM high</span>' : '') +
        '<div class="dim">' + esc(fmtSets(e.sets)) + ' · e1RM ' + L.round1(best.epley) + 'kg</div>' + (a.deload ? '' : coachHTML(e.name, meta, { exId: e.id, since: a.endDate })) + '</div>';
    });
    clampDay();
    var nd = days()[state.nextDayIdx];
    if (lastFinish && lastFinish.adv) h += '<div class="banner info">' + (lastFinish.adv.newBlock ? '🚀 <b>Block ' + phase().block + ' starts!</b> Starting weights raised on ' + lastFinish.adv.raised + ' exercises (see Profile → Coach change log, you can undo).' : '✅ Week complete, moved on to <b>' + esc(L.phaseLabel(phase())) + '</b>.') + '</div>';
    h += '<p>Next up: <b class="acc">' + esc(L.phaseLabel(phase())) + ' · ' + esc(nd ? nd.name : '') + '</b></p><button class="primary big full" data-act="closemodal">Done</button>';
    openModal(h); render();
  }

  /* ============ shared view helpers ============ */
  var afterRender = null;
  var WDN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  function wdIdx(t) { return (new Date(t).getDay() + 6) % 7; }
  function sod(t) { var d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function addDays(t, n) { var d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); }
  function mondayOf(t) { return addDays(sod(t), -wdIdx(t)); }
  function sameDay(a, b) { return sod(a) === sod(b); }
  function dayFor(t) { return days().filter(function (d) { return d.weekday === wdIdx(t); }); }
  function doneOn(t) { return state.sessions.filter(function (s) { return sameDay(s.date, t); }); }
  function dayMinutes(d) { return Math.max(10, Math.round(d.exercises.reduce(function (m, e) { return m + e.sets * 2.5 + 2; }, 0) / 5) * 5); }
  var EMO = [[/squat|leg press|lunge|leg|calf|step/i, '🦵', '#23405f'], [/deadlift|rdl|romanian|hip|glute|good morning/i, '🍑', '#4a3a1f'], [/bench|press|chest|fly|dip|push/i, '💪', '#4a2330'], [/row|pull|lat|chin|shrug/i, '🏋️', '#1f4a3a'], [/curl|bicep/i, '💪', '#3a2a5a'], [/tricep|pushdown|extension/i, '💪', '#5a3a1f'], [/plank|core|crunch|ab/i, '🧘', '#2a4a4a'], [/shoulder|lateral|raise|overhead|ohp/i, '🙆', '#2a3a5a']];
  function thumbHTML(name, big) {
    var e = EMO.filter(function (x) { return x[0].test(name); })[0] || [0, '🏋️', '#27303f'];
    var id = L.youtubeId(state.videos[L.normName(name)]);
    return '<div class="thumb' + (big ? ' lg' : '') + '" style="background:' + e[2] + '">' + e[1] + (id ? '<img alt="" loading="lazy" src="https://i.ytimg.com/vi/' + id + '/mqdefault.jpg" onerror="this.remove()">' : '') + '</div>';
  }
  function thumbsRow(day, max) {
    return '<div class="thumbs">' + day.exercises.slice(0, max || 5).map(function (e) { return thumbHTML(e.name); }).join('') + (day.exercises.length > (max || 5) ? '<div class="thumb" style="background:var(--card2);font-size:15px;font-weight:700">+' + (day.exercises.length - (max || 5)) + '</div>' : '') + '</div>';
  }
  function videoMedia(name) {
    var url = videoUrl(name), id = L.youtubeId(url), k = L.normName(name), custom = hasCustomVideo(name);
    var m;
    if (id && ui.openVideo[k]) m = '<div class="video-embed"><iframe src="https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&playsinline=1" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen title="Tutorial"></iframe></div>';
    else if (id) m = '<button class="vthumb" data-act="embed" aria-label="Play video"><img alt="" src="https://i.ytimg.com/vi/' + id + '/hqdefault.jpg" onerror="this.remove()"><span class="play">▶</span></button>';
    else m = '<a class="vlink" href="' + esc(url) + '" target="_blank" rel="noopener"><span class="play">▶</span>' + (custom ? 'Watch tutorial video' : 'Watch form tutorials') + '<small>' + (custom ? 'Opens your saved link' : 'Opens YouTube search in a new tab') + '</small></a>';
    return '<div class="media">' + m + '</div>' +
      '<div class="row wrap" style="margin-bottom:12px">' + (id ? '<a class="btn sm" href="' + esc(url) + '" target="_blank" rel="noopener">Open in YouTube ↗</a>' : '<a class="btn sm" href="' + esc(url) + '" target="_blank" rel="noopener">Search YouTube ↗</a>') +
      '<button class="sm" data-act="editvideo">✎ Edit video link</button></div>';
  }
  function coachHTML(name, meta, opts) {
    if (isDeloadNow() && !(opts && opts.since)) return '<div class="coach hold"><b>🧠 Coach:</b> Deload week. Targets are about 10% lighter with one set fewer; the coach picks up again next block.</div>';
    var s = L.suggest(coachHist(name), meta);
    var cls = s.kind === 'deload' ? 'deload' : (s.kind === 'hold' || s.kind === 'hold-stalled') ? 'hold' : s.kind === 'start' ? 'start' : '';
    var ex = findProgEx(name), act = '';
    if (ex && s.kind !== 'start') {
      var logged = null;
      if (opts && opts.since) state.changes.forEach(function (c) { if (c.exId === ex.id && c.date >= opts.since - 1 && !c.undone && (c.source === 'auto' || c.source === 'manual')) logged = c; });
      if (logged) act = '<div class="row between applybar"><span class="ok small">✓ ' + (logged.source === 'auto' ? 'Auto-applied' : 'Applied') + ': ' + esc(L.describeChange(logged)) + '</span><button class="sm" data-act="undochange" data-cid="' + logged.id + '">Undo</button></div>';
      else if (L.isApplied(ex, s, (coachHist(name).slice(-1)[0] || {}).sid)) act = '<div class="applybar"><span class="ok small">✓ Next session target is up to date</span></div>';
      else act = '<div class="applybar"><button class="sm primary" data-act="applycoach" data-exid="' + esc(ex.id) + '">Apply → next target ' + esc(L.fmt(s.nextWeight) + 'kg · ' + s.nextSets + ' × ' + s.nextReps + '+') + '</button></div>';
    }
    return '<div class="coach ' + cls + '"><b>🧠 Coach says:</b> ' + esc(s.text) + '<div class="why">Why: ' + esc(s.reason) + '</div>' + act + '</div>';
  }
  function coachHTMLLive(e, meta) {
    if (state.active.deload) return '<div class="coach hold"><b>🧠 Coach:</b> Deload session. Keep it smooth and leave reps in the tank.</div>';
    var hist = coachHist(e.name);
    var done = e.sets.filter(function (s) { return s.done && +s.r > 0; }).map(function (s) { return { w: +s.w, r: +s.r }; });
    hist.push({ sets: done, recovery: state.active.recovery || 'ok' });
    var s = L.suggest(hist, meta);
    var cls = s.kind === 'deload' ? 'deload' : (s.kind === 'hold' || s.kind === 'hold-stalled') ? 'hold' : '';
    return '<div class="coach ' + cls + '"><b>🧠 Coach says (next time):</b> ' + esc(s.text) + '<div class="why">Why: ' + esc(s.reason) + '</div><div class="small dim">' + (state.settings.autoApply ? 'Will be applied automatically when you finish the workout.' : 'You can tap Apply after you finish the workout.') + '</div></div>';
  }
  function sessionCardHTML(s) {
    var open = ui.openHist[s.id];
    return '<div class="card"><div class="row between"><div><b>' + esc(s.dayName) + '</b><div class="dim small">' + wkTxt(s.week) + (s.deload ? ' (deload)' : '') + ' · ' + fmtDateLong(s.date) + ' · recovery: ' + esc(s.recovery || 'ok') + '</div></div>' +
      '<button class="sm ghost" data-act="togglehist" data-sid="' + s.id + '">' + (open ? 'Hide' : 'View') + '</button></div>' +
      (open ? s.exercises.map(function (e) { return '<div class="hist"><b>' + esc(e.name) + '</b><div class="dim">' + esc(fmtSets(e.sets)) + '</div></div>'; }).join('') +
        '<button class="sm danger full" style="margin-top:8px" data-act="delsession" data-sid="' + s.id + '">Delete this session</button>' : '') + '</div>';
  }
  function activeProgress(a) {
    var tot = 0, dn = 0; a.exercises.forEach(function (e) { tot += e.sets.length; dn += e.sets.filter(function (s) { return s.done; }).length; });
    return { tot: tot, dn: dn };
  }

  /* ============ HOME ============ */
  function workoutHero(d, di, dateT, completed) {
    var act = state.active && state.active.dayIdx === di;
    var h = '<div class="hero"><div class="row between"><span class="pill">' + (isDeloadNow() ? 'Deload' : 'Week ' + phase().week) + '</span><span class="dim small">' + d.exercises.length + ' exercises · ~' + dayMinutes(d) + ' min</span></div><h2>' + esc(d.name) + '</h2>';
    h += '<div class="dim small">' + d.exercises.slice(0, 3).map(function (e) { return esc(e.name); }).join(' · ') + (d.exercises.length > 3 ? ' …' : '') + '</div>' + thumbsRow(d, 5);
    if (completed) h += '<div class="row"><span class="ok" style="font-weight:700">✓ Completed</span><button class="sm grow" data-act="openworkout" data-day="' + di + '">Details</button></div>';
    else h += '<button class="primary big full" data-act="start" data-day="' + di + '">' + (act ? 'Resume workout' : 'Start workout') + '</button><button class="ghost full sm" data-act="openworkout" data-day="' + di + '" style="margin-top:4px">View exercises</button>';
    return h + '</div>';
  }
  function homeHTML() {
    var today = sod(Date.now()), mon = mondayOf(today), sel = ui.selDate != null ? ui.selDate : today;
    var h = '';
    if (state.sessions.length && Date.now() - state.lastBackup > 7 * DAY) h += '<div class="banner">💾 Your data only lives on this phone. <b>' + (state.lastBackup ? 'Last backup ' + fmtDate(state.lastBackup) + '.' : 'No backup yet.') + '</b> <a href="#" data-go="profile">Back up now →</a></div>';
    h += '<div class="hello"><div class="row between"><h2>Hi ' + esc(state.settings.name || 'there') + ' 👋</h2><span class="chip">' + esc(L.phaseLabel(phase())) + '</span></div></div>';
    if (days().length) h += phaseBannerHTML();
    h += '<div class="card" style="padding:8px 8px 10px"><div class="strip">';
    for (var i = 0; i < 7; i++) {
      var t = addDays(mon, i), sched = dayFor(t).length > 0, done = doneOn(t).length > 0;
      h += '<button class="wd' + (sameDay(t, today) ? ' today' : '') + (sched ? ' sched' : '') + (done ? ' done' : '') + (sameDay(t, sel) ? ' sel' : '') + '" data-act="seldate" data-t="' + t + '"><span class="l">' + WDN[i][0] + '</span><span class="n">' + new Date(t).getDate() + '</span><span class="d">' + (done ? '✓' : sched ? '●' : '') + '</span></button>';
    }
    h += '</div><div class="dim small" style="text-align:center">' + (sameDay(sel, today) ? 'Today' : fmtDateLong(sel)) + '</div></div>';
    if (state.active) {
      var a = state.active, pr = activeProgress(a);
      h += '<div class="hero" style="border-color:var(--ok)"><span class="pill" style="background:var(--ok);color:#04210f">In progress</span><h2>' + esc(a.dayName) + '</h2><div class="dim small">' + pr.dn + ' of ' + pr.tot + ' sets done</div><div class="progress"><i style="width:' + (pr.tot ? pr.dn / pr.tot * 100 : 0) + '%"></i></div><button class="primary big full" data-act="openworkout" data-day="' + a.dayIdx + '">Resume workout</button></div>';
    } else if (!days().length) {
      h += '<div class="card"><h2>Let’s set up a programme</h2><p class="dim">You don’t have a programme yet.</p><button class="primary full" data-act="loadmine">Load my programme (Alastair – Block 1)</button><button class="full" style="margin-top:8px" data-act="loadsample">Load sample 3-day full body</button><button class="full" style="margin-top:8px" data-go="calendar" data-ctab="prog">Import or build my own</button></div>';
    } else {
      var sched = dayFor(sel), done = doneOn(sel);
      if (sched.length) sched.forEach(function (d) { var di = days().indexOf(d); h += workoutHero(d, di, done.some(function (s) { return s.dayId === d.id; })); });
      else {
        h += '<div class="card"><div class="row"><div style="font-size:30px">😴</div><div><b>No workout scheduled</b><div class="dim small">' + (done.length ? 'But you trained: ' + esc(done.map(function (s) { return s.dayName; }).join(', ')) : 'Enjoy the rest day, or train anyway.') + '</div></div></div></div>';
      }
      clampDay();
      var nd = days()[state.nextDayIdx];
      if (!sched.length || sched.indexOf(nd) < 0) h += '<div class="card"><div class="dim small">' + (state.sessions.length ? 'You left off after <b>' + esc(state.sessions[state.sessions.length - 1].dayName) + '</b> (' + wkTxt(state.sessions[state.sessions.length - 1].week) + ', ' + fmtDate(state.sessions[state.sessions.length - 1].date) + '). Next in your programme:' : 'Ready for your first session. Next in your programme:') + '</div><div class="row between" style="margin-top:6px"><b class="acc">' + esc(nd.name) + '</b><button class="sm primary" data-act="start" data-day="' + state.nextDayIdx + '">Start workout</button></div></div>';
    }
    if (state.sessions.length) { h += '<h3 style="margin:16px 4px 8px">Recent workouts</h3>'; state.sessions.slice(-3).reverse().forEach(function (s) { h += sessionCardHTML(s); }); }
    return h;
  }

  /* ============ CALENDAR + PROGRAMME ============ */
  function calendarHTML() {
    var base = new Date(); base.setDate(1); base.setMonth(base.getMonth() + ui.calOff);
    var y = base.getFullYear(), m = base.getMonth(), first = new Date(y, m, 1).getTime(), dim = new Date(y, m + 1, 0).getDate(), today = sod(Date.now());
    var sel = ui.selDate != null ? ui.selDate : today;
    var h = days().length ? phaseBannerHTML() : '';
    h += '<div class="card"><div class="row between"><button class="iconbtn" data-act="calprev">‹</button><b>' + base.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) + '</b><button class="iconbtn" data-act="calnext">›</button></div><div class="cal" style="margin-top:8px">';
    WDN.forEach(function (w) { h += '<div class="h">' + w[0] + '</div>'; });
    for (var i = 0; i < wdIdx(first); i++) h += '<button class="out"></button>';
    for (var d = 1; d <= dim; d++) {
      var t = new Date(y, m, d).getTime(), sc = dayFor(t).length > 0, dn = doneOn(t).length > 0;
      h += '<button class="' + (sameDay(t, today) ? 'today ' : '') + (sc ? 'sched ' : '') + (dn ? 'done ' : '') + (sameDay(t, sel) ? 'sel' : '') + '" data-act="calsel" data-t="' + t + '">' + d + '<i></i></button>';
    }
    h += '</div><div class="row small dim" style="margin-top:8px"><span class="acc">●</span> scheduled <span class="ok">●</span> done</div></div>';
    h += '<div class="card"><b>' + fmtDateLong(sel) + '</b>';
    var sc2 = dayFor(sel), dn2 = doneOn(sel);
    if (!sc2.length && !dn2.length) h += '<div class="dim small">Nothing scheduled.</div>';
    sc2.forEach(function (d) { var di = days().indexOf(d); h += '<div class="row between" style="margin-top:8px"><div><b>' + esc(d.name) + '</b><div class="dim small">' + d.exercises.length + ' exercises</div></div><button class="sm" data-act="openworkout" data-day="' + di + '">Open</button></div>'; });
    dn2.forEach(function (s) { h += '<div class="hist"><span class="ok">✓</span> ' + esc(s.dayName) + ' <span class="dim small">(' + s.exercises.length + ' exercises)</span></div>'; });
    return h + '</div>';
  }
  function calTabHTML() {
    return '<div class="seg"><button data-act="ctab" data-v="cal" class="' + (ui.ctab !== 'prog' ? 'on' : '') + '">Calendar</button><button data-act="ctab" data-v="prog" class="' + (ui.ctab === 'prog' ? 'on' : '') + '">Programme</button></div>' + (ui.ctab === 'prog' ? programHTML() : calendarHTML());
  }

  /* ============ WORKOUTS list + detail ============ */
  function workoutsHTML() {
    if (!days().length) return '<div class="card"><h2>No workouts yet</h2><p class="dim">Import or build a programme first.</p><button class="primary full" data-act="loadmine">Load my programme</button><button class="full" style="margin-top:8px" data-act="loadsample">Load sample 3-day full body</button></div>';
    var h = '<div class="dim small" style="margin:0 4px 8px">' + esc(state.program.name) + ' · next up: <b class="acc">' + esc(days()[state.nextDayIdx].name) + '</b></div>';
    days().forEach(function (d, i) {
      var last = null; state.sessions.forEach(function (s) { if (s.dayId === d.id) last = s; });
      h += '<div class="card wcard" data-act="openworkout" data-day="' + i + '"><div class="row between"><b style="font-size:18px">' + esc(d.name) + '</b>' + (i === state.nextDayIdx ? '<span class="pill">Next</span>' : '') + '</div>' +
        '<div class="dim small">' + (d.weekday != null ? WDN[d.weekday] + ' · ' : '') + d.exercises.length + ' exercises · ~' + dayMinutes(d) + ' min' + (last ? ' · last done ' + fmtDate(last.date) : '') + '</div>' + thumbsRow(d, 5) + '</div>';
    });
    return h;
  }
  function workoutHTML(di) {
    var d = days()[di]; if (!d) return '<div class="card">Workout not found.</div>';
    var act = state.active && state.active.dayIdx === di ? state.active : null;
    var h = '<div class="card whead"><div class="row between"><span class="pill">' + (act ? (act.deload ? 'Deload' : 'Week ' + act.pweek) : (isDeloadNow() ? 'Deload' : 'Week ' + phase().week)) + '</span><span class="dim small">' + d.exercises.length + ' exercises · ~' + dayMinutes(d) + ' min</span></div><h2 style="margin-top:8px">' + esc(d.name) + '</h2>';
    if (act) { var pr = activeProgress(act); h += '<div class="progress"><i style="width:' + (pr.tot ? pr.dn / pr.tot * 100 : 0) + '%"></i></div><div class="dim small">' + pr.dn + ' of ' + pr.tot + ' sets done</div>'; }
    h += '</div><div class="card nopad">';
    (act ? act.exercises : d.exercises).forEach(function (e, j) {
      var hist = historyFor(e.name), last = hist[hist.length - 1];
      var pl = act ? null : L.plannedSets(e, { deload: isDeloadNow() }), tg = act ? e.target : { sets: pl.nSets, repMin: e.repMin, repMax: e.repMax, weight: pl.weight };
      var badge = act ? (function () { var dn = e.sets.filter(function (s) { return s.done; }).length; return '<span class="badge' + (dn >= e.sets.length ? ' ok' : '') + '">' + dn + '/' + e.sets.length + '</span>'; })() : '';
      h += '<div class="exrow" data-act="openex" data-day="' + di + '" data-ex="' + j + '">' + thumbHTML(e.name) + '<div class="info"><div class="nm">' + esc(e.name) + '</div><div class="dim small">' + tg.sets + ' sets × ' + L.repsLabel(tg) + (tg.weight ? ' · ' + L.fmt(tg.weight) + 'kg' : '') + (e.backoff ? ' · top set + back-off' : '') + (e.muscle ? ' · ' + esc(e.muscle) : '') + '</div>' +
        (last ? '<div class="dim small">Last: ' + esc(fmtSets(last.sets)) + '</div>' : '') + '</div>' + badge + '<span class="chev">›</span></div>';
    });
    h += '</div>';
    if (act) h += '<button class="danger full" data-act="discard">Discard workout</button>';
    return h;
  }

  /* ============ EXERCISE screen ============ */
  function exerciseHTML(di, ei) {
    var a = state.active && state.active.dayIdx === di ? state.active : null;
    var pe = days()[di] && days()[di].exercises[ei];
    var e = a ? a.exercises[ei] : pe; if (!e) return '<div class="card">Exercise not found.</div>';
    var name = e.name, hist = historyFor(name), last = hist[hist.length - 1];
    var pl = a ? null : L.plannedSets(e, { deload: isDeloadNow() }), tg = a ? e.target : { sets: pl.nSets, repMin: e.repMin, repMax: e.repMax, weight: pl.weight };
    var meta = a ? { sets: tg.sets, repMin: tg.repMin, repMax: tg.repMax, type: e.type, weight: tg.weight } : { sets: e.sets, repMin: e.repMin, repMax: e.repMax, type: e.type, weight: e.weight };
    var h = videoMedia(name);
    h += '<div class="card"><div class="ex-name">' + esc(name) + '</div><span class="tag">' + tg.sets + ' × ' + L.repsLabel(tg) + '</span><span class="tag">' + (e.type === 'lower' ? 'lower body · +5kg steps' : 'upper body · +2.5kg steps') + '</span>' + (e.muscle ? '<span class="tag">' + esc(e.muscle) + '</span>' : '') + (e.backoff ? '<span class="tag">top set + back-off</span>' : '') + (e.rest ? '<span class="tag">rest ~' + (e.rest >= 120 ? Math.round(e.rest / 60 * 2) / 2 + ' min' : e.rest + 's') + '</span>' : '') +
      (e.notes ? '<div class="small dim" style="margin-top:8px">📝 ' + esc(e.notes) + '</div>' : '') + '<div class="last">' + lastLine(last) + '</div>';
    var plan = a ? e.plan : L.planText(e, pl);
    h += '<div class="plan">🎯 ' + (a ? 'Today: ' : 'Next: ') + esc(plan) + '</div></div>';
    if (a) {
      var doneSets = e.sets.filter(function (s) { return s.done; });
      h += '<div class="card nopad"><div class="lt head"><span>Set</span><span>Previous</span><span>kg</span><span>Reps</span><span>✓</span></div>';
      e.sets.forEach(function (s, j) {
        var p = last && last.sets[Math.min(j, last.sets.length - 1)];
        h += '<div class="lt row' + (s.done ? ' done' : '') + '" data-s="' + j + '"><div class="n">' + (j + 1) + '</div>' +
          '<button class="prev" data-act="prev" ' + (p ? '' : 'disabled') + ' aria-label="Copy previous">' + (p ? L.fmt(p.w) + '×' + p.r : '–') + '</button>' +
          '<div class="stepper"><button data-act="w-" aria-label="Less weight">−</button><input inputmode="decimal" data-f="w" value="' + esc(L.fmt(s.w)) + '" aria-label="Weight kg"><button data-act="w+" aria-label="More weight">+</button></div>' +
          '<div class="stepper"><button data-act="r-" aria-label="Fewer reps">−</button><input inputmode="numeric" data-f="r" value="' + esc(s.r) + '" aria-label="Reps"><button data-act="r+" aria-label="More reps">+</button></div>' +
          '<button class="check' + (s.done ? ' on' : '') + '" data-act="done" aria-label="Mark set done">✓</button></div>';
      });
      h += '<div class="row" style="padding:8px"><button class="sm grow" data-act="addset">+ Add set</button><button class="sm grow ghost" data-act="rmset"' + (e.sets.length <= 1 ? ' disabled' : '') + '>− Remove last</button></div></div>';
      if (doneSets.length) { var cur = L.sessionE1RM(doneSets.map(function (s) { return { w: +s.w, r: +s.r }; })); h += '<div class="small dim" style="margin:0 4px 12px">Today’s best e1RM: <b style="color:var(--text)">' + L.round1(cur.epley) + 'kg</b> (Epley) · ' + L.round1(cur.brzycki) + 'kg (Brzycki)</div>'; }
      if (doneSets.length >= tg.sets) h += coachHTMLLive(e, meta);
    } else {
      h += coachHTML(name, meta);
      h += '<div class="card nopad"><div class="lt head" style="grid-template-columns:30px 1fr 1fr"><span>Set</span><span>Target kg</span><span>Reps</span></div>';
      for (var j = 0; j < tg.sets; j++) h += '<div class="lt row" style="grid-template-columns:30px 1fr 1fr;text-align:center"><div class="n">' + (j + 1) + '</div><div>' + (pl.sets[j].w ? L.fmt(pl.sets[j].w) : '–') + '</div><div>' + L.repsLabel(tg) + '</div></div>';
      h += '</div>';
    }
    if (hist.length) {
      var b = hist.reduce(function (m, x) { var s = L.sessionE1RM(x.sets); return s.epley > m.epley ? s : m; }, { epley: 0 });
      h += '<div class="card"><h3>Best e1RM</h3><b style="font-size:24px">' + L.round1(b.epley) + 'kg</b> <span class="dim small">Epley · ' + L.round1(b.brzycki) + 'kg Brzycki</span> <button class="sm ghost" data-act="toprogress">See chart ›</button></div>';
    }
    return h;
  }

  /* ============ PROFILE ============ */
  function profileHTML() {
    var st = state.settings;
    var h = '<div class="banner">⚠️ <b>Your data is stored only on this phone</b> (browser local storage). If you clear Safari/Chrome website data, remove the app or lose the phone, it’s gone. <b>Export a backup regularly</b> and keep it somewhere safe (iCloud, Drive, email to yourself).</div>';
    h += '<div class="card"><label style="margin-top:0">Your name</label><input data-set="name" value="' + esc(st.name || '') + '"><div class="dim small" style="margin-top:6px">Units: kg · ' + state.sessions.length + ' sessions logged</div></div>';
    h += '<div class="card"><h2>Backup</h2><div class="dim small">' + (state.lastBackup ? 'Last exported ' + fmtDateLong(state.lastBackup) : 'Never exported') + '</div>' +
      '<div class="row wrap" style="margin-top:10px"><button class="primary grow" data-act="exportjson">⬇️ Export backup (JSON)</button></div>' +
      '<div class="row wrap" style="margin-top:8px"><button class="grow" data-act="sharejson">📤 Share / save…</button><button class="grow" data-act="copyjson">📋 Copy</button></div>' +
      '<h3 style="margin-top:16px">Restore</h3><label class="btn full" style="margin:0;color:var(--text)">📁 Choose backup file<input type="file" id="restorefile" accept=".json,application/json" hidden></label>' +
      '<label>…or paste backup JSON</label><textarea id="restoretext" placeholder="{ … }"></textarea><button class="full" style="margin-top:8px" data-act="restorepaste">Restore from pasted text</button>' +
      '<p class="small dim">Restoring replaces everything currently in the app.</p></div>';
    h += '<div class="card"><h2>Training settings</h2>' +
      '<div class="switch"><span>Rest timer after each set</span><input type="checkbox" data-set="restOn"' + (st.restOn ? ' checked' : '') + '></div>' +
      '<div class="switch"><span>Beep when rest ends</span><input type="checkbox" data-set="sound"' + (st.sound ? ' checked' : '') + '></div>' +
      '<div class="switch"><span>Auto-apply coach suggestions<br><small class="dim">Updates next session’s targets when you finish a workout</small></span><input type="checkbox" data-set="autoApply"' + (st.autoApply ? ' checked' : '') + '></div>' +
      '<div class="switch"><span>Auto-advance the week<br><small class="dim">When every day of the week is done</small></span><input type="checkbox" data-set="autoPhase"' + (st.autoPhase ? ' checked' : '') + '></div>' +
      '<label>Rest length (seconds)</label><select data-set="restSecs">' + [45, 60, 90, 120, 150, 180, 240].map(function (s) { return '<option' + (st.restSecs === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>' +
      '<label>Weight +/− step (kg)</label><select data-set="step">' + [1, 1.25, 2, 2.5, 5].map(function (s) { return '<option' + (st.step === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>' +
      '<button class="full" style="margin-top:12px" data-act="editweek">Change block / week / next workout</button></div>';
    h += changeLogHTML();
    h += '<div class="card"><h2>Add to home screen</h2><ul class="plain small"><li><b>iPhone (Safari):</b> Share button → Add to Home Screen.</li><li><b>Android (Chrome):</b> ⋮ menu → Install app / Add to Home screen.</li></ul><div class="small dim">Once opened online once, it works offline. On iPhone the Home Screen app and the Safari tab can have separate storage – pick one and stick with it, and back up before switching.</div></div>';
    h += '<div class="card"><button class="danger full" data-act="wipe">Erase all data</button></div>';
    return h;
  }
  function changeLogHTML() {
    var list = state.changes.slice(-20).reverse();
    var h = '<div class="card"><h2>Coach change log</h2><div class="dim small">Every target change from the coach or a new block. Undo puts the target back.</div>';
    if (!list.length) return h + '<div class="dim small" style="margin-top:8px">Nothing yet.</div></div>';
    list.forEach(function (c) {
      var lbl = c.source === 'auto' ? 'auto' : c.source === 'block' ? 'new block' : c.source === 'migrate' ? 'carried over' : 'applied';
      h += '<div class="hist"><div class="row between"><div><b>' + esc(c.exName) + '</b> <span class="dim small">' + fmtDate(c.date) + ' · ' + lbl + '</span><div class="small' + (c.undone ? ' dim' : '') + '">' + (c.undone ? '<s>' : '') + esc(L.describeChange(c) || 'no change') + (c.undone ? '</s> (undone)' : '') + '</div></div>' +
        (c.undone ? '' : '<button class="sm" data-act="undochange" data-cid="' + c.id + '">Undo</button>') + '</div></div>';
    });
    return h + '</div>';
  }
  function repsTxt(ex) { return ex.sets + ' × ' + L.repsLabel(ex) + (ex.weight ? ' @ ' + L.fmt(ex.weight) + 'kg' : '') + (ex.backoff ? ' · top set + back-off' : ''); }
  function programHTML() {
    var h = '<div class="card"><b>Alastair – Block 1</b><div class="dim small">3 full-body days (Mon/Wed/Fri), machines and free weights, no free-standing single-leg moves. Your logged history is kept.</div><button class="primary full" style="margin-top:8px" data-act="loadmine">Load my programme</button></div>';
    h += '<div class="card"><label style="margin-top:0">Programme name</label><input id="progname" value="' + esc(state.program.name) + '"></div>';
    h += '<div class="card"><details><summary>⬆️ Import a programme (CSV / JSON / paste)</summary>' +
      '<p class="small dim">Columns: <b>day, exercise, sets, reps, weight, notes</b> (reps can be a range like 8-10; weight in kg). Comma, semicolon or tab separated. JSON also works.</p>' +
      '<textarea id="importtext" placeholder="day,exercise,sets,reps,weight,notes&#10;Day 1,Back Squat,3,5-8,60,Brace hard"></textarea>' +
      '<div class="row" style="margin-top:8px"><label class="btn sm grow" style="margin:0;color:var(--text)">📁 Choose file<input type="file" id="importfile" accept=".csv,.json,.txt,text/csv,application/json,text/plain" hidden></label></div>' +
      '<div class="row" style="margin-top:8px"><button class="primary grow" data-act="import" data-mode="replace">Replace programme</button><button class="grow" data-act="import" data-mode="append">Add to current</button></div></details>' +
      '<div class="row wrap" style="margin-top:8px"><a class="btn sm" href="program-template.csv" download="program-template.csv">⬇️ CSV template</a><a class="btn sm" href="sample-program.csv" download="sample-3-day-full-body.csv">⬇️ Sample 3-day</a>' +
      '<button class="sm" data-act="loadsample">Load sample</button><button class="sm" data-act="exportcsv">Export current CSV</button></div></div>';
    state.program.days.forEach(function (d, i) {
      h += '<div class="dayblock" data-d="' + i + '"><div class="row"><input class="grow" data-f="dayname" value="' + esc(d.name) + '" aria-label="Day name">' +
        '<select data-f="dayweekday" aria-label="Weekday" style="width:auto;padding:0 6px">' + WDN.map(function (w, k) { return '<option value="' + k + '"' + (d.weekday === k ? ' selected' : '') + '>' + w + '</option>'; }).join('') + '</select>' +
        '<button class="iconbtn" data-act="dayup"' + (i === 0 ? ' disabled' : '') + '>↑</button><button class="iconbtn" data-act="daydown"' + (i === days().length - 1 ? ' disabled' : '') + '>↓</button><button class="iconbtn danger" data-act="daydel">🗑</button></div>';
      d.exercises.forEach(function (ex, j) {
        h += '<div class="exline" data-e="' + j + '"><div class="info"><div class="nm">' + esc(ex.name) + '</div><div class="dim small">' + esc(repsTxt(ex)) + '</div></div>' +
          '<button class="iconbtn" data-act="exup"' + (j === 0 ? ' disabled' : '') + '>↑</button><button class="iconbtn" data-act="exdown"' + (j === d.exercises.length - 1 ? ' disabled' : '') + '>↓</button><button class="iconbtn" data-act="exedit">✎</button></div>';
      });
      h += '<button class="sm full" style="margin-top:8px" data-act="exadd">+ Add exercise</button></div>';
    });
    h += '<button class="full" data-act="dayadd">+ Add day</button>';
    return h;
  }
  function editExerciseModal(di, ei) {
    var isNew = ei == null, ex = isNew ? L.makeExercise({ exercise: '', sets: 3, reps: '8-12', weight: 0 }) : days()[di].exercises[ei];
    var custom = state.videos[L.normName(ex.name)] || '';
    openModal('<h2>' + (isNew ? 'Add exercise' : 'Edit exercise') + '</h2>' +
      '<label>Name</label><input id="x-name" value="' + esc(ex.name) + '">' +
      '<div class="row"><div class="grow"><label>Sets</label><input id="x-sets" inputmode="numeric" value="' + ex.sets + '"></div><div class="grow"><label>Min reps</label><input id="x-rmin" inputmode="numeric" value="' + ex.repMin + '"></div><div class="grow"><label>Max reps</label><input id="x-rmax" inputmode="numeric" value="' + ex.repMax + '"></div></div>' +
      '<div class="row"><div class="grow"><label>Target weight (kg)</label><input id="x-w" inputmode="decimal" value="' + L.fmt(ex.weight) + '"></div><div class="grow"><label>Type (for +kg steps)</label><select id="x-type"><option value="upper"' + (ex.type === 'upper' ? ' selected' : '') + '>Upper (+2.5kg)</option><option value="lower"' + (ex.type === 'lower' ? ' selected' : '') + '>Lower (+5kg)</option></select></div></div>' +
      '<div class="row"><div class="grow"><label>Muscle group</label><input id="x-muscle" value="' + esc(ex.muscle || '') + '"></div><div class="grow"><label>Rest (seconds)</label><input id="x-rest" inputmode="numeric" value="' + (ex.rest || '') + '" placeholder="e.g. 90"></div></div>' +
      '<div class="switch"><span>Top set then back-off<br><small class="dim">Set 1 heaviest, later sets ~6% lighter (rounded to 2.5kg)</small></span><input type="checkbox" id="x-backoff"' + (ex.backoff ? ' checked' : '') + '></div>' +
      '<label>Notes</label><input id="x-notes" value="' + esc(ex.notes) + '">' +
      '<label>Tutorial video URL (blank = YouTube search)</label><input id="x-video" inputmode="url" placeholder="https://youtu.be/…" value="' + esc(custom) + '">' +
      '<div class="row" style="margin-top:14px"><button class="primary grow" id="x-save">Save</button><button id="x-cancel">Cancel</button></div>' +
      (isNew ? '' : '<button class="danger full" style="margin-top:8px" id="x-del">Delete exercise</button>') +
      '<p class="small dim">Tip: renaming an exercise starts a fresh history for it.</p>', function (m) {
        $('#x-cancel', m).onclick = closeModal;
        var del = $('#x-del', m); if (del) del.onclick = function () { if (confirm('Delete ' + ex.name + ' from this day?')) { days()[di].exercises.splice(ei, 1); save(); closeModal(); render(); } };
        $('#x-save', m).onclick = function () {
          var name = $('#x-name', m).value.trim(); if (!name) { toast('Give it a name.'); return; }
          var rmin = Math.max(1, parseInt($('#x-rmin', m).value, 10) || 1), rmax = Math.max(rmin, parseInt($('#x-rmax', m).value, 10) || rmin);
          var o = { name: name, sets: Math.max(1, parseInt($('#x-sets', m).value, 10) || 3), repMin: rmin, repMax: rmax, weight: Math.max(0, num($('#x-w', m).value)), type: $('#x-type', m).value, muscle: $('#x-muscle', m).value.trim(), rest: parseInt($('#x-rest', m).value, 10) || 0, backoff: $('#x-backoff', m).checked, notes: $('#x-notes', m).value.trim() };
          var vid = $('#x-video', m).value.trim();
          if (vid && !/^https?:\/\//i.test(vid)) vid = 'https://' + vid;
          if (vid) { try { new URL(vid); } catch (e) { toast('That video link doesn’t look valid.'); return; } }
          if (!isNew && o.weight !== ex.weight) { o.blockStart = o.weight; o.nextReps = null; }
          if (isNew) { o.blockStart = o.weight; ex = Object.assign(ex, o); days()[di].exercises.push(ex); } else Object.assign(ex, o);
          setVideo(name, vid); save(); closeModal(); render();
        };
      });
  }
  function setVideo(name, url) { var k = L.normName(name); if (url) state.videos[k] = url; else delete state.videos[k]; }
  function editVideoModal(name) {
    openModal('<h2>Tutorial video</h2><div class="dim small">' + esc(name) + '</div><label>Video URL (YouTube or any link)</label><input id="v-url" inputmode="url" placeholder="https://youtu.be/…" value="' + esc(state.videos[L.normName(name)] || '') + '">' +
      '<p class="small dim">Leave blank to use the default YouTube search: <br>' + esc(L.youtubeSearchUrl(name)) + '</p>' +
      '<div class="row"><button class="primary grow" id="v-save">Save</button><button id="v-cancel">Cancel</button></div>', function (m) {
        $('#v-cancel', m).onclick = closeModal;
        $('#v-save', m).onclick = function () {
          var vid = $('#v-url', m).value.trim(); if (vid && !/^https?:\/\//i.test(vid)) vid = 'https://' + vid;
          if (vid) { try { new URL(vid); } catch (e) { toast('That link doesn’t look valid.'); return; } }
          setVideo(name, vid); ui.openVideo[L.normName(name)] = false; save(); closeModal(); render(); toast(vid ? 'Video link saved' : 'Reset to YouTube search');
        };
      });
  }
  function doImport(mode) {
    var text = $('#importtext').value, r = L.parseProgram(text);
    if (!r.days.length) { toast(r.errors[0] || 'Nothing to import.'); return; }
    if (mode === 'replace' && days().length && !confirm('Replace your current programme with ' + r.days.length + ' imported day(s)? Your logged history is kept.')) return;
    r.days.forEach(function (d) { d.exercises.forEach(function (e) { if (e.video) { setVideo(e.name, e.video); } }); });
    if (mode === 'replace') { L.autoWeekdays(r.days); state.program.days = r.days; if (r.name) state.program.name = r.name; state.nextDayIdx = 0; }
    else state.program.days = state.program.days.concat(r.days);
    save(); $('#importtext').value = ''; render();
    toast('Imported ' + r.days.length + ' day(s)' + (r.errors.length ? ' – ' + r.errors.length + ' row(s) skipped' : ''));
  }

  function allExerciseNames() {
    var seen = {}, out = [];
    state.sessions.forEach(function (s) { s.exercises.forEach(function (e) { var k = L.normName(e.name); if (!seen[k]) { seen[k] = 1; out.push(e.name); } }); });
    return out.sort(function (a, b) { return a.localeCompare(b); });
  }
  var chartData = null;
  function progressHTML() {
    var names = allExerciseNames();
    if (!names.length) { return '<div class="card"><h2>Progress</h2><p class="dim">Log and finish a workout to see your 1RM estimates, trends and charts here.</p></div>'; }
    if (!ui.progEx || names.map(L.normName).indexOf(L.normName(ui.progEx)) < 0) ui.progEx = names[0];
    var name = ui.progEx, hist = historyFor(name), meta = metaFor(name);
    var pts = hist.map(function (h) { return L.sessionE1RM(h.sets); });
    var bestIdx = 0; pts.forEach(function (p, i) { if (p.epley > pts[bestIdx].epley) bestIdx = i; });
    var tr = L.trend(pts.map(function (p) { return p.epley; }));
    var h = '<div class="card"><label style="margin-top:0">Exercise</label><select id="progsel">' + names.map(function (n) { return '<option' + (n === name ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select>' +
      '<div class="stat"><div><b>' + L.round1(pts[bestIdx].epley) + '</b><span>Best e1RM (Epley) kg</span></div><div><b>' + L.round1(pts[bestIdx].brzycki) + '</b><span>Brzycki kg</span></div>' +
      '<div><b class="' + (tr == null ? 'dim' : tr >= 0 ? 'acc' : 'bad') + '">' + (tr == null ? '–' : (tr >= 0 ? '+' : '') + L.round1(tr) + '%') + '</b><span>Trend (last 6)</span></div></div>' +
      '<div class="small dim">Best came from ' + L.fmt(pts[bestIdx].w) + 'kg × ' + pts[bestIdx].r + ' on ' + fmtDate(hist[bestIdx].date) + '. Latest e1RM: ' + L.round1(pts[pts.length - 1].epley) + 'kg.</div></div>';
    h += '<div class="card"><h3>Estimated 1RM over time</h3><canvas class="chart" id="chart"></canvas><div class="row small dim" style="margin-top:6px"><span style="color:var(--acc)">● Epley</span><span style="color:var(--blue)">● Brzycki</span><span style="color:var(--warn)">● Top weight</span></div></div>';
    h += '<div class="card"><h3>Coach</h3>' + coachHTML(name, meta) + '<a class="btn sm" href="' + esc(videoUrl(name)) + '" target="_blank" rel="noopener">▶ Tutorial video</a></div>';
    h += '<div class="card"><h3>History</h3>' + hist.slice().reverse().map(function (x) {
      var b = L.sessionE1RM(x.sets);
      return '<div class="hist"><b>' + fmtDate(x.date) + '</b> <span class="dim small">' + wkTxt(x.week) + ' · ' + esc(shortDay(x.dayName)) + '</span><div>' + esc(fmtSets(x.sets)) + '</div><div class="dim small">e1RM ' + L.round1(b.epley) + ' / ' + L.round1(b.brzycki) + 'kg</div></div>';
    }).join('') + '</div>';
    chartData = { hist: hist, pts: pts }; afterRender = drawChart;
    return h;
  }
  function drawChart() {
    var cv = $('#chart'); if (!cv || !chartData) return;
    var dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    var c = cv.getContext('2d'); c.scale(dpr, dpr); c.clearRect(0, 0, W, H);
    var series = [
      { v: chartData.pts.map(function (p) { return p.epley; }), col: '#3ddc84', w: 3 },
      { v: chartData.pts.map(function (p) { return p.brzycki; }), col: '#6cb6ff', w: 2, dash: [5, 4] },
      { v: chartData.hist.map(function (h) { return Math.max.apply(null, h.sets.map(function (s) { return s.w; })); }), col: '#ffb84d', w: 2, dash: [2, 4] }
    ];
    var all = [].concat.apply([], series.map(function (s) { return s.v; }));
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
    if (hi - lo < 1) { hi += 2; lo -= 2; } var pad = (hi - lo) * 0.12; lo = Math.max(0, lo - pad); hi += pad;
    var L0 = 40, R0 = 12, T0 = 12, B0 = 26, n = chartData.pts.length;
    var X = function (i) { return n === 1 ? (L0 + (W - R0)) / 2 : L0 + (W - L0 - R0) * i / (n - 1); };
    var Y = function (val) { return T0 + (H - T0 - B0) * (1 - (val - lo) / (hi - lo)); };
    c.font = '11px sans-serif'; c.fillStyle = '#9aa3b2'; c.strokeStyle = '#2a2f3a'; c.lineWidth = 1; c.textAlign = 'right';
    for (var g = 0; g <= 3; g++) { var gv = lo + (hi - lo) * g / 3, gy = Y(gv); c.beginPath(); c.moveTo(L0, gy); c.lineTo(W - R0, gy); c.stroke(); c.fillText(Math.round(gv), L0 - 6, gy + 4); }
    c.textAlign = 'center';
    c.fillText(fmtDate(chartData.hist[0].date), X(0) + (n === 1 ? 0 : 14), H - 8);
    if (n > 1) c.fillText(fmtDate(chartData.hist[n - 1].date), X(n - 1) - 14, H - 8);
    series.forEach(function (s) {
      c.strokeStyle = s.col; c.fillStyle = s.col; c.lineWidth = s.w; c.setLineDash(s.dash || []); c.beginPath();
      s.v.forEach(function (val, i) { if (i) c.lineTo(X(i), Y(val)); else c.moveTo(X(i), Y(val)); }); c.stroke(); c.setLineDash([]);
      s.v.forEach(function (val, i) { c.beginPath(); c.arc(X(i), Y(val), s.w === 3 ? 4 : 2.5, 0, 7); c.fill(); });
    });
  }
  window.addEventListener('resize', function () { if (ui.tab === 'progress') drawChart(); });

  function exportJSON() { return JSON.stringify(Object.assign({}, state, { exportedAt: new Date().toISOString(), app: 'gym-tracker' }), null, 1); }
  function restoreFrom(text) {
    var d; try { d = JSON.parse(text); } catch (e) { toast('That isn’t valid JSON.'); return; }
    if (!d || !d.program || !Array.isArray(d.sessions)) { toast('That doesn’t look like a Gym Tracker backup.'); return; }
    if (!confirm('Replace ALL current data with this backup (' + d.sessions.length + ' sessions)?')) return;
    state = normalise(d); state.active = state.active || null; ui.stack = []; ui.progEx = null; save(); render(); toast('Backup restored ✔');
  }
  function editWeekModal() {
    var p0 = phase(), blk = p0.block, wk = p0.week, di = state.nextDayIdx;
    function body() {
      return '<h2>Block, week &amp; next day</h2>' +
        '<div class="row between"><span>Block</span><div class="row"><button class="iconbtn" id="bk-">−</button><b style="font-size:22px;min-width:30px;text-align:center" id="bk-n">' + blk + '</b><button class="iconbtn" id="bk+">+</button></div></div>' +
        '<div class="row between" style="margin-top:8px"><span>Week of block</span><div class="row"><button class="iconbtn" id="wk-">−</button><b style="font-size:22px;min-width:30px;text-align:center" id="wk-n">' + wk + '</b><button class="iconbtn" id="wk+">+</button></div></div>' +
        '<div class="dim small" style="margin-top:6px" id="wk-lbl">' + esc(L.phaseLabel({ block: blk, week: wk })) + (wk === L.PHASE_WEEKS ? ' – weights about 10% lighter, one set fewer' : '') + '</div>' +
        '<label>Next session</label><div class="chips">' + days().map(function (d, i) { return '<button class="ch' + (i === di ? ' on' : '') + '" data-di="' + i + '">' + esc(d.name) + '</button>'; }).join('') + '</div>' +
        '<p class="small dim">Moving into a new block raises starting weights (+2.5kg upper / +5kg lower, or your best working weight). Undo any of it from Profile → Coach change log.</p>' +
        '<div class="row" style="margin-top:12px"><button class="primary grow" id="wk-save">Save</button><button id="wk-cancel">Cancel</button></div>';
    }
    function mount(m) {
      function upd() { $('#bk-n', m).textContent = blk; $('#wk-n', m).textContent = wk; $('#wk-lbl', m).textContent = L.phaseLabel({ block: blk, week: wk }) + (wk === L.PHASE_WEEKS ? ' – weights about 10% lighter, one set fewer' : ''); }
      $('#bk-', m).onclick = function () { blk = Math.max(1, blk - 1); upd(); };
      $('#bk\\+', m).onclick = function () { blk++; upd(); };
      $('#wk-', m).onclick = function () { wk = Math.max(1, wk - 1); upd(); };
      $('#wk\\+', m).onclick = function () { wk = Math.min(L.PHASE_WEEKS, wk + 1); upd(); };
      [].forEach.call(m.querySelectorAll('[data-di]'), function (b) { b.onclick = function () { di = +b.dataset.di; [].forEach.call(m.querySelectorAll('[data-di]'), function (y) { y.classList.toggle('on', y === b); }); }; });
      $('#wk-cancel', m).onclick = closeModal;
      $('#wk-save', m).onclick = function () {
        var target = L.absWeek(blk, wk), r = null;
        if (target !== state.week) r = setWeek(target, 'manual');
        state.nextDayIdx = di; save(); closeModal(); render();
        if (r && r.newBlock) toast('Block ' + blk + ' started – ' + r.raised + ' starting weights raised');
      };
    }
    openModal(body(), mount);
  }


  /* ============ main render + events ============ */
  function top() { return ui.stack[ui.stack.length - 1]; }
  function render() {
    var v = $('#view'), y = window.scrollY, t = top();
    afterRender = null;
    [].forEach.call(document.querySelectorAll('#tabs button'), function (b) { b.classList.toggle('on', b.dataset.tab === ui.tab); });
    clampDay();
    var title, sub = '', html, cta = '';
    if (t && t.t === 'exercise') {
      var dd = days()[t.d], ex = dd && dd.exercises[t.e], a = state.active && state.active.dayIdx === t.d ? state.active : null;
      title = (a ? a.exercises[t.e] : ex) ? (a ? a.exercises[t.e].name : ex.name) : 'Exercise'; sub = dd ? dd.name : '';
      html = exerciseHTML(t.d, t.e);
      var n = a ? a.exercises.length : dd.exercises.length;
      if (a) cta = t.e < n - 1 ? '<button class="primary big" data-act="nextex">Next exercise ›</button>' : '<button class="primary big" data-act="finish">Finish workout</button>';
      else cta = '<button class="primary big" data-act="start" data-day="' + t.d + '">Start workout</button>';
    } else if (t && t.t === 'workout') {
      var d2 = days()[t.d]; title = d2 ? d2.name : 'Workout'; sub = esc(L.phaseLabel(phase())); html = workoutHTML(t.d);
      cta = state.active && state.active.dayIdx === t.d ? '<button class="primary big" data-act="finish">Finish workout</button>' : '<button class="primary big" data-act="start" data-day="' + t.d + '">Start workout</button>';
      if (!d2 || !d2.exercises.length) cta = '';
    } else {
      var T = { home: ['Home', ''], calendar: ['Calendar', esc(state.program.name)], workouts: ['Workouts', ''], progress: ['Progress', ''], profile: ['Profile', ''] }[ui.tab];
      title = T[0]; sub = days().length ? esc(L.phaseLabel(phase())) + (state.active ? ' · workout in progress' : '') : 'No programme yet';
      html = ui.tab === 'home' ? homeHTML() : ui.tab === 'calendar' ? calTabHTML() : ui.tab === 'workouts' ? workoutsHTML() : ui.tab === 'progress' ? progressHTML() : profileHTML();
      if (state.active && ui.tab !== 'home') cta = '<button class="primary big" data-act="openworkout" data-day="' + state.active.dayIdx + '">Resume workout</button>';
    }
    $('#title').textContent = title; $('#subtitle').innerHTML = sub;
    $('#back').hidden = !ui.stack.length;
    $('#hright').innerHTML = state.active ? '<button class="iconbtn ghost" data-act="restnow" aria-label="Rest timer">⏱</button>' : '';
    v.innerHTML = html;
    var c = $('#cta'); c.innerHTML = cta; c.hidden = !cta; document.body.classList.toggle('hascta', !!cta);
    if (afterRender) afterRender();
    window.scrollTo(0, y);
  }
  function go(tab) { ui.tab = tab; ui.stack = []; render(); window.scrollTo(0, 0); }
  function push(e) { ui.stack.push(e); render(); window.scrollTo(0, 0); }
  $('#tabs').addEventListener('click', function (e) { var b = e.target.closest('[data-tab]'); if (b) go(b.dataset.tab); });
  $('#back').addEventListener('click', function () { ui.stack.pop(); render(); window.scrollTo(0, 0); });
  window.addEventListener('resize', function () { if (ui.tab === 'progress' && !ui.stack.length) drawChart(); });

  function setVal(e, j, f, val) {
    var old = e.sets[j][f]; e.sets[j][f] = val;
    for (var k = j + 1; k < e.sets.length; k++) if (!e.sets[k].done && e.sets[k][f] === old) e.sets[k][f] = val;
  }
  function curEx() { var t = top(); return t && t.t === 'exercise' && state.active && state.active.dayIdx === t.d ? state.active.exercises[t.e] : null; }
  function exName() { var t = top(); if (t && t.t === 'exercise') { var e = curEx() || days()[t.d].exercises[t.e]; return e.name; } return ui.progEx; }

  document.addEventListener('click', function (ev) {
    var t = ev.target;
    var g = t.closest('[data-go]'); if (g) { ev.preventDefault(); if (g.dataset.ctab) ui.ctab = g.dataset.ctab; go(g.dataset.go); return; }
    var b = t.closest('[data-act]'); if (!b || t.closest('#modal') && !t.closest('#modal [data-act=closemodal], #modal [data-act=applycoach], #modal [data-act=undochange]')) return;
    var act = b.dataset.act, a = state.active, step = state.settings.step || 2.5;
    var row = b.closest('[data-s]'), j = row ? +row.dataset.s : -1;
    var dayEl = b.closest('[data-d]'), di = dayEl ? +dayEl.dataset.d : -1, exEl = b.closest('[data-e]'), ei = exEl ? +exEl.dataset.e : -1;
    switch (act) {
      case 'w-': case 'w+': case 'r-': case 'r+': {
        var e = curEx(), f = act[0], d = act[1] === '+' ? 1 : -1, cur = +e.sets[j][f] || 0;
        setVal(e, j, f, f === 'w' ? Math.max(0, Math.round((cur + d * step) * 100) / 100) : Math.max(0, cur + d)); save(); render(); break;
      }
      case 'prev': { var e3 = curEx(), h = historyFor(e3.name), l = h[h.length - 1], p = l.sets[Math.min(j, l.sets.length - 1)]; e3.sets[j].w = p.w; e3.sets[j].r = p.r; save(); render(); break; }
      case 'done': {
        var s = curEx().sets[j];
        if (!s.done && !(+s.r > 0)) { toast('Enter the reps first.'); break; }
        s.done = !s.done; save(); render();
        if (s.done && state.settings.restOn) startRest(curEx().rest || state.settings.restSecs);
        break;
      }
      case 'addset': { var ee = curEx(), ls = ee.sets[ee.sets.length - 1]; ee.sets.push({ w: ls ? ls.w : 0, r: ls ? ls.r : 8, done: false }); save(); render(); break; }
      case 'rmset': { var e2 = curEx(); if (e2.sets.length > 1) { e2.sets.pop(); save(); render(); } break; }
      case 'embed': { var k = L.normName(exName()); ui.openVideo[k] = !ui.openVideo[k]; render(); break; }
      case 'editvideo': editVideoModal(exName()); break;
      case 'restnow': startRest(state.settings.restSecs); break;
      case 'seldate': ui.selDate = +b.dataset.t; render(); break;
      case 'calsel': ui.selDate = +b.dataset.t; render(); break;
      case 'calprev': ui.calOff--; render(); break;
      case 'calnext': ui.calOff++; render(); break;
      case 'ctab': ui.ctab = b.dataset.v; render(); break;
      case 'openworkout': ui.tab = ui.tab; ui.stack = [{ t: 'workout', d: +b.dataset.day }]; render(); window.scrollTo(0, 0); break;
      case 'openex': push({ t: 'exercise', d: +b.dataset.day, e: +b.dataset.ex }); break;
      case 'nextex': { var tp = top(); ui.stack[ui.stack.length - 1] = { t: 'exercise', d: tp.d, e: tp.e + 1 }; render(); window.scrollTo(0, 0); break; }
      case 'toprogress': ui.progEx = exName(); go('progress'); break;
      case 'start': {
        if (state.active) { ui.stack = [{ t: 'workout', d: state.active.dayIdx }]; render(); toast('Resuming your workout in progress'); break; }
        startSession(+b.dataset.day); break;
      }
      case 'finish': {
        if (!sessionDoneCount(a)) { toast('Mark at least one set done first (tick ✓).'); break; }
        var unf = a.exercises.reduce(function (n, e) { return n + e.sets.filter(function (s) { return !s.done; }).length; }, 0);
        openModal('<h2>Finish workout?</h2>' + (unf ? '<p class="dim small">' + unf + ' unticked set(s) will be left out.</p>' : '') +
          '<label>How well recovered did you feel today? (helps the coach)</label><div class="chips"><button class="ch grow" data-rec="poor">😫 Poor</button><button class="ch grow on" data-rec="ok">🙂 OK</button><button class="ch grow" data-rec="good">💪 Good</button></div>' +
          '<div class="row" style="margin-top:14px"><button class="primary grow" id="fin-ok">Save workout</button><button id="fin-cancel">Back</button></div>', function (m) {
            var rec = 'ok';
            [].forEach.call(m.querySelectorAll('[data-rec]'), function (x) { x.onclick = function () { rec = x.dataset.rec; [].forEach.call(m.querySelectorAll('[data-rec]'), function (y) { y.classList.toggle('on', y === x); }); }; });
            $('#fin-cancel', m).onclick = closeModal;
            $('#fin-ok', m).onclick = function () { closeModal(); finishSession(rec); };
          });
        break;
      }
      case 'discard': if (confirm('Discard this workout? Nothing will be saved.')) { state.active = null; stopRest(); save(); ui.stack = []; render(); } break;
      case 'closemodal': closeModal(); break;
      case 'editweek': editWeekModal(); break;
      case 'togglehist': ui.openHist[b.dataset.sid] = !ui.openHist[b.dataset.sid]; render(); break;
      case 'delsession': if (confirm('Delete this session from your history?')) { state.sessions = state.sessions.filter(function (x) { return x.id !== b.dataset.sid; }); save(); render(); } break;
      case 'loadsample': loadSample(true); break;
      case 'loadmine': loadMine(true); break;
      case 'applycoach': {
        var pex = L.findExercise(days(), b.dataset.exid), ent = pex && L.applyForExercise(pex, state.sessions, 'manual', { calibrate: false, block: phase().block });
        if (ent) { logChanges([ent]); save(); refreshSummaryOrRender(); toast('Applied: ' + L.describeChange(ent)); } else toast('Already up to date.');
        if (!$('#modal').hidden) { /* keep summary open */ }
        break;
      }
      case 'undochange': {
        var ch = state.changes.filter(function (x) { return x.id === b.dataset.cid; })[0];
        if (ch && L.undoChange(ch, days())) { save(); toast('Undone: ' + ch.exName); refreshSummaryOrRender(); } break;
      }
      case 'import': doImport(b.dataset.mode); break;
      case 'exportcsv': download('my-program.csv', L.programToCSV(state.program), 'text/csv'); break;
      case 'dayup': case 'daydown': { var to = act === 'dayup' ? di - 1 : di + 1, arr = days(), tmp = arr[di]; arr[di] = arr[to]; arr[to] = tmp; save(); render(); break; }
      case 'daydel': if (confirm('Delete “' + days()[di].name + '” and its exercises? (Logged history is kept.)')) { days().splice(di, 1); clampDay(); save(); render(); } break;
      case 'dayadd': days().push({ id: L.newId('d'), name: 'Day ' + (days().length + 1), weekday: null, exercises: [] }); L.autoWeekdays(days()); save(); render(); break;
      case 'exup': case 'exdown': { var exs = days()[di].exercises, to2 = act === 'exup' ? ei - 1 : ei + 1, t2 = exs[ei]; exs[ei] = exs[to2]; exs[to2] = t2; save(); render(); break; }
      case 'exedit': editExerciseModal(di, ei); break;
      case 'exadd': editExerciseModal(di, null); break;
      case 'exportjson': download('gym-tracker-backup-' + new Date().toISOString().slice(0, 10) + '.json', exportJSON(), 'application/json'); state.lastBackup = Date.now(); save(); toast('Backup downloaded – check your Files/Downloads'); render(); break;
      case 'copyjson': (navigator.clipboard ? navigator.clipboard.writeText(exportJSON()) : Promise.reject()).then(function () { state.lastBackup = Date.now(); save(); toast('Copied – paste it into Notes/email'); render(); }, function () { toast('Copy failed – use Export instead.'); }); break;
      case 'sharejson': {
        var file; try { file = new File([exportJSON()], 'gym-tracker-backup.json', { type: 'application/json' }); } catch (e) { }
        if (file && navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file], title: 'Gym Tracker backup' }).then(function () { state.lastBackup = Date.now(); save(); render(); }, function () { });
        else toast('Sharing files isn’t supported here – use Export.');
        break;
      }
      case 'restorepaste': restoreFrom($('#restoretext').value); break;
      case 'wipe': if (confirm('Erase ALL programme and workout data from this phone? This cannot be undone.') && confirm('Really erase everything? Have you exported a backup?')) { localStorage.removeItem(KEY); state = defaults(); save(); ui.stack = []; loadMine(false); render(); toast('Erased'); } break;
    }
  });
  var view = $('#view');
  view.addEventListener('change', function (ev) {
    var t = ev.target, a = state.active;
    if (t.id === 'progsel') { ui.progEx = t.value; render(); return; }
    if (t.id === 'progname') { state.program.name = t.value.trim() || 'My programme'; save(); return; }
    if (t.dataset.set) { var k = t.dataset.set; state.settings[k] = t.type === 'checkbox' ? t.checked : k === 'name' ? t.value.trim() : (k === 'restSecs' ? parseInt(t.value, 10) : parseFloat(t.value)); save(); return; }
    if (t.dataset.f === 'dayname') { var d = days()[+t.closest('[data-d]').dataset.d]; d.name = t.value.trim() || d.name; save(); return; }
    if (t.dataset.f === 'dayweekday') { days()[+t.closest('[data-d]').dataset.d].weekday = +t.value; save(); return; }
    if (t.dataset.f === 'w' || t.dataset.f === 'r') {
      var e = curEx(), j = +t.closest('[data-s]').dataset.s, f = t.dataset.f;
      setVal(e, j, f, f === 'w' ? Math.max(0, num(t.value)) : Math.max(0, parseInt(t.value, 10) || 0)); save(); render(); return;
    }
    if (t.id === 'importfile' && t.files[0]) { readFile(t.files[0]).then(function (txt) { $('#importtext').value = txt; toast('File loaded – choose Replace or Add'); }); return; }
    if (t.id === 'restorefile' && t.files[0]) { readFile(t.files[0]).then(restoreFrom); return; }
  });
  view.addEventListener('focusin', function (ev) { if (ev.target.matches('.stepper input')) ev.target.select(); });

  /* ============ built-in programme ============ */
  function loadMine(confirmIt) {
    if (confirmIt && days().length && !confirm('Replace your current programme with “Alastair – Block 1”? Your logged history is kept.')) return;
    var pr = L.builtinAlastairBlock1();
    L.autoWeekdays(pr.days);
    pr.days.forEach(function (d) { d.exercises.forEach(function (e) { e.blockStart = e.weight; }); });
    state.program = { name: pr.name, days: pr.days }; state.nextDayIdx = 0; state.seeded = true;
    if (!state.sessions.length) { state.week = 1; state.phaseSince = Date.now(); }
    save(); render(); if (confirmIt) toast('Loaded Alastair – Block 1');
  }

  /* ============ sample ============ */
  function loadSample(confirmIt) {
    return fetch('sample-program.csv').then(function (r) { if (!r.ok) throw 0; return r.text(); }).then(function (txt) {
      if (confirmIt && days().length && !confirm('Replace your current programme with the sample 3-day full body?')) return;
      var r = L.parseProgram(txt); L.autoWeekdays(r.days); state.program = { name: 'Sample 3-day full body', days: r.days }; state.nextDayIdx = 0; state.seeded = true; save(); render();
      if (confirmIt) toast('Sample programme loaded');
    }).catch(function () { toast('Couldn’t load the sample (are you offline on first run?).'); });
  }

  /* ============ init ============ */
  render();
  if (!state.seeded && !days().length) loadMine(false);
  if (state.active) { /* resume */ }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () { });
  if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { }); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && rest) tickRest(); });
  window.__gym = { get state() { return state; }, L: L, render: render, normalise: normalise };
})();
