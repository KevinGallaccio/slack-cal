# Contributing

Thanks for your interest in slack-cal. This is a small personal project but contributions are welcome.

## Reporting bugs

Please open a GitHub issue with:
- A short description of what happened vs. what you expected.
- A minimal reproduction (event title/time, calendar source, classifier output if relevant).
- Logs, with secrets redacted.

## Suggesting features

Open an issue first to discuss. Anything explicitly marked **out of scope** in `specs.md` (multi-user, web UI, Outlook) is unlikely to land here without a strong case.

## Pull requests

1. Fork and create a branch off `main`.
2. Run `npm install`.
3. Make your change. Keep PRs focused — one concern per PR.
4. Make sure `npm run typecheck`, `npm run lint`, and `npm test` all pass.
5. Update `specs.md` if you changed the architecture.
6. Open the PR with a description of *why* the change is needed.

## Code style

- TypeScript, strict mode. No `any` unless there's a reason and a comment.
- Match the existing module structure (`src/<domain>/<file>.ts`).
- Prefer small, focused functions. Push side effects (HTTP, DB) to the edges.
- Tests go in `tests/`. Use `vitest`.

## Architecture decisions

If you're proposing a structural change (e.g., swapping the scheduler, changing the LLM, adding a new calendar source), please open an issue describing the trade-offs first.
