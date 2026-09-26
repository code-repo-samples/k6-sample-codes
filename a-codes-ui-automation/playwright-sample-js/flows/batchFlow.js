const { BatchPage } = require('../pages/BatchPage');
const { ensureLot } = require('./lotFlow');
const { ensurePromotion } = require('./promotionFlow');
const config = require('../test-data/test-config.json');

async function ensureBatch(page, journey) {
  if (journey.batchId) return journey;

  await ensureLot(page, journey);
  await ensurePromotion(page, journey); // batch needs a promotion mapped to it

  const batchPage = new BatchPage(page);
  journey.batchId = await batchPage.createBatch({
    lotId: journey.lotId,
    organizationId: config.batch.organizationId, // parameter-driven, not hardcoded
    promotionName: journey.promotionName || config.batch.promotionName,
    codesPerFile: config.batch.codesPerFile,
  });
  console.log(`[flow:batch] created batch ${journey.batchId}`);

  await batchPage.triggerCodeGeneration(journey.batchId);
  await batchPage.waitForCodeGenComplete(journey.batchId);
  console.log(`[flow:batch] code generation complete for ${journey.batchId}`);

  return journey;
}

module.exports = { ensureBatch };
