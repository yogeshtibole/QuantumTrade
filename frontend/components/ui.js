
import { esc } from '../src/utils.js';

// Display a temporary notification.
export function toast(msg, type = '') {
  let container = document.getElementById('toasts');

  if (!container) {
    container = document.createElement('div');
    container.id = 'toasts';
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'false');
    document.body.appendChild(container);
  }

  const allowedTypes = ['success', 'err', 'warn', 'info'];
  const safeType = allowedTypes.includes(type) ? type : '';

  const element = document.createElement('div');
  element.className = `toast ${safeType}`.trim();
  element.textContent = String(msg ?? '');

  if (safeType === 'err') {
    element.setAttribute('role', 'alert');
  } else {
    element.setAttribute('role', 'status');
  }

  container.appendChild(element);

  const duration = safeType === 'err' ? 6000 : 3800;

  setTimeout(() => {
    element.remove();
  }, duration);
}

// Reusable card component.
export const card = (title, inner, extra = '') => {
  const heading = title
    ? `<h3 class="text-sm mu mb-3 font-medium">${esc(title)}</h3>`
    : '';

  return `
    <section class="glass p-4 ${esc(extra)}">
      ${heading}
      ${inner ?? ''}
    </section>
  `;
};

// Reusable statistic component.
export const stat = (label, value, sub = '', c = '') => {
  const colorClass = /^[a-zA-Z0-9 _-]*$/.test(String(c)) ? c : '';

  return `
    <div class="glass p-4">
      <div class="text-xs mu">${esc(label)}</div>

      <div class="text-2xl font-semibold mt-1 num ${colorClass}">
        ${esc(value ?? '')}
      </div>

      ${
        sub
          ? `<div class="text-xs mt-1 ${colorClass || 'mu'}">${esc(sub)}</div>`
          : ''
      }
    </div>
  `;
};

// Reusable HTML table.
// Cell content is escaped by default; use trusted HTML only when required.
export const table = (
  cols,
  rows,
  empty = 'Nothing here yet'
) => {
  const safeCols = Array.isArray(cols) ? cols : [];
  const safeRows = Array.isArray(rows) ? rows : [];

  const header = safeCols
    .map(column => `<th>${esc(column ?? '')}</th>`)
    .join('');

  const body = safeRows.length
    ? safeRows.map(row => `
        <tr>
          ${(Array.isArray(row) ? row : [])
            .map(cell => `<td>${esc(cell ?? '')}</td>`)
            .join('')}
        </tr>
      `).join('')
    : `
        <tr>
          <td colspan="${Math.max(1, safeCols.length)}"
              class="mu"
              style="text-align:center;padding:20px">
            ${esc(empty)}
          </td>
        </tr>
      `;

  return `
    <div class="scroll-x">
      <table class="t">
        <thead><tr>${header}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
};

// Display an error message.
export const errBox = message => `
  <div class="dn text-sm p-3 rounded-xl bgdn">
    ${esc(message ?? '')}
  </div>
`;

// Reusable tab navigation.
export const tabs = (items, active, attr = 'data-tab') => {
  const safeItems = Array.isArray(items) ? items : [];

  // Only allow standard HTML data attributes.
  const safeAttr = /^data-[a-zA-Z0-9_-]+$/.test(attr)
    ? attr
    : 'data-tab';

  return `
    <div class="flex flex-wrap" role="tablist">
      ${safeItems.map(([key, label]) => {
        const isActive = key === active;

        return `
          <button
            type="button"
            class="chip ${isActive ? 'on' : ''}"
            ${safeAttr}="${esc(key ?? '')}"
            role="tab"
            aria-selected="${isActive}"
          >${esc(label ?? '')}</button>
        `;
      }).join('')}
    </div>
  `;
};

// Native confirmation dialog.
export function confirmBox(msg) {
  return window.confirm(String(msg ?? ''));
}
