#!/usr/bin/env python3
"""Independent native-pixel audit of atlas transport and building access geometry."""
import hashlib
import json
import math
from pathlib import Path
import sys
import cv2
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]

def native(p,h):return [p[1],h-p[0]]
def samples(a,b):
    count=max(1,math.ceil(math.dist(a,b)*2))
    for i in range(count+1):yield [a[k]+(b[k]-a[k])*i/count for k in range(2)]
def inside(p,poly):return cv2.pointPolygonTest(np.array(poly,np.float32),tuple(p),False)>=0

def audit_world(name):
    data=json.loads((ROOT/f'maps/{name}.json').read_text());before=json.loads((ROOT/f'design/world-transport/before-{name}.json').read_text())
    water=np.asarray(Image.open(ROOT/f'design/world-transport/{name}-water-mask.png'))>0;h=data['height'];crossings={p['id']:p for p in data['transportReview']['proposedCrossings']}
    failures=[];counts={'landWaterSamplesOnProposedStructures':0,'boatWaterSamples':0,'dryLandSamples':0,'reviewedDryArtworkSamples':0}
    exceptions=data['transportReview'].get('correctionReview',{}).get('artworkMaskExceptions',[])
    for line in data['lines']:
        if not line.get('travelMode') or line.get('travelServiceStatus')=='closed':continue
        sea=line['travelMode']in ['sail','ferry'];polys=[crossings[x]['footprint']for x in line.get('travelCrossingIds',[])if x in crossings]
        points=[native(p,h)for p in line['coordinates']]
        for a,b in zip(points,points[1:]):
            for p in samples(a,b):
                x,y=[round(v)for v in p];wet=bool(water[y,x])
                if sea:
                    if not wet:failures.append({'line':line['id'],'kind':'boat over unpainted land','native':p});break
                    counts['boatWaterSamples']+=1
                elif wet and any(entry.get('trailSourceId')==line.get('trailSourceId') and entry['nativeBounds'][0]<=p[0]<=entry['nativeBounds'][2] and entry['nativeBounds'][1]<=p[1]<=entry['nativeBounds'][3] for entry in exceptions):
                    counts['reviewedDryArtworkSamples']+=1
                elif wet:
                    if not any(inside(p,poly)for poly in polys):failures.append({'line':line['id'],'kind':'land over water without proposed structure','native':p});break
                    counts['landWaterSamplesOnProposedStructures']+=1
                else:counts['dryLandSamples']+=1
    preserved={key:data[key]==before[key]for key in ['imageUrl','width','height','scalePixels','scaleKilometers','regions','blurb','selectorDescription']}
    place_changes=[]
    for old,new in zip(before['pointsOfInterest'],data['pointsOfInterest']):
        old_fields={key:new.get(key)for key in old}
        if old!=old_fields:place_changes.append(old['name'])
    old_lines=[line for line in data['lines']if line.get('mappingSource')!='world-transport-survey']
    preserved['originalLines']=old_lines==before.get('lines',[]);preserved['originalPOIFields']=not place_changes
    return {'map':name,'counts':counts,'failures':failures,'preservation':preserved,'closedSpansExcluded':sum(line.get('travelServiceStatus')=='closed'for line in data['lines']),
        'sourceMaskLimit':'Illustration-derived coast mask, with separately source-reviewed dry label/shading exceptions; proposals do not establish existing services or safe real ground conditions.'}

