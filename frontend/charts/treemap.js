
import { esc, fmt, pct } from '../src/utils.js';

// Calculate the worst aspect ratio for a row of rectangles.
function worst(row, side) {
  if (!row.length || side <= 0) return Infinity;

  const sum = row.reduce((a, r) => a + r.area, 0);
  const max = Math.max(...row.map(r => r.area));
  const min = Math.min(...row.map(r => r.area));

  if (sum <= 0 || min <= 0) return Infinity;

  return Math.max(
    (side * side * max) / (sum * sum),
    (sum * sum) / (side * side * min)
  );
}

// Squarified treemap layout.
export function squarify(items, x, y, w, h) {
  if (
    !Array.isArray(items) ||
    !items.length ||
    ![x, y, w, h].every(Number.isFinite) ||
    w <= 0 ||
    h <= 0
  ) {
    return [];
  }

  const validItems = items
    .map((item, index) => ({
      ...item,
      _index: index,
      value: Number(item.value)
    }))
    .filter(item => Number.isFinite(item.value) && item.value > 0);

  const total = validItems.reduce((sum, item) => sum + item.value, 0);

  if (!Number.isFinite(total) || total <= 0) return [];

  const rectangles = validItems
    .map(item => ({
      ...item,
      area: (item.value / total) * w * h
    }))
    .sort((a, b) => b.area - a.area);

  const out = [];
  let rest = rectangles;

  while (rest.length && w > 0 && h > 0) {
    const side = Math.min(w, h);
    const row = [rest[0]];
    let k = 1;

    while (
      k < rest.length &&
      worst([...row, rest[k]], side) <= worst(row, side)
    ) {
      row.push(rest[k]);
      k++;
    }

    rest = rest.slice(k);

    const area = row.reduce((sum, item) => sum + item.area, 0);
    if (area <= 0) continue;

    if (w >= h) {
      // Place a vertical strip of rectangles.
      const stripWidth = Math.min(w, area / h);
      let currentY = y;

      row.forEach((item, index) => {
        const rectHeight =
          index === row.length - 1
            ? y + h - currentY
            : Math.min(h, item.area / stripWidth);

        out.push({
          ...item,
          x,
          y: currentY,
          w: stripWidth,
          h: Math.max(0, rectHeight)
        });

        currentY += rectHeight;
      });

      x += stripWidth;
      w = Math.max(0, w - stripWidth);
    } else {
      // Place a horizontal strip of rectangles.
      const stripHeight = Math.min(h, area / w);
      let currentX = x;

      row.forEach((item, index) => {
        const rectWidth =
          index === row.length - 1
            ? x + w - currentX
            : Math.min(w, item.area / stripHeight);

        out.push({
          ...item,
          x: currentX,
          y,
          w: Math.max(0, rectWidth),
          h: stripHeight
        });

        currentX += rectWidth;
      });

      y += stripHeight;
      h = Math.max(0, h - stripHeight);
    }
  }

  return out.filter(
    rect =>
      Number.isFinite(rect.x) &&
      Number.isFinite(rect.y) &&
      Number.isFinite(rect.w) &&
      Number.isFinite(rect.h) &&
      rect.w > 0 &&
      rect.h > 0
  );
}

// Map percentage changes to heat-map colors.
// Positive = green, negative = red, near zero = neutral.
export const heatColor = change => {
  const value = Number(change);

  if (!Number.isFinite(value)) return '#3a3f4f';

  const t = Math.max(-1, Math.min(1, value / 3));

  if (Math.abs(t) < 0.04) return '#3a3f4f';

  if (t > 0) {
    return `rgb(${Math.round(40 - 14 * t)},${Math.round(
      100 + 120 * t
    )},${Math.round(70 + 20 * t)})`;
  }

  return `rgb(${Math.round(110 + 150 * t)},${Math.round(
    50 - 20 * t
  )},${Math.round(60 - 20 * t)})`;
};

