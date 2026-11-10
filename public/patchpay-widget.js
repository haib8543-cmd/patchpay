// PatchPay bug-report widget. Drop into any web game:
// <script src="/patchpay-widget.js" data-game="my-game" data-canvas="#game"></script>
// Optional: window.patchpayState = () => ({ ...game state... })
(() => {
  const script = document.currentScript;
  const game = script.dataset.game || location.pathname;
  const canvasSelector = script.dataset.canvas || 'canvas';
  const endpoint = script.dataset.endpoint || '/api/reports';
  const MAX_TEXT = 500;
  const MAX_IMAGE = 290_000;

  // Keep the last 20 errors/warnings, with emails and token-like strings removed.
  const logs = [];
  const redact = (s) => String(s)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/\b(?:eyJ[\w-]*\.[\w.-]+|sk-[\w-]{8,}|Bearer\s+[\w.-]+)/g, '[secret]');
  const push = (kind, msg) => {
    logs.push(`${kind}: ${redact(msg)}`.slice(0, 300));
    if (logs.length > 20) logs.shift();
  };
  for (const level of ['error', 'warn']) {
    const original = console[level];
    console[level] = (...args) => { push(level, args.map(String).join(' ')); original.apply(console, args); };
  }
  addEventListener('error', (e) => push('uncaught', `${e.message} @ ${(e.filename || '').split('/').pop()}:${e.lineno}`));
  addEventListener('unhandledrejection', (e) => push('unhandled', (e.reason && e.reason.message) || e.reason));

  function snapshot() {
    const source = document.querySelector(canvasSelector);
    if (!(source instanceof HTMLCanvasElement)) return null;
    const scale = Math.min(1, 640 / source.width);
    const c = document.createElement('canvas');
    c.width = Math.round(source.width * scale);
    c.height = Math.round(source.height * scale);
    c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
    for (const q of [0.7, 0.5, 0.3]) {
      const url = c.toDataURL('image/jpeg', q);
      if (url.length <= MAX_IMAGE) return url;
    }
    return null;
  }

  function readState() {
    try { return typeof window.patchpayState === 'function' ? window.patchpayState() : null; }
    catch (e) { return { error: String(e) }; }
  }

  const css = `
    .pp-fab { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; min-height: 48px; padding: 0 18px;
      border: 0; border-radius: 999px; background: #0b1f3a; color: #fff; font: 600 15px system-ui, sans-serif;
      box-shadow: 0 4px 16px rgba(0,0,0,.2); cursor: pointer; }
    .pp-fab:focus-visible, .pp-dialog button:focus-visible, .pp-dialog textarea:focus-visible { outline: 3px solid #2f6fed; outline-offset: 2px; }
    .pp-dialog { width: min(480px, calc(100vw - 32px)); border: 0; border-radius: 16px; padding: 24px;
      font: 15px/1.5 system-ui, sans-serif; color: #111; }
    .pp-dialog::backdrop { background: rgba(11,31,58,.5); }
    .pp-dialog h2 { margin: 0 0 4px; font-size: 20px; }
    .pp-dialog p { margin: 0 0 12px; color: #5b6573; }
    .pp-dialog textarea { width: 100%; min-height: 96px; padding: 10px; border: 1px solid #cfd6e0; border-radius: 10px;
      font: 16px/1.4 system-ui, sans-serif; resize: vertical; box-sizing: border-box; }
    .pp-count { text-align: right; font-size: 13px; color: #5b6573; }
    .pp-attach { display: flex; gap: 12px; align-items: center; margin: 12px 0; font-size: 14px; color: #5b6573; }
    .pp-attach img { width: 112px; border-radius: 8px; background: #0b1f3a; }
    .pp-attach ul { margin: 0; padding-left: 18px; }
    .pp-row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
    .pp-row button { min-height: 44px; padding: 0 16px; border-radius: 10px; font: 600 15px system-ui, sans-serif; cursor: pointer; }
    .pp-primary { border: 0; background: #2f6fed; color: #fff; }
    .pp-primary:disabled { opacity: .6; cursor: default; }
    .pp-ghost { border: 1px solid #cfd6e0; background: #fff; color: #111; }
    .pp-error { color: #b42318; margin-top: 8px; font-size: 14px; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);

  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'pp-fab';
  fab.textContent = 'Report a bug · earn a bounty';

  const dialog = document.createElement('dialog');
  dialog.className = 'pp-dialog';
  dialog.setAttribute('aria-labelledby', 'pp-title');
  document.body.append(fab, dialog);

  let draft = null;

  function showForm() {
    dialog.innerHTML = `
      <form method="dialog">
        <h2 id="pp-title">Report a bug</h2>
        <p>One sentence is enough. We attach the details for you.</p>
        <label for="pp-text" style="display:block;font-weight:600;margin-bottom:6px">What went wrong?</label>
        <textarea id="pp-text" maxlength="${MAX_TEXT}" required placeholder="e.g. The paddle froze when I hit the right wall"></textarea>
        <div class="pp-count" aria-live="polite"><span id="pp-n">0</span>/${MAX_TEXT}</div>
        <label for="pp-email" style="display:block;font-weight:600;margin:8px 0 6px">PayPal email for your bounty <span style="font-weight:400;color:#5b6573">(optional, sandbox)</span></label>
        <input id="pp-email" type="email" autocomplete="email" maxlength="254" placeholder="you@example.com"
          style="width:100%;min-height:44px;padding:0 10px;border:1px solid #cfd6e0;border-radius:10px;font:16px system-ui,sans-serif;box-sizing:border-box">
        <p style="font-size:13px;margin:6px 0 0">Only used to send the bounty. You can add it later from your report page.</p>
        <div class="pp-attach">
          ${draft.screenshot ? `<img src="${draft.screenshot}" alt="Screenshot of the game at the moment you opened this report">` : ''}
          <div>Attached automatically:
            <ul>
              <li>${draft.screenshot ? 'Game screenshot' : 'No screenshot (canvas not found)'}</li>
              <li>${draft.console.length} console message${draft.console.length === 1 ? '' : 's'}</li>
              <li>${draft.state ? 'Game state' : 'No game state'}</li>
            </ul>
          </div>
        </div>
        <div class="pp-error" id="pp-error" role="alert"></div>
        <div class="pp-row">
          <button type="button" class="pp-ghost" id="pp-cancel">Cancel</button>
          <button type="submit" class="pp-primary" id="pp-send">Send report</button>
        </div>
      </form>`;
    const text = dialog.querySelector('#pp-text');
    text.addEventListener('input', () => { dialog.querySelector('#pp-n').textContent = text.value.length; });
    dialog.querySelector('#pp-cancel').addEventListener('click', () => dialog.close());
    const email = dialog.querySelector('#pp-email');
    dialog.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); send(text.value.trim(), email.value.trim()); });
  }

  async function send(text, email) {
    const button = dialog.querySelector('#pp-send');
    const error = dialog.querySelector('#pp-error');
    if (!text) { error.textContent = 'Please describe the bug.'; return; }
    button.disabled = true;
    button.textContent = 'Sending…';
    error.textContent = '';
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ game, text, email: email || undefined, screenshot: draft.screenshot, console: draft.console.join('\n'), state: draft.state }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `Server error (${r.status})`);
      dialog.innerHTML = `
        <h2 id="pp-title">Thanks, report received</h2>
        <p>Report <strong>#${data.id.slice(0, 8)}</strong> is being triaged. If the developer approves it, your bounty is paid through PayPal.</p>
        <p>Keep this private link to follow your report${email ? '' : ' and add your PayPal email later'}:</p>
        <p><a id="pp-link" target="_blank" rel="noopener"></a></p>
        <div class="pp-row"><button type="button" class="pp-primary" id="pp-done">Back to the game</button></div>`;
      // The token sits in the URL fragment so it is never sent to servers or in Referer headers.
      const link = new URL(`/r#${data.id}.${data.token}`, endpoint.startsWith('http') ? endpoint : location.href).href;
      Object.assign(dialog.querySelector('#pp-link'), { href: link, textContent: 'Track my report ↗' });
      dialog.querySelector('#pp-done').addEventListener('click', () => dialog.close());
      dialog.querySelector('#pp-done').focus();
    } catch (e) {
      error.textContent = e.message === 'Failed to fetch' ? 'Could not reach the server. Check your connection and try again.' : e.message;
      button.disabled = false;
      button.textContent = 'Send report';
    }
  }

  fab.addEventListener('click', () => {
    // Capture before the dialog covers anything.
    draft = { screenshot: snapshot(), console: logs.slice(), state: readState() };
    dispatchEvent(new Event('patchpay:open'));
    showForm();
    dialog.showModal();
  });
  dialog.addEventListener('close', () => { dispatchEvent(new Event('patchpay:close')); fab.focus(); });
})();
