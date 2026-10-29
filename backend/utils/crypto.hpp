#pragma once
// SHA-1, SHA-256, HMAC, PBKDF2, Base64/32, TOTP (RFC 6238). No external dependencies.

#include <chrono>
#include <cstdint>
#include <random>
#include <string>
#include "util.hpp"

using namespace std;

namespace qt {
namespace crypto {

inline uint32_t rotr(uint32_t x, int n) {
    return (x >> n) | (x << (32 - n));
}

inline uint32_t rotl(uint32_t x, int n) {
    return (x << n) | (x >> (32 - n));
}

inline uint32_t be32(const string& s, size_t o) {
    return ((uint32_t)(uint8_t)s[o] << 24) |
           ((uint32_t)(uint8_t)s[o + 1] << 16) |
           ((uint32_t)(uint8_t)s[o + 2] << 8) |
           (uint32_t)(uint8_t)s[o + 3];
}

inline void put32(string& o, uint32_t v) {
    for (int i = 3; i >= 0; --i)
        o.push_back((char)((v >> (i * 8)) & 0xff));
}

inline string padMsg(const string& m) {
    string p = m;
    p.push_back((char)0x80);

    while (p.size() % 64 != 56)
        p.push_back('\0');

    uint64_t b = (uint64_t)m.size() * 8;

    for (int i = 7; i >= 0; --i)
        p.push_back((char)((b >> (i * 8)) & 0xff));

    return p;
}

inline string sha256(const string& m) {
    static const uint32_t K[64] = {
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
        0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
        0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
        0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
        0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
        0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
        0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
        0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    };

    uint32_t h[8] = {
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    };

    string p = padMsg(m);

    for (size_t off = 0; off < p.size(); off += 64) {
        uint32_t w[64];

        for (int i = 0; i < 16; i++)
            w[i] = be32(p, off + 4 * i);

        for (int i = 16; i < 64; i++) {
            uint32_t s0 = rotr(w[i - 15], 7) ^
                          rotr(w[i - 15], 18) ^
                          (w[i - 15] >> 3);

            uint32_t s1 = rotr(w[i - 2], 17) ^
                          rotr(w[i - 2], 19) ^
                          (w[i - 2] >> 10);

            w[i] = w[i - 16] + s0 + w[i - 7] + s1;
        }

        uint32_t a = h[0], b = h[1], c = h[2], d = h[3];
        uint32_t e = h[4], f = h[5], g = h[6], hh = h[7];

        for (int i = 0; i < 64; i++) {
            uint32_t S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            uint32_t ch = (e & f) ^ (~e & g);
            uint32_t t1 = hh + S1 + ch + K[i] + w[i];

            uint32_t S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            uint32_t mj = (a & b) ^ (a & c) ^ (b & c);
            uint32_t t2 = S0 + mj;

            hh = g;
            g = f;
            f = e;
            e = d + t1;
            d = c;
            c = b;
            b = a;
            a = t1 + t2;
        }

        h[0] += a;
        h[1] += b;
        h[2] += c;
        h[3] += d;
        h[4] += e;
        h[5] += f;
        h[6] += g;
        h[7] += hh;
    }

    string o;
    for (int i = 0; i < 8; i++)
        put32(o, h[i]);

    return o;
}

inline string sha1(const string& m) {
    uint32_t h[5] = {
        0x67452301, 0xEFCDAB89, 0x98BADCFE,
        0x10325476, 0xC3D2E1F0
    };

    string p = padMsg(m);

    for (size_t off = 0; off < p.size(); off += 64) {
        uint32_t w[80];

        for (int i = 0; i < 16; i++)
            w[i] = be32(p, off + 4 * i);

        for (int i = 16; i < 80; i++)
            w[i] = rotl(
                w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1
            );

        uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4];

        for (int i = 0; i < 80; i++) {
            uint32_t f, k;

            if (i < 20) {
                f = (b & c) | (~b & d);
                k = 0x5A827999;
            } else if (i < 40) {
                f = b ^ c ^ d;
                k = 0x6ED9EBA1;
            } else if (i < 60) {
                f = (b & c) | (b & d) | (c & d);
                k = 0x8F1BBCDC;
            } else {
                f = b ^ c ^ d;
                k = 0xCA62C1D6;
            }

            uint32_t t = rotl(a, 5) + f + e + k + w[i];

            e = d;
            d = c;
            c = rotl(b, 30);
            b = a;
            a = t;
        }

        h[0] += a;
        h[1] += b;
        h[2] += c;
        h[3] += d;
        h[4] += e;
    }

    string o;
    for (int i = 0; i < 5; i++)
        put32(o, h[i]);

