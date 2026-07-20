# Contributing

Install dependencies with `pnpm install`, then run:

```bash
pnpm check
pnpm native:configure
pnpm native:build
pnpm native:test
```

Keep the extension-host main thread free of raw audio and inference work. Microphone capture lives in the native helper (`src/native/voice-helper.cpp`, miniaudio). Silero VAD (`@ricky0123/vad-web`) and Cohere Transcribe inference run in the Node worker (`src/transcription-worker.ts`). Changes to helper commands or events must update the TypeScript protocol (`src/helper-protocol.ts`), the native implementation, the `protocol-test.cmake` fixture, tests, and the protocol version when compatibility changes.

The native helper is capture-only: do not add ML or ONNX dependencies to it. Do not log transcript text or audio. Do not add automatic Chat submission.