// Render the clickable stock heat map.
export function treemap(host, quotes, onClick, grouped = true) {
  if (!host) return;

  host.style.position = 'relative';

  const W = host.clientWidth;
  const H = host.clientHeight;

  if (!W || !H || !Array.isArray(quotes)) {
    host.innerHTML = '';
    return;
  }

  const validQuotes = quotes.filter(
    q =>
      q &&
      q.symbol != null &&
      String(q.symbol).trim() !== ''
  );

  if (!validQuotes.length) {
    host.innerHTML = `
      <div style="
        display:flex;
        align-items:center;
        justify-content:center;
        width:100%;
        height:100%;
        color:#9298a8;
        font-size:12px;
      ">No market data available</div>
    `;
    return;
  }

  const marketValue = q => {
    const value = Number(q.market_cap_cr);
    return Number.isFinite(value) && value > 0 ? value : 1;
  };

  const bySec = {};

  validQuotes.forEach(q => {
    const sector =
      q.sector == null || String(q.sector).trim() === ''
        ? 'Other'
        : String(q.sector);

    (bySec[sector] ||= []).push(q);
  });

  const sectors = Object.entries(bySec).map(([key, list]) => ({
    key,
    value: list.reduce((sum, q) => sum + marketValue(q), 0),
    list
  }));

  const top = grouped
    ? squarify(sectors, 0, 0, W, H)
    : [
        {
          key: '',
          x: 0,
          y: 0,
          w: W,
          h: H,
          list: validQuotes,
          value: 1
        }
      ];

  let html = '';

  top.forEach(sec => {
    const headerHeight =
      grouped && sec.h > 40 && sec.w > 70 ? 16 : 0;

    if (headerHeight) {
      html += `
        <div style="
          position:absolute;
          left:${sec.x + 3}px;
          top:${sec.y + 1}px;
          font-size:10px;
          color:#cfc8ff;
          text-transform:uppercase;
          letter-spacing:.06em;
          z-index:1;
          pointer-events:none;
          overflow:hidden;
          white-space:nowrap;
        ">${esc(sec.key)}</div>
      `;
    }

    const innerX = sec.x + 1;
    const innerY = sec.y + headerHeight + 1;
    const innerW = Math.max(0, sec.w - 2);
    const innerH = Math.max(0, sec.h - headerHeight - 2);

    const tiles = squarify(
      sec.list.map(q => ({
        ...q,
        value: marketValue(q)
      })),
      innerX,
      innerY,
      innerW,
      innerH
    );

    tiles.forEach(tile => {
      const big = tile.w > 70 && tile.h > 44;
      const symbol = String(tile.symbol);
      const name = tile.name ?? symbol;
      const change = Number(tile.change_pct);
      const last = Number(tile.last);

      const changeText = Number.isFinite(change)
        ? pct(change)
        : '—';

      const lastText = Number.isFinite(last)
        ? fmt(last)
        : '—';

      const symbolFont = big
        ? Math.min(18, tile.w / 6)
        : 10;

      html += `
        <div
          class="tile"
          data-sym="${esc(symbol)}"
          title="${esc(name)}  ${esc(lastText)}  ${esc(changeText)}"
          role="button"
          tabindex="0"
          style="
            position:absolute;
            box-sizing:border-box;
            left:${tile.x}px;
            top:${tile.y}px;
            width:${tile.w}px;
            height:${tile.h}px;
            overflow:hidden;
            display:flex;
            flex-direction:column;
            align-items:center;
            justify-content:center;
            gap:3px;
            padding:2px;
            background:${heatColor(change)};
            cursor:pointer;
            border:1px solid rgba(255,255,255,.08);
            color:#fff;
            text-align:center;
          "
        >
          <b style="
            font-size:${symbolFont}px;
            line-height:1.15;
            overflow:hidden;
            max-width:100%;
            overflow-wrap:anywhere;
          ">${tile.w > 38 ? esc(symbol) : ''}</b>

          ${
            big
              ? `<span style="font-size:11px;opacity:.9">${esc(changeText)}</span>`
              : ''
          }
        </div>
      `;
    });
  });

  host.innerHTML = html;

  if (typeof onClick === 'function') {
    const activate = el => {
      onClick(el.dataset.sym);
    };

    host.querySelectorAll('.tile').forEach(el => {
      el.addEventListener('click', () => activate(el));

      el.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          activate(el);
        }
      });
    });
  }
}
