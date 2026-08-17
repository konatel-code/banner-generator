# Nasadenie na Plesk

Návod pre vlastný server s Pleskom. Po dokončení beží na tvojom serveri
**všetko** – generátor v prehliadači, prihlásenie, render bannerov aj feedy
pre reklamné platformy. Netlify už netreba.

Väčšinu klikania v Plesku zvládne Claude in Chrome; kroky s príkazovým
riadkom sú označené.

---

## Čo musí server spĺňať

| Požiadavka | Ako overiť |
|---|---|
| Rozšírenie **Node.js** v Plesku | Extensions → nainštalované rozšírenia |
| Node **20 alebo novší** | v nastaveniach domény → Node.js → verzia |
| Linux x64 s glibc (bežné AlmaLinux, Ubuntu, Debian) | render bannerov používa natívnu knižnicu |
| ~500 MB voľného miesta | závislosti a cache bannerov |

Ak rozšírenie Node.js nie je nainštalované: Extensions → Extensions Catalog →
Node.js → Install.

---

## 1. Doména alebo subdoména

Odporúčam samostatnú subdoménu, napr. `banner.ckdaka.sk`.

> **Prompt pre Claude in Chrome**
>
> V Plesku otvor Websites & Domains a pridaj subdoménu `banner.ckdaka.sk`.
> Document root zatiaľ nechaj predvolený, upravíme ho neskôr. Potom
> subdoméne vydaj Let's Encrypt certifikát (SSL/TLS Certificates → Install
> a zapni presmerovanie na HTTPS).

HTTPS je nutnosť – reklamné platformy si obrázky z nezabezpečenej adresy
nestiahnu.

---

## 2. Nahratie kódu

**Cez Git (odporúčané, aktualizácie sú potom jedno kliknutie):**

> **Prompt pre Claude in Chrome**
>
> V Plesku otvor subdoménu `banner.ckdaka.sk` → Git → Add Repository.
> Vzdialený repozitár je `https://github.com/konatel-code/banner-generator`,
> vetva `claude/dotidot-service-expansion-ivaljb`. Ako cieľový priečinok
> nastav `banner.ckdaka.sk` a zapni automatické nasadenie po pull.

**Alebo cez File Manager:** stiahni ZIP repozitára a rozbaľ ho do priečinka
subdomény.

Výsledná štruktúra na serveri:

```
/var/www/vhosts/ckdaka.sk/banner.ckdaka.sk/
├── index.html          ← appka pre prehliadač
├── shared/             ← spoločný kód
└── server/             ← služba (tu beží Node)
    ├── app.cjs         ← štartovací súbor pre Plesk
    ├── package.json
    └── public/         ← prázdny, bude to Document Root
```

---

## 3. Nastavenie Node.js aplikácie

> **Prompt pre Claude in Chrome**
>
> V Plesku otvor subdoménu → Node.js a nastav:
> Node.js Version = 22 (alebo 20), Document Root = `/server/public`,
> Application Mode = production, Application Root = `/server`,
> Application Startup File = `app.cjs`.
> Potom klikni na NPM install a počkaj, kým sa dokončí.

Tri veci, ktoré sa oplatí nepomýliť si:

- **Application Root je `server/`** – tam je `package.json`.
- **Startup file je `app.cjs`** – Passenger ho načíta cez `require()`, preto
  je zámerne v CommonJS a zvyšok naštartuje sám.
- **Document Root je `server/public`, ktorý je prázdny.** Vďaka tomu ide
  každá požiadavka do aplikácie, ktorá vydá len `index.html` a moduly
  v `shared/`. Keby bol Document Root koreň projektu, web server by
  ochotne vydal aj zdrojáky, `node_modules` a cache.

`NPM install` trvá 1–3 minúty – sťahuje sa aj knižnica na kreslenie
a font Ubuntu.

---

## 4. Premenné prostredia

V tej istej obrazovke (Node.js → Custom environment variables) pridaj:

```
PUBLIC_URL      = https://banner.ckdaka.sk
CACHE_DIR       = /var/www/vhosts/ckdaka.sk/banner.ckdaka.sk/server/.cache
BANNER_PASSWORD = <heslo do generátora>
BANNER_SECRET   = <náhodný reťazec, aspoň 32 znakov>
```

`BANNER_PASSWORD` a `BANNER_SECRET` sú tie isté hodnoty, aké máš dnes
v Netlify – ak ich necháš rovnaké, prihlasovacie heslo sa nezmení.

Odkazy na detail zájazdu berie služba z tagu `<url>` vo feede, takže sa
nastavovať nemusia. Nepovinné zálohy pre prípad, že by odkaz niektorému
zájazdu chýbal: `LINK_TEMPLATE` (napr.
`https://www.ckdaka.sk/zajazd/{slug}-{code}`) a `SITE_URL`.

Po uložení premenných klikni na **Restart App**.

---

## 5. Kontrola, že to beží

Otvor `https://banner.ckdaka.sk/health`. Očakávaný výsledok:

