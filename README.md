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
priamo do knižnice Google Ads (`node upload.js`, predvolene nasucho).
Detaily, endpointy a nasadenie: [`server/README.md`](server/README.md).

## Testy

```bash
cd server && npm test
```
