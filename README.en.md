<h1 align="center">Kaloricke-Tabulky-MCP</h1>

<p align="center">
  <a href="https://github.com/NightMean/Kaloricke-Tabulky-MCP/actions"><img src="https://img.shields.io/badge/build-passing-brightgreen?style=flat-square" alt="Build Status" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="License" /></a>
  <img src="https://img.shields.io/badge/TypeScript-5.8-blue?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/MCP-1.6.0-orange?style=flat-square" alt="Model Context Protocol" />
  <img src="https://img.shields.io/badge/Node-%3E%3D20-green?style=flat-square&logo=node.js&logoColor=white" alt="Node" />
</p>

<p align="center">
  <a href="README.md">🇨🇿 Česky</a> · <b>🇬🇧 English</b>
</p>

A self-hosted [MCP](https://modelcontextprotocol.io) server that connects an AI agent to your [kaloricketabulky.cz](https://www.kaloricketabulky.cz) and [kaloricketabulky.sk](https://www.kaloricketabulky.sk) food diary.

You say *"I ate 3 eggs and a banana"* — the agent searches the food database, picks the right portion unit, and writes the entries into your real diary. The official app stays the source of truth, so premium features keep working.

Supports both the Czech domain ([kaloricketabulky.cz](https://www.kaloricketabulky.cz)) and Slovak domain ([kaloricketabulky.sk](https://www.kaloricketabulky.sk)) via `KT_DOMAIN=kaloricketabulky.sk`.
Both Docker Compose files pass this setting into the server. Alternatively,
leave `KT_DOMAIN` unset or blank and set `KT_BASE_URL=https://www.kaloricketabulky.sk`.
A nonblank `KT_DOMAIN` takes precedence; when neither is set, the Czech domain is used.

## Features

Once connected, food logging stops being a chore of tapping through search screens. Some patterns that work well in practice:

- **Natural language logging.** "I had a rohlík with ham and two eggs for breakfast." The agent parses the text (or voice dictation transcribed by your client), searches the database, resolves natural portions (*kus (55 g)* instead of guessed grams), and logs each item into the right meal slot.

- **Automate your routine.** You drink two coffees with milk every day — why type it? If your agent supports scheduled tasks (Claude does), tell it once: *"Every day at 9:00, log two espressos with milk into my diary."* Your daily constants log themselves.

- **Photograph your plate.** Send the agent a photo of your lunch and ask what's on it. It identifies the foods, estimates real gram amounts from the picture, tells you the calories — and logs it when you confirm. Estimates are estimates, but for mixed plates it beats not logging at all.

- **Photograph a recipe.** Snap a recipe from a cookbook or a screenshot from the web and say *"save this as a meal"*. The agent reads the ingredients, finds each one in the database, and creates a reusable saved recipe — one entry to log next time you cook it. You can edit on the way in: *"swap the cream for white yogurt and halve the sugar."*

- **Ask how your day is going.** "How many calories do I have left?" reads today's totals straight from the diary.

### Supported Clients

The server communicates via standard MCP over HTTPS with OAuth 2.1 and is tested with:
- **Claude** (Desktop, mobile app, and web via custom connector)
- **Cursor**, **Windsurf**, and other AI coding environments supporting remote MCP servers
- Any MCP-compliant client supporting remote HTTP/SSE transport with OAuth 2.1

## Tools

<details>
<summary><b>View available MCP tools</b></summary>

| Tool | Purpose |
|---|---|
| `search_food` | Find foods by Czech/Slovak name or 13-digit EAN barcode. Returns the food id the other tools need. |
| `get_food_portions` | List a food's natural portion units (`kus (55 g)`, `velký kus (60 g)`) so "3 eggs" logs as three pieces rather than an estimated weight. |
| `get_food_nutrition` | Calories and macros for a quantity, scaled by the site itself. Read-only. |
| `log_food` | Write an eating record into the diary (supports `dry_run: true` to preview macros without logging). |
| `get_day_summary` | Read back a day's totals and structured overview (current/target/remaining calories, macros, water). |
| `record_weight` | Log user body weight (kg) for a given date (supports `dry_run: true`). |
| `get_weight_history` | Retrieve recent body weight entries from monthly tracking statistics. |
| `create_meal` | Save a recipe built from existing foods. |
| `list_my_meals` | List saved recipes with their ids and total energy. |
| `log_meal` | Log a saved recipe into the diary with optional portion scaling (supports `dry_run: true`). |
| `delete_meal` | Delete a saved recipe. |

</details>

`get_day_summary` keeps the original statistics response in `summary` and its
`raw` alias. The `overview` combines energy and water from statistics with macro
goals from the separate diary summary. Water reported in litres is converted to
millilitres; energy retains the site's unit. Missing values remain `null`.
If either API request fails, the tool reports an error.

For `log_food`, `log_meal`, and `record_weight`, set `dry_run: true` for a
preview without writing. Omitting `dry_run` or setting it to `false` writes
immediately. Both modes validate the date, including calendar validity;
failed food or recipe lookups are reported as preview errors.

### Recipes

The site calls a saved recipe a *meal*. `create_meal` composes one from
existing foods, so "3 eggs and 200 ml milk" becomes a single reusable item
rather than two entries typed out every time.

Quantities follow the same rule as `log_food`: `amount` counts **units**, not
grams. Omitting `unit_id` selects the food's own base unit, which is grams for
solids and millilitres for liquids — what recipes are normally written in. Pass
a `unit_id` from `get_food_portions` and the count multiplies it, so 2 of
`porce (250 ml)` is 500 ml. Getting this backwards is easy: an early test asked
for 100 of the `100 ml` unit and quietly created a recipe containing ten litres
of milk.

## How it works

[kaloricketabulky.cz](https://www.kaloricketabulky.cz) is a Spring MVC app where every route also answers JSON if you append `?format=json`, returning a `{code, data, message}` envelope. There is no official or documented API — these endpoints were recovered from the site's own frontend JavaScript. See `src/kt/client.ts` for the full map.

```
Agent  ──OAuth 2.1──►  kt-mcp  ──JSESSIONID──►  kaloricketabulky.cz
       ──MCP/HTTPS─►
```

Two credentials, doing different jobs:

| Secret | Guards |
|---|---|
| `MCP_AUTH_PASSWORD` | Who may connect this server to an agent. You type it once in a browser during the OAuth consent step. |
| `KT_PASSWORD` | The [kaloricketabulky.cz](https://www.kaloricketabulky.cz) account the tools write to. Never leaves the server. |

### What the passphrase protects

`MCP_AUTH_PASSWORD` is the only way to obtain a token. Every request to `/mcp`
requires a valid bearer token, and tokens are minted solely by the consent form
after a constant-time comparison against that passphrase. Verified by audit
(`scripts/security-audit.sh`): unauthenticated and forged-token calls are
rejected, fabricated authorization codes and refresh tokens are rejected, no
public endpoint exposes a credential, and no verb or path variation reaches the
tools without a token.

Two things are public by design and safe to be so: OAuth discovery documents
(the spec requires them) and dynamic client registration. Registering a client
gets an attacker no further — they still cannot obtain a token without the
passphrase.

Brute force is bounded by a 100-requests-per-15-minutes limit on `/authorize`.
That limiter keys on client IP, so nginx **overwrites** `X-Forwarded-For` with
Cloudflare's verified `CF-Connecting-IP` and the app trusts exactly one proxy
hop. Appending to a caller-supplied header instead — or setting
`trust proxy: true` — lets an attacker forge a fresh bucket per request and
removes the limit entirely.

Residual risks worth knowing: anyone holding the passphrase has full access;
tokens cannot be revoked individually short of deleting `/data/oauth-state.json`;
and because client registration is open, a phishing link to the consent page
could capture the passphrase if you typed it there — check the client name shown
on the form before authorizing.

## Local development

```bash
npm install
cp .env.example .env      # fill in your details
npm run build
npm test

set -a; source .env; set +a
PUBLIC_URL=https://localhost:8092 node dist/index.js
```

`GET /healthz` returns the resulting public MCP endpoint — the fastest way to confirm that `PUBLIC_URL` is what you think it is.

## Self-hosting

> ⚠️ The server should be always-on — sleeping PCs will cause scheduled logs to
> fail. See [HOSTING.md](HOSTING.md) for full context and trade-offs.

The reference deployment uses Docker, nginx, and a free Cloudflare Tunnel — no ports are opened on your host or router. Anything that puts an HTTPS hostname in front of the container works; the tunnel is just the cheapest secure default.

Request path:

```
Cloudflare → cloudflared (host network) → 127.0.0.1:80 → nginx → kt-mcp:8092
```

nginx listens only on the host loopback; `cloudflared` makes an outbound connection.
The nginx config (`deploy/nginx.conf.template`) disables proxy buffering — without
this, Server-Sent Events buffer until the connection closes and tool calls hang.

**1. Create the tunnel** (once), in Cloudflare Zero Trust dashboard → Networks → Tunnels:

- Create a tunnel, copy the **tunnel token**.
- Add a public hostname pointing to **`HTTP`** → **`localhost:80`**.
  `cloudflared` runs in host network mode, so `localhost:80` reaches nginx on the
  host loopback. Plain `http` because TLS terminates at Cloudflare.

The hostname you chose is called `<your-host>` below; any domain on your Cloudflare
account works, and nothing in the code cares what domain you use.

**2. Build the image**, from this directory:

```bash
docker compose build
```

**3. Deploy the stack.** `deploy/stack.yml` is the runtime compose file (works standalone or as a Portainer stack); set these environment variables:

| Variable | Value |
|---|---|
| `KT_EMAIL` / `KT_PASSWORD` | Your [kaloricketabulky.cz](https://www.kaloricketabulky.cz) / [kaloricketabulky.sk](https://www.kaloricketabulky.sk) login |
| `KT_DOMAIN` | `kaloricketabulky.cz` (default) or `kaloricketabulky.sk` depending on your account |
| `KT_BASE_URL` | Optional base URL; only consulted if `KT_DOMAIN` is empty or unset |
| `MCP_HOSTNAME` | `<your-host>` — bare hostname with no scheme. nginx substitutes it on boot |
| `MCP_AUTH_PASSWORD` | A long passphrase you invent (min 12 characters) |
| `PUBLIC_URL` | `https://<your-host>` — must match the tunnel hostname exactly |
| `TUNNEL_TOKEN` | From step 1 |

Keep `docker-compose.yml` and `deploy/stack.yml` in sync — the first builds the image, the second runs it.

**4. Verify the deployment**, before pointing an agent at it:

```bash
./scripts/verify-deployment.sh https://<your-host>
```

**5. Connect your agent.** In Claude: Settings → Connectors → Add custom connector → enter `https://<your-host>/mcp`. The agent registers itself, pops open the consent page, and you enter `MCP_AUTH_PASSWORD` once. Other MCP clients have their own "add remote MCP server" flow using the same URL.

### Changing domain later

The hostname is not baked into the image — only `PUBLIC_URL` and the tunnel hostname need to match. To move:

1. Update the tunnel public hostname to the new domain (or create a new tunnel and swap `TUNNEL_TOKEN`).
2. Update `PUBLIC_URL` on the stack and redeploy.
3. Re-run the verification script, then remove and re-add the connector in your agent.

Step 3 is required: `PUBLIC_URL` is the OAuth issuer and the RFC 8707 resource identifier, so tokens issued under the old hostname are correctly rejected after the move.

### Stuck, or nowhere to run it?

If you hit a wall self-hosting, open a [GitHub issue](../../issues) — happy to help you get unstuck, that's what the issue tracker is for.

Self-hosting does need a machine that is always on (see [HOSTING.md](HOSTING.md)) and a Cloudflare account. If you have no way to run it at all, you can reach me at **kt-mcp@stanwhy.me** and we can figure something out — just know that running a private instance means real server costs, which would be yours to cover.

## Authentication

The server is its own OAuth 2.1 authorization server, implementing what the MCP spec requires of a protected resource:

- `/.well-known/oauth-protected-resource/mcp` — RFC 9728 discovery
- `/.well-known/oauth-authorization-server` — RFC 8414 discovery
- `/authorize`, `/token`, `/register`, `/revoke` — authorization code + PKCE, dynamic client registration, refresh-token rotation

Access tokens live 30 days and are persisted to `/data` on a volume, so redeploying does not force you to reconnect.

### What happens on connect

You don't generate or copy tokens manually — OAuth handles it:

1. You put your **[kaloricketabulky.cz](https://www.kaloricketabulky.cz) login** (`KT_EMAIL` / `KT_PASSWORD`) and a **passphrase you invent** (`MCP_AUTH_PASSWORD`) into the server environment (`.env`). Your Kalorické Tabulky credentials stay on your server; the agent never sees them.
2. In your agent, you add the connector URL, `https://<your-host>/mcp`. The agent registers itself with your server (dynamic client registration).
3. A browser window opens to your server's consent screen. You enter `MCP_AUTH_PASSWORD` once.
4. Your server issues a unique, random access token to the agent, which stores it and refreshes it automatically. Every subsequent tool call is authenticated with that token.

Because each person runs their own instance, each token is single-tenant: your server only knows your food diary, and it only hands out tokens to someone who knows your passphrase. Nothing is shared between installs, and there is no central service.

## Limitations

- **Undocumented upstream.** Dine4Fit guarantees nothing here; a frontend refactor could change payload shapes without warning. The client throws on anything unexpected rather than guessing, so breakage surfaces as a loud error rather than a wrong calorie count.
- **`md5(password)` is password-equivalent.** The site hashes the password client-side, so the hash is as sensitive as the password. Treat `KT_PASSWORD` accordingly.
- **One account per instance.** The server logs into a single [kaloricketabulky.cz](https://www.kaloricketabulky.cz) (or [kaloricketabulky.sk](https://www.kaloricketabulky.sk)) account. Two people, two containers.
- **Personal use.** Automating entry into your own account is a far softer position than bulk scraping, but it is still outside anything Dine4Fit has sanctioned. Keep the request rate human, and don't build a competing client on it.
- **Daily summaries are totals, not individual diary entries.** Response parsing is covered by controlled tests based on community API models; this does not verify your account or guarantee that the undocumented endpoints will remain unchanged.
- **Recipe portion scaling.** When logging saved recipes via `log_meal`, partial or multiple portions (e.g. `0.5` or `2`) are supported by proportionally scaling constituent foodstuff ingredients in the diary entry.

> [!WARNING]
> ## Unofficial, and not affiliated with Dine4Fit
>
> [kaloricketabulky.cz](https://www.kaloricketabulky.cz) and [kaloricketabulky.sk](https://www.kaloricketabulky.sk) are operated by **Dine4Fit, a.s.**, who are not involved in
> this project and do not endorse it. There is no public API; the endpoints used
> here were read out of the site's own frontend JavaScript and may change or
> break without notice.
>
> Dine4Fit's terms grant a **personal, non-commercial** licence. This software is
> published so that you can automate access to **your own account** — which is
> what that licence permits. Running it as a paid or multi-tenant service, or
> redistributing the food data it returns, is a different matter and is on you.
> The database is Dine4Fit's and is protected by EU database rights.
>
> Keep the request rate human. Don't build a competing client on it.

## Credits

* **[nikopol666/kaloricke-tabulky-MCP](https://github.com/nikopol666/kaloricke-tabulky-MCP)** — safe write flow and dry-run preview concepts.
* **[tomasvotava/kaloricketabulky](https://github.com/tomasvotava/kaloricketabulky)** — structured modeling of daily overviews, macro targets, and metric tracking.
* **[TomasHubelbauer/kaloricke-tabulky-api](https://github.com/TomasHubelbauer/kaloricke-tabulky-api)** — reverse-engineering of weight logging (`record_weight`) and statistics summary endpoints.

## License

Licensed under the [MIT license](LICENSE). The food database and the [kaloricketabulky.cz](https://www.kaloricketabulky.cz) service belong to Dine4Fit, a.s. — this licence covers only the code in this repository.
