/**
 * download_videos.js — Baixa todos os vídeos do Mux como MP4
 * Uso: node download_videos.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const VIDEO_DIR = path.join(__dirname, 'www.fromanother.love', 'videos');
if (!fs.existsSync(VIDEO_DIR)) fs.mkdirSync(VIDEO_DIR, { recursive: true });

// Playback IDs extraídos da página principal
// Precisamos também visitar /work/* para pegar mais vídeos
const KNOWN_IDS = [
  'IKwT5z3LAi601P01OKfmNbH02rHsMhgMbyQmGXJVfJGilk',
  'uKkmm51HPsTGQzUqQMxVUV8eI01BykKYUGKvFALbiP7U',
  'Z02DKxTDFK3IuRBMPa4sqOaOTxiE00kPZcjQZ00Kj2EUxM',
  'u00pmsw00Uvr9CJkKgHEEVMrmnTjQzVPTAZ301005S4EjFM',
  '9WxTFb6OWNtU00jzN9FipwesSwpAuf002rI99qkRxMj1Y',
  'KNLYjrRuaORoeS6J7II2heM8Ncikq3418564Br00B1Ig',
  '401m2zKPY6dGA00dL7Iihrb00p4LEAHaVYLugAovjAd9wU',
  'BF02ixx7qhj8tO2b02tmY5qDdygS2nXS5m1zuPJfGmDko',
];

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(dest)) {
      const size = fs.statSync(dest).size;
      if (size > 10000) {
        console.log(`  ✓ Já existe: ${path.basename(dest)} (${(size/1024/1024).toFixed(1)} MB)`);
        return resolve(true);
      }
    }

    const file = fs.createWriteStream(dest);
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    }, res => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        file.close();
        fs.unlinkSync(dest);
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        return resolve(false);
      }

      const total = parseInt(res.headers['content-length'] || '0');
      let downloaded = 0;
      let lastLog = 0;

      res.on('data', chunk => {
        downloaded += chunk.length;
        const pct = total ? Math.floor(downloaded / total * 100) : '?';
        if (Date.now() - lastLog > 2000) {
          process.stdout.write(`\r  ↓ ${path.basename(dest)}: ${(downloaded/1024/1024).toFixed(1)} MB (${pct}%)   `);
          lastLog = Date.now();
        }
      });

      res.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log(`\r  ✓ Baixado: ${path.basename(dest)} (${(downloaded/1024/1024).toFixed(1)} MB)   `);
        resolve(true);
      });
    });

    req.on('error', err => {
      file.close();
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(err);
    });
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function downloadVideo(playbackId) {
  const qualities = ['high', 'medium', 'low'];
  for (const q of qualities) {
    const url = `https://stream.mux.com/${playbackId}/${q}.mp4`;
    const dest = path.join(VIDEO_DIR, `${playbackId}_${q}.mp4`);
    console.log(`\n→ ${playbackId.substring(0, 20)}... [${q}]`);
    try {
      const ok = await downloadFile(url, dest);
      if (ok) return { playbackId, quality: q, file: dest };
    } catch (e) {
      console.log(`  ✗ Erro: ${e.message}`);
    }
  }
  return null;
}

(async () => {
  console.log('='.repeat(55));
  console.log(' Download de vídeos Mux');
  console.log('='.repeat(55));

  const results = [];
  for (const id of KNOWN_IDS) {
    const result = await downloadVideo(id);
    if (result) results.push(result);
  }

  console.log('\n' + '='.repeat(55));
  console.log(` ${results.length}/${KNOWN_IDS.length} vídeos baixados`);
  console.log('='.repeat(55));
  console.log(JSON.stringify(results.map(r => ({ id: r.playbackId.substring(0,20), q: r.quality })), null, 2));
})();
