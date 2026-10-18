#!/usr/bin/env python3
"""data/research/*.json(조사 결과) → 프로그램용 입결 데이터 파일.

만드는 파일
  js/data-jonghap.js       학생부종합 입결 (브라우저에서 window.GRADEUP_DB['종합'])
  js/data-gyogwa.js        학생부교과 입결 (window.GRADEUP_DB['교과'])
  data/ipgyeol-jonghap.csv 엑셀에서 열어 보거나 고칠 수 있는 같은 내용의 CSV
  data/ipgyeol-gyogwa.csv

실행: python3 tools/build_data.py
"""
import csv
import glob
import json
import os
import sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIELDS = {'인문', '사회과학', '경영·경제', '교육', '자연과학', '공학', '의약·보건'}
BASES = {'전과목', '국영수사과', '국영수사', '국영수과'}
YEARS = ['2026', '2025', '2024']
TYPES = {'종합': ('data-jonghap.js', 'ipgyeol-jonghap.csv', '학생부종합'),
         '교과': ('data-gyogwa.js', 'ipgyeol-gyogwa.csv', '학생부교과')}
CSV_HEAD = ['대학', '학과', '구분', '계열', '전형유형', '전형명', '반영', '학년도',
            '50%컷', '70%컷', '추합컷', '평균', '출처']


def grade(v, where, warnings):
    if v is None or v == '':
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        warnings.append(f'{where}: 숫자가 아님 {v!r} → 제외')
        return None
    if not 1.0 <= x <= 9.99:
        warnings.append(f'{where}: 등급 범위(1~9.99) 밖 {x} → 제외')
        return None
    return round(x, 2)


def load_rows(warnings):
    rows, notes = {'종합': [], '교과': []}, {}
    for path in sorted(glob.glob(os.path.join(ROOT, 'data', 'research', '*.json'))):
        with open(path, encoding='utf-8') as f:
            doc = json.load(f)
        for u in doc.get('universities', []):
            univ = u['univ'].strip()
            if u.get('notes'):
                notes[univ] = u['notes']
            for d in u.get('departments', []):
                field = d.get('field') if d.get('field') in FIELDS else None
                if d.get('field') and not field:
                    warnings.append(f'{univ} {d["dept"]}: 알 수 없는 계열 {d.get("field")!r}')
                for e in d.get('entries', []):
                    t = e.get('type')
                    if t not in TYPES:
                        warnings.append(f'{univ} {d["dept"]}: 알 수 없는 전형유형 {t!r}')
                        continue
                    cuts = {}
                    for y in YEARS:
                        c = (e.get('cuts') or {}).get(y) or {}
                        where = f'{univ} {d["dept"]} {t} {y}'
                        cut = {k: grade(c.get(k), f'{where} {k}', warnings) for k in ('c50', 'c70', 'cf', 'avg')}
                        if any(v is not None for v in cut.values()):
                            cuts[y] = cut
                    rows[t].append({
                        'univ': univ,
                        'dept': d['dept'].strip(),
                        'track': d.get('track') if d.get('track') in ('문과', '이과') else None,
                        'field': field,
                        'type': t,
                        'admission': e.get('admission'),
                        'basis': e.get('basis') if e.get('basis') in BASES else None,
                        'cuts': cuts,
                        'sources': [s for s in e.get('sources', []) if s.get('url')],
                    })
    return rows, notes


def write_js(t, rows, notes):
    js_name, _, label = TYPES[t]
    univs = sorted({r['univ'] for r in rows})
    with_data = sum(1 for r in rows if r['cuts'])
    body = ',\n'.join('    ' + json.dumps(r, ensure_ascii=False) for r in rows)
    note_json = json.dumps({u: notes[u] for u in univs if u in notes}, ensure_ascii=False, indent=2)
    out = f"""/*
 * {label} 입결 — tools/build_data.py가 data/research/*.json에서 만든 파일입니다. 직접 고치지 말고
 * 조사 JSON을 고친 뒤 다시 실행하세요.
 * 대학 {len(univs)}곳, 모집단위 {len(rows)}개 (입결 있음 {with_data}개), 생성일 {date.today().isoformat()}
 * 숫자는 각 행의 sources에 적힌 공개 자료에서 옮긴 9등급제 내신 등급이며, 비어 있는 값은 찾지 못한 값입니다.
 */
window.GRADEUP_DB = window.GRADEUP_DB || {{}};
window.GRADEUP_DB['{t}'] = {{
  updated: '{date.today().isoformat()}',
  notes: {note_json},
  universities: [
{body}
  ],
}};
"""
    with open(os.path.join(ROOT, 'js', js_name), 'w', encoding='utf-8') as f:
        f.write(out)
    return len(univs), len(rows), with_data


def write_csv(t, rows):
    _, csv_name, label = TYPES[t]
    os.makedirs(os.path.join(ROOT, 'data'), exist_ok=True)
    with open(os.path.join(ROOT, 'data', csv_name), 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(CSV_HEAD)
        for r in rows:
            years = [y for y in YEARS if y in r['cuts']] or ['']
            for y in years:
                c = r['cuts'].get(y, {})
                src = next((s['url'] for s in r['sources'] if str(s.get('year')) == y), '')
                w.writerow([r['univ'], r['dept'], r['track'] or '', r['field'] or '', label,
                            r['admission'] or '', r['basis'] or '', y,
                            *['' if c.get(k) is None else c[k] for k in ('c50', 'c70', 'cf', 'avg')], src])


def main():
    warnings = []
    rows, notes = load_rows(warnings)
    for t in TYPES:
        u, n, d = write_js(t, rows[t], notes)
        write_csv(t, rows[t])
        print(f'{TYPES[t][2]}: 대학 {u}곳, 모집단위 {n}개, 입결 있음 {d}개')
    for w in warnings:
        print('경고:', w, file=sys.stderr)


if __name__ == '__main__':
    main()
