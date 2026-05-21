# macOS Native Helpers

This folder contains the Swift helper that replaces the AppKit-only behavior from `apps/macos`.
The Electron shell resolves packaged helper binaries through `electron/nativePaths.ts`, following
the same app.asar unpacking pattern used in the Recordly reference app.

Current helper commands:

- `--permissions`, `--request-microphone`, `--request-accessibility`, and `--request-screen` for native privacy checks and prompts.
- `--capture-screens` for ScreenCaptureKit screenshots across all displays, sorted with the cursor display first and excluding Piksy-owned windows.
- `--keyboard-hook` for modifier-only Control+Option push-to-talk transitions using a listen-only CGEvent tap.