    return o;
}

typedef string (*HashFn)(const string&);

inline string hmac(HashFn H, string key, const string& msg) {
    if (key.size() > 64)
        key = H(key);

    key.resize(64, '\0');

    string ip(64, 0), op(64, 0);

    for (int i = 0; i < 64; i++) {
        ip[i] = key[i] ^ 0x36;
        op[i] = key[i] ^ 0x5c;
    }

    return H(op + H(ip + msg));
}

inline string hmacSha256(const string& k, const string& m) {
    return hmac(sha256, k, m);
}

inline string hmacSha1(const string& k, const string& m) {
    return hmac(sha1, k, m);
}

inline string pbkdf2(const string& pass, const string& salt, int iters) {
    string u = hmacSha256(pass, salt + string("\0\0\0\1", 4));
    string t = u;

    for (int i = 1; i < iters; i++) {
        u = hmacSha256(pass, u);

        for (size_t j = 0; j < t.size(); j++)
            t[j] ^= u[j];
    }

    return t;
}

inline string hex(const string& s) {
    static const char* d = "0123456789abcdef";
    string o;

    for (unsigned char c : s) {
        o += d[c >> 4];
        o += d[c & 15];
    }

    return o;
}

inline string b64(const string& s, bool url = false) {
    const char* T = url
        ? "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
        : "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    string o;
    size_t i = 0;

    for (; i + 2 < s.size(); i += 3) {
        uint32_t v = ((uint8_t)s[i] << 16) |
                     ((uint8_t)s[i + 1] << 8) |
                     (uint8_t)s[i + 2];

        o += T[v >> 18];
        o += T[(v >> 12) & 63];
        o += T[(v >> 6) & 63];
        o += T[v & 63];
    }

    if (i + 1 == s.size()) {
        uint32_t v = (uint8_t)s[i] << 16;

        o += T[v >> 18];
        o += T[(v >> 12) & 63];

        if (!url)
            o += "==";
    } else if (i + 2 == s.size()) {
        uint32_t v = ((uint8_t)s[i] << 16) |
                     ((uint8_t)s[i + 1] << 8);

        o += T[v >> 18];
        o += T[(v >> 12) & 63];
        o += T[(v >> 6) & 63];

        if (!url)
            o += "=";
    }

    return o;
}

inline string b64decode(const string& s) {
    string o;
    uint32_t v = 0;
    int bits = 0;

    for (char c : s) {
        int d;

        if (c >= 'A' && c <= 'Z')
            d = c - 'A';
        else if (c >= 'a' && c <= 'z')
            d = c - 'a' + 26;
        else if (c >= '0' && c <= '9')
            d = c - '0' + 52;
        else if (c == '+' || c == '-')
            d = 62;
        else if (c == '/' || c == '_')
            d = 63;
        else
            continue;

        v = (v << 6) | d;
        bits += 6;

        if (bits >= 8) {
            bits -= 8;
            o += (char)((v >> bits) & 0xff);
        }
    }

    return o;
}

inline string base32decode(const string& s) {
    string o;
    uint32_t v = 0;
    int bits = 0;

    for (char c : s) {
        int d;

        if (c >= 'A' && c <= 'Z')
            d = c - 'A';
        else if (c >= 'a' && c <= 'z')
            d = c - 'a';
        else if (c >= '2' && c <= '7')
            d = c - '2' + 26;
        else
            continue;

        v = (v << 5) | d;
        bits += 5;

        if (bits >= 8) {
            bits -= 8;
            o += (char)((v >> bits) & 0xff);
        }
    }

    return o;
}

inline string randomBytes(size_t n) {
    random_device rd;
    mt19937_64 g(((uint64_t)rd() << 32) ^ rd() ^ nowNs());

    string o;

    for (size_t i = 0; i < n; i++)
        o += (char)(g() & 0xff);

    return o;
}

inline string randomHex(size_t n) {
    return hex(randomBytes(n));
}

inline string randomBase32(size_t n) {
    static const char* A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

    string r = randomBytes(n), o;

    for (unsigned char c : r)
        o += A[c & 31];

    return o;
}

inline bool ctEq(const string& a, const string& b) {
    if (a.size() != b.size())
        return false;

    unsigned char d = 0;

    for (size_t i = 0; i < a.size(); i++)
        d |= (unsigned char)(a[i] ^ b[i]);

    return d == 0;
}

inline string totpAt(const string& secretB32, uint64_t counter, int digits = 6) {
    string key = base32decode(secretB32), msg;

    for (int i = 7; i >= 0; --i)
        msg.push_back((char)((counter >> (i * 8)) & 0xff));

    string h = hmacSha1(key, msg);
    int off = h[19] & 0xf;

    uint32_t bin = ((uint32_t)(h[off] & 0x7f) << 24) |
                   ((uint32_t)(uint8_t)h[off + 1] << 16) |
                   ((uint32_t)(uint8_t)h[off + 2] << 8) |
                   (uint32_t)(uint8_t)h[off + 3];

    uint32_t mod = 1;

    for (int i = 0; i < digits; i++)
        mod *= 10;

    string c = to_string(bin % mod);

    while ((int)c.size() < digits)
        c = "0" + c;

    return c;
}

inline bool totpVerify(const string& secret, const string& code, int64_t nowSec = 0) {
    if (!nowSec)
        nowSec = nowMs() / 1000;

    for (int w = -1; w <= 1; w++) {
        if (ctEq(totpAt(secret, (uint64_t)(nowSec / 30 + w)), code))
            return true;
    }

    return false;
}

} // namespace crypto
} // namespace qt