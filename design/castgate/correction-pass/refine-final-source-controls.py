"""Refine reviewed lower timber centers and the nonbuilding garden fountain."""
from pathlib import Path
import json,cv2,numpy as np
from PIL import Image,ImageDraw
P=Path(__file__).parent;c=json.loads((P/'controls.json').read_text())
for r in c['deckExclusions']:
 if r['id']=='castgate-reviewed-east-pier-ghost-stem':r['nativePolygon']=[[4070,4470],[4148,4470],[4148,4972],[4070,4972]];r['reason']='Clear old straight eastern stem and west-edge lower approach water allowance before restoring only source-confirmed timber centers.'
for r in c['deckExtensions']:
 if r['id']=='castgate-reviewed-outer-pier-stem':r['nativeCenterline']=[[4107,4762],[4104,4830],[4100,4900],[4096,4948]];r['widthPixels']=24;r['reason']='Actual lower slanted timber centers independently confirmed from the native source; exclude prior west-edge water allowance.'
for r in c['pierApproaches']:
 if r['id']=='castgate-street-correction-outer-pier-access':r['nativePath']=[[4098,4762],[4107,4762],[4104,4830],[4100,4900],[4096,4948],[4090,4978],[4106,5010]]
source=json.loads((P/'candidate-contours.json').read_text());pool=next(r for r in source if r['index']==50147);box=[2680,5620,2810,5760];m=np.zeros((140,130),np.uint8);cv2.fillPoly(m,[np.array(pool['polygon'],np.int32)-box[:2]],1);m=cv2.dilate(m,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(15,15)));cs,_=cv2.findContours(m,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE);polygon=(cv2.approxPolyDP(cs[0],.8,True).reshape(-1,2)+box[:2]).tolist()
r={'id':'castgate-palace-garden-fountain','kind':'ornamental fountain basin','nativePolygon':polygon,'reason':'The palace garden ornamental fountain contains blue water and a solid curb; shared street paths must remain on surrounding cobbles. This feature has no building address.','method':'Source ink-bound pool/curb interior contour50147 expanded seven native pixels to the drawn cream curb; attached palms and public cobbled garden remain walkable.'};c['walkingObstacleCorrections']=[r]
# Source-guided clear east cobbles. Keep every other street point unchanged.
d=json.loads(Path('maps/castgate.json').read_text())
for id in ['castgate-street-0025','castgate-street-0027','castgate-street-0029']:
 l=next(l for l in d['lines']if l['id']==id);ps=[[p[1],8192-p[0]]for p in l['coordinates']];bad=[i for i,p in enumerate(ps)if 5645<p[1]<5723 and p[0]<2778 and p[0]>2730]
 # Existing long vertical spans often have no vertex inside the pool range;
 # insert a deterministic clear-cobble bypass into any intersecting segment.
 out=[ps[0]]
 for a,b in zip(ps,ps[1:]):
  if abs(a[0]-b[0])<1 and 2745<a[0]<2765 and min(a[1],b[1])<5675 and max(a[1],b[1])>5705:
   detour=[[a[0],5640],[2785,5655],[2785,5715],[a[0],5722]]
   if b[1]<a[1]:detour=detour[::-1]
   out+=detour
  out.append(b)
 if out!=ps:
  record={'id':id,'nativePath':out,'reason':'Retain the repaired palace garden street on clear cobbles east of the ornamental fountain; do not cross pool water or curb.'};c['lineCorrections']=[r for r in c['lineCorrections']if r['id']!=id]+[record]
(P/'controls.json').write_text(json.dumps(c,indent=2)+'\n')
im=Image.open('maps/castgate.webp').convert('RGB').crop(box).resize((780,840));dr=ImageDraw.Draw(im);p=[((x-box[0])*6,(y-box[1])*6)for x,y in polygon];dr.line(p+[p[0]],fill='#00ffbb',width=3);im.save(P/'fountain-source-obstacle-review.png')
print('Reviewed final source controls updated.')
