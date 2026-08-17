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
| `/` a `/shared/*.js` | appka pre prehliadač (servíruje sa len tento zoznam, nič iné z repozitára) |
| `/api/check-auth`, `/api/verify-auth` | prihlásenie do appky – funguje bez Netlify funkcií |
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

## Automatický beh

`sync.js` je to, čo má bežať samo. Jeden cyklus stiahne feed, porovná ho
s odtlačkom z minulého behu a pracuje **len so zmenenými zájazdmi**:

```bash
node sync.js                                  # jeden cyklus, len príprava obrázkov
node sync.js --watch --interval 360           # každých 6 hodín
node sync.js --upload google-ads,meta --confirm
node sync.js --all                            # pregenerovať všetko
```

Ukážka dvoch behov za sebou:

```
[sync] feed 7ef95359ad38: 3 zájazdov – prvý beh, 3 zájazdov na spracovanie
[sync] pregenerúvam 3 zájazdov × 3 rozmerov
[sync] hotovo za 2s – 9 bannerov

[sync] feed 7ef95359ad38: 3 zájazdov – žiadne zmeny
[sync] niet čo pregenerovať
```

Rozpoznáva zmenu ceny, posun najbližšieho termínu, zmenu zľavy, nové zájazdy
aj tie, ktoré z feedu zmizli. Predgenerovanie znamená, že keď si banner príde
stiahnuť Google alebo Meta, je už v cache a odpoveď je okamžitá.

Nahrávanie do účtov je vypnuté, kým sa nezapne `--upload` **a** `--confirm`.
Odtlačok sa zapisuje až na konci behu, takže prerušený cyklus sa nabudúce
zopakuje a nič sa nestratí.

Po behu ostáva `<CACHE_DIR>/last-sync.json` so správou: koľko sa zmenilo,
koľko sa vygenerovalo, koľko nahralo, ako dlho to trvalo.

Plánovanie: buď `--watch` v samostatnom kontajneri, alebo cron:

```
0 5,17 * * *  cd /app/server && node sync.js --upload google-ads --confirm >> /var/log/ckdaka-sync.log 2>&1
```

## Nahrávanie podkladov do reklamného účtu

Feedy pokrývajú dynamické kampane. Pre klasické display kampane treba obrázky
priamo v účte – na to slúži `upload.js`.

| Cieľ (`--target`) | Kam sa nahráva | Čo sa vráti |
|---|---|---|
| `google-ads` (predvolený) | knižnica podkladov účtu | `resourceName` |
| `meta` | knižnica obrázkov reklamného účtu | `hash` obrázka |
| `microsoft` | knižnica médií účtu (SOAP `AddMedia`) | `mediaId` |
| `tiktok` | knižnica obrázkov inzerenta | `image_id` |
| `pinterest` | pin na zvolenej nástenke | `pin_id` |

```bash
node upload.js --platform "Google Ads" --limit 20              # nasucho, nič sa neodošle
node upload.js --platform "Google Ads" --limit 20 --confirm    # naostro
node upload.js --target meta --sizes 1080x1080 --confirm       # Facebook / Instagram
node upload.js --target tiktok --sizes 1080x1920 --confirm     # TikTok
node upload.js --target meta --list                            # čo už v účte je
node upload.js --help
```

Pinterest je iný ako ostatné: nemá knižnicu podkladov, jednotkou obsahu je pin
na nástenke. Banner sa preto nahrá ako pin (s názvom a odkazom zo zájazdu),
ktorý sa dá následne propagovať.

Microsoft mapuje obrázky na typy podľa pomeru strán (`Image1x1`, `Image4x1`…).
Presné rozmery bannerov sa na typy nemapujú jedna k jednej, preto sa vyberá
najbližší pomer; natvrdo sa dá určiť cez `MICROSOFT_MEDIA_TYPE`.

Bez `--confirm` beh len vypíše, čo by nahral. Nahráva sa výhradne to, čo sa
zmenilo: stav v `<CACHE_DIR>/upload-state.json` si pamätá hash obsahu každého
podkladu, takže druhý beh bez zmeny cien neurobí ani jedno volanie API.
Podklad, ktorý v účte už existuje, sa nepovažuje za chybu.

Nahrávajú sa len obrázky. Zostavenie reklám a kampaní zostáva na človeku –
automat dodá podklady, nie stratégiu.

### Čo si treba vybaviť – Google Ads

| Premenná | Odkiaľ |
|---|---|
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads → Nástroje → API Center (schvaľuje Google, trvá to) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud Console → OAuth klient (typ Desktop) |
| `GOOGLE_REFRESH_TOKEN` | jednorazovo cez OAuth consent flow, rozsah `https://www.googleapis.com/auth/adwords` |
| `GOOGLE_ADS_CUSTOMER_ID` | ID účtu bez pomlčiek |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | ID MCC účtu, ak sa účet spravuje cezeň |
| `GOOGLE_ADS_API_VERSION` | predvolene `v18`; Google verzie priebežne vypína |

