# Windows Native Helpers

This folder contains the Windows helpers used by the Electron app.

Current helpers:

- `piksy-keyboard-hook.exe` for the low-level Control+Alt push-to-talk shortcut. Emits `READY\n` on startup, then `SHORTCUT_DOWN\n`/`SHORTCUT_UP\n` transitions. Listens for `stop\n` on stdin to exit.
- `piksy-screen-capture.exe` for native multi-monitor screenshots using GDI + GDI+ JPEG encoding, sorted with the cursor monitor first. Downscales to 1280px max dimension with 80% JPEG quality to match macOS behavior.

Build requirements:

- Windows SDK (for GDI, GDI+, Ole32)
- CMake 3.20+
- MSVC or compatible C++17 compiler
