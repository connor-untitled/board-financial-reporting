// Metabase answers: column names plus row arrays, paired into rows.
['end_clients', 'mqls', 'pipeline_open', 'opps_split', 'opps_channel', 'churn_reasons', 'deck_pipeline'].forEach((id) => dash.loader(id, {
  description: 'Metabase answers with column names and row arrays; this pairs them into rows.',
  fn: ({ answer }) => {
    const a = typeof answer === 'string' ? JSON.parse(answer) : answer;
    if (!a || !a.data || !a.data.rows) throw new Error((a && (a.error || a.message)) || 'Metabase returned no rows');
    const cols = a.data.cols.map((c) => c.name);
    return { columns: cols, rows: a.data.rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]]))) };
  },
}));

// CFO.ai: the "Monthly sales & retention targets by channel" table, read only, as one row per month, channel and target.
// A second read of the scenario's "Case toggle" table names the case the targets follow.
dash.loader('plan_targets', {
  description: 'CFO.ai answers a table as columns (months) and rows (each target, then its Direct and Reseller members); this makes one row per month, channel and target and adds the case selected in the scenario.',
  fn: async ({ answer, call, args }) => {
    const a = typeof answer === 'string' ? JSON.parse(answer) : answer;
    if (!a || !Array.isArray(a.rows) || !Array.isArray(a.columns)) throw new Error((a && (a.error || a.message)) || 'CFO.ai returned no table');
    const KEY = { 'Target Opening Subscription MRR': 'opening', 'Target Net Subscription MRR Growth': 'net_growth', 'Target Billing Lapse Allowance': 'lapse',
      'Target Total Subscription Loss Allowance': 'lost', 'Target Expansion MRR': 'expansion', 'Target Required New Customer MRR': 'new_mrr',
      'Target Estimated New Customer Wins': 'wins', 'Target Ending Subscription MRR': 'ending', 'Target Consumption Revenue': 'consumption' };
    const months = a.columns.map((c) => String(c.ref || '').slice(0, 7));
    const val = (v) => (v && typeof v === 'object' ? v.value : v);
    const out = [];
    let metric = null;
    a.rows.forEach((r) => {
      if (r.variable) metric = KEY[r.display_name] || null;
      if (!metric || !Array.isArray(r.values)) return;
      const channel = r.member || (r.variable ? 'Total' : null);
      if (channel !== 'Total' && channel !== 'Direct' && channel !== 'Reseller') return;
      r.values.forEach((v, i) => { const x = val(v); if (x != null && x !== '' && /^\d{4}-\d{2}$/.test(months[i])) out.push({ month: months[i], channel, metric, value: +x }); });
    });
    if (!out.length) throw new Error('CFO.ai answered, but the targets table had no monthly values');
    let pickCase = null;
    try {
      const t = await call('inspect_table_blocks', { read: { target: 'Case toggle#d56', scenario: args.read.scenario, comparison: 'none', format: 'json' } });
      const tt = typeof t === 'string' ? JSON.parse(t) : t;
      const row = ((tt && tt.rows) || []).find((r) => r.member === 'Active');
      if (row) pickCase = row.values.map(val).filter((v) => typeof v === 'string' && v).pop() || null;
    } catch (e) { pickCase = null; }
    out.forEach((r) => { r.case = pickCase; });
    return { columns: ['month', 'channel', 'metric', 'value', 'case'], rows: out,
      meta: [{ label: 'Scenario', value: String(a.scenario || '') }, { label: 'Case selected in CFO.ai', value: pickCase || 'Not read' }, { label: 'CFO.ai table', value: (a.table && a.table.display_name) || 'Monthly sales & retention targets by channel' }] };
  },
});

// The page reruns the period calcs on the range picked in the date control: each fn takes an optional
// window map ({ __ub: true, w }) as its last argument and falls back to the fixed board windows below when called by the dashboard.
if (typeof window !== 'undefined') {
  window.UBC = {};
  const reg = dash.calc;
  dash.calc = (name, def) => { window.UBC[name] = def.fn; return reg.call(dash, name, def); };
}

