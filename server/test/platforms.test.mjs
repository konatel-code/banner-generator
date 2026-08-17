import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

// ── Falošné API troch platforiem v jednom serveri ───────────────────────────
// Každá platforma má vlastnú logiku chýb: Microsoft posiela SOAP Fault
// s HTTP 500, TikTok chybu s HTTP 200 a kódom v tele, Pinterest bežné
// stavové kódy. Testy overujú, že klient rozlíši dočasnú chybu od trvalej.
const calls = [];
let failuresLeft = 0;
let failMode = 'transient';

const api = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://x');
    calls.push({ path: url.pathname, method: req.method, headers: req.headers, raw, query: Object.fromEntries(url.searchParams) });

    const json = (status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    const xml = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'text/xml; charset=utf-8' });
      res.end(body);
    };

    // OAuth (Microsoft)
    if (url.pathname === '/token') return json(200, { access_token: 'ms-token', expires_in: 3600 });

    // ── Microsoft SOAP ──
    if (url.pathname === '/soap') {
      if (failuresLeft > 0) {
        failuresLeft--;
        const code = failMode === 'throttle' ? '117' : '999';
        return xml(500, `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault>
          <detail><AdApiFaultDetail xmlns="https://adapi.microsoft.com"><Errors><AdApiError>
          <Code>${code}</Code><Message>chyba ${code}</Message>
          </AdApiError></Errors></AdApiFaultDetail></detail></s:Fault></s:Body></s:Envelope>`);
      }
      return xml(200, `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>
        <AddMediaResponse xmlns="https://bingads.microsoft.com/CampaignManagement/v13">
        <MediaIds xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays"><a:long>556677</a:long></MediaIds>
        </AddMediaResponse></s:Body></s:Envelope>`);
    }

    // ── TikTok ──
    if (url.pathname.includes('/file/image/ad/upload/')) {
      if (failuresLeft > 0) {
        failuresLeft--;
        // TikTok hlási chybu s HTTP 200 a kódom v tele
        const code = failMode === 'throttle' ? 40100 : 40001;
        return json(200, { code, message: `chyba ${code}` });
      }
      return json(200, { code: 0, message: 'OK', data: { image_id: 'tt-img-1', image_url: 'https://cdn.tiktok/x.png' } });
    }
    if (url.pathname.includes('/file/image/ad/search/')) {
      return json(200, { code: 0, data: { list: [{ image_id: 'tt-img-1', file_name: 'DAKA.png', image_url: 'https://cdn.tiktok/x.png' }] } });
    }

    // ── Pinterest ──
    if (url.pathname === '/v5/pins' && req.method === 'POST') {
      if (failuresLeft > 0) {
        failuresLeft--;
        return json(failMode === 'throttle' ? 429 : 400, { message: 'chyba' });
      }
      return json(201, { id: 'pin-123', media: { images: { originals: { url: 'https://i.pinimg/x.png' } } } });
    }
    if (url.pathname.startsWith('/v5/boards/')) {
      return json(200, { items: [{ id: 'pin-123', title: 'DAKA', media: { images: { originals: { url: 'https://i.pinimg/x.png' } } } }] });
    }

    json(404, { message: 'nepodporované' });
  });
});

