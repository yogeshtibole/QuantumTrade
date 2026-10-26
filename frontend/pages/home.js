
import { get } from '../src/store.js';
import { api } from '../src/api.js';
import { $, esc, fmt, pct, cls } from '../src/utils.js';
import { lineChart } from '../charts/line.js';

const STEPS = [
  ['Strategy Development', 'Create and test trading strategy'],
  ['Data Acquisition', 'Collect market data in real-time'],
  ['Signal Generation', 'Generate buy/sell signals'],
  ['Trade Execution', 'Automatically place orders'],
  ['Performance Monitoring', 'Track and evaluate results'],
  ['Risk Management', 'Monitor risk and set limits'],
  ['Backtesting & Optimization', 'Test strategy with historical data']
];

export default function (el) {
  const off = [];
  const hist = [];

  let destroyed = false;
  let healthRequestId = 0;
  let lastChartRender = 0;

  const user = get()?.user;

  el.innerHTML = `
    <div class="relative overflow-hidden">
      <div class="hero-arc"></div>

      <section class="relative text-center pt-14 sm:pt-24 pb-10">
        <span class="chip on">● C++ matching engine · live WebSocket prices</span>

        <h1 class="grad-text font-light tracking-tight leading-[1.02] mt-6"
          style="font-size:clamp(42px,8.5vw,96px)">
          Take control of<br>every trade
        </h1>

        <p class="mu max-w-xl mx-auto mt-5 text-base sm:text-lg">
          A professional trading platform with a microsecond order matcher,
          live market depth, AI signals and strategy backtesting.
        </p>

        <div class="mt-8 flex gap-3 justify-center flex-wrap">
          <a class="btn btn-p text-base px-7 py-3"
            href="#${user ? '/trade' : '/login'}">
            Start free now
            <span class="bg-white/25 rounded-full w-6 h-6 inline-flex items-center justify-center">→</span>
          </a>

          <a class="btn text-base px-7 py-3" href="#/heatmap">
            Explore markets
          </a>
        </div>
      </section>

      <section class="relative grid md:grid-cols-3 gap-3 max-w-5xl mx-auto mb-12">
        <div class="glass p-4">
          <div class="text-xs mu">Live price · <span id="hs">NIFTY50</span></div>
          <div class="text-3xl num mt-1" id="hp">—</div>
          <div id="hc" class="text-sm"></div>
        </div>

        <div class="glass glass-hi p-4 md:-mt-6">
          <div class="text-xs text-slate-300">Live index chart</div>
          <div id="hg" style="height:130px"></div>
        </div>

        <div class="glass p-4">
          <div class="text-xs mu">Engine latency (avg, order ack)</div>
          <div class="text-3xl num mt-1 up" id="hl">—</div>
          <div class="text-xs mu" id="ht">Loading engine status...</div>
        </div>
      </section>
    </div>

    <section>
      <h2 class="text-xl mb-3">Market Overview</h2>
      <div id="mkt" class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3"></div>
    </section>

    <section class="mt-10">
      <h2 class="text-xl mb-3">Top Gainers / Losers</h2>
      <div class="grid md:grid-cols-2 gap-3">
        <div>
          <div class="up text-sm mb-2">▲ Gainers</div>
          <div id="gain" class="grid sm:grid-cols-2 gap-2"></div>
        </div>
        <div>
          <div class="dn text-sm mb-2">▼ Losers</div>
          <div id="lose" class="grid sm:grid-cols-2 gap-2"></div>
        </div>
      </div>
    </section>

    <section class="mt-10">
      <h2 class="text-xl mb-3">Trading Features</h2>

      <div class="grid md:grid-cols-3 gap-3">
        <div class="glass p-5">
          <div class="text-2xl">⚡</div>
          <h3 class="font-medium mt-2">Fast Execution</h3>
          <p class="mu text-sm mt-1">
            Price-time priority matching on a dedicated engine thread with a
            lock-free queue and memory pool. Seven order types including
            iceberg, bracket and trailing stop.
          </p>
        </div>

        <div class="glass p-5">
          <div class="text-2xl">✦</div>
          <h3 class="font-medium mt-2">AI Signals</h3>
          <p class="mu text-sm mt-1">
            Ask Bramha or Sars for analysis, sentiment and price forecasts
            in English, Hindi or Marathi, by text or voice.
          </p>
        </div>

        <div class="glass p-5">
          <div class="text-2xl">◔</div>
          <h3 class="font-medium mt-2">Portfolio Analytics</h3>
          <p class="mu text-sm mt-1">
            Live P&amp;L, allocation, risk score, dividend history and an
            illustrative tax report with PDF export.
          </p>
        </div>
      </div>
    </section>

    <section class="mt-10">
      <h2 class="text-xl mb-3">Algorithmic trading workflow</h2>

      <div class="glass p-5 grid grid-cols-2 md:grid-cols-4 gap-3">
        ${STEPS.map((step, index) => `
          <div class="p-3 rounded-xl bg-white/5">
            <div class="grad-text text-2xl font-semibold">${index + 1}</div>
            <b class="text-sm">${step[0]}</b>
            <div class="mu text-xs mt-1">${step[1]}</div>
          </div>
        `).join('')}

        <a href="#/algos"
          class="p-3 rounded-xl bg-white/5 flex items-center justify-center text-sm underline">
          Explore 8 strategies →
        </a>
      </div>
    </section>

    <section class="mt-10">
      <h2 class="text-xl mb-3">
        What traders say <span class="mu text-xs">(sample testimonials)</span>
      </h2>

      <div class="grid md:grid-cols-3 gap-3">
        ${[
          ['Aarav M.', 'Prop trader', 'Ack latency on fills is the first thing I check, and it is consistently tiny.'],
          ['Sneha K.', 'Quant analyst', 'Backtests with fees and slippage built in make strategy ideas easy to vet.'],
          ['Rohan P.', 'Fund manager', 'The sector heat map plus the AI summary is my morning routine.']
        ].map(testimonial => `
          <div class="glass p-5">
            <p class="text-sm">“${testimonial[2]}”</p>
            <div class="mt-3 text-sm">
              <b>${testimonial[0]}</b>
              <span class="mu">· ${testimonial[1]}</span>
            </div>
            <div class="text-yellow-400 text-sm">★★★★★</div>
          </div>
        `).join('')}
      </div>
    </section>

    <footer class="mt-14 pt-6 border-t border-white/10 grid sm:grid-cols-4 gap-4 text-sm">
      <div>
        <b class="grad-text">QuantumTrade</b>
        <p class="mu text-xs mt-2">
          Paper-trading demo. Not investment advice. Market data is simulated.
        </p>
      </div>

      <div>
        <b>Developers</b>
        <ul class="mu mt-2 space-y-1">
          <li><a href="/api/health" target="_blank" rel="noopener">API health</a></li>
          <li><a href="https://github.com/" target="_blank" rel="noopener">GitHub</a></li>
        </ul>
      </div>

      <div>
        <b>Company</b>
        <ul class="mu mt-2 space-y-1">
          <li>Careers</li>
          <li>About</li>
        </ul>
      </div>

      <div>
        <b>Contact</b>
        <ul class="mu mt-2 space-y-1">
          <li>support@quantumtrade.local</li>
        </ul>
      </div>
    </footer>
  `;

  const $el = selector => el.querySelector(selector);

  function card(quote) {
    const symbol = String(quote.symbol || '');

    return `
      <a href="#/trade?symbol=${encodeURIComponent(symbol)}"
        class="glass p-3 block no-underline"
        data-s="${esc(symbol)}">

        <div class="text-xs mu">${esc(quote.name || symbol)}</div>
        <div class="text-lg num font-medium mt-0.5" data-p>${fmt(quote.last ?? 0)}</div>
        <div class="text-xs num ${cls(quote.change_pct ?? 0)}" data-c>
          ${pct(quote.change_pct ?? 0)}
        </div>
      </a>
    `;
  }

  function mini(quote) {
    const symbol = String(quote.symbol || '');

    return `
      <a href="#/trade?symbol=${encodeURIComponent(symbol)}"
        class="glass p-3 flex items-center justify-between no-underline">

        <div>
          <b>${esc(symbol)}</b>
          <div class="text-xs mu">${esc(quote.name || symbol)}</div>
        </div>

        <div class="text-right num">
          <div>${fmt(quote.last ?? 0)}</div>
          <div class="${cls(quote.change_pct ?? 0)} text-sm">
            ${pct(quote.change_pct ?? 0)}
          </div>
        </div>
      </a>
    `;
  }

  function renderIndexChart(value) {
    if (destroyed || !Number.isFinite(Number(value))) return;

    hist.push(Number(value));

    if (hist.length > 90) hist.shift();

    const now = Date.now();

    // Avoid redrawing the chart on every one-second dashboard refresh.
    if (now - lastChartRender < 2000 && hist.length > 1) return;

    lastChartRender = now;

    const host = $el('#hg');
    host.innerHTML = '';

    lineChart(host, {
      series: [{
        data: [...hist],
        color: '#d46bd6',
        fill: true
      }],
      total: 90
    });
  }

  function paint() {
    if (destroyed) return;

    const quotes = get()?.quotes || {};
    const all = Object.values(quotes).filter(
      quote => quote && typeof quote.symbol === 'string'
    );

    const overviewSymbols = [
      'NIFTY50',
      'SENSEX',
      'NASDAQ',
      'DOWJONES',
      'BTC-INR',
      'ETH-INR'
    ];

    const overview = overviewSymbols
      .map(symbol => quotes[symbol])
      .filter(Boolean);

    $el('#mkt').innerHTML = overview.map(card).join('');

    const equities = all.filter(quote =>
      !quote.index &&
      !quote.crypto &&
      Number.isFinite(Number(quote.change_pct))
    );

    const gainers = equities
      .filter(quote => Number(quote.change_pct) > 0)
      .sort((a, b) => Number(b.change_pct) - Number(a.change_pct))
      .slice(0, 4);

    const losers = equities
      .filter(quote => Number(quote.change_pct) < 0)
      .sort((a, b) => Number(a.change_pct) - Number(b.change_pct))
      .slice(0, 4);

    $el('#gain').innerHTML = gainers.map(mini).join('');
    $el('#lose').innerHTML = losers.map(mini).join('');

    if (!gainers.length) {
      $el('#gain').innerHTML =
        '<div class="mu text-xs">No gainers currently.</div>';
    }

    if (!losers.length) {
      $el('#lose').innerHTML =
        '<div class="mu text-xs">No losers currently.</div>';
    }

    const nifty = quotes.NIFTY50;

    if (nifty && nifty.last != null) {
      $el('#hp').textContent = fmt(nifty.last);
      $el('#hc').className = 'text-sm ' + cls(nifty.change_pct ?? 0);
      $el('#hc').textContent = pct(nifty.change_pct ?? 0);

      renderIndexChart(nifty.last);
    } else {
      $el('#hp').textContent = '—';
      $el('#hc').textContent = 'Waiting for index data';
    }
  }

  async function loadHealth() {
    const requestId = ++healthRequestId;

    try {
      const health = await api('/health');

      if (destroyed || requestId !== healthRequestId) return;

      const latency = Number(health?.order_ack_latency?.avg_us);
      const trades = Number(health?.trades);

      $el('#hl').textContent =
        Number.isFinite(latency) ? fmt(latency, 1) + ' µs' : '—';

      $el('#ht').textContent =
        Number.isFinite(trades)
          ? fmt(trades, 0) + ' trades matched since start'
          : 'Engine status available';
    } catch {
      if (destroyed || requestId !== healthRequestId) return;

      $el('#hl').textContent = '—';
      $el('#ht').textContent = 'Engine status unavailable';
    }
  }

  paint();

  const intervalId = setInterval(paint, 1000);
  off.push(() => clearInterval(intervalId));

  loadHealth();

  return () => {
    if (destroyed) return;

    destroyed = true;
    healthRequestId++;

    off.forEach(cleanup => {
      try {
        cleanup();
      } catch {
        // Continue cleaning up remaining resources.
      }
    });

    hist.length = 0;
    $el('#hg').innerHTML = '';
  };
}
