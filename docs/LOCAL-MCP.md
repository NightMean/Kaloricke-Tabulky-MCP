# Local MCP with stdio

Install Node.js 22 or newer. Your MCP client can launch the compiled GitHub
release with `npx`, without Docker, a source checkout, a build, or an npm account.
The archive is hosted on GitHub Releases; it is not published to the npm registry.

The process provides the same 48 tools as HTTP, opens no listening port, and
creates no OAuth state. It needs no public hostname, tunnel, or MCP OAuth setup.
KT account authentication happens when a tool needs it.

## Configuration

Set `KT_EMAIL`, `KT_PASSWORD`, and optionally `KT_DOMAIN` in the client's `env`
settings. A separate `.env` file is optional; passwords do not belong in command
arguments. This follows the [MCP authorization guidance for stdio](https://modelcontextprotocol.io/specification/latest/basic/authorization#protocol-requirements).
Protect client configuration containing credentials.

`KT_DOMAIN` defaults to `kaloricketabulky.cz`; use `kaloricketabulky.sk` for Slovak
accounts. `KT_BASE_URL` is an alternative when `KT_DOMAIN` is unset or blank.

## Codex

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.kaloricke_tabulky]
command = "npx"
args = ["--yes", "https://github.com/NightMean/Kaloricke-Tabulky-MCP/releases/latest/download/kaloricke-tabulky-mcp.tgz"]

[mcp_servers.kaloricke_tabulky.env]
KT_EMAIL = "you@example.com"
KT_PASSWORD = "your-kaloricketabulky-password"
KT_DOMAIN = "kaloricketabulky.sk"
```

Alternatively, use `env_vars = ["KT_EMAIL", "KT_PASSWORD", "KT_DOMAIN"]` in the
parent server table to forward credentials already present in Codex's environment,
and omit the table containing literal credentials.

For a deployed HTTP server, configure its URL instead:

```sh
codex mcp add kaloricke_tabulky --url https://kt-mcp.example.com/mcp
codex mcp login kaloricke_tabulky
```

Choose one entry for the server name. Stdio needs no MCP login. HTTP login opens
the consent flow for `MCP_AUTH_PASSWORD`. Check configured servers with
`codex mcp list`. See the [official OpenAI MCP documentation](https://developers.openai.com/codex/mcp/).

## Hermes Agent

Add this to `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  kaloricke_tabulky:
    command: "npx"
    args: ["--yes", "https://github.com/NightMean/Kaloricke-Tabulky-MCP/releases/latest/download/kaloricke-tabulky-mcp.tgz"]
    env:
      KT_EMAIL: "you@example.com"
      KT_PASSWORD: "your-kaloricketabulky-password"
      KT_DOMAIN: "kaloricketabulky.sk"
```

Node.js/npm must be on Hermes's PATH. If credentials already live in Hermes's
active profile environment, use `${KT_EMAIL}`, `${KT_PASSWORD}`, and `${KT_DOMAIN}`
in the `env` mapping. See the [Hermes MCP configuration reference](https://hermes-agent.nousresearch.com/docs/reference/mcp-config-reference/).

Restart Hermes or use `/reload-mcp`, then ask it to search for food or read your
daily summary. Tool discovery does not authenticate KT; a successful account read
verifies login too. Other stdio clients use the same command and arguments.
On Windows, some clients require `cmd` with arguments `/c`, `npx`, followed by
the arguments above; follow the client's launcher requirements.

## Optional credential file

For a manual launch, create a file with the KT fields from
[`.env.example`](../.env.example), then run:

```sh
npx --yes https://github.com/NightMean/Kaloricke-Tabulky-MCP/releases/latest/download/kaloricke-tabulky-mcp.tgz --env /absolute/path/account.env
```

Existing environment variables take precedence over the file. The command waits
for MCP messages on stdin and prints no startup banner.

## Lifecycle and diagnostics

Standard output contains only MCP JSON-RPC messages. Operation names and
success/failure outcomes go to stderr; credentials and diary arguments are
excluded. The client controls diagnostic capture and retention. Missing KT
credentials fail startup with the missing variable's name.

Closing stdin or sending SIGINT/SIGTERM closes the transport and cancels outstanding
requests, including shared login. Individual tool cancellation preserves shared
login for other calls. A lost response can leave a write's outcome uncertain:
read the diary before retrying to avoid duplicates. Stdio requests are bounded
to 7 MiB, matching HTTP; image and document limits are unchanged.

For scheduled tasks, the machine running the agent must be awake with network
access. The MCP process need not run between sessions. The initial archive and
dependency download needs internet access. See [HOSTING.md](../HOSTING.md) for HTTP.

## Run from source

For development, from the repository root:

```sh
npm ci
npm run build
node --env-file=.env dist/stdio.js
```

The file is optional when credentials are already exported. A client can launch
`node` with the absolute path to `dist/stdio.js` and the same `env` settings.
For HTTP, use `dist/index.js` and the additional hosting configuration.

## Verification

`npm test` verifies stdio and OAuth/HTTP subprocesses against controlled fixtures,
including authentication, cancellation, recovery, request limits and shutdown.
`npm run test:package` verifies the compiled archive without source or development
dependencies. Release verification also checks container HTTP startup and Docker
stdio tool discovery. Tests do not write to KT or prove external KT availability.
