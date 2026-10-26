
export const $ = (s, r = document) =>
    r.querySelector(s);

export const $$ = (s, r = document) =>
    [...r.querySelectorAll(s)];

export const esc = s =>
    String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[c]));

export const fmt = (n, d = 2) =>
    (n == null || isNaN(n))
        ? '-'
        : Number(n).toLocaleString('en-IN', {
            minimumFractionDigits: d,
            maximumFractionDigits: d
        });

export const inr = n =>
    (n < 0 ? '-' : '') + '₹' + fmt(Math.abs(n));

export const pct = n =>
    (n >= 0 ? '+' : '') + fmt(n) + '%';

export const cls = n =>
    (n >= 0 ? 'up' : 'dn');

export const time = ts =>
    new Date(ts).toLocaleTimeString('en-IN', {
        hour12: false
    });

export const dateTime = ts =>
    new Date(ts).toLocaleString('en-IN', {
        hour12: false,
        dateStyle: 'medium',
        timeStyle: 'short'
    });

export const throttle = (fn, ms) => {
    let t = 0;
    let q;

    return (...a) => {
        const n = Date.now();

        if (n - t >= ms) {
            t = n;
            fn(...a);
        } else {
            clearTimeout(q);

            q = setTimeout(() => {
                t = Date.now();
                fn(...a);
            }, ms - (n - t));
        }
    };
};

export const qs = () =>
    Object.fromEntries(
        new URLSearchParams(location.hash.split('?')[1] || '')
    );

export function downloadText(name, text, type = 'text/csv') {
    const a = document.createElement('a');

    a.href = URL.createObjectURL(
        new Blob([text], { type })
    );

    a.download = name;
    a.click();

    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function priceDecimals(p) {
    return p >= 100000 ? 0 : p >= 1000 ? 2 : 2;
}
