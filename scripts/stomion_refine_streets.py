#!/usr/bin/env python3
"""Refine the manual street trace inside bounded source-image corridors.

This preserves shared-junction topology, treats raised rail separately, and avoids
conservative inner roof cores. Image color/texture favors paved road surfaces.
Draft seed rectangles are deliberately not treated as authoritative street edges.
"""
from pathlib import Path
import sys,json,heapq,math,collections,time,hashlib
import numpy as np
import cv2
from PIL import Image
from stomion_streets import ROOT,HEIGHT,TRACE,GARDEN_WATERWAYS,build,write_overlay,report
from stomion_waterways import surface_trace,BANK_CENTERLINES,projection

def prepare_cost(water):
 im=np.asarray(Image.open(ROOT/'maps/The-Port-City-of-Stomion.webp').resize((2048,1536))).astype(np.float32)
 r,g,b=im[:,:,0],im[:,:,1],im[:,:,2]
 lum=(r*.299+g*.587+b*.114)
 variance=np.maximum(0,cv2.boxFilter(lum*lum,-1,(5,5))-cv2.boxFilter(lum,-1,(5,5))**2)
 # Streets generally have muted gray/earth colors and fewer hard black ridge
 # outlines than roofs. No global hue classification defines a street by itself.
 saturation=np.max(im,axis=2)-np.min(im,axis=2)
 texture=np.minimum(3,np.sqrt(variance)/13)
 cost=1+texture*.6+np.maximum(0,saturation-13)/12+np.maximum(0,45-lum)/15
 cost+=np.maximum(0,b-r-7)/7 # blue river/roof surfaces
 cost+=np.maximum(0,g-r-9)/7 # leafy vegetation
 core=np.zeros(lum.shape,np.uint8)
 margins=np.zeros(lum.shape,np.uint8)
 source=(ROOT/'design/stomion/buildings.json').read_bytes()
 roof_source=json.loads(source)
 roofs=roof_source['buildings']+roof_source.get('obstacles',[])
 for roof in roofs:
  if roof.get('kind')=='gatehouse':continue # bridge/fort gates have through passages
  pts=np.array([[c[1]/2,(HEIGHT-c[0])/2] for c in roof['footprint']],np.float32)
  x0=max(0,int(np.floor(pts[:,0].min()))-2);x1=min(lum.shape[1],int(np.ceil(pts[:,0].max()))+3)
  y0=max(0,int(np.floor(pts[:,1].min()))-2);y1=min(lum.shape[0],int(np.ceil(pts[:,1].max()))+3)
  occupied=np.zeros((y1-y0,x1-x0),np.uint8)
  offset=np.array([x0,y0],np.int32)
  cv2.fillPoly(occupied,[np.round(pts).astype(np.int32)-offset],1)
  confidence=roof.get('confidence','').lower()
  explicit=('outline' in confidence or 'perimeter reviewed' in confidence or 'reviewed terrace separators' in confidence
            or 'source-reviewed occupied roof perimeter' in roof.get('traceMethod','').lower())
  uncertain=any(word in confidence for word in ('hull','rectangular','includes courtyard','unresolved'))
  # Approximate outer boundaries remain traversable, but are not free space.
  # This discourages gray roof-edge shortcuts when nearby paving is available.
  strength=4 if 'hull' in confidence or 'includes courtyard' in confidence else (16 if explicit and not uncertain else 6)
  margins[y0:y1,x0:x1]=np.maximum(margins[y0:y1,x0:x1],occupied*strength)
  if explicit and not uncertain:
   # A source-reviewed C/H outline describes occupied roof wings. Erode those
   # actual pixels by two original pixels, preserving each open courtyard.
   inner=cv2.erode(occupied,np.ones((3,3),np.uint8))
  else:
   # Approximate boxes/hulls protect only their conservative inner region.
   center=pts.mean(axis=0);scaled=np.zeros(occupied.shape,np.uint8)
   cv2.fillPoly(scaled,[np.round(center+(pts-center)*.55).astype(np.int32)-offset],1)
   inner=scaled & occupied
  core[y0:y1,x0:x1] |= inner
 cost+=core*250 # confirmed ordinary roof cores are occupied, not walkable
 cost+=margins
 cost+=water*250 # garden canals are water, independent of their muted gray palette
 return cost,core,{'file':'design/stomion/buildings.json','sha256':hashlib.sha256(source).hexdigest(),'buildingCount':len(roofs)}

