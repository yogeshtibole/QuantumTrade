
 // Strategy library: 8 algorithms with backtest stats
// (win rate, Sharpe ratio, drawdown and equity curve).

import { api } from '../src/api.js';
import { $, esc, fmt, pct, cls } from '../src/utils.js';
import { lineChart } from '../charts/line.js';

const STEPS = [
  'Strategy Development',
  'Data Acquisition',
  'Signal Generation',
  'Trade Execution',
  'Performance Monitoring',
  'Risk Management',
  'Backtesting & Optimization'
];

const BACKTEST_CONFIG = {
  symbol: 'RELIANCE',
  bars: 1000
};

const isObject = value =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value);

const numberOrNull = value => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const displayNumber = (value, digits = 2) => {
  const number = numberOrNull(value);
  return number === null ? 'N/A' : fmt(number, digits);
};

const displayPercent = value => {
  const number = numberOrNull(value);
  return number === null ? 'N/A' : pct(number);
};

const escapeText = value => esc(String(value ?? ''));

function cycle() {
  const radius = 118;
  const center = 150;

  const nodes = STEPS.map((step, index) => {
    const angle =
      index / STEPS.length * Math.PI * 2 - Math.PI / 2;

    const x = center + radius * Math.cos(angle);
    const y = center + radius * Math.sin(angle);

    return `
      <circle cx="${x}" cy="${y}" r="15"
        fill="#12102a" stroke="#d46bd6"/>
      <text x="${x}" y="${y + 4}"
        text-anchor="middle" fill="#fff" font-size="11">
        ${index + 1}
      </text>
    `;
  }).join('');

  return `
    <svg viewBox="0 0 300 300"
      class="w-full max-w-[300px] mx-auto"
      role="img"
      aria-label="Algorithmic trading workflow">

      <defs>
        <linearGradient id="strategy-gradient">
          <stop offset="0" stop-color="#d46bd6"/>
          <stop offset="1" stop-color="#4a4cf0"/>
        </linearGradient>
      </defs>

      <circle cx="${center}" cy="${center}" r="${radius}"
        fill="none"
        stroke="url(#strategy-gradient)"
        stroke-width="2"
        stroke-dasharray="6 6">

        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 150 150"
          to="360 150 150"
          dur="40s"
          repeatCount="indefinite"/>
      </circle>

      ${nodes}

      <text x="150" y="146" text-anchor="middle"
        fill="#fff" font-size="13">
        Algorithmic
      </text>

      <text x="150" y="164" text-anchor="middle"
        fill="#d46bd6" font-size="13">
        Trading Loop
      </text>
    </svg>
  `;
}

function renderMetric(label, value, className = '') {
  return `
    <div class="bg-white/5 rounded-lg p-2">
      <div class="mu">${escapeText(label)}</div>
      <b class="num ${className}">${escapeText(value)}</b>
    </div>
  `;
}

function renderCard(strategy, result, chartId) {
  const roi = numberOrNull(result.roi_pct);
  const winRate = numberOrNull(result.win_rate);
  const sharpe = numberOrNull(result.sharpe);
  const drawdown = numberOrNull(result.max_drawdown_pct);

  const roiClass = roi === null ? '' : cls(roi);
  const sharpeClass = sharpe === null ? '' : cls(sharpe);

  return `
    <h3 class="font-medium">${escapeText(strategy.name)}</h3>

    <p class="text-xs mu mt-1">
      ${escapeText(strategy.description)}
    </p>

    <div class="my-2" style="height:70px" id="${chartId}"></div>

    <div class="grid grid-cols-2 gap-2 text-xs">
      ${renderMetric(
        'ROI',
        displayPercent(roi),
        roiClass
      )}

      ${renderMetric(
        'Win rate',
        winRate === null ? 'N/A' : fmt(winRate, 1) + '%'
      )}

      ${renderMetric(
        'Sharpe',
        displayNumber(sharpe),
        sharpeClass
      )}

      ${renderMetric(
        'Max drawdown',
        drawdown === null
          ? 'N/A'
          : '-' + fmt(Math.abs(drawdown), 1) + '%',
        'dn'
      )}
    </div>

    <a class="btn btn-sm mt-3 justify-center"
      href="#/backtest?strategy=${encodeURIComponent(strategy.id)}">
      Open in Backtest Lab
    </a>
  `;
}

