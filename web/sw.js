/**
 * みんなでガチャメーカー Service Worker
 *
 * 目的: 画面(HTML/CSS/JS)と画像素材をキャッシュし、
 *   - 2回目以降の起動を速くする
 *   - 電波が悪い瞬間でもアプリの見た目自体は表示できるようにする
 * ※ このアプリはリアルタイム通信が前提なので、ガチャの作成・参加・候補投稿などの
 *   実際の操作はオフラインでは動作しません(仕様通り)。あくまで「アプリの外側」を
 *   キャッシュするだけです。
 *
 * キャッシュのバージョンを上げる(CACHE_NAMEの日付を変える)と、
 * 古いキャッシュは自動的に破棄されて新しいファイルに置き換わります。
 * 見た目やロジックを更新したら、このバージョン文字列を変更してください。
 */
const CACHE_NAME = "gachamaker-shell-v3";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./assets/icon.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/icon-maskable-512.png",
  "./assets/apple-touch-icon.png",
  "./assets/splash.png",
  "./assets/mascot_full.png",
  "./assets/mascot_empty.png",
  "./assets/handle.png",
  "./assets/ogp.png",
  "./assets/capsule_pink.png",
  "./assets/capsule_yellow.png",
  "./assets/capsule_mint.png",
  "./assets/capsule_purple.png",
  "./assets/capsule_sky.png",
  "./assets/confetti_star.png",
  "./assets/confetti_ribbon.png",
  "./assets/confetti_popper.png",
  "./assets/confetti_burst.png",
  "./assets/confetti_flag.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Supabase(Edge Functions / Realtime)への通信はキャッシュ対象外。
  // 常にネットワークへ直接流し、オフライン時に古いデータで誤動作しないようにする。
  if (req.url.includes("supabase.co")) {
    return;
  }
  // GET以外(POSTなど)もキャッシュ対象外
  if (req.method !== "GET") {
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // 同一オリジンの取得成功レスポンスのみキャッシュに追加
          if (res.ok && new URL(req.url).origin === self.location.origin) {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});