### Čo si treba vybaviť – Meta

| Premenná | Odkiaľ |
|---|---|
| `META_ACCESS_TOKEN` | Business Manager → systémový používateľ → dlhodobý token s právom `ads_management` |
| `META_AD_ACCOUNT_ID` | ID reklamného účtu (prefix `act_` sa doplní sám) |
| `META_API_VERSION` | predvolene `v21.0` |

Meta vráti pri nahratí `hash` obrázka – ten sa potom používa v reklamnom
kreatíve. Rovnaký obrázok nahratý druhýkrát dostane rovnaký hash.

### Čo si treba vybaviť – Microsoft Advertising

| Premenná | Odkiaľ |
|---|---|
| `MICROSOFT_DEVELOPER_TOKEN` | Microsoft Advertising → Nástroje → Developer Settings |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | Azure Portal → App registrations |
| `MICROSOFT_REFRESH_TOKEN` | jednorazovo cez consent flow, scope `https://ads.microsoft.com/msads.manage offline_access` |
| `MICROSOFT_ACCOUNT_ID`, `MICROSOFT_CUSTOMER_ID` | ID účtu a zákazníka z rozhrania Microsoft Advertising |
| `MICROSOFT_MEDIA_TYPE` | voliteľné – vynúti jeden typ média namiesto odvodenia z pomeru strán |

### Čo si treba vybaviť – TikTok

| Premenná | Odkiaľ |
|---|---|
| `TIKTOK_ACCESS_TOKEN` | TikTok for Business → Developers → aplikácia s právom `Ad Account Management` |
| `TIKTOK_ADVERTISER_ID` | ID inzerenta |
| `TIKTOK_API_VERSION` | predvolene `v1.3` |

TikTok hlási chyby s HTTP 200 a nenulovým `code` v tele – klient to rozoznáva,
takže neúspech sa neprehliadne.

### Čo si treba vybaviť – Pinterest

| Premenná | Odkiaľ |
|---|---|
| `PINTEREST_ACCESS_TOKEN` | Pinterest Developers → aplikácia s právom `pins:write` |
| `PINTEREST_BOARD_ID` | ID nástenky, na ktorú sa piny vytvárajú |
| `PINTEREST_DEFAULT_LINK` | voliteľné – odkaz, keď ho zájazd nemá |

Rozhrania oboch platforiem sa menia niekoľkokrát ročne. Pred prvým ostrým
behom over verziu a názvy polí v aktuálnej dokumentácii – beh bez `--confirm`
ukáže presne to, čo by sa odoslalo.

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
| `BANNER_PASSWORD` | – | heslo do generátora; bez neho je appka otvorená |
| `BANNER_SECRET` | – | tajný kľúč na podpis prihlasovacieho tokenu (aspoň 32 znakov) |

Ak feed dočasne vypadne, služba beží ďalej na poslednej úspešne načítanej verzii.

## Nasadenie

```bash
docker build -f server/Dockerfile -t ckdaka-banner .
docker run -p 3457:3457 \
  -e PUBLIC_URL=https://banner-api.ckdaka.sk \
  -e LINK_TEMPLATE='https://www.ckdaka.sk/zajazd/{slug}-{code}' \
  -v ckdaka-cache:/app/.cache \
  ckdaka-banner

# Synchronizácia ako druhý proces nad tou istou cache
docker run -v ckdaka-cache:/app/.cache ckdaka-banner node sync.js --watch --interval 360
```

Netlify na to nestačí – funkcie majú krátky časový limit a render bannerov je
CPU práca. Potrebný je bežiaci Node proces.

Na **Plesk** je pripravený štartovací súbor `app.cjs` (Passenger ho načíta cez
`require()`) a prázdny `public/` ako Document Root – postup je
v [`../docs/PLESK.md`](../docs/PLESK.md). Tam beží aj appka pre prehliadač
vrátane prihlásenia, takže Netlify netreba vôbec.

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

- **Nezostavuje reklamy ani kampane** – nahrá obrázky do knižnice podkladov,
  zvyšok ostáva na človeku.
- **Nemaže staré podklady** – keď termín prebehne, `upload.js` na to upozorní,
  ale z účtu nič neodstraňuje.
- **Nespravuje rozpočty ani cielenie** – to zostáva v rukách človeka.
- **Klienti nie sú overení proti ostrým účtom** – testy bežia proti lokálnym
  mockom, takže sedí tvar požiadaviek, nie správanie konkrétneho účtu. Prvý
  ostrý beh spusti bez `--confirm`.
