
#pragma once
// Small JSON value type with parser and serializer.

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <map>
#include <string>
#include <type_traits>
#include <vector>
#include <utility>
#include <cctype>

using namespace std;

namespace qt {

class Json {
public:
    enum Type { Null, Bool, Num, Str, Arr, Obj };

    Type t = Null;
    bool b = false;
    double n = 0;
    string s;
    vector<Json> a;
    map<string, Json> o;

    Json() {}

    Json(bool v) : t(Bool), b(v) {}

    template <class N,
        typename enable_if<
            is_arithmetic<N>::value &&
            !is_same<N, bool>::value,
            int
        >::type = 0>
    Json(N v) : t(Num), n((double)v) {}

    Json(const char* v) : t(Str), s(v ? v : "") {}

    Json(const string& v) : t(Str), s(v) {}

    static Json array() {
        Json j;
        j.t = Arr;
        return j;
    }

    static Json object() {
        Json j;
        j.t = Obj;
        return j;
    }

    Json& operator[](const string& k) {
        if (t != Obj) {
            t = Obj;
            o.clear();
        }
        return o[k];
    }

    Json& push(Json v) {
        if (t != Arr) {
            t = Arr;
            a.clear();
        }
        a.push_back(move(v));
        return *this;
    }

    const Json& at(const string& k) const {
        static const Json nul;

        if (t != Obj)
            return nul;

        auto i = o.find(k);
        return i == o.end() ? nul : i->second;
    }

    bool has(const string& k) const {
        return t == Obj && o.count(k) > 0;
    }

    bool isNull() const {
        return t == Null;
    }

    bool isArr() const {
        return t == Arr;
    }

    bool isObj() const {
        return t == Obj;
    }

    string str(const string& d = "") const {
        return t == Str ? s : d;
    }

    double num(double d = 0) const {
        if (t == Num)
            return n;

        if (t == Str) {
            char* e;
            double v = strtod(s.c_str(), &e);

            if (e != s.c_str())
                return v;
        }

        return d;
    }

    bool boolean(bool d = false) const {
        return t == Bool ? b : d;
    }

    size_t size() const {
        return t == Arr ? a.size()
             : t == Obj ? o.size()
             : 0;
    }

    string dump() const {
        string r;
        dumpTo(r);
        return r;
    }

    static void esc(string& r, const string& x) {
        r += '"';

        for (unsigned char c : x) {
            switch (c) {
                case '"':  r += "\\\""; break;
                case '\\': r += "\\\\"; break;
                case '\n': r += "\\n"; break;
                case '\r': r += "\\r"; break;
                case '\t': r += "\\t"; break;

                default:
                    if (c < 0x20) {
                        char u[8];
                        snprintf(u, 8, "\\u%04x", c);
                        r += u;
                    } else {
                        r += (char)c;
                    }
            }
        }

        r += '"';
    }

    void dumpTo(string& r) const {
        switch (t) {
            case Null:
                r += "null";
                break;

            case Bool:
                r += b ? "true" : "false";
                break;

            case Num: {
                if (!isfinite(n)) {
                    r += "null";
                    break;
                }

                char buf[48];

                if (n == 0) {
                    r += "0";
                } else if (n == floor(n) && fabs(n) < 1e15) {
                    snprintf(buf, 48, "%.0f", n);
                    r += buf;
                } else {
                    snprintf(buf, 48, "%.10g", n);
                    r += buf;
                }

                break;
            }

            case Str:
                esc(r, s);
                break;

            case Arr: {
                r += '[';
                bool f = true;

                for (auto& v : a) {
                    if (!f)
                        r += ',';

                    f = false;
                    v.dumpTo(r);
                }

                r += ']';
                break;
            }

            case Obj: {
                r += '{';
                bool f = true;

                for (auto& kv : o) {
                    if (!f)
                        r += ',';

                    f = false;
                    esc(r, kv.first);
                    r += ':';
                    kv.second.dumpTo(r);
                }

                r += '}';
                break;
            }
        }
    }

    static Json parse(const string& src, bool* ok = nullptr) {
        P p{src};
        Json v = p.val();
        p.ws();

        bool good = p.ok && p.i == src.size();

        if (ok)
            *ok = good;

        return good ? v : Json();
    }

private:
    struct P {
        const string& s;
        size_t i = 0;
        bool ok = true;
        int depth = 0;

