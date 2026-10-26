
#pragma once
// Rule-based market assistant ("Bramha" / "Sars"): technical indicators, news sentiment, regression forecast,
// portfolio suggestions, answers in English / Hindi / Marathi. Deterministic analytics, not an LLM and not investment advice.

#include <cstdarg>
#include <string>
#include <vector>
#include <map>
#include <array>
#include <algorithm>
#include <cmath>

#include "../market_feed/market_feed.hpp"
#include "../strategies/strategies.hpp"

using namespace std;

namespace qt {

struct Analysis {
    double last = 0, rsi = 50, sma20 = 0, sma50 = 0, macd = 0,
           macdSig = 0, macdHist = 0, bbU = 0, bbL = 0, atr = 0,
           vol = 0, mom = 0, score = 0, sentiment = 50, dayPct = 0;

    string trend, verdict, macdDir;
    vector<double> fc, fcLo, fcHi;
};

class AiAssistant {
    MarketFeed& feed_;

    static string fmt(const char* f, ...) {
        char b[1024];
        va_list a;
        va_start(a, f);
        vsnprintf(b, sizeof b, f, a);
        va_end(a);
        return b;
    }

    static int li(const string& l) {
        return l == "hi" ? 1 : l == "mr" ? 2 : 0;
    }

public:
    explicit AiAssistant(MarketFeed& f) : feed_(f) {}

    bool analyze(const string& sym, Analysis& A) const {
        auto cs = feed_.candles(sym, 300);
        Quote q;

        if (cs.size() < 60 || !feed_.quote(sym, q))
            return false;

        size_t n = cs.size();
        vector<double> c(n);

        for (size_t i = 0; i < n; i++)
            c[i] = cs[i].c;

        A.last = c.back();
        A.dayPct = q.prev > 0 ? (q.last / q.prev - 1) * 100 : 0;

        auto s20 = bt::sma(c, 20);
        auto s50 = bt::sma(c, 50);
        auto sd = bt::stdev(c, 20);
        auto r = bt::rsi(c, 14);
        auto e12 = bt::ema(c, 12);
        auto e26 = bt::ema(c, 26);

        vector<double> mac(n);

        for (size_t i = 0; i < n; i++)
            mac[i] = e12[i] - e26[i];

        auto sg = bt::ema(mac, 9);

        A.sma20 = s20[n - 1];
        A.sma50 = s50[n - 1];
        A.rsi = r[n - 1];
        A.macd = mac[n - 1];
        A.macdSig = sg[n - 1];
        A.macdHist = A.macd - A.macdSig;

        A.bbU = A.sma20 + 2 * sd[n - 1];
        A.bbL = A.sma20 - 2 * sd[n - 1];

        double atr = 0;

        for (size_t i = n - 14; i < n; i++) {
            atr += max({
                cs[i].h - cs[i].l,
                fabs(cs[i].h - c[i - 1]),
                fabs(cs[i].l - c[i - 1])
            });
        }

        A.atr = atr / 14;

        vector<double> lr;

        for (size_t i = n - 60; i < n; i++)
            lr.push_back(log(c[i] / c[i - 1]));

        double mu = 0, v = 0;

        for (double x : lr)
            mu += x;

        mu /= lr.size();

        for (double x : lr)
            v += (x - mu) * (x - mu);

        A.vol = sqrt(v / lr.size());
        A.mom = c[n - 1] / c[n - 21] - 1;

        A.trend = A.sma20 > A.sma50 * 1.0005
            ? "bullish"
            : A.sma20 < A.sma50 * 0.9995
            ? "bearish"
            : "sideways";

        A.macdDir = A.macdHist >= 0 ? "bullish" : "bearish";

        double sc =
            (A.sma20 > A.sma50 ? 25 : -25)
            + (A.rsi < 30 ? 20 : A.rsi > 70 ? -20 : (50 - A.rsi) * 0.1)
            + (A.macdHist > 0 ? 20 : -20)
            + (A.last < A.bbL ? 15 : A.last > A.bbU ? -15 : 0)
            + clampd(A.mom * 400, -20, 20);

        A.score = clampd(sc, -100, 100);
        A.verdict = A.score >= 25 ? "BUY"
            : A.score <= -25 ? "SELL"
            : "HOLD";

        double ns = 0;
        auto nw = feed_.news(20, sym);

        for (auto& x : nw)
            ns += x.sentiment;

        ns = nw.empty() ? 0 : ns / nw.size();

        A.sentiment = clampd(
            50 + 50 * (0.6 * ns + 0.4 * tanh(A.mom * 20)),
            0, 100
        );

        // Forecast: dampened log-linear regression with a volatility cone (+/- 1.64 sigma*sqrt(h)).
        size_t N = 60;
        double sx = 0, sy = 0, sxy = 0, sxx = 0;

        for (size_t i = 0; i < N; i++) {
            double x = (double)i;
            double y = log(c[n - N + i]);

            sx += x;
            sy += y;
            sxy += x * y;
            sxx += x * x;
        }

        double slope = (N * sxy - sx * sy) / (N * sxx - sx * sx);

        for (int h = 1; h <= 30; h++) {
            double m = A.last * exp(slope * h * 0.5);
            double band = A.last * A.vol * sqrt((double)h) * 1.64;

            A.fc.push_back(m);
            A.fcLo.push_back(m - band);
            A.fcHi.push_back(m + band);
        }

        return true;
    }

