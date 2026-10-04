#!/usr/bin/env python3
"""Source-traced waterways, dry bank walks and depicted pedestrian bridges.

Input coordinates are half-image pixels. Smooth nested gray bands in this map
are water; the adjacent mottled/cobbled surfaces are dry walking ground.
"""
from pathlib import Path
import json, math, re, collections
import cv2
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
# Source channel centerlines and full widths in half-image pixels. These are
# independent source geometry, not routing edges. Narrow ponds are water masks
# only. The main channel banks are derived from these source outlines.
CHANNELS = {
 'Hallow Heart North and West':(8,[(1014,674),(1003,659),(988,651),(972,644),(950,639),(930,639),(910,644),(890,655),(876,670),(864,685),(856,701),(852,720),(852,740),(857,758),(865,776),(879,792),(895,804)]),
 'Hallow Heart South':(7,[(895,804),(916,814),(938,818),(960,818),(980,812),(997,802),(1009,790)]),
 'Hallow Heart Northeast':(8,[(1014,674),(1017.5,680),(1022,690),(1027,700),(1029,705),(1032,722),(1032,730)]),
 'Hallow Eastern Deck Channel':(5,[(1032,730),(1030.5,735),(1029.5,740),(1030.5,745),(1029.5,750),(1030,755),(1028.5,760)]),
 'Hallow Heart Southeast':(8,[(1028.5,760),(1026,765),(1022.5,770),(1020,775),(1017,780),(1013,785),(1009,790)]),
 'Towers Western Channel':(5,[(470,919.5),(490,922),(510,925),(530,928),(550,930.5),(559,931),(566,928.5),(580,921.5)]),
 'Towers Diagonal Channel':(5,[(580,921.5),(600,905.5),(615,893.5),(644,869.75),(671,847.5),(694,828.5),(721,807.5)]),
 'Towers Narrow Deck Channel':(4,[(721,807.5),(745,789),(770,766),(795,744.5)]),
 'Towers Eastern Channel':(5,[(795,744.5),(810,733.5),(831,733.5),(851,733.5)]),
 'Towers Crescent Upper':([8,8,7,6,6,6,6,8],[(712,814),(712,820),(717.5,830),(721,840),(722,850),(729,860),(734,870),(742.5,880),(750.25,890)]),
 'Towers Crescent Lower':(10,[(750.25,890),(760.5,900),(770.5,910),(784,920),(800.5,930),(813,938),(818,942)]),
 'Highhammer Diagonal Channel':(5,[(1009,790),(1018,800),(1031.5,810),(1042.5,820),(1053,830),(1063,840),(1070.5,850)]),
 'Highhammer Narrow Channel':(4,[(1070.5,850),(1073,860),(1076.5,870),(1080,880),(1083,887),(1088,896)]),
 'Badges':([13,13,14,15,15,16,15,15,15,15,15,15,16,17,17,17,16,15,14,13],[(872,924),(883,925),(893,929),(902,936),(906,945),(906,956),(905,966),(901,977),(894,984),(884,989),(873,990),(862,989),(852,985),(844,978),(839,968),(839,957),(839.5,947),(844,937),(852,930),(862,925),(872,924)]),
 'Chimes':([10,8,8,8,8,10,11,10,6,4,5,5,6,6],[(914,969),(942,970),(970,962.75),(995,956.25),(1020,946.5),(1041,936.5),(1060,924),(1078,909.75),(1089,900.5),(1099,897.25),(1120,889.75),(1160,877.75),(1200,864.75),(1215.5,863.5),(1221.5,864)]),
 'Chimes Eastern Branch':(8,[(1221.5,864),(1222.5,870),(1225.5,880),(1228.5,890),(1232,900),(1235.5,910),(1239,920),(1241.5,930),(1243,937),(1244,944),(1246,948)]),
 'Harbor':(11,[(470,1141),(493,1131),(530,1107),(557,1107),(571,1116),(585,1127),(607,1128),(630,1129),(658,1131),(691,1131),(722,1132),(752,1132),(776,1134),(800,1146),(822,1154),(847,1166),(867,1178),(890,1192)]),
}
PONDS = [
 (3,[(916,680),(904,690),(887,692),(875,694),(868,699),(872,707),(884,709),(888,719),(883,727),(884,741),(881,750),(876,748),(872,751),(874,758),(880,764),(891,766),(901,762),(913,762)]),
 (3,[(917,686),(915,679),(917,668),(921,662),(931,663),(940,668),(949,679),(954,674),(960,670),(967,671),(974,677),(976,685),(971,691),(973,696),(994,690),(1012,691),(1021,701),(1021,715)]),
 (3,[(1021,736),(1019,745),(1007,745),(991,749),(981,749),(972,754),(972,768),(968,771),(958,766),(949,777),(945,793),(952,800),(965,800),(974,784),(981,785),(986,792),(991,792),(995,783),(995,778),(988,773),(988,769),(1000,765),(1001,755)]),
]
WATER_POLYGONS = {
 'Highhammer ornamental pond':[(1023,875),(1032,873),(1042,877),(1049,876),(1054,877),(1054,881),(1051,886),(1042,888),(1033,885),(1025,881)],
}
BANK_CENTERLINES = {
 # Narrow source-visible beige deck: a constant contour offset cuts the C roofs.
 'Towers Crescent eastern deck':[(725.5,840),(728,845),(727.5,848),(726,850),(727,852.5),(735.5,857.5),(737.5,863.5),(738,866.5),(739.5,870),(741.5,873.5),(744.5,877.5)],
 'Chimes middle north quay':[(966.5,957),(974,955.5),(984,953.5),(989,952),(995,950.5),(1000,948.5),(1007,947),(1014,944)],
 'Academy western roof frontage':[(897,639),(897,633),(901,628),(909,627.5),(916.5,627.5),(919,629.5),(919,632.5),(922,634),(925,634)],
}
BANK_WINDOWS = {
 'Towers Crescent eastern deck':(720,754,836,882,'east','Towers Crescent Upper'),
 'Chimes middle north quay':(964,1017,938,962,'north','Chimes'),
 'Academy western roof frontage':(895,927,625,640,None,None),
}
# Independently traced shoreline of the wooded southwest end of Reedbank.
# Gray forest floor is connected to sea-colored pixels through tiny outline
# gaps, so color components alone incorrectly classify this dry island as sea.
LAND_OUTLINES = {
 'Northern bank forest clearing':[(1120,38),(1210,38),(1210,64),(1188,64),(1171,62),(1165,67),(1158,70),(1142,67),(1130,69),(1120,76)],
 'Reedbank wooded southwest peninsula':[(1113,1170),(1090,1182),(1074,1196),(1042,1215),(1002,1234),(982,1251),(957,1266),(938,1281),(916,1301),(891,1317),(861,1330),(838,1340),(810,1347),(783,1352),(755,1360),(727,1372),(719,1377),(747,1374),(778,1368),(809,1362),(839,1360),(868,1354),(894,1348),(925,1342),(950,1333),(978,1325),(1002,1312),(1034,1297),(1061,1282),(1085,1267),(1101,1251),(1123,1235),(1144,1214),(1157,1193),(1172,1174),(1150,1185),(1134,1174)]
}
# These older traces followed the middle of waterways. Their replacements are
# bank walks, each an actual dry connected shoreline, with bridge links below.
REPLACED={'Hallow Heart Ring','Towers Avenue','Towers Crescent','Highhammer Avenue','Badges Ring','Chimes Avenue','Mirkwater Upper Quay'}
BRIDGES=r'''
Hallow West Footbridge|bridge|847,724.5 859,724.5
Hallow Northeast Footbridge|bridge|1008,677 1019,668
Hallow East Footbridge|bridge|1020,763 1032,768
Towers North Footbridge|bridge|828.5,726 828.5,740.5
Towers Upper Footbridge|bridge|703.5,815.5 705.5,829
Towers Western Footbridge|bridge|558,927 557.5,941
Towers Crescent Footbridge|bridge|822.5,937 820,948.5
Badges South Footbridge|bridge|863,977 861.5,983 855,995.5
Highhammer Garden Footbridge|bridge|1074,889.5 1087.5,886.5
Chimes Western Footbridge|bridge|924,961 923,976
Chimes Middle Footbridge|bridge|1046,926 1057,938
Chimes Market Footbridge|bridge|1098,891 1095,906
Chimes Eastern Footbridge|bridge|1218,857 1213,870
Harbor Western Footbridge|bridge|552,1100 552,1119
Harbor West Court Footbridge|bridge|635,1120 633,1140
Harbor Middle Footbridge|bridge|699,1121 699,1140
Harbor Eastern Footbridge|bridge|796,1125 796,1144
Harbor East Court Footbridge|bridge|866,1125 863,1144
'''

