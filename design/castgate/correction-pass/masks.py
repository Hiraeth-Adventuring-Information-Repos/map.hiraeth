import json
from PIL import Image,ImageDraw
from pathlib import Path
import cv2,numpy as np
P=Path(__file__).parent;im=Image.open('maps/castgate.webp').convert('RGB'); cs={r['index']:r for r in json.load(open(P/'candidate-contours.json'))}
for name,box,ids in [('embassy',(5080,2840,5600,3380),[102535,102371,102271,102558]),('northcentral',(3850,2850,4230,3360),[100574,100568,100627,100459,100453,100445]),('palace',(2280,5450,3070,6250),[7727,7360,7307,7474,7523,7087,7217,6795,7225,6941,7302])]:
 c=im.crop(box);mask=np.zeros((c.height,c.width),np.uint8)
 for i in ids:cv2.fillPoly(mask,[np.array(cs[i]['polygon'],np.int32)-[box[0],box[1]]],1)
 mask=cv2.dilate(mask,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(17,17)))
 a=np.array(c);a[mask>0]=(a[mask>0].astype(float)*.5+[0,255,180]*np.ones((mask.sum(),3))*.5).astype('uint8');Image.fromarray(a).save(P/(name+'-mask-draft.png'))
 ps,_=cv2.findContours(mask,cv2.RETR_CCOMP,cv2.CHAIN_APPROX_SIMPLE);records=[]
 for cc in ps:
  records.append({'area':cv2.contourArea(cc),'polygon':(cv2.approxPolyDP(cc,1.2,True).reshape(-1,2)+[box[0],box[1]]).tolist()})
 json.dump(records,open(P/(name+'-mask-polygons.json'),'w'),indent=2)
