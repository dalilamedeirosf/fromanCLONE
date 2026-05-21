/**
 * download_homepage_videos.js
 * Baixa os 8 vídeos de fundo da homepage (URLs planas stream.mux.com/{ID}.m3u8)
 * corrigindo o bug de extração de token do script anterior.
 */

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const PUBLIC_DIR = path.join(__dirname, 'www.fromanother.love');
const VIDEO_DIR  = path.join(PUBLIC_DIR, '_videos');
const HLS_DIR    = path.join(PUBLIC_DIR, '_hls');

[VIDEO_DIR, HLS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// IDs completos dos 8 vídeos da homepage (extraídos do manifest_urls.txt)
const HOMEPAGE_IDS = [
  'IKwT5z3LAi601P01OKfmNbH02rHsMhgMbyQmGXJVfJGilk',
  'BF02ixx7qhj8tO2b02tmY5qDdygS2nXS5m1zuPJfGmDko',
  '401m2zKPY6dGA00dL7Iihrb00p4LEAHaVYLugAovjAd9wU',
  'KNLYjrRuaORoeS6J7II2heM8Ncikq3418564Br00B1Ig',
  '9WxTFb6OWNtU00jzN9FipwesSwpAuf002rI99qkRxMj1Y',
  'Z02DKxTDFK3IuRBMPa4sqOaOTxiE00kPZcjQZ00Kj2EUxM',
  'u00pmsw00Uvr9CJkKgHEEVMrmnTjQzVPTAZ301005S4EjFM',
  'uKkmm51HPsTGQzUqQMxVUV8eI01BykKYUGKvFALbiP7U',
];

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

function saveFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, data);
}

