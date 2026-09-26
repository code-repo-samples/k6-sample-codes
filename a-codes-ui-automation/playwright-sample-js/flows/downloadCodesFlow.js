const { DownloadCodesPage } = require('../pages/DownloadCodesPage');

async function downloadCodes(page) {
  const downloadCodesPage = new DownloadCodesPage(page);
  const download = await downloadCodesPage.downloadCodes();
  await downloadCodesPage.expectFilenameMatches(download, /Part_1/); // VERIFY: filename pattern
}

module.exports = { downloadCodes };
