
 // Technical indicators: SMA, EMA, RSI, MACD, Bollinger Bands and VWAP.

const validPeriod = n =>
  Number.isInteger(n) && n > 0;

const validNumber = value =>
  Number.isFinite(Number(value));

export const sma = (x, n) => {
  if (!Array.isArray(x) || !validPeriod(n)) {
    return [];
  }

  const result = new Array(x.length).fill(NaN);
  let sum = 0;
  let invalidCount = 0;

  for (let i = 0; i < x.length; i++) {
    const value = Number(x[i]);

    if (Number.isFinite(value)) {
      sum += value;
    } else {
      invalidCount++;
    }

    if (i >= n) {
      const oldValue = Number(x[i - n]);

      if (Number.isFinite(oldValue)) {
        sum -= oldValue;
      } else {
        invalidCount--;
      }
    }

    if (i >= n - 1 && invalidCount === 0) {
      result[i] = sum / n;
    }
  }

  return result;
};

export const ema = (x, n) => {
  if (!Array.isArray(x) || !validPeriod(n)) {
    return [];
  }

  const alpha = 2 / (n + 1);
  const result = new Array(x.length).fill(NaN);
  let previous = NaN;

  for (let i = 0; i < x.length; i++) {
    const value = Number(x[i]);

    if (!Number.isFinite(value)) {
      previous = NaN;
      continue;
    }

    previous = Number.isFinite(previous)
      ? alpha * value + (1 - alpha) * previous
      : value;

    result[i] = previous;
  }

  return result;
};

export function rsi(c, n = 14) {
  if (!Array.isArray(c) || !validPeriod(n)) {
    return [];
  }

  const result = new Array(c.length).fill(NaN);

  if (c.length <= n) {
    return result;
  }

  let gains = 0;
  let losses = 0;

  // Calculate the initial average gain and loss.
  for (let i = 1; i <= n; i++) {
    const current = Number(c[i]);
    const previous = Number(c[i - 1]);

    if (!Number.isFinite(current) || !Number.isFinite(previous)) {
      return result;
    }

    const change = current - previous;

    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }

  gains /= n;
  losses /= n;

  const calculateRSI = (avgGain, avgLoss) => {
    if (avgGain === 0 && avgLoss === 0) return 50;
    if (avgLoss === 0) return 100;
    if (avgGain === 0) return 0;

    return 100 - 100 / (1 + avgGain / avgLoss);
  };

  result[n] = calculateRSI(gains, losses);

  // Wilder's smoothing method.
  for (let i = n + 1; i < c.length; i++) {
    const current = Number(c[i]);
    const previous = Number(c[i - 1]);

    if (!Number.isFinite(current) || !Number.isFinite(previous)) {
      gains = 0;
      losses = 0;
      continue;
    }

    const change = current - previous;
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);

    gains = (gains * (n - 1) + gain) / n;
    losses = (losses * (n - 1) + loss) / n;

    result[i] = calculateRSI(gains, losses);
  }

  return result;
}

export function macd(c) {
  if (!Array.isArray(c)) {
    return {
      macd: [],
      signal: [],
      hist: []
    };
  }

  const e12 = ema(c, 12);
  const e26 = ema(c, 26);

  const line = e12.map((value, i) => {
    if (!Number.isFinite(value) || !Number.isFinite(e26[i])) {
      return NaN;
    }

    return value - e26[i];
  });

  const signal = new Array(line.length).fill(NaN);
  const hist = new Array(line.length).fill(NaN);

  // Start the signal EMA after the MACD line has valid values.
  let alpha = 2 / (9 + 1);
  let previous = NaN;
  let count = 0;

  for (let i = 0; i < line.length; i++) {
    const value = line[i];

    if (!Number.isFinite(value)) {
      previous = NaN;
      count = 0;
      continue;
    }

    previous = Number.isFinite(previous)
      ? alpha * value + (1 - alpha) * previous
      : value;

    count++;

    if (count >= 9) {
      signal[i] = previous;
      hist[i] = value - previous;
    }
  }

  return {
    macd: line,
    signal,
    hist
  };
}

export function bollinger(c, n = 20, k = 2) {
  if (
    !Array.isArray(c) ||
    !validPeriod(n) ||
    !Number.isFinite(k) ||
    k < 0
  ) {
    return {
      mid: [],
      up: [],
      lo: []
    };
  }

  const mid = sma(c, n);

  const sd = c.map((_, i) => {
    if (i + 1 < n || !Number.isFinite(mid[i])) {
      return NaN;
    }

    const start = i + 1 - n;
    let sumSquares = 0;

    for (let j = start; j <= i; j++) {
      const value = Number(c[j]);

      if (!Number.isFinite(value)) {
        return NaN;
      }

      sumSquares += (value - mid[i]) ** 2;
    }

    return Math.sqrt(sumSquares / n);
  });

  return {
    mid,
    up: mid.map((value, i) =>
      Number.isFinite(value) && Number.isFinite(sd[i])
        ? value + k * sd[i]
        : NaN
    ),
    lo: mid.map((value, i) =>
      Number.isFinite(value) && Number.isFinite(sd[i])
        ? value - k * sd[i]
        : NaN
    )
  };
}

export function vwap(data, n = 50) {
  if (!Array.isArray(data) || !validPeriod(n)) {
    return [];
  }

  return data.map((_, i) => {
    const start = Math.max(0, i + 1 - n);
    let priceVolume = 0;
    let volume = 0;

    for (let j = start; j <= i; j++) {
      const candle = data[j];

      const high = Number(candle?.h);
      const low = Number(candle?.l);
      const close = Number(candle?.c);
      const vol = Number(candle?.v);

      if (
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(close) ||
        !Number.isFinite(vol) ||
        vol < 0
      ) {
        return NaN;
      }

      const typicalPrice = (high + low + close) / 3;

      priceVolume += typicalPrice * vol;
      volume += vol;
    }

    return volume > 0 ? priceVolume / volume : NaN;
  });
}
