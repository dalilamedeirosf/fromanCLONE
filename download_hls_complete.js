/**
 * download_hls_complete.js
 * Usa Puppeteer para interceptar todos os manifests m3u8, baixa todos os segmentos,
 * monta MP4s locais e salva manifests reescritos para servir offline.
 *
 * Uso: node download_hls_complete.js
 */

const puppeteer = require('puppeteer-core');
const https    = require('https');
const http     = require('http');
const fs       = require('fs');
const path     = require('path');

const BASE        = 'http://localhost:3000';
const PUBLIC_DIR  = path.join(__dirname, 'www.fromanother.love');
const VIDEO_DIR   = path.join(PUBLIC_DIR, '_videos');           // MP4s finais
const HLS_DIR     = path.join(PUBLIC_DIR, '_hls');             // segmentos + manifests locais

[VIDEO_DIR, HLS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// Páginas do site (homepage + todas as obras)
const SEED_PAGES = [
  '/',
  '/work',
  '/lab',
];

// ─── utilitários ───────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetchBuf(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      if ([301, 302].includes(res.statusCode)) {
        return fetchBuf(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ buf: Buffer.concat(chunks), status: res.statusCode, ct: res.headers['content-type'] || '' }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout: ' + url)); });
  });
}

function fetchText(url) {
  return fetchBuf(url).then(r => ({ text: r.buf.toString('utf8'), status: r.status }));
}

// Salva arquivo criando pastas intermediárias
function saveFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, data);
}

// ─── parser de m3u8 ────────────────────────────────────────────────────────

/**
 * Retorna { isMaster, renditions: [{url, bandwidth}], segments: [{url, duration}], initUrl }
 */
function parseM3u8(text, baseUrl) {
  const lines  = text.split('\n').map(l => l.trim()).filter(Boolean);
  const isMaster = text.includes('#EXT-X-STREAM-INF');
  const base   = new URL(baseUrl);

  function resolve(rel) {
    if (rel.startsWith('http')) return rel;
    return new URL(rel, base).toString();
  }

  if (isMaster) {
    const renditions = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
        const bw = (lines[i].match(/BANDWIDTH=(\d+)/) || [])[1];
        renditions.push({ url: resolve(lines[i + 1]), bandwidth: parseInt(bw || '0') });
      }
    }
    return { isMaster: true, renditions, segments: [], initUrl: null };
  }

  // mídia — pegar init segment e segmentos
  let initUrl = null;
  const segments = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('#EXT-X-MAP')) {
      const m = l.match(/URI="([^"]+)"/);
      if (m) initUrl = resolve(m[1]);
    } else if (l.startsWith('#EXTINF')) {
      const dur = parseFloat(l.split(':')[1]);
      segments.push({ url: resolve(lines[i + 1]), duration: dur });
      i++;
    }
  }
  return { isMaster: false, renditions: [], segments, initUrl };
}

// ─── download de um vídeo completo ─────────────────────────────────────────

const processedManifests = new Set();

