# Builds .board-dashboard/out/fin_review.json and fin_statements.json from CFO.ai reads saved as REAM row lines
# in .board-dashboard/cfo/<close>/ (read only; the inspect_table_blocks reads are listed in the README).
# Asserts that every statement foots, and that months already published did not move, before writing.
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from parse import parse
ROOT = os.path.join(HERE, '..', '..', '..', '.board-dashboard')
CLOSE = sys.argv[1] if len(sys.argv) > 1 else '2026-09'
IN = os.path.join(ROOT, 'cfo', {'2026-09': 'sep'}[CLOSE])
OUT = os.path.join(ROOT, 'out')
M = ['2026-%02d' % i for i in range(1, 13)]
Q = ['2026-07', '2026-08', '2026-09']
ACT = [m for m in M if m <= CLOSE]
def rd(f): return {r['line']: r for r in parse(os.path.join(IN, f + '.ream'))}
# ---- sources: (month, basis) -> value per line
PL = rd('pl_ttm')  # Cash Forecast scenario, Jan-Dec: actual through the close, then the Upside case; Budget 2026 beside it
PLC = {(m, 'actual' if m <= CLOSE else 'upside'): 'BDFHJLNPRTVX'[i] for i, m in enumerate(M)}
PLC.update({(m, 'budget'): 'CEGIKMOQSUWY'[i] for i, m in enumerate(M)})
def src(table, cols):
    return lambda line, m, b: (table.get(line, {}).get(cols[(m, b)], 0.0) if (m, b) in cols else None)
pl = src(PL, PLC)
bsJ, bsS = rd('bs_jul'), rd('bs_sep')
def bs(line, m, b):
    if m == '2026-07': return bsJ[line][{'actual': 'D', 'budget': 'E'}[b]]
    return bsS[line][{('2026-08', 'actual'): 'B', ('2026-08', 'budget'): 'C', ('2026-09', 'actual'): 'D', ('2026-09', 'budget'): 'E'}[(m, b)]]
cfJ, cfS = rd('cf_jul'), rd('cf_sep')
def cf(line, m, b):
    t, c = (cfJ, {'actual': 'B', 'budget': 'C'}[b]) if m == '2026-07' else (cfS, {('2026-08', 'actual'): 'B', ('2026-08', 'budget'): 'C', ('2026-09', 'actual'): 'D', ('2026-09', 'budget'): 'E'}[(m, b)])
    return t.get(line, {}).get(c, 0.0)
MSF = rd('msf'); MSC = {m: 'BCDE'[i] for i, m in enumerate(['2026-09', '2026-10', '2026-11', '2026-12'])}
YA = rd('ytd_aug'); YAC = {m: 'BCDEFGHIJKLM'[i] for i, m in enumerate(M)}
E = 'down'
SUMMARY = [('Revenue',), ('Subscription Revenue','line'), ('Usage Revenue','line'), ('Software Revenue','sub'), ('Services Retainer','line'), ('Services - Project','line'), ('Services Revenue','sub'),
   ('Total Revenue','total'), ('Total Cost of Goods Sold','line',E), ('Gross Profit','sub'), ('Gross Profit (%)','pct'), ('Operating Expenses','line',E), ('EBITDA','total'), ('EBITDA (%)','pct'),
   ('Cash Flows',), ('Cash Flow from Operating Activities','line'), ('Cash Flow from Investing Activities','line'), ('Cash Flow from Financing Activities','line'), ('Change in Cash & Equivalents','total'), ('Cash & Equivalents, Closing Balance','sub')]
