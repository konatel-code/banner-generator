# CK DAKA – generátor bannerov

Nástroj na tvorbu reklamných bannerov zo zájazdov v XML feede CK DAKA.

Dve časti, jedno spoločné jadro:

| Časť | Čo robí | Kde beží |
|---|---|---|
| `index.html` | interaktívny generátor – vyber zájazdy a formáty, stiahni ZIP | statický hosting (Netlify) |
| `server/` | automatický render z feedu + produktové feedy pre reklamné platformy | Node proces (Docker) |
| `shared/` | spoločný kód: parser feedu, formáty, kreslenie bannerov | oboje |

Kresliaca logika je v `shared/banner.js` a používajú ju obe časti, takže banner
vygenerovaný službou vyzerá presne ako náhľad v prehliadači. Úprava šablóny sa
robí na jedinom mieste.

## Interaktívny generátor

Otvor `index.html` cez lokálny server (kvôli ES modulom nefunguje `file://`):

```bash
node server.js            # http://localhost:3456
# alebo v Windows: SPUSTI.bat
```

## Automatická služba

```bash
cd server && npm install && npm start     # http://localhost:3457
```

Generuje bannery na požiadanie na vlastných URL a vydáva produktové feedy, ktoré
si Google Ads, Merchant Center a Meta sťahujú samy – bannery sa teda nemusia
generovať a nahrávať ručne. Pre klasické display kampane vie podklady nahrať aj
priamo do účtu Google Ads či Meta (`node upload.js`, predvolene nasucho).

O pravidelný chod sa stará `node sync.js --watch`: porovná feed s minulým behom
a pracuje len so zájazdmi, ktorým sa zmenila cena, termín alebo zľava.

Detaily, endpointy a nasadenie: [`server/README.md`](server/README.md).

## Nasadenie

| Kam | Návod |
|---|---|
| **Vlastný server s Pleskom** | [`docs/PLESK.md`](docs/PLESK.md) – beží tam všetko vrátane prihlásenia, Netlify netreba |
| Railway / Fly.io | [`docs/NASADENIE.md`](docs/NASADENIE.md), v koreni sú `railway.json` aj `fly.toml` |
| Napojenie reklamných platforiem | [`docs/NASADENIE.md`](docs/NASADENIE.md), fáza 2 a 3 |

Pri každom kroku je pripravený text, ktorý stačí vložiť do Claude in Chrome.

## Testy

```bash
cd server && npm test
```
