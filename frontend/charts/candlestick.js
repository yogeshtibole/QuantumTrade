
 // Canvas candlestick chart: volume, SMA20/50, Bollinger Bands, VWAP, RSI, MACD, crosshair, wheel zoom, drag pan.
import { sma, rsi, macd, bollinger, vwap } from './indicators.js';
import { fmt } from '../src/utils.js';

export class CandleChart {
  constructor(host, opts = {}) {
    this.host = host;
    host.classList.add('chart-host');

    this.cv = document.createElement('canvas');
    this.cv.style.display = 'block';
    this.cv.style.width = '100%';
    this.cv.style.height = '100%';
    this.cv.style.touchAction = 'none';
    host.appendChild(this.cv);

    this.g = this.cv.getContext('2d');

    this.data = [];
    this.o = {
      sma: true,
      bb: false,
      vwap: false,
      rsi: true,
      macd: false,
      markers: [],
      ...opts
    };

    this.view = 90;
    this.off = 0;
    this.mx = -1;
    this.my = -1;
    this.drag = null;
    this.raf = 0;
    this.ind = {};

    this.ro = new ResizeObserver(() => this.draw());
    this.ro.observe(host);

    this.cv.addEventListener('mousemove', e => {
      const r = this.cv.getBoundingClientRect();

      this.mx = e.clientX - r.left;
      this.my = e.clientY - r.top;

      if (this.drag !== null) {
        const dx = e.clientX - this.drag;
        const bw = this.cv.clientWidth / this.view;
        const steps = Math.round(dx / Math.max(bw, 1));

        if (steps !== 0) {
          this.off = Math.max(
            0,
            Math.min(this.data.length - 1, this.off + steps)
          );
          this.drag = e.clientX;
        }
      }

      this.draw();
    });

    this.cv.addEventListener('mouseleave', () => {
      this.mx = -1;
      this.my = -1;
      this.drag = null;
      this.draw();
    });

    this.cv.addEventListener('mousedown', e => {
      if (e.button === 0) this.drag = e.clientX;
    });

    this._up = () => {
      this.drag = null;
    };

    addEventListener('mouseup', this._up);

    this.cv.addEventListener('wheel', e => {
      e.preventDefault();

      const oldView = this.view;
      const factor = e.deltaY > 0 ? 1.12 : 0.89;

      this.view = Math.max(
        20,
        Math.min(400, Math.round(this.view * factor))
      );

      // Keep the candle under the pointer approximately fixed while zooming.
      const rect = this.cv.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const usableWidth = Math.max(this.cv.clientWidth - 64, 1);
      const pointerIndex = Math.max(
        0,
        Math.floor((x - 4) / (usableWidth / oldView))
      );

      const change = this.view - oldView;
      this.off = Math.max(
        0,
        Math.min(
          Math.max(0, this.data.length - 1),
          this.off + Math.round(change * (pointerIndex / oldView))
        )
      );

      this.draw();
    }, { passive: false });
  }

  destroy() {
    this.ro.disconnect();
    removeEventListener('mouseup', this._up);
    cancelAnimationFrame(this.raf);
    this.cv.remove();
  }

  setData(rows) {
    this.data = rows.map(r =>
      Array.isArray(r)
        ? {
            t: r[0],
            o: Number(r[1]),
            h: Number(r[2]),
            l: Number(r[3]),
            c: Number(r[4]),
            v: Number(r[5]) || 0
          }
        : {
            ...r,
            o: Number(r.o),
            h: Number(r.h),
            l: Number(r.l),
            c: Number(r.c),
            v: Number(r.v) || 0
          }
    );

    this.off = 0;
    this.calc();
    this.draw();
  }

