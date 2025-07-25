const https = require('https');
const fs = require('fs');
const path = require('path');

const FILE_URL = 'https://drive.google.com/uc?export=download&id=15DmsrIEW2DW_ZIvEUJ-3Iwred7vBwpoS';
const DEST_PATH = path.resolve(__dirname, 'sf2', 'PSR_MANAGER.sf2');

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error('Download failed, status: ' + res.statusCode));
        return;
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => reject(err));
    });
  });
}

(async () => {
  try {
    // Crée dossier sf2 si besoin
    const dir = path.dirname(DEST_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    console.log('Téléchargement du SF2...');
    await downloadFile(FILE_URL, DEST_PATH);
    console.log('SF2 téléchargé avec succès');
  } catch (err) {
    console.error('Erreur lors du téléchargement du SF2:', err);
    process.exit(1);
  }
})();
