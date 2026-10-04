#!/usr/bin/env python3
"""Manually reviewed roof seeds outside Stomion's main city island.
All input centroids/sizes use half-image pixels; output uses original image pixels.
These are visual roof units, not declarations of occupants or lore.
"""
from pathlib import Path
import json
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1]
# x y roofWidth roofHeight clockwiseAngle kind
SEEDS=r'''
# Aelindor's Isle: connected castle roof wings and distinct service/gate buildings
1665 236 79 34 -35 building
1707 294 97 36 -30 building
1771 222 75 94 18 building
1746 159 29 17 0 building
1725 174 26 19 -40 building
1740 145 29 11 -1 building
1558 267 26 20 42 gatehouse
1592 220 23 13 39 building
1582 237 21 10 31 building
1620 231 15 47 0 gatehouse
1668 197 27 13 56 gatehouse
1614 361 13 34 14 house
1629 362 17 16 27 house
1548 253 10 11 20 building
# Harrowholm island shrine
1361 294 27 29 -9 building
1371 270 8 12 1 house
'''
SEEDS += r"""
# East bank island and isolated river structures
1645 538 18 15 -37 building
1564 727 30 21 43 building
1605 749 41 29 45 house
1702 636 36 27 13 building
1577 798 13 19 44 house
1567 804 8 13 -30 house
1602 827 12 17 -8 house
1583 826 18 8 -35 house
1595 830 18 10 25 house
1569 834 20 11 -30 house
1583 835 15 13 -30 house
1563 846 10 9 0 house
1577 843 18 12 -35 house
1594 842 11 7 -45 house
1602 840 14 10 -30 house
1591 846 12 5 40 house
1567 863 27 19 4 house
1583 866 10 12 0 house
1587 869 7 5 -20 house
1573 866 5 4 35 house
1569 875 12 5 -20 house
1552 876 13 9 -3 house
1588 878 26 28 -7 building
1572 887 17 7 0 house
1551 886 15 9 5 house
1585 896 12 16 -10 house
1568 894 14 9 -5 house
1550 896 8 8 0 house
1552 906 20 15 -5 house
1561 903 12 14 -10 house
1581 899 10 10 -12 house
1588 903 11 9 -30 house
1571 908 10 7 -30 house
1574 916 14 8 -35 house
1514 916 27 12 27 house
1526 922 12 14 15 house
1564 925 34 20 26 house
1518 957 29 15 21 house
1502 961 15 15 30 house
1510 966 10 7 12 house
1530 965 13 10 32 house
1512 888 18 13 25 building
1520 880 17 11 25 house
"""

SEEDS += r"""
# East-bank southern fields and mainland cottages
1495 972 15 10 -17 house
1462 975 19 10 -48 house
1453 984 12 8 -38 house
1439 997 17 8 -48 house
1431 1006 15 8 -48 house
1419 998 12 7 -44 house
1405 1010 12 8 35 house
1418 1014 14 9 -38 house
1523 994 14 8 -35 house
1533 995 12 6 20 house
1487 1006 25 34 27 house
1458 1028 11 7 -30 house
1465 1031 10 6 32 house
1473 1034 8 6 15 house
1451 1043 16 9 -35 house
1446 1049 17 8 17 house
1453 1058 13 8 2 house
1486 1056 11 7 -20 house
1494 1053 8 11 -17 house
1486 1064 8 8 5 house
1386 1077 14 8 35 house
1393 1085 14 8 35 house
1396 1076 14 8 35 house
1733 1011 9 7 40 house
1728 1018 8 10 38 house
"""

