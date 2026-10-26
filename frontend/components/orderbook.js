
import { fmt } from '../src/utils.js';

export function bookHtml(d, n = 10) {
  if (!d || !Array.isArray(d.asks) || !Array.isArray(d.bids)) {
    return '<div class="mu text-sm p-4">Loading order book…</div>';
  }

  const limit = Number.isFinite(Number(n))
    ? Math.max(0, Math.floor(Number(n)))
    : 10;

  const asks = d.asks
    .filter(level => level && Number.isFinite(Number(level.price)) &&
      Number.isFinite(Number(level.qty)) && Number(level.qty) >= 0)
    .slice(0, limit)
    .reverse();

  const bids = d.bids
    .filter(level => level && Number.isFinite(Number(level.price)) &&
      Number.isFinite(Number(level.qty)) && Number(level.qty) >= 0)
    .slice(0, limit);

  const quantities = [...asks, ...bids].map(level => Number(level.qty));
  const maxQty = Math.max(1, ...quantities);

  const safeNumber = value => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  };

  const formatQty = value => {
    const qty = safeNumber(value);
    return fmt(qty, qty < 10 ? 4 : 0);
  };

  const formatTotal = value => {
    const total = safeNumber(value);
    return fmt(total, total < 10 ? 3 : 0);
  };

  const row = (level, color) => {
    const price = safeNumber(level.price);
    const qty = safeNumber(level.qty);
    const total = safeNumber(level.total);
    const width = Math.max(0, Math.min(100, (qty / maxQty) * 100));

    return `
      <div class="ob-row num" data-p="${price}">
        <i style="width:${width}%;background:${color}"></i>
        <span style="color:${color}">${fmt(price)}</span>
        <span>${formatQty(qty)}</span>
        <span class="mu">${formatTotal(total)}</span>
      </div>
    `;
  };

  const spread = safeNumber(d.spread);
  const mid = safeNumber(d.mid);

  return `
    <div class="ob-row mu text-[11px]" style="cursor:default">
      <span>Price</span>
      <span>Quantity</span>
      <span>Total</span>
    </div>

    ${asks.map(level => row(level, '#ff5b6e')).join('')}

    <div class="flex justify-between px-2 py-1.5 my-1 text-xs border-y border-white/10 num">
      <span class="mu">Spread <b class="text-white">${fmt(spread)}</b></span>
      <span class="mu">Mid <b class="text-white">${fmt(mid)}</b></span>
    </div>

    ${bids.map(level => row(level, '#2ee59d')).join('')}
  `;
}
