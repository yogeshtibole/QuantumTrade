
 // AI assistant (Bramha / Sars): chat, voice in English/Hindi/Marathi,
// analysis, sentiment, forecast and portfolio suggestions.

import { get, set } from '../src/store.js';
import { api } from '../src/api.js';
import { $, $$, esc, fmt, pct, cls } from '../src/utils.js';
import { lineChart } from '../charts/line.js';
import { toast } from '../components/ui.js';
import {
  listen,
  speak,
  stopSpeaking,
  voiceSupported
} from '../hooks/useVoice.js';

const NAMES = {
  Bramha: 'ब्रह्मा',
  Sars: 'सर्स'
};

const LANGUAGES = new Set(['en', 'hi', 'mr']);

const PROMPTS = {
  en: [
    ['Market Pulse', 'news'],
    ['Stock analysis', 'analyse RELIANCE'],
    ['Sentiment', 'sentiment for TCS'],
    ['Price prediction', 'forecast INFY'],
    ['Portfolio', 'suggest portfolio changes']
  ],
  hi: [
    ['बाज़ार की नब्ज़', 'news'],
    ['स्टॉक विश्लेषण', 'RELIANCE analyse'],
    ['सेंटिमेंट', 'TCS सेंटिमेंट'],
    ['भाव अनुमान', 'INFY अनुमान'],
    ['पोर्टफोलियो', 'पोर्टफोलियो सुझाव']
  ],
  mr: [
    ['बाजार स्थिती', 'बातम्या'],
    ['स्टॉक विश्लेषण', 'RELIANCE analyse'],
    ['सेंटिमेंट', 'TCS सेंटिमेंट'],
    ['किंमत अंदाज', 'INFY अंदाज'],
    ['पोर्टफोलिओ', 'पोर्टफोलिओ सूचना']
  ]
};

const isObject = value =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value);

const toNumber = value => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const safeNumber = value => toNumber(value) ?? 0;

const safeArray = value => Array.isArray(value) ? value : [];

const validSymbol = value => {
  const symbol = String(value ?? '').trim();

  return /^[A-Z0-9._-]{1,20}$/i.test(symbol)
    ? symbol
    : '';
};

const validLanguage = value =>
  LANGUAGES.has(value) ? value : 'en';

const validName = value =>
  Object.hasOwn(NAMES, value) ? value : 'Bramha';

