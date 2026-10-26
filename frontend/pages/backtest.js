
// Backtesting Lab: data loader, strategy builder, replay, equity curve,
// drawdown, trade log, performance metrics and CSV export.

import { api } from '../src/api.js';
import { get } from '../src/store.js';
import { $, $$, esc, fmt, inr, pct, cls, qs, downloadText } from '../src/utils.js';
import { CandleChart } from '../charts/candlestick.js';
import { lineChart } from '../charts/line.js';
import { stat, table, toast } from '../components/ui.js';

const PARAMS = {
  mean_reversion: { window: 20, k: 1.5 },
  momentum: { lookback: 20, trend: 50, threshold: 0 },
  arbitrage: { window: 10, entry_z: 1.5, exit_z: 0.3 },
  scalping: { take_profit: 0.003, stop_loss: 0.002, max_hold: 4 },
  pair_trading: { window: 40, entry_z: 2, exit_z: 0.3, beta: 1 },
  breakout: { window: 20 },
  ma_crossover: { fast: 10, slow: 30 },
  vwap: { window: 50, band: 0.002 }
};

const DEFAULTS = {
  bars: 1000,
  seed: 42,
  capital: 100000,
  feeBps: 5,
  minBars: 100,
  maxBars: 20000
};

const isObject = value =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const toNumber = value => {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const safeArray = value => Array.isArray(value) ? value : [];

const csvCell = value => {
  const text = String(value ?? '');
  return '"' + text.replace(/"/g, '""') + '"';
};

const validSymbol = value =>
  typeof value === 'string' &&
  /^[a-zA-Z0-9._-]{1,40}$/.test(value);

const validStrategy = value =>
  typeof value === 'string' &&
  Object.prototype.hasOwnProperty.call(PARAMS, value);

function parseCSV(text) {
  const lines = String(text)
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter(line => line.trim() !== '');

  if (lines.length < 2) {
    throw new Error('CSV must contain a header and at least one data row.');
  }

  const delimiter = lines[0].includes('\t')
    ? '\t'
    : lines[0].includes(';')
      ? ';'
      : ',';

  // Supports quoted fields and escaped quotes.
  const splitRow = line => {
    const fields = [];
    let field = '';
    let quoted = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        if (quoted && line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = !quoted;
        }
      } else if (char === delimiter && !quoted) {
        fields.push(field.trim());
        field = '';
      } else {
        field += char;
      }
    }

    fields.push(field.trim());
    return fields;
  };

  const firstRow = splitRow(lines[0]);
  const header = firstRow.map(value => value.trim().toLowerCase());

  const closeIndex = header.indexOf('close');
  const priceIndex = closeIndex >= 0
    ? closeIndex
    : firstRow.length - 1;

  const firstValue = toNumber(firstRow[priceIndex]);
  const hasHeader = firstValue === null;

  const dataLines = hasHeader ? lines.slice(1) : lines;
  const prices = [];

  for (const line of dataLines) {
    const fields = splitRow(line);
    const price = toNumber(fields[priceIndex]);

    if (price !== null && price > 0) {
      prices.push(price);
    }
  }

  if (prices.length < 60) {
    throw new Error(
      'CSV needs at least 60 valid closing prices. Use a "close" column.'
    );
  }

  return prices;
}

function normalizeSeries(values) {
  return safeArray(values).map(toNumber);
}