def node_positions(data,cost):
 kinds=collections.defaultdict(set)
 for e in data['edges']:
  kinds[e['from']].add(e['kind']);kinds[e['to']].add(e['kind'])
 moved={};fixed=[]
 for n in data['nodes']:
  x,y=[v/2 for v in n['imageCoordinates']]
  x0,y0=int(round(x)),int(round(y))
  if n.get('layer')=='rail' or kinds[n['id']] & {'bridge','ferry'}:
   moved[n['id']]=(x,y);continue
  if cost[y0,x0]<200 and any(math.dist((x,y),projection((x,y),a,b))<.15 for line in BANK_CENTERLINES.values() for a,b in zip(line,line[1:])):
   # Independently measured narrow decks cannot move to a cheaper roof eave.
   # A blocked source point still receives the normal honest refinement below.
   moved[n['id']]=(x,y);continue
  # Junction refinement must remain on the same connected walking ground.
  # A lower image cost on the opposite canal bank cannot justify teleporting a
  # dry junction across water or across an occupied roof wing.
  lx0=max(0,x0-12);lx1=min(cost.shape[1],x0+13)
  ly0=max(0,y0-12);ly1=min(cost.shape[0],y0+13)
  yy,xx=np.mgrid[ly0:ly1,lx0:lx1]
  clear=((cost[ly0:ly1,lx0:lx1]<200)&((xx-x0)**2+(yy-y0)**2<=144)).astype(np.uint8)
  _,labels=cv2.connectedComponents(clear,connectivity=4)
  ground=labels[y0-ly0,x0-lx0]
  candidates=[]
  for dy in range(-12,13):
   for dx in range(-12,13):
    dist=math.hypot(dx,dy)
    if dist>12:continue
    xx,yy=x0+dx,y0+dy
    if 0<=xx<cost.shape[1] and 0<=yy<cost.shape[0]:
     if not clear[yy-ly0,xx-lx0]:continue
     if ground and labels[yy-ly0,xx-lx0]!=ground:continue
     # Penalize displacement enough that open cobbled plaza intersections remain
     # near their original trace, while ridge-line placements move onto pavement.
     score=float(cost[yy,xx])+dist*.4 if ground else dist*100+float(cost[yy,xx])
     candidates.append((score,dist,xx,yy))
  if not candidates:
   moved[n['id']]=(x0,y0);continue # honest unresolved source endpoint
  _,dist,xx,yy=min(candidates)
  moved[n['id']]=(xx,yy)
  if dist>1:fixed.append({'id':n['id'],'before':[x*2,y*2],'after':[xx*2,yy*2],'movedPixels':round(dist*2,2)})
 return moved,fixed

def refine_edge(start,end,original_start,original_end,cost,half_width=22):
 exact_start,exact_end=start,end
 start=tuple(int(round(v)) for v in start);end=tuple(int(round(v)) for v in end)
 x0=max(0,int(min(start[0],end[0],original_start[0],original_end[0])-half_width-2));x1=min(cost.shape[1]-1,int(max(start[0],end[0],original_start[0],original_end[0])+half_width+2))
 y0=max(0,int(min(start[1],end[1],original_start[1],original_end[1])-half_width-2));y1=min(cost.shape[0]-1,int(max(start[1],end[1],original_start[1],original_end[1])+half_width+2))
 yy,xx=np.mgrid[y0:y1+1,x0:x1+1]
 ax,ay=original_start;bx,by=original_end;dx,dy=bx-ax,by-ay;den=dx*dx+dy*dy
 t=np.clip(((xx-ax)*dx+(yy-ay)*dy)/den,0,1) if den else np.zeros(xx.shape)
 gap=np.sqrt((xx-(ax+t*dx))**2+(yy-(ay+t*dy))**2)
 corridor=(gap<=half_width) & (cost[y0:y1+1,x0:x1+1]<200)
 local=cost[y0:y1+1,x0:x1+1]+gap*.065
 source=(start[0]-x0,start[1]-y0);target=(end[0]-x0,end[1]-y0)
 if not(0<=source[0]<local.shape[1] and 0<=source[1]<local.shape[0]):return None
 if not(0<=target[0]<local.shape[1] and 0<=target[1]<local.shape[0]):return None
 # A shared endpoint in water is a source-trace error, not permission to enter
 # the river. Leave it unresolved so the QA report requires a physical repair.
 if not corridor[source[1],source[0]] or not corridor[target[1],target[0]]:return None
 todo=[(math.hypot(source[0]-target[0],source[1]-target[1]),0,source)];best={source:0};previous={};seen=set()
 while todo:
  _,score,p=heapq.heappop(todo)
  if p in seen:continue
  if p==target:
   route=[p]
   while p in previous:p=previous[p];route.append(p)
   route=[(x+x0,y+y0) for x,y in route[::-1]]
   return ([exact_start] if exact_start!=route[0] else [])+route+([exact_end] if exact_end!=route[-1] else [])
  seen.add(p)
  for dy in (-1,0,1):
   for dx in (-1,0,1):
    if not(dx or dy):continue
    q=(p[0]+dx,p[1]+dy)
    if q in seen or not(0<=q[0]<local.shape[1] and 0<=q[1]<local.shape[0]) or not corridor[q[1],q[0]]:continue
    # A diagonal step must not shave a blocked water-cell corner. The exported
    # line is subsequently sampled at full resolution, between these pixels.
    if dx and dy and (not corridor[p[1],q[0]] or not corridor[q[1],p[0]]):continue
    step=1.41421356237 if dx and dy else 1
    v=score+step*float((local[p[1],p[0]]+local[q[1],q[0]])/2)
    if v<best.get(q,float('inf')):
     best[q]=v;previous[q]=p
     heapq.heappush(todo,(v+math.hypot(q[0]-target[0],q[1]-target[1]),v,q))
 return None

