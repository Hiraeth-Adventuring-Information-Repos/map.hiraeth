import json,math
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
P=Path(__file__).parent
im=Image.open('maps/castgate.webp').convert('RGB');d=json.load(open('maps/castgate.json'));f=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',19)
cs=[('school',(4150,1030,5000,1680)),('blue-north',(4880,1950,5470,2470)),('blue-west',(4210,2810,4610,3280)),('frostviel',(5020,2800,5740,3390)),('athenaeum',(5310,2950,5610,3300)),('midwest',(4570,3340,4930,3730)),('pink-west',(4070,5010,4380,5350)),('blue-south',(5160,4980,5510,5380)),('blue-cathedral',(5150,5510,5520,5960)),('pink-east',(6140,5990,6510,6340)),('southwest',(2500,5490,3030,6000)),('grove',(4050,4660,4540,5110)),('ornamentnorth',(4090,1520,4340,1730)),('basin',(5800,2470,6050,2790)),('bottom',(3850,7120,4680,7590)),('dock',(3080,2780,3390,3200))]
for name,bounds in cs:
 c=im.crop(bounds);dr=ImageDraw.Draw(c)
 selected=[]
 for b in d['buildings']:
  points=[(p[1],8192-p[0]) for p in b['footprint']]
  xy=(b['coordinates'][1],8192-b['coordinates'][0])
  if not(bounds[0]<=xy[0]<bounds[2] and bounds[1]<=xy[1]<bounds[3]):continue
  selected.append({'id':b['id'],'xy':xy,'area':b['sourceReview']['roofCompoundAreaPixels']})
  dr.line([(x-bounds[0],y-bounds[1]) for x,y in points+[points[0]]],fill='#00ffc8',width=3)
  dr.text((xy[0]-bounds[0]-22,xy[1]-bounds[1]),b['id'][-4:],font=f,fill='#ffffff',stroke_width=2,stroke_fill='#000000')
 c.save(P/(name+'-before.png'));im.crop(bounds).save(P/(name+'-native.png'))
 print(name,bounds,json.dumps(selected))
json.dump(cs,open(P/'inspect-regions.json','w'),indent=2)
