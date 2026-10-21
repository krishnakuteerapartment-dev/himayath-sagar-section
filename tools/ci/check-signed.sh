#!/bin/bash
# Installs the signed APK (Android rejects a bad signature), opens it and takes screenshots.
set -x
PKG=com.himayathsagar.dtrverify
adb uninstall $PKG || true
adb install -r Himayath-Sagar.apk || exit 1
adb install -r Himayath-Sagar.apk || exit 1   # reinstall over itself: same key accepted
adb shell dumpsys package $PKG | grep -E "versionCode|versionName|signatures" | head -5
adb shell am start -W -n $PKG/com.himayathsagar.dtrverify.MainActivity
sleep 8
mkdir -p check && adb exec-out screencap -p > check/signed-login.png
adb shell pidof $PKG || exit 1
zip -q check-shots.zip check/*.png
