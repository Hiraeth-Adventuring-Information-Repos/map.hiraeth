# Hiraeth Map Studio

Hiraeth Map Studio packages the existing visual map editor into an authenticated LAN service. It provides immediate local previews, guided new-map creation, isolated draft branches, complete release validation, and GitHub draft pull-request creation.

Public deployment remains review-gated: Studio never merges a pull request or pushes directly to `main`. The existing GitHub Actions workflow deploys the public site after a maintainer approves and merges the pull request.

## Requirements

- A dedicated clean clone of this repository on the Docker host
- Docker Engine with Docker Compose
- A LAN hostname that resolves to the Docker host, such as `map-studio.local`
- A strong Studio password
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
openssl rand -base64 36 > .secrets/map-studio-password.txt
chmod 700 .secrets
chmod 600 .secrets/map-studio-password.txt
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

The `map-studio` application is reachable only through the internal Compose network. Caddy is the LAN-facing service and provides HTTPS using its local certificate authority.

## 4. Trust the LAN certificate

Caddy stores its local root certificate in the `caddy_data` volume. Export it on the Docker host:

```sh
docker compose cp studio-proxy:/data/caddy/pki/authorities/local/root.crt ./map-studio-root.crt
```

Install `map-studio-root.crt` as a trusted root certificate only on authorized maintainer devices. The exact installation process depends on the operating system. After trust and LAN name resolution are configured, open the hostname URL:

```text
https://map-studio.local/studio
```

When `MAP_STUDIO_LAN_IP` is configured, the equivalent `https://<LAN-IP>/studio` address is also served. Both addresses use Caddy's private certificate authority, so each maintainer device must trust the exported root certificate.

Use the password stored in `.secrets/map-studio-password.txt`.

## Maintainer workflow

1. Open Map Studio and enter a concise change title.
2. Click **Start local draft**. Studio creates a unique persistent worktree and `map-studio/*` branch in its private service repository. When GitHub is connected it fetches `origin/main`; offline drafts import the mounted checkout's committed `main` ref without writing to that checkout.
3. Open the visual editor and save map data normally, or use **New map** to upload supported artwork and create the map data and atlas entry automatically.
4. Build and inspect the live preview.
5. Return to Studio and click **Create draft pull request**.
6. Studio advances the asset version when needed, runs `npm run publish:check`, stages only approved map/version files, commits, pushes, and creates a draft PR.
7. Review GitHub checks and the preview, then approve and merge the PR through GitHub.
8. Click **Sync merged draft**. Studio verifies that the branch is present in `origin/main`, removes the isolated worktree and local branch, and leaves the mounted checkout untouched. **Abandon local draft** provides a typed-confirmation recovery path for drafts that should be discarded; it never deletes a remote branch.

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
- LAN mode requires an allowlisted Host header, authenticated HttpOnly/SameSite session, exact same-origin requests, and a per-session CSRF token.
- Login attempts are rate-limited.
- Map writes are enabled only inside the active managed `map-studio/*` worktree. The mounted checkout remains read-only to Studio regardless of its branch or dirty state.
- Publishing rejects every changed path except `maps/**` and the four synchronized asset-version files.
- Git credentials are supplied to one command through the process environment and are not persisted in the remote URL or credential store.
- The application runs as a non-root container user and does not mount the Docker socket.
- Map artwork uploads are streamed into a temporary directory, limited to 512 MiB, restricted to WebP, PNG, or JPEG, inspected by ImageMagick, and removed after processing.

Keep the service on a trusted LAN or private VPN. Do not forward ports 80 or 443 from the public internet to this Compose project.

## Operations

Check health and logs:

```sh
docker compose ps
docker compose logs --tail=200 map-studio
docker compose logs --tail=100 studio-proxy
```

Update the Studio application only while its workspace is clean and on `main`:

```sh
git pull --ff-only origin main
docker compose up -d --build
```

The tile cache, private Studio clone/worktrees, Caddy certificate authority, and Caddy configuration are persistent named volumes. Back up the `map_studio_drafts` volume when an unpushed draft is important; rebuilding the application image does not remove it. The host clone mounted at `/workspace` is a read-only source and recovery remote, not the active editing workspace.

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
- [ ] Browser tests cover draft start, map creation, edit/save, preview build, pull-request preparation, and recovery paths at desktop and narrow widths.
- [x] A maintainer can complete the common workflow without opening technical workspace JSON or knowing repository internals.

Until those gates are complete, changes should improve the lifecycle and shared state model instead of introducing another standalone card, modal, or one-off endpoint.
