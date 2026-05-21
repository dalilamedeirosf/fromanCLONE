/**
 * crawl.js — Baixa o site completo via proxy local
 * Uso:
 *   1. Certifique-se que o servidor está rodando:  node server.js
 *   2. npm install puppeteer   (só na primeira vez)
 *   3. node crawl.js
 *
 * Tudo que o Puppeteer carregar vai ser salvo automaticamente
 * pelo proxy em www.fromanother.love/  (a pasta do site local).
 */

const puppeteer = require('puppeteer-core');

const BASE = 'http://localhost:3000';

// Páginas conhecidas do site — adicione mais se descobrir outras
const SEED_PAGES = [
  '/',
  '/work',
  '/lab',
];

const VISITED = new Set();
const QUEUE   = [...SEED_PAGES];

// Rola a página devagar do topo ao fim para disparar lazy loading
async function slowScroll(page) {
  const height = await page.evaluate(() => document.body.scrollHeight);
  const step   = 300;   // pixels por passo
  const delay  = 120;   // ms entre passos

  for (let y = 0; y < height; y += step) {
    await page.evaluate((pos) => window.scrollTo(0, pos), y);
    await sleep(delay);
  }
  // Volta ao topo (às vezes dispara mais animações)
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(500);
}

// Retorna links internos encontrados na página
async function collectLinks(page) {
  return page.evaluate((base) => {
    return Array.from(document.querySelectorAll('a[href]'))
      .map(a => {
        try {
          const url = new URL(a.href, base);
          if (url.origin === base) return url.pathname;
        } catch (_) {}
        return null;
      })
      .filter(p => p && !p.includes('#') && !p.includes('.'));
  }, BASE);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function waitIdle(page) {
  try {
    await page.waitForNetworkIdle({ idleTime: 1500, timeout: 20000 });
  } catch (_) {
    // timeout é ok — seguimos em frente
  }
}

async function visitPage(browser, path) {
  if (VISITED.has(path)) return;
  VISITED.add(path);

  const url = BASE + path;
  console.log(`\n→ Visitando: ${url}`);

  const page = await browser.newPage();

  // Ignora erros de recursos (não aborta o crawl)
  page.on('requestfailed', () => {});

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitIdle(page);

    // Rola para disparar imagens lazy e animações
    await slowScroll(page);
    await waitIdle(page);

    // Coleta novos links para enfileirar
    const links = await collectLinks(page);
    for (const link of links) {
      if (!VISITED.has(link) && !QUEUE.includes(link)) {
        console.log(`  + Nova página encontrada: ${link}`);
        QUEUE.push(link);
      }
    }

    console.log(`  ✓ Pronto: ${url}`);
  } catch (err) {
    console.error(`  ✗ Erro em ${url}: ${err.message}`);
  } finally {
    await page.close();
  }
}

(async () => {
  console.log('='.repeat(55));
  console.log(' Crawl iniciado — servidor deve estar em localhost:3000');
  console.log('='.repeat(55));

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  while (QUEUE.length > 0) {
    const path = QUEUE.shift();
    await visitPage(browser, path);
    await sleep(800); // pausa entre páginas
  }

  await browser.close();

  console.log('\n' + '='.repeat(55));
  console.log(` Crawl concluído! ${VISITED.size} página(s) visitada(s).`);
  console.log(' Todos os arquivos estão em:');
  console.log(' www.fromanother.love/www.fromanother.love/');
  console.log('='.repeat(55));
})();
