# Spoken Page Enhanced

**Subtitle-first listening for Audiobookshelf — with read-along playback, fullscreen customization, visualizer effects, bookmarks, and personal lists.**

> **Spoken Page Enhanced v1.3.2**
> Based on **Spoken Page v1.3.0** by [JCDeSantis](https://github.com/JCDeSantis/spoken-page)

[Original Spoken Page](https://github.com/JCDeSantis/spoken-page) · [Audiobookshelf](https://www.audiobookshelf.org/)

![Status](https://img.shields.io/badge/status-enhanced-blue)
![Based on](https://img.shields.io/badge/based%20on-Spoken%20Page%20v1.3.0-red)
![Docker](https://img.shields.io/badge/deployment-Docker-2496ED)
![License](https://img.shields.io/badge/license-MIT-green)

## What is Spoken Page Enhanced?

Spoken Page Enhanced is an independent enhancement project built from **Spoken Page v1.3.0**. It keeps Audiobookshelf as the source of truth while adding a more customizable read-along listening experience for people who want to listen to an audiobook while following its text on screen.

This project focuses on making the subtitle-first player more visual and customizable while retaining the core Audiobookshelf library, playback, progress, and subtitle functionality provided by the original project.

> **Important:** Spoken Page Enhanced is **not the official Spoken Page repository**. For the original project's upstream features, issues, and releases, see [JCDeSantis/Spoken Page](https://github.com/JCDeSantis/spoken-page).

## Screenshots

### Library

![Spoken Page Enhanced library](docs/images/1.PNG)

### Book Details / Lists

![Spoken Page Enhanced book details and lists](docs/images/2.PNG)

### Fullscreen Player

![Spoken Page Enhanced fullscreen player](docs/images/3.PNG)

### Minimize / Roll Up and Down Player Controls

![Spoken Page Enhanced player controls](docs/images/4.PNG)

### Player Controls Minimized

![Spoken Page Enhanced minimized player controls](docs/images/5.PNG)

### Subtitle Settings

![Spoken Page Enhanced subtitle settings](docs/images/6.PNG)

### Cover, Background, Visualizer, and Subtitle Settings

![Spoken Page Enhanced appearance, visualizer, and subtitle settings](docs/images/7.PNG)

## Features

### Original Spoken Page features retained

Spoken Page v1.3 provides the foundation for this project. The upstream project includes a responsive subtitle-first Audiobookshelf web player, complete-library search, Audiobookshelf-derived listening status plus Want to listen, remembered library views, series handling, progress-save feedback, account-synced pinned books, resume/continue listening, multi-track progress synchronization, chapters and timeline navigation, playback speed and subtitle timing, sleep timer, focused/separate player views, keyboard and Media Session controls, automatic SRT/VTT discovery, local subtitle upload, subtitle-focused reading, and per-book subtitle source/timing preferences.

See the [original Spoken Page README](https://github.com/JCDeSantis/spoken-page) and its release history for the authoritative upstream feature list.

### Enhanced features

#### Read-along / fullscreen player

* Subtitle-focused fullscreen listening view.
* Current audiobook cover used as the visual centerpiece.
* Cover art remains proportional rather than being stretched or cropped.
* Cover art can be resized, repositioned, and adjusted for opacity.
* Cover editing is locked by default and must be unlocked before editing.
* Per-book visual settings can be saved.
* Fullscreen, close, pop-out, subtitle options, and appearance controls remain separate from the visual layers so artwork does not block controls.
* Player controls can be minimized or rolled up/down to provide more screen space while listening or adjusting the display.

#### Appearance customization

* Solid fullscreen background colors.
* Dark, gray, bright, and colored background choices.
* Optional background patterns.
* Optional ambient/blurred cover background.
* Dedicated appearance controls instead of placing every option in the main transport row.
* Visual layers, cover art, and subtitles can be arranged independently.

#### Audio visualizer

* Optional audio-reactive visual layer.
* Bars, waveform, combined wave/bars, and pulse-style modes where supported by the current build.
* Position, size, opacity, color, glow, sensitivity, and smoothing controls.
* Visualizer editing can be locked to prevent accidental movement during playback.
* Designed to sit behind or around the read-along presentation without obscuring subtitles or playback controls.

#### Bookmarks

* `B` keyboard shortcut for bookmarks.
* Timeline bookmark markers.
* Jump directly to saved bookmarks.
* Remove individual bookmarks.
* Clear bookmarks.

#### Personal lists

* Personal listening lists in addition to Audiobookshelf's normal library and listening-status system.
* Rename lists.
* Add and remove books from lists.
* Delete lists with confirmation.
* Account preference synchronization when supported by the Spoken Page preference backend.
* Browser-local fallback for temporary or offline situations.

#### SRT-aware library workflow

* **Has SRT subtitles** library filter.
* Detects attached subtitle files through Audiobookshelf item metadata.
* Subtitle selection and timing preferences can be saved independently for each book.

## Installation

Spoken Page Enhanced supports two installation paths.

### New installation — recommended

For a new installation, use the **Spoken Page Enhanced** repository or release directly.

You do **not** need to install the original Spoken Page separately.

See the complete [Installation Guide](INSTALL.md) for Docker Desktop setup, Audiobookshelf configuration, startup, updating, rollback, and troubleshooting.

### Requirements

Spoken Page Enhanced runs with Docker.

**Windows:** Install [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/) and make sure Docker Desktop is running before starting the application.

Verify Docker from PowerShell:

```powershell
docker --version
docker compose version
```

Node.js and npm are **not required on the host computer** for the normal Docker installation.

### Quick start

Clone the repository:

```powershell
git clone https://github.com/matrixblad77/Spoken-Page-Enhanced.git
cd Spoken-Page-Enhanced
```

Create your environment file:

```powershell
Copy-Item .\.env.example .\.env
```

Configure `.env` with a strong secret and the Audiobookshelf URL reachable from inside the Docker container.

Example:

```dotenv
SPOKEN_PAGE_SECRET=replace-with-a-long-random-value
SPOKEN_PAGE_ABS_BASE_URL=http://host.docker.internal:13378
```

Start the application:

```powershell
docker compose up -d
```

Then open:

```text
http://localhost:3000
```

For the complete setup procedure, see [INSTALL.md](INSTALL.md).

### Already using Spoken Page v1.3.0?

Spoken Page Enhanced v1.3.2 is based on **Spoken Page v1.3.0**.

If you already have a working **Spoken Page v1.3.0 source installation**, you can apply the Enhanced v1.3.2 changes rather than starting over.

For v1.3.2, the primary Enhanced source files are:

```text
src/components/player-panel.tsx
src/components/dashboard.tsx
src/components/spoken-page-header.tsx
src/app/globals.css
```

**Do not overwrite your `.env`, `compose.yml` / `docker-compose.yml`, Audiobookshelf authentication or connection settings, persistent Docker data, or other machine-specific configuration unless the release-specific instructions explicitly tell you to do so.**

Back up your existing project before applying changes and follow the existing-installation procedure in [INSTALL.md](INSTALL.md).

### Version compatibility

| Enhanced release | Upstream Spoken Page base |
| ---------------- | ------------------------- |
| v1.3.2           | v1.3.0                    |

Enhanced releases are tied to their documented upstream base version. Do not copy files from an Enhanced release into an unrelated Spoken Page version without checking the release documentation first.

## Docker

For a new Docker installation, see the [Docker Desktop installation documentation](https://docs.docker.com/desktop/setup/install/windows-install/) and then follow [INSTALL.md](INSTALL.md).

For an existing compatible source installation, rebuild after replacing Enhanced files:

```powershell
docker compose up -d --build
```

Then verify:

```powershell
docker compose ps
```

Refresh the browser with `Ctrl+F5` after rebuilding.

## Configuration and security

Keep your own machine-specific configuration private:

```text
.env
compose.yml / docker-compose.yml
Audiobookshelf connection/authentication settings
persistent data / Docker volumes
```

Never commit or publish:

* `.env` files
* passwords or API tokens
* Audiobookshelf session information
* private logs
* local library paths
* private screenshots
* machine-specific configuration

For internet-facing deployments, use HTTPS and review [SECURITY.md](SECURITY.md).

## Documentation

* [Installation Guide](INSTALL.md) — installation, Docker setup, configuration, updates, rollback, and troubleshooting
* [Changelog](CHANGELOG.md) — project version history
* [Patch Notes](PATCH_NOTES.md) — release and feature changes
* [Security](SECURITY.md) — security considerations
* [Screenshot Guide](docs/SCREENSHOTS.md) — project screenshots and documentation
* [Development Plan](docs/DEVELOPMENT_PLAN.md) — development information
* [Upstream Information](docs/UPSTREAM.md) — relationship to the original Spoken Page project

## AI-assisted development

This project was developed with substantial **AI-assisted coding, debugging, refactoring, testing, and documentation help**. The maintainer makes the final decisions and tests changes, but AI assistance does not guarantee that the software is bug-free or suitable for every deployment.

Review changes before using the project in an important or internet-facing environment, keep backups, and report problems through GitHub Issues.

## Credits and thanks

A huge thank-you to **JCDeSantis** for creating the original Spoken Page project and for making it open source.

Spoken Page provides the core Audiobookshelf integration, playback, progress synchronization, subtitle handling, account/session model, and overall application foundation that this project builds on.

Original project:

https://github.com/JCDeSantis/spoken-page

Additional acknowledgements are documented in [README-THANKS.txt](README-THANKS.txt).

The upstream repository identifies Spoken Page as MIT licensed. Preserve the applicable upstream license and attribution notices when redistributing derivative work.

## Contributing

Bug reports, screenshots, UI ideas, and pull requests are welcome.

Before opening an issue, include:

1. Your Spoken Page Enhanced version.
2. The original Spoken Page version it is based on.
3. Windows, browser, and Docker versions when relevant.
4. The exact error message or build output.
5. Any relevant steps needed to reproduce the problem.

Remove personal paths, usernames, IP addresses, tokens, passwords, and private media information from logs and screenshots before posting them.

## Versioning

Enhanced versions use their own version number and are separate from the upstream Spoken Page version.

For example:

```text
Upstream base: Spoken Page v1.3.0
Enhanced release: v1.3.2
```

Future Enhanced releases may use versions such as:

```text
v1.3.3
v1.4.0
v1.4.1
```

Meaningful changes should be recorded in [CHANGELOG.md](CHANGELOG.md).

## License

This project is based on the MIT-licensed Spoken Page project.

Preserve the upstream license and attribution notices for the original portions of the code when redistributing derivative work.

See [LICENSE](LICENSE) and the [original Spoken Page repository](https://github.com/JCDeSantis/spoken-page) for the applicable licensing information.
