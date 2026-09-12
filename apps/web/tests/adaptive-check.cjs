const assert=require('node:assert/strict');
const path=require('node:path');
// PLAYWRIGHT_MODULE can point at an existing local Playwright installation.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const cases=[['auth'],['home'],['mbti'],['role'],['room'],['dont'],['must'],['witch','bury'],['witch','investigate'],['camera'],['draw'],['imitate'],['truth','setup'],['truth','voting'],['truth','reveal'],['auction','init'],['auction','setup'],['auction','preview'],['auction','bidding'],['auction','complete'],['shopping','shopping'],['shopping','complete'],...['setup','relay','reveal','voting','review','complete'].map(s=>['story',s]),...['setup','speaking','voting','complete'].map(s=>['undercover',s])];
(async()=>{
 const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
 const page=await browser.newPage();let checks=0;const failures=[];
 page.on('pageerror',e=>failures.push({error:e.message}));
 await page.route('**/api/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,data:{timeline:{items:[]}}})}));
 for(const width of [320,375,430,768,1024,1440]){
  await page.setViewportSize({width,height:800});
  for(const [game,stage='relay']of cases){
   await page.goto(`http://127.0.0.1:5173/tests/adaptive.html?game=${game}&stage=${stage}`);
   await page.locator('main').waitFor();
   const result=await page.evaluate(()=>{
    const main=document.querySelector('main'),w=innerWidth;
    const overflow=[...document.querySelectorAll('main *')].filter(el=>{
     if(!el.getClientRects().length||el.closest('dialog:not([open])'))return false;
     const rect=el.getBoundingClientRect(),style=getComputedStyle(el);
     return style.position!=='fixed'&&(rect.right>w+2||rect.left< -2);
    }).slice(0,5).map(el=>el.className||el.tagName);
    return {overflow,empty:!main?.textContent?.trim()};
   });
   if(result.overflow.length||result.empty)failures.push({width,game,stage,...result});checks++;
  }
 }
 await page.goto('http://127.0.0.1:5173/tests/adaptive.html?game=disclosure');
 await page.setViewportSize({width:375,height:667});
 await page.getByText('长记录',{exact:true}).click();
 await page.getByRole('textbox',{name:'草稿'}).fill('保留草稿');
 await page.getByRole('button',{name:/模拟同步/}).click();
 assert.equal(await page.locator('details').getAttribute('open'),'');
 assert.equal(await page.getByRole('textbox',{name:'草稿'}).inputValue(),'保留草稿');
 await page.setViewportSize({width:1440,height:800});
 assert.equal(await page.getByRole('textbox',{name:'草稿'}).inputValue(),'保留草稿');
 await page.getByRole('button',{name:'打开抽屉'}).click();
 await page.getByRole('button',{name:'保存',exact:true}).scrollIntoViewIfNeeded();
 assert(await page.getByRole('button',{name:'保存',exact:true}).isVisible());
 await page.keyboard.press('Escape');
 assert.equal(await page.locator('dialog').count(),0);
 assert.equal(await page.evaluate(()=>document.activeElement.textContent),'打开抽屉');
 for(const size of [{width:667,height:375},{width:720,height:400}]){
  await page.setViewportSize(size);
  await page.getByRole('button',{name:'底部主操作'}).scrollIntoViewIfNeeded();
  const rect=await page.getByRole('button',{name:'底部主操作'}).boundingBox();
  assert(rect.y>=0&&rect.y+rect.height<=size.height+1);
 }
 await page.goto('http://127.0.0.1:5173/tests/adaptive.html?game=draw');
 await page.setViewportSize({width:430,height:800});
 const canvas=page.locator('canvas'),rect=await canvas.boundingBox();
 await page.mouse.move(rect.x+20,rect.y+20);await page.mouse.down();await page.mouse.move(rect.x+90,rect.y+70);await page.mouse.up();
 const before=await canvas.evaluate(c=>c.toDataURL());await page.setViewportSize({width:1440,height:800});
 assert.equal(await canvas.evaluate(c=>c.toDataURL()),before);
 for(const width of [375,1440]){
  await page.setViewportSize({width,height:800});
  await page.goto('http://127.0.0.1:5173/tests/adaptive.html?game=shopping&stage=shopping');
  await page.screenshot({path:path.resolve(`.local/adaptive-shopping-${width}.png`),fullPage:true});
 }
 await browser.close();console.log(JSON.stringify({checks,failures,interactions:'disclosure, draft preservation, dialog, short viewport and canvas passed'},null,2));
 if(failures.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1)});