def simplify(pts):
 # Preserve actual graph junctions; remove only collinear pixel-step vertices.
 out=[]
 for p in pts:
  if len(out)>1:
   a,b=out[-2:]
   if (b[0]-a[0])*(p[1]-b[1])==(b[1]-a[1])*(p[0]-b[0]):out.pop()
  out.append(p)
 return out

def main():
 trace,water=surface_trace(TRACE,GARDEN_WATERWAYS)
 data=build(trace);cost,core,building_source=prepare_cost(water)
 positions,moves=node_positions(data,cost)
 full_water=np.asarray(Image.open(ROOT/'design/stomion/water-mask.png').convert('L'))
 qa={'method':'Shared junction projection and bounded-corridor A* using source image surface cost and conservative inner roof cores. Ordinary inner roofs and reviewed water are excluded. Draft seed outer boundaries are not used as hard walls.','maxJunctionMovePixels':24,'corridorHalfWidthPixels':44,'expandedCorridorHalfWidthPixels':88,'expandedCorridorEdges':[],'movedJunctions':moves,'refinedEdges':0,'fallbackEdges':[],'roofCorePixelsBefore':0,'roofCorePixelsAfter':0}
 qa['buildingSource']=building_source
 qa['waterMaskSha256']=hashlib.sha256((ROOT/'design/stomion/water-mask.png').read_bytes()).hexdigest()
 qa['roofCoreMethod']='Source-reviewed occupied roof outlines eroded by two original pixels; approximate boxes/hulls use the inner 55 percent intersected with their original occupied polygon. Gatehouses permit depicted through passages.'
 qa['roofCoreConflicts']=[]
 qa['preservedReviewedBankEdges']=[]
 qa['reviewedQuayInteriorEdges']=[]
 def core_hits(points):
  mask=np.zeros(core.shape,np.uint8)
  cv2.polylines(mask,[np.asarray(points,np.int32)],False,1,1)
  return int(np.count_nonzero(mask&core))
 for e in data['edges']:
  original=[(c[1]/2,(HEIGHT-c[0])/2) for c in e['coordinates']]
  start,end=positions[e['from']],positions[e['to']]
  pedestrian=e['kind'] not in {'rail','ferry'}
  if pedestrian:qa['roofCorePixelsBefore']+=core_hits(original)
  if e['kind'] in {'rail','bridge','ferry'}:
   points=[start,end]
  elif start==original[0] and end==original[-1] and not core_hits(original) and any(all(min(math.dist(p,projection(p,a,b)) for a,b in zip(line,line[1:]))<.15 for p in original) for line in BANK_CENTERLINES.values()):
   points=original
   qa['preservedReviewedBankEdges'].append(e['id'])
  else:
   points=refine_edge(start,end,*original,cost)
   if not points:
    points=refine_edge(start,end,*original,cost,half_width=44)
    if points:qa['expandedCorridorEdges'].append(e['id'])
   if not points:
    qa['fallbackEdges'].append(e['id']);points=[start,end]
   else:qa['refinedEdges']+=1
  if pedestrian:
   if e['streetId'].startswith('badges-bank-walk-') and min(p[0] for p in points)<=989.5 and max(p[0] for p in points)>=1007 and all(930<p[1]<965 for p in points):
    # Only the reviewed middle126 quay run replaces its 2px A* staircase.
    # Outside this short strip, keep the already verified path and endpoints.
    interior=[i for i,p in enumerate(points) if 989.45<=p[0]<=1007 and 945<=p[1]<=956]
    if len(interior)>1:
     a,b=interior[0],interior[-1]
     detail=[(2014,1892.5),(2010,1894),(2008,1894.7),(2006.5,1896),(2004,1897),(2002,1897),(2000,1898.1),(1998,1899.2),(1996,1899.4),(1993,1900.4),(1990,1901),(1987,1902.5),(1982,1903.1),(1980,1904),(1978.9,1903.8)]
     detail=[(x/2,y/2) for x,y in detail]
     if points[a][0]<points[b][0]:detail=detail[::-1]
     candidate=points[:a]+detail+points[b+1:]
     candidate[0]=start;candidate[-1]=end
     for pa,pb in zip(candidate,candidate[1:]):
      steps=max(1,math.ceil(math.dist(pa,pb)*2))
      for i in range(steps+1):
       t=i/steps;xx=round(2*(pa[0]+t*(pb[0]-pa[0])));yy=round(2*(pa[1]+t*(pb[1]-pa[1])))
       if full_water[yy,xx]>127:raise ValueError(f'Native quay replacement enters water at {xx},{yy}')
     points=candidate;qa['reviewedQuayInteriorEdges'].append(e['id'])
   hits=core_hits(points);qa['roofCorePixelsAfter']+=hits
   if hits:qa['roofCoreConflicts'].append({'id':e['id'],'name':e['name'],'kind':e['kind'],'roofCorePixels':hits,'sourceCoordinates':[[x*2,y*2] for x,y in points]})
  e['coordinates']=[[HEIGHT-y*2,x*2] for x,y in simplify(points)]
 for n in data['nodes']:
  x,y=positions[n['id']];n['imageCoordinates']=[x*2,y*2];n['coordinates']=[HEIGHT-y*2,x*2]
 # Junction projection may bring nearby vertices to the same pixel. Merge only
 # matching coordinates on the same layer, then drop zero-distance fragments.
 aliases={};unique={};kept=[]
 for n in data['nodes']:
  key=(n.get('layer','street'),*n['coordinates'])
  if key in unique:aliases[n['id']]=unique[key]
  else:unique[key]=n['id'];aliases[n['id']]=n['id'];kept.append(n)
 data['nodes']=kept
 edges=[];collapsed=[]
 for e in data['edges']:
  e['from']=aliases[e['from']];e['to']=aliases[e['to']]
  if e['from']==e['to'] or len(e['coordinates'])<2:
   collapsed.append(e['id']);continue
  edges.append(e)
 data['edges']=edges;qa['collapsedEdges']=collapsed;qa['mergedCoincidentNodes']=len(aliases)-len(kept)
 grouped=collections.defaultdict(list)
 for e in data['edges']:grouped[e['streetId']].append(e)
 for r in data['streets']:
  r['edgeIds']=[e['id'] for e in grouped[r['id']]]
  points=[]
  for e in grouped[r['id']]:
   part=e['coordinates']
   points.extend(part[1:] if points and points[-1]==part[0] else part)
  r['coordinates']=points
 qa['collapsedStreets']=[r['id'] for r in data['streets'] if not r['edgeIds']]
 data['streets']=[r for r in data['streets'] if r['edgeIds']]
 data['metadata']['surfaceRefinement']=qa['method'];data['metadata']['geometryReviewState']='Source-reviewed navigation survey with native-image review of canal banks, bridges, roof conflicts and rural approaches. Roof boundaries, exact doors, wooded footways and pedestrian bridge access remain artwork-scale approximations; independent integration audits are recorded separately.'
 data['metadata']['authoredStreetNameSource']='design/stomion/street-names.json'
 full_water=np.asarray(Image.open(ROOT/'design/stomion/water-mask.png').convert('L'))
 water_conflicts=[]
 for e in data['edges']:
  if e['kind'] in {'rail','ferry'}:continue
  hits=set()
  for a,b in zip(e['coordinates'],e['coordinates'][1:]):
   steps=max(1,math.ceil(math.dist(a,b)))
   for i in range(steps+1):
    t=i/steps;x=round(a[1]+t*(b[1]-a[1]));y=round(HEIGHT-(a[0]+t*(b[0]-a[0])))
    if full_water[y,x]>127:hits.add((x,y))
  if hits:water_conflicts.append({'id':e['id'],'name':e['name'],'kind':e['kind'],'waterPixels':len(hits),'sourceSamples':sorted(hits)[::max(1,len(hits)//8)][:10]})
 qa['waterConflicts']=water_conflicts
 qa['waterPixelsAfter']=sum(c['waterPixels'] for c in water_conflicts)
 (ROOT/'design/stomion/streets.json').write_text(json.dumps(data,indent=2)+'\n')
 write_overlay(data)
 (ROOT/'design/stomion/streets-refinement-qa.json').write_text(json.dumps(qa,indent=2)+'\n')
 (ROOT/'design/stomion/streets-qa.json').write_text(json.dumps(report(data),indent=2)+'\n')
 print(json.dumps({k:v for k,v in qa.items() if k!='movedJunctions'},indent=2));print(f'{len(moves)} relocated shared junctions')
if __name__=='__main__':main()
