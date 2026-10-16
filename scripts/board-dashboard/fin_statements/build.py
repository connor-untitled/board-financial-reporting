# Builds .board-dashboard/out/fin_statements.json from CFO.ai reads saved as REAM rows in .board-dashboard/cfo/ (read only;
# the inspect_table_blocks reads are listed in the README). Asserts that every statement foots before writing.
import json, sys
import os
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
IN = os.path.join(HERE, '..', '..', '..', '.board-dashboard', 'cfo')
from parse import parse
OUT = '/home/user/board-financial-reporting/.board-dashboard/out/fin_statements.json'
Q = ['2026-07', '2026-08', '2026-09']
# Column letters per source: (month, basis) -> letter
MAP = {
  'summary': {('2026-07','actual'):'B',('2026-07','budget'):'C',('2026-08','actual'):'D',('2026-08','budget'):'E'},
  'pl': {('2026-07','actual'):'B',('2026-07','budget'):'C',('2026-08','actual'):'D',('2026-08','budget'):'E',('2026-09','budget'):'G'},
  'bs': {('2026-07','actual'):'D',('2026-07','budget'):'E',('2026-08','actual'):'F',('2026-08','budget'):'G'},
  'cf': {('2026-07','actual'):'B',('2026-07','budget'):'C',('2026-08','actual'):'D',('2026-08','budget'):'E'},
}
FILE = {'summary': 'sum', 'pl': 'pl', 'bs': 'bs', 'cf': 'cf'}
RENAME = {'Gross Profit Before Depreciation': 'Gross Profit', 'Total Expenses': 'Operating Expenses', 'Gross Profit (%)': 'Gross Profit (%)'}
# Layout per statement: (band) or (line, style, better). style: line | sub | total | pct ; better: up (higher is better) | down
E = 'down'
LAYOUT = {
 'summary': [('Revenue',), ('Subscription Revenue','line'), ('Usage Revenue','line'), ('Software Revenue','sub'), ('Services Retainer','line'), ('Services - Project','line'), ('Services Revenue','sub'),
   ('Total Revenue','total'), ('Total Cost of Goods Sold','line',E), ('Gross Profit Before Depreciation','sub'), ('Gross Profit (%)','pct'), ('Total Expenses','line',E), ('EBITDA','total'), ('EBITDA (%)','pct'),
   ('Cash Flows',), ('Cash Flow from Operating Activities','line'), ('Cash Flow from Investing Activities','line'), ('Cash Flow from Financing Activities','line'), ('Change in Cash & Equivalents','total'), ('Cash & Equivalents, Closing Balance','sub')],
 'pl': [('Revenue',), ('Subscription Revenue','line'), ('Consumption Revenue','line'), ('DSP Revenue','line'), ('Mailer Revenue','line'), ('Services Retainer','line'), ('Services - Project','line'), ('Total Revenue','total'),
   ('Cost of Goods Sold',), ('Cost of Goods - Software & Data','line',E), ('Cost of Goods - Services','line',E), ('Total Cost of Goods Sold','total',E), ('Gross Profit Before Depreciation','sub'),
   ('Expenses',), ('General & Administrative','line',E), ('Operations','line',E), ('Technology & Development','line',E), ('Sales & Marketing','line',E), ('Total Expenses','total',E),
   ('Operating Profit Before Depn & Amort.','sub'), ('Other Income','line'), ('EBITDA','total'), ('Depreciation and Amortization','line',E), ('Earnings Before Interest & Tax','sub'),
   ('Interest Expense','line',E), ('Earnings Before Tax','sub'), ('Income Tax','line',E), ('Net Income','total')],
 'bs': [('Assets',), ('Cash & Equivalents','line'), ('Accounts Receivable','line'), ('Prepaid Expenses','line'), ('Other Current Assets','line'), ('Total Current Assets','sub'), ('Net Fixed Assets','line'),
   ('Investments or Other Non-Current Assets','line'), ('Total Non-Current Assets','sub'), ('Total Assets','total'),
   ('Liabilities',), ('Accounts Payable','line',E), ('Credit Cards','line',E), ('Accrued Liabilities','line',E), ('Deferred Revenue','line',E), ('Short Term Debt','line',E), ('Other Current Liabilities','line',E), ('Total Current Liabilities','sub',E),
   ('SBA Loan','line',E), ('Jakeland Promissory Note','line',E), ('Convertible Note','line',E), ('Total Non-Current Liabilities','sub',E), ('Total Liabilities','total',E),
   ('Equity',), ('Retained Earnings','line'), ('Current Earnings','line'), ('Other Equity','line'), ('Total Equity','sub'), ('Total Liabilities & Equity','total')],
 'cf': [('Operating Activities',), ('Net Income','sub'), ('Depreciation and Amortization','line'), ('Change in Accounts Receivable','line'), ('Changes in Prepaid Expenses','line'), ('Change in Other Current Assets','line'),
   ('Change in Accounts Payable','line'), ('Changes to Accrued Liabilities','line'), ('Changes to Deferred Revenue','line'), ('Change in Other Current Liabilities','line'), ('Changes to Credit Card Balances','line'), ('Cash Flow from Operating Activities','total'),
   ('Investing Activities',), ('Change in Fixed Assets','line'), ('Change in Other Non-Current Assets','line'), ('Cash Flow from Investing Activities','total'),
   ('Financing Activities',), ('Change in Other Equity','line'), ('Change in Short Term Debt','line'), ('Change in Other Non-Current Liabilities','line'), ('Cash Flow from Financing Activities','total'),
   ('Change in Cash & Equivalents','total'), ('Cash & Equivalents, Opening Balance','line'), ('Cash & Equivalents, Closing Balance','sub')],
}
PCT = {'Gross Profit (%)': ('Gross Profit Before Depreciation', 'Total Revenue'), 'EBITDA (%)': ('EBITDA', 'Total Revenue')}
out = []
for st, lay in LAYOUT.items():
    src = {r['line']: r for r in parse(os.path.join(IN, FILE[st] + '.ream'))}
    used = set()
    for i, item in enumerate(lay):
        if len(item) == 1:
            out.append({'kind': 'q', 'statement': st, 'order': i, 'line': item[0], 'style': 'band', 'better': None, 'ratio_of': None, 'month': None, 'basis': None, 'value': None}); continue
        name, style = item[0], item[1]; better = item[2] if len(item) > 2 else 'up'
        r = src[name]; used.add(name)
        ratio = '/'.join(RENAME.get(x, x) if st == 'summary' else x for x in PCT[name]) if name in PCT else None
        for (m, b), c in MAP[st].items():
            out.append({'kind': 'q', 'statement': st, 'order': i, 'line': RENAME.get(name, name) if st in ('summary',) else name, 'style': style, 'better': better, 'ratio_of': ratio,
                        'month': m, 'basis': b, 'value': round(r.get(c, 0.0), 6)})
    left = set(src) - used - {'Balance Check (Assets - L&E)'}
    assert not left, (st, left)
