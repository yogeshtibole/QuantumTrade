
import { get, setSession } from './store.js';

export async function api(path, { method = 'GET', body } = {}) {
    const headers = {};
    const t = get().token;

    if (t) {
        headers.Authorization = 'Bearer ' + t;
    }

    if (body) {
        headers['Content-Type'] = 'application/json';
    }

    let r;

    try {
        r = await fetch('/api' + path, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined
        });
    } catch {
        throw new Error(
            'Cannot reach the server. Is the backend running?'
        );
    }

    let j = null;

    try {
        j = await r.json();
    } catch {
        // Empty body
    }

    if (r.status === 401 && t && !path.startsWith('/auth')) {
        setSession(null, null);
        location.hash = '#/login';
    }

    if (!r.ok) {
        const e = new Error(
            (j && j.error) || 'Request failed (' + r.status + ')'
        );

        e.data = j;
        e.status = r.status;

        throw e;
    }

    return j;
}