export default async function strategiesPage(el) {
  if (!el) return;

  let strategies = [];
  let seed = 42;
  let runId = 0;
  let running = false;
  let mounted = true;

  el.innerHTML = `
    <div class="pt-4 grid gap-3">

      <div class="flex flex-wrap items-center gap-2">
        <h2 class="text-xl">Trading Algorithms</h2>

        <span class="chip">Backtests on simulated data</span>

        <button id="rerun" type="button"
          class="btn btn-sm ml-auto">
          ↻ Re-run with new data
        </button>
      </div>

      <div class="grid md:grid-cols-3 gap-3">
        <div class="glass p-4">
          ${cycle()}
        </div>

        <div class="glass p-4 md:col-span-2">
          <h3 class="text-sm mu mb-2">Workflow</h3>

          <ol class="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            ${STEPS.map((step, index) => `
              <li>
                <span class="grad-text font-semibold mr-2">
                  ${index + 1}
                </span>
                ${escapeText(step)}
              </li>
            `).join('')}
          </ol>

          <p class="text-xs mu mt-4">
            Each strategy is configured for 1,000 simulated daily bars,
            3 bps fees and 2 bps slippage. Sharpe is annualised assuming
            252 bars per year. Actual results depend on the backend's
            implementation and data. Simulated performance does not
            predict live results.
          </p>
        </div>
      </div>

      <div id="status" class="text-sm mu" aria-live="polite"></div>

      <div id="grid" class="grid sm:grid-cols-2 xl:grid-cols-4 gap-3"></div>
    </div>
  `;

  const grid = $('#grid');
  const status = $('#status');
  const rerunButton = $('#rerun');

  const isCurrentRun = id => mounted && id === runId;

  function renderLoading(currentStrategies) {
    grid.innerHTML = currentStrategies.map(strategy => `
      <article class="glass p-4 flex flex-col">
        <h3 class="font-medium">${escapeText(strategy.name)}</h3>

        <p class="text-xs mu mt-1 flex-1">
          ${escapeText(strategy.description)}
        </p>

        <div class="mt-3 text-center mu text-sm py-8">
          <span class="spin"></span>
          <span class="ml-2">Running backtest...</span>
        </div>
      </article>
    `).join('');
  }

  async function runBacktests() {
    if (!mounted || running) return;

    running = true;
    const currentRun = ++runId;
    const currentSeed = seed;

    rerunButton.disabled = true;
    rerunButton.textContent = 'Running...';

    status.textContent = 'Running strategy backtests...';

    renderLoading(strategies);

    try {
      const results = await Promise.all(
        strategies.map(async strategy => {
          try {
            const result = await api('/backtest', {
              method: 'POST',
              body: {
                strategy: strategy.id,
                symbol: BACKTEST_CONFIG.symbol,
                bars: BACKTEST_CONFIG.bars,
                seed: currentSeed
              }
            });

            return {
              strategy,
              result,
              error: null
            };
          } catch (error) {
            return {
              strategy,
              result: null,
              error
            };
          }
        })
      );

      if (!isCurrentRun(currentRun)) return;

      grid.innerHTML = results.map(({ strategy, result, error }, index) => {
        const chartId = `strategy-chart-${currentRun}-${index}`;

        if (error || !isObject(result)) {
          return `
            <article class="glass p-4 flex flex-col">
              <h3 class="font-medium">${escapeText(strategy.name)}</h3>

              <p class="text-xs mu mt-1 flex-1">
                ${escapeText(strategy.description)}
              </p>

              <p class="dn text-xs mt-4">
                ${escapeText(
                  error?.message || 'Invalid backtest response.'
                )}
              </p>

              <button type="button"
                class="btn btn-sm mt-3"
                data-retry="${index}">
                Retry backtest
              </button>
            </article>
          `;
        }

        return `
          <article class="glass p-4 flex flex-col">
            ${renderCard(strategy, result, chartId)}
          </article>
        `;
      }).join('');

      // Draw charts only after all card containers exist.
      results.forEach(({ result }, index) => {
        if (!isCurrentRun(currentRun) || !isObject(result)) return;

        const chartId = `strategy-chart-${currentRun}-${index}`;
        const chartHost = $('#' + chartId);

        if (!chartHost) return;

        const equityCurve = Array.isArray(result.equity_curve)
          ? result.equity_curve
              .map(numberOrNull)
              .filter(value => value !== null)
          : [];

        if (!equityCurve.length) {
          chartHost.innerHTML = `
            <p class="mu text-xs pt-5">No equity curve available.</p>
          `;
          return;
        }

        const roi = numberOrNull(result.roi_pct);

        lineChart(chartHost, {
          series: [{
            data: equityCurve,
            color: roi !== null && roi >= 0
              ? '#2ee59d'
              : '#ff5b6e',
            fill: true,
            width: 1.5
          }],
          yfmt: value => fmt(value, 2)
        });
      });

      const failed = results.filter(item => item.error).length;

      status.textContent = failed
        ? `${results.length - failed} of ${results.length} strategies completed. Some backtests failed.`
        : `All ${results.length} strategy backtests completed.`;

      // Retry only the failed strategy, using the same seed.
      $$('[data-retry]').forEach(button => {
        button.onclick = async () => {
          const index = Number(button.dataset.retry);
          const item = results[index];

          if (!item || !isCurrentRun(currentRun)) return;

          button.disabled = true;
          button.textContent = 'Retrying...';

          try {
            const result = await api('/backtest', {
              method: 'POST',
              body: {
                strategy: item.strategy.id,
                symbol: BACKTEST_CONFIG.symbol,
                bars: BACKTEST_CONFIG.bars,
                seed: currentSeed
              }
            });

            if (!isCurrentRun(currentRun) || !isObject(result)) return;

            const card = button.closest('article');
            if (!card) return;

            const chartId = `strategy-chart-${currentRun}-retry-${index}`;
            card.innerHTML = renderCard(item.strategy, result, chartId);

            const chartHost = $('#' + chartId);
            const curve = Array.isArray(result.equity_curve)
              ? result.equity_curve
                  .map(numberOrNull)
                  .filter(value => value !== null)
              : [];

            if (chartHost && curve.length) {
              const roi = numberOrNull(result.roi_pct);

              lineChart(chartHost, {
                series: [{
                  data: curve,
                  color: roi !== null && roi >= 0
                    ? '#2ee59d'
                    : '#ff5b6e',
                  fill: true,
                  width: 1.5
                }],
                yfmt: value => fmt(value, 2)
              });
            }
          } catch (error) {
            if (!isCurrentRun(currentRun)) return;

            button.disabled = false;
            button.textContent = 'Retry backtest';

            status.textContent =
              error?.message || 'Retry failed.';
          }
        };
      });
    } catch (error) {
      if (!isCurrentRun(currentRun)) return;

      status.textContent =
        error?.message || 'Unable to run strategy backtests.';
    } finally {
      if (isCurrentRun(currentRun)) {
        running = false;
        rerunButton.disabled = false;
        rerunButton.textContent = '↻ Re-run with new data';
      }
    }
  }

  rerunButton.onclick = () => {
    if (running) return;

    seed = Math.floor(Math.random() * 1_000_000);
    runBacktests();
  };

  try {
    const response = await api('/strategies');

    if (!mounted) return;

    strategies = Array.isArray(response)
      ? response.filter(strategy =>
          isObject(strategy) &&
          strategy.id !== undefined &&
          strategy.id !== null &&
          String(strategy.id).length > 0
        )
      : [];

    if (!strategies.length) {
      status.textContent = 'No strategies are available.';
      grid.innerHTML = `
        <div class="glass p-4 text-sm mu">
          No strategies were returned by the server.
        </div>
      `;
      return () => {
        mounted = false;
        runId++;
      };
    }

    await runBacktests();
  } catch (error) {
    if (mounted) {
      status.textContent =
        error?.message || 'Unable to load strategies.';

      grid.innerHTML = `
        <div class="glass p-4">
          <p class="dn text-sm">
            ${escapeText(error?.message || 'Failed to load strategies.')}
          </p>
          <button id="load-retry" type="button" class="btn btn-sm mt-3">
            Retry
          </button>
        </div>
      `;

      $('#load-retry').onclick = async () => {
        if (!mounted) return;

        try {
          const response = await api('/strategies');

          if (!mounted) return;

          strategies = Array.isArray(response)
            ? response.filter(strategy =>
                isObject(strategy) &&
                strategy.id !== undefined &&
                strategy.id !== null &&
                String(strategy.id).length > 0
              )
            : [];

          if (strategies.length) {
            await runBacktests();
          } else {
            status.textContent = 'No strategies are available.';
          }
        } catch (retryError) {
          if (mounted) {
            status.textContent =
              retryError?.message || 'Retry failed.';
          }
        }
      };
    }
  }

  // Call when navigating away from this page.
  return () => {
    mounted = false;
    runId++;
  };
}
