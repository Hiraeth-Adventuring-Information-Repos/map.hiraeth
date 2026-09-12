import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {createMapFileServer}=require('../scripts/map_file_server.js');
const source=path.resolve(import.meta.dirname,'..');
function unzip(bytes){const files={};let at=0;while(bytes.readUInt32LE(at)===0x04034b50){const size=bytes.readUInt32LE(at+18), n=bytes.readUInt16LE(at+26),extra=bytes.readUInt16LE(at+28);const name=bytes.subarray(at+30,at+30+n).toString();const start=at+30+n+extra;files[name]=bytes.subarray(start,start+size);at=start+size;}return files;}
test('password-free editing downloads lossless files and never writes server maps',async({page},testInfo)=>{
 test.setTimeout(90000);
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'hiraeth-download-test-')));
 for(const name of ['maps','css','js','images','map-editor.html','file-studio.html','site.config.json','favicon-16x16.png','favicon-32x32.png'])fs.cpSync(path.join(source,name),path.join(root,name),{recursive:true});
 const jsonPath=path.join(root,'maps/Fair-Content.json');const original=JSON.parse(fs.readFileSync(jsonPath));
 const before=new Map(fs.readdirSync(path.join(root,'maps')).filter(f=>fs.statSync(path.join(root,'maps',f)).isFile()).map(f=>[f,fs.readFileSync(path.join(root,'maps',f))]));
 const server=createMapFileServer({repoRoot:root,allowedHosts:'127.0.0.1'});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const writes=[],errors=[];page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url())});page.on('pageerror',e=>errors.push(e.message));
 const download=async action=>{const event=page.waitForEvent('download');await action();const item=await event;const dest=testInfo.outputPath(item.suggestedFilename());await item.saveAs(dest);return {name:item.suggestedFilename(),bytes:fs.readFileSync(dest)};};
 try{
  await page.goto(base+'/studio');await page.waitForURL('**/studio/editor');await expect(page.locator('#map-editor-app')).toHaveAttribute('data-loading','false');
  await expect(page.locator('input[type=password]')).toHaveCount(0);
  await page.locator('[data-map-id="main_continent"]').first().click();
  await expect(page.locator('#save-current-map-btn')).toHaveText('Download changes');
  await page.locator('#editor-add-poi-btn').click();await page.locator('#editor-map').click({position:{x:270,y:240}});
  await page.locator('#editor-feature-form [data-field="name"]').fill('Downloaded harbor');await page.locator('#editor-feature-form [data-field="name"]').press('Tab');
  const map=await download(()=>page.locator('#save-current-map-btn').click());expect(map.name).toBe('Fair-Content.json');const doc=JSON.parse(map.bytes);
  expect(doc.pointsOfInterest.find(p=>p.name==='Downloaded harbor')).toBeTruthy();doc.pointsOfInterest=doc.pointsOfInterest.filter(p=>p.name!=='Downloaded harbor');expect(doc).toEqual(original);
  await expect(page.locator('#editor-save-state-title')).toHaveText('Download requested');
  await page.locator('.file-editor-more > summary').click();await page.getByRole('button',{name:'Settings',exact:true}).click();await page.locator('#map-name').fill('Downloaded Fair');await page.locator('#map-name').press('Tab');
  const bundle=await download(()=>page.locator('#save-current-map-btn').click());expect(bundle.name).toMatch(/\.zip$/);const bundleFiles=unzip(bundle.bytes);expect(JSON.parse(bundleFiles['maps/Fair-Content.json']).name).toBe('Downloaded Fair');expect(JSON.parse(bundleFiles['maps/maps.json']).find(m=>m.id==='main_continent').name).toBe('Downloaded Fair');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:testInfo.outputPath('download-mobile.png')});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  await page.goto(base+'/studio?new-map=1');await page.locator('#map-name').fill('Local harbor');await page.locator('#map-artwork').setInputFiles(path.join(root,'maps/Fair-Content.mini.webp'));
  const starter=await download(()=>page.locator('#create-form button[type=submit]').click());const files=unzip(starter.bytes);expect(Object.keys(files)).toEqual(['maps/local-harbor.json','maps/maps.json','maps/local-harbor.webp','maps/local-harbor.mini.webp']);expect(JSON.parse(files['maps/local-harbor.json']).name).toBe('Local harbor');expect(files['maps/local-harbor.webp'].subarray(0,4).toString()).toBe('RIFF');
  expect(fs.readdirSync(path.join(root,'maps')).filter(f=>fs.statSync(path.join(root,'maps',f)).isFile()).sort()).toEqual([...before.keys()].sort());
  for(const [name,bytes]of before)expect(fs.readFileSync(path.join(root,'maps',name)).equals(bytes),name).toBe(true);
  expect(writes).toEqual([]);expect(errors).toEqual([]);
 }finally{await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}
});
