
import { get } from './store.js';

const routes = {
    '': () => import('../pages/home.js'),
    '/': () => import('../pages/home.js'),
    '/login': () => import('../pages/auth.js'),
    '/dashboard': () => import('../pages/dashboard.js'),
    '/trade': () => import('../pages/trade.js'),
    '/book': () => import('../pages/book.js'),
    '/portfolio': () => import('../pages/portfolio.js'),
    '/ai': () => import('../pages/ai.js'),
    '/heatmap': () => import('../pages/heatmap.js'),
    '/news': () => import('../pages/news.js'),
    '/algos': () => import('../pages/algos.js'),
    '/backtest': () => import('../pages/backtest.js'),
    '/admin': () => import('../pages/admin.js'),
    '/settings': () => import('../pages/settings.js')
};

const PUBLIC = new Set([
    '',
    '/',
    '/login',
    '/heatmap',
    '/news',
    '/algos',
    '/backtest'
]);

let cleanup = null;
let token = 0;

export const path = () =>
    (location.hash.slice(1).split('?')[0]) || '/';

export async function render() {
    const my = ++token;
    const p = path();
    const el = document.getElementById('app');

    if (cleanup) {
        try {
            cleanup();
        } catch (e) {
            console.error(e);
        }

        cleanup = null;
    }

    if (!PUBLIC.has(p) && !get().token) {
        location.hash = '#/login?next=' + encodeURIComponent(p);
        return;
    }

    const loader = routes[p];

    if (!loader) {
        el.innerHTML = `
            <div class="glass p-10 mt-10 text-center">
                <h2 class="text-2xl">Page not found</h2>
                <a class="btn btn-p mt-4" href="#/">Go home</a>
            </div>
        `;
        return;
    }

    el.innerHTML = `
        <div class="py-24 text-center">
            <span class="spin"></span>
        </div>
    `;

    try {
        const mod = await loader();

        if (my !== token) {
            return;
        }

        el.innerHTML = '';

        const c = await mod.default(el);

        if (my !== token) {
            if (c) {
                c();
            }

            return;
        }

        cleanup = c || null;

        window.scrollTo(0, 0);
    } catch (e) {
        console.error(e);

        if (my === token) {
            el.innerHTML = `
                <div class="glass p-8 mt-10">
                    <h2 class="text-xl dn mb-2">
                        Something went wrong
                    </h2>
                    <p class="mu text-sm"></p>
                </div>
            `;

            el.querySelector('p').textContent = e.message;
        }
    }
}

export function startRouter() {
    addEventListener('hashchange', render);
    render();
}
