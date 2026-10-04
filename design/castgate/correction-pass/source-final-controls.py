"""Targeted final-source controls: attached palace blue roofs, real slant deck, snow roof.
Uses preserved reviewed white roof and retained source-interior contours; never edits map.
"""
from pathlib import Path
import json,cv2,numpy as np
from PIL import Image,ImageDraw
P=Path(__file__).parent;controls=json.loads((P/'controls.json').read_text());roof=next(r for r in controls['corrections']if r['id']=='castgate-building-0340');box=roof['bounds'];offset=np.array(box[:2]);mask=np.zeros((box[3]-box[1],box[2]-box[0]),np.uint8)
if not(P/'palace-white-reviewed-outline.json').exists():(P/'palace-white-reviewed-outline.json').write_text(json.dumps(roof['polygon'],indent=2)+'\n')
white=json.loads((P/'palace-white-reviewed-outline.json').read_text());cv2.fillPoly(mask,[np.array(white,np.int32)-offset],1)
blue=json.loads((P/'palace-blue-source-interiors.json').read_text());selected=[855,819,823,762,820,807,799,790,769]
blueMask=np.zeros_like(mask)
for r in blue:
 if r['index']in selected:cv2.fillPoly(blueMask,[np.array(r['polygon'],np.int32)-offset],1)
blueMask=cv2.dilate(blueMask,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(17,17)));mask|=blueMask
# Small upper blue triangle has source contours open under the palm/roof ink.
upper=[[2583,5642],[2596,5654],[2608,5660],[2620,5662],[2625,5668],[2593,5680],[2587,5661]]
cv2.fillPoly(mask,[np.array(upper,np.int32)-offset],1)
mask=cv2.morphologyEx(mask,cv2.MORPH_CLOSE,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(13,13)))
cs,_=cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE);c=max(cs,key=cv2.contourArea);roof['polygon']=(cv2.approxPolyDP(c,1.0,True).reshape(-1,2)+offset).tolist();roof['reason']='Join southwest palace into one contiguous architectural roof including the attached blue crescent glazing/awnings; interior skylights are not independent buildings. Keep the open cobbled garden outside the curved roof silhouette.';roof['boundaryMethod']='Reviewed native white roof silhouette united with source ink-bound blue architectural contours, expanded to drawn outer ink; small palm-occluded upper join source-controlled; no convex hull.';roof['blueSourceContourEvidence']={'path':'design/castgate/correction-pass/palace-blue-source-interiors.json','selectedContourIds':selected,'upperOccludedJoin':upper,'inkRadiusPixels':8}
# Replace ghost vertical water allowance with actual slanted timber centerline.
ex={'id':'castgate-reviewed-east-pier-ghost-stem','nativePolygon':[[4078,4470],[4148,4470],[4148,4763],[4078,4763]],'reason':'Clear old straight x4098 stem allowance through open water before restoring only the source slanted timber.'}
controls['deckExclusions']=[r for r in controls.get('deckExclusions',[])if r['id']!=ex['id']]+[ex]
east=[[4133,4465],[4133,4480],[4129,4520],[4124,4580],[4119,4640],[4113,4700],[4107,4762]]
ext={'id':'castgate-reviewed-east-pier-slanted-stem','nativeCenterline':east,'widthPixels':24,'reason':'Actual slanted eastern T-pier timber centerline; source native20px grid independently reviewed.'}
controls['deckExtensions']=[r for r in controls['deckExtensions']if r['id']!=ext['id']]+[ext]
line={'id':'castgate-street-0104','nativePath':[[4098,4454],[4133,4454]]+east+[[4098,4762]],'reason':'Follow the real horizontal T-head to its stem meeting, then the actual slanted timber centerline; no straight shortcut through open harbor.'}
controls['lineCorrections']=[r for r in controls['lineCorrections']if r['id']!=line['id']]+[line]
# Snow-covered source roof has no established tenant; inventory identity stays neutral.
snow=json.loads(Path('design/data-correction-review/Castgate-brewery-roof-controls.json').read_text());record={'id':'castgate-building-correction-snow-east','new':True,'bounds':[7660,4220,7930,4480],'polygon':snow['polygon'],'holes':[],'reason':'Recover the missing connected snow-covered roof beside the Dwarf Brewery lore pin. Exact tenant is unconfirmed; preserve the original destination pin and route around this physical roof.','boundaryMethod':'Independent reviewer fitted native outer roof ink including attached projections; precision approximately 2–4 native pixels.'}
controls['corrections']=[r for r in controls['corrections']if r['id']!=record['id']]+[record]
node={'id':snow['affectedTravelNode'],'nativeCoordinates':snow['suggestedDryJunction'],'reason':'Generated street junction was inside a snow-covered physical roof; move to visible dry eastern snow margin, preserving original lore pin.'}
controls['nodeCorrections']=[r for r in controls['nodeCorrections']if r['id']!=node['id']]+[node]
data=json.loads(Path('maps/castgate.json').read_text());by={r['id']:r for r in data['lines']}
# Retain the existing first points and add only source-guided roof-edge detours.
l=by['castgate-street-0423'];old=[[q[1],8192-q[0]]for q in l['coordinates']];dry=snow['streetDetourGuidance'];prefix=[p for p in old[:-1]if p[0]<7740];path=prefix+dry
if not prefix:path=[old[0]]+dry
fix={'id':l['id'],'nativePath':path,'reason':'Preserve eastern snow road, detouring north/east of the newly reviewed snow-covered roof to the dry junction.'}
controls['lineCorrections']=[r for r in controls['lineCorrections']if r['id']!=fix['id']]+[fix]
l=by['castgate-landmark-dwarf-brewery-walk'];old=[[q[1],8192-q[0]]for q in l['coordinates']];fix={'id':l['id'],'nativePath':[old[0]]+snow['landmarkApproachGuidance'],'reason':'Keep the original Brewery lore pin; approach the street along visible clear snow east of the physical roof, whose tenant is unconfirmed.'}
controls['lineCorrections']=[r for r in controls['lineCorrections']if r['id']!=fix['id']]+[fix]
(P/'controls.json').write_text(json.dumps(controls,indent=2)+'\n')
im=Image.open('maps/castgate.webp').convert('RGB').crop(box);dr=ImageDraw.Draw(im);ps=[(x-box[0],y-box[1])for x,y in roof['polygon']];dr.line(ps+[ps[0]],fill='#00ffcc',width=2);im.resize((1580,1600)).save(P/'palace-full-architectural-source-review.png')
print('Updated literal source controls, no canonical write. Palace vertices',len(roof['polygon']))
