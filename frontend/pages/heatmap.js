
import { get } from '../src/store.js';
import { api } from '../src/api.js';
import { $, $$, throttle } from '../src/utils.js';
import { treemap, heatColor } from '../charts/treemap.js';

const SECTORS = [
  'Banking',
  'IT',
  'Pharma',
  'Energy',
  'FMCG',
  'Auto',
  'Metal',
  'Realty',
  'Crypto'
];

export default async function (el) {
  let sector = 'All';
  let list = [];
  let destroyed = false;
  let resizeHandler = null;
  let resizeScheduled = false;

  const off = [];

  el.innerHTML = `
    <div class="pt-4 grid gap-3">
      <div class="flex flex-wrap items-center gap-3">
        <h2 class="text-xl">Market Heat Map</h2>
        <span class="text-xs mu">
          Tile size = market cap · colour = % change today · click a tile to trade
        </span>
      </div>

      <div id="heatmap-error" class="dn text-sm" role="status"></div>

      <div id="chips" class="flex flex-wrap gap-2">
        <button type="button" class="chip on" data-s="All">All sectors</button>
        ${SECTORS.map(s => `
          <button type="button" class="chip" data-s="${s}">${s}</button>
        `).join('')}
      </div>

      <div class="glass p-2">
        <div id="hm" style="height:min(70vh,640px);min-height:380px"></div>
      </div>

      <div class="flex flex-wrap items-center gap-1 text-xs mu justify-center">
        ${[-3, -2, -1, 0, 1, 2, 3].map(value => `
          <span
            style="background:${heatColor(value)};padding:4px 12px;border-radius:4px;color:#fff"
          >${value > 0 ? '+' : ''}${value}%</span>
        `).join('')}
      </div>
    </div>
  `;

  const $el = selector => el.querySelector(selector);
  const heatmapHost = $el('#hm');
  const errorHost = $el('#heatmap-error');
  const chips = [...el.querySelectorAll('[data-s]')];

  function showError(message = '') {
    errorHost.textContent = message;
    errorHost.classList.toggle('hidden', !message);
  }

  function paint() {
    if (destroyed) return;

    try {
      const quotes = get()?.quotes || {};

      const items = list
        .filter(item => {
          if (!item || typeof item.symbol !== 'string') return false;
          return sector === 'All' || item.sector === sector;
        })
        .map(item => {
          const quote = quotes[item.symbol] || {};

          return {
            ...item,
            last: quote.last ?? item.last,
            change_pct: quote.change_pct ?? item.change_pct
          };
        });

      heatmapHost.innerHTML = '';

      if (!items.length) {
        heatmapHost.innerHTML = `
          <div class="mu text-sm p-4">
            No market data available for this sector.
          </div>
        `;
        showError('');
        return;
      }

      treemap(
        heatmapHost,
        items,
        symbol => {
          if (destroyed || !symbol) return;

          location.hash = '#/trade?symbol=' + encodeURIComponent(symbol);
        },
        sector === 'All'
      );

      showError('');
    } catch (error) {
      showError(error?.message || 'Unable to render the market heat map.');
    }
  }

  function selectSector(nextSector) {
    if (destroyed || !['All', ...SECTORS].includes(nextSector)) return;

    sector = nextSector;

    chips.forEach(chip => {
      const selected = chip.dataset.s === sector;

      chip.classList.toggle('on', selected);
      chip.setAttribute('aria-pressed', String(selected));
    });

    paint();
  }

  chips.forEach(chip => {
    chip.setAttribute('aria-pressed', String(chip.dataset.s === sector));
    chip.onclick = () => selectSector(chip.dataset.s);
  });

  try {
    const result = await api('/heatmap');

    if (destroyed) return () => {};

    list = Array.isArray(result) ? result : [];

    if (!list.length) {
      showError('The server returned no heat-map data.');
    }

    paint();
  } catch (error) {
    if (!destroyed) {
      showError(error?.message || 'Unable to load market heat-map data.');
      heatmapHost.innerHTML = `
        <div class="mu text-sm p-4">
          Check your connection and try opening the page again.
        </div>
      `;
    }
  }

  if (destroyed) return () => {};

  const intervalId = setInterval(paint, 1500);

  resizeHandler = throttle(() => {
    if (destroyed) return;
    paint();
  }, 200);

  addEventListener('resize', resizeHandler);

  off.push(() => clearInterval(intervalId));
  off.push(() => removeEventListener('resize', resizeHandler));

  return () => {
    if (destroyed) return;

    destroyed = true;

    off.forEach(cleanup => {
      try {
        cleanup();
      } catch {
        // Continue cleaning up remaining listeners.
      }
    });
  };
}
