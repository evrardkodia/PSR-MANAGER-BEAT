const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const KEYFILEPATH = path.join(__dirname, '..', 'credentials', 'service-account.json'); // ".." car on est dans /utils
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

const auth = new google.auth.GoogleAuth({
  keyFile: KEYFILEPATH,
  scopes: SCOPES,
});

const driveService = google.drive({ version: 'v3', auth });

/**
 * Upload un fichier .sty sur Google Drive
 */
async function uploadToDrive(filePath, filename) {
  const fileMetadata = {
    name: filename,
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
