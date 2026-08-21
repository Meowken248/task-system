const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('PAGE LOG ERROR:', msg.text());
    }
  });

  page.on('pageerror', err => {
    console.log('PAGE ERROR:', err.toString());
  });

  console.log('Navigating to http://localhost:3000');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });

  // Wait for the workspace to load and redirect to a project
  await page.waitForSelector('button', { timeout: 10000 });
  await new Promise(r => setTimeout(r, 2000));
  
  console.log('Current URL:', page.url());

  // Find the layout buttons. In the header there is a group of buttons.
  // The layout buttons have tooltips, but we can find them by the icons.
  // The display button contains the text "Hiển thị" (Display) or has a specific class.
  // The Analytics button contains "Phân tích" (Analytics).
  
  const buttons = await page.$$('button');
  console.log(`Found ${buttons.length} buttons.`);
  
  for (let i = 0; i < buttons.length; i++) {
    const text = await page.evaluate(el => el.textContent, buttons[i]);
    const className = await page.evaluate(el => el.className, buttons[i]);
    
    // We want to test clicks on the top right buttons.
    // Let's just click the ones matching specific classes or texts.
    if (text.includes('Hiển thị') || text.includes('Display')) {
      console.log('Clicking Display button...');
      await buttons[i].click();
      await new Promise(r => setTimeout(r, 1000));
    }
    
    if (text.includes('Phân tích') || text.includes('Analytics')) {
      console.log('Clicking Analytics button...');
      await buttons[i].click();
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // Find layout buttons by looking for the grid/list icons inside
  // They are usually grouped in a div with "bg-layer-3".
  const layoutButtons = await page.$$('.bg-layer-3 button');
  console.log(`Found ${layoutButtons.length} layout buttons.`);
  for (let i = 0; i < layoutButtons.length; i++) {
    console.log(`Clicking layout button ${i}...`);
    await layoutButtons[i].click();
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('Done testing buttons.');
  await browser.close();
})();