SEEDS += r"""
# Southern river-bank island hamlet: roofs around fields, not the fields themselves
1200 1108 13 13 -38 gatehouse
1232 1097 7 9 15 house
1238 1104 8 15 12 house
1247 1105 10 7 5 house
1255 1116 7 13 -10 house
1268 1119 10 9 -28 house
1260 1122 7 14 -16 house
1274 1104 17 12 -33 house
1281 1090 13 10 -30 house
1290 1085 14 9 -25 house
1302 1087 16 12 -30 house
1312 1083 13 8 -30 house
1330 1080 14 8 -35 house
1330 1094 31 15 -35 house
1320 1090 13 9 -35 house
1334 1104 10 7 -35 house
1330 1111 9 8 -35 house
1344 1105 12 9 -35 house
1311 1113 5 8 -40 house
1283 1127 30 18 -18 house
1199 1128 11 10 -32 house
1218 1125 13 16 -40 house
1211 1134 13 16 -35 house
1228 1149 10 5 -48 house
1239 1157 16 15 -4 house
1246 1164 13 9 -33 house
1207 1156 15 12 -50 house
1189 1141 26 25 -12 building
1182 1151 20 12 -21 house
1188 1163 13 13 -45 house
1149 1176 14 14 -38 house
1142 1179 14 10 -27 house
1142 1186 13 8 -17 house
1122 1187 12 8 -22 house
1153 1154 26 19 7 building
1216 1175 38 15 -33 house
1182 1181 10 7 40 house
1300 1132 10 14 -7 house
1300 1141 10 5 0 house
1293 1143 9 11 -38 house
1288 1150 7 10 -35 house
1343 1133 6 14 -12 house
1349 1130 7 12 -30 house
1355 1126 12 12 -43 house
1358 1141 6 6 45 house
"""

SEEDS += r"""
# Bulwark bridge gate buildings (roof complexes, not their individual triangles)
1509 388 29 32 42 gatehouse
1536 417 43 34 -5 gatehouse
1562 375 15 23 -35 gatehouse
1478 433 25 17 -30 gatehouse
# Southern mainland village
1552 1230 24 27 -12 building
1529 1254 19 13 -36 house
1540 1248 19 8 -35 house
1537 1273 26 15 0 house
1489 1263 22 9 -3 house
1503 1265 8 14 0 house
1519 1263 27 20 -5 house
1528 1283 20 12 43 house
1498 1286 17 9 40 house
1514 1294 10 9 -45 house
1515 1300 18 11 35 house
1526 1316 25 18 -35 house
1549 1309 20 10 -10 house
1553 1320 20 20 -30 house
1565 1305 22 22 35 house
1565 1287 13 10 -55 house
1570 1278 16 10 -55 house
1576 1267 18 15 -40 house
1552 1275 18 17 15 house
1545 1350 18 21 -20 house
1569 1372 18 17 15 house
1542 1389 21 14 20 house
1573 1388 8 24 -20 house
1559 1409 8 15 -12 house
1579 1413 9 18 -20 house
1560 1432 11 14 -8 house
1566 1443 20 10 30 house
# Southern woodland homestead
1301 1406 28 15 0 house
1318 1406 7 18 0 house
1313 1397 10 6 0 house
1270 1425 13 5 0 house
1258 1425 17 17 0 house
1244 1433 15 12 0 house
1305 1428 21 7 0 house
1291 1423 15 7 47 house
1275 1444 6 17 0 house
1293 1457 15 14 45 house
# Eastern mainland homestead
1711 1244 15 10 -32 house
1725 1244 8 14 0 house
1723 1256 14 14 -40 house
1789 1228 9 20 38 house
1794 1239 15 11 30 house
1772 1251 26 14 -57 building
"""

SEEDS += r"""
# Far eastern road: visible cottages and barns
1850 1289 11 10 35 house
1837 1349 12 8 -35 house
1831 1362 10 12 -35 house
1828 1424 9 7 -10 house
1836 1438 8 7 -20 house
# Northern shore farm roofs. Barrels, stumps and uncovered field plots omitted.
784 30 14 16 0 house
806 28 7 5 -15 house
799 46 4 8 15 house
897 33 11 5 0 house
908 36 5 9 -25 house
932 20 9 7 20 house
1098 40 8 5 12 house
1101 29 9 7 -30 house
1107 43 7 3 10 house
1135 15 14 17 0 house
1315 29 15 8 30 house
1320 15 6 7 20 house
1330 20 13 5 -20 house
1323 30 6 3 40 house
1338 24 10 7 -25 house
1349 34 5 12 -14 house
1354 14 9 8 -50 house
1352 29 10 7 -10 house
1368 24 9 6 -30 house
1374 21 9 10 -30 house
1349 42 3 8 0 house
1330 52 5 9 0 house
1318 48 14 5 -5 house
1338 76 24 17 -22 building
"""

