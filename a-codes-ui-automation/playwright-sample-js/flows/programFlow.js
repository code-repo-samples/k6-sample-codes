const { NavigationBar } = require('../pages/NavigationBar');
const { ProgramsPage } = require('../pages/ProgramsPage');
const { CreateProgramModal } = require('../pages/CreateProgramModal');
const { ProgramDetailPage } = require('../pages/ProgramDetailPage');
const config = require('../test-data/test-config.json');

/**
 * Ensures `journey` has a program to work with, in priority order:
 *   1. Already created earlier this run (journey.programId set)
 *   2. An existing program pinned in test-config.json ("existingIds.programId")
 *   3. Create a brand new one from config.program
 * This is what lets any later stage (Release, Campaign, ...) run standalone
 * without needing Program creation to have run first in the same session.
 */
async function ensureProgram(page, journey) {
  if (journey.programId) return journey;

  if (config.existingIds?.programId && config.existingIds?.programName) {
    journey.programId = config.existingIds.programId;
    journey.programName = config.existingIds.programName;
    console.log(`[flow:program] using existing program from config: ${journey.programName} (${journey.programId})`);
    return journey;
  }

  const nav = new NavigationBar(page);
  const programsPage = new ProgramsPage(page);
  const modal = new CreateProgramModal(page);

  await nav.goTo('Programs');
  await programsPage.openCreateNewProgram();
  journey.programName = await modal.fillFromConfig(config.program);
  await modal.save();

  await programsPage.goto();
  journey.programId = await programsPage.getProgramIdByName(journey.programName);
  console.log(`[flow:program] created program ${journey.programName} (${journey.programId})`);
  return journey;
}

async function editProgram(page, journey) {
  await ensureProgram(page, journey);
  const programsPage = new ProgramsPage(page);
  const detailPage = new ProgramDetailPage(page);

  await programsPage.goto();
  await programsPage.openProgramByName(journey.programName);
  await detailPage.openEdit();
  await detailPage.editProgramFields({ description: 'Updated by Playwright automation' });
}

module.exports = { ensureProgram, editProgram };
