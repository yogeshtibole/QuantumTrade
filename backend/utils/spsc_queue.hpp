#pragma once

// Lock-free single-producer / single-consumer ring buffer
// (acquire/release atomics).

#include <array>
#include <atomic>
#include <cstddef>
#include <utility>

using namespace std;

namespace qt {

template <typename T, size_t N>
class SpscQueue {
    array<T, N> buf_;

    alignas(64) atomic<size_t> head_{0};
    alignas(64) atomic<size_t> tail_{0};

public:
    bool push(const T& v) {
        size_t t = tail_.load(memory_order_relaxed);
        size_t n = (t + 1) % N;

        if (n == head_.load(memory_order_acquire))
            return false;

        buf_[t] = v;
        tail_.store(n, memory_order_release);

        return true;
    }

    bool pop(T& v) {
        size_t h = head_.load(memory_order_relaxed);

        if (h == tail_.load(memory_order_acquire))
            return false;

        v = move(buf_[h]);
        head_.store((h + 1) % N, memory_order_release);

        return true;
    }

    size_t size() const {
        size_t t = tail_.load();
        size_t h = head_.load();

        return (t + N - h) % N;
    }
};

} // namespace qt