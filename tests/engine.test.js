// 실행: node tests/engine.test.js
const assert = require('assert');
const E = require('../js/engine.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log('ok - ' + name);
}
const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= (eps || 0.01), a + ' != ' + b);

test('상위 5.2%는 9등급제 약 2.17등급', () => near(E.percentileToGrade9(5.2), 2.17));
test('구간 경계: 4% → 2.00, 0% → 1.00', () => {
  near(E.percentileToGrade9(4), 2.0);
  near(E.percentileToGrade9(0), 1.0);
});
test('등급↔백분위 역변환', () => {
  [1.3, 2.17, 3.5, 5.99, 8.2].forEach((g) => near(E.percentileToGrade9(E.grade9ToPercentile(g)), g, 1e-9));
});
test('5등급 경계 (10/34/66/90%)', () => {
  assert.strictEqual(E.percentileToGrade5(10), 1);
  assert.strictEqual(E.percentileToGrade5(10.1), 2);
  assert.strictEqual(E.percentileToGrade5(66), 3);
  assert.strictEqual(E.percentileToGrade5(95), 5);
});
test('정규분포 누적확률', () => {
  near(E.normCdf(0), 0.5, 1e-6);
  near(E.normCdf(1.96), 0.975, 1e-3);
  near(E.normCdf(-1), 0.1587, 1e-3);
});
test('트랙 A: 석차 13 / 250명', () => {
  const c = E.convertSubject({ grade5: 1, rank: 13, total: 250 });
  assert.strictEqual(c.track, 'A');
  near(c.P, 5.0);
  near(c.g9, 2.14);
});
test('트랙 A: 동석차는 중간석차 사용', () => {
  // 석차 3, 동석차 5명 → 중간석차 5 → (5 - 0.5) / 100 = 4.5%
  const c = E.convertSubject({ grade5: 1, rank: 3, ties: 5, total: 100 });
  near(c.P, 4.5);
});
test('트랙 B: Z점수 결과는 5등급 구간 안으로 제한', () => {
  // Z = 2.5 → 상위 0.6%지만 입력 등급이 2등급이면 10~34% 구간으로 제한
  const c = E.convertSubject({ grade5: 2, raw: 95, mean: 70, sd: 10 });
  assert.strictEqual(c.track, 'B');
  near(c.P, 10);
});
test('트랙 C: 등급만 있으면 구간 중간값', () => {
  near(E.convertSubject({ grade5: 3 }).P, 50);
});
test('성취도만 기재 과목은 등급 계산 제외', () => {
  assert.strictEqual(E.convertSubject({ absoluteOnly: true, achievement: 'A' }).g9, null);
});

const subjects = [
  { semester: '1-1', category: '국어', credits: 4, rank: 20, total: 200 },
  { semester: '1-1', category: '수학', credits: 4, rank: 10, total: 200 },
  { semester: '1-2', category: '국어', credits: 4, rank: 16, total: 200 },
  { semester: '1-2', category: '수학', credits: 4, rank: 6, total: 200 },
];
const profile = E.buildProfile(subjects);

