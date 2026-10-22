/*
 * Nefes — Service Worker
 * ------------------------
 * Amaç: uygulama kabuğu (HTML/CSS/JS/ikonlar) internet olmadan da açılsın.
 * İnternet sadece iki yerde gerçekten kullanılır:
 *   1) Bu dosyanın kendisini güncellemek (yeni sürüm yayınladığında)
 *   2) Cloudflare Worker'dan fiyat/faiz/enflasyon çekmek (uygulamanın
 *      kendi zamanlama mantığı bunu yönetiyor, burada DOKUNMUYORUZ)
 *
 * Strateji: "stale-while-revalidate" — önce cihazdaki (önbellekteki)
 * sürümü anında göster, arka planda internet varsa yenisini indir ve
 * bir sonraki açılış için sakla. Böylece uygulama hem çevrimdışı hızlı
 * açılır hem de internet olduğunda kendini günceller.
 *
 * SÜRÜM NUMARASI: nefes.html'i her güncellediğinde bu sayıyı artır.
 * Artırmazsan telefonlar eski sürümü göstermeye devam edebilir.
 */
const SURUM = 'nefes-v8';

const KABUK = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-48.png',
  './icons/icon-72.png',
  './icons/icon-96.png',
  './icons/icon-144.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    // Dosyaları tek tek önbelleğe al. addAll tek bir eksik dosyada (ör. ikon
    // henüz yüklenmemişse) tüm kurulumu düşürüyordu. Böylece eksik ikon
    // yüzünden uygulama çevrimdışı çalışmaz hale gelmez.
    caches.open(SURUM)
      .then((cache) => Promise.allSettled(KABUK.map((u) => cache.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SURUM).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // POST vb. asla önbelleklenmez

  const url = new URL(req.url);

  // Worker'a giden veri istekleri (Cloudflare) HİÇ önbelleklenmez — fiyat/
  // faiz/enflasyon her zaman gerçek zamanlı olmalı, internet yoksa da
  // uygulamanın kendi hata mesajı devreye girsin, eski/yanlış veri asla
  // sessizce gösterilmesin.
  if (!url.origin.includes(self.location.origin)) {
    event.respondWith(fetch(req).catch(() => new Response(null, { status: 503 })));
    return;
  }

  // Uygulama kabuğu: stale-while-revalidate
  event.respondWith(
    caches.open(SURUM).then(async (cache) => {
      const onbellekteki = await cache.match(req, { ignoreSearch: true });
      const agdan = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);

      // Önbellekte varsa anında onu dön, ağ isteği arka planda devam etsin.
      if (onbellekteki) return onbellekteki;

      // Önbellekte yoksa ağı bekle; o da yoksa (ilk açılış + internetsizsen)
      // navigasyon isteklerinde ana sayfaya düş.
      const agSonuc = await agdan;
      if (agSonuc) return agSonuc;
      if (req.mode === 'navigate') {
        const yedek = await cache.match('./index.html');
        if (yedek) return yedek;
      }
      return new Response('Çevrimdışısın ve bu içerik henüz cihazına inmemiş.', { status: 503 });
    })
  );
});