# YTD + Upside
YM = {c: '2026-%02d' % (i + 1) for i, c in enumerate('BCDEFGHIJKLM')}
ylay = LAYOUT['summary']
ysrc = {r['line']: r for r in parse(os.path.join(IN, 'ytd.ream'))}
for i, item in enumerate(ylay):
    if len(item) == 1:
        out.append({'kind': 'ytd', 'statement': 'ytd', 'order': i, 'line': item[0], 'style': 'band', 'better': None, 'ratio_of': None, 'month': None, 'basis': None, 'value': None}); continue
    name, style = item[0], item[1]; better = item[2] if len(item) > 2 else 'up'
    r = ysrc[name]
    for c, m in YM.items():
        out.append({'kind': 'ytd', 'statement': 'ytd', 'order': i, 'line': RENAME.get(name, name), 'style': style, 'better': better, 'ratio_of': '/'.join(RENAME.get(x, x) for x in PCT[name]) if name in PCT else None,
                    'month': m, 'basis': 'actual' if m <= '2026-08' else 'upside', 'value': round(r[c], 6)})
out.append({'kind': 'meta', 'statement': None, 'order': None, 'line': None, 'style': None, 'better': None, 'ratio_of': None, 'month': '2026-08', 'basis': 'close', 'value': None})
# ---- tie-outs
def v(st, line, m, b):
    for x in out:
        if x['statement'] == st and x['month'] == m and x['basis'] == b and x['line'] == line: return x['value']
    raise KeyError((st, line, m, b))
