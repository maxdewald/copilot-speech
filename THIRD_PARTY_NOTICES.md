# Third-Party Notices

Copilot Speech plans to distribute or download the following runtime components. Exact revisions, binary digests, and complete notices will be pinned before a production release.

## Moonshine Voice

- Project: https://github.com/moonshine-ai/moonshine
- Purpose: Streaming speech recognition runtime and English model weights
- License: MIT for the runtime and English models

## ONNX Runtime

- Project: https://github.com/microsoft/onnxruntime
- Purpose: CPU inference for Moonshine ORT model files
- License: MIT

## miniaudio

- Project: https://github.com/mackron/miniaudio
- Purpose: Portable native microphone capture
- License: Public domain or MIT-0

This draft does not yet bundle these components in the VSIX. The current native helper is a dependency-free protocol stub.