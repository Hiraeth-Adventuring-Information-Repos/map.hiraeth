import json, math
from pathlib import Path
import cv2,numpy as np
from PIL import Image,ImageDraw
P=Path(__file__).parent; source=json.load(open(P/'controls-draft.json')); cs={r['index']:r for r in json.load(open(P/'candidate-contours.json'))}; rgb=np.asarray(Image.open('maps/castgate.webp').convert('RGB'))

def poly_mask(points,box):
 m=np.zeros((box[3]-box[1],box[2]-box[0]),np.uint8);cv2.fillPoly(m,[np.array(points,np.int32)-[box[0],box[1]]],1);return m

def trace(ids,box,dilate=13,extra=None,holes=None):
 mask=np.zeros((box[3]-box[1],box[2]-box[0]),np.uint8)
 for i in ids:cv2.fillPoly(mask,[np.array(cs[i]['polygon'],np.int32)-[box[0],box[1]]],1)
 mask=cv2.dilate(mask,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(dilate,dilate)))
 for p in extra or []:mask|=poly_mask(p,box)
 mask=cv2.morphologyEx(mask,cv2.MORPH_CLOSE,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(25,25)))
 for p in holes or []:mask[poly_mask(p,box)>0]=0
 contours,hi=cv2.findContours(mask,cv2.RETR_CCOMP,cv2.CHAIN_APPROX_SIMPLE)
 outer=[(i,c) for i,c in enumerate(contours) if hi[0,i,3]<0];i,c=max(outer,key=lambda z:cv2.contourArea(z[1]));poly=(cv2.approxPolyDP(c,1.2,True).reshape(-1,2)+[box[0],box[1]]).tolist()
 hs=[]
 for j,cc in enumerate(contours):
  if hi[0,j,3]==i and cv2.contourArea(cc)>1200:hs.append((cv2.approxPolyDP(cc,1.2,True).reshape(-1,2)+[box[0],box[1]]).tolist())
 return poly,hs,[int(cv2.contourArea(c)) for j,c in outer if j!=i]
source['corrections']=[r for r in source['corrections'] if r['id']!='castgate-building-0243']
by={r['id']:r for r in source['corrections']}
configs={
'castgate-building-0340':([7727,7360,7307,7474,7523,7087,7217,6795,7225,6941,7302],(2280,5450,3070,6250),17),
'castgate-building-0031':([12064,11989,11968,12031],(2750,2050,3460,2760),13),
'castgate-building-0087':([100574,100568,100627,100459,100453,100445],(3750,2830,4250,3420),13),
'castgate-building-correction-pink-east':([6455,6536,6537,6567,6617,6695,6700,6713],(6100,6000,6460,6320),13)
}
for id,(indices,box,dilate) in configs.items():
 p,h,parts=trace(indices,box,dilate);r=by[id];r['polygon']=p;r['holes']=[];r['sourceInteriorContours']=indices;r['boundaryMethod']='Reviewed native roof interior outlines expanded to the drawn outer ink boundary; no convex hull.';r['maskNote']={'discardedSeparateMaskPartsAreas':parts,'inkRadiusPixels':dilate//2}
# Main embassy annular roof is occluded at the top by palm leaves. These inferred
# controls preserve the visible stone rim and the source garden as a courtyard;
# the overlapping crown is not treated as its own building.
box=(5080,2840,5600,3380)
ring=[[5184,2954],[5205,2940],[5230,2929],[5255,2927],[5282,2931],[5310,2943],[5335,2961],[5355,2984],[5370,3011],[5379,3040],[5379,3064],[5373,3090],[5360,3115],[5340,3136],[5318,3152],[5292,3163],[5268,3168],[5243,3168],[5217,3160],[5194,3147],[5177,3128],[5166,3105],[5159,3079],[5157,3050],[5160,3023],[5168,2996],[5179,2972]]
garden=[[5195,2969],[5210,2955],[5232,2948],[5256,2945],[5278,2949],[5302,2962],[5322,2979],[5337,3002],[5348,3026],[5352,3049],[5350,3064],[5333,3065],[5315,3071],[5298,3083],[5285,3098],[5276,3116],[5272,3147],[5250,3146],[5227,3139],[5207,3127],[5190,3111],[5180,3091],[5175,3067],[5174,3044],[5178,3019],[5185,2993]]
p,h,parts=trace([102535,102371,102271,102558],box,13,extra=[ring],holes=[garden]);r=by['castgate-building-0091'];r['polygon']=p;r['holes']=[];r['sourceInteriorContours']=[102535,102371,102271,102558];r['boundaryMethod']='Reviewed native interior roof contours and stone rim controls; palm-occluded rim is approximate; garden subtracted explicitly.'
# The southern harbor roof has a separate topological outline from the north wing.
r={'id':'castgate-building-correction-harbor-south','new':True,'bounds':[2750,2050,3460,2760],'reason':'Recover separate connected southern harbor roof; keep public tiled terrace between north/south roofs unfilled.'}
p,h,parts=trace([11718,11828,11664,11638],r['bounds'],13);r.update(polygon=p,holes=[],sourceInteriorContours=[11718,11828,11664,11638],boundaryMethod='Reviewed source roof interior boundaries expanded only to outer roof ink.');source['corrections'].append(r)
# Recover pink-east from its local native inkoutline; crop strips the neighboring dome wall.
local=json.load(open(P/'local-contours.json'))
pink=next(x for x in local if x['name']=='pink-east')['contours'][0]['polygon']
by['castgate-building-correction-pink-east']['polygon']=[[min(x,6405),min(y,6250)] for x,y in pink]
by['castgate-building-correction-pink-east']['holes']=[]
by['castgate-building-0323']['polygon']=next(x for x in local if x['name']=='pink-east')['contours'][0]['polygon'] if False else by['castgate-building-0323']['polygon']
json.dump(source,open(P/'controls.json','w'),indent=2);print('Controls',len(source['remove']),len(source['corrections']))
for r in source['corrections']:
 box=r['bounds'];c=Image.fromarray(rgb).crop(box);dr=ImageDraw.Draw(c)
 poly=r.get('polygon') or [[q[1],8192-q[0]] for q in next(b for b in json.load(open('maps/castgate.json'))['buildings'] if b['id']==r['id'])['footprint']]
 dr.line([(x-box[0],y-box[1]) for x,y in poly+[poly[0]]],fill='#00ffcc',width=3)
 for h in r['holes']:dr.line([(x-box[0],y-box[1]) for x,y in h+[h[0]]],fill='#ffa333',width=3)
 c.save(P/(r['id']+'-review-draft.png'))