    Json toJson(const string& sym, const Analysis& A) const {
        Json j = Json::object();

        j["symbol"] = sym;
        j["last"] = A.last;
        j["day_pct"] = A.dayPct;
        j["rsi"] = A.rsi;
        j["sma20"] = A.sma20;
        j["sma50"] = A.sma50;
        j["macd"] = A.macd;
        j["macd_signal"] = A.macdSig;
        j["macd_hist"] = A.macdHist;
        j["bb_upper"] = A.bbU;
        j["bb_lower"] = A.bbL;
        j["atr"] = A.atr;
        j["volatility"] = A.vol;
        j["momentum_pct"] = A.mom * 100;
        j["trend"] = A.trend;
        j["score"] = A.score;
        j["verdict"] = A.verdict;
        j["sentiment"] = A.sentiment;

        Json f = Json::array();
        Json lo = Json::array();
        Json hi = Json::array();

        for (size_t i = 0; i < A.fc.size(); i++) {
            f.push(A.fc[i]);
            lo.push(A.fcLo[i]);
            hi.push(A.fcHi[i]);
        }

        j["forecast"] = f;
        j["forecast_low"] = lo;
        j["forecast_high"] = hi;

        return j;
    }

    static string word(const string& w, const string& lang) {
        static const map<string, array<const char*, 3>> t = {
            {"bullish", {"bullish", "तेजी", "तेजी"}},
            {"bearish", {"bearish", "मंदी", "मंदी"}},
            {"sideways", {"sideways", "सपाट", "सपाट"}},
            {"BUY", {"BUY", "खरीदें", "खरेदी"}},
            {"SELL", {"SELL", "बेचें", "विक्री"}},
            {"HOLD", {"HOLD", "रुकें", "थांबा"}}
        };

        auto i = t.find(w);
        return i == t.end() ? w : i->second[li(lang)];
    }

