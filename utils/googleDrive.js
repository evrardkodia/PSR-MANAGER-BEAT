const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const KEYFILEPATH = path.join(__dirname, '..', 'credentials', 'service-account.json');
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

// ✅ ID du dossier partagé
const FOLDER_ID = '1pGtMCePMCbpN3ri4_MmUgtj_-tPUNKQJ';

const auth = new google.auth.GoogleAuth({
  keyFile: KEYFILEPATH,
  scopes: SCOPES,
});

const driveService = google.drive({ version: 'v3', auth });

/**
 * Upload un fichier .sty sur Google Drive dans le bon dossier
 */
async function uploadToDrive(filePath, filename) {
  const fileMetadata = {
    name: filename,
    parents: [FOLDER_ID], // ✅ très important pour cibler ton dossier partagé
  };

  const media = {
    mimeType: 'application/octet-stream',
    body: fs.createReadStream(filePath),
  };

  const response = await driveService.files.create({
    resource: fileMetadata,
    media: media,
    fields: 'id, name, webViewLink, webContentLink',
  });

  return response.data;
}

module.exports = {
  uploadToDrive,
};
