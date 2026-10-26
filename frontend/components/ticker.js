
import { get, on } from '../src/store.js';
import { fmt, pct, cls, esc } from '../src/utils.js';

let lastRender = 0;
let unsubscribe = null;
let started = false;
let refreshTimer = null;

function getTickerQuotes() {
  const quotes = get()?.quotes ?? {};

  return Object.values(quotes).filter(quote =>
    quote &&
    !quote.index &&
    !quote.crypto &&
    quote.symbol != null &&
    String(quote.symbol).trim() !== ''
  );
}

export function tickerHtml() {
  const quotes = getTickerQuotes();

  if (!quotes.length) {
    return '<div class="p-2 mu">Connecting to market feed…</div>';
  }

  const items = quotes.map(quote => {
    const symbol = esc(String(quote.symbol));
    const last = Number(quote.last);
    const change = Number(quote.change_pct);

    const priceText = Number.isFinite(last) ? fmt(last) : '—';
    const changeText = Number.isFinite(change) ? pct(change) : '—';
    const changeClass = Number.isFinite(change) ? cls(change) : '';

    return `
      <span class="inline-flex gap-1.5 px-4 whitespace-nowrap">
        <b>${symbol}</b>
        <span class="num">${priceText}</span>
        <span class="num ${esc(changeClass)}">${changeText}</span>
      </span>
    `;
  }).join('');

  // Duplicate the content to create a continuous marquee.
  return `
    <div class="ticker-track py-2">
      <div class="ticker-content">${items}${items}</div>
    </div>
    <style>
      .ticker-track {
        width: 100%;
        overflow: hidden;
      }

      .ticker-content {
        display: flex;
        width: max-content;
        animation: mq 60s linear infinite;
        will-change: transform;
      }

      .ticker-track:hover .ticker-content {
        animation-play-state: paused;
      }

      @keyframes mq {
        to {
          transform: translateX(-50%);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .ticker-content {
          animation: none;
          transform: none;
        }
      }
    </style>
  `;
}

function refreshTicker() {
  const now = Date.now();
  const element = document.getElementById('tick');

  if (!element || now - lastRender < 8000) return;

  lastRender = now;
  element.innerHTML = tickerHtml();
}

export function startTicker() {
  // Prevent duplicate store subscriptions.
  if (started) return;

  started = true;

  unsubscribe = on(() => {
    refreshTicker();
  });

  // Render immediately instead of waiting for a store update.
  const element = document.getElementById('tick');

  if (element) {
    element.innerHTML = tickerHtml();
    lastRender = Date.now();
  }

  // Optional cleanup if the ticker needs to be stopped.
  return stopTicker;
}

export function stopTicker() {
  if (typeof unsubscribe === 'function') {
    unsubscribe();
  }

  unsubscribe = null;
  started = false;

  if (refreshTimer !== null) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}
