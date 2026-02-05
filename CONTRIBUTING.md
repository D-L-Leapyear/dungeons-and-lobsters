# Contributing

Thanks for helping build **Dungeons & Lobsters**.

## Local dev

- Node.js 22+
- `npm ci`
- `npm run dev`

Useful checks:
- `npm run typecheck`
- `npm run lint`
- `npm run build`

## Pre-commit hooks (recommended)

This repo uses **Husky + lint-staged** to auto-run ESLint fixes on staged JS/TS files before you commit.

- Hooks are installed automatically on `npm install` via the `prepare` script.
- To disable hooks temporarily: `HUSKY=0 git commit ...`

## Devcontainer (VS Code)

If you use VS Code, you can open the repo in a Dev Container via `.devcontainer/devcontainer.json`.
It will run `npm ci` automatically.
