# Building Brahmaand for iPhone / iPad

Brahmaand runs as a real native app via **Capacitor** — the *same* `dist/` web build wrapped in a
WKWebView with native plugins (geolocation, haptics, share, app lifecycle; push next). The native
Xcode project is **committed at [`ios/`](../ios)** and uses **Swift Package Manager** (no
CocoaPods needed). Config: [`capacitor.config.ts`](../capacitor.config.ts).

> **Status 2026-06-12:** ✅ **the iOS app compiles** — `xcodebuild` for the iphonesimulator SDK
> returns **BUILD SUCCEEDED** with Xcode 26.5 (SPM resolves capacitor-swift-pm + the geolocation
> plugin; no CodeSign needed for the simulator). The steps below add your phone + free signing.

## One-time setup

1. Install **Xcode** from the Mac App Store and launch it once (accepts license, installs the
   iOS platform). If `xcodebuild -version` complains about CommandLineTools:
   ```bash
   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
   ```
2. That's it — no CocoaPods (the project uses SPM; dependencies resolve inside Xcode).

## Run on your iPhone (free — no $99 needed)

```bash
npm run ios:sync        # build the web app + copy into ios/ + sync plugins
npm run ios:open        # open the project in Xcode
```

In Xcode:
- Plug in your iPhone (trust the Mac), select it as the run target.
- Signing & Capabilities → Team → your **free** Apple ID (Personal Team). Change the bundle id
  if `com.kunalbhatia.brahmaand` is taken.
- Press ▶. The app installs and runs. (Free provisioning re-signs every **7 days** — press ▶
  again. The $99/yr Apple Developer Program removes that and unlocks TestFlight/App Store/push.)

After any web-code change: `npm run ios:sync`, then ▶ in Xcode again.

## Pro vs Public listings

One codebase, two experiences (`src/config/mode.ts`): the in-app **◆ PRO ⇄ ◇ Explore** toggle, or
bake a default per listing by pointing the native shell at `index.html?mode=pro` /
`?mode=public` (two app targets / two listings later).

## Live-reload during development (optional)

1. `npm run dev -- --host` (note the LAN URL, e.g. `http://192.168.1.20:5173`).
2. In `capacitor.config.ts` set `server: { url: 'http://<that-ip>:5173', cleartext: true }`,
   `npm run ios:sync`, run from Xcode. Revert before a release build.

## What native unlocks (roadmap — docs/ROADMAP-V2.md)

- **No CORS** — call the ESA archive / any service directly.
- **Push notifications** — transient/watchlist alerts (needs $99 + APNs).
- **CoreMotion + compass** — true "hold the phone up to the sky" (small Swift plugin).
- **Core Location** — hemisphere-aware observation planning (plugin already installed).
- **Offline** — catalogs/textures ship in the bundle; tile cache via the service worker.
