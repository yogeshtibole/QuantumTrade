
 // Login, signup, OTP verification, 2FA, password reset and demo Google sign-in.

import { api } from '../src/api.js';
import { setSession, get } from '../src/store.js';
import { $, $$, esc, qs } from '../src/utils.js';
import { toast } from '../components/ui.js';
import { wsReconnect } from '../hooks/useWebSocket.js';

export default function (el) {
  let mode = 'login';
  let ctx = {};
  let submitting = false;
  let mounted = true;

  const LANG = {
    login: 'Log in',
    signup: 'Sign up',
    otp: 'Verify',
    twofa: 'Continue',
    forgot: 'Send reset code',
    reset: 'Reset password'
  };

  const eye = id => `
    <button type="button"
      data-eye="${id}"
      class="absolute right-3 top-[34px] mu text-sm"
      aria-label="Show password"
      aria-pressed="false">
      👁
    </button>
  `;

  const field = (id, label, type = 'text', ph = '', ac = '') => `
    <div class="relative">
      <label class="lbl" for="${id}">${label}</label>
      <input
        id="${id}"
        name="${id}"
        type="${type}"
        class="input"
        placeholder="${ph}"
        autocomplete="${ac}"
        required
        ${type === 'password' ? 'minlength="8"' : ''}
        ${id === 'code' ? 'inputmode="numeric" maxlength="6"' : ''}
      >
      ${type === 'password' ? eye(id) : ''}
    </div>
  `;

  const hint = () => ctx.dev
    ? `
      <div class="text-xs p-2 rounded-xl bg-white/5 mu mt-3">
        Demo mode: no email/SMS provider is connected, so your code
        is shown here:
        <b class="text-white text-sm">${esc(ctx.dev)}</b>
      </div>
    `
    : '';

  const gbtn = () => `
    <div class="flex items-center gap-3 my-4">
      <i class="flex-1 h-px bg-white/10"></i>
      <span class="mu text-xs">or</span>
      <i class="flex-1 h-px bg-white/10"></i>
    </div>

    <button type="button" id="google"
      class="btn w-full justify-center"
      style="border-color:rgba(255,255,255,.25)">
      <svg width="18" height="18" viewBox="0 0 48 48"
        aria-hidden="true">
        <path fill="#EA4335"
          d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/>
        <path fill="#4285F4"
          d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.5-4.1 7-10.2 7-17.6z"/>
        <path fill="#FBBC05"
          d="M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z"/>
        <path fill="#34A853"
          d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/>
      </svg>
      Continue with Google (demo)
    </button>
  `;

  const views = {
    login: () => `
      <h2 class="text-2xl font-semibold mb-1">Welcome back</h2>
      <p class="mu text-sm mb-3">
        Sign in to your QuantumTrade account
      </p>

      ${field('email', 'Email', 'email', 'you@example.com', 'username')}
      ${field('password', 'Password', 'password', '••••••••', 'current-password')}

      <div class="text-right mt-2">
        <a href="#" data-go="forgot" class="text-xs mu hover:text-white">
          Forgot password?
        </a>
      </div>

      <button type="submit" id="go"
        class="btn btn-p w-full justify-center mt-3">
        Log in
      </button>

      ${gbtn()}

      <p class="text-sm mu text-center mt-4">
        New here?
        <a href="#" data-go="signup" class="text-white underline">
          Create an account
        </a>
      </p>

      <p class="text-[11px] mu text-center mt-3">
        Demo: demo@quantumtrade.local / Demo@12345
      </p>
    `,

    signup: () => `
      <h2 class="text-2xl font-semibold mb-1">Create your account</h2>
      <p class="mu text-sm mb-1">
        Start with ₹10,00,000 of virtual paper-trading funds
      </p>

      ${field('name', 'Full name', 'text', 'Your name', 'name')}
      ${field('phone', 'Mobile number', 'tel', '9876543210', 'tel')}
      ${field('email', 'Email', 'email', 'you@example.com', 'email')}
      ${field('password', 'Password', 'password', 'Min 8 chars, upper + lower + digit', 'new-password')}
      ${field('confirm', 'Confirm password', 'password', '', 'new-password')}

      <label class="flex gap-2 items-start text-xs mu mt-3">
        <input type="checkbox" id="terms" class="mt-0.5">
        <span>
          I have read and agree to the
          <a class="text-white underline" href="#">Privacy Policy</a>
          and
          <a class="text-white underline" href="#">Terms &amp; Conditions</a>.
        </span>
      </label>

      <button type="submit" id="go"
        class="btn btn-p w-full justify-center mt-4">
        Sign up
      </button>

      ${gbtn()}

      <p class="text-sm mu text-center mt-4">
        Already have an account?
        <a href="#" data-go="login" class="text-white underline">
          Log in
        </a>
      </p>
    `,

    otp: () => `
      <h2 class="text-2xl font-semibold mb-1">Verify your email</h2>
      <p class="mu text-sm mb-3">
        Enter the 6-digit code for <b>${esc(ctx.email)}</b>
      </p>

      ${field('code', 'Verification code', 'text', '123456', 'one-time-code')}
      ${hint()}

      <button type="submit" id="go"
        class="btn btn-p w-full justify-center mt-4">
        Verify
      </button>

      <p class="text-sm mu text-center mt-4">
        <a href="#" id="resend" class="underline">Resend code</a>
        ·
        <a href="#" data-go="login" class="underline">Back</a>
      </p>
    `,

    twofa: () => `
      <h2 class="text-2xl font-semibold mb-1">
        Two-factor authentication
      </h2>
      <p class="mu text-sm mb-3">
        Enter the 6-digit code from your authenticator app.
      </p>

      ${field('code', 'Authenticator code', 'text', '123456', 'one-time-code')}

      <button type="submit" id="go"
        class="btn btn-p w-full justify-center mt-4">
        Continue
      </button>
    `,

    forgot: () => `
      <h2 class="text-2xl font-semibold mb-1">Forgot password</h2>
      <p class="mu text-sm mb-3">
        We'll send a reset code to your email.
      </p>

      ${field('email', 'Email', 'email', 'you@example.com', 'email')}

      <button type="submit" id="go"
        class="btn btn-p w-full justify-center mt-4">
        Send reset code
      </button>

      <p class="text-sm mu text-center mt-4">
        <a href="#" data-go="login" class="underline">Back to login</a>
      </p>
    `,

    reset: () => `
      <h2 class="text-2xl font-semibold mb-1">Reset password</h2>
      <p class="mu text-sm mb-1">
        Code sent to <b>${esc(ctx.email)}</b>
      </p>

      ${field('code', 'Reset code', 'text', '123456', 'one-time-code')}
      ${field('password', 'New password', 'password', '', 'new-password')}
      ${hint()}

      <button type="submit" id="go"
        class="btn btn-p w-full justify-center mt-4">
        Reset password
      </button>
    `
  };

  const draw = () => {
    if (!mounted) return;

    el.innerHTML = `
      <div class="max-w-md mx-auto pt-8 sm:pt-14">
        <div class="glass p-6 sm:p-8"
          style="box-shadow:0 0 80px rgba(120,80,255,.18)">

          <div class="flex items-center gap-2 mb-5">
            <img src="assets/logo.svg" class="w-9 h-9" alt="">
            <b class="grad-text text-lg">QuantumTrade</b>
          </div>

          <form id="f" novalidate>
            ${views[mode]()}

            <p id="err"
              class="dn text-sm mt-3 min-h-[20px]"
              role="alert"
              aria-live="polite"></p>
          </form>
        </div>
      </div>
    `;

    $$('[data-go]').forEach(link => {
      link.onclick = event => {
        event.preventDefault();

        if (submitting) return;

        mode = link.dataset.go;
        ctx = {};
        draw();
      };
    });

    $$('[data-eye]').forEach(button => {
      button.onclick = () => {
        const input = $('#' + button.dataset.eye);
        if (!input) return;

        const showing = input.type === 'password';

        input.type = showing ? 'text' : 'password';
        button.setAttribute('aria-pressed', String(showing));
        button.setAttribute(
          'aria-label',
          showing ? 'Hide password' : 'Show password'
        );
      };
    });

    $('#f').onsubmit = event => {
      event.preventDefault();
      submit();
    };

    const googleButton = $('#google');
    if (googleButton) googleButton.onclick = google;

    const resendButton = $('#resend');

    if (resendButton) {
      resendButton.onclick = async event => {
        event.preventDefault();

        if (submitting) return;

        submitting = true;
        resendButton.textContent = 'Sending...';
        resendButton.setAttribute('aria-disabled', 'true');

        try {
          const result = await api('/auth/resend-otp', {
            method: 'POST',
            body: { email: ctx.email }
          });

          if (!mounted) return;

          ctx.dev = result.dev_otp;
          draw();
          toast('Code sent', 'ok');
        } catch (error) {
          fail(error);
          const button = $('#resend');
          if (button) {
            button.textContent = 'Resend code';
            button.removeAttribute('aria-disabled');
          }
        } finally {
          submitting = false;
        }
      };
    }

    const firstInput = $('input:not([type=checkbox])');
    if (firstInput) firstInput.focus();
  };

  const fail = error => {
    const message = $('#err');
    if (message) {
      message.textContent = error?.message || 'Something went wrong.';
    }
  };

  const value = id => ($('#' + id)?.value || '').trim();

  const emailIsValid = email =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const passwordIsValid = password =>
    password.length >= 8 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password);

  function validate() {
    if (mode === 'login') {
      if (!emailIsValid(value('email'))) {
        return 'Enter a valid email address.';
      }
      if (!$('#password')?.value) {
        return 'Enter your password.';
      }
    }

    if (mode === 'signup') {
      if (value('name').length < 2) {
        return 'Enter your full name.';
      }
      if (!value('phone')) {
        return 'Enter your mobile number.';
      }
      if (!emailIsValid(value('email'))) {
        return 'Enter a valid email address.';
      }
      if (!passwordIsValid($('#password').value)) {
        return 'Password must have at least 8 characters, an uppercase letter, a lowercase letter and a digit.';
      }
      if ($('#password').value !== $('#confirm').value) {
        return 'Passwords do not match.';
      }
      if (!$('#terms').checked) {
        return 'Please accept the Terms & Conditions and Privacy Policy.';
      }
    }

    if (mode === 'otp' || mode === 'twofa' || mode === 'reset') {
      if (!/^\d{6}$/.test(value('code'))) {
        return 'Enter the 6-digit verification code.';
      }
    }

    if (mode === 'forgot' && !emailIsValid(value('email'))) {
      return 'Enter a valid email address.';
    }

    if (mode === 'reset' && !passwordIsValid($('#password').value)) {
      return 'Password must have at least 8 characters, an uppercase letter, a lowercase letter and a digit.';
    }

    return '';
  }

  async function done(result) {
    if (!mounted) return;

    if (!result?.token || !result?.user) {
      throw new Error('The server returned an invalid login response.');
    }

    setSession(result.token, result.user);
    wsReconnect();

    toast(
      'Welcome, ' + String(result.user.name || 'User').split(' ')[0],
      'ok'
    );

    const next = decodeURIComponent(qs().next || '');
    const destination = next.startsWith('/') &&
      !next.startsWith('//') &&
      !next.includes('\\')
      ? next
      : '/dashboard';

    location.hash = '#' + destination;
  }

  async function google() {
    if (submitting) return;

    const email = prompt(
      'Demo Google sign-in. Enter the account email to use:',
      'google.demo@quantumtrade.local'
    );

    if (!email || !mounted) return;

    const cleanEmail = email.trim();

    if (!emailIsValid(cleanEmail)) {
      fail(new Error('Enter a valid email address.'));
      return;
    }

    submitting = true;

    try {
      const result = await api('/auth/oauth/google', {
        method: 'POST',
        body: {
          email: cleanEmail,
          name: cleanEmail.split('@')[0]
        }
      });

      await done(result);
    } catch (error) {
      fail(error);
    } finally {
      submitting = false;
    }
  }

  async function submit() {
    if (submitting || !mounted) return;

    const validationError = validate();

    if (validationError) {
      fail(new Error(validationError));
      return;
    }

    const currentMode = mode;
    const button = $('#go');

    submitting = true;

    if (button) {
      button.disabled = true;
      button.textContent = 'Please wait...';
    }

    const errorElement = $('#err');
    if (errorElement) errorElement.textContent = '';

    try {
      if (currentMode === 'login') {
        try {
          const result = await api('/auth/login', {
            method: 'POST',
            body: {
              email: value('email'),
              password: $('#password').value
            }
          });

          if (!mounted) return;

          if (result.need_2fa) {
            ctx = { ticket: result.ticket };
            mode = 'twofa';
            return draw();
          }

          await done(result);
        } catch (error) {
          if (error.data?.need_verification) {
            ctx = {
              email: value('email'),
              dev: error.data.dev_otp
            };
            mode = 'otp';
            return draw();
          }

          throw error;
        }
      } else if (currentMode === 'signup') {
        const email = value('email');

        const result = await api('/auth/register', {
          method: 'POST',
          body: {
            name: value('name'),
            phone: value('phone'),
            email,
            password: $('#password').value,
            confirm: $('#confirm').value,
            accept_terms: $('#terms').checked
          }
        });

        if (!mounted) return;

        ctx = {
          email,
          dev: result.dev_otp
        };

        mode = 'otp';
        return draw();
      } else if (currentMode === 'otp') {
        const result = await api('/auth/verify-otp', {
          method: 'POST',
          body: {
            email: ctx.email,
            code: value('code')
          }
        });

        await done(result);
      } else if (currentMode === 'twofa') {
        const result = await api('/auth/login/2fa', {
          method: 'POST',
          body: {
            ticket: ctx.ticket,
            code: value('code')
          }
        });

        await done(result);
      } else if (currentMode === 'forgot') {
        const email = value('email');

        const result = await api('/auth/forgot', {
          method: 'POST',
          body: { email }
        });

        if (!mounted) return;

        ctx = {
          email,
          dev: result.dev_otp
        };

        mode = 'reset';
        return draw();
      } else if (currentMode === 'reset') {
        await api('/auth/reset', {
          method: 'POST',
          body: {
            email: ctx.email,
            code: value('code'),
            password: $('#password').value
          }
        });

        if (!mounted) return;

        toast('Password updated. Please log in.', 'ok');
        mode = 'login';
        ctx = {};
        return draw();
      }
    } catch (error) {
      if (mounted) fail(error);
    } finally {
      submitting = false;

      if (mounted) {
        const currentButton = $('#go');

        if (currentButton) {
          currentButton.disabled = false;
          currentButton.textContent = LANG[mode] || 'Continue';
        }
      }
    }
  }

  if (get().token) {
    location.hash = '#/dashboard';
    return;
  }

  draw();

  return () => {
    mounted = false;
  };
}
