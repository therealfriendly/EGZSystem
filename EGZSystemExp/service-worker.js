self.addEventListener("install", e => {
  e.waitUntil(
    caches.open("egz-v2").then(cache =>
      cache.addAll([
        "./",
        "./index.html",
        "./style.css",
        "./script.js",
        "./manifest.json",
        "./blitz-512x512.png"
      ])
    )
  );
});
