// Rebuild the reviewed bridge revision from its preserved source snapshot.
const fs=require('fs'),assert=require('assert/strict');
const path=require('node:path');
const root=path.resolve(__dirname,'..'),read=p=>JSON.parse(fs.readFileSync(path.join(root,p)));
const output=process.argv[2];
if (!output) throw Error('Usage: node scripts/stomion_apply_bridge_review.js OUTPUT_JSON. Reads the saved pre-bridge review source; inspect and audit before promoting output.');
const {clipNetwork}=require(root+'/scripts/stomion_clip_rail_paths'),{addBridgeLinks}=require(root+'/scripts/stomion_bridge_links'),{project}=require(root+'/scripts/integrate_stomion_addresses');
const nat=([y,x])=>[x,3072-y],leaf=([x,y])=>[3072-y,x],gap=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
let s=read('design/stomion/review/geometry-audit/bridge-review-base-streets.json'),p=read('design/stomion/review/geometry-audit/rail/integrated-north-east-bridge-patch.json'),review=read('design/stomion/rail-walking-bridges.json');
const cityAlignment=read('design/stomion/review/geometry-audit/rail/final-city-deck-alignment.json');for(const x of cityAlignment.cityCrossings){const link=p.eightCityBridges.find(l=>l.id===x.replaceLinkId);link.nativePolyline=x.suggestedNativePolyline;}
const N=new Map(s.nodes.map(n=>[n.id,n])),E=new Map(s.edges.map(e=>[e.id,e]));
const sw=structuredClone(N.get('stomion-street-0820'));sw.id='stomion-reedbank-sw-frontage';s.nodes.push(sw);E.get('reedbank-road-001').from=sw.id;
for(const m of p.eastBankRoad.nodeMoves){N.get(m.nodeId).coordinates=leaf(m.nativeCoordinates);N.get(m.nodeId).imageCoordinates=m.nativeCoordinates;}
for(const r of p.eastBankRoad.edgeReplacements){const e=E.get(r.edgeId);assert.equal(e.from,r.fromNode);assert.equal(e.to,r.toNode);e.coordinates=r.nativePolyline.map(leaf);}
const mill=p.eastBankAttachments.find(a=>a.id==='east-bank-mill-ne-approach'),me=E.get(mill.edgeId),mi=me.coordinates.findIndex(a=>gap(nat(a),mill.rejoinOriginalAt)<.001);assert(mi>=0);me.coordinates=[...mill.nativeFirstPolyline.slice(0,-1).map(leaf),...me.coordinates.slice(mi)];
const cottage=p.eastBankAttachments.find(a=>a.edgeId==='east-bank-cottage-lane-007'),ce=E.get(cottage.edgeId),ci=ce.coordinates.findIndex(a=>gap(nat(a),cottage.rejoinOriginalAt)<.001);assert(ci>=0);assert.equal(ce.to,cottage.fromNode);ce.coordinates=[...ce.coordinates.slice(0,ci),...cottage.nativeFirstPolyline.toReversed().map(leaf)];
const remove=new Set(p.riverDecks.filter(d=>d.widthPixels).flatMap(d=>d.affectedEdgeIds));s.edges=s.edges.filter(e=>!remove.has(e.id));
for(const st of s.streets)st.edgeIds=st.edgeIds.filter(id=>!remove.has(id));s.streets=s.streets.filter(st=>st.edgeIds.length);
let clipped=clipNetwork(s,review);s=clipped.source;
const corrections=[],links=[];
function exactHint(point,hint){
 const hits=s.edges.filter(e=>!['rail','ferry'].includes(e.kind)).map(e=>({edge:e,...project(leaf(point),e.coordinates)})).filter(x=>x.distance<.01).sort((a,b)=>Number(b.edge.id===hint?.edgeId)-Number(a.edge.id===hint?.edgeId)||a.distance-b.distance);if(!hits[0])throw Error('Detached hint '+JSON.stringify({point,hint}));return {edgeId:hits[0].edge.id};
}
function adapt(link){
 const out=structuredClone(link);
 for(const [side,hint] of [[0,out.fromProjection],[1,out.toProjection]]){
  const idx=side?out.nativePolyline.length-1:0,point=out.nativePolyline[idx];
  out[side?'toProjection':'fromProjection']=exactHint(point,hint);
 }
 return out;
}
for(const link of p.eightCityBridges)links.push(adapt(link));
const d=p.riverDecks.filter(d=>d.widthPixels);
for(const deck of d){
 let a,b;
 if(deck.streetId==='woodhollow-north-bridge'){a=p.dryLandings.find(l=>l.id==='north-outer-ne-north-landing');b=p.dryLandings.find(l=>l.id==='north-outer-ne-south-landing');}
 else if(deck.streetId==='northgate-bridge'){a=p.dryLandings.find(l=>l.id==='north-inner-ne-north-landing');b=p.dryLandings.find(l=>l.id==='north-inner-ne-south-landing');}
 else {a=p.dryLandings.find(l=>l.id==='east-outer-ne-west-landing');b=p.dryLandings.find(l=>l.id==='east-outer-ne-farmland-landing');}
 const nativePolyline=[...a.nativePolyline.toReversed().slice(0,-1),...deck.nativeDeckPolyline,...b.nativePolyline.slice(1)];
 links.push(adapt({id:deck.id,bridgeId:deck.streetId+'-cobble',name:deck.streetId.split('-').map(w=>w[0].toUpperCase()+w.slice(1)).join(' ')+' Walkway',nativePolyline,fromProjection:a.streetProjection||{edgeId:'east-bank-road-006'},toProjection:b.streetProjection}));
}

