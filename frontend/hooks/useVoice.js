
 // Browser speech recognition and speech synthesis.
// Hindi and Marathi support depends on the browser and installed voices.

const LANG = {
  en: 'en-IN',
  hi: 'hi-IN',
  mr: 'mr-IN'
};

const getRecognition = () =>
  typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

export const voiceSupported = () =>
  !!getRecognition();

export function listen(lang, onText, onEnd) {
  const Recognition = getRecognition();

  if (!Recognition) return null;

  const recognition = new Recognition();

  recognition.lang = LANG[lang] || LANG.en;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  let finished = false;

  const finish = event => {
    if (finished) return;
    finished = true;

    if (typeof onEnd === 'function') {
      onEnd(event);
    }
  };

  recognition.onresult = event => {
    const transcript =
      event.results?.[0]?.[0]?.transcript;

    if (
      typeof transcript === 'string' &&
      typeof onText === 'function'
    ) {
      onText(transcript);
    }
  };

  recognition.onerror = event => {
    finish(event);
  };

  recognition.onend = event => {
    finish(event);
  };

  try {
    recognition.start();
    return recognition;
  } catch (error) {
    finish(error);
    return null;
  }
}

export function speak(text, lang) {
  if (
    typeof window === 'undefined' ||
    !('speechSynthesis' in window) ||
    typeof SpeechSynthesisUtterance === 'undefined'
  ) {
    return;
  }

  const message = String(text ?? '').trim();

  if (!message) return;

  const synthesis = window.speechSynthesis;
  const utterance = new SpeechSynthesisUtterance(message);

  utterance.lang = LANG[lang] || LANG.en;

  // Prefer a voice matching the selected language.
  const voices = synthesis.getVoices();

  const voice =
    voices.find(item => item.lang === utterance.lang) ||
    voices.find(item =>
      item.lang?.toLowerCase().startsWith(
        utterance.lang.split('-')[0].toLowerCase() + '-'
      )
    );

  if (voice) {
    utterance.voice = voice;
  }

  // Stop previous speech before starting new speech.
  synthesis.cancel();
  synthesis.speak(utterance);
}

export const stopSpeaking = () => {
  if (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window
  ) {
    window.speechSynthesis.cancel();
    return true;
  }

  return false;
};
