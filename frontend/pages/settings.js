
 // Settings: profile, assistant name/language, 2FA, KYC, and login history.
import { api } from '../src/api.js';
import { get, set } from '../src/store.js';
import { $, esc, dateTime } from '../src/utils.js';
import { table, toast } from '../components/ui.js';

const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const CODE_PATTERN = /^\d{6}$/;

const asArray = value => Array.isArray(value) ? value : [];
const text = value => String(value ?? '');
const errorMessage = error => error?.message || 'Something went wrong. Please try again.';

export default async function (el) {
  let me = get()?.user || {};
  let hist = [];
  let setupData = null;
  let destroyed = false;
  const busy = new Set();

  el.innerHTML = '<div class="pt-8 text-center"><span class="spin"></span><p class="mu text-sm mt-2">Loading settings…</p></div>';

  function notifyError(error) {
    toast(errorMessage(error), 'err');
  }

  function refreshUser(user) {
    if (user && typeof user === 'object') {
      me = user;
      set({ user: me });
    }
  }

  function actionButton(action, label, className = 'btn') {
    return `<button type="button" class="${className}" data-action="${action}">${label}</button>`;
  }

  function renderTwoFactor() {
    const box = document.createElement('div');
    box.className = 'mt-3';

    if (me.two_factor) {
      box.innerHTML = `
        <p class="text-sm">Status:
          <b class="up">Enabled</b>
        </p>
        <div class="mt-3 grid gap-2">
          <label class="lbl" for="dp">Password</label>
          <input id="dp" type="password" class="input"
            autocomplete="current-password" placeholder="Enter your password">

          <label class="lbl" for="dc">Authenticator code</label>
          <input id="dc" class="input" maxlength="6" inputmode="numeric"
            autocomplete="one-time-code" placeholder="6-digit code">

          ${actionButton('disable-2fa', 'Disable 2FA', 'btn btn-dn mt-2')}
        </div>
      `;
      return box.innerHTML;
    }

    if (setupData) {
      return `
        <p class="text-sm">Status: <b class="mu">Not enabled yet</b></p>
        <p class="text-xs mu mt-3">
          Add this key to your authenticator app using a time-based setup.
          Keep this secret private.
        </p>
        <div class="font-mono text-sm bg-white/5 rounded-lg p-2 my-2 break-all select-all">
          ${esc(setupData.secret)}
        </div>
        <p class="text-[11px] mu break-all">${esc(setupData.uri)}</p>
        <label class="lbl" for="ec">6-digit confirmation code</label>
        <input id="ec" class="input" maxlength="6" inputmode="numeric"
          autocomplete="one-time-code" placeholder="123456">
        <div class="flex flex-wrap gap-2 mt-3">
          ${actionButton('enable-2fa', 'Enable 2FA', 'btn btn-p')}
          ${actionButton('cancel-2fa', 'Cancel setup', 'btn')}
        </div>
      `;
    }

    return `
      <p class="text-sm">Status: <b class="mu">Off</b></p>
      <p class="text-xs mu mt-2">
        Use an authenticator app to generate time-based verification codes.
      </p>
      ${actionButton('setup-2fa', 'Set up 2FA', 'btn mt-3')}
    `;
  }

  function renderHistory() {
    return table(
      ['When', 'Result', 'IP', 'Device'],
      hist.map(item => {
        const result = text(item.result || 'Unknown');
        const device = text(item.device || 'Unknown device');

        return [
          dateTime(item.ts),
          `<span class="${/fail/i.test(result) ? 'dn' : 'up'}">${esc(result)}</span>`,
          esc(item.ip || '—'),
          `<span class="mu" title="${esc(device)}">${esc(device.slice(0, 50))}</span>`
        ];
      }),
      'No history yet'
    );
  }

  function draw() {
    if (destroyed) return;

    const name = text(me.name);
    const email = text(me.email);
    const aiName = text(me.ai_name || 'Bramha');
    const language = text(me.lang || 'en');
    const kyc = text(me.kyc || 'not submitted');
    const verified = kyc.toLowerCase() === 'verified';
    const pending = kyc.toLowerCase() === 'pending';

    el.innerHTML = `
      <div class="pt-4 grid gap-3 max-w-4xl mx-auto">
        <h2 class="text-xl">Settings</h2>

        <div class="grid md:grid-cols-2 gap-3">
          <section class="glass p-4">
            <h3 class="text-sm mu mb-2">Profile &amp; assistant</h3>

            <label class="lbl" for="nm">Name</label>
            <input id="nm" class="input" maxlength="100"
              autocomplete="name" value="${esc(name)}">

            <label class="lbl mt-3" for="email">Email</label>
            <input id="email" class="input" value="${esc(email)}" disabled>

            <label class="lbl mt-3" for="ai">AI assistant name</label>
            <select id="ai" class="input">
              <option value="Bramha">Bramha (ब्रह्मा)</option>
              <option value="Sars">Sars (सर्स)</option>
            </select>

            <label class="lbl mt-3" for="lg">Assistant language</label>
            <select id="lg" class="input">
              <option value="en">English</option>
              <option value="hi">हिन्दी</option>
              <option value="mr">मराठी</option>
            </select>

            <button id="sv" data-action="save-profile"
              type="button" class="btn btn-p mt-4">Save settings</button>
          </section>

          <section class="glass p-4">
            <h3 class="text-sm mu mb-2">Two-factor authentication</h3>
            <div id="tf">${renderTwoFactor()}</div>
          </section>

          <section class="glass p-4">
            <h3 class="text-sm mu mb-2">KYC verification</h3>
            <p class="text-sm">
              Status:
              <b class="${verified ? 'up' : pending ? 'mu' : ''}">${esc(kyc)}</b>
            </p>

            ${verified
              ? '<p class="text-xs mu mt-2">KYC is verified. Withdrawals remain subject to server-side checks.</p>'
              : pending
                ? '<p class="text-xs mu mt-2">Your verification request is under review.</p>'
                : `
                  <label class="lbl mt-3" for="pan">PAN number</label>
                  <input id="pan" class="input" placeholder="ABCDE1234F"
                    maxlength="10" autocapitalize="characters"
                    autocomplete="off">
                  ${actionButton('submit-kyc', 'Submit for verification', 'btn mt-3')}
                `
            }
          </section>
        </div>

        <section class="glass p-4">
          <h3 class="text-sm mu mb-2">Device &amp; login history</h3>
          <div id="hs">${renderHistory()}</div>
        </section>
      </div>
    `;

    const ai = el.querySelector('#ai');
    const languageSelect = el.querySelector('#lg');

    if ([...ai.options].some(option => option.value === aiName)) {
      ai.value = aiName;
    }

    if ([...languageSelect.options].some(option => option.value === language)) {
      languageSelect.value = language;
    }
  }

  async function runAction(name, button, action) {
    if (busy.has(name) || destroyed) return;

    busy.add(name);
    if (button) button.disabled = true;

    try {
      await action();
    } catch (error) {
      if (!destroyed) notifyError(error);
    } finally {
      busy.delete(name);
      if (button?.isConnected) button.disabled = false;
    }
  }

  async function saveProfile() {
    const nameInput = el.querySelector('#nm');
    const name = nameInput?.value.trim() || '';
    const aiName = el.querySelector('#ai')?.value;
    const language = el.querySelector('#lg')?.value;

    if (!name) {
      toast('Please enter your name.', 'err');
      nameInput?.focus();
      return;
    }

    if (name.length > 100) {
      toast('Name must be 100 characters or fewer.', 'err');
      nameInput?.focus();
      return;
    }

    if (!['Bramha', 'Sars'].includes(aiName)) {
      toast('Choose a valid assistant name.', 'err');
      return;
    }

    if (!['en', 'hi', 'mr'].includes(language)) {
      toast('Choose a valid language.', 'err');
      return;
    }

    const updated = await api('/me/settings', {
      method: 'POST',
      body: { name, ai_name: aiName, lang: language }
    });

    refreshUser(updated);
    toast('Settings saved.', 'ok');
    draw();
  }

  async function submitKyc() {
    const input = el.querySelector('#pan');
    const pan = (input?.value || '').trim().toUpperCase();

    if (!PAN_PATTERN.test(pan)) {
      toast('Enter a valid PAN number, for example ABCDE1234F.', 'err');
      input?.focus();
      return;
    }

    await api('/kyc', {
      method: 'POST',
      body: { pan }
    });

    const updated = await api('/me');
    refreshUser(updated);
    toast('KYC submitted for review.', 'ok');
    draw();
  }

  async function setupTwoFactor() {
    const result = await api('/auth/2fa/setup', { method: 'POST' });

    if (!result?.secret || !result?.uri) {
      throw new Error('The server did not return valid 2FA setup details.');
    }

    setupData = { secret: result.secret, uri: result.uri };
    draw();
  }

  async function enableTwoFactor() {
    const code = el.querySelector('#ec')?.value.trim() || '';

    if (!CODE_PATTERN.test(code)) {
      toast('Enter the 6-digit authenticator code.', 'err');
      el.querySelector('#ec')?.focus();
      return;
    }

    await api('/auth/2fa/enable', {
      method: 'POST',
      body: { code }
    });

    setupData = null;
    refreshUser(await api('/me'));
    toast('Two-factor authentication enabled.', 'ok');
    draw();
  }

  async function disableTwoFactor() {
    const password = el.querySelector('#dp')?.value || '';
    const code = el.querySelector('#dc')?.value.trim() || '';

    if (!password) {
      toast('Enter your password to disable 2FA.', 'err');
      el.querySelector('#dp')?.focus();
      return;
    }

    if (!CODE_PATTERN.test(code)) {
      toast('Enter the 6-digit authenticator code.', 'err');
      el.querySelector('#dc')?.focus();
      return;
    }

    await api('/auth/2fa/disable', {
      method: 'POST',
      body: { password, code }
    });

    setupData = null;
    refreshUser(await api('/me'));
    toast('Two-factor authentication disabled.', 'ok');
    draw();
  }

  async function handleClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button || !el.contains(button)) return;

    const action = button.dataset.action;

    if (action === 'save-profile') {
      await runAction(action, button, saveProfile);
    } else if (action === 'submit-kyc') {
      await runAction(action, button, submitKyc);
    } else if (action === 'setup-2fa') {
      await runAction(action, button, setupTwoFactor);
    } else if (action === 'enable-2fa') {
      await runAction(action, button, enableTwoFactor);
    } else if (action === 'disable-2fa') {
      await runAction(action, button, disableTwoFactor);
    } else if (action === 'cancel-2fa') {
      setupData = null;
      draw();
    }
  }

  el.addEventListener('click', handleClick);

  try {
    const results = await Promise.allSettled([
      api('/me'),
      api('/me/history')
    ]);

    if (destroyed) return () => {};

    if (results[0].status === 'fulfilled') {
      refreshUser(results[0].value);
    } else {
      toast('Could not refresh your profile. Showing saved session data.', 'err');
    }

    if (results[1].status === 'fulfilled') {
      hist = asArray(results[1].value);
    } else {
      hist = [];
      toast('Could not load login history.', 'err');
    }
  } catch (error) {
    if (!destroyed) notifyError(error);
  }

  draw();

  return () => {
    destroyed = true;
    setupData = null;
    el.removeEventListener('click', handleClick);
  };
}
