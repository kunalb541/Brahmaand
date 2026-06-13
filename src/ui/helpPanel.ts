/**
 * "?" Help — how to use the app (desktop + phone controls, gyro modes, what the data is) and
 * dead-simple install steps for iPhone and Android. Mounted as a button in the top bar; the
 * panel is a centered modal (covers the sky only — tap anywhere outside to close).
 */

const S = {
  h: 'margin:14px 0 4px;color:#9cc4ff;font-size:12px;letter-spacing:.06em;text-transform:uppercase',
  p: 'margin:4px 0;color:#bcd;font-size:12px;line-height:1.55',
  k: 'background:rgba(120,170,255,.16);border:1px solid rgba(120,170,255,.3);border-radius:4px;padding:0 5px;font-size:11px',
  ol: 'margin:4px 0 4px 18px;padding:0;color:#bcd;font-size:12px;line-height:1.6',
};

export function initHelpPanel(): void {
  const btn = document.createElement('button');
  btn.textContent = '?';
  btn.title = 'Help — controls & how to install on your phone';
  document.getElementById('topbar-actions')!.appendChild(btn);

  const modal = document.createElement('div');
  modal.style.cssText =
    'position:fixed;inset:0;z-index:30;display:none;place-items:center;background:rgba(2,6,14,.8);backdrop-filter:blur(4px)';
  modal.innerHTML =
    `<div style="max-width:560px;max-height:82vh;overflow-y:auto;background:rgba(8,14,28,.97);border:1px solid rgba(120,170,255,.25);` +
    `border-radius:14px;padding:20px 24px;font:13px ui-monospace,monospace;color:#cfe3ff">` +
    `<h2 style="margin:0;color:#9cc4ff">? Help</h2>` +

    `<div style="${S.h}">Look around & fly</div>` +
    `<p style="${S.p}"><b>Desktop:</b> drag to look · scroll to zoom · <span style="${S.k}">W A S D</span> fly ` +
    `(forward/left/back/right) · <span style="${S.k}">Q</span>/<span style="${S.k}">E</span> down/up · ` +
    `click any star or galaxy to identify it · type a name in the search bar.</p>` +
    `<p style="${S.p}"><b>Phone:</b> drag to look · pinch to zoom · the round joystick (bottom-left) flies you ` +
    `through the 3-D stars · tap an object to identify it.</p>` +
    `<p style="${S.p}"><b>📱 Move-to-look:</b> tap the button at the bottom of the sky, allow motion (and location), ` +
    `then just move your phone — the view follows. With GPS + compass it becomes <b>📡 Sky-locked</b>: the app shows ` +
    `the real stars in the direction you're pointing, north or south. Fly back home anytime with ⌂ Return to Earth.</p>` +

    `<div style="${S.h}">What you're seeing</div>` +
    `<p style="${S.p}">Everything is real data: survey photography (DSS2 base; zoom in and the active survey's ` +
    `telescope tiles stream in — pick surveys in <b>Imagery</b>), 109k+ stars at their true parallax distances, ` +
    `and (PRO) live transient alerts from the ALeRCE/ANTARES brokers with their ML classifications. ` +
    `Wide-field surveys cover part of the sky — the status bar says when you're outside coverage.</p>` +

    `<div style="${S.h}">Install on iPhone (free, ~10 min, needs a Mac with Xcode)</div>` +
    `<ol style="${S.ol}">` +
    `<li>In the project folder run: <span style="${S.k}">npm run ios:sync</span> then <span style="${S.k}">npm run ios:open</span></li>` +
    `<li>Plug in the iPhone (tap <b>Trust</b> on the phone) and pick it as the run target in Xcode.</li>` +
    `<li>Project → <b>Signing & Capabilities</b> → Team → your free Apple ID (change the bundle id if taken).</li>` +
    `<li>Press <b>▶</b>. First run: on the phone, Settings → General → VPN &amp; Device Management → trust your certificate.</li>` +
    `<li>Free signing expires after 7 days — just press ▶ again to refresh.</li>` +
    `</ol>` +

    `<div style="${S.h}">Install on Android (free, no account, no computer needed to receive)</div>` +
    `<ol style="${S.ol}">` +
    `<li>Build once: <span style="${S.k}">cd android && ./gradlew assembleDebug</span> → ` +
    `<span style="${S.k}">app-debug.apk</span> (~18 MB).</li>` +
    `<li>Send the APK file (Google Drive / email / any file share).</li>` +
    `<li>On the phone: download → tap it → allow "install unknown apps" for that app → <b>Install</b>.</li>` +
    `<li>The debug APK never expires. (Play Protect may ask once — choose "Install anyway".)</li>` +
    `</ol>` +

    `<p style="margin:14px 0 0;font-size:11px;color:#5f7494">Full docs: docs/IOS.md · docs/ANDROID.md · docs/USAGE-AND-LEGAL.md in the ` +
    `<a href="https://github.com/kunalb541/Brahmaand" target="_blank" rel="noopener" style="color:#8aa6d6">repository ↗</a></p>` +
    `<button id="help-close" style="margin-top:12px;font:inherit;font-size:12px;cursor:pointer;color:#dcebff;` +
    `background:rgba(40,70,130,.5);border:1px solid rgba(120,170,255,.3);border-radius:6px;padding:5px 12px">Close</button>` +
    `</div>`;
  document.body.appendChild(modal);

  btn.addEventListener('click', () => (modal.style.display = 'grid'));
  modal.addEventListener('click', (e) => {
    if (e.target === modal || (e.target as HTMLElement).id === 'help-close') modal.style.display = 'none';
  });
}
