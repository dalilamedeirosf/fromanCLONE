const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, 'www.fromanother.love');

const domains = [
  'chunk-oci-us-ashburn-1-vop1.fastly.mux.com',
  'fromanother-2026.prismic.io',
  'image.mux.com',
  'images.prismic.io',
  'manifest-oci-us-ashburn-1-vop1.fastly.mux.com',
  'snap.licdn.com',
  'static.cdn.prismic.io',
  'stream.mux.com'
];

// Recursive directory copy
function copyFolderRecursiveSync(source, target) {
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }

  if (fs.lstatSync(source).isDirectory()) {
    const files = fs.readdirSync(source);
    files.forEach((file) => {
      const curSource = path.join(source, file);
      const curTarget = path.join(target, file);
      if (fs.lstatSync(curSource).isDirectory()) {
        copyFolderRecursiveSync(curSource, curTarget);
      } else {
        fs.copyFileSync(curSource, curTarget);
      }
    });
  }
}

// Recursive directory delete (safe, fallback for older Node versions)
function deleteFolderRecursiveSync(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.readdirSync(dirPath).forEach((file) => {
      const curPath = path.join(dirPath, file);
      if (fs.lstatSync(curPath).isDirectory()) {
        deleteFolderRecursiveSync(curPath);
      } else {
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(dirPath);
  }
}

// Walk files recursively to perform text replacements
function walkAndReplace(dir) {
  const files = fs.readdirSync(dir);
  files.forEach((file) => {
    const filePath = path.join(dir, file);
    if (fs.lstatSync(filePath).isDirectory()) {
      // Don't modify node_modules or git
      if (file !== 'node_modules' && file !== '.git') {
        walkAndReplace(filePath);
      }
    } else {
      const ext = path.extname(filePath).toLowerCase();
      const isTextFile = ['.html', '.js', '.css', '.json', '.xml', '.svg', '.m3u8'].includes(ext);
      
      if (isTextFile) {
        let content = fs.readFileSync(filePath, 'utf8');
        let hasChanges = false;

        // Replace absolute URL domains with root-relative paths
        for (const domain of domains) {
          const targetStr = `https://${domain}`;
          if (content.includes(targetStr)) {
            content = content.replaceAll(targetStr, `/${domain}`);
            hasChanges = true;
          }
        }

        // Replace absolute references to main site domain as well
        const mainSiteDomain = 'https://www.fromanother.love';
        if (content.includes(mainSiteDomain)) {
          content = content.replaceAll(mainSiteDomain, '');
          hasChanges = true;
        }

        if (hasChanges) {
          console.log(`Rewritten references in: ${path.relative(PUBLIC_DIR, filePath)}`);
          fs.writeFileSync(filePath, content, 'utf8');
        }
      }
    }
  });
}

function assemble() {
  console.log('==================================================');
  console.log('STARTING SITE ASSEMBLY & CONSOLIDATION');
  console.log('==================================================\n');

  if (!fs.existsSync(PUBLIC_DIR)) {
    console.error(`Error: PUBLIC_DIR "${PUBLIC_DIR}" does not exist.`);
    return;
  }

  // 1. Copy domain directories inside PUBLIC_DIR
  domains.forEach((domain) => {
    const sourcePath = path.join(__dirname, domain);
    const targetPath = path.join(PUBLIC_DIR, domain);

    if (fs.existsSync(sourcePath)) {
      console.log(`Copying: ${domain} -> www.fromanother.love/${domain}...`);
      copyFolderRecursiveSync(sourcePath, targetPath);
      console.log(`Successfully consolidated: ${domain}`);
    } else {
      console.log(`Folder already moved or missing: ${domain}`);
    }
  });

  // 2. Perform replacements inside consolidated directory
  console.log('\nScanning and permanently rewriting asset URLs...');
  walkAndReplace(PUBLIC_DIR);
  console.log('URL rewriting complete!');

  // 3. Safely delete the original external domain directories
  console.log('\nCleaning up external directories...');
  domains.forEach((domain) => {
    const sourcePath = path.join(__dirname, domain);
    if (fs.existsSync(sourcePath)) {
      try {
        deleteFolderRecursiveSync(sourcePath);
        console.log(`Removed: ${domain}`);
      } catch (err) {
        console.error(`Could not remove original folder ${domain}:`, err.message);
      }
    }
  });

  console.log('\n==================================================');
  console.log('ASSEMBLY COMPLETE! Site is now fully self-contained.');
  console.log('==================================================\n');
}

assemble();
