const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
  page.on('requestfailed', request =>
    console.log('REQUEST FAILED:', request.url(), request.failure().errorText)
  );

  console.log("Navigating to localhost:8001...");
  await page.goto('http://localhost:8001', { waitUntil: 'networkidle0' }).catch(e => console.log(e));
  
  await browser.close();
})();

