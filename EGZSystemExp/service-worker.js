self.addEventListener("install", e => {
  e.waitUntil(
    caches.open("egz").then(c =>
      c.addAll([
        "./",
        "./index.html",
        "./style.css",
        "./script.js"
      ])
    )
  );
});
