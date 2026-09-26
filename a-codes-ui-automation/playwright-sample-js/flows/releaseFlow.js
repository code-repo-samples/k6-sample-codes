const { ProgramsPage } = require('../pages/ProgramsPage');
const { ProgramDetailPage } = require('../pages/ProgramDetailPage');
const { ensureProgram } = require('./programFlow');
const config = require('../test-data/test-config.json');

async function ensureRelease(page, journey) {
  if (journey.releaseId) return journey;

  if (config.existingIds?.releaseId && config.existingIds?.releaseName) {
    journey.releaseId = config.existingIds.releaseId;
    journey.releaseName = config.existingIds.releaseName;
    console.log(`[flow:release] using existing release from config: ${journey.releaseName}`);
    return journey;
  }

  await ensureProgram(page, journey); // releases belong to a program

  const programsPage = new ProgramsPage(page);
  const detailPage = new ProgramDetailPage(page);
  await programsPage.goto();
  await programsPage.openProgramByName(journey.programName);

  const releaseName = `${config.release.namePrefix}-${Date.now()}`;
  const result = await detailPage.createRelease({
    name: releaseName,
    startDay: config.release.startDay,
    endDay: config.release.endDay,
  });
  journey.releaseId = result.releaseId;
  journey.releaseName = result.releaseName;
  console.log(`[flow:release] created release ${journey.releaseName} (${journey.releaseId})`);
  return journey;
}

async function editRelease(page, journey) {
  await ensureRelease(page, journey);
  const detailPage = new ProgramDetailPage(page);
  await detailPage.editRelease(journey.releaseId, { endDay: '30' }); // VERIFY: exact day
}

module.exports = { ensureRelease, editRelease };
