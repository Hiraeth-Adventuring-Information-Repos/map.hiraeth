#!/usr/bin/env python3
"""Declare proposed grade separation at schematic world road/rail crossings.

Crossing geometry never creates a routing interchange. Small footprints are
atlas symbols in artwork pixels, not assertions about physical bridge widths.
"""
import hashlib
import json
import math
import sys
from pathlib import Path
from survey_curation import require_uncurated
ROOT=Path(__file__).resolve().parents[1]

def cross(a,b):return a[0]*b[1]-a[1]*b[0]
def intersections(a,b,c,d):
    ray=[b[k]-a[k]for k in range(2)];edge=[d[k]-c[k]for k in range(2)];delta=[c[k]-a[k]for k in range(2)];det=cross(ray,edge)
    if abs(det)<1e-8:return []
    t,u=cross(delta,edge)/det,cross(delta,ray)/det
    if -1e-8<=t<=1+1e-8 and -1e-8<=u<=1+1e-8:return [[a[k]+t*ray[k]for k in range(2)]]
    return []

def apply(name):
    require_uncurated(ROOT/f'maps/{name}.json', 'transportReview')
    target=ROOT/f'maps/{name}.json';data=json.loads(target.read_text());h=data['height'];review=data['transportReview'];crossings=review['proposedCrossings']
    crossings[:]=[p for p in crossings if p.get('kind')!='proposed road overpass']
    for line in data['lines']:
        if line.get('travelMode')=='rail':line.pop('travelOcclusions',None)
        if line.get('travelCrossingIds'):line['travelCrossingIds']=[x for x in line['travelCrossingIds']if '-overpass-'not in x]
    rails=[l for l in data['lines']if l.get('travelMode')=='rail'];roads=[l for l in data['lines']if l.get('travelMode')in ['road','trail']]
    events=[]
    for rail in rails:
        rp=[[p[1],h-p[0]]for p in rail['coordinates']]
        for road in roads:
            pp=[[p[1],h-p[0]]for p in road['coordinates']];shared=[]
            for a,p in [('travelFromNode',pp[0]),('travelToNode',pp[-1])]:
                if road[a]in [rail['travelFromNode'],rail['travelToNode']]:shared.append(p)
            points=[]
            for a,b in zip(rp,rp[1:]):
                for c,d in zip(pp,pp[1:]):
                    for point in intersections(a,b,c,d):
                        if any(math.dist(point,p)<48 for p in shared):continue
                        if not any(math.dist(point,p)<12 for p in points):points.append(point)
            for point in points:
                identifier=f'{data["id"]}-overpass-{len(events)+1:03}';x,y=point;poly=[[x-10,y-10],[x+10,y-10],[x+10,y+10],[x-10,y+10]]
                crossing={'id':identifier,'kind':'proposed road overpass','status':'proposed','nativeCenter':point,'footprint':poly,
                    'roadLineId':road['id'],'railLineId':rail['id'],'source':'Atlas-proposed grade separation; bridge size and construction unresolved. The footprint is a schematic drawing symbol.'}
                crossings.append(crossing);events.append(crossing)
                road.setdefault('travelCrossingIds',[]).append(identifier);rail.setdefault('travelCrossingIds',[]).append(identifier)
                rail.setdefault('travelOcclusions',[]).append([[round(h-p[1],3),round(p[0],3)]for p in poly])
    review['railCrossingPolicy']='Roads cross proposed rails on proposed overpasses. Drawn crossings do not create interchanges; boarding remains schematic at named settlements.'
    target.write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n')
    (ROOT/f'design/world-transport/{name}-rail-crossings.json').write_text(json.dumps({'proposedOverpasses':events,'railLines':len(rails),'mapSha256':hashlib.sha256(target.read_bytes()).hexdigest()},indent=2)+'\n')
    print(name,len(events),'proposed grade separations')

if __name__=='__main__':
    selected=[name for name in ['Fair-Content','Astrousia','IceBeach']if not sys.argv[1:]or name in sys.argv[1:]]
    for name in selected:require_uncurated(ROOT/f'maps/{name}.json', 'transportReview')
    for name in selected:apply(name)