```json
{
  "ok": true,
  "feed": {
    "tours": 250,
    "lastError": null,
    "links": { "fromFeed": 250, "fromTemplate": 0, "example": "https://www.ckdaka.sk/zajazd/..." }
  },
  "fonts": { "ok": true, "weights": ["400","500","700"] },
  "auth": "heslo"
}
```

V `feed.links` sa oplatí pozrieť dve veci: `fromFeed` má sedieť s počtom
zájazdov (odkazy sa berú z tagu `<url>`) a `example` má byť skutočná adresa
detailu zájazdu – klikni na ňu. Ak je `fromTemplate` väčšie ako nula, toľkým
zájazdom odkaz vo feede chýba a doplní sa zo šablóny `LINK_TEMPLATE`.

Potom skontroluj:

| Adresa | Čo má byť |
|---|---|
| `https://banner.ckdaka.sk/` | prihlasovacia obrazovka generátora |
| `https://banner.ckdaka.sk/service` | prehľad služby s odkazmi na feedy |
| `https://banner.ckdaka.sk/feed/google-merchant.xml` | XML s položkami |
| `https://banner.ckdaka.sk/server/config.js` | **404** – zdrojáky nesmú ísť von |

Posledný riadok je bezpečnostná kontrola. Ak vráti obsah súboru, Document
Root nie je nastavený na `server/public` – oprav to a reštartuj.

---

## 6. Pravidelný beh

Plesk má vlastný plánovač.

> **Prompt pre Claude in Chrome**
>
> V Plesku otvor Tools & Settings → Scheduled Tasks (alebo v doméne
> Scheduled Tasks) a vytvor úlohu typu „Run a command". Príkaz:
> `/opt/plesk/node/22/bin/node /var/www/vhosts/ckdaka.sk/banner.ckdaka.sk/server/sync.js`
> Spúšťanie nastav dvakrát denne, o 5:00 a 17:00. Cestu k node uprav podľa
> verzie, ktorú si vybral v nastaveniach Node.js.

Presnú cestu k node zistíš cez SSH:

```bash
ls /opt/plesk/node/
```

Cyklus stiahne feed, porovná ho s minulým behom a pregeneruje len zájazdy,
ktorým sa zmenila cena, termín alebo zľava. Do reklamných účtov nesiahne,
kým sa nepridá `--upload google-ads,meta --confirm`.

Plánovaná úloha potrebuje rovnaké premenné ako aplikácia. Plesk ich úlohám
neodovzdáva, preto ich zadaj priamo v príkaze:

```
CACHE_DIR=/var/www/vhosts/ckdaka.sk/banner.ckdaka.sk/server/.cache \
PUBLIC_URL=https://banner.ckdaka.sk \
/opt/plesk/node/22/bin/node /var/www/vhosts/.../server/sync.js
```

---

## 7. Napojenie reklamných platforiem

Odtiaľto pokračuj fázou 2 v [`NASADENIE.md`](NASADENIE.md) – adresy feedov sú
tie isté, len na tvojej doméne:

```
https://banner.ckdaka.sk/feed/google-merchant.xml
https://banner.ckdaka.sk/feed/google-ads-dynamic.csv
https://banner.ckdaka.sk/feed/meta-catalog.csv
```

---

## Keď niečo nejde

**502 Bad Gateway alebo „Web application could not be started"**
Pozri log: Logs → `error_log`, alebo v Node.js paneli tlačidlo Show logs.
Najčastejšie chýba `NPM install` alebo je zle zadaný startup file.

**„Cannot find module '@napi-rs/canvas'"**
Nespustil sa NPM install, alebo bežal pod inou verziou Node. Prepni verziu,
zmaž `server/node_modules` a spusti NPM install znova.

**Bannery bez diakritiky alebo s prázdnymi štvorcami**
Font Ubuntu sa inštaluje z npm, takže by mal byť vždy. Prázdny štvorec pri
dátume znamená, že na serveri nie je emoji font – služba to zistí a ikonu
vynechá, text zostane správny. Ak ju chceš, doinštaluj balík
`google-noto-emoji-color-fonts` (AlmaLinux) alebo `fonts-noto-color-emoji`
(Debian, Ubuntu) a reštartuj aplikáciu.

**Feed hlási `"tours": 0`**
Server sa nedostal k XML feedu. Cez SSH skús:
`curl -I https://cestovnakancelariadaka.sk/export/cesys`

**Prvý banner sa načítava dlho**
Prvé vykreslenie sťahuje fotku zájazdu. Ďalšie idú z cache. Práve preto sa
oplatí mať zapnutý plánovaný `sync.js` – pripraví bannery dopredu.

**Po aktualizácii kódu sa nič nezmenilo**
Po `git pull` treba v Node.js paneli kliknúť na **Restart App**.

---

## Čo zostáva na Netlify

Nič – po tomto nasadení beží všetko na tvojom serveri. Pôvodné Netlify
funkcie (`netlify/functions/`) v repozitári nechávam, aby appka fungovala aj
tam, keby si sa chcel vrátiť. Appka si sama zistí, kde overovanie beží:
najprv skúsi `/api/check-auth` na vlastnom serveri a až potom Netlify.
