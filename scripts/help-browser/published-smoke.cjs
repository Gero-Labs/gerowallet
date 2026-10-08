const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
// Each scenario uses a fresh browser profile and intercepted API responses.
const out = process.env.HELP_SMOKE_OUTPUT || path.resolve(__dirname, '../../output/help-browser');
fs.mkdirSync(out, { recursive: true });
const wallet = process.env.WALLET_REPO || path.resolve(__dirname, '../..');
const { guides: documents } = require('./fixtures.cjs');
const topics = ['start','send','card','earn','security','fix'];
const sources = [{source:'gero-help',status:'fresh',lastSuccessfulSyncAt:'2026-10-08T00:00:00Z'}];
function summary(doc, locale) { const {body,assets,relatedArticleIds,...result}=doc; return {...result,requestedLocale:locale,resolvedLocale:'en-US',isLocaleFallback:locale!=='en-US'}; }
let offline = false;
const requests=[];
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'gero-help-stage3-'));
 const extension=path.join(wallet,'extension');
 const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1360,height:1000},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 const errors=[];
 try {
  await context.route(/^https?:/, async route=>{
   const u=new URL(route.request().url()); requests.push({path:u.pathname,locale:u.searchParams.get('locale'),cursor:u.searchParams.get('cursor')});
   if(!u.pathname.startsWith('/api/help/') || offline) return route.abort();
   const locale=u.searchParams.get('locale')||'en-US';
   const send = value=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value),headers:{'access-control-allow-origin':'*'}});
   if(u.pathname==='/api/help/home') return send({topics:topics.map(id=>({id,articles:documents.filter(doc=>doc.topic===id).map(doc=>summary(doc,locale))})),publicFeaturedArticles:documents.filter(doc=>['create','restore','backup'].includes(doc.id)).map(doc=>summary(doc,locale)),walletFeaturedArticles:Object.fromEntries(['cardano','midnight','bitcoin'].map(chain=>[chain,documents.filter(doc=>doc.applicability.chains.includes(chain)).slice(0,3).map(doc=>summary(doc,locale))])),sources,updatePreviews:[]});
   if(u.pathname.startsWith('/api/help/articles/')) {
    const doc=documents.find(doc=>doc.slug===decodeURIComponent(u.pathname.split('/').pop()));
    if(!doc) return route.fulfill({status:404,body:'',headers:{'access-control-allow-origin':'*'}});
    return send({article:doc,requestedLocale:locale,resolvedLocale:'en-US',isLocaleFallback:locale!=='en-US',sources});
   }
   const topic=u.searchParams.get('topic'),chain=u.searchParams.get('chain');
   let selected=documents.filter(doc=>(!topic||doc.topic===topic)&&(!chain||chain==='all'||!doc.applicability.chains.length||doc.applicability.chains.includes(chain)));
   const offset=u.searchParams.has('cursor')?20:0;
   const items=selected.slice(offset,offset+20).map(doc=>({...summary(doc,locale),destination:{type:'help-article',slug:doc.slug},snippet:doc.summary}));
   return send({[u.pathname.endsWith('/search')?'results':'items']:items,total:selected.length,nextCursor:offset+20<selected.length?'page-two':null,sources});
  });
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const base=worker.url().split('/').slice(0,3).join('/');
  const page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${base}/index.html#/help`);
  await page.locator('.help-ledger .help-answer-row').first().waitFor();
  await page.waitForFunction(()=>!document.querySelector('.help-content-status'));
  assert.equal(await page.locator('.help-topic').count(),6);
  await page.screenshot({path:path.join(out,'stage3-published-home.png'),fullPage:true});
  await page.locator('.help-chain select').selectOption('midnight');
  await page.locator('a.help-topic[href*="/card"]').click();
  await page.locator('.help-applicability').waitFor();
  await page.goto(`${base}/index.html#/help/search?q=wallet&chain=all`);
  await page.getByRole('button',{name:'Load more answers',exact:true}).waitFor();
  assert.equal(await page.locator('.help-ledger .help-answer-row').count(),20);
  await page.getByRole('button',{name:'Load more answers',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.help-ledger .help-answer-row').length===25);
  await page.locator('.help-ledger a[href*="midnight-proof"]').click();
  await page.locator('.help-rich-text ol').waitFor();
  assert.ok(page.url().includes('q=wallet'));
  assert.equal(await page.locator('.help-rich-text li').count(),4);
  await page.screenshot({path:path.join(out,'stage3-published-reader.png'),fullPage:true});
  await page.locator('.help-public-header .v-btn').last().click();
  await page.getByText('Deutsch',{exact:true}).click();
  await page.waitForFunction(()=>document.body.innerText.includes('während eine geprüfte Übersetzung'));
  assert.equal(await page.locator('.help-rich-text').getAttribute('lang'),'en-US');
  assert.ok(requests.some(request=>request.locale==='de-DE'));
  await page.screenshot({path:path.join(out,'stage3-language-fallback.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(out,'stage3-reader-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1360,height:1000});
  await page.evaluate(async()=>{
    const m=await import('./js/activityTracker.service.js'); window.helpSmokeStores=m;
    const w={id:90010,name:'Synthetic Help reader',chain:'Midnight',network:'Mainnet',type:'Normal',icon:'gero'};
    m.geroStore.wallets={[w.id]:w};m.walletStore.loggedWallet=w;m.walletStore.isSyncing=false;m.walletStore.isLocked=false;
  });
  await page.locator('.help-public-header').waitFor({state:'hidden'}); await page.locator('.help-rich-text ol').waitFor();
  const before=page.url(); offline=true;
  await page.evaluate(()=>{window.helpSmokeStores.walletStore.isLocked=true;});
  await page.locator('.help-public-header').waitFor(); await page.locator('.help-rich-text ol').waitFor();
  assert.equal(page.url(),before); assert.equal(await page.locator('.help-rich-text li').count(),4);
  await page.screenshot({path:path.join(out,'stage3-offline-locked-reader.png'),fullPage:true});
  offline=false;
  await page.goto(`${base}/index.html#/help/articles/withdrawn-guide`);
  await page.waitForFunction(()=>document.body.innerText.includes('Diese Antwort')||document.body.innerText.includes('nicht gefunden'));
  assert.equal(await page.locator('.help-rich-text').count(),0);
  assert.equal(await page.locator('.help-answer-body').count(),0);
  assert.deepEqual(errors,[]);
  assert.equal(requests.filter(r=>/chatwoot|support-chat|support\.gerowallet/.test(r.path)).length,0);
  fs.writeFileSync(path.join(out,'stage3-browser-results.json'),JSON.stringify({passed:true,syntheticPublishedFixtures:true,liveCms:false,guideCount:25,errors,requests:requests.filter(r=>r.path.startsWith('/api/help/'))},null,2));
  console.log(JSON.stringify({passed:true,errors,publishedFixtures:documents.length,profile}));
 } catch(error) {
  const page=context.pages().at(-1); await page.screenshot({path:path.join(out,'stage3-browser-failure.png'),fullPage:true}).catch(()=>{});
  console.error((await page.locator('body').innerText()).slice(0,3000)); console.error({errors}); throw error;
 } finally {await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