        void ws() {
            while (i < s.size() && isspace((unsigned char)s[i]))
                i++;
        }

        Json val() {
            ws();

            if (i >= s.size() || depth > 64) {
                ok = false;
                return Json();
            }

            char c = s[i];

            if (c == '{')
                return obj();

            if (c == '[')
                return arr();

            if (c == '"')
                return Json(str());

            if (s.compare(i, 4, "true") == 0) {
                i += 4;
                return Json(true);
            }

            if (s.compare(i, 5, "false") == 0) {
                i += 5;
                return Json(false);
            }

            if (s.compare(i, 4, "null") == 0) {
                i += 4;
                return Json();
            }

            const char* st = s.c_str() + i;
            char* e;
            double d = strtod(st, &e);

            if (e == st) {
                ok = false;
                return Json();
            }

            i += (size_t)(e - st);
            return Json(d);
        }

        Json obj() {
            Json r = Json::object();
            i++;
            depth++;
            ws();

            if (i < s.size() && s[i] == '}') {
                i++;
                depth--;
                return r;
            }

            while (ok) {
                ws();

                if (i >= s.size() || s[i] != '"') {
                    ok = false;
                    break;
                }

                string k = str();
                ws();

                if (i >= s.size() || s[i] != ':') {
                    ok = false;
                    break;
                }

                i++;
                r.o[k] = val();
                ws();

                if (i < s.size() && s[i] == ',') {
                    i++;
                    continue;
                }

                if (i < s.size() && s[i] == '}') {
                    i++;
                    break;
                }

                ok = false;
            }

            depth--;
            return r;
        }

        Json arr() {
            Json r = Json::array();
            i++;
            depth++;
            ws();

            if (i < s.size() && s[i] == ']') {
                i++;
                depth--;
                return r;
            }

            while (ok) {
                r.a.push_back(val());
                ws();

                if (i < s.size() && s[i] == ',') {
                    i++;
                    continue;
                }

                if (i < s.size() && s[i] == ']') {
                    i++;
                    break;
                }

                ok = false;
            }

            depth--;
            return r;
        }

        static void utf8(string& o, unsigned cp) {
            if (cp < 0x80) {
                o += (char)cp;
            } else if (cp < 0x800) {
                o += (char)(0xC0 | (cp >> 6));
                o += (char)(0x80 | (cp & 63));
            } else if (cp < 0x10000) {
                o += (char)(0xE0 | (cp >> 12));
                o += (char)(0x80 | ((cp >> 6) & 63));
                o += (char)(0x80 | (cp & 63));
            } else {
                o += (char)(0xF0 | (cp >> 18));
                o += (char)(0x80 | ((cp >> 12) & 63));
                o += (char)(0x80 | ((cp >> 6) & 63));
                o += (char)(0x80 | (cp & 63));
            }
        }

        string str() {
            string o;
            i++;

            while (i < s.size() && s[i] != '"') {
                if (s[i] == '\\' && i + 1 < s.size()) {
                    char c = s[++i];

                    switch (c) {
                        case 'n': o += '\n'; break;
                        case 't': o += '\t'; break;
                        case 'r': o += '\r'; break;
                        case 'b': o += '\b'; break;
                        case 'f': o += '\f'; break;

                        case 'u': {
                            if (i + 4 >= s.size()) {
                                ok = false;
                                return o;
                            }

                            unsigned cp = (unsigned)strtol(
                                s.substr(i + 1, 4).c_str(),
                                nullptr, 16
                            );

                            i += 4;

                            if (cp >= 0xD800 && cp < 0xDC00 &&
                                i + 6 < s.size() &&
                                s[i + 1] == '\\' &&
                                s[i + 2] == 'u') {

                                unsigned lo = (unsigned)strtol(
                                    s.substr(i + 3, 4).c_str(),
                                    nullptr, 16
                                );

                                i += 6;
                                cp = 0x10000 +
                                     ((cp - 0xD800) << 10) +
                                     (lo - 0xDC00);
                            }

                            utf8(o, cp);
                            break;
                        }

                        default:
                            o += c;
                    }

                    i++;
                } else {
                    o += s[i++];
                }
            }

            if (i >= s.size())
                ok = false;
            else
                i++;

            return o;
        }
    };
};

} // namespace qt