test('프로필: 남은 학기는 2-1, 2-2, 3-1', () => {
  assert.deepStrictEqual(profile.pastSems, ['1-1', '1-2']);
  assert.deepStrictEqual(profile.futureSems, ['2-1', '2-2', '3-1']);
});
test('시나리오 A: 백분위가 매 학기 15%씩 줄어듦', () => {
  const p = E.project(profile, { scenario: 'A', rate: 15 });
  const P1 = E.grade9ToPercentile(p.future['2-1']['수학']);
  const P2 = E.grade9ToPercentile(p.future['2-2']['수학']);
  near(P2 / P1, 0.85, 1e-6);
});
test('유지 시나리오: 예측 평균 = 현재 평균', () => {
  const p = E.project(profile, { scenario: 'keep' });
  const g = E.groupAverage(profile, p, E.BASIS['전과목']);
  near(g.projected, g.past, 1e-9);
});
test('역산: 남은 학기 필요 평균', () => {
  const g = E.groupAverage(profile, E.project(profile, { scenario: 'keep' }), E.BASIS['전과목']);
  const target = g.past - 0.3;
  const bt = E.backtrack(g, target);
  assert.strictEqual(bt.status, 'ok');
  near((g.pastSum + bt.required * g.futureWeight) / (g.pastWeight + g.futureWeight), target, 1e-9);
});
test('3개년 컷은 5:3:2로 최근 연도 가중', () => {
  const c = E.aggregateCuts({ 2024: { c70: 3 }, 2025: { c70: 2 }, 2026: { c70: 1 } });
  near(c.c70, (5 * 1 + 3 * 2 + 2 * 3) / 10, 1e-9);
});
test('판정: 안정 / 적정 / 상향 / 위험', () => {
  const cuts = { c50: 2.0, c70: 2.3, cf: 2.6 };
  assert.strictEqual(E.judge(1.9, cuts).verdict, '안정');
  assert.strictEqual(E.judge(2.2, cuts).verdict, '적정');
  assert.strictEqual(E.judge(2.7, cuts).verdict, '상향');
  assert.strictEqual(E.judge(3.0, cuts).verdict, '위험');
  assert.strictEqual(E.judge(2.4, cuts, { bonus: 0.15 }).verdict, '적정');
});
test('판정: 평균만 공개된 경우 평균을 기준선으로', () => {
  const j = E.judge(2.1, { c50: null, c70: null, cf: null, avg: 2.0 });
  assert.strictEqual(j.refs.refKind, '평균');
  assert.strictEqual(j.verdict, '상향');
  assert.strictEqual(E.judge(1.7, { c50: null, c70: null, cf: null, avg: 2.0 }).verdict, '안정');
});
test('판정: 등록자 최저 이상치는 상향 범위를 기준선 + 1.0까지만 넓힘', () => {
  const cuts = { c50: null, c70: null, cf: 6.06, avg: 2.5 };
  assert.strictEqual(E.judge(3.4, cuts).verdict, '상향');
  assert.strictEqual(E.judge(3.6, cuts).verdict, '위험');
});
test('판정: 컷이 하나도 없으면 입결 없음', () => {
  assert.strictEqual(E.judge(2.0, { c50: null, c70: null, cf: null, avg: null }).verdict, '입결 없음');
});
test('CSV: 따옴표·학년도별 줄 합치기', () => {
  const csv = '대학,학과,구분,계열,전형유형,전형명,반영,학년도,50%컷,70%컷,추합컷,평균,출처\n' +
    '가나대학교,"경영학과",문과,경영·경제,학생부종합,"활동우수형, 서류",전과목,2026,2.1,2.4,,,https://a\n' +
    '가나대학교,경영학과,문과,경영·경제,학생부종합,"활동우수형, 서류",전과목,2025학년도,2.0,2.3,,,\n' +
    '가나대학교,경영학과,문과,경영·경제,교과,지역균형,국영수사,2026,,1.8,,,\n' +
    ',빈줄,,,,,,,,,,,\n';
  const r = E.csvToRows(csv);
  assert.strictEqual(r.rows.length, 2);
  const jong = r.rows.find((x) => x.type === '종합');
  assert.strictEqual(jong.admission, '활동우수형, 서류');
  assert.deepStrictEqual(Object.keys(jong.cuts).sort(), ['2025', '2026']);
  assert.strictEqual(jong.cuts['2026'].c70, 2.4);
  assert.strictEqual(r.errors.length, 1);
});
test('CSV: 같은 학과라도 전형명이 다르면 다른 행', () => {
  const csv = '대학,학과,전형유형,전형명,학년도,70%컷\n' +
    '가나대학교,경영학과,학생부종합,면접형,2026,2.4\n' +
    '가나대학교,경영학과,학생부종합,서류형,2026,2.1\n';
  const r = E.csvToRows(csv);
  assert.strictEqual(r.rows.length, 2);
  assert.deepStrictEqual(r.rows.map((x) => x.admission).sort(), ['서류형', '면접형'].sort());
});
test('CSV: 필수 열이 없으면 오류', () => {
  assert.ok(E.csvToRows('대학,학과\n가,나').errors.length > 0);
});
test('학교 유형 보정: 상위 20% × 0.5 → 일반고 상위 10%', () => {
  const c = E.convertSubject({ rank: 40.5, total: 200 }, { factor: 0.5 });
  near(c.Praw, 20);
  near(c.P, 10);
  near(c.g9, E.percentileToGrade9(10));
  near(c.g9raw, E.percentileToGrade9(20));
  assert.strictEqual(c.g5calc, 2); // 등급 일치 확인은 원래 백분위로
});
test('보정계수 1이면 변화 없음', () => {
  const c = E.convertSubject({ rank: 13, total: 250 }, { factor: 1 });
  near(c.P, c.Praw, 1e-12);
});
test('목표 석차 계산', () => {
  assert.strictEqual(E.rankForPercentile(4, 250), 10);
  assert.strictEqual(E.rankForPercentile(0.1, 100), 1);
});

console.log('\n' + passed + ' tests passed');
