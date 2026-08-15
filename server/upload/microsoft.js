/**
 * Klient Microsoft Advertising (Bing Ads) – nahrávanie obrázkov do účtu.
 *
 * Microsoft ako jediná z platforiem používa SOAP, nie REST: požiadavka je
 * XML obálka s hlavičkou (token, developer token, ID účtu) a telom AddMedia.
 * Odpoveď obsahuje ID nahratých médií.
 *
 * Chyba príde ako HTTP 500 so SOAP Fault – to nie je výpadok servera, preto
 * sa opakuje len vtedy, keď je vo faulte kód prekročeného limitu volaní.
 */
import { DOMParser } from '@xmldom/xmldom';
import { getAccessToken, MICROSOFT_TOKEN_URL } from './oauth.js';

const ENDPOINT = process.env.MICROSOFT_ENDPOINT
  || 'https://campaign.api.bingads.microsoft.com/Api/Advertiser/CampaignManagement/v13/CampaignManagementService.svc';
const NS = 'https://bingads.microsoft.com/CampaignManagement/v13';
const SCOPE = process.env.MICROSOFT_SCOPE || 'https://ads.microsoft.com/msads.manage offline_access';

// Kód, ktorým Microsoft hlási prekročenú frekvenciu volaní
const RATE_LIMIT_CODES = new Set(['117']);

/**
 * Pomer strán → typ média podľa číselníka Microsoftu. Presné rozmery
 * bannerov sa na typy nemapujú jedna k jednej, preto vyberáme najbližší
 * pomer; natvrdo sa dá určiť cez MICROSOFT_MEDIA_TYPE.
 */
const MEDIA_TYPES = [
  { type: 'Image1x1',   ratio: 1 },
  { type: 'Image15x10', ratio: 1.5 },
  { type: 'Image16x9',  ratio: 16 / 9 },
  { type: 'Image178x100', ratio: 1.78 },
  { type: 'Image133x100', ratio: 1.33 },
  { type: 'Image4x1',   ratio: 4 },
  { type: 'Image1x2',   ratio: 0.5 },
];

export function mediaTypeForSize(w, h) {
  if (process.env.MICROSOFT_MEDIA_TYPE) return process.env.MICROSOFT_MEDIA_TYPE;
  const ratio = w / h;
  let best = MEDIA_TYPES[0], bestDiff = Infinity;
  for (const m of MEDIA_TYPES) {
    const diff = Math.abs(Math.log(ratio / m.ratio));   // pomer porovnávame logaritmicky
    if (diff < bestDiff) { bestDiff = diff; best = m; }
  }
  return best.type;
}

export function microsoftCredentialsFromEnv() {
  return {
    clientId: process.env.MICROSOFT_CLIENT_ID,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
    refreshToken: process.env.MICROSOFT_REFRESH_TOKEN,
    developerToken: process.env.MICROSOFT_DEVELOPER_TOKEN,
    accountId: String(process.env.MICROSOFT_ACCOUNT_ID || '').trim(),
    customerId: String(process.env.MICROSOFT_CUSTOMER_ID || '').trim(),
  };
}

const xmlEsc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Nájde v dokumente všetky elementy s daným lokálnym menom (bez ohľadu na prefix). */
function byLocalName(doc, name) {
  return Array.from(doc.getElementsByTagName('*') || [])
    .filter(el => (el.localName || el.nodeName.split(':').pop()) === name);
}

export class MicrosoftAdsClient {
  constructor(creds, opts = {}) {
    const missing = ['clientId','clientSecret','refreshToken','developerToken','accountId','customerId']
      .filter(k => !creds[k]);
    if (missing.length) throw new Error(`Chýbajúce údaje pre Microsoft Advertising: ${missing.join(', ')}`);
    this.creds = creds;
    this.retries = opts.retries ?? 3;
  }

  token() {
    return getAccessToken({ ...this.creds, tokenUrl: MICROSOFT_TOKEN_URL, scope: SCOPE });
  }

  envelope(action, bodyXml, token) {
    return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Header xmlns="${NS}">
    <Action mustUnderstand="1">${action}</Action>
    <AuthenticationToken>${xmlEsc(token)}</AuthenticationToken>
    <CustomerAccountId>${xmlEsc(this.creds.accountId)}</CustomerAccountId>
    <CustomerId>${xmlEsc(this.creds.customerId)}</CustomerId>
    <DeveloperToken>${xmlEsc(this.creds.developerToken)}</DeveloperToken>
  </s:Header>
  <s:Body>${bodyXml}</s:Body>
</s:Envelope>`;
  }

  async call(action, bodyXml) {
    let lastErr;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt) await new Promise(r => setTimeout(r, 1000 * 2 ** (attempt - 1)));

      try {
        const token = await this.token();
        const res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': action },
          body: this.envelope(action, bodyXml, token),
          signal: AbortSignal.timeout(60_000),
        });

        const text = await res.text();
        const doc = new DOMParser({ onError: () => {} }).parseFromString(text, 'text/xml');

        // SOAP Fault chodí s HTTP 500 – rozlíšime prekročený limit od skutočnej chyby
        const fault = byLocalName(doc, 'Fault')[0];
        if (fault || !res.ok) {
          const codes = byLocalName(doc, 'Code').map(e => e.textContent?.trim());
          const message = byLocalName(doc, 'Message')[0]?.textContent
            || byLocalName(doc, 'faultstring')[0]?.textContent
            || text.slice(0, 400);
          const err = new Error(`Microsoft Ads ${res.status}: ${message}`);
          err.status = res.status;
          err.codes = codes;

          const throttled = codes.some(c => RATE_LIMIT_CODES.has(c));
          const transient = !fault && res.status >= 500;
          if ((throttled || transient || res.status === 429) && attempt < this.retries) {
            lastErr = err; continue;
          }
          throw err;
        }
        return doc;
      } catch (err) {
        if (!err.status && attempt < this.retries) { lastErr = err; continue; }
        throw err;
      }
    }
    throw lastErr;
  }

  /**
   * Nahrá obrázok do knižnice médií účtu.
   * @returns {Promise<{mediaId:string}>}
   */
  async uploadImage({ buffer, name, width, height }) {
    const mediaType = mediaTypeForSize(width || 1, height || 1);
    const body = `<AddMediaRequest xmlns="${NS}">
      <AccountId>${xmlEsc(this.creds.accountId)}</AccountId>
      <Media xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
        <Media i:type="Image">
          <Type>Image</Type>
          <Text>${xmlEsc(name)}</Text>
          <MediaType>${xmlEsc(mediaType)}</MediaType>
          <Data>${buffer.toString('base64')}</Data>
        </Media>
      </Media>
    </AddMediaRequest>`;

    const doc = await this.call('AddMedia', body);
    const ids = byLocalName(doc, 'long').map(e => e.textContent?.trim()).filter(Boolean);
    if (!ids.length) {
      throw new Error('Odpoveď Microsoftu neobsahuje ID média');
    }
    return { mediaId: ids[0], mediaType };
  }

  /**
   * Médiá v účte. Microsoft ich vracia po dávkach podľa ID, takže bez
   * zoznamu ID vrátime prázdno – slúži hlavne na kontrolu spojenia.
   */
  async listImages() {
    return [];
  }
}