await new Promise(r => api.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${api.address().port}`;

process.env.MICROSOFT_ENDPOINT = `${base}/soap`;
process.env.MICROSOFT_TOKEN_URL = `${base}/token`;
process.env.TIKTOK_ENDPOINT = base;
process.env.PINTEREST_ENDPOINT = base;

const { MicrosoftAdsClient, mediaTypeForSize } = await import('../upload/microsoft.js');
const { TikTokAdsClient } = await import('../upload/tiktok.js');
const { PinterestClient } = await import('../upload/pinterest.js');
const { TARGETS, uploadContext } = await import('../upload.js');

const MS_CREDS = {
  clientId: 'c', clientSecret: 's', refreshToken: 'r',
  developerToken: 'dev', accountId: '111', customerId: '222',
};
const TT_CREDS = { accessToken: 'tt-token', advertiserId: '999' };
const PI_CREDS = { accessToken: 'pi-token', boardId: 'board-1' };

after(() => new Promise(r => api.close(r)));

// ── Microsoft Advertising ───────────────────────────────────────────────────

test('typ média sa vyberie podľa pomeru strán', () => {
  assert.equal(mediaTypeForSize(1080, 1080), 'Image1x1');
  assert.equal(mediaTypeForSize(728, 90), 'Image4x1');       // veľmi široký pásik
  assert.equal(mediaTypeForSize(160, 600), 'Image1x2');      // na výšku
  assert.equal(mediaTypeForSize(1200, 628), 'Image178x100'); // 1.91:1
});

test('Microsoft: SOAP obálka nesie token, developer token aj ID účtu', async () => {
  calls.length = 0;
  const client = new MicrosoftAdsClient(MS_CREDS);
  const res = await client.uploadImage({ buffer: Buffer.from('png'), name: 'DAKA_test', width: 300, height: 250 });

  assert.equal(res.mediaId, '556677');
  const soap = calls.find(c => c.path === '/soap');
  const body = soap.raw.toString();
  assert.equal(soap.headers.soapaction, 'AddMedia');
  assert.ok(body.includes('<DeveloperToken>dev</DeveloperToken>'), 'chýba developer token');
  assert.ok(body.includes('<AuthenticationToken>ms-token</AuthenticationToken>'), 'chýba prístupový token');
  assert.ok(body.includes('<CustomerAccountId>111</CustomerAccountId>'));
  assert.ok(body.includes('<CustomerId>222</CustomerId>'));
  assert.ok(body.includes(`<Data>${Buffer.from('png').toString('base64')}</Data>`), 'chýbajú dáta obrázka');
});

test('Microsoft: prekročený limit sa zopakuje, iná chyba nie', async () => {
  calls.length = 0;
  failMode = 'throttle';
  failuresLeft = 1;
  const ok = await new MicrosoftAdsClient(MS_CREDS, { retries: 2 })
    .uploadImage({ buffer: Buffer.from('x'), name: 'n', width: 300, height: 250 });
  assert.equal(ok.mediaId, '556677');

  calls.length = 0;
  failMode = 'transient';           // Fault s iným kódom = trvalá chyba
  failuresLeft = 5;
  await assert.rejects(
    () => new MicrosoftAdsClient(MS_CREDS, { retries: 3 })
      .uploadImage({ buffer: Buffer.from('x'), name: 'n', width: 300, height: 250 }),
    /Microsoft Ads 500/);
  const soapCalls = calls.filter(c => c.path === '/soap').length;
  assert.equal(soapCalls, 1, 'SOAP Fault s trvalou chybou sa nemá opakovať');
  failuresLeft = 0;
});

test('Microsoft: chýbajúce údaje zlyhajú zrozumiteľne', () => {
  assert.throws(() => new MicrosoftAdsClient({ clientId: 'x' }), /Chýbajúce údaje pre Microsoft/);
});

// ── TikTok ──────────────────────────────────────────────────────────────────

test('TikTok: obrázok ide ako multipart aj s MD5 podpisom', async () => {
  calls.length = 0;
  const buffer = Buffer.from('tiktok-png-bytes');
  const res = await new TikTokAdsClient(TT_CREDS).uploadImage({ buffer, name: 'DAKA_tt' });

  assert.equal(res.imageId, 'tt-img-1');
  const call = calls[0];
  assert.equal(call.headers['access-token'], 'tt-token');
  assert.match(call.headers['content-type'], /multipart\/form-data/);

  const body = call.raw.toString('binary');
  assert.ok(body.includes('999'), 'chýba advertiser_id');
  assert.ok(body.includes('UPLOAD_BY_FILE'), 'chýba typ nahrávania');
  assert.ok(body.includes(crypto.createHash('md5').update(buffer).digest('hex')), 'chýba MD5 podpis');
  assert.ok(body.includes('tiktok-png-bytes'), 'chýbajú dáta obrázka');
});

test('TikTok: chyba s HTTP 200 a nenulovým kódom je chybou', async () => {
  calls.length = 0;
  failMode = 'permanent';
  failuresLeft = 5;
  await assert.rejects(
    () => new TikTokAdsClient(TT_CREDS, { retries: 1 }).uploadImage({ buffer: Buffer.from('x'), name: 'n' }),
    /TikTok API 200\/40001/);
  failuresLeft = 0;
});

test('TikTok: kód limitu sa zopakuje', async () => {
  calls.length = 0;
  failMode = 'throttle';
  failuresLeft = 1;
  const res = await new TikTokAdsClient(TT_CREDS, { retries: 2 }).uploadImage({ buffer: Buffer.from('x'), name: 'n' });
  assert.equal(res.imageId, 'tt-img-1');
  assert.equal(calls.length, 2);
});

test('TikTok: zoznam obrázkov v účte', async () => {
  const list = await new TikTokAdsClient(TT_CREDS).listImages({ limit: 5 });
  assert.deepEqual(list, [{ imageId: 'tt-img-1', name: 'DAKA.png', url: 'https://cdn.tiktok/x.png' }]);
});

// ── Pinterest ───────────────────────────────────────────────────────────────

test('Pinterest: banner sa vytvorí ako pin na nástenke', async () => {
  calls.length = 0;
  const buffer = Buffer.from('pin-png');
  const res = await new PinterestClient(PI_CREDS).uploadImage({
    buffer, name: 'DAKA_pin', title: 'Slnečné pobrežie', link: 'https://www.ckdaka.sk/z/1',
  });

  assert.equal(res.pinId, 'pin-123');
  const call = calls[0];
  assert.equal(call.headers.authorization, 'Bearer pi-token');
  const body = JSON.parse(call.raw.toString());
  assert.equal(body.board_id, 'board-1');
  assert.equal(body.title, 'Slnečné pobrežie');
  assert.equal(body.link, 'https://www.ckdaka.sk/z/1');
  assert.equal(body.media_source.source_type, 'image_base64');
  assert.equal(Buffer.from(body.media_source.data, 'base64').toString(), 'pin-png');
});

test('Pinterest: dlhý názov sa oreže na povolenú dĺžku', async () => {
  calls.length = 0;
  await new PinterestClient(PI_CREDS).uploadImage({
    buffer: Buffer.from('x'), name: 'n', title: 'A'.repeat(300),
  });
  const body = JSON.parse(calls[0].raw.toString());
  assert.equal(body.title.length, 100);
});

test('Pinterest: 429 sa zopakuje, 400 nie', async () => {
  calls.length = 0;
  failMode = 'throttle';
  failuresLeft = 1;
  const ok = await new PinterestClient(PI_CREDS, { retries: 2 }).uploadImage({ buffer: Buffer.from('x'), name: 'n' });
  assert.equal(ok.pinId, 'pin-123');

  calls.length = 0;
  failMode = 'permanent';
  failuresLeft = 5;
  await assert.rejects(
    () => new PinterestClient(PI_CREDS, { retries: 3 }).uploadImage({ buffer: Buffer.from('x'), name: 'n' }),
    /Pinterest API 400/);
  assert.equal(calls.length, 1, 'chyba 400 sa nemá opakovať');
  failuresLeft = 0;
});

// ── Spoločné rozhranie ──────────────────────────────────────────────────────

test('všetkých päť cieľov je registrovaných a má rovnaké rozhranie', () => {
  assert.deepEqual(Object.keys(TARGETS), ['google-ads', 'meta', 'microsoft', 'tiktok', 'pinterest']);
  for (const [key, t] of Object.entries(TARGETS)) {
    for (const fn of ['create', 'upload', 'list', 'describe']) {
      assert.equal(typeof t[fn], 'function', `${key}: chýba ${fn}`);
    }
    assert.equal(typeof t.label, 'string', `${key}: chýba label`);
  }
});

test('kontext podkladu nesie rozmery aj odkaz pre platformy, ktoré ich potrebujú', () => {
  const item = {
    tour: { id: 'D1', name: 'Zájazd do Turecka', dest: 'Turecko', url: 'https://www.ckdaka.sk/z/D1' },
    w: 1080, h: 1920, style: 'dark', name: 'DAKA_D1_min_1080x1920_dark',
  };
  const ctx = uploadContext(item, Buffer.from('x'));
  assert.equal(ctx.width, 1080);
  assert.equal(ctx.height, 1920);
  assert.equal(ctx.title, 'Zájazd do Turecka');
  assert.equal(ctx.link, 'https://www.ckdaka.sk/z/D1');
  assert.match(ctx.description, /Turecko/);
});

test('nové ciele vrátia identifikátor podkladu', async () => {
  const ctx = { buffer: Buffer.from('x'), name: 'n', width: 300, height: 250, title: 't' };
  assert.equal((await TARGETS['microsoft'].upload(new MicrosoftAdsClient(MS_CREDS), ctx)).ref, '556677');
  assert.equal((await TARGETS['tiktok'].upload(new TikTokAdsClient(TT_CREDS), ctx)).ref, 'tt-img-1');
  assert.equal((await TARGETS['pinterest'].upload(new PinterestClient(PI_CREDS), ctx)).ref, 'pin-123');
});