LAYOUT = {
 'summary': SUMMARY,
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
 'cf': [('Operating Activities',), ('Net Income','sub'), ('Depreciation and Amortization','line'), ('Convertible Note Interest Accrual','line'), ('Change in Accounts Receivable','line'), ('Changes in Prepaid Expenses','line'), ('Change in Other Current Assets','line'),
   ('Change in Accounts Payable','line'), ('Changes to Accrued Liabilities','line'), ('Changes to Deferred Revenue','line'), ('Change in Other Current Liabilities','line'), ('Changes to Credit Card Balances','line'), ('Cash Flow from Operating Activities','total'),
   ('Investing Activities',), ('Change in Fixed Assets','line'), ('Change in Other Non-Current Assets','line'), ('Cash Flow from Investing Activities','total'),
   ('Financing Activities',), ('Change in Other Equity','line'), ('Change in Short Term Debt','line'), ('Change in Other Non-Current Liabilities','line'), ('Cash Flow from Financing Activities','total'),
   ('Change in Cash & Equivalents','total'), ('Cash & Equivalents, Opening Balance','line'), ('Cash & Equivalents, Closing Balance','sub')],
}
PCT = {'Gross Profit (%)': 'Gross Profit/Total Revenue', 'EBITDA (%)': 'EBITDA/Total Revenue'}
CFL = {'Cash Flow from Operating Activities', 'Cash Flow from Investing Activities', 'Cash Flow from Financing Activities', 'Change in Cash & Equivalents', 'Cash & Equivalents, Closing Balance'}
def summ(line, m, b):
    """Summary lines from the P&L and cash flow reads (actual or budget), or the forecast summary (Upside)."""
    if b == 'upside': return MSF[{'Gross Profit': 'Gross Profit Before Depreciation', 'Operating Expenses': 'Total Expenses'}.get(line, line)][MSC[m]]
    if line in CFL:
        if m in Q: return cf(line, m, b)
        assert b == 'actual'; return YA[line][YAC[m]]
    p = lambda n: pl(n, m, b)
    f = {'Usage Revenue': lambda: p('Consumption Revenue') + p('DSP Revenue') + p('Mailer Revenue'),
         'Software Revenue': lambda: p('Subscription Revenue') + p('Consumption Revenue') + p('DSP Revenue') + p('Mailer Revenue'),
         'Services Revenue': lambda: p('Services Retainer') + p('Services - Project'),
         'Gross Profit': lambda: p('Gross Profit Before Depreciation'), 'Operating Expenses': lambda: p('Total Expenses'),
         'Gross Profit (%)': lambda: p('Gross Profit Before Depreciation') / p('Total Revenue'), 'EBITDA (%)': lambda: p('EBITDA') / p('Total Revenue')}
    return f[line]() if line in f else p(line)
GET = {'summary': summ, 'pl': pl, 'bs': bs, 'cf': cf}
out = []
def row(kind, st, i, item, m=None, b=None, v=None):
    if len(item) == 1: return {'kind': kind, 'statement': st, 'order': i, 'line': item[0], 'style': 'band', 'better': None, 'ratio_of': None, 'month': None, 'basis': None, 'value': None}
    return {'kind': kind, 'statement': st, 'order': i, 'line': item[0], 'style': item[1], 'better': item[2] if len(item) > 2 else 'up', 'ratio_of': PCT.get(item[0]), 'month': m, 'basis': b, 'value': round(v, 6)}
for st, lay in LAYOUT.items():
    for i, item in enumerate(lay):
        if len(item) == 1: out.append(row('q', st, i, item)); continue
        for m in Q:
            if m > CLOSE: continue
            for b in ('actual', 'budget'): out.append(row('q', st, i, item, m, b, GET[st](item[0], m, b)))
for i, item in enumerate(SUMMARY):
    if len(item) == 1: out.append(row('ytd', 'ytd', i, item)); continue
    for m in M:
        b = 'actual' if m <= CLOSE else 'upside'
        out.append(row('ytd', 'ytd', i, item, m, b, summ(item[0], m, b)))
out.append({'kind': 'meta', 'statement': None, 'order': None, 'line': None, 'style': None, 'better': None, 'ratio_of': None, 'month': CLOSE, 'basis': 'close', 'value': None})
# ---- fin_review (break-even chart and variance tables)
fr = [{'kind': 'meta', 'close_month': CLOSE, 'other_income_ytd': round(sum(pl('Other Income', m, 'actual') for m in ACT), 2), 'other_income_ytd_budget': round(sum(pl('Other Income', m, 'budget') for m in ACT), 2),
       'forecast_scenario': "Cash Forecast Q4'26-Q1'27", 'forecast_case': 'Upside', 'forecast_read': '2026-10-16'}]
for m in M:
    a = m <= CLOSE; g = lambda n, b: pl(n, m, b)
    r = {'kind': 'month', 'month': m}
    for k, n in (('revenue', 'Total Revenue'), ('cogs', 'Total Cost of Goods Sold'), ('opex', 'Total Expenses'), ('ebitda', 'EBITDA'), ('other_income', 'Other Income')):
        r[k] = round(g(n, 'actual'), 2) if a else None
        r['budget_' + k] = round(g(n, 'budget'), 2)
    r['expenses'] = round(r['cogs'] + r['opex'], 2) if a else None
    r['budget_expenses'] = round(r['budget_cogs'] + r['budget_opex'], 2)
    r['upside_revenue'] = None if a else round(g('Total Revenue', 'upside'), 2)
    r['upside_expenses'] = None if a else round(g('Total Cost of Goods Sold', 'upside') + g('Total Expenses', 'upside'), 2)
    r['upside_ebitda'] = None if a else round(g('EBITDA', 'upside'), 2)
    del r['budget_other_income']
    fr.append(r)
def line(sec, name, better, fn):
    return {'kind': 'line', 'section': sec, 'line': name, 'better': better, 'month_actual': round(fn(CLOSE, 'actual'), 2), 'month_budget': round(fn(CLOSE, 'budget'), 2),
            'ytd_actual': round(sum(fn(m, 'actual') for m in ACT), 2), 'ytd_budget': round(sum(fn(m, 'budget') for m in ACT), 2)}
