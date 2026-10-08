const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
// Each scenario uses a fresh browser profile and intercepted API responses.
const out=process.env.HELP_SMOKE_OUTPUT||path.resolve(__dirname, '../../output/help-browser'),wallet=process.env.WALLET_REPO||path.resolve(__dirname, '../..');
fs.mkdirSync(out, { recursive: true });
const { updates: records } = require('./fixtures.cjs');
const sources=['gero-blog','cardano-news','midnight-news','bitcoin-news','gero-x','nexus-x'].map(source=>({source,status:source==='midnight-news'?'stale':'fresh',mode:source==='midnight-news'?'manual':'automatic',lastReviewedAt:'2026-09-01T00:00:00Z',lastSuccessfulSyncAt:'2026-10-08T20:00:00Z'}));
let offline=false,empty=false;const requests=[],errors=[];
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'gero-help-updates-')),extension=path.join(wallet,'extension');
 const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1360,height:1000},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 try{
  await context.route(/^https?:/,async route=>{
   const u=new URL(route.request().url());requests.push({path:u.pathname,source:u.searchParams.get('source'),chain:u.searchParams.get('chain')});
   if (!offline && u.pathname === '/api/blog/articles') return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({posts:[{id:'fallback',slug:'available-blog',title:'Legacy Blog is still readable',excerpt:'A published post',publishDate:'2026-01-01T00:00:00Z',tags:[],readingTime:2}],total:1,hasMore:false})});
   if(offline||u.pathname!=='/api/help/updates')return route.abort();
   const source=u.searchParams.get('source'),chain=u.searchParams.get('chain');
   const items=empty?[]:records.filter(i=>(source==='all'||i.source===source||source==='ecosystem-news'&&i.kind==='news')&&(chain==='all'||i.chain==='all'||i.chain===chain));
   const offset=u.searchParams.has('cursor')?20:0;
   return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({items:items.slice(offset,offset+20),total:items.length,nextCursor:offset+20<items.length?'page-two':null,sources})});
  });
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),base='chrome-extension://'+new URL(worker.url()).host;
  const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(base+'/index.html#/help/updates?chain=all&source=all');
  await page.locator('.update-row').first().waitFor();assert.equal(await page.locator('.update-row').count(),20);
  await page.getByRole('button',{name:'Load more updates',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.update-row').length===40);
  await page.locator('.updates-freshness summary').click();assert.ok((await page.locator('.updates-freshness').innerText()).includes('Last available snapshot'));
  await page.screenshot({path:path.join(out,'updates-all-desktop.png'),fullPage:true});
  await page.getByRole('link',{name:'Nexus on X',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.update-row').length===2);
  assert.ok(page.url().includes('source=nexus-x'));assert.equal(await page.locator('.update-title[target="_blank"]').count(),2);
  for(const a of await page.locator('.update-title').all())assert.match(await a.getAttribute('href'),/^https:\/\/x\.com\/i\/web\/status\/[0-9]+$/);
  await page.screenshot({path:path.join(out,'updates-nexus-posts.png'),fullPage:true});
  await page.getByRole('link',{name:'Ecosystem news',exact:true}).click();await page.locator('.help-chain select').selectOption('midnight');
  await page.waitForFunction(()=>document.querySelectorAll('.update-row').length===3);await page.locator('.updates-freshness summary').click();assert.ok((await page.locator('.updates-freshness').innerText()).includes('Midnight'));
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(out,'updates-midnight-mobile.png'),fullPage:true});
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement?.tagName==='BODY'),false);
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),true);
  await page.setViewportSize({width:1360,height:1000});
  await page.evaluate(async()=>{const m=await import('./js/activityTracker.service.js');window.helpSmokeStores=m;const w={id:90012,name:'Synthetic Updates',chain:'Midnight',network:'Mainnet',type:'Normal',icon:'gero'};m.geroStore.wallets={[w.id]:w};m.walletStore.loggedWallet=w;m.walletStore.isSyncing=false;m.walletStore.isLocked=false;});
  await page.locator('.help-public-header').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelectorAll('.update-row').length===3);
  offline=true;const before=page.url();await page.evaluate(()=>window.helpSmokeStores.walletStore.isLocked=true);
  await page.locator('.help-public-header').waitFor();await page.waitForFunction(()=>document.body.innerText.includes('Showing saved updates'));
  assert.equal(page.url(),before);assert.equal(await page.locator('.update-row').count(),3);
  await page.screenshot({path:path.join(out,'updates-locked-outage.png'),fullPage:true});
  offline=false;empty=true;await page.getByRole('button',{name:'Try again',exact:true}).click();await page.waitForFunction(()=>document.body.innerText.includes('No published updates'));
  assert.equal(await page.locator('.update-row').count(),0);assert.ok(await page.locator('.updates-originals a[href="https://midnight.network/blog"]').count());
  sources.find(s=>s.source==='gero-blog').status='unavailable';
  await page.goto(base+'/index.html#/help/updates?source=blog&chain=all');
  await page.locator('.blog-card__title').waitFor();
  assert.equal(await page.locator('.blog-card__title').innerText(),'Legacy Blog is still readable');
  assert.equal(await page.getByText('No published updates match this view.').count(),0);
  await page.screenshot({path:path.join(out,'unavailable-blog-fallback.png'),fullPage:true});
  assert.deepEqual(errors,[]);assert.equal(requests.filter(r=>/support-chat|chatwoot/.test(r.path)).length,0);
  fs.writeFileSync(path.join(out,'updates-browser-results.json'),JSON.stringify({passed:true,syntheticFixtures:records.length,interceptedApi:true,liveBackend:false,checks:['source filters','40-row pagination','separate manual freshness','original links','390px layout','keyboard focus','reduced motion','lock/outage cache','authoritative empty withdrawal','200 unavailable Blog fallback'],errors,requests:requests.filter(r=>r.path.startsWith('/api/help'))},null,2));
  console.log(JSON.stringify({passed:true,syntheticFixtures:records.length,errors}));
 }catch(error){const page=context.pages().at(-1);await page.screenshot({path:path.join(out,'updates-failure.png'),fullPage:true}).catch(()=>{});console.error((await page.locator('body').innerText()).slice(0,2200));throw error;}
 finally{await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
