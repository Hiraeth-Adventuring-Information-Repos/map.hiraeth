#!/usr/bin/env python3
"""Trace Castgate roof compounds and constrained, source-guided pedestrian streets.

Native X/Y controls and exclusions are versioned in design/castgate. This is an
atlas address inventory, not a claim about occupants or canonical street names.
Run with PYTHONPATH=/tmp/stomion-cv and the artifact Python runtime.
"""
import collections
import hashlib
import heapq
import json
import math
from pathlib import Path
import re
from survey_curation import require_uncurated

import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'design/castgate'
N=8192
STEP=4
SOURCE='castgate-address-survey'

def leaf(p):return [round(N-p[1],3),round(p[0],3)]
def native(p):return [p[1],N-p[0]]
def slug(s):return re.sub('[^a-z0-9]+','-',s.lower()).strip('-')

def proper_crosses(points):
    p=np.array(points,float);ends=np.roll(p,-1,axis=0);vec=ends-p
    for i in range(len(p)):
        idx=np.arange(i+2,len(p));idx=idx[idx!=len(p)-1]if i==0 else idx
        if not len(idx):continue
        delta=p[idx]-p[i];det=vec[i,0]*vec[idx,1]-vec[i,1]*vec[idx,0];safe=np.abs(det)>1e-8
        t=np.divide(delta[:,0]*vec[idx,1]-delta[:,1]*vec[idx,0],det,out=np.zeros(len(idx)),where=safe)
        u=np.divide(delta[:,0]*vec[i,1]-delta[:,1]*vec[i,0],det,out=np.zeros(len(idx)),where=safe)
        if np.any(safe&(t>1e-7)&(t<1-1e-7)&(u>1e-7)&(u<1-1e-7)):return True
    return False

