const { NavigationBar } = require('../pages/NavigationBar');
const { PromotionsPage } = require('../pages/PromotionsPage');
const { ensureProgram } = require('./programFlow');
const config = require('../test-data/test-config.json');

async function ensurePromotion(page, journey) {
  if (journey.promotionId) return journey;

  if (config.existingIds?.promotionId && config.existingIds?.promotionName) {
    journey.promotionId = config.existingIds.promotionId;
    journey.promotionName = config.existingIds.promotionName;
    console.log(`[flow:promotion] using existing promotion from config: ${journey.promotionName}`);
    return journey;
  }

  await ensureProgram(page, journey); // promotions map to a program

  const nav = new NavigationBar(page);
  const promotionsPage = new PromotionsPage(page);
  await nav.goTo('Promotions');

  const promoName = `${config.promotion.namePrefix}-${Date.now()}`;
  const result = await promotionsPage.createPromotionForProgram({
    programName: journey.programName,
    name: promoName,
    startDay: config.promotion.startDay,
    endDay: config.promotion.endDay,
  });
  journey.promotionId = result.promotionId;
  journey.promotionName = result.promotionName;
  console.log(`[flow:promotion] created promotion ${journey.promotionName} (${journey.promotionId})`);
  return journey;
}

module.exports = { ensurePromotion };