def image_water_core(image):
 r,g,b=image[:,:,0],image[:,:,1],image[:,:,2];lum=(r+g+b)/3
 var=np.maximum(0,cv2.boxFilter(lum*lum,-1,(3,3))-cv2.boxFilter(lum,-1,(3,3))**2)
 mask=((abs(r-b)<9)&(g>=r+.5)&(g>=b+1.5)&(lum>62)&(lum<177)&(var<200)).astype(np.uint8)
 mask=cv2.morphologyEx(mask,cv2.MORPH_CLOSE,np.ones((5,5),np.uint8))
 n,labels,stats,_=cv2.connectedComponentsWithStats(mask,8)
 # Keep only components anchored at visually confirmed open-water locations.
 # Gray lawns/forest floor must not become water merely because of their hue.
 selected=set()
 for x,y in [(400,900),(600,1250),(1000,1150),(900,400),(1600,500),(1720,780),(1670,950),(1200,60)]:
  candidates=collections.Counter(labels[y-6:y+7,x-6:x+7].ravel());candidates.pop(0,None)
  if candidates:
   label=candidates.most_common(1)[0][0]
   if stats[label,cv2.CC_STAT_AREA]>1500:selected.add(label)
 out=np.isin(labels,list(selected)).astype(np.uint8)
 return out

