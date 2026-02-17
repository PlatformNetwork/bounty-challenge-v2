# docs/ — User-Facing Documentation

## Overview

Documentation for miners, validators, and API consumers. Linked from the root README.md.

## Structure

| Path | Audience | Content |
|------|----------|---------|
| `miner/getting-started.md` | Miners | Installation, prerequisites, first registration |
| `miner/registration.md` | Miners | Step-by-step GitHub ↔ hotkey linking |
| `validator/setup.md` | Validators | Running a validator node |
| `reference/api-reference.md` | Developers | HTTP endpoints, request/response schemas |
| `reference/scoring.md` | All | Weight calculation formulas, point system |
| `anti-abuse.md` | All | Anti-abuse measures and penalty system |

## Conventions

- Use GitHub-flavored Markdown
- Include code examples with correct language tags
- Keep API reference in sync with `src/server.rs` routes
- Update scoring docs when `src/pg_storage.rs` weight constants change
- Link to relevant source files when documenting implementation details
