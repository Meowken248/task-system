const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:3000/mock-workspace/browse/FIAI-1/');
  const result = await page.evaluate(() => {
    return localStorage.getItem('plane_dapp_db');
  });
  console.log(result ? 'Found DB with size: ' + result.length : 'No DB');
  const issues = JSON.parse(result || '{}').issues || [];
  console.log('Issue 1:', issues.find(i => i.sequence_id === 1));
  
  const testFetch = await page.evaluate(async () => {
    try {
      const r = await fetch('/api/workspaces/mock-workspace/projects/FIAI/issues/1/');
      return r.status;
    } catch(e) { return e.message; }
  });
  console.log('Client fetch status: ' + testFetch);
  await browser.close();
})();
