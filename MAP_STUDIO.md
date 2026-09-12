# Hiraeth Map Studio

## Default: password-free, download-only editing

`npm run editor` and `npm run studio` now open the same download-only editor. See [MAP_EDITOR.md](MAP_EDITOR.md) for setup and workflow. Edits stay in the browser, and **Download changes** saves copies to your device. No password is required, and server writes and uploads are disabled.

Install downloaded files in the maps folder manually before using the existing publishing process. The default editor does not update or deploy the player website.

The previous authenticated Studio remains available via `npm run studio:legacy` for old workspaces; the older local save server is `npm run editor:legacy`. Existing drafts and password files are preserved but unused by the default editor.

## Legacy Studio deployment

The instructions below describe the optional legacy service, not the default file editor.

Hiraeth Map Studio packages the existing visual map editor into a LAN-only local testing service. It provides immediate local previews, guided new-map creation, isolated draft branches, complete release validation, and GitHub draft pull-request creation.

Public deployment remains review-gated: Studio never merges a pull request or pushes directly to `main`. The existing GitHub Actions workflow deploys the public site after a maintainer approves and merges the pull request.

## Requirements

- A dedicated clean clone of this repository on the Docker host
- Docker Engine with Docker Compose
- A LAN hostname that resolves to the Docker host, such as `map-studio.local`
- A GitHub App installed only on this repository, or a fine-grained repository token, when automated pull requests are desired

Studio mounts the host checkout read-only and creates a private service clone inside its persistent volume. Each `map-studio/*` draft lives in a worktree owned by that service clone, so Studio neither changes the mounted checkout nor adds branches and worktree metadata to its `.git` directory. A dedicated clone is still recommended for a long-running service, but it is no longer a data-isolation requirement.

## 1. Prepare the host

Clone the repository into a dedicated directory and enter it:

```sh
git clone https://github.com/Hiraeth-Adventuring-Information-Repos/map.hiraeth.git map-studio
cd map-studio
```

Create the local configuration and secret directory:

```sh
cp .env.example .env
mkdir -p .secrets
chmod 700 .secrets
```

Set `MAP_STUDIO_HOSTNAME` in `.env` to the exact hostname maintainers will use. Add that hostname to local DNS, or to the hosts file on each authorized LAN device. Set `MAP_STUDIO_LAN_IP` to the Docker host's current private-network address when maintainers should also be able to open Studio by IP. If DHCP changes that address, update `.env` and rerun `docker compose up -d`.

## 2. Configure GitHub

### Recommended: GitHub App

Create a private GitHub App and grant only these repository permissions:

- **Metadata:** read-only
- **Contents:** read and write
- **Pull requests:** read and write

Do not grant Administration, Actions write, Workflows, organization, or account permissions. Install the App only on `map.hiraeth`.

Put the App ID, installation ID, repository owner, and repository name in `.env`. Download the App private key to:

```text
.secrets/github-app-private-key.pem
```

Set `MAP_STUDIO_GITHUB_PRIVATE_KEY_SECRET_FILE=./.secrets/github-app-private-key.pem` in `.env` so Compose mounts the key instead of the disabled-integration placeholder.

Then restrict it:

```sh
chmod 600 .secrets/github-app-private-key.pem
```

Studio exchanges that key for short-lived installation tokens. The private key is mounted read-only as a Docker secret and is never written into the Git configuration or image.

After sign-in, expand **Publishing setup** in the draft workflow. Studio lists each missing host setting without displaying credential values. Once the configuration is complete, **Check GitHub connection** verifies live repository access before a maintainer starts publication.

### Initial alternative: fine-grained token

For a short-lived personal installation, create a fine-grained token restricted to this repository with Contents and Pull requests write access. Put only the token in `.secrets/github-token.txt`, set this in `.env`, and give it an expiration:

```text
MAP_STUDIO_GITHUB_TOKEN_SECRET_FILE=./.secrets/github-token.txt
```

Do not use a classic personal access token. Do not put any token directly in `compose.yaml`, `.env`, a Git remote URL, or a container image.

## 3. Start the service

Validate and build the configuration:

```sh
docker compose config --quiet
docker compose build map-studio
docker compose up -d
docker compose ps
```

The `map-studio` application is reachable only through the internal Compose network. Caddy is the LAN-facing service and exposes it over plain HTTP on port 80.

## 4. Open Map Studio

After LAN name resolution is configured, open the hostname URL:

```text
http://map-studio.local/studio
```

When `MAP_STUDIO_LAN_IP` is configured, the equivalent `http://<LAN-IP>/studio` address is also served. No certificate installation is required.

Studio opens directly into the local dashboard; this Compose deployment does not use a password or login session.

## Maintainer workflow

1. Open Map Studio and click **Edit maps**. No change title or branch setup is required before editing.
2. Studio prepares an isolated editing draft automatically, or continues the existing draft. **New map** also prepares a draft automatically. A review-only editor has a **Start editing** action that keeps the selected map. The original checkout remains untouched.
3. Open the visual editor and save map data normally, or use **New map** to upload supported artwork and create the map data and atlas entry automatically.
4. Build and inspect the live preview.
5. Return to Studio, expand **Publish changes**, enter a descriptive change title, and click **Create draft pull request**. This step requires a configured GitHub connection; local editing and preview do not.
6. Studio advances the asset version when needed, runs `npm run publish:check`, stages only approved map/version files, commits, pushes, and creates a draft PR.
7. Review GitHub checks and the preview, then approve and merge the PR through GitHub.
8. Click **Check merge and sync**. Studio verifies the exact draft commit was merged (including squash or rebase merges), removes the completed draft, and opens the merged maps from a private review checkout. The original mounted checkout remains untouched. **Abandon local draft** provides a typed-confirmation recovery path for drafts that should be discarded; it never deletes a remote branch.