// Period roll-ups. Each returns one row per period so the page can switch periods without new queries.
// Month windows: 2026 quarters, single months, year to date, and the same periods in 2025.
dash.calc('booking_totals', {
  inputs: ['bookings'],
  title: 'Bookings by period',
  description: 'Software bookings per signed-date period from the Wins tabs; services projects are left out, deals closed counts rows with contract value, and a new logo is a customer’s first New deal since January 2025.',
  fn: (bookings, W) => {
    const sum = (a, f) => a.reduce((t, x) => t + (+f(x) || 0), 0);
    const sw = bookings.filter((b) => b.category === 'Software');
    const d = String(Math.max(1, ...sw.filter((b) => b.date >= '2026-10-01').map((b) => +b.date.slice(8, 10)))).padStart(2, '0');
    W = W && W.__ub ? W.w : { Q1: ['2026-01-01', '2026-03-31'], Q2: ['2026-04-01', '2026-06-30'], Q3: ['2026-07-01', '2026-09-30'],
      Oct: ['2026-10-01', '2026-10-' + d], SepTD: ['2026-09-01', '2026-09-' + d], YTD: ['2026-01-01', '2026-10-' + d],
      Q1_25: ['2025-01-01', '2025-03-31'], Q2_25: ['2025-04-01', '2025-06-30'], Q3_25: ['2025-07-01', '2025-09-30'],
      Oct_25: ['2025-10-01', '2025-10-' + d], YTD_25: ['2025-01-01', '2025-10-' + d],
      Q3O: ['2026-07-01', '2026-10-' + d], Q2O: ['2026-04-01', '2026-07-' + d], Q3O_25: ['2025-07-01', '2025-10-' + d] };
    return Object.entries(W).map(([period, [a, z]]) => {
      const r = sw.filter((b) => b.date >= a && b.date <= z);
      const deals = r.filter((b) => b.tcv > 0).length, tcv = sum(r, (b) => b.tcv);
      return { period, start: a, end: z, tcv, deals, avg_deal: deals ? tcv / deals : 0, contracted_mrr: sum(r, (b) => b.mrr),
        dsp: sum(r, (b) => b.dsp_revenue), mail: sum(r, (b) => b.mail_revenue), new_logos: r.filter((b) => b.new_logo).length,
        reseller_tcv: sum(r.filter((b) => b.channel === 'Reseller'), (b) => b.tcv) };
    });
  },
});

dash.calc('booking_groups', {
  inputs: ['booking_totals', 'bookings'],
  title: 'Bookings by product, channel and deal type',
  description: 'Software TCV per period split three ways.',
  fn: (booking_totals, bookings) => {
    const out = [];
    booking_totals.forEach((p) => {
      const r = bookings.filter((b) => b.category === 'Software' && b.date >= p.start && b.date <= p.end);
      ['product', 'channel', 'deal_type'].forEach((dim) => {
        const m = {};
        r.forEach((b) => { m[b[dim]] = (m[b[dim]] || 0) + b.tcv; });
        Object.entries(m).forEach(([group, tcv]) => out.push({ period: p.period, dimension: dim, group, tcv }));
      });
    });
    return out;
  },
});

dash.calc('booking_daily', {
  inputs: ['booking_totals', 'bookings'],
  title: 'Cumulative bookings by day',
  description: 'Running software TCV from day 1 of each period.',
  fn: (booking_totals, bookings) => {
    const out = [], by = {};
    bookings.filter((b) => b.category === 'Software').forEach((b) => { by[b.date] = (by[b.date] || 0) + b.tcv; });
    booking_totals.forEach((p) => {
      const a = new Date(p.start + 'T00:00:00Z'), z = new Date(p.end + 'T00:00:00Z');
      const days = Math.round((z - a) / 864e5) + 1;
      let run = 0;
      for (let i = 0; i < days; i++) {
        const day = new Date(+a + i * 864e5).toISOString().slice(0, 10);
        run += by[day] || 0;
        out.push({ period: p.period, day: i + 1, date: day, tcv: run });
      }
    });
    return out;
  },
});