def projection(p,a,b):
 dx,dy=b[0]-a[0],b[1]-a[1];den=dx*dx+dy*dy
 t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/den)) if den else 0
 return (a[0]+t*dx,a[1]+t*dy)

def draw_channel(mask,width,points,value):
 vertices=np.asarray(points,np.int32)
 if isinstance(width,list):
  if len(width)!=len(vertices)-1:raise ValueError('One channel width is required per source segment')
  for i,w in enumerate(width):cv2.polylines(mask,[vertices[i:i+2]],False,value,int(w))
 else:cv2.polylines(mask,[vertices],False,value,int(width))

def reviewed_bank(part):
 chains={}
 for name,line in BANK_CENTERLINES.items():
  chain=[0]
  for a,b in zip(line,line[1:]):chain.append(chain[-1]+math.dist(a,b))
  chains[name]=chain
 def checked(p):
  best=None
  for name,line in BANK_CENTERLINES.items():
   x0,x1,y0,y1,side,channel=BANK_WINDOWS[name]
   if not (x0<p[0]<x1 and y0<p[1]<y1):continue
   if channel:
    spine=CHANNELS[channel][1]
    water=min((projection(p,a,b) for a,b in zip(spine,spine[1:])),key=lambda q:math.dist(p,q))
    if side=='east' and p[0]<=water[0]:continue
    if side=='north' and p[1]>=water[1]:continue
   for i,(a,b) in enumerate(zip(line,line[1:])):
    q=projection(p,a,b);gap=math.dist(p,q)
    if best is None or gap<best[0]:best=(gap,q,chains[name][i]+math.dist(a,q),name)
  return best[1:] if best and best[0]<12 else None
 mapped=[checked(p) for p in part];out=[]
 for i,p in enumerate(part):
  if i and mapped[i-1] and mapped[i] and mapped[i-1][2]==mapped[i][2]:
   ca,cb=mapped[i-1][1],mapped[i][1]
   name=mapped[i][2]
   mid=[(c,q) for c,q in zip(chains[name],BANK_CENTERLINES[name]) if min(ca,cb)<c<max(ca,cb)]
   for _,q in sorted(mid,reverse=cb<ca):out.append(q)
  out.append(mapped[i][0] if mapped[i] else p)
 return out

