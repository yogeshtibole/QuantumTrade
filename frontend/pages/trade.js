
import { get } from '../src/store.js';
import { api } from '../src/api.js';
import {
  $,
  $$,
  esc,
  fmt,
  inr,
  pct,
  cls,
  time,
  qs
} from '../src/utils.js';
import { CandleChart } from '../charts/candlestick.js';
import { bookHtml } from '../components/orderbook.js';
import { toast, card, table } from '../components/ui.js';
import {
  wsOn,
  wsSub,
  wsUnsub
} from '../hooks/useWebSocket.js';

const TYPES = [
  ['market', 'Market'],
  ['limit', 'Limit'],
  ['stop_loss', 'Stop Loss'],
  ['take_profit', 'Take Profit'],
  ['iceberg', 'Iceberg'],
  ['bracket', 'Bracket'],
  ['trailing_stop', 'Trailing Stop']
];

export default async function (el) {
  let sym = qs().symbol || 'RELIANCE';
  let side = 'buy';
  let type = 'market';
  let depth = null;
  let tape = [];
  let tab = 'open';

  const off = [];
  const syms = get().symbols.filter(s => !s.index);

  el.innerHTML = `
    <div class="pt-4 grid gap-3">
      <div class="glass p-3 flex flex-wrap items-center gap-4">
        <select id="sym" class="input !w-auto">
          ${syms.map(s => `
            <option value="${s.symbol}">
              ${s.symbol} - ${esc(s.name)}
            </option>
          `).join('')}
        </select>

        <div>
          <div id="px" class="text-2xl font-semibold num">-</div>
          <div id="chg" class="text-xs"></div>
        </div>

        <div class="text-xs mu hidden sm:block" id="hl"></div>

        <div
          class="ml-auto text-xs mu"
          id="lat"
          title="Order acknowledgement latency measured inside the C++ engine"
        ></div>
      </div>

      <div class="grid lg:grid-cols-12 gap-3">
        <section class="glass p-3 lg:col-span-8">
          <div
            class="flex flex-wrap items-center gap-1 mb-2"
            id="ind"
          >
            ${[
              ['sma', 'SMA 20/50', 1],
              ['bb', 'Bollinger', 0],
              ['vwap', 'VWAP', 0],
              ['rsi', 'RSI', 1],
              ['macd', 'MACD', 0]
            ].map(([k, label, on]) => `
              <span
                class="chip ${on ? 'on' : ''}"
                data-k="${k}"
              >${label}</span>
            `).join('')}

            <span class="text-[11px] mu ml-auto">
              5s candles · wheel to zoom · drag to pan
            </span>
          </div>

          <div id="chart" style="height:440px"></div>

          <div
            id="read"
            class="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs mt-2"
          ></div>
        </section>

        <section class="glass p-3 lg:col-span-4">
          <h3 class="text-sm mu mb-2">Order Book</h3>
          <div id="book" style="min-height:360px"></div>
        </section>
      </div>

      <div class="grid lg:grid-cols-12 gap-3">
        <section class="glass p-4 lg:col-span-4">
          <div class="grid grid-cols-2 gap-2 mb-3">
            <button id="sb" class="btn btn-up justify-center">
              Buy
            </button>

            <button id="ss" class="btn justify-center">
              Sell
            </button>
          </div>

          <label class="lbl">Order type</label>

          <select id="type" class="input">
            ${TYPES.map(([key, label]) => `
              <option value="${key}">${label}</option>
            `).join('')}
          </select>

          <div id="fields"></div>

          <div class="text-xs mu mt-3" id="est"></div>

          <button
            id="go"
            class="btn w-full justify-center mt-3 btn-up"
          >Buy</button>

          <p id="msg" class="text-xs mt-2 min-h-[16px]"></p>
        </section>

        <section class="glass p-3 lg:col-span-3">
          <h3 class="text-sm mu mb-2">Time &amp; Sales</h3>

          <div
            id="tape"
            class="text-xs num"
            style="max-height:330px;overflow:auto"
          ></div>
        </section>

        <section class="glass p-3 lg:col-span-5">
          <div class="flex gap-1">
            <span class="chip on" data-tab="open">Open orders</span>
            <span class="chip" data-tab="hist">History</span>
            <span class="chip" data-tab="fills">Fills</span>
          </div>

          <div id="orders"></div>
        </section>
      </div>
    </div>
  `;

  const chart = new CandleChart($('#chart'), { rsi: true });

  off.push(() => chart.destroy());

  $('#sym').value = sym;

  const fieldsFor = () => {
    const f = (id, label, placeholder = '') => `
      <label class="lbl">${label}</label>
      <input
        id="${id}"
        class="input"
        type="number"
        step="any"
        min="0"
        placeholder="${placeholder}"
      >
    `;

    return (
      f('qty', 'Quantity', '10') +
      ({
        market: '',
        limit: f('price', 'Limit price'),
        stop_loss: f('stop', 'Stop (trigger) price'),
        take_profit: f('stop', 'Take-profit (trigger) price'),
        iceberg:
          f('price', 'Limit price') +
          f('display', 'Display quantity (visible slice)'),
        bracket:
          f('price', 'Entry price (blank = market)') +
          f('tp', 'Take-profit price') +
          f('sl', 'Stop-loss price'),
        trailing_stop: f('trail', 'Trail amount (₹)')
      }[type])
    );
  };

  const paintSide = () => {
    $('#sb').className =
      'btn justify-center ' + (side === 'buy' ? 'btn-up' : '');

    $('#ss').className =
      'btn justify-center ' + (side === 'sell' ? 'btn-dn' : '');

    const button = $('#go');

    button.textContent = (side === 'buy' ? 'Buy ' : 'Sell ') + sym;

    button.className =
      'btn w-full justify-center mt-3 ' +
      (side === 'buy' ? 'btn-up' : 'btn-dn');
  };

  const paintFields = () => {
    $('#fields').innerHTML = fieldsFor();

    $$('#fields input').forEach(input => {
      input.oninput = est;
    });

    est();
    paintSide();
  };

  const est = () => {
    const qty = +($('#qty')?.value || 0);
    const price =
      +($('#price')?.value || 0) ||
      (get().quotes[sym]?.last || 0);

    $('#est').textContent = qty
      ? `Est. value ${inr(qty * price)} · fee ≈ ${inr(qty * price * 0.0003)}`
      : '';
  };

  $('#sb').onclick = () => {
    side = 'buy';
    paintFields();
  };

  $('#ss').onclick = () => {
    side = 'sell';
    paintFields();
  };

  $('#type').onchange = event => {
    type = event.target.value;
    paintFields();
  };

  paintFields();

  $('#go').onclick = async () => {
    const v = id => {
      const input = $('#' + id);

      return input && input.value !== ''
        ? +input.value
        : undefined;
    };

    const order = {
      symbol: sym,
      side,
      type,
      qty: v('qty'),
      price: v('price'),
      stop: v('stop'),
      display: v('display'),
      tp: v('tp'),
      sl: v('sl'),
      trail: v('trail')
    };

    const button = $('#go');

    button.disabled = true;
    $('#msg').textContent = '';

    try {
      const result = await api('/orders', {
        method: 'POST',
        body: order
      });

      const message =
        result.status === 'filled'
          ? `Filled ${fmt(result.filled, 4)} @ ${fmt(result.avg_price)}`
          : result.status === 'pending_trigger'
            ? 'Order armed, waiting for trigger price'
            : result.status === 'open'
              ? 'Order placed on the book'
              : result.status;

      $('#msg').className = 'text-xs mt-2 up';
      $('#msg').textContent =
        '✓ ' + message +
        (result.reason ? ' (' + result.reason + ')' : '');

      toast(message, 'ok');
      loadOrders();
    } catch (error) {
      $('#msg').className = 'text-xs mt-2 dn';
      $('#msg').textContent = '✕ ' + error.message;

      toast(error.message, 'err');
    } finally {
      button.disabled = false;
    }
  };

  $$('#ind .chip').forEach(chip => {
    chip.onclick = () => {
      chip.classList.toggle('on');

      chart.set({
        [chip.dataset.k]: chip.classList.contains('on')
      });

      readouts();
    };
  });

  const readouts = () => {
    const latest = chart.latest();

    if (!latest) return;

    const cell = (label, value, colorClass = '') => `
      <div class="glass px-2 py-1.5">
        <div class="mu">${label}</div>
        <b class="num ${colorClass}">${value}</b>
      </div>
    `;

    $('#read').innerHTML =
      cell('VWAP', fmt(latest.vwap)) +
      cell(
        'RSI 14',
        fmt(latest.rsi, 1),
        latest.rsi > 70
          ? 'dn'
          : latest.rsi < 30
            ? 'up'
            : ''
      ) +
      cell(
        'MACD',
        fmt(latest.macd, 2) + ' / ' + fmt(latest.signal, 2),
        latest.hist >= 0 ? 'up' : 'dn'
      ) +
      cell(
        'Bollinger',
        fmt(latest.bbL, 1) + ' - ' + fmt(latest.bbU, 1)
      ) +
      cell(
        'SMA 20 / 50',
        fmt(latest.sma20, 1) + ' / ' + fmt(latest.sma50, 1)
      );
  };

  const head = () => {
    const quote = get().quotes[sym];

    if (!quote) return;

    $('#px').textContent = fmt(quote.last);
    $('#chg').className = 'text-xs ' + cls(quote.change_pct);
    $('#chg').textContent = pct(quote.change_pct || 0);

    if (quote.high) {
      $('#hl').textContent =
        `H ${fmt(quote.high)}  L ${fmt(quote.low)}`;
    }
  };

  const paintTape = () => {
    $('#tape').innerHTML =
      tape.slice(0, 40).map(trade => `
        <div class="flex justify-between py-0.5">
          <span class="${trade.side === 'buy' ? 'up' : 'dn'}">
            ${fmt(trade.price)}
          </span>

          <span>
            ${fmt(trade.qty, trade.qty < 10 ? 4 : 0)}
          </span>

          <span class="mu">${time(trade.ts)}</span>
        </div>
      `).join('') ||
      '<div class="mu">No trades yet</div>';
  };

  const loadOrders = async () => {
    try {
      let rows;
      let cols;

      if (tab === 'fills') {
        const fills = await api('/fills');

        cols = ['Time', 'Symbol', 'Side', 'Qty', 'Price', 'Fee'];

        rows = fills.slice(0, 30).map(fill => [
          time(fill.ts),
          fill.symbol,
          `<span class="${fill.side === 'buy' ? 'up' : 'dn'}">${fill.side}</span>`,
          fmt(fill.qty, 4),
          fmt(fill.price),
          fmt(fill.fee)
        ]);
      } else {
        const orders = await api('/orders');

        const live = status =>
          ['open', 'partial', 'pending_trigger'].includes(status);

        const list = orders
          .filter(order =>
            tab === 'open'
              ? live(order.status)
              : !live(order.status)
          )
          .slice(0, 30);

        cols = [
          '#',
          'Symbol',
          'Type',
          'Side',
          'Qty',
          'Price',
          'Status',
          ''
        ];

        rows = list.map(order => [
          order.id,
          order.symbol,
          order.type.replace('_', ' '),
          `<span class="${order.side === 'buy' ? 'up' : 'dn'}">${order.side}</span>`,
          `${fmt(order.filled, 2)}/${fmt(order.qty, 2)}`,
          fmt(order.price || order.stop || 0),
          `<span title="${esc(order.reason)}">${order.status.replace('_', ' ')}</span>`,
          live(order.status)
            ? `<button class="btn btn-sm" data-c="${order.id}">Cancel</button>`
            : ''
        ]);
      }

      $('#orders').innerHTML = table(
        cols,
        rows,
        tab === 'open' ? 'No open orders' : 'Nothing yet'
      );

      $$('#orders [data-c]').forEach(button => {
        button.onclick = async () => {
          try {
            await api('/orders/cancel', {
              method: 'POST',
              body: { id: +button.dataset.c }
            });

            toast('Order cancelled', 'ok');
            loadOrders();
          } catch (error) {
            toast(error.message, 'err');
          }
        };
      });
    } catch (error) {
      $('#orders').innerHTML =
        `<p class="dn text-sm p-3">${esc(error.message)}</p>`;
    }
  };

  $$('[data-tab]').forEach(chip => {
    chip.onclick = () => {
      $$('[data-tab]').forEach(item => {
        item.classList.toggle('on', item === chip);
      });

      tab = chip.dataset.tab;
      loadOrders();
    };
  });

  async function load() {
    $('#book').innerHTML = bookHtml(null);
    chart.setData([]);

    const [candles, book, trades] = await Promise.all([
      api('/candles?symbol=' + sym + '&limit=500'),
      api('/depth?symbol=' + sym + '&levels=12'),
      api('/trades?symbol=' + sym)
    ]);

    chart.setData(candles);

    depth = book;
    tape = trades;

    $('#book').innerHTML = bookHtml(book, 10);

    bindBook();
    paintTape();
    head();
    readouts();
    paintSide();
    est();
  }

  const bindBook = () => {
    $$('#book .ob-row[data-p]').forEach(row => {
      row.onclick = () => {
        if (type === 'market') {
          type = 'limit';
          $('#type').value = 'limit';
          paintFields();
        }

        const price = $('#price');

        if (price) {
          price.value = row.dataset.p;
          est();
        }
      };
    });
  };

  const topics = () => [
    'chart:' + sym,
    'depth:' + sym,
    'trades:' + sym
  ];

  $('#sym').onchange = async event => {
    wsUnsub(topics());

    sym = event.target.value;

    history.replaceState(
      null,
      '',
      '#/trade?symbol=' + sym
    );

    wsSub(topics());
    await load();
  };

  off.push(
    wsOn('candle', message => {
      if (message.s === sym) {
        chart.push(message.k);
        head();
      }
    }),

    wsOn('depth', message => {
      if (message.symbol === sym) {
        depth = message;
        $('#book').innerHTML = bookHtml(message, 10);
        bindBook();
      }
    }),

    wsOn('trade', message => {
      if (message.s === sym) {
        tape.unshift({
          price: message.p,
          qty: message.q,
          ts: message.ts,
          side: message.side
        });

        tape = tape.slice(0, 60);
        paintTape();
      }
    }),

    wsOn('order', () => loadOrders()),

    wsOn('fill', message => {
      toast(
        `Fill: ${message.side} ${fmt(message.qty, 4)} ${message.symbol} @ ${fmt(message.price)}`,
        'ok'
      );
    }),

    wsOn('ticks', () => head())
  );

  wsSub(topics());

  off.push(() => wsUnsub(topics()));

  const health = async () => {
    try {
      const status = await api('/health');

      $('#lat').textContent =
        `Engine ack ${fmt(status.order_ack_latency.avg_us, 1)} µs avg · ` +
        `p99 ${fmt(status.order_ack_latency.p99_us, 0)} µs · ` +
        `${status.trades} trades`;
    } catch {
      // Ignore temporary health endpoint failures.
    }
  };

  health();

  const healthInterval = setInterval(health, 5000);
  off.push(() => clearInterval(healthInterval));

  const readoutInterval = setInterval(readouts, 2000);
  off.push(() => clearInterval(readoutInterval));

  await load();
  loadOrders();

  return () => off.forEach(cleanup => cleanup());
}
