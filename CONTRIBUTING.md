# Contributing

Thank you for helping improve Spoken Page Enhanced.

## Before opening an issue

Please include:

- Spoken Page Enhanced version
- Upstream Spoken Page base version
- Browser and version
- Windows/Docker version when relevant
- Steps to reproduce
- Expected behavior
- Actual behavior
- Relevant error text

Remove private paths, usernames, IP addresses, media titles, tokens, and other personal information from logs and screenshots.

## Pull requests

Keep changes focused. Avoid replacing large upstream files just to make a small fix. Mark project-specific changes with clear Enhanced comments where practical so future maintainers can distinguish them from upstream code.

Run the project's validation commands before submitting a change when they exist:

```text
npm run typecheck
npm test
npm run build
npm audit --omit=dev
```

## Upstream relationship

This repository is an independent enhancement project based on Spoken Page. Check the upstream repository for upstream bug fixes and architectural changes before carrying large patches forward.
