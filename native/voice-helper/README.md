# Native Voice Helper

This first draft implements the versioned stdio protocol and a synthetic transcript hook. It does not capture audio or link Moonshine yet.

Build it with:

```bash
pnpm native:configure
pnpm native:build
pnpm native:test
```

Point `copilotSpeech.helperPath` at the resulting executable. Set `COPILOT_SPEECH_STUB_TRANSCRIPT` before launching VS Code to exercise final transcript delivery.

The production implementation will replace the stub internals with Moonshine Voice v2 streaming inference and native microphone capture while preserving this process boundary and protocol.