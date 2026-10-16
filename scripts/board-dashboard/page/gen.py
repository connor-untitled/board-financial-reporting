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
plan_notes=["Targets are the 'Monthly sales & retention targets by channel' table in CFO.ai's Cash Forecast Q4'26-Q1'27 scenario, for whichever case is selected there. The dashboard only reads them; nothing here changes the model.",
"CFO.ai works on a last-close basis: actuals move in after the books close, usually the 15th to 20th of the following month.",
"New-customer MRR and new customers come from the Wins tabs by signed date, so the open month counts to date and its pace is the month-to-date figure scaled to the full month.",
"All new MRR is every software MRR row in the Wins tabs by signed date: new customers plus upsells, reactivations and conversions from existing customers. Its target is CFO.ai's new-customer MRR target plus its expansion MRR target. The Wins tab stays the source until sources are standardized; the KPI sheet's month-close expansion can differ from signed upsells.",
"Expansion, MRR lost, net change and ending MRR come from the KPI sheet once a month closes. Consumption comes from the revenue tabs.",
"Pipeline coverage uses HubSpot's Opportunity and Enterprise pipelines. Win rate is won over won plus lost for deals closed since August 1, when the demo-led motion started.",
"The model's opening MRR comes from its own September baseline, so it can split Direct and Reseller slightly differently from the KPI sheet's September close; compare the two before reading a small channel gap as a miss."]
plan_about='<div class="ub-card" id="c-plan-about"><div class="ub-card-head"><div><h3 class="ub-card-title">How this tracker works</h3><p class="ub-card-period">Targets from CFO.ai, read only</p></div></div><ul class="ub-plan-notes">'+''.join(f'<li>{html.escape(t)}</li>' for t in plan_notes)+'</ul></div>'
pages={
'overview':['Overview', card('c-highlights','Highlights','kpi booking_totals mrr_windows end_clients')+card('c-headline','Headline numbers','mrr_windows revenue_windows booking_totals')+grid(card('c-goals','Progress on 2026 goals','goals end_clients revenue kpi'),card('c-mrrdef','What we mean by MRR','kpi revenue'))+card('c-ov-book','Cumulative software bookings, day by day','booking_daily')],
'plan':['Plan tracker', '<p class="ub-internal-note">Plan months are fixed at October 2026 to March 2027; the date range above does not change this tab.</p>'+card('c-plan-now','This month against the plan','plan_targets plan_actuals bookings')+card('c-plan-trend','All new MRR against the plan','plan_targets plan_actuals bookings')+card('c-plan-table','Monthly scorecard','plan_targets plan_actuals')+card('c-plan-pipe','Pipeline needed this month','plan_targets plan_actuals opps_channel pipeline_open')+card('c-plan-mix','Channel mix: plan vs actual','plan_targets plan_actuals bookings kpi')+card('c-plan-july','Against the July 2026 board forecast','july_forecast',img=False,tbl=('month',[('month','Month'),('status','Status'),('deck_revenue','Revenue: July deck forecast'),('budget_revenue','Revenue: budget'),('base_revenue','Revenue: actual or Base'),('upside_revenue','Revenue: actual or Upside'),('gap','Base vs July deck'),('deck_ebitda','EBITDA: July deck'),('base_ebitda','EBITDA: actual or Base'),('deck_cash','Cash: July deck'),('base_cash','Cash: actual or Base')]))+plan_about],
'revenue':['Revenue and MRR', card('c-revmix','Monthly revenue by line','revenue')+card('c-swsvc','Software vs services revenue','revenue revenue_windows')+card('c-revdetail','Revenue detail','revenue revenue_windows')+grid(card('c-mrrtrend','Subscription and services MRR at month end','kpi mrr_windows'),card('c-bridge','MRR bridge','mrr_windows churns',extra=seg('ub-seg-channel','Channel',[('Total','Total'),('Direct','Direct'),('Reseller','Reseller')])))],
'sales':['Sales and pipeline', card('c-salestiles','Sales KPIs','booking_totals revenue bookings')+card('c-bookmonth','Software bookings by month and quarter','bookings')+grid(card('c-groups','Where the TCV came from','booking_groups',extra=seg('ub-seg-dim','Split by',[('product','Product'),('channel','Channel'),('deal_type','Deal type')])),card('c-dealmix','Deal mix','bookings booking_totals'))+card('c-cumulative','Cumulative software bookings, day by day','booking_daily')+card('c-topdeals','Largest deals in the period','bookings booking_totals',img=False,tbl=('deal',[('client','Client'),('date','Signed'),('product','Product'),('channel','Channel'),('deal_type','Type'),('tcv','TCV'),('mrr','MRR')]))+card('c-pipeline','Open pipeline by stage','pipeline_open booking_totals')+card('c-pipetable','Pipeline snapshot','pipeline_open')+card('c-pipemove','Pipeline created, won and lost','pipeline_windows')],
'resellers':['Resellers and customers', card('c-endclients','Consumption-model resellers: end clients by month','end_clients reseller_history revenue')+card('c-custdeck','Monthly active customers','kpi')+card('c-customers','Active customers by channel','kpi mrr_windows')],
'churn':['Churn and retention', card('c-retention','Retention','mrr_windows churns')+card('c-churnsum','Churn summary','churns')+card('c-churnbymonth','Churn by month','churns')+grid(card('c-churnbyplan','Churn by plan size','churns'),card('c-churnbytype','Churn by customer type and channel','churns'))+grid(card('c-churnmrr','Lost MRR by month','kpi'),card('c-reasons','Why customers left','churns'))+card('c-churnlog','Who churned and why','churns',img=False,tbl=('key',[('customer','Customer'),('churn_month','Month'),('channel','Channel'),('mrr','MRR'),('reason_category','Reason category'),('reason','Reason')]))],
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
('Reseller end clients','Clients of our resellers on the consumption pricing model with 10 or more resolutions in the month. Counted month by month.'),
('MQL','Marketing qualified lead: a new HubSpot contact from search, email, social or AI referrals, excluding gmail.com addresses.'),
('Pipeline blocks','Direct and Reseller are the Opportunity and Enterprise pipelines split by account type; Expansion is upsells to existing customers. "Account type not set" is a deal not yet tagged in HubSpot.')]
gl='<div class="ub-card" id="c-glossary"><div class="ub-card-head"><div><h3 class="ub-card-title">Glossary</h3><p class="ub-card-period">Definitions used on every card</p></div></div><dl class="ub-gloss">'+''.join(f'<div><dt>{html.escape(a)}</dt><dd>{html.escape(b)}</dd></div>' for a,b in gloss)+'</dl></div>'
internal=card('c-deckfollow','Board follow-up: pipeline highlights from the July 2026 deck','deck_pipeline',img=False,tbl=('deal',[('deal','Deal'),('deck_note','July deck note'),('est','July deck est. MRR'),('stage_now','HubSpot stage now'),('value_now','HubSpot value (TCV)'),('monthly','Value a month'),('close_date','Close date')]))+card('c-sources','Sources and refresh','snapshot_info',img=False,tbl=('source',[('label','Source'),('as_of','As of'),('covers','Covers'),('refresh','Refresh')]))+card('c-stripekpi','Stripe vs the KPI sheet, by month','stripe_vs_kpi',img=False,tbl=('month',[('month','Month'),('kpi_lost','KPI lost MRR'),('stripe_lost','Stripe lost MRR'),('lost_diff','Difference'),('kpi_churned','KPI churned'),('stripe_churned','Stripe churned'),('kpi_ending','KPI ending MRR'),('stripe_ending','Stripe ending MRR'),('ending_diff','Difference'),('status','Status')]))+card('c-checks','Data checks behind this dashboard','checks',img=False,tbl=('item',[('check','Check'),('item','Item'),('status','Status'),('finding','Finding')]))
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