## New-map behavior

The guided workflow accepts WebP, PNG, or JPEG artwork and asks for:

- Map name and stable ID
- Parent map or folder
- Optional scale values
- Atlas description and map introduction

Studio previews the selected artwork and requires a review of every file it will create, update, or regenerate before writes are enabled. Existing WebP artwork is preserved; PNG and JPEG inputs are auto-oriented where applicable, stripped of non-rendering metadata, and converted to high-quality WebP. Studio then reads the final dimensions with ImageMagick, creates `maps/<id>.webp` and `maps/<id>.json`, adds the flat `maps/maps.json` entry, regenerates the atlas, and validates everything transactionally. A failed validation restores the prior files.

Every save and new-map upload creates a recovery journal in the private worktree's Git metadata before repository files change. If the container stops during regeneration or validation, the next startup restores the complete pre-operation snapshot and removes incomplete generated files. Preview jobs also persist their state; an interrupted build discards its partial `dist/` bundle and can be started again safely. Publication jobs persist their title, output, branch, and status in the drafts volume. **Resume publication** reuses an existing validated commit or open pull request instead of duplicating either, while **Dismiss status** abandons only the saved job record.

## Security model

- The original `npm run editor` command remains loopback-only.
- Local Compose mode disables password authentication. It still requires an allowlisted Host header, exact same-origin writes, and a per-process CSRF token.
- Login attempts are rate-limited.
- Map writes are enabled only inside the active managed `map-studio/*` worktree. The mounted checkout remains read-only to Studio regardless of its branch or dirty state.
- Publishing rejects every changed path except `maps/**` and the four synchronized asset-version files.
- Git credentials are supplied to one command through the process environment and are not persisted in the remote URL or credential store.
- The application runs as a non-root container user and does not mount the Docker socket.
- Map artwork uploads are streamed into a temporary directory, limited to 512 MiB, restricted to WebP, PNG, or JPEG, inspected by ImageMagick, and removed after processing.

HTTP does not encrypt edited map data in transit, and this local testing deployment has no login gate. Keep the service on a trusted LAN or private VPN, and never forward port 80 from the public internet to this Compose project.

## Operations

Check health and logs:

```sh
docker compose ps
docker compose logs --tail=200 map-studio
docker compose logs --tail=100 studio-proxy
```

Run the hermetic browser workflow before releasing Studio changes:

```sh
npm run test:studio:e2e
```

The suite uses a temporary repository, local bare Git remote, and simulated draft pull request. It exercises the real authenticated draft, upload, edit/save, preview, publish, restart recovery, and merged-draft cleanup paths without credentials or writes to the working repository.

Update the Studio application only while its workspace is clean and on `main`:

```sh
git pull --ff-only origin main
docker compose up -d --build
```

The tile cache and private Studio clone/worktrees are persistent named volumes. Back up the `map_studio_drafts` volume when an unpushed draft is important; rebuilding the application image does not remove it. The host clone mounted at `/workspace` is a read-only source and recovery remote, not the active editing workspace.

## Product architecture

Map Studio is organized around one workspace lifecycle rather than a collection of unrelated tools:

1. **Draft** establishes a reversible Git boundary.
2. **Edit** changes map and atlas documents through transactional APIs.
3. **Validate** regenerates derived data and the exact Pages preview.
4. **Review** creates a draft pull request without merging it.

The server is the authority for capabilities such as `canEdit`, `canCreateMap`, and `canPublish`. The browser renders those capabilities and their reasons; it must not invent a second set of Git or security rules. `js/map-studio-model.js` turns the server state into a testable presentation model so new workspace states do not add scattered button conditionals.

The editor follows three stable inspector surfaces:

- **Map** contains frequently edited visitor-facing metadata.
- **Features** contains feature discovery, selection, content, and geometry.
- **Advanced** contains paths, dimensions, calibration, and atlas placement.

New fields should join one of those surfaces through a reusable field definition instead of adding another always-open section. New background work should use the existing job-status pattern and expose a resumable state, recent output, and a clear recovery action.

### Long-term completion gates

The current capability model and inspector structure are foundations, not the end of the product. Map Studio should not be described as mature until all of these gates are met:

- [x] Each Studio draft uses its own persistent Git worktree and private service clone instead of writing Git state into the mounted checkout.
- [x] Map and feature edits have command-based undo and redo, including geometry operations.
- [x] Map and feature forms are schema-driven, with field help, validation, and extension points in one registry.
- [x] New-map creation previews artwork, supports preprocessing where safe, and explains every generated file before writing.
- [x] GitHub setup has an in-product capability check and concrete remediation without exposing secrets.
- [x] Interrupted save, validation, upload, preview, and publish jobs can be resumed or safely abandoned after a restart.
- [x] Browser tests cover draft start, map creation, edit/save, preview build, pull-request preparation, and recovery paths at desktop and narrow widths.
- [x] A maintainer can complete the common workflow without opening technical workspace JSON or knowing repository internals.

Until those gates are complete, changes should improve the lifecycle and shared state model instead of introducing another standalone card, modal, or one-off endpoint.
