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
const SURUM = 'nefes-v25';
// Sürüm notu: worker bu satırı okuyup abonelere "Nefes güncellendi" bildirimi
// gönderiyor. Her güncellemede SURUM'u artır ve buraya kısa bir not yaz.
const NOT = 'Destek mesajları karıştırıldı, sevgi mesajları artık listenin üst sıralarında.';

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

  // Sayfanın kendisi (index.html): önce ağ. Güncelleme bildirimine dokunup
  // açınca yeni sürüm hemen gelsin. 4 saniyede cevap yoksa ya da internet
  // yoksa önbellekteki sürüm açılır.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(SURUM);
      const net = fetch(req).then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res; });
      const res = await Promise.race([net.catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))]);
      if (res && res.ok) return res;
      const cached = (await cache.match(req, { ignoreSearch: true })) || (await cache.match('./index.html')) || (await cache.match('./'));
      if (cached) return cached;
      return net.catch(() => new Response('Çevrimdışısın ve uygulama henüz cihazına inmemiş.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
    })());
    return;
  }

  // Diğer dosyalar (ikonlar, manifest): stale-while-revalidate
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

// ---------------------------------------------------------------------
// Bildirimler: worker'dan gelen push burada gösterilir. Gövde iOS 18.4+
// "declarative web push" biçiminde ({web_push:8030, notification:{...}}),
// eski biçim ({title, body}) de kabul edilir. iOS her push'ta görünür bir
// bildirim ister. Göstermezsek birkaç kez sonra aboneliği iptal eder.
self.addEventListener('push', (event) => {
  // iOS 18.4+ "mutable" declarative mesaj: tarayıcı bildirimi zaten hazırlamış (event.notification).
  // Biz sadece simgedeki sayıyı ayarlıyoruz. Bildirim göstermezsek tarayıcı kendisininkini gösterir,
  // bunun bir cezası yok. data bu yolda null gelir.
  if (event.notification) {
    const nd = event.notification.data || {};
    if (typeof nd.badge === 'number' && self.navigator && self.navigator.setAppBadge) {
      event.waitUntil((nd.badge > 0 ? self.navigator.setAppBadge(nd.badge) : self.navigator.clearAppBadge()).catch(() => {}));
    }
    return;
  }
  let d = {};
  try { d = event.data ? event.data.json() : {}; }
  catch (e) { d = { title: 'Nefes', body: event.data ? event.data.text() : '' }; }
  const n = d.notification || d;
  const jobs = [self.registration.showNotification(n.title || 'Nefes', {
    body: n.body || '',
    icon: './icons/icon-192.png',
    badge: './icons/icon-96.png',
    tag: n.tag || d.tag || undefined,
    data: { url: n.navigate || './', badge: typeof d.nefes_badge === 'number' ? d.nefes_badge : undefined },
  })];
  // simgedeki gün sayısı (uygulama kapalıyken de güncellensin)
  if (typeof d.nefes_badge === 'number' && self.navigator && self.navigator.setAppBadge) {
    jobs.push((d.nefes_badge > 0 ? self.navigator.setAppBadge(d.nefes_badge) : self.navigator.clearAppBadge()).catch(() => {}));
  }
  event.waitUntil(Promise.all(jobs));
});

// Sayfa, telefondaki service worker sürümünü sorar. Sunucu yeni bildirim biçimini
// sadece bunu anlayan sürüme gönderir.
self.addEventListener('message', (event) => {
  if (event.data && event.data.q === 'ver' && event.ports && event.ports[0]) event.ports[0].postMessage(SURUM);
});

// Bildirime dokununca: açık uygulama varsa öne getir, yoksa aç
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const n = event.notification;
  const url = (n.data && n.data.url) || n.navigate || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const hash = url.indexOf('#') >= 0 ? url.slice(url.indexOf('#') + 1) : '';
      for (const c of list) {
        if ('focus' in c) { if (hash) c.postMessage({ go: hash }); return c.focus(); }
      }
      return self.clients.openWindow(url);
    })
  );
});
