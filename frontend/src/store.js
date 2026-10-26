
 // Tiny global store with subscribe().
const state = {
    user: null,
    token: localStorage.getItem('qt_token'),
    quotes: {},
    indices: {},
    symbols: [],
    uiLang: localStorage.getItem('qt_lang') || 'en',
    alerts: [],
    wsStatus: 'connecting'
};

const subs = new Set();

export const get = () => state;

export function set(p) {
    Object.assign(state, p);
    subs.forEach(f => f(state));
}

export function on(f) {
    subs.add(f);
    return () => subs.delete(f);
}

export function setSession(token, user) {
    if (token) {
        localStorage.setItem('qt_token', token);
    } else {
        localStorage.removeItem('qt_token');
    }

    set({ token, user });
}
