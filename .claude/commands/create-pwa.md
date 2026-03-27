---
description: Scaffold a new PWA in this Jekyll site — creates the HTML page, service worker, manifest, icons, and wires everything up
argument-hint: [app-name]
---

You are scaffolding a new Progressive Web App for this Jekyll portfolio site (jorgecensi.github.io). The site already has three PWAs (Binary Puzzle, CrossFit Timer, Flappy Bird) that follow a consistent pattern. You will gather requirements, generate icons, and create/update all the necessary files.

## Step 1 — Gather Requirements

Ask these questions **one at a time**, waiting for the user's answer before asking the next. Skip any that were already provided via `$ARGUMENTS`.

1. **App name** — the full display name (e.g. "Snake Game")
2. **Short name** — shown on the home screen icon (e.g. "Snake", max ~12 chars)
3. **Slug** — the URL path segment (e.g. `snake` → `/snake/`). All generated files use this prefix: `snake.html`, `snake-sw.js`, `snake-manifest.json`
4. **Description** — one sentence describing what the app does (used in the manifest and the apps page card)
5. **Theme color** — hex color for the browser chrome and icon background (default: `#6366f1` — the site's indigo)
6. **Category** — one of: `games`, `productivity`, `utilities`, `entertainment`, `sports`, or another appropriate value
7. **Emoji** — a single emoji for the apps page card (e.g. 🐍)
8. **App content** — describe what the app does so you can scaffold meaningful HTML/JS (e.g. "a snake game using canvas", "a Pomodoro timer", "a markdown previewer"). You will generate a working or well-stubbed implementation.

After collecting all answers, confirm the summary with the user before writing any files.

---

## Step 2 — Generate Icons

Use the Bash tool to run a temporary Python script that generates two PNG icon files using **Pillow**. The icons are a rounded square in the theme color with the first two characters of the short name (uppercased) centered in white.

Write this script to `/tmp/gen_icons.py` and run it:

```python
import sys
import math

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("PILLOW_MISSING")
    sys.exit(0)

import os

slug = sys.argv[1]
color_hex = sys.argv[2].lstrip('#')
label = sys.argv[3][:2].upper()
out_dir = sys.argv[4]

r = int(color_hex[0:2], 16)
g = int(color_hex[2:4], 16)
b = int(color_hex[4:6], 16)
bg = (r, g, b, 255)

def make_icon(size, path, label, bg):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    radius = size // 5
    draw.rounded_rectangle([(0, 0), (size - 1, size - 1)], radius=radius, fill=bg)
    font_size = size // 3
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", font_size)
    except Exception:
        try:
            font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", font_size)
        except Exception:
            font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), label, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    x = (size - tw) / 2 - bbox[0]
    y = (size - th) / 2 - bbox[1]
    draw.text((x, y), label, fill=(255, 255, 255, 255), font=font)
    img.convert("RGB").save(path, "PNG")
    print(f"Created {path}")

make_icon(192, os.path.join(out_dir, f"{slug}-icon-192.png"), label, bg)
make_icon(512, os.path.join(out_dir, f"{slug}-icon-512.png"), label, bg)
```

Run it with:
```
python /tmp/gen_icons.py <slug> <theme_color> <short_name> <repo_root>/img
```

**If Pillow is missing** (script prints `PILLOW_MISSING`): attempt `pip install Pillow --quiet` and retry. If it still fails, create an SVG icon instead:

```xml
<!-- img/<slug>-icon.svg -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192">
  <rect width="192" height="192" rx="38" fill="<theme_color>"/>
  <text x="96" y="120" font-family="Arial,sans-serif" font-size="80" font-weight="bold"
        text-anchor="middle" fill="white"><first-two-chars-of-short-name></text>
</svg>
```

And update the manifest icons to reference the SVG with `"type": "image/svg+xml"`.

---

## Step 3 — Create Files

Replace `<slug>`, `<name>`, `<short_name>`, `<description>`, `<theme_color>`, `<category>`, `<emoji>` with the collected values throughout.

### `<slug>-manifest.json`

```json
{
  "id": "/<slug>/",
  "name": "<name>",
  "short_name": "<short_name>",
  "description": "<description>",
  "start_url": "/<slug>/",
  "scope": "/<slug>/",
  "display": "standalone",
  "background_color": "<theme_color>",
  "theme_color": "<theme_color>",
  "orientation": "portrait-primary",
  "icons": [
    {
      "src": "/img/<slug>-icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/img/<slug>-icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ],
  "categories": ["<category>"],
  "lang": "en-US",
  "screenshots": [],
  "related_applications": [],
  "prefer_related_applications": false
}
```

### `<slug>-sw.js`

```javascript
const CACHE_VERSION = 'dev';
const CACHE_NAME = `<slug>-${CACHE_VERSION}`;
const OFFLINE_URL = '/<slug>/';
const PRECACHE_URLS = [
  '/<slug>/',
  '/<slug>-manifest.json',
  '/img/<slug>-icon-192.png',
  '/img/<slug>-icon-512.png',
  '/img/favicon.ico'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName.startsWith('<slug>-')) {
            return caches.delete(cacheName);
          }
          return Promise.resolve();
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(event.request.url);
  const isNavigationRequest = event.request.mode === 'navigate';
  const isSameOrigin = requestUrl.origin === self.location.origin;

  if (isNavigationRequest) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          return networkResponse;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match(OFFLINE_URL)))
    );
    return;
  }

  if (isSameOrigin) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        const networkFetch = fetch(event.request)
          .then((networkResponse) => {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
            return networkResponse;
          })
          .catch(() => cachedResponse);

        return cachedResponse || networkFetch;
      })
    );
  }
});
```

### `<slug>.html`

This is a **standalone** HTML file (not using Jekyll layouts) that is self-contained, similar to `flappy.html`. Include the service worker registration script and implement the app content described by the user. Structure:

```html
---
permalink: /<slug>/
---
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
    <meta name="theme-color" content="<theme_color>">
    <meta name="description" content="<description>">

    <title><name></title>

    <!-- PWA Manifest -->
    <link rel="manifest" href="/<slug>-manifest.json">

    <!-- iOS specific -->
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="<short_name>">
    <link rel="apple-touch-icon" href="/img/<slug>-icon-192.png">

    <!-- Favicon -->
    <link rel="icon" href="/img/favicon.ico" type="image/x-icon">

    <style>
        /* App styles here */
    </style>
</head>

<body>
    <!-- App HTML here -->

    <script>
        const SW_VERSION = 'dev';

        if ('serviceWorker' in navigator) {
            let hasRefreshedForUpdate = false;

            const askToUpdate = (registration) => {
                const shouldUpdate = window.confirm('A new <name> update is ready. Update now?');
                if (shouldUpdate && registration.waiting) {
                    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
                }
            };

            navigator.serviceWorker.register('/<slug>-sw.js?v=' + SW_VERSION)
                .then((registration) => {
                    registration.addEventListener('updatefound', () => {
                        const newWorker = registration.installing;
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                if (!hasRefreshedForUpdate) {
                                    hasRefreshedForUpdate = true;
                                    askToUpdate(registration);
                                }
                            }
                        });
                    });
                });

            navigator.serviceWorker.addEventListener('controllerchange', () => {
                window.location.reload();
            });
        }

        // App JavaScript here
    </script>
</body>

</html>
```

Implement the actual app logic (game, tool, etc.) based on the user's description from Step 1. Make it functional — don't leave placeholder comments without code.

---

## Step 4 — Update Existing Files

### `_layouts/default.html`

Find the block:
```
{% if page.ref == "binary" %}
```

Add an `{% elsif %}` branch **before** the `{% endif %}` for the new PWA:

```liquid
{% elsif page.ref == "<slug>" %}
    <meta name="theme-color" content="<theme_color>">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="<short_name>">
    <link rel="apple-touch-icon" href="/img/<slug>-icon-192.png">
    <link rel="manifest" href="/<slug>-manifest.json">
```

**Note:** Only add this block if `<slug>.html` uses the default Jekyll layout (i.e., has a `layout: default` or `layout: wrapper` in the front matter). If the HTML page is fully standalone (like `flappy.html`), skip this step since the manifest is already linked directly in the page's `<head>`.

### `apps.html`

Append a new card inside the `.apps-grid` div, following the same pattern as the existing cards:

```html
    <a class="app-card" href="/<slug>/">
        <span class="app-icon"><emoji></span>
        <h3><name></h3>
        <p><description></p>
        <span class="app-tag"><category></span>
    </a>
```

### `.github/workflows/bump-pwa-cache-version.yml`

In the `files_and_patterns` dict inside the Python block, add:

```python
"<slug>-sw.js": r"const CACHE_VERSION = '[^']*';",
"<slug>.html": r"const SW_VERSION = '[^']*';",
```

In the `git add` command at the end, add `<slug>-sw.js` and `<slug>.html` to the list.

---

## Step 5 — Verify

After all files are created:

1. Run `bundle exec jekyll build` and confirm there are no errors.
2. Report all files created/modified to the user with a checklist.
3. Remind the user to:
   - Start the dev server: `bundle exec jekyll serve --port 4001`
   - Visit `http://localhost:4001/<slug>/` to test the app
   - Check DevTools → Application → Manifest and Service Workers
   - Visit `http://localhost:4001/apps/` to see the new card
