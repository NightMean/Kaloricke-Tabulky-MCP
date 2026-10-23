<h1 align="center">Kaloricke-Tabulky-MCP</h1>

<p align="center">
  <a href="https://github.com/NightMean/Kaloricke-Tabulky-MCP/actions"><img src="https://img.shields.io/badge/build-passing-brightgreen?style=flat-square" alt="Build Status" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="License" /></a>
  <img src="https://img.shields.io/badge/TypeScript-5.8-blue?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/MCP-1.6.0-orange?style=flat-square" alt="Model Context Protocol" />
  <img src="https://img.shields.io/badge/Node-%3E%3D20-green?style=flat-square&logo=node.js&logoColor=white" alt="Node" />
</p>

<p align="center">
  <b>🇨🇿 Česky</b> · <a href="README.en.md">🇬🇧 English</a>
</p>

Self-hosted [MCP](https://modelcontextprotocol.io) server, který propojí AI agenta s vaším jídelníčkem na [kaloricketabulky.cz](https://www.kaloricketabulky.cz) i [kaloricketabulky.sk](https://www.kaloricketabulky.sk).

Řeknete *„snědl jsem 3 vejce a banán"* (nebo slovensky *„zjedol som 3 vajcia a banán"*) — agent prohledá databázi potravin, vybere správnou porci a zapíše záznamy do vašeho skutečného jídelníčku. Oficiální aplikace zůstává zdrojem pravdy, takže prémiové funkce fungují dál.

