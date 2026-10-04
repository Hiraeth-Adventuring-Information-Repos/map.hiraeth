import json
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import cv2,numpy as np
P=Path(__file__).parent;im=Image.open('maps/castgate.webp').convert('RGB');black=(cv2.cvtColor(np.array(im),cv2.COLOR_RGB2GRAY)<57).astype('uint8');cs,hi=cv2.findContours(black,cv2.RETR_TREE,cv2.CHAIN_APPROX_SIMPLE);f=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',20)
regions=[('southwest-palace',(2280,5450,3070,6250)),('harbor-palace',(2750,2050,3460,2760)),('embassy',(4960,2740,5680,3460)),('northcentral',(3750,2830,4250,3420)),('pink-east',(6100,6000,6460,6300)),('brown-bottom-blue',(4700,6500,5100,7080)),('brown-east',(6100,3370,6540,4020)),('blue-south',(5110,4940,5550,5400)),('blue-cathedral',(5110,5470,5550,5980))]
records=[]
for name,bounds in regions:
 out=im.crop(bounds);dr=ImageDraw.Draw(out)
 for i,c in enumerate(cs):
  area=cv2.contourArea(c); x,y,w,h=cv2.boundingRect(c)
  if not 1000<area<550000 or not(bounds[0]<=x and bounds[1]<=y and x+w<bounds[2] and y+h<bounds[3]):continue
  m=cv2.moments(c);cx=m['m10']/m['m00'];cy=m['m01']/m['m00'];dr.line([(xx-bounds[0],yy-bounds[1]) for xx,yy in c.reshape(-1,2).tolist()+[c[0,0].tolist()]],fill='#00ff99' if hi[0,i,3]<0 else '#ff66ff',width=1);dr.text((cx-bounds[0],cy-bounds[1]),str(i),font=f,fill='white',stroke_width=2,stroke_fill='black');records.append({'region':name,'index':i,'area':area,'bounds':[x,y,w,h],'parent':int(hi[0,i,3]),'polygon':cv2.approxPolyDP(c,1.1,True).reshape(-1,2).tolist()})
 out.save(P/(name+'-contours.png'))
json.dump(records,open(P/'candidate-contours.json','w'),indent=2)
print([(r['region'],r['index'],int(r['area']),r['bounds'],r['parent']) for r in records])