dash.calc('mrr_windows', {
  inputs: ['kpi'],
  title: 'MRR movement and retention by period',
  description: 'Subscription and services MRR movements summed over each period from the KPI sheet as published. Adjustment is the August 2026 Stripe rebase. Retention is the average monthly dollar retention from the KPI sheet: 1 minus its gross (or net) monthly $ churn rate, averaged over the months in the period.',
  fn: (kpi, W) => {
    const sum = (a, f) => a.reduce((t, x) => t + (+f(x) || 0), 0);
    const Q = (y, a) => [0, 1, 2].map((i) => `${y}-${String(a + i).padStart(2, '0')}`);
    const Y = (y) => [1, 2, 3, 4, 5, 6, 7, 8, 9].map((m) => `${y}-0${m}`);
    W = W && W.__ub ? W.w : { Q1: Q(2026, 1), Q2: Q(2026, 4), Q3: Q(2026, 7), Aug: ['2026-08'], Sep: ['2026-09'], YTD: Y(2026),
      Q1_25: Q(2025, 1), Q2_25: Q(2025, 4), Q3_25: Q(2025, 7), Sep_25: ['2025-09'], YTD_25: Y(2025) };
    const C = { Total: ['sub_', 'customers_'], Direct: ['direct_', 'direct_customers_'], Reseller: ['reseller_', 'resellers_'] };
    const out = [];
    Object.entries(W).forEach(([period, ms]) => {
      const rows = kpi.filter((k) => ms.includes(k.month));
      if (!rows.length) return;
      const first = rows[0], last = rows[rows.length - 1];
      Object.entries(C).forEach(([channel, [m, c]]) => {
        const s = (f) => sum(rows, (k) => k[m + f]);
        const beginning = first[m + 'beginning'], services = channel === 'Reseller' ? 0 : last.services_retainer_mrr;
        const lost = s('contraction') + s('cancellation'), gained = s('expansion') + s('reactivation');
        out.push({ period, channel, beginning, new: s('new'), expansion: s('expansion'), reactivation: s('reactivation'),
          contraction: s('contraction'), cancellation: s('cancellation'), ending: last[m + 'ending'],
          adjustment: last[m + 'ending'] - (beginning + s('new') + gained - lost),
          net_new: last[m + 'ending'] - beginning, services_retainer: services, license_ending: last[m + 'ending'] - services,
          gross_retention: channel === 'Total' ? 1 - sum(rows, (k) => k.gross_usd_churn_rate) / rows.length : null,
          net_retention: channel === 'Total' ? 1 - sum(rows, (k) => k.net_usd_churn_rate) / rows.length : null,
          customers_beginning: first[c + 'beginning'], customers_new: sum(rows, (k) => k[c + 'new']),
          customers_churned: sum(rows, (k) => k[c + 'churned']), customers_ending: last[c + 'ending'],
          avg_mrr_per_customer: channel === 'Total' ? last.avg_mrr_per_customer : null,
          blended_mrr: channel === 'Total' ? last.blended_mrr : null, consumption_mrr: channel === 'Total' ? last.consumption_kpi : null,
          dsp_mrr: channel === 'Total' ? last.dsp_kpi : null });
      });
    });
    return out;
  },
});

dash.calc('revenue_windows', {
  inputs: ['revenue'],
  title: 'Revenue by period',
  description: 'Revenue per line summed over each period. Recurring is subscription plus usage (consumption, DSP, mail) plus services retainer; services projects are left out.',
  fn: (revenue, W) => {
    const sum = (a, f) => a.reduce((t, x) => t + (+f(x) || 0), 0);
    const Q = (y, a) => [0, 1, 2].map((i) => `${y}-${String(a + i).padStart(2, '0')}`);
    const Y = (y) => [1, 2, 3, 4, 5, 6, 7, 8, 9].map((m) => `${y}-0${m}`);
    W = W && W.__ub ? W.w : { Q1: Q(2026, 1), Q2: Q(2026, 4), Q3: Q(2026, 7), Aug: ['2026-08'], Sep: ['2026-09'], YTD: Y(2026),
      Q1_25: Q(2025, 1), Q2_25: Q(2025, 4), Q3_25: Q(2025, 7), Sep_25: ['2025-09'], YTD_25: Y(2025) };
    return Object.entries(W).map(([period, ms]) => {
      const r = revenue.filter((x) => ms.includes(x.month));
      const s = (f) => sum(r, (x) => x[f]);
      const usage = s('consumption') + s('dsp') + s('mail');
      return { period, subscription: s('subscription'), consumption: s('consumption'), dsp: s('dsp'), mail: s('mail'), usage,
        services_retainer: s('services_retainer'), recurring_total: s('subscription') + usage + s('services_retainer'),
        services_projects: s('services_projects') };
    });
  },
});