    // Intent detection by keyword; returns {text, data}.
    // `portfolio` is the caller's snapshot (may be empty).
    Json answer(
        const string& q,
        const string& lang,
        const string& name,
        const Json& portfolio,
        const string& symHint
    ) const {
        string ql = lower(q), sym = symHint;
        int L = li(lang);

        for (auto& d : symbolDefs()) {
            string s = lower(d.sym);
            string nm = lower(d.name);
            size_t sp = nm.find(' ');

            if (ql.find(s) != string::npos ||
                ql.find(nm.substr(0, sp)) != string::npos) {
                sym = d.sym;
                break;
            }
        }

        auto has = [&](initializer_list<const char*> ks) {
            for (auto k : ks) {
                if (ql.find(k) != string::npos ||
                    q.find(k) != string::npos)
                    return true;
            }
            return false;
        };

        Json out = Json::object();
        string text;
        out["intent"] = "analysis";

        if (has({"hello", "hi ", "namaste", "नमस्ते", "help", "मदद", "मदत"})
            && q.size() < 20) {

            out["intent"] = "help";

            static const char* h[3] = {
                "Hey, I'm %s. Ask me to analyse a stock (e.g. 'analyse TCS'), summarise market news, forecast a price, check sentiment or suggest portfolio changes.",
                "नमस्ते, मैं %s हूँ। किसी स्टॉक का विश्लेषण (जैसे 'TCS analyse'), बाज़ार की खबरें, भाव का अनुमान, सेंटिमेंट या पोर्टफोलियो सुझाव पूछें।",
                "नमस्कार, मी %s आहे. स्टॉकचे विश्लेषण (उदा. 'TCS analyse'), बाजार बातम्या, किंमत अंदाज, सेंटिमेंट किंवा पोर्टफोलिओ सूचना विचारा."
            };

            text = fmt(h[L], name.c_str());

        } else if (has({"news", "खबर", "बातम्या", "headline"})) {

            out["intent"] = "news";

            auto nw = feed_.news(4, sym);

            if (nw.empty())
                nw = feed_.news(4);

            Json hl = Json::array();

            text = L == 0 ? "Latest market headlines: "
                : L == 1 ? "ताज़ा बाज़ार खबरें: "
                : "ताज्या बाजार बातम्या: ";

            for (size_t i = 0; i < nw.size(); i++) {
                hl.push(nw[i].headline);
                text += (i ? " | " : "") + nw[i].headline;
            }

            out["headlines"] = hl;

        } else if (has({"portfolio", "पोर्टफोलियो", "पोर्टफोलिओ", "suggest", "rebalance"})) {

            out["intent"] = "portfolio";

            Json pos = portfolio.at("positions");
            double tot = portfolio.at("holdings_value").num();

            map<string, double> sec;

            for (auto& p : pos.a)
                sec[p.at("sector").str()] += p.at("value").num();

            string topS;
            double topW = 0;

            for (auto& kv : sec) {
                if (tot > 0 && kv.second / tot > topW) {
                    topW = kv.second / tot;
                    topS = kv.first;
                }
            }

            double cashPct = portfolio.at("equity").num() > 0
                ? portfolio.at("cash").num() /
                  portfolio.at("equity").num() * 100
                : 100;

            Json tips = Json::array();

            if (pos.size() == 0) {
                text = L == 0
                    ? "You hold no positions yet. Consider starting with 3-5 stocks across different sectors."
                    : L == 1
                    ? "अभी कोई पोज़िशन नहीं है। अलग-अलग सेक्टर के 3-5 स्टॉक से शुरुआत करें।"
                    : "सध्या कोणतीही पोझिशन नाही. वेगवेगळ्या क्षेत्रातील 3-5 स्टॉकने सुरुवात करा.";

            } else {
                if (topW > 0.4) {
                    text = fmt(
                        L == 0
                            ? "%s makes up %.0f%% of your holdings. Consider trimming it and adding other sectors. "
                            : L == 1
                            ? "%s आपके होल्डिंग का %.0f%% है। इसे घटाकर अन्य सेक्टर जोड़ने पर विचार करें। "
                            : "%s तुमच्या होल्डिंगचा %.0f%% आहे. ते कमी करून इतर क्षेत्रे जोडण्याचा विचार करा. ",
                        topS.c_str(), topW * 100
                    );
                } else {
                    text = L == 0
                        ? "Your sector mix looks reasonably diversified. "
                        : L == 1
                        ? "आपका सेक्टर मिश्रण संतुलित दिखता है। "
                        : "तुमचे क्षेत्र मिश्रण संतुलित दिसते. ";
                }

                text += fmt(
                    L == 0
                        ? "Cash is %.0f%% of equity; risk score %.0f/100 (%s)."
                        : L == 1
                        ? "कैश इक्विटी का %.0f%% है; जोखिम स्कोर %.0f/100 (%s)।"
                        : "रोख इक्विटीच्या %.0f%% आहे; जोखीम स्कोअर %.0f/100 (%s).",
                    cashPct,
                    portfolio.at("risk_score").num(),
                    portfolio.at("risk_label").str().c_str()
                );
            }

            out["tips"] = tips;

        } else if (sym.empty()) {

            out["intent"] = "unknown";

            text = L == 0
                ? "Which stock? Try: 'analyse RELIANCE', 'sentiment for TCS' or 'forecast INFY'."
                : L == 1
                ? "कौन सा स्टॉक? जैसे: 'RELIANCE analyse', 'TCS sentiment' या 'INFY forecast'।"
                : "कोणता स्टॉक? उदा. 'RELIANCE analyse', 'TCS sentiment' किंवा 'INFY forecast'.";

        } else {

            Analysis A;

            if (!analyze(sym, A)) {
                text = "No data for " + sym;

            } else {
                out["analysis"] = toJson(sym, A);

                if (has({"sentiment", "सेंटिमेंट", "भावना", "मूड"})) {
                    out["intent"] = "sentiment";

                    const char* lab = A.sentiment > 60
                        ? "bullish"
                        : A.sentiment < 40
                        ? "bearish"
                        : "sideways";

                    text = fmt(
                        L == 0
                            ? "%s sentiment is %.0f/100 (%s), blending recent headlines and 20-bar momentum."
                            : L == 1
                            ? "%s का सेंटिमेंट %.0f/100 (%s) है, हाल की खबरों और 20-बार मोमेंटम पर आधारित।"
                            : "%s चे सेंटिमेंट %.0f/100 (%s) आहे, अलीकडील बातम्या आणि 20-बार मोमेंटमवर आधारित.",
                        sym.c_str(), A.sentiment, word(lab, lang).c_str()
                    );

                } else if (has({"predict", "forecast", "price target", "अनुमान", "अंदाज", "भविष्य"})) {
                    out["intent"] = "prediction";

                    text = fmt(
                        L == 0
                            ? "%s forecast for the next 30 candles: Rs %.2f (range Rs %.2f - Rs %.2f). Trend: %s. Statistical projection only."
                            : L == 1
                            ? "%s का अगले 30 कैंडल का अनुमान: ₹%.2f (दायरा ₹%.2f - ₹%.2f)। रुझान: %s। केवल सांख्यिकीय अनुमान।"
                            : "%s चा पुढील 30 कॅंडलचा अंदाज: ₹%.2f (श्रेणी ₹%.2f - ₹%.2f). कल: %s. केवळ सांख्यिकीय अंदाज.",
                        sym.c_str(),
                        A.fc.back(), A.fcLo.back(), A.fcHi.back(),
                        word(A.trend, lang).c_str()
                    );

                } else {
                    text = fmt(
                        L == 0
                            ? "%s trades at Rs %.2f (%+.2f%% today). RSI %.0f, MACD %s, trend %s. Signal: %s (score %.0f). 30-candle forecast Rs %.2f - Rs %.2f. Demo analytics, not investment advice."
                            : L == 1
                            ? "%s ₹%.2f पर है (आज %+.2f%%)। RSI %.0f, MACD %s, रुझान %s। संकेत: %s (स्कोर %.0f)। 30 कैंडल अनुमान ₹%.2f - ₹%.2f। डेमो विश्लेषण, निवेश सलाह नहीं।"
                            : "%s ₹%.2f वर आहे (आज %+.2f%%). RSI %.0f, MACD %s, कल %s. संकेत: %s (स्कोअर %.0f). 30 कॅंडल अंदाज ₹%.2f - ₹%.2f. डेमो विश्लेषण, गुंतवणूक सल्ला नाही.",
                        sym.c_str(), A.last, A.dayPct, A.rsi,
                        word(A.macdDir, lang).c_str(),
                        word(A.trend, lang).c_str(),
                        word(A.verdict, lang).c_str(),
                        A.score, A.fcLo.back(), A.fcHi.back()
                    );
                }
            }
        }

        out["text"] = text;
        out["symbol"] = sym;
        out["assistant"] = name;

        return out;
    }
};

} // namespace qt