for m in ['2026-07', '2026-08']:
    for b in ['actual', 'budget']:
        rev = sum(v('pl', n, m, b) for n in ['Subscription Revenue','Consumption Revenue','DSP Revenue','Mailer Revenue','Services Retainer','Services - Project'])
        assert abs(rev - v('pl', 'Total Revenue', m, b)) < 0.05, ('rev', m, b)
        assert abs(v('pl','Total Revenue',m,b) - v('summary','Total Revenue',m,b)) < 0.05
        ex = sum(v('pl', n, m, b) for n in ['General & Administrative','Operations','Technology & Development','Sales & Marketing'])
        assert abs(ex - v('pl', 'Total Expenses', m, b)) < 0.05, ('exp', m, b)
        ta = v('bs','Total Assets',m,b); tle = v('bs','Total Liabilities & Equity',m,b); assert abs(ta - tle) < 0.05, ('bs', m, b)
        cfo = sum(v('cf', n, m, b) for n in ['Net Income','Depreciation and Amortization','Change in Accounts Receivable','Changes in Prepaid Expenses','Change in Other Current Assets','Change in Accounts Payable','Changes to Accrued Liabilities','Changes to Deferred Revenue','Change in Other Current Liabilities','Changes to Credit Card Balances'])
        assert abs(cfo - v('cf','Cash Flow from Operating Activities',m,b)) < 0.06, ('cfo', m, b, cfo)
        assert abs(v('cf','Cash & Equivalents, Opening Balance',m,b) + v('cf','Change in Cash & Equivalents',m,b) - v('cf','Cash & Equivalents, Closing Balance',m,b)) < 0.05
        assert abs(v('cf','Cash & Equivalents, Closing Balance',m,b) - v('bs','Cash & Equivalents',m,b)) < 0.05
        assert abs(v('cf','Net Income',m,b) - v('pl','Net Income',m,b)) < 0.05
for c, m in YM.items():
    sw = v('ytd','Subscription Revenue',m,'actual' if m<='2026-08' else 'upside') + v('ytd','Usage Revenue',m,'actual' if m<='2026-08' else 'upside')
    assert abs(sw - v('ytd','Software Revenue',m,'actual' if m<='2026-08' else 'upside')) < 0.05, m
    b = 'actual' if m<='2026-08' else 'upside'
    assert abs(v('ytd','Software Revenue',m,b)+v('ytd','Services Revenue',m,b)-v('ytd','Total Revenue',m,b)) < 0.05, m
    assert abs(v('ytd','Total Revenue',m,b)-v('ytd','Total Cost of Goods Sold',m,b)-v('ytd','Gross Profit',m,b)) < 0.05, m
# Upside YTD months must match the fin_review file
fr = {r['month']: r for r in json.load(open('/home/user/board-financial-reporting/.board-dashboard/out/fin_review.json')) if r['kind'] == 'month'}
for m in ['2026-09','2026-12']: assert abs(fr[m]['upside_ebitda'] - v('ytd','EBITDA',m,'upside')) < 0.05
for m in ['2026-01','2026-08']: assert abs(fr[m]['ebitda'] - v('ytd','EBITDA',m,'actual')) < 0.05
json.dump(out, open(OUT, 'w'))
print('rows', len(out), 'all tie-outs pass')
