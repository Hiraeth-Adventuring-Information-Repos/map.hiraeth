# Hiraeth Map Studio

Hiraeth Map Studio packages the existing visual map editor into an authenticated LAN service. It provides immediate local previews, guided new-map creation, isolated draft branches, complete release validation, and GitHub draft pull-request creation.

Public deployment remains review-gated: Studio never merges a pull request or pushes directly to `main`. The existing GitHub Actions workflow deploys the public site after a maintainer approves and merges the pull request.

## Requirements

- A dedicated clean clone of this repository on the Docker host
- Docker Engine with Docker Compose
- A LAN hostname that resolves to the Docker host, such as `map-studio.local`
- A strong Studio password
- A GitHub App installed only on this repository, or a fine-grained repository token for initial testing

Do not run the Compose service from a developer checkout containing unrelated work. Studio deliberately refuses to publish non-map files, and it switches its dedicated clone between `main` and `map-studio/*` draft branches.

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

Set `MAP_STUDIO_HOSTNAME` in `.env` to the exact hostname maintainers will use. Add that hostname to local DNS, or to the hosts file on each authorized LAN device.

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

Then restrict it:

```sh
chmod 600 .secrets/github-app-private-key.pem
```

Studio exchanges that key for short-lived installation tokens. The private key is mounted read-only as a Docker secret and is never written into the Git configuration or image.

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

Install `map-studio-root.crt` as a trusted root certificate only on authorized maintainer devices. The exact installation process depends on the operating system. After trust and LAN name resolution are configured, open:

```text
https://map-studio.local/studio
```

Use the password stored in `.secrets/map-studio-password.txt`.

## Maintainer workflow

1. Open Map Studio and enter a concise change title.
2. Click **Start draft**. Studio fetches `origin/main`, fast-forwards its clean workspace, and creates a unique `map-studio/*` branch.
3. Open the visual editor and save map data normally, or use **New map** to upload WebP artwork and create the JSON and atlas entry automatically.
4. Build and inspect the live preview.
5. Return to Studio and click **Create draft pull request**.
6. Studio advances the asset version when needed, runs `npm run publish:check`, stages only approved map/version files, commits, pushes, and creates a draft PR.
7. Review GitHub checks and the preview, then approve and merge the PR through GitHub.
8. Click **Sync merged draft**. Studio verifies that the branch is present in `origin/main`, switches back to `main`, fast-forwards, and removes the merged local branch.

## New-map behavior

The guided workflow accepts WebP artwork and asks for:

- Map name and stable ID
- Parent map or folder
- Optional scale values
- Atlas description and map introduction

Studio reads the image dimensions with ImageMagick, creates `maps/<id>.webp` and `maps/<id>.json`, adds the flat `maps/maps.json` entry, regenerates the atlas, and validates everything transactionally. A failed validation restores the prior files.

## Security model

- The original `npm run editor` command remains loopback-only.
- LAN mode requires an allowlisted Host header, authenticated HttpOnly/SameSite session, exact same-origin requests, and a per-session CSRF token.
- Login attempts are rate-limited.
- Map writes are disabled unless the Git workspace is on an active `map-studio/*` branch.
- Publishing rejects every changed path except `maps/**` and the four synchronized asset-version files.
- Git credentials are supplied to one command through the process environment and are not persisted in the remote URL or credential store.
- The application runs as a non-root container user and does not mount the Docker socket.
- Map artwork uploads are streamed into a temporary directory, limited to 512 MiB, restricted to WebP, inspected by ImageMagick, and removed after processing.

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

The tile cache, Caddy certificate authority, and Caddy configuration are persistent named volumes. The Git repository remains the dedicated host clone mounted at `/workspace`; back it up like any other maintainer working copy, especially if a draft has not been pushed yet.
