#!/usr/bin/env python3
"""Apply the 2026-10-03 source-reviewed Castgate corrections, without regenerating inventory.

Run with PYTHONPATH=/tmp/stomion-cv /home/codex/tools/artifacts/bin/python.
The literal native rings in controls.json are curated source boundaries. This
script preserves IDs, addresses, POIs/lore, unrelated buildings and street
names. It repairs only graph points/paths blocked by the corrected roofs, then
rechecks every retained address approach against all roofs and harbor water.
"""
from pathlib import Path
import sys,json,math,hashlib,heapq,collections,copy
import cv2,numpy as np
from PIL import Image,ImageDraw,ImageFont
from castgate_survey import proper_crosses
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'design/castgate/correction-pass';N=8192;STEP=4

def leaf(p):return [round(N-p[1],3),round(p[0],3)]
def native(p):return [p[1],N-p[0]]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def polygon(b):return np.array([native(p)for p in b['footprint']],np.float32)
def poly_area(p):return abs(cv2.contourArea(np.array(p,np.float32)))
def ring_contains(b,p):
 return cv2.pointPolygonTest(polygon(b),tuple(native(p)),False)>=0 and not any(cv2.pointPolygonTest(np.array([native(q)for q in h],np.float32),tuple(native(p)),False)>=0 for h in b.get('footprintHoles',[]))
def simplify(points):
 # Local repairs can return to the same grid vertex while replacing adjacent
 # unsafe segments. Erase that needless closed detour without a ground shortcut.
 clean=[];positions={}
 for q in points:
  key=tuple(round(v,3)for v in q)
  if key in positions:
   clean=clean[:positions[key]+1];positions={tuple(round(v,3)for v in p):i for i,p in enumerate(clean)}
  else:positions[key]=len(clean);clean.append(q)
 points=clean
 if len(points)<3:return points
 p=np.array(points,np.float32);return cv2.approxPolyDP(p,.15,False).reshape(-1,2).tolist()