async function downloadVideo(manifestUrl) {
  const cleanKey = manifestUrl.split('?')[0];
  if (processedManifests.has(cleanKey)) return;
  processedManifests.add(cleanKey);

  // Extrair um ID legível da URL
  const parts = cleanKey.split('/');
  const token = parts[parts.length - 2] || 'unknown';
  const shortId = token.substring(0, 24);

  console.log(`\n━━ Vídeo: ${shortId}...`);

  // 1. Buscar manifest raiz (pode ser master ou direto)
  let masterText, masterUrl;
  try {
    const r = await fetchText(manifestUrl);
    if (r.status !== 200) { console.log(`  ✗ Manifest retornou ${r.status}`); return; }
    masterText = r.text;
    masterUrl  = manifestUrl;
  } catch (e) {
    console.log(`  ✗ Erro ao buscar manifest: ${e.message}`);
    return;
  }

  const master = parseM3u8(masterText, masterUrl);

  // Pegar a rendição de maior qualidade (ou única)
  let mediaUrl, mediaM3u8;
  if (master.isMaster && master.renditions.length > 0) {
    const best = master.renditions.sort((a, b) => b.bandwidth - a.bandwidth)[0];
    console.log(`  ↳ Qualidades: ${master.renditions.length}, usando melhor (${Math.round(best.bandwidth/1000)}kbps)`);
    try {
      const r = await fetchText(best.url);
      if (r.status !== 200) { console.log(`  ✗ Sub-manifest ${r.status}`); return; }
      mediaM3u8 = r.text;
      mediaUrl  = best.url;
    } catch (e) {
      console.log(`  ✗ Erro sub-manifest: ${e.message}`);
      return;
    }
  } else {
    mediaM3u8 = masterText;
    mediaUrl  = masterUrl;
  }

  const media = parseM3u8(mediaM3u8, mediaUrl);
  if (media.segments.length === 0) { console.log('  ✗ Nenhum segmento encontrado'); return; }

  console.log(`  ↳ ${media.segments.length} segmentos + init: ${!!media.initUrl}`);

  // 2. Pasta local para este vídeo
  const videoDir = path.join(HLS_DIR, shortId);
  fs.mkdirSync(videoDir, { recursive: true });

  // 3. Baixar init segment
  let initLocalPath = null;
  if (media.initUrl) {
    const initName = 'init.mp4';
    initLocalPath  = path.join(videoDir, initName);
    if (!fs.existsSync(initLocalPath)) {
      try {
        const r = await fetchBuf(media.initUrl);
        if (r.status === 200) {
          saveFile(initLocalPath, r.buf);
          console.log(`  ✓ init.mp4 (${(r.buf.length/1024).toFixed(0)} KB)`);
        }
      } catch (e) { console.log(`  ✗ init: ${e.message}`); }
    } else {
      console.log(`  ✓ init.mp4 já existe`);
    }
  }

  // 4. Baixar segmentos
  let ok = 0, fail = 0;
  const segmentPaths = [];

  for (let i = 0; i < media.segments.length; i++) {
    const seg     = media.segments[i];
    const segName = `seg_${String(i).padStart(4, '0')}.m4s`;
    const segPath = path.join(videoDir, segName);
    segmentPaths.push(segName);

    if (fs.existsSync(segPath) && fs.statSync(segPath).size > 0) {
      ok++;
      continue;
    }

    try {
      const r = await fetchBuf(seg.url);
      if (r.status === 200 && r.buf.length > 0) {
        saveFile(segPath, r.buf);
        ok++;
        process.stdout.write(`\r  ↓ Segmentos: ${ok}/${media.segments.length}   `);
      } else {
        fail++;
      }
    } catch (e) {
      fail++;
    }
  }

  console.log(`\r  ✓ ${ok} segmentos baixados${fail ? `, ${fail} erros` : ''}   `);

  // 5. Montar MP4 concatenando init + segmentos
  if (ok > 0) {
    const mp4Path = path.join(VIDEO_DIR, `${shortId}.mp4`);
    if (!fs.existsSync(mp4Path)) {
      const parts = [];
      if (initLocalPath && fs.existsSync(initLocalPath)) parts.push(fs.readFileSync(initLocalPath));
      for (const name of segmentPaths) {
        const p = path.join(videoDir, name);
        if (fs.existsSync(p)) parts.push(fs.readFileSync(p));
      }
      if (parts.length > 0) {
        const mp4 = Buffer.concat(parts);
        saveFile(mp4Path, mp4);
        console.log(`  ✓ MP4: ${shortId}.mp4 (${(mp4.length/1024/1024).toFixed(1)} MB)`);
      }
    } else {
      console.log(`  ✓ MP4 já existe`);
    }

    // 6. Salvar manifest reescrito apontando para arquivos locais
    const localM3u8Lines = ['#EXTM3U', '#EXT-X-VERSION:6', `#EXT-X-TARGETDURATION:10`];
    if (initLocalPath) {
      localM3u8Lines.push(`#EXT-X-MAP:URI="/_hls/${shortId}/init.mp4"`);
    }
    for (let i = 0; i < media.segments.length; i++) {
      localM3u8Lines.push(`#EXTINF:${media.segments[i].duration.toFixed(6)},`);
      localM3u8Lines.push(`/_hls/${shortId}/${segmentPaths[i]}`);
    }
    localM3u8Lines.push('#EXT-X-ENDLIST');
    const localM3u8 = localM3u8Lines.join('\n');
    saveFile(path.join(videoDir, 'local.m3u8'), localM3u8);

    // Registrar mapeamento: token do Mux → ID local
    return { token: shortId, mp4: `/_videos/${shortId}.mp4`, m3u8: `/_hls/${shortId}/local.m3u8`, segments: ok };
  }
  return null;
}

