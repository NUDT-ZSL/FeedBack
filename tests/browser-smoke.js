const { chromium } = require('playwright');
const fs = require('fs');
const candidates=[process.env.PLAYWRIGHT_CHROME,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
const executablePath=candidates.find(p=>fs.existsSync(p));
(async()=>{
  const browser = await chromium.launch({headless:true, executablePath});
  const page = await browser.newPage({viewport:{width:1600,height:900}});
  const errors=[];
  page.on('pageerror',e=>errors.push('pageerror: '+e.message));
  page.on('console',msg=>{ if(msg.type()==='error') errors.push('console: '+msg.text()); });
  await page.goto('file:///'+process.cwd().replace(/\\/g,'/')+'/index.html',{waitUntil:'networkidle'});
  await page.waitForTimeout(500);
  const text = await page.locator('body').innerText();
  for(const needle of ['空间剖切与测量工作台','PUMP-01','被遮挡','增量']) {
    if(!text.includes(needle)) errors.push('missing text '+needle);
  }
  await page.selectOption('#measureType','point-point');
  await page.fill('#pointA','0,0,0');
  await page.fill('#pointB','10,0,0');
  await page.click('#addMeasure');
  await page.waitForTimeout(100);
  const before = await page.locator('#sections').innerText();
  await page.fill('#off','1.2');
  await page.dispatchEvent('#off','change');
  await page.waitForTimeout(150);
  const after = await page.locator('#sections').innerText();
  if(after === before) errors.push('section list did not update after plane move');
  await page.click('#btnBad');
  await page.waitForTimeout(150);
  const badText = await page.locator('#rejections').innerText();
  if(!badText.includes('包围尺寸必须') || !badText.includes('VALVE-BAD → GHOST-PUMP → <不存在>') || !badText.includes('LOOP-A')) errors.push('rejection details missing');

  if(errors.length){ console.error(errors.join('\n')); await browser.close(); process.exit(1); }
  console.log('browser smoke check passed');
  await browser.close();
})();
