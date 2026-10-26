
 // WebSocket client with auto-reconnect, topic re-subscription,
// and typed event handlers.

import { get, set } from '../src/store.js';

let ws = null;
let closing = false;
let retry = 0;
let reconnectTimer = null;
let connectionGeneration = 0;

const topics = new Set();
const handlers = new Map();

const MAX_RETRY_DELAY = 10000;
const BASE_RETRY_DELAY = 500;
const MAX_RETRIES = 10;

const emit = (type, message) => {
  const listeners = handlers.get(type);

  if (!listeners) return;

  // Copy listeners so they can safely unsubscribe during emission.
  for (const listener of [...listeners]) {
    try {
      listener(message);
    } catch (error) {
      console.error(`WebSocket handler error (${type}):`, error);
    }
  }
};

const send = message => {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return false;
  }

  try {
    ws.send(JSON.stringify(message));
    return true;
  } catch (error) {
    console.error('WebSocket send failed:', error);
    return false;
  }
};

function clearReconnectTimer() {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect() {
  if (closing || reconnectTimer !== null) return;

  if (retry >= MAX_RETRIES) {
    console.warn('WebSocket: maximum reconnect attempts reached.');
    return;
  }

  const delay = Math.min(
    MAX_RETRY_DELAY,
    BASE_RETRY_DELAY * 2 ** retry
  );

  retry++;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;

    if (!closing) {
      wsConnect();
    }
  }, delay);
}

export function wsConnect() {
  if (
    typeof window === 'undefined' ||
    typeof WebSocket === 'undefined'
  ) {
    return;
  }

  // Avoid opening duplicate connections.
  if (
    ws &&
    (ws.readyState === WebSocket.CONNECTING ||
      ws.readyState === WebSocket.OPEN)
  ) {
    return;
  }

  closing = false;
  clearReconnectTimer();

  const generation = ++connectionGeneration;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = get()?.token;

  const url =
    `${protocol}//${location.host}/ws` +
    (token ? `?token=${encodeURIComponent(token)}` : '');

  let socket;

  try {
    socket = new WebSocket(url);
  } catch (error) {
    console.error('WebSocket connection failed:', error);
    set({ wsStatus: 'closed' });
    scheduleReconnect();
    return;
  }

  ws = socket;

  socket.onopen = () => {
    if (generation !== connectionGeneration) {
      socket.close();
      return;
    }

    retry = 0;
    set({ wsStatus: 'open' });

    if (topics.size) {
      send({ op: 'sub', topics: [...topics] });
    }

    emit('open', { t: 'open' });
  };

  socket.onmessage = event => {
    if (generation !== connectionGeneration) return;

    try {
      const message = JSON.parse(event.data);

      if (message && typeof message.t === 'string') {
        emit(message.t, message);
      }
    } catch (error) {
      console.warn('WebSocket received invalid JSON:', error);
    }
  };

  socket.onerror = error => {
    if (generation !== connectionGeneration) return;

    console.warn('WebSocket connection error:', error);
    emit('error', { t: 'error', error });
  };

  socket.onclose = event => {
    if (generation !== connectionGeneration) return;

    ws = null;
    set({ wsStatus: 'closed' });

    emit('close', {
      t: 'close',
      code: event.code,
      reason: event.reason,
      wasClean: event.wasClean
    });

    if (!closing) {
      scheduleReconnect();
    }
  };
}

export function wsReconnect() {
  closing = false;
  retry = 0;

  clearReconnectTimer();

  // Invalidate callbacks from the previous connection.
  connectionGeneration++;

  const previous = ws;
  ws = null;

  if (previous) {
    previous.onopen = null;
    previous.onmessage = null;
    previous.onerror = null;
    previous.onclose = null;

    try {
      previous.close();
    } catch (error) {
      console.warn('WebSocket close failed:', error);
    }
  }

  set({ wsStatus: 'closed' });
  wsConnect();
}

export function wsDisconnect() {
  closing = true;
  clearReconnectTimer();

  // Invalidate callbacks and prevent automatic reconnection.
  connectionGeneration++;

  const previous = ws;
  ws = null;

  if (previous) {
    previous.onopen = null;
    previous.onmessage = null;
    previous.onerror = null;
    previous.onclose = null;

    try {
      previous.close();
    } catch (error) {
      console.warn('WebSocket close failed:', error);
    }
  }

  set({ wsStatus: 'closed' });
}

export const wsSub = input => {
  const requestedTopics = Array.isArray(input) ? input : [input];

  const added = requestedTopics.filter(
    topic => typeof topic === 'string' &&
      topic.length > 0 &&
      !topics.has(topic)
  );

  added.forEach(topic => topics.add(topic));

  if (added.length) {
    send({ op: 'sub', topics: added });
  }
};

export const wsUnsub = input => {
  const requestedTopics = Array.isArray(input) ? input : [input];

  const removed = requestedTopics.filter(
    topic => typeof topic === 'string' && topics.has(topic)
  );

  removed.forEach(topic => topics.delete(topic));

  if (removed.length) {
    send({ op: 'unsub', topics: removed });
  }
};

export function wsOn(type, fn) {
  if (typeof type !== 'string' || typeof fn !== 'function') {
    return () => {};
  }

  if (!handlers.has(type)) {
    handlers.set(type, new Set());
  }

  const listeners = handlers.get(type);
  listeners.add(fn);

  return () => {
    listeners.delete(fn);

    if (listeners.size === 0) {
      handlers.delete(type);
    }
  };
}
