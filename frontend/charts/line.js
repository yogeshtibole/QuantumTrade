
 // Multi-series line/area chart with optional confidence band and hover tooltip.
import { fmt } from '../src/utils.js';

export function lineChart(host, o = {}) {
  host.classList.add('chart-host');

  let cv = host.querySelector('canvas');

  if (!cv) {
    cv = document.createElement('canvas');
    host.appendChild(cv);
  }

  cv.style.display = 'block';
  cv.style.width = '100%';
  cv.style.height = '100%';

  const W = host.clientWidth;
  const H = host.clientHeight;

  if (!W || !H) return;

  const dpr = window.devicePixelRatio || 1;
  const pixelW = Math.round(W * dpr);
  const pixelH = Math.round(H * dpr);

  if (cv.width !== pixelW || cv.height !== pixelH) {
    cv.width = pixelW;
    cv.height = pixelH;
  }

  const g = cv.getContext('2d');

  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);

  const S = (Array.isArray(o.series) ? o.series : [])
    .filter(s => Array.isArray(s.data) && s.data.length);

  const pad = {
    l: 8,
    r: 60,
    t: 10,
    b: Array.isArray(o.labels) && o.labels.length ? 20 : 8
  };

  const plotW = Math.max(1, W - pad.l - pad.r);
  const plotH = Math.max(1, H - pad.t - pad.b);
  const total = Math.max(1, Number(o.total) || 0);

  if (!S.length) {
    g.font = '12px system-ui';
    g.fillStyle = '#9a95b8';
    g.fillText('No data yet', 12, 24);
    return;
  }

  const n = Math.max(...S.map(s => s.data.length));
  const count = Math.max(n, Number(o.total) || n);

  let lo = Number.isFinite(o.min) ? o.min : Infinity;
  let hi = Number.isFinite(o.max) ? o.max : -Infinity;

  S.forEach(s => {
    s.data.forEach(v => {
      if (Number.isFinite(v)) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    });

    (Array.isArray(s.band) ? s.band : []).forEach(b => {
      if (
        Array.isArray(b) &&
        Number.isFinite(b[0]) &&
        Number.isFinite(b[1])
      ) {
        lo = Math.min(lo, b[0]);
        hi = Math.max(hi, b[1]);
      }
    });
  });

  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    g.fillStyle = '#9a95b8';
    g.fillText('No valid values', 12, 24);
    return;
  }

  if (hi === lo) {
    const adjustment = Math.abs(hi) * 0.01 || 1;
    hi += adjustment;
    lo -= adjustment;
  }

  const padding = (hi - lo) * 0.08;
  lo -= padding;
  hi += padding;

  const x = i =>
    pad.l + (i / Math.max(1, count - 1)) * plotW;

  const y = value =>
    pad.t + ((hi - value) / (hi - lo)) * plotH;

  const yfmt = typeof o.yfmt === 'function'
    ? o.yfmt
    : value => fmt(value, Math.abs(value) > 100 ? 0 : 2);

  g.font = '11px system-ui';
  g.fillStyle = '#9a95b8';
  g.strokeStyle = 'rgba(255,255,255,.06)';
  g.textAlign = 'left';

  // Horizontal grid lines and price/value labels.
  for (let i = 0; i <= 4; i++) {
    const value = lo + ((hi - lo) * i) / 4;
    const yy = y(value);

    g.beginPath();
    g.moveTo(pad.l, yy);
    g.lineTo(W - pad.r, yy);
    g.stroke();

    g.fillStyle = '#9a95b8';
    g.fillText(yfmt(value), W - pad.r + 6, yy + 4);
  }

  // Draw each series.
  S.forEach(s => {
    const offset = Number.isFinite(s.offset) ? s.offset : 0;
    const color = s.color || '#d46bd6';
    const values = s.data;

    // Confidence band.
    if (Array.isArray(s.band) && s.band.length) {
      const band = s.band
        .map((b, i) => ({
          index: offset + i,
          low: b?.[0],
          high: b?.[1]
        }))
        .filter(b =>
          b.index >= 0 &&
          b.index < count &&
          Number.isFinite(b.low) &&
          Number.isFinite(b.high)
        );

      if (band.length) {
        g.beginPath();

        band.forEach((b, i) => {
          if (i === 0) {
            g.moveTo(x(b.index), y(b.high));
          } else {
            g.lineTo(x(b.index), y(b.high));
          }
        });

        for (let i = band.length - 1; i >= 0; i--) {
          g.lineTo(x(band[i].index), y(band[i].low));
        }

        g.closePath();
        g.fillStyle = color + '26';
        g.fill();
      }
    }

    // Area fill: build a separate closed path so the line itself
    // is not accidentally connected to the chart baseline.
    if (s.fill) {
      let segment = [];

      const fillSegment = points => {
        if (points.length < 2) return;

        const gradient = g.createLinearGradient(
          0,
          pad.t,
          0,
          H - pad.b
        );

        gradient.addColorStop(0, color + '55');
        gradient.addColorStop(1, color + '00');

        g.beginPath();
        g.moveTo(x(points[0].index), H - pad.b);
        g.lineTo(x(points[0].index), y(points[0].value));

        for (let i = 1; i < points.length; i++) {
          g.lineTo(x(points[i].index), y(points[i].value));
        }

        g.lineTo(
          x(points[points.length - 1].index),
          H - pad.b
        );

        g.closePath();
        g.fillStyle = gradient;
        g.fill();
      };

      values.forEach((value, i) => {
        const index = offset + i;

        if (
          index >= 0 &&
          index < count &&
          Number.isFinite(value)
        ) {
          segment.push({ index, value });
        } else {
          fillSegment(segment);
          segment = [];
        }
      });

      fillSegment(segment);
    }

    // Line series.
    g.strokeStyle = color;
    g.lineWidth = Number.isFinite(s.width) ? s.width : 2;
    g.setLineDash(Array.isArray(s.dash) ? s.dash : []);
    g.beginPath();

    let started = false;

    values.forEach((value, i) => {
      const index = offset + i;

      if (
        index < 0 ||
        index >= count ||
        !Number.isFinite(value)
      ) {
        started = false;
        return;
      }

      if (!started) {
        g.moveTo(x(index), y(value));
        started = true;
      } else {
        g.lineTo(x(index), y(value));
      }
    });

    g.stroke();
    g.setLineDash([]);
    g.lineWidth = 1;
  });

  // X-axis labels.
  if (Array.isArray(o.labels) && o.labels.length) {
    g.fillStyle = '#9a95b8';

    [0, 0.5, 1].forEach(f => {
      const i = Math.round(f * (count - 1));
      const label = o.labels[i] ?? '';

      g.textAlign = f === 0
        ? 'left'
        : f === 1
          ? 'right'
          : 'center';

      g.fillText(label, x(i), H - 5);
    });

    g.textAlign = 'left';
  }

  // Register hover handlers only once per host.
  if (!host._lineChartHover) {
    host._lineChartHover = true;

    host.addEventListener('mousemove', e => {
      const rect = host.getBoundingClientRect();
      host._mx = e.clientX - rect.left;
      host._redraw?.();
    });

    host.addEventListener('mouseleave', () => {
      host._mx = null;
      host._redraw?.();
    });
  }

  // Store the latest options so hover redraws use current data.
  host._redraw = () => lineChart(host, o);

  // Hover crosshair and tooltip.
  if (host._mx != null) {
    const index = Math.max(
      0,
      Math.min(
        count - 1,
        Math.round(((host._mx - pad.l) / plotW) * (count - 1))
      )
    );

    const xx = x(index);

    g.strokeStyle = 'rgba(255,255,255,.3)';
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(xx, pad.t);
    g.lineTo(xx, H - pad.b);
    g.stroke();
    g.setLineDash([]);

    // Show the first series' value at the hovered index.
    const s = S[0];
    const offset = Number.isFinite(s.offset) ? s.offset : 0;
    const valueIndex = index - offset;
    const value = s.data[valueIndex];

    if (Number.isFinite(value)) {
      const label = Array.isArray(o.labels)
        ? `${o.labels[index] ?? ''}  `
        : '';

      const tx = `${label}${yfmt(value)}`;

      g.font = '12px system-ui';

      const maxTooltipWidth = Math.max(1, plotW - 8);
      const text = g.measureText(tx).width > maxTooltipWidth
        ? yfmt(value)
        : tx;

      const tooltipW = Math.min(
        maxTooltipWidth,
        g.measureText(text).width + 12
      );

      const tooltipX = Math.max(
        pad.l,
        Math.min(xx + 6, W - pad.r - tooltipW)
      );

      g.fillStyle = 'rgba(10,10,30,.92)';
      g.fillRect(tooltipX, pad.t + 2, tooltipW, 20);

      g.fillStyle = '#fff';
      g.fillText(
        text,
        tooltipX + 6,
        pad.t + 16,
        tooltipW - 8
      );
    }
  }
}
