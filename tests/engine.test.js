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
test('목표 석차 계산', () => {
  assert.strictEqual(E.rankForPercentile(4, 250), 10);
  assert.strictEqual(E.rankForPercentile(0.1, 100), 1);
});

console.log('\n' + passed + ' tests passed');
