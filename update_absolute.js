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

function walkAndReplaceToAbsolute(dir) {
  const files = fs.readdirSync(dir);
  files.forEach((file) => {
    const filePath = path.join(dir, file);
    if (fs.lstatSync(filePath).isDirectory()) {
      if (file !== 'node_modules' && file !== '.git') {
        walkAndReplaceToAbsolute(filePath);
      }
    } else {
      const ext = path.extname(filePath).toLowerCase();
      const isTextFile = ['.html', '.js', '.css', '.json', '.xml', '.svg', '.m3u8'].includes(ext);
      
      if (isTextFile) {
        let content = fs.readFileSync(filePath, 'utf8');
        let hasChanges = false;

        for (const domain of domains) {
          // Find root-relative paths like /images.prismic.io and replace with absolute localhost URLs
          // We look for "/domain" which was written in the previous assembly
          const targetStr = `/${domain}`;
          const replacementStr = `http://localhost:3000/${domain}`;
          
          if (content.includes(targetStr)) {
            // Be careful to replace only where it's a domain reference (e.g. preceded by quotes, equal signs, or spaces, or at the start)
            // A simple replaceAll is safe because "/images.prismic.io" as a subpath is unique and represents the domain folder.
            content = content.replaceAll(targetStr, replacementStr);
            hasChanges = true;
          }
        }

        if (hasChanges) {
          console.log(`Updated to absolute localhost in: ${path.relative(PUBLIC_DIR, filePath)}`);
          fs.writeFileSync(filePath, content, 'utf8');
        }
      }
    }
  });
}

console.log('==================================================');
console.log('UPDATING LOCAL DOMAIN PATHS TO VALID ABSOLUTE LOCALHOST URLS');
console.log('==================================================\n');

walkAndReplaceToAbsolute(PUBLIC_DIR);

console.log('\n==================================================');
console.log('UPDATE COMPLETE! All assets are now valid absolute localhost URLs.');
console.log('==================================================\n');
