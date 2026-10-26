
/*
 * End-to-end smoke test against a running server.
 *
 * Usage:
 * node tests/api_smoke.js [http://localhost:8080]
 *
 * Requires Node.js 18+ (global fetch).
 * Exits with a non-zero status on the first failed check.
 */

const B = process.argv[2] || 'http://localhost:8080';

let n = 0;

const ok = (c, m) => {
    n++;

    if (!c) {
        console.error('FAIL:', m);
        process.exit(1);
    } else {
        console.log('ok  -', m);
    }
};

const call = async (p, o = {}, t) => {
    const r = await fetch(B + p, {
        ...o,
        headers: {
            ...(t ? { Authorization: 'Bearer ' + t } : {})
        },
        body: o.body ? JSON.stringify(o.body) : undefined,
        method: o.method || 'GET'
    });

    let j = null;

    try {
        j = await r.json();
    } catch {
        // Response body is not valid JSON or is empty.
    }

    return {
        s: r.status,
        j
    };
};

(async () => {
    // 1. Health check
    ok(
        (await call('/api/health')).j.status === 'ok',
        'health'
    );

    // 2. Register a test user
    const email = 'smoke' + Date.now() + '@test.io';

    let r = await call('/api/auth/register', {
        method: 'POST',
        body: {
            name: 'Smoke Test',
            email,
            password: 'Passw0rdX',
            accept_terms: true
        }
    });

    ok(
        r.s === 201 && r.j.dev_otp,
        'register returns OTP (needs QT_DEV_MODE=1)'
    );

    // 3. Login should fail until email verification
    ok(
        (
            await call('/api/auth/login', {
                method: 'POST',
                body: {
                    email,
                    password: 'Passw0rdX'
                }
            })
        ).s === 403,
        'login blocked until verified'
    );

    // 4. Incorrect OTP should be rejected
    r = await call('/api/auth/verify-otp', {
        method: 'POST',
        body: {
            email,
            code: '000000'
        }
    });

    ok(
        r.s === 400,
        'wrong OTP rejected'
    );

    // 5. Resend OTP and verify the user
    const code = (
        await call('/api/auth/resend-otp', {
            method: 'POST',
            body: { email }
        })
    ).j.dev_otp;

    r = await call('/api/auth/verify-otp', {
        method: 'POST',
        body: {
            email,
            code
        }
    });

    ok(
        r.s === 200 && r.j.token,
        'OTP verifies and returns JWT'
    );

    const T = r.j.token;

    // 6. Protected endpoints require authentication
    ok(
        (await call('/api/portfolio')).s === 401,
        'portfolio requires auth'
    );

    // 7. Normal users cannot access admin endpoints
    ok(
        (await call('/api/admin/overview', {}, T)).s === 403,
        'admin endpoints forbidden for normal users'
    );

    // 8. Check the order book
    const d = (
        await call('/api/depth?symbol=TCS')
    ).j;

    ok(
        d.bids.length > 0 && d.best_ask > d.best_bid,
        'order book is populated and uncrossed'
    );

    // 9. Market buy should fill
    r = await call('/api/orders', {
        method: 'POST',
        body: {
            symbol: 'TCS',
            side: 'buy',
            type: 'market',
            qty: 3
        }
    }, T);

    ok(
        r.s === 201 && r.j.status === 'filled',
        'market buy fills'
    );

    // 10. Overselling should be rejected
    r = await call('/api/orders', {
        method: 'POST',
        body: {
            symbol: 'TCS',
            side: 'sell',
            type: 'limit',
            qty: 9999,
            price: d.best_ask
        }
    }, T);

    ok(
        r.s === 422,
        'oversell rejected by risk manager'
    );

    // 11. Limit buy should remain open
    r = await call('/api/orders', {
        method: 'POST',
        body: {
            symbol: 'TCS',
            side: 'buy',
            type: 'limit',
            qty: 1,
            price: +(d.best_bid * 0.98).toFixed(2)
        }
    }, T);

    ok(
        r.j.status === 'open',
        'limit order rests on the book'
    );

    // 12. Cancel the open limit order
    const oid = r.j.id;

    r = await call('/api/orders/cancel', {
        method: 'POST',
        body: { id: oid }
    }, T);

    ok(
        r.s === 200,
        'cancel works'
    );

    // 13. Verify portfolio positions and fees
    const p = (
        await call('/api/portfolio', {}, T)
    ).j;

    ok(
        p.positions.some(
            x => x.symbol === 'TCS' && x.qty === 3
        ) && p.fees > 0,
        'portfolio reflects fill and fees'
    );

    // 14. Backtest should produce an equity curve
    r = await call('/api/backtest', {
        method: 'POST',
        body: {
            strategy: 'ma_crossover',
            symbol: 'TCS',
            bars: 500
        }
    });

    ok(
        r.s === 200 && r.j.equity_curve.length > 10,
        'backtest runs'
    );

    // 15. AI assistant should answer in Hindi
    r = await call('/api/ai/ask', {
        method: 'POST',
        body: {
            question: 'analyse TCS',
            lang: 'hi'
        }
    }, T);

    ok(
        r.s === 200 && r.j.text.length > 20,
        'AI assistant answers (Hindi)'
    );

    console.log(`\nAll ${n} checks passed.`);
})().catch(e => {
    console.error(
        'Error (is the server running?):',
        e.message
    );

    process.exit(1);
});
