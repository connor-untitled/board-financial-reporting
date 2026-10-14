// Page: controls, card registry (draw + "what changed" note + sources), copy-to-deck wiring.
(function () {
  const { B, setTheme, fmt, spec, setRange, presetRange, PRESETS, openLabel, monthsIn, addMonths, monthStart, qStart, addDays, WIN_LABEL, WIN_MONTHS, size, svgFor, textW, ink, tooltip, yAxis, stackedBars, legend, tiles, copyImage, copyTable, wrap, callout } = window.UB;
  const state = { theme: 'light', preset: 'last_q', start: null, end: null, cmp: 'prior', data: 'frozen', tab: 'overview', channel: 'Total', dim: 'channel' };
  const LIVE = ['end_clients', 'mqls', 'pipeline_open', 'opps_split', 'plan_targets', 'opps_channel', 'churn_reasons'];
  // Churned customers: Stripe cancellations with HubSpot reasons, live or as of the board snapshot.
  const CH = () => (state.data === 'frozen' ? 'churns_frozen' : 'churns');
  // Customer-level churn starts with the Stripe history (stripe_churn.py); a range reaching earlier is labelled as cut short.
  const CHURN_FROM = '2025-01', CHURN_DETAIL = ['c-churnsum', 'c-reasons', 'c-churnlog'];
  const churnCut = (cid, cards) => (cards || CHURN_DETAIL).includes(cid) && selMonths().some((m) => m < CHURN_FROM);
  // Cards whose note names Stripe cancellations, though their own figures come from the KPI sheet.
  const CHURN_NOTE = CHURN_DETAIL.concat(['c-retention', 'c-bridge']);
  const $ = (s) => document.querySelector('#ub ' + s);
  const $$ = (s) => [...document.querySelectorAll('#ub ' + s)];
  const id = (x) => (state.data === 'frozen' && LIVE.includes(x) ? x + '_frozen' : x);
  const raw = (x) => { const d = dash.data(x); return d.status === 'ok' && Array.isArray(d.data) ? d.data : null; };
  // Period calcs are rerun on the range in the date control (see calcs.js); everything else is read as stored.
  const DYN = {
    booking_totals: () => [['bookings'], (bk) => UBC.booking_totals(bk, { __ub: true, w: S().bookW })],
    booking_groups: () => [['bookings'], (bk) => UBC.booking_groups(dyn('booking_totals'), bk)],
    booking_daily: () => [['bookings'], (bk) => UBC.booking_daily(dyn('booking_totals'), bk)],
    mrr_windows: () => [['kpi'], (k) => UBC.mrr_windows(k, { __ub: true, w: S().monthW })],
    revenue_windows: () => [['revenue'], (r) => UBC.revenue_windows(r, { __ub: true, w: S().monthW })],
    pipeline_windows: () => [['kpi'], (k) => UBC.pipeline_windows(k, { __ub: true, w: S().monthW })],
    funnel_windows: () => [['mqls', 'kpi', 'opps_split'], (m, k, o) => UBC.funnel_windows(m, k, o, { __ub: true, w: S().monthW })],
    funnel_windows_frozen: () => [['mqls_frozen', 'kpi', 'opps_split_frozen'], (m, k, o) => UBC.funnel_windows_frozen(m, k, o, { __ub: true, w: S().monthW })],
  };
  const dynCache = {};
  function dyn(x) {
    const [ins, f] = DYN[x](), args = ins.map(raw);
    if (args.some((v) => !v)) return null;
    const dep = x === 'booking_groups' || x === 'booking_daily' ? dyn('booking_totals') : null;
    const key = JSON.stringify([S().bookW, S().monthW]), c = dynCache[x];
    if (c && c.key === key && c.dep === dep && c.args.every((v, i) => v === args[i])) return c.out;
    const out = f(...args);
    dynCache[x] = { key, args, dep, out };
    return out;
  }
  const rows = (x) => (DYN[x] ? (raw(x) ? dyn(x) : null) : raw(x));
  const pick = (arr, f) => (arr || []).find(f);
  const chg = (a, b) => (a == null || b == null || !b) ? null : (a - b) / Math.abs(b);
  const card = (c) => document.getElementById(c);
  const body = (c) => card(c).querySelector('.ub-body');
  const S = () => spec();
  const selMonths = () => S().months || WIN_MONTHS[S().win];
  const lastOf = (w) => (WIN_MONTHS[w] || []).slice(-1)[0];
  // Trend charts: 15 closed months ending with the range's last closed month (longer if the range is).
  const TREND = (m) => { const ms = WIN_MONTHS.curM || [], z = ms[ms.length - 1], a = addMonths(z + '-01', -14).slice(0, 7); return m >= (ms[0] < a ? ms[0] : a) && m <= z; };
  const up = (a, b) => (a >= b ? 'up' : 'down');

  // Shows the loading bar or the failure line; returns the rows of every dataset once all are ready.
  function need(el, ids) {
    const out = {};
    for (const x of ids) {
      const d = dash.data(x);
      if (d.status === 'ok') { out[x] = DYN[x] ? dyn(x) : d.data; if (out[x]) continue; }
      if (['error', 'connect', 'declined'].includes(d.status)) {
        el.classList.remove('dash-skeleton');
        d3.select(el).selectAll(':scope > svg.ub-chart').remove();
        if (!el.querySelector(':scope > .ub-fail')) { const f = document.createElement('div'); f.className = 'ub-fail'; f.append(document.createElement('i'), 'Failed to load'); el.appendChild(f); }
      } else el.classList.add('dash-skeleton');
      return null;
    }
    el.classList.remove('dash-skeleton');
    const f = el.querySelector(':scope > .ub-fail'); if (f) f.remove();
    return out;
  }

  // ---------- shared pieces
  // Series colors are read at draw time so a theme switch repaints them.
  const REV_DEF = [['subscription', 'Subscription', 'peri'], ['consumption', 'Consumption', 'sky'], ['dsp', 'DSP', 'mint'], ['mail', 'Mail', 'lav'], ['services_retainer', 'Services retainer', 'deep']];
  const REV = [], REV_ALL = [], SRC = [];
  function paintSeries() {
    REV.splice(0, REV.length, ...REV_DEF.map(([key, label, c]) => ({ key, label, color: B[c] })));
    REV_ALL.splice(0, REV_ALL.length, ...REV, { key: 'services_projects', label: 'Services projects', color: B.soft });
    SRC.splice(0, SRC.length, ...[['Organic search', 'peri'], ['Paid search', 'sky'], ['AI referrals', 'mint'], ['Paid social', 'lav'], ['Organic social', 'teal'], ['Email marketing', 'deep']].map(([s, c]) => [s, B[c]]));
  }
  const BLOCK = (b) => (b === 'Upsell' ? 'Expansion (existing customers)' : b === 'Not yet tagged' ? 'Account type not set' : b);
  const winRows = (ds, w, extra) => pick(ds, (r) => r.period === w && (!extra || extra(r)));
  function topChurns(log, months, n) {
    return log.filter((x) => months.includes(x.churn_month)).sort((a, b) => b.mrr - a.mrr).slice(0, n).map((x) => `${x.customer} ${fmt.usd(x.mrr)}`).join(', ');
  }
  function hbars(el, opt, data, { label, value, color, fmtv, sub }) {
    const { w } = size(el, opt, 0);
    const rowH = sub ? 54 : 40, h = (opt && opt.h) || data.length * rowH + 6;
    const rh = Math.min(rowH, (h - 6) / Math.max(1, data.length));
    const svg = svgFor(el, w, h);
    const labW = d3.max(data, (d) => textW(svg, label(d), 'ub-lab')) + 16;
    const x = d3.scaleLinear([0, d3.max(data, value) || 1], [0, w - labW - 90]);
    const tip = tooltip(el);
    data.forEach((d, i) => {
      const y0 = i * rh + 4, c = color(d), v = value(d), bw = Math.max(3, x(v));
      svg.append('text').attr('x', 0).attr('y', y0 + 17).attr('class', 'ub-lab').text(label(d));
      svg.append('rect').attr('x', labW).attr('y', y0 + 4).attr('height', 18).attr('rx', 4).attr('width', bw).attr('fill', c)
        .on('mousemove', (ev) => tip.show(ev, label(d), [[c, '', fmtv(v)]])).on('mouseleave', () => tip.hide());
      svg.append('text').attr('x', labW + bw + 8).attr('y', y0 + 17).attr('class', 'ub-val').text(fmtv(v));
      if (sub) svg.append('text').attr('x', labW).attr('y', y0 + 38).attr('class', 'ub-tick').text(sub(d));
    });
  }

  // ---------- monthly series for sparklines: the 12 months ending with the period's last closed month
  const monthsTo = (end, n) => { const out = []; let d = new Date(end + '-01T00:00:00Z'); for (let i = 0; i < n; i++) { out.unshift(d.toISOString().slice(0, 7)); d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)); } return out; };
  const sparkEnd = () => { const s = S(); return lastOf(s.win); };
  const kSeries = (kpi, f) => monthsTo(sparkEnd(), 12).map((m) => { const k = pick(kpi, (x) => x.month === m); return k ? f(k) : null; });
  const rSeries = (rev, f) => monthsTo(sparkEnd(), 12).map((m) => { const r = pick(rev, (x) => x.month === m); return r ? f(r) : null; });
  const bSeries = (bk, f) => monthsTo(S().end.slice(0, 7), 12).map((m) => f(bk.filter((b) => b.category === 'Software' && b.date.startsWith(m))));
  // Last full calendar quarter's software bookings, for pipeline coverage whatever range is picked.
  function lastQ() {
    const a = addMonths(qStart(S().today), -3), z = addDays(addMonths(a, 3), -1), q = Math.floor((+a.slice(5, 7) - 1) / 3) + 1;
    const r = UBC.booking_totals(raw('bookings') || [], { __ub: true, w: { LQ: [a, z] } })[0];
    return { tcv: r ? r.tcv : 0, label: `Q${q} ${a.slice(0, 4)}` };
  }
  // When the board snapshot of the live sources was taken, from the Source dates dataset.
  const snapDate = () => { const r = pick(raw('snapshot_info'), (x) => x.source === 'frozen'); return r ? fmt.date(r.as_of) : 'the snapshot date'; };
  const recurring = (r) => r.subscription + r.consumption + r.dsp + r.mail + r.services_retainer;

  // ---------- card registry
  const CARDS = {};

  CARDS['c-highlights'] = {
    kind: 'book', src: ['kpi', 'bookings', 'end_clients'],
    data: () => ['kpi', 'booking_totals', 'mrr_windows', id('end_clients')],
    draw(el, opt) {
      const d = need(el, this.data()); if (!d) return null;
      const s = S(), kpi = d.kpi, bt = d.booking_totals, mw = d.mrr_windows, ec = d[id('end_clients')];
      const items = [];
      const ms = WIN_MONTHS[s.win];
      const inWin = kpi.filter((k) => ms.includes(k.month));
      const best = inWin.reduce((a, k) => (k.sub_new > (a ? a.sub_new : -1) ? k : a), null);
      const prevMax = best ? d3.max(kpi.filter((k) => k.month < best.month), (k) => k.sub_new) : null;
      if (best && best.sub_new > prevMax) items.push({ big: fmt.usd(best.sub_new), text: `New MRR in ${fmt.monthLong(best.month)}: the highest month since the KPI sheet began (July 2023). Previous high ${fmt.usd(prevMax)}.` });
      const m = winRows(mw, s.win, (r) => r.channel === 'Total'), mc = winRows(mw, s.winComp, (r) => r.channel === 'Total');
      if (m && m.net_new > 0) items.push({ big: fmt.signedUsd(m.net_new), text: `Net new subscription MRR in ${WIN_LABEL[s.win]} (${WIN_LABEL[s.winComp]}: ${fmt.signedUsd(mc ? mc.net_new : null)}).` });
      const r = winRows(mw, s.win, (x) => x.channel === 'Reseller'), rc = winRows(mw, s.winComp, (x) => x.channel === 'Reseller');
      if (r && rc && r.ending > rc.ending) items.push({ big: fmt.pct(chg(r.ending, rc.ending)), text: `Reseller MRR, ${fmt.usd(rc.ending)} to ${fmt.usd(r.ending)}; resellers ${rc.customers_ending} to ${r.customers_ending}.` });
      const b = winRows(bt, s.book), bc = winRows(bt, s.bookComp);
      if (b && bc && b.avg_deal > bc.avg_deal) items.push({ big: fmt.usd(b.avg_deal), text: `Average software deal, up ${fmt.pct(chg(b.avg_deal, bc.avg_deal)).slice(1)} from ${fmt.usd(bc.avg_deal)}.` });
      const e = pick(ec, (x) => x.month === s.ecMonth), maxPrior = d3.max(ec.filter((x) => x.month < s.ecMonth), (x) => +x.end_clients);
      if (e && +e.end_clients > maxPrior) items.push({ big: fmt.n(+e.end_clients), text: `Reseller end clients in ${openLabel(s.ecMonth, s.openMonth)}, a new high.` });
      if (b && bc && b.tcv > bc.tcv) items.push({ big: fmt.usd(b.tcv), text: `Software bookings, ${fmt.pct(chg(b.tcv, bc.tcv))} vs ${WIN_LABEL[s.bookComp]}.` });
      const show = items.slice(0, 4);
      const { w } = size(el, opt, 0);
      const cols = w > 860 ? show.length : w > 520 ? 2 : 1, gap = 12, cw = (w - gap * (cols - 1)) / cols, ch = 132;
      const h = (opt && opt.h) || Math.ceil(show.length / cols) * (ch + gap) - gap;
      const svg = svgFor(el, w, h);
      const per = Math.max(18, Math.floor((cw - 32) / 7.6));
      show.forEach((it, i) => {
        const g = svg.append('g').attr('transform', `translate(${(i % cols) * (cw + gap)},${Math.floor(i / cols) * (ch + gap)})`);
        g.append('rect').attr('width', cw).attr('height', ch).attr('rx', 10).attr('fill', B.bg).attr('stroke', B.line);
        g.append('rect').attr('width', 4).attr('height', ch - 24).attr('x', 0).attr('y', 12).attr('rx', 2).attr('fill', B.mint);
        g.append('text').attr('x', 18).attr('y', 40).attr('class', 'ub-big').attr('font-size', 30).text(it.big);
        wrap(it.text, per, 3).forEach((l, j) => g.append('text').attr('x', 18).attr('y', 66 + j * 18).attr('class', 'ub-sub').attr('fill', B.muted).text(l));
      });
      return { columns: ['Highlight', 'Detail'], rows: show.map((it) => [it.big, it.text]) };
    },
    note: () => 'Computed from the period selected; only gains are listed here. Risks are on the Churn and retention tab.',
  };

  CARDS['c-headline'] = {
    kind: 'book', src: ['kpi', 'revenue', 'bookings'],
    data: () => ['mrr_windows', 'revenue_windows', 'booking_totals', 'kpi', 'revenue', 'bookings'],
    draw(el, opt) {
      const d = need(el, this.data()); if (!d) return null;
      const s = S(), mw = d.mrr_windows, rw = d.revenue_windows, bt = d.booking_totals;
      const m = winRows(mw, s.win, (r) => r.channel === 'Total'), mc = winRows(mw, s.winComp, (r) => r.channel === 'Total');
      const r = winRows(rw, s.win), rc = winRows(rw, s.winComp), b = winRows(bt, s.book), bc = winRows(bt, s.bookComp);
      const cc = 'vs ' + WIN_LABEL[s.winComp], bk = 'vs ' + WIN_LABEL[s.bookComp];
      const W = (p, ch) => `period=${p}&channel=${ch}`;
      const sp = [kSeries(d.kpi, (k) => k.license_mrr_ending), kSeries(d.kpi, (k) => k.sub_ending - k.sub_beginning), rSeries(d.revenue, recurring),
        bSeries(d.bookings, (r) => d3.sum(r, (b) => b.tcv)), bSeries(d.bookings, (r) => r.filter((b) => b.new_logo).length), kSeries(d.kpi, (k) => 1 - k.gross_usd_churn_rate)];
      const items = [
        { label: 'Subscription MRR', value: fmt.usd(m.license_ending), delta: fmt.pct(chg(m.license_ending, mc.license_ending)), good: m.license_ending >= mc.license_ending, compText: cc, mark: { source: 'mrr_windows', field: 'license_ending', where: W(s.win, 'Total') }, foot: `+ ${fmt.usd(m.services_retainer)} services retainer` },
        { label: 'Net new MRR', value: fmt.signedUsd(m.net_new), delta: fmt.signedUsd(m.net_new - mc.net_new), good: m.net_new >= mc.net_new, compText: cc, mark: { source: 'mrr_windows', field: 'net_new', where: W(s.win, 'Total') } },
        { label: 'Recurring revenue', value: fmt.usd(r.recurring_total), delta: fmt.pct(chg(r.recurring_total, rc.recurring_total)), good: r.recurring_total >= rc.recurring_total, compText: cc, mark: { source: 'revenue_windows', field: 'recurring_total', where: `period=${s.win}` } },
        { label: 'Software bookings (TCV)', value: fmt.usd(b.tcv), delta: fmt.pct(chg(b.tcv, bc.tcv)), good: b.tcv >= bc.tcv, compText: bk, mark: { source: 'booking_totals', field: 'tcv', where: `period=${s.book}` } },
        { label: 'New logos', value: fmt.n(b.new_logos), delta: fmt.signedN(b.new_logos - bc.new_logos), good: b.new_logos >= bc.new_logos, compText: bk, mark: { source: 'booking_totals', field: 'new_logos', where: `period=${s.book}` } },
        { label: 'Monthly $ retention', value: fmt.rate(m.gross_retention), delta: fmt.pts(m.gross_retention - mc.gross_retention), good: m.gross_retention >= mc.gross_retention, compText: cc, mark: { source: 'mrr_windows', field: 'gross_retention', where: W(s.win, 'Total') }, foot: `Net, with expansion: ${fmt.rate(m.net_retention)}` },
      ];
      items.forEach((it, i) => { it.spark = sp[i]; });
      tiles(el, items, { ...opt, cols: (opt && opt.export) ? 3 : undefined });
      return { columns: ['Metric', WIN_LABEL[s.win] + ' / ' + WIN_LABEL[s.book], 'Change', 'Compared with'], rows: items.map((i) => [i.label, i.value, i.delta, i.compText.replace('vs ', '')]) };
    },
    note() {
      const mw = rows('mrr_windows'), rw = rows('revenue_windows'), kpi = rows('kpi'); if (!mw || !rw || !kpi) return '';
      const s = S(), r = winRows(rw, s.win), rc = winRows(rw, s.winComp);
      const m = winRows(mw, s.win, (x) => x.channel === 'Total'), mc = winRows(mw, s.winComp, (x) => x.channel === 'Total');
      let t = `Subscription MRR ${up(m.license_ending, mc.license_ending)} ${fmt.pct(chg(m.license_ending, mc.license_ending)).slice(1)} to ${fmt.usd(m.license_ending)}.`;
      if (r.recurring_total < rc.recurring_total) {
        const ms = WIN_MONTHS[s.win], lastNew = pick(kpi, (k) => k.month === ms[ms.length - 1]);
        t += ` Recurring revenue is down ${fmt.pct(chg(r.recurring_total, rc.recurring_total)).slice(1)}`;
        t += r.usage < rc.usage ? `; usage fell ${fmt.usd(rc.usage - r.usage)} (consumption ${fmt.signedUsd(r.consumption - rc.consumption)}, DSP ${fmt.signedUsd(r.dsp - rc.dsp)})` : '';
        // Only when the period's last month brought most of its new MRR is it worth saying the revenue lands next period.
        const newAll = d3.sum(kpi.filter((k) => ms.includes(k.month)), (k) => k.sub_new);
        t += ms.length > 1 && lastNew && lastNew.sub_new > newAll / 2 ? `, and ${fmt.usd(lastNew.sub_new)} of the period's ${fmt.usd(newAll)} new MRR landed in ${fmt.monthLong(lastNew.month)}, so most of it shows in the next period's revenue.` : '.';
      }
      return t;
    },
  };

  CARDS['c-goals'] = {
    kind: 'static', src: ['goals', 'end_clients', 'revenue', 'kpi'],
    data: () => ['goals', id('end_clients'), 'revenue', 'kpi'],
    draw(el, opt) {
      const d = need(el, this.data()); if (!d) return null;
      const s = S(), goals = d.goals, ec = d[id('end_clients')], rev = d.revenue, kpi = d.kpi, G0 = (n) => goals.find((g) => g.goal.startsWith(n));
      const e = pick(ec, (x) => x.month === s.ecMonth) || ec[ec.length - 1];
      const exG = G0('Exit monthly'), exM = exG ? d3.utcFormat('%Y-%m')(new Date(`1 ${exG.by} UTC`)) : null;
      const jun = pick(rev, (x) => x.month === exM);
      const junTotal = jun ? jun.subscription + jun.consumption + jun.dsp + jun.mail + jun.services_retainer + jun.services_projects : null;
      const PY = +(goals.map((g) => (String(g.by).match(/\d{4}/) || [])[0]).filter(Boolean).sort().pop() || s.end.slice(0, 4));
      const dec = pick(kpi, (k) => k.month === `${PY - 1}-12`), last = kpi[kpi.length - 1];
      const totalRev = (x) => x.subscription + x.consumption + x.dsp + x.mail + x.services_retainer + x.services_projects, lastRev = rev[rev.length - 1];
      const G = (n) => goals.find((g) => g.goal.startsWith(n)), by = (n) => G(n).by.replace(/^(\w{3})\w* /, '$1 ');
      const list = [
        { name: 'Resellers with active end clients', cur: +e.resellers, target: G('Resellers').target, hi: null, by: by('Resellers'), start: G('Resellers').baseline, f: fmt.n },
        { name: 'Active reseller end clients', cur: +e.end_clients, target: G('Active reseller').target, hi: G('Active reseller').target_high, by: by('Active reseller'), start: G('Active reseller').baseline, f: fmt.n },
        { name: `Exit monthly revenue (${exG ? exG.by : ''})`, cur: junTotal, target: G('Exit monthly').target, hi: null, by: by('Exit monthly'), start: G('Exit monthly').baseline, f: fmt.usd, done: true },
        { name: `Period-end MRR, deck basis (${fmt.month(lastRev.month)})`, cur: totalRev(lastRev), target: G('December').target, hi: null, by: by('December'), start: G('December').baseline, f: fmt.usd },
      ];
      const trends = [
        { name: 'Avg subscription MRR per customer', a: dec.avg_mrr_per_customer, b: last.avg_mrr_per_customer, f: fmt.usd, good: last.avg_mrr_per_customer >= dec.avg_mrr_per_customer },
        { name: 'Direct $ churn rate, 12-month average', a: dec.direct_gross_usd_churn_rate_ttm, b: last.direct_gross_usd_churn_rate_ttm, f: fmt.rate, good: last.direct_gross_usd_churn_rate_ttm <= dec.direct_gross_usd_churn_rate_ttm },
      ];
      const { w } = size(el, opt, 0), rowH = 58, h = (opt && opt.h) || list.length * rowH + trends.length * 44 + 30;
      const svg = svgFor(el, w, h);
      const labW = Math.min(300, w * 0.36), barW = w - labW - 150;
      list.forEach((g, i) => {
        const y0 = i * rowH + 6, max = (g.hi || g.target) * 1.05, x = d3.scaleLinear([0, max], [0, barW]);
        const pct = g.cur / g.target, met = g.cur >= g.target;
        svg.append('text').attr('x', 0).attr('y', y0 + 16).attr('class', 'ub-lab').text(g.name);
        svg.append('text').attr('x', 0).attr('y', y0 + 34).attr('class', 'ub-tick').text(`Goal ${g.f(g.target)}${g.hi ? '–' + g.f(g.hi) : ''} by ${g.by}`);
        svg.append('rect').attr('x', labW).attr('y', y0 + 6).attr('width', barW).attr('height', 18).attr('rx', 9).attr('fill', B.grid);
        svg.append('rect').attr('x', labW).attr('y', y0 + 6).attr('width', Math.min(barW, x(g.cur))).attr('height', 18).attr('rx', 9).attr('fill', met ? B.mint : B.peri);
        svg.append('line').attr('x1', labW + x(g.start)).attr('x2', labW + x(g.start)).attr('y1', y0 + 2).attr('y2', y0 + 28).attr('stroke', B.muted).attr('stroke-dasharray', '2 2');
        svg.append('text').attr('x', labW + x(g.start)).attr('y', y0 + 40).attr('text-anchor', 'middle').attr('class', 'ub-tick').attr('font-size', 10).text('May: ' + g.f(g.start));
        svg.append('line').attr('x1', labW + x(g.target)).attr('x2', labW + x(g.target)).attr('y1', y0 + 2).attr('y2', y0 + 28).attr('stroke', B.fg).attr('stroke-width', 2);
        const curText = g.f(g.cur), inside = x(g.cur) > curText.length * 8 + 12;
        svg.append('text').attr('x', inside ? labW + Math.min(barW, x(g.cur)) - 8 : labW + x(g.cur) + 8).attr('y', y0 + 19).attr('text-anchor', inside ? 'end' : 'start').attr('class', 'ub-seg').attr('font-size', 12).attr('fill', inside ? B.bg : B.fg).text(curText);
        svg.append('text').attr('x', w - 2).attr('y', y0 + 19).attr('text-anchor', 'end').attr('class', 'ub-delta').attr('fill', met ? B.good : B.fg).text(met ? 'Met' : d3.format('.0%')(pct) + ' of goal');
      });
      const t0 = list.length * rowH + 22;
      svg.append('text').attr('x', 0).attr('y', t0).attr('class', 'ub-eyebrow').text(`${PY} FOCUS AREAS, SINCE DECEMBER ${PY - 1}`);
      trends.forEach((t, i) => {
        const y0 = t0 + 14 + i * 40;
        svg.append('text').attr('x', 0).attr('y', y0 + 16).attr('class', 'ub-lab').text(t.name);
        svg.append('text').attr('x', labW).attr('y', y0 + 16).attr('class', 'ub-val').attr('font-size', 15).text(`${t.f(t.a)}  →  ${t.f(t.b)}`);
        svg.append('text').attr('x', w - 2).attr('y', y0 + 16).attr('text-anchor', 'end').attr('class', 'ub-delta').attr('fill', t.good ? B.good : B.bad).text(t.good ? 'Improving' : 'Needs work');
      });
      return { columns: ['Goal', 'Current', 'Target', 'Status'], rows: list.map((g) => [g.name, g.f(g.cur), g.f(g.target) + (g.hi ? '–' + g.f(g.hi) : '') + ' by ' + g.by, g.cur >= g.target ? 'Met' : d3.format('.0%')(g.cur / g.target) + ' of goal'])
        .concat(trends.map((t) => [t.name, t.f(t.b), `Dec ${PY - 1}: ` + t.f(t.a), t.good ? 'Improving' : 'Needs work'])) };
    },
    note() {
      const ec = rows(id('end_clients')); if (!ec) return '';
      const s = S(), e = pick(ec, (x) => x.month === s.ecMonth) || ec[ec.length - 1];
      const gl = rows('goals') || [], ecG = gl.find((g) => g.goal.startsWith('Active reseller')) || {}, rsG = gl.find((g) => g.goal.startsWith('Resellers')) || {};
      return `Reaching ${fmt.n(ecG.target)} end clients by ${ecG.by} needs about ${fmt.n(Math.max(0, ecG.target - e.end_clients))} more; resellers with active clients need ${fmt.n(Math.max(0, rsG.target - e.resellers))} more to reach ${fmt.n(rsG.target)}. Revenue goals are on total monthly revenue. Break-even tracking comes from CFO.ai and is not shown here.`;
    },
  };

  CARDS['c-mrrdef'] = {
    kind: 'close', src: ['kpi', 'revenue'],
    data: () => ['kpi', 'revenue'],
    draw(el, opt) {
      const d = need(el, this.data()); if (!d) return null;
      const s = S(), m = lastOf(s.win), k = pick(d.kpi, (x) => x.month === m), r = pick(d.revenue, (x) => x.month === m);
      const steps = [['Subscription MRR (licenses)', k.license_mrr_ending, 'total'], ['Services retainer', k.services_retainer_mrr, 'up'], ['Subscription and services MRR', k.sub_ending, 'total'],
        ['Consumption', k.consumption_kpi, 'up'], ['DSP', k.dsp_kpi, 'up'], ['Total MRR', k.blended_mrr, 'total']];
      const total = r.subscription + r.consumption + r.dsp + r.mail + r.services_retainer + r.services_projects;
      const { w } = size(el, opt, 0), rh = 40, h = (opt && opt.h) || (steps.length + 1) * rh + 12;
      const rr = Math.min(rh, (h - 12) / (steps.length + 1));
      const svg = svgFor(el, w, h);
      const labW = d3.max(steps.concat([['Total revenue incl. one-off projects']]), (x) => textW(svg, x[0], 'ub-lab')) + 16;
      const x = d3.scaleLinear([0, Math.max(k.blended_mrr, total) * 1.08], [0, w - labW - 70]);
      let run = 0;
      steps.forEach(([lab, v, kind], i) => {
        const y0 = i * rr + 4, a = kind === 'total' ? 0 : run, z = kind === 'total' ? v : run + v; run = z;
        const c = kind === 'total' ? B.peri : B.sky;
        svg.append('text').attr('x', 0).attr('y', y0 + 18).attr('class', kind === 'total' ? 'ub-lab ub-lab-strong' : 'ub-lab').text(lab);
        svg.append('rect').attr('x', labW + x(a)).attr('y', y0 + 5).attr('width', Math.max(2, x(z) - x(a))).attr('height', 20).attr('rx', 3).attr('fill', c);
        svg.append('text').attr('x', labW + x(z) + 8).attr('y', y0 + 19).attr('class', 'ub-val').text(kind === 'total' ? fmt.usd(v) : '+' + fmt.usd(v));
      });
      const y0 = steps.length * rr + 8;
      svg.append('text').attr('x', 0).attr('y', y0 + 18).attr('class', 'ub-lab').attr('fill', B.muted).text('Total revenue incl. one-off projects');
      svg.append('rect').attr('x', labW).attr('y', y0 + 5).attr('width', x(total)).attr('height', 20).attr('rx', 3).attr('fill', 'none').attr('stroke', B.muted).attr('stroke-dasharray', '4 3');
      svg.append('text').attr('x', labW + x(total) + 8).attr('y', y0 + 19).attr('class', 'ub-val').attr('fill', B.muted).text(fmt.usd(total));
      return { columns: ['Measure', fmt.monthLong(m)], rows: steps.map(([l, v, kd]) => [l, (kd === 'total' ? '' : '+') + fmt.usdFull(v)]).concat([['Total revenue incl. one-off projects', fmt.usdFull(total)]]) };
    },
    note() {
      const rev = rows('revenue'); if (!rev) return '';
      return 'Subscription MRR builds up to total MRR by adding the services retainer and the month-end usage run rate (consumption and DSP) from the KPI sheet.';
    },
  };

  // ---------- Revenue and MRR
  CARDS['c-revmix'] = {
    kind: 'trend', src: ['revenue'], data: () => ['revenue'],
    draw(el, opt) {
      const d = need(el, this.data()); if (!d) return null;
      const s = S(), rev = d.revenue.filter((r) => TREND(r.month));
      legend(el, REV_ALL.map((x) => [x.color, x.label]));
      const notes = [];
      const bk = rows('bookings') || [];
      const spike = rev.find((r, i) => i > 0 && r.services_projects > 10000 && rev[i - 1].services_projects < 10000);
      if (spike) {
        const big = bk.filter((b) => b.category === 'Services' && b.date <= spike.month + '-31').sort((a, z) => z.tcv - a.tcv)[0];
        notes.push({ month: spike.month, text: big ? `${big.client.split(' - ')[0]} web build starts` : 'Services project starts' });
      }
      const recent = rev.slice(-6), low = recent.reduce((a, r) => (r.consumption < a.consumption ? r : a), recent[0]);
      if (low && low !== spike) notes.push({ month: low.month, text: `Consumption low ${fmt.usd(low.consumption)}`, lift: 44 });
      stackedBars(el, { ...opt, rows: rev, series: REV_ALL, highlight: WIN_MONTHS[s.win], yfmt: fmt.usd, height: 360, notes });
      return { columns: ['Month'].concat(REV_ALL.map((x) => x.label), ['Recurring (excl. projects)', 'Total revenue']),
        rows: rev.map((r) => [fmt.monthLong(r.month)].concat(REV_ALL.map((x) => fmt.usdFull(r[x.key])), [fmt.usdFull(d3.sum(REV, (x) => r[x.key])), fmt.usdFull(d3.sum(REV_ALL, (x) => r[x.key]))])) };
    },
    note() { const t = CARDS['c-headline'].note(); return t ? t + ' Bars include one-off services projects (lightest segment) so totals match total revenue.' : ''; },
  };

  CARDS['c-revdetail'] = {
    kind: 'close', src: ['revenue'], data: () => ['revenue', 'revenue_windows'],
    draw(el, opt) {
      const d = need(el, this.data()); if (!d) return null;
      const s = S(), rev = d.revenue, rw = d.revenue_windows, ms = WIN_MONTHS[s.win];
      const cur = winRows(rw, s.win), cmp = winRows(rw, s.winComp);
      const lines = [['Subscription', 'subscription'], ['Consumption', 'consumption'], ['DSP', 'dsp'], ['Mail', 'mail'], ['Usage subtotal', 'usage'], ['Services retainer', 'services_retainer'], ['Recurring total', 'recurring_total']];
      const showMonths = ms.length > 1 && ms.length <= 3;
      const head = ['Line'].concat(showMonths ? ms.map(fmt.month) : [], [WIN_LABEL[s.win], WIN_LABEL[s.winComp], 'Change']);
      const get = (m, k) => { const r = pick(rev, (x) => x.month === m); if (!r) return null; return k === 'usage' ? r.consumption + r.dsp + r.mail : k === 'recurring_total' ? r.subscription + r.consumption + r.dsp + r.mail + r.services_retainer : r[k]; };
      const body2 = lines.map(([lab, k]) => [lab].concat(showMonths ? ms.map((m) => fmt.usdFull(get(m, k))) : [], [fmt.usdFull(cur[k]), fmt.usdFull(cmp[k]), fmt.pct(chg(cur[k], cmp[k]))]));
      if (!opt || !opt.export) htmlTable(el, head, body2, (r) => /total/.test(r[0]));
      tableSvg(el, head, body2, opt);
      return { columns: head, rows: body2 };
    },
    note() {
      const rw = rows('revenue_windows'); if (!rw) return '';
      const s = S(), c = winRows(rw, s.win), p = winRows(rw, s.winComp);
      return `Subscription ${fmt.signedUsd(c.subscription - p.subscription)}, consumption ${fmt.signedUsd(c.consumption - p.consumption)}, DSP ${fmt.signedUsd(c.dsp - p.dsp)}, retainer ${fmt.signedUsd(c.services_retainer - p.services_retainer)}. Services projects (${fmt.usd(c.services_projects)}) are left out.`;
    },
  };

  CARDS['c-mrrtrend'] = {
    kind: 'trend', src: ['kpi'], data: () => ['kpi'],
    draw(el, opt) {
      const d = need(el, this.data()); if (!d) return null;
      const s = S();
      const SR = [{ key: 'reseller', label: 'Reseller licenses', color: B.sky }, { key: 'direct', label: 'Direct licenses', color: B.peri }, { key: 'svc', label: 'Services retainer', color: B.deep }];
      const data = d.kpi.filter((k) => TREND(k.month)).map((k) => ({ month: k.month, reseller: k.reseller_ending, direct: k.direct_ending - k.services_retainer_mrr, svc: k.services_retainer_mrr }));
      legend(el, SR.map((x) => [x.color, x.label]));
      const kk = d.kpi.filter((k) => TREND(k.month)), best = kk.reduce((a, k) => (k.sub_new > a.sub_new ? k : a), kk[0]);
      const notes = [{ month: best.month, text: `Record new MRR +${fmt.usd(best.sub_new)}` }];
      kk.forEach((k, i) => { const prev = d.kpi.find((p) => p.month < k.month && d.kpi.indexOf(p) === d.kpi.indexOf(k) - 1); if (prev && Math.abs(k.sub_beginning - prev.sub_ending) > 1) notes.push({ month: k.month, text: `Stripe rebase ${fmt.signedUsd(k.sub_beginning - prev.sub_ending)}`, lift: 50 }); });
      stackedBars(el, { ...opt, rows: data, series: SR, highlight: WIN_MONTHS[s.win], yfmt: fmt.usd, height: 330, notes });
      return { columns: ['Month'].concat(SR.map((x) => x.label), ['Total']), rows: data.map((r) => [fmt.monthLong(r.month)].concat(SR.map((x) => fmt.usdFull(r[x.key])), [fmt.usdFull(r.reseller + r.direct + r.svc)])) };
    },
    note() {
      const mw = rows('mrr_windows'); if (!mw) return '';
      const s = S(), D = (ch) => [winRows(mw, s.win, (r) => r.channel === ch), winRows(mw, s.winComp, (r) => r.channel === ch)];
      const [dn, dp] = D('Direct'), [rn, rp] = D('Reseller');
      return `Reseller licenses ${fmt.signedUsd(rn.ending - rp.ending)} (${fmt.pct(chg(rn.ending, rp.ending))}) and Direct ${fmt.signedUsd(dn.ending - dp.ending)} vs ${WIN_LABEL[s.winComp]}. Reseller is now ${d3.format('.0%')(rn.ending / (rn.ending + dn.license_ending))} of license MRR.`;
    },
  };

  CARDS['c-bridge'] = {
    kind: 'close', src: ['kpi', 'stripe_churns', 'churn_reasons'], data: () => ['mrr_windows'],
    draw(el, opt) {
      const d = need(el, this.data()); if (!d) return null;
      $$('.ub-seg-channel button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === state.channel));
      const s = S(), m = winRows(d.mrr_windows, s.win, (r) => r.channel === state.channel);
      const steps = [['Beginning', m.beginning, 'total'], ['New', m.new, 'up'], ['Expansion', m.expansion, 'up'], ['Reactivation', m.reactivation, 'up'],
        ['Contraction', -m.contraction, 'down'], ['Cancellation', -m.cancellation, 'down']];
      if (Math.abs(m.adjustment) > 0.5) steps.push(['Aug. rebase', m.adjustment, m.adjustment >= 0 ? 'up' : 'down']);
      steps.push(['Ending', m.ending, 'total']);
      const { w, h } = size(el, opt, 300), svg = svgFor(el, w, h);
      let run = 0; const bars = steps.map(([label, v, kind]) => { const a = kind === 'total' ? 0 : run; const z = kind === 'total' ? v : run + v; run = kind === 'total' ? v : z; return { label, v, kind, a, z }; });
      const y = d3.scaleLinear([0, d3.max(bars, (b) => Math.max(b.a, b.z)) * 1.12], [h - 30, 12]).nice();
      const left = 8 + d3.max(y.ticks(4), (t) => textW(svg, fmt.usd(t)));
      const x = d3.scaleBand(bars.map((b) => b.label), [left + 4, w - 4]).padding(0.28);
      yAxis(svg, y, left, w - 4, fmt.usd);
      const tip = tooltip(el);
      bars.forEach((b, i) => {
        const c = b.kind === 'total' ? B.peri : b.kind === 'up' ? B.mint : B.bad;
        svg.append('rect').attr('x', x(b.label)).attr('width', x.bandwidth()).attr('y', y(Math.max(b.a, b.z))).attr('height', Math.max(1, Math.abs(y(b.a) - y(b.z)))).attr('rx', 3).attr('fill', c)
          .on('mousemove', (ev) => tip.show(ev, b.label, [[c, state.channel, fmt.usdFull(b.v)]])).on('mouseleave', () => tip.hide());
        if (i < bars.length - 1) svg.append('line').attr('x1', x(b.label) + x.bandwidth()).attr('x2', x(bars[i + 1].label)).attr('y1', y(b.z)).attr('y2', y(b.z)).attr('class', 'ub-ref');
        svg.append('text').attr('x', x(b.label) + x.bandwidth() / 2).attr('y', y(Math.max(b.a, b.z)) - 6).attr('text-anchor', 'middle').attr('class', 'ub-val').text(b.kind === 'total' ? fmt.usd(b.v) : fmt.signedUsd(b.v));
        svg.append('text').attr('x', x(b.label) + x.bandwidth() / 2).attr('y', h - 10).attr('text-anchor', 'middle').attr('class', 'ub-tick').text(x.bandwidth() < 58 ? b.label.slice(0, 6) : b.label);
      });
      return { columns: ['Step', state.channel + ' MRR'], rows: bars.map((b) => [b.label, b.kind === 'total' ? fmt.usdFull(b.v) : fmt.signedUsd(b.v)]) };
    },
    note() {
      const mw = rows('mrr_windows'), log = rows(CH()); if (!mw || !log) return '';
      const s = S(), m = winRows(mw, s.win, (r) => r.channel === state.channel);
      let t = `${state.channel === 'Total' ? 'Subscription and services' : state.channel} MRR ${fmt.signedUsd(m.net_new)} net: new ${fmt.usd(m.new)}, expansion ${fmt.usd(m.expansion)}, cancellations ${fmt.usd(m.cancellation)}.`;
      const months = WIN_MONTHS[s.win];
      const top = topChurns(log.filter((x) => state.channel === 'Total' || x.channel === state.channel), months, 3);
      if (top) t += ` Largest cancellations: ${top}.`;
      if (Math.abs(m.adjustment) > 0.5) t += ` The rebase bar is the one-time August 2026 true-up of the sheet to Stripe, as published.`;
      return t;
    },
  };

  // ---------- Sales and pipeline
  CARDS['c-salestiles'] = {
    kind: 'book', src: ['bookings', 'revenue'], data: () => ['booking_totals', 'revenue', 'bookings'],
    draw(el, opt) {
      const d = need(el, this.data()); if (!d) return null;
      const s = S(), b = winRows(d.booking_totals, s.book), c = winRows(d.booking_totals, s.bookComp), ct = 'vs ' + WIN_LABEL[s.bookComp];
      const M = (f) => ({ source: 'booking_totals', field: f, where: `period=${s.book}` });
      const items = [
        { label: 'Contract bookings (TCV)', value: fmt.usd(b.tcv), delta: fmt.pct(chg(b.tcv, c.tcv)), good: b.tcv >= c.tcv, compText: ct, mark: M('tcv') },
        { label: 'Deals closed', value: fmt.n(b.deals), delta: fmt.signedN(b.deals - c.deals), good: b.deals >= c.deals, compText: ct, mark: M('deals') },
        { label: 'Average deal', value: fmt.usd(b.avg_deal), delta: fmt.pct(chg(b.avg_deal, c.avg_deal)), good: b.avg_deal >= c.avg_deal, compText: ct, mark: M('avg_deal') },
        { label: 'Contracted MRR', value: fmt.usd(b.contracted_mrr), delta: fmt.pct(chg(b.contracted_mrr, c.contracted_mrr)), good: b.contracted_mrr >= c.contracted_mrr, compText: ct, mark: M('contracted_mrr') },
        { label: 'DSP bookings', value: fmt.usd(b.dsp), delta: fmt.pct(chg(b.dsp, c.dsp)), good: b.dsp >= c.dsp, compText: ct, mark: M('dsp') },
        { label: 'New logos', value: fmt.n(b.new_logos), delta: fmt.signedN(b.new_logos - c.new_logos), good: b.new_logos >= c.new_logos, compText: ct, mark: M('new_logos') },
      ];
      const cm = lastOf(s.win), cr = pick(d.revenue, (r) => r.month === cm), dm = lastOf(s.winComp), dr = pick(d.revenue, (r) => r.month === dm);
      const bkAll = rows('bookings') || [];
      const sps = [(r) => d3.sum(r, (b) => b.tcv), (r) => r.filter((b) => b.tcv > 0).length, (r) => { const n = r.filter((b) => b.tcv > 0).length; return n ? d3.sum(r, (b) => b.tcv) / n : null; },
        (r) => d3.sum(r, (b) => b.mrr), (r) => d3.sum(r, (b) => b.dsp_revenue), (r) => r.filter((b) => b.new_logo).length];
      items.forEach((it, i) => { it.spark = bSeries(bkAll, sps[i]); });
      if (cr && dr) items.push({ label: 'Monthly consumption change', value: fmt.signedUsd(cr.consumption - dr.consumption), delta: fmt.usd(cr.consumption), good: cr.consumption >= dr.consumption, compText: `in ${fmt.month(cm)} vs ${fmt.usd(dr.consumption)} in ${fmt.month(dm)}`, spark: rSeries(d.revenue, (r) => r.consumption), sparkColor: B.sky });
      tiles(el, items, { ...opt, cols: (opt && opt.export) || el.clientWidth > 900 ? 4 : undefined });
      return { columns: ['Metric', WIN_LABEL[s.book], WIN_LABEL[s.bookComp], 'Change'],
        rows: [['Contract bookings (TCV)', fmt.usdFull(b.tcv), fmt.usdFull(c.tcv)], ['Deals closed', b.deals, c.deals], ['Average deal', fmt.usdFull(b.avg_deal), fmt.usdFull(c.avg_deal)], ['Contracted MRR', fmt.usdFull(b.contracted_mrr), fmt.usdFull(c.contracted_mrr)], ['DSP bookings', fmt.usdFull(b.dsp), fmt.usdFull(c.dsp)], ['New logos', b.new_logos, c.new_logos]].map((r, i) => r.concat(items[i].delta)).concat(items[6] ? [[`Monthly consumption change vs ${fmt.month(dm)}`, items[6].value, '', items[6].delta]] : []) };
    },
    note() {
      const bt = rows('booking_totals'), bk = rows('bookings'); if (!bt || !bk) return '';
      const s = S(), b = winRows(bt, s.book), c = winRows(bt, s.bookComp);
      const top = bk.filter((x) => x.category === 'Software' && x.date >= b.start && x.date <= b.end).sort((a, z) => z.tcv - a.tcv).slice(0, 3).map((x) => `${x.client} ${fmt.usd(x.tcv)}`).join(', ');
      let t = `Bookings ${fmt.pct(chg(b.tcv, c.tcv))} on ${b.deals} deals (${c.deals} in ${WIN_LABEL[s.bookComp]}); the average deal is ${fmt.usd(b.avg_deal)} vs ${fmt.usd(c.avg_deal)}. Reseller channel ${d3.format('.0%')(b.reseller_tcv / b.tcv)} of TCV.`;
      if (top) t += ` Largest: ${top}.`;
      return t;
    },
  };

  CARDS['c-groups'] = {
    kind: 'book', src: ['bookings'], data: () => ['booking_groups'],
    draw(el, opt) {
      const d = need(el, this.data()); if (!d) return null;
      $$('.ub-seg-dim button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === state.dim));
      const s = S(), g = d.booking_groups;
      const groups = [...new Set(g.filter((r) => r.dimension === state.dim && (r.period === s.book || r.period === s.bookComp)).map((r) => r.group))];
      const val = (p, grp) => (pick(g, (r) => r.period === p && r.dimension === state.dim && r.group === grp) || {}).tcv || 0;
      const data = groups.map((grp) => ({ group: grp, cur: val(s.book, grp), cmp: val(s.bookComp, grp) })).sort((a, b) => b.cur - a.cur);
      const { w } = size(el, opt, 0), h = (opt && opt.h) || data.length * 62 + 10, rowH = Math.min(62, (h - 10) / Math.max(1, data.length));
      const svg = svgFor(el, w, h);
      const labW = d3.max(data, (x) => textW(svg, x.group, 'ub-lab')) + 16;
      const x = d3.scaleLinear([0, d3.max(data, (z) => Math.max(z.cur, z.cmp)) || 1], [0, w - labW - 160]);
      const tip = tooltip(el);
      data.forEach((z, i) => {
        const y0 = i * rowH + 8;
        svg.append('text').attr('x', 0).attr('y', y0 + 26).attr('class', 'ub-lab').text(z.group);
        [['cmp', B.prior, 0], ['cur', B.peri, 22]].forEach(([k, c, dy]) => {
          svg.append('rect').attr('x', labW).attr('y', y0 + dy + 4).attr('height', 15).attr('rx', 7).attr('width', Math.max(3, x(z[k]))).attr('fill', c)
            .on('mousemove', (ev) => tip.show(ev, z.group, [[B.prior, WIN_LABEL[s.bookComp], fmt.usdFull(z.cmp)], [B.peri, WIN_LABEL[s.book], fmt.usdFull(z.cur)]])).on('mouseleave', () => tip.hide());
          svg.append('text').attr('x', labW + Math.max(3, x(z[k])) + 8).attr('y', y0 + dy + 16).attr('class', k === 'cur' ? 'ub-val' : 'ub-tick').text(fmt.usd(z[k]));
        });
        const dv = z.cur - z.cmp;
        svg.append('text').attr('x', w - 2).attr('y', y0 + 26).attr('text-anchor', 'end').attr('class', 'ub-delta').attr('fill', dv >= 0 ? B.good : B.bad).text(fmt.signedUsd(dv));
      });
      legend(el, [[B.prior, WIN_LABEL[s.bookComp]], [B.peri, WIN_LABEL[s.book]]]);
      return { columns: [{ product: 'Product', channel: 'Channel', deal_type: 'Deal type' }[state.dim], WIN_LABEL[s.bookComp], WIN_LABEL[s.book], 'Change'],
        rows: data.map((z) => [z.group, fmt.usdFull(z.cmp), fmt.usdFull(z.cur), fmt.signedUsd(z.cur - z.cmp)]) };
    },
    note() {
      const g = rows('booking_groups'); if (!g) return '';
      const s = S();
      const diffs = [...new Set(g.filter((r) => r.dimension === state.dim).map((r) => r.group))].map((grp) => {
        const v = (p) => (pick(g, (r) => r.period === p && r.dimension === state.dim && r.group === grp) || {}).tcv || 0;
        return [grp, v(s.book) - v(s.bookComp)];
      }).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
      return diffs.length ? `Biggest move: ${diffs[0][0]} ${fmt.signedUsd(diffs[0][1])}` + (diffs[1] ? `, then ${diffs[1][0]} ${fmt.signedUsd(diffs[1][1])}.` : '.') : '';
    },
  };

  CARDS['c-cumulative'] = {
    kind: 'book', src: ['bookings'], data: () => ['booking_daily'],
    draw(el, opt) { return drawCumulative(el, opt, this.data()); },
    note() {
      const dd = rows('booking_daily'); if (!dd) return '';
      const s = S(), cur = dd.filter((r) => r.period === s.book), cmp = dd.filter((r) => r.period === s.bookComp);
      const lc = cur[cur.length - 1], same = cmp[Math.min(cur.length, cmp.length) - 1];
      const ahead = cur.find((r, i) => cmp[i] && r.tcv > cmp[i].tcv && cur.slice(i).every((q, j) => !cmp[i + j] || q.tcv >= cmp[i + j].tcv));
      return `${WIN_LABEL[s.book]} reached ${fmt.usd(lc.tcv)}, vs ${fmt.usd(same.tcv)} at the same point of ${WIN_LABEL[s.bookComp]}.` + (ahead ? ` Pulled ahead for good on day ${ahead.day}.` : '');
    },
  };
  CARDS['c-ov-book'] = { ...CARDS['c-cumulative'] };
  CARDS['c-ov-book'].draw = function (el, opt) { return drawCumulative(el, opt, ['booking_daily']); };

  function drawCumulative(el, opt, ids) {
    const d = need(el, ids); if (!d) return null;
    const s = S(), cur = d.booking_daily.filter((r) => r.period === s.book), cmp = d.booking_daily.filter((r) => r.period === s.bookComp);
    const { w, h } = size(el, opt, 300), svg = svgFor(el, w, h);
    const lc = cur[cur.length - 1], lp = cmp[cmp.length - 1];
    const endLabW = Math.max(textW(svg, 'Now ' + fmt.usd(lc.tcv), 'ub-endlab'), textW(svg, 'Prior ' + fmt.usd(lp.tcv), 'ub-endlab')) + 14;
    const maxD = Math.max(cur.length, cmp.length);
    const y = d3.scaleLinear([0, d3.max(cur.concat(cmp), (q) => q.tcv) * 1.22 || 1], [h - 28, 14]).nice();
    const left = 8 + d3.max(y.ticks(4), (t) => textW(svg, fmt.usd(t)));
    const x = d3.scaleLinear([1, maxD], [left + 6, w - endLabW]);
    yAxis(svg, y, left, w - endLabW, fmt.usd);
    const line = d3.line().x((q) => x(q.day)).y((q) => y(q.tcv)).curve(d3.curveStepAfter);
    [[cmp, B.prior], [cur, B.peri]].forEach(([q, c]) => svg.append('path').attr('d', line(q)).attr('fill', 'none').attr('stroke', c).attr('stroke-width', 2.5).attr('stroke-linejoin', 'round'));
    // Callout on the largest single deal in the current period.
    const bkc = (rows('bookings') || []).filter((b) => b.category === 'Software' && b.date >= cur[0].date && b.date <= lc.date).sort((a, z) => z.tcv - a.tcv)[0];
    if (bkc && bkc.tcv >= 10000) { const p = cur.find((q) => q.date === bkc.date); if (p) callout(svg, w - endLabW, x(p.day), y(p.tcv), `${bkc.client.split(' - ')[0].split(' (')[0]} ${fmt.usd(bkc.tcv)}`, { lift: 34 }); }
    // Data labels at each month end of the current period.
    const marks = cur.filter((q, i) => i < cur.length - 1 && q.date.slice(5, 7) !== cur[i + 1].date.slice(5, 7));
    marks.forEach((q) => {
      svg.append('circle').attr('cx', x(q.day)).attr('cy', y(q.tcv)).attr('r', 3.5).attr('fill', B.peri);
      svg.append('text').attr('x', x(q.day)).attr('y', y(q.tcv) - 9).attr('text-anchor', 'middle').attr('class', 'ub-val').attr('font-size', 11).text(fmt.usd(q.tcv));
    });
    const ticks = maxD > 120 ? d3.range(1, maxD + 1, 30) : maxD > 40 ? [1, 15, 30, 45, 60, 75, 90].filter((t) => t <= maxD) : d3.range(1, maxD + 1, Math.max(1, Math.ceil(maxD / 6)));
    ticks.forEach((t) => svg.append('text').attr('x', x(t)).attr('y', h - 8).attr('text-anchor', 'middle').attr('class', 'ub-tick').text('Day ' + t));
    let yc = y(lc.tcv), yp = y(lp.tcv);
    if (Math.abs(yc - yp) < 18) { if (yc < yp) yp = yc + 18; else yc = yp + 18; }
    svg.append('circle').attr('cx', x(lc.day)).attr('cy', y(lc.tcv)).attr('r', 4).attr('fill', B.peri);
    svg.append('text').attr('x', x(lc.day) + 8).attr('y', yc).attr('dy', '0.32em').attr('class', 'ub-endlab').text('Now ' + fmt.usd(lc.tcv));
    svg.append('text').attr('x', x(lp.day) + 8).attr('y', yp).attr('dy', '0.32em').attr('class', 'ub-endlab ub-endlab-prior').text('Prior ' + fmt.usd(lp.tcv));
    const tip = tooltip(el), dot = svg.append('circle').attr('r', 4).attr('fill', B.peri).attr('opacity', 0);
    svg.append('rect').attr('class', 'ub-hit').attr('x', left).attr('width', w - endLabW - left).attr('y', 0).attr('height', h - 24).attr('fill', 'transparent')
      .on('mousemove', (ev) => {
        const [mx] = d3.pointer(ev); const day = Math.max(1, Math.min(maxD, Math.round(x.invert(mx))));
        const a = cur[Math.min(day, cur.length) - 1], b = cmp[Math.min(day, cmp.length) - 1];
        dot.attr('cx', x(a.day)).attr('cy', y(a.tcv)).attr('opacity', 1);
        tip.show(ev, 'Day ' + day, [[B.peri, `${WIN_LABEL[s.book]} (${fmt.date(a.date)})`, fmt.usdFull(a.tcv)], [B.prior, `${WIN_LABEL[s.bookComp]} (${fmt.date(b.date)})`, fmt.usdFull(b.tcv)]]);
      })
      .on('mouseleave', () => { tip.hide(); dot.attr('opacity', 0); });
    legend(el, [[B.prior, WIN_LABEL[s.bookComp]], [B.peri, WIN_LABEL[s.book]]]);
    return { columns: ['Day', WIN_LABEL[s.bookComp], WIN_LABEL[s.book]], rows: d3.range(1, maxD + 1).map((dy) => [dy, cmp[dy - 1] ? fmt.usdFull(cmp[dy - 1].tcv) : '', cur[dy - 1] ? fmt.usdFull(cur[dy - 1].tcv) : '']) };
  }

  CARDS['c-topdeals'] = {
    kind: 'book', src: ['bookings'], data: () => ['bookings', 'booking_totals'],
    draw(el) {
      const d = need(el, this.data()); if (!d) return null;
      const s = S(), b = winRows(d.booking_totals, s.book);
      const r = d.bookings.filter((x) => x.category === 'Software' && x.date >= b.start && x.date <= b.end && x.tcv > 0).sort((a, z) => z.tcv - a.tcv).slice(0, 12);
      const tb = card('c-topdeals').querySelector('tbody');
      const cells = (x) => [x.client, fmt.date(x.date), x.product, x.channel, x.deal_type, fmt.usdFull(x.tcv), x.mrr ? fmt.usdFull(x.mrr) : '—'];
      tb.replaceChildren(...r.map((x) => { const tr = document.createElement('tr'); tr.dataset.key = x.deal; cells(x).forEach((v) => { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); }); return tr; }));
      return { columns: ['Client', 'Signed', 'Product', 'Channel', 'Type', 'TCV', 'MRR'], rows: r.map(cells) };
    },
    note() {
      const bt = rows('booking_totals'), bk = rows('bookings'); if (!bt || !bk) return '';
      const s = S(), b = winRows(bt, s.book);
      const r = bk.filter((x) => x.category === 'Software' && x.date >= b.start && x.date <= b.end).sort((a, z) => z.tcv - a.tcv);
      const top = d3.sum(r.slice(0, 12), (x) => x.tcv);
      return `The 12 largest deals are ${d3.format('.0%')(b.tcv ? top / b.tcv : 0)} of ${WIN_LABEL[s.book]} software bookings.`;
    },
  };

  CARDS['c-pipeline'] = {
    kind: 'live', src: ['pipeline_open'], data: () => [id('pipeline_open'), 'booking_totals'],
    draw(el, opt) {
      const d = need(el, this.data()); if (!d) return null;
      const p = d[id('pipeline_open')].map((r) => ({ ...r, block: BLOCK(r.block), pipeline_value: +r.pipeline_value, deals: +r.deals, stage_order: +r.stage_order }));
      const blocks = ['Direct', 'Reseller', 'Expansion (existing customers)', 'Account type not set'].filter((b) => p.some((r) => r.block === b));
      const colors = [B.prior, B.deep, B.peri, B.sky, B.mint, B.lav];
      const { w } = size(el, opt, 0), h = (opt && opt.h) || blocks.length * 76 + 4, rowH = Math.min(76, (h - 4) / blocks.length);
      const svg = svgFor(el, w, h);
      const labW = d3.max(blocks, (b) => textW(svg, b, 'ub-lab')) + 16, totW = 110;
      const x = d3.scaleLinear([0, d3.max(blocks, (b) => d3.sum(p.filter((r) => r.block === b), (r) => r.pipeline_value)) || 1], [0, w - labW - totW]);
      const tip = tooltip(el);
      blocks.forEach((b, i) => {
        const r = p.filter((q) => q.block === b).sort((a, c) => a.stage_order - c.stage_order);
        const y0 = i * rowH + 6; let acc = 0;
        svg.append('text').attr('x', 0).attr('y', y0 + 22).attr('class', 'ub-lab').text(b);
        r.forEach((st) => {
          const v = st.pipeline_value, c = colors[Math.min(st.stage_order, colors.length - 1)], wd = Math.max(v ? 2 : 0, x(v) - 2);
          svg.append('rect').attr('x', labW + x(acc)).attr('y', y0 + 6).attr('height', 26).attr('width', wd).attr('rx', 3).attr('fill', c)
            .on('mousemove', (ev) => tip.show(ev, `${b} · ${st.stage}`, [[c, `${st.deals} deals`, fmt.usdFull(v)]])).on('mouseleave', () => tip.hide());
          const t = fmt.usdS(v);
          if (wd > t.length * 7 + 8) svg.append('text').attr('x', labW + x(acc) + wd / 2).attr('y', y0 + 23).attr('text-anchor', 'middle').attr('class', 'ub-seg').attr('font-size', 11).attr('fill', ink(c)).text(t);
          if (wd > st.stage.length * 6 + 8 && rowH >= 60) svg.append('text').attr('x', labW + x(acc) + wd / 2).attr('y', y0 + 48).attr('text-anchor', 'middle').attr('class', 'ub-tick').attr('font-size', 10).text(st.stage);
          acc += v;
        });
        const deals = d3.sum(r, (q) => q.deals);
        svg.append('text').attr('x', w - 2).attr('y', y0 + 22).attr('text-anchor', 'end').attr('class', 'ub-delta').attr('fill', B.fg).text(fmt.usd(acc));
        svg.append('text').attr('x', w - 2).attr('y', y0 + 40).attr('text-anchor', 'end').attr('class', 'ub-tick').text(deals + ' deals');
      });
      const tot = d3.sum(p, (r) => r.pipeline_value), n = d3.sum(p, (r) => r.deals);
      return { columns: ['Block', 'Stage', 'Deals', 'Pipeline value'], rows: blocks.flatMap((b) => p.filter((r) => r.block === b).sort((a, c) => a.stage_order - c.stage_order).map((r) => [b, r.stage, r.deals, fmt.usdFull(r.pipeline_value)])).concat([['Total', '', n, fmt.usdFull(tot)]]) };
    },
    note() {
      const p = rows(id('pipeline_open')); if (!p || !rows('bookings')) return '';
      const tot = d3.sum(p, (r) => +r.pipeline_value), n = d3.sum(p, (r) => +r.deals), lq = lastQ();
      const late = d3.sum(p.filter((r) => /Proposal|Decision|Contract|Negotiation/.test(r.stage)), (r) => +r.pipeline_value);
      return `${fmt.usd(tot)} open across ${n} deals, ${d3.format('.1f')(tot / lq.tcv)}x ${lq.label} software bookings. ${fmt.usd(late)} is at proposal stage or later. A Q4 bookings target would turn this into a coverage ratio.`;
    },
  };

  CARDS['c-pipemove'] = {
    kind: 'close', src: ['kpi'], data: () => ['pipeline_windows'],
    draw(el, opt) {
      const d = need(el, this.data()); if (!d) return null;
      const s = S(), r = d.pipeline_windows.filter((x) => x.period === s.win);
      const SR = [['created', 'Created', B.sky], ['won', 'Won', B.mint], ['lost', 'Lost', B.bad], ['ending', 'Ending pipeline', B.peri]];
      const { w, h } = size(el, opt, 290), svg = svgFor(el, w, h);
      const y = d3.scaleLinear([0, d3.max(r, (q) => d3.max(SR, ([k]) => q[k])) * 1.15], [h - 30, 12]).nice();
      const left = 8 + d3.max(y.ticks(4), (t) => textW(svg, fmt.usd(t)));
      const x0 = d3.scaleBand(r.map((q) => q.block), [left + 6, w - 4]).padding(0.2), x1 = d3.scaleBand(SR.map((q) => q[0]), [0, x0.bandwidth()]).padding(0.12);
      yAxis(svg, y, left, w - 4, fmt.usd);
      const tip = tooltip(el), bw = x1.bandwidth();
      r.forEach((q) => {
        SR.forEach(([k, lab, c]) => {
          svg.append('rect').attr('x', x0(q.block) + x1(k)).attr('width', bw).attr('y', y(q[k])).attr('height', y(0) - y(q[k])).attr('rx', 3).attr('fill', c)
            .on('mousemove', (ev) => tip.show(ev, q.block, SR.map(([kk, ll, cc]) => [cc, ll, fmt.usdFull(q[kk])]))).on('mouseleave', () => tip.hide());
          const t = fmt.usdS(q[k]);
          if (bw >= t.length * 6) svg.append('text').attr('x', x0(q.block) + x1(k) + bw / 2).attr('y', y(q[k]) - 5).attr('text-anchor', 'middle').attr('class', 'ub-val').attr('font-size', bw > 44 ? 12 : 10).text(t);
        });
        svg.append('text').attr('x', x0(q.block) + x0.bandwidth() / 2).attr('y', h - 10).attr('text-anchor', 'middle').attr('class', 'ub-tick ub-tick-on').text(q.block);
      });
      legend(el, SR.map(([, l, c]) => [c, l]));
      return { columns: ['Block', 'Beginning', 'Created', 'Won', 'Lost', 'Ending'], rows: r.map((q) => [q.block, fmt.usdFull(q.beginning), fmt.usdFull(q.created), fmt.usdFull(q.won), fmt.usdFull(q.lost), fmt.usdFull(q.ending)]) };
    },
    note() {
      const pw = rows('pipeline_windows'); if (!pw) return '';
      const s = S(), c = pw.filter((x) => x.period === s.win), p = pw.filter((x) => x.period === s.winComp);
      const S2 = (a, k) => d3.sum(a, (x) => x[k]);
      return `Created ${fmt.usd(S2(c, 'created'))} (${WIN_LABEL[s.winComp]}: ${fmt.usd(S2(p, 'created'))}), won ${fmt.usd(S2(c, 'won'))}, lost ${fmt.usd(S2(c, 'lost'))}. Ending pipeline ${fmt.usd(S2(c, 'ending'))}.`;
    },
  };

  // ---------- Resellers and customers
  CARDS['c-customers'] = {
    kind: 'trend', src: ['kpi'], data: () => ['kpi'],
    draw(el, opt) {
      const d = need(el, this.data()); if (!d) return null;
      const s = S(), SR = [{ key: 'direct', label: 'Direct customers', color: B.peri }, { key: 'reseller', label: 'Resellers', color: B.sky }];
      const data = d.kpi.filter((k) => TREND(k.month)).map((k) => ({ month: k.month, direct: k.direct_customers_ending, reseller: k.resellers_ending, n: k.customers_new, c: k.customers_churned }));
      legend(el, SR.map((x) => [x.color, x.label]));
      stackedBars(el, { ...opt, rows: data, series: SR, highlight: WIN_MONTHS[s.win], yfmt: fmt.n, lab: fmt.n, height: 300 });
      return { columns: ['Month', 'Direct customers', 'Resellers', 'Total', 'New', 'Churned'], rows: data.map((r) => [fmt.monthLong(r.month), r.direct, r.reseller, r.direct + r.reseller, r.n, r.c]) };
    },
    note() {
      const mw = rows('mrr_windows'); if (!mw) return '';
      const s = S(), m = winRows(mw, s.win, (r) => r.channel === 'Total'), mc = winRows(mw, s.winComp, (r) => r.channel === 'Total');
      const r = winRows(mw, s.win, (x) => x.channel === 'Reseller'), rc = winRows(mw, s.winComp, (x) => x.channel === 'Reseller');
      return `${m.customers_ending} paying customers at period end (${fmt.signedN(m.customers_ending - mc.customers_ending)} vs ${WIN_LABEL[s.winComp]}): ${m.customers_new} added, ${m.customers_churned} churned. Resellers ${rc.customers_ending} to ${r.customers_ending}.`;
    },
  };

  CARDS['c-endclients'] = {
    kind: 'trend', src: ['end_clients', 'reseller_history', 'revenue'], data: () => [id('end_clients'), 'reseller_history', 'revenue'],
    draw(el, opt) {
      const d = need(el, this.data()); if (!d) return null;
      const s = S(), live = d[id('end_clients')].map((r) => ({ month: r.month, end_clients: +r.end_clients, resellers: +r.resellers, src: 'Metabase' }));
      const hist = d.reseller_history.filter((r) => !live.some((l) => l.month === r.month)).map((r) => ({ ...r, src: 'Sheet' }));
      const data = hist.concat(live).sort((a, z) => (a.month < z.month ? -1 : 1)).map((q) => ({ ...q, consumption: (pick(d.revenue, (r) => r.month === q.month) || {}).consumption }));
      const { w, h } = size(el, opt, 320), svg = svgFor(el, w, h);
      const y = d3.scaleLinear([0, d3.max(data, (q) => q.end_clients) * 1.3], [h - 28, 14]).nice();
      const y2 = d3.scaleLinear([0, d3.max(data, (q) => q.consumption || 0) * 1.18], [h - 28, 14]).nice();
      const left = 8 + d3.max(y.ticks(4), (t) => textW(svg, fmt.n(t))), right = 8 + d3.max(y2.ticks(4), (t) => textW(svg, fmt.usd(t)));
      const x = d3.scaleBand(data.map((q) => q.month), [left + 4, w - right]).padding(0.24);
      yAxis(svg, y, left, w - right, fmt.n);
      y2.ticks(4).forEach((t) => svg.append('text').attr('x', w - right + 8).attr('y', y2(t)).attr('dy', '0.32em').attr('class', 'ub-tick').attr('fill', B.mint).text(fmt.usd(t)));
      const hl = selMonths();
      const tip = tooltip(el), bw = x.bandwidth(), every = Math.ceil(data.length / Math.max(2, Math.floor((w - left - right) / 50)));
      data.forEach((q, i) => {
        const on = hl.includes(q.month), g = svg.append('g').attr('opacity', on ? 1 : 0.5), c = q.month === S().openMonth ? B.lav : B.deep;
        g.append('rect').attr('x', x(q.month)).attr('width', bw).attr('y', y(q.end_clients)).attr('height', y(0) - y(q.end_clients)).attr('rx', 3).attr('fill', c);
        if (bw >= 18) g.append('text').attr('x', x(q.month) + bw / 2).attr('y', y(q.end_clients) + 14).attr('text-anchor', 'middle').attr('class', 'ub-seg').attr('font-size', bw > 30 ? 11 : 9).attr('fill', B.fg).text(q.end_clients);
        if (bw >= 18) g.append('text').attr('x', x(q.month) + bw / 2).attr('y', y(0) - 6).attr('text-anchor', 'middle').attr('class', 'ub-seg').attr('font-size', 9).attr('fill', B.soft).text(q.resellers);
        if (i % every === 0 || on || i === data.length - 1) svg.append('text').attr('x', x(q.month) + bw / 2).attr('y', h - 8).attr('text-anchor', 'middle').attr('class', on ? 'ub-tick ub-tick-on' : 'ub-tick').attr('font-size', 11).text(q.month === S().openMonth ? fmt.month(q.month).slice(0, 3) + '*' : fmt.month(q.month));
        svg.append('rect').attr('class', 'ub-hit').attr('x', x(q.month)).attr('width', bw).attr('y', 0).attr('height', h - 24).attr('fill', 'transparent')
          .on('mousemove', (ev) => tip.show(ev, fmt.monthLong(q.month), [[c, 'End clients', fmt.n(q.end_clients)], [null, 'Resellers with active clients', fmt.n(q.resellers)], [B.mint, 'Consumption revenue', q.consumption != null ? fmt.usdFull(q.consumption) : 'not closed'], [null, 'Source', q.src === 'Sheet' ? 'Wins tab as published' : 'Metabase']])).on('mouseleave', () => tip.hide());
      });
      const pts = data.filter((q) => q.consumption != null);
      svg.append('path').attr('d', d3.line().x((q) => x(q.month) + bw / 2).y((q) => y2(q.consumption))(pts)).attr('fill', 'none').attr('stroke', B.mint).attr('stroke-width', 2);
      pts.forEach((q, i) => {
        svg.append('circle').attr('cx', x(q.month) + bw / 2).attr('cy', y2(q.consumption)).attr('r', 3).attr('fill', B.mint);
        if (bw >= 26 || i === pts.length - 1) svg.append('text').attr('x', x(q.month) + bw / 2).attr('y', y2(q.consumption) - 8).attr('text-anchor', 'middle').attr('class', 'ub-val').attr('font-size', 10).attr('fill', B.mint).text(fmt.usdS(q.consumption));
      });
      const top = data.reduce((a, q) => (q.end_clients > a.end_clients ? q : a), data[0]);
      callout(svg, w - right, x(top.month) + bw / 2, y(top.end_clients), `Record ${top.end_clients}${top.month === S().openMonth ? ', month to date' : ''}`, { lift: 22 });
      legend(el, [[B.deep, 'End clients (10+ resolutions)'], [B.soft, 'Active resellers (number at base)'], [B.mint, 'Consumption revenue (right axis)'], [B.lav, openLabel(S().openMonth, S().openMonth)]]);
      return { columns: ['Month', 'Reseller end clients', 'Resellers with active clients', 'Consumption revenue', 'Source'], rows: data.map((q) => [fmt.monthLong(q.month), q.end_clients, q.resellers, q.consumption != null ? fmt.usdFull(q.consumption) : '', q.src === 'Sheet' ? 'Wins tab' : 'Metabase']) };
    },
    note() {
      const ec = rows(id('end_clients')); if (!ec) return '';
      const s = S(), e = pick(ec, (x) => x.month === s.ecMonth), c = pick(ec, (x) => x.month === s.ecComp);
      if (!e || !c) return '';
      return `${e.end_clients} end clients in ${openLabel(s.ecMonth, s.openMonth)} vs ${c.end_clients} in ${fmt.monthLong(s.ecComp)} (${fmt.pct(chg(+e.end_clients, +c.end_clients))}), across ${e.resellers} resellers with active clients. Months before September 2025 come from the Wins tab as published.`;
    },
  };

  // ---------- Churn and retention
  CARDS['c-retention'] = {
    kind: 'close', src: ['kpi', 'stripe_churns', 'churn_reasons'], data: () => ['mrr_windows', CH(), 'kpi'],
    draw(el, opt) {
      const d = need(el, this.data()); if (!d) return null;
      const s = S(), m = winRows(d.mrr_windows, s.win, (r) => r.channel === 'Total'), mc = winRows(d.mrr_windows, s.winComp, (r) => r.channel === 'Total');
      const rsp = [kSeries(d.kpi, (k) => 1 - k.gross_usd_churn_rate), kSeries(d.kpi, (k) => 1 - k.net_usd_churn_rate), kSeries(d.kpi, (k) => k.sub_cancellation + k.sub_contraction), kSeries(d.kpi, (k) => k.customers_churned)];
      const cc = 'vs ' + WIN_LABEL[s.winComp], W = `period=${s.win}&channel=Total`;
      const lost = m.cancellation + m.contraction, lostc = mc.cancellation + mc.contraction;
      const items = [
        { label: 'Gross $ retention (monthly)', value: fmt.rate(m.gross_retention), delta: fmt.pts(m.gross_retention - mc.gross_retention), good: m.gross_retention >= mc.gross_retention, compText: cc, mark: { source: 'mrr_windows', field: 'gross_retention', where: W } },
        { label: 'Net $ retention (monthly)', value: fmt.rate(m.net_retention), delta: fmt.pts(m.net_retention - mc.net_retention), good: m.net_retention >= mc.net_retention, compText: cc, mark: { source: 'mrr_windows', field: 'net_retention', where: W } },
        { label: 'Lost MRR', value: fmt.usd(lost), delta: fmt.signedUsd(lost - lostc), good: lost <= lostc, compText: cc },
        { label: 'Customers churned', value: fmt.n(m.customers_churned), delta: fmt.signedN(m.customers_churned - mc.customers_churned), good: m.customers_churned <= mc.customers_churned, compText: cc, mark: { source: 'mrr_windows', field: 'customers_churned', where: W } },
      ];
      items.forEach((it, i) => { it.spark = rsp[i]; it.sparkColor = i < 2 ? B.mint : B.bad; });
      tiles(el, items, { ...opt, cols: (opt && opt.export) ? 4 : undefined });
      return { columns: ['Metric', WIN_LABEL[s.win], 'Change', 'Compared with'], rows: items.map((i) => [i.label, i.value, i.delta, WIN_LABEL[s.winComp]]) };
    },
    note() {
      const mw = rows('mrr_windows'), log = rows(CH()); if (!mw || !log) return '';
      const s = S(), ms = WIN_MONTHS[s.win];
      const r = log.filter((x) => ms.includes(x.churn_month)), byCat = d3.rollups(r.filter((x) => x.reason_category !== 'Not recorded'), (v) => d3.sum(v, (x) => x.mrr), (x) => x.reason_category).sort((a, b) => b[1] - a[1]);
      const nr = r.filter((x) => x.reason_category === 'Not recorded');
      let t = `Retention is the average monthly share of starting MRR kept, from the KPI sheet. Largest Stripe cancellations: ${topChurns(log, ms, 3) || 'none'}.`;
      if (byCat.length) t += ` Leading recorded reason: ${byCat[0][0].toLowerCase()} (${fmt.usd(byCat[0][1])}).`;
      if (nr.length) t += ` ${nr.length} churns (${fmt.usd(d3.sum(nr, (x) => x.mrr))}) have no reason recorded yet.`;
      return t;
    },
  };

  CARDS['c-churnmrr'] = {
    kind: 'trend', src: ['kpi'], data: () => ['kpi'],
    draw(el, opt) {
      const d = need(el, this.data()); if (!d) return null;
      const s = S(), SR = [{ key: 'direct', label: 'Direct', color: B.peri }, { key: 'reseller', label: 'Reseller', color: B.sky }];
      const data = d.kpi.filter((k) => TREND(k.month)).map((k) => ({ month: k.month, direct: k.direct_cancellation + (k.direct_contraction || 0), reseller: k.reseller_cancellation + (k.reseller_contraction || 0), n: k.customers_churned }));
      legend(el, SR.map((x) => [x.color, x.label]));
      const inR = data.filter((q) => WIN_MONTHS[s.win].includes(q.month)), d26 = inR.length ? inR : data, worst = d26.reduce((a, q) => (q.direct + q.reseller > a.direct + a.reseller ? q : a), d26[0]);
      const lg = (rows(CH()) || []).filter((x) => x.churn_month === worst.month).sort((a, z) => z.mrr - a.mrr).slice(0, 2).map((x) => x.customer.replace(/\s*\(.*\)/, '').split(' ')[0]);
      const notes = [{ month: worst.month, text: lg.length ? `${lg.join(' and ')} left` : 'Largest month' }];
      stackedBars(el, { ...opt, rows: data, series: SR, highlight: WIN_MONTHS[s.win], yfmt: fmt.usd, height: 310, notes });
      return { columns: ['Month', 'Direct lost MRR', 'Reseller lost MRR', 'Total', 'Customers churned'], rows: data.map((r) => [fmt.monthLong(r.month), fmt.usdFull(r.direct), fmt.usdFull(r.reseller), fmt.usdFull(r.direct + r.reseller), r.n]) };
    },
    note() {
      const kpi = rows('kpi'); if (!kpi) return '';
      const s = S(), ms = WIN_MONTHS[s.win], r = kpi.filter((k) => ms.includes(k.month));
      const worst = r.reduce((a, k) => ((k.sub_cancellation + k.sub_contraction) > (a ? a.sub_cancellation + a.sub_contraction : -1) ? k : a), null);
      if (!worst) return '';
      const lost = (k, p) => (+k[p + '_cancellation'] || 0) + (+k[p + '_contraction'] || 0);
      const dl = d3.sum(r, (k) => lost(k, 'direct')), rl = d3.sum(r, (k) => lost(k, 'reseller')), tl = dl + rl;
      const first = r[0], last = r[r.length - 1], rGrow = last.reseller_ending - first.reseller_beginning;
      let t = `Heaviest month: ${fmt.monthLong(worst.month)} at ${fmt.usd(worst.sub_cancellation + worst.sub_contraction)}.`;
      if (tl) t += ` ${dl >= rl ? 'Direct' : 'Reseller'} carried ${d3.format('.0%')(Math.max(dl, rl) / tl)} of the ${fmt.usd(tl)} lost MRR`;
      if (tl && rl) t += rGrow > rl ? `; reseller MRR still grew ${fmt.usd(rGrow)} net.` : rGrow > 0 ? `; reseller MRR grew ${fmt.usd(rGrow)} net.` : `; reseller MRR fell ${fmt.usd(-rGrow)} net.`;
      else if (tl) t += '.';
      return t;
    },
  };

  CARDS['c-reasons'] = {
    kind: 'close', src: ['stripe_churns', 'churn_reasons'], data: () => [CH()],
    draw(el, opt) {
      const d = need(el, this.data()); if (!d) return null;
      const s = S(), ms = selMonths();
      const r = d[CH()].filter((x) => ms.includes(x.churn_month));
      const data = d3.rollups(r, (v) => ({ mrr: d3.sum(v, (x) => x.mrr), n: v.length }), (x) => x.reason_category).map(([cat, v]) => ({ cat, ...v })).sort((a, b) => (a.cat === 'Not recorded') - (b.cat === 'Not recorded') || b.mrr - a.mrr);
      hbars(el, opt, data, { label: (q) => q.cat, value: (q) => q.mrr, color: (q) => (q.cat === 'Not recorded' ? B.prior : B.bad), fmtv: (v) => fmt.usd(v), sub: (q) => `${q.n} customer${q.n === 1 ? '' : 's'}` });
      return { columns: ['Reason', 'Lost MRR', 'Customers'], rows: data.map((q) => [q.cat, fmt.usdFull(q.mrr), q.n]) };
    },
    note() { return 'Each Stripe cancellation takes the HubSpot company churn reason where one is recorded, otherwise the churn log note, grouped into categories. Grey is churn with no reason recorded yet.'; },
  };

  CARDS['c-churnlog'] = {
    kind: 'close', src: ['stripe_churns', 'churn_reasons'], data: () => [CH()],
    draw(el) {
      const d = need(el, this.data()); if (!d) return null;
      const s = S(), ms = selMonths();
      const r = d[CH()].filter((x) => ms.includes(x.churn_month)).sort((a, b) => b.mrr - a.mrr);
      const tb = card('c-churnlog').querySelector('tbody');
      const cells = (x) => [x.customer, fmt.month(x.churn_month), x.channel, fmt.usdFull(x.mrr), x.reason_category, x.reason];
      tb.replaceChildren(...r.map((x) => { const tr = document.createElement('tr'); tr.dataset.key = x.key; cells(x).forEach((v) => { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); }); return tr; }));
      return { columns: ['Customer', 'Month', 'Channel', 'MRR', 'Reason category', 'Reason'], rows: r.map(cells) };
    },
    note() {
      const log = rows(CH()); if (!log) return '';
      const s = S(), ms = selMonths(), r = log.filter((x) => ms.includes(x.churn_month));
      const nr = r.filter((x) => x.reason_category === 'Not recorded').length;
      return `${r.length} Stripe cancellations, ${fmt.usd(d3.sum(r, (x) => x.mrr))} MRR, in ${WIN_LABEL[s.book]}. Voluntary ${r.filter((x) => x.churn_type === 'Voluntary').length}, involuntary ${r.filter((x) => x.churn_type === 'Involuntary').length} (from the churn log)${nr ? `; ${nr} with no reason recorded` : ''}.`;
    },
  };

  // ---------- Marketing
  CARDS['c-mqls'] = {
    kind: 'trend', src: ['mqls'], data: () => [id('mqls')],
    draw(el, opt) {
      const d = need(el, this.data()); if (!d) return null;
      const s = S(), mq = d[id('mqls')];
      const months = [...new Set(mq.map((r) => r.month))].filter((m) => TREND(m) || (m > S().lastClosed && S().months.includes(m))).sort();
      const data = months.map((m) => { const o = { month: m }; SRC.forEach(([x]) => { o[x] = d3.sum(mq.filter((r) => r.month === m && r.source === x), (r) => +r.mqls); }); return o; });
      const SR = SRC.filter(([x]) => data.some((q) => q[x])).map(([x, c]) => ({ key: x, label: x, color: c }));
      legend(el, SR.map((x) => [x.color, x.label]));
      stackedBars(el, { ...opt, rows: data, series: SR, highlight: selMonths(), yfmt: fmt.n, lab: fmt.n, height: 320, xlab: (m) => (m === S().openMonth ? fmt.month(m).slice(0, 3) + ' (MTD)' : fmt.month(m)) });
      return { columns: ['Month'].concat(SR.map((x) => x.label), ['Total']), rows: data.map((q) => [fmt.monthLong(q.month)].concat(SR.map((x) => q[x.key]), [d3.sum(SR, (x) => q[x.key])])) };
    },
    note() {
      const mq = rows(id('mqls')); if (!mq) return '';
      const s = S(), ms = WIN_MONTHS[s.win], cs = WIN_MONTHS[s.winComp];
      const t = (m) => d3.sum(mq.filter((r) => m.includes(r.month)), (r) => +r.mqls), org = d3.sum(mq.filter((r) => ms.includes(r.month) && r.source === 'Organic search'), (r) => +r.mqls);
      const ai = d3.sum(mq.filter((r) => ms.includes(r.month) && r.source === 'AI referrals'), (r) => +r.mqls), aic = d3.sum(mq.filter((r) => cs.includes(r.month) && r.source === 'AI referrals'), (r) => +r.mqls);
      return `${t(ms)} MQLs in ${WIN_LABEL[s.win]} vs ${t(cs)} in ${WIN_LABEL[s.winComp]}; organic search ${d3.format('.0%')(t(ms) ? org / t(ms) : 0)} of the total. AI referrals ${ai} (from ${aic}).`;
    },
  };

  CARDS['c-funnel'] = {
    kind: 'close', src: ['mqls', 'kpi', 'opps_split'], data: () => [state.data === 'frozen' ? 'funnel_windows_frozen' : 'funnel_windows'],
    draw(el, opt) {
      const fid = this.data()[0], d = need(el, [fid]); if (!d) return null;
      const s = S(), cur = d[fid].filter((r) => r.period === s.win), cmp = d[fid].filter((r) => r.period === s.winComp);
      const { w } = size(el, opt, 0), h = (opt && opt.h) || cur.length * 60 + 6, rowH = Math.min(60, (h - 6) / cur.length);
      const svg = svgFor(el, w, h);
      const labW = d3.max(cur, (q) => textW(svg, (q.sub ? '↳ ' : '') + q.stage, 'ub-lab') + (q.sub ? 14 : 0)) + 16;
      const x = d3.scaleLinear([0, d3.max(cur.concat(cmp), (q) => q.value) || 1], [0, w - labW - 170]);
      const tip = tooltip(el);
      let lastMain = null;
      cur.forEach((q, i) => {
        const y0 = i * rowH + 6, c = cmp[i], sub = !!q.sub, ind = sub ? 14 : 0;
        svg.append('text').attr('x', ind).attr('y', y0 + 20).attr('class', sub ? 'ub-tick' : 'ub-lab').attr('font-size', sub ? 12 : null).text(sub ? '↳ ' + q.stage : q.stage);
        svg.append('rect').attr('x', labW).attr('y', y0 + 4).attr('height', sub ? 16 : 22).attr('rx', 4).attr('width', Math.max(3, x(q.value))).attr('fill', sub ? B.lav : B.peri).attr('opacity', sub ? 0.85 : 1)
          .on('mousemove', (ev) => tip.show(ev, q.stage, [[B.peri, WIN_LABEL[s.win], fmt.n(q.value)], [B.prior, WIN_LABEL[s.winComp], fmt.n(c.value)]])).on('mouseleave', () => tip.hide());
        svg.append('rect').attr('x', labW).attr('y', y0 + (sub ? 24 : 30)).attr('height', sub ? 6 : 8).attr('rx', 3).attr('width', Math.max(3, x(c.value))).attr('fill', B.prior);
        svg.append('text').attr('x', labW + Math.max(3, x(q.value)) + 8).attr('y', y0 + (sub ? 17 : 20)).attr('class', 'ub-val').attr('font-size', sub ? 12 : null).text(fmt.n(q.value));
        svg.append('text').attr('x', labW + Math.max(3, x(c.value)) + 8).attr('y', y0 + (sub ? 31 : 38)).attr('class', 'ub-tick').attr('font-size', 10).text(fmt.n(c.value));
        if (sub) return;
        if (lastMain && lastMain.value && q.value <= lastMain.value) svg.append('text').attr('x', w - 2).attr('y', y0 + 20).attr('text-anchor', 'end').attr('class', 'ub-tick').text(d3.format('.0%')(q.value / lastMain.value) + ' of previous step');
        lastMain = q;
      });
      legend(el, [[B.peri, WIN_LABEL[s.win]], [B.prior, WIN_LABEL[s.winComp]]]);
      return { columns: ['Stage', WIN_LABEL[s.win], WIN_LABEL[s.winComp]], rows: cur.map((q, i) => [(q.sub ? '  of which: ' : '') + q.stage, q.value, cmp[i].value]) };
    },
    note() {
      const fid = this.data()[0], f = rows(fid); if (!f) return '';
      const s = S(), c = f.filter((r) => r.period === s.win), g = (n) => (pick(c, (r) => r.stage === n) || {}).value || 0;
      const split = d3.sum(c.filter((r) => r.sub), (r) => r.value);
      return `New opportunities is the KPI sheet's month-end count (${fmt.n(g('New opportunities'))}) and includes upsell deals in the Expansion pipeline. The split below it is HubSpot today (${fmt.n(split)} deals): marketing-sourced new business came from the same channels as MQLs; other new business is reseller, sales-entered, direct-traffic and referral deals that never pass through an MQL; expansion is upsell to existing customers. HubSpot runs higher because deals moved in from the Qualification pipeline after month end keep their original created date. New customers are all new paying customers in Stripe, from any source.`;
    },
  };

  // ---------- Internal
  CARDS['c-sources'] = {
    kind: 'static', src: [], data: () => ['snapshot_info'],
    draw(el) {
      const d = need(el, this.data()); if (!d) return null;
      const r = d.snapshot_info;
      const tb = card('c-sources').querySelector('tbody');
      const cells = (x) => [x.label, fmt.date(x.as_of), x.covers, x.refresh];
      tb.replaceChildren(...r.map((x) => { const tr = document.createElement('tr'); tr.dataset.key = x.source; cells(x).forEach((v) => { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); }); return tr; }));
      return { columns: ['Source', 'As of', 'Covers', 'Refresh'], rows: r.map(cells) };
    },
    note: () => `Numbers mode: ${state.data === 'frozen' ? `board snapshot. Pipeline, MQLs and end clients show ${snapDate()} values for everyone.` : 'live. Pipeline, MQLs and end clients query Metabase with your own access.'}`,
  };
  CARDS['c-checks'] = {
    kind: 'static', src: [], data: () => ['checks'],
    draw(el) {
      const d = need(el, this.data()); if (!d) return null;
      const tb = card('c-checks').querySelector('tbody');
      tb.replaceChildren(...d.checks.map((r) => { const tr = document.createElement('tr'); tr.dataset.key = r.item;
        [r.check, r.item, r.status, r.finding].forEach((v, i) => { const td = document.createElement('td'); td.textContent = v; if (i === 2) td.className = 'ub-status ub-status-' + v.toLowerCase().replace(/\s+/g, '-'); tr.appendChild(td); }); return tr; }));
      return { columns: ['Check', 'Item', 'Status', 'Finding'], rows: d.checks.map((r) => [r.check, r.item, r.status, r.finding]) };
    },
    note: () => '',
  };

  CARDS['c-stripekpi'] = {
    kind: 'static', src: ['stripe_churns', 'kpi'], data: () => ['stripe_vs_kpi'],
    draw(el) {
      const d = need(el, this.data()); if (!d) return null;
      const tb = card('c-stripekpi').querySelector('tbody');
      const cells = (r) => [fmt.monthLong(r.month), fmt.usdFull(r.kpi_lost), fmt.usdFull(r.stripe_lost), fmt.signedUsd(r.lost_diff), String(r.kpi_churned), String(r.stripe_churned), fmt.usdFull(r.kpi_ending), fmt.usdFull(r.stripe_ending), fmt.signedUsd(r.ending_diff), r.status];
      const rws = d.stripe_vs_kpi.slice().reverse();
      tb.replaceChildren(...rws.map((r) => { const tr = document.createElement('tr'); tr.dataset.key = r.month;
        cells(r).forEach((v, i) => { const td = document.createElement('td'); td.textContent = v; if (i === 9) td.className = 'ub-status ub-status-' + (r.status === 'Matches' ? 'matches' : 'differs'); tr.appendChild(td); }); return tr; }));
      return { columns: ['Month', 'KPI lost MRR', 'Stripe lost MRR', 'Difference', 'KPI churned', 'Stripe churned', 'KPI ending MRR', 'Stripe ending MRR', 'Difference', 'Status'], rows: rws.map(cells) };
    },
    note() {
      const v = rows('stripe_vs_kpi'); if (!v || !v.length) return '';
      const churnSame = v.filter((r) => r.status === 'Matches' || r.status.startsWith('Churn matches')).length, first = v.find((r) => r.status === 'Matches');
      return `Lost MRR and churned customers agree in ${churnSame} of ${v.length} months${first ? `; everything agrees from ${fmt.monthLong(first.month)} on, the month of the Stripe true-up` : ''}. The published KPI sheet stays the board's source until the year-end rebase; this is what that restatement would change.`;
    },
  };

  // ---------- Deck-format cards (the views the board saw in May)
  // Small bar panel inside a larger SVG, used for the churn summary grid.
  function panel(svg, x0, y0, w, h, title, data, f, color, horiz) {
    const g = svg.append('g').attr('transform', `translate(${x0},${y0})`);
    g.append('rect').attr('width', w).attr('height', h).attr('rx', 8).attr('fill', B.bg).attr('stroke', B.line);
    g.append('text').attr('x', 12).attr('y', 22).attr('class', 'ub-lab ub-lab-strong').attr('font-size', 13).text(title);
    if (!data.length) { g.append('text').attr('x', 12).attr('y', 48).attr('class', 'ub-tick').text('None in this period'); return; }
    const top = 34, pad = 12;
    if (horiz) {
      const lw = Math.min(w * 0.42, d3.max(data, (q) => q.label.length) * 6.4 + 8), rh = (h - top - pad) / data.length;
      const x = d3.scaleLinear([0, d3.max(data, (q) => q.value) || 1], [0, w - lw - pad - 52]);
      data.forEach((q, i) => {
        const y = top + i * rh;
        g.append('text').attr('x', pad).attr('y', y + rh / 2).attr('dy', '0.35em').attr('class', 'ub-tick').attr('font-size', 11).text(q.label);
        g.append('rect').attr('x', lw).attr('y', y + rh * 0.18).attr('height', rh * 0.64).attr('rx', 3).attr('width', Math.max(2, x(q.value))).attr('fill', color);
        g.append('text').attr('x', lw + Math.max(2, x(q.value)) + 6).attr('y', y + rh / 2).attr('dy', '0.35em').attr('class', 'ub-val').attr('font-size', 11).text(f(q.value));
      });
    } else {
      const x = d3.scaleBand(data.map((q) => q.label), [pad, w - pad]).padding(0.25), y = d3.scaleLinear([0, (d3.max(data, (q) => q.value) || 1) * 1.2], [h - 24, top + 4]);
      data.forEach((q) => {
        g.append('rect').attr('x', x(q.label)).attr('width', x.bandwidth()).attr('y', y(q.value)).attr('height', y(0) - y(q.value)).attr('rx', 3).attr('fill', color);
        g.append('text').attr('x', x(q.label) + x.bandwidth() / 2).attr('y', y(q.value) - 5).attr('text-anchor', 'middle').attr('class', 'ub-val').attr('font-size', 11).text(f(q.value));
        g.append('text').attr('x', x(q.label) + x.bandwidth() / 2).attr('y', h - 8).attr('text-anchor', 'middle').attr('class', 'ub-tick').attr('font-size', 10).text(q.label);
      });
    }
  }
  const planName = (p) => String(p || 'Other').replace(/\s*\(.*$/, '').replace(/ Plan$/, '') || 'Other';

  CARDS['c-swsvc'] = {
    kind: 'trend', src: ['revenue'], data: () => ['revenue'],
    draw(el, opt) {
      const d = need(el, this.data()); if (!d) return null;
      const s = S(), SR = [{ key: 'software', label: 'Software revenue', color: B.peri }, { key: 'services', label: 'Services revenue', color: B.sky }];
      const data = d.revenue.filter((r) => TREND(r.month)).map((r) => ({ month: r.month, software: r.subscription + r.consumption + r.dsp + r.mail, services: r.services_retainer + r.services_projects }));
      legend(el, SR.map((x) => [x.color, x.label]));
      stackedBars(el, { ...opt, rows: data, series: SR, highlight: WIN_MONTHS[s.win], yfmt: fmt.usd, height: 320 });
      return { columns: ['Month', 'Software revenue', 'Services revenue', 'Total revenue'], rows: data.map((r) => [fmt.monthLong(r.month), fmt.usdFull(r.software), fmt.usdFull(r.services), fmt.usdFull(r.software + r.services)]) };
    },
    note() {
      const rw = rows('revenue_windows'); if (!rw) return '';
      const s = S(), c = winRows(rw, s.win), p = winRows(rw, s.winComp);
      const sw = (x) => x.subscription + x.usage, sv = (x) => x.services_retainer + x.services_projects;
      return `Software ${fmt.usd(sw(c))} (${fmt.pct(chg(sw(c), sw(p)))}) and services ${fmt.usd(sv(c))} in ${WIN_LABEL[s.win]}. Services includes one-off web projects (${fmt.usd(c.services_projects)}), which are left out of recurring metrics.`;
    },
  };

  CARDS['c-custdeck'] = {
    kind: 'trend', src: ['kpi'], data: () => ['kpi'],
    draw(el, opt) {
      const d = need(el, this.data()); if (!d) return null;
      const s = S(), data = d.kpi.filter((k) => TREND(k.month));
      const SR = [['customers_beginning', 'Beginning', B.soft], ['customers_new', 'New', B.sky], ['customers_churned', 'Churned', B.bad], ['customers_ending', 'Ending', B.deep]];
      const { w, h } = size(el, opt, 320), svg = svgFor(el, w, h);
      const y = d3.scaleLinear([-d3.max(data, (k) => k.customers_churned) * 1.4, d3.max(data, (k) => k.customers_ending) * 1.15], [h - 26, 12]).nice();
      const left = 8 + d3.max(y.ticks(5), (t) => textW(svg, fmt.n(t)));
      const x0 = d3.scaleBand(data.map((k) => k.month), [left + 4, w - 4]).padding(0.16), x1 = d3.scaleBand(SR.map((q) => q[0]), [0, x0.bandwidth()]).padding(0.1);
      yAxis(svg, y, left, w - 4, fmt.n, 5);
      const tip = tooltip(el), bw = x1.bandwidth(), fs = bw >= 14 ? 10 : 8;
      data.forEach((k) => {
        const on = WIN_MONTHS[s.win].includes(k.month), g = svg.append('g').attr('opacity', on ? 1 : 0.55);
        SR.forEach(([f, , c]) => {
          const v = f === 'customers_churned' ? -k[f] : k[f];
          g.append('rect').attr('x', x0(k.month) + x1(f)).attr('width', bw).attr('y', Math.min(y(v), y(0))).attr('height', Math.abs(y(v) - y(0))).attr('fill', c);
          if (bw >= 9) g.append('text').attr('x', x0(k.month) + x1(f) + bw / 2).attr('y', v >= 0 ? y(v) - 4 : y(v) + 11).attr('text-anchor', 'middle').attr('class', 'ub-val').attr('font-size', fs).text(fmt.n(v));
        });
        svg.append('text').attr('x', x0(k.month) + x0.bandwidth() / 2).attr('y', h - 8).attr('text-anchor', 'middle').attr('class', on ? 'ub-tick ub-tick-on' : 'ub-tick').attr('font-size', 11).text(fmt.month(k.month));
        svg.append('rect').attr('class', 'ub-hit').attr('x', x0(k.month)).attr('width', x0.bandwidth()).attr('y', 0).attr('height', h - 22).attr('fill', 'transparent')
          .on('mousemove', (ev) => tip.show(ev, fmt.monthLong(k.month), SR.map(([f, l, c]) => [c, l, fmt.n(k[f])]))).on('mouseleave', () => tip.hide());
      });
      legend(el, SR.map(([, l, c]) => [c, l + (l === 'Churned' ? ' (shown below zero)' : '')]));
      return { columns: ['Month', 'Beginning', 'New', 'Churned', 'Ending'], rows: data.map((k) => [fmt.monthLong(k.month), k.customers_beginning, k.customers_new, -k.customers_churned, k.customers_ending]) };
    },
    note() { return CARDS['c-customers'].note(); },
  };

  CARDS['c-churnsum'] = {
    kind: 'close', src: ['stripe_churns', 'churn_reasons'], data: () => [CH()],
    draw(el, opt) {
      const d = need(el, this.data()); if (!d) return null;
      const s = S(), ms = selMonths();
      const r = d[CH()].filter((x) => ms.includes(x.churn_month));
      const roll = (key, val) => d3.rollups(r, val, key).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
      const byMonth = ms.map((m) => ({ label: fmt.month(m), mrr: d3.sum(r.filter((x) => x.churn_month === m), (x) => x.mrr), n: r.filter((x) => x.churn_month === m).length }));
      const plans$ = roll((x) => planName(x.plan), (v) => d3.sum(v, (x) => x.mrr)).slice(0, 6), plansN = roll((x) => planName(x.plan), (v) => v.length).slice(0, 6);
      const share = (key) => roll(key, (v) => v.length / r.length);
      const { w } = size(el, opt, 0), h = (opt && opt.h) || 560, svg = svgFor(el, w, h);
      const cols = w > 760 ? 3 : 1, gap = 12, pw = (w - gap * (cols - 1)) / cols;
      const tileH = 64, ph = cols === 3 ? (h - tileH - gap * 2) / 2 : 220;
      svg.append('rect').attr('width', w).attr('height', tileH).attr('rx', 8).attr('fill', B.bg).attr('stroke', B.line);
      svg.append('text').attr('x', 16).attr('y', 42).attr('class', 'ub-big').attr('font-size', 28).attr('fill', B.bad).text(fmt.usdFull(d3.sum(r, (x) => x.mrr)));
      svg.append('text').attr('x', 16 + textW(svg, fmt.usdFull(d3.sum(r, (x) => x.mrr)), 'ub-big') * 0.85 + 14).attr('y', 40).attr('class', 'ub-sub').attr('fill', B.muted).text('churned MRR');
      svg.append('text').attr('x', w / 2).attr('y', 42).attr('class', 'ub-big').attr('font-size', 28).attr('fill', B.bad).text(fmt.n(r.length));
      svg.append('text').attr('x', w / 2 + 50).attr('y', 40).attr('class', 'ub-sub').attr('fill', B.muted).text('churned customers');
      const panels = [
        ['Churned MRR by month', byMonth.map((q) => ({ label: q.label, value: q.mrr })), fmt.usdS, false],
        ['Churned MRR by plan size', plans$, fmt.usdS, true],
        ['By customer type (share of count)', share((x) => x.customer_type || 'Other'), d3.format('.0%'), true],
        ['Churn count by month', byMonth.map((q) => ({ label: q.label, value: q.n })), fmt.n, false],
        ['Churn count by plan size', plansN, fmt.n, true],
        ['By channel (share of count)', share((x) => x.channel || 'Other'), d3.format('.0%'), true],
      ];
      panels.forEach(([t, data, f, hz], i) => {
        const cx = (i % cols) * (pw + gap), cy = tileH + gap + Math.floor(i / cols) * (ph + gap);
        panel(svg, cx, cy, pw, ph, t, data, f, B.bad, hz);
      });
      return { columns: ['Measure', 'Group', 'Value'], rows: panels.flatMap(([t, data, f]) => data.map((q) => [t, q.label, f(q.value)])) };
    },
    note() {
      const log = rows(CH()); if (!log) return '';
      const s = S(), ms = selMonths();
      const r = log.filter((x) => ms.includes(x.churn_month)), dir = r.filter((x) => x.channel === 'Direct');
      return `Stripe cancellations, with customer type from the churn log where the customer is in it. Direct accounts are ${d3.format('.0%')(r.length ? dir.length / r.length : 0)} of churned customers and ${d3.format('.0%')(d3.sum(r, (x) => x.mrr) ? d3.sum(dir, (x) => x.mrr) / d3.sum(r, (x) => x.mrr) : 0)} of churned MRR.`;
    },
  };

  CARDS['c-bookmonth'] = {
    kind: 'static', src: ['bookings'], data: () => ['bookings'],
    draw(el, opt) {
      const d = need(el, this.data()); if (!d) return null;
      // The calendar year of the range's end date, with quarters that have started (the open one marked to date).
      const s = S(), Y = s.end.slice(0, 4), tq = s.today.slice(0, 4) === Y ? Math.floor((+s.today.slice(5, 7) - 1) / 3) + 1 : 4;
      const sw = d.bookings.filter((b) => b.category === 'Software' && b.date.startsWith(Y));
      const months = [...new Set(sw.map((b) => b.date.slice(0, 7)))].sort();
      const data = months.map((m) => { const r = sw.filter((b) => b.date.startsWith(m)); return { month: m, tcv: d3.sum(r, (b) => b.tcv), n: r.filter((b) => b.tcv > 0).length }; });
      const qs = [['Q1', '01', '03'], ['Q2', '04', '06'], ['Q3', '07', '09'], ['Q4', '10', '12']].slice(0, tq).map(([q, a, z], i) => [i + 1 === tq && s.today.slice(0, 4) === Y ? q + ' to date' : q, a, z]).map(([q, a, z]) => { const r = sw.filter((b) => b.date.slice(5, 7) >= a && b.date.slice(5, 7) <= z); return { q, tcv: d3.sum(r, (b) => b.tcv), n: r.filter((b) => b.tcv > 0).length }; });
      const { w, h } = size(el, opt, 300), svg = svgFor(el, w, h);
      const split = w > 700 ? 0.64 : 1, w1 = w * split - (split < 1 ? 16 : 0);
      const y = d3.scaleLinear([0, (d3.max(data, (q) => q.tcv) || 1) * 1.4], [h - 44, 14]);
      const x = d3.scaleBand(data.map((q) => q.month), [0, w1]).padding(0.22);
      svg.append('text').attr('x', 0).attr('y', 10).attr('class', 'ub-eyebrow').text('BY MONTH, ' + Y);
      const tip = tooltip(el);
      data.forEach((q) => {
        svg.append('rect').attr('x', x(q.month)).attr('width', x.bandwidth()).attr('y', y(q.tcv)).attr('height', y(0) - y(q.tcv)).attr('rx', 3).attr('fill', B.peri)
          .on('mousemove', (ev) => tip.show(ev, fmt.monthLong(q.month), [[B.peri, 'TCV', fmt.usdFull(q.tcv)], [null, 'Deals', fmt.n(q.n)]])).on('mouseleave', () => tip.hide());
        svg.append('text').attr('x', x(q.month) + x.bandwidth() / 2).attr('y', y(q.tcv) - 5).attr('text-anchor', 'middle').attr('class', 'ub-val').attr('font-size', 11).text(fmt.usdS(q.tcv));
        svg.append('text').attr('x', x(q.month) + x.bandwidth() / 2).attr('y', h - 26).attr('text-anchor', 'middle').attr('class', 'ub-tick').attr('font-size', 11).text(d3.utcFormat('%b')(new Date(q.month + '-01T00:00:00Z')) + (q.month === s.openMonth ? '*' : ''));
        svg.append('text').attr('x', x(q.month) + x.bandwidth() / 2).attr('y', h - 8).attr('text-anchor', 'middle').attr('class', 'ub-tick').attr('font-size', 10).text(q.n + ' deals');
      });
      const bm = data.reduce((a, q) => (q.tcv > a.tcv ? q : a), data[0]);
      if (bm) callout(svg, w1, x(bm.month) + x.bandwidth() / 2, y(bm.tcv) - 16, 'Best month of ' + Y, { lift: 16 });
      if (split < 1) {
        const x2 = d3.scaleBand(qs.map((q) => q.q), [w1 + 32, w]).padding(0.25), y2 = d3.scaleLinear([0, d3.max(qs, (q) => q.tcv) * 1.2], [h - 44, 14]);
        svg.append('text').attr('x', w1 + 32).attr('y', 10).attr('class', 'ub-eyebrow').text('BY QUARTER');
        qs.forEach((q) => {
          svg.append('rect').attr('x', x2(q.q)).attr('width', x2.bandwidth()).attr('y', y2(q.tcv)).attr('height', y2(0) - y2(q.tcv)).attr('rx', 3).attr('fill', B.sky);
          svg.append('text').attr('x', x2(q.q) + x2.bandwidth() / 2).attr('y', y2(q.tcv) - 5).attr('text-anchor', 'middle').attr('class', 'ub-val').attr('font-size', 11).text(fmt.usdS(q.tcv));
          svg.append('text').attr('x', x2(q.q) + x2.bandwidth() / 2).attr('y', h - 26).attr('text-anchor', 'middle').attr('class', 'ub-tick').attr('font-size', 11).text(q.q);
          svg.append('text').attr('x', x2(q.q) + x2.bandwidth() / 2).attr('y', h - 8).attr('text-anchor', 'middle').attr('class', 'ub-tick').attr('font-size', 10).text(q.n + ' deals');
        });
      }
      return { columns: ['Period', 'Software TCV', 'Deals'], rows: data.map((q) => [fmt.monthLong(q.month), fmt.usdFull(q.tcv), q.n]).concat(qs.map((q) => [q.q + ' ' + Y, fmt.usdFull(q.tcv), q.n])) };
    },
    note() { return 'Software bookings by signed date. The open month (*) is month to date. Services projects are left out.'; },
  };

  CARDS['c-dealmix'] = {
    kind: 'book', src: ['bookings'], data: () => ['bookings', 'booking_totals'],
    draw(el, opt) {
      const d = need(el, this.data()); if (!d) return null;
      const s = S(), b = winRows(d.booking_totals, s.book), c = winRows(d.booking_totals, s.bookComp);
      const sel = (p) => d.bookings.filter((x) => x.category === 'Software' && x.date >= p.start && x.date <= p.end && x.tcv > 0);
      const cur = sel(b), cmp = sel(c);
      const types = ['New', 'Upsell', 'Reactivation'], chans = ['Reseller', 'Direct'];
      const { w } = size(el, opt, 0), h = (opt && opt.h) || 250, svg = svgFor(el, w, h);
      const half = w > 620 ? (w - 24) / 2 : w;
      panel(svg, 0, 0, half, h, `Deals by type, ${WIN_LABEL[s.book]} (prior in brackets)`, types.map((t) => ({ label: `${t} (${cmp.filter((x) => x.deal_type === t).length})`, value: cur.filter((x) => x.deal_type === t).length })), fmt.n, B.peri, true);
      if (w > 620) panel(svg, half + 24, 0, half, h, `Share of TCV by channel, ${WIN_LABEL[s.book]}`, chans.map((ch) => ({ label: ch, value: d3.sum(cur.filter((x) => x.channel === ch), (x) => x.tcv) / (d3.sum(cur, (x) => x.tcv) || 1) })), d3.format('.0%'), B.sky, true);
      return { columns: ['Group', WIN_LABEL[s.book], WIN_LABEL[s.bookComp]], rows: types.map((t) => [t + ' deals', cur.filter((x) => x.deal_type === t).length, cmp.filter((x) => x.deal_type === t).length])
        .concat(chans.map((ch) => [ch + ' share of TCV', d3.format('.0%')(d3.sum(cur.filter((x) => x.channel === ch), (x) => x.tcv) / (d3.sum(cur, (x) => x.tcv) || 1)), d3.format('.0%')(d3.sum(cmp.filter((x) => x.channel === ch), (x) => x.tcv) / (d3.sum(cmp, (x) => x.tcv) || 1))])) };
    },
    note: () => 'Deal counts by type and the channel split of software TCV.',
  };

  CARDS['c-pipetable'] = {
    kind: 'live', src: ['pipeline_open'], data: () => [id('pipeline_open')],
    draw(el, opt) {
      const d = need(el, this.data()); if (!d) return null;
      const p = d[id('pipeline_open')].map((r) => ({ ...r, pipeline: r.pipeline || (r.block === 'Upsell' ? 'Upsell' : 'Opportunity'), pipeline_value: +r.pipeline_value, deals: +r.deals, stage_order: +r.stage_order }));
      const pipes = ['Opportunity', 'Enterprise', 'Upsell'];
      const head = ['Pipeline', 'Stage', 'Deals', 'Value'], body2 = [];
      pipes.forEach((pp) => {
        const r = p.filter((x) => x.pipeline === pp);
        const st = d3.rollups(r, (v) => ({ n: d3.sum(v, (x) => x.deals), v: d3.sum(v, (x) => x.pipeline_value), o: v[0].stage_order }), (x) => x.stage).sort((a, b) => a[1].o - b[1].o);
        st.forEach(([stage, v]) => body2.push([pp, stage, String(v.n), fmt.usdFull(v.v)]));
        body2.push([pp + ' total', '', String(d3.sum(r, (x) => x.deals)), fmt.usdFull(d3.sum(r, (x) => x.pipeline_value))]);
      });
      body2.push(['Full pipeline TCV', '', String(d3.sum(p, (x) => x.deals)), fmt.usdFull(d3.sum(p, (x) => x.pipeline_value))]);
      if (!opt || !opt.export) htmlTable(el, head, body2, (r) => /total|Full/.test(r[0]));
      tableSvg(el, head, body2, opt);
      return { columns: head, rows: body2 };
    },
    note() {
      const p = rows(id('pipeline_open')); if (!p) return '';
      const tot = d3.sum(p, (r) => +r.pipeline_value), n = d3.sum(p, (r) => +r.deals);
      return `Full pipeline ${fmt.usd(tot)} across ${n} deals, by pipeline, block and stage.`;
    },
  };

  CARDS['c-mayfollow'] = {
    kind: 'static', src: ['may_pipeline'], data: () => ['may_pipeline'],
    draw(el) {
      const d = need(el, this.data()); if (!d) return null;
      const tb = card('c-mayfollow').querySelector('tbody');
      const cells = (x) => [x.deal, x.may_pipeline, fmt.usdFull(x.may_value), x.status_now, x.value_now ? fmt.usdFull(x.value_now) : '—', x.expected_close ? fmt.date(x.expected_close) : '—'];
      tb.replaceChildren(...d.may_pipeline.map((x) => { const tr = document.createElement('tr'); tr.dataset.key = x.deal; cells(x).forEach((v) => { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); }); return tr; }));
      return { columns: ['Deal', 'May pipeline', 'May value', 'Status now', 'Value now', 'Close date'], rows: d.may_pipeline.map(cells) };
    },
    note() {
      const m = rows('may_pipeline'); if (!m) return '';
      const open = m.filter((x) => x.value_now > 0);
      const top = open.slice().sort((x, z) => z.value_now - x.value_now)[0];
      return `${open.length} of the ${m.length} deals the May deck highlighted are still open (${fmt.usd(d3.sum(open, (x) => x.value_now))})${top ? `, led by ${top.deal}` : ''}; ${m.length - open.length} closed lost or churned.`;
    },
  };

  CARDS['c-mqlchannels'] = {
    kind: 'close', src: ['mqls', 'kpi'], data: () => [id('mqls'), 'kpi'],
    draw(el, opt) {
      const d = need(el, this.data()); if (!d) return null;
      const s = S(), mq = d[id('mqls')], ms = WIN_MONTHS[s.win], cs = WIN_MONTHS[s.winComp];
      const t = (m, src) => d3.sum(mq.filter((r) => m.includes(r.month) && (!src || r.source === src)), (r) => +r.mqls);
      const conv = (m) => d3.sum(d.kpi.filter((k) => m.includes(k.month)), (k) => k.mql_to_customer || 0);
      const head = ['Channel', WIN_LABEL[s.win], WIN_LABEL[s.winComp], 'Share'];
      const body2 = SRC.map(([src]) => [src, String(t(ms, src)), String(t(cs, src)), d3.format('.0%')(t(ms) ? t(ms, src) / t(ms) : 0)])
        .concat([['Total MQLs', String(t(ms)), String(t(cs)), '100%'], ['MQLs to paying customers', String(conv(ms)), String(conv(cs)), '']]);
      if (!opt || !opt.export) htmlTable(el, head, body2, (r) => /Total|paying/.test(r[0]));
      tableSvg(el, head, body2, opt);
      return { columns: head, rows: body2 };
    },
    note: () => 'By HubSpot original source. MQLs to paying customers is the KPI sheet’s count of new Stripe customers whose email domain matches an MQL.',
  };

  // ---------- takeaway titles: the conclusion first; the chart's name moves to the line under it
  const TAKE = {
    'c-highlights': () => `${S().short}: what went well`,
    'c-headline': () => { const mw = rows('mrr_windows'); if (!mw) return ''; const s = S(), m = winRows(mw, s.win, (r) => r.channel === 'Total'), c = winRows(mw, s.winComp, (r) => r.channel === 'Total');
      return `Subscription MRR ${up(m.license_ending, c.license_ending)} ${fmt.pct(chg(m.license_ending, c.license_ending)).slice(1)} to ${fmt.usd(m.license_ending)}, with ${fmt.signedUsd(m.net_new)} net new`; },
    'c-goals': () => { const ec = rows(id('end_clients')); if (!ec) return ''; const e = pick(ec, (x) => x.month === S().ecMonth) || ec[ec.length - 1];
      const ecG = (rows('goals') || []).find((g) => g.goal.startsWith('Active reseller')); if (!ecG) return '';
      return `End clients at ${d3.format('.0%')(e.end_clients / ecG.target)} of the ${fmt.n(ecG.target)} goal; ${fmt.n(e.resellers)} resellers with active clients`; },
    'c-mrrdef': () => { const k = rows('kpi'); if (!k) return ''; const r = pick(k, (x) => x.month === lastOf(S().win)); return r ? `${fmt.usd(r.license_mrr_ending)} subscription MRR builds to ${fmt.usd(r.blended_mrr)} total MRR` : ''; },
    'c-ov-book': () => TAKE['c-cumulative'](),
    'c-cumulative': () => { const dd = rows('booking_daily'); if (!dd) return ''; const s = S(), cur = dd.filter((r) => r.period === s.book), cmp = dd.filter((r) => r.period === s.bookComp);
      const lc = cur[cur.length - 1], same = cmp[Math.min(cur.length, cmp.length) - 1]; const dv = lc.tcv - same.tcv;
      return `${WIN_LABEL[s.book]} bookings finished ${fmt.usd(Math.abs(dv))} ${dv >= 0 ? 'ahead of' : 'behind'} ${WIN_LABEL[s.bookComp]}`; },
    'c-revmix': () => { const rw = rows('revenue_windows'); if (!rw) return ''; const s = S(), c = winRows(rw, s.win), p = winRows(rw, s.winComp);
      const dv = chg(c.recurring_total, p.recurring_total);
      return dv >= 0 ? `Recurring revenue up ${fmt.pct(dv).slice(1)} to ${fmt.usd(c.recurring_total)}` : `Recurring revenue ${fmt.usd(c.recurring_total)}: usage dipped while subscription MRR grew`; },
    'c-swsvc': () => { const rw = rows('revenue_windows'); if (!rw) return ''; const c = winRows(rw, S().win), sw = c.subscription + c.usage, tot = sw + c.services_retainer + c.services_projects;
      return `Software is ${d3.format('.0%')(sw / tot)} of revenue in ${WIN_LABEL[S().win]}`; },
    'c-revdetail': () => { const rw = rows('revenue_windows'); if (!rw) return ''; const c = winRows(rw, S().win); return `${fmt.usd(c.subscription)} subscription and ${fmt.usd(c.usage)} usage revenue in ${WIN_LABEL[S().win]}`; },
    'c-mrrtrend': () => { const mw = rows('mrr_windows'); if (!mw) return ''; const s = S(), r = winRows(mw, s.win, (x) => x.channel === 'Reseller'), rc = winRows(mw, s.winComp, (x) => x.channel === 'Reseller');
      return `Reseller licenses ${up(r.ending, rc.ending)} ${fmt.pct(chg(r.ending, rc.ending)).slice(1)} to ${fmt.usd(r.ending)}`; },
    'c-bridge': () => { const mw = rows('mrr_windows'); if (!mw) return ''; const m = winRows(mw, S().win, (r) => r.channel === state.channel);
      return `${state.channel === 'Total' ? '' : state.channel + ' '}MRR ${fmt.signedUsd(m.net_new)} net: ${fmt.usd(m.new + m.expansion + m.reactivation)} added, ${fmt.usd(m.contraction + m.cancellation)} lost`; },
    'c-salestiles': () => { const bt = rows('booking_totals'); if (!bt) return ''; const s = S(), b = winRows(bt, s.book), c = winRows(bt, s.bookComp);
      return `Software bookings ${up(b.tcv, c.tcv)} ${fmt.pct(chg(b.tcv, c.tcv)).slice(1)} to ${fmt.usd(b.tcv)}; average deal ${fmt.usd(b.avg_deal)}`; },
    'c-bookmonth': () => { const bk = rows('bookings'); if (!bk) return ''; const Y = S().end.slice(0, 4), sw = bk.filter((b) => b.category === 'Software' && b.date.startsWith(Y));
      const by = d3.rollups(sw, (v) => d3.sum(v, (b) => b.tcv), (b) => b.date.slice(0, 7)).sort((a, z) => z[1] - a[1])[0];
      return by ? `${fmt.monthLong(by[0]).split(' ')[0]} was the biggest bookings month of ${Y} at ${fmt.usd(by[1])}` : ''; },
    'c-groups': () => { const g = rows('booking_groups'); if (!g) return ''; const s = S(), r = g.filter((x) => x.period === s.book && x.dimension === state.dim).sort((a, z) => z.tcv - a.tcv);
      const tot = d3.sum(r, (x) => x.tcv); return r.length ? `${r[0].group} drove ${d3.format('.0%')(r[0].tcv / tot)} of ${WIN_LABEL[s.book]} TCV` : ''; },
    'c-dealmix': () => { const bt = rows('booking_totals'); if (!bt) return ''; const b = winRows(bt, S().book); return `${d3.format('.0%')(b.reseller_tcv / (b.tcv || 1))} of software TCV came through resellers`; },
    'c-topdeals': () => CARDS['c-topdeals'].note().replace(/\.$/, ''),
    'c-pipeline': () => { const p = rows(id('pipeline_open')); if (!p || !rows('bookings')) return ''; const tot = d3.sum(p, (r) => +r.pipeline_value);
      const lq = lastQ(); return `${fmt.usd(tot)} open pipeline, ${d3.format('.1f')(tot / lq.tcv)}x ${lq.label} software bookings`; },
    'c-pipetable': () => { const p = rows(id('pipeline_open')); if (!p) return ''; return `${fmt.usd(d3.sum(p, (r) => +r.pipeline_value))} across ${d3.sum(p, (r) => +r.deals)} open deals`; },
    'c-mayfollow': () => { const m = rows('may_pipeline'); if (!m) return ''; const open = m.filter((x) => x.value_now > 0); const top = open.slice().sort((x, z) => z.value_now - x.value_now)[0]; return top ? `${open.length} of ${m.length} May deals still open, led by ${top.deal} at ${fmt.usd(top.value_now)}` : `None of the ${m.length} May deals are still open`; },
    'c-pipemove': () => { const pw = rows('pipeline_windows'); if (!pw) return ''; const c = pw.filter((x) => x.period === S().win); return `${fmt.usd(d3.sum(c, (x) => x.created))} of new pipeline created in ${WIN_LABEL[S().win]}`; },
    'c-endclients': () => { const ec = rows(id('end_clients')); if (!ec) return ''; const s = S(), e = pick(ec, (x) => x.month === s.ecMonth) || ec[ec.length - 1];
      const max = d3.max(ec, (x) => +x.end_clients); return +e.end_clients >= max ? `Reseller end clients at a record ${e.end_clients}` : `${e.end_clients} reseller end clients across ${e.resellers} resellers`; },
    'c-custdeck': () => { const mw = rows('mrr_windows'); if (!mw) return ''; const s = S(), m = winRows(mw, s.win, (r) => r.channel === 'Total'), c = winRows(mw, s.winComp, (r) => r.channel === 'Total');
      return `${m.customers_ending} paying customers, ${fmt.signedN(m.customers_ending - c.customers_ending)} vs ${WIN_LABEL[s.winComp]}`; },
    'c-customers': () => { const mw = rows('mrr_windows'); if (!mw) return ''; const s = S(), r = winRows(mw, s.win, (x) => x.channel === 'Reseller'), c = winRows(mw, s.winComp, (x) => x.channel === 'Reseller');
      return `Paying resellers grew from ${c.customers_ending} to ${r.customers_ending}`; },
    'c-retention': () => { const mw = rows('mrr_windows'); if (!mw) return ''; const m = winRows(mw, S().win, (r) => r.channel === 'Total');
      return `${fmt.rate(m.gross_retention)} of MRR kept each month on average; ${fmt.rate(m.net_retention)} with expansion`; },
    'c-churnsum': () => { const log = rows(CH()); if (!log) return ''; const ms = selMonths();
      const r = log.filter((x) => ms.includes(x.churn_month)); const tot = d3.sum(r, (x) => x.mrr), dir = d3.sum(r.filter((x) => x.channel === 'Direct'), (x) => x.mrr);
      return r.length ? `${r.length} customers and ${fmt.usd(tot)} MRR churned; ${d3.format('.0%')(tot ? dir / tot : 0)} of it Direct, ${fmt.usd(tot / r.length)} a customer on average` : 'No churns logged in the period'; },
    'c-churnmrr': () => { const mw = rows('mrr_windows'); if (!mw) return ''; const s = S(), m = winRows(mw, s.win, (r) => r.channel === 'Total'), c = winRows(mw, s.winComp, (r) => r.channel === 'Total');
      const l = m.cancellation + m.contraction, lc = c.cancellation + c.contraction; return `Lost MRR ${fmt.usd(l)}, ${l <= lc ? 'down' : 'up'} ${fmt.usd(Math.abs(l - lc))} vs ${WIN_LABEL[s.winComp]}`; },
    'c-reasons': () => { const log = rows(CH()); if (!log) return ''; const ms = selMonths();
      const by = d3.rollups(log.filter((x) => ms.includes(x.churn_month) && x.reason_category !== 'Not recorded'), (v) => d3.sum(v, (x) => x.mrr), (x) => x.reason_category).sort((a, z) => z[1] - a[1]);
      return by.length ? `${by[0][0]} is the leading reason, at ${fmt.usd(by[0][1])} of lost MRR` : ''; },
    'c-mqls': () => { const mq = rows(id('mqls')); if (!mq) return ''; const ms = WIN_MONTHS[S().win], t = d3.sum(mq.filter((r) => ms.includes(r.month)), (r) => +r.mqls);
      const org = d3.sum(mq.filter((r) => ms.includes(r.month) && r.source === 'Organic search'), (r) => +r.mqls); return `${t} MQLs in ${WIN_LABEL[S().win]}, ${d3.format('.0%')(t ? org / t : 0)} from organic search`; },
    'c-mqlchannels': () => { const mq = rows(id('mqls')); if (!mq) return ''; const ms = WIN_MONTHS[S().win];
      const by = d3.rollups(mq.filter((r) => ms.includes(r.month)), (v) => d3.sum(v, (r) => +r.mqls), (r) => r.source).sort((a, z) => z[1] - a[1]); return by.length ? `${by[0][0]} is the top MQL channel` : ''; },
    'c-funnel': () => { const f = rows(state.data === 'frozen' ? 'funnel_windows_frozen' : 'funnel_windows'); if (!f) return ''; const c = f.filter((r) => r.period === S().win);
      const g = (n) => (pick(c, (r) => r.stage === n) || {}).value; return `${g('New customers')} new customers from ${g('New opportunities')} new opportunities; ${g('Marketing-sourced new business')} new-business deals came from marketing channels`; },
  };

  // ---------- plan tracker: targets from CFO.ai (read only), actuals from the Wins tabs, KPI sheet and HubSpot
  const PLAN_M = ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'], PLAN_HIST = ['2026-08', '2026-09'];
  const tgt = (T, m, ch, k) => { const r = pick(T, (x) => x.month === m && x.channel === ch && x.metric === k); return r ? +r.value : null; };
  const actOf = (A, m, ch) => pick(A, (x) => x.month === m && x.channel === ch);
  const caseOf = (T) => ((T && pick(T, (x) => x.case)) || {}).case || 'selected';
  const daysIn = (m) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
  // The month the tracker looks at: this month while it is inside the plan, else the nearest plan month.
  const planMonth = () => { const m = S().today.slice(0, 7); return m < PLAN_M[0] ? PLAN_M[0] : m > PLAN_M[5] ? PLAN_M[5] : m; };
  // Open month: share of the month gone, so month-to-date counts can be read at a full-month pace.
  const paceOf = (m) => { const t = S().today; if (t.slice(0, 7) !== m) return null; const d = +t.slice(8, 10), n = daysIn(m); return { d, n, f: n / d }; };
  // On pace at or above target, near within 10%, behind otherwise; lost MRR is good when at or under its allowance.
  function planStatus(a, t, lower) {
    if (a == null || t == null) return null;
    if (lower) return a <= t ? 'ok' : a <= t * 1.1 ? 'near' : 'bad';
    return a >= t ? 'ok' : a >= t * 0.9 ? 'near' : 'bad';
  }
  const ST_TEXT = { ok: 'on pace', near: 'within 10%', bad: 'behind' };
  const PLAN_ROWS = [
    ['new_mrr', 'New-customer MRR', 'book', fmt.usd], ['wins', 'New customers', 'book', fmt.n], ['expansion', 'Expansion MRR', 'close', fmt.usd],
    ['lost', 'MRR lost (churn and contraction)', 'close', fmt.usd, true], ['net_growth', 'Net change in MRR', 'close', fmt.signedUsd], ['ending', 'Ending MRR', 'close', fmt.usd],
  ];
  // New-customer MRR and count from the Wins tabs over the last 45 days, at a monthly rate.
  function last45(bk, ch) {
    const z = S().today, a = addDays(z, -44);
    const r = bk.filter((b) => b.category === 'Software' && b.new_logo && b.date >= a && b.date <= z && (!ch || b.channel === ch));
    const k = 30.4 / 45; return { mrr: d3.sum(r, (b) => b.mrr) * k, wins: r.length * k, n: r.length, sum: d3.sum(r, (b) => b.mrr) };
  }

  CARDS['c-plan-now'] = {
    kind: 'plan', src: ['plan_targets', 'bookings'], data: () => [id('plan_targets'), 'plan_actuals', 'bookings'],
    draw(el, opt) {
      const d = need(el, this.data()); if (!d) return null;
      const T = d[id('plan_targets')], A = d.plan_actuals, m = planMonth(), p = paceOf(m), cs = caseOf(T);
      const items = [], tab = [];
      const add = (label, ch, k, f) => {
        const a = actOf(A, m, ch), t = tgt(T, m, ch, k); if (!a) return;
        const v = a[k], proj = p ? v * p.f : v, st = planStatus(proj, t);
        items.push({ label, value: f(v), delta: p ? `pace ${f(proj)}` : f(v), good: st == null ? null : st !== 'bad', compText: `vs ${f(t)} ${cs} target`,
          foot: p ? `${p.d} of ${p.n} days · ${ST_TEXT[st] || ''}` : ST_TEXT[st] || '', mark: { source: 'plan_actuals', field: k, where: `month=${m}` } });
        tab.push([label, f(v), p ? f(proj) : '', f(t), ST_TEXT[st] || '']);
      };
      add('New-customer MRR', 'Total', 'new_mrr', fmt.usd); add('Direct new MRR', 'Direct', 'new_mrr', fmt.usd); add('Reseller new MRR', 'Reseller', 'new_mrr', fmt.usd);
      add('New customers', 'Total', 'wins', fmt.n); add('Direct new customers', 'Direct', 'wins', fmt.n); add('Reseller new customers', 'Reseller', 'wins', fmt.n);
      const l = last45(d.bookings), lt = tgt(T, m, 'Total', 'new_mrr'), lst = planStatus(l.mrr, lt);
      items.push({ label: 'Last 45 days, monthly pace', value: fmt.usd(l.mrr), delta: ST_TEXT[lst] || '', good: lst == null ? null : lst !== 'bad', compText: `vs ${fmt.usd(lt)} target`, foot: `${l.n} new customers, ${fmt.usd(l.sum)} new MRR` });
      tab.push(['Last 45 days, new MRR at a monthly pace', fmt.usd(l.mrr), '', fmt.usd(lt), ST_TEXT[lst] || '']);
      tiles(el, items, { ...opt, cols: (opt && opt.export) || el.clientWidth > 900 ? 4 : undefined });
      return { columns: ['Metric', `${fmt.monthLong(m)} so far`, 'Full-month pace', `${cs} target`, 'Status'], rows: tab };
    },
    note() {
      const T = rows(id('plan_targets')), A = rows('plan_actuals'); if (!T || !A) return '';
      const m = planMonth(), p = paceOf(m), f = p ? p.f : 1;
      const dr = actOf(A, m, 'Direct'), rr = actOf(A, m, 'Reseller'); if (!dr || !rr) return '';
      const dg = dr.new_mrr * f - tgt(T, m, 'Direct', 'new_mrr'), rg = rr.new_mrr * f - tgt(T, m, 'Reseller', 'new_mrr');
      const say = (n, g) => `${n} ${g >= 0 ? 'ahead by' : 'short by'} ${fmt.usd(Math.abs(g))}`;
      return `${p ? 'At the month-to-date pace' : 'In ' + fmt.monthLong(m)}: ${say('Direct', dg)}, ${say('Reseller', rg)} against the ${caseOf(T)} case. Expansion and lost MRR are scored once the month closes.`;
    },
  };

  CARDS['c-plan-trend'] = {
    kind: 'plan', src: ['plan_targets', 'bookings'], data: () => [id('plan_targets'), 'plan_actuals'],
    draw(el, opt) {
      const d = need(el, this.data()); if (!d) return null;
      const T = d[id('plan_targets')], A = d.plan_actuals, cs = caseOf(T), ms = PLAN_HIST.concat(PLAN_M);
      const SR = [{ key: 'Direct', label: 'Direct', color: B.peri }, { key: 'Reseller', label: 'Reseller', color: B.sky }];
      const data = ms.map((m) => { const p = paceOf(m), dr = actOf(A, m, 'Direct'), rr = actOf(A, m, 'Reseller');
        return { month: m, Direct: dr ? dr.new_mrr : 0, Reseller: rr ? rr.new_mrr : 0, has: m <= S().today.slice(0, 7), pace: p ? ((dr ? dr.new_mrr : 0) + (rr ? rr.new_mrr : 0)) * p.f : null, target: tgt(T, m, 'Total', 'new_mrr') }; });
      legend(el, SR.map((x) => [x.color, x.label]).concat([[B.amber, `${cs} target`], [B.muted, 'Pace for the open month']]));
      const { w, h } = size(el, opt, (opt && opt.height) || 300);
      const svg = svgFor(el, w, h);
      const max = d3.max(data, (r) => Math.max(r.Direct + r.Reseller, r.pace || 0, r.target || 0)) || 1;
      const y = d3.scaleLinear([0, max * 1.15], [h - 28, 16]).nice();
      const left = 8 + d3.max(y.ticks(4), (t) => textW(svg, fmt.usdS(t)));
      const x = d3.scaleBand(ms, [left + 4, w - 4]).padding(0.28), bw = x.bandwidth();
      yAxis(svg, y, left, w - 4, fmt.usdS);
      const tip = tooltip(el);
      data.forEach((r) => {
        let acc = 0;
        SR.forEach((s) => { const v = r[s.key]; if (!v) return; svg.append('rect').attr('x', x(r.month)).attr('width', bw).attr('y', y(acc + v)).attr('height', Math.max(0, y(acc) - y(acc + v))).attr('fill', s.color); acc += v; });
        if (r.pace != null && r.pace > acc) svg.append('rect').attr('x', x(r.month) + 0.5).attr('width', bw - 1).attr('y', y(r.pace)).attr('height', Math.max(0, y(acc) - y(r.pace))).attr('fill', 'none').attr('stroke', B.muted).attr('stroke-dasharray', '4 3');
        const top = Math.max(acc, r.pace || 0);
        if (acc) svg.append('text').attr('x', x(r.month) + bw / 2).attr('y', y(top) - 5).attr('text-anchor', 'middle').attr('class', 'ub-val').attr('font-size', 11).text(r.pace != null ? `${fmt.usdS(acc)} → ${fmt.usdS(r.pace)}` : fmt.usdS(acc));
        if (r.target != null) svg.append('line').attr('x1', x(r.month) - 4).attr('x2', x(r.month) + bw + 4).attr('y1', y(r.target)).attr('y2', y(r.target)).attr('stroke', B.amber).attr('stroke-width', 2.5).attr('stroke-linecap', 'round');
        svg.append('text').attr('x', x(r.month) + bw / 2).attr('y', h - 8).attr('text-anchor', 'middle').attr('class', PLAN_M.includes(r.month) ? 'ub-tick ub-tick-on' : 'ub-tick').text(fmt.month(r.month));
        svg.append('rect').attr('x', x(r.month) - x.step() * x.paddingInner() / 2).attr('width', x.step()).attr('y', 0).attr('height', h - 24).attr('fill', 'transparent').attr('class', 'ub-hit')
          .on('mousemove', (ev) => tip.show(ev, fmt.monthLong(r.month), [[B.peri, 'Direct', fmt.usdFull(r.Direct)], [B.sky, 'Reseller', fmt.usdFull(r.Reseller)]]
            .concat(r.pace != null ? [[B.muted, 'Full-month pace', fmt.usdFull(r.pace)]] : []).concat(r.target != null ? [[B.amber, `${cs} target`, fmt.usdFull(r.target)]] : [[null, 'Before the plan', '']])))
          .on('mouseleave', () => tip.hide());
      });
      return { columns: ['Month', 'Direct new MRR', 'Reseller new MRR', 'Total', 'Full-month pace', `${cs} target`],
        rows: data.map((r) => [fmt.monthLong(r.month), r.has ? fmt.usdFull(r.Direct) : '', r.has ? fmt.usdFull(r.Reseller) : '', r.has ? fmt.usdFull(r.Direct + r.Reseller) : '', r.pace != null ? fmt.usdFull(r.pace) : '', r.target != null ? fmt.usdFull(r.target) : '']) };
    },
    note() {
      const T = rows(id('plan_targets')); if (!T) return '';
      const a = tgt(T, PLAN_M[0], 'Total', 'new_mrr'), z = tgt(T, PLAN_M[5], 'Total', 'new_mrr');
      return `The ${caseOf(T)} case needs new-customer MRR to rise from ${fmt.usd(a)} in October to ${fmt.usd(z)} in March (${fmt.pct(Math.pow(z / a, 1 / 5) - 1)} a month). August and September are shown for the run rate going in.`;
    },
  };

  CARDS['c-plan-table'] = {
    kind: 'plan', src: ['plan_targets', 'kpi', 'bookings', 'revenue'], data: () => [id('plan_targets'), 'plan_actuals'],
    draw(el, opt) {
      const d = need(el, this.data()); if (!d) return null;
      const T = d[id('plan_targets')], A = d.plan_actuals, cs = caseOf(T), ms = PLAN_HIST.concat(PLAN_M);
      const head = ['Metric'].concat(ms.map((m) => fmt.month(m) + (PLAN_HIST.includes(m) ? ' (before plan)' : '')));
      const cell = (m, ch, k, kind, f, lower) => {
        const a = actOf(A, m, ch), t = PLAN_M.includes(m) ? tgt(T, m, ch, k) : null, p = paceOf(m);
        const v = a ? a[k] : null;
        if (!PLAN_M.includes(m)) return { main: v == null ? '—' : f(v), sub: '', st: null };
        if (a && a.closed && v != null) { const st = planStatus(v, t, lower); return { main: f(v), sub: `target ${f(t)}`, st }; }
        if (p && kind === 'book' && v != null) { const pr = v * p.f; return { main: `${f(v)}, pace ${f(pr)}`, sub: `target ${f(t)}`, st: planStatus(pr, t, lower) }; }
        if (p) return { main: 'after close', sub: `target ${f(t)}`, st: null, muted: true };
        return { main: f(t), sub: 'target', st: null, muted: true };
      };
      const body2 = [], text = [];
      [['Direct', 'Direct'], ['Reseller', 'Reseller'], ['Total', 'Total']].forEach(([ch, lab]) => {
        body2.push({ group: lab }); text.push([lab].concat(ms.map(() => '')));
        PLAN_ROWS.forEach(([k, label, kind, f, lower]) => {
          const cells = ms.map((m) => cell(m, ch, k, kind, f, lower));
          body2.push({ label, cells }); text.push([`${lab}: ${label}`].concat(cells.map((c) => c.sub ? `${c.main} (${c.sub})` : c.main)));
        });
      });
      { const cells = ms.map((m) => cell(m, 'Total', 'consumption', 'close', fmt.usd)); body2.push({ label: 'Consumption revenue', cells }); text.push(['Total: Consumption revenue'].concat(cells.map((c) => c.sub ? `${c.main} (${c.sub})` : c.main))); }
      if (!opt || !opt.export) {
        let wrapEl = el.querySelector(':scope > .ub-tablewrap');
        if (!wrapEl) { wrapEl = document.createElement('div'); wrapEl.className = 'ub-tablewrap'; el.appendChild(wrapEl); }
        const t = document.createElement('table'); t.className = 'ub-table ub-plan';
        const hr = document.createElement('tr'); head.forEach((h) => { const th = document.createElement('th'); th.textContent = h; hr.appendChild(th); });
        const th = document.createElement('thead'); th.appendChild(hr); t.appendChild(th);
        const tb = document.createElement('tbody');
        body2.forEach((r) => {
          const tr = document.createElement('tr');
          if (r.group) { tr.className = 'ub-plan-group'; const td = document.createElement('td'); td.colSpan = head.length; td.textContent = r.group; tr.appendChild(td); tb.appendChild(tr); return; }
          const td0 = document.createElement('td'); td0.textContent = r.label; tr.appendChild(td0);
          r.cells.forEach((c) => {
            const td = document.createElement('td'); if (c.st) td.className = 'ub-st-' + c.st; else if (c.muted) td.className = 'ub-st-muted';
            const a = document.createElement('div'); a.textContent = c.main; td.appendChild(a);
            if (c.sub) { const b = document.createElement('div'); b.className = 'ub-plan-sub'; b.textContent = c.sub; td.appendChild(b); }
            tr.appendChild(td);
          });
          tb.appendChild(tr);
        });
        t.appendChild(tb); wrapEl.replaceChildren(t);
      }
      tableSvg(el, head, text, opt);
      return { columns: head, rows: text };
    },
    note() {
      const T = rows(id('plan_targets')); if (!T) return '';
      return `Each plan month shows the actual against the ${caseOf(T)} case target: green on pace, amber within 10%, red behind. New-customer MRR and counts update daily from the Wins tabs; the rest fills in after each month closes.`;
    },
  };

  CARDS['c-plan-pipe'] = {
    kind: 'planlive', src: ['plan_targets', 'opps_channel', 'pipeline_open', 'bookings'], data: () => [id('plan_targets'), 'plan_actuals', id('opps_channel'), id('pipeline_open')],
    draw(el, opt) {
      const d = need(el, this.data()); if (!d) return null;
      const T = d[id('plan_targets')], A = d.plan_actuals, O = d[id('opps_channel')].map((r) => ({ ...r, created: +r.created, won: +r.won, lost: +r.lost }));
      const P = d[id('pipeline_open')].map((r) => ({ ...r, deals: +r.deals })), m = planMonth(), p = paceOf(m);
      const LATE = ['Proposal Sent', 'Decision Maker Aligned', 'Contract Sent'];
      const head = ['Channel', 'New customers: target', 'Won so far', 'Still needed', 'Open deals', 'Proposal or later', 'Win rate since Aug 1', 'Likely wins from open deals', 'Opportunities created this month', 'Opportunities needed a month'];
      const body2 = [];
      ['Direct', 'Reseller', 'Not yet tagged'].forEach((ch) => {
        const t = ch === 'Not yet tagged' ? null : tgt(T, m, ch, 'wins'), a = ch === 'Not yet tagged' ? null : actOf(A, m, ch);
        const since = O.filter((r) => r.block === ch && r.month >= '2026-08'), won = d3.sum(since, (r) => r.won), lost = d3.sum(since, (r) => r.lost), wr = won + lost ? won / (won + lost) : null;
        const open = P.filter((r) => r.block === ch), n = d3.sum(open, (r) => r.deals), late = d3.sum(open.filter((r) => LATE.includes(r.stage)), (r) => r.deals);
        const cr = d3.sum(O.filter((r) => r.block === ch && r.month === m), (r) => r.created);
        body2.push([ch === 'Not yet tagged' ? 'Account type not set' : ch, t == null ? '—' : fmt.n(t), a ? fmt.n(a.wins) : '—', t == null || !a ? '—' : fmt.n(Math.max(0, t - a.wins)),
          fmt.n(n), fmt.n(late), wr == null ? '—' : fmt.rate(wr), wr == null ? '—' : fmt.n(n * wr), p ? `${fmt.n(cr)}, pace ${fmt.n(cr * p.f)}` : fmt.n(cr), t == null || !wr ? '—' : fmt.n(Math.ceil(t / wr))]);
      });
      if (!opt || !opt.export) htmlTable(el, head, body2, () => false);
      tableSvg(el, head, body2, opt);
      return { columns: head, rows: body2 };
    },
    note() {
      const T = rows(id('plan_targets')), O = rows(id('opps_channel')); if (!T || !O) return '';
      const m = planMonth(), p = paceOf(m), cr = d3.sum(O.filter((r) => r.block === 'Direct' && r.month === m), (r) => +r.created), un = d3.sum(O.filter((r) => r.block === 'Not yet tagged' && r.month === m), (r) => +r.created);
      return `Direct needs about ${fmt.n(Math.ceil(tgt(T, m, 'Direct', 'wins') / 0.5))} new opportunities a month at a 50% win rate; ${fmt.n(cr)} Direct and ${fmt.n(un)} untagged opportunities were created ${p ? 'so far this month' : 'in ' + fmt.monthLong(m)}. Tagging account type on new deals shows how much of the gap is real.`;
    },
  };

  CARDS['c-plan-mix'] = {
    kind: 'plan', src: ['plan_targets', 'kpi', 'bookings'], data: () => [id('plan_targets'), 'plan_actuals', 'bookings', 'kpi'],
    draw(el, opt) {
      const d = need(el, this.data()); if (!d) return null;
      const T = d[id('plan_targets')], K = d.kpi.filter((k) => k.sub_ending != null), cs = caseOf(T);
      const last3 = K.slice(-3), first = PLAN_M[0];
      const pl = (ch) => d3.sum(PLAN_M, (m) => tgt(T, m, ch, 'new_mrr')), plT = pl('Direct') + pl('Reseller');
      const l = { Direct: last45(d.bookings, 'Direct'), Reseller: last45(d.bookings, 'Reseller') }, lT = l.Direct.mrr + l.Reseller.mrr;
      const pre = (ch) => d3.sum(d.bookings.filter((b) => b.category === 'Software' && b.new_logo && b.channel === ch && b.date >= '2026-05-01' && b.date <= '2026-07-31'), (b) => b.mrr), preT = pre('Direct') + pre('Reseller');
      const lossPct = (ch) => tgt(T, first, ch, 'lost') / tgt(T, first, ch, 'opening');
      const actLoss = (pfx) => d3.sum(last3, (k) => (+k[pfx + '_cancellation'] || 0) + (+k[pfx + '_contraction'] || 0)) / d3.sum(last3, (k) => +k[pfx + '_beginning']);
      const head = ['Channel', `${cs} case: share of new MRR`, 'Last 45 days', 'May to July', `${cs} case: new MRR per customer`, 'Last 45 days: new MRR per customer', `${cs} case: MRR lost a month`, `Actual, ${fmt.month(last3[0].month)} to ${fmt.month(last3[2].month)}`];
      const body2 = [['Direct', 'direct'], ['Reseller', 'reseller']].map(([ch, pfx]) => [ch, fmt.rate(pl(ch) / plT), fmt.rate(l[ch].mrr / lT), fmt.rate(pre(ch) / preT),
        fmt.usd(tgt(T, first, ch, 'new_mrr') / tgt(T, first, ch, 'wins')), l[ch].n ? fmt.usd(l[ch].sum / l[ch].n) : '—', fmt.rate(lossPct(ch)) + ' of opening', fmt.rate(actLoss(pfx)) + ' of opening']);
      if (!opt || !opt.export) htmlTable(el, head, body2, () => false);
      tableSvg(el, head, body2, opt);
      return { columns: head, rows: body2 };
    },
    note() {
      const T = rows(id('plan_targets')), bk = rows('bookings'); if (!T || !bk) return '';
      const m = PLAN_M[0], dl = tgt(T, m, 'Direct', 'lost'), dn = tgt(T, m, 'Direct', 'new_mrr');
      const l = last45(bk, 'Reseller'), ld = last45(bk, 'Direct');
      return `The plan already gives resellers most of the growth. ${fmt.usd(dl)} of Direct's ${fmt.usd(dn)} October target only replaces the MRR the plan expects Direct to lose. In the last 45 days resellers brought ${d3.format('.0%')(l.mrr / (l.mrr + ld.mrr))} of new MRR.`;
    },
  };

  // ---------- tables
  function htmlTable(el, head, body2, strong) {
    let wrapEl = el.querySelector(':scope > .ub-tablewrap');
    if (!wrapEl) { wrapEl = document.createElement('div'); wrapEl.className = 'ub-tablewrap'; el.appendChild(wrapEl); }
    const t = document.createElement('table'); t.className = 'ub-table';
    const tr = document.createElement('tr'); head.forEach((h) => { const th = document.createElement('th'); th.textContent = h; tr.appendChild(th); });
    const th = document.createElement('thead'); th.appendChild(tr); t.appendChild(th);
    const tb = document.createElement('tbody');
    body2.forEach((r) => { const row = document.createElement('tr'); if (strong && strong(r)) row.className = 'ub-strong'; r.forEach((c) => { const td = document.createElement('td'); td.textContent = c; row.appendChild(td); }); tb.appendChild(row); });
    t.appendChild(tb); wrapEl.replaceChildren(t);
  }
  // SVG copy of a table so Copy image works on table cards; hidden on the page.
  function tableSvg(el, head, body2, opt) {
    const colW = head.map((h, i) => Math.max(h.length, ...body2.map((r) => String(r[i]).length)) * 9 + 30);
    const w = d3.sum(colW), rh = 36, h = rh * (body2.length + 1);
    const svg = svgFor(el, w, h);
    if (!opt || !opt.export) svg.attr('class', 'ub-chart ub-offscreen');
    let x = 0;
    head.forEach((hd, i) => {
      const right = i > 0, tx = right ? x + colW[i] - 12 : x + 4;
      svg.append('text').attr('x', tx).attr('y', 23).attr('text-anchor', right ? 'end' : 'start').attr('class', 'ub-th').text(hd);
      body2.forEach((r, j) => svg.append('text').attr('x', tx).attr('y', rh * (j + 1) + 23).attr('text-anchor', right ? 'end' : 'start')
        .attr('class', /total/.test(r[0]) ? 'ub-td ub-td-strong' : 'ub-td').text(r[i]));
      x += colW[i];
    });
    body2.forEach((r, j) => svg.append('line').attr('x1', 0).attr('x2', w).attr('y1', rh * (j + 1) + 0.5).attr('y2', rh * (j + 1) + 0.5).attr('class', 'ub-grid'));
  }

  // ---------- as-of footers
  const LIVE_LABEL = { end_clients: 'Metabase · platform activity', mqls: 'HubSpot contacts via Metabase', pipeline_open: 'HubSpot deals via Metabase', opps_split: 'HubSpot deals via Metabase', plan_targets: "CFO.ai · Cash Forecast Q4'26-Q1'27 targets (read only)", opps_channel: 'HubSpot deals via Metabase', churn_reasons: 'HubSpot company churn reasons via Metabase' };
  function footer(c) {
    const info = rows('snapshot_info') || [];
    const parts = (CARDS[c].src || []).filter((x) => x !== 'goals').map((x) => {
      if (LIVE.includes(x)) {
        if (state.data === 'frozen') { const f = pick(info, (r) => r.source === 'frozen'); return `${LIVE_LABEL[x]}, board snapshot ${f ? fmt.date(f.as_of) : ''}`; }
        return `${LIVE_LABEL[x]}, live`;
      }
      const r = pick(info, (q) => q.source === x);
      return r ? `${r.label}, as of ${fmt.date(r.as_of)}` : '';
    }).filter(Boolean);
    if ((CARDS[c].src || []).includes('goals')) parts.unshift('Goals: ' + ((pick(raw('goals'), () => true) || {}).source || 'board goals').split(',')[0]);
    return parts.length ? 'Source: ' + parts.join(' · ') : '';
  }
  function periodText(kind) {
    const s = S();
    if (kind === 'book') return `${WIN_LABEL[s.book]} vs ${WIN_LABEL[s.bookComp]}`;
    if (kind === 'close') return `${WIN_LABEL[s.win]} vs ${WIN_LABEL[s.winComp]}`;
    if (kind === 'trend') { const k = (raw('kpi') || []).map((r) => r.month).filter(TREND); return `Monthly, ${fmt.monthLong(k[0] || s.win)} to ${fmt.monthLong(k[k.length - 1] || s.win)} · highlighted: ${WIN_LABEL[s.win]}`; }
    if (kind === 'plan' || kind === 'planlive') { const T = rows(id('plan_targets')), m = planMonth();
      return `${T ? caseOf(T) : 'Selected'} case targets, October 2026 to March 2027 · ${paceOf(m) ? fmt.monthLong(m) + ' to date' : fmt.monthLong(m)}${kind === 'planlive' ? (state.data === 'frozen' ? ' · pipeline as of the board snapshot' : ' · pipeline live') : ''}`; }
    if (kind === 'live') return state.data === 'frozen' ? `Open as of the board snapshot, ${snapDate()}` : 'Open right now (live)';
    return '';
  }

  // ---------- controls
  const bind = (sel, key) => $$(sel + ' button').forEach((b) => b.addEventListener('click', () => { state[key] = b.dataset.v; render(); }));
  try { const t = localStorage.getItem('ub-theme'); if (t === 'light' || t === 'dark') state.theme = t; } catch (e) { /* storage blocked: keep the default */ }
  $$('.ub-seg-theme button').forEach((b) => b.addEventListener('click', () => { state.theme = b.dataset.v; try { localStorage.setItem('ub-theme', state.theme); } catch (e) { /* not saved */ } render(); }));
  // Date range: a preset, or Custom once either date is edited. Remembered per viewer.
  const saveRange = () => { try { localStorage.setItem('ub-range', JSON.stringify({ preset: state.preset, start: state.start, end: state.end, cmp: state.cmp })); } catch (e) { /* not saved */ } };
  try { const r = JSON.parse(localStorage.getItem('ub-range') || 'null'); if (r && PRESETS.some((p) => p[0] === r.preset)) Object.assign(state, { preset: r.preset, start: r.start, end: r.end, cmp: r.cmp === 'yoy' ? 'yoy' : 'prior' }); } catch (e) { /* keep defaults */ }
  $('.ub-preset').addEventListener('change', (ev) => { state.preset = ev.target.value; saveRange(); render(); });
  ['.ub-start', '.ub-end'].forEach((sel) => $(sel).addEventListener('change', () => {
    const a = $('.ub-start').value, z = $('.ub-end').value; if (!a || !z) return;
    Object.assign(state, { preset: 'custom', start: a <= z ? a : z, end: a <= z ? z : a }); saveRange(); render();
  }));
  $$('.ub-seg-cmp button').forEach((b) => b.addEventListener('click', saveRange));
  bind('.ub-seg-cmp', 'cmp'); bind('.ub-seg-data', 'data'); bind('.ub-seg-channel', 'channel'); bind('.ub-seg-dim', 'dim');
  $$('.ub-tabs button').forEach((b) => b.addEventListener('click', () => { state.tab = b.dataset.tab; dash.setLink(b.dataset.tab); render(); }));
  document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('#ub [data-copy]'); if (!btn) return;
    const c = btn.closest('.ub-card');
    if (btn.dataset.copy === 'image') copyImage(c, btn, (el, opt) => CARDS[c.id].draw(el, opt));
    else copyTable(c, btn);
  });
  const named = location.hash.slice(1);
  if ($$('.ub-page').some((p) => p.id === named)) state.tab = named;

  // Point each card's source marks at the live or snapshot copy, so only the sources in use load.
  const dsMap = (x) => (x === 'funnel_windows' && state.data === 'frozen' ? 'funnel_windows_frozen' : x === 'churns' ? CH() : id(x));
  function markSources() {
    $$('[data-ds]').forEach((el) => el.setAttribute('data-source', el.dataset.ds.split(' ').map(dsMap).join(' ')));
    $$('[data-ds-table]').forEach((el) => el.setAttribute('data-source', dsMap(el.dataset.dsTable)));
  }

  // Today in the viewer's time zone; month-close numbers stop at the last month the KPI sheet has closed.
  function applyRange() {
    const n = new Date(), today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
    const k = (raw('kpi') || []).filter((r) => r.sub_ending != null).map((r) => r.month).sort();
    const lastClosed = k.length ? k[k.length - 1] : addMonths(monthStart(today), -1).slice(0, 7);
    let [start, end] = state.preset === 'custom' && state.start && state.end ? [state.start, state.end] : presetRange(state.preset, today);
    if (end > today) end = today;
    if (start > end) start = end;
    if (state.preset !== 'custom') Object.assign(state, { start, end });
    return setRange({ preset: state.preset, start, end, cmp: state.cmp, today, lastClosed, openMonth: today.slice(0, 7) });
  }

  function render() {
    const s = applyRange();
    $('.ub-preset').value = state.preset;
    $('.ub-start').value = s.start; $('.ub-end').value = s.end; $('.ub-start').max = s.today; $('.ub-end').max = s.today;
    setTheme(state.theme); paintSeries();
    document.getElementById('ub').dataset.theme = state.theme;
    $$('.ub-seg-theme button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === state.theme));
    markSources();
    $$('.ub-seg-cmp button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === state.cmp));
    $('.ub-cmplabel').textContent = `vs ${WIN_LABEL[s.bookComp]}`;
    $$('.ub-seg-data button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === state.data));
    $$('.ub-tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === state.tab));
    $$('.ub-page').forEach((p) => { p.hidden = p.id !== state.tab; });
    $('.ub-periodlabel').textContent = s.label;
    { const si = raw('snapshot_info') || [], d = si.map((x) => x.as_of).sort().pop(); if (d) $('.ub-asofdate').textContent = fmt.date(d); }
    $$('.ub-seg-data button').forEach((b) => { if (b.dataset.v === 'frozen') b.textContent = `Board snapshot, ${snapDate().replace(/, \d{4}$/, '')}`; });
    $('.ub-closenote').textContent = s.closeNote || '';
    $('.ub-closenote').hidden = !s.closeNote;
    const tk = $('.ub-takeaway'), hn = CARDS['c-headline'].note();
    tk.classList.toggle('dash-skeleton', !hn); tk.textContent = hn || '—';
    const page = document.getElementById(state.tab);
    page.querySelectorAll('.ub-card').forEach((c) => {
      const def = CARDS[c.id]; if (!def) return;
      const tt = c.querySelector('.ub-card-title'); if (!tt.dataset.name) tt.dataset.name = tt.textContent;
      const per = c.querySelector('.ub-card-period'); if (per && def.kind !== 'static') per.textContent = periodText(def.kind);
      if (per && TAKE[c.id]) per.textContent = tt.dataset.name + (per.textContent && def.kind !== 'static' ? ' · ' + periodText(def.kind) : '');
      if (per && churnCut(c.id)) per.textContent += ' · churn detail from January 2025';
      const t = def.draw(body(c.id), null); if (t) c._table = t;
      const ch = c.querySelector('.ub-changed'); if (ch) {
        let n = def.note();
        if (churnCut(c.id, CHURN_NOTE)) n = (n ? n + ' ' : '') + 'Customer-level churn starts in January 2025, when the Stripe history begins; months before that are not included.';
        ch.textContent = n; ch.hidden = !n;
      }
      if (TAKE[c.id]) { let t = ''; try { t = TAKE[c.id](); } catch (e) { t = ''; } tt.textContent = t || tt.dataset.name; }
    });
  }
  dash.onData(render);
  if (window.UB_FONT_LOADED) window.UB_FONT_LOADED.then((ok) => { if (ok) render(); });
})();
