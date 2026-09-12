const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createSession, buildDocument } = require('../js/map-file-document');
const raw = { id:'map', custom:{secret:'retained'}, filterGroups:{Regions:{Kind:['Unused','Town']}}, pointsOfInterest:[{id:'p',name:'Same',coords:[1.234,5.678],custom:'keep',properties:{a:1}},{id:'q',name:'Same',coords:[4.567,8.901],detailSections:[{heading:'Heading',body:'Body',custom:'keep'}]}], regions:[{id:'r',name:'Region',coordinates:[[1.25,2.5],[3.75,4.5],[6.25,7.5]],custom:true}], roads:[{id:'l',name:'Road',coordinates:[[1.2,3.4],[5.6,7.8]],weight:0.5}] };
function session() {
 const ui=JSON.parse(JSON.stringify(raw));
 ui.pointsOfInterest.forEach(p=>{p.coords=p.coords.map(Math.round);p.description='';});
 ui.pointsOfInterest[1].detailSections[0]={heading:'Heading',body:'Body'};
 ui.regions[0].coordinates=ui.regions[0].coordinates.map(c=>c.map(Math.round));
 ui.lines=ui.roads;delete ui.roads;ui.lines[0].weight=1;
 ui.filterGroups={Regions:{Kind:['Town']}};
 return createSession(raw,ui);
}
test('no-op preserves complete raw document and original collection names',()=>{const s=session();assert.deepEqual(buildDocument(s.snapshot,s.editableDocument),raw);});
test('rename preserves precision, custom fields, duplicate names and untouched nested metadata',()=>{const s=session();s.editableDocument.pointsOfInterest[0].name='Renamed';const expected=structuredClone(raw);expected.pointsOfInterest[0].name='Renamed';assert.deepEqual(buildDocument(s.snapshot,s.editableDocument),expected);});
test('geometry edit changes only selected geometry',()=>{const s=session();s.editableDocument.regions[0].coordinates[1]=[90.25,44.125];const expected=structuredClone(raw);expected.regions[0].coordinates[1]=[90.25,44.125];assert.deepEqual(buildDocument(s.snapshot,s.editableDocument),expected);});
test('delete, create, rename and reorder keep correct source identities',()=>{const s=session();const q=s.editableDocument.pointsOfInterest[1];q.name='Moved';s.editableDocument.pointsOfInterest=[{name:'New',coords:[10,20]},q];const result=buildDocument(s.snapshot,s.editableDocument);assert.deepEqual(result.pointsOfInterest,[{...raw.pointsOfInterest[1],name:'Moved'},{name:'New',coords:[10,20]}]);assert.deepEqual(result.roads,raw.roads);});
test('UI line alias edits preserve roads name and source weight',()=>{const s=session();s.editableDocument.lines[0].name='Track';const expected=structuredClone(raw);expected.roads[0].name='Track';assert.deepEqual(buildDocument(s.snapshot,s.editableDocument),expected);});
test('generated filters retain unused choices and add new choices',()=>{const s=session();s.editableDocument.filterGroups={Regions:{Kind:['City']}};assert.deepEqual(buildDocument(s.snapshot,s.editableDocument).filterGroups,{Regions:{Kind:['Unused','Town','City']}});});
test('sessions and snapshots survive JSON history cloning and do not mutate source',()=>{const before=JSON.stringify(raw);const s=JSON.parse(JSON.stringify(session()));s.editableDocument.custom.secret='Changed';assert.equal(buildDocument(s.snapshot,s.editableDocument).custom.secret,'Changed');assert.equal(JSON.stringify(raw),before);});
test('duplicate identities fail closed',()=>{const s=session();s.editableDocument.regions.push(structuredClone(s.editableDocument.regions[0]));assert.throws(()=>buildDocument(s.snapshot,s.editableDocument),/Duplicate feature/);});

test('insert vertex preserves precision of untouched vertices',()=>{const s=session();s.editableDocument.regions[0].coordinates.splice(1,0,[9.9,8.8]);const expected=structuredClone(raw);expected.regions[0].coordinates.splice(1,0,[9.9,8.8]);assert.deepEqual(buildDocument(s.snapshot,s.editableDocument),expected);});

