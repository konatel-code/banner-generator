/**
 * Štartovací súbor pre Plesk (Phusion Passenger).
 *
 * Passenger načíta tento súbor cez require(), preto je zámerne v CommonJS –
 * zvyšok služby sú ES moduly a tie sa natiahnu dynamickým importom. Passenger
 * odovzdáva port cez PORT; treba naň počúvať, inak požiadavky nedorazia.
 *
 * V Plesku nastav:
 *   Application Root         → …/server
 *   Application Startup File → app.cjs
 */
'use strict';

// Cache patrí mimo webového priestoru; ak ju neurčí administrátor, drž ju
// vedľa aplikácie a nie tam, odkiaľ sa servírujú súbory.
process.env.CACHE_DIR = process.env.CACHE_DIR || require('path').join(__dirname, '.cache');

import('./index.js')
  .then(({ startServer }) => {
    // Passenger počúva na svojom porte; HOST necháme na localhost,
    // navonok ho vystaví web server Plesku.
    startServer({
      port: process.env.PORT || 3457,
      host: process.env.HOST || '127.0.0.1',
    });
  })
  .catch((err) => {
    console.error('[server] štart zlyhal:', err && err.stack ? err.stack : err);
    process.exit(1);
  });
