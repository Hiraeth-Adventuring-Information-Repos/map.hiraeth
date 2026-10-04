from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import cv2,numpy as np,json
P=Path(__file__).parent; im=Image.open('maps/castgate.webp').convert('RGB');rgb=np.asarray(im);gray=cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY);data=json.load(open('maps/castgate.json'));results=[];f=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',12)
for b in data['buildings']:
 poly=np.array([[p[1],8192-p[0]]for p in b['footprint']],np.int32); x,y,w,h=cv2.boundingRect(poly)
 if w>400 or h>400:continue
 box=[max(0,x-45),max(0,y-45),min(8192,x+w+45),min(8192,y+h+45)];cx,cy=b['coordinates'][1],8192-b['coordinates'][0];image=gray[box[1]:box[3],box[0]:box[2]];black=(image<57).astype('uint8');cs,hi=cv2.findContours(black,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
 for c in cs:
  xx,yy,ww,hh=cv2.boundingRect(c);area=cv2.contourArea(c)
  if xx<2 or yy<2 or xx+ww>=image.shape[1]-2 or yy+hh>=image.shape[0]-2:continue
  if area<max(1500,cv2.contourArea(poly)*1.12)or area>cv2.contourArea(poly)*6:continue
  if cv2.pointPolygonTest(c,(cx-box[0],cy-box[1]),False)<0:continue
  po=(cv2.approxPolyDP(c,1.1,True).reshape(-1,2)+box[:2]).tolist(); results.append({'id':b['id'],'bounds':box,'polygon':po,'area':area,'beforeArea':cv2.contourArea(poly)})
  break
json.dump(results,open(P/'partial-roof-candidates.json','w'),indent=2);print([(r['id'],round(r['beforeArea']),round(r['area']))for r in results])
rows=(len(results)+5)//6;out=Image.new('RGB',(1800,rows*280),'white');d=ImageDraw.Draw(out)
for j,r in enumerate(results):
 box=r['bounds'];c=im.crop(box);dd=ImageDraw.Draw(c);b=next(b for b in data['buildings']if b['id']==r['id']);p=[[q[1]-box[0],8192-q[0]-box[1]]for q in b['footprint']];dd.line([tuple(q)for q in p+[p[0]]],fill='#ff6868',width=2);p=[[q[0]-box[0],q[1]-box[1]]for q in r['polygon']];dd.line([tuple(q)for q in p+[p[0]]],fill='#00ffcc',width=2);c.thumbnail((296,250));out.paste(c,((j%6)*300,(j//6)*280));d.text(((j%6)*300,(j//6)*280+252),r['id'][-4:]+' %s→%s'%(round(r['beforeArea']),round(r['area'])),font=f,fill='black')
out.save(P/'partial-roof-candidates.png')