def main():
 seeds=[]
 for l in SEEDS.splitlines():
  if not l.strip() or l.strip().startswith('#'):continue
  x,y,w,h,a,k=l.split();x,y,w,h,a=map(float,(x,y,w,h,a))
  seeds.append({'x':round(x*2,1),'y':round(y*2,1),'w':round(w*2,1),'h':round(h*2,1),'angle':a,'kind':k})
 # Stable source identities allow centroid corrections without renumbering later
 # seeds. Compact-roof dimensions are calibrated against the full-pixel image.
 corrections={134:(1556,1231.75),138:(1493,1265),139:(1503,1267.5),145:(1528,1316),147:(1557,1320),148:(1569,1307.25),149:(1569.25,1288),150:(1574.75,1280),151:(1579.5,1268),153:(1546.75,1350.75),154:(1572.75,1374.5),155:(1544.25,1391.5),156:(1576.75,1391.5),157:(1563,1411.25),158:(1584.25,1414.5),159:(1563.5,1435),160:(1569.5,1446),188:(1103.5,41.5),189:(1112,33),190:(1117,43),191:(1174,22),192:(1330,27.25),193:(1336.5,15.5),194:(1344.5,22.75),195:(1336.75,33.75),196:(1355,26),197:(1351.75,42.5),198:(1366.25,20.25),199:(1373.75,28),200:(1387.25,21),202:(1330,47.5),203:(1345,54.75),204:(1371.5,63),205:(1349,76),182:(789.5,33),183:(809,16.5),184:(807.5,41.5),185:(911,34),186:(921,38),187:(945,18),21:(1585.5,796),22:(1577.5,803.5),23:(1610.75,829.5),24:(1585,827),26:(1573,836),27:(1587,837),28:(1567,846.5),29:(1579.5,845.5),30:(1595,840.5),32:(1601.75,847),34:(1584.25,863.5),38:(1548,882.25),39:(1592.5,878.25),40:(1577.25,883.75),41:(1548.25,889.75),42:(1585,892.5),43:(1576.25,891.5),44:(1547.25,897.25),45:(1547.25,904.25),46:(1558.5,902.25),48:(1590,902.5),50:(1574,912.5),51:(1505,916.5),52:(1517.5,922.5),53:(1549.25,922.5)}
 reviewed=[]
 for i,seed in enumerate(seeds,1):
  seed['id']=f'stomion-building-shores-{i:04d}'
  seed['method']='Manual visual roof rectangle; source center and rectangle dimensions reviewed separately.'
  seed['confidence']='draft-rectangle'
  if i in (4,5,6,8,9,14,16,35,47,85,201):continue # open ramparts, boats or ground, not roofs
  if i in corrections:
   x,y=corrections[i];seed['x']=x*2;seed['y']=y*2
   seed['confidence']='center-reviewed'
  if 17<=i<=176:
   seed['w']=round(seed['w']*.60,1);seed['h']=round(seed['h']*.60,1)
  northern_dims={182:(26,35,0),183:(7,7,45),184:(9,17,15),185:(24,11,0),186:(10,19,-25),187:(18,22,20),188:(20,20,15),189:(24,22,-30),190:(17,9,10),191:(30,33,0),192:(10,18,-25),193:(9,11,20),194:(28,12,-15),195:(18,9,43),196:(24,19,-30),197:(15,23,-14),198:(12,25,40),199:(22,11,-15),200:(30,27,-40),202:(38,15,-10),203:(5,15,-16),204:(22,14,15),205:(38,21,-30)}
  if i in northern_dims:
   seed['w'],seed['h'],seed['angle']=northern_dims[i]
   seed['confidence']='source-center-reviewed'
  if i in (204,205):
   seed['confidence']='source-center-reviewed'
   seed['notes']='Northern shore roof verified independently at enlarged source scale: upper rectangular shed with chimney and lower red hipped compound. Separate nearby boat is excluded.'
  reviewed.append(seed)
 castle_polygons={
  'stomion-building-shores-0001':[[3336,410],[3325,422],[3347,445],[3358,458],[3340,473],[3324,479],[3317,493],[3327,508],[3344,517],[3354,535],[3355,549],[3379,565],[3391,550],[3389,533],[3383,514],[3368,504],[3371,489],[3393,488],[3404,481],[3418,491],[3436,477],[3425,464],[3431,450],[3442,436],[3423,428],[3428,414],[3410,408],[3394,422],[3388,435],[3372,444],[3358,434],[3362,425],[3348,414]],
  'stomion-building-shores-0002':[[3378,570],[3396,562],[3416,576],[3427,580],[3432,570],[3450,564],[3460,551],[3477,532],[3499,529],[3509,539],[3525,540],[3540,555],[3525,569],[3508,570],[3495,579],[3482,583],[3472,590],[3482,600],[3468,611],[3450,602],[3439,610],[3417,616],[3404,602],[3389,600],[3374,589]],
  'stomion-building-shores-0003':[[3502,401],[3503,408],[3545,407],[3540,420],[3556,418],[3578,436],[3592,428],[3595,440],[3603,437],[3618,455],[3615,459],[3633,462],[3630,470],[3624,535],[3615,539],[3613,548],[3602,549],[3594,566],[3573,567],[3545,578],[3530,567],[3535,554],[3559,538],[3572,524],[3566,514],[3559,516],[3558,506],[3578,500],[3576,490],[3566,483],[3575,471],[3560,468],[3565,458],[3557,446],[3543,454],[3536,447],[3520,448],[3514,436],[3509,438],[3496,426],[3500,409]]}
 for seed in reviewed:
  manor_corrections={7:(3210,535,32,28,45,'gatehouse'),10:(3265,450,28,24,0,'gatehouse'),11:(3345,405,28,26,45,'gatehouse'),12:(3270,734,30,35,18,'house'),13:(3267,710,39,23,15,'house')}
  source_id=int(seed['id'].rsplit('-',1)[-1])
  if source_id in manor_corrections:
   seed['x'],seed['y'],seed['w'],seed['h'],seed['angle'],seed['kind']=manor_corrections[source_id]
   seed['confidence']='source-center-reviewed'
   seed['notes']='Roof center verified at original source scale; open ramparts and adjacent boats excluded.'
  if seed['id']=='stomion-building-shores-0015':
   seed.update({'x':2728,'y':608,'name':"Mayor's Manor",'aliases':["Mayor's Manor"],'poiId':'0','footprint':[[2715,585],[2722,580],[2730,590],[2742,588],[2749,594],[2760,596],[2762,604],[2754,612],[2738,614],[2735,624],[2726,625],[2715,616],[2700,611],[2704,593],[2715,593]],'confidence':'source-outline-reviewed','method':'Manual outline of the single palace roof on Harrowholm. Nearby round garden pool and northern stairs are not additional buildings.'})
  if seed['id'] in castle_polygons:
   seed['footprint']=castle_polygons[seed['id']]
   seed['confidence']='source-outline-reviewed'
   seed['method']='Manual nonconvex roof-wing outline from original image; courtyard is excluded.'
   if seed['id'].endswith('0001'):seed['x'],seed['y']=3360,470
   if seed['id'].endswith('0003'):seed['x'],seed['y']=3550,435
 seeds=reviewed
 seeds.append({'id':'stomion-building-shores-0209','x':3265,'y':491,'w':29,'h':28,'angle':0,'kind':'gatehouse','confidence':'roof-verified','method':'Separate lower hipped gate roof at the end of the western drawbridge; open bridge deck is excluded.'})
 seeds.append({'id':'stomion-building-shores-0210','x':3320,'y':730,'w':30,'h':28,'angle':18,'kind':'house','confidence':'source-center-reviewed','method':'Separate L-shaped service-house roof beside the manor south gate.'})
 seeds.append({'id':'stomion-building-shores-0211','x':3309,'y':690,'w':31,'h':30,'angle':12,'kind':'building','confidence':'source-center-reviewed','method':'Separate roofed mill structure north of the manor south-gate service houses.'})
 seeds.append({'id':'stomion-building-shores-0208','x':3412,'y':529,'footprint':[[3410,505],[3438,526],[3418,550],[3389,531]],'kind':'building','confidence':'roof-verified','method':'Manual quadrilateral of a detached castle garden tower roof.'})
 seeds.append({'id':'stomion-building-shores-0207','x':3041,'y':2556,'footprint':[[3031.5,2556],[3042,2547],[3050.5,2557],[3040,2565]],'kind':'house','confidence':'roof-verified','method':'Manually traced separate gabled roof beside southern village L-house.'})
 seeds.append({'id':'stomion-building-shores-0206','x':3182.5,'y':1639,'w':17,'h':12,'angle':-45,'kind':'house','confidence':'center-reviewed','method':'Manually located missing gabled roof above eastern farm lane.'})
 for seed in seeds:
  if seed['x']==3290 and seed['y']==1076:
   seed.update({'id':'stomion-building-river-islet','footprint':[[3294,1062],[3310,1079],[3288,1090],[3272,1075]],'entrance':[3304,1082],'confidence':'roof-verified','notes':'Visible roof on an isolated paved river islet, with eastern landing steps. Boat access is a newly authored navigation proposal; no existing ferry service or schedule inferred.'})
 # Independent final native-image review supplies stable-ID corrections and
 # exclusions. This report is retained as source evidence for repeatable builds.
 review_path=ROOT/'design/stomion/shores-final-review.json'
 if review_path.exists():
  decisions={r['id']:r for r in json.loads(review_path.read_text())['records']}
  final=[]
  for seed in seeds:
   decision=decisions.get(seed['id'])
   if decision:
    if decision['status'] in ('remove','uncertain','ambiguous'):continue
    if 'recommendedCenter' in decision:
     seed['x'],seed['y']=decision['recommendedCenter']
    if 'recommendedRectangle' in decision:
     seed.pop('footprint',None)
     seed.update(decision['recommendedRectangle'])
    if 'recommendedKind' in decision:seed['kind']=decision['recommendedKind']
    seed['confidence']=decision['recommendedConfidence']
    seed['method']='Independent native-image roof-center review; rectangular extent remains approximate.'
    seed['centerReviewEvidence']=decision['verifiedCenterEvidence']
    seed['reviewNotes']=decision['reason']
   final.append(seed)
  seeds=final
 data={'district':'shores','metadata':{'sourceImage':'maps/The-Port-City-of-Stomion.webp','coordinateSystem':'original image [x,y] pixels','provenance':'Manual visual inventory. Castle wings are building units; no occupants or historical street identities inferred.'},'seeds':seeds}
 if review_path.exists():data['metadata']['independentCenterReview']='design/stomion/shores-final-review.json'
 (ROOT/'design/stomion/seeds-shores.json').write_text(json.dumps(data,indent=2)+'\n')
 im=Image.open(ROOT/'maps/The-Port-City-of-Stomion.webp').convert('RGB');d=ImageDraw.Draw(im)
 for i,b in enumerate(seeds):
  x,y=b['x'],b['y'];d.ellipse((x-6,y-6,x+6,y+6),fill='#f343dd');d.text((x+7,y),b['id'].rsplit('-',1)[-1].lstrip('0') or 'islet',fill='white',stroke_width=1,stroke_fill='black')
 im.save(ROOT/'design/stomion/seeds-shores-overlay.png')
 print(f'{len(seeds)} roof seeds')
if __name__=='__main__':main()