for(const link of links){const result=addBridgeLinks(s,[link]);s=result.source;}
// Depicted upper spans also provide real local frontage on the opposite side.
// They end at the reviewed deck approach; no unproven longitudinal service walk
// is extended across the water to force a connection to a distant bank road.
function leafBridge(link,mainEnd,mainHint){
 const hit=exactHint(mainEnd,mainHint); const points=link.nativePolyline.map(leaf),side=gap(link.nativePolyline[0],mainEnd)<.001?0:1;
 const edge=s.edges.find(e=>e.id===hit.edgeId),at=project(leaf(mainEnd),edge.coordinates);
 let endpoint=gap(at.coordinates,edge.coordinates[0])<.00001?edge.from:gap(at.coordinates,edge.coordinates.at(-1))<.00001?edge.to:null;
 if(!endpoint){endpoint=link.id+'-frontage';s.nodes.push({id:endpoint,layer:'street',coordinates:at.coordinates,imageCoordinates:nat(at.coordinates)});s.edges.push({...edge,id:edge.id+'-'+link.id,from:endpoint,coordinates:[at.coordinates,...edge.coordinates.slice(at.segmentIndex+1)]});edge.coordinates=[...edge.coordinates.slice(0,at.segmentIndex+1),at.coordinates];edge.to=endpoint;}
 const id=link.id+'-local-end',end=points[side?0:points.length-1];s.nodes.push({id,layer:'street',coordinates:end,imageCoordinates:nat(end)});
 const streetId=link.id;s.streets.push({id:streetId,name:link.id.split('-').join(' '),kind:'bridge',coordinates:points,edgeIds:[link.id]});s.edges.push({id:link.id,streetId,name:link.id.split('-').join(' '),kind:'bridge',from:side?id:endpoint,to:side?endpoint:id,coordinates:points,travelBridgeIds:[link.bridgeId],geometryReviewSource:'review/geometry-audit/rail/integrated-north-east-bridge-patch.json'});links.push(link);
}
const external=read('design/stomion/review/geometry-audit/rail/final-external-transverse-decks.json'); for(const x of external.crossings){ const points=x.nativeSupportedWalkingBranch;const grayId=x.bridgeId.startsWith('north-outer')?'woodhollow-north-bridge-cobble-deck':x.bridgeId.startsWith('north-inner')?'northgate-bridge-cobble-deck':x.bridgeId.startsWith('east-inner')?'old-gate-bridge-004':'east-bank-bridge-cobble-deck';leafBridge({id:x.replaceLinkId,bridgeId:x.bridgeId,nativePolyline:points},points.at(-1),{edgeId:grayId});}
const nn=new Map(s.nodes.map(n=>[n.id,n]));for(const e of s.edges){assert(gap(e.coordinates[0],nn.get(e.from).coordinates)<.00001,e.id+' from');assert(gap(e.coordinates.at(-1),nn.get(e.to).coordinates)<.00001,e.id+' to');}
for(const st of s.streets){const es=s.edges.filter(e=>e.streetId===st.id);st.edgeIds=es.map(e=>e.id);if(!st.coordinates?.length)st.coordinates=es.flatMap(e=>e.coordinates);}
s.metadata.geometryAuditSource='review/geometry-audit/';s.metadata.railBarrierReview='rail-walking-bridges.json';
fs.writeFileSync(root+'/design/stomion/review/geometry-audit/final-bridge-links.json',JSON.stringify(links,null,2)+'\n');fs.writeFileSync(path.resolve(output),JSON.stringify(s,null,2)+'\n');fs.writeFileSync(root+'/design/stomion/review/geometry-audit/rail-clipping-applied.json',JSON.stringify({changes:clipped.changes,endpointCorrections:corrections,removedLongitudinalEdges:[...remove]},null,2)+'\n');console.log(JSON.stringify({edges:s.edges.length,bridgeLinks:links.length,endpointCorrections:corrections}));
