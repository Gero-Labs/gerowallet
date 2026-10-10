const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const { fitShot, imageLoaded, scrollsSideways, acceptHelpEvents, anonymousEvents } = require('./helpers.cjs');
// Each scenario uses a fresh browser profile and intercepted API responses.
const out=process.env.HELP_SMOKE_OUTPUT||path.resolve(__dirname, '../../output/help-browser'),wallet=process.env.WALLET_REPO||path.resolve(__dirname, '../..');
fs.mkdirSync(out, { recursive: true });
const shot=name=>path.join(out,name);
const { updates: records, updateSources, updatesPage, mediaResponse, BLOG_THUMB, X_IMAGES } = require('./fixtures.cjs');
// Midnight is the stale source in these fixtures; the backend reports the rest as fresh.
const sources=updateSources();
const STALE='Midnight is showing its last available snapshot, checked Sep 1, 2026.';
let offline=false,empty=false;const requests=[],errors=[],eventBodies=[];
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'gero-help-updates-')),extension=path.join(wallet,'extension');
 const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1360,height:1000},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 try{
  await context.route(/^https?:/,async route=>{
   const u=new URL(route.request().url());requests.push({path:u.pathname,source:u.searchParams.get('source'),chain:u.searchParams.get('chain')});
   if(!offline&&await acceptHelpEvents(route,eventBodies))return;
   const media=mediaResponse(u.pathname);
   if(media&&!offline)return route.fulfill(media);
   if (!offline && u.pathname === '/api/blog/articles') return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({posts:[{id:'fallback',slug:'available-blog',title:'Legacy Blog is still readable',excerpt:'A published post',publishDate:'2026-01-01T00:00:00Z',tags:[],readingTime:2}],total:1,hasMore:false})});
   if(offline||u.pathname!=='/api/help/updates')return route.abort();
   return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(updatesPage(u.searchParams,sources,empty))});
  });
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),base='chrome-extension://'+new URL(worker.url()).host;
  const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));
  const header=page.locator('header.help-header'),rows=page.locator('.update-row'),warning=page.locator('.updates-warning'),pills=page.locator('.source-pills .help-pill');
  const pill=name=>pills.filter({hasText:new RegExp('^'+name+'$')});
  const rowCount=count=>page.waitForFunction(n=>document.querySelectorAll('.update-row').length===n,count);

  // --- Updates page: pills with freshness dots, always-visible stale notice, rows with media ---
  await page.goto(base+'/index.html#/help/updates?chain=all&source=all');
  await rows.first().waitFor();assert.equal(await rows.count(),20);
  assert.equal(await page.getByRole('heading',{level:1}).textContent(),'Updates');
  assert.deepEqual(await pills.allTextContents(),['All updates','Gero blog','Cardano','Midnight','Bitcoin Core updates','Gero on X','Nexus on X']);
  assert.equal(await pill('All updates').getAttribute('aria-pressed'),'true');
  assert.equal(await pill('All updates').locator('.pill-dot').count(),0,'The All pill has no freshness dot');
  assert.equal(await pills.locator('.pill-dot').count(),6);
  assert.equal(await pills.locator('.pill-dot--stale').count(),1);
  assert.equal(await pill('Midnight').locator('.pill-dot--stale').count(),1);
  assert.equal(await pill('Midnight').getAttribute('aria-label'),'Midnight, Last available snapshot');
  assert.equal(await pill('Gero blog').getAttribute('aria-label'),'Gero blog, Up to date');
  await warning.waitFor();assert.equal(await page.locator('.updates-freshness').count(),0,'No collapsed <details> any more');
  assert.equal(await page.locator('details').count(),0);
  const notice=await warning.innerText();
  assert.ok(notice.includes(STALE)&&notice.includes('The other 5 sources are up to date.'),notice);
  const blogRow=rows.nth(0);
  assert.equal(await blogRow.evaluate(row=>row.tagName),'A');assert.match(await blogRow.getAttribute('href'),/#\/blog\/fixture-blog-post\?chain=all$/);
  assert.equal(await blogRow.locator('.update-icon').count(),1);
  assert.equal(await blogRow.locator('.update-caption').innerText(),'Gero blog · Jan 3, 2026');
  assert.equal(await blogRow.locator('h2.update-title').textContent(),'Fixture Gero blog post');
  assert.equal(await blogRow.locator('.update-summary').textContent(),'Synthetic blog summary with a thumbnail.');
  assert.equal(await blogRow.locator('.update-arrow').count(),1);
  const thumb=await imageLoaded(blogRow.locator('img.update-thumb'));assert.ok(thumb.src.endsWith(BLOG_THUMB),thumb.src);
  assert.equal(await rows.nth(1).locator('.update-thumb').count(),0,'No empty thumbnail frame');
  const news=rows.nth(2);assert.equal(await news.getAttribute('target'),'_blank');assert.match(await news.getAttribute('href'),/^https:\/\/cardano\.org\//);
  await fitShot(page,shot('help-updates-desktop.png'));
  await page.getByRole('button',{name:'Load more updates',exact:true}).click();await rowCount(40);
  await fitShot(page,shot('updates-all-desktop.png'));

  // --- One source at a time: posts on X carry their image, and only the stale source warns ---
  await pill('Nexus on X').click();await rowCount(2);
  assert.ok(page.url().includes('source=nexus-x'));assert.equal(await page.locator('a.update-row[target="_blank"]').count(),2);
  for(const a of await rows.all())assert.match(await a.getAttribute('href'),/^https:\/\/x\.com\/i\/web\/status\/[0-9]+$/);
  const nexusImage=await imageLoaded(rows.nth(0).locator('img.update-media'));assert.ok(nexusImage.src.endsWith(X_IMAGES['nexus-x']),nexusImage.src);
  assert.equal(await rows.nth(1).locator('img.update-media').count(),0);
  assert.equal(await warning.count(),0,'A fresh source shows no notice');
  await fitShot(page,shot('updates-nexus-posts.png'));
  await pill('Gero blog').click();await rowCount(2);
  assert.equal(await page.locator('img.update-thumb').count(),1);assert.equal(await warning.count(),0);

  // --- Home widgets: the blog thumbnail, the X post image and the Gero/Nexus switch ---
  await page.goto(base+'/index.html#/help?chain=all');
  const blogCard=page.locator('section.blog'),xCard=page.locator('section.xcard'),newsCard=page.locator('section.news');
  await blogCard.locator('.blog-link').waitFor();
  assert.equal(await blogCard.locator('.blog-link').textContent(),'Fixture Gero blog post');
  assert.equal(await blogCard.locator('.blog-foot').innerText(),'Gero · Jan 3, 2026');
  const homeThumb=await imageLoaded(blogCard.locator('img.blog-thumb'));assert.ok(homeThumb.src.endsWith(BLOG_THUMB),homeThumb.src);
  const toggle=xCard.getByRole('group',{name:'Account'});
  await xCard.locator('.x-text').waitFor();
  assert.equal(await toggle.getByRole('button',{name:'Gero',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await toggle.getByRole('button',{name:'Nexus',exact:true}).getAttribute('aria-pressed'),'false');
  assert.ok((await xCard.locator('.x-text').innerText()).includes('Synthetic gero-x post 1'));
  const geroImage=await imageLoaded(xCard.locator('img.x-media'));assert.ok(geroImage.src.endsWith(X_IMAGES['gero-x']),geroImage.src);
  assert.equal(await xCard.locator('img.x-media').getAttribute('alt'),'Synthetic gero-x post image');
  assert.equal(await xCard.getByRole('link',{name:/View on X/}).getAttribute('href'),'https://x.com/i/web/status/1');
  await toggle.getByRole('button',{name:'Nexus',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('section.xcard .x-text')?.textContent.includes('nexus-x'));
  assert.equal(await toggle.getByRole('button',{name:'Nexus',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await toggle.getByRole('button',{name:'Gero',exact:true}).getAttribute('aria-pressed'),'false');
  assert.ok((await xCard.locator('.x-name').innerText()).includes('Nexus on X'));
  const nexusHome=await imageLoaded(xCard.locator('img.x-media'));assert.ok(nexusHome.src.endsWith(X_IMAGES['nexus-x']),nexusHome.src);
  await newsCard.locator('.news-row').first().waitFor();assert.equal(await newsCard.locator('.news-row').count(),3);
  assert.equal((await newsCard.locator('.news-fresh').innerText()).trim(),'Last available snapshot');assert.equal(await newsCard.locator('.news-fresh__dot--stale').count(),1);
  await page.setViewportSize({width:1280,height:1900});await fitShot(page,shot('updates-home-widgets.png'));await page.setViewportSize({width:1360,height:1000});

  // --- Chain filter keeps the stale notice specific to what is shown ---
  await page.goto(base+'/index.html#/help/updates?chain=all&source=all');await rows.first().waitFor();
  await header.getByRole('link',{name:'Overview'}).click();await page.locator('.chain-pills').getByRole('button',{name:'Midnight',exact:true}).click();
  await header.getByRole('link',{name:'Updates',exact:true}).click();await rowCount(9);
  assert.ok(page.url().includes('chain=midnight'));
  assert.deepEqual(await pills.allTextContents(),['All updates','Gero blog','Midnight','Gero on X','Nexus on X']);
  assert.ok((await warning.innerText()).includes('The other 3 sources are up to date.'));
  await pill('Midnight').click();await rowCount(3);
  assert.ok(page.url().includes('source=midnight-news'));
  assert.equal((await warning.innerText()).trim(),STALE,'One stale source, nothing else to add');
  assert.ok((await rows.first().locator('.update-caption').innerText()).endsWith('Last available snapshot'));
  await page.setViewportSize({width:390,height:844});assert.equal(await scrollsSideways(page),false);
  await fitShot(page,shot('updates-midnight-mobile.png'));
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement?.tagName==='BODY'),false);
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),true);
  await page.setViewportSize({width:1360,height:1000});

  await page.waitForTimeout(2600); // Usage events are posted after 2 s without a new one; flush them before the outage below.

  // --- Lock and outage: the saved list and notice stay, then an authoritative empty list wins ---
  await page.evaluate(async()=>{const m=await import('./js/activityTracker.service.js');window.helpSmokeStores=m;const w={id:90012,name:'Synthetic Updates',chain:'Midnight',network:'Mainnet',type:'Normal',icon:'gero'};m.geroStore.wallets={[w.id]:w};m.walletStore.loggedWallet=w;m.walletStore.isSyncing=false;m.walletStore.isLocked=false;});
  await header.waitFor({state:'hidden'});await rowCount(3);
  offline=true;const before=page.url();await page.evaluate(()=>window.helpSmokeStores.walletStore.isLocked=true);
  await header.waitFor();await page.waitForFunction(()=>document.body.innerText.includes('Showing saved updates'));
  assert.equal(page.url(),before);assert.equal(await rows.count(),3);assert.ok((await warning.innerText()).includes(STALE));
  await fitShot(page,shot('updates-locked-outage.png'));
  offline=false;empty=true;await page.getByRole('button',{name:'Try again',exact:true}).click();await page.waitForFunction(()=>document.body.innerText.includes('No published updates'));
  assert.equal(await rows.count(),0);assert.ok(await page.locator('.updates-originals a[href="https://midnight.network/blog"]').count());

  // --- An unavailable Gero blog source falls back to the legacy Blog list ---
  sources.find(s=>s.source==='gero-blog').status='unavailable';
  await page.goto(base+'/index.html#/help/updates?source=blog&chain=all');
  await page.locator('.blog-card__title').waitFor();
  assert.equal(await page.locator('.blog-card__title').innerText(),'Legacy Blog is still readable');
  assert.equal(await page.getByText('No published updates match this view.').count(),0);
  assert.equal((await warning.innerText()).trim(),'Gero blog is unavailable right now.');
  await fitShot(page,shot('unavailable-blog-fallback.png'));
  assert.deepEqual(errors,[]);assert.equal(requests.filter(r=>/support-chat|chatwoot/.test(r.path)).length,0);
  const events=anonymousEvents(assert,eventBodies,['90012','Synthetic Updates']);
  assert.deepEqual(['nexus-x','gero-blog','midnight-news'].filter(subject=>!events.some(e=>e.type==='updates_filter'&&e.surface==='help'&&e.subject===subject)),[],'Source pill changes are counted');
  fs.writeFileSync(path.join(out,'updates-browser-results.json'),JSON.stringify({passed:true,syntheticFixtures:records.length,interceptedApi:true,liveBackend:false,usageEvents:events.length,checks:['source pills with freshness dots','always-visible stale-source notice','40-row pagination','blog thumbnail and X post image on Updates and Home','Gero/Nexus switch','original links','390px layout','keyboard focus','reduced motion','lock/outage cache','authoritative empty withdrawal','200 unavailable Blog fallback'],errors,requests:requests.filter(r=>r.path.startsWith('/api/help'))},null,2));
  console.log(JSON.stringify({passed:true,syntheticFixtures:records.length,errors}));
 }catch(error){const page=context.pages().at(-1);await page.screenshot({path:path.join(out,'updates-failure.png'),fullPage:true}).catch(()=>{});console.error((await page.locator('body').innerText()).slice(0,2200));throw error;}
 finally{await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
