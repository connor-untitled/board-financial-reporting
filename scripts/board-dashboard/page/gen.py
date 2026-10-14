import html
def card(cid, title, ds, img=True, table=True, extra='', tbl=None):
    btn=('<button type="button" data-copy="image">Copy image</button>' if img else '')+('<button type="button" data-copy="table">Copy table</button>' if table else '')
    if tbl:
        key, cols = tbl
        ths=''.join(f'<th data-field="{f}">{l}</th>' for f,l in cols)
        body=f'<div class="ub-body" data-ds="{ds}"><div class="ub-tablewrap ub-tablewrap-tall"><table class="ub-table ub-left" data-ds-table="{ds.split()[0]}" data-row-key="{key}"><thead><tr>{ths}</tr></thead><tbody></tbody></table></div></div>'
    else:
        body=f'<div class="ub-body dash-skeleton" data-ds="{ds}"></div>'
    return f'''
    <div class="ub-card" id="{cid}">
      <div class="ub-card-head"><div><h3 class="ub-card-title">{html.escape(title)}</h3><p class="ub-card-period"></p></div><div class="ub-actions">{btn}</div></div>
      <p class="ub-changed" hidden></p>{extra}
      {body}
    </div>'''
seg=lambda cls,label,opts: f'<div class="ub-seg {cls}" role="group" aria-label="{label}">'+''.join(f'<button type="button" data-v="{v}">{t}</button>' for v,t in opts)+'</div>'
grid=lambda *c: '<div class="ub-grid2">'+''.join(c)+'</div>'
pages={
'overview':['Overview', card('c-highlights','Highlights','kpi booking_totals mrr_windows end_clients')+card('c-headline','Headline numbers','mrr_windows revenue_windows booking_totals')+grid(card('c-goals','Progress on 2026 goals','goals end_clients revenue kpi'),card('c-mrrdef','What we mean by MRR','kpi revenue'))+card('c-ov-book','Cumulative software bookings, day by day','booking_daily')],
'revenue':['Revenue and MRR', card('c-revmix','Monthly revenue by line','revenue')+card('c-swsvc','Software vs services revenue','revenue revenue_windows')+card('c-revdetail','Revenue detail','revenue revenue_windows')+grid(card('c-mrrtrend','Subscription and services MRR at month end','kpi mrr_windows'),card('c-bridge','MRR bridge','mrr_windows churn_log',extra=seg('ub-seg-channel','Channel',[('Total','Total'),('Direct','Direct'),('Reseller','Reseller')])))],
'sales':['Sales and pipeline', card('c-salestiles','Sales KPIs','booking_totals revenue bookings')+card('c-bookmonth','Software bookings by month and quarter','bookings')+grid(card('c-groups','Where the TCV came from','booking_groups',extra=seg('ub-seg-dim','Split by',[('product','Product'),('channel','Channel'),('deal_type','Deal type')])),card('c-dealmix','Deal mix','bookings booking_totals'))+card('c-cumulative','Cumulative software bookings, day by day','booking_daily')+card('c-topdeals','Largest deals in the period','bookings booking_totals',img=False,tbl=('deal',[('client','Client'),('date','Signed'),('product','Product'),('channel','Channel'),('deal_type','Type'),('tcv','TCV'),('mrr','MRR')]))+card('c-pipeline','Open pipeline by stage','pipeline_open booking_totals')+card('c-pipetable','Pipeline snapshot','pipeline_open')+card('c-pipemove','Pipeline created, won and lost','pipeline_windows')],
'resellers':['Resellers and customers', card('c-endclients','Reseller end-client growth','end_clients reseller_history revenue')+card('c-custdeck','Monthly active customers','kpi')+card('c-customers','Active customers by channel','kpi mrr_windows')],
'churn':['Churn and retention', card('c-retention','Retention','mrr_windows churn_log')+card('c-churnsum','Churn summary','churn_log')+grid(card('c-churnmrr','Lost MRR by month','kpi'),card('c-reasons','Why customers left','churn_log'))+card('c-churnlog','Who churned and why','churn_log',img=False,tbl=('log_row',[('customer','Customer'),('churn_month','Month'),('channel','Channel'),('mrr','MRR'),('reason_category','Reason category'),('reason','Reason')]))],
'marketing':['Marketing', card('c-mqls','MQLs by month and source','mqls')+grid(card('c-mqlchannels','MQLs by channel','mqls kpi'),card('c-funnel','Funnel','funnel_windows'))],
}
PRESETS=[('l90','Last 90 days'),('mtd','Month to date'),('last_m','Last month'),('qtd','Quarter to date'),('last_q','Last quarter'),('ytd','Year to date'),('l12m','Last 12 months'),('last_y','Last year'),('custom','Custom range')]
gloss=[('MRR (subscription)','Monthly recurring revenue from platform licenses at month end, from Stripe via the KPI sheet. The headline MRR on this dashboard.'),
('Services retainer','The flat monthly web services retainer, reported beside subscription MRR, not inside it.'),
('Total MRR','Subscription MRR plus services retainer plus month-end consumption and DSP run rate. The comparable figure to the "MRR" in earlier decks.'),
('Usage revenue','Consumption (per-resolution fees), DSP (media campaigns) and direct mail.'),
('Recurring revenue','Revenue recognized in the period from subscription, usage and services retainer. Leaves out one-off services projects.'),
('Net new MRR','Ending MRR minus beginning MRR for the period: new plus expansion plus reactivation, minus contraction and cancellation.'),
('Expansion / contraction','An existing customer paying more or less per month than before.'),
('Reactivation','A former customer returning.'),
('Aug. rebase',"A one-time true-up in August 2026 when the KPI sheet's running balance was reset to Stripe. Shown as published."),
('Gross / net $ retention','The share of starting MRR kept each month, averaged over the period. Gross counts only losses; net also adds expansion.'),
('TCV','Total contract value: the full value of a signed deal over its term.'),
('Bookings','Software TCV signed in the period, by signed date, from the Wins tab. Services projects are left out.'),
('New logo',"A customer's first New software deal since January 2025. Each customer counts once."),
('Reseller / Direct','Reseller deals come through agencies that resell Untitled to their clients; Direct deals are brands buying for themselves.'),
('Reseller end clients','Clients of our resellers with 10 or more resolutions in the month.'),
('MQL','Marketing qualified lead: a new HubSpot contact from search, email, social or AI referrals, excluding gmail.com addresses.'),
('Pipeline blocks','Direct and Reseller are the Opportunity and Enterprise pipelines split by account type; Expansion is upsells to existing customers. "Account type not set" is a deal not yet tagged in HubSpot.')]
gl='<div class="ub-card" id="c-glossary"><div class="ub-card-head"><div><h3 class="ub-card-title">Glossary</h3><p class="ub-card-period">Definitions used on every card</p></div></div><dl class="ub-gloss">'+''.join(f'<div><dt>{html.escape(a)}</dt><dd>{html.escape(b)}</dd></div>' for a,b in gloss)+'</dl></div>'
internal=card('c-mayfollow','Board follow-up: deals highlighted in the May 2026 deck','may_pipeline',img=False,tbl=('deal',[('deal','Deal'),('may_pipeline','May pipeline'),('may_value','May value'),('status_now','Status now'),('value_now','Value now'),('expected_close','Close date')]))+card('c-sources','Sources and refresh','snapshot_info',img=False,tbl=('source',[('label','Source'),('as_of','As of'),('covers','Covers'),('refresh','Refresh')]))+card('c-checks','Data checks behind this dashboard','checks',img=False,tbl=('item',[('check','Check'),('item','Item'),('status','Status'),('finding','Finding')]))
tabs=list(pages.items())+[('glossary',['Glossary',gl]),('internal',['Internal: data and sources','<p class="ub-internal-note">For the team only. Nothing on this tab goes in the board deck.</p>'+internal])]
css=open('style.css').read()
out=f'''<style>
{css}
</style>

<div id="ub" data-theme="light">
  <header class="ub-head">
    <div class="ub-eyebrow-row">Untitled · Board reporting · <span class="ub-periodlabel"></span></div>
    <h1>Untitled Board Reporting</h1>
    <p class="ub-takeaway dash-skeleton">—</p>
    <p class="ub-asof">Data as of <span class="ub-asofdate">the latest refresh</span>. Sources and refresh details are on the Internal tab and in the Sources panel.</p>
    <p class="ub-closenote" hidden></p>
    <div class="ub-controls">
      <div class="ub-control"><span class="ub-control-label">Date range</span>
        <div class="ub-range">
          <select class="ub-preset" aria-label="Date range">{''.join(f'<option value="{v}">{l}</option>' for v, l in PRESETS)}</select>
          <input type="date" class="ub-start" aria-label="Start date"><span class="ub-range-to">to</span><input type="date" class="ub-end" aria-label="End date">
        </div>
      </div>
      <div class="ub-control"><span class="ub-control-label">Compare with</span>{seg('ub-seg-cmp','Compare with',[('prior','Previous period'),('yoy','Same period last year')])}<span class="ub-cmplabel"></span></div>
      <div class="ub-control"><span class="ub-control-label">Live sources</span>{seg('ub-seg-data','Live sources',[('frozen','Board snapshot'),('live','Live')])}</div>
      <div class="ub-control"><span class="ub-control-label">Theme</span>{seg('ub-seg-theme','Theme',[('light','Light'),('dark','Dark')])}</div>
    </div>
    <nav class="ub-tabs" aria-label="Sections">{''.join(f'<button type="button" data-tab="{k}">{v[0]}</button>' for k,v in tabs)}</nav>
  </header>
{''.join(f'<section class="ub-page" id="{k}" hidden>{v[1]}</section>' for k,v in tabs)}
</div>
<script src="font.js"></script>
<script src="core.js"></script>
<script src="calcs.js"></script>
<script src="app.js"></script>
'''
open('index.html','w').write(out)
print(len(out))