dash.calc('pipeline_windows', {
  inputs: ['kpi'],
  title: 'Pipeline movement by period',
  description: 'HubSpot pipeline created, won, lost and ending value per block, from the KPI sheet.',
  fn: (kpi, W) => {
    const sum = (a, f) => a.reduce((t, x) => t + (+f(x) || 0), 0);
    const Q = (y, a) => [0, 1, 2].map((i) => `${y}-${String(a + i).padStart(2, '0')}`);
    const Y = (y) => [1, 2, 3, 4, 5, 6, 7, 8, 9].map((m) => `${y}-0${m}`);
    W = W && W.__ub ? W.w : { Q1: Q(2026, 1), Q2: Q(2026, 4), Q3: Q(2026, 7), Aug: ['2026-08'], Sep: ['2026-09'], YTD: Y(2026),
      Q1_25: Q(2025, 1), Q2_25: Q(2025, 4), Q3_25: Q(2025, 7), Sep_25: ['2025-09'], YTD_25: Y(2025) };
    const P = { Direct: 'direct_pipe_', Reseller: 'reseller_pipe_', 'Expansion (existing customers)': 'upsell_pipe_' };
    const out = [];
    Object.entries(W).forEach(([period, ms]) => {
      const rows = kpi.filter((k) => ms.includes(k.month));
      if (!rows.length) return;
      Object.entries(P).forEach(([block, p]) => out.push({ period, block, beginning: rows[0][p + 'beginning'],
        created: sum(rows, (k) => k[p + 'created']), won: sum(rows, (k) => k[p + 'won']),
        lost: sum(rows, (k) => k[p + 'lost']), ending: rows[rows.length - 1][p + 'ending'] }));
    });
    return out;
  },
});

dash.calc('funnel_windows', {
  inputs: ['mqls', 'kpi', 'opps_split'],
  title: 'Funnel by period (live)',
  description: 'MQLs from HubSpot via Metabase, opportunities and new customers from the KPI sheet, per period. Below new opportunities, HubSpot deals created in the period split into marketing-sourced new business, other new business and expansion (rows with sub = true); HubSpot counts deals moved in after month end, so the split can total more than the KPI sheet.',
  fn: (mqls, kpi, opps_split, W) => {
    const sum = (a, f) => a.reduce((t, x) => t + (+f(x) || 0), 0);
    const Q = (y, a) => [0, 1, 2].map((i) => `${y}-${String(a + i).padStart(2, '0')}`);
    const Y = (y) => [1, 2, 3, 4, 5, 6, 7, 8, 9].map((m) => `${y}-0${m}`);
    W = W && W.__ub ? W.w : { Q1: Q(2026, 1), Q2: Q(2026, 4), Q3: Q(2026, 7), Aug: ['2026-08'], Sep: ['2026-09'], YTD: Y(2026),
      Q1_25: Q(2025, 1), Q2_25: Q(2025, 4), Q3_25: Q(2025, 7), Sep_25: ['2025-09'], YTD_25: Y(2025) };
    const out = [];
    Object.entries(W).forEach(([period, ms]) => {
      const k = kpi.filter((x) => ms.includes(x.month));
      out.push({ period, stage: 'MQLs', value: sum(mqls.filter((x) => ms.includes(x.month)), (x) => x.mqls) });
      out.push({ period, stage: 'New opportunities', value: sum(k, (x) => x.opps_new) });
      ['Marketing-sourced new business', 'Other new business', 'Expansion'].forEach((b) =>
        out.push({ period, stage: b, sub: true, value: sum(opps_split.filter((x) => x.bucket === b && ms.includes(x.month)), (x) => x.deals) }));
      out.push({ period, stage: 'Opportunities won', value: sum(k, (x) => x.opps_won) });
      out.push({ period, stage: 'New customers', value: sum(k, (x) => x.customers_new) });
    });
    return out;
  },
});