test('serializer sorting is not a content reorder',()=>{const s=session();s.editableDocument.pointsOfInterest.reverse();assert.deepEqual(buildDocument(s.snapshot,s.editableDocument),raw);assert.deepEqual(buildDocument(s.snapshot,s.editableDocument,{honorFeatureOrder:true}).pointsOfInterest,[raw.pointsOfInterest[1],raw.pointsOfInterest[0]]);});
test('all current file-backed maps survive normalized and sorted no-op serialization',()=>{
 const fs=require('node:fs'); const path=require('node:path'); const shared=require('../js/editor-shared');
 const root=path.resolve(__dirname,'..');
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'maps/maps.json'),'utf8'));
 let checked=0;
 for(const entry of manifest){
  if(!entry.dataUrl)continue;
  const source=JSON.parse(fs.readFileSync(path.join(root,entry.dataUrl),'utf8'));
  const ui=structuredClone(source);
  ui.pointsOfInterest=(ui.pointsOfInterest||[]).map(shared.normalizePoint);
  ui.regions=(ui.regions||[]).map(shared.normalizeRegion);
  const key=Array.isArray(ui.lines)?'lines':Array.isArray(ui.roads)?'roads':'lines';
  ui[key]=(ui[key]||[]).map(shared.normalizeLine);
  // Capture the filter representation the serializer initially generates.
  ui.filterGroups=shared.serializeEditorState({masterMapData:[ui],currentMapId:ui.id,collectedPoints:ui.pointsOfInterest,collectedRegions:ui.regions,collectedLines:ui[key],lineCollectionKey:key,selectedMapOnly:true}).filterGroups;
  const s=createSession(source,ui);
  const saved=shared.serializeMapDocumentState({masterMapData:[s.editableDocument],currentMapId:ui.id,collectedPoints:s.editableDocument.pointsOfInterest,collectedRegions:s.editableDocument.regions,collectedLines:s.editableDocument[key],lineCollectionKey:key});
  assert.deepEqual(buildDocument(s.snapshot,saved),source,entry.dataUrl);checked++;
 }
 assert.ok(checked>=24);
});
test('editing a rich section while inserting another preserves hidden nested fields',()=>{
 const source={id:'map',pointsOfInterest:[{name:'P',coords:[1,2],detailSections:[{heading:'Lore',body:'Original',custom:'keep me'}]}]};
 const normalized=structuredClone(source);delete normalized.pointsOfInterest[0].detailSections[0].custom;
 const s=createSession(source,normalized);s.editableDocument.pointsOfInterest[0].detailSections[0].body='Edited';
 s.editableDocument.pointsOfInterest[0].detailSections.push({heading:'New',body:'Added'});
 const expected=structuredClone(source);expected.pointsOfInterest[0].detailSections[0].body='Edited';expected.pointsOfInterest[0].detailSections.push({heading:'New',body:'Added'});
 assert.deepEqual(buildDocument(s.snapshot,s.editableDocument),expected);
});
test('rich section removal, reorder, and identical headings retain correct source identity',()=>{
 const source={id:'map',pointsOfInterest:[{name:'P',coords:[1,2],detailSections:[{heading:'Lore',body:'A',custom:'first'},{heading:'Lore',body:'B',custom:'second'},{heading:'Lore',body:'C',custom:'third'}]}]};
 const normalized=structuredClone(source);normalized.pointsOfInterest[0].detailSections.forEach(s=>delete s.custom);
 const s=createSession(source,normalized);const sections=s.editableDocument.pointsOfInterest[0].detailSections;
 sections[2].body='Edited C';sections[2].heading='Renamed';s.editableDocument.pointsOfInterest[0].detailSections=[sections[2],sections[1]];
 assert.deepEqual(buildDocument(s.snapshot,s.editableDocument).pointsOfInterest[0].detailSections,[{heading:'Renamed',body:'Edited C',custom:'third'},{heading:'Lore',body:'B',custom:'second'}]);
});
