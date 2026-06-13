# Building Brahmaand for Android

Same model as iOS: the `dist/` web build wrapped by **Capacitor** into a native Android app
(WebView + the same native plugins). The Gradle project is **committed at
[`android/`](../android)** (its template `.gitignore` excludes build artifacts).

> **Status 2026-06-13:** ✅ **the APK builds** — `./gradlew assembleDebug` returns **BUILD
> SUCCESSFUL** and produces `android/app/build/outputs/apk/debug/app-debug.apk` (~18 MB) with the
> full feature set (solar system and time machine included), using Android Studio's bundled JDK
> (JBR) + SDK android-36. Location permissions are declared in the manifest but optional — the
> location and compass hardware features are marked `required="false"`, so the app installs and
> runs without them. `adb install` it on a phone, or `npm run android:open` to run from Studio.
> Build env (set these or use Studio's):
> `JAVA_HOME=/Applications/Android Studio.app/Contents/jbr/Contents/Home`,
> `ANDROID_SDK_ROOT=~/Library/Android/sdk`.

## One-time setup

1. Install **[Android Studio](https://developer.android.com/studio)** (bundles the SDK + JDK).
2. Open it once and let it install the default SDK platform + build tools.

## Run on an Android phone / emulator

```bash
npm run android:sync     # build the web app + copy into android/ + sync plugins
npm run android:open     # open the project in Android Studio
```

In Android Studio: pick a device (USB phone with developer mode, or an emulator) and press ▶.
No signing account needed for development; a Play Store release later needs a keystore +
Play Console account ($25 one-time).

Command-line alternative (after Android Studio has installed the SDK):

```bash
cd android && ./gradlew assembleDebug
# APK at android/app/build/outputs/apk/debug/app-debug.apk — install with adb install
```

After any web-code change: `npm run android:sync`, then ▶ again.

## Send it to a friend to test (no Play Store, no account)

The debug APK is a single self-contained file you can hand to anyone with an Android phone:

```bash
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk   (~18 MB)
```

1. **Send the file.** Email it, drop it in Google Drive/Dropbox and share the link, or use any
   transfer app. (APKs are too big/blocked for SMS; a Drive link is easiest.)
2. **On your friend's phone:** open the link, tap the APK to download, then tap it again to install.
   Android will say "For your security, your phone isn't allowed to install unknown apps from this
   source" → tap **Settings** → enable **Allow from this source** for whichever app delivered it
   (Chrome, Gmail, Drive, Files…) → back, then **Install**.
3. Open **Brahmaand**. It works fully offline-capable for the sky; the live data needs internet.

Notes:
- This **debug** build is fine for testing and never expires (unlike iOS free-signing's 7 days).
- It's signed with the auto-generated debug key, so Google Play Protect may show a one-time "unknown
  app" warning — tapping **Install anyway / More details → Install** is expected for sideloaded apps.
- For a polished build you'd hand out, make a **release** APK with your own keystore:
  `./gradlew assembleRelease` after configuring `signingConfigs` in `android/app/build.gradle`
  (Android Studio → Build → Generate Signed Bundle/APK walks you through creating the keystore).
- A public listing needs a **Play Console** account ($25 one-time) and an `.aab` (`bundleRelease`).

## Pro vs Public

Same as iOS: the in-app ◆ PRO ⇄ ◇ Explore toggle, or bake `?mode=pro|public` into the shell URL
for two Play Store listings from one codebase.
