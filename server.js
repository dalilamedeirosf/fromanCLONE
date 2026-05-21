const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const PUBLIC_DIR = path.join(__dirname, 'www.fromanother.love');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.m3u8': 'application/x-mpegURL',
  '.ts': 'video/MP2T',
  '.m4s': 'video/iso.segment',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

const knownDomains = [
  'chunk-oci-us-ashburn-1-vop1.fastly.mux.com',
  'fromanother-2026.prismic.io',
  'image.mux.com',
  'images.prismic.io',
  'manifest-oci-us-ashburn-1-vop1.fastly.mux.com',
  'snap.licdn.com',
  'static.cdn.prismic.io',
  'stream.mux.com'
];

const ASSET_DIRS = ['/_next/', '/images/', '/fonts/', '/icons/', '/videos/', '/logos/', '/static/'];

// Returns true if this URL is a static asset (not a page route)
function isAssetUrl(urlPath) {
  const ext = path.extname(urlPath.split('?')[0]);
  if (ext) return true;
  if (urlPath === '/favicon.ico') return true;
  for (const dir of ASSET_DIRS) {
    if (urlPath.startsWith(dir)) return true;
  }
  for (const d of knownDomains) {
    if (urlPath.startsWith('/' + d)) return true;
  }
  return false;
}

// Returns true if this is a Next.js RSC prefetch request
function isRscRequest(req) {
  return !!(req.headers['rsc'] || (req.url && req.url.includes('_rsc=')));
}

// Injects CSS to bypass the loading screen and unregisters the service worker
function bypassLoadingScreen(html) {
  const inject = `<style>
  /* PageLoader mostra normalmente — só garantir cursor padrão */
  body { cursor: default !important; }
  /* Work page: cards hidden at 1200px+ for WebGL hover overlay — force them visible */
  .ProjectList_card__PiGCk { visibility: visible !important; }
  /* Skeleton cards should stay hidden */
  .ProjectList_skeleton_card__qw3sB { visibility: hidden !important; }
</style>
<script>
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => {
      regs.forEach(r => r.unregister());
    });
  }
  // Force-load lazy images: custom scroll libs keep window.scrollY=0 so
  // the browser's lazy-load intersection observer never fires.
  function eagerLoad(img) {
    if (img.getAttribute('loading') === 'lazy') img.setAttribute('loading', 'eager');
  }
  function eagerLoadAll() {
    document.querySelectorAll('img[loading="lazy"]').forEach(eagerLoad);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', eagerLoadAll);
  } else {
    eagerLoadAll();
  }
  new MutationObserver(mutations => {
    mutations.forEach(m => m.addedNodes.forEach(n => {
      if (n.nodeName === 'IMG') eagerLoad(n);
      if (n.querySelectorAll) n.querySelectorAll('img[loading="lazy"]').forEach(eagerLoad);
      if (n.nodeName === 'VIDEO') autoplayVideo(n);
      if (n.querySelectorAll) n.querySelectorAll('video').forEach(autoplayVideo);
    }));
  }).observe(document.documentElement, { childList: true, subtree: true });
  // Force muted+autoplay on videos: React sets .muted property but not the HTML
  // attribute, so Chrome's autoplay policy blocks them without user interaction.
  function autoplayVideo(v) {
    v.setAttribute('muted', '');
    v.muted = true;
    v.play().catch(() => {});
  }
  function autoplayAll() {
    document.querySelectorAll('video').forEach(autoplayVideo);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoplayAll);
  } else {
    autoplayAll();
  }
  setTimeout(autoplayAll, 800);
  setTimeout(autoplayAll, 2000);
  // Fallback: se o PageLoader travar (assets não carregaram), force-reveal após 8s.
  // Só age se o loader ainda estiver visível (não completou naturalmente).
  function gsapRevealFallback() {
    const loader = document.querySelector('.PageLoader_pageLoader___1cgC');
    // Loader já completou se visibility=hidden ou display=none
    if (loader && (loader.style.visibility === 'hidden' || getComputedStyle(loader).display === 'none')) return;
    // Loader ainda visível após timeout — forçar revelação do conteúdo
    document.querySelectorAll('*').forEach(el => {
      if (el.style.opacity === '0' && !(loader && loader.contains(el))) {
        el.style.opacity = '';
        el.style.transform = '';
        el.style.visibility = '';
      }
    });
    // Esconder o loader manualmente
    if (loader) { loader.style.visibility = 'hidden'; loader.style.pointerEvents = 'none'; }
  }
  setTimeout(gsapRevealFallback, 8000);
</script>`;
  return html.replace('</head>', inject + '</head>');
}