dash.calc('funnel_windows_frozen', {
  inputs: ['mqls_frozen', 'kpi', 'opps_split_frozen'],
  title: 'Funnel by period (board snapshot)',
  description: 'As the live funnel, with MQLs as they stood on October 13, 2026 and the opportunity split as it stood on October 14, 2026.',
  fn: (mqls_frozen, kpi, opps_split, W) => {
    const sum = (a, f) => a.reduce((t, x) => t + (+f(x) || 0), 0);
    const Q = (y, a) => [0, 1, 2].map((i) => `${y}-${String(a + i).padStart(2, '0')}`);
    const Y = (y) => [1, 2, 3, 4, 5, 6, 7, 8, 9].map((m) => `${y}-0${m}`);
    W = W && W.__ub ? W.w : { Q1: Q(2026, 1), Q2: Q(2026, 4), Q3: Q(2026, 7), Aug: ['2026-08'], Sep: ['2026-09'], YTD: Y(2026),
      Q1_25: Q(2025, 1), Q2_25: Q(2025, 4), Q3_25: Q(2025, 7), Sep_25: ['2025-09'], YTD_25: Y(2025) };
    const out = [];
    Object.entries(W).forEach(([period, ms]) => {
      const k = kpi.filter((x) => ms.includes(x.month));
      out.push({ period, stage: 'MQLs', value: sum(mqls_frozen.filter((x) => ms.includes(x.month)), (x) => x.mqls) });
      out.push({ period, stage: 'New opportunities', value: sum(k, (x) => x.opps_new) });
      ['Marketing-sourced new business', 'Other new business', 'Expansion'].forEach((b) =>
        out.push({ period, stage: b, sub: true, value: sum(opps_split.filter((x) => x.bucket === b && ms.includes(x.month)), (x) => x.deals) }));
      out.push({ period, stage: 'Opportunities won', value: sum(k, (x) => x.opps_won) });
      out.push({ period, stage: 'New customers', value: sum(k, (x) => x.customers_new) });
    });
    return out;
  },
});

// Plan tracker actuals, one row per month (August 2026 to March 2027) and channel. New MRR and new customers come from the
// Wins tabs by signed date, so the open month counts to date; expansion, lost MRR and MRR balances come from the KPI sheet
// once a month has closed; consumption from the revenue tabs.
dash.calc('plan_actuals', {
  inputs: ['kpi', 'bookings', 'revenue'],
  title: 'Plan tracker actuals by month',
  description: 'Per month and channel: new-customer MRR and new customers (first New software deal since January 2025, by signed date, from the Wins tabs), and for closed months the KPI sheet’s expansion, lost MRR (cancellation plus contraction), opening and ending subscription MRR, plus consumption revenue from the revenue tabs. Direct and Reseller as the KPI sheet splits them.',
  fn: (kpi, bookings, revenue) => {
    const sum = (a, f) => a.reduce((t, x) => t + (+f(x) || 0), 0);
    const months = ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'];
    const out = [];
    months.forEach((m) => {
      const k = kpi.find((x) => x.month === m && x.sub_ending != null);
      const rv = revenue.find((x) => x.month === m);
      const bk = bookings.filter((b) => b.category === 'Software' && b.new_logo && b.date.slice(0, 7) === m);
      const through = bk.length ? bk.map((b) => b.date).sort().pop() : null;
      [['Direct', 'direct'], ['Reseller', 'reseller'], ['Total', 'sub']].forEach(([channel, p]) => {
        const b = channel === 'Total' ? bk : bk.filter((x) => x.channel === channel);
        const row = { month: m, channel, closed: !!k, through, new_mrr: sum(b, (x) => x.mrr), wins: b.length,
          expansion: null, lost: null, opening: null, ending: null, net_growth: null, consumption: null };
        if (k) {
          row.expansion = +k[p + '_expansion'] || 0;
          row.lost = (+k[p + '_cancellation'] || 0) + (+k[p + '_contraction'] || 0);
          row.opening = +k[p + '_beginning'];
          row.ending = +k[p + '_ending'];
          row.net_growth = row.ending - row.opening;
        }
        if (channel === 'Total' && rv && k) row.consumption = +rv.consumption;
        out.push(row);
      });
    });
    return out;
  },
});

