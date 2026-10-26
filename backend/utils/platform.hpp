#pragma once

// Cross-platform socket shim (Winsock on Windows, BSD sockets elsewhere).

using namespace std;

#ifdef _WIN32

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif

#include <winsock2.h>
#include <ws2tcpip.h>

namespace qt {

using sock_t = SOCKET;

const sock_t BAD_SOCK = INVALID_SOCKET;
const int SEND_FLAGS = 0;

inline void sockInit() {
    WSADATA w;
    WSAStartup(MAKEWORD(2, 2), &w);
}

inline void sockClose(sock_t s) {
    closesocket(s);
}

inline void sockShutdown(sock_t s) {
    shutdown(s, SD_BOTH);
}

inline void setTimeouts(sock_t s, int ms) {
    DWORD t = ms;

    setsockopt(
        s, SOL_SOCKET, SO_RCVTIMEO,
        (const char*)&t, sizeof t
    );

    setsockopt(
        s, SOL_SOCKET, SO_SNDTIMEO,
        (const char*)&t, sizeof t
    );
}

inline void setSendTimeout(sock_t s, int ms) {
    DWORD t = ms;

    setsockopt(
        s, SOL_SOCKET, SO_SNDTIMEO,
        (const char*)&t, sizeof t
    );
}

inline void setRecvTimeout(sock_t s, int ms) {
    DWORD t = ms;

    setsockopt(
        s, SOL_SOCKET, SO_RCVTIMEO,
        (const char*)&t, sizeof t
    );
}

} // namespace qt

#else

#include <sys/socket.h>
#include <sys/time.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <signal.h>

namespace qt {

using sock_t = int;

const sock_t BAD_SOCK = -1;
const int SEND_FLAGS = MSG_NOSIGNAL;

inline void sockInit() {
    signal(SIGPIPE, SIG_IGN);
}

inline void sockClose(sock_t s) {
    ::close(s);
}

inline void sockShutdown(sock_t s) {
    ::shutdown(s, SHUT_RDWR);
}

inline void setSendTimeout(sock_t s, int ms) {
    timeval tv{ms / 1000, (ms % 1000) * 1000};

    setsockopt(
        s, SOL_SOCKET, SO_SNDTIMEO,
        &tv, sizeof tv
    );
}

inline void setRecvTimeout(sock_t s, int ms) {
    timeval tv{ms / 1000, (ms % 1000) * 1000};

    setsockopt(
        s, SOL_SOCKET, SO_RCVTIMEO,
        &tv, sizeof tv
    );
}

inline void setTimeouts(sock_t s, int ms) {
    setSendTimeout(s, ms);
    setRecvTimeout(s, ms);
}

} // namespace qt

#endif