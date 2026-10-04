from pathlib import Path
import json,numpy as np
from PIL import Image,ImageDraw,ImageFont
P=Path(__file__).parent;im=Image.open('maps/castgate.webp').convert('RGB');before=json.load(open('design/data-correction/before/castgate.json'));after=json.load(open('maps/castgate.json'));font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',20)
for name,box,scale in [('palace-final-routes',[2460,5520,2980,6170],2),('east-pier-final-routes',[3970,4400,4270,5030],3),('snow-roof-final-routes',[7680,4230,7900,4500],3)]:
 w,h=(box[2]-box[0])*scale,(box[3]-box[1])*scale;out=Image.new('RGB',(w*2,h+38),'white');deck=np.array(Image.open(P/'reviewed-deck-mask.png'))>0
 for j,data in enumerate([before,after]):
  c=im.crop(box).resize((w,h));dr=ImageDraw.Draw(c)
  for b in data['buildings']:
   ps=[((q[1]-box[0])*scale,(8192-q[0]-box[1])*scale)for q in b['footprint']]
   if all(x<0 or x>w or y<0 or y>h for x,y in ps):continue
   dr.line(ps+[ps[0]],fill='#00ffab',width=2)
  for line in data['lines']:
   if not line.get('travelMode'):continue
   ps=[((q[1]-box[0])*scale,(8192-q[0]-box[1])*scale)for q in line['coordinates']]
   if all(x<0 or x>w or y<0 or y>h for x,y in ps):continue
   dr.line(ps,fill='#ff764a',width=2)
  for n in data['travelNodes']:
   x,y=(n['coordinates'][1]-box[0])*scale,(8192-n['coordinates'][0]-box[1])*scale
   if 0<=x<w and 0<=y<h:dr.ellipse((x-3,y-3,x+3,y+3),fill='#ffff00')
  out.paste(c,(j*w,38));ImageDraw.Draw(out).text((j*w+6,7),'Before'if j==0 else'Corrected source roofs and routes',font=font,fill='black')
 out.save(P/(name+'.png'))
 # Narrow slanted deck allowance over source, independently inspectable.
 if name=='east-pier-final-routes':
  a=np.array(im.crop(box));m=deck[box[1]:box[3],box[0]:box[2]];a[m]=(a[m]*.6+np.array([0,250,180])*.4).astype('uint8');Image.fromarray(a).resize((w,h)).save(P/'east-pier-reviewed-deck-source.png')
