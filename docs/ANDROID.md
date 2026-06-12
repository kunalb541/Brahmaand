# Building Brahmaand for Android

Same model as iOS: the `dist/` web build wrapped by **Capacitor** into a native Android app
(WebView + the same native plugins). The Gradle project is **committed at
[`android/`](../android)** (its template `.gitignore` excludes build artifacts).

> **Status 2026-06-12:** project generated, synced, committed. This machine has **no Java/Android
> SDK**, so the APK build is user-side — install Android Studio and the steps below are all
> that's left.

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

## Pro vs Public

Same as iOS: the in-app ◆ PRO ⇄ ◇ Explore toggle, or bake `?mode=pro|public` into the shell URL
for two Play Store listings from one codebase.
