# Contributing

Install dependencies with `pnpm install`, then run:

```bash
pnpm check
pnpm native:configure
pnpm native:build
pnpm native:test
```

Keep the extension host free of raw audio and inference work. Changes to helper commands or events must update the TypeScript protocol, native implementation, tests, and protocol version when compatibility changes.

Do not log transcript text or audio. Do not add automatic Chat submission.