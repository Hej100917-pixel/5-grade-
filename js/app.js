/*
 * 학점제 내신 내비게이터 — 화면 처리
 * 계산은 모두 engine.js(Engine)에 있고, 이 파일은 입력·표·그래프만 다룹니다.
 */
(function () {
  'use strict';
  const E = window.Engine;
  const DATA = window.GRADEUP_DATA;
  const STORE_KEY = 'gradeup.v1';
  const SCENARIOS = ['keep', 'A', 'B', 'custom'];
  const SCEN_LABEL = { keep: '현재 유지', A: 'A 안정 상승', B: 'B 전공 집중', custom: '직접 조정' };
  const VERDICTS = ['안정', '적정', '상향', '위험'];
  const FIELDS = Object.keys(DATA.fields);

  // 예시 성적: 공학 계열 희망 1학년 (2022 개정 공통과목)
  const SAMPLE = [
    { semester: '1-1', name: '공통국어1', category: '국어', credits: 4, grade5: 2, rank: 52, ties: '', total: 248, raw: 84, mean: 66.3, sd: 16.2 },
    { semester: '1-1', name: '공통수학1', category: '수학', credits: 4, grade5: 1, rank: 19, ties: '', total: 248, raw: 92, mean: 58.4, sd: 21.5 },
    { semester: '1-1', name: '공통영어1', category: '영어', credits: 4, grade5: 2, rank: 41, ties: '', total: 248, raw: 87, mean: 69.0, sd: 15.8 },
    { semester: '1-1', name: '한국사1', category: '한국사', credits: 3, grade5: 2, rank: 70, ties: 3, total: 248, raw: 88, mean: 74.2, sd: 13.1 },
    { semester: '1-1', name: '통합사회1', category: '사회', credits: 4, grade5: 3, rank: 98, ties: '', total: 248, raw: 76, mean: 70.5, sd: 14.9 },
    { semester: '1-1', name: '통합과학1', category: '과학', credits: 4, grade5: 2, rank: 30, ties: '', total: 248, raw: 89, mean: 63.7, sd: 18.0 },
    { semester: '1-2', name: '공통국어2', category: '국어', credits: 4, grade5: 2, rank: 47, ties: '', total: 246, raw: 85, mean: 67.0, sd: 15.5 },
    { semester: '1-2', name: '공통수학2', category: '수학', credits: 4, grade5: 1, rank: 14, ties: '', total: 246, raw: 94, mean: 57.9, sd: 22.0 },
    { semester: '1-2', name: '공통영어2', category: '영어', credits: 4, grade5: 2, rank: '', ties: '', total: '', raw: 88, mean: 70.1, sd: 14.0 },
    { semester: '1-2', name: '한국사2', category: '한국사', credits: 3, grade5: 2, rank: 61, ties: '', total: 246, raw: 90, mean: 75.0, sd: 12.6 },
    { semester: '1-2', name: '통합사회2', category: '사회', credits: 4, grade5: 2, rank: 80, ties: '', total: 246, raw: 81, mean: 71.2, sd: 14.0 },
    { semester: '1-2', name: '통합과학2', category: '과학', credits: 4, grade5: 1, rank: 22, ties: '', total: 246, raw: 93, mean: 64.1, sd: 17.6 },
    { semester: '1-2', name: '정보', category: '정보', credits: 2, grade5: 1, rank: 9, ties: '', total: 120, raw: 95, mean: 72.4, sd: 14.3 },
    { semester: '1-2', name: '음악', category: '기타', credits: 2, absoluteOnly: true, achievement: 'A' },
  ];

  let seq = 0;
  function newId() { seq += 1; return 's' + Date.now().toString(36) + seq; }
  function blankSubject(sem) {
    return { id: newId(), semester: sem || '1-1', name: '', category: '국어', credits: 4, grade5: '', rank: '', ties: '', total: '', raw: '', mean: '', sd: '', absoluteOnly: false, achievement: '' };
  }
  function sampleSubjects() {
    return SAMPLE.map(function (s) { return Object.assign(blankSubject(), s, { id: newId() }); });
  }

  function defaults() {
    return {
      mode: '종합', field: '공학', related: DATA.fields['공학'].slice(),
      subjects: sampleSubjects(), sample: true,
      sim: { scenario: 'A', rate: 15, targetP: 4, futureCredits: '', expectedN: '', yw: [1, 1, 1], custom: {} },
      margin: 0.5, filter: { verdict: '전체', field: '전체', q: '' },
      selected: null, goal: 'c70', targetSem: '',
    };
  }

  function load() {
    const d = defaults();
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) return d;
      const s = JSON.parse(raw);
      return Object.assign(d, s, {
        sim: Object.assign(d.sim, s.sim || {}),
        filter: Object.assign(d.filter, s.filter || {}),
      });
    } catch (e) { return d; }
  }
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { window.localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* 저장 불가 환경 */ }
    }, 250);
  }

  const state = load();
  const $ = function (sel) { return document.querySelector(sel); };
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function f2(x) { return x === null || x === undefined || !Number.isFinite(x) ? '–' : x.toFixed(2); }
  function f1(x) { return x === null || x === undefined || !Number.isFinite(x) ? '–' : x.toFixed(1); }

  function relatedFor(field) {
    return field === state.field ? state.related : (DATA.fields[field] || []);
  }

  // ───────────── 계산 ─────────────
  function compute() {
    const profile = E.buildProfile(state.subjects);
    const sim = state.sim;
    const yw = sim.yw.map(function (v) { const n = E.num(v); return n >= 0 ? n : 1; });
    const base = {
      relatedCats: state.related,
      rate: E.num(sim.rate), targetP: E.num(sim.targetP),
      futureCredits: E.num(sim.futureCredits) > 0 ? E.num(sim.futureCredits) : 0,
    };
    const projs = {};
    projs.keep = E.project(profile, Object.assign({}, base, { scenario: 'keep' }));
    projs.A = E.project(profile, Object.assign({}, base, { scenario: 'A' }));
    projs.B = E.project(profile, Object.assign({}, base, { scenario: 'B' }));
    const custom = {};
    profile.futureSems.forEach(function (sem) {
      const v = E.num(sim.custom[sem]);
      custom[sem] = Number.isFinite(v) ? E.clamp(v, 1, 9.5) : E.round(projs.A.semOverall[sem] || profile.overall || 3, 2);
    });
    projs.custom = E.project(profile, Object.assign({}, base, { scenario: 'custom', custom: custom }));
    const active = projs[sim.scenario] || projs.keep;

    const groupCache = {};
    function group(cats, key) {
      if (!groupCache[key]) groupCache[key] = E.groupAverage(profile, active, cats, yw);
      return groupCache[key];
    }
    const groups = {};
    Object.keys(E.BASIS).forEach(function (k) { groups[k] = group(E.BASIS[k], 'b:' + k); });
    groups.related = group(state.related, 'f:' + state.field);

    const semSeries = profile.pastSems.map(function (s) { return profile.semOverall[s]; })
      .concat(active.futureSems.map(function (s) { return active.semOverall[s]; }));

    const rows = DATA.universities.filter(function (u) { return u.type === state.mode; }).map(function (u) {
      const cuts = E.aggregateCuts(u.cuts, [5, 3, 2]);
      const g = groups[u.basis] || groups['전과목'];
      const my = g.projected;
      let bonus = { trend: 0, fit: 0, total: 0 };
      if (state.mode === '종합' && my !== null) {
        const rel = relatedFor(u.field);
        const relAvg = group(rel, 'f:' + u.field).projected;
        const ach = state.subjects.filter(function (s) {
          return s.absoluteOnly && s.achievement && rel.indexOf(s.category) >= 0;
        }).map(function (s) { return s.achievement; });
        bonus = E.compBonus(semSeries, groups['전과목'].projected, relAvg, ach);
      }
      const j = E.judge(my, cuts, { bonus: bonus.total, margin: E.num(state.margin) >= 0 ? E.num(state.margin) : 0.5 });
      return {
        u: u, cuts: cuts, my: my, bonus: bonus, verdict: j.verdict, adj: j.adj, diff70: j.diff70,
        key: u.univ + '|' + u.dept + '|' + u.type, group: g,
      };
    });
    const order = { '안정': 0, '적정': 1, '상향': 2, '위험': 3, '정보 부족': 4 };
    rows.sort(function (a, b) {
      return (order[a.verdict] - order[b.verdict]) || ((a.cuts.c70 || 9) - (b.cuts.c70 || 9));
    });

    return { profile: profile, projs: projs, active: active, custom: custom, groups: groups, rows: rows, yw: yw, semSeries: semSeries };
  }

  // ───────────── Step 1: 과목 입력 ─────────────
  function opt(v, label, cur) {
    return '<option value="' + esc(v) + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + esc(label) + '</option>';
  }
  function numInput(s, k, attrs) {
    const dis = s.absoluteOnly ? ' disabled' : '';
    return '<input type="number" id="' + s.id + '-' + k + '" data-k="' + k + '" value="' + esc(s[k]) + '"' + (attrs || '') + dis + ' aria-label="' + k + '">';
  }
  function renderSubjects() {
    const body = $('#subjectBody');
    if (!state.subjects.length) {
      body.innerHTML = '<tr><td colspan="17" class="empty">과목이 없습니다. "과목 추가"를 눌러 성적을 입력하세요.</td></tr>';
      return;
    }
    body.innerHTML = state.subjects.map(function (s) {
      const dis = s.absoluteOnly ? ' disabled' : '';
      return '<tr data-id="' + s.id + '">' +
        '<td><select id="' + s.id + '-semester" data-k="semester" aria-label="학기">' + E.SEMESTERS.map(function (x) { return opt(x, x, s.semester); }).join('') + '</select></td>' +
        '<td><input type="text" id="' + s.id + '-name" data-k="name" value="' + esc(s.name) + '" placeholder="과목명" aria-label="과목명"></td>' +
        '<td><select id="' + s.id + '-category" data-k="category" aria-label="교과">' + E.CATEGORIES.map(function (x) { return opt(x, x, s.category); }).join('') + '</select></td>' +
        '<td>' + numInput(Object.assign({}, s, { absoluteOnly: false }), 'credits', ' min="0" step="1"') + '</td>' +
        '<td><select id="' + s.id + '-grade5" data-k="grade5" aria-label="5등급"' + dis + '>' + opt('', '–', s.grade5) + [1, 2, 3, 4, 5].map(function (x) { return opt(x, x, s.grade5); }).join('') + '</select></td>' +
        '<td>' + numInput(s, 'rank', ' min="1" step="1"') + '</td>' +
        '<td>' + numInput(s, 'ties', ' min="1" step="1" placeholder="1"') + '</td>' +
        '<td>' + numInput(s, 'total', ' min="1" step="1"') + '</td>' +
        '<td>' + numInput(s, 'raw', ' step="0.1"') + '</td>' +
        '<td>' + numInput(s, 'mean', ' step="0.1"') + '</td>' +
        '<td>' + numInput(s, 'sd', ' min="0" step="0.1"') + '</td>' +
        '<td><select id="' + s.id + '-achievement" data-k="achievement" aria-label="성취도">' + opt('', '–', s.achievement) + ['A', 'B', 'C', 'D', 'E'].map(function (x) { return opt(x, x, s.achievement); }).join('') + '</select></td>' +
        '<td><input type="checkbox" id="' + s.id + '-absoluteOnly" data-k="absoluteOnly"' + (s.absoluteOnly ? ' checked' : '') + ' aria-label="성취도만 기재"></td>' +
        '<td class="res n" data-r="P"></td><td class="res n" data-r="g9"></td><td class="res" data-r="why"></td>' +
        '<td><button type="button" class="del" data-del="' + s.id + '" aria-label="과목 삭제">×</button></td>' +
        '</tr>';
    }).join('');
  }

  function updateSubjectResults(c) {
    const byId = {};
    c.profile.rows.forEach(function (r) { byId[r.id] = r; });
    document.querySelectorAll('#subjectBody tr[data-id]').forEach(function (tr) {
      const r = byId[tr.getAttribute('data-id')];
      if (!r) return;
      const cv = r.conv;
      tr.querySelector('[data-r="P"]').textContent = cv.P === null ? '–' : cv.P.toFixed(1) + '%';
      tr.querySelector('[data-r="g9"]').innerHTML = cv.g9 === null ? '–' : '<span class="g9">' + cv.g9.toFixed(2) + '</span>';
      const warn = cv.notes.some(function (n) { return n.indexOf('다름') >= 0; });
      tr.querySelector('[data-r="why"]').innerHTML = cv.track
        ? '<span class="track">' + esc(cv.track === 'A' || cv.track === 'B' || cv.track === 'C' ? '트랙 ' + cv.track : cv.track) + '</span>' +
          '<span class="num">신뢰도 ' + esc(cv.reliability) + '</span>' +
          (cv.notes.length ? '<span class="notes' + (warn ? ' warn' : '') + '">' + esc(cv.notes.join(' · ')) + '</span>' : '')
        : '<span class="notes">석차·수강자 수, 또는 원점수·평균·표준편차, 또는 5등급을 입력하세요</span>';
    });
    $('#sampleTag').hidden = !state.sample;
  }

  function renderSummary(c) {
    const items = [
      ['전과목', c.groups['전과목']],
      ['국영수사과', c.groups['국영수사과']],
      ['국영수사 (인문)', c.groups['국영수사']],
      ['국영수과 (자연)', c.groups['국영수과']],
      ['전공 관련 · ' + state.field, c.groups.related, true],
    ];
    $('#summary').innerHTML = items.map(function (it) {
      const g = it[1];
      const P = g.past !== null ? E.grade9ToPercentile(g.past) : null;
      let proj = '';
      if (g.past !== null && g.projected !== null && c.profile.futureSems.length) {
        const d = g.projected - g.past;
        proj = '<span class="meta">' + SCEN_LABEL[state.sim.scenario] + ' → <span class="' + (d < -0.005 ? 'arrow-good' : d > 0.005 ? 'arrow-bad' : '') + '">' + f2(g.projected) + '</span></span>';
      }
      return '<div class="tile' + (it[2] ? ' related-tile' : '') + '">' +
        '<span class="label">' + esc(it[0]) + '</span>' +
        '<span class="value">' + f2(g.past) + '<small> 등급</small></span>' +
        '<span class="meta">' + (P === null ? '입력 없음' : '상위 약 ' + f1(P) + '% · 5등급제 ' + E.percentileToGrade5(P) + '등급') + '</span>' +
        proj + '</div>';
    }).join('');
  }

  function renderRelated() {
    $('#relatedField').textContent = '· ' + state.field;
    $('#relatedChips').innerHTML = E.CATEGORIES.map(function (cat) {
      const on = state.related.indexOf(cat) >= 0;
      return '<button type="button" class="chip" data-cat="' + esc(cat) + '" aria-pressed="' + on + '">' + esc(cat) + '</button>';
    }).join('');
  }

  // ───────────── Step 2: 시뮬레이터 ─────────────
  const CH = { W: 640, H: 300, l: 52, r: 24, t: 18, b: 38 };
  let drag = null;
  let lastC = null;

  function renderChart(c) {
    const svg = $('#chart');
    const sems = E.SEMESTERS;
    const xi = function (i) { return CH.l + i * (CH.W - CH.l - CH.r) / (sems.length - 1); };
    const vals = [];
    c.profile.pastSems.forEach(function (s) { vals.push(c.profile.semOverall[s]); });
    SCENARIOS.forEach(function (k) { c.profile.futureSems.forEach(function (s) { vals.push(c.projs[k].semOverall[s]); }); });
    const sel = selectedRow(c);
    if (sel && sel.cuts.c70) vals.push(sel.cuts.c70);
    const yMax = drag ? drag.yMax : E.clamp(Math.ceil(Math.max.apply(null, vals.filter(Number.isFinite).concat([2])) + 0.4), 3, 9);
    const yv = function (g) { return CH.t + (g - 1) / (yMax - 1) * (CH.H - CH.t - CH.b); };
    let out = '';

    if (c.profile.futureSems.length) {
      const i0 = sems.indexOf(c.profile.futureSems[0]);
      const xStart = (i0 > 0 ? (xi(i0 - 1) + xi(i0)) / 2 : CH.l);
      out += '<rect class="future-band" x="' + xStart + '" y="' + CH.t + '" width="' + (CH.W - CH.r - xStart) + '" height="' + (CH.H - CH.t - CH.b) + '"></rect>';
      out += '<text x="' + (xStart + 6) + '" y="' + (CH.t + 12) + '">예측</text>';
    }
    for (let g = 1; g <= yMax; g++) {
      out += '<line class="gridline" x1="' + CH.l + '" x2="' + (CH.W - CH.r) + '" y1="' + yv(g) + '" y2="' + yv(g) + '"></line>';
      out += '<text x="' + (CH.l - 8) + '" y="' + (yv(g) + 4) + '" text-anchor="end">' + g + '등급</text>';
    }
    sems.forEach(function (s, i) {
      out += '<text x="' + xi(i) + '" y="' + (CH.H - 14) + '" text-anchor="middle">' + s + '</text>';
    });
    if (sel && sel.cuts.c70) {
      const y = yv(sel.cuts.c70);
      out += '<line class="target" x1="' + CH.l + '" x2="' + (CH.W - CH.r) + '" y1="' + y + '" y2="' + y + '"></line>';
      out += '<text class="target-label" x="' + (CH.W - CH.r) + '" y="' + (y - 5) + '" text-anchor="end">' + esc(sel.u.univ + ' 70%컷 ' + f2(sel.cuts.c70)) + '</text>';
    }

    const pastPts = c.profile.pastSems.map(function (s) { return [xi(sems.indexOf(s)), yv(c.profile.semOverall[s])]; });
    const anchor = pastPts.length ? pastPts[pastPts.length - 1] : null;
    const order = SCENARIOS.filter(function (k) { return k !== state.sim.scenario; }).concat([state.sim.scenario]);
    order.forEach(function (k) {
      const p = c.projs[k];
      const pts = (anchor ? [anchor] : []).concat(p.futureSems.map(function (s) { return [xi(sems.indexOf(s)), yv(p.semOverall[s])]; }));
      if (pts.length < 2) return;
      const active = k === state.sim.scenario;
      out += '<polyline class="scen' + (active ? ' active' : '') + '" points="' + pts.map(function (q) { return q.join(','); }).join(' ') + '"></polyline>';
      if (active) {
        p.futureSems.forEach(function (s) {
          const x = xi(sems.indexOf(s)), y = yv(p.semOverall[s]);
          if (k !== 'custom') out += '<circle class="dot" cx="' + x + '" cy="' + y + '" r="4"></circle>';
          out += '<text class="val" x="' + x + '" y="' + (y - 11) + '" text-anchor="middle">' + f2(p.semOverall[s]) + '</text>';
        });
      }
    });
    if (pastPts.length) {
      out += '<polyline class="past" points="' + pastPts.map(function (q) { return q.join(','); }).join(' ') + '"></polyline>';
      c.profile.pastSems.forEach(function (s, i) {
        out += '<circle class="past-dot" cx="' + pastPts[i][0] + '" cy="' + pastPts[i][1] + '" r="4.5"></circle>';
        out += '<text x="' + pastPts[i][0] + '" y="' + (pastPts[i][1] + 18) + '" text-anchor="middle">' + f2(c.profile.semOverall[s]) + '</text>';
      });
    }
    c.profile.futureSems.forEach(function (s) {
      const x = xi(sems.indexOf(s)), y = yv(c.projs.custom.semOverall[s]);
      out += '<circle class="handle' + (state.sim.scenario === 'custom' ? '' : ' idle') + '" data-sem="' + s + '" cx="' + x + '" cy="' + y + '" r="8"><title>끌어서 ' + s + ' 목표 등급 조정</title></circle>';
    });
    if (!pastPts.length) out += '<text x="' + (CH.W / 2) + '" y="' + (CH.H / 2) + '" text-anchor="middle">Step 1에 성적을 입력하면 곡선이 표시됩니다</text>';
    svg.innerHTML = out;
    svg.dataset.ymax = yMax;

    $('#legend').innerHTML = '<span class="lg-past">입력 성적 (학기 평균)</span>' +
      '<span class="lg-active">' + esc(SCEN_LABEL[state.sim.scenario]) + '</span>' +
      '<span>다른 시나리오</span>' + (sel ? '<span class="lg-target">선택한 대학 70%컷</span>' : '');
  }

  function renderCustomInputs(c) {
    const wrap = $('#customInputs');
    const sems = c.profile.futureSems;
    const sig = sems.join(',');
    if (wrap.dataset.sig !== sig) {
      wrap.dataset.sig = sig;
      wrap.innerHTML = sems.length
        ? '<span>직접 조정:</span>' + sems.map(function (s) {
          return '<label>' + s + ' <input type="number" id="cust-' + s + '" data-sem="' + s + '" min="1" max="9.5" step="0.05"></label>';
        }).join('') + '<button type="button" class="link" id="resetCustom">A 곡선으로 되돌리기</button>'
        : '<span>남은 학기가 없습니다 (3학년 1학기까지 모두 입력됨).</span>';
    }
    sems.forEach(function (s) {
      const inp = document.getElementById('cust-' + s);
      if (inp && document.activeElement !== inp) inp.value = c.custom[s].toFixed(2);
    });
  }

  function expectedN(c, cat) {
    const o = E.num(state.sim.expectedN);
    if (o > 0) return o;
    const b = c.profile.byCat[cat];
    return b && b.avgN ? b.avgN : null;
  }

  function renderNextTable(c) {
    const sel = $('#targetSem');
    const sems = c.profile.futureSems;
    if (sems.indexOf(state.targetSem) < 0) state.targetSem = sems[0] || '';
    sel.innerHTML = sems.map(function (s) { return opt(s, s, state.targetSem); }).join('');
    sel.disabled = !sems.length;
    const t = $('#nextTable');
    if (!sems.length || !Object.keys(c.profile.byCat).length) {
      t.innerHTML = '<tbody><tr><td class="empty">예측할 학기가 없거나 입력된 성적이 없습니다.</td></tr></tbody>';
      return;
    }
    const sem = state.targetSem;
    const p = c.active;
    const cats = E.CATEGORIES.filter(function (k) { return c.profile.byCat[k]; });
    t.innerHTML = '<thead><tr><th>교과</th><th class="n">현재 평균</th><th class="n">' + esc(sem) + ' 목표 등급</th><th class="n">목표 상위 %</th><th class="n">예상 수강자</th><th>목표 석차</th></tr></thead><tbody>' +
      cats.map(function (k) {
        const now = c.profile.byCat[k].avg;
        const g = p.future[sem][k];
        const P = E.grade9ToPercentile(g);
        const n = expectedN(c, k);
        const rank = E.rankForPercentile(P, n);
        const rel = state.related.indexOf(k) >= 0;
        return '<tr><td>' + esc(k) + (rel ? ' <span class="track">전공</span>' : '') + '</td>' +
          '<td class="n num">' + f2(now) + '</td>' +
          '<td class="n num">' + f2(g) + '</td>' +
          '<td class="n num">' + f1(P) + '%</td>' +
          '<td class="n num">' + (n ? n + '명' : '–') + '</td>' +
          '<td>' + (rank ? '<strong>' + n + '명 중 ' + rank + '등 이내</strong>' : '<span class="notes">수강자 수를 입력하면 계산됩니다</span>') + '</td></tr>';
      }).join('') + '</tbody>';
  }

  // ───────────── Step 3: 대학 리스트 ─────────────
  function selectedRow(c) {
    if (!state.selected) return null;
    return c.rows.filter(function (r) { return r.key === state.selected; })[0] || null;
  }

  function filteredRows(c) {
    const q = (state.filter.q || '').trim();
    return c.rows.filter(function (r) {
      if (state.filter.field !== '전체' && r.u.field !== state.filter.field) return false;
      if (q && (r.u.univ + ' ' + r.u.dept).indexOf(q) < 0) return false;
      return true;
    });
  }

  function renderUnivs(c) {
    const base = filteredRows(c);
    const counts = { '전체': base.length };
    VERDICTS.forEach(function (v) { counts[v] = base.filter(function (r) { return r.verdict === v; }).length; });
    $('#verdictChips').innerHTML = ['전체'].concat(VERDICTS).map(function (v) {
      return '<button type="button" class="chip" data-verdict="' + v + '" aria-pressed="' + (state.filter.verdict === v) + '">' + v + '<span class="count">' + counts[v] + '</span></button>';
    }).join('');

    const rows = base.filter(function (r) { return state.filter.verdict === '전체' || r.verdict === state.filter.verdict; });
    const comp = state.mode === '종합';
    $('#bonusHead').hidden = !comp;
    $('#univBody').innerHTML = rows.length ? rows.map(function (r) {
      const d = r.diff70;
      const dCls = d === null ? '' : d <= 0 ? 'diff-good' : 'diff-bad';
      const dTxt = d === null ? '–' : (d > 0 ? '+' : '') + d.toFixed(2) + (d <= 0 ? ' 여유' : ' 부족');
      const vCls = r.verdict === '정보 부족' ? 'v-정보' : 'v-' + r.verdict;
      return '<tr data-key="' + esc(r.key) + '" class="' + (r.key === state.selected ? 'sel' : '') + '" tabindex="0">' +
        '<td><span class="badge ' + vCls + '">' + esc(r.verdict) + '</span></td>' +
        '<td>' + esc(r.u.univ) + '</td><td>' + esc(r.u.dept) + '</td><td>' + esc(r.u.field) + '</td><td>' + esc(r.u.basis) + '</td>' +
        '<td class="n num">' + f2(r.cuts.c50) + '</td><td class="n num">' + f2(r.cuts.c70) + '</td><td class="n num">' + f2(r.cuts.cf) + '</td>' +
        '<td class="n num">' + f2(r.my) + '</td>' +
        '<td class="n num ' + dCls + '">' + dTxt + '</td>' +
        (comp ? '<td class="n num">' + (r.bonus.total > 0 ? '−' + r.bonus.total.toFixed(2) : '0.00') + '</td>' : '') +
        '</tr>';
    }).join('') : '<tr><td colspan="11" class="empty">조건에 맞는 대학이 없습니다.</td></tr>';
  }

  function renderDetail(c) {
    const box = $('#detail');
    const r = selectedRow(c);
    if (!r) { box.hidden = true; return; }
    box.hidden = false;
    const comp = state.mode === '종합';
    const goalCut = state.goal === 'c50' ? r.cuts.c50 : r.cuts.c70;
    const target = goalCut === null ? null : goalCut + (comp ? r.bonus.total : 0);
    const bt = target === null ? { status: 'noData' } : E.backtrack(r.group, target);
    const years = r.cuts.years;

    let btHtml;
    if (bt.status === 'ok') {
      const cats = E.BASIS[r.u.basis].filter(function (k) { return c.profile.byCat[k]; });
      btHtml = '<p>남은 ' + c.profile.futureSems.length + '학기 동안 <strong>' + esc(r.u.basis) + '</strong> 평균을 <span class="big">' + f2(bt.required) + '</span>등급 이내(상위 약 ' + f1(bt.P) + '%)로 유지해야 합니다.</p>' +
        '<div class="table-wrap"><table class="grid compact"><thead><tr><th>교과</th><th class="n">현재</th><th class="n">필요 등급</th><th>목표 석차</th></tr></thead><tbody>' +
        cats.map(function (k) {
          const n = expectedN(c, k);
          const rank = E.rankForPercentile(bt.P, n);
          return '<tr><td>' + esc(k) + '</td><td class="n num">' + f2(c.profile.byCat[k].avg) + '</td><td class="n num">' + f2(bt.required) + '</td><td>' + (rank ? n + '명 중 ' + rank + '등 이내' : '–') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    } else if (bt.status === 'impossible') {
      btHtml = '<p>남은 학기를 모두 1.00등급으로 받아도 도달하기 어렵습니다 (필요 평균 ' + f2(bt.required) + '등급).</p>';
    } else if (bt.status === 'met') {
      btHtml = '<p>남은 학기 성적과 관계없이 이미 기준을 충족합니다.</p>';
    } else if (bt.status === 'noFuture') {
      btHtml = '<p>남은 학기가 없어 역산할 수 없습니다.</p>';
    } else {
      btHtml = '<p>' + esc(r.u.basis) + ' 교과 성적이 입력되지 않았습니다.</p>';
    }

    box.innerHTML =
      '<div class="detail-head"><h3>' + esc(r.u.univ + ' ' + r.u.dept) + ' <span class="badge ' + (r.verdict === '정보 부족' ? 'v-정보' : 'v-' + r.verdict) + '">' + esc(r.verdict) + '</span></h3>' +
      '<button type="button" class="link" id="closeDetail">닫기</button></div>' +
      '<div class="detail-cols">' +
      '<div><h4>최근 3개년 입결 (학생부' + esc(r.u.type) + ', ' + esc(r.u.basis) + ')</h4>' +
      '<div class="table-wrap"><table class="grid compact"><thead><tr><th>학년도</th><th class="n">50%컷</th><th class="n">70%컷</th><th class="n">추합컷</th></tr></thead><tbody>' +
      years.map(function (y, i) {
        const v = r.u.cuts[y];
        return '<tr><td>' + y + ' <span class="notes" style="display:inline">×' + [5, 3, 2][i] + '</span></td><td class="n num">' + f2(v.c50) + '</td><td class="n num">' + f2(v.c70) + '</td><td class="n num">' + f2(v.cf) + '</td></tr>';
      }).join('') +
      '<tr><td><strong>가중 평균</strong></td><td class="n num"><strong>' + f2(r.cuts.c50) + '</strong></td><td class="n num"><strong>' + f2(r.cuts.c70) + '</strong></td><td class="n num"><strong>' + f2(r.cuts.cf) + '</strong></td></tr>' +
      '</tbody></table></div></div>' +
      '<div><h4>내 예상 성적 (' + esc(SCEN_LABEL[state.sim.scenario]) + ')</h4><dl class="kv">' +
      '<dt>지금까지 ' + esc(r.u.basis) + '</dt><dd>' + f2(r.group.past) + '</dd>' +
      '<dt>예상 최종</dt><dd>' + f2(r.my) + '</dd>' +
      (comp ? '<dt>상승세 보정</dt><dd>−' + r.bonus.trend.toFixed(2) + '</dd><dt>전공 적합 보정</dt><dd>−' + r.bonus.fit.toFixed(2) + '</dd><dt>보정 후</dt><dd>' + f2(r.adj) + '</dd>' : '') +
      '<dt>70%컷 대비</dt><dd>' + (r.diff70 === null ? '–' : (r.diff70 > 0 ? '+' : '') + r.diff70.toFixed(2)) + '</dd>' +
      '</dl></div>' +
      '<div><h4>목표 역산</h4>' +
      '<div class="seg" role="group" aria-label="목표 기준"><button type="button" data-goal="c50" aria-pressed="' + (state.goal === 'c50') + '">안정 (50%컷)</button><button type="button" data-goal="c70" aria-pressed="' + (state.goal === 'c70') + '">적정 (70%컷)</button></div>' +
      (comp && r.bonus.total > 0 ? '<p class="hint">종합 보정 ' + r.bonus.total.toFixed(2) + '을 반영한 목표: ' + f2(target) + '등급</p>' : '') +
      btHtml + '</div>' +
      '</div>';
  }

  // ───────────── 전체 갱신 ─────────────
  let rafId = null;
  function refresh() {
    const c = compute();
    lastC = c;
    updateSubjectResults(c);
    renderSummary(c);
    renderChart(c);
    renderCustomInputs(c);
    renderNextTable(c);
    renderUnivs(c);
    renderDetail(c);
    syncButtons();
    save();
  }
  function refreshSoon() {
    if (rafId) return;
    rafId = requestAnimationFrame(function () { rafId = null; refresh(); });
  }

  function syncButtons() {
    document.querySelectorAll('[data-mode]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)); });
    document.querySelectorAll('[data-scen]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.scen === state.sim.scenario)); });
  }

  // ───────────── 이벤트 ─────────────
  function bind() {
    document.querySelectorAll('[data-mode]').forEach(function (b) {
      b.addEventListener('click', function () { state.mode = b.dataset.mode; state.selected = null; refresh(); });
    });
    const fs = $('#fieldSelect');
    fs.innerHTML = FIELDS.map(function (f) { return opt(f, f, state.field); }).join('');
    fs.addEventListener('change', function () {
      state.field = fs.value;
      state.related = DATA.fields[state.field].slice();
      renderRelated();
      refresh();
    });
    const ff = $('#fieldFilter');
    ff.innerHTML = ['전체'].concat(FIELDS).map(function (f) { return opt(f, f, state.filter.field); }).join('');
    ff.addEventListener('change', function () { state.filter.field = ff.value; refresh(); });
    const sb = $('#searchBox');
    sb.value = state.filter.q;
    sb.addEventListener('input', function () { state.filter.q = sb.value; refresh(); });

    const body = $('#subjectBody');
    function onField(e) {
      const el = e.target;
      const k = el.dataset.k;
      const tr = el.closest('tr[data-id]');
      if (!k || !tr) return;
      const s = state.subjects.filter(function (x) { return x.id === tr.dataset.id; })[0];
      if (!s) return;
      s[k] = el.type === 'checkbox' ? el.checked : el.value;
      state.sample = false;
      if (k === 'absoluteOnly') renderSubjects();
      refreshSoon();
    }
    body.addEventListener('input', onField);
    body.addEventListener('change', onField);
    body.addEventListener('click', function (e) {
      const id = e.target.dataset && e.target.dataset.del;
      if (!id) return;
      state.subjects = state.subjects.filter(function (s) { return s.id !== id; });
      state.sample = false;
      renderSubjects();
      refresh();
    });

    $('#addRow').addEventListener('click', function () {
      const last = state.subjects[state.subjects.length - 1];
      const s = blankSubject(last ? last.semester : '1-1');
      if (last) s.total = last.total;
      state.subjects.push(s);
      renderSubjects();
      refresh();
      const inp = document.getElementById(s.id + '-name');
      if (inp) inp.focus();
    });
    $('#loadSample').addEventListener('click', function () {
      state.subjects = sampleSubjects();
      state.sample = true;
      renderSubjects();
      refresh();
    });
    // 브라우저 확인창 대신 두 번 눌러 삭제
    const clr = $('#clearAll');
    let armTimer = null;
    clr.addEventListener('click', function () {
      if (!clr.classList.contains('armed')) {
        clr.classList.add('armed');
        clr.textContent = '한 번 더 누르면 모두 지워집니다';
        armTimer = setTimeout(function () { clr.classList.remove('armed'); clr.textContent = '모두 지우기'; }, 3000);
        return;
      }
      clearTimeout(armTimer);
      clr.classList.remove('armed');
      clr.textContent = '모두 지우기';
      state.subjects = [];
      state.sample = false;
      state.sim.custom = {};
      renderSubjects();
      refresh();
    });

    $('#relatedChips').addEventListener('click', function (e) {
      const cat = e.target.closest('[data-cat]');
      if (!cat) return;
      const k = cat.dataset.cat;
      const i = state.related.indexOf(k);
      if (i >= 0) state.related.splice(i, 1); else state.related.push(k);
      renderRelated();
      refresh();
    });
    $('#resetRelated').addEventListener('click', function () {
      state.related = DATA.fields[state.field].slice();
      renderRelated();
      refresh();
    });

    document.querySelectorAll('[data-scen]').forEach(function (b) {
      b.addEventListener('click', function () { state.sim.scenario = b.dataset.scen; refresh(); });
    });
    function bindNum(id, get, set) {
      const el = document.getElementById(id);
      el.value = get();
      el.addEventListener('input', function () { set(el.value); refreshSoon(); });
    }
    bindNum('pRate', function () { return state.sim.rate; }, function (v) { state.sim.rate = v; });
    bindNum('pTarget', function () { return state.sim.targetP; }, function (v) { state.sim.targetP = v; });
    bindNum('pCredits', function () { return state.sim.futureCredits; }, function (v) { state.sim.futureCredits = v; });
    bindNum('pN', function () { return state.sim.expectedN; }, function (v) { state.sim.expectedN = v; });
    bindNum('pMargin', function () { return state.margin; }, function (v) { state.margin = v; });
    [0, 1, 2].forEach(function (i) {
      bindNum('yw' + (i + 1), function () { return state.sim.yw[i]; }, function (v) { state.sim.yw[i] = v; });
    });

    $('#customInputs').addEventListener('input', function (e) {
      const sem = e.target.dataset.sem;
      if (!sem) return;
      const v = E.num(e.target.value);
      if (!Number.isFinite(v)) return;
      state.sim.custom[sem] = E.clamp(v, 1, 9.5);
      state.sim.scenario = 'custom';
      refreshSoon();
    });
    $('#customInputs').addEventListener('click', function (e) {
      if (e.target.id !== 'resetCustom') return;
      state.sim.custom = {};
      state.sim.scenario = 'custom';
      refresh();
    });
    $('#targetSem').addEventListener('change', function (e) { state.targetSem = e.target.value; refresh(); });

    // 그래프 점 끌기
    const svg = $('#chart');
    function gradeAt(clientY) {
      const rect = svg.getBoundingClientRect();
      const y = (clientY - rect.top) * (CH.H / rect.height);
      const g = 1 + (y - CH.t) / (CH.H - CH.t - CH.b) * (drag.yMax - 1);
      return E.round(E.clamp(g, 1, Math.min(9.5, drag.yMax)), 2);
    }
    svg.addEventListener('pointerdown', function (e) {
      const sem = e.target.dataset && e.target.dataset.sem;
      if (!sem) return;
      e.preventDefault();
      drag = { sem: sem, yMax: Number(svg.dataset.ymax) || 9 };
      try { svg.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
      if (lastC) {
        lastC.profile.futureSems.forEach(function (s) { state.sim.custom[s] = lastC.custom[s]; });
      }
      state.sim.scenario = 'custom';
      state.sim.custom[sem] = gradeAt(e.clientY);
      refreshSoon();
    });
    svg.addEventListener('pointermove', function (e) {
      if (!drag) return;
      state.sim.custom[drag.sem] = gradeAt(e.clientY);
      refreshSoon();
    });
    function endDrag() { if (drag) { drag = null; refreshSoon(); } }
    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', endDrag);

    function pickRow(tr) {
      if (!tr) return;
      const key = tr.dataset.key;
      state.selected = state.selected === key ? null : key;
      refresh();
      if (state.selected) $('#detail').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    $('#univBody').addEventListener('click', function (e) { pickRow(e.target.closest('tr[data-key]')); });
    $('#univBody').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickRow(e.target.closest('tr[data-key]')); }
    });
    $('#verdictChips').addEventListener('click', function (e) {
      const b = e.target.closest('[data-verdict]');
      if (!b) return;
      state.filter.verdict = b.dataset.verdict;
      refresh();
    });
    $('#detail').addEventListener('click', function (e) {
      if (e.target.id === 'closeDetail') { state.selected = null; refresh(); return; }
      const g = e.target.closest('[data-goal]');
      if (g) { state.goal = g.dataset.goal; refresh(); }
    });
  }

  $('#sampleNotice').hidden = !DATA.isSample;
  bind();
  renderSubjects();
  renderRelated();
  refresh();
})();
