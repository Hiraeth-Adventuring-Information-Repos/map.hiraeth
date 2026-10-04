#!/usr/bin/env python3
"""Build editable, explicitly proposed world corridors from reviewed controls.

Retains every original place, region, decorative line and calibrated world scale.
Native controls and artwork constraints live in design/world-transport.
"""
import hashlib
import heapq
import json
import math
from pathlib import Path
import re
import sys
from survey_curation import require_uncurated

import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'design/world-transport'
STEP = 4
MODES = {'road': (5, '#d6ad60'), 'trail': (3, '#85b875'), 'rail': (40, '#ba9feb'),
         'sail': (10, '#62bee5'), 'ferry': (8, '#63d5c1')}


def slug(value):
    return re.sub(r'[^a-z0-9]+', '-', value.lower()).strip('-')


class Terrain:
    def __init__(self, name, data):
        self.water = np.asarray(Image.open(OUT / f'{name}-water-mask.png').convert('L')) > 0
        self.depth = cv2.distanceTransform(self.water.astype(np.uint8), cv2.DIST_L2, 5)
        self.h, self.w = self.water.shape
        h, w = math.ceil(self.h / STEP), math.ceil(self.w / STEP)
        self.water_grid = np.zeros((h, w), np.float32)
        self.deep_grid = np.zeros((h, w), bool)
        self.sea_clear = np.zeros((h, w), bool)
        for y in range(h):
            for x in range(w):
                box = self.water[y*STEP:min((y+1)*STEP,self.h), x*STEP:min((x+1)*STEP,self.w)]
                self.water_grid[y,x] = box.mean()
                self.deep_grid[y,x] = self.depth[y*STEP:min((y+1)*STEP,self.h), x*STEP:min((x+1)*STEP,self.w)].max() > 12
                self.sea_clear[y,x] = bool(box.all())
        _,components,stats,_=cv2.connectedComponentsWithStats(self.sea_clear.astype(np.uint8),connectivity=4)
        sizes=stats[:,cv2.CC_STAT_AREA].copy();sizes[0]=0
        self.ocean=components==int(sizes.argmax())
        self.lakes=np.isin(components,np.where(sizes>=100)[0])
        self.sea_components=components;self.sea_sizes=sizes
        self.allowed_sea=self.ocean
        self.road_grid=np.zeros((h,w),np.uint8)
        self.land_penalty=np.zeros((h,w),np.float32)
        self.cliff = np.zeros((h,w), np.uint8)
        for line in data.get('lines', []):
            if line.get('type') == 'cliff':
                points = np.array([[round(p[1]/STEP), round((data['height']-p[0])/STEP)] for p in line['coordinates']], np.int32)
                cv2.polylines(self.cliff, [points], False, 1, 3)

    def point(self, cell):
        return [min(self.w-1, cell[0]*STEP+STEP/2), min(self.h-1,cell[1]*STEP+STEP/2)]

    def nearest(self, point, sea=False, limit=512):
        x,y = [int(v//STEP) for v in point]
        grid = self.allowed_sea if sea else ((self.water_grid == 0) & (self.cliff == 0))
        cells = max(1, math.ceil(limit/STEP))
        y0,y1=max(0,y-cells),min(grid.shape[0],y+cells+1)
        x0,x1=max(0,x-cells),min(grid.shape[1],x+cells+1)
        ys,xs=np.where(grid[y0:y1,x0:x1])
        if not len(xs): raise ValueError(f'No {"water" if sea else "dry"} anchor near {point}')
        distances=(xs+x0-x)**2+(ys+y0-y)**2
        at=int(distances.argmin())
        return (int(xs[at]+x0),int(ys[at]+y0))

    def path(self, start, end, sea=False):
        a,b=self.nearest(start,sea),self.nearest(end,sea)
        if a==b:return [start,end] if math.dist(start,end)>0 else [start]
        blocked = ~self.allowed_sea if sea else (self.deep_grid | (self.cliff>0))
        h,w=blocked.shape
        pending=[(math.dist(a,b),0,a)];cost={a:0};parents={}
        while pending:
            _,g,p=heapq.heappop(pending)
            if g>cost[p]+1e-8:continue
            if p==b:break
            x,y=p
            for dx,dy in [(1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)]:
                nx,ny=x+dx,y+dy;q=nx,ny
                if nx<0 or ny<0 or nx>=w or ny>=h or blocked[ny,nx]:continue
                if dx and dy and (blocked[y,nx] or blocked[ny,x]):continue
                n=g+math.hypot(dx,dy)*(1 if sea else 1+30*float(self.water_grid[ny,nx])+float(self.land_penalty[ny,nx]))
                if n<cost.get(q,math.inf):
                    cost[q]=n;parents[q]=p;heapq.heappush(pending,(n+math.dist(q,b),n,q))
        if b not in parents:raise ValueError(f'No {"sea" if sea else "land"} corridor between {start} and {end}')
        cells=[b]
        while cells[-1]!=a:cells.append(parents[cells[-1]])
        cells.reverse()
        # Retain every change of direction; do not smooth across shores or channels.
        points=[start]
        previous=None
        for i,c in enumerate(cells):
            direction=(cells[i+1][0]-c[0],cells[i+1][1]-c[1]) if i+1<len(cells) else None
            if i==0 or direction!=previous:points.append(self.point(c))
            previous=direction
        points.append(end)
        return [p for i,p in enumerate(points) if i==0 or math.dist(p,points[i-1])>1e-6]

    def water_runs(self, points):
        runs=[];current=[]
        for a,b in zip(points,points[1:]):
            n=max(1,math.ceil(math.dist(a,b)))
            for i in range(n):
                t=i/n;p=[a[k]+t*(b[k]-a[k]) for k in range(2)]
                x,y=[round(v) for v in p]
                if self.water[y,x]:current.append(p)
                elif current:runs.append(current);current=[]
        if current:runs.append(current)
        return runs


def integrate(name, plan):
    require_uncurated(ROOT/f'maps/{name}.json', 'transportReview')
    target=ROOT/f'maps/{name}.json'
    data=json.loads(target.read_text())
    original=json.loads((OUT/f'before-{name}.json').read_text())
    terrain=Terrain(name,original)
    places={p['name']:p for p in data['pointsOfInterest']}
    nodes={};node_by_name={};lines=[];crossings=[];ports={};adjustments=[]
    native=lambda p:[p[1],data['height']-p[0]]
    leaflet=lambda p:[round(data['height']-p[1],3),round(p[0],3)]
    lake_body=terrain.lakes
    if name=='IceBeach':
        pair=[native(places[label]['coords'])for label in ['Sleetmond','Ottiker']]
        candidates=[]
        for component in np.where(terrain.sea_sizes>=1000)[0]:
            grid=terrain.sea_components==component;terrain.allowed_sea=grid
            try:distances=[math.dist(p,terrain.point(terrain.nearest(p,True,256)))for p in pair]
            except ValueError:continue
            candidates.append((sum(distances),int(component)))
        if not candidates:raise ValueError('No shared lake body for Sleetmond and Ottiker')
        lake_body=terrain.sea_components==min(candidates)[1]
        terrain.allowed_sea=terrain.ocean
    for label in plan['places']:
        place=places[label];point=native(place['coords']);cell=terrain.nearest(point,False,256)
        x,y=[round(v) for v in point]
        if terrain.water[y,x]:
            anchor=terrain.point(cell);adjustments.append({'place':label,'originalNativePin':point,'dryRouteAnchor':anchor,'reason':'Original pin is on shoreline paint; POI is preserved, route anchor uses nearby dry ground.'});point=anchor
        node={'id':f'{data["id"]}-travel-{slug(label)}','name':label,
              'kind':'town' if place['type'] in ['City','Capital','Village','Town','Hamlet','Settlement'] else 'landmark',
              'coordinates':leaflet(point),'mappingSource':'world-transport-survey',
              'transportInterchange':'schematic settlement; local boarding locations unresolved'}
        nodes[node['id']]=node;node_by_name[label]=node;place['travelNodeId']=node['id']
    def add_link(a,b,mode,controls=None,label=None):
        aa,bb=native(a['coordinates']),native(b['coordinates']);sea=mode in ['sail','ferry']
        terrain.land_penalty=cv2.dilate(terrain.road_grid,np.ones((7,7),np.uint8)).astype(np.float32)*15 if mode=='rail' else np.zeros_like(terrain.water_grid)
        if sea:terrain.allowed_sea=lake_body if a.get('waterBody')=='lake' and b.get('waterBody')=='lake' else terrain.ocean
        controls=[terrain.point(terrain.nearest(p,sea,max(terrain.w,terrain.h) if sea else 512)) for p in (controls or [])];points=[]
        for start,end in zip([aa]+controls,controls+[bb]):
            part=terrain.path(start,end,sea);points.extend(part[1:] if points else part)
        runs=terrain.water_runs(points) if not sea else []
        ids=[]
        for run in runs:
            length=sum(math.dist(a,b) for a,b in zip(run,run[1:]))
            # A continental road cannot masquerade as a long sea crossing.
            if length>40:
                (OUT/'failed-corridor.json').write_text(json.dumps({'map':name,'link':label,'nativePoints':points,'wetSpan':run,'length':length},indent=2)+'\n')
                raise ValueError(f'{name}/{label or mode}: unproven {length:.0f}px land-water span; see failed-corridor.json')
            xs,ys=zip(*run);crossing_id=f'{data["id"]}-proposed-crossing-{len(crossings)+1:03}'
            crossing={'id':crossing_id,'kind':'proposed landing' if a['kind']=='port' or b['kind']=='port' else 'proposed river bridge',
                      'status':'proposed','nativeWaterSpan':[run[0],run[-1]],
                      'footprint':[[min(xs)-4,min(ys)-4],[max(xs)+4,min(ys)-4],[max(xs)+4,max(ys)+4],[min(xs)-4,max(ys)+4]],
                      'source':'Illustrated water crossing requiring an atlas-proposed structure; no existing bridge is asserted.'}
            crossings.append(crossing);ids.append(crossing_id)
        line={'id':f'{data["id"]}-transport-{len(lines)+1:03}', 'name':label or f'{a["name"]} – {b["name"]}',
              'type':'Travel','coordinates':[leaflet(p) for p in points],
              'travelMode':mode,'travelSpeedKph':MODES[mode][0],'travelFromNode':a['id'],'travelToNode':b['id'],
              'travelVisible':False,'travelServiceStatus':'proposed','travelGeometryStatus':'proposed corridor',
              'mappingSource':'world-transport-survey','color':MODES[mode][1],'weight':3,
              'summary':'Atlas-proposed route. Placement, speed and any service require setting review; no timetable is asserted.'}
        if mode in ['road','trail']:line['travelFareGp']=0
        else:line['travelDelayHours']=.25 if mode=='rail' else .5
        if ids:line['travelCrossingIds']=ids
        lines.append(line)
        if mode in ['road','trail']:
            cv2.polylines(terrain.road_grid,[np.array([[round(p[0]/STEP),round(p[1]/STEP)]for p in points],np.int32)],False,1,1)
        return line
    def port(label):
        if label in ports:return ports[label]
        town=node_by_name[label];point=native(town['coordinates'])
        local_lake=name=='IceBeach' and label in ['Sleetmond','Ottiker']
        terrain.allowed_sea=lake_body if local_lake else terrain.ocean
        cell=terrain.nearest(point,True,256)
        water=terrain.point(cell)
        # Port is a planned shoreline node with a separate walking approach.
        node={'id':town['id']+'-harbor','name':label+' harbor','kind':'port','coordinates':leaflet(water),
              'mappingSource':'world-transport-survey','placementStatus':'proposed coastal landing'}
        if local_lake:node['waterBody']='lake';node['name']=label+' lake landing'
        nodes[node['id']]=node;ports[label]=node
        add_link(town,node,'road',label=label+' harbor approach')
        return node
    for a,b,mode,controls in plan['links']:
        add_link(port(a) if mode in ['sail','ferry'] else node_by_name[a],
                 port(b) if mode in ['sail','ferry'] else node_by_name[b],mode,controls,f'{a} – {b}')
    data['lines']=[l for l in data.get('lines',[]) if l.get('mappingSource')!='world-transport-survey']+lines
    data['travelNodes']=[n for n in data.get('travelNodes',[]) if n.get('mappingSource')!='world-transport-survey']+list(nodes.values())
    data['transportReview']={'status':'proposed atlas network','mappingSource':'world-transport-survey',
        'sourceArtwork':original['imageUrl'],'sourceArtworkSha256':hashlib.sha256((ROOT/original['imageUrl']).read_bytes()).hexdigest(),
        'notes':plan['notes'],'proposedCrossings':crossings,'shorelinePinAdjustments':adjustments,
        'limits':['World maps show schematic corridors, not surveyed ground routes or safe crossings.',
                  'Speeds are editable moving-time estimates. Boat and train fares remain unknown.',
                  'No cross-map timetable, overnight rest or operating service is inferred.']}
    for p in data['pointsOfInterest']:
        if p['name']=='Castgate':p['linkedMapId']='castgate'
        elif p['name']=='Stomion':p['linkedMapId']='The-Port-City-of-Stomion'
    target.write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n')
    im=Image.open(ROOT/original['imageUrl']).convert('RGB');im.thumbnail((1600,1600));draw=ImageDraw.Draw(im);ratio=im.width/data['width']
    for line in lines:
        points=[(p[1]*ratio,(data['height']-p[0])*ratio) for p in line['coordinates']]
        draw.line(points,fill=MODES[line['travelMode']][1],width=3 if line['travelMode']=='rail' else 2)
    for node in nodes.values():
        x,y=native(node['coordinates']);x*=ratio;y*=ratio;draw.ellipse((x-3,y-3,x+3,y+3),fill='#fff1b4',outline='#3b243e')
    im.save(OUT/f'{name}-transport-overlay.png')
    (OUT/f'{name}-integration.json').write_text(json.dumps({'mapSha256':hashlib.sha256(target.read_bytes()).hexdigest(),
        'places':len(plan['places']),'connectionPoints':len(nodes),'transportLinks':len(lines),
        'modes':{mode:sum(line['travelMode']==mode for line in lines) for mode in MODES},
        'proposedCrossings':len(crossings),'preservedOriginalLines':len(original.get('lines',[])),
        'allServicesProposed':True,'shorelineAnchorAdjustments':adjustments},indent=2)+'\n')
    print(json.dumps({'map':name,'nodes':len(nodes),'links':len(lines),'proposedCrossings':len(crossings)}),flush=True)


if __name__=='__main__':
    selected=[(name,plan) for name,plan in json.loads((OUT/'corridor-plan.json').read_text()).items() if not sys.argv[1:] or name in sys.argv[1:]]
    # Preflight the whole batch before any map is replaced.
    for name,_ in selected:require_uncurated(ROOT/f'maps/{name}.json', 'transportReview')
    for name,plan in selected:integrate(name,plan)
