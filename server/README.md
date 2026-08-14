# CK DAKA – banner service

Serverová časť generátora bannerov. Robí to, čo doteraz robil človek klikaním
v prehliadači: prečíta XML feed zájazdov, vyrenderuje bannery a sprístupní ich
reklamným platformám.

Kľúčová myšlienka: **bannery sa nikam nenahrávajú ručne**. Služba ich generuje
na požiadanie na vlastnej URL a tie URL vloží do produktového feedu. Google Ads,
Merchant Center aj Meta si feed sťahujú sami – keď sa vo feede zmení cena alebo
termín, zmení sa aj obrázok. Nepotrebuje to schválenie API prístupu ani
developer token.

Kresliaci kód je zdieľaný s prehliadačovou appkou (`../shared/banner.js`), takže
server-side banner vyzerá presne ako náhľad v generátore.

## Spustenie

```bash
cd server
npm install
npm start           # http://localhost:3457
```

`npm start` obslúži aj pôvodnú appku (`index.html`) a `/proxy`, takže na lokálny
vývoj stačí jeden proces.

```bash
npm test            # 41 testov, bez prístupu na internet
```

## Endpointy

| Endpoint | Popis |
|---|---|
| `/img/{kód}/{š}x{v}.{jpg\|png\|webp}` | banner zájazdu vyrenderovaný na požiadanie |
| `/feed/google-merchant.xml` | RSS feed pre Merchant Center / Performance Max |
| `/feed/google-ads-dynamic.csv` | feed firemných údajov pre dynamický remarketing |
| `/feed/meta-catalog.csv`, `/feed/meta-catalog.xml` | katalóg pre Facebook / Instagram |
| `/feed/items.json` | surové položky – na ladenie |
| `/service` | prehľad služby |
| `/health` | stav feedu, fontov, dostupné rozmery |

### Parametre bannera

| Parameter | Hodnoty | Význam |
|---|---|---|
| `style` | `dark`, `light-wave`, `light-stamp` | štýl šablóny |
| `term` | `YYYY-MM-DD` | konkrétny termín → konkrétna cena („už za 729,50 €“) namiesto „od 730 €“ |
| `img` | index fotky | ručný výber fotky; bez neho sa vyberá automaticky |

Príklad:
`/img/D1001/1200x628.jpg?style=light-wave&term=2026-07-17`

Povolené sú len rozmery zo zoznamu formátov (`../shared/formats.js`) a fotky,
ktoré k danému zájazdu patria – službu teda nie je možné zneužiť na render
cudzích obrázkov.

### Parametre feedu

`style`, `terms` (koľko najbližších termínov na zájazd, 1–20), `limit`,
`from` (od ktorého dňa brať termíny – na náhľad).

Pri `terms > 1` vznikne z jedného zájazdu viac položiek s vlastnou cenou;
spája ich `item_group_id`.

## Dávkové generovanie do súborov

Keď treba bannery ako súbory (napr. na ručné nahratie do knižnice podkladov):

```bash
node generate.js --out ./out --platform "Google Ads" --style dark --terms 2
node generate.js --out ./out --codes D1001,D1002 --sizes 300x250,1200x628
node generate.js --help
```

Vedľa obrázkov vznikne `manifest.json` so zoznamom vygenerovaného – z neho bude
čerpať nahrávač do reklamných platforiem (fáza 2).

## Konfigurácia

Všetko cez env premenné, žiadne tajomstvá v kóde:

| Premenná | Predvolené | Popis |
|---|---|---|
| `PORT`, `HOST` | `3457`, `0.0.0.0` | kde služba počúva |
| `FEED_URL` | export cesys | zdrojový XML feed |
| `LOGO_URL` | logo z webu | logo do bannerov |
| `PUBLIC_URL` | z hlavičiek | verejná adresa – vkladá sa do feedov |
| `LINK_TEMPLATE` | – | šablóna odkazu na detail, napr. `https://www.ckdaka.sk/zajazd/{slug}-{code}` |
| `SITE_URL` | `https://www.ckdaka.sk` | záložný odkaz |
| `FEED_TTL_MS` | 30 min | ako často sa sťahuje feed |
| `DEFAULT_STYLE`, `DEFAULT_EXT` | `dark`, `jpg` | predvolený štýl a formát |
| `JPEG_QUALITY`, `WEBP_QUALITY` | 88, 90 | kvalita kompresie |
| `MAX_CONCURRENT_RENDERS` | 4 | koľko bannerov sa kreslí naraz |
| `CACHE_DIR` | `server/.cache` | cache fotiek a hotových bannerov |
| `BANNER_MAX_AGE`, `FEED_MAX_AGE` | 6 h, 30 min | hlavičky `Cache-Control` |
| `FEED_LIMIT` | 0 (bez limitu) | strop počtu položiek vo feede |

Ak feed dočasne vypadne, služba beží ďalej na poslednej úspešne načítanej verzii.

## Nasadenie

```bash
docker build -f server/Dockerfile -t ckdaka-banner .
docker run -p 3457:3457 \
  -e PUBLIC_URL=https://banner-api.ckdaka.sk \
  -e LINK_TEMPLATE='https://www.ckdaka.sk/zajazd/{slug}-{code}' \
  -v ckdaka-cache:/app/.cache \
  ckdaka-banner
```

Netlify na to nestačí – funkcie majú krátky časový limit a render bannerov je
CPU práca. Potrebný je bežiaci Node proces (Fly.io, Railway, VPS). Statická
appka `index.html` môže ostať na Netlify tak, ako je.

Cache je zámerne na disku: `docker run` bez `-v` funguje tiež, len sa po reštarte
znova vyrenderuje.

## Napojenie platforiem

1. **Google Merchant Center** → Produkty → Feedy → pridať feed z URL
   `https://.../feed/google-merchant.xml`, plánovať sťahovanie denne.
2. **Google Ads – dynamický remarketing** → Nástroje → Zdieľaná knižnica →
   Firemné údaje → nahrať `/feed/google-ads-dynamic.csv` (alebo plánovaný odber URL).
3. **Meta** → Commerce Manager → katalóg → Zdroje dát → plánovaný odber
   `https://.../feed/meta-catalog.csv`.

Pri všetkých troch platí: adresa v `PUBLIC_URL` musí byť verejne dostupná
(platforma si obrázky sťahuje sama) a bežať na HTTPS.

## Čo služba zatiaľ nerobí

Nenahráva podklady cez API priamo do kampaní (Google Ads API, Meta Marketing
API). To je fáza 2 – vyžaduje developer token, OAuth a schvaľovanie zo strany
platforiem. `manifest.json` z `generate.js` je pripravený ako vstup pre takýto
nahrávač.
