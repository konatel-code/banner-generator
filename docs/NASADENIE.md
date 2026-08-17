# Nasadenie – krok za krokom

Návod je písaný tak, aby väčšinu klikania v prehliadači zvládol **Claude in
Chrome**. Pri každom kroku je pripravený text, ktorý mu stačí vložiť.

Poradie fáz nie je náhodné: fáza 1 odomkne fázu 2 (feedy potrebujú verejnú
adresu) a fáza 3 sa začína čakaním na schválenie, takže ju treba rozbehnúť čo
najskôr.

---

## Než začneš: čo Claude in Chrome zvládne a čo nie

**Zvládne:** preklikať administrácie (Railway, Merchant Center, Google Ads,
Business Manager), vyplniť formuláre, nájsť ID účtov, založiť feedy, nastaviť
plán sťahovania.

**Nezvládne:** spustiť príkaz v termináli, prijať za teba zmluvné podmienky
a schváliť žiadosti, ktoré posudzuje človek na strane platformy.

### Tajomstvá do chatu nediktuj

Claude in Chrome vidí obsah stránky, na ktorej pracuje – vrátane tokenov.
Pri každom kroku, kde vzniká token alebo heslo, urob toto:

1. nechaj Clauda dokliknúť sa na miesto, kde sa token generuje,
2. token **skopíruj sám** (Ctrl+C) a **sám ho vlož** do premenných na Railway,
3. Claudovi povedz len „hotovo, pokračuj" – hodnotu mu neposielaj.

Rovnaké pravidlo platí pre `client secret` a refresh tokeny.

---

## Fáza 0 – Čo mať poruke (15 min)

| Potrebuješ | Kde |
|---|---|
| GitHub účet s prístupom k repozitáru | github.com/konatel-code/banner-generator |
| Účet na Railway (alebo Fly.io) | railway.app – dá sa prihlásiť cez GitHub |
| Prístup správcu do Google Ads | ads.google.com |
| Prístup do Meta Business Managera | business.facebook.com |

Odkaz na detail zájazdu riešiť netreba – feed ho má pri každom zájazde
v tagu `<url>` a služba ho odtiaľ berie. Či to sedí, uvidíš v `/health`
(položka `feed.links`) hneď po nasadení.

---

## Fáza 1 – Rozbehnúť službu (20 min)

### 1.1 Vytvoriť projekt na Railway

> **Prompt pre Claude in Chrome**
>
> Otvor railway.app a prihlás sa cez GitHub. Vytvor nový projekt cez
> „Deploy from GitHub repo" a vyber repozitár `konatel-code/banner-generator`,
> vetvu `claude/dotidot-service-expansion-ivaljb`. Repozitár má v koreni
> súbor `railway.json`, ktorý hovorí, že sa má stavať cez
> `server/Dockerfile` – nič iné pri builde nenastavuj. Keď build začne,
> daj mi vedieť.

Prvý build trvá 3–5 minút (sťahuje sa Node a font).

### 1.2 Pripojiť úložisko pre cache

> **Prompt pre Claude in Chrome**
>
> V projekte na Railway otvor službu, klikni na záložku Variables a pridaj
> premennú `CACHE_DIR` s hodnotou `/data`. Potom v nastaveniach služby pridaj
> Volume s mount path `/data`, veľkosť 3 GB.

Bez úložiska to funguje tiež, len sa po každom reštarte bannery generujú
odznova.

### 1.3 Nastaviť premenné

Do Variables pridaj:

```
PUBLIC_URL     = https://<adresa-z-railway>
CACHE_DIR      = /data
```

`PUBLIC_URL` musí byť presne tá adresa, na ktorej služba beží – vkladá sa do
feedov ako odkaz na obrázky.

`LINK_TEMPLATE` je nepovinná záloha pre prípad, že by niektorý zájazd vo feede
odkaz nemal (`{code}` je kód zájazdu, `{slug}` názov v tvare pre URL).

### 1.4 Overiť, že služba žije

Otvor v prehliadači `https://<adresa>/health`. Má sa zobraziť JSON, v ktorom
je `"ok": true`, počet načítaných zájazdov a `"fonts": {"ok": true}`.

