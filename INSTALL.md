# Installation Guide

## Before you start

Spoken Page Enhanced is an enhancement project based on a compatible Spoken Page v1.3.0 source tree. It is not a separate replacement for Audiobookshelf and it does not replace Audiobookshelf itself.

Make a backup of your current Spoken Page project before applying an Enhanced release.

## 1. Back up the three main Enhanced files

From your Spoken Page project folder:

```powershell
Copy-Item .\src\components\player-panel.tsx .\src\components\player-panel.before-enhanced.tsx
Copy-Item .\src\components\dashboard.tsx .\src\components\dashboard.before-enhanced.tsx
Copy-Item .\src\app\globals.css .\src\app\globals.before-enhanced.css
```

If a release explicitly contains additional files, back those up too before replacement.

## 2. Replace only the files listed by the release

Do not replace `compose.yml`, `.env`, or your Audiobookshelf authentication/session configuration unless a release specifically tells you to.

## 3. Rebuild

```powershell
docker compose up -d --build
```

## 4. Check the container

```powershell
docker compose ps
```

## 5. Refresh the browser

Use `Ctrl+F5` in the browser.

## 6. If the build fails

Do not guess or start changing random files.

Copy the complete PowerShell build error, especially the first TypeScript or module error, and report it as a GitHub issue with personal paths removed.

## Rollback

Use the backup files created before the update:

```powershell
Copy-Item .\src\components\player-panel.before-enhanced.tsx .\src\components\player-panel.tsx -Force
Copy-Item .\src\components\dashboard.before-enhanced.tsx .\src\components\dashboard.tsx -Force
Copy-Item .\src\app\globals.before-enhanced.css .\src\app\globals.css -Force

docker compose up -d --build
```

## New project setup

For a brand-new installation, follow the original Spoken Page README first. The upstream project documents Docker Compose, environment variables, Audiobookshelf connectivity, security, and source-build validation.

Original documentation:

https://github.com/JCDeSantis/spoken-page
