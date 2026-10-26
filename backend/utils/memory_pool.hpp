#pragma once

// Fixed-block object pool with a free list.
// Single-owner (the matching-engine thread); grows by whole blocks.

#include <memory>
#include <vector>

using namespace std;

namespace qt {

template <typename T>
class MemoryPool {
    size_t block_;
    vector<unique_ptr<T[]>> blocks_;
    vector<T*> free_;
    size_t live_ = 0;

    void grow() {
        blocks_.emplace_back(new T[block_]);

        T* p = blocks_.back().get();

        for (size_t i = block_; i-- > 0;)
            free_.push_back(p + i);
    }

public:
    explicit MemoryPool(size_t block = 4096)
        : block_(block) {
        grow();
    }

    T* alloc() {
        if (free_.empty())
            grow();

        T* p = free_.back();
        free_.pop_back();

        *p = T();
        ++live_;

        return p;
    }

    void release(T* p) {
        free_.push_back(p);
        --live_;
    }

    size_t live() const {
        return live_;
    }

    size_t capacity() const {
        return blocks_.size() * block_;
    }
};

} // namespace qt