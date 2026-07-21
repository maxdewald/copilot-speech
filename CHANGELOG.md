# Changelog

## [0.3.0](https://github.com/maxdewald/copilot-speech/compare/v0.2.0...v0.3.0) (2026-07-21)


### Features

* add live chat preview and silence auto-stop ([21da026](https://github.com/maxdewald/copilot-speech/commit/21da0265ac74920c35170cd7ef4bac8230c05788))
* add model download management and improve chat delivery ([cc2875b](https://github.com/maxdewald/copilot-speech/commit/cc2875b914df7a6b1062fb1f251ab82fcc53306e))


### Refactoring

* move inference to Node worker using Cohere Transcribe ([40ccc81](https://github.com/maxdewald/copilot-speech/commit/40ccc816e4d5f76a691d5eac7e71ba0883f8afe7))


### Documentation

* add model benchmarks and marketplace badge to README ([3f29e4a](https://github.com/maxdewald/copilot-speech/commit/3f29e4ac5af936052d0f65e4f61e078cda58ccdd))

## [0.2.0](https://github.com/maxdewald/copilot-speech/compare/v0.1.0...v0.2.0) (2026-07-19)


### Features

* add dictation to chat input status menu ([776cb41](https://github.com/maxdewald/copilot-speech/commit/776cb41272f939e89263d83cb1111c4e9d195ac2))
* implement native voice helper and dictation flow ([855ef53](https://github.com/maxdewald/copilot-speech/commit/855ef53349ad4b30de0148d3b506ca845a94679f))
* initial Copilot Speech draft ([71bc3c3](https://github.com/maxdewald/copilot-speech/commit/71bc3c314e98689dcba0d841dabbacb1ad106165))
* replace chat panel menus with status bar ([db76903](https://github.com/maxdewald/copilot-speech/commit/db7690315c21b106d3cf5edea9f179157f8fe041))
* support multi-language dictation and model architectures ([6efff95](https://github.com/maxdewald/copilot-speech/commit/6efff954d04ff38818f0b295c3fa6cd5c4e14405))
* support partial transcripts and refine dictation UI ([78e61ff](https://github.com/maxdewald/copilot-speech/commit/78e61ff4b8a80dbb10ddd9e757d28ff986e7c7b2))


### Bug Fixes

* prevent Windows ERROR macro from breaking moonshine headers ([ead2b75](https://github.com/maxdewald/copilot-speech/commit/ead2b75a5945179a017a42c3a2e7bddc637503ec))
* suppress MSVC deprecation warnings on Windows ([98ab182](https://github.com/maxdewald/copilot-speech/commit/98ab182658ab6548c90922136674caa188e0fb57))


### Refactoring

* consolidate native dependency scripts and use CMake FetchContent ([8e6b2b4](https://github.com/maxdewald/copilot-speech/commit/8e6b2b4d03af5bed233e936a19298f9cec1ae3aa))
* focus extension on core dictation flow ([31694e4](https://github.com/maxdewald/copilot-speech/commit/31694e458eec56a37a7365ba7c656cf2345b2f34))
* migrate native dependency fetching to TypeScript ([873f8d0](https://github.com/maxdewald/copilot-speech/commit/873f8d0a4e508eb38f3a3403af4f00762f4b0c1d))
* remove chat input status menu ([71c7f6b](https://github.com/maxdewald/copilot-speech/commit/71c7f6b4bf55ee8a160d903590de5f3a8e840f53))
* remove native-deps script ([6ec11c3](https://github.com/maxdewald/copilot-speech/commit/6ec11c3a76aa42ce374b2bf811760fc54044446b))
* unify build outputs under dist/ and clean up repository ([2130ee5](https://github.com/maxdewald/copilot-speech/commit/2130ee56d8ede1440ed251a26aae74b6bc5901ab))


### Documentation

* add logo and update readme ([2c4f87f](https://github.com/maxdewald/copilot-speech/commit/2c4f87f0f7fbf9322d018fe9b76e662dedabac0b))
* simplify and update README ([e7d3b4f](https://github.com/maxdewald/copilot-speech/commit/e7d3b4fd1849c723794345a2305ca719ed9366c9))
* simplify logo and remove AGENTS.md ([9377251](https://github.com/maxdewald/copilot-speech/commit/937725143e76aaa92e7147aca9cd4fbef22d7fc5))

## 0.1.0

- Add the first Copilot Speech extension draft.
- Add local UI-host placement, commands, keybindings, Chat status controls, and diagnostics.
- Add a versioned native-helper protocol and C++ protocol stub.
- Add Copilot Chat prefill with a clipboard fallback.
- Add Moonshine Medium and Small Streaming model metadata.
- Add TypeScript, native, packaging, CI, and release scaffolding.
