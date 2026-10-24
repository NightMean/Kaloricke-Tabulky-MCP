# Self-hosting over HTTP

Český přehled instalace je v [README](README.md#instalace). Tento podrobný návod je anglicky. Pro lokální proces bez HTTPS a OAuth použijte [stdio](docs/LOCAL-MCP.md).

This guide covers the separate HTTP service. For a process launched by Hermes,
Codex, or another local MCP client, use [local stdio](docs/LOCAL-MCP.md).

## Requirements

- A host that is reachable whenever clients need the tools. Scheduled tasks require both the agent and this service to be available when they run.
- A KT account and an HTTPS hostname reachable by your MCP client.
- For containers: Docker Engine and Docker Compose. Use an existing HTTPS reverse proxy or the optional Cloudflare Tunnel stack below.
- For Cloudflare Tunnel only: a Cloudflare account and a tunnel route for your hostname. The tunnel stack uses Linux host networking for `cloudflared`; Docker Desktop requires host networking support to be enabled.
- For verification scripts: Bash, curl, sed, and grep (for example, Linux or WSL).

The Node application serves plain HTTP internally;
your reverse proxy or tunnel terminates HTTPS. An existing HTTPS reverse proxy
can replace Cloudflare. Preserve streaming, forward the correct origin, and
configure forwarded client IPs only from a trusted proxy. The application trusts
one proxy hop; the bundled nginx template overwrites `X-Forwarded-For` using
Cloudflare's client IP header. Adapt this for a different proxy topology.

## Docker Compose with an existing HTTPS proxy

Follow the [README installation steps](README.en.md#option-1-self-host-for-remote-clients-recommended)
to download the Compose files and create `.env`. Set the KT credentials,
`MCP_AUTH_PASSWORD`, and `PUBLIC_URL`. The image is already configured in Compose.

From the repository root:

```sh
docker compose -p kt-mcp --env-file .env pull
docker compose -p kt-mcp --env-file .env up -d --no-build
```

The root Compose file publishes the server on `127.0.0.1:8092`. Point an HTTPS
proxy running on that host at `http://127.0.0.1:8092`. A containerized proxy needs
a shared Docker network and access to `kt-mcp:8092` instead of its own loopback;
adapt your Compose networking accordingly. Keep the internal listener private.
Use the proxy forwarding and streaming guidance above. `MCP_HOSTNAME` and
`TUNNEL_TOKEN` are not required for this deployment.

For a source build, run `docker compose build`, then
`docker compose -p kt-mcp --env-file .env up -d --no-build`.

## Optional Cloudflare Tunnel deployment

Run commands from the repository root after cloning the project.

### 1. Configure the environment

Copy [`.env.example`](.env.example) to `.env`, fill in the values below,
and add `TUNNEL_TOKEN` for the bundled Cloudflare service.

| Variable | Value |
|---|---|
| `KT_EMAIL`, `KT_PASSWORD` | Login for the KT account this instance will access |
| `KT_DOMAIN` | `kaloricketabulky.cz` (default) or `kaloricketabulky.sk` |
| `KT_BASE_URL` | Alternative base URL when `KT_DOMAIN` is unset or blank |
| `MCP_AUTH_PASSWORD` | A separate consent passphrase of at least 12 characters |
| `PUBLIC_URL` | `https://<your-host>`; no path, query, or fragment |
| `MCP_HOSTNAME` | The same hostname, without the scheme |
| `TUNNEL_TOKEN` | Your Cloudflare tunnel token |

For a bare Node HTTP process, `PORT` defaults to `8092` and `STATE_DIR` to
`./data`. The Compose files explicitly set these to `8092` and `/data` and
persist `/data` in a named volume. Changing `PORT` or `STATE_DIR` in `.env`
does not override those fixed Compose values; edit your Compose configuration
if you need different settings. Node loads `.env` only with `--env-file`;
Compose substitutes values into its configured environment.

Keep `.env` and the OAuth state private. KT credentials and session cookies
belong to the server. OAuth tokens grant tool access even without knowing the
KT password.

### 2. Create the tunnel route

In Cloudflare Zero Trust, create a tunnel and configure its public hostname
to reach **HTTP `localhost:80`**. Put its token in `TUNNEL_TOKEN`.
The reference stack uses this path:

```text
MCP client -> HTTPS -> Cloudflare -> cloudflared -> 127.0.0.1:80 -> nginx -> kt-mcp:8092
```

`cloudflared` uses host networking so `localhost:80` reaches nginx's host
loopback publication. nginx reaches the MCP container over the private Compose
network. No incoming router port is needed for the tunnel.

### 3. Pull and start

The Compose file already selects the published image. Run:

```sh
docker compose -p kt-mcp --env-file .env -f deploy/stack.yml pull
docker compose -p kt-mcp --env-file .env -f deploy/stack.yml up -d
```

This path needs no Node.js or compiler on your host. To build from the checkout
instead, run:

```sh
docker compose build
docker compose -p kt-mcp --env-file .env -f deploy/stack.yml up -d
```

The root `docker-compose.yml` can build the application image;
`deploy/stack.yml` runs that image with nginx and the tunnel. For a source build,
use the same Docker host for both commands
or transfer the image to the deployment host first. Keep the `kt-mcp` project
name stable so the same state volume is reused. Do not remove the volume when
recreating containers.

## Verify and connect

With Bash, run the existing read-only deployment check, replacing the example hostname:

```sh
./scripts/verify-deployment.sh https://kt-mcp.example.com
```

It checks `/healthz`, the advertised endpoint, OAuth discovery, and the
unauthenticated MCP challenge. It does not authenticate KT or verify a diary
write. You can inspect container output with:

```sh
docker compose -p kt-mcp --env-file .env logs --tail=100 kt-mcp
```

For the optional tunnel stack, add `-f deploy/stack.yml` before `logs` and
include `nginx cloudflared` to inspect those services too.

Add `https://<your-host>/mcp` to your MCP client. Complete its OAuth flow and
enter `MCP_AUTH_PASSWORD` on this server's consent page. A food search checks
tool access; a daily summary checks KT login and account access too. See
[Codex configuration](docs/LOCAL-MCP.md#codex) for CLI examples.

## Multiple users

Each server connects to one KT account. You can connect multiple clients to it,
but they all access the same diary. Signing in through OAuth does not create
a separate diary for each user.

For multiple users with their own diaries, run a separate server for each KT
account. Use the same Docker image with separate credentials, consent
passphrases, saved OAuth state, and HTTPS addresses.

When running these servers on the same machine:

- Use a different Compose project name for each user, such as `-p kt-alice` and `-p kt-bob`. This keeps their networks and saved OAuth state separate.
- Give each user's container a unique `container_name` instead of `kaloricke-tabulky-mcp`, or remove that setting so Compose generates the name.
- Give each server its own hostname and matching `PUBLIC_URL`, and route it through your HTTPS proxy.
- In the root Compose file, give each server a different host port instead of reusing `127.0.0.1:8092`.
- With the optional tunnel stack, also remove or uniquely rename the nginx and tunnel container names, give each nginx a different host port, and update `MCP_HOSTNAME` and the tunnel route for that user.

There is no account-switching screen or ready-made shared deployment for
multiple users; each person's server is configured separately.

## Authentication and architecture

Both transports share tool registration and the KT API client:

```text
Local client  -> stdio JSON-RPC -> MCP process -> KT API (JSESSIONID)
Remote client -> HTTPS / OAuth -> MCP service -> KT API (JSESSIONID)
```

KT uses internal Spring MVC JSON endpoints. The client logs in using the
site's MD5 password form and maintains a session cookie. This login is separate
from MCP OAuth. See [API contracts](docs/API.md) for upstream details.

In HTTP mode, this server also provides OAuth authorization-code + PKCE,
dynamic client registration, refresh-token rotation, and token revocation:

- `/.well-known/oauth-protected-resource/mcp`
- `/.well-known/oauth-authorization-server`
- `/authorize`, `/token`, `/register`, `/revoke`

`MCP_AUTH_PASSWORD` authorizes a new client through the consent form; it is not
the KT password. Access tokens last 30 days. Registered clients, access tokens,
and refresh tokens are persisted in `oauth-state.json` under `STATE_DIR`.
Discovery and registration are public, while `/mcp` requires a valid bearer
token. The SDK limits requests to `/authorize`; proxy/client-IP configuration
affects that protection.

Every authorized client has access to this instance's exposed tools and KT
account. There are no per-user diaries or read-only permission tiers.
Changing the consent passphrase does not revoke already-issued tokens. Clients
can revoke tokens through `/revoke`; if you deliberately reset all OAuth state,
stop the service first, remove its state file, then restart and reconnect clients.
Treat state backups as secrets.

Remote hosting can keep KT credentials outside the harness's accessible
filesystem and environment, provided it has no server-administration access.
The client still holds diary-capable tokens. With local stdio, the credentials
remain in the local subprocess, so host permissions determine access. Neither
transport returns credentials as part of its intended tool results.

## Updates, hostname changes, and availability

Rerun `pull` and `up -d --no-build` with the same Compose project and file to
update to the latest stable image. Source installations rebuild
the image instead of pulling it. Keep the state volume when replacing containers.
If your public hostname changes, update `PUBLIC_URL` and the proxy route;
for the optional tunnel stack, also update `MCP_HOSTNAME` and its tunnel route.
Verify the endpoint again and reconnect clients with the new address.

A sleeping or stopped host cannot serve requests. A VPS, NAS, home server,
or another always-available host is useful for scheduled routines. A regular
PC also works while it is awake; no 24/7 requirement applies to manual use.
Local stdio only needs to run while the client uses it, with the agent's machine
awake for scheduled tasks.

## Request and document sizes

Authenticated `/mcp` JSON requests are limited to 7 MiB, allowing up to 5 MiB
of PNG/JPEG bytes encoded as base64. The bundled nginx template uses the same
7 MiB request limit and disables response buffering for streaming. Reload that
configuration when upgrading an older deployment; custom proxies need the same
limits and streaming behavior. Other JSON routes retain a 1 MiB limit.

Document exports are downloaded into a bounded buffer (maximum 5 MiB) and
returned as embedded MCP resources, without being saved on the server.

For problems with setup, use the project's [issue tracker](https://github.com/NightMean/Kaloricke-Tabulky-MCP/issues). Include the failing operation and redacted diagnostics, never credentials, cookies, tokens, or diary contents.
