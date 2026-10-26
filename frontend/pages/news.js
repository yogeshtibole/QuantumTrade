
import { get } from '../src/store.js';
import { api } from '../src/api.js';
import { $, esc, time } from '../src/utils.js';
import { wsOn, wsSub, wsUnsub } from '../hooks/useWebSocket.js';

const TABS = [
  ['market', 'Breaking news'],
  ['company', 'Company news'],
  ['rbi', 'RBI announcements'],
  ['fed', 'US Fed events'],
  ['ipo', 'IPO calendar'],
  ['earnings', 'Earnings calendar'],
  ['watch', 'Watchlist alerts']
];

const MAX_NEWS_ITEMS = 200;

export default async function (el) {
  let tab = 'market';
  let news = [];
  let cal = [];
  let watch = [];
  let destroyed = false;

  const off = [];

  el.innerHTML = `
    <div class="pt-4 grid gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <h2 class="text-xl">News &amp; Economic Calendar</h2>
        <span class="chip">Demo data</span>
      </div>

      <div id="tabs" class="flex flex-wrap gap-2"></div>
      <div id="news-error" class="dn text-sm" role="status"></div>
      <div id="body" class="grid gap-2"></div>
    </div>
  `;

  const $el = selector => el.querySelector(selector);
  const body = $el('#body');
  const tabsHost = $el('#tabs');
  const errorHost = $el('#news-error');

  function showError(message = '') {
    errorHost.textContent = message;
    errorHost.classList.toggle('hidden', !message);
  }

  function sentiment(value) {
    const score = Number(value);

    if (!Number.isFinite(score)) {
      return '<span class="mu text-xs">● Neutral</span>';
    }

    if (score > 0.25) {
      return '<span class="up text-xs">● Positive</span>';
    }

    if (score < -0.25) {
      return '<span class="dn text-xs">● Negative</span>';
    }

    return '<span class="mu text-xs">● Neutral</span>';
  }

  function formatTime(timestamp) {
    if (timestamp == null || timestamp === '') return '—';

    try {
      const result = time(timestamp);
      return result == null ? '—' : String(result);
    } catch {
      return '—';
    }
  }

  function formatMonth(dateString) {
    if (!dateString) return '—';

    const date = new Date(dateString);

    if (Number.isNaN(date.getTime())) return '—';

    return date.toLocaleString('en-IN', { month: 'short' });
  }

  function formatDay(dateString) {
    if (!dateString) return '—';

    const match = String(dateString).match(/^\d{4}-\d{2}-(\d{2})/);

    if (match) return match[1];

    const date = new Date(dateString);

    if (Number.isNaN(date.getTime())) return '—';

    return String(date.getDate()).padStart(2, '0');
  }

  function validSymbol(symbol) {
    return typeof symbol === 'string' && symbol.trim().length > 0;
  }

  function renderNews(item) {
    const symbol = validSymbol(item.symbol)
      ? item.symbol.trim()
      : '';

    return `
      <article class="glass p-3 flex gap-3 items-start">
        <div class="text-xs mu w-14 shrink-0 num">
          ${esc(formatTime(item.ts))}
        </div>

        <div class="flex-1 min-w-0">
          <div class="text-sm">${esc(item.headline || 'Untitled headline')}</div>

          <div class="text-xs mu mt-1">
            ${esc(item.source || 'Unknown source')}
            ${symbol
              ? ` · <a class="underline" href="#/trade?symbol=${encodeURIComponent(symbol)}">${esc(symbol)}</a>`
              : ''}
          </div>
        </div>

        ${sentiment(item.sentiment)}
      </article>
    `;
  }

  function renderEvent(event) {
    return `
      <article class="glass p-3 flex gap-3 items-start">
        <div class="text-center w-16 shrink-0">
          <div class="grad-text text-lg font-semibold">
            ${esc(formatDay(event.date))}
          </div>

          <div class="text-[11px] mu">
            ${esc(formatMonth(event.date))}
          </div>
        </div>

        <div class="flex-1 min-w-0">
          <b class="text-sm">${esc(event.title || 'Untitled event')}</b>

          <div class="text-xs mu mt-0.5">
            ${esc(event.detail || '')}
          </div>
        </div>

        <span class="chip !mb-0 !mr-0 text-[11px]">sample</span>
      </article>
    `;
  }

  function renderAlerts() {
    const state = get() || {};
    const user = state.user;

    if (!user) {
      return `
        <div class="glass p-5 text-sm">
          Log in to see alerts for your watchlist.
          <a class="underline" href="#/login">Log in</a>
        </div>
      `;
    }

    const alerts = Array.isArray(state.alerts) ? state.alerts : [];
    const watchedSymbols = new Set(watch);

    const alertHtml = alerts
      .filter(alert => alert && typeof alert === 'object')
      .map(alert => `
        <article class="glass p-3 text-sm flex gap-3 items-start">
          <span class="mu text-xs num shrink-0">
            ${esc(formatTime(alert.ts))}
          </span>

          <span class="min-w-0">
            🔔 ${esc(alert.message || 'Price alert')}
          </span>
        </article>
      `)
      .join('');

    const matchingNews = news
      .filter(item => watchedSymbols.has(item.symbol))
      .map(renderNews)
      .join('');

    if (!alertHtml && !matchingNews) {
      return `
        <p class="mu text-sm">
          Nothing yet. Add symbols to your watchlist on the Dashboard.
          Matching headlines and price alerts can appear here.
        </p>
      `;
    }

    return alertHtml + matchingNews;
  }

  function paintTabs() {
    tabsHost.innerHTML = TABS.map(([key, label]) => `
      <button
        type="button"
        class="chip ${key === tab ? 'on' : ''}"
        data-t="${key}"
        aria-pressed="${key === tab}"
      >${label}</button>
    `).join('');
  }

  function paintBody() {
    if (destroyed) return;

    if (tab === 'market') {
      body.innerHTML = news
        .filter(item => item.category === 'market')
        .map(renderNews)
        .join('') || '<p class="mu">No breaking headlines yet.</p>';

      return;
    }

    if (tab === 'company') {
      body.innerHTML = news
        .filter(item => item.category === 'company')
        .map(renderNews)
        .join('') || '<p class="mu">No company headlines yet.</p>';

      return;
    }

    if (tab === 'watch') {
      body.innerHTML = renderAlerts();
      return;
    }

    body.innerHTML = cal
      .filter(event => event.kind === tab)
      .map(renderEvent)
      .join('') || '<p class="mu">No events available in this calendar.</p>';
  }

  function paint() {
    if (destroyed) return;

    paintTabs();
    paintBody();
  }

  // One delegated click handler avoids rebinding every tab after each render.
  tabsHost.addEventListener('click', event => {
    const button = event.target.closest('[data-t]');

    if (!button || !tabsHost.contains(button) || destroyed) return;

    const nextTab = button.dataset.t;

    if (!TABS.some(([key]) => key === nextTab)) return;

    tab = nextTab;
    paint();
  });

  // Fetch independently so one failed endpoint doesn't discard the other.
  const [newsResult, calendarResult] = await Promise.allSettled([
    api('/news'),
    api('/calendar')
  ]);

  if (destroyed) return () => {};

  const errors = [];

  if (newsResult.status === 'fulfilled') {
    news = Array.isArray(newsResult.value) ? newsResult.value : [];
  } else {
    errors.push('News could not be loaded.');
  }

  if (calendarResult.status === 'fulfilled') {
    cal = Array.isArray(calendarResult.value) ? calendarResult.value : [];
  } else {
    errors.push('The economic calendar could not be loaded.');
  }

  if (get()?.user) {
    try {
      const result = await api('/watchlist');

      if (!destroyed) {
        watch = Array.isArray(result?.symbols)
          ? result.symbols
              .map(item => item?.symbol)
              .filter(validSymbol)
          : [];
      }
    } catch {
      // News and calendar remain usable if watchlist loading fails.
    }
  }

  if (destroyed) return () => {};

  showError(errors.join(' '));
  paint();

  // Subscribe to live news updates.
  wsSub(['news']);

  const unsubscribeNews = wsOn('news', message => {
    if (destroyed || !message || typeof message.headline !== 'string') {
      return;
    }

    const symbol = validSymbol(message.symbol) ? message.symbol : '';

    news.unshift({
      ts: message.ts,
      headline: message.headline,
      symbol,
      sentiment: message.sentiment,
      category: symbol ? 'company' : 'market',
      source: 'QT Demo Wire'
    });

    if (news.length > MAX_NEWS_ITEMS) {
      news.length = MAX_NEWS_ITEMS;
    }

    paintBody();
  });

  const unsubscribeAlert = wsOn('alert', () => {
    if (!destroyed && tab === 'watch') {
      paintBody();
    }
  });

  if (typeof unsubscribeNews === 'function') off.push(unsubscribeNews);
  if (typeof unsubscribeAlert === 'function') off.push(unsubscribeAlert);

  off.push(() => wsUnsub(['news']));

  return () => {
    if (destroyed) return;

    destroyed = true;

    off.forEach(cleanup => {
      try {
        cleanup();
      } catch {
        // Continue cleaning up remaining subscriptions.
      }
    });
  };
}
