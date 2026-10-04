from pathlib import Path
from PIL import Image,ImageDraw
import cv2,numpy as np,json
P=Path(__file__).parent;im=Image.open('maps/castgate.webp').convert('RGB');rgb=np.asarray(im);gray=cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY);cases=[('pink-east',[6160,5990,6420,6260]),('palace',[2490,5590,2950,6140]),('embassy',[5140,2915,5590,3340]),('bluecathedral',[5155,5490,5505,5940]),('bluecourtyard',[5155,5030,5510,5340]),('pinkwest',[4100,5030,4380,5300]),('pink234',[4990,4755,5120,4940]),('pink245',[4980,5015,5130,5270])]
out=[]
for name,box in cases:
 black=(gray[box[1]:box[3],box[0]:box[2]]<57).astype('uint8');cs,hi=cv2.findContours(black,cv2.RETR_TREE,cv2.CHAIN_APPROX_SIMPLE);c=im.crop(box);d=ImageDraw.Draw(c);recs=[]
 for i,cc in enumerate(cs):
  if cv2.contourArea(cc)<1000 or hi[0,i,3]>=0:continue
  poly=(cv2.approxPolyDP(cc,1.1,True).reshape(-1,2)+[box[0],box[1]]).tolist();d.line([(x-box[0],y-box[1])for x,y in poly+[poly[0]]],fill='#00ffbb',width=2);recs.append({'polygon':poly,'area':cv2.contourArea(cc)})
 c.save(P/(name+'-localcontour.png'));out.append({'name':name,'bounds':box,'contours':recs})
json.dump(out,open(P/'local-contours.json','w'),indent=2)
