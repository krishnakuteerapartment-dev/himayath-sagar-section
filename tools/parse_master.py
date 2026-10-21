"""Parse the EBS 'Consumer Master Details' report (pdftotext -layout output) into JSON records.
usage: parse_master.py master.txt out.json"""
import re, json, sys
lines = open(sys.argv[1], encoding='utf-8', errors='replace').read().replace('\x0c', '').split('\n')
# line 1: SERVICE NO. CT CONNLD NAME UKSCNO METERNO STRUCTURECD SEALNO CONCEAL SUPPLYDT READING MF
SVC = r'(\d{4}\s+(?:\d\s+)?\d{3,6}\S?)'
r1 = re.compile(r'^' + SVC + r'\s+(\S+)\s+(\d+\.\d+)\s+(.*?)\s+(\d{9})\s+(?:(\S+)\s+)?(\d{10}|\d{1,9}|\d{11})\s+(?:(.+?)\s+)?(OPEN|CONCEAL|\S+)\s+(NO DATE|\d\d/\d\d/\d\d)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+\.\d+)\s*$')
# line 2: AREACD ST GR SB CONTLD ADRESS MAKE AVGBLDUNITS PH POLENO SEALST LASTPDDT RDGMNTH ARREARS
r2 = re.compile(r'^(\S+)\s+(\S+)\s+(\S)\s+(\S+)\s+(\d+\.\d+)\s?(.*?)\s+(-?\d+)\s+([13])\s*(.*?)\s*(YES|NO)\s+(NO DATE|\d\d/\d\d/\d\d)\s+(\d\d/\d{4}|NO DATE|\S+)(?:\s+(-?[\d.]+))?\s*$')
recs = []; bad = []
i = 0
while i < len(lines):
    s = lines[i]
    m = r1.match(s)
    if m:
        j = i + 1
        while j < len(lines) and not lines[j].strip(): j += 1
        g = m.groups()
        rec = dict(s=re.sub(r'\s+', ' ', g[0]), ct=g[1], ld=float(g[2]), n=g[3].strip(), u=g[4], m=g[5] or '', md=g[6],
                   sl=(g[7] or '').strip(), cc=g[8], sd=g[9], r=float(g[10]), mf=float(g[11]))
        m2 = r2.match(lines[j]) if j < len(lines) else None
        if m2:
            h = m2.groups()
            mid = h[5]
            parts = re.split(r'\s{2,}', mid.strip())
            addr, make = (' '.join(parts[:-1]), parts[-1]) if len(parts) >= 2 else (mid.strip(), '')
            rec.update(ar=h[0], st=h[1], gr=h[2], sb=h[3], cl=float(h[4]), a=addr, mk=make, av=int(h[6]), ph=int(h[7]),
                       pole=h[8].strip(), ss=h[9], lp=h[10], rm=h[11], arr=float(h[12]) if h[12] else 0.0)
            i = j + 1
        else:
            bad.append('L2:' + (lines[j] if j < len(lines) else '')); i += 1
        recs.append(rec)
        continue
    if re.match(r'^\d{4}\s+(?:\d\s+)?\d{3,6}\S?\s+\S+\s+\d+\.\d+\s', s):
        bad.append('L1:' + s)
    i += 1
print(len(recs), 'records;', len(bad), 'unparsed lines', file=sys.stderr)
for b in bad[:40]: print(repr(b), file=sys.stderr)
json.dump(recs, open(sys.argv[2], 'w'), separators=(',', ':'))
