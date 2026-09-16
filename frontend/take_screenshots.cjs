const puppeteer = require('puppeteer');

(async () => {
  console.log("Launching headless browser...");
  const browser = await puppeteer.launch({ defaultViewport: { width: 1440, height: 900 } });
  const page = await browser.newPage();
  
  console.log("Navigating to http://localhost:8001...");
  await page.goto('http://localhost:8001', { waitUntil: 'networkidle0' });

  // 1. Take screenshot of 3D Digital Twin
  console.log("Navigating to 3D Portfolio...");
  await page.goto('http://localhost:8001/3d', { waitUntil: 'networkidle0' });
  // Wait a couple of seconds for the 3D scene to fully render
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: '3d_digital_twin.png' });
  console.log("Saved 3d_digital_twin.png");

  // 2. Take screenshot of Mobile Field Worker PWA
  console.log("Navigating to Inspections...");
  await page.goto('http://localhost:8001/inspections', { waitUntil: 'networkidle0' });
  // Wait a second for map/page
  await new Promise(r => setTimeout(r, 1000));
  // If there's a button to open camera, we click it. Otherwise, screenshot the page.
  // We'll just take a screenshot of the Inspections page.
  await page.screenshot({ path: 'mobile_pwa.png' });
  console.log("Saved mobile_pwa.png");

  await browser.close();
  console.log("Done.");
})();