Potom otvor `https://<adresa>/service` – prehľad služby s odkazmi na feedy.
Klikni na ktorýkoľvek feed a pozri sa, či obsahuje položky s adresami
obrázkov. Jednu takú adresu otvor – musí sa zobraziť hotový banner.

**Ak `/health` hlási `"tours": 0`:** služba sa nedostala k XML feedu.
Skontroluj, či `cestovnakancelariadaka.sk/export/cesys` odpovedá aj zvonku.

---

## Fáza 2 – Feedy do platforiem (30 min, bez čakania na schválenie)

Toto je najrýchlejšia cesta k výsledku: platformy si bannery sťahujú samy,
netreba žiadny developer token.

### 2.1 Google Merchant Center

> **Prompt pre Claude in Chrome**
>
> Otvor merchants.google.com a prihlás sa. Prejdi do Produkty → Zdroje údajov
> → Pridať zdroj údajov → Naplánovaný odber zo súboru. Ako názov zadaj
> „CK DAKA bannery", ako URL zadaj `https://<adresa>/feed/google-merchant.xml`,
> frekvenciu nastav na denne o 5:00, krajinu Slovensko, jazyk slovenčina.
> Ulož a spusti prvé stiahnutie. Potom mi povedz, koľko položiek sa načítalo
> a či hlási nejaké chyby.

### 2.2 Google Ads – feed firemných údajov

> **Prompt pre Claude in Chrome**
>
> Otvor ads.google.com. Prejdi do Nástroje → Zdieľaná knižnica → Firemné
> údaje → tlačidlo plus → Vlastné údaje. Vyber možnosť naplánovaného
> nahrávania z URL a zadaj `https://<adresa>/feed/google-ads-dynamic.csv`,
> frekvencia denne. Ulož a spusti nahranie. Povedz mi, či prešlo bez chýb.

### 2.3 Meta katalóg

> **Prompt pre Claude in Chrome**
>
> Otvor business.facebook.com a prejdi do Commerce Manager → Katalógy.
> Vytvor nový katalóg typu „Produkty" s názvom „CK DAKA zájazdy". V katalógu
> choď do Zdroje údajov → Pridať položky → Naplánovaný odber a zadaj URL
> `https://<adresa>/feed/meta-catalog.csv`, frekvencia denne. Ulož, spusti
> prvé načítanie a povedz mi, koľko položiek prešlo a koľko skončilo chybou.

**Po fáze 2 už systém funguje** – dynamické kampane majú bannery, ktoré sa
samy prekresľujú pri zmene ceny. Zvyšok je pre klasické display kampane.

---

## Fáza 3 – Prístupy pre nahrávanie do účtov

Tu sa čaká na schválenia, preto začni hneď, aj keď to dokončíš neskôr.

### 3.1 Google Ads – developer token (schvaľovanie: dni až týždne)

> **Prompt pre Claude in Chrome**
>
> Otvor ads.google.com, prejdi do Nástroje → Nastavenia → API Center.
> Ak tam ešte nie je žiadosť, vyplň ju: účel použitia je správa vlastného
> reklamného účtu, nahrávanie obrázkových podkladov generovaných z produktového
> feedu cestovnej kancelárie. Odošli žiadosť a povedz mi, aký stav má token
> (Test / Basic / Standard).

Na začiatok stačí **Basic access**. S testovacím tokenom sa dá volať len na
testovacie účty.

### 3.2 Google Ads – OAuth klient a refresh token

> **Prompt pre Claude in Chrome**
>
> Otvor console.cloud.google.com, vyber alebo vytvor projekt „CK DAKA bannery".
> Zapni Google Ads API v knižnici API. Potom v Credentials vytvor OAuth
> client ID typu Desktop app. Keď sa zobrazí client ID a client secret,
> zastav sa a daj mi vedieť – hodnoty si skopírujem sám.

Refresh token potom získaš raz cez OAuth Playground
(`developers.google.com/oauthplayground`), scope
`https://www.googleapis.com/auth/adwords`, v nastaveniach zaškrtni „Use your
own OAuth credentials".