// Replace absolute CDN domain references so assets are served locally
function rewriteUrls(text, host) {
  for (const d of knownDomains) {
    text = text.replaceAll(`https://${d}`, `http://${host}/${d}`);
  }
  text = text.replaceAll('https://www.fromanother.love', '');
  return text;
}

function serveFile(filePath, res, host) {
  fs.readFile(filePath, (err, content) => {
    if (err) return null; // signal not found

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const isText = ['.html', '.js', '.css', '.json', '.xml', '.svg', '.m3u8'].includes(ext);

    res.writeHead(200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
    });

    if (isText) {
      let text = content.toString('utf-8');
      text = rewriteUrls(text, host);
      if (ext === '.html') text = bypassLoadingScreen(text);
      res.end(text, 'utf-8');
    } else {
      res.end(content);
    }
    return true;
  });
}

function proxyFromLive(decodedUrl, originalQuery, req, res) {
  let domain = 'www.fromanother.love';
  let subpath = decodedUrl;

  for (const d of knownDomains) {
    if (decodedUrl.startsWith('/' + d)) {
      domain = d;
      subpath = decodedUrl.substring(d.length + 1);
      break;
    }
  }

  const liveUrl = `https://${domain}${subpath}${originalQuery || ''}`;
  console.log(`PROXY → ${liveUrl}`);

  const options = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': '*/*',
    }
  };

  https.get(liveUrl, options, (proxyRes) => {
    if (proxyRes.statusCode !== 200) {
      console.log(`PROXY FAIL ${proxyRes.statusCode} → ${liveUrl}`);
      res.writeHead(proxyRes.statusCode, { 'Content-Type': 'text/plain' });
      res.end(`Live server returned ${proxyRes.statusCode}`);
      return;
    }

    const contentType = proxyRes.headers['content-type'] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' });

    const localPath = path.join(PUBLIC_DIR, decodedUrl);
    const ext = path.extname(localPath).toLowerCase();
    // Treat RSC (text/x-component) and other text types as text for URL rewriting
    const isText = ['.html', '.js', '.css', '.json', '.xml', '.svg', '.m3u8'].includes(ext)
      || contentType.startsWith('text/') || contentType.includes('application/json')
      || contentType.includes('x-component');
    const host = req.headers.host || `localhost:${PORT}`;

    // Only cache actual files — not when localPath resolves to a known directory.
    // Note: path.extname('www.fromanother.love') = '.love', so we can't rely on extension alone.
    // .m3u8 manifests contain Mux time-limited signed chunk URLs — never cache them.
    const VALID_CACHE_EXTS = new Set([
      '.html','.js','.css','.json','.xml','.svg','.m4s','.ts',
      '.jpg','.jpeg','.png','.gif','.webp','.ico','.mp4','.webm',
      '.woff','.woff2','.ttf','.otf','.txt',
    ]);
    const canCache = VALID_CACHE_EXTS.has(path.extname(localPath).toLowerCase());

    if (isText) {
      const chunks = [];
      proxyRes.on('data', (c) => chunks.push(c));
      proxyRes.on('end', () => {
        let text = Buffer.concat(chunks).toString('utf8');
        text = rewriteUrls(text, host);
        if (ext === '.html') text = bypassLoadingScreen(text);
        res.end(text, 'utf-8');
        if (canCache) {
          fs.mkdir(path.dirname(localPath), { recursive: true }, () => {
            fs.writeFile(localPath, text, 'utf8', () => {});
          });
        }
      });
    } else {
      // Buffer binary data so we can write to res and cache file from the same buffer.
      // Dual-pipe (proxyRes.pipe(res) + async proxyRes.pipe(ws)) causes an empty body
      // because the async pipe races with the stream already being consumed.
      const chunks = [];
      proxyRes.on('data', (c) => chunks.push(c));
      proxyRes.on('end', () => {
        const buf = Buffer.concat(chunks);
        res.end(buf);
        if (canCache) {
          fs.mkdir(path.dirname(localPath), { recursive: true }, () => {
            fs.writeFile(localPath, buf, () => {});
          });
        }
      });
    }
  }).on('error', (e) => {
    console.error(`PROXY ERROR: ${e.message}`);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Proxy error: ${e.message}`);
  });
}

const server = http.createServer((req, res) => {
  const [rawPath, rawQuery] = req.url.split('?');
  const originalQuery = rawQuery ? '?' + rawQuery : '';
  let decodedUrl;
  try { decodedUrl = decodeURIComponent(rawPath); } catch { decodedUrl = rawPath; }

  const host = req.headers.host || `localhost:${PORT}`;
  const isRsc = isRscRequest(req);
  const isAsset = isAssetUrl(decodedUrl);

  console.log(`${req.method} ${decodedUrl}${isRsc ? ' [RSC]' : ''}`);

  // ── Page routes (no extension, not an asset dir) ─────────────────────────
  if (!isAsset && !isRsc) {
    // Each route needs its own HTML (not just index.html) so Next.js App Router
    // can hydrate the correct page. Check for a cached route-specific HTML first.
    const routeHtmlPath = decodedUrl === '/'
      ? path.join(PUBLIC_DIR, 'index.html')
      : path.join(PUBLIC_DIR, decodedUrl.replace(/\/+$/, ''), 'index.html');

    fs.readFile(routeHtmlPath, 'utf-8', (err, cached) => {
      if (!err && cached.length > 500) {
        // Serve cached route-specific HTML
        let text = rewriteUrls(cached, host);
        text = bypassLoadingScreen(text);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(text, 'utf-8');
        return;
      }
      // No cached HTML — proxy from live site, cache it, then serve
      const liveUrl = `https://www.fromanother.love${decodedUrl}`;
      console.log(`PAGE PROXY → ${liveUrl}`);
      https.get(liveUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (proxyRes) => {
        if (proxyRes.statusCode !== 200) {
          // Fall back to homepage HTML for routes not found on live site
          const indexPath = path.join(PUBLIC_DIR, 'index.html');
          fs.readFile(indexPath, 'utf-8', (e2, fallback) => {
            let text = rewriteUrls(fallback || '', host);
            text = bypassLoadingScreen(text);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            res.end(text, 'utf-8');
          });
          return;
        }
        const chunks = [];
        proxyRes.on('data', c => chunks.push(c));
        proxyRes.on('end', () => {
          let html = Buffer.concat(chunks).toString('utf-8');
          // Cache the raw HTML so next load uses this route-specific content
          fs.mkdir(path.dirname(routeHtmlPath), { recursive: true }, () => {
            fs.writeFile(routeHtmlPath, html, 'utf-8', () => {});
          });
          let text = rewriteUrls(html, host);
          text = bypassLoadingScreen(text);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          res.end(text, 'utf-8');
        });
      }).on('error', () => {
        // Network error — fall back to homepage HTML
        const indexPath = path.join(PUBLIC_DIR, 'index.html');
        fs.readFile(indexPath, 'utf-8', (e2, fallback) => {
          let text = rewriteUrls(fallback || '', host);
          text = bypassLoadingScreen(text);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          res.end(text, 'utf-8');
        });
      });
    });
    return;
  }

  // ── RSC prefetch requests ─────────────────────────────────────────────────
  if (isRsc) {
    const rscPath = path.join(PUBLIC_DIR, decodedUrl);
    fs.readFile(rscPath, 'utf-8', (err, content) => {
      if (err) {
        proxyFromLive(decodedUrl, originalQuery, req, res);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/x-component', 'Access-Control-Allow-Origin': '*' });
      res.end(content, 'utf-8');
    });
    return;
  }

  // ── Service Worker override: self-unregistering no-op ───────────────────
  if (decodedUrl === '/sw.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript', 'Access-Control-Allow-Origin': '*' });
    res.end('self.addEventListener("install",()=>self.skipWaiting());self.addEventListener("activate",e=>e.waitUntil(self.registration.unregister()));');
    return;
  }

  // ── Next.js Image Optimization passthrough ───────────────────────────────
  // /_next/image?url=http://localhost:3000/images.prismic.io/... → serve the image directly
  if (decodedUrl === '/_next/image' && originalQuery) {
    const params = new URLSearchParams(originalQuery.slice(1));
    const imgUrl = params.get('url') || '';
    // Strip localhost prefix to get the root-relative path
    const localImgPath = imgUrl
      .replace(/^https?:\/\/localhost:\d+/, '')
      .replace(/^https?:\/\/localhost/, '');

    if (localImgPath && localImgPath.startsWith('/')) {
      const imgFilePath = path.join(PUBLIC_DIR, localImgPath.split('?')[0]);
      fs.stat(imgFilePath, (statErr, stats) => {
        if (!statErr && stats.isFile()) {
          const ext = path.extname(imgFilePath).toLowerCase();
          const ct = MIME_TYPES[ext] || 'image/jpeg';
          res.writeHead(200, { 'Content-Type': ct, 'Access-Control-Allow-Origin': '*' });
          fs.createReadStream(imgFilePath).pipe(res);
        } else {
          // Not cached locally — proxy the actual CDN URL
          proxyFromLive(localImgPath.split('?')[0], '', req, res);
        }
      });
    } else if (imgUrl.startsWith('http')) {
      // Absolute external URL — proxy it directly
      const parsed = new URL(imgUrl);
      const cdnPath = '/' + parsed.hostname + parsed.pathname;
      proxyFromLive(cdnPath, parsed.search || '', req, res);
    } else {
      proxyFromLive(decodedUrl, originalQuery, req, res);
    }
    return;
  }

  // ── Vídeos locais: servir arquivos de /_videos/ e /_hls/ diretamente ────────
  if (decodedUrl.startsWith('/_videos/') || decodedUrl.startsWith('/_hls/')) {
    const localFile = path.join(PUBLIC_DIR, decodedUrl);
    fs.stat(localFile, (err, stats) => {
      if (!err && stats.isFile()) {
        const ext = path.extname(localFile).toLowerCase();
        const ct = MIME_TYPES[ext] || (ext === '.m3u8' ? 'application/x-mpegURL' : 'application/octet-stream');
        res.writeHead(200, { 'Content-Type': ct, 'Access-Control-Allow-Origin': '*' });
        fs.createReadStream(localFile).pipe(res);
      } else {
        res.writeHead(404); res.end('not found');
      }
    });
    return;
  }

  // ── Static asset requests ─────────────────────────────────────────────────

  // .m3u8 manifests: verificar se há versão local (/_hls/ID/local.m3u8) antes de ir ao Mux
  if (path.extname(decodedUrl.split('?')[0]).toLowerCase() === '.m3u8') {
    // Tentar carregar mapa de vídeos locais
    const videoMapPath = path.join(PUBLIC_DIR, 'video_map.json');
    let videoMap = null;
    try { videoMap = JSON.parse(fs.readFileSync(videoMapPath, 'utf8')); } catch {}

    if (videoMap && videoMap.length > 0) {
      // Extrair o token da URL do manifest:
      // - URL nested:  /manifest-.../TOKEN/rendition.m3u8  → lookahead /
      // - URL plana:   /stream.mux.com/TOKEN.m3u8          → lookahead .m3u8
      const tokenMatch = decodedUrl.match(/\/([A-Za-z0-9]{20,})(?=\/|\.m3u8)/);
      const token = tokenMatch ? tokenMatch[1].substring(0, 24) : null;
      if (token) {
        const entry = videoMap.find(v => v.token === token);
        if (entry) {
          const localM3u8 = path.join(PUBLIC_DIR, entry.m3u8);
          if (fs.existsSync(localM3u8)) {
            const content = fs.readFileSync(localM3u8, 'utf8');
            const rewritten = rewriteUrls(content, host);
            res.writeHead(200, { 'Content-Type': 'application/x-mpegURL', 'Access-Control-Allow-Origin': '*' });
            res.end(rewritten, 'utf-8');
            return;
          }
        }
      }
    }

    // Sem versão local — buscar do Mux
    proxyFromLive(decodedUrl, originalQuery, req, res);
    return;
  }

  let filePath = path.join(PUBLIC_DIR, decodedUrl);

  fs.stat(filePath, (err, stats) => {
    if (err) {
      if (err.code === 'ENOENT') proxyFromLive(decodedUrl, originalQuery, req, res);
      else { res.writeHead(500); res.end(err.code); }
      return;
    }

    if (stats.isDirectory()) filePath = path.join(filePath, 'index.html');

    fs.readFile(filePath, (err2, content) => {
      if (err2) {
        if (err2.code === 'ENOENT') proxyFromLive(decodedUrl, originalQuery, req, res);
        else { res.writeHead(500); res.end(err2.code); }
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const isText = ['.html', '.js', '.css', '.json', '.xml', '.svg', '.m3u8'].includes(ext);

      res.writeHead(200, { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' });

      if (isText) {
        let text = content.toString('utf-8');
        text = rewriteUrls(text, host);
        if (ext === '.html') text = bypassLoadingScreen(text);
        res.end(text, 'utf-8');
      } else {
        res.end(content);
      }
    });
  });
});

server.listen(PORT, () => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Server → http://localhost:${PORT}/`);
  console.log(`Root   → ${PUBLIC_DIR}`);
  console.log(`=`.repeat(50) + '\n');
});
