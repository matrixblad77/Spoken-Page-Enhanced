# GitHub setup guide for Spoken Page Enhanced

## 1. Decide the repository name

Recommended:

`spoken-page-enhanced`

The eventual public URL will be:

`https://github.com/YOUR-USERNAME/spoken-page-enhanced`

Replace `YOUR-USERNAME` with your GitHub username.

## 2. Create a new repository

On GitHub:

1. Click the `+` menu in the upper-right.
2. Click **New repository**.
3. Repository name: `spoken-page-enhanced`.
4. Add the short description from the README.
5. Choose **Public** if you want the project publicly discoverable.
6. For an existing local project, do **not** initialize the repository with another README. You already have one in this pack.
7. Create the repository.

GitHub's current repository quickstart recommends creating a repository, choosing a name/description/visibility, and optionally adding a README. Because you already have a complete local README, keeping the new repository empty avoids a first-commit collision.

## 3. Put the project files in your local repository

Your local project should contain the actual Spoken Page Enhanced source tree plus the documentation in this pack.

The repository should look broadly like:

```text
spoken-page-enhanced/
├─ src/
│  ├─ app/
│  ├─ components/
│  └─ lib/
├─ public/
├─ docs/
│  └─ images/
├─ .github/
├─ README.md
├─ INSTALL.md
├─ CHANGELOG.md
├─ CONTRIBUTING.md
├─ SECURITY.md
├─ CODE_OF_CONDUCT.md
├─ .gitignore
├─ Dockerfile
├─ compose.yml
├─ package.json
└─ ...
```

Keep your normal source tree intact. This documentation pack does not replace your working project files.

## 4. Run the public-repository safety check

From PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check-public-repo.ps1
```

Review the result manually too.

## 5. Initialize Git locally

From the root of your new project:

```powershell
git init
git add .
git status
```

Make sure the status does not show `.env`, private logs, personal screenshots, or other private data.

Then:

```powershell
git commit -m "Initial Spoken Page Enhanced release"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/spoken-page-enhanced.git
git push -u origin main
```

GitHub will ask you to authenticate.

## 6. Add a good repository description

Use:

`Spoken Page Enhanced — a subtitle-first Audiobookshelf companion with fullscreen read-along customization, visualizer effects, bookmarks, and personal lists.`

## 7. Add topics

Good starting topics:

- audiobookshelf
- audiobook
- subtitles
- srt
- read-along
- docker
- nextjs
- pwa
- audiobook-player
- audiobook-library

GitHub currently allows up to 20 topics; topic names should be lowercase and use letters, numbers, and hyphens.

## 8. Add screenshots

Put screenshots here:

`docs/images/`

For example:

```text
docs/images/01-library.png
docs/images/02-fullscreen.png
docs/images/03-appearance.png
docs/images/04-personal-lists.png
```

Then embed them in README.md using relative paths.

For the repository's social-preview image, GitHub recommends PNG/JPG/GIF under 1 MB and at least 1280×640 for best display.

## 9. Make the first GitHub release

Once the repository is working:

1. Open the repository.
2. Click **Releases**.
3. Choose **Create a new release**.
4. Create a tag such as `v1.3.2-enhanced` or use your project's own Enhanced tag convention.
5. Give the release a clear title, such as `Spoken Page Enhanced v1.3.2`.
6. Upload a clean project ZIP as a release asset.
7. Upload any other user-downloadable asset you intentionally distribute.
8. Publish the release.

GitHub releases are the best place for downloadable ZIPs/binaries. GitHub also creates source ZIP/tarball links for the tagged repository state.

## 10. Keep normal source in Git; use Releases for ready-to-download packages

A good structure is:

- Git repository = source code and documentation.
- Releases = tested user downloads.
- README = what the project is and how to get started.
- INSTALL.md = detailed setup/upgrade steps.
- CHANGELOG.md = what changed in each Enhanced version.

## 11. How to see activity/downloads

### Stars / watchers / forks

These are visible from the repository page.

### Visitors and clones

Open:

`Insights -> Traffic`

GitHub's traffic view provides visitors, full clones, referring sites, and popular content. The traffic dashboard covers the most recent 14 days.

### Release downloads

Open:

`Releases`

Each release asset has a download count. GitHub also exposes release download counts through its API.

### Can you see exactly who downloaded it?

No. GitHub gives aggregate download counts, traffic information, referrers, and repository activity, but it does not give you a list of the individual people who downloaded a release asset.

You can see public contributors/commit authors when they contribute to the repository.

## 12. Issues

Enable Issues and use the supplied templates for:

- Bug reports
- Feature requests

Ask users to remove private information before posting logs/screenshots.

## 13. Discussions

Once the project gets users, GitHub Discussions can be useful for setup help, feature ideas, screenshots, and general questions without turning every conversation into an Issue.

## 14. Project homepage / About section

Set the repository's About description to the same one used in README.md.

Add the original Spoken Page repository URL as the official upstream link.

## 15. Thank the original developer

Keep a visible credit section in README.md and do not imply that Spoken Page Enhanced is the official Spoken Page project.

A good wording is:

> Thank you to JCDeSantis for creating Spoken Page and releasing it as open source. Spoken Page Enhanced builds on that project rather than replacing or claiming ownership of the original project.

## 16. AI-assistance disclosure

Keep the AI-assisted development notice in README.md. It is useful context for users and future contributors and is honest about how the project was developed.

## 17. Before every release

1. Test the Docker build.
2. Test sign-in and Audiobookshelf connection.
3. Test a normal audiobook.
4. Test an audiobook with SRT/VTT.
5. Test fullscreen.
6. Test pop-out/fullscreen controls.
7. Test appearance controls.
8. Test personal-list saving/sync.
9. Check browser console for new errors.
10. Run the public-repository safety check.
11. Update CHANGELOG.md.
12. Create the release and attach the tested ZIP.

## 18. Recommended first public release workflow

Do not publish while you are still changing core behavior every few minutes.

Use this sequence:

`private repository -> final local testing -> first public repository -> first release -> Reddit post`

That keeps early debugging activity out of the public project history as much as practical.
