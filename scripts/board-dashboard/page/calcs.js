// Metabase answers: column names plus row arrays, paired into rows.
['end_clients', 'mqls', 'pipeline_open'].forEach((id) => dash.loader(id, {
  description: 'Metabase answers with column names and row arrays; this pairs them into rows.',
  fn: ({ answer }) => {
    const a = typeof answer === 'string' ? JSON.parse(answer) : answer;
    if (!a || !a.data || !a.data.rows) throw new Error((a && (a.error || a.message)) || 'Metabase returned no rows');
    const cols = a.data.cols.map((c) => c.name);
    return { columns: cols, rows: a.data.rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]]))) };
  },
}));

// Period roll-ups. Each returns one row per period so the page can switch periods without new queries.
// Month windows: 2026 quarters, single months, year to date, and the same periods in 2025.
dash.calc('booking_totals', {
  inputs: ['bookings'],
  title: 'Bookings by period',
  description: 'Software bookings per signed-date period from the Wins tabs; services projects are left out, deals closed counts rows with contract value, and a new logo is a customer’s first New deal since January 2025.',
  fn: (bookings) => {
    const sum = (a, f) => a.reduce((t, x) => t + (+f(x) || 0), 0);
    const sw = bookings.filter((b) => b.category === 'Software');
    const d = String(Math.max(1, ...sw.filter((b) => b.date >= '2026-10-01').map((b) => +b.date.slice(8, 10)))).padStart(2, '0');
    const W = { Q1: ['2026-01-01', '2026-03-31'], Q2: ['2026-04-01', '2026-06-30'], Q3: ['2026-07-01', '2026-09-30'],
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
  fn: (kpi) => {
    const sum = (a, f) => a.reduce((t, x) => t + (+f(x) || 0), 0);
    const Q = (y, a) => [0, 1, 2].map((i) => `${y}-${String(a + i).padStart(2, '0')}`);
    const Y = (y) => [1, 2, 3, 4, 5, 6, 7, 8, 9].map((m) => `${y}-0${m}`);
    const W = { Q1: Q(2026, 1), Q2: Q(2026, 4), Q3: Q(2026, 7), Aug: ['2026-08'], Sep: ['2026-09'], YTD: Y(2026),
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
  fn: (revenue) => {
    const sum = (a, f) => a.reduce((t, x) => t + (+f(x) || 0), 0);
    const Q = (y, a) => [0, 1, 2].map((i) => `${y}-${String(a + i).padStart(2, '0')}`);
    const Y = (y) => [1, 2, 3, 4, 5, 6, 7, 8, 9].map((m) => `${y}-0${m}`);
    const W = { Q1: Q(2026, 1), Q2: Q(2026, 4), Q3: Q(2026, 7), Aug: ['2026-08'], Sep: ['2026-09'], YTD: Y(2026),
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
  fn: (kpi) => {
    const sum = (a, f) => a.reduce((t, x) => t + (+f(x) || 0), 0);
    const Q = (y, a) => [0, 1, 2].map((i) => `${y}-${String(a + i).padStart(2, '0')}`);
    const Y = (y) => [1, 2, 3, 4, 5, 6, 7, 8, 9].map((m) => `${y}-0${m}`);
    const W = { Q1: Q(2026, 1), Q2: Q(2026, 4), Q3: Q(2026, 7), Aug: ['2026-08'], Sep: ['2026-09'], YTD: Y(2026),
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
  inputs: ['mqls', 'kpi'],
  title: 'Funnel by period (live)',
  description: 'MQLs from HubSpot via Metabase, opportunities and new customers from the KPI sheet, per period.',
  fn: (mqls, kpi) => {
    const sum = (a, f) => a.reduce((t, x) => t + (+f(x) || 0), 0);
    const Q = (y, a) => [0, 1, 2].map((i) => `${y}-${String(a + i).padStart(2, '0')}`);
    const Y = (y) => [1, 2, 3, 4, 5, 6, 7, 8, 9].map((m) => `${y}-0${m}`);
    const W = { Q1: Q(2026, 1), Q2: Q(2026, 4), Q3: Q(2026, 7), Aug: ['2026-08'], Sep: ['2026-09'], YTD: Y(2026),
      Q1_25: Q(2025, 1), Q2_25: Q(2025, 4), Q3_25: Q(2025, 7), Sep_25: ['2025-09'], YTD_25: Y(2025) };
    const out = [];
    Object.entries(W).forEach(([period, ms]) => {
      const k = kpi.filter((x) => ms.includes(x.month));
      out.push({ period, stage: 'MQLs', value: sum(mqls.filter((x) => ms.includes(x.month)), (x) => x.mqls) });
      out.push({ period, stage: 'New opportunities', value: sum(k, (x) => x.opps_new) });
      out.push({ period, stage: 'Opportunities won', value: sum(k, (x) => x.opps_won) });
      out.push({ period, stage: 'New customers', value: sum(k, (x) => x.customers_new) });
    });
    return out;
  },
});

dash.calc('funnel_windows_frozen', {
  inputs: ['mqls_frozen', 'kpi'],
  title: 'Funnel by period (board snapshot)',
  description: 'As the live funnel, with MQLs as they stood on October 13, 2026.',
  fn: (mqls_frozen, kpi) => {
    const sum = (a, f) => a.reduce((t, x) => t + (+f(x) || 0), 0);
    const Q = (y, a) => [0, 1, 2].map((i) => `${y}-${String(a + i).padStart(2, '0')}`);
    const Y = (y) => [1, 2, 3, 4, 5, 6, 7, 8, 9].map((m) => `${y}-0${m}`);
    const W = { Q1: Q(2026, 1), Q2: Q(2026, 4), Q3: Q(2026, 7), Aug: ['2026-08'], Sep: ['2026-09'], YTD: Y(2026),
      Q1_25: Q(2025, 1), Q2_25: Q(2025, 4), Q3_25: Q(2025, 7), Sep_25: ['2025-09'], YTD_25: Y(2025) };
    const out = [];
    Object.entries(W).forEach(([period, ms]) => {
      const k = kpi.filter((x) => ms.includes(x.month));
      out.push({ period, stage: 'MQLs', value: sum(mqls_frozen.filter((x) => ms.includes(x.month)), (x) => x.mqls) });
      out.push({ period, stage: 'New opportunities', value: sum(k, (x) => x.opps_new) });
      out.push({ period, stage: 'Opportunities won', value: sum(k, (x) => x.opps_won) });
      out.push({ period, stage: 'New customers', value: sum(k, (x) => x.customers_new) });
    });
    return out;
  },
});
