const { ProgramDetailPage } = require('../pages/ProgramDetailPage');
const { ensureRelease } = require('./releaseFlow');
const config = require('../test-data/test-config.json');

async function ensureLot(page, journey) {
  if (journey.lotId) return journey;

  if (config.existingIds?.lotId) {
    journey.lotId = config.existingIds.lotId;
    console.log(`[flow:lot] using existing lot from config: ${journey.lotId}`);
    return journey;
  }

  await ensureRelease(page, journey); // lots belong to a release

  const detailPage = new ProgramDetailPage(page);
  await detailPage.expandRelease(journey.releaseId);

  const lotName = `${config.lot.namePrefix}-${Date.now()}`;
  journey.lotId = await detailPage.addLot({ releaseId: journey.releaseId, name: lotName });
  console.log(`[flow:lot] created lot ${lotName} (${journey.lotId})`);
  return journey;
}

async function editLot(page, journey) {
  await ensureLot(page, journey);
  const detailPage = new ProgramDetailPage(page);
  await detailPage.editLot(journey.lotId, { name: `${config.lot.namePrefix}-updated` });
}

module.exports = { ensureLot, editLot };
