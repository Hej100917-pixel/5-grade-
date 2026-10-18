/*
 * 학점제 내신 내비게이터 — 계산 엔진
 * DOM에 의존하지 않는 순수 함수만 모아 둔 파일입니다. 브라우저에서는 window.Engine,
 * Node에서는 require('./engine.js')로 사용합니다.
 */
(function (root) {
  'use strict';

  // 9등급제 누적 비율 경계(%): 1등급 ~4, 2등급 ~11, ... 9등급 ~100
  const CUM9 = [0, 4, 11, 23, 40, 60, 77, 89, 96, 100];
  // 5등급제 누적 비율 경계(%): 1등급 ~10, 2등급 ~34, 3등급 ~66, 4등급 ~90, 5등급 ~100
  const CUM5 = [0, 10, 34, 66, 90, 100];

  const CATEGORIES = ['국어', '수학', '영어', '사회', '한국사', '과학', '정보', '제2외국어', '기타'];

  // 대학 입결의 '반영 기준'별 포함 교과
  const BASIS = {
    '전과목': CATEGORIES.slice(),
    '국영수사과': ['국어', '수학', '영어', '사회', '한국사', '과학'],
    '국영수사': ['국어', '수학', '영어', '사회', '한국사'],
    '국영수과': ['국어', '수학', '영어', '과학'],
  };

  const SEMESTERS = ['1-1', '1-2', '2-1', '2-2', '3-1'];

  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

  function num(v) {
    if (v === '' || v === null || v === undefined) return NaN;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }

  function round(x, d) {
    const f = Math.pow(10, d === undefined ? 2 : d);
    return Math.round(x * f) / f;
  }

  // 표준정규분포 누적확률 Φ(z) (Abramowitz–Stegun 7.1.26, 오차 < 1.5e-7)
  function normCdf(z) {
    const x = Math.abs(z) / Math.SQRT2;
    const t = 1 / (1 + 0.3275911 * x);
    const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
    const erf = 1 - poly * Math.exp(-x * x);
    return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
  }

  // 상위 누적 백분위 P(%) → 소수점 9등급 (구간 내 선형 비례)
  // 예: P = 5.2 → 2등급 구간(4~11%) → 2 + (5.2 - 4) / 7 = 2.17
  function percentileToGrade9(P) {
    const p = clamp(P, 0, 100);
    for (let k = 1; k <= 9; k++) {
      if (p < CUM9[k] || k === 9) {
        const g = k + (p - CUM9[k - 1]) / (CUM9[k] - CUM9[k - 1]);
        return Math.min(g, 9.99);
      }
    }
    return 9.99;
  }

  // 소수점 9등급 → 상위 누적 백분위 P(%) (percentileToGrade9의 역함수)
  function grade9ToPercentile(g) {
    const x = clamp(g, 1, 9.99);
    const k = Math.floor(x);
    return CUM9[k - 1] + (x - k) * (CUM9[k] - CUM9[k - 1]);
  }

  // 상위 누적 백분위 → 정수 5등급
  function percentileToGrade5(P) {
    for (let k = 1; k <= 5; k++) if (P <= CUM5[k]) return k;
    return 5;
  }

  function band5(g5) { return [CUM5[g5 - 1], CUM5[g5]]; }

  /*
   * 과목 하나를 9등급제 환산값으로 변환합니다.
   * 트랙 A: 석차·수강자 수 → P = ((중간석차 - 0.5) / 수강자 수) × 100
   * 트랙 B: 원점수·평균·표준편차 → Z점수 → 정규분포 상위 비율, 5등급 구간 안으로 제한
   * 트랙 C: 5등급만 있음 → 해당 구간의 중간값 (신뢰도 낮음)
   */
  function convertSubject(s, opts) {
    const factor = opts && opts.factor > 0 ? opts.factor : 1;
    const out = { track: null, P: null, g9: null, g5calc: null, reliability: '', notes: [], Praw: null, g9raw: null };
    if (s.absoluteOnly) {
      out.track = '성취도';
      out.reliability = '-';
      out.notes.push('성취도만 기재 과목: 등급 평균에서 제외');
      return out;
    }
    const g5 = num(s.grade5);
    const hasG5 = g5 >= 1 && g5 <= 5 && Number.isInteger(g5);
    const n = num(s.total);
    const r = num(s.rank);
    const raw = num(s.raw), mean = num(s.mean), sd = num(s.sd);

    if (n > 0 && r >= 1 && r <= n) {
      const ties = Math.max(1, num(s.ties) || 1);
      const mid = Math.min(r + (ties - 1) / 2, n);
      out.P = (mid - 0.5) / n * 100;
      out.track = 'A';
      out.reliability = n < 20 ? '낮음' : n < 50 ? '보통' : '높음';
      if (n < 20) out.notes.push('수강자 20명 미만: 석차 1등 차이가 크게 반영됨');
    } else if (Number.isFinite(raw) && Number.isFinite(mean) && sd > 0) {
      const z = (raw - mean) / sd;
      let P = (1 - normCdf(z)) * 100;
      if (hasG5) {
        const [lo, hi] = band5(g5);
        P = clamp(P, lo, hi);
      }
      out.P = P;
      out.track = 'B';
      out.reliability = '추정';
      out.notes.push('Z점수 추정치: 원점수 분포가 정규분포와 다르면 오차가 큼');
    } else if (hasG5) {
      const [lo, hi] = band5(g5);
      out.P = (lo + hi) / 2;
      out.track = 'C';
      out.reliability = '낮음';
      out.notes.push('등급만 입력: 구간 중간값으로 계산');
    } else {
      return out;
    }

    out.Praw = out.P;
    out.g9raw = percentileToGrade9(out.P);
    out.g5calc = percentileToGrade5(out.P);
    if (out.track === 'A' && hasG5 && out.g5calc !== g5) {
      out.notes.push('입력한 5등급(' + g5 + ')과 석차로 계산한 등급(' + out.g5calc + ')이 다름: 입력값 확인');
    }
    // 학교 유형 보정: 일반고 기준 상위 % = 우리 학교 상위 % × 보정계수
    if (factor !== 1) out.P = clamp(out.P * factor, 0.01, 100);
    out.g9 = percentileToGrade9(out.P);
    return out;
  }

  /*
   * 자사고·특목고 성적을 일반고 기준으로 대략 바꾸는 보정계수 기본값.
   * 학생 수준이 높은 학교의 상위 X%는 일반고에서 그보다 위(상위 X × 계수 %)에 해당한다고 보는
   * 단순 가정이며, 실제 통계로 정한 값이 아닙니다. 화면에서 직접 바꿀 수 있습니다.
   */
  const SCHOOL_TYPES = {
    '일반고': 1,
    '자사고 (광역단위)': 0.75,
    '자사고 (전국단위)': 0.55,
    '외고·국제고': 0.6,
    '과학고·영재고': 0.45,
  };

  function yearOf(sem) { return Number(String(sem).charAt(0)) || 1; }

  function yearWeight(sem, yw) {
    const w = yw && yw[yearOf(sem) - 1];
    return Number.isFinite(w) && w > 0 ? w : 1;
  }

  /*
   * 입력 과목들로 현재 성적 프로필을 만듭니다.
   * byCat: 교과별 학점 합·평균 등급·평균 수강자 수
   * pastSems / futureSems: 성적이 있는 학기와 그 이후 남은 학기
   */
  function buildProfile(subjects, opts) {
    const rows = (subjects || []).map(function (s) {
      return Object.assign({}, s, { conv: convertSubject(s, opts), credits: num(s.credits) || 0 });
    });
    const graded = rows.filter(function (s) { return s.conv.g9 !== null && s.credits > 0; });

    const byCat = {};
    graded.forEach(function (s) {
      const c = s.category || '기타';
      if (!byCat[c]) byCat[c] = { credits: 0, sum: 0, nSum: 0, nCount: 0 };
      byCat[c].credits += s.credits;
      byCat[c].sum += s.credits * s.conv.g9;
      if (s.conv.track === 'A') { byCat[c].nSum += num(s.total); byCat[c].nCount += 1; }
    });
    let totalCredits = 0;
    Object.keys(byCat).forEach(function (c) {
      const b = byCat[c];
      b.avg = b.sum / b.credits;
      b.P = grade9ToPercentile(b.avg);
      b.avgN = b.nCount ? Math.round(b.nSum / b.nCount) : null;
      totalCredits += b.credits;
    });

    const semOverall = {};
    SEMESTERS.forEach(function (sem) {
      const list = graded.filter(function (s) { return s.semester === sem; });
      const w = list.reduce(function (a, s) { return a + s.credits; }, 0);
      if (w > 0) semOverall[sem] = list.reduce(function (a, s) { return a + s.credits * s.conv.g9; }, 0) / w;
    });
    const pastSems = SEMESTERS.filter(function (sem) { return semOverall[sem] !== undefined; });
    const lastIdx = pastSems.length ? SEMESTERS.indexOf(pastSems[pastSems.length - 1]) : -1;
    const futureSems = SEMESTERS.slice(lastIdx + 1);
    const semCredits = pastSems.length ? totalCredits / pastSems.length : 0;

    return {
      rows: rows, graded: graded, byCat: byCat, totalCredits: totalCredits,
      semOverall: semOverall, pastSems: pastSems, futureSems: futureSems,
      avgSemCredits: semCredits,
      overall: totalCredits ? Object.keys(byCat).reduce(function (a, c) { return a + byCat[c].sum; }, 0) / totalCredits : null,
    };
  }

  /*
   * 남은 학기 성적을 시나리오별로 예측합니다. 모든 계산은 교과 단위로 하고,
   * 교과별 학점 비중은 지금까지의 비중을 그대로 유지한다고 가정합니다.
   *  keep  : 현재 교과별 백분위 유지
   *  A     : 매 학기 교과별 백분위를 rate(%)만큼 줄임 (P × (1 - rate)^k)
   *  B     : 전공 관련 교과만 3-1까지 targetP(%) 이내로 단계적으로 진입, 나머지는 유지
   *  custom: 사용자가 정한 학기별 전체 등급에 맞춰 교과별 백분위를 같은 비율로 조정
   */
  function project(profile, opts) {
    const o = opts || {};
    const cats = Object.keys(profile.byCat);
    const futureSems = profile.futureSems;
    const m = futureSems.length;
    const rate = clamp((Number.isFinite(o.rate) ? o.rate : 15) / 100, 0, 0.9);
    const targetP = clamp(Number.isFinite(o.targetP) ? o.targetP : 4, 0.5, 100);
    const related = o.relatedCats || [];
    const semCredits = o.futureCredits > 0 ? o.futureCredits : profile.avgSemCredits;
    const P0 = profile.overall !== null ? grade9ToPercentile(profile.overall) : null;

    const future = {}, credits = {}, semOverall = {};
    futureSems.forEach(function (sem, i) {
      const k = i + 1;
      future[sem] = {}; credits[sem] = {};
      let w = 0, sum = 0;
      cats.forEach(function (c) {
        const b = profile.byCat[c];
        let P = b.P;
        if (o.scenario === 'A') {
          P = b.P * Math.pow(1 - rate, k);
        } else if (o.scenario === 'B') {
          if (related.indexOf(c) >= 0) {
            const goal = Math.min(b.P, targetP);
            P = b.P + (goal - b.P) * k / m;
          }
        } else if (o.scenario === 'custom') {
          const g = o.custom && Number.isFinite(o.custom[sem]) ? o.custom[sem] : profile.overall;
          if (P0 > 0) P = b.P * (grade9ToPercentile(g) / P0);
        }
        const g9 = percentileToGrade9(clamp(P, 0.05, 99.95));
        const cr = semCredits * (b.credits / profile.totalCredits);
        future[sem][c] = g9;
        credits[sem][c] = cr;
        w += cr; sum += cr * g9;
      });
      semOverall[sem] = w ? sum / w : null;
    });
    return { scenario: o.scenario || 'keep', future: future, credits: credits, semOverall: semOverall, futureSems: futureSems };
  }

  /*
   * 특정 교과 묶음의 평균을 계산합니다.
   * past: 입력한 성적만, projected: 입력 성적 + 시나리오 예측 성적
   * 학년 가중치(yw)는 [1학년, 2학년, 3학년] 순서이며 학점에 곱해집니다.
   */
  function groupAverage(profile, proj, cats, yw) {
    let pw = 0, ps = 0;
    profile.graded.forEach(function (s) {
      if (cats.indexOf(s.category || '기타') < 0) return;
      const w = s.credits * yearWeight(s.semester, yw);
      pw += w; ps += w * s.conv.g9;
    });
    let fw = 0, fs = 0;
    if (proj) {
      proj.futureSems.forEach(function (sem) {
        Object.keys(proj.future[sem]).forEach(function (c) {
          if (cats.indexOf(c) < 0) return;
          const w = proj.credits[sem][c] * yearWeight(sem, yw);
          fw += w; fs += w * proj.future[sem][c];
        });
      });
    }
    return {
      past: pw ? ps / pw : null,
      projected: (pw + fw) ? (ps + fs) / (pw + fw) : null,
      pastWeight: pw, pastSum: ps, futureWeight: fw,
    };
  }

  // 최근 3개년 입결을 최근 연도에 더 큰 가중치(기본 5:3:2)로 합칩니다.
  function aggregateCuts(cutsByYear, weights) {
    const ws = weights || [5, 3, 2];
    const years = Object.keys(cutsByYear || {}).sort(function (a, b) { return b - a; }).slice(0, ws.length);
    const out = {};
    ['c50', 'c70', 'cf', 'avg'].forEach(function (key) {
      let w = 0, s = 0;
      years.forEach(function (y, i) {
        const v = num(cutsByYear[y][key]);
        if (Number.isFinite(v)) { w += ws[i]; s += ws[i] * v; }
      });
      out[key] = w ? s / w : null;
    });
    out.years = years;
    return out;
  }

  /*
   * 학생부종합전형 보정치(등급 단위, 클수록 유리)
   *  trend: 학기별 성적 상승 기울기 × 0.5, 최대 0.15
   *  fit  : (전체 평균 - 전공 관련 교과 평균) × 0.5, 최대 0.15
   *         + 전공 관련 성취도 전용 과목의 A 비율 × 0.05
   *  합계 최대 0.3
   */
  function compBonus(semSeries, overall, relatedAvg, relatedAchievements) {
    let trend = 0;
    if (semSeries.length >= 2) {
      const slope = (semSeries[0] - semSeries[semSeries.length - 1]) / (semSeries.length - 1);
      trend = clamp(slope * 0.5, 0, 0.15);
    }
    let fit = 0;
    if (overall !== null && relatedAvg !== null) fit = clamp((overall - relatedAvg) * 0.5, 0, 0.15);
    const ach = relatedAchievements || [];
    if (ach.length) fit += 0.05 * ach.filter(function (a) { return a === 'A'; }).length / ach.length;
    const total = Math.min(trend + fit, 0.3);
    return { trend: trend, fit: fit, total: total };
  }

  /*
   * 판정에 쓸 기준선을 고릅니다. 대학마다 공개 지표가 달라서
   * 기준(ref)은 70% 컷 → 평균 → 50% 컷 순으로, 안정선(safe)은 50% 컷 → 평균 순으로 씁니다.
   * 평균만 공개된 경우 안정선은 평균보다 0.2등급 좋은 지점으로 잡습니다.
   */
  function pickRefs(cuts) {
    const has = function (k) { return cuts[k] !== null && cuts[k] !== undefined; };
    let ref = null, refKind = null;
    if (has('c70')) { ref = cuts.c70; refKind = '70%컷'; }
    else if (has('avg')) { ref = cuts.avg; refKind = '평균'; }
    else if (has('c50')) { ref = cuts.c50; refKind = '50%컷'; }
    let safe = null, safeKind = null;
    if (has('c50') && refKind !== '50%컷') { safe = cuts.c50; safeKind = '50%컷'; }
    else if (has('avg') && refKind === '70%컷') { safe = Math.min(cuts.avg, ref); safeKind = '평균'; }
    else if (ref !== null) { safe = ref - 0.2; safeKind = refKind + ' − 0.2'; }
    return { ref: ref, refKind: refKind, safe: safe, safeKind: safeKind };
  }

  /*
   * 지원 판정. 등급은 숫자가 작을수록 좋습니다.
   *  안정: 보정 등급 ≤ 안정선(50% 컷)
   *  적정: 안정선 < 보정 등급 ≤ 기준선(70% 컷)
   *  상향: 기준선 < 보정 등급 ≤ max(기준선 + margin, 추가합격 컷)
   *  위험: 그 밖
   */
  function judge(my, cuts, opts) {
    const o = opts || {};
    const bonus = o.bonus || 0;
    const margin = Number.isFinite(o.margin) ? o.margin : 0.5;
    const r = pickRefs(cuts);
    if (r.ref === null) return { verdict: '입결 없음', adj: null, diff70: null, refs: r };
    if (my === null) return { verdict: '성적 없음', adj: null, diff70: null, refs: r };
    const adj = my - bonus;
    // cf는 대학에 따라 추가합격 마감이 아니라 '등록자 최저'라 이상치가 섞입니다.
    // 상향 범위를 넓히는 데는 기준선 + 1.0등급까지만 씁니다.
    const cf = cuts.cf !== null && cuts.cf !== undefined ? Math.min(cuts.cf, r.ref + 1.0) : -Infinity;
    const upper = Math.max(r.ref + margin, cf);
    let verdict;
    if (adj <= r.safe) verdict = '안정';
    else if (adj <= r.ref) verdict = '적정';
    else if (adj <= upper) verdict = '상향';
    else verdict = '위험';
    return { verdict: verdict, adj: adj, diff70: my - r.ref, refs: r };
  }

  /*
   * 역산: 목표 컷(9등급 환산)에 도달하려면 남은 학기 평균이 얼마여야 하는지 계산합니다.
   * R = (목표 × (지금까지 가중치 + 남은 가중치) - 지금까지 합) ÷ 남은 가중치
   */
  function backtrack(group, target) {
    if (group.pastWeight === 0) return { status: 'noData' };
    if (group.futureWeight === 0) return { status: 'noFuture' };
    const R = (target * (group.pastWeight + group.futureWeight) - group.pastSum) / group.futureWeight;
    if (R < 1) return { status: 'impossible', required: R };
    if (R >= 9.99) return { status: 'met', required: R };
    return { status: 'ok', required: R, P: grade9ToPercentile(R) };
  }

  // CSV 텍스트 → 2차원 배열 (따옴표, 따옴표 안 쉼표·줄바꿈, 탭 구분 지원)
  function parseCsv(text) {
    const src = String(text || '').replace(/^﻿/, '');
    const firstLine = src.split(/\r?\n/)[0] || '';
    const sep = firstLine.indexOf('\t') >= 0 && firstLine.indexOf(',') < 0 ? '\t' : ',';
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (q) {
        if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') q = false;
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && src[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.some(function (c) { return c.trim() !== ''; })) rows.push(row);
        row = [];
      } else cell += ch;
    }
    row.push(cell);
    if (row.some(function (c) { return c.trim() !== ''; })) rows.push(row);
    return rows;
  }

  const CSV_COLUMNS = {
    univ: ['대학', '대학명', '대학교'],
    dept: ['학과', '모집단위', '학과명'],
    track: ['구분', '문이과', '계열구분'],
    field: ['계열'],
    type: ['전형유형', '유형', '전형구분'],
    admission: ['전형명', '전형'],
    basis: ['반영', '반영교과', '산출방식'],
    year: ['학년도', '연도'],
    c50: ['50%컷', '50%', 'c50'],
    c70: ['70%컷', '70%', 'c70'],
    cf: ['추합컷', '추가합격컷', '최저', 'cf'],
    avg: ['평균', 'avg'],
    source: ['출처', 'source', 'url'],
  };

  /*
   * CSV(대학어디가 등에서 정리한 표) → 입결 행 목록.
   * 한 줄 = 대학·학과·전형유형·학년도 하나. 같은 대학·학과·전형유형은 한 행으로 합칩니다.
   * 반환: { rows, errors }
   */
  function csvToRows(text) {
    const table = parseCsv(text);
    const errors = [];
    if (table.length < 2) return { rows: [], errors: ['머리글 줄과 데이터 줄이 필요합니다.'] };
    const head = table[0].map(function (h) { return h.trim().replace(/\s+/g, ''); });
    const idx = {};
    Object.keys(CSV_COLUMNS).forEach(function (k) {
      idx[k] = head.findIndex(function (h) { return CSV_COLUMNS[k].indexOf(h) >= 0; });
    });
    ['univ', 'dept', 'type', 'year'].forEach(function (k) {
      if (idx[k] < 0) errors.push('필수 열이 없습니다: ' + CSV_COLUMNS[k][0]);
    });
    if (errors.length) return { rows: [], errors: errors };
    const map = {};
    table.slice(1).forEach(function (r, i) {
      const get = function (k) { return idx[k] >= 0 ? String(r[idx[k]] || '').trim() : ''; };
      const univ = get('univ'), dept = get('dept'), year = get('year').replace(/[^0-9]/g, '');
      let type = get('type');
      if (type.indexOf('종합') >= 0) type = '종합'; else if (type.indexOf('교과') >= 0) type = '교과';
      if (!univ || !dept || !year || (type !== '종합' && type !== '교과')) {
        errors.push((i + 2) + '번째 줄: 대학·학과·전형유형(종합/교과)·학년도를 확인하세요.');
        return;
      }
      const key = univ + '|' + dept + '|' + type;
      if (!map[key]) {
        map[key] = {
          univ: univ, dept: dept, type: type,
          track: get('track') || null, field: get('field') || null,
          admission: get('admission') || null, basis: get('basis') || null,
          cuts: {}, sources: [], imported: true,
        };
      }
      const cut = {};
      ['c50', 'c70', 'cf', 'avg'].forEach(function (k) {
        const v = num(get(k));
        cut[k] = Number.isFinite(v) ? v : null;
      });
      map[key].cuts[year] = cut;
      const src = get('source');
      if (src) map[key].sources.push({ year: year, url: src, kind: 'user' });
    });
    return { rows: Object.keys(map).map(function (k) { return map[k]; }), errors: errors };
  }

  // 상위 P%에 들기 위한 최대 석차 (수강자 n명 기준)
  function rankForPercentile(P, n) {
    if (!(n > 0)) return null;
    return Math.max(1, Math.floor(P / 100 * n + 0.5));
  }

  const Engine = {
    CUM9: CUM9, CUM5: CUM5, CATEGORIES: CATEGORIES, BASIS: BASIS, SEMESTERS: SEMESTERS, SCHOOL_TYPES: SCHOOL_TYPES,
    clamp: clamp, num: num, round: round, normCdf: normCdf,
    percentileToGrade9: percentileToGrade9, grade9ToPercentile: grade9ToPercentile,
    percentileToGrade5: percentileToGrade5, band5: band5,
    convertSubject: convertSubject, buildProfile: buildProfile, project: project,
    groupAverage: groupAverage, aggregateCuts: aggregateCuts, compBonus: compBonus,
    pickRefs: pickRefs, judge: judge, parseCsv: parseCsv, csvToRows: csvToRows, backtrack: backtrack, rankForPercentile: rankForPercentile, yearOf: yearOf,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof window !== 'undefined' ? window : this);
