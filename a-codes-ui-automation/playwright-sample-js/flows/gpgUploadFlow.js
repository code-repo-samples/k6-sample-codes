const path = require('path');
const { GpgUploadPage } = require('../pages/GpgUploadPage');
const config = require('../test-data/test-config.json');

async function uploadPublicKey(page) {
  const gpgUploadPage = new GpgUploadPage(page);
  await gpgUploadPage.uploadPublicKey({
    filePath: path.join(process.cwd(), config.gpgUpload.filePath),
    fromDate: config.gpgUpload.fromDate,
    toDate: config.gpgUpload.toDate,
  });
}

module.exports = { uploadPublicKey };
