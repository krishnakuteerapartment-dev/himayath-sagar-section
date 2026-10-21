"""Build HSagar_section_data.json for the Himayath Sagar app.
usage: build_section.py master.json mapping.xlsx dtr_list.xlsx out.json
- master.json: parse_master.py output (EBS consumer master PDF: meter no, reading, make, phase, load, seal, status...)
- mapping.xlsx: services mapped on DTRs (structure code, consumer name, address, area) -> the DTR each service is checked on
- dtr_list.xlsx: all DTRs of the section (structure code, name, type, feeder, capacity, substation)
"""
import json, sys, re, gzip, base64, collections, openpyxl
master, mapping, dtrlist, out = sys.argv[1:5]
F = ['s', 'u', 'm', 'dtr', 'n', 'a', 'ph', 'ct', 'ld', 'mk', 'r', 'rm', 'sl', 'st', 'mf', 'an', 'x', 'md']
cl = lambda v: re.sub(r'\s+', ' ', str('' if v is None else v)).strip()
code = lambda v: re.sub(r'\.0+$', '', cl(v))
num = lambda f: int(f) if float(f).is_integer() else f
def addr(v):  # "Q NO 66  , , " -> "Q NO 66"
    a = cl(v); a = re.sub(r'\s*,(\s*,)+\s*', ', ', a); return a.strip(' ,')

P = {r['u']: r for r in json.load(open(master))}

# all DTRs of the section
STR = {}
for r in list(openpyxl.load_workbook(dtrlist, read_only=True).worksheets[0].iter_rows(values_only=True))[1:]:
    c = code(r[5])
    if not c: continue
    kva = code(r[17]); ph = code(r[16])
    if c in STR:  # two DTRs on one structure
        if kva: STR[c][4] = (STR[c][4] + '+' if STR[c][4] else '') + kva
        continue
    STR[c] = [cl(r[4]), cl(r[10]), cl(r[9]), code(r[8]), kva, cl(r[7])]
in_list = set(STR)

# services mapped on DTRs
rows = list(openpyxl.load_workbook(mapping, read_only=True).worksheets[0].iter_rows(values_only=True))
hdr = [cl(h).upper() for h in rows[0]]; ix = {h: i for i, h in enumerate(hdr)}
g = lambda r, k: r[ix[k]]
AR, recs, seen, area_names = {}, [], set(), {}
extra_str = 0; dup = 0; dates = collections.Counter()
for r in rows[1:]:
    u = code(g(r, 'UKSCNO'))
    if not u: continue
    if u in seen: dup += 1; continue
    seen.add(u)
    c = code(g(r, 'STRUCTURE CODE'))
    if c not in STR:
        STR[c] = [cl(g(r, 'STRUCTURE NAME')), cl(g(r, 'STRUCTURE TYPE')), cl(g(r, 'FEEDER NAME')), code(g(r, 'FEEDER CODE')), '', '']; extra_str += 1
    ac, an = code(g(r, 'AREA CODE')), cl(g(r, 'AREA NAME'))
    if ac:
        area_names.setdefault(ac, an)
        AR.setdefault(ac, [an, {}]); AR[ac][1][c] = AR[ac][1].get(c, 0) + 1
    dates[cl(g(r, 'APPROVED DATE'))] += 1
    m = P.get(u, {})
    recs.append([cl(g(r, 'SERVICE NO')), u, m.get('m') or '0', c, cl(g(r, 'CONSUMER NAME')) or m.get('n', ''),
                 addr(g(r, 'ADDRESS')) or m.get('a', ''), m.get('ph', 1), m.get('ct', ''), num(m.get('ld', 0)), m.get('mk', ''),
                 num(m.get('r', 0)), m.get('rm', ''), m.get('sl', ''), m.get('st', ''), num(m.get('mf', 1)), an, 0, m.get('md', '')])
not_in_pdf = sum(1 for x in recs if x[1] not in P)
# in the EBS master but not mapped on any DTR: kept for search and scans, shown as "not in mapping"
legacy = 0
for u, m in P.items():
    if u in seen: continue
    legacy += 1
    recs.append([m['s'], u, m['m'] or '0', m['md'], m['n'], m.get('a', ''), m.get('ph', 1), m['ct'], num(m['ld']), m.get('mk', ''),
                 num(m['r']), m.get('rm', ''), m['sl'], m.get('st', ''), num(m['mf']), area_names.get(m.get('ar', ''), ''), 1, m['md']])
for x in recs:
    for i, v in enumerate(x): x[i] = re.sub(r'[\t\n\r]+', ' ', str(v))
txt = '\n'.join('\t'.join(x) for x in recs)
meta = {'section': '18 Himayath Sagar', 'ero': '322 Gaganpahad', 'mapOn': '21-Oct-2026', 'masterOn': '21-Oct-2026',
        'dtrList': len(in_list), 'fields': F}
j = {'app': 'hsagar-dtr', 'v': 1, 'meta': meta, 'records': base64.b64encode(gzip.compress(txt.encode(), 9, mtime=0)).decode(),
     'structs': STR, 'areas': AR}
json.dump(j, open(out, 'w'), separators=(',', ':'), ensure_ascii=False)
live = len(seen)
print(f'services mapped: {live} (duplicate rows skipped {dup}; not found in PDF {not_in_pdf})')
print(f'EBS master only (not mapped): {legacy}; total records {len(recs)}')
print(f'DTRs: {len(in_list)} in DTR list + {extra_str} only in mapping = {len(STR)}; with services {len({x[3] for x in recs if x[16]=="0"})}')
print(f'areas {len(AR)}; feeders {len({s[3] or s[2] for s in STR.values()})}; approved dates {dates.most_common(3)}')
