
 // Dashboard: live portfolio, candlestick + volume, heat map, market depth, watchlist with alerts.
import { get } from '../src/store.js';
import { api } from '../src/api.js';
import { $, $$, esc, fmt, inr, pct, cls, time, throttle } from '../src/utils.js';
import { CandleChart } from '../charts/candlestick.js';
import { lineChart } from '../charts/line.js';
import { depthChart } from '../charts/depth.js';
import { treemap } from '../charts/treemap.js';
import { stat, table, toast } from '../components/ui.js';
import { wsOn, wsSub, wsUnsub } from '../hooks/useWebSocket.js';

export default async function (el) {
  const off = [];

  let sym = 'RELIANCE';
  let depth = null;
  let wl = { symbols: [], alerts: [] };
  let destroyed = false;
  let chartRequestId = 0;
  let statsRequestId = 0;
  let watchRequestId = 0;
  let fillsRequestId = 0;
  let statsBusy = false;
  let fillsBusy = false;

  const store = get();
  const symbols = (Array.isArray(store?.symbols) ? store.symbols : [])
    .filter(s => s && !s.index && typeof s.symbol === 'string');

  if (!symbols.some(s => s.symbol === sym) && symbols.length) {
    sym = symbols[0].symbol;
  }

  el.innerHTML = `
    <div class="pt-4 grid gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <h2 class="text-xl mr-2">Dashboard</h2>
        <span id="kyc"></span>
      </div>

      <div id="stats" class="grid grid-cols-2 lg:grid-cols-4 gap-3"></div>

      <div class="grid lg:grid-cols-12 gap-3">
        <section class="glass p-3 lg:col-span-8">
          <div class="flex flex-wrap items-center gap-2 mb-2">
            <select id="sym" class="input !w-auto !py-1.5"></select>
            <b id="px" class="num text-lg">—</b>
            <span class="text-xs mu ml-auto">Candlesticks + volume · 5s candles</span>
          </div>
          <div id="chart" style="height:360px"></div>
          <div id="chart-error" class="dn text-xs mt-2" role="status"></div>
        </section>

        <section class="glass p-3 lg:col-span-4">
          <h3 class="text-sm mu mb-2">Portfolio value (live)</h3>
          <div id="eq" style="height:180px"></div>

          <h3 class="text-sm mu mt-3 mb-1">
            Market depth · <span id="dsym"></span>
          </h3>
          <div id="dp" style="height:150px"></div>
          <div id="depth-error" class="dn text-xs mt-1" role="status"></div>
        </section>
      </div>

      <div class="grid lg:grid-cols-12 gap-3">
        <section class="glass p-3 lg:col-span-5">
          <div class="flex items-center mb-2">
            <h3 class="text-sm mu">Sector heat map</h3>
            <a href="#/heatmap" class="text-xs ml-auto underline mu">Full view</a>
          </div>
          <div id="hm" style="height:300px"></div>
        </section>

        <section class="glass p-3 lg:col-span-4">
          <div class="flex items-center mb-2">
            <h3 class="text-sm mu">Watchlist</h3>
            <div class="ml-auto flex gap-1">
              <input id="wadd" class="input !w-28 !py-1 !text-xs"
                placeholder="Add symbol" list="dl" autocomplete="off">
              <datalist id="dl"></datalist>
              <button id="wbtn" class="btn btn-sm">Add</button>
            </div>
          </div>
          <div id="wl"></div>
        </section>

        <section class="glass p-3 lg:col-span-3">
          <h3 class="text-sm mu mb-2">Recent activity</h3>
          <div id="fills" class="text-xs"></div>
        </section>
      </div>
    </div>
  `;

  const $el = selector => el.querySelector(selector);
  const symbolSelect = $el('#sym');
  const chartError = $el('#chart-error');
  const depthError = $el('#depth-error');

  symbolSelect.innerHTML = symbols
    .map(s => `<option value="${esc(s.symbol)}">${esc(s.symbol)}</option>`)
    .join('');

  $el('#dl').innerHTML = symbols
    .map(s => `<option value="${esc(s.symbol)}"></option>`)
    .join('');

  symbolSelect.value = sym;

  if (!symbols.length) {
    chartError.textContent = 'No market symbols are available.';
    chartError.classList.remove('hidden');
  }

  const chart = new CandleChart($el('#chart'), { rsi: false });
  off.push(() => chart.destroy());

  function showError(node, message) {
    if (!node) return;
    node.textContent = message || '';
    node.classList.toggle('hidden', !message);
  }

  function topicsFor(symbol) {
    return ['chart:' + symbol, 'depth:' + symbol];
  }

  function unsubscribeSymbol(symbol) {
    if (symbol) wsUnsub(topicsFor(symbol));
  }

  function subscribeSymbol(symbol) {
    if (symbol) wsSub(topicsFor(symbol));
  }

  function paintDepth() {
    if (destroyed || !depth) return;

    const host = $el('#dp');
    if (!host) return;

    try {
      const bids = Array.isArray(depth.bids) ? depth.bids : [];
      const asks = Array.isArray(depth.asks) ? depth.asks : [];

      // Clear old chart markup before rendering the latest depth.
      host.innerHTML = '';

      if (!bids.length && !asks.length) {
        showError(depthError, 'No market-depth data available.');
        return;
      }

      depthChart(host, bids, asks, depth.mid);
      showError(depthError, '');
    } catch (error) {
      showError(depthError, error?.message || 'Unable to render market depth.');
    }
  }

  async function loadChart() {
    const requestedSymbol = sym;
    const requestId = ++chartRequestId;

    showError(chartError, '');
    showError(depthError, '');
    $el('#dsym').textContent = requestedSymbol;

    try {
      const candles = await api(
        '/candles?symbol=' + encodeURIComponent(requestedSymbol) + '&limit=400'
      );

      if (destroyed || requestId !== chartRequestId || requestedSymbol !== sym) {
        return;
      }

      chart.setData(candles);

      const quote = get()?.quotes?.[requestedSymbol];
      if (quote?.last != null) {
        $el('#px').textContent = fmt(quote.last);
      }

      const depthData = await api(
        '/depth?symbol=' + encodeURIComponent(requestedSymbol) + '&levels=15'
      );

      if (destroyed || requestId !== chartRequestId || requestedSymbol !== sym) {
        return;
      }

      depth = depthData;
      paintDepth();
    } catch (error) {
      if (destroyed || requestId !== chartRequestId) return;

      showError(
        chartError,
        error?.message || 'Unable to load candle data.'
      );

      showError(
        depthError,
        error?.message || 'Unable to load market depth.'
      );
    }
  }

  symbolSelect.onchange = async event => {
    const nextSymbol = event.target.value;

    if (!nextSymbol || nextSymbol === sym) return;

    // Invalidate responses from requests for the previous symbol.
    chartRequestId++;
    unsubscribeSymbol(sym);

    sym = nextSymbol;
    depth = null;

    $el('#px').textContent = '—';
    $el('#dsym').textContent = sym;
    $el('#dp').innerHTML = '';

    subscribeSymbol(sym);
    await loadChart();
  };

  off.push(
    wsOn('candle', message => {
      if (destroyed || !message || message.s !== sym || !message.k) return;

      try {
        chart.push(message.k);

        if (message.k.c != null) {
          $el('#px').textContent = fmt(message.k.c);
        }
      } catch (error) {
        showError(chartError, error?.message || 'Unable to update candle chart.');
      }
    }),

    wsOn('depth', message => {
      if (destroyed || !message || message.symbol !== sym) return;

      depth = message;
      paintDepth();
    })
  );

  subscribeSymbol(sym);
  off.push(() => unsubscribeSymbol(sym));

  async function stats() {
    if (destroyed || statsBusy) return;

    statsBusy = true;
    const requestId = ++statsRequestId;

    try {
      const portfolio = await api('/portfolio');

      if (destroyed || requestId !== statsRequestId) return;

      const p = portfolio || {};

      $el('#stats').innerHTML =
        stat(
          'Total equity',
          inr(p.equity ?? 0),
          'Since start ' + pct(
            p.start_cash ? (p.equity / p.start_cash - 1) * 100 : 0
          ),
          cls(p.total_pnl ?? 0)
        ) +
        stat(
          'Day P&L',
          inr(p.day_pnl ?? 0),
          '',
          cls(p.day_pnl ?? 0)
        ) +
        stat(
          'Unrealized P&L',
          inr(p.unrealized ?? 0),
          'Realized ' + inr(p.realized ?? 0),
          cls(p.unrealized ?? 0)
        ) +
        stat(
          'Cash available',
          inr(p.cash ?? 0),
          'Risk score ' + fmt(p.risk_score ?? 0, 0) +
            ' · ' + esc(p.risk_label ?? 'N/A')
        );

      const equityHistory = await api('/portfolio/equity');

      if (destroyed || requestId !== statsRequestId) return;

      const history = Array.isArray(equityHistory) ? equityHistory : [];

      $el('#eq').innerHTML = '';

      if (history.length) {
        lineChart($el('#eq'), {
          series: [{
            data: history.map(point => point[1]),
            color: '#d46bd6',
            fill: true
          }],
          yfmt: value => '₹' + fmt(value / 1000, 0) + 'k'
        });
      } else {
        $el('#eq').innerHTML = '<div class="mu text-xs">No equity history yet.</div>';
      }
    } catch (error) {
      if (destroyed || requestId !== statsRequestId) return;

      $el('#stats').innerHTML =
        `<div class="dn text-sm col-span-4">${esc(error?.message || 'Unable to load portfolio.')}</div>`;
    } finally {
      statsBusy = false;
    }
  }

  async function watch() {
    if (destroyed) return;

    const requestId = ++watchRequestId;

    try {
      const result = await api('/watchlist');

      if (destroyed || requestId !== watchRequestId) return;

      wl = {
        symbols: Array.isArray(result?.symbols) ? result.symbols : [],
        alerts: Array.isArray(result?.alerts) ? result.alerts : []
      };

      paintWl();
    } catch (error) {
      if (destroyed || requestId !== watchRequestId) return;

      $el('#wl').innerHTML =
        `<div class="dn text-xs">${esc(error?.message || 'Unable to load watchlist.')}</div>`;
    }
  }

  function paintWl() {
    if (destroyed) return;

    const quotes = get()?.quotes || {};
    const activeAlerts = wl.alerts.filter(alert => alert.active);

    $el('#wl').innerHTML =
      table(
        ['Symbol', 'Last', 'Chg', ''],
        wl.symbols.map(item => {
          const symbol = item.symbol;
          const quote = quotes[symbol] || item;
          const alertCount = activeAlerts.filter(
            alert => alert.symbol === symbol
          ).length;

          return [
            `<a href="#/trade?symbol=${encodeURIComponent(symbol)}" class="underline">${esc(symbol)}</a>`,
            fmt(quote.last ?? 0),
            `<span class="${cls(quote.change_pct ?? 0)}">${pct(quote.change_pct ?? 0)}</span>`,
            `<button class="btn btn-sm" data-al="${esc(symbol)}" title="Set price alert">🔔${alertCount || ''}</button>
             <button class="btn btn-sm" data-rm="${esc(symbol)}" title="Remove">✕</button>`
          ];
        }),
        'Your watchlist is empty'
      ) +
      (
        activeAlerts.length
          ? `<div class="text-xs mu mt-2">Active alerts: ${
              activeAlerts.map(alert =>
                `${esc(alert.symbol)} ${esc(alert.direction)} ${fmt(alert.price)}
                 <a href="#" data-da="${esc(alert.id)}" class="dn">✕</a>`
              ).join(' · ')
            }</div>`
          : ''
      );

    // Bind only to elements inside this dashboard.
    $el('#wl').querySelectorAll('[data-rm]').forEach(button => {
      button.onclick = async () => {
        try {
          await api('/watchlist', {
            method: 'POST',
            body: {
              symbol: button.dataset.rm,
              action: 'remove'
            }
          });

          await watch();
        } catch (error) {
          toast(error?.message || 'Unable to remove symbol.', 'err');
        }
      };
    });

    $el('#wl').querySelectorAll('[data-al]').forEach(button => {
      button.onclick = async () => {
        const symbol = button.dataset.al;
        const last = get()?.quotes?.[symbol]?.last;

        if (!Number.isFinite(Number(last))) {
          toast('Current market price is unavailable.', 'err');
          return;
        }

        const answer = prompt(
          `Alert when ${symbol} crosses (current ${fmt(last)}):`,
          fmt(last, 2).replace(/,/g, '')
        );

        if (answer === null || !answer.trim()) return;

        const price = Number(answer);

        if (!Number.isFinite(price) || price <= 0) {
          toast('Enter a valid positive alert price.', 'err');
          return;
        }

        try {
          await api('/alerts', {
            method: 'POST',
            body: {
              symbol,
              price,
              direction: price >= Number(last) ? 'above' : 'below'
            }
          });

          toast('Alert set', 'ok');
          await watch();
        } catch (error) {
          toast(error?.message || 'Unable to set alert.', 'err');
        }
      };
    });

    $el('#wl').querySelectorAll('[data-da]').forEach(button => {
      button.onclick = async event => {
        event.preventDefault();

        try {
          await api('/alerts/delete', {
            method: 'POST',
            body: { id: Number(button.dataset.da) }
          });

          await watch();
        } catch (error) {
          toast(error?.message || 'Unable to delete alert.', 'err');
        }
      };
    });
  }

  async function addWatchlistSymbol() {
    const input = $el('#wadd');
    const symbol = input.value.trim().toUpperCase();

    if (!symbol) {
      toast('Enter a symbol first.', 'err');
      return;
    }

    try {
      await api('/watchlist', {
        method: 'POST',
        body: {
          symbol,
          action: 'add'
        }
      });

      input.value = '';
      await watch();
    } catch (error) {
      toast(error?.message || 'Unable to add symbol.', 'err');
    }
  }

  $el('#wbtn').onclick = addWatchlistSymbol;

  $el('#wadd').onkeydown = event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addWatchlistSymbol();
    }
  };

  async function fills() {
    if (destroyed || fillsBusy) return;

    fillsBusy = true;
    const requestId = ++fillsRequestId;

    try {
      const result = await api('/fills');

      if (destroyed || requestId !== fillsRequestId) return;

      const recentFills = Array.isArray(result) ? result.slice(0, 8) : [];

      $el('#fills').innerHTML = recentFills.map(item => `
        <div class="flex justify-between py-1 border-b border-white/5">
          <span>
            <b class="${item.side === 'buy' ? 'up' : 'dn'}">${esc(String(item.side || '').toUpperCase())}</b>
            ${esc(item.symbol)}
          </span>
          <span class="num">${fmt(item.qty, 2)} @ ${fmt(item.price)}</span>
        </div>
      `).join('') ||
        '<div class="mu">No trades yet. Place one from the Trade page.</div>';
    } catch (error) {
      if (!destroyed && requestId === fillsRequestId) {
        $el('#fills').innerHTML =
          `<div class="dn">${esc(error?.message || 'Unable to load recent activity.')}</div>`;
      }
    } finally {
      fillsBusy = false;
    }
  }

  const heat = throttle(() => {
    if (destroyed) return;

    const quotes = Object.values(get()?.quotes || {});

    const marketData = quotes
      .filter(quote =>
        !quote.index &&
        quote.sector &&
        quote.market_cap_cr != null
      )
      .map(quote => ({
        ...quote,
        market_cap_cr: quote.market_cap_cr ||
          (quote.symbol === 'BTC-INR' ? 1100000 : 330000)
      }));

    try {
      treemap(
        $el('#hm'),
        marketData,
        symbol => {
          location.hash = '#/trade?symbol=' + encodeURIComponent(symbol);
        }
      );
    } catch (error) {
      $el('#hm').textContent = error?.message || 'Unable to render sector heat map.';
    }
  }, 1500);

  off.push(
    wsOn('ticks', () => {
      if (destroyed) return;
      heat();
      paintWl();
    }),

    wsOn('fill', () => {
      if (destroyed) return;
      stats();
      fills();
    })
  );

  try {
    const user = get()?.user;

    if (user) {
      $el('#kyc').innerHTML =
        `<span class="chip ${user.kyc === 'verified' ? 'on' : ''}">KYC: ${esc(user.kyc || 'unknown')}</span>`;
    }
  } catch {
    // User information may not be available yet.
  }

  await Promise.all([
    loadChart(),
    stats(),
    watch(),
    fills()
  ]);

  heat();

  const intervalId = setInterval(() => {
    if (!destroyed) stats();
  }, 5000);

  off.push(() => clearInterval(intervalId));

  // Return cleanup for the app's page/router lifecycle.
  return () => {
    if (destroyed) return;

    destroyed = true;
    chartRequestId++;
    statsRequestId++;
    watchRequestId++;
    fillsRequestId++;

    off.forEach(cleanup => {
      try {
        cleanup();
      } catch {
        // Continue cleaning up other listeners.
      }
    });
  };
}
