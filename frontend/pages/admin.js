
 // Admin dashboard: users, KYC, freeze accounts, trade monitor,
// feed status, revenue, API usage, system logs, latency and trading halt.

import { api } from '../src/api.js';
import { get } from '../src/store.js';
import { $, $$, esc, fmt, inr, dateTime, time } from '../src/utils.js';
import { lineChart } from '../charts/line.js';
import { stat, toast, errBox } from '../components/ui.js';

const TABS = [
  ['overview', 'Overview'],
  ['users', 'User management'],
  ['kyc', 'Verify KYC'],
  ['trades', 'Monitor trades'],
  ['feed', 'Market feed status'],
  ['revenue', 'Revenue analytics'],
  ['api', 'API usage'],
  ['logs', 'System logs']
];

const isObject = value =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const asArray = value => Array.isArray(value) ? value : [];

const number = value => {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
};

const text = value => esc(String(value ?? ''));

const validId = value => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

const adminTable = (columns, rows, empty = 'Nothing here yet') => `
  <div class="scroll-x">
    <table class="t">
      <thead>
        <tr>${columns.map(column => `<th>${text(column)}</th>`).join('')}</tr>
      </thead>
      <tbody>
        ${rows.length
          ? rows.map(row => `
              <tr>${row.map(cell => `<td>${cell ?? ''}</td>`).join('')}</tr>
            `).join('')
          : `<tr>
              <td colspan="${columns.length}" class="mu"
                style="text-align:center;padding:20px">
                ${text(empty)}
              </td>
            </tr>`
        }
      </tbody>
    </table>
  </div>
`;

const latencyCard = (data, label) => {
  const latency = isObject(data) ? data : {};

  return `
    <div class="bg-white/5 rounded-lg p-3">
      <div class="text-xs mu">${text(label)}</div>
      <div class="num text-lg">${fmt(number(latency.avg_us), 1)} µs</div>
      <div class="text-[11px] mu">
        p50 ${fmt(number(latency.p50_us), 0)}
        · p99 ${fmt(number(latency.p99_us), 0)}
        · n=${fmt(number(latency.count), 0)}
      </div>
    </div>
  `;
};

const moneyChart = (host, points, includeLabels = false) => {
  if (!host) return;

  const data = asArray(points);

  lineChart(host, {
    series: [{
      data: data.map(point =>
        Array.isArray(point) ? number(point[1]) : 0
      ),
      color: '#2ee59d',
      fill: true
    }],
    ...(includeLabels
      ? {
          labels: data.map(point =>
            Array.isArray(point) ? time(point[0]) : ''
          )
        }
      : {}),
    yfmt: value => '₹' + fmt(number(value), 0)
  });
};

