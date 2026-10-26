
// Order Book & Market Depth: bids, asks, spread and cumulative liquidity.

import { get } from '../src/store.js';
import { api } from '../src/api.js';
import { $, esc, fmt, qs } from '../src/utils.js';
import { depthChart } from '../charts/depth.js';
import { wsOn, wsSub, wsUnsub } from '../hooks/useWebSocket.js';

const DEFAULT_SYMBOL = 'RELIANCE';
const MAX_LEVELS = 12;

const isObject = value =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const toNumber = value => {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const validSymbol = symbol =>
  typeof symbol === 'string' && /^[A-Za-z0-9._-]{1,40}$/.test(symbol);

const normalizeLevels = levels => {
  if (!Array.isArray(levels)) return [];

  return levels
    .map(level => {
      if (!isObject(level)) return null;

      const price = toNumber(level.price);
      const qty = toNumber(level.qty);
      const total = toNumber(level.total);

      if (price === null || qty === null || price <= 0 || qty < 0) {
        return null;
      }

      return {
        price,
        qty,
        total: total !== null && total >= 0 ? total : null
      };
    })
    .filter(Boolean);
};

export default async function orderBookPage(el) {
  let mounted = true;
  let symbol = DEFAULT_SYMBOL;
  let depth = null;
  let chart = null;
  let requestId = 0;
  let loading = false;

  const off = [];
  const subscribedTopics = new Set();

  const symbols = (Array.isArray(get()?.symbols) ? get().symbols : [])
    .filter(item => item && !item.index && validSymbol(item.symbol));

  const availableSymbols = [...new Set(symbols.map(item => item.symbol))];

  if (availableSymbols.includes(qs().symbol)) {
    symbol = qs().symbol;
  } else if (availableSymbols.includes(DEFAULT_SYMBOL)) {
    symbol = DEFAULT_SYMBOL;
  } else if (availableSymbols.length) {
    symbol = availableSymbols[0];
  }

  el.innerHTML = `
    <div class="pt-4 grid gap-3">
      <div class="flex flex-wrap items-center gap-3">
        <h2 class="text-xl">Order Book &amp; Market Depth</h2>
        <select id="sym" class="input !w-auto" aria-label="Select market symbol">
          ${availableSymbols.map(item => `
            <option value="${esc(item)}">${esc(item)}</option>
          `).join('')}
        </select>
        <span id="status" class="text-xs mu ml-auto" role="status">
          Connecting…
        </span>
      </div>

      <div class="grid sm:grid-cols-3 gap-3">
        <div class="glass p-4">
          <div class="text-xs mu">Best bid</div>
          <div id="bb" class="text-2xl up num">—</div>
        </div>

        <div class="glass p-4">
          <div class="text-xs mu">Spread</div>
          <div id="sp" class="text-2xl num">—</div>
          <div id="spp" class="text-xs mu"></div>
        </div>

        <div class="glass p-4">
          <div class="text-xs mu">Best ask</div>
          <div id="ba" class="text-2xl dn num">—</div>
        </div>
      </div>

      <div class="grid lg:grid-cols-2 gap-3">
        <section class="glass p-3">
          <h3 class="text-sm up mb-2">Buy orders (bids)</h3>
          <div id="buys" class="overflow-x-auto"></div>
        </section>

        <section class="glass p-3">
          <h3 class="text-sm dn mb-2">Sell orders (asks)</h3>
          <div id="sells" class="overflow-x-auto"></div>
        </section>
      </div>

      <section class="glass p-3">
        <h3 class="text-sm mu mb-2">Liquidity (cumulative depth)</h3>
        <div id="dc" style="height:280px"></div>
      </section>

      <p id="error" class="dn text-sm" role="alert" aria-live="polite"></p>
    </div>
  `;

  const symbolSelect = $('#sym');
  const statusElement = $('#status');
  const errorElement = $('#error');

  symbolSelect.value = symbol;

  const setStatus = message => {
    if (mounted && statusElement) statusElement.textContent = message;
  };

  const setError = message => {
    if (mounted && errorElement) {
      errorElement.textContent = message || '';
    }
  };

  const formatNumber = (value, digits = 2) => {
    const number = toNumber(value);
    return number === null ? '—' : fmt(number, digits);
  };

  const rows = (levels, color) => {
    if (!levels.length) {
      return '<p class="text-sm mu py-4 text-center">No orders available.</p>';
    }

    return `
      <table class="t num w-full">
        <thead>
          <tr>
            <th>Price</th>
            <th>Quantity</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          ${levels.map(level => `
            <tr>
              <td style="color:${color}">${formatNumber(level.price)}</td>
              <td>${formatNumber(level.qty, level.qty < 10 ? 4 : 0)}</td>
              <td class="mu">
                ${level.total === null
                  ? '—'
                  : formatNumber(level.total, level.total < 10 ? 3 : 0)}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  };

  const normalizeDepth = payload => {
    if (!isObject(payload)) {
      throw new Error('Invalid order book response.');
    }

    const bids = normalizeLevels(payload.bids);
    const asks = normalizeLevels(payload.asks);

    // Bids should be highest-price first; asks lowest-price first.
    bids.sort((a, b) => b.price - a.price);
    asks.sort((a, b) => a.price - b.price);

    const bestBid = toNumber(payload.best_bid) ?? bids[0]?.price ?? null;
    const bestAsk = toNumber(payload.best_ask) ?? asks[0]?.price ?? null;

    const validBid = bestBid !== null && bestBid > 0;
    const validAsk = bestAsk !== null && bestAsk > 0;

    const midpoint = validBid && validAsk
      ? (bestBid + bestAsk) / 2
      : null;

    const reportedMid = toNumber(payload.mid);

    const spread = validBid && validAsk
      ? bestAsk - bestBid
      : toNumber(payload.spread);

    return {
      ...payload,
      bids: bids.slice(0, MAX_LEVELS),
      asks: asks.slice(0, MAX_LEVELS),
      best_bid: bestBid,
      best_ask: bestAsk,
      mid: reportedMid !== null && reportedMid > 0
        ? reportedMid
        : midpoint,
      spread
    };
  };

  const paint = () => {
    if (!mounted || !depth) return;

    $('#bb').textContent = formatNumber(depth.best_bid);
    $('#ba').textContent = formatNumber(depth.best_ask);
    $('#sp').textContent = formatNumber(depth.spread);

    const mid = toNumber(depth.mid);
    const spread = toNumber(depth.spread);

    $('#spp').textContent =
      mid !== null && mid > 0 && spread !== null
        ? `${(spread / mid * 10000).toFixed(1)} bps`
        : '';

    $('#buys').innerHTML = rows(depth.bids, '#2ee59d');
    $('#sells').innerHTML = rows(depth.asks, '#ff5b6e');

    if (chart) {
      chart.destroy();
      chart = null;
    }

    const host = $('#dc');

    if (host) {
      depthChart(host, depth.bids, depth.asks, depth.mid);
    }
  };

  const topicFor = selectedSymbol => `depth:${selectedSymbol}`;

  const subscribe = selectedSymbol => {
    const topic = topicFor(selectedSymbol);

    if (subscribedTopics.has(topic)) return;

    wsSub([topic]);
    subscribedTopics.add(topic);
  };

  const unsubscribe = selectedSymbol => {
    const topic = topicFor(selectedSymbol);

    if (!subscribedTopics.has(topic)) return;

    wsUnsub([topic]);
    subscribedTopics.delete(topic);
  };

  const load = async selectedSymbol => {
    const thisRequest = ++requestId;

    loading = true;
    setStatus('Loading order book…');
    setError('');

    try {
      const response = await api(
        `/depth?symbol=${encodeURIComponent(selectedSymbol)}&levels=${MAX_LEVELS}`
      );

      if (!mounted || thisRequest !== requestId) return;

      depth = normalizeDepth(response);
      paint();
      setStatus('Market data loaded');
    } catch (error) {
      if (!mounted || thisRequest !== requestId) return;

      setStatus('Unable to load');
      setError(error?.message || 'Failed to load order book data.');
    } finally {
      if (mounted && thisRequest === requestId) {
        loading = false;
      }
    }
  };

  const handleDepthMessage = message => {
    if (!mounted || !isObject(message) || message.symbol !== symbol) {
      return;
    }

    try {
      depth = normalizeDepth(message);
      paint();
      setStatus('Live market data');
      setError('');
    } catch {
      // Ignore malformed WebSocket updates; keep the last valid book.
    }
  };

  symbolSelect.onchange = async event => {
    const nextSymbol = event.target.value;

    if (!validSymbol(nextSymbol) || nextSymbol === symbol) return;

    unsubscribe(symbol);

    symbol = nextSymbol;
    depth = null;

    if (chart) {
      chart.destroy();
      chart = null;
    }

    $('#bb').textContent = '—';
    $('#ba').textContent = '—';
    $('#sp').textContent = '—';
    $('#spp').textContent = '';
    $('#buys').innerHTML = '';
    $('#sells').innerHTML = '';
    $('#dc').innerHTML = '';

    subscribe(symbol);
    await load(symbol);
  };

  const unsubscribeDepth = wsOn('depth', handleDepthMessage);

  if (typeof unsubscribeDepth === 'function') {
    off.push(unsubscribeDepth);
  }

  subscribe(symbol);

  // Unsubscribe from the currently selected topic during page cleanup.
  off.push(() => {
    for (const topic of [...subscribedTopics]) {
      wsUnsub([topic]);
      subscribedTopics.delete(topic);
    }
  });

  // Redraw the depth chart when the viewport changes.
  const onResize = () => {
    if (mounted && depth) paint();
  };

  addEventListener('resize', onResize);
  off.push(() => removeEventListener('resize', onResize));

  if (!availableSymbols.length) {
    setStatus('No symbols available');
    setError('No market symbols are available in the current session.');
  } else {
    await load(symbol);
  }

  return () => {
    mounted = false;
    requestId++;

    for (const cleanup of off) {
      try {
        cleanup();
      } catch {
        // Continue cleanup even if one unsubscribe handler fails.
      }
    }

    if (chart) {
      chart.destroy();
      chart = null;
    }
  };
}
