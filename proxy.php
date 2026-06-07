<?php
/**
 * CK DAKA Banner Generator – PHP Proxy
 * Slúži na obchádzanie CORS obmedzení pri načítaní obrázkov a XML feedov.
 * Uploadnite tento súbor vedľa index.html na FTP server.
 */

// Povolené zdroje (bezpečnostný whitelist)
$allowed_hosts = [
    'ckdaka.sk',
    'www.ckdaka.sk',
    'cdn.ckdaka.sk',
    'reisesysteme.de',
    'www.reisesysteme.de',
    'invia.sk',
    'www.invia.sk',
];

$target_url = isset($_GET['url']) ? trim($_GET['url']) : '';

if (empty($target_url)) {
    http_response_code(400);
    exit('Missing url parameter');
}

// Validate URL
if (!filter_var($target_url, FILTER_VALIDATE_URL)) {
    http_response_code(400);
    exit('Invalid URL');
}

// Bezpečnostná kontrola – len povolené domény (vypnite whitelist ak potrebujete všetky zdroje)
$parsed = parse_url($target_url);
$host   = strtolower($parsed['host'] ?? '');
$host_ok = false;
foreach ($allowed_hosts as $ah) {
    if ($host === $ah || str_ends_with($host, '.' . $ah)) {
        $host_ok = true; break;
    }
}
// Odkomentujte nasledujúci blok ak chcete striktný whitelist:
// if (!$host_ok) { http_response_code(403); exit('Host not allowed: ' . $host); }

// Fetch cez cURL
$ch = curl_init($target_url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS      => 5,
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_SSL_VERIFYPEER => false,   // vypnuté kvôli self-signed certifikátom
    CURLOPT_SSL_VERIFYHOST => false,
    CURLOPT_USERAGENT      => 'Mozilla/5.0 (CK DAKA Banner Generator)',
    CURLOPT_HTTPHEADER     => ['Accept: */*'],
]);

$body        = curl_exec($ch);
$http_code   = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$content_type = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
$curl_error  = curl_error($ch);
curl_close($ch);

if ($curl_error) {
    http_response_code(502);
    exit('Proxy error: ' . $curl_error);
}
if ($body === false || $http_code >= 400) {
    http_response_code($http_code ?: 502);
    exit('Upstream error: HTTP ' . $http_code);
}

// CORS hlavičky
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET');
header('Cache-Control: public, max-age=300');
if ($content_type) {
    header('Content-Type: ' . $content_type);
}

echo $body;