  push(candle) {
    const d = this.data;
    const last = d[d.length - 1];

    const k = Array.isArray(candle)
      ? {
          t: candle[0],
          o: Number(candle[1]),
          h: Number(candle[2]),
          l: Number(candle[3]),
          c: Number(candle[4]),
          v: Number(candle[5]) || 0
        }
      : {
          ...candle,
          o: Number(candle.o),
          h: Number(candle.h),
          l: Number(candle.l),
          c: Number(candle.c),
          v: Number(candle.v) || 0
        };

    if (last && last.t === k.t) {
      d[d.length - 1] = k;
    } else {
      d.push(k);

      if (this.off > 0) this.off++;
    }

    if (d.length > 3000) {
      d.shift();
      this.off = Math.max(0, this.off - 1);
    }

    this.calc();
    this.draw();
  }

  set(options) {
    Object.assign(this.o, options);
    this.calc();
    this.draw();
  }

  calc() {
    const closes = this.data.map(d => d.c);

    this.ind = {
      s20: sma(closes, 20),
      s50: sma(closes, 50),
      bb: bollinger(closes),
      vw: vwap(this.data),
      rsi: rsi(closes),
      macd: macd(closes)
    };
  }

  latest() {
    const n = this.data.length - 1;

    if (n < 0) return null;

    const I = this.ind;

    return {
      vwap: I.vw[n],
      rsi: I.rsi[n],
      macd: I.macd.macd[n],
      signal: I.macd.signal[n],
      hist: I.macd.hist[n],
      bbU: I.bb.up[n],
      bbL: I.bb.lo[n],
      sma20: I.s20[n],
      sma50: I.s50[n]
    };
  }

