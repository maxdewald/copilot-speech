# Copilot Speech

A desktop VS Code extension for private local dictation into Copilot Chat.

## Layout

- `src/speech/` - dictation state, helper lifecycle, and protocol.
- `src/delivery/` - transcript destinations such as Copilot Chat.
- `src/extension/` - commands and status UI.
- `native/voice-helper/` - isolated microphone and inference process.
- `artifacts/` - pinned helper and model manifests.
- `test/` - focused TypeScript behavior tests.

## Rules

- Raw PCM remains in the native helper.
- Never log transcript text or audio.
- Final text prefills Chat; it is never submitted automatically.
- Keep the helper protocol versioned and bounded.
- Prefer stable VS Code APIs and isolate internal command contracts.
- Add comments only where names and structure cannot explain the behavior.