def main():
 controls=json.loads((OUT/'controls.json').read_text());path=ROOT/'maps/castgate.json';current=json.loads(path.read_text());base_path=ROOT/'design/data-correction/before/castgate.json'
 previous_report=json.loads((OUT/'report.json').read_text())if (OUT/'report.json').exists()else{}
 allowed={controls['baseMapSha256'],previous_report.get('canonicalSha256')}
 if sha(base_path)!=controls['baseMapSha256']:raise ValueError('Immutable correction baseline changed; review before applying.')
 if sha(path)not in allowed:raise ValueError('Canonical map has later manual/editor changes; review and update targeted controls rather than overwrite them.')
 if current.get('addressReview',{}).get('correctionReview',{}).get('passId')==controls['passId']:
  print('Correction already applied; reapplying reviewed controls without retiring IDs twice.');data=current;before=json.loads(base_path.read_text());apply=True
 else:before=copy.deepcopy(current);data=copy.deepcopy(current);apply=True
 if sha(ROOT/'maps/castgate.webp')!=controls['sourceArtworkSha256']:raise ValueError('Source artwork changed; re-review native controls.')
 retired=copy.deepcopy(current.get('addressReview',{}).get('correctionReview',{}).get('retiredBuildings',[]));changed=[];node_changes=[];line_changes=[];access_changes=[]
 if apply:
  by={b['id']:b for b in data['buildings']}
  for r in controls['remove']:
   b=by.pop(r['id'],None)
   if b is None:continue
   surviving=r.get('survivingBuildingId');retired.append({'id':b['id'],'address':b['address'],'aliases':b.get('aliases',[]),'survivingBuildingId':surviving,'reason':r['reason']})
   if surviving:
    target=by[surviving];target['aliases']=list(dict.fromkeys(target.get('aliases',[])+[b['address']]+b.get('aliases',[])))
   for place in data['pointsOfInterest']:
    if place.get('buildingId')==b['id']:
     if not surviving:raise ValueError('Retired named destination without surviving roof')
     place['buildingId']=surviving
  for r in controls['corrections']:
   if r.get('new')and r['id']not in by:
    b={'id':r['id'],'mappingSource':'castgate-address-survey','accessReview':{'status':'unmapped'}};by[r['id']]=b
   else:b=by[r['id']]
   b['footprint']=[leaf(p)for p in (r['polygon'] if 'polygon'in r else [native(q)for q in b['footprint']])]
   if r.get('holes'):b['footprintHoles']=[[leaf(p)for p in h]for h in r['holes']]
   else:b.pop('footprintHoles',None)
   # A roof marker must be on the solid roof, rather than former garden/ornament.
   p=polygon(b).astype('int32');x,y,w,h=cv2.boundingRect(p);mask=np.zeros((h,w),np.uint8);cv2.fillPoly(mask,[p-[x,y]],1)
   for hole in b.get('footprintHoles',[]):cv2.fillPoly(mask,[np.array([native(q)for q in hole],np.int32)-[x,y]],0)
   dist=cv2.distanceTransform(mask,cv2.DIST_L2,5);yy,xx=np.unravel_index(dist.argmax(),dist.shape)
   if not b.get('coordinates')or not ring_contains(b,b['coordinates']):b['coordinates']=leaf([x+int(xx),y+int(yy)])
   b['sourceReview']={'status':'source reviewed correction','roofCompoundAreaPixels':poly_area([native(q)for q in b['footprint']])-sum(poly_area([native(q)for q in h])for h in b.get('footprintHoles',[])),
     'method':r.get('boundaryMethod','Source reviewed outer roof silhouette; courtyard exclusions follow the artwork.'),'correctionPassId':controls['passId'],'note':r['reason']}
   changed.append({'id':b['id'],'new':bool(r.get('new')),'nativeBounds':r['bounds'],'reason':r['reason'],'holeCount':len(b.get('footprintHoles',[]))})
  data['buildings']=[b for b in data['buildings']if b['id']in by]+[by[r['id']]for r in controls['corrections']if r.get('new')and r['id']not in {b['id']for b in data['buildings']}]
  # A garden fountain is a walking obstacle, never a building/address. Preserve
  # every prior obstacle exactly and update only this pass's explicit additions.
  for r in controls.get('walkingObstacleCorrections',[]):
   obstacle={'id':r['id'],'kind':r['kind'],'footprint':[leaf(p)for p in r['nativePolygon']],'mappingSource':'castgate-source-correction','correctionPassId':controls['passId'],'sourceReview':{'status':'source reviewed correction','method':r['method'],'note':r['reason']}}
   existing=next((o for o in data.get('walkingObstacles',[])if o['id']==r['id']),None)
   if existing:existing.update(obstacle)
   else:data.setdefault('walkingObstacles',[]).append(obstacle)
 # Mask all current roofs and walking basins, subtracting explicit courtyard rings.
 owners=np.zeros((N,N),np.uint16)
 for i,b in enumerate(data['buildings'],1):
  cv2.fillPoly(owners,[polygon(b).astype('int32')],i)
  for h in b.get('footprintHoles',[]):cv2.fillPoly(owners,[np.array([native(p)for p in h],np.int32)],0)
 occupied=owners>0;water=np.asarray(Image.open(ROOT/'design/castgate/source/water-mask.png'))>0;deck=np.asarray(Image.open(ROOT/'design/castgate/source/deck-mask.png'))>0
 # Retain original mask except a source-confirmed phantom T-head arm.
 for exclusion in controls.get('deckExclusions',[]):
  layer=np.zeros((N,N),np.uint8);cv2.fillPoly(layer,[np.array(exclusion['nativePolygon'],np.int32)],1);deck[layer>0]=False
 # Extend only source-reviewed timber centerlines.
 for extension in controls.get('deckExtensions',[]):
  layer=np.zeros((N,N),np.uint8);cv2.polylines(layer,[np.array(extension['nativeCenterline'],np.int32)],False,1,extension['widthPixels']);deck|=layer>0
 if controls.get('deckExtensions'):Image.fromarray(deck.astype('uint8')*255).save(OUT/'reviewed-deck-mask.png')
 obstacle=np.zeros((N,N),np.uint8)
 for b in data.get('walkingObstacles',[]):cv2.fillPoly(obstacle,[polygon(b).astype('int32')],1)
 solid=occupied|(water&~deck)|(obstacle>0);blocked=solid.reshape(N//STEP,STEP,N//STEP,STEP).max(axis=(1,3));W=N//STEP
 _,components,stats,_=cv2.connectedComponentsWithStats((~blocked).astype('uint8'),connectivity=4);sizes=stats[:,cv2.CC_STAT_AREA].copy();sizes[0]=0;ground=components==int(sizes.argmax())
 def cell(p):x,y=native(p);return int((x-2)//STEP),int((y-2)//STEP)
 def point(c):return [c[0]*STEP+2,c[1]*STEP+2]
 def nearest(p,limit=900):
  x,y=cell(p);n=math.ceil(limit/STEP);x0,x1=max(0,x-n),min(W,x+n+1);y0,y1=max(0,y-n),min(W,y+n+1);ys,xs=np.where(ground[y0:y1,x0:x1]);
  if not len(xs):raise ValueError(f'No safe ground near {p}')
  j=int(((xs+x0-x)**2+(ys+y0-y)**2).argmin());return int(xs[j]+x0),int(ys[j]+y0)
 def sample(points,increment=1):
  for a,b in zip(points,points[1:]):
   a,b=native(a),native(b);n=max(1,math.ceil(math.dist(a,b)/increment))
   for j in range(n+1):
    t=j/n;yield max(0,min(N-1,round(a[0]+(b[0]-a[0])*t))),max(0,min(N-1,round(a[1]+(b[1]-a[1])*t)))
 def collides(points,own=0):
  for x,y in sample(points):
   if (owners[y,x]!=0 and owners[y,x]!=own)or(water[y,x]and not deck[y,x])or obstacle[y,x]:return True
  return False
 # Existing safe street paths receive high priority so local repairs return to
 # illustrated authored approaches, rather than routing across arbitrary plazas.
 streetmask=np.zeros((W,W),np.uint8)
 for line in data['lines']:
  if line.get('travelMode'):
   pts=np.array([cell(p)for p in line['coordinates']],np.int32);cv2.polylines(streetmask,[pts],False,1,1)
 near=cv2.distanceTransform(1-streetmask,cv2.DIST_L2,5);cost=1+np.minimum(near/3,10)
 def astar(a,b):
  if a==b:return [a]
  queue=[(math.dist(a,b),0,a)];ds={a:0};parent={}
  while queue:
   _,g,p=heapq.heappop(queue)
   if g>ds[p]+1e-7:continue
   if p==b:break
   x,y=p
   for dx,dy in [(1,0),(-1,0),(0,1),(0,-1),(1,1),(-1,1),(1,-1),(-1,-1)]:
    nx,ny=x+dx,y+dy;q=nx,ny
    if nx<0 or ny<0 or nx>=W or ny>=W or blocked[ny,nx]:continue
    if dx and dy and(blocked[y,nx]or blocked[ny,x]):continue
    n=g+math.hypot(dx,dy)*float(cost[ny,nx])
    if n<ds.get(q,math.inf):ds[q]=n;parent[q]=p;heapq.heappush(queue,(n+math.dist(q,b),n,q))
  if b not in parent:raise ValueError(f'No constrained repair route {a} to {b}')
  chain=[b]
  while chain[-1]!=a:chain.append(parent[chain[-1]])
  return chain[::-1]
 if apply:
  # Trim a source-confirmed phantom timber arm while preserving stable IDs.
  for correction in controls.get('nodeCorrections',[]):
   node=next(n for n in data['travelNodes']if n['id']==correction['id']);node['coordinates']=leaf(correction['nativeCoordinates'])
  for correction in controls.get('lineCorrections',[]):
   line=next(l for l in data['lines']if l['id']==correction['id']);line['coordinates']=[leaf(p)for p in correction['nativePath']];line['geometryReview']=correction['reason']
  # Complete two legitimate source timber piers with minimal shore approaches.
  node_index={n['id']:n for n in data['travelNodes']}
  for approach in controls.get('pierApproaches',[]):
   pts=[leaf(p)for p in approach['nativePath']];pts[0]=node_index[approach['from']]['coordinates'];pts[-1]=node_index[approach['to']]['coordinates'];refined=[pts[0]]
   for a,b in zip(pts,pts[1:]):
    if not collides([a,b]):refined.append(b);continue
    ca,cb=nearest(a),nearest(b);part=[leaf(point(c))for c in astar(ca,cb)]
    if refined[-1]!=part[0]:refined.append(part[0])
    refined.extend(part[1:])
   link={'id':approach['id'],'name':approach['name'],'type':'Travel','coordinates':simplify(refined),'travelMode':'road','travelSpeedKph':5,'travelFareGp':0,'travelFromNode':approach['from'],'travelToNode':approach['to'],'streetId':approach['streetId'],'travelVisible':False,'mappingSource':'castgate-address-survey','geometryReview':'Source-reviewed continuation of actual timber pier and clear shore; no crossing of open harbor.','correctionPassId':controls['passId']}
   if collides(link['coordinates']):raise ValueError('Pier approach leaves reviewed deck/clear shore: '+link['id'])
   existing=next((l for l in data['lines']if l['id']==link['id']),None)
   if existing:existing.update(link)
   else:data['lines'].append(link)
  # Move only graph points that newly occupy actual roofs; preserve node IDs.
  bynodes={n['id']:n for n in data['travelNodes']}
  for node in data['travelNodes']:
   if collides([node['coordinates'],node['coordinates']]):
    old=node['coordinates'];new=leaf(point(nearest(old)));node['coordinates']=new;node_changes.append({'id':node['id'],'before':old,'after':new})
  for line in data['lines']:
   if not line.get('travelMode'):continue
   old=copy.deepcopy(line['coordinates']);pts=line['coordinates'];pts[0]=bynodes[line['travelFromNode']]['coordinates'];pts[-1]=bynodes[line['travelToNode']]['coordinates']
   if collides(pts):
    repaired=[pts[0]]
    for a,b in zip(pts,pts[1:]):
     if not collides([a,b]):repaired.append(b);continue
     ca,cb=nearest(a),nearest(b);chain=astar(ca,cb);part=[leaf(point(c))for c in chain]
     if repaired[-1]!=part[0]:repaired.append(part[0])
     repaired.extend(part[1:])
    # Unsafe old intermediate vertices may recur between repaired spans; remove
    # them by simplifying only consecutive collinear ground-safe cell runs.
    line['coordinates']=simplify(repaired)
    if collides(line['coordinates']):raise ValueError('Local path repair still collides: '+line['id'])
   if line['id']in {r['id']for r in previous_report.get('repairedStreets',[])}|{r['id']for r in controls.get('lineCorrections',[])}:
    line['coordinates']=simplify(line['coordinates'])
   if line['coordinates']!=old:line_changes.append({'id':line['id'],'beforePoints':len(old),'afterPoints':len(line['coordinates'])})
   explicit=next((r for r in controls.get('lineCorrections',[])if r['id']==line['id']),None)
   if explicit:line['geometryReview']=explicit['reason']
   elif line['coordinates']!=old or line['id']in {r['id']for r in previous_report.get('repairedStreets',[])}:line['geometryReview']='Source correction pass: existing street retained except local roof/water avoidance repairs.'
  # Multi-source shortest walk from actual repaired street cells to roof edges.
  dist={};parent={};root={};streetowner={};queue=[]
  for line in data['lines']:
   if not line.get('travelMode')or not line.get('streetId'):continue
   for x,y in sample(line['coordinates'],2):
    c=((x-2)//STEP,(y-2)//STEP)
    if 0<=c[0]<W and 0<=c[1]<W and not blocked[c[1],c[0]]:streetowner.setdefault(c,line);dist[c]=0;root[c]=c
  for c in root:heapq.heappush(queue,(0,c))
  while queue:
   g,p=heapq.heappop(queue)
   if g>dist[p]+1e-7 or g>240:continue
   x,y=p
   for dx,dy in [(1,0),(-1,0),(0,1),(0,-1),(1,1),(-1,1),(1,-1),(-1,-1)]:
    nx,ny=x+dx,y+dy;q=nx,ny
    if nx<0 or ny<0 or nx>=W or ny>=W or blocked[ny,nx]:continue
    if dx and dy and(blocked[y,nx]or blocked[ny,x]):continue
    ng=g+math.hypot(dx,dy)
    if ng<dist.get(q,math.inf):dist[q]=ng;root[q]=root[p];parent[q]=p;heapq.heappush(queue,(ng,q))
  for ordinal,b in enumerate(data['buildings'],1):
   needs=b['id']in {r['id']for r in controls['corrections']}or not b.get('access')or collides(b['access'].get('path',[]),ordinal)or b['access'].get('lineId')in {r['id']for r in line_changes}
   if not needs:continue
   old=copy.deepcopy(b.get('access'));po=polygon(b).astype('int32');x,y,w,h=cv2.boundingRect(po);local=np.zeros((h+24,w+24),np.uint8);cv2.fillPoly(local,[po-[x-12,y-12]],1)
   ring=cv2.dilate(local,np.ones((17,17),np.uint8))-local;ys,xs=np.where(ring>0);options={((int(xx+x-12)-2)//STEP,(int(yy+y-12)-2)//STEP)for xx,yy in zip(xs,ys)};options=[c for c in options if c in dist]
   if not options:raise ValueError('Corrected roof has no safe walking entrance: '+b['id'])
   end=min(options,key=lambda c:dist[c]);target=root[end];line=streetowner[target];p=point(end);best=None
   for aa,bb in zip(po,np.roll(po,-1,axis=0)):
    v=bb-aa;t=max(0,min(1,float(np.dot(np.array(p)-aa,v)/max(1,np.dot(v,v)))));q=(aa+t*v).tolist();distance=math.dist(q,p)
    if best is None or distance<best[0]:best=distance,q
   entrance=leaf(best[1]);chain=[end]
   while chain[-1]!=target:chain.append(parent[chain[-1]])
   approach=[entrance]+[leaf(point(c))for c in chain];anchor=approach[-1]
   # Project the final clear-ground cell to the exact existing street segment.
   nearest_segment=None
   for a,z in zip(line['coordinates'],line['coordinates'][1:]):
    va=np.array(z)-a;t=max(0,min(1,float(np.dot(np.array(anchor)-a,va)/max(1,np.dot(va,va)))));q=(np.array(a)+t*va).tolist();distance=math.dist(q,anchor)
    if nearest_segment is None or distance<nearest_segment[0]:nearest_segment=distance,q
   anchor=nearest_segment[1]
   if approach[-1]!=anchor:approach.append(anchor)
   b['entrance']=entrance;b['access']={'lineId':line['id'],'coordinates':anchor,'path':simplify(approach)};b['accessReview']={'status':'connected','method':'Corrected roof edge to exact street projection through clear ground; all retained roofs and harbor water excluded.','correctionPassId':controls['passId']}
   if not b.get('address'):
    b['streetId']=line['streetId'];taken={int(z.get('number','0'))for z in data['buildings']if z.get('streetId')==line['streetId']and str(z.get('number','')).isdigit()};b['number']=str(max(taken or {0})+1);b['address']=b['number']+' '+line['name']
   # Preserve authored address aliases even if the verified entrance now approaches
   # from another street; number/label is atlas convention, not a relocation.
   if old!=b['access']:access_changes.append({'id':b['id'],'oldLineId':old.get('lineId')if old else None,'newLineId':line['id']})
   if collides(b['access']['path'],ordinal):raise ValueError('Corrected approach crosses neighboring roof/water: '+b['id'])
  data['addressReview']['buildingCount']=len(data['buildings']);data['addressReview']['unresolvedAccess']=[];data['addressReview']['status']='source reviewed targeted correction';data['addressReview']['limits']=[
    'Footprints depict illustrated roof compounds, not occupancy or household counts. Distinct detached roofs are not automatically merged.',
    'Address numbers and street labels are atlas conveniences. Surviving original addresses/aliases are retained.',
    'Palm-occluded portions of the embassy stone rim are approximate. Its enclosed garden courtyard is excluded from the roof.',
    'Entrance points are routing approximations on illustrated outer roof edges; the artwork does not establish actual door positions.',
    'This pass corrects independently identified major source defects; remaining unlabeled small compounds are not a surveyed real estate inventory.'
  ];data['addressReview']['correctionReview']={'passId':controls['passId'],'status':'source-reviewed targeted correction','retiredBuildings':retired,'compoundCorrections':changed,'scope':'Native source outlines; obvious nonbuilding exclusions; exact courtyard ring; affected street/entrance repair.','controls':'design/castgate/correction-pass/controls.json','limitations':data['addressReview']['limits']}
  if controls.get('deckExtensions'):
   data['addressReview']['correctionReview']['deckMask']={'path':'design/castgate/correction-pass/reviewed-deck-mask.png','sha256':sha(OUT/'reviewed-deck-mask.png'),'sourceArtworkSha256':controls['sourceArtworkSha256'],'method':'Original harbor deck mask with phantom T-head arm and straight eastern stem water allowance removed; true slanted eastern timber and two source-visible stem endings restored from native controls in controls.json.'}
   data['addressReview']['correctionReview']['pierApproaches']=[{'id':p['id'],'from':p['from'],'to':p['to'],'reason':p['reason']}for p in controls.get('pierApproaches',[])]
  if controls.get('walkingObstacleCorrections'):data['addressReview']['correctionReview']['walkingObstacles']=[{'id':o['id'],'reason':o['reason']}for o in controls['walkingObstacleCorrections']]
  for review in data['addressReview']['poiReview']:
   retired_item=next((r for r in retired if r['id']==review.get('buildingId')),None)
   if retired_item:review['buildingId']=retired_item['survivingBuildingId']
  # Canonical write occurs only after every final geometry check succeeds.
 # Native topology and physical-mask verification of every retained roof/access.
 failures=[];overlaps=[];seen=np.zeros((N,N),np.uint16)
 for obstacle_entry in data.get('walkingObstacles',[]):
  if proper_crosses(polygon(obstacle_entry)):failures.append({'id':obstacle_entry['id'],'reason':'Walking obstacle boundary self intersection'})
 for i,b in enumerate(data['buildings'],1):
  poly=polygon(b)
  if proper_crosses(poly):failures.append({'id':b['id'],'reason':'Roof boundary self intersection'})
  for hole in b.get('footprintHoles',[]):
   hp=np.array([native(q)for q in hole],np.float32)
   if proper_crosses(hp)or any(cv2.pointPolygonTest(poly,tuple(q),False)<=0 for q in hp):failures.append({'id':b['id'],'reason':'Courtyard boundary outside roof or self intersecting'})
  x,y,w,h=cv2.boundingRect(poly.astype('int32'));mask=np.zeros((h,w),np.uint8);cv2.fillPoly(mask,[poly.astype('int32')-[x,y]],1)
  for hh in b.get('footprintHoles',[]):cv2.fillPoly(mask,[np.array([native(q)for q in hh],np.int32)-[x,y]],0)
  overlap=int(((seen[y:y+h,x:x+w]>0)&(mask>0)).sum())
  if overlap>5:overlaps.append({'id':b['id'],'pixels':overlap})
  view=seen[y:y+h,x:x+w];view[mask>0]=i
  if not ring_contains(b,b['coordinates']):failures.append({'id':b['id'],'reason':'Marker outside actual roof'})
  if collides(b['access']['path'],i):failures.append({'id':b['id'],'reason':'Approach intersects neighbor roof/harbor'})
 for l in data['lines']:
  if l.get('travelMode')and collides(l['coordinates']):failures.append({'id':l['id'],'reason':'Street intersects roof/harbor'})
 report={'passId':controls['passId'],'beforeBuildings':len(before['buildings']),'afterBuildings':len(data['buildings']),'retiredBuildings':retired or data['addressReview']['correctionReview']['retiredBuildings'],'correctedRoofs':changed or data['addressReview']['correctionReview']['compoundCorrections'],
 'repairedNodes':node_changes,'repairedStreets':line_changes,'repairedEntrances':access_changes,'counts':{'travelLinks':len([l for l in data['lines']if l.get('travelMode')]),'nodes':len(data['travelNodes']),'roofsWithCourtyards':len([b for b in data['buildings']if b.get('footprintHoles')])},'failures':failures,'overlappingRoofPixels':overlaps,'topologyChecked':len(data['buildings']),'sourceSha256':controls['sourceArtworkSha256'],'canonicalSha256':hashlib.sha256((json.dumps(data,indent=2,ensure_ascii=False)+'\n').encode()).hexdigest(),'scope':'Pixel collision against every final roof/courtyard and continuous harbor mask; source alignment reviewed in native closeups.'}
 # Derive cumulative repairs from immutable this-pass baseline so audit reruns
 # retain the complete change inventory rather than only their last local edit.
 oldnodes={n['id']:n for n in before['travelNodes']};oldlines={l['id']:l for l in before['lines']};oldbuildings={b['id']:b for b in before['buildings']}
 def roof_area(b):return poly_area([native(p)for p in b['footprint']])-sum(poly_area([native(p)for p in h])for h in b.get('footprintHoles',[]))if b else 0
 report['roofAreaChanges']=[{'id':b['id'],'beforeAreaPixels':roof_area(oldbuildings.get(b['id'])),'afterAreaPixels':roof_area(b),'nativeExtent':list(map(float,[polygon(b)[:,0].min(),polygon(b)[:,1].min(),polygon(b)[:,0].max(),polygon(b)[:,1].max()])),'courtyardAreaPixels':sum(poly_area([native(p)for p in h])for h in b.get('footprintHoles',[]))}for b in data['buildings']if b['id']in {r['id']for r in controls['corrections']}]
 report['repairedNodes']=[{'id':n['id'],'before':oldnodes[n['id']]['coordinates'],'after':n['coordinates']}for n in data['travelNodes']if n['id']in oldnodes and n['coordinates']!=oldnodes[n['id']]['coordinates']]
 report['repairedStreets']=[{'id':l['id'],'beforePoints':len(oldlines[l['id']]['coordinates']),'afterPoints':len(l['coordinates'])}for l in data['lines']if l['id']in oldlines and l.get('travelMode')and l['coordinates']!=oldlines[l['id']]['coordinates']]
 report['repairedEntrances']=[{'id':b['id'],'oldLineId':oldbuildings.get(b['id'],{}).get('access',{}).get('lineId'),'newLineId':b['access']['lineId']}for b in data['buildings']if b.get('access')!=oldbuildings.get(b['id'],{}).get('access')]
 report['removedPhantomDeckAreas']=controls.get('deckExclusions',[]);report['sourcePierCorrections']=controls.get('lineCorrections',[])
 report['addedWalkingObstacles']=controls.get('walkingObstacleCorrections',[]);report['counts']['walkingObstacles']=len(data.get('walkingObstacles',[]))
 report['addedPierApproaches']=[{'id':p['id'],'from':p['from'],'to':p['to'],'sourceNativePath':p['nativePath'],'reason':p['reason']}for p in controls.get('pierApproaches',[])]
 if controls.get('deckExtensions'):report['reviewedDeckMaskSha256']=sha(OUT/'reviewed-deck-mask.png')
 report['controlsSha256']=sha(OUT/'controls.json');report['baselineSha256']=controls['baseMapSha256']
 if failures or overlaps:raise ValueError('Correction did not pass final masks; canonical map left unchanged: '+json.dumps(failures+overlaps))
 if apply:path.write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n')
 (OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({k:report[k]for k in ['beforeBuildings','afterBuildings','counts','failures','overlappingRoofPixels']},indent=2));print('Repairs',len(node_changes),'nodes',len(line_changes),'streets',len(access_changes),'entrances')
 render(before,data,controls)
 if failures or overlaps:raise SystemExit(1)

def render(before,data,controls):
 im=Image.open(ROOT/'maps/castgate.webp').convert('RGB');font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',18)
 for r in controls['corrections']:
  box=r['bounds'];w,h=box[2]-box[0],box[3]-box[1];out=Image.new('RGB',(w*2,h+36),'white')
  for j,d in enumerate([before,data]):
   c=im.crop(box);dr=ImageDraw.Draw(c)
   for b in d['buildings']:
    xy=native(b['coordinates'])
    if not(box[0]<=xy[0]<=box[2]and box[1]<=xy[1]<=box[3]):continue
    p=[(q[1]-box[0],N-q[0]-box[1])for q in b['footprint']];dr.line(p+[p[0]],fill='#00ffcc',width=2)
    for hh in b.get('footprintHoles',[]):
     p=[(q[1]-box[0],N-q[0]-box[1])for q in hh];dr.line(p+[p[0]],fill='#ffac46',width=3)
    if b['id']==r['id']:
     path=b.get('access',{}).get('path',[])
     if len(path)>1:dr.line([(q[1]-box[0],N-q[0]-box[1])for q in path],fill='#ff8e53',width=3)
   out.paste(c,(w*j,36));ImageDraw.Draw(out).text((w*j+8,6),'Before'if j==0 else'Corrected source roof',font=font,fill='black')
  out.save(OUT/(r['id']+'-comparison.png'))
 # Separate source closeup for the two restored deck/shore graph connections.
 if controls.get('pierApproaches'):
  box=[3400,4230,4550,5460];w,h=box[2]-box[0],box[3]-box[1];out=Image.new('RGB',(w*2,h+36),'white')
  for j,d in enumerate([before,data]):
   c=im.crop(box);dr=ImageDraw.Draw(c)
   for line in d['lines']:
    if not line.get('travelMode'):continue
    ps=[(q[1]-box[0],N-q[0]-box[1])for q in line['coordinates']];dr.line(ps,fill='#fdad42'if line['id'].startswith('castgate-street-correction-')else'#4cdbcc',width=3)
   out.paste(c,(w*j,36));ImageDraw.Draw(out).text((w*j+8,6),'Before: disconnected deck ends'if j==0 else'Corrected: timber stem and clear shore links',font=font,fill='black')
  out.save(OUT/'pier-approaches-comparison.png')
 overview=im.resize((2048,2048));dr=ImageDraw.Draw(overview)
 for b in data['buildings']:
  pts=[(q[1]/4,(N-q[0])/4)for q in b['footprint']];dr.line(pts+[pts[0]],fill='#19e6bc',width=1)
  for hh in b.get('footprintHoles',[]):
   pts=[(q[1]/4,(N-q[0])/4)for q in hh];dr.line(pts+[pts[0]],fill='#ffad48',width=2)
 overview.save(OUT/'corrected-roof-overview.png')

if __name__=='__main__':main()
