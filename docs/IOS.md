# Building Brahmaand for iPhone / iPad

Brahmaand runs as a real native app via **Capacitor** — the *same* `dist/` web build wrapped in a
WKWebView with native plugins (push, geolocation, haptics, share, motion). Capacitor config is in
[`capacitor.config.ts`](../capacitor.config.ts); the generated `ios/` Xcode project is git-ignored
(regenerate it, don't commit it).

## One-time setup (on a Mac)

1. **Install Xcode** from the Mac App Store (the full IDE, not just Command Line Tools), then:
   ```bash
   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
   sudo xcodebuild -license accept
   ```
2. **Install CocoaPods**: `brew install cocoapods` (or `sudo gem install cocoapods`).
3. From the repo: `npm install` (Capacitor deps are already in package.json).

## Build & run on your iPhone (free — no $99 needed)

```bash
npm run build           # produce dist/ (the web app)
npm run ios:add         # one-time: generate the native ios/ Xcode project (runs pod install)
npm run ios:sync        # copy dist/ into the native app + sync plugins (re-run after web changes)
npm run ios:open        # open ios/App/App.xcworkspace in Xcode
```

In Xcode:
- Select your iPhone (plug it in, trust the Mac).
- Signing & Capabilities → Team → your **free** Apple ID (Personal Team). Set a unique bundle id
  if `com.kunalbhatia.brahmaand` is taken.
- Press ▶. The app installs on your phone. (Free provisioning expires after **7 days** — re-run ▶
  to re-sign. The $99/yr Apple Developer Program removes that limit and unlocks TestFlight/App
  Store/push.)

## Live-reload during development (optional)

Point the native shell at your Mac's dev server so web edits hot-reload on the phone:
1. `npm run dev -- --host` (note the LAN URL, e.g. `http://192.168.1.20:5173`).
2. In `capacitor.config.ts`, set `server.url` to that URL + `cleartext: true`, then `npm run ios:sync`.
3. Run from Xcode — the app now loads from the dev server. (Revert before a release build.)

## What native unlocks (roadmap — see docs/ROADMAP-V2.md)

- **No CORS** — call the ESA Gaia archive / any service directly from the app.
- **Push notifications** — transient/watchlist alerts (needs the $99 program + APNs).
- **CoreMotion + compass** — true "hold the phone up to the sky" (a small Swift plugin; better than
  the permission-gated, compass-poor web DeviceOrientation API).
- **Core Location** — observation planning filtered to the user's hemisphere & horizon.
- **Offline** — catalogs + base textures ship in the app bundle; tile cache via the service worker
  (works in WKWebView) or native URLCache.

## Already mobile-ready in the web build

- **Pinch-to-zoom** (two-finger) + one-finger look — verified in the browser at mobile size.
- **viewport-fit=cover + safe-area insets** so the HUD clears the notch / home indicator.
- `apple-mobile-web-app-capable` for a full-screen "Add to Home Screen" PWA as a zero-cost interim
  before the App Store build.