// Who churned and why. Cancellations come from Stripe under the board KPI rules (stripe_churn.py), reasons from the
// HubSpot company's churn reason (matched by domain, then name, nearest churn date), then the churn log's note.
dash.calc('churns', {
  inputs: ['stripe_churns', 'churn_reasons', 'churn_log'],
  title: 'Churned customers with reasons',
  description: 'One row per customer cancellation in Stripe (January 2025 on, the KPI sheet rules), with MRR lost, plan size, start and end dates, and a reason: the HubSpot company churn reason when one is recorded, otherwise the churn log note for the same customer within two months, grouped into categories. Customer type and churn type come from the churn log where the customer is in it.',
  fn: (stripe_churns, reasons, churn_log) => {
    // Reason categories, first match wins; the same list as build_data.py's CATEGORIES.
    const CATS = [
      ['Not recorded', /^unknown$|no specific reason|really weird|^unspecified|no reason documented|no explicit reason|no churn reason recorded|no reason given/],
      ['Went unresponsive', /disengage|never particularly responsive|unresponsive|never responded/],
      ['Service miss', /customer success miss|notice that was never received|bad email send|missed communication|went to spam and was missed/],
      ['Business closed', /shut(ting)? down|closure|business has failed|sold to|disbanded|bankrupt|insolven|closing down/],
      ['Non-payment', /non-payment|no payment|overdue|ghosted payment|can't pay|non-response on payment|unpaid|stopped paying/],
      ['Lost to competitor', /competitor|rb2b|switched provider/],
      ['Compliance', /legal|compliance/],
      ['Low adoption', /low perceived need|never got well implemented|consistently make money|no longer have a need|inherited|never converted|use-case|use case|never really|didn't really engage|no buy-in|low usage|underutiliz/],
      ['Champion left', /left the company|stakeholder|champion|implementer left|cheerleader/],
      ['Budget cuts', /pe ownership|cost-cutting|cut costs|budget|discounted rate/],
      ['Business change', /agency of record|contract expir|non-renewal|downstream churn|end-client cancelled|event-based|one-off|business decline|marketing around|pivot|downsiz|pre-launch|pre-order|restructur|seasonal|paused|pause/],
      ['Product fit', /deliverability|spam|complaints/],
      ['Pricing dispute', /pricing dispute|pricing change/],
      ['Low ROI or value', /roi|justify|results|performance|value|cost/],
    ];
    const cat = (t) => { if (!t) return 'Not recorded'; const l = String(t).toLowerCase(); const c = CATS.find(([, re]) => re.test(l)); return c ? c[0] : 'Other'; };
    const nkey = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
    const mnum = (m) => +String(m).slice(0, 4) * 12 + +String(m).slice(5, 7);
    const unspecified = (t) => /^unspecified/i.test(String(t || '').trim());
    const size = (v) => (v < 500 ? 'Under $500' : v < 1000 ? '$500 to $999' : v < 1500 ? '$1,000 to $1,499' : '$1,500 and up');
    // The match nearest the churn month, so a company that churned twice gets the right note.
    const nearest = (list, month, dateOf) => list.slice().sort((a, b) => Math.abs(mnum(dateOf(a)) - mnum(month)) - Math.abs(mnum(dateOf(b)) - mnum(month)))[0];
    const hsByDomain = {}, hsByName = {}, logByName = {};
    reasons.forEach((h) => { const d = String(h.domain || '').toLowerCase(); if (d) (hsByDomain[d] = hsByDomain[d] || []).push(h); (hsByName[nkey(h.name)] = hsByName[nkey(h.name)] || []).push(h); });
    churn_log.forEach((l) => { (logByName[nkey(l.customer)] = logByName[nkey(l.customer)] || []).push(l); });
    return stripe_churns.filter((c) => c.kind === 'cancellation').map((c) => {
      const hsList = (c.domain && hsByDomain[c.domain]) || hsByName[nkey(c.customer)] || [];
      const h = hsList.length ? nearest(hsList, c.churn_month, (x) => x.churn_date || c.churn_month) : null;
      const logList = logByName[nkey(c.customer)] || [];
      const l = logList.length ? nearest(logList, c.churn_month, (x) => x.churn_month) : null;
      const logNear = l && Math.abs(mnum(l.churn_month) - mnum(c.churn_month)) <= 2 ? l : null;
      const logReason = logNear && logNear.reason && logNear.reason !== 'Not recorded' ? logNear.reason : '';
      let reason = '', source = 'None';
      if (h && !unspecified(h.churn_reason)) { reason = h.churn_reason; source = 'HubSpot'; }
      else if (logReason) { reason = logReason; source = logNear.reason_source === 'Slack' ? 'Slack' : 'Churn log'; }
      else if (h) { reason = h.churn_reason; source = 'HubSpot'; }
      const days = c.start_date && c.end_date ? Math.round((Date.parse(c.end_date) - Date.parse(c.start_date)) / 864e5) : null;
      return { key: c.key, churn_month: c.churn_month, customer: c.customer, customer_id: c.customer_id, channel: c.channel,
        mrr: c.mrr_lost, plan: size(c.mrr_lost), customer_type: (logNear && logNear.customer_type) || 'Not recorded',
        churn_type: (logNear && logNear.churn_type) || 'Not recorded', start_date: c.start_date, end_date: c.end_date, days_active: days,
        reason: reason || 'Not recorded', reason_source: source, reason_category: cat(reason), in_churn_log: !!logNear };
    });
  },
});

dash.calc('churns_frozen', {
  inputs: ['stripe_churns', 'churn_reasons_frozen', 'churn_log'],
  title: 'Churned customers with reasons (board snapshot)',
  description: 'As the live version, with HubSpot churn reasons as they stood on October 14, 2026.',
  fn: (stripe_churns, reasons, churn_log) => {
    // Reason categories, first match wins; the same list as build_data.py's CATEGORIES.
    const CATS = [
      ['Not recorded', /^unknown$|no specific reason|really weird|^unspecified|no reason documented|no explicit reason|no churn reason recorded|no reason given/],
      ['Went unresponsive', /disengage|never particularly responsive|unresponsive|never responded/],
      ['Service miss', /customer success miss|notice that was never received|bad email send|missed communication|went to spam and was missed/],
      ['Business closed', /shut(ting)? down|closure|business has failed|sold to|disbanded|bankrupt|insolven|closing down/],
      ['Non-payment', /non-payment|no payment|overdue|ghosted payment|can't pay|non-response on payment|unpaid|stopped paying/],
      ['Lost to competitor', /competitor|rb2b|switched provider/],
      ['Compliance', /legal|compliance/],
      ['Low adoption', /low perceived need|never got well implemented|consistently make money|no longer have a need|inherited|never converted|use-case|use case|never really|didn't really engage|no buy-in|low usage|underutiliz/],
      ['Champion left', /left the company|stakeholder|champion|implementer left|cheerleader/],
      ['Budget cuts', /pe ownership|cost-cutting|cut costs|budget|discounted rate/],
      ['Business change', /agency of record|contract expir|non-renewal|downstream churn|end-client cancelled|event-based|one-off|business decline|marketing around|pivot|downsiz|pre-launch|pre-order|restructur|seasonal|paused|pause/],
      ['Product fit', /deliverability|spam|complaints/],
      ['Pricing dispute', /pricing dispute|pricing change/],
      ['Low ROI or value', /roi|justify|results|performance|value|cost/],
    ];
    const cat = (t) => { if (!t) return 'Not recorded'; const l = String(t).toLowerCase(); const c = CATS.find(([, re]) => re.test(l)); return c ? c[0] : 'Other'; };
    const nkey = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
    const mnum = (m) => +String(m).slice(0, 4) * 12 + +String(m).slice(5, 7);
    const unspecified = (t) => /^unspecified/i.test(String(t || '').trim());
    const size = (v) => (v < 500 ? 'Under $500' : v < 1000 ? '$500 to $999' : v < 1500 ? '$1,000 to $1,499' : '$1,500 and up');
    // The match nearest the churn month, so a company that churned twice gets the right note.
    const nearest = (list, month, dateOf) => list.slice().sort((a, b) => Math.abs(mnum(dateOf(a)) - mnum(month)) - Math.abs(mnum(dateOf(b)) - mnum(month)))[0];
    const hsByDomain = {}, hsByName = {}, logByName = {};
    reasons.forEach((h) => { const d = String(h.domain || '').toLowerCase(); if (d) (hsByDomain[d] = hsByDomain[d] || []).push(h); (hsByName[nkey(h.name)] = hsByName[nkey(h.name)] || []).push(h); });
    churn_log.forEach((l) => { (logByName[nkey(l.customer)] = logByName[nkey(l.customer)] || []).push(l); });
    return stripe_churns.filter((c) => c.kind === 'cancellation').map((c) => {
      const hsList = (c.domain && hsByDomain[c.domain]) || hsByName[nkey(c.customer)] || [];
      const h = hsList.length ? nearest(hsList, c.churn_month, (x) => x.churn_date || c.churn_month) : null;
      const logList = logByName[nkey(c.customer)] || [];
      const l = logList.length ? nearest(logList, c.churn_month, (x) => x.churn_month) : null;
      const logNear = l && Math.abs(mnum(l.churn_month) - mnum(c.churn_month)) <= 2 ? l : null;
      const logReason = logNear && logNear.reason && logNear.reason !== 'Not recorded' ? logNear.reason : '';
      let reason = '', source = 'None';
      if (h && !unspecified(h.churn_reason)) { reason = h.churn_reason; source = 'HubSpot'; }
      else if (logReason) { reason = logReason; source = logNear.reason_source === 'Slack' ? 'Slack' : 'Churn log'; }
      else if (h) { reason = h.churn_reason; source = 'HubSpot'; }
      const days = c.start_date && c.end_date ? Math.round((Date.parse(c.end_date) - Date.parse(c.start_date)) / 864e5) : null;
      return { key: c.key, churn_month: c.churn_month, customer: c.customer, customer_id: c.customer_id, channel: c.channel,
        mrr: c.mrr_lost, plan: size(c.mrr_lost), customer_type: (logNear && logNear.customer_type) || 'Not recorded',
        churn_type: (logNear && logNear.churn_type) || 'Not recorded', start_date: c.start_date, end_date: c.end_date, days_active: days,
        reason: reason || 'Not recorded', reason_source: source, reason_category: cat(reason), in_churn_log: !!logNear };
    });
  },
});

// Stripe under the KPI rules against the KPI sheet as published, month by month. The published sheet stays the board's
// source for totals until the year-end rebase; this shows what that restatement would change.
dash.calc('stripe_vs_kpi', {
  inputs: ['stripe_monthly', 'kpi'],
  title: 'Stripe vs the KPI sheet by month',
  description: 'Per month from January 2025: lost MRR (cancellation plus contraction), ending subscription MRR and customers churned, from the KPI sheet as published and from Stripe under the same rules (stripe_churn.py), with the difference.',
  fn: (stripe_monthly, kpi) => {
    const out = [];
    const months = [...new Set(stripe_monthly.map((r) => r.month))].sort();
    months.forEach((m) => {
      const s = stripe_monthly.filter((r) => r.month === m), k = kpi.find((r) => r.month === m && r.sub_ending != null);
      if (!k) return;
      const sum = (f) => s.reduce((t, r) => t + (+f(r) || 0), 0);
      const sLost = sum((r) => r.cancellation + r.contraction), kLost = (+k.sub_cancellation || 0) + (+k.sub_contraction || 0);
      const sEnd = sum((r) => r.ending), kEnd = +k.sub_ending, sN = sum((r) => r.customers_churned), kN = +k.customers_churned || 0;
      const churnSame = Math.abs(sLost - kLost) < 1 && sN === kN, endSame = Math.abs(sEnd - kEnd) < 1;
      out.push({ month: m, kpi_lost: kLost, stripe_lost: Math.round(sLost * 100) / 100, lost_diff: Math.round((sLost - kLost) * 100) / 100,
        kpi_ending: kEnd, stripe_ending: Math.round(sEnd * 100) / 100, ending_diff: Math.round((sEnd - kEnd) * 100) / 100,
        kpi_churned: kN, stripe_churned: sN,
        status: churnSame ? (endSame ? 'Matches' : 'Churn matches; ending MRR differs') : (endSame ? 'Churn differs' : 'Churn and ending MRR differ') });
    });
    return out;
  },
});