export default async function adminDashboard(el) {
  if (!el) return;

  if (get()?.user?.role !== 'admin') {
    el.innerHTML = `
      <div class="glass p-8 mt-8 text-center">
        <h2 class="text-xl">Admin access required</h2>
        <p class="mu text-sm mt-2">
          Log in with an administrator account.
        </p>
      </div>
    `;
    return;
  }

  let tab = 'overview';
  let refreshTimer = null;
  let requestId = 0;
  let mounted = true;
  let haltBusy = false;

  el.innerHTML = `
    <div class="pt-4 grid gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <h2 class="text-xl">Admin Dashboard</h2>
        <button id="halt" class="btn btn-sm ml-auto" type="button">
          Loading status...
        </button>
      </div>
      <div id="tabs" class="flex flex-wrap gap-2"></div>
      <div id="body"></div>
    </div>
  `;

  const stopRefresh = () => {
    if (refreshTimer !== null) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
  };

  const scheduleRefresh = (delay, expectedTab = tab) => {
    stopRefresh();

    refreshTimer = setTimeout(() => {
      refreshTimer = null;

      if (mounted && tab === expectedTab) {
        load();
      }
    }, delay);
  };

  const drawTabs = () => {
    const host = $('#tabs');
    if (!host) return;

    host.innerHTML = TABS.map(([key, label]) => `
      <button
        type="button"
        class="chip ${key === tab ? 'on' : ''}"
        data-t="${key}"
        aria-pressed="${key === tab}"
      >${text(label)}</button>
    `).join('');

    $$('[data-t]').forEach(button => {
      button.onclick = () => {
        if (button.dataset.t === tab) return;

        tab = button.dataset.t;
        stopRefresh();
        drawTabs();
        load();
      };
    });
  };

  const renderHaltButton = halted => {
    const button = $('#halt');
    if (!button) return;

    button.textContent = halted
      ? '▶ Resume trading'
      : '⏸ Halt all trading';

    button.className =
      'btn btn-sm ml-auto ' + (halted ? 'btn-up' : 'btn-dn');

    button.disabled = haltBusy;
    button.onclick = async () => {
      if (haltBusy) return;

      if (!halted && !window.confirm(
        'Halt ALL trading platform-wide?'
      )) {
        return;
      }

      haltBusy = true;
      button.disabled = true;

      try {
        await api('/admin/halt', {
          method: 'POST',
          body: { halted: !halted }
        });

        toast(
          halted ? 'Trading resumed' : 'Trading halted',
          'ok'
        );

        await load();
      } catch (error) {
        toast(error?.message || 'Could not update trading status', 'err');
      } finally {
        haltBusy = false;

        if (mounted) {
          const currentButton = $('#halt');
          if (currentButton) currentButton.disabled = false;
        }
      }
    };
  };

  async function load() {
    if (!mounted) return;

    stopRefresh();

    const currentRequest = ++requestId;
    const requestedTab = tab;
    const body = $('#body');

    if (!body) return;

    const isCurrent = () =>
      mounted &&
      currentRequest === requestId &&
      requestedTab === tab;

    try {
      const overview = await api('/admin/overview');

      if (!isCurrent()) return;

      const o = isObject(overview) ? overview : {};
      renderHaltButton(Boolean(o.halted));

      if (requestedTab === 'overview') {
        const [latencyResponse, revenueResponse] = await Promise.all([
          api('/admin/latency'),
          api('/admin/revenue')
        ]);

        if (!isCurrent()) return;

        const latency = isObject(latencyResponse) ? latencyResponse : {};
        const revenue = isObject(revenueResponse) ? revenueResponse : {};
        const risk = isObject(o.risk) ? o.risk : {};
        const revenuePoints = asArray(revenue.per_minute);

        body.innerHTML = `
          <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
            ${stat(
              'Total users',
              fmt(number(o.users), 0),
              `${fmt(number(o.verified_users), 0)} verified`
            )}
            ${stat(
              'KYC pending',
              fmt(number(o.kyc_pending), 0),
              `${fmt(number(o.frozen), 0)} frozen accounts`
            )}
            ${stat(
              'Trades matched',
              fmt(number(o.trades), 0),
              `${fmt(number(o.fills), 0)} fills recorded`
            )}
            ${stat(
              'Platform revenue',
              inr(number(o.platform_fees)),
              'Fee ' + (number(o.fee_rate) * 100).toFixed(3) +
                '% per side',
              'up'
            )}
          </div>

          <div class="grid lg:grid-cols-2 gap-3 mt-3">
            <section class="glass p-4">
              <h3 class="text-sm mu mb-2">Engine latency</h3>
              <div class="grid grid-cols-3 gap-2">
                ${latencyCard(latency.order_ack, 'Order ack')}
                ${latencyCard(latency.match, 'Match')}
                ${latencyCard(latency.http, 'HTTP')}
              </div>
              <p class="text-xs mu mt-2">
                Queue depth ${fmt(number(latency.queue_depth), 0)}
                · pool objects ${fmt(number(latency.pool_live), 0)}
                · orders ${fmt(number(latency.orders), 0)}
              </p>
            </section>

            <section class="glass p-4">
              <h3 class="text-sm mu mb-2">Revenue per minute</h3>
              <div id="rv" style="height:150px"></div>
            </section>
          </div>

          <section class="glass p-4 mt-3">
            <h3 class="text-sm mu mb-2">Risk manager</h3>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
              ${[
                ['Checks', fmt(number(risk.checks), 0)],
                ['Rejects', fmt(number(risk.rejects), 0)],
                ['Max order', inr(number(risk.max_order_notional))],
                ['Max position', fmt(number(risk.max_position_pct), 2) + '%'],
                ['Price band', '±' + fmt(number(risk.price_band_pct), 2) + '%'],
                ['Leverage', fmt(number(risk.leverage), 2) + 'x'],
                ['Rate limit', fmt(number(risk.max_orders_per_sec), 0) + '/s'],
                ['Open orders', fmt(number(risk.max_open_orders), 0)]
              ].map(([label, value]) => `
                <div class="bg-white/5 rounded-lg p-2">
                  <div class="text-xs mu">${text(label)}</div>
                  <b>${text(value)}</b>
                </div>
              `).join('')}
            </div>
          </section>
        `;

        moneyChart($('#rv'), revenuePoints);
        scheduleRefresh(5000, requestedTab);
      }

      else if (requestedTab === 'users' || requestedTab === 'kyc') {
        let users = asArray(await api('/admin/users'));

        if (!isCurrent()) return;

        if (requestedTab === 'kyc') {
          users = users.filter(user =>
            user.kyc &&
            !['none', 'verified', 'rejected'].includes(
              String(user.kyc).toLowerCase()
            )
          );
        }

        const columns = requestedTab === 'kyc'
          ? ['ID', 'Name', 'Email', 'KYC', 'Action']
          : ['ID', 'Name', 'Email', 'Role', 'Equity', 'KYC', 'Status', 'Action'];

        const rows = users.map(user => {
          const id = validId(user.id);
          const isAdmin = user.role === 'admin';
          const kyc = String(user.kyc || 'none');
          const kycClass = kyc.toLowerCase() === 'verified' ? 'on' : '';

          if (requestedTab === 'kyc') {
            const actions = isAdmin || !id
              ? '-'
              : `
                <button type="button" class="btn btn-sm"
                  data-k="verified" data-id="${id}">Verify</button>
                <button type="button" class="btn btn-sm"
                  data-k="rejected" data-id="${id}">Reject</button>
              `;

            return [
              text(user.id),
              text(user.name),
              text(user.email),
              `<span class="chip !mb-0 !mr-0 ${kycClass}">${text(kyc)}</span>`,
              actions
            ];
          }

          const frozen = Boolean(user.frozen);
          const status = frozen
            ? '<span class="dn">frozen</span>'
            : user.verified
              ? 'active'
              : 'unverified';

          const action = isAdmin || !id
            ? '-'
            : `
              <button type="button" class="btn btn-sm"
                data-f="${frozen ? 0 : 1}" data-id="${id}">
                ${frozen ? 'Unfreeze' : 'Freeze'}
              </button>
            `;

          return [
            text(user.id),
            text(user.name),
            text(user.email),
            text(user.role),
            text(inr(number(user.equity))),
            text(kyc),
            status,
            action
          ];
        });

        body.innerHTML = `
          <div class="glass p-3">
            ${adminTable(
              columns,
              rows,
              requestedTab === 'kyc'
                ? 'No KYC applications need review'
                : 'No users found'
            )}
          </div>
        `;

        $$('[data-k]').forEach(button => {
          button.onclick = async () => {
            const id = validId(button.dataset.id);
            const status = button.dataset.k;

            if (!id || !['verified', 'rejected'].includes(status)) {
              return;
            }

            button.disabled = true;

            try {
              await api('/admin/users/kyc', {
                method: 'POST',
                body: { id, status }
              });

              toast('KYC updated', 'ok');

              if (isCurrent()) await load();
            } catch (error) {
              toast(error?.message || 'Could not update KYC', 'err');
              button.disabled = false;
            }
          };
        });

        $$('[data-f]').forEach(button => {
          button.onclick = async () => {
            const id = validId(button.dataset.id);
            if (!id) return;

            const frozen = button.dataset.f === '1';

            if (frozen && !window.confirm(
              'Freeze this account? The user may lose access to trading.'
            )) {
              return;
            }

            button.disabled = true;

            try {
              await api('/admin/users/freeze', {
                method: 'POST',
                body: { id, frozen }
              });

              toast('Account updated', 'ok');

              if (isCurrent()) await load();
            } catch (error) {
              toast(error?.message || 'Could not update account', 'err');
              button.disabled = false;
            }
          };
        });
      }

      else if (requestedTab === 'trades') {
        const trades = asArray(await api('/admin/trades'));

        if (!isCurrent()) return;

        body.innerHTML = `
          <div class="glass p-3" style="max-height:70vh;overflow:auto">
            ${adminTable(
              ['Time', 'User', 'Symbol', 'Side', 'Qty', 'Price', 'Fee'],
              trades.map(trade => {
                const side = String(trade.side || '').toLowerCase();

                return [
                  text(time(trade.ts)),
                  text(trade.user),
                  text(trade.symbol),
                  `<span class="${side === 'buy' ? 'up' : 'dn'}">${text(side)}</span>`,
                  text(fmt(number(trade.qty), 3)),
                  text(fmt(number(trade.price))),
                  text(fmt(number(trade.fee)))
                ];
              }),
              'No trades yet'
            )}
          </div>
        `;

        scheduleRefresh(3000, requestedTab);
      }

      else if (requestedTab === 'feed') {
        const response = await api('/admin/feed');

        if (!isCurrent()) return;

        const feed = isObject(response) ? response : {};
        const age = number(feed.last_tick_age_ms);
        const healthy = Boolean(feed.running) && age >= 0 && age < 2000;

        body.innerHTML = `
          <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
            ${stat(
              'Feed status',
              healthy ? '● Healthy' : '● Stalled',
              'Source: ' + String(feed.source || 'Unknown'),
              healthy ? 'up' : 'dn'
            )}
            ${stat('Last tick age', fmt(age, 0) + ' ms')}
            ${stat(
              'Ticks total',
              fmt(number(feed.ticks_total), 0),
              fmt(number(feed.symbols), 0) + ' instruments'
            )}
            ${stat(
              'WebSocket clients',
              fmt(number(feed.ws_clients), 0),
              `${fmt(number(feed.ws_sent), 0)} msgs sent · ` +
                `${fmt(number(feed.ws_dropped), 0)} dropped`
            )}
          </div>

          <p class="text-xs mu mt-3">
            Uptime ${fmt(number(feed.uptime_s), 0)}s
            · candle interval ${fmt(number(feed.candle_ms) / 1000, 2)}s.
            The current simulator is not an exchange-connected live feed.
          </p>
        `;

        scheduleRefresh(2000, requestedTab);
      }

      else if (requestedTab === 'revenue') {
        const response = await api('/admin/revenue');

        if (!isCurrent()) return;

        const revenue = isObject(response) ? response : {};
        const points = asArray(revenue.per_minute);

        body.innerHTML = `
          <div class="grid sm:grid-cols-3 gap-3">
            ${stat('Total fee revenue', inr(number(revenue.total)), '', 'up')}
            ${stat(
              'Fee rate',
              (number(revenue.fee_rate) * 100).toFixed(3) + '% / side'
            )}
            ${stat('Minutes with trades', fmt(points.length, 0))}
          </div>

          <section class="glass p-4 mt-3">
            <h3 class="text-sm mu mb-2">Fees per minute</h3>
            <div id="rv" style="height:260px"></div>
          </section>
        `;

        moneyChart($('#rv'), points, true);
      }

      else if (requestedTab === 'api') {
        const response = await api('/admin/api-usage');

        if (!isCurrent()) return;

        const usage = isObject(response) ? response : {};
        const endpoints = asArray(usage.endpoints);
        const latency = isObject(usage.latency) ? usage.latency : {};
        const maxCount = Math.max(
          1,
          ...endpoints.map(endpoint => number(endpoint.count))
        );

        body.innerHTML = `
          <div class="grid sm:grid-cols-3 gap-3">
            ${stat('Total requests', fmt(number(usage.total_requests), 0))}
            ${stat('Active connections', fmt(number(usage.active_connections), 0))}
            ${stat(
              'HTTP latency avg',
              fmt(number(latency.avg_us) / 1000, 2) + ' ms',
              'p99 ' + fmt(number(latency.p99_us) / 1000, 1) + ' ms'
            )}
          </div>

          <section class="glass p-4 mt-3">
            <h3 class="text-sm mu mb-2">Top endpoints</h3>
            ${endpoints.length
              ? endpoints.map(endpoint => {
                  const count = Math.max(0, number(endpoint.count));
                  const width = Math.max(
                    0,
                    Math.min(100, count / maxCount * 100)
                  );

                  return `
                    <div class="flex items-center gap-2 text-xs py-1">
                      <span class="w-64 truncate">${text(endpoint.endpoint)}</span>
                      <div class="flex-1 h-2 bg-white/10 rounded">
                        <div style="width:${width}%;height:100%;
                          background:linear-gradient(90deg,#4a4cf0,#d46bd6);
                          border-radius:4px"></div>
                      </div>
                      <b class="num w-12 text-right">${fmt(count, 0)}</b>
                    </div>
                  `;
                }).join('')
              : '<p class="mu text-sm">No API usage data available.</p>'
            }
          </section>
        `;
      }

      else if (requestedTab === 'logs') {
        const logs = asArray(await api('/admin/logs'));

        if (!isCurrent()) return;

        body.innerHTML = `
          <div class="glass p-3 font-mono text-xs"
            style="max-height:70vh;overflow:auto">
            ${logs.length
              ? logs.slice().reverse().map(log => {
                  const level = String(log.level || 'INFO').toUpperCase();
                  const levelClass = level === 'ERROR'
                    ? 'dn'
                    : level === 'WARN'
                      ? 'text-yellow-400'
                      : 'up';

                  return `
                    <div class="py-0.5 border-b border-white/5">
                      <span class="mu">${text(dateTime(log.ts))}</span>
                      <b class="${levelClass}">${text(level)}</b>
                      ${text(log.msg)}
                    </div>
                  `;
                }).join('')
              : '<p class="mu">No system logs available.</p>'
            }
          </div>
        `;

        scheduleRefresh(4000, requestedTab);
      }
    } catch (error) {
      if (!isCurrent()) return;

      body.innerHTML = errBox(
        error?.message || 'Failed to load admin dashboard data.'
      );
    }
  }

  drawTabs();
  await load();

  // Call this cleanup when navigating away from the admin page.
  return () => {
    mounted = false;
    requestId++;
    stopRefresh();
  };
}