Podporuje jak českou doménu ([kaloricketabulky.cz](https://www.kaloricketabulky.cz)), tak slovenskou ([kaloricketabulky.sk](https://www.kaloricketabulky.sk)) přes proměnnou `KT_DOMAIN=kaloricketabulky.sk`.
Oba soubory Docker Compose předávají nastavení serveru. Alternativně ponechte
`KT_DOMAIN` nenastavené nebo prázdné a nastavte `KT_BASE_URL=https://www.kaloricketabulky.sk`.
Neprázdné `KT_DOMAIN` má přednost; bez obou hodnot se použije česká doména.

## Funkce

Jakmile je agent připojený, přestane být zapisování jídel otravným proklikáváním vyhledávání. Pár vzorů, které v praxi fungují dobře:

- **Zápis přirozeným jazykem.** „K snídani jsem měl rohlík se šunkou a dvě vejce." Agent zpracuje text (nebo hlasový přepis z vašeho klienta), vyhledá potraviny, zvolí přirozené porce (*kus (55 g)* místo odhadovaných gramů) a zapíše každou položku do správného denního jídla.

- **Zautomatizujte rutinu.** Pijete každý den dvě kávy s mlékem — proč je vypisovat? Pokud váš agent umí naplánované úlohy (Claude umí), řekněte mu to jednou: *„Každý den v 9:00 mi zapiš do jídelníčku dvě espressa s mlékem."* Denní konstanty se zapisují samy.

- **Vyfoťte talíř.** Pošlete agentovi fotku oběda a zeptejte se, co na ní je. Rozpozná potraviny, odhadne reálné gramáže z obrázku, spočítá kalorie — a po potvrzení zaloguje. Odhad je odhad, ale u míchaných talířů je to lepší než nezapsat nic.

- **Vyfoťte recept.** Vyfoťte recept z kuchařky nebo screenshot z webu a řekněte *„ulož mi to jako jídlo"*. Agent přečte suroviny, každou najde v databázi a vytvoří uložený recept — příště zalogujete jedním záznamem. Cestou můžete upravovat: *„vyměň smetanu za bílý jogurt a dej poloviční cukr."*

- **Ptejte se, jak vám jde den.** „Kolik kalorií mi dnes zbývá?" přečte denní součty přímo z jídelníčku.

### Podporovaní klienti

Server komunikuje standardním protokolem MCP přes HTTPS s OAuth 2.1 a je otestován s:
- **Claude** (Desktop, mobilní aplikace i web přes custom connector)
- **Cursor**, **Windsurf** a další vývojová prostředí s podporou vzdálených MCP serverů
- Jakýkoli MCP klient podporující vzdálený transport (SSE/HTTP) s OAuth 2.1

## Nástroje

<details>
<summary><b>Zobrazit seznam dostupných MCP nástrojů</b></summary>

| Nástroj | Účel |
|---|---|
| `search_food` | Najde potraviny podle českého/slovenského názvu nebo 13místného EAN kódu. Vrací id potraviny, které potřebují ostatní nástroje. |
| `get_food_portions` | Vypíše přirozené porce potraviny (`kus (55 g)`, `velký kus (60 g)`), takže „3 vejce / 3 vajcia" se zapíšou jako tři kusy, ne odhadnutá váha. |
| `get_food_nutrition` | Kalorie a makra pro dané množství, přepočítané samotným webem. Pouze čtení. |
| `log_food` | Zapíše záznam o jídle do jídelníčku (podporuje `dry_run: true` pro bezpečný náhled před zápisem). |
| `get_day_summary` | Přečte denní souhrn jídelníčku a strukturovaný přehled cílů (energie, makra, voda). |
| `record_weight` | Zapíše tělesnou hmotnost (kg) uživatele k danému dni (podporuje `dry_run: true`). |
| `get_weight_history` | Načte historii záznamů tělesné hmotnosti z měsíčních statistik. |
| `create_meal` | Uloží recept složený z existujících potravin. |
| `list_my_meals` | Vypíše uložené recepty s jejich id a celkovou energií. |
| `log_meal` | Zaloguje uložený recept do jídelníčku s možností škálování porce (podporuje `dry_run: true`). |
| `delete_meal` | Smaže uložený recept. |

</details>

`get_day_summary` zachovává původní odpověď statistik v `summary` i aliasu
`raw`. Přehled `overview` spojuje energii ze statistik s vodou a cíli makroživin
ze samostatného souhrnu jídelníčku. Voda používá přesnější zobrazené hodnoty
jídelníčku; chybějící hodnoty doplní ze statistik. Litry převádí na mililitry;
energie si zachovává jednotku webu. Chybějící hodnoty zůstávají `null`.
Při selhání kteréhokoli API požadavku nástroj vrátí chybu.

U `log_food`, `log_meal` a `record_weight` nastavte `dry_run: true` pro náhled
bez zápisu. Vynechání `dry_run` nebo hodnota `false` provede zápis okamžitě.
Oba režimy ověřují formát i platnost kalendářního data;
selhání načtení potraviny nebo receptu se v náhledu projeví chybou.

### Recepty

Web říká uloženému receptu *jídlo* (meal). `create_meal` ho složí
z existujících potravin, takže „3 vejce a 200 ml mléka" je jedna znovupoužitelná
položka místo dvou záznamů vypisovaných pokaždé znovu.

Množství se řídí stejným pravidlem jako `log_food`: `amount` počítá **jednotky**,
ne gramy. Vynecháte-li `unit_id`, použije se základní jednotka potraviny — gramy
u pevných potravin, mililitry u tekutin — tedy to, v čem se recepty běžně píší.
Když předáte `unit_id` z `get_food_portions`, počet ho násobí: 2 × `porce
(250 ml)` je 500 ml. Splést se je snadné: jeden raný test zadal 100 jednotek
`100 ml` a potichu vytvořil recept s deseti litry mléka.

`log_meal` násobí celý uložený recept hodnotou `portions` (výchozí `1`).
Například `portions: 0.5` použije polovinu každé vybrané suroviny a na webu
se zobrazí jako `50 %`. Klient používá procentní jednotku dostupnou ve formuláři
a pole `selectedUnitMultiplier`; samotná změna `count` nezajistí správné
zobrazení množství.

## Jak to funguje

[kaloricketabulky.cz](https://www.kaloricketabulky.cz) je Spring MVC aplikace, kde každá routa odpoví i v JSON, když přidáte `?format=json` — vrací obálku `{code, data, message}`. Žádné oficiální ani dokumentované API neexistuje; endpointy byly zrekonstruovány z frontendového JavaScriptu webu. Úplná mapa je v `src/kt/client.ts`.

```
Agent  ──OAuth 2.1──►  kt-mcp  ──JSESSIONID──►  kaloricketabulky.cz
       ──MCP/HTTPS─►
```

Dvě hesla, každé hlídá něco jiného:

| Tajemství | Hlídá |
|---|---|
| `MCP_AUTH_PASSWORD` | Kdo smí tento server připojit k agentovi. Zadáváte ho jednou v prohlížeči při OAuth souhlasu. |
| `KT_PASSWORD` | Účet na [kaloricketabulky.cz](https://www.kaloricketabulky.cz), do kterého nástroje zapisují. Nikdy neopouští server. |

### Co se stane při připojení

Žádný token ručně nevytváříte ani nekopírujete — OAuth to udělá za vás:

1. Do prostředí serveru (`.env`) vložíte svůj **login na [kaloricketabulky.cz](https://www.kaloricketabulky.cz)**
   (`KT_EMAIL` / `KT_PASSWORD`) a **přístupovou frázi, kterou si vymyslíte**
   (`MCP_AUTH_PASSWORD`). Přihlašovací údaje ke kalorickým tabulkám zůstávají
   na vašem serveru; agent je nikdy nevidí.
2. V agentovi přidáte URL konektoru, `https://<your-host>/mcp`. Agent se u
   vašeho serveru zaregistruje sám (dynamická registrace klientů).
3. Otevře se stránka v prohlížeči — obrazovka souhlasu vašeho serveru. Jednou
   zadáte `MCP_AUTH_PASSWORD`.
4. Váš server vygeneruje unikátní náhodný přístupový token a předá ho agentovi,
   který si ho uloží a automaticky obnovuje. Od té chvíle je každé volání
   nástroje ověřené tímto tokenem.

Protože si každý provozuje vlastní instanci, každý token patří jen jemu: váš
server zná jen váš jídelníček a tokeny vydává jen tomu, kdo zná vaši frázi.
Mezi instalacemi se nesdílí nic a žádná centrální služba neexistuje.

## Lokální vývoj

```bash
npm install
cp .env.example .env      # doplňte své údaje
npm run build
npm test

set -a; source .env; set +a
PUBLIC_URL=https://localhost:8092 node dist/index.js
```

`GET /healthz` vrací výsledný veřejný MCP endpoint — nejrychlejší způsob, jak ověřit, že `PUBLIC_URL` je opravdu to, co si myslíte.

## Vlastní hosting

> ⚠️ Server by měl běžet nepřetržitě — na uspávaném PC selžou naplánované
> zápisy. Podrobnosti a doporučení v [HOSTING.md](HOSTING.md).

Referenční nasazení používá Docker, nginx a Cloudflare Tunnel zdarma — na hostiteli ani routeru se neotvírá žádný příchozí port. Funguje ale cokoli jiného, co před kontejner postaví HTTPS hostname; tunel je jen nejlevnější bezpečná výchozí volba.

Cesta požadavku:

```
Cloudflare → cloudflared (host network) → 127.0.0.1:80 → nginx → kt-mcp:8092
```

nginx poslouchá jen na loopbacku hostitele a `cloudflared` se připojuje ven.
Konfigurace nginx (`deploy/nginx.conf.template`) vypíná proxy buffering — bez
toho by Server-Sent Events čekaly na konec streamu a volání nástrojů by se
zasekávala.

**1. Vytvořte tunel** (jednou), v Cloudflare Zero Trust dashboardu → Networks → Tunnels:

- Vytvořte tunel, zkopírujte **tunnel token**.
- Přidejte public hostname se službou **`HTTP`** → **`localhost:80`**.
  `cloudflared` ze stacku běží v host network módu, takže `localhost:80` je
  nginx publikovaný na loopbacku hostitele. Obyčejné `http`, protože TLS
  ukončuje tunel.

Zvolený hostname je dále označován `<your-host>`; funguje jakákoli doména na
vašem Cloudflare účtu a nic v kódu na ni není vázané.

**2. Sestavte image**, z tohoto adresáře:

```bash
docker compose build
```

**3. Nasaďte stack.** `deploy/stack.yml` je runtime compose soubor (funguje samostatně i jako Portainer stack); nastavte tyto proměnné prostředí:

| Proměnná | Hodnota |
|---|---|
| `KT_EMAIL` / `KT_PASSWORD` | Váš login na [kaloricketabulky.cz](https://www.kaloricketabulky.cz) / [kaloricketabulky.sk](https://www.kaloricketabulky.sk) |
| `KT_DOMAIN` | `kaloricketabulky.cz` (výchozí) nebo `kaloricketabulky.sk` podle vašeho účtu |
| `KT_BASE_URL` | Volitelná základní URL; použije se jen při nenastaveném nebo prázdném `KT_DOMAIN` |
| `MCP_HOSTNAME` | `<your-host>` — holý hostname bez schématu. nginx si ho při startu doplní do konfigurace |
| `MCP_AUTH_PASSWORD` | Dlouhá přístupová fráze, kterou si zvolíte (min. 12 znaků) |
| `PUBLIC_URL` | `https://<your-host>` — musí přesně odpovídat hostname tunelu |
| `TUNNEL_TOKEN` | Z kroku 1 |

Udržujte `docker-compose.yml` a `deploy/stack.yml` v souladu — první sestavuje image, druhý ho spouští.

**4. Ověřte nasazení**, než ho připojíte k agentovi:

```bash
./scripts/verify-deployment.sh https://<your-host>
```

**5. Připojte agenta.** V Claudovi: Settings → Connectors → Add custom connector → zadejte `https://<your-host>/mcp`. Agent se sám zaregistruje, otevře stránku souhlasu a vy jednou zadáte `MCP_AUTH_PASSWORD`. Ostatní MCP klienti mají vlastní postup „přidat vzdálený MCP server" se stejnou URL.

### Pozdější změna domény

Hostname není zapečený v image — shodovat se musí jen `PUBLIC_URL` a public
hostname tunelu. Přesun:

1. Přesměrujte public hostname tunelu na novou doménu (nebo vytvořte nový tunel
   a vyměňte `TUNNEL_TOKEN`).
2. Aktualizujte `PUBLIC_URL` na stacku a znovu nasaďte.
3. Znovu spusťte ověřovací skript, pak v agentovi konektor odeberte a přidejte
   znovu.

Krok 3 je nutný: `PUBLIC_URL` je OAuth issuer a identifikátor zdroje podle
RFC 8707, takže tokeny vydané pod starým hostname jsou po přesunu správně
odmítnuty.

### Zaseklí, nebo nemáte kde hostovat?

Pokud při vlastním hostování narazíte, založte [GitHub issue](../../issues) —
rád pomůžu, od toho issue tracker je.

Vlastní hosting potřebuje stroj, který běží nepřetržitě (viz
[HOSTING.md](HOSTING.md)), a účet u Cloudflare. Pokud nemáte kde server
provozovat, ozvěte se na **kt-mcp@stanwhy.me** a něco vymyslíme — jen počítejte
s tím, že provoz privátní instance znamená reálné náklady na server, které by
šly za vámi.

## Autentizace

Server je sám sobě OAuth 2.1 autorizačním serverem a implementuje, co MCP specifikace od chráněného zdroje vyžaduje:

- `/.well-known/oauth-protected-resource/mcp` — RFC 9728 discovery
- `/.well-known/oauth-authorization-server` — RFC 8414 discovery
- `/authorize`, `/token`, `/register`, `/revoke` — authorization code + PKCE, dynamická registrace klientů, rotace refresh tokenů

Přístupové tokeny žijí 30 dní a persistují se do `/data` na volume, takže redeploy nevynutí nové připojení konektoru.

### Co chrání přístupová fráze

`MCP_AUTH_PASSWORD` je jediná cesta k získání tokenu. Každý požadavek na `/mcp`
vyžaduje platný bearer token a tokeny vydává výhradně formulář souhlasu po
porovnání s frází v konstantním čase. Ověřeno auditem
(`scripts/security-audit.sh`): neautentizovaná volání i volání s padělaným
tokenem jsou odmítnuta, vymyšlené autorizační kódy a refresh tokeny jsou
odmítnuty, žádný veřejný endpoint nevydává credential a žádná variace metody či
cesty se k nástrojům bez tokenu nedostane.

Dvě věci jsou veřejné záměrně a bezpečně: OAuth discovery dokumenty (vyžaduje je
specifikace) a dynamická registrace klientů. Registrace klienta útočníkovi nic
nedá — token bez fráze stále nezíská.

Hrubou sílu omezuje limit 100 požadavků za 15 minut na `/authorize`. Limiter
klíčuje podle IP klienta, proto nginx **přepisuje** `X-Forwarded-For` ověřenou
hlavičkou `CF-Connecting-IP` od Cloudflare a aplikace věří přesně jednomu proxy
hopu. Připojování k hlavičce od klienta — nebo `trust proxy: true` — by útočníkovi
dovolilo vyrobit si nový bucket pro každý požadavek a limit by přestal existovat.

Zbytková rizika, o kterých je dobré vědět: kdokoli s frází má plný přístup;
jednotlivé tokeny nelze odvolat jinak než smazáním `/data/oauth-state.json`;
a protože registrace klientů je otevřená, phishingový odkaz na stránku souhlasu
by mohl frázi zachytit, kdybyste ji tam zadali — před autorizací zkontrolujte
jméno klienta zobrazené ve formuláři.

## Omezení

- **Nedokumentovaný upstream.** Dine4Fit tu nic negarantuje; refactoring frontendu může bez varování změnit tvary odpovědí. Klient při čemkoli nečekaném vyhodí chybu místo hádání, takže se rozbití projeví hlasitou chybou, ne špatným počtem kalorií.
- **`md5(hesla)` je ekvivalent hesla.** Web hashuje heslo na klientovi, hash je tedy stejně citlivý jako heslo samotné. Podle toho s `KT_PASSWORD` zacházejte.
- **Jeden účet na instanci.** Server se přihlašuje k jedinému účtu [kaloricketabulky.cz](https://www.kaloricketabulky.cz) (či [kaloricketabulky.sk](https://www.kaloricketabulky.sk)). Dva lidé, dva kontejnery.
- **Osobní použití.** Automatizace zápisů do vlastního účtu je mnohem měkčí pozice než hromadný scraping, ale pořád je mimo cokoli, co Dine4Fit posvětil. Držte frekvenci požadavků na lidské úrovni a nestavte na tom konkurenčního klienta.
- **Denní souhrny obsahují součty, nikoli jednotlivé záznamy jídelníčku.** Parsování pokrývají řízené testy podle komunitních modelů API; neověřují váš účet ani nezaručují neměnnost nedokumentovaných endpointů.
- **Škálování porcí receptů.** Při zápisu uložených receptů pomocí `log_meal` jsou plně podporovány částečné i vícenásobné porce (např. `0.5` nebo `2`) prostřednictvím poměrného přepočtu jednotlivých surovin receptu.

> [!WARNING]
> ## Neoficiální projekt, bez vazby na Dine4Fit
>
> [kaloricketabulky.cz](https://www.kaloricketabulky.cz) i [kaloricketabulky.sk](https://www.kaloricketabulky.sk) provozuje společnost **Dine4Fit, a.s.**, která s tímto
> projektem nemá nic společného a nijak ho neschvaluje. Veřejné API neexistuje;
> zde použité endpointy byly vyčteny z frontendového JavaScriptu samotného webu
> a mohou se kdykoli bez varování změnit nebo rozbít.
>
> Podmínky Dine4Fit udělují **osobní, nekomerční** licenci. Tento software je
> zveřejněn proto, abyste si mohli zautomatizovat přístup ke **svému vlastnímu
> účtu** — což licence dovoluje. Provozovat ho jako placenou nebo víceuživatelskou
> službu, případně dál šířit potravinová data, která vrací, je jiná věc a jde
> na váš vrub. Databáze patří Dine4Fit a je chráněna evropskými databázovými právy.
>
> Držte frekvenci požadavků na lidské úrovni. Nestavte na tom konkurenčního klienta.

## Credits

* **[nikopol666/kaloricke-tabulky-MCP](https://github.com/nikopol666/kaloricke-tabulky-MCP)** — koncept bezpečného zápisu s náhledem (`dry_run` / `commit`).
* **[tomasvotava/kaloricketabulky](https://github.com/tomasvotava/kaloricketabulky)** — inspirace pro přehledné strukturování denních souhrnů, makroživinových cílů a statistik.
* **[TomasHubelbauer/kaloricke-tabulky-api](https://github.com/TomasHubelbauer/kaloricke-tabulky-api)** — reverzní inženýrství endpointů pro záznam a sledování tělesné hmotnosti (`record_weight`).

## Licence

Licensed under the [MIT license](LICENSE). Databáze potravin a služba [kaloricketabulky.cz](https://www.kaloricketabulky.cz) patří Dine4Fit, a.s. — tato licence pokrývá pouze kód v tomto repozitáři.