function parseM3u8(text, baseUrl) {
  const lines    = text.split('\n').map(l => l.trim()).filter(Boolean);
  const isMaster = text.includes('#EXT-X-STREAM-INF');
  const base     = new URL(baseUrl);

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

async function downloadVideo(muxId) {
  const shortId = muxId.substring(0, 24);
  console.log(`\n━━ ${shortId}...`);

  // Checar se já existe
  const mp4Path = path.join(VIDEO_DIR, `${shortId}.mp4`);
  if (fs.existsSync(mp4Path)) {
    console.log(`  ✓ MP4 já existe — verificando video_map`);
    return { token: shortId, mp4: `/_videos/${shortId}.mp4`, m3u8: `/_hls/${shortId}/local.m3u8` };
  }

  // Buscar master manifest diretamente do Mux (sem token = playback público)
  const masterUrl = `https://stream.mux.com/${muxId}.m3u8`;
  let masterText;
  try {
    const r = await fetchText(masterUrl);
    if (r.status !== 200) { console.log(`  ✗ Manifest ${r.status}`); return null; }
    masterText = r.text;
  } catch (e) { console.log(`  ✗ ${e.message}`); return null; }

  const master = parseM3u8(masterText, masterUrl);

  let mediaUrl, mediaM3u8;
  if (master.isMaster && master.renditions.length > 0) {
    const best = master.renditions.sort((a, b) => b.bandwidth - a.bandwidth)[0];
    console.log(`  ↳ ${master.renditions.length} qualidades → ${Math.round(best.bandwidth / 1000)}kbps`);
    try {
      const r = await fetchText(best.url);
      if (r.status !== 200) { console.log(`  ✗ Sub-manifest ${r.status}`); return null; }
      mediaM3u8 = r.text;
      mediaUrl  = best.url;
    } catch (e) { console.log(`  ✗ ${e.message}`); return null; }
  } else {
    mediaM3u8 = masterText;
    mediaUrl  = masterUrl;
  }

  const media = parseM3u8(mediaM3u8, mediaUrl);
  if (media.segments.length === 0) { console.log('  ✗ Sem segmentos'); return null; }
  console.log(`  ↳ ${media.segments.length} segmentos, init: ${!!media.initUrl}`);

  const videoDir = path.join(HLS_DIR, shortId);
  fs.mkdirSync(videoDir, { recursive: true });

  // Init segment
  let initLocalPath = null;
  if (media.initUrl) {
    initLocalPath = path.join(videoDir, 'init.mp4');
    if (!fs.existsSync(initLocalPath)) {
      try {
        const r = await fetchBuf(media.initUrl);
        if (r.status === 200) saveFile(initLocalPath, r.buf);
      } catch (e) { console.log(`  ✗ init: ${e.message}`); }
    }
  }

  // Segmentos
  let ok = 0, fail = 0;
  const segmentNames = [];
  for (let i = 0; i < media.segments.length; i++) {
    const seg     = media.segments[i];
    const segName = `seg_${String(i).padStart(4, '0')}.m4s`;
    const segPath = path.join(videoDir, segName);
    segmentNames.push(segName);
    if (fs.existsSync(segPath) && fs.statSync(segPath).size > 0) { ok++; continue; }
    try {
      const r = await fetchBuf(seg.url);
      if (r.status === 200 && r.buf.length > 0) { saveFile(segPath, r.buf); ok++; process.stdout.write(`\r  ↓ ${ok}/${media.segments.length}`); }
      else fail++;
    } catch { fail++; }
  }
  console.log(`\r  ✓ ${ok} segmentos${fail ? `, ${fail} erros` : ''}   `);

  if (ok === 0) return null;

  // Montar MP4
  const parts = [];
  if (initLocalPath && fs.existsSync(initLocalPath)) parts.push(fs.readFileSync(initLocalPath));
  for (const name of segmentNames) {
    const p = path.join(videoDir, name);
    if (fs.existsSync(p)) parts.push(fs.readFileSync(p));
  }
  if (parts.length > 0) {
    const mp4 = Buffer.concat(parts);
    saveFile(mp4Path, mp4);
    console.log(`  ✓ MP4: ${shortId}.mp4 (${(mp4.length / 1024 / 1024).toFixed(1)} MB)`);
  }

  // Salvar local.m3u8
  const localLines = ['#EXTM3U', '#EXT-X-VERSION:6', '#EXT-X-TARGETDURATION:10'];
  if (initLocalPath) localLines.push(`#EXT-X-MAP:URI="/_hls/${shortId}/init.mp4"`);
  for (let i = 0; i < media.segments.length; i++) {
    localLines.push(`#EXTINF:${media.segments[i].duration.toFixed(6)},`);
    localLines.push(`/_hls/${shortId}/${segmentNames[i]}`);
  }
  localLines.push('#EXT-X-ENDLIST');
  saveFile(path.join(videoDir, 'local.m3u8'), localLines.join('\n'));

  return { token: shortId, mp4: `/_videos/${shortId}.mp4`, m3u8: `/_hls/${shortId}/local.m3u8`, segments: ok };
}

(async () => {
  console.log('='.repeat(55));
  console.log(' Baixando 8 vídeos da homepage...');
  console.log('='.repeat(55));

  // Carregar video_map existente (filtrar entradas inválidas de "stream.mux.com")
  const videoMapPath = path.join(PUBLIC_DIR, 'video_map.json');
  let existing = [];
  try {
    existing = JSON.parse(fs.readFileSync(videoMapPath, 'utf8'));
    existing = existing.filter(v => v.token !== 'stream.mux.com');
  } catch {}

  const newEntries = [];
  for (const id of HOMEPAGE_IDS) {
    const result = await downloadVideo(id);
    if (result) newEntries.push(result);
  }

  // Mesclar: remover duplicatas e adicionar novos
  const merged = [...existing];
  for (const entry of newEntries) {
    const idx = merged.findIndex(v => v.token === entry.token);
    if (idx >= 0) merged[idx] = entry;
    else merged.push(entry);
  }

  saveFile(videoMapPath, JSON.stringify(merged, null, 2));
  console.log(`\n${'='.repeat(55)}`);
  console.log(` Concluído: ${newEntries.length}/8 vídeos baixados`);
  console.log(` video_map.json atualizado: ${merged.length} entradas`);
  console.log('='.repeat(55));
})();
