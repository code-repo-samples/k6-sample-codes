const { NavigationBar } = require('../pages/NavigationBar');
const { OrganizationsPage } = require('../pages/OrganizationsPage');

async function createOrganization(page) {
  const nav = new NavigationBar(page);
  const organizationsPage = new OrganizationsPage(page);

  await nav.goTo('Organisations');
  await organizationsPage.expectOnPage();

  const name = `TestOrg-${Date.now()}`;
  await organizationsPage.createOrganization(name);
  console.log(`[flow:organization] created ${name}`);
  return name;
}

module.exports = { createOrganization };