  draw() {
    if (this.raf) return;

    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.paint();
    });
  }

  paint() {
    const cv = this.cv;
    const W = this.host.clientWidth;
    const H = this.host.clientHeight;

    if (!W || !H) return;

    const dpr = window.devicePixelRatio || 1;

    if (
      cv.width !== Math.round(W * dpr) ||
      cv.height !== Math.round(H * dpr)
    ) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }

    const g = this.g;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    const all = this.data;

    if (all.length < 2) {
      g.font = '12px system-ui';
      g.fillStyle = '#9a95b8';
      g.fillText('Waiting for market data…', 20, 30);
      return;
    }

    const end = Math.max(0, all.length - this.off);
    const start = Math.max(0, end - this.view);
    const vis = all.slice(start, end);
    const n = vis.length;
    const AX = 64;

    const sub = (this.o.rsi ? 1 : 0) + (this.o.macd ? 1 : 0);
    const subH = sub ? Math.min(90, H * 0.22) : 0;
    const mainH = Math.max(40, H - sub * subH - 18);
    const plotW = Math.max(1, W - AX);
    const cw = plotW / this.view;
    const X = i => 4 + (i + 0.5) * cw;

    const I = this.ind;
    const sl = a => a.slice(start, end);

    let hi = -Infinity;
    let lo = Infinity;

    vis.forEach(d => {
      hi = Math.max(hi, d.h);
      lo = Math.min(lo, d.l);
    });

    if (this.o.bb) {
      sl(I.bb.up).concat(sl(I.bb.lo)).forEach(v => {
        if (Number.isFinite(v)) {
          hi = Math.max(hi, v);
          lo = Math.min(lo, v);
        }
      });
    }

    if (!Number.isFinite(hi) || !Number.isFinite(lo)) return;

    const pad = (hi - lo) * 0.06 || Math.max(Math.abs(hi) * 0.001, 1);
    hi += pad;
    lo -= pad;

    const volH = mainH * 0.16;
    const pH = mainH - volH * 0.6;
    const Y = v => 6 + ((hi - v) / (hi - lo)) * (pH - 12);

    g.font = '11px system-ui';
    g.strokeStyle = 'rgba(255,255,255,.06)';
    g.fillStyle = '#9a95b8';
    g.textAlign = 'left';

    // Price grid and axis labels.
    for (let i = 0; i <= 5; i++) {
      const v = lo + ((hi - lo) * i) / 5;
      const y = Y(v);

      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(plotW, y);
      g.stroke();

      g.fillStyle = '#9a95b8';
      g.fillText(fmt(v, v > 999 ? 1 : 2), plotW + 6, y + 4);
    }

    // Volume bars.
    const vmax = Math.max(1, ...vis.map(d => d.v));

    vis.forEach((d, i) => {
      const up = d.c >= d.o;
      const col = up ? '#2ee59d' : '#ff5b6e';
      const x = X(i);
      const vh = (d.v / vmax) * volH;

      g.fillStyle = up
        ? 'rgba(46,229,157,.25)'
        : 'rgba(255,91,110,.25)';

      g.fillRect(
        x - cw * 0.4,
        mainH - vh,
        Math.max(1, cw * 0.8),
        vh
      );

      // Candle wick.
      g.strokeStyle = col;
      g.beginPath();
      g.moveTo(x, Y(d.h));
      g.lineTo(x, Y(d.l));
      g.stroke();

      // Candle body.
      const y1 = Y(d.o);
      const y2 = Y(d.c);

      g.fillStyle = col;
      g.fillRect(
        x - cw * 0.35,
        Math.min(y1, y2),
        Math.max(1, cw * 0.7),
        Math.max(1, Math.abs(y1 - y2))
      );
    });

    // Indicator lines.
    const line = (arr, col, width = 1.3) => {
      g.strokeStyle = col;
      g.lineWidth = width;
      g.beginPath();

      let started = false;

      sl(arr).forEach((v, i) => {
        if (!Number.isFinite(v)) {
          started = false;
          return;
        }

        if (!started) {
          g.moveTo(X(i), Y(v));
          started = true;
        } else {
          g.lineTo(X(i), Y(v));
        }
      });

      g.stroke();
      g.lineWidth = 1;
    };

    if (this.o.sma) {
      line(I.s20, '#f5c542');
      line(I.s50, '#4aa8ff');
    }

    if (this.o.bb) {
      line(I.bb.up, '#b79be0');
      line(I.bb.lo, '#b79be0');
      line(I.bb.mid, 'rgba(183,155,224,.5)');
    }

    if (this.o.vwap) {
      line(I.vw, '#ff9f43', 1.6);
    }

    // Buy and sell markers.
    (this.o.markers || []).forEach(m => {
      const i = m.index - start;

      if (i < 0 || i >= n) return;

      const x = X(i);
      const y = Y(m.price);

      g.fillStyle = m.type === 'buy' ? '#2ee59d' : '#ff5b6e';
      g.beginPath();

      if (m.type === 'buy') {
        g.moveTo(x, y + 4);
        g.lineTo(x - 6, y + 14);
        g.lineTo(x + 6, y + 14);
      } else {
        g.moveTo(x, y - 4);
        g.lineTo(x - 6, y - 14);
        g.lineTo(x + 6, y - 14);
      }

      g.closePath();
      g.fill();
    });

    // Current price line.
    const last = all[all.length - 1];
    const ly = Y(last.c);

    if (ly > 0 && ly < pH) {
      const col = last.c >= last.o ? '#2ee59d' : '#ff5b6e';

      g.setLineDash([4, 4]);
      g.strokeStyle = col;
      g.beginPath();
      g.moveTo(0, ly);
      g.lineTo(plotW, ly);
      g.stroke();
      g.setLineDash([]);

      g.fillStyle = col;
      g.fillRect(plotW, ly - 9, AX, 18);

      g.fillStyle = '#000';
      g.fillText(fmt(last.c), plotW + 4, ly + 4);
    }

    // RSI and MACD panes.
    let top = mainH;

    const pane = (title, drawPane) => {
      g.fillStyle = 'rgba(255,255,255,.03)';
      g.fillRect(0, top, plotW, subH - 4);

      g.fillStyle = '#9a95b8';
      g.fillText(title, 6, top + 12);

      drawPane();
      top += subH;
    };

    if (this.o.rsi) {
      pane('RSI 14', () => {
        const y = v => top + 4 + ((100 - v) / 100) * (subH - 12);

        g.strokeStyle = 'rgba(255,255,255,.15)';

        [30, 70].forEach(level => {
          g.beginPath();
          g.moveTo(0, y(level));
          g.lineTo(plotW, y(level));
          g.stroke();
        });

        g.strokeStyle = '#b79be0';
        g.beginPath();

        let started = false;

        sl(I.rsi).forEach((v, i) => {
          if (!Number.isFinite(v)) {
            started = false;
            return;
          }

          if (!started) {
            g.moveTo(X(i), y(v));
            started = true;
          } else {
            g.lineTo(X(i), y(v));
          }
        });

        g.stroke();
      });
    }

    if (this.o.macd) {
      pane('MACD', () => {
        const h = sl(I.macd.hist);
        const m = sl(I.macd.macd);
        const s = sl(I.macd.signal);

        const values = [...h, ...m, ...s].filter(Number.isFinite);
        const mx = Math.max(1e-9, ...values.map(Math.abs)) * 1.1;

        const y = v => top + 4 + ((mx - v) / (2 * mx)) * (subH - 12);
        const zero = y(0);

        h.forEach((v, i) => {
          if (!Number.isFinite(v)) return;

          g.fillStyle = v >= 0
            ? 'rgba(46,229,157,.6)'
            : 'rgba(255,91,110,.6)';

          g.fillRect(
            X(i) - cw * 0.35,
            Math.min(zero, y(v)),
            Math.max(1, cw * 0.7),
            Math.abs(y(v) - zero)
          );
        });

        [[m, '#4aa8ff'], [s, '#f5c542']].forEach(([arr, col]) => {
          g.strokeStyle = col;
          g.beginPath();

          let started = false;

          arr.forEach((v, i) => {
            if (!Number.isFinite(v)) {
              started = false;
              return;
            }

            if (!started) {
              g.moveTo(X(i), y(v));
              started = true;
            } else {
              g.lineTo(X(i), y(v));
            }
          });

          g.stroke();
        });
      });
    }

    // Crosshair and candle information.
    if (this.mx >= 0 && this.mx < plotW) {
      const i = Math.min(
        n - 1,
        Math.max(0, Math.floor((this.mx - 4) / cw))
      );

      const d = vis[i];
      const x = X(i);

      g.strokeStyle = 'rgba(255,255,255,.35)';
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, mainH);

      if (this.my >= 0 && this.my < mainH) {
        g.moveTo(0, this.my);
        g.lineTo(plotW, this.my);
      }

      g.stroke();
      g.setLineDash([]);

      const timestamp = typeof d.t === 'number'
        ? d.t
        : Date.parse(d.t);

      const date = Number.isFinite(timestamp)
        ? new Date(timestamp)
        : null;

      const timeText = date && !Number.isNaN(date.getTime())
        ? date.toLocaleString('en-IN', { hour12: false })
        : String(d.t);

      const tx =
        `${timeText}  O ${fmt(d.o)}  H ${fmt(d.h)}  ` +
        `L ${fmt(d.l)}  C ${fmt(d.c)}  V ${fmt(d.v, 0)}`;

      g.font = '12px system-ui';

      const maxTextWidth = Math.max(40, plotW - 14);
      const text = g.measureText(tx).width > maxTextWidth
        ? `${timeText} O ${fmt(d.o)} H ${fmt(d.h)} L ${fmt(d.l)} C ${fmt(d.c)}`
        : tx;

      const boxW = Math.min(plotW - 4, g.measureText(text).width + 14);

      g.fillStyle = 'rgba(10,10,30,.9)';
      g.fillRect(4, 4, boxW, 20);

      g.fillStyle = d.c >= d.o ? '#2ee59d' : '#ff5b6e';
      g.fillText(text, 11, 18, boxW - 10);
    } else {
      const d = vis[n - 1];

      g.font = '12px system-ui';
      g.fillStyle = d.c >= d.o ? '#2ee59d' : '#ff5b6e';

      g.fillText(
        `O ${fmt(d.o)}  H ${fmt(d.h)}  L ${fmt(d.l)}  C ${fmt(d.c)}`,
        8,
        16
      );
    }
  }
}