// ─── Puppeteer: interceptar manifests em todas as páginas ─────────────────

async function collectManifestUrls() {
  console.log('\n='.repeat(55));
  console.log(' Abrindo navegador para capturar manifests...');
  console.log('='.repeat(55));

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const manifests = new Set();

  const pagesToVisit = [...SEED_PAGES];
  const visited      = new Set();

  // Primeiro pegar as páginas de projetos da página /work
  const page0 = await browser.newPage();
  await page0.goto(`${BASE}/work`, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
  const links = await page0.evaluate(() =>
    Array.from(document.querySelectorAll('a[href]'))
      .map(a => new URL(a.href).pathname)
      .filter(p => p.startsWith('/work/'))
  );
  links.forEach(l => { if (!pagesToVisit.includes(l)) pagesToVisit.push(l); });
  await page0.close();
  console.log(`  Páginas encontradas: ${pagesToVisit.length}`);

  for (const pagePath of pagesToVisit) {
    if (visited.has(pagePath)) continue;
    visited.add(pagePath);

    const page = await browser.newPage();
    await page.setRequestInterception(true);

    page.on('request', req => {
      const url = req.url();
      if (url.includes('rendition.m3u8') || url.includes('.m3u8')) {
        manifests.add(url);
      }
      req.continue();
    });

    try {
      await page.goto(`${BASE}${pagePath}`, { waitUntil: 'networkidle2', timeout: 30000 });
      await sleep(3000); // esperar vídeos iniciarem
    } catch (e) { /* timeout ok */ }

    await page.close();
    console.log(`  ✓ ${pagePath} — manifests até agora: ${manifests.size}`);
  }

  await browser.close();
  return Array.from(manifests);
}

// ─── main ──────────────────────────────────────────────────────────────────

(async () => {
  const startTime = Date.now();

  // 1. Coletar URLs de manifests
  const manifestUrls = await collectManifestUrls();
  console.log(`\n  Total de manifests únicos: ${manifestUrls.length}`);

  // Salvar lista de manifests para depuração
  saveFile(path.join(HLS_DIR, 'manifest_urls.txt'), manifestUrls.join('\n'));

  // 2. Baixar cada vídeo
  console.log('\n='.repeat(55));
  console.log(' Baixando vídeos...');
  console.log('='.repeat(55));

  const results = [];
  for (const url of manifestUrls) {
    const r = await downloadVideo(url);
    if (r) results.push(r);
  }

  // 3. Salvar mapeamento JSON
  const mapPath = path.join(PUBLIC_DIR, 'video_map.json');
  saveFile(mapPath, JSON.stringify(results, null, 2));

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log('\n' + '='.repeat(55));
  console.log(` Concluído em ${elapsed} min`);
  console.log(` ${results.length}/${manifestUrls.length} vídeos baixados`);
  console.log(` MP4s em: ${VIDEO_DIR}`);
  console.log(` Segmentos em: ${HLS_DIR}`);
  console.log('='.repeat(55));
})();
