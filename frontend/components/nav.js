
import { get, on, set, setSession } from '../src/store.js';
import { t, setUiLang } from '../src/i18n.js';
import { path } from '../src/router.js';
import { esc } from '../src/utils.js';
import { wsReconnect } from '../hooks/useWebSocket.js';
import { tickerHtml } from './ticker.js';

const LINKS = [
  ['/', 'home', '⌂'],
  ['/dashboard', 'dashboard', '▦'],
  ['/trade', 'trade', '⇅'],
  ['/portfolio', 'portfolio', '◔'],
  ['/ai', 'ai', '✦'],
  ['/heatmap', 'heatmap', '▩'],
  ['/news', 'news', '☰'],
  ['/algos', 'algos', 'ƒ'],
  ['/backtest', 'backtest', '↺']
];

const LANGUAGES = [
  ['en', 'EN'],
  ['hi', 'हिं'],
  ['mr', 'मरा']
];

function isActiveRoute(currentPath, linkPath) {
  const current = currentPath || '/';

  return current === linkPath ||
    (linkPath === '/' && current === '');
}

function getLinks(state) {
  const links = [...LINKS];

  if (state.user?.role === 'admin') {
    links.push(['/admin', 'admin', '⚙']);
  }

  return links;
}

function renderDesktopLinks(links, currentPath) {
  return links.map(([href, label]) => `
    <a
      href="#${href}"
      class="${isActiveRoute(currentPath, href) ? 'on' : ''}"
      ${isActiveRoute(currentPath, href) ? 'aria-current="page"' : ''}
    >${esc(t(label))}</a>
  `).join('');
}

function renderMobileLinks(links, currentPath) {
  // Keep the primary five links and heat map visible on mobile.
  const mobileLinks = [
    ...links.slice(0, 5),
    ...links.filter(link => link[0] === '/heatmap')
  ];

  return mobileLinks.map(([href, label, icon]) => {
    const active = isActiveRoute(currentPath, href);

    return `
      <a
        href="#${href}"
        class="${active ? 'on' : ''}"
        ${active ? 'aria-current="page"' : ''}
      >
        <b aria-hidden="true">${esc(icon)}</b>
        <span>${esc(t(label))}</span>
      </a>
    `;
  }).join('');
}

function renderLanguageOptions(selectedLanguage) {
  return LANGUAGES.map(([value, label]) => `
    <option
      value="${value}"
      ${selectedLanguage === value ? 'selected' : ''}
    >${esc(label)}</option>
  `).join('');
}

export function mountNav() {
  const el = document.getElementById('nav');

  if (!el) {
    console.warn('QuantumTrade: navigation element #nav was not found.');
    return;
  }

  let lastKey = '';
  let destroyed = false;

  const draw = () => {
    if (destroyed) return;

    const state = get();
    const currentPath = path() || '/';
    const links = getLinks(state);
    const user = state.user;

    const firstName = user?.name
      ? String(user.name).trim().split(/\s+/)[0]
      : '';

    const userControl = user
      ? `
        <a
          href="#/settings"
          class="btn btn-sm"
          title="${esc(user.email || '')}"
          aria-label="Open account settings"
        >${esc(firstName || 'Account')}</a>
        <button id="lo" type="button" class="btn btn-sm">
          ${esc(t('logout'))}
        </button>
      `
      : `
        <a href="#/login" class="btn">${esc(t('login'))}</a>
      `;

    const isLive = state.wsStatus === 'open';

    el.innerHTML = `
      <header class="sticky top-0 z-40 backdrop-blur-xl bg-[#04040ccc]">
        <div class="mx-auto max-w-[1400px] px-3 sm:px-5 py-3 flex items-center gap-3 justify-between">

          <a href="#/" class="flex items-center gap-2 no-underline"
             aria-label="QuantumTrade home">
            <img src="assets/logo.svg" class="w-8 h-8" alt="">
            <span class="text-lg font-semibold grad-text">QuantumTrade</span>
          </a>

          <nav class="pill-nav desk-nav" aria-label="Main navigation">
            ${renderDesktopLinks(links, currentPath)}
          </nav>

          <div class="flex items-center gap-2">
            <span
              title="${isLive ? 'Live feed connected' : 'Live feed disconnected'}"
              class="text-xs ${isLive ? 'up' : 'dn'}"
              role="status"
              aria-live="polite"
            >● ${isLive ? 'LIVE' : 'OFFLINE'}</span>

            <select
              id="ulang"
              class="input !w-auto !py-1.5 !px-2 text-xs"
              aria-label="Language"
            >
              ${renderLanguageOptions(state.uiLang)}
            </select>

            ${userControl}
          </div>
        </div>

        <div id="tick" class="border-y border-white/10 text-xs overflow-hidden">
          ${tickerHtml()}
        </div>
      </header>

      <nav class="mob-nav" aria-label="Mobile navigation">
        ${renderMobileLinks(links, currentPath)}
      </nav>
    `;

    const languageSelect = el.querySelector('#ulang');

    if (languageSelect) {
      languageSelect.value = LANGUAGES.some(
        ([value]) => value === state.uiLang
      )
        ? state.uiLang
        : 'en';

      languageSelect.onchange = event => {
        setUiLang(event.currentTarget.value);
      };
    }

    const logoutButton = el.querySelector('#lo');

    if (logoutButton) {
      logoutButton.onclick = () => {
        setSession(null, null);
        wsReconnect();
        location.hash = '#/';
      };
    }
  };

  const makeStateKey = state => {
    const user = state.user;

    return [
      state.uiLang,
      state.wsStatus,
      user?.id ?? '',
      user?.name ?? '',
      user?.email ?? '',
      user?.role ?? '',
      path()
    ].join('|');
  };

  const unsubscribe = on(state => {
    const key = makeStateKey(state);

    if (key !== lastKey) {
      lastKey = key;
      draw();
    }
  });

  const handleHashChange = () => {
    lastKey = makeStateKey(get());
    draw();
  };

  addEventListener('hashchange', handleHashChange);

  // Render immediately.
  lastKey = makeStateKey(get());
  draw();

  // Optional cleanup for apps that remount navigation.
  return () => {
    destroyed = true;
    removeEventListener('hashchange', handleHashChange);

    if (typeof unsubscribe === 'function') {
      unsubscribe();
    }
  };
}