def roof_traces(rgb,hsv,water):
    black=(cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY)<57).astype(np.uint8)
    contours,hierarchy=cv2.findContours(black,cv2.RETR_TREE,cv2.CHAIN_APPROX_SIMPLE)
    candidates={}
    for i,c in enumerate(contours):
        area=cv2.contourArea(c);x,y,w,h=cv2.boundingRect(c)
        depth=0;parent=hierarchy[0,i,3]
        while parent>=0:depth+=1;parent=hierarchy[0,parent,3]
        if depth%2==0 and 700<=area<=450000 and 16<=w<1300 and 16<=h<1300:
            mask=np.zeros((h,w),np.uint8);cv2.fillPoly(mask,[c-[x,y]],1)
            pixels=hsv[y:y+h,x:x+w][mask>0]
            tan=((pixels[:,0]>=8)&(pixels[:,0]<=35)&(pixels[:,1]>=20)&(pixels[:,2]>=110)).mean()
            green=((pixels[:,0]>=36)&(pixels[:,0]<=90)&(pixels[:,1]>=50)).mean()
            m=cv2.moments(c);center=[m['m10']/m['m00'],m['m01']/m['m00']]
            wet=water[y:y+h,x:x+w][mask>0].mean()
            # Ordinary tan roofs plus individually visible colored roofs. Trees,
            # open sea, piers and open plazas are not building footprints.
            accepted=(tan>=.22 or (area>=4000 and tan>=.035)) and green<.25 and wet<.12 and max(w/h,h/w)<6
            if center[0]<4200 and center[1]<2050 and center[0]<(-.9*center[1]+5900):accepted=False
            if math.dist(center,[1430,5130])<270:accepted=False # southern grove tree crown
            if math.dist(center,[4750,3825])<100:accepted=False # Frostviel plaza ornaments
            if accepted:candidates[i]=(c,area,[x,y,w,h],tan,green)
    records=[]
    for i,(c,area,bounds,tan,green) in candidates.items():
        p=hierarchy[0,i,3];nested=False
        while p>=0:
            if p in candidates:nested=True;break
            p=hierarchy[0,p,3]
        if nested:continue
        # Simplification must never shortcut across a narrow source roof edge.
        for tolerance in [1.1,.9,.7,.5,.3,.1]:
            poly=cv2.approxPolyDP(c,tolerance,True).reshape(-1,2)
            if not proper_crosses(poly):break
        if proper_crosses(poly):
            x,y,w,h=bounds;filled=np.zeros((h+4,w+4),np.uint8);cv2.fillPoly(filled,[poly-[x-2,y-2]],1)
            clean,_=cv2.findContours(filled,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
            poly=cv2.approxPolyDP(max(clean,key=cv2.contourArea),.2,True).reshape(-1,2)+[x-2,y-2]
            if proper_crosses(poly):raise ValueError('Could not retain a non-crossing source roof boundary')
        x,y,w,h=bounds;mask=np.zeros((h,w),np.uint8);cv2.fillPoly(mask,[poly-[x,y]],1)
        distances=cv2.distanceTransform(mask,cv2.DIST_L2,5);cy,cx=np.unravel_index(distances.argmax(),distances.shape)
        records.append({'nativePolygon':poly.tolist(),'center':[float(x+cx),float(y+cy)],'area':area,'bounds':bounds,'tanFraction':float(tan),'greenFraction':float(green)})
    records.sort(key=lambda r:(round(r['center'][1]/100),r['center'][0]))
    return records

class Ground:
    def __init__(self,hsv,water,roofs,controls):
        self.water=water
        self.roof=np.zeros((N,N),np.uint8)
        for r in roofs:cv2.fillPoly(self.roof,[np.array(r['nativePolygon'],np.int32)],1)
        self.deck=np.zeros((N,N),np.uint8)
        for name,points in controls['docks']:
            cv2.polylines(self.deck,[np.array([[round(x*N/1600),round(y*N/1600)]for x,y in points],np.int32)],False,1,16)
        # Retain all polygon edges and a small clearance in every occupied cell.
        solid=(self.roof>0)|(water & (self.deck==0))
        self.blocked=solid.reshape(N//STEP,STEP,N//STEP,STEP).max(axis=(1,3))
        _,components,stats,_=cv2.connectedComponentsWithStats((~self.blocked).astype(np.uint8),connectivity=4)
        sizes=stats[:,cv2.CC_STAT_AREA].copy();sizes[0]=0
        self.connected_ground=components==int(sizes.argmax())
        # Illustrated cobbles are gray, while surrounding public ground is tan.
        cobble=((hsv[:,:,1]<70)&(hsv[:,:,2]>=65)&(hsv[:,:,2]<160)&(~water)&(self.roof==0)).astype(np.uint8)
        near=cv2.distanceTransform(1-cobble,cv2.DIST_L2,5)
        self.cost=1+np.minimum(near[STEP//2::STEP,STEP//2::STEP]/15,12)
        self.cost[self.deck[STEP//2::STEP,STEP//2::STEP]>0]=1
    def point(self,c):return [c[0]*STEP+2,c[1]*STEP+2]
    def nearest(self,p,limit=240):
        x,y=[round((v-2)/STEP)for v in p];n=math.ceil(limit/STEP)
        x0,x1=max(0,x-n),min(N//STEP,x+n+1);y0,y1=max(0,y-n),min(N//STEP,y+n+1)
        ys,xs=np.where(self.connected_ground[y0:y1,x0:x1])
        if not len(xs):raise ValueError(f'No ground at {p}')
        i=int(((xs+x0-x)**2+(ys+y0-y)**2).argmin());return int(xs[i]+x0),int(ys[i]+y0)
    def path(self,a,b):
        if a==b:return [a]
        queue=[(math.dist(a,b),0,a)];cost={a:0};parent={};W=N//STEP
        while queue:
            _,g,p=heapq.heappop(queue)
            if g>cost[p]+1e-7:continue
            if p==b:break
            x,y=p
            for dx,dy in [(1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)]:
                nx,ny=x+dx,y+dy;q=nx,ny
                if nx<0 or ny<0 or nx>=W or ny>=W or self.blocked[ny,nx]:continue
                if dx and dy and (self.blocked[y,nx]or self.blocked[ny,x]):continue
                n=g+math.hypot(dx,dy)*float(self.cost[ny,nx])
                if n<cost.get(q,math.inf):cost[q]=n;parent[q]=p;heapq.heappush(queue,(n+math.dist(q,b),n,q))
        if b not in parent:raise ValueError(f'No Castgate ground path {a} to {b}')
        result=[b]
        while result[-1]!=a:result.append(parent[result[-1]])
        return result[::-1]

def main():
    require_uncurated(ROOT/'maps/castgate.json', 'addressReview')
    data=json.loads((OUT.parent/'world-transport/before-castgate.json').read_text())
    im=Image.open(ROOT/'maps/castgate.webp').convert('RGB');rgb=np.asarray(im);hsv=cv2.cvtColor(rgb,cv2.COLOR_RGB2HSV)
    blue=((hsv[:,:,0]>=73)&(hsv[:,:,0]<=125)&(hsv[:,:,1]>45)&(hsv[:,:,2]<200)).astype(np.uint8)
    _,components,stats,_=cv2.connectedComponentsWithStats(blue,connectivity=8)
    sizes=stats[:,cv2.CC_STAT_AREA].copy();sizes[0]=0;water=components==int(sizes.argmax())
    # Close tiny paint gaps in the continuous harbor, without flooding roofs.
    water=cv2.morphologyEx(water.astype(np.uint8),cv2.MORPH_OPEN,np.ones((19,19),np.uint8))>0
    water=cv2.morphologyEx(water.astype(np.uint8),cv2.MORPH_CLOSE,np.ones((5,5),np.uint8))>0
    Image.fromarray(water.astype(np.uint8)*255).save(OUT/'source/water-mask.png')
    roofs=roof_traces(rgb,hsv,water)
    (OUT/'source/roof-traces.json').write_text(json.dumps(roofs,indent=2)+'\n')
    print('Roof compounds',len(roofs),flush=True)
    controls=json.loads((OUT/'street-controls.json').read_text())
    def on_pier(record):
        center=np.array(record['center'])
        for _,points in controls['docks']:
            for a,b in zip(points,points[1:]):
                a=np.array(a)*N/1600;b=np.array(b)*N/1600;ray=b-a;t=max(0,min(1,float(np.dot(center-a,ray)/max(1,np.dot(ray,ray)))))
                if math.dist(center,a+t*ray)<65:return True
        return False
    roofs=[r for r in roofs if not on_pier(r)]
    # The Crystal Needle's open basin is a landmark obstacle, not a house.
    obstacles=[r for r in roofs if math.dist(r['center'],[5906,2623])<100]
    roofs=[r for r in roofs if r not in obstacles]
    (OUT/'source/roof-traces.json').write_text(json.dumps(roofs,indent=2)+'\n')
    ground=Ground(hsv,water,roofs+obstacles,controls)
    Image.fromarray(ground.deck*255).save(OUT/'source/deck-mask.png')
    edges={};adj=collections.defaultdict(set);street_paths=[]
    for name,points in controls['streets']+controls['docks']:
        cells=[ground.nearest([x*N/1600,y*N/1600])for x,y in points];path=[]
        for a,b in zip(cells,cells[1:]):
            part=ground.path(a,b);path.extend(part[1:]if path else part)
        street_paths.append((name,path))
        for a,b in zip(path,path[1:]):
            if a==b:continue
            edge=tuple(sorted((a,b)));edges.setdefault(edge,name);adj[a].add(b);adj[b].add(a)
        print('Street',name,len(path),flush=True)
    # Turn every intersection, terminal and street-name change into a real node.
    junctions={p for p,neighbors in adj.items()if len(neighbors)!=2 or len({edges[tuple(sorted((p,q)))]for q in neighbors})>1}
    visited=set();lines=[];nodes=[];node_ids={}
    def node(p):
        if p not in node_ids:
            identifier=f'castgate-junction-{len(nodes)+1:04}';node_ids[p]=identifier
            nodes.append({'id':identifier,'name':f'Castgate junction {len(nodes)+1}','kind':'junction','coordinates':leaf(ground.point(p)),'mappingSource':SOURCE})
        return node_ids[p]
    for p in sorted(junctions):
        for q in sorted(adj[p]):
            edge=tuple(sorted((p,q)))
            if edge in visited:continue
            name=edges[edge];chain=[p,q];visited.add(edge)
            while chain[-1]not in junctions:
                next_point=next(r for r in adj[chain[-1]]if r!=chain[-2]);visited.add(tuple(sorted((chain[-1],next_point))));chain.append(next_point)
            simplified=[chain[0]]
            for i in range(1,len(chain)-1):
                if tuple(chain[i][k]-chain[i-1][k]for k in range(2))!=tuple(chain[i+1][k]-chain[i][k]for k in range(2)):simplified.append(chain[i])
            simplified.append(chain[-1])
            lines.append({'id':f'castgate-street-{len(lines)+1:04}','name':name,'type':'Travel','coordinates':[leaf(ground.point(c))for c in simplified],
                'travelMode':'road','travelSpeedKph':5,'travelFareGp':0,'travelFromNode':node(chain[0]),'travelToNode':node(chain[-1]),'streetId':'castgate-'+slug(name),
                'travelVisible':False,'mappingSource':SOURCE,'geometryReview':'Roof and harbor constrained; illustrated cobbles guide the street centerline. Local address labels are atlas additions.'})
    # A closed traced block needs two distinct junctions to remain routable.
    for line in list(lines):
        if line['travelFromNode']!=line['travelToNode']:continue
        index=len(line['coordinates'])//2;anchor=line['coordinates'][index]
        identifier=f'castgate-cycle-{len(nodes)+1:04}'
        nodes.append({'id':identifier,'name':f'Castgate junction {len(nodes)+1}','kind':'junction','coordinates':anchor,'mappingSource':SOURCE})
        after=dict(line);after['id']=line['id']+'-return';after['coordinates']=line['coordinates'][index:];after['travelFromNode']=identifier
        line['coordinates']=line['coordinates'][:index+1];line['travelToNode']=identifier;lines.append(after)
    data['lines']+=lines;data['travelNodes']=nodes
    data['streets']=[{'id':'castgate-'+slug(name),'name':name,'namingStatus':'atlas proposal'}for name,_ in controls['streets']+controls['docks']]
    data['scalePixels']=6630;data['scaleKilometers']=2
    data['scaleReview']={'status':'provisional','diameterKilometers':2,'measurement':'Approximate 6630 native pixels between opposite dome walls; image margins excluded.',
        'note':'Provisional scale: the dome is about 2 km across. Distances can be recalibrated in map settings.', 'authority':'User authorized a reasonable scale estimate.'}
    # Building entrances are computed from roof boundaries to an actual traced
    # street cell. A multi-source ground search supplies walks around neighbors.
    street_cells=set(adj);queue=[];dist={};parent={};root={}
    for c in street_cells:dist[c]=0;root[c]=c;heapq.heappush(queue,(0,c))
    W=N//STEP
    while queue:
        g,p=heapq.heappop(queue)
        if g>dist[p]+1e-7:continue
        if g>180:continue # about 720 native pixels; distant roofs stay unresolved
        x,y=p
        for dx,dy in [(1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)]:
            nx,ny=x+dx,y+dy;q=nx,ny
            if nx<0 or ny<0 or nx>=W or ny>=W or ground.blocked[ny,nx]:continue
            if dx and dy and (ground.blocked[y,nx]or ground.blocked[ny,x]):continue
            n=g+math.hypot(dx,dy)
            if n<dist.get(q,math.inf):dist[q]=n;parent[q]=p;root[q]=root[p];heapq.heappush(queue,(n,q))
    # Lookup the precise exported segment owning each native street edge.
    cell_line={}
    for line in lines:
        for a,b in zip(line['coordinates'],line['coordinates'][1:]):
            aa,bb=native(a),native(b);length=math.dist(aa,bb);n=max(1,round(length/STEP))
            for j in range(n+1):
                p=[aa[k]+(bb[k]-aa[k])*j/n for k in range(2)];cell_line[(round((p[0]-2)/STEP),round((p[1]-2)/STEP))]=line
    buildings=[];numbers=collections.Counter();unresolved=[]
    for ordinal,r in enumerate(roofs,1):
        poly=np.array(r['nativePolygon'],np.int32);x,y,w,h=r['bounds'];roi=np.zeros((h+16,w+16),np.uint8);cv2.fillPoly(roi,[poly-[x-8,y-8]],1)
        ring=cv2.dilate(roi,np.ones((13,13),np.uint8))-roi
        ys,xs=np.where(ring>0);options={((int(xx+x-8)-2)//STEP,(int(yy+y-8)-2)//STEP)for xx,yy in zip(xs,ys)}
        options=[c for c in options if c in dist]
        building={'id':f'castgate-building-{ordinal:04}','coordinates':leaf(r['center']),'footprint':[leaf(p)for p in r['nativePolygon']],
            'mappingSource':SOURCE,'sourceReview':{'status':'source traced','roofCompoundAreaPixels':r['area'],'method':'Native black roof outline, color and spatial exclusions; connected roof compounds retained.'}}
        if options:
            end=min(options,key=lambda c:dist[c]);target=root[end];line=cell_line[target];point=ground.point(end)
            # Pick the closest polygon boundary point, instead of a ray that can
            # cross another wing of the same concave roof compound.
            best=None
            for a,b in zip(r['nativePolygon'],r['nativePolygon'][1:]+r['nativePolygon'][:1]):
                ray=np.array(b)-a;t=max(0,min(1,float(np.dot(np.array(point)-a,ray)/max(1,np.dot(ray,ray)))));p=(np.array(a)+t*ray).tolist()
                if best is None or math.dist(p,point)<best[0]:best=math.dist(p,point),p
            entrance=best[1];path=[end]
            while path[-1]!=target:path.append(parent[path[-1]])
            approach=[entrance]+[ground.point(c)for c in path]
            building.update({'entrance':leaf(entrance),'access':{'lineId':line['id'],'coordinates':leaf(ground.point(target)),'path':[leaf(p)for p in approach]},
                'streetId':line['streetId'],'accessReview':{'status':'connected','method':'Roof boundary to traced street through clear ground; harbor and neighboring footprints excluded.'}})
            numbers[line['streetId']]+=1;building['number']=str(numbers[line['streetId']]);building['address']=building['number']+' '+line['name']
        else:
            numbers['unresolved']+=1;building.update({'number':str(numbers['unresolved']),'address':str(numbers['unresolved'])+' Unmapped Roof','accessReview':{'status':'unmapped','reason':'Source roof retained; no verified walking approach to this street network.'}});unresolved.append(building['id'])
        buildings.append(building)
    data['buildings']=buildings
    data['walkingObstacles']=[{'id':f'castgate-basin-{i+1}','kind':'open landmark basin','footprint':[leaf(p)for p in r['nativePolygon']],'mappingSource':SOURCE}for i,r in enumerate(obstacles)]
    poi_review=[]
    for place in data['pointsOfInterest']:
        p=native(place['coords']);near=min(buildings,key=lambda b:math.dist(p,native(b['coordinates'])))
        distance=math.dist(p,native(near['coordinates']))
        if distance<230 and place['name']not in ["Bleak's Stand",'Frostviel','The Crystal Needle','The Mourning Arch']:
            near.setdefault('aliases',[]).append(place['name']);near['name']=place['name'];place['buildingId']=near['id']
            poi_review.append({'place':place['name'],'buildingId':near['id'],'pinPreserved':True,'nativeDistanceToRoofCenter':round(distance,2)})
        else:
            c=ground.nearest(p);target=root.get(c)
            if target:
                node_id=f'castgate-landmark-{slug(place["name"])}';coordinates=leaf(ground.point(c));street=cell_line[target];path=[c]
                while path[-1]!=target:path.append(parent[path[-1]])
                node_record={'id':node_id,'name':place['name'],'kind':'landmark','coordinates':coordinates,'mappingSource':SOURCE};nodes.append(node_record);place['travelNodeId']=node_id
                # Attach at the nearest street endpoint using the actual street
                # segment, with an intervening real junction at the access cell.
                attachment=f'castgate-landmark-access-{slug(place["name"])}';anchor=leaf(ground.point(target))
                if anchor==street['coordinates'][0]:attachment=street['travelFromNode']
                elif anchor==street['coordinates'][-1]:attachment=street['travelToNode']
                else:
                    nodes.append({'id':attachment,'name':place['name']+' street access','kind':'junction','coordinates':anchor,'mappingSource':SOURCE})
                    # Preserve exact topology by splitting the street at this cell.
                    points=street['coordinates'];idx=min(range(len(points)-1),key=lambda i:abs(math.dist(points[i],anchor)+math.dist(anchor,points[i+1])-math.dist(points[i],points[i+1])))
                    after=dict(street);after['id']=street['id']+'-'+slug(place['name']);after['coordinates']=[anchor]+points[idx+1:];after['travelFromNode']=attachment
                    street['coordinates']=points[:idx+1]+[anchor];street['travelToNode']=attachment;lines.append(after);data['lines'].append(after)
                data['lines'].append({'id':node_id+'-walk','name':place['name']+' approach','type':'Travel','coordinates':[leaf(ground.point(q))for q in path],
                    'travelMode':'trail','travelSpeedKph':3,'travelFareGp':0,'travelFromNode':node_id,'travelToNode':attachment,'travelVisible':False,'mappingSource':SOURCE})
                poi_review.append({'place':place['name'],'travelNodeId':node_id,'pinPreserved':True,'routeAnchorNative':ground.point(c)})
            else:poi_review.append({'place':place['name'],'pinPreserved':True,'status':'walking access unresolved'})
    # Landmark junctions may split a street after entrances were calculated.
    # Reattach each entrance to the exact remaining segment containing its point.
    for building in buildings:
        if not building.get('access'):continue
        anchor=building['access']['coordinates']
        matches=[]
        for line in data['lines']:
            if line.get('streetId')!=building['streetId']:continue
            if any(abs(math.dist(a,anchor)+math.dist(anchor,b)-math.dist(a,b))<.001 for a,b in zip(line['coordinates'],line['coordinates'][1:])):matches.append(line)
        if not matches:raise ValueError(f'Lost street attachment for {building["id"]}')
        building['access']['lineId']=matches[0]['id']
    data['addressReview']={'status':'source traced atlas inventory','mappingSource':SOURCE,'sourceArtworkSha256':hashlib.sha256((ROOT/'maps/castgate.webp').read_bytes()).hexdigest(),
        'buildingCount':len(buildings),'unresolvedAccess':unresolved,'poiReview':poi_review,
        'limits':['Building outlines depict roof compounds, not occupancy or individual households.','Address numbers and street labels are new atlas conveniences.','Unresolved walking access remains explicitly unmapped.']}
    (ROOT/'maps/castgate.json').write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n')
    review=im.resize((2048,2048));draw=ImageDraw.Draw(review);ratio=.25
    for b in buildings:draw.line([(p[1]*ratio,(N-p[0])*ratio)for p in b['footprint']+[b['footprint'][0]]],fill='#4cdcc6',width=1)
    for l in data['lines']:
        if l.get('mappingSource')==SOURCE:draw.line([(p[1]*ratio,(N-p[0])*ratio)for p in l['coordinates']],fill='#ffcf69',width=2)
    review.save(OUT/'castgate-survey-overlay.png')
    (OUT/'integration.json').write_text(json.dumps({'roofCompounds':len(buildings),'travelLinks':len([l for l in data['lines']if l.get('travelMode')]),'nodes':len(nodes),'unresolvedAccess':unresolved,'poiReview':poi_review,'scalePixels':6630,'scaleKilometers':2},indent=2)+'\n')
    print('Integrated',len(buildings),'roofs;',len(lines),'streets;',len(unresolved),'unresolved entrances',flush=True)

if __name__=='__main__':main()