Do premenných na Railway vlož: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_REFRESH_TOKEN`, `GOOGLE_ADS_DEVELOPER_TOKEN`,
`GOOGLE_ADS_CUSTOMER_ID` (bez pomlčiek) a pri správe cez MCC aj
`GOOGLE_ADS_LOGIN_CUSTOMER_ID`.

### 3.3 Meta – systémový token

> **Prompt pre Claude in Chrome**
>
> Otvor business.facebook.com → Nastavenia firmy → Používatelia → Systémoví
> používatelia. Vytvor systémového používateľa „CK DAKA bannery" s rolou
> Zamestnanec. Prirad mu reklamný účet s plným prístupom. Potom klikni na
> „Generovať nový token", vyber aplikáciu a povolenia `ads_management`
> a `business_management`, platnosť Nikdy nevyprší. Keď sa token zobrazí,
> zastav sa a daj mi vedieť.

Do premenných: `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`.

### 3.4 Ostatné platformy (voliteľné)

| Platforma | Kde získať prístup | Premenné |
|---|---|---|
| Microsoft Advertising | Nástroje → Developer Settings (developer token) + Azure App registration | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REFRESH_TOKEN`, `MICROSOFT_DEVELOPER_TOKEN`, `MICROSOFT_ACCOUNT_ID`, `MICROSOFT_CUSTOMER_ID` |
| TikTok | business-api.tiktok.com → aplikácia s právom Ad Account Management | `TIKTOK_ACCESS_TOKEN`, `TIKTOK_ADVERTISER_ID` |
| Pinterest | developers.pinterest.com → aplikácia s právom `pins:write` | `PINTEREST_ACCESS_TOKEN`, `PINTEREST_BOARD_ID` |

---

## Fáza 4 – Prvé nahratie a automatika

### 4.1 Nasucho (nič sa neodošle)

Na Railway otvor službu → záložka Deployments → tri bodky → „Run command":

```
node upload.js --target google-ads --limit 5
```

Výpis ukáže, čo by sa nahralo. Keď sedí, spusti to isté s `--confirm`.

**Toto je jediný krok, ktorý Claude in Chrome nespraví za teba** – ide
o príkaz, nie o klikanie.

### 4.2 Zapnúť pravidelný beh

V Railway pridaj druhú službu z toho istého repozitára a nastav jej
štartovací príkaz:

```
node sync.js --watch --interval 360
```

Beží každých 6 hodín, pregeneruje len zmenené zájazdy a do účtov nesiahne.
Keď chceš aj nahrávanie, priprav príkaz s `--upload google-ads,meta --confirm`.

Alternatíva bez druhej služby: cron na vlastnom serveri, príklad je
v [`server/README.md`](../server/README.md).

---

## Fáza 5 – Čo sledovať

| Kde | Čo hľadať |
|---|---|
| `https://<adresa>/health` | `tours` > 0, `lastError` prázdny |
| `<CACHE_DIR>/last-sync.json` | čo sa naposledy zmenilo a koľko sa vygenerovalo |
| Merchant Center → Diagnostika | zamietnuté položky |
| Meta Commerce Manager → Kvalita | chyby v katalógu |

Najčastejšie problémy:

- **Feed má 0 položiek** – všetkým zájazdom prebehli termíny, alebo sa nedá
  stiahnuť XML. Skontroluj `/health`.
- **Platforma nevie stiahnuť obrázok** – `PUBLIC_URL` nesedí s adresou, na
  ktorej služba beží, alebo nebeží na HTTPS.
- **Odkazy vedú na úvodnú stránku** – vo feede chýba `<url>` a nie je
  nastavený ani `LINK_TEMPLATE`. Koľkých zájazdov sa to týka, ukáže `/health`
  v položke `feed.links.fromTemplate`.

---

## Dve veci, ktoré si over sám

1. **Verzie API.** Klienti sú napísané proti Google Ads `v18` a Meta `v21.0`.
   Obe platformy verzie priebežne vypínajú. Ak nahrávanie hlási neznámu
   verziu, nastav `GOOGLE_ADS_API_VERSION` alebo `META_API_VERSION` na
   aktuálnu z dokumentácie – kód meniť netreba.
2. **Prvý ostrý beh.** Nahrávacie klienty sú otestované proti lokálnym
   napodobeninám API, nie proti skutočným účtom. Preto prvýkrát vždy
   bez `--confirm` a pozri si výpis.
