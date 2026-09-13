const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const path=require('node:path');
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();let generated=false,saved=false,profileReads=0;
  const role={id:'r1',ipTheme:'罗小黑战记',name:'无限',personaTags:[],quote:'',signatureAction:'',ability:'',isDefault:true,version:1};
  const profile={accountId:'p1',displayName:'测试玩家',mbti:'INFP',mbtiCompletedAt:null,roles:[role]};
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{const url=new URL(route.request().url());let data={};let status=200;
    if(url.pathname==='/api/profile/me'){profileReads++;data={profile};}
    else if(url.pathname==='/api/rooms/recent')data={rooms:[]};
    else if(url.pathname==='/api/profile/me/role-generation'){generated=true;role.generation={status:'queued',taskId:'job1',message:'已保存，资料补全中'};role.version++;data={role,task:{id:'job1',status:'queued'}};status=202;}
    else if(url.pathname==='/api/profile/me/roles/r1'){saved=true;Object.assign(role,route.request().postDataJSON());role.version++;data={role};}
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify({ok:true,data})});
  });
  for(const width of [375,1024]){
    await page.setViewportSize({width,height:812});await page.goto('http://127.0.0.1:5174');
    await page.getByRole('button',{name:'我的设置',exact:true}).click();
    await page.getByRole('button',{name:/无限/}).click();
    assert.equal(await page.getByLabel('IP 主题',{exact:true}).inputValue(),'罗小黑战记');
    await page.getByText('角色资料',{exact:false}).first().waitFor();
    assert.equal(await page.locator('details.role-details').getAttribute('open'),null);
    if(width===375){
      await page.getByRole('button',{name:'AI 生成',exact:false}).click();assert.equal(generated,true);
      await page.getByRole('button',{name:'保存角色',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'保存角色',exact:true}).isEnabled(),true);
      await page.locator('details.role-details summary').click();await page.getByLabel('代表台词',{exact:true}).fill('手动修改，保留这句');
      await page.screenshot({path:path.resolve('../../.local/role-mobile-generating.png'),fullPage:true});
      await page.getByRole('button',{name:'保存角色',exact:true}).click();assert.equal(saved,true);
      await page.getByRole('button',{name:'返回',exact:true}).click();
      role.ability='金属操控';role.generation={status:'complete',taskId:'job1',message:'资料已自动补全'};role.version++;
      await page.waitForTimeout(3300);assert(profileReads>=2);
    }else await page.screenshot({path:path.resolve('../../.local/role-desktop.png'),fullPage:true});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false);
  }
  assert.deepEqual(errors,[]);await browser.close();console.log('Role UI: mobile/desktop, save while generating, leave and refresh, no overflow passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