def audit_castgate():
    data=json.loads((ROOT/'maps/castgate.json').read_text());water=np.asarray(Image.open(ROOT/'design/castgate/source/water-mask.png'))>0
    review=data.get('addressReview',{}).get('correctionReview',{})
    deck_path=ROOT/'design/castgate/source/deck-mask.png'
    if review.get('deckMask'):
        declaration=review['deckMask'];deck_path=(ROOT/(declaration['path'] if isinstance(declaration,dict) else declaration)).resolve()
        if not deck_path.is_relative_to(ROOT/'design/castgate/correction-pass'):raise ValueError('Reviewed deck mask must belong to the Castgate correction artifacts.')
        expected_sha=declaration.get('sha256') if isinstance(declaration,dict) else review.get('deckMaskSha256')
        artwork_sha=declaration.get('sourceArtworkSha256') if isinstance(declaration,dict) else review.get('deckMaskSourceArtworkSha256')
        if hashlib.sha256(deck_path.read_bytes()).hexdigest()!=expected_sha:raise ValueError('Reviewed deck mask changed after source review.')
        if hashlib.sha256((ROOT/'maps/castgate.webp').read_bytes()).hexdigest()!=artwork_sha:raise ValueError('Reviewed deck mask artwork changed after source review.')
    deck=np.asarray(Image.open(deck_path))>0
    if deck.shape!=water.shape:raise ValueError('Deck and harbor masks must share the native artwork bounds.')
    roof=np.zeros((8192,8192),np.int32);polygons={}
    for i,b in enumerate(data['buildings'],1):
        poly=[native(p,8192)for p in b['footprint']];polygons[b['id']]=poly
        rings=[poly]+[[native(p,8192)for p in ring]for ring in b.get('footprintHoles',[])]
        x,y,w,h=cv2.boundingRect(np.array(poly,np.int32));local=np.zeros((h,w),np.uint8)
        cv2.fillPoly(local,[np.array(poly,np.int32)-[x,y]],1)
        for hole in rings[1:]:cv2.fillPoly(local,[np.array(hole,np.int32)-[x,y]],0)
        # Courtyards may contain separately addressed detached roofs. Do not
        # erase those earlier records while subtracting this building's holes.
        view=roof[y:y+h,x:x+w];view[local>0]=i
    for i,obstacle in enumerate(data.get('walkingObstacles',[]),len(data['buildings'])+1):cv2.fillPoly(roof,[np.array([native(p,8192)for p in obstacle['footprint']],np.int32)],i)
    failures=[];counts={'streetSamples':0,'accessSamples':0,'dockSamples':0}
    for line in data['lines']:
        if not line.get('travelMode'):continue
        for a,b in zip(line['coordinates'],line['coordinates'][1:]):
            for p in samples(native(a,8192),native(b,8192)):
                x,y=[round(v)for v in p];counts['streetSamples']+=1
                if water[y,x] and not deck[y,x]:failures.append({'line':line['id'],'kind':'street over water without deck','native':p});break
                if roof[y,x]:failures.append({'line':line['id'],'kind':'street over roof','native':p});break
                if deck[y,x]:counts['dockSamples']+=1
    for ordinal,b in enumerate(data['buildings'],1):
        if not b.get('access'):continue
        points=[native(p,8192)for p in b['access']['path']]
        for i,(a,end)in enumerate(zip(points,points[1:])):
            for p in samples(a,end):
                if i==0 and math.dist(p,points[0])<1.5:continue # raster rounding at source roof boundary
                x,y=[round(v)for v in p];counts['accessSamples']+=1
                if roof[y,x]:failures.append({'building':b['id'],'kind':'entrance over roof','native':p});break
                if water[y,x] and not deck[y,x]:failures.append({'building':b['id'],'kind':'entrance over water without deck','native':p});break
        center=native(b['coordinates'],8192)
        if not inside(center,polygons[b['id']])or any(inside(center,[native(p,8192)for p in ring])for ring in b.get('footprintHoles',[])):failures.append({'building':b['id'],'kind':'center outside physical roof'})
    return {'map':'castgate','buildingCount':len(data['buildings']),'counts':counts,'failures':failures,'unresolvedAccess':[b['id']for b in data['buildings']if not b.get('access')],'deckMaskUsed':str(deck_path.relative_to(ROOT)),'reviewedDeckMaskHashVerified':bool(review.get('deckMask')),'limits':'Native pixel audit checks authored masks and footprints, not occupancy or completeness of every artwork object.'}

if __name__=='__main__':
    results=[audit_world(n)for n in ['Fair-Content','Astrousia','IceBeach']]
    if (ROOT/'maps/castgate.json').exists() and 'buildings'in json.loads((ROOT/'maps/castgate.json').read_text()):results.append(audit_castgate())
    output=ROOT/'design/world-transport/geometry-audit.json';output.write_text(json.dumps(results,indent=2)+'\n')
    for r in results:print(r['map'],len(r['failures']),'failures')
    sys.exit(int(any(r['failures']or not all(r.get('preservation',{}).values())for r in results)))
