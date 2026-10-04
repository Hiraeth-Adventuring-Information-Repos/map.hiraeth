#!/usr/bin/env python3
"""Check native roof polygon topology, centers, bounds and raster overlaps."""
import json
import argparse
from pathlib import Path
import cv2
import numpy as np
ROOT=Path(__file__).resolve().parents[1]

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',default='design/castgate/footprint-audit.json');args=parser.parse_args()
    data=json.loads((ROOT/'maps/castgate.json').read_text());failures=[];overlaps=[]
    occupied=np.zeros((8192,8192),np.uint16)
    for ordinal,building in enumerate(data['buildings'],1):
        p=np.array([[c[1],8192-c[0]]for c in building['footprint']],float);ends=np.roll(p,-1,axis=0);vectors=ends-p
        if len(p)<3 or cv2.contourArea(p.astype(np.float32))<1:failures.append([building['id'],'degenerate polygon'])
        center=(float(building['coordinates'][1]),float(8192-building['coordinates'][0]))
        holes=[np.array([[c[1],8192-c[0]]for c in ring],float)for ring in building.get('footprintHoles',[])]
        if cv2.pointPolygonTest(p.astype(np.float32),center,False)<0 or any(cv2.pointPolygonTest(hole.astype(np.float32),center,False)>=0 for hole in holes):failures.append([building['id'],'center outside physical roof'])
        if (p<0).any()or(p>8192).any():failures.append([building['id'],'out of artwork bounds'])
        for i in range(len(p)):
            indices=np.arange(i+2,len(p));indices=indices[indices!=len(p)-1]if i==0 else indices
            if not len(indices):continue
            delta=p[indices]-p[i];det=vectors[i,0]*vectors[indices,1]-vectors[i,1]*vectors[indices,0];valid=np.abs(det)>1e-8
            t=np.divide(delta[:,0]*vectors[indices,1]-delta[:,1]*vectors[indices,0],det,out=np.zeros(len(indices)),where=valid)
            u=np.divide(delta[:,0]*vectors[i,1]-delta[:,1]*vectors[i,0],det,out=np.zeros(len(indices)),where=valid)
            hits=valid&(t>1e-7)&(t<1-1e-7)&(u>1e-7)&(u<1-1e-7)
            if hits.any():failures.append([building['id'],'proper self intersection',i,int(indices[np.where(hits)[0][0]])]);break
        poly=p.astype(np.int32);x,y,w,h=cv2.boundingRect(poly);local=np.zeros((h,w),np.uint8);cv2.fillPoly(local,[poly-[x,y]],1)
        for hole in holes:
            if len(hole)<3 or cv2.contourArea(hole.astype(np.float32))<1:failures.append([building['id'],'degenerate courtyard'])
            if any(cv2.pointPolygonTest(p.astype(np.float32),tuple(point),False)<=0 for point in hole):failures.append([building['id'],'courtyard outside outer outline'])
            cv2.fillPoly(local,[hole.astype(np.int32)-[x,y]],0)
        count=int((occupied[y:y+h,x:x+w][local>0]>0).sum())
        if count>5:overlaps.append([building['id'],count])
        view=occupied[y:y+h,x:x+w];view[local>0]=ordinal
    report={'buildings':len(data['buildings']),'failures':failures,'overlappingNativeRoofPixels':overlaps,
        'courtyards':sum(len(b.get('footprintHoles',[]))for b in data['buildings']),
        'scope':'Physical roof polygon sanity and overlap checks, subtracting open courtyards; source overlays establish illustration alignment, not occupancy.'}
    (ROOT/args.output).write_text(json.dumps(report,indent=2)+'\n')
    print(len(data['buildings']),'footprints;',len(failures),'topology/bounds failures;',len(overlaps),'overlaps')
    if failures or overlaps:raise SystemExit(1)

if __name__=='__main__':main()
