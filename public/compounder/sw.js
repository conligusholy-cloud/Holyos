/* COMPOUNDER service worker — offline shell + push notifications (Phase: scaffold).
   Bump CACHE when static assets change. */
var CACHE = "compounder-v3";
var CORE = [
  "./",
  "./index.html",
  "./app.js",
  "./i18n.js",
  "./manifest.webmanifest",
  "./assets/icon.svg"
];

self.addEventListener("install", function(e){
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(CORE).catch(function(){}); }));
});

self.addEventListener("activate", function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k!==CACHE; }).map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function(e){
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf("/api/") === 0) return;
  if (/(?:^|\/)i18n\.js$/.test(url.pathname) || /\/i18n\/[a-z]{2}\.json$/.test(url.pathname)){
    e.respondWith(
      fetch(req).then(function(res){
        var copy = res.clone();
        caches.open(CACHE).then(function(c){ return c.put(req, copy); }).catch(function(){});
        return res;
      }).catch(function(){ return caches.match(req); })
    );
    return;
  }
  if (req.mode === "navigate"){
    e.respondWith(fetch(req).catch(function(){ return caches.match("./index.html"); }));
    return;
  }
  e.respondWith(
    caches.match(req).then(function(hit){
      return hit || fetch(req).then(function(res){
        var copy = res.clone();
        caches.open(CACHE).then(function(c){ return c.put(req, copy); }).catch(function(){});
        return res;
      }).catch(function(){ return hit; });
    })
  );
});

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