export default async function backtestingPage(el) {
  let strategies = [];
  let csvPrices = null;
  let result = null;
  let timer = null;
  let chart = null;
  let mounted = true;
  let running = false;
  let requestId = 0;
  let replayIndex = 0;
  let candles = [];
  let trades = [];

  const symbols = safeArray(get()?.symbols)
    .filter(item => item && !item.index && validSymbol(item.symbol));

  const cleanupTimer = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const destroyChart = () => {
    if (chart) {
      chart.destroy();
      chart = null;
    }
  };

  const stopReplay = () => {
    cleanupTimer();

    const playButton = $('#pl');
    if (playButton) playButton.textContent = '▶ Play';
  };

  const showError = message => {
    if (!mounted) return;

    const target = $('#res');
    if (target) {
      target.className = 'glass p-6 text-center';
      target.innerHTML = `
        <p class="dn text-sm" role="alert">${esc(message)}</p>
        <p class="mu text-xs mt-2">
          Check the selected data and parameters, then try again.
        </p>
      `;
    }
  };

  el.innerHTML = `
    <div class="pt-4 grid lg:grid-cols-12 gap-3">
      <aside class="glass p-4 lg:col-span-3 h-fit">
        <h2 class="text-lg mb-1">Backtesting Lab</h2>
        <p class="text-xs mu mb-2">
          Test strategies against historical data and review the results.
        </p>

        <label class="lbl" for="st">Strategy</label>
        <select id="st" class="input"></select>
        <p id="sd" class="text-xs mu mt-1"></p>

        <label class="lbl" for="sy">Market / asset</label>
        <select id="sy" class="input"></select>

        <label class="lbl" for="src">Historical data loader</label>
        <select id="src" class="input">
          <option value="sim">Simulated history (seeded)</option>
          <option value="live">Live feed candles (5s)</option>
          <option value="csv">Upload CSV…</option>
        </select>

        <input id="file" type="file" accept=".csv,.txt"
          class="input mt-2 hidden">

        <p id="fi" class="text-xs mu mt-1"></p>

        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="lbl" for="bars">Bars</label>
            <input id="bars" type="number" class="input"
              value="${DEFAULTS.bars}" min="${DEFAULTS.minBars}"
              max="${DEFAULTS.maxBars}">
          </div>
          <div>
            <label class="lbl" for="seed">Seed</label>
            <input id="seed" type="number" class="input"
              value="${DEFAULTS.seed}">
          </div>
          <div>
            <label class="lbl" for="cap">Capital ₹</label>
            <input id="cap" type="number" class="input"
              value="${DEFAULTS.capital}" min="1">
          </div>
          <div>
            <label class="lbl" for="fee">Fee + slip bps</label>
            <input id="fee" type="number" class="input"
              value="${DEFAULTS.feeBps}" min="0" max="1000" step="any">
          </div>
        </div>

        <h3 class="text-sm mt-4 mb-1">Strategy builder (parameters)</h3>
        <div id="params" class="grid grid-cols-2 gap-2"></div>

        <button id="run" type="button"
          class="btn btn-p w-full justify-center mt-4">
          Run Backtest
        </button>
      </aside>

      <div class="lg:col-span-9 grid gap-3 content-start">
        <div id="res" class="glass p-10 text-center mu">
          Loading strategies…
        </div>
      </div>
    </div>
  `;

  const strategySelect = $('#st');
  const symbolSelect = $('#sy');

  try {
    const [strategyResult] = await Promise.all([
      api('/strategies')
    ]);

    if (!mounted) return () => {};

    strategies = safeArray(strategyResult).filter(
      item =>
        isObject(item) &&
        validStrategy(item.id) &&
        typeof item.name === 'string'
    );

    if (!strategies.length) {
      showError('No supported strategies were returned by the server.');
      return () => {
        mounted = false;
        stopReplay();
        destroyChart();
      };
    }

    strategySelect.innerHTML = strategies.map(strategy => `
      <option value="${esc(strategy.id)}">${esc(strategy.name)}</option>
    `).join('');

    symbolSelect.innerHTML = symbols.map(item => `
      <option value="${esc(item.symbol)}">${esc(item.symbol)}</option>
    `).join('');

    if (!symbols.length) {
      symbolSelect.innerHTML = '<option value="">No market symbols available</option>';
    }

    const query = qs();

    if (query.strategy && validStrategy(query.strategy) &&
        strategies.some(item => item.id === query.strategy)) {
      strategySelect.value = query.strategy;
    }

    if (query.symbol && symbols.some(item => item.symbol === query.symbol)) {
      symbolSelect.value = query.symbol;
    }

    const drawParams = () => {
      const id = strategySelect.value;
      const strategy = strategies.find(item => item.id === id);

      $('#sd').textContent = strategy?.description || '';

      const defaults = PARAMS[id] || {};

      $('#params').innerHTML = Object.entries(defaults).map(([key, value]) => `
        <div>
          <label class="lbl" for="param-${esc(key)}">${esc(key)}</label>
          <input
            id="param-${esc(key)}"
            class="input"
            data-p="${esc(key)}"
            type="number"
            step="any"
            value="${value}"
            required
          >
        </div>
      `).join('');
    };

    strategySelect.onchange = drawParams;
    drawParams();
  } catch (error) {
    if (mounted) showError(error?.message || 'Unable to load strategies.');

    return () => {
      mounted = false;
      stopReplay();
      destroyChart();
    };
  }

  $('#src').onchange = event => {
    const isCSV = event.target.value === 'csv';

    $('#file').classList.toggle('hidden', !isCSV);

    if (!isCSV) {
      csvPrices = null;
      $('#fi').textContent = '';
      $('#file').value = '';
    }
  };

  $('#file').onchange = async event => {
    const file = event.target.files?.[0];

    csvPrices = null;
    $('#fi').textContent = '';

    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      $('#fi').textContent = 'CSV file must be 10 MB or smaller.';
      event.target.value = '';
      return;
    }

    try {
      const prices = parseCSV(await file.text());

      if (!mounted) return;

      csvPrices = prices;
      $('#fi').textContent =
        `Loaded ${prices.length} closing prices from ${file.name}.`;
    } catch (error) {
      $('#fi').textContent = error.message || 'Unable to read this CSV.';
      event.target.value = '';
    }
  };

  const readParams = () => {
    const params = {};

    for (const input of $$('[data-p]')) {
      const value = toNumber(input.value);

      if (value === null) {
        throw new Error(`Enter a valid value for ${input.dataset.p}.`);
      }

      if (value < 0) {
        throw new Error(`${input.dataset.p} cannot be negative.`);
      }

      params[input.dataset.p] = value;
    }

    const strategy = $('#st').value;

    if (strategy === 'ma_crossover' && params.fast >= params.slow) {
      throw new Error('Fast moving-average period must be smaller than slow period.');
    }

    if (strategy === 'scalping' &&
        (params.take_profit <= 0 || params.stop_loss <= 0 || params.max_hold < 1)) {
      throw new Error('Take profit, stop loss and max hold must be greater than zero.');
    }

    if (strategy === 'arbitrage' || strategy === 'pair_trading') {
      if (params.entry_z !== undefined &&
          params.exit_z !== undefined &&
          params.exit_z >= params.entry_z) {
        throw new Error('Exit Z-score must be smaller than entry Z-score.');
      }
    }

    for (const [key, value] of Object.entries(params)) {
      if (['window', 'lookback', 'trend', 'fast', 'slow', 'max_hold'].includes(key)) {
        if (!Number.isInteger(value) || value < 1) {
          throw new Error(`${key} must be a positive whole number.`);
        }
      }
    }

    return params;
  };

  const validateForm = () => {
    const bars = toNumber($('#bars').value);
    const seed = toNumber($('#seed').value);
    const capital = toNumber($('#cap').value);
    const totalFee = toNumber($('#fee').value);

    if (bars === null || !Number.isInteger(bars) ||
        bars < DEFAULTS.minBars || bars > DEFAULTS.maxBars) {
      throw new Error(`Bars must be a whole number from ${DEFAULTS.minBars} to ${DEFAULTS.maxBars}.`);
    }

    if (seed === null || !Number.isInteger(seed)) {
      throw new Error('Seed must be a valid whole number.');
    }

    if (capital === null || capital <= 0) {
      throw new Error('Capital must be greater than zero.');
    }

    if (totalFee === null || totalFee < 0 || totalFee > 1000) {
      throw new Error('Fee + slippage must be between 0 and 1000 bps.');
    }

    if (!validStrategy($('#st').value)) {
      throw new Error('Select a valid strategy.');
    }

    if (!validSymbol($('#sy').value)) {
      throw new Error('Select a valid market symbol.');
    }

    const source = $('#src').value;

    if (source === 'csv' && !csvPrices) {
      throw new Error('Upload a valid CSV with at least 60 closing prices.');
    }

    return {
      strategy: $('#st').value,
      symbol: $('#sy').value,
      bars,
      seed,
      capital,
      fee_bps: totalFee * 0.6,
      slippage_bps: totalFee * 0.4,
      params: readParams(),
      source: source === 'live' ? 'live' : 'sim',
      ...(source === 'csv' ? { prices: csvPrices.slice() } : {})
    };
  };

  $('#run').onclick = async () => {
    if (running || !mounted) return;

    let payload;

    try {
      payload = validateForm();
    } catch (error) {
      toast(error.message, 'err');
      return;
    }

    running = true;

    const thisRequest = ++requestId;
    const button = $('#run');

    button.disabled = true;
    button.textContent = 'Running…';

    stopReplay();
    destroyChart();

    $('#res').className = 'glass p-10 text-center mu';
    $('#res').textContent = 'Running backtest…';

    try {
      const response = await api('/backtest', {
        method: 'POST',
        body: payload
      });

      if (!mounted || thisRequest !== requestId) return;

      if (!isObject(response)) {
        throw new Error('The server returned an invalid backtest response.');
      }

      result = response;
      show();
    } catch (error) {
      if (mounted && thisRequest === requestId) {
        showError(error?.message || 'Backtest failed.');
        toast(error?.message || 'Backtest failed.', 'err');
      }
    } finally {
      if (thisRequest === requestId) {
        running = false;

        if (mounted) {
          const currentButton = $('#run');

          if (currentButton) {
            currentButton.disabled = false;
            currentButton.textContent = 'Run Backtest';
          }
        }
      }
    }
  };

  function show() {
    stopReplay();
    destroyChart();

    const r = result;

    trades = safeArray(r.trades);

    const equity = normalizeSeries(r.equity_curve);
    const drawdown = normalizeSeries(r.drawdown_curve);
    const ohlc = safeArray(r.ohlc);

    const metric = (value, digits = 2) =>
      value === null ? '—' : fmt(value, digits);

    const percentMetric = value =>
      toNumber(value) === null ? '—' : pct(value);

    const tradeCount = toNumber(r.trades_count) ?? trades.length;
    const netProfit = toNumber(r.net_profit);
    const roi = toNumber(r.roi_pct);
    const sharpe = toNumber(r.sharpe);
    const drawdownPct = toNumber(r.max_drawdown_pct);
    const winRate = toNumber(r.win_rate);
    const profitFactor = toNumber(r.profit_factor);
    const avgTrade = toNumber(r.avg_trade_pct);
    const exposure = toNumber(r.exposure_pct);
    const buyHold = toNumber(r.buy_hold_pct);

    const statHTML = (label, value, subtitle = '', color = '') =>
      stat(
        esc(label),
        esc(value),
        esc(subtitle),
        color
      );

    $('#res').className = 'grid gap-3';

    $('#res').innerHTML = `
      <div class="grid grid-cols-2 xl:grid-cols-4 gap-3">
        ${statHTML(
          'Net profit',
          netProfit === null ? '—' : inr(netProfit),
          percentMetric(roi),
          netProfit === null ? '' : cls(netProfit)
        )}
        ${statHTML(
          'Max drawdown',
          drawdownPct === null ? '—' : `${fmt(Math.abs(drawdownPct), 2)}%`,
          'Peak-to-trough decline',
          'dn'
        )}
        ${statHTML(
          'Win rate',
          winRate === null ? '—' : `${fmt(winRate, 1)}%`,
          `${tradeCount} trades`
        )}
        ${statHTML(
          'Sharpe ratio',
          metric(sharpe),
          sharpe === null ? 'Not available' :
            sharpe > 1.5 ? 'Excellent' :
            sharpe > 0.8 ? 'Good' :
            sharpe > 0 ? 'Weak' : 'Negative',
          sharpe === null ? '' : cls(sharpe)
        )}
      </div>

      <div class="grid grid-cols-2 xl:grid-cols-4 gap-3">
        ${statHTML('ROI', percentMetric(roi), `Buy & hold ${percentMetric(buyHold)}`, roi === null ? '' : cls(roi))}
        ${statHTML('Profit factor', metric(profitFactor))}
        ${statHTML('Avg trade', percentMetric(avgTrade))}
        ${statHTML('Time in market', exposure === null ? '—' : `${fmt(exposure, 0)}%`)}
      </div>

      <section class="glass p-3">
        <div class="flex flex-wrap items-center gap-2 mb-2">
          <h3 class="text-sm mu">
            Candlestick replay
            <span class="text-[11px]">
              (${esc(r.data_source || 'Backtest data')} ·
              ${esc(r.bars ?? ohlc.length)} bars · ▲ entry ▼ exit)
            </span>
          </h3>

          <div class="ml-auto flex items-center gap-2">
            <button id="pl" class="btn btn-sm" type="button">▶ Play</button>
            <button id="rs" class="btn btn-sm" type="button">⏮</button>
            <select id="sp" class="input !w-auto !py-1 !text-xs">
              <option value="160">1x</option>
              <option value="70">2x</option>
              <option value="25">5x</option>
            </select>
          </div>
        </div>

        <div id="rc" style="height:340px"></div>
      </section>

      <div class="grid lg:grid-cols-2 gap-3">
        <section class="glass p-3">
          <h3 class="text-sm mu mb-1">Equity curve</h3>
          <div id="eq" style="height:220px"></div>
        </section>

        <section class="glass p-3">
          <h3 class="text-sm mu mb-1">Drawdown %</h3>
          <div id="dd" style="height:220px"></div>
        </section>
      </div>

      <section class="glass p-3">
        <div class="flex items-center mb-2">
          <h3 class="text-sm mu">Trade log (${trades.length})</h3>
          <button id="ex" class="btn btn-sm ml-auto" type="button">
            ⬇ Export CSV
          </button>
        </div>

        <div style="max-height:320px;overflow:auto" id="trade-table"></div>
      </section>
    `;

    const tradeRows = trades.map((trade, index) => {
      const side = trade.side === 'long' || trade.side === 'short'
        ? trade.side
        : '—';

      const entryBar = toNumber(trade.entry_bar);
      const exitBar = toNumber(trade.exit_bar);
      const entryPrice = toNumber(trade.entry_price);
      const exitPrice = toNumber(trade.exit_price);
      const duration = toNumber(trade.bars);
      const pnl = toNumber(trade.pnl_pct);

      return [
        index + 1,
        `<span class="${side === 'long' ? 'up' : side === 'short' ? 'dn' : ''}">${esc(side)}</span>`,
        entryBar === null ? '—' : entryBar,
        `${exitBar === null ? '—' : exitBar}${trade.open ? ' (open)' : ''}`,
        entryPrice === null ? '—' : fmt(entryPrice),
        exitPrice === null ? '—' : fmt(exitPrice),
        duration === null ? '—' : duration,
        `<span class="${pnl === null ? '' : cls(pnl)}">${pnl === null ? '—' : esc(pct(pnl))}</span>`
      ];
    });

    $('#trade-table').innerHTML = table(
      ['#', 'Side', 'Entry bar', 'Exit bar', 'Entry', 'Exit', 'Bars', 'P&L %'],
      tradeRows,
      'No trades were triggered'
    );

    lineChart($('#eq'), {
      series: [{
        data: equity,
        color: '#d46bd6',
        fill: true
      }],
      yfmt: value => '₹' + fmt(value, 0)
    });

    lineChart($('#dd'), {
      series: [{
        data: drawdown,
        color: '#ff5b6e',
        fill: true
      }],
      yfmt: value => fmt(value, 1) + '%',
      max: 0
    });

    const step = Math.max(1, Math.floor(toNumber(r.step) || 1));

    candles = ohlc
      .map((candle, index) => {
        if (!Array.isArray(candle) || candle.length < 4) return null;

        const [open, high, low, close] = candle.map(toNumber);

        if ([open, high, low, close].some(value => value === null)) {
          return null;
        }

        if (
          open <= 0 || high <= 0 || low <= 0 || close <= 0 ||
          high < Math.max(open, close, low) ||
          low > Math.min(open, close, high)
        ) {
          return null;
        }

        return {
          t: index * 1000,
          o: open,
          h: high,
          l: low,
          c: close,
          v: 1
        };
      })
      .filter(Boolean);

    const markers = [];

    for (const trade of trades) {
      const entryBar = toNumber(trade.entry_bar);
      const exitBar = toNumber(trade.exit_bar);
      const entryPrice = toNumber(trade.entry_price);
      const exitPrice = toNumber(trade.exit_price);

      const entryIndex = entryBar === null
        ? -1
        : Math.floor(entryBar / step);

      const exitIndex = exitBar === null
        ? -1
        : Math.floor(exitBar / step);

      const isLong = trade.side === 'long';

      if (entryIndex >= 0 && entryIndex < candles.length) {
        markers.push({
          index: entryIndex,
          price: entryPrice ?? candles[entryIndex].l,
          type: isLong ? 'buy' : 'sell'
        });
      }

      // Open trades have no confirmed exit marker.
      if (
        !trade.open &&
        exitIndex >= 0 &&
        exitIndex < candles.length
      ) {
        markers.push({
          index: exitIndex,
          price: exitPrice ?? candles[exitIndex].h,
          type: isLong ? 'sell' : 'buy'
        });
      }
    }

    if (candles.length) {
      chart = new CandleChart($('#rc'), {
        rsi: false,
        markers
      });

      chart.view = Math.min(120, candles.length);
      chart.setData(
        candles.map(candle => [
          candle.t,
          candle.o,
          candle.h,
          candle.l,
          candle.c,
          candle.v
        ])
      );

      replayIndex = candles.length;
    } else {
      $('#rc').innerHTML = `
        <p class="mu text-sm p-4">
          No valid candlestick data was returned for replay.
        </p>
      `;

      $('#pl').disabled = true;
      $('#rs').disabled = true;
    }

    const drawReplayFrame = () => {
      if (!mounted || !chart || !candles.length) {
        stopReplay();
        return;
      }

      replayIndex = Math.min(candles.length, replayIndex + 1);
      chart.data = candles.slice(0, replayIndex);
      chart.calc();
      chart.draw();

      if (replayIndex >= candles.length) {
        stopReplay();
      }
    };

    $('#pl').onclick = () => {
      if (timer !== null) {
        stopReplay();
        return;
      }

      if (!candles.length || !chart) return;

      if (replayIndex >= candles.length) {
        replayIndex = Math.min(20, candles.length);
        chart.data = candles.slice(0, replayIndex);
        chart.calc();
        chart.draw();
      }

      const speed = toNumber($('#sp').value) || 160;

      $('#pl').textContent = '⏸ Pause';
      timer = setInterval(drawReplayFrame, speed);
    };

    $('#rs').onclick = () => {
      stopReplay();

      if (!chart || !candles.length) return;

      replayIndex = Math.min(20, candles.length);
      chart.data = candles.slice(0, replayIndex);
      chart.calc();
      chart.draw();
    };

    $('#sp').onchange = () => {
      if (timer === null) return;

      stopReplay();

      if (replayIndex < candles.length) {
        $('#pl').click();
      }
    };

    $('#ex').onclick = () => {
      const headers = [
        'trade',
        'side',
        'entry_bar',
        'exit_bar',
        'entry_price',
        'exit_price',
        'bars',
        'pnl_pct'
      ];

      const rows = trades.map((trade, index) => [
        index + 1,
        trade.side,
        trade.entry_bar,
        trade.exit_bar,
        trade.entry_price,
        trade.exit_price,
        trade.bars,
        trade.pnl_pct
      ]);

      const csvContent = [
        headers.map(csvCell).join(','),
        ...rows.map(row => row.map(csvCell).join(','))
      ].join('\r\n');

      const filename =
        `backtest_${r.strategy || 'strategy'}_${r.symbol || 'market'}.csv`;

      downloadText(filename, csvContent);
    };
  }

  return () => {
    mounted = false;
    requestId++;
    stopReplay();
    destroyChart();
  };
}
