// Mocked account only: never writes to the local or remote application server.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.UI_BASE_URL||'http://127.0.0.1:5173';
(async()=>{
  fs.mkdirSync('.local/avatar-colors',{recursive:true});
  const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
  const context=await browser.newContext();
  const draft={ipTheme:'罗小黑战记',personaTags:[],quote:'',signatureAction:'',ability:'',isDefault:true,version:1};
  const profile={accountId:'test-avatar',displayName:'敏',mbti:'ENFJ',roles:[{...draft,id:'r1',name:'无限',generation:{status:'queued',taskId:'job1'}},{...draft,id:'r2',name:'鹿野',avatarColor:'#82AEED'}]};
  let failSave=true;const writes=[],errors=[];
  await context.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url()),method=req.method();let data={},status=200;
    if(method!=='GET')writes.push({path:url.pathname,body:req.postDataJSON()});
    if(url.pathname==='/api/profile/me'){
      if(method==='PUT'){
        assert.deepEqual(Object.keys(req.postDataJSON()),['avatarColor']);
        if(failSave){failSave=false;return route.fulfill({status:503,json:{ok:false,error:'测试保存失败，请重试'}});}
        profile.avatarColor=req.postDataJSON().avatarColor.toUpperCase();
      }
      data={profile};
    }else if(url.pathname==='/api/rooms/recent')data={rooms:[{code:'ABCD23',name:'今晚入戏',ipTheme:'罗小黑战记',status:'running',currentGame:'auction',playerRole:'无限',memberCount:3,canReenter:true},{code:'EFGH45',name:'上次聚会',ipTheme:'罗小黑战记',status:'settled',currentGame:null,memberCount:4,canReenter:false}]};
    else if(url.pathname.startsWith('/api/profile/me/roles/')&&method==='PUT'){
      const role=profile.roles.find(r=>r.id===url.pathname.split('/').pop());assert(role);Object.assign(role,req.postDataJSON());role.version++;data={role};
    }else{errors.push(`Unexpected API: ${method} ${url.pathname}`);status=400;}
    await route.fulfill({status,json:{ok:status===200,data}});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:375,height:812});await page.goto(base);
  await page.getByRole('button',{name:'我的设置'}).click();
  const personal=page.getByLabel('个人头像颜色颜色值');
  await personal.fill('#112233');await page.getByRole('button',{name:'保存颜色',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'测试保存失败'}).waitFor();assert.equal(await personal.inputValue(),'#112233');assert.equal(profile.avatarColor,undefined);
  await personal.fill('#BAD');assert.equal(await page.getByRole('button',{name:'保存颜色',exact:true}).isDisabled(),true);
  await personal.fill('#112233');await page.getByRole('button',{name:'保存颜色',exact:true}).click();
  await page.getByText('头像颜色已保存',{exact:true}).waitFor();assert.equal(profile.avatarColor,'#112233');
  await page.getByRole('button',{name:/无限/}).click();
  const roleColor=page.getByLabel('角色头像颜色颜色值');await roleColor.fill('#456789');
  profile.roles[0].ability='后台补全的能力';profile.roles[0].generation={status:'complete',taskId:'job1'};profile.roles[0].version++;
  await page.waitForTimeout(3400);assert.equal(await roleColor.inputValue(),'#456789');
  await page.getByRole('button',{name:'保存角色',exact:true}).click();
  await page.getByRole('button',{name:'保存角色',exact:true}).waitFor({state:'hidden'});
  assert.equal(profile.roles[0].avatarColor,'#456789');assert.equal(profile.roles[1].avatarColor,'#82AEED');
  assert.equal(writes.filter(w=>w.path==='/api/profile/me/roles/r1').length,1);
  assert.equal(writes.filter(w=>w.path==='/api/profile/me').length,2);
  for(const width of [320,375,430,768,1024,1440]){
    await page.setViewportSize({width,height:812});await page.reload();
    await page.getByRole('button',{name:'我的设置'}).waitFor();
    assert.equal(await page.locator('.personal-avatar').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(17, 34, 51)');
    assert.equal(await page.locator('.profile-strip .role-glyph').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(69, 103, 137)');
    assert.equal(await page.getByRole('button',{name:'重新进入',exact:true}).evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(232, 180, 90)');
    assert.equal(await page.getByRole('button',{name:'已结束',exact:true}).isDisabled(),true);
    if([375,1440].includes(width))await page.screenshot({path:`.local/avatar-colors/home-${width}.png`});
    await page.getByRole('button',{name:'我的设置'}).click();
    assert.equal(await personal.inputValue(),'#112233');
    await page.getByRole('button',{name:/无限/}).click();assert.equal(await roleColor.inputValue(),'#456789');
    await roleColor.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    const rect=await roleColor.boundingBox();assert(rect.x>=0&&rect.x+rect.width<=width);
    if([375,1440].includes(width))await page.screenshot({path:`.local/avatar-colors/settings-${width}.png`});
  }
  assert.deepEqual(errors,[]);await browser.close();
  console.log('Avatar UI passed: retry, validation, independent colors, background refresh, reload, 6 widths, unchanged reentry/disabled states.');
})().catch(e=>{console.error(e);process.exitCode=1;});
