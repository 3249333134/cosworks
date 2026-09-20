const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.UI_BASE_URL||'http://127.0.0.1:5173';
(async()=>{
  fs.mkdirSync('.local/auction-compact',{recursive:true});
  const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});const page=await browser.newPage();const errors=[],actions=[];
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=';
  const image='data:image/png;base64,'+png;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{
    const req=route.request();if(req.url().includes('/media/upload'))return route.fulfill({json:{ok:true,data:{assetId:'fixture-image',url:image,thumb:image,size:70,mime:'image/png',width:1,height:1}}});
    if(req.method()==='POST')actions.push({path:new URL(req.url()).pathname,body:req.postDataJSON()});
    await route.fulfill({json:{ok:true,data:{room:{},rooms:[],timeline:{items:[]}}}});
  });
  let checks=0;
  for(const size of [{width:320,height:568},{width:375,height:667},{width:390,height:844},{width:430,height:932},{width:768,height:800},{width:1440,height:900}]){
    await page.setViewportSize(size);await page.goto(`${base}/tests/adaptive.html?game=auction&stage=setup&interactive=1`);await page.locator('.auction-setup').waitFor();
    const visible=await page.evaluate(()=>{
      const selectors=['.play-header','.wallet-chip','.image-pickers','.field-row','.task-actions','.auction-footer'];
      return selectors.map(selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect();return {selector,inside:r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1};});
    });assert(visible.every(v=>v.inside),JSON.stringify({size,visible}));
    const clipped=await page.locator('.field-row').evaluate(el=>{const r=el.getBoundingClientRect();let parent=el.parentElement;while(parent){const s=getComputedStyle(parent),p=parent.getBoundingClientRect();if(['hidden','auto','scroll'].includes(s.overflowY)&&(r.top<p.top-1||r.bottom>p.bottom+1))return true;parent=parent.parentElement;}return false;});assert.equal(clipped,false,`fields clipped ${size.width}`);
    if([375,1440].includes(size.width))await page.screenshot({path:`.local/auction-compact/setup-${size.width}.png`});checks++;
  }
  await page.setViewportSize({width:375,height:667});await page.goto(`${base}/tests/adaptive.html?game=auction&stage=setup&interactive=1`);
  await page.getByLabel('相册或选择文件').setInputFiles({name:'test.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.getByText('已上传',{exact:true}).waitFor();
  await page.getByLabel('物品名称（1–20 字）').fill('测试钢笔');await page.getByLabel('起拍价 ¥',{exact:true}).fill('9.5');
  await page.setViewportSize({width:1440,height:900});assert.equal(await page.getByLabel('物品名称（1–20 字）').inputValue(),'测试钢笔');
  await page.setViewportSize({width:375,height:667});await page.screenshot({path:'.local/auction-compact/uploaded-375.png'});
  await page.getByRole('button',{name:'确认上传这件物品',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.auction-setup input[maxlength="20"]').value==='');
  const submission=actions.filter(a=>a.body.action==='auction-submit-item');assert.equal(submission.length,1);assert.deepEqual(submission[0].body.payload,{assetId:'fixture-image',title:'测试钢笔',story:'',reservePrice:'9.5'});
  await page.getByRole('button',{name:'预览拍品顺序',exact:true}).click();await page.waitForTimeout(100);
  assert.deepEqual(actions.find(a=>a.path.endsWith('/host-actions')).body,{action:'advance-stage',reason:'开始预览拍品'});
  await page.getByRole('button',{name:'查看本局规则',exact:true}).click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
  for(const width of [320,375,430,768,1440])for(const stage of ['init','preview','bidding','complete']){
    await page.setViewportSize({width,height:800});await page.goto(`${base}/tests/adaptive.html?game=auction&stage=${stage}&player=1`);await page.locator('main').waitFor();
    assert.equal(await page.evaluate(()=>[...document.querySelectorAll('main button,main input')].some(el=>{if(!el.getClientRects().length)return false;const r=el.getBoundingClientRect();return r.left< -1||r.right>innerWidth+1;})),false,`${width} ${stage}`);checks++;
  }
  await browser.close();assert.deepEqual(errors,[]);console.log(`Auction compact UI passed: ${checks} viewport/stage checks, visible setup fields, upload/submit payload, draft preservation and host action unchanged.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
