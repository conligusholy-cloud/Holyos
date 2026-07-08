/* COMPOUNDER service worker — push notifications + PWA install.
   Záměrně NEcachuje a NEzasahuje do síťových requestů (portál je online-only);
   dřívější offline caching způsoboval chyby "Failed to convert value to 'Response'"
   a zasekával načtení. Vše (navigace, statika, API) řeší prohlížeč nativně. */
var CACHE = "compounder-v4";

self.addEventListener("install", function(e){
  self.skipWaiting();
});

self.addEventListener("activate", function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

/* Žádný fetch handler → prohlížeč řeší všechny requesty sám (network),
   žádné respondWith, žádné cache.put → žádné pády SW. */

/* ---- Push notifications (server sends VAPID push; reaction tracked via notificationclick) ---- */
self.addEventListener("push", function(e){
  var data = {};
  try{ data = e.data ? e.data.json() : {}; }catch(_){ data = { title:"Compounder", body: e.data && e.data.text() }; }
  var title = data.title || "Compounder";
  var opts = {
    body: data.body || "",
    icon: "./assets/icon-192.png",
    badge: "./assets/icon-192.png",
    data: { url: data.url || "./", id: data.id || null },
    actions: data.actions || [],
    tag: data.tag || "compounder",
    renotify: true
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener("notificationclick", function(e){
  e.notification.close();
  var d = e.notification.data || {};
  var url = d.url || "./";
  var beacon = fetch("/api/compounder/push-reaction", {
    method:"POST", headers:{"Content-Type":"application/json"}, keepalive:true,
    body: JSON.stringify({ id:d.id||null, action:e.action||"open", ts:Date.now() })
  }).catch(function(){});
  e.waitUntil(Promise.all([beacon, self.clients.matchAll({type:"window", includeUncontrolled:true}).then(function(list){
    for (var i=0;i<list.length;i++){ if ("focus" in list[i]) return list[i].focus(); }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })]));
});

self.addEventListener("notificationclose", function(e){
  var d = e.notification.data || {};
  fetch("/api/compounder/push-reaction", {
    method:"POST", headers:{"Content-Type":"application/json"}, keepalive:true,
    body: JSON.stringify({ id:d.id||null, action:"dismiss", ts:Date.now() })
  }).catch(function(){});
});
