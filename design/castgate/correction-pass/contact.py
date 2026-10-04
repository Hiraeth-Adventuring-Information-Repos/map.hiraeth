import json,math
from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
P=Path(__file__).parent; im=Image.open('maps/castgate.webp').convert('RGB');d=json.load(open('maps/castgate.json'));font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',15)
bs=d['buildings']
for page in range(math.ceil(len(bs)/72)):
 rows=math.ceil(len(bs[page*72:(page+1)*72])/8);o=Image.new('RGB',(1600,rows*180),'#ffffff');dr=ImageDraw.Draw(o)
 for j,b in enumerate(bs[page*72:(page+1)*72]):
  ps=[(p[1],8192-p[0]) for p in b['footprint']];xmin=min(x for x,y in ps)-15;ymin=min(y for x,y in ps)-15;xmax=max(x for x,y in ps)+15;ymax=max(y for x,y in ps)+15
  c=im.crop((xmin,ymin,xmax,ymax));dc=ImageDraw.Draw(c);dc.line([(x-xmin,y-ymin) for x,y in ps+[ps[0]]],fill='#00ffcc',width=2);c.thumbnail((194,156));x=(j%8)*200;y=(j//8)*180;o.paste(c,(x+(194-c.width)//2,y));dr.text((x+2,y+158),b['id'][-4:]+' '+str(int(b['sourceReview']['roofCompoundAreaPixels'])),font=font,fill='#111111')
 o.save(P/('contact-%s.png'%page))
