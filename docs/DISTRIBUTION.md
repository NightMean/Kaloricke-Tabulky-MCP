# Release distribution and publishing

Local clients run a compiled archive from GitHub Releases with `npx`.
Self-hosted HTTP uses the Docker image from GitHub Container Registry (GHCR).
Neither installation needs an npm account, and this project is not published
to the npm registry.

## Installation

See [local MCP](LOCAL-MCP.md) for Codex and Hermes configuration using the compiled
archive at `https://github.com/NightMean/Kaloricke-Tabulky-MCP/releases/latest/download/kaloricke-tabulky-mcp.tgz`.
Only Node.js 22+ is required locally. The package has `private: true` to prevent
accidental npm registry publication; public GitHub release archives still install
normally through npm/npx.

The Compose files already use `ghcr.io/nightmean/kaloricke-tabulky-mcp:latest`.
HTTP is the image's default command. See [hosting](../HOSTING.md) for HTTPS and OAuth.

From the repository root:

```sh
docker compose -p kt-mcp --env-file .env pull
docker compose -p kt-mcp --env-file .env up -d --no-build
```

For the optional Cloudflare Tunnel deployment, add `-f deploy/stack.yml` to both
commands. Keep the Compose files and nginx template matched to the image revision.
Public GHCR images can be pulled anonymously.

## Local verification

From the repository root:

```sh
npm ci
npm audit
npm test
npm run typecheck
npm run test:package
docker build --pull -t kt-mcp:distribution-test .
```

Run builds and tests sequentially. The package test creates and installs a local
tarball in a temporary folder to verify the compiled CLI and both transports;
it does not publish anything. Fixture credentials make no KT account requests.
Registry access is needed to download development and runtime dependencies.

The container uses production-only JavaScript and dependencies, runs as the
unprivileged `node` user, and stores HTTP OAuth state in `/data`. The publishing
workflow checks HTTP startup, the unauthenticated challenge, and real Docker
stdio tool discovery before publication.

## Manual GitHub workflow

In **Actions → Verify or publish release → Run workflow**, choose `main`
and enable `publish_image` to publish images and the compiled release archive.
Its default is **false**, which performs
verification only. Publication uses the GitHub `release` environment; configure
required reviewers there if an approval gate is wanted.

The workflow authenticates to GHCR with its `GITHUB_TOKEN` and `packages: write`,
then creates the matching GitHub Release and archive with `contents: write`.
No npm login, npm token, or npm trusted publisher is needed. It refuses publication
when `npm audit --omit=dev --audit-level=high` reports high or critical advisories.

`package.json` is the version source. Update it and its lockfile only for an
authorized release; do not reuse a version for different released code. Images
receive version tags (for example `1.0.0` and `v1.0.0`) and `sha-<full-commit>`.
Stable releases also update `latest`, which the installation guides use.
The workflow builds `linux/amd64` and `linux/arm64`; the native runner checks
do not establish an ARM runtime test.

After the first image push, open its GitHub package settings and set visibility
to **public**. Repository visibility alone does not ensure public image access.
Verify an anonymous pull of the exact release tag, then test both Compose HTTP
startup and client-managed Docker stdio before announcing availability.
See [GitHub container publishing](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)
and [package visibility](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility).

A rerun can encounter an already-published image or release. Check its revision,
digest and archive before retrying; do not move released version tags or replace
an existing archive with different code. `latest` and the GitHub latest-release
download URL select the current stable release.
