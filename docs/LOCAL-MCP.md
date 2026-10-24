# Local MCP with stdio

The server supports two standard MCP transports with the same tools and agent
instructions:

| Mode | Entry point | Configuration | Process lifetime |
|---|---|---|---|
| Local stdio | `dist/stdio.js` | KT credentials and optional domain | Launched and stopped by the MCP client |
| Streamable HTTP | `dist/index.js` | KT credentials, HTTPS identity and OAuth settings | Run as a separate service |

Stdio requires Node.js 22 or newer. Docker, Portainer, a public hostname,
a tunnel, and MCP OAuth are unnecessary for this mode. The process opens no
listening port and creates no OAuth state file. It still connects to KT over
the network and authenticates your KT account when a tool needs it.

## Build and configuration

From the repository root:

```sh
npm ci
npm run build
```

Create a local `.env` file using the KT fields from [`.env.example`](../.env.example):

```dotenv
KT_EMAIL=you@example.com
KT_PASSWORD=your-kaloricketabulky-password
KT_DOMAIN=kaloricketabulky.sk
```

`KT_DOMAIN` is optional and defaults to `kaloricketabulky.cz`. `KT_BASE_URL`
is the alternative when `KT_DOMAIN` is unset or blank. HTTP-only settings
(`PUBLIC_URL`, `MCP_AUTH_PASSWORD`, `PORT`, `STATE_DIR`, `MCP_HOSTNAME`) are
unused in stdio mode; an existing HTTP `.env` can therefore be reused.

The server reads its process environment. Node's `--env-file` option explicitly
loads the local file; the server does not discover `.env` files automatically:

```sh
node --env-file=.env dist/stdio.js
```

This command waits for MCP messages on stdin. It does not start a web page or
print a startup banner. If credentials are already exported into the process
environment, `npm run --silent start:stdio` is equivalent. MCP clients should
launch `node` directly so npm banners cannot enter the protocol stream.

## Hermes Agent

Add this entry to `~/.hermes/config.yaml`, replacing both absolute paths with
the paths on the machine where Hermes runs:

```yaml
mcp_servers:
  kaloricke_tabulky:
    command: "node"
    args:
      - "--env-file=/absolute/path/Kaloricke-Tabulky-MCP/.env"
      - "/absolute/path/Kaloricke-Tabulky-MCP/dist/stdio.js"
```

On Windows, forward-slash paths such as `C:/Projects/Kaloricke-Tabulky-MCP/.env`
work in this YAML. Use an absolute Node executable path if `node` is not on
Hermes's PATH. Absolute paths make the configuration independent of Hermes's
working directory.

Alternatively, keep credentials in Hermes's active profile `.env` and pass
them through `env`; the profile's defaults are described in the
[Hermes MCP configuration reference](https://hermes-agent.nousresearch.com/docs/reference/mcp-config-reference/):

```yaml
mcp_servers:
  kaloricke_tabulky:
    command: "node"
    args: ["/absolute/path/Kaloricke-Tabulky-MCP/dist/stdio.js"]
    env:
      KT_EMAIL: "${KT_EMAIL}"
      KT_PASSWORD: "${KT_PASSWORD}"
      KT_DOMAIN: "${KT_DOMAIN}"
```

Choose one configuration. Restart Hermes or use `/reload-mcp`, then ask it to
search for a Czech/Slovak food or read your daily summary. Tool discovery does
not authenticate the KT account; a successful account read verifies login too.
Other stdio-capable clients use the same `node` command and arguments under
their own MCP configuration format. No Hermes-specific server adapter is used.

## Lifecycle and diagnostics

Standard output contains only MCP JSON-RPC messages. Operation names and
success/failure outcomes go to stderr; credentials and diary arguments are
excluded from these logs. The client controls diagnostic capture and retention.
Missing KT credentials fail startup with the missing variable's name.

Closing stdin or sending SIGINT/SIGTERM closes the MCP transport and cancels
outstanding upstream requests, including shared login. Individual MCP
cancellation preserves shared login for other active calls. Shutdown or a lost
response can leave a write's outcome uncertain: read the diary before retrying
to avoid duplicate entries. Stdio requests are bounded to 7 MiB, matching the
HTTP request limit; image and document limits remain unchanged.

For scheduled tasks, the machine running the agent must be awake and have
network access when the task runs. The MCP process does not need to run between
agent sessions. HTTP clients can continue to use a separately hosted instance;
see [HOSTING.md](../HOSTING.md).

## Verification

Run `npm test` from the repository root. `src/stdio.test.ts` launches the real
compiled entry point through the SDK's stdio client, discovers all tools, and
exercises the KT client against a controlled local HTTP fixture. It checks
authentication wiring, tool errors/recovery, cancellation, protocol-only stdout,
missing credentials, absence of OAuth state, and graceful EOF during login.
`src/mcp/http.test.ts` checks the existing OAuth/HTTP boundary separately.
These tests do not establish compatibility with a particular installed Hermes
version or prove that the external KT service is available.
