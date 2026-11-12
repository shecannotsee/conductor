# Source Directory

This directory contains the Electron TypeScript source, build config, and package files.

Windows 0.4.0 packaging, per-conversation API profiles, and uninstall options: [release guide](../docs/windows-release-0.4.md). Build the installer with `npm run dist:win` (uses the isolated NSIS template wrapper).

## Main Process

- `main/main.ts`: Electron app lifecycle, BrowserWindow, close guard, menu dispatch.
- `main/ipc_registration.ts`: IPC handlers.
- `main/preload.ts`: safe renderer bridge.
- `main/app_controller/`: AppController mixins.
- `main/codex/`: Codex CLI/app-server bridge and output parsing.
- `main/telegram/`: Telegram notifications, sender, updates, and notification state.
- `main/security/`: credential vault and encryption helpers.
- `main/storage/`: state-store adapter.

## Renderer

- `renderer/index.html`: DOM shell.
- `renderer/app/`: TypeScript renderer modules.
- `renderer/styles.css`: layout, themes, Telegram-like visual style.

## Generated Files

- `app/`: build output from `npm run build`; ignored.
- `build/icon.png`: synced icon; ignored.
- `node_modules/`: dependencies; ignored.

## Commands

```bash
npm run check
npm run build
npm start
npm run capture:docs
npm run dist:deb
```

Project-level docs live in `../README.md` and `../docs/`.

## Windows Packaging

See [Windows release guide](../docs/windows-release-0.4.md). `main/preview_runtime.ts` owns private paths/environment; `main/codex_settings.ts` owns config/auth and probes; `renderer/app/codex_settings_ui.ts` provides setup. `electron-builder.windows.yml` and `scripts/windows/` implement isolated installation and removal.

## Local streaming speech

`main/speech_service.ts` owns the private CPU sidecar and bounded IPC. `speech-package/worker.cjs` streams Paraformer and applies punctuation. `renderer/audio/pcm-worklet.js` captures PCM and `renderer/app/speech_input.ts` appends final segments without overwriting drafts. See [voice input](../docs/voice-input.md) for platform builds and model licenses.
