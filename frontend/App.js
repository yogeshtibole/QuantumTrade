
 // QuantumTrade frontend entry (plain JavaScript ES modules, no build step).

import { get, set, setSession } from './src/store.js';
import { api } from './src/api.js';
import { startRouter } from './src/router.js';

import { mountNav } from './components/nav.js';
import { startTicker } from './components/ticker.js';
import { toast } from './components/ui.js';

import {
    wsConnect,
    wsSub,
    wsOn
} from './hooks/useWebSocket.js';

async function boot() {
    if (get().token) {
        try {
            set({ user: await api('/me') });
        } catch {
            setSession(null, null);
        }
    }

    try {
        const [s, o] = await Promise.all([
            api('/symbols'),
            api('/market/overview')
        ]);

        const q = {};

        s.forEach(x => {
            q[x.symbol] = x;
        });

        o.forEach(x => {
            q[x.symbol] = {
                ...(q[x.symbol] || {}),
                ...x
            };
        });

        set({
            quotes: q,
            symbols: s
        });
    } catch (e) {
        toast(e.message, 'err');
    }

    wsOn('ticks', m => {
        const q = get().quotes;

        m.d.forEach(t => {
            const x = q[t.s] || (q[t.s] = { symbol: t.s });

            x.last = t.p;
            x.change_pct = t.c;
            x.volume = t.v;
        });

        set({ quotes: q });
    });

    wsOn('alert', m => {
        toast(m.message, 'ok');

        set({
            alerts: [
                {
                    ts: Date.now(),
                    message: m.message
                },
                ...get().alerts
            ].slice(0, 50)
        });
    });

    wsSub(['ticks']);
    wsConnect();

    mountNav();
    startTicker();
    startRouter();
}

boot();
