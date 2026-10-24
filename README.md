<h1 align="center">Kaloricke-Tabulky-MCP</h1>

<p align="center">
  <a href="package.json"><img src="https://img.shields.io/badge/Node.js-%3E%3D22-339933?style=flat-square" alt="Node.js 22+" /></a>
  <a href="docs/LOCAL-MCP.md"><img src="https://img.shields.io/badge/MCP-stdio%20%7C%20HTTP-8A2BE2?style=flat-square" alt="MCP: stdio / HTTP" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT" /></a>
</p>

<p align="center"><b>Česky</b> · <a href="README.en.md">English</a></p>

Propojte svého AI asistenta s jídelníčkem na [kaloricketabulky.cz](https://www.kaloricketabulky.cz) nebo [kaloricketabulky.sk](https://www.kaloricketabulky.sk) přes [MCP](https://modelcontextprotocol.io). Server spusťte lokálně společně s agentem, nebo jej hostujte jako HTTP endpoint pro vzdálený přístup.

Řeknete *„snědl jsem 3 vejce a banán“* — agent prohledá databázi potravin, vybere správné porce a zapíše záznamy do jídelníčku.

## Funkce

- **Zapisujte jídlo v přirozených porcích.** Vyhledávejte podle českého či slovenského názvu nebo čárového kódu a používejte kusy, porce, gramy či mililitry. Podporované zápisy nabízejí náhled `dry_run`.
- **Čtěte a opravujte jídelníček.** Kontrolujte kalorie, makroživiny a pitný režim; upravujte, přesouvejte, kopírujte či mažte položky a přidávejte poznámky.
- **Ukládejte a používejte recepty.** Vytvářejte a upravujte recepty, připojujte obrázky a zapisujte polovinu, celý recept nebo násobek. Dny lze znovu použít pomocí uložených šablon.
- **Sledujte i další údaje.** Zapisujte aktivity, hmotnost a tělesné míry; načítejte vývoj hodnot, oblíbené položky a výživové cíle; exportujte jídelníček.

Rozpoznávání fotografií, hlasový vstup a plánované rutiny závisí na agentovi. Po vyhodnocení obrázku nebo spuštění naplánované úlohy může použít tyto MCP nástroje.

## Instalace

### Možnost 1: Vlastní hosting pro vzdálené klienty (doporučeno)

**Doporučeno pro lepší oddělení přihlašovacích údajů.** Pokud server běží mimo souborový systém a prostředí procesů dostupné harnessu, přihlašovací údaje KT zůstávají na serveru. Harness přistupuje k nástrojům jídelníčku pomocí OAuth tokenu, proto chraňte token i HTTP službu. Viz [podrobnosti hostingu a autentizace](HOSTING.md#authentication-and-architecture).

HTTP server provozujte na vlastním serveru, NAS nebo VPS pomocí Docker Compose a HTTPS reverzní proxy. Cloudflare Tunnel je volitelný.

1. Stáhněte konfiguraci Compose a vzor proměnných prostředí:

   ```sh
   git clone https://github.com/NightMean/Kaloricke-Tabulky-MCP.git
   cd Kaloricke-Tabulky-MCP
   cp .env.example .env
   ```

2. Do `.env` vyplňte `KT_EMAIL`, `KT_PASSWORD`, `MCP_AUTH_PASSWORD` (alespoň 12 znaků) a `PUBLIC_URL=https://<your-host>`.

3. Stáhněte a spusťte server:

   ```sh
   docker compose -p kt-mcp --env-file .env pull
   docker compose -p kt-mcp --env-file .env up -d --no-build
   ```

HTTPS reverzní proxy nasměrujte na `http://127.0.0.1:8092` na hostiteli Dockeru. Klienta připojte k `https://<your-host>/mcp` a autorizujte pomocí `MCP_AUTH_PASSWORD`.

[HOSTING.md](HOSTING.md) popisuje nastavení proxy, volitelný stack s Cloudflare Tunnel a obnovu provozu. `TUNNEL_TOKEN` potřebujete pouze při použití Cloudflare Tunnel.

> [!TIP]
> **Více uživatelů:** pro každý účet KT spusťte samostatný server s vlastními přihlašovacími údaji, OAuth stavem, frází a endpointem. Klienti jednoho serveru sdílejí stejný jídelníček. Viz [více uživatelů](HOSTING.md#multiple-users).

### Možnost 2: Přímo ve vašem agentovi

> [!WARNING]
> Lokální stdio poskytuje slabší oddělení přihlašovacích údajů: harness s přístupem k prostředí MCP procesu nebo `.env` může přečíst váš e-mail a heslo ke KT. Pro lepší oddělení použijte HTTP na samostatném serveru.

Nainstalujte Node.js 22 nebo novější a podle [lokálního návodu](docs/LOCAL-MCP.md) spusťte sestavený balíček z GitHub Releases pomocí `npx`. Přihlašovací údaje KT nastavte v sekci `env` svého klienta. Docker, klonování repozitáře, sestavení ani účet npm nejsou potřeba; `.env` je volitelný.

Klient spravuje životní cyklus procesu. Naslouchající port, veřejná doména, tunel ani nastavení MCP OAuth nejsou potřeba. Konfiguraci klienta s přihlašovacími údaji chraňte.

### Klienti

| Klient | Připojení |
|---|---|
| **Codex** | Lokální stdio nebo vzdálené HTTP s OAuth; [příklady nastavení](docs/LOCAL-MCP.md#codex) |
| **Claude** | Vzdálené HTTP přes vlastní konektor; lokální stdio tam, kde jej klient podporuje |
| **Hermes Agent** | Lokální stdio; [příklady nastavení](docs/LOCAL-MCP.md#hermes-agent) |
| **Cursor, Windsurf a další MCP klienti** | Příkaz nebo HTTP/OAuth konfigurace podle možností klienta |

## Konfigurace

| Proměnná | Režim | Účel |
|---|---|---|
| `KT_EMAIL`, `KT_PASSWORD` | Oba | Přihlašovací údaje k účtu KT |
| `KT_DOMAIN` | Oba | `kaloricketabulky.cz` (výchozí) nebo `kaloricketabulky.sk` |
| `KT_BASE_URL` | Oba | Alternativní základní URL při nenastaveném či prázdném `KT_DOMAIN` |
| `MCP_AUTH_PASSWORD` | HTTP | Přístupová fráze pro souhlas, nejméně 12 znaků |
| `PUBLIC_URL` | HTTP | HTTPS origin oznamovaný klientům |
| `PORT`, `STATE_DIR` | HTTP | Naslouchající port a umístění trvalého OAuth stavu |
| `MCP_HOSTNAME`, `TUNNEL_TOKEN` | Volitelný stack s tunelem | Hostname pro nginx a token Cloudflare tunelu |

Výchozí hodnoty a komentáře ke konfiguraci jsou v [`.env.example`](.env.example) a [HOSTING.md](HOSTING.md).

## Nástroje

48 nástrojů pokrývá vyhledávání potravin a porcí, položky jídelníčku a poznámky, recepty, aktivity, statistiky, hmotnost a míry, oblíbené položky, šablony a exporty. Agent jejich schémata a pokyny k použití získá přes MCP.

[Úplný přehled nástrojů](docs/TOOLS.md) obsahuje názvy, chování náhledů a význam množství; [API kontrakty](docs/API.md) popisují implementační podrobnosti.

> [!NOTE]
> Zápisy se provedou ihned, pokud nástroj nepodporuje `dry_run` a nezapnete jej.

## Vývoj

```sh
npm ci
npm test
npm run typecheck
```

Testy zahrnují stdio procesy a OAuth/HTTP kontroly s řízenými testovacími daty; nezapisují do skutečného účtu KT. Pro lokální HTTP s nastavenou HTTPS identitou použijte `node --env-file=.env dist/index.js`; HTTPS zajišťuje vaše proxy. Viz [ověření lokálního MCP](docs/LOCAL-MCP.md#verification) a [kontroly nasazení](HOSTING.md#verify-and-connect).

Kontroly vydání a workflow pro publikování popisuje [distribuce a publikování](docs/DISTRIBUTION.md).

## Poděkování

- [stany9g/kt-mcp](https://github.com/stany9g/kt-mcp) — původní server, ze kterého tento fork vychází.
- [nikopol666/kaloricke-tabulky-MCP](https://github.com/nikopol666/kaloricke-tabulky-MCP) — koncept bezpečného zápisu a náhledů dry-run.
- [tomasvotava/kaloricketabulky](https://github.com/tomasvotava/kaloricketabulky) — strukturované denní souhrny, cíle makroživin a sledování hodnot.
- [TomasHubelbauer/kaloricke-tabulky-api](https://github.com/TomasHubelbauer/kaloricke-tabulky-api) — reverzní inženýrství endpointů pro zápis hmotnosti a statistiky.

> [!NOTE]
> Jde o neoficiální integraci, která není spojena se společností Dine4Fit ani jí není schválena. Používá interní endpointy KT, jejichž změny bez předchozího upozornění mohou přerušit funkčnost.

## Licence

[MIT](LICENSE) se vztahuje na kód repozitáře. Databáze potravin a služby KT patří společnosti Dine4Fit, a.s.
