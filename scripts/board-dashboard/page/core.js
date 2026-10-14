// Shared helpers: brand palette, formats, period windows, chart primitives with data labels, and copy-to-deck.
(function () {
  const B = {
    bg: '#020617', card: '#0b1024', line: '#1d2545', grid: '#151c38',
    fg: '#f8fafc', muted: '#94a3b8', faint: '#64748b',
    peri: '#9691f4', mint: '#85ffe8', sky: '#77d4fd', lav: '#d8b4fe', teal: '#99f6e4', deep: '#736fc2',
    prior: '#4a4f72', good: '#85ffe8', bad: '#fb7185', amber: '#fcd34d',
  };
  const MONO = '"JetBrains Mono", "IBM Plex Mono", ui-monospace, Menlo, monospace';
  const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
  const ok = (v) => v != null && !isNaN(v) && isFinite(v);
  const fmt = {
    usd: (v) => !ok(v) ? '—' : (v < 0 ? '−$' : '$') + (Math.abs(v) >= 10000 ? compact.format(Math.abs(v)) : d3.format(',.0f')(Math.abs(v))),
    usdS: (v) => !ok(v) ? '—' : (v < 0 ? '−$' : '$') + (Math.abs(v) >= 1000 ? compact.format(Math.abs(v)) : d3.format(',.0f')(Math.abs(v))),
    usdFull: (v) => !ok(v) ? '—' : (v < 0 ? '−$' : '$') + d3.format(',.0f')(Math.abs(v)),
    n: (v) => !ok(v) ? '—' : d3.format(',')(Math.round(v)),
    pct: (v) => !ok(v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + d3.format('.1%')(Math.abs(v)),
    rate: (v) => !ok(v) ? '—' : d3.format('.1%')(v),
    signedUsd: (v) => !ok(v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + '$' + (Math.abs(v) >= 10000 ? compact.format(Math.abs(v)) : d3.format(',.0f')(Math.abs(v))),
    signedN: (v) => !ok(v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + d3.format(',')(Math.abs(Math.round(v))),
    pts: (v) => !ok(v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + d3.format('.1f')(Math.abs(v * 100)) + ' pts',
    month: (m) => d3.utcFormat('%b %y')(new Date(m + '-01T00:00:00Z')),
    monthLong: (m) => d3.utcFormat('%B %Y')(new Date(m + '-01T00:00:00Z')),
    date: (d) => d3.utcFormat('%b %-d, %Y')(new Date(d + 'T00:00:00Z')),
  };

  // Picker choices. book = signed-date window for deals; win = whole months for month-close numbers.
  const BASE = {
    Q2: { label: 'Q2 2026', book: 'Q2', win: 'Q2', prior: ['Q1', 'Q1'], yoy: ['Q2_25', 'Q2_25'], ec: ['2026-06', '2026-03', '2025-09'] },
    Q3: { label: 'Q3 2026', book: 'Q3', win: 'Q3', prior: ['Q2', 'Q2'], yoy: ['Q3_25', 'Q3_25'], ec: ['2026-09', '2026-06', '2025-09'] },
    Oct: { label: 'October 2026 to date', book: 'Oct', win: 'Sep', prior: ['SepTD', 'Aug'], yoy: ['Oct_25', 'Sep_25'], ec: ['2026-10', '2026-09', '2025-10'],
      closeNote: 'October is still open, so MRR, revenue and customer counts show the latest closed month, September.' },
    YTD: { label: '2026 year to date', book: 'YTD', win: 'YTD', prior: ['YTD_25', 'YTD_25'], yoy: ['YTD_25', 'YTD_25'], ec: ['2026-09', '2025-09', '2025-09'],
      closeNote: 'Year to date runs January through September for month-close numbers and through the latest signed deal for bookings.' },
  };
  function spec(sel, cmp) {
    const b = BASE[sel], c = cmp === 'yoy' || sel === 'YTD' ? b.yoy : b.prior;
    return { ...b, bookComp: c[0], winComp: c[1], ecMonth: b.ec[0], ecComp: cmp === 'yoy' || sel === 'YTD' ? b.ec[2] : b.ec[1] };
  }
  const WIN_LABEL = { Q1: 'Q1 2026', Q2: 'Q2 2026', Q3: 'Q3 2026', Aug: 'August 2026', Sep: 'September 2026', Oct: 'October 2026 to date', SepTD: 'September 2026, same days',
    YTD: '2026 year to date', Q1_25: 'Q1 2025', Q2_25: 'Q2 2025', Q3_25: 'Q3 2025', Sep_25: 'September 2025', Oct_25: 'October 2025, same days', YTD_25: '2025, same period' };
  const WIN_MONTHS = { Q1: ['2026-01', '2026-02', '2026-03'], Q2: ['2026-04', '2026-05', '2026-06'], Q3: ['2026-07', '2026-08', '2026-09'], Aug: ['2026-08'], Sep: ['2026-09'],
    YTD: ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'],
    Q1_25: ['2025-01', '2025-02', '2025-03'], Q2_25: ['2025-04', '2025-05', '2025-06'], Q3_25: ['2025-07', '2025-08', '2025-09'], Sep_25: ['2025-09'],
    YTD_25: ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09'], Oct: ['2026-10'] };

  // ---------- chart scaffolding
  function size(el, opt, h) { return { w: (opt && opt.w) || Math.max(320, el.clientWidth), h: (opt && opt.h) || h }; }
  function svgFor(el, w, h) {
    d3.select(el).selectAll(':scope > svg.ub-chart').remove();
    return d3.select(el).append('svg').attr('class', 'ub-chart').attr('width', '100%').attr('viewBox', `0 0 ${w} ${h}`)
      .attr('preserveAspectRatio', 'xMinYMin meet').style('display', 'block');
  }
  function textW(svg, s, cls) {
    const t = svg.append('text').attr('class', cls || 'ub-tick').text(s);
    const w = t.node().getComputedTextLength(); t.remove(); return w;
  }
  // Text color that reads on a given fill.
  function ink(fill) { const c = d3.color(fill); if (!c) return B.fg; const { r, g, b } = c.rgb(); return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? B.bg : B.fg; }
  function tooltip(el) {
    let tip = el.querySelector(':scope > .ub-tip');
    if (!tip) { tip = document.createElement('div'); tip.className = 'ub-tip'; tip.hidden = true; el.appendChild(tip); }
    return {
      show(ev, title, lines) {
        tip.replaceChildren();
        const h = document.createElement('div'); h.className = 'ub-tip-h'; h.textContent = title; tip.appendChild(h);
        lines.forEach(([c, name, v]) => {
          const r = document.createElement('div'); r.className = 'ub-tip-r';
          if (c) { const s = document.createElement('span'); s.className = 'ub-sw'; s.style.background = c; r.appendChild(s); }
          const n = document.createElement('span'); n.textContent = name; r.appendChild(n);
          const b = document.createElement('b'); b.textContent = v; r.appendChild(b);
          tip.appendChild(r);
        });
        tip.hidden = false;
        const box = el.getBoundingClientRect();
        let x = ev.clientX - box.left + 12, y = ev.clientY - box.top + 12;
        const tw = tip.offsetWidth, th = tip.offsetHeight;
        if (x + tw > box.width) x = Math.max(0, ev.clientX - box.left - tw - 12);
        if (y + th > box.height) y = Math.max(0, ev.clientY - box.top - th - 12);
        tip.style.left = x + 'px'; tip.style.top = y + 'px';
      },
      hide() { tip.hidden = true; },
    };
  }
  function yAxis(svg, y, x0, x1, f, ticks) {
    const g = svg.append('g');
    y.ticks(ticks || 4).forEach((t) => {
      g.append('line').attr('x1', x0).attr('x2', x1).attr('y1', y(t)).attr('y2', y(t)).attr('class', t === 0 ? 'ub-axis' : 'ub-grid');
      g.append('text').attr('x', x0 - 8).attr('y', y(t)).attr('dy', '0.32em').attr('text-anchor', 'end').attr('class', 'ub-tick').text(f(t));
    });
  }
  function legend(el, items) {
    let lg = el.querySelector(':scope > .ub-legend');
    if (!lg) { lg = document.createElement('div'); lg.className = 'ub-legend'; el.prepend(lg); }
    lg.replaceChildren(...items.map(([c, t]) => { const s = document.createElement('span'); const i = document.createElement('i'); i.style.background = c; s.append(i, t); return s; }));
  }

  // Stacked monthly bars with segment and total labels where they fit.
  function stackedBars(el, opt) {
    const { rows, series, highlight, yfmt, lab } = opt;
    const { w, h } = size(el, opt, opt.height || 300);
    const svg = svgFor(el, w, h);
    const max = d3.max(rows, (r) => d3.sum(series, (s) => r[s.key] || 0)) || 1;
    const y = d3.scaleLinear([0, max * 1.14], [h - 28, 16]).nice();
    const left = 8 + d3.max(y.ticks(4), (t) => textW(svg, yfmt(t)));
    const x = d3.scaleBand(rows.map((r) => r.month), [left + 4, w - 4]).padding(0.24);
    yAxis(svg, y, left, w - 4, yfmt);
    const tip = tooltip(el), lf = lab || fmt.usdS;
    const every = Math.ceil(rows.length / Math.max(2, Math.floor((w - left) / 54)));
    const bw = x.bandwidth(), fs = bw >= 44 ? 11 : 10;
    rows.forEach((r, i) => {
      let acc = 0;
      const on = !highlight || highlight.includes(r.month);
      const g = svg.append('g').attr('opacity', on ? 1 : 0.4);
      series.forEach((s) => {
        const v = r[s.key] || 0; if (!v) return;
        const y0 = y(acc + v), hh = Math.max(0, y(acc) - y(acc + v));
        g.append('rect').attr('x', x(r.month)).attr('width', bw).attr('y', y0).attr('height', hh).attr('fill', s.color);
        const t = lf(v);
        if (series.length > 1 && hh >= 15 && bw >= t.length * fs * 0.62 + 4) g.append('text').attr('x', x(r.month) + bw / 2).attr('y', y0 + hh / 2).attr('dy', '0.35em')
          .attr('text-anchor', 'middle').attr('class', 'ub-seg').attr('font-size', fs).attr('fill', ink(s.color)).text(t);
        acc += v;
      });
      const tt = lf(acc);
      if (bw >= tt.length * fs * 0.6) g.append('text').attr('x', x(r.month) + bw / 2).attr('y', y(acc) - 5).attr('text-anchor', 'middle').attr('class', 'ub-val').attr('font-size', fs + 1).text(tt);
      if (i % every === 0 || on || i === rows.length - 1) svg.append('text').attr('x', x(r.month) + bw / 2).attr('y', h - 8).attr('text-anchor', 'middle').attr('class', on ? 'ub-tick ub-tick-on' : 'ub-tick').text(opt.xlab ? opt.xlab(r.month) : fmt.month(r.month));
      svg.append('rect').attr('x', x(r.month) - x.step() * x.paddingInner() / 2).attr('width', x.step()).attr('y', 0).attr('height', h - 24).attr('fill', 'transparent').attr('class', 'ub-hit')
        .on('mousemove', (ev) => tip.show(ev, fmt.monthLong(r.month), series.filter((s) => r[s.key]).map((s) => [s.color, s.label, yfmt === fmt.n ? fmt.n(r[s.key]) : fmt.usdFull(r[s.key])]).reverse()
          .concat(series.length > 1 ? [[null, 'Total', yfmt === fmt.n ? fmt.n(acc) : fmt.usdFull(acc)]] : [])))
        .on('mouseleave', () => tip.hide());
    });
    return svg;
  }

  // Row of headline tiles drawn in SVG so they copy as one image. item.mark = {source, field, where}
  function tiles(el, items, opt) {
    const { w } = size(el, opt, 0);
    const cols = (opt && opt.cols) || (w > 900 ? Math.min(items.length, 6) : w > 560 ? 3 : 2);
    const rowsN = Math.ceil(items.length / cols), th = 124, gap = 12;
    const tw = (w - gap * (cols - 1)) / cols, h = rowsN * th + (rowsN - 1) * gap;
    const svg = svgFor(el, w, h);
    items.forEach((it, i) => {
      const cx = (i % cols) * (tw + gap), cy = Math.floor(i / cols) * (th + gap);
      const g = svg.append('g').attr('transform', `translate(${cx},${cy})`);
      g.append('rect').attr('width', tw).attr('height', th).attr('rx', 10).attr('fill', B.bg).attr('stroke', B.line);
      g.append('text').attr('x', 16).attr('y', 26).attr('class', 'ub-eyebrow').text(it.label.toUpperCase());
      const v = g.append('text').attr('x', 16).attr('y', 70).attr('class', 'ub-big').text(it.value);
      if (it.mark) { v.attr('data-source', it.mark.source).attr('data-field', it.mark.field); if (it.mark.where) v.attr('data-where', it.mark.where); }
      if (it.delta != null) {
        const t = g.append('text').attr('x', 16).attr('y', 96).attr('class', 'ub-sub');
        t.append('tspan').attr('fill', it.good == null ? B.fg : it.good ? B.good : B.bad).attr('font-weight', 600).text(it.delta);
        t.append('tspan').attr('fill', B.muted).text(' ' + it.compText);
      }
      if (it.foot) g.append('text').attr('x', 16).attr('y', 114).attr('class', 'ub-tick').attr('font-size', 11).text(it.foot);
    });
  }

  // ---------- copy to deck: every image is 1280 x 720 (16:9) with title, period, note and as-of footer.
  const EXPORT = { W: 1280, H: 720, pad: 44 };
  const STYLE_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-family', 'font-size', 'font-weight', 'letter-spacing', 'text-anchor', 'dominant-baseline'];
  function inlineStyles(src, dst) {
    const cs = getComputedStyle(src);
    STYLE_PROPS.forEach((p) => { const v = cs.getPropertyValue(p); if (v) dst.style.setProperty(p, v); });
    for (let i = 0; i < src.children.length; i++) inlineStyles(src.children[i], dst.children[i]);
  }
  function wrap(text, maxChars, maxLines) {
    const words = String(text || '').split(/\s+/); const lines = []; let cur = '';
    words.forEach((wd) => { if ((cur + ' ' + wd).trim().length > maxChars) { lines.push(cur.trim()); cur = wd; } else cur += ' ' + wd; });
    if (cur.trim()) lines.push(cur.trim());
    if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…'; }
    return lines;
  }
  function buildExport(card, draw) {
    const { W, H, pad } = EXPORT;
    const title = card.querySelector('.ub-card-title').textContent;
    const period = (card.querySelector('.ub-card-period') || {}).textContent || '';
    const note = (card.querySelector('.ub-changed') || {}).textContent || '';
    const foot = (card.querySelector('.ub-card-source') || {}).textContent || '';
    const noteLines = wrap(note, 150, 2);
    const head = pad + 30 + 26 + noteLines.length * 21 + 14;
    const legendEl = card.querySelector('.ub-body > .ub-legend');
    const legendH = legendEl ? 26 : 0;
    const chartH = H - head - legendH - 46;
    const box = document.createElement('div'); box.className = 'ub-exportbox'; box.style.width = (W - pad * 2) + 'px';
    document.getElementById('ub').appendChild(box);
    try {
      draw(box, { w: W - pad * 2, h: chartH, export: true });
      const src = box.querySelector('svg.ub-chart');
      if (!src) throw new Error('Nothing to copy');
      const ns = 'http://www.w3.org/2000/svg';
      const out = document.createElementNS(ns, 'svg');
      out.setAttribute('xmlns', ns); out.setAttribute('width', W); out.setAttribute('height', H); out.setAttribute('viewBox', `0 0 ${W} ${H}`);
      const add = (tag, attrs, text) => { const n = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v)); if (text != null) n.textContent = text; out.appendChild(n); return n; };
      add('rect', { width: W, height: H, fill: B.card });
      const sans = 'Inter, system-ui, sans-serif';
      add('text', { x: pad, y: pad + 22, fill: B.fg, 'font-size': 28, 'font-weight': 600, 'font-family': sans }, title);
      add('text', { x: pad, y: pad + 50, fill: B.peri, 'font-size': 16, 'font-weight': 500, 'font-family': sans }, period);
      noteLines.forEach((l, i) => add('text', { x: pad, y: pad + 78 + i * 21, fill: B.muted, 'font-size': 15, 'font-family': sans }, l));
      if (legendEl) {
        let lx = pad;
        [...legendEl.children].forEach((s) => {
          const label = s.textContent; const color = s.querySelector('i').style.background;
          add('rect', { x: lx, y: head - 2, width: 11, height: 11, rx: 2, fill: color });
          add('text', { x: lx + 17, y: head + 8, fill: B.muted, 'font-size': 13, 'font-family': sans }, label);
          lx += 30 + label.length * 7.4;
        });
      }
      const clone = src.cloneNode(true);
      inlineStyles(src, clone);
      clone.querySelectorAll('.ub-hit').forEach((n) => n.remove());
      clone.removeAttribute('style'); clone.removeAttribute('class');
      clone.setAttribute('x', pad); clone.setAttribute('y', head + legendH); clone.setAttribute('width', W - pad * 2); clone.setAttribute('height', chartH);
      out.appendChild(clone);
      add('line', { x1: pad, x2: W - pad, y1: H - 30, y2: H - 30, stroke: B.line });
      add('text', { x: pad, y: H - 12, fill: B.faint, 'font-size': 12, 'font-family': MONO }, foot);
      add('text', { x: W - pad, y: H - 12, fill: B.faint, 'font-size': 12, 'font-family': MONO, 'text-anchor': 'end' }, 'Untitled · Confidential');
      return out;
    } finally { box.remove(); }
  }
  function toPng(svg) {
    const data = new XMLSerializer().serializeToString(svg);
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(data);
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas'); const s = 2;
        c.width = EXPORT.W * s; c.height = EXPORT.H * s;
        const ctx = c.getContext('2d'); ctx.scale(s, s); ctx.drawImage(img, 0, 0);
        c.toBlob((b) => b ? res({ blob: b, dataUrl: c.toDataURL('image/png') }) : rej(new Error('Could not draw the image')), 'image/png');
      };
      img.onerror = () => rej(new Error('Could not draw the image'));
      img.src = url;
    });
  }
  function flash(btn, msg) {
    const old = btn.dataset.label || btn.textContent; btn.dataset.label = old;
    btn.textContent = msg; setTimeout(() => { btn.textContent = old; }, 1600);
  }
  function showOverlay(dataUrl) {
    let ov = document.querySelector('#ub .ub-overlay');
    if (!ov) {
      ov = document.createElement('div'); ov.className = 'ub-overlay';
      const box = document.createElement('div'); box.className = 'ub-overlay-box';
      const p = document.createElement('p'); p.textContent = 'Your browser blocked the clipboard. Right-click the image and choose Copy image, then paste it into the deck.';
      const im = document.createElement('img'); im.alt = 'Chart image for the deck';
      const close = document.createElement('button'); close.className = 'ub-btn'; close.type = 'button'; close.textContent = 'Close';
      close.addEventListener('click', () => { ov.hidden = true; });
      box.append(p, im, close); ov.appendChild(box);
      document.getElementById('ub').appendChild(ov);
    }
    ov.querySelector('img').src = dataUrl; ov.hidden = false;
  }
  function copyImage(card, btn, draw) {
    let work;
    try { work = toPng(buildExport(card, draw)); } catch (e) { flash(btn, 'Could not copy'); return; }
    try {
      if (!window.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write) throw new Error('no clipboard');
      navigator.clipboard.write([new ClipboardItem({ 'image/png': work.then((r) => r.blob) })])
        .then(() => flash(btn, 'Copied'))
        .catch(() => work.then((r) => showOverlay(r.dataUrl)).catch(() => flash(btn, 'Could not copy')));
    } catch (e) {
      work.then((r) => showOverlay(r.dataUrl)).catch(() => flash(btn, 'Could not copy'));
    }
  }
  function copyTable(card, btn) {
    const t = card._table;
    if (!t) return flash(btn, 'No table');
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const html = '<table><thead><tr>' + t.columns.map((c) => `<th>${esc(c)}</th>`).join('') + '</tr></thead><tbody>' +
      t.rows.map((r) => '<tr>' + r.map((c) => `<td>${esc(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
    const tsv = [t.columns].concat(t.rows).map((r) => r.join('\t')).join('\n');
    const plain = () => navigator.clipboard.writeText(tsv).then(() => flash(btn, 'Copied')).catch(() => flash(btn, 'Could not copy'));
    try {
      navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([tsv], { type: 'text/plain' }) })])
        .then(() => flash(btn, 'Copied')).catch(plain);
    } catch (e) { plain(); }
  }

  window.UB = { B, MONO, fmt, spec, WIN_LABEL, WIN_MONTHS, size, svgFor, textW, ink, tooltip, yAxis, stackedBars, legend, tiles, copyImage, copyTable, wrap };
})();
