<h1 align="center">Kaloricke-Tabulky-MCP</h1>

<p align="center">
  <a href="package.json"><img src="https://img.shields.io/badge/Node.js-%3E%3D22-339933?style=flat-square" alt="Node.js 22+" /></a>
  <a href="docs/LOCAL-MCP.md"><img src="https://img.shields.io/badge/MCP-stdio%20%7C%20HTTP-8A2BE2?style=flat-square" alt="MCP: stdio / HTTP" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT" /></a>
</p>

<p align="center"><a href="README.md">Česky</a> · <b>English</b></p>

Connect your AI assistant to your food diary on [kaloricketabulky.cz](https://www.kaloricketabulky.cz) or [kaloricketabulky.sk](https://www.kaloricketabulky.sk) through [MCP](https://modelcontextprotocol.io). Run it locally alongside your agent, or self-host an HTTP endpoint for remote access.

You say *"I ate 3 eggs and a banana"* — the agent searches the food database, chooses the right portion units, and logs the entries in your diary.

## Features

- **Log food in natural portions.** Search by Czech/Slovak name or barcode and use pieces, servings, grams, or millilitres. Supported writes offer `dry_run` previews.
- **Read and correct your diary.** Check calories, macros, and water; adjust, move, copy, or delete entries and add meal notes.
- **Save and reuse recipes.** Create and edit recipes, attach images, and log half, whole, or multiple recipe quantities. Reuse days with saved templates.
- **Track more than food.** Log activities, weight, and body measurements; read trends, favorites, and nutrition goals; export diary documents.

Photo interpretation, voice input, and scheduled routines depend on your agent. It can use these MCP tools after interpreting an image or running a scheduled task.

## Installation

### Option 1: Self-host for remote clients (recommended)

**Recommended for stronger credential isolation.** When hosted outside the harness's accessible filesystem and process environment, your KT credentials stay on the server. The harness uses an OAuth token to access diary tools, so protect the token and the HTTP service. See [hosting and authentication details](HOSTING.md#authentication-and-architecture).

Run the HTTP server on your server, NAS, or VPS with Docker Compose and an HTTPS reverse proxy. Cloudflare Tunnel is optional.

1. Download the Compose configuration and environment template:

   ```sh
   git clone https://github.com/NightMean/Kaloricke-Tabulky-MCP.git
   cd Kaloricke-Tabulky-MCP
   cp .env.example .env
   ```

2. Set `KT_EMAIL`, `KT_PASSWORD`, `MCP_AUTH_PASSWORD` (at least 12 characters), and `PUBLIC_URL=https://<your-host>` in `.env`.

3. Pull and start the server:

   ```sh
   docker compose -p kt-mcp --env-file .env pull
   docker compose -p kt-mcp --env-file .env up -d --no-build
   ```

Point your HTTPS reverse proxy at `http://127.0.0.1:8092` on the Docker host. Connect your client to `https://<your-host>/mcp` and authorize it with `MCP_AUTH_PASSWORD`.

[HOSTING.md](HOSTING.md) covers proxy configuration, the optional Cloudflare Tunnel stack, and recovery. `TUNNEL_TOKEN` is needed only when using Cloudflare Tunnel.

> [!TIP]
> **Multiple users:** run a separate server per KT account, each with its own credentials, OAuth state, passphrase, and endpoint. Clients connected to one server share the same diary. See [multiple users](HOSTING.md#multiple-users).

### Option 2: Run directly with your agent

> [!WARNING]
> Local stdio provides less credential isolation: a harness with access to the subprocess environment or `.env` can read your KT email and password. Choose HTTP on a separate server for stronger credential isolation.

1. Install **Node.js 22 or newer**.

2. Add a local (stdio) MCP server in your client with this launch command:

   ```sh
   npx --yes https://github.com/NightMean/Kaloricke-Tabulky-MCP/releases/latest/download/kaloricke-tabulky-mcp.tgz
   ```

   For clients with separate fields, set **Command** to `npx` and pass `--yes` and the URL as two **Arguments**. `npx` downloads and runs the compiled release automatically.

3. Set `KT_EMAIL` and `KT_PASSWORD` in the server's environment settings (`env`). For a Slovak account, also set `KT_DOMAIN=kaloricketabulky.sk`; the default is `kaloricketabulky.cz`. A separate `.env` file is optional.

4. Restart or reload your MCP client and check that the tools appear. The [local setup guide](docs/LOCAL-MCP.md) shows where to enter these settings in Codex and Hermes.

The client manages the process. No listening port, public hostname, tunnel, or MCP OAuth setup is needed. Protect the client configuration containing your credentials.

<details>
<summary>Build from source (alternative)</summary>

With Git and Node.js 22 or newer installed, run:

```sh
git clone https://github.com/NightMean/Kaloricke-Tabulky-MCP.git
cd Kaloricke-Tabulky-MCP
npm ci
npm run build
```

Set your client's **Command** to `node` and pass the absolute path to `dist/stdio.js` as its argument. Use the same environment settings from step 3 above.

</details>

### Clients

| Client | Connection |
|---|---|
| **Codex** | Local stdio or remote HTTP with OAuth; [setup examples](docs/LOCAL-MCP.md#codex) |
| **Claude** | Remote HTTP through a custom connector; local stdio where the client supports it |
| **Hermes Agent** | Local stdio; [setup examples](docs/LOCAL-MCP.md#hermes-agent) |
| **Cursor, Windsurf, and other MCP clients** | Use the command or HTTP/OAuth configuration supported by your client |

## Configuration

| Variable | Used by | Purpose |
|---|---|---|
| `KT_EMAIL`, `KT_PASSWORD` | Both modes | KT account credentials |
| `KT_DOMAIN` | Both modes | `kaloricketabulky.cz` (default) or `kaloricketabulky.sk` |
| `KT_BASE_URL` | Both modes | Alternative base URL when `KT_DOMAIN` is unset or blank |
| `MCP_AUTH_PASSWORD` | HTTP | Consent passphrase, at least 12 characters |
| `PUBLIC_URL` | HTTP | HTTPS origin advertised to clients |
| `PORT`, `STATE_DIR` | HTTP | Listener port and persistent OAuth state location |
| `MCP_HOSTNAME`, `TUNNEL_TOKEN` | Optional tunnel stack | nginx hostname and Cloudflare tunnel token |

Full configuration defaults and comments are in [`.env.example`](.env.example) and [HOSTING.md](HOSTING.md).

## Tools

The 48 tools cover food search and portions, diary entries and notes, recipes, activities, statistics, weight and measurements, favorites, templates, and exports. Your agent discovers their schemas and usage hints through MCP.

See the [full tool reference](docs/TOOLS.md) for names, preview behavior, and quantity semantics, or [API contracts](docs/API.md) for implementation details.

> [!NOTE]
> Writes take effect immediately unless the tool supports `dry_run` and you enable it.

## Development

```sh
npm ci
npm test
npm run typecheck
```

Tests include stdio subprocess and OAuth/HTTP checks against controlled fixtures; they do not write to a real KT account. To run HTTP locally with your configured HTTPS identity, use `node --env-file=.env dist/index.js`; your proxy provides HTTPS. See [local MCP verification](docs/LOCAL-MCP.md#verification) and [deployment checks](HOSTING.md#verify-and-connect).

For release checks and the publishing workflow, see [distribution and publishing](docs/DISTRIBUTION.md).

## Credits

- [stany9g/kt-mcp](https://github.com/stany9g/kt-mcp) — the original server this fork builds on.
- [nikopol666/kaloricke-tabulky-MCP](https://github.com/nikopol666/kaloricke-tabulky-MCP) — safe write flow and dry-run preview concepts.
- [tomasvotava/kaloricketabulky](https://github.com/tomasvotava/kaloricketabulky) — structured daily overviews, macro targets, and metric tracking.
- [TomasHubelbauer/kaloricke-tabulky-api](https://github.com/TomasHubelbauer/kaloricke-tabulky-api) — reverse-engineering of weight logging and statistics endpoints.

> [!NOTE]
> This is an unofficial integration and is not affiliated with or endorsed by Dine4Fit. It uses internal KT endpoints that can change without notice and break functionality.

## License

[MIT](LICENSE) for this repository's code. The food database and KT services belong to Dine4Fit, a.s.
