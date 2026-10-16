# Parses the row lines of a CFO.ai REAM table read: "N | A=\"Line#ref\" | B=1 | C:E=0 |", including "N:M" row ranges.
import re, json
def cols(a, b): return [chr(c) for c in range(ord(a), ord(b) + 1)]
def parse(path):
    rows = {}; order = []
    for ln in open(path):
        parts = [p.strip() for p in ln.strip().strip('|').split('|')]
        rr = parts[0]; r0, r1 = (rr.split(':') + [rr])[:2]; rng = range(int(r0), int(r1) + 1)
        for p in parts[1:]:
            if not p: continue
            k, v = p.split('=', 1)
            if k == 'A':
                name = re.sub(r'#[0-9a-f]+$', '', json.loads(v)); rows.setdefault(int(r0), {})['line'] = name; order.append(int(r0)); continue
            cs = cols(*k.split(':')) if ':' in k else [k]
            for r in rng:
                rows.setdefault(r, {})
                for c in cs: rows[r][c] = float(v)
    return [rows[r] for r in order]
