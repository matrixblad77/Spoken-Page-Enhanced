# Installation Guide

Spoken Page Enhanced is an independent enhancement project based on **Spoken Page v1.3.0** by [JCDeSantis](https://github.com/JCDeSantis/spoken-page).

It keeps Audiobookshelf as the source of truth while adding Enhanced read-along, fullscreen, visualizer, bookmark, personal-list, and appearance features.

There are two supported ways to install Spoken Page Enhanced.

---

## Before you start

Spoken Page Enhanced runs in **Docker**.

For the normal Docker installation, you do **not** need to install Node.js or npm separately on your computer. The application build environment is provided by Docker.

### Windows — install Docker Desktop

Download Docker Desktop for Windows from Docker's official website:

https://docs.docker.com/desktop/setup/install/windows-install/

Docker Desktop uses the **WSL 2 backend by default on Windows** on supported systems. Hardware virtualization must be enabled for the virtualization backend to work. For detailed requirements and installation instructions, use Docker's official documentation.

After installing Docker Desktop:

1. Start Docker Desktop.
2. Wait until Docker Desktop reports that it is running.
3. Open PowerShell.
4. Verify that Docker is available:

```powershell
docker --version
docker compose version
```

Both commands should return version information.

If Docker Desktop is already installed and working, you can skip this section.

### Other operating systems

Docker Desktop is also available for macOS and Linux. See Docker's official installation page:

https://docs.docker.com/get-started/get-docker/

---

# Option 1 — New installation

**Recommended for new users.**

You do **not** need to install the original Spoken Page separately.

## 1. Download Spoken Page Enhanced

Download the latest release from:

https://github.com/matrixblad77/Spoken-Page-Enhanced/releases

For example:

```text
Spoken Page Enhanced v1.3.2
```

You can also clone the repository:

```powershell
git clone https://github.com/matrixblad77/Spoken-Page-Enhanced.git
cd Spoken-Page-Enhanced
```

## 2. Create your environment file

Copy:

```text
.env.example
```

to:

```text
.env
```

For example:

```powershell
Copy-Item .\.env.example .\.env
```

Open `.env` and configure the required settings.

Example:

```dotenv
SPOKEN_PAGE_SECRET=replace-with-a-long-random-value
SPOKEN_PAGE_ABS_BASE_URL=http://host.docker.internal:13378
```

### Audiobookshelf URL

`SPOKEN_PAGE_ABS_BASE_URL` is the Audiobookshelf address that **the Spoken Page container can reach**. It is not necessarily the same address you type into your browser.

Examples:

```text
ABS running on the same Windows PC:
http://host.docker.internal:13378

ABS on another LAN computer:
http://192.168.1.50:13378

ABS behind HTTPS:
https://abs.example.com
```

Do not publish your `.env` file or any secrets from it.

## 3. Start Spoken Page Enhanced

From the project directory:

```powershell
docker compose up -d
```

The first startup may take some time while Docker downloads the required images and builds the application.

## 4. Check the container

Run:

```powershell
docker compose ps
```

The `spoken-page` container should be running.

## 5. Open Spoken Page Enhanced

Open:

```text
http://localhost:3000
```

Sign in using your existing Audiobookshelf account.

Spoken Page Enhanced uses Audiobookshelf for your library, account, metadata, playback, and progress information.

---

# Option 2 — Enhance an existing Spoken Page v1.3.0 source installation

Use this option if you already have a working **Spoken Page v1.3.0 source project** and want to apply the Enhanced changes to it.

**Spoken Page Enhanced v1.3.2 is based on Spoken Page v1.3.0.**

Do not apply the v1.3.2 Enhanced files to an unrelated or newer Spoken Page version unless a future release specifically states that it is supported.

## Before applying the Enhanced files

Make a complete backup of your existing Spoken Page project.

Do not replace your own:

```text
.env
compose.yml / docker-compose.yml
Audiobookshelf connection settings
persistent Docker data / volumes
machine-specific configuration
```

unless the specific Enhanced release explicitly tells you to change them.

## Enhanced v1.3.2 files

For **Spoken Page Enhanced v1.3.2**, the primary Enhanced source changes are:

```text
src/components/player-panel.tsx
src/components/dashboard.tsx
src/components/spoken-page-header.tsx
src/app/globals.css
```

The Enhanced release may also contain version metadata and other project files needed by the complete release.

For the most reliable installation, use the **complete Spoken Page Enhanced release** rather than manually copying individual files.

### Version metadata

Enhanced v1.3.2 uses:

```text
package.json       → 1.3.2
package-lock.json  → 1.3.2
```

The Enhanced header reads the application version from the project version instead of maintaining a separate hardcoded release number.

## 1. Back up the files before replacing them

From your existing Spoken Page project folder:

```powershell
Copy-Item .\src\components\player-panel.tsx .\src\components\player-panel.before-enhanced.tsx
Copy-Item .\src\components\dashboard.tsx .\src\components\dashboard.before-enhanced.tsx
Copy-Item .\src\components\spoken-page-header.tsx .\src\components\spoken-page-header.before-enhanced.tsx
Copy-Item .\src\app\globals.css .\src\app\globals.before-enhanced.css
```

If the release instructions identify additional files, back those up before replacing them as well.

## 2. Replace the Enhanced files

Copy the corresponding files from the compatible Enhanced release into your existing Spoken Page source tree.

For v1.3.2:

```text
src/components/player-panel.tsx
src/components/dashboard.tsx
src/components/spoken-page-header.tsx
src/app/globals.css
```

Do **not** blindly overwrite unrelated files.

If the release notes identify additional required files, follow those instructions as well.

## 3. Check the project version

For Enhanced v1.3.2, the application version should be:

```text
1.3.2
```

The version in `package.json` and `package-lock.json` should agree.

## 4. Rebuild

From the project directory:

```powershell
docker compose up -d --build
```

## 5. Check the container

```powershell
docker compose ps
```

Make sure the `spoken-page` container is running.

## 6. Refresh the browser

Use:

```text
Ctrl+F5
```

Then open:

```text
http://localhost:3000
```

The header should display the Enhanced branding and the installed application version.

---

# Updating to a newer Enhanced release

Before updating:

1. Back up your working Spoken Page/Enhanced project.
2. Check the release notes.
3. Confirm the compatible upstream Spoken Page version.
4. Check which files changed in that Enhanced release.
5. Preserve your `.env`, Audiobookshelf connection configuration, and persistent data unless the release specifically requires a change.

Do not assume that files from one Enhanced release can be copied into every future Spoken Page version.

---

# Rebuilding after changes

Whenever source files are replaced or updated:

```powershell
docker compose up -d --build
```

Then check:

```powershell
docker compose ps
```

Use `Ctrl+F5` in the browser after rebuilding so the browser does not continue displaying an older cached version.

---

# If the build fails

Do not start changing unrelated files or dependencies at random.

Run:

```powershell
docker compose up -d --build
```

and copy the complete PowerShell output.

For TypeScript or module errors, include the first relevant error. Later errors may simply be consequences of the first error.

When opening a GitHub issue, remove:

* Windows usernames and private paths
* IP addresses
* Audiobookshelf library information
* passwords
* API tokens
* other private information

---

# Rollback

If you created the backup files listed above, restore them with:

```powershell
Copy-Item .\src\components\player-panel.before-enhanced.tsx .\src\components\player-panel.tsx -Force
Copy-Item .\src\components\dashboard.before-enhanced.tsx .\src\components\dashboard.tsx -Force
Copy-Item .\src\components\spoken-page-header.before-enhanced.tsx .\src\components\spoken-page-header.tsx -Force
Copy-Item .\src\app\globals.before-enhanced.css .\src\app\globals.css -Force
```

Then rebuild:

```powershell
docker compose up -d --build
```

---

# Security

Never publish:

```text
.env
Audiobookshelf passwords
Audiobookshelf tokens
private logs
private library paths
machine-specific configuration
```

Keep your `.env` file local.

For internet-facing installations, use HTTPS and review [SECURITY.md](SECURITY.md).

---

# Related documentation

* [README](README.md)
* [CHANGELOG](CHANGELOG.md)
* [PATCH NOTES](PATCH_NOTES.md)
* [SECURITY](SECURITY.md)
* [Original Spoken Page](https://github.com/JCDeSantis/spoken-page)

## Version compatibility

| Enhanced release | Upstream base      |
| ---------------- | ------------------ |
| v1.3.2           | Spoken Page v1.3.0 |
