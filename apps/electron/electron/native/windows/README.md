# Windows Native Helpers

This folder contains the Windows helpers used by the Electron app.

Current helpers:

- `piksy-keyboard-hook.exe` for the low-level Control+Alt push-to-talk shortcut.
- `piksy-screen-capture.exe` for native multi-monitor GDI screenshots, sorted with the cursor monitor first.

Future upgrade candidate:

- Windows Graphics Capture can replace GDI capture if the app needs per-window exclusion parity with ScreenCaptureKit.
