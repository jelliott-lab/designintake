// Small dependency-free SVG charts: grouped columns, a line, and horizontal bars.
// Colors come from CSS custom properties so light/dark mode swap in one place.
(function (root) {
  const NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => { if (v != null) n.setAttribute(k, v); });
    if (parent) parent.appendChild(n);
    return n;
  }

  // Clean axis ticks: 0 and 3-5 round steps up to >= max.
  function niceTicks(max, count) {
    if (!(max > 0)) return [0, 1];
    const raw = max / (count || 4);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    const ticks = [];
    for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
    if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
    return ticks;
  }

  // ---- tooltip (one shared element) ----
  let tip;
  function showTip(html, evt) {
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'chart-tip';
      tip.setAttribute('role', 'tooltip');
      document.body.appendChild(tip);
    }
    tip.innerHTML = html;
    tip.style.display = 'block';
    const pad = 14;
    const r = tip.getBoundingClientRect();
    let x = evt.clientX + pad;
    let y = evt.clientY + pad;
    if (x + r.width > window.innerWidth - 8) x = evt.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = evt.clientY - r.height - pad;
    tip.style.left = Math.max(8, x) + 'px';
    tip.style.top = Math.max(8, y) + 'px';
  }
  function hideTip() { if (tip) tip.style.display = 'none'; }

  // A column with a 4px rounded top and square base.
  function colPath(x, y, w, h) {
    if (h <= 0) return '';
    const r = Math.min(4, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  function frame(container, height) {
    container.innerHTML = '';
    const width = Math.max(260, container.clientWidth || 600);
    const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height, class: 'chart-svg', role: 'img' }, container);
    return { svg, width, height };
  }

  function yAxis(svg, ticks, y, left, right, fmt) {
    const g = el('g', { class: 'axis' }, svg);
    ticks.forEach((t) => {
      const yy = Math.round(y(t)) + 0.5;
      el('line', { x1: left, x2: right, y1: yy, y2: yy, class: t === 0 ? 'baseline' : 'grid' }, g);
      const label = el('text', { x: left - 8, y: yy + 4, 'text-anchor': 'end', class: 'tick' }, g);
      label.textContent = fmt(t);
    });
  }

  function xLabels(svg, labels, cx, y, every) {
    const g = el('g', { class: 'axis' }, svg);
    labels.forEach((l, i) => {
      if (i % every) return;
      const t = el('text', { x: cx(i), y, 'text-anchor': 'middle', class: 'tick' }, g);
      t.textContent = l;
    });
  }

  // opts: { labels, series: [{ name, cls, values }], fmt, tip(i) → html, height, ariaLabel,
  //         barClass(i, series) → extra class for one bar (optional) }
  function columns(container, opts) {
    const H = opts.height || 260;
    const { svg, width } = frame(container, H);
    svg.setAttribute('aria-label', opts.ariaLabel || '');
    const m = { t: 12, r: 8, b: 26, l: 56 };
    const n = opts.labels.length;
    const max = Math.max(0, ...opts.series.flatMap((s) => s.values.map((v) => v || 0)));
    const ticks = niceTicks(max);
    const top = ticks[ticks.length - 1] || 1;
    const plotW = width - m.l - m.r;
    const band = plotW / Math.max(1, n);
    const y = (v) => m.t + (H - m.t - m.b) * (1 - v / top);
    yAxis(svg, ticks, y, m.l, width - m.r, opts.fmt);

    const k = opts.series.length;
    const gap = 2;
    const barW = Math.max(3, Math.min(24, (band * 0.7 - gap * (k - 1)) / k));
    const groupW = barW * k + gap * (k - 1);
    const cx = (i) => m.l + band * i + band / 2;
    opts.series.forEach((s, si) => {
      const g = el('g', { class: `series ${s.cls}` }, svg);
      s.values.forEach((v, i) => {
        const x = cx(i) - groupW / 2 + si * (barW + gap);
        const h = y(0) - y(v || 0);
        const d = colPath(x, y(v || 0), barW, h);
        if (d) el('path', { d, class: opts.barClass ? opts.barClass(i, s) || null : null }, g);
      });
    });
    xLabels(svg, opts.labels, cx, H - 8, n > 14 ? 2 : 1);

    // Hover: one hit band per month, larger than the marks.
    const hits = el('g', { class: 'hits' }, svg);
    opts.labels.forEach((_, i) => {
      const r = el('rect', { x: m.l + band * i, y: m.t, width: band, height: H - m.t - m.b, fill: 'transparent' }, hits);
      r.addEventListener('mousemove', (e) => { r.setAttribute('class', 'hover'); showTip(opts.tip(i), e); });
      r.addEventListener('mouseleave', () => { r.removeAttribute('class'); hideTip(); });
    });
  }

  // opts: { labels, values, cls, fmt, tip(i), height, ariaLabel } — nulls leave a gap in the line.
  function line(container, opts) {
    const H = opts.height || 200;
    const { svg, width } = frame(container, H);
    svg.setAttribute('aria-label', opts.ariaLabel || '');
    const m = { t: 14, r: 16, b: 26, l: 56 };
    const n = opts.labels.length;
    const max = Math.max(0, ...opts.values.map((v) => v || 0));
    const ticks = niceTicks(max);
    const top = ticks[ticks.length - 1] || 1;
    const band = (width - m.l - m.r) / Math.max(1, n);
    const cx = (i) => m.l + band * i + band / 2;
    const y = (v) => m.t + (H - m.t - m.b) * (1 - v / top);
    yAxis(svg, ticks, y, m.l, width - m.r, opts.fmt);

    const g = el('g', { class: `series ${opts.cls}` }, svg);
    let d = '';
    let pen = false;
    opts.values.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${cx(i)},${y(v)}`;
      pen = true;
    });
    // Area wash under the line, then the 2px line, then the end dot.
    const pts = opts.values.map((v, i) => (v == null ? null : [cx(i), y(v)])).filter(Boolean);
    if (pts.length > 1) {
      el('path', { d: `M${pts[0][0]},${y(0)}L${pts.map((p) => p.join(',')).join('L')}L${pts[pts.length - 1][0]},${y(0)}Z`, class: 'area' }, g);
    }
    el('path', { d, class: 'line' }, g);
    const dots = el('g', {}, g);
    opts.values.forEach((v, i) => {
      if (v == null) return;
      el('circle', { cx: cx(i), cy: y(v), r: 4, class: 'dot' }, dots);
    });
    xLabels(svg, opts.labels, cx, H - 8, n > 14 ? 2 : 1);

    const cross = el('line', { class: 'crosshair', y1: m.t, y2: H - m.b, x1: -10, x2: -10 }, svg);
    const hits = el('g', { class: 'hits' }, svg);
    opts.labels.forEach((_, i) => {
      const r = el('rect', { x: m.l + band * i, y: m.t, width: band, height: H - m.t - m.b, fill: 'transparent' }, hits);
      r.addEventListener('mousemove', (e) => {
        cross.setAttribute('x1', cx(i)); cross.setAttribute('x2', cx(i));
        showTip(opts.tip(i), e);
      });
      r.addEventListener('mouseleave', () => { cross.setAttribute('x1', -10); cross.setAttribute('x2', -10); hideTip(); });
    });
  }

  // Horizontal bars as HTML (labels wrap nicely and stay accessible).
  // rows: [{ label, value, display, sub, cls }]
  function hbars(container, rows, opts) {
    opts = opts || {};
    const max = Math.max(0, ...rows.map((r) => r.value || 0)) || 1;
    container.innerHTML = '';
    const list = document.createElement('div');
    list.className = 'hbars';
    rows.forEach((r) => {
      const row = document.createElement('div');
      row.className = 'hbar';
      const pct = Math.max(0, (r.value || 0) / max * 100);
      row.innerHTML = `
        <div class="hbar-label"><span>${r.label}</span><span class="hbar-value">${r.display}</span></div>
        <div class="hbar-track"><div class="hbar-fill ${r.cls || opts.cls || ''}" style="width:${pct.toFixed(1)}%"></div></div>
        ${r.sub ? `<div class="hbar-sub">${r.sub}</div>` : ''}`;
      list.appendChild(row);
    });
    container.appendChild(list);
  }

  root.Charts = { columns, line, hbars, niceTicks, hideTip };
})(typeof self !== 'undefined' ? self : this);
