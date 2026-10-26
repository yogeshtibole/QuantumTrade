
// Portfolio: holdings, P&L, unrealized gains, dividend history, allocation,
// risk score, tax report, PDF export, and wallet.

import { api } from '../src/api.js';
import { get } from '../src/store.js';
import { $, esc, fmt, inr, pct, cls, dateTime, time } from '../src/utils.js';
import { donut } from '../charts/donut.js';
import { lineChart } from '../charts/line.js';
import { stat, table, toast, card } from '../components/ui.js';

const TABS = [
  ['holdings', 'Holdings'],
  ['pnl', 'Profit & Loss'],
  ['div', 'Dividends'],
  ['alloc', 'Allocation & Risk'],
  ['tax', 'Tax report'],
  ['wallet', 'Wallet']
];

const money = value => inr(Number.isFinite(Number(value)) ? Number(value) : 0);
const number = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const safeArray = value => Array.isArray(value) ? value : {};

export default async function (el) {
  const off = [];
  let tab = 'holdings';
  let P = null;
  let destroyed = false;
  let busy = false;
  let timer = null;
  let previousTitle = document.title;

  el.innerHTML = `
    <div class="pt-4 grid gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <h2 class="text-xl">Portfolio</h2>
        <div class="ml-auto flex gap-2 no-print">
          <button id="pdf" class="btn btn-sm" type="button">⬇ Export PDF</button>
        </div>
      </div>
      <div id="top" class="grid grid-cols-2 lg:grid-cols-4 gap-3"></div>
      <div class="no-print" id="tabs"></div>
      <div id="body"></div>
    </div>
  `;

  const $el = selector => el.querySelector(selector);
  const bodyHost = $el('#body');
  const topHost = $el('#top');
  const tabsHost = $el('#tabs');

  function renderTop() {
    if (!P || destroyed) return;

    const equity = number(P.equity);
    const invested = number(P.invested);
    const unrealized = number(P.unrealized);
    const realized = number(P.realized);
    const fees = number(P.fees);
    const riskScore = Math.max(0, Math.min(100, number(P.risk_score)));

    topHost.innerHTML =
      stat('Total equity', money(equity), '', '') +
      stat(
        'Unrealized gains',
        money(unrealized),
        pct(invested ? unrealized / invested * 100 : 0),
        cls(unrealized)
      ) +
      stat(
        'Realized P&L (net of fees)',
        money(realized),
        'Fees paid ' + money(fees),
        cls(realized)
      ) +
      stat(
        'Risk score',
        fmt(riskScore, 0) + ' / 100',
        `${P.risk_label || 'Unrated'} risk`
      );
  }

  async function refreshPortfolio() {
    const data = await api('/portfolio');
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid portfolio response.');
    }
    P = data;
    renderTop();
    return P;
  }

  function renderTabs() {
    tabsHost.innerHTML = TABS.map(([key, label]) => `
      <button
        type="button"
        class="chip ${key === tab ? 'on' : ''}"
        data-t="${key}"
        aria-pressed="${key === tab}"
      >${label}</button>
    `).join('');
  }

  function renderHoldings() {
    const positions = safeArray(P.positions);

    return card(
      'Holdings',
      table(
        [
          'Symbol', 'Sector', 'Qty', 'Avg cost', 'LTP',
          'Value', 'P&L', 'P&L %', 'Day P&L'
        ],
        positions.map(p => {
          const symbol = String(p.symbol || '');
          const qty = number(p.qty);
          const pnl = number(p.pnl);
          const pnlPct = number(p.pnl_pct);
          const dayPnl = number(p.day_pnl);

          return [
            `<a class="underline" href="#/trade?symbol=${encodeURIComponent(symbol)}">${esc(symbol)}</a>`,
            esc(p.sector || '—'),
            fmt(qty, qty % 1 ? 4 : 0),
            fmt(number(p.avg)),
            fmt(number(p.last)),
            fmt(number(p.value)),
            `<span class="${cls(pnl)}">${fmt(pnl)}</span>`,
            `<span class="${cls(pnlPct)}">${pct(pnlPct)}</span>`,
            `<span class="${cls(dayPnl)}">${fmt(dayPnl)}</span>`
          ];
        }),
        'No holdings yet. Buy something on the Trade page.'
      )
    );
  }

  async function renderPnl() {
    const curve = await api('/portfolio/equity');
    if (destroyed || tab !== 'pnl') return;

    const rows = Array.isArray(curve) ? curve : [];

    bodyHost.innerHTML = `
      <div class="grid md:grid-cols-3 gap-3">
        ${stat(
          'Total P&L since start',
          money(P.total_pnl),
          pct(P.start_cash ? number(P.total_pnl) / number(P.start_cash) * 100 : 0),
          cls(number(P.total_pnl))
        )}
        ${stat('Day P&L', money(P.day_pnl), '', cls(number(P.day_pnl)))}
        ${stat('Invested capital', money(P.invested))}
      </div>
      ${card('Equity curve', '<div id="ec" style="height:260px"></div>', 'mt-3')}
    `;

    const chartHost = $el('#ec');
    if (!chartHost || !rows.length) {
      if (chartHost) {
        chartHost.innerHTML = '<p class="mu text-sm p-3">No equity history available yet.</p>';
      }
      return;
    }

    lineChart(chartHost, {
      series: [{
        data: rows.map(row => number(row?.[1])),
        color: '#d46bd6',
        fill: true
      }],
      labels: rows.map(row => {
        const date = new Date(row?.[0]);
        return Number.isNaN(date.getTime())
          ? ''
          : date.toLocaleTimeString('en-IN', { hour12: false });
      }),
      yfmt: value => '₹' + fmt(value, 0)
    });
  }

  async function renderDividends() {
    const data = await api('/portfolio/dividends');
    if (destroyed || tab !== 'div') return;

    const rows = Array.isArray(data?.rows) ? data.rows.slice() : [];
    rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

    bodyHost.innerHTML = card(
      'Dividend history (illustrative)',
      `
        <div class="text-sm mb-3">
          Trailing 12-month income:
          <b class="up">${money(data?.total_12m)}</b>
        </div>
        ${table(
          ['Date', 'Symbol', 'Per share', 'Amount'],
          rows.map(row => [
            esc(row.date || '—'),
            esc(row.symbol || '—'),
            fmt(number(row.dps)),
            `<span class="up">${money(row.amount)}</span>`
          ]),
          'Hold dividend-paying stocks to see history'
        )}
        <p class="text-xs mu mt-2">${esc(data?.note || 'Illustrative data; verify against official statements.')}</p>
      `
    );
  }

  function renderAllocation() {
    const allocation = safeArray(P.allocation)
      .filter(item => number(item.value) > 0)
      .map(item => ({
        label: String(item.sector || 'Other'),
        value: number(item.value)
      }));

    const riskScore = Math.max(0, Math.min(100, number(P.risk_score)));
    const limits = P.risk_limits || {};

    bodyHost.innerHTML = `
      <div class="grid md:grid-cols-2 gap-3">
        ${card(
          'Asset allocation',
          donut(allocation, 190, 'Equity')
        )}
        ${card(
          'Risk score',
          `
            <div class="text-5xl font-semibold num ${
              riskScore < 30 ? 'up' : riskScore < 60 ? '' : 'dn'
            }">
              ${fmt(riskScore, 0)}
              <span class="text-lg mu"> / 100</span>
            </div>
            <div class="mt-1 text-sm">${esc(P.risk_label || 'Unrated')} risk</div>
            <div class="h-2 rounded-full mt-3 bg-white/10 overflow-hidden">
              <div style="width:${riskScore}%;height:100%;background:linear-gradient(90deg,#2ee59d,#f5c542,#ff5b6e)"></div>
            </div>
            <p class="mu text-xs mt-3">
              Blends position concentration (HHI), holding volatility and cash buffer.
              Platform limits: max order ${money(limits.max_order_notional)},
              max single position ${fmt(number(limits.max_position_pct), 2)}% of equity,
              price band ±${fmt(number(limits.price_band_pct), 2)}%.
            </p>
          `
        )}
      </div>
    `;
  }

  async function renderTax() {
    const data = await api('/portfolio/tax');
    if (destroyed || tab !== 'tax') return;

    const trades = Array.isArray(data?.trades) ? data.trades.slice().reverse() : [];
    const rate = number(data?.assumed_stcg_rate) * 100;

    bodyHost.innerHTML = card(
      'Tax report (illustrative)',
      `
        <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
          ${stat('Gross gains', money(data?.gross_gains), '', 'up')}
          ${stat('Gross losses', money(data?.gross_losses), '', 'dn')}
          ${stat('Net short-term gain', money(data?.net_stcg), '', cls(number(data?.net_stcg)))}
          ${stat('Estimated tax @ ' + fmt(rate, 2) + '%', money(data?.estimated_tax))}
        </div>
        ${table(
          ['Date', 'Symbol', 'Qty', 'Buy', 'Sell', 'P&L', 'Term'],
          trades.map(row => [
            dateTime(row.ts),
            esc(row.symbol || '—'),
            fmt(number(row.qty), 2),
            fmt(number(row.buy)),
            fmt(number(row.sell)),
            `<span class="${cls(number(row.pnl))}">${fmt(number(row.pnl))}</span>`,
            esc(row.term || '—')
          ]),
          'No realized trades yet'
        )}
        <p class="text-xs mu mt-2">${esc(data?.disclaimer || 'Illustrative estimate only; consult a qualified tax professional.')}</p>
      `
    );
  }

  async function renderWallet() {
    const transactions = await api('/wallet');
    if (destroyed || tab !== 'wallet') return;

    const rows = Array.isArray(transactions) ? transactions : [];

    bodyHost.innerHTML = `
      <div class="grid md:grid-cols-3 gap-3">
        <section class="glass p-4">
          <h3 class="text-sm mu mb-2">Add or withdraw funds</h3>
          <div class="text-2xl num mb-2">${money(P.cash)}</div>
          <label for="amt" class="text-xs mu block mb-1">Amount (₹)</label>
          <input id="amt" type="number" min="1" step="0.01" class="input" placeholder="Amount (₹)">
          <div class="flex gap-2 mt-3">
            <button class="btn btn-p flex-1 justify-center" data-w="deposit" type="button">Deposit</button>
            <button class="btn flex-1 justify-center" data-w="withdraw" type="button">Withdraw</button>
          </div>
          <p class="text-xs mu mt-2">Virtual funds. Withdrawals need KYC verification (Settings).</p>
        </section>
        <section class="glass p-4 md:col-span-2">
          <h3 class="text-sm mu mb-2">Transactions</h3>
          ${table(
            ['Time', 'Type', 'Amount', 'Balance'],
            rows.map(row => [
              dateTime(row.ts),
              esc(row.kind || '—'),
              `<span class="${cls(number(row.amount))}">${fmt(number(row.amount))}</span>`,
              fmt(number(row.balance))
            ]),
            'No transactions'
          )}
        </section>
      </div>
    `;
  }

  async function renderBody() {
    if (destroyed || busy) return;
    busy = true;
    bodyHost.innerHTML = '<div class="py-10 text-center"><span class="spin"></span></div>';

    try {
      await refreshPortfolio();
      if (destroyed) return;

      if (tab === 'holdings') {
        bodyHost.innerHTML = renderHoldings();
      } else if (tab === 'pnl') {
        await renderPnl();
      } else if (tab === 'div') {
        await renderDividends();
      } else if (tab === 'alloc') {
        renderAllocation();
      } else if (tab === 'tax') {
        await renderTax();
      } else if (tab === 'wallet') {
        await renderWallet();
      }
    } catch (error) {
      if (!destroyed) {
        bodyHost.innerHTML = `
          <div class="glass p-4 dn text-sm">
            ${esc(error?.message || 'Unable to load portfolio data.')}
          </div>
        `;
      }
    } finally {
      busy = false;
    }
  }

  function onTabsClick(event) {
    const button = event.target.closest('[data-t]');
    if (!button || !tabsHost.contains(button)) return;

    const nextTab = button.dataset.t;
    if (!TABS.some(([key]) => key === nextTab) || nextTab === tab) return;

    tab = nextTab;
    renderTabs();
    renderBody();
  }

  async function onWalletClick(event) {
    const button = event.target.closest('[data-w]');
    if (!button || !bodyHost.contains(button) || busy) return;

    const amountInput = $el('#amt');
    const amount = Number(amountInput?.value);

    if (!Number.isFinite(amount) || amount <= 0) {
      toast('Enter a valid amount greater than zero.', 'err');
      amountInput?.focus();
      return;
    }

    button.disabled = true;

    try {
      await api('/wallet', {
        method: 'POST',
        body: { kind: button.dataset.w, amount }
      });

      toast('Transaction completed.', 'ok');
      await renderBody();
    } catch (error) {
      toast(error?.message || 'Wallet transaction failed.', 'err');
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  }

  function onPrint() {
    previousTitle = document.title;
    document.title = 'QuantumTrade Portfolio Report';
    window.addEventListener('afterprint', restoreTitle, { once: true });
    window.print();
  }

  function restoreTitle() {
    document.title = previousTitle;
  }

  tabsHost.addEventListener('click', onTabsClick);
  bodyHost.addEventListener('click', onWalletClick);
  $el('#pdf').addEventListener('click', onPrint);

  off.push(() => tabsHost.removeEventListener('click', onTabsClick));
  off.push(() => bodyHost.removeEventListener('click', onWalletClick));
  off.push(() => $el('#pdf')?.removeEventListener('click', onPrint));
  off.push(() => window.removeEventListener('afterprint', restoreTitle));

  renderTabs();
  await renderBody();

  timer = setInterval(async () => {
    if (destroyed || busy || !['holdings', 'pnl'].includes(tab)) return;

    try {
      await refreshPortfolio();
      if (tab === 'holdings') {
        bodyHost.innerHTML = renderHoldings();
      } else if (tab === 'pnl') {
        await renderPnl();
      }
    } catch {
      // Keep the currently rendered view if a background refresh fails.
    }
  }, 6000);

  off.push(() => clearInterval(timer));

  return () => {
    destroyed = true;
    off.forEach(cleanup => cleanup());
    restoreTitle();
  };
}