def surface_trace(trace,garden_waterways):
 im=np.asarray(Image.open(ROOT/'maps/The-Port-City-of-Stomion.webp').resize((2048,1536))).astype(np.float32)
 sea=image_water_core(im)
 for outline in LAND_OUTLINES.values():cv2.fillPoly(sea,[np.asarray(outline,np.int32)],0)
 channels=dict(CHANNELS);bridge_trace=BRIDGES
 for i,points in enumerate(garden_waterways):channels[f'Academy Gardens {i+1}']=(7 if i==0 else 12,points)
 for i,(width,points) in enumerate(PONDS):channels[f'Hallow Gardens {i+1}']=(width,points)
 harbor_source=ROOT/'design/stomion/water-harbor-source.json'
 additional_walks=[]
 if harbor_source.exists():
  source=json.loads(harbor_source.read_text())
  for c in source.get('channels',[]):channels[c['name']]=(c['width'],c['coordinates'])
  bridge_trace='\n'.join(l for l in BRIDGES.splitlines() if l and not l.startswith('Harbor'))
  bridge_trace+='\n'+'\n'.join(b['name']+'|bridge|'+' '.join(f'{x:g},{y:g}' for x,y in b['coordinates']) for b in source.get('bridges',[]))
  additional_walks=[w['name']+'|lane|'+' '.join(f'{x:g},{y:g}' for x,y in w['coordinates']) for w in source.get('walks',[])]
 else:
  channels.pop('Harbor') # await independent source trace; never use rough guess
  bridge_trace='\n'.join(l for l in BRIDGES.splitlines() if l and not l.startswith('Harbor'))
 landing_points=[]
 for line in trace.splitlines()+bridge_trace.splitlines():
  if not line.strip() or line.startswith('#'):continue
  _,kind,coords=line.split('|')
  if kind in ('bridge','ferry'):
   pts=[tuple(map(float,p.split(','))) for p in coords.split()]
   landing_points.extend((pts[0],pts[-1]))
 channel=np.zeros(sea.shape,np.uint8)
 for width,points in channels.values():draw_channel(channel,width,points,1)
 bank_water=cv2.dilate(channel,np.ones((7,7),np.uint8))
 contours,_=cv2.findContours(bank_water,cv2.RETR_LIST,cv2.CHAIN_APPROX_SIMPLE)
 banks=[]
 for contour in contours:
  points=cv2.approxPolyDP(contour,1.5,True)[:,0,:].astype(float).tolist()
  if len(points)<5 or cv2.arcLength(contour,True)<60:continue
  # Long open sea mouths do not acquire an invented dry walk around their end.
  parts=[];part=[]
  for p in points+[points[0]]:
   x,y=map(int,p)
   on_land=490<x<1268 and (y<1100 or 486<x<875) and not sea[y,x]
   if on_land:part.append(p)
   elif part:
    if len(part)>1:parts.append(part)
    part=[]
  if part and len(part)>1:parts.append(part)
  for part in parts:
   part=reviewed_bank(part)
   if sum(math.dist(a,b) for a,b in zip(part,part[1:]))<25:continue
   center=np.mean(part,axis=0)
   district=min(channels,key=lambda k:min(math.dist(center,p) for p in channels[k][1]))
   # Small lawn islands inside ornamental ponds have no depicted paved loop.
   # Do not invent an address street around an inaccessible decorative islet.
   if district.startswith('Hallow Gardens') and cv2.contourArea(contour)<1500:continue
   banks.append((district,part))
 banks.sort(key=lambda b:(b[0],round(np.mean(b[1],axis=0)[1]),round(np.mean(b[1],axis=0)[0])))
 segments=[(a,b) for _,part in banks for a,b in zip(part,part[1:])]
 def nearest_bank(p,toward=None):
  best=None
  for a,b in segments:
   q=projection(p,a,b);dist=math.dist(p,q)
   if dist>22:continue
   score=dist+(math.dist(q,toward)*.15 if toward else 0)
   if best is None or score<best[0]:best=(score,q)
  return best[1] if best else p
 lines=[];moves=[]
 for line in trace.splitlines()+additional_walks:
  if not line.strip() or line.startswith('#'):continue
  name,kind,coords=line.split('|')
  if name in REPLACED:continue
  pts=[list(map(float,p.split(','))) for p in coords.split()]
  if kind not in ('rail','bridge','ferry'):
   for i in (0,len(pts)-1):
    x,y=map(lambda v:int(round(v)),pts[i])
    at_landing=any(math.dist(pts[i],p)<.01 for p in landing_points)
    if channel[y,x] and not at_landing:
     old=pts[i];pts[i]=nearest_bank(old,pts[1 if i==0 else i-1])
     moves.append({'street':name,'before':old,'after':pts[i]})
  lines.append(name+'|'+kind+'|'+' '.join(f'{x:g},{y:g}' for x,y in pts))
 names={}
 for district,pts in banks:
  names[district]=names.get(district,0)+1
  lines.append(f'{district} Bank Walk {names[district]}|lane|'+' '.join(f'{x:g},{y:g}' for x,y in pts))
 for line in bridge_trace.splitlines():
  if not line.strip():continue
  name,kind,coords=line.split('|');pts=[list(map(float,p.split(','))) for p in coords.split()]
  lines.append(name+'|'+kind+'|'+' '.join(f'{x:g},{y:g}' for x,y in pts))
 water=sea|channel
 for outline in WATER_POLYGONS.values():cv2.fillPoly(water,[np.asarray(outline,np.int32)],1)
 review_path=ROOT/'design/stomion/water-crossing-review.json'
 reviewed_water={}
 review=json.loads(review_path.read_text()) if review_path.exists() else {}
 if review_path.exists():
  reviewed_water=review.get('waterPolygons',{})
  for outline in reviewed_water.values():cv2.fillPoly(water,[np.asarray([[x/2,y/2] for x,y in outline],np.int32)],1)
 for width,line in PONDS:cv2.polylines(water,[np.asarray(line,np.int32)],False,1,width)
 for i,line in enumerate(garden_waterways):cv2.polylines(water,[np.asarray(line,np.int32)],False,1,7 if i==0 else 12)
 for line in lines:
  if line.split('|')[1]!='bridge':continue
  coords=line.split('|')[2];pts=np.asarray([list(map(float,p.split(','))) for p in coords.split()],np.int32)
  bridge_width=3 if 'Gray Pier' in line.split('|')[0] else 5
  widths=review.get('bridgeWidthsPixels',{})
  if line.split('|')[0] in widths:bridge_width=max(1,round(widths[line.split('|')[0]]/2))
  cv2.polylines(water,[pts],False,0,bridge_width)
 # Independently reviewed cobbled halves of the river bridges are wider than
 # the older central bridge traces. These source measurements never come from
 # arbitrary route edges, so an erroneous route cannot erase its water obstacle.
 reviewed_decks=review.get('dryDecks',[])
 for deck in reviewed_decks:
  points=np.asarray([[x/2,y/2] for x,y in deck['coordinates']],np.int32)
  cv2.polylines(water,[points],False,0,max(1,round(deck['widthPixels']/2)))
 mask=np.zeros(sea.shape,np.uint8);mask[:]=water
 full=cv2.resize(mask*255,(4096,3072),interpolation=cv2.INTER_NEAREST)
 # Tiny individually measured landing planks need native precision; the
 # half-image brush must not erase their real one- or two-pixel floor edges.
 reviewed_dry_polygons=review.get('dryDeckPolygons',{})
 for polygon in reviewed_dry_polygons.values():
  cv2.fillPoly(full,[np.asarray(polygon,np.int32)],0)
 Image.fromarray(full).save(ROOT/'design/stomion/water-mask.png')
 overlay=im.astype(np.uint8);overlay[water.astype(bool)]=overlay[water.astype(bool)]*.45+np.array([0,140,255])*.55
 Image.fromarray(overlay).save(ROOT/'design/stomion/water-overlay-half.png')
 (ROOT/'design/stomion/waterways-source.json').write_text(json.dumps({'coordinateSystem':'half-image [x,y] pixels','widthUnits':'half-image pixels; arrays give one width per segment','channels':{k:{'width':v[0],'coordinates':v[1]} for k,v in channels.items()},'verifiedWaterPolygons':WATER_POLYGONS,'geometryAuditWaterPolygons':reviewed_water,'geometryAuditDryDecks':reviewed_decks,'geometryAuditDryDeckPolygons':reviewed_dry_polygons,'verifiedLandOutlines':LAND_OUTLINES,'verifiedBankCenterlines':BANK_CENTERLINES,'bridgeTrace':bridge_trace,'rejectedCrossings':['Badges eastern crossing: uninterrupted water bands, no depicted span','Hallow southeastern crossing: boat in open water','Hallow southern crossing: continuous water and ordinary roof','Towers middle crossing: ordinary house row'],'bankWalks':len(banks),'endpointMoves':moves,'waterMaskMethod':'Conservative color/texture water-core components anchored at verified sea pixels, plus source-traced urban channel outlines and independent dry-land shoreline overrides. Warm or dark water contours are not exhaustively classified. Depicted bridges and wooden decks are cut out of the mask.','reviewState':'Source-reviewed channel bands and bridge/deck crossings; source-scale bank and roof boundaries remain approximate.'},indent=2)+'\n')
 return '\n'.join(lines),water


if __name__ == '__main__':
 # Regenerate only source-reviewed water evidence. Keep the curated street
 # graph intact; the returned draft bank centerlines are deliberately unused.
 from stomion_streets import TRACE, GARDEN_WATERWAYS
 surface_trace(TRACE, GARDEN_WATERWAYS)