export default async function assistantPage(el) {
  if (!el) return;

  const me = get()?.user || {};

  let name = validName(me.ai_name);
  let lang = validLanguage(me.lang);
  let speakOn = false;
  let rec = null;
  let busy = false;
  let mounted = true;
  let requestId = 0;
  let analysisId = 0;

  const off = [];

  el.innerHTML = `
    <div class="pt-4 grid lg:grid-cols-12 gap-3">
      <section class="glass p-4 lg:col-span-7 flex flex-col"
        style="min-height:70vh">

        <div class="flex flex-wrap items-center gap-2 mb-3">
          <div id="names" class="flex flex-wrap gap-1"></div>

          <select id="lang" class="input !w-auto !py-1.5"
            aria-label="Assistant language">
            <option value="en">English</option>
            <option value="hi">हिन्दी</option>
            <option value="mr">मराठी</option>
          </select>

          <label class="text-xs mu flex items-center gap-1 ml-auto">
            <input type="checkbox" id="spk">
            Speak replies
          </label>
        </div>

        <div id="chat"
          class="flex-1 flex flex-col gap-2 overflow-auto pr-1"
          style="max-height:52vh"
          aria-live="polite"
          aria-label="Chat messages">
        </div>

        <div id="pr" class="mt-3 flex flex-wrap gap-1"></div>

        <div class="flex gap-2 mt-2">
          <input id="q" class="input" maxlength="500"
            placeholder="Ask anything about the market…"
            aria-label="Your message">

          <button id="mic" class="btn" type="button"
            title="Voice input" aria-label="Voice input">
            🎤
          </button>

          <button id="send" class="btn btn-p" type="button">
            Send
          </button>
        </div>

        <p class="text-[11px] mu mt-2">
          Rule-based analytics on simulated data (not an LLM,
          not investment advice). Voice requires browser support;
          Hindi and Marathi voices depend on your device.
        </p>
      </section>

      <section class="lg:col-span-5 grid gap-3 content-start">
        <div class="glass p-4" id="an">
          <h3 class="text-sm mu">Analysis</h3>
          <p class="mu text-sm mt-2">
            Ask about a stock to see indicators, sentiment and
            the forecast here.
          </p>
        </div>
      </section>
    </div>
  `;

  const $id = id => el.querySelector(`#${id}`);
  const $$id = selector => el.querySelectorAll(selector);

  const greeting = () => ({
    en: `Hey, I'm ${name}. How can I help you today?`,
    hi: `नमस्ते, मैं ${NAMES[name]} हूँ। मैं आपकी कैसे मदद कर सकता हूँ?`,
    mr: `नमस्कार, मी ${NAMES[name]} आहे. मी तुम्हाला कशी मदत करू?`
  })[lang];

  function say(who, message) {
    if (!mounted) return;

    const chat = $id('chat');
    if (!chat) return;

    const bubble = document.createElement('div');

    bubble.className =
      'chat-b ' + (who === 'u' ? 'chat-u' : 'chat-a');

    // Use textContent so chat messages cannot inject HTML.
    bubble.textContent = String(message ?? '');

    chat.appendChild(bubble);
    chat.scrollTop = chat.scrollHeight;

    if (who === 'a' && speakOn) {
      speak(bubble.textContent, lang);
    }
  }

  function drawNames() {
    const host = $id('names');
    if (!host) return;

    host.innerHTML = Object.keys(NAMES).map(key => `
      <button type="button"
        class="chip ${key === name ? 'on' : ''}"
        data-n="${key}"
        aria-pressed="${key === name}">
        ✦ ${key} / ${NAMES[key]}
      </button>
    `).join('');

    $$id('[data-n]').forEach(button => {
      button.onclick = async () => {
        const nextName = button.dataset.n;

        if (!Object.hasOwn(NAMES, nextName) || nextName === name) {
          return;
        }

        const previousName = name;
        name = nextName;
        drawNames();

        try {
          const user = await api('/me/settings', {
            method: 'POST',
            body: { ai_name: name }
          });

          if (!mounted) return;

          if (user) set({ user });

          say('a', greeting());
        } catch (error) {
          if (!mounted) return;

          name = previousName;
          drawNames();

          toast(
            error?.message || 'Could not update assistant name',
            'err'
          );
        }
      };
    });
  }

  function drawPrompts() {
    const host = $id('pr');
    if (!host) return;

    host.innerHTML = PROMPTS[lang].map(([label, question], index) => `
      <button type="button" class="chip"
        data-prompt="${index}">
        ${esc(label)}
      </button>
    `).join('');

    $$id('[data-prompt]').forEach(button => {
      button.onclick = () => {
        const prompt = PROMPTS[lang][Number(button.dataset.prompt)];

        if (prompt) ask(prompt[1]);
      };
    });
  }

  function setBusy(value) {
    busy = value;

    const sendButton = $id('send');
    const input = $id('q');

    if (sendButton) {
      sendButton.disabled = busy;
      sendButton.textContent = busy ? 'Thinking…' : 'Send';
    }

    if (input) {
      input.disabled = busy;
    }
  }

  async function ask(inputText) {
    if (!mounted || busy) return;

    const input = $id('q');
    const question = String(inputText ?? input?.value ?? '').trim();

    if (!question) return;

    if (question.length > 500) {
      toast('Please keep your message within 500 characters.', 'err');
      return;
    }

    if (input) input.value = '';

    say('u', question);
    setBusy(true);

    const currentRequest = ++requestId;

    try {
      const response = await api('/ai/ask', {
        method: 'POST',
        body: {
          question,
          lang
        }
      });

      if (!mounted || currentRequest !== requestId) return;

      const result = isObject(response) ? response : {};

      if (typeof result.text === 'string' && result.text.trim()) {
        say('a', result.text);
      } else {
        say('a', 'I could not generate a response. Please try again.');
      }

      if (isObject(result.analysis)) {
        await renderAnalysis(result.analysis);
      }
    } catch (error) {
      if (!mounted || currentRequest !== requestId) return;

      say(
        'a',
        '⚠ ' + (error?.message || 'Unable to contact the assistant.')
      );
    } finally {
      if (mounted && currentRequest === requestId) {
        setBusy(false);

        if (input) input.focus();
      }
    }
  }

  async function renderAnalysis(data) {
    if (!mounted || !isObject(data)) return;

    const currentAnalysis = ++analysisId;
    const symbol = validSymbol(data.symbol);

    if (!symbol) {
      toast('The analysis returned an invalid stock symbol.', 'err');
      return;
    }

    let history = [];

    try {
      const response = await api(
        '/candles?symbol=' + encodeURIComponent(symbol) + '&limit=60'
      );

      if (!mounted || currentAnalysis !== analysisId) return;

      history = safeArray(response)
        .map(candle => Array.isArray(candle) ? toNumber(candle[4]) : null)
        .filter(value => value !== null);
    } catch {
      // Analysis can still render without historical chart data.
      history = [];
    }

    if (!mounted || currentAnalysis !== analysisId) return;

    const score = Math.max(
      -100,
      Math.min(100, safeNumber(data.score))
    );

    const gauge = (score + 100) / 2;

    const verdict = String(data.verdict || 'HOLD').toUpperCase();

    const verdictClass =
      verdict === 'BUY' ? 'up' :
      verdict === 'SELL' ? 'dn' : '';

    const sentiment = Math.max(
      0,
      Math.min(100, safeNumber(data.sentiment))
    );

    const rsi = toNumber(data.rsi);
    const macd = toNumber(data.macd_hist);
    const momentum = toNumber(data.momentum_pct);
    const volatility = toNumber(data.volatility);

    const metrics = [
      ['RSI 14', fmt(rsi)],
      ['MACD', macd === null ? 'N/A' : macd >= 0 ? 'Bullish' : 'Bearish'],
      ['Trend', String(data.trend ?? 'N/A')],
      ['SMA 20', fmt(toNumber(data.sma20))],
      ['SMA 50', fmt(toNumber(data.sma50))],
      ['ATR', fmt(toNumber(data.atr))],
      ['Momentum', momentum === null ? 'N/A' : pct(momentum)],
      [
        'Volatility',
        volatility === null ? 'N/A' : fmt(volatility * 100, 2) + '%'
      ],
      [
        'Bollinger',
        `${fmt(toNumber(data.bb_lower), 0)}-${fmt(toNumber(data.bb_upper), 0)}`
      ]
    ];

    const forecast = safeArray(data.forecast)
      .map(toNumber);

    const low = safeArray(data.forecast_low)
      .map(toNumber);

    const high = safeArray(data.forecast_high)
      .map(toNumber);

    const validForecast = forecast.every(value => value !== null);

    const validBand =
      low.length === forecast.length &&
      high.length === forecast.length &&
      low.every(value => value !== null) &&
      high.every(value => value !== null);

    const last = toNumber(data.last);
    const dayPct = toNumber(data.day_pct);

    const host = $id('an');
    if (!host) return;

    host.innerHTML = `
      <div class="flex items-center justify-between gap-2">
        <h3 class="text-lg font-medium">
          ${esc(symbol)}
          <span class="mu text-sm">
            ₹${fmt(last)}
            <span class="${dayPct === null ? '' : cls(dayPct)}">
              ${dayPct === null ? 'N/A' : esc(pct(dayPct))}
            </span>
          </span>
        </h3>

        <span class="text-xl font-semibold ${verdictClass}">
          ${esc(verdict)}
        </span>
      </div>

      <div class="h-2 rounded-full bg-white/10 mt-3 relative"
        title="Signal score ${fmt(score, 0)}">
        <div style="position:absolute;left:${gauge}%;top:-4px;
          width:4px;height:16px;background:#fff;border-radius:2px">
        </div>
        <div class="h-full rounded-full"
          style="background:linear-gradient(90deg,#ff5b6e,#f5c542,#2ee59d)">
        </div>
      </div>

      <div class="flex justify-between text-[10px] mu mt-1">
        <span>Sell</span>
        <span>Hold</span>
        <span>Buy</span>
      </div>

      <div class="grid grid-cols-3 gap-2 mt-3 text-xs">
        ${metrics.map(([label, value]) => `
          <div class="bg-white/5 rounded-lg p-2">
            <div class="mu">${esc(label)}</div>
            <b class="num">${esc(value)}</b>
          </div>
        `).join('')}
      </div>

      <div class="mt-3 text-xs mu">
        Sentiment ${fmt(sentiment, 0)}/100
      </div>

      <div class="h-2 rounded-full bg-white/10 overflow-hidden">
        <div style="width:${sentiment}%;height:100%;
          background:linear-gradient(90deg,#ff5b6e,#2ee59d)">
        </div>
      </div>

      <h4 class="text-sm mu mt-4 mb-1">
        Price prediction (next 30 candles, 90% range)
      </h4>

      <div id="fc" style="height:190px"></div>

      <a href="#/trade?symbol=${encodeURIComponent(symbol)}"
        class="btn btn-sm mt-3">
        Open ${esc(symbol)} terminal
      </a>

      <p class="text-[11px] mu mt-2">
        Signals and forecasts are estimates, not guaranteed outcomes.
      </p>
    `;

    const chart = $id('fc');
    if (!chart) return;

    const series = [];

    if (history.length) {
      series.push({
        data: history,
        color: '#9a95b8',
        width: 1.6
      });
    }

    if (forecast.length && validForecast) {
      const forecastSeries = {
        data: forecast,
        offset: history.length,
        color: '#d46bd6',
        dash: [5, 4]
      };

      if (validBand) {
        forecastSeries.band = forecast.map((_, index) => [
          low[index],
          high[index]
        ]);
      }

      series.push(forecastSeries);
    }

    if (series.length) {
      lineChart(chart, {
        total: history.length + forecast.length,
        series
      });
    } else {
      chart.innerHTML = `
        <p class="mu text-xs mt-4">
          No historical or forecast data is available for this chart.
        </p>
      `;
    }
  }

  const languageSelect = $id('lang');
  languageSelect.value = lang;

  languageSelect.onchange = async event => {
    const nextLanguage = validLanguage(event.target.value);
    const previousLanguage = lang;

    lang = nextLanguage;
    drawPrompts();

    try {
      const user = await api('/me/settings', {
        method: 'POST',
        body: { lang }
      });

      if (!mounted) return;

      if (user) set({ user });
    } catch (error) {
      if (!mounted) return;

      // Keep the selected language for this session even if
      // saving the preference fails.
      toast(
        error?.message || 'Could not save language preference',
        'err'
      );
    }

    if (mounted && previousLanguage !== lang) {
      say('a', greeting());
    }
  };

  $id('spk').onchange = event => {
    speakOn = event.target.checked;

    if (!speakOn) {
      stopSpeaking();
    }
  };

  $id('send').onclick = () => ask();

  $id('q').onkeydown = event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      ask();
    }
  };

  $id('mic').onclick = () => {
    if (rec) {
      try {
        rec.stop();
      } catch {
        // Recognition may already have stopped.
      }
      return;
    }

    if (!voiceSupported()) {
      toast(
        'Voice input is not supported in this browser. Try Chrome or Edge.',
        'err'
      );
      return;
    }

    const mic = $id('mic');
    if (!mic) return;

    mic.textContent = '⏺';
    mic.disabled = true;

    const recognition = listen(
      lang,
      transcript => {
        if (!mounted) return;

        const input = $id('q');
        if (!input) return;

        input.value = String(transcript ?? '').slice(0, 500);

        // Wait for recognition to finish before sending.
        ask(input.value);
      },
      () => {
        if (rec === recognition) {
          rec = null;
        }

        if (mounted) {
          const currentMic = $id('mic');

          if (currentMic) {
            currentMic.textContent = '🎤';
            currentMic.disabled = false;
          }
        }
      }
    );

    if (!recognition) {
      mic.textContent = '🎤';
      mic.disabled = false;

      toast('Could not start voice recognition.', 'err');
      return;
    }

    rec = recognition;
  };

  drawNames();
  drawPrompts();
  say('a', greeting());

  off.push(() => {
    mounted = false;
    requestId++;
    analysisId++;

    stopSpeaking();

    if (rec) {
      try {
        rec.stop();
      } catch {
        // Recognition may already have stopped.
      }

      rec = null;
    }
  });

  // Call when navigating away from the assistant page.
  return () => off.forEach(cleanup => cleanup());
}
