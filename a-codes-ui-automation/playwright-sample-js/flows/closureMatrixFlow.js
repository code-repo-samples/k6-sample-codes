const { ClosureMatrixPage } = require('../pages/ClosureMatrixPage');

async function createClosureList(page) {
  const closureMatrixPage = new ClosureMatrixPage(page);
  await closureMatrixPage.createClosureList(`TestList-${Date.now()}`, ['Coke Zero', 'Coke Zero Cherry']); // VERIFY
}

module.exports = { createClosureList };