P = lambda n: (lambda m, b: pl(n, m, b))
EXP = lambda m, b: pl('Total Cost of Goods Sold', m, b) + pl('Total Expenses', m, b)
for n in ['Subscription Revenue', 'Consumption Revenue', 'DSP Revenue', 'Mailer Revenue', 'Services Retainer', 'Services - Project', 'Total Revenue']: fr.append(line('revenue', n, 'rev', P(n)))
fr += [line('expenses', 'Cost of Goods Sold', 'exp', P('Total Cost of Goods Sold')), line('expenses', 'Operating Expenses', 'exp', P('Total Expenses')), line('expenses', 'Total Expenses (COGS + OPEX)', 'exp', EXP)]
fr += [line('summary', 'Total Revenue', 'rev', P('Total Revenue')), line('summary', 'Total Expenses (COGS + OPEX)', 'exp', EXP), line('summary', 'EBITDA', 'rev', P('EBITDA'))]
cols = sorted({k for r in fr for k in r}, key=lambda k: (k != 'kind', k)); fr = [{k: r.get(k) for k in cols} for r in fr]
# ---- checks
v = lambda st, ln, m, b: next(x['value'] for x in out if x['statement'] == st and x['line'] == ln and x['month'] == m and x['basis'] == b)
REV = ['Subscription Revenue', 'Consumption Revenue', 'DSP Revenue', 'Mailer Revenue', 'Services Retainer', 'Services - Project']
for m in M:
    for b in (('actual', 'budget') if m <= CLOSE else ('upside', 'budget')):
        assert abs(sum(pl(n, m, b) for n in REV) - pl('Total Revenue', m, b)) < 0.05, ('rev', m, b)
        assert abs(sum(pl(n, m, b) for n in ['General & Administrative', 'Operations', 'Technology & Development', 'Sales & Marketing']) - pl('Total Expenses', m, b)) < 0.05, ('opex', m, b)
        assert abs(pl('Total Revenue', m, b) - pl('Total Cost of Goods Sold', m, b) - pl('Total Expenses', m, b) + pl('Other Income', m, b) - pl('EBITDA', m, b)) < 0.05, ('ebitda', m, b)
for m in [x for x in Q if x <= CLOSE]:
    for b in ('actual', 'budget'):
        assert abs(bs('Total Assets', m, b) - bs('Total Liabilities & Equity', m, b)) < 0.05, ('bs', m, b)
        ops = ['Net Income', 'Depreciation and Amortization', 'Convertible Note Interest Accrual', 'Change in Accounts Receivable', 'Changes in Prepaid Expenses', 'Change in Other Current Assets', 'Change in Accounts Payable', 'Changes to Accrued Liabilities', 'Changes to Deferred Revenue', 'Change in Other Current Liabilities', 'Changes to Credit Card Balances']
        assert abs(sum(cf(n, m, b) for n in ops) - cf('Cash Flow from Operating Activities', m, b)) < 0.06, ('cfo', m, b)
        assert abs(cf('Cash & Equivalents, Opening Balance', m, b) + cf('Change in Cash & Equivalents', m, b) - cf('Cash & Equivalents, Closing Balance', m, b)) < 0.05, ('cash', m, b)
        assert abs(cf('Cash & Equivalents, Closing Balance', m, b) - bs('Cash & Equivalents', m, b)) < 0.05, ('cash-bs', m, b)
        assert abs(cf('Net Income', m, b) - pl('Net Income', m, b)) < 0.05, ('ni', m, b)
        if m < CLOSE or m == '2026-08': pass
for m in ['2026-07', '2026-08']:  # the CF summary read for H1 and the quarter read agree where they overlap
    for n in CFL: assert abs(YA[n][YAC[m]] - cf(n, m, 'actual')) < 0.05, ('overlap', n, m)
for m in [x for x in M if x > CLOSE]:  # Upside: the P&L read and the forecast summary agree
    assert abs(MSF['Total Revenue'][MSC[m]] - pl('Total Revenue', m, 'upside')) < 0.05 and abs(MSF['EBITDA'][MSC[m]] - pl('EBITDA', m, 'upside')) < 0.05, m
prev = {r['month']: r for r in json.load(open(os.path.join(OUT, 'fin_review.json'))) if r['kind'] == 'month'}
for r in fr:  # months already closed and published must not move
    if r['kind'] == 'month' and prev.get(r['month'], {}).get('revenue') is not None:
        for k in ('revenue', 'cogs', 'opex', 'ebitda', 'budget_revenue', 'budget_ebitda'): assert abs(prev[r['month']][k] - r[k]) < 0.01, ('moved', r['month'], k)
json.dump(out, open(os.path.join(OUT, 'fin_statements.json'), 'w'))
json.dump(fr, open(os.path.join(OUT, 'fin_review.json'), 'w'), indent=1)
print('fin_statements', len(out), 'rows; fin_review', len(fr), 'rows; close', CLOSE, '; all checks pass')
