const { NavigationBar } = require('../pages/NavigationBar');
const { RealTimeTestPage } = require('../pages/RealTimeTestPage');

async function openRealTimeTest(page) {
  const nav = new NavigationBar(page);
  const realTimeTestPage = new RealTimeTestPage(page);

  await nav.goTo('Real Time Test');
  await realTimeTestPage.expectOnPage();
}

module.exports = { openRealTimeTest };
