
 // QuantumTrade server: C++17 REST + WebSocket + matching engine, serves the frontend from ../frontend.

#include <atomic>
#include <chrono>
#include <csignal>
#include <cstdlib>
#include <fstream>
#include <string>
#include <thread>
#include <sys/stat.h>

#include "api/routes.hpp"

#ifdef _WIN32
#include <direct.h>
#define MKDIR(p) _mkdir(p)
#else
#define MKDIR(p) mkdir(p, 0755)
#endif

using namespace std;
using namespace qt;

static atomic<bool> g_stop{false};
static HttpServer* g_http = nullptr;

static void onSignal(int) {
    g_stop = true;
    if (g_http)
        g_http->stop();
}

static bool exists(const string& p) {
    ifstream f(p);
    return f.good();
}

int main(int argc, char** argv) {
        // Hosting platforms such as Render inject PORT; QT_PORT overrides it.
    string portEnv = getenvOr("PORT", "8080");
    bool cloud = !getenvOr("PORT", "").empty();

    int port = atoi(getenvOr("QT_PORT", portEnv).c_str());
    bool dev = getenvOr("QT_DEV_MODE", "1") != "0";

    // Never run on a public host with the default admin password.
    if (cloud && getenvOr("QT_ADMIN_PASSWORD", "").empty()) {
        loge("QT_ADMIN_PASSWORD must be set when running on a hosting platform");
        return 1;
    }

    string dataDir = getenvOr("QT_DATA", "data");

    string secret = getenvOr("QT_JWT_SECRET", "");

    if (secret.empty()) {
        secret = crypto::randomHex(32);

        logw(
            "QT_JWT_SECRET not set - generated a random one "
            "(sessions reset on restart)"
        );
    }

    string fe = getenvOr("QT_FRONTEND", "");

    if (fe.empty()) {
        for (const char* c : {
            "../frontend",
            "frontend",
            "../../frontend"
        }) {
            if (exists(string(c) + "/index.html")) {
                fe = c;
                break;
            }
        }
    }

    if (argc > 1)
        port = atoi(argv[1]);

    MKDIR(dataDir.c_str());

    App app(dev, dataDir, secret);

    g_http = &app.http;

    app.http.setStaticDir(fe);

    app.wire();
    app.registerRoutes();

    if (!app.load() || app.auth.all().empty())
        app.seed();

    app.pf.sampleEquity(
        [&](const string& s) {
            return app.feed.last(s);
        },
        nowMs()
    );

    app.engine.start();
    app.hub.start();
    app.feed.start();

    if (!app.http.listen(port))
        return 1;

    signal(SIGINT, onSignal);
    signal(SIGTERM, onSignal);

    thread saver([&] {
        int i = 0;

        while (!g_stop) {
            this_thread::sleep_for(chrono::milliseconds(500));

            if (++i >= 60) {
                i = 0;
                app.save();
            }
        }
    });

    logi(
        "QuantumTrade running on http://localhost:" +
        to_string(port) +
        (fe.empty()
            ? "  (frontend folder NOT found - set QT_FRONTEND)"
            : "  frontend: " + fe) +
        (dev ? "  [dev mode]" : "  [production mode]")
    );

    app.http.serve();

    logi("Shutting down...");

    g_stop = true;
    saver.join();

    app.feed.stop();
    app.hub.stop();
    app.engine.stop();

    app.save();

    logi("Saved. Bye.");

    return 0;
}
