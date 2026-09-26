const { ProgramsPage } = require('../pages/ProgramsPage');
const { CampaignsPage } = require('../pages/CampaignsPage');
const { ensureProgram } = require('./programFlow');
const { recordCode } = require('../utils/generatedCodesStore');
const config = require('../test-data/test-config.json');

async function ensureCampaign(page, journey) {
  if (journey.campaignId) return journey;

  await ensureProgram(page, journey); // campaigns attach to a program, not a release/lot/batch

  const programsPage = new ProgramsPage(page);
  const campaignsPage = new CampaignsPage(page);
  await programsPage.goto();
  await programsPage.openProgramByName(journey.programName);
  await campaignsPage.openTab();

  const campaignName = `${config.campaign.namePrefix}-${Date.now()}`;
  const result = await campaignsPage.createCampaign({ name: campaignName, day: 28 }); // VERIFY: exact day
  journey.campaignId = result.campaignId;
  journey.viralCode = result.viralCode;

  recordCode({
    source: 'campaign',
    programId: journey.programId,
    campaignId: journey.campaignId,
    code: journey.viralCode,
  });
  console.log(`[flow:campaign] created campaign ${campaignName} (${journey.campaignId}), code=${journey.viralCode}`);

  return journey;
}

async function editCampaign(page, journey) {
  await ensureCampaign(page, journey);
  const campaignsPage = new CampaignsPage(page);
  await campaignsPage.editCampaign(journey.campaignId, { name: `${config.campaign.namePrefix}-updated` });
}

module.exports = { ensureCampaign, editCampaign };
