#!/usr/bin/env python3
"""Reproducible hand tracing of streets visible on the Stomion map.
Coordinates in TRACE are half-resolution image pixels (x,y); exported coordinates
are the atlas's full-resolution Leaflet (3072-y,x). Street names are newly authored
for this address demonstration, not historical/campaign canon.
"""
from pathlib import Path
import argparse,json,math,re,collections
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1]
WIDTH,HEIGHT=4096,3072
RAIL_REVIEW='Native-image review of continuous northern and eastern tracks beneath covered crossings and across four river bridges, the eastern mill loop, and local bridge crossings. Occlusion affects drawing only; route geometry and distance continue beneath the structures. Rail remains separate from surface crossings. Station service and boarding access are not established by the artwork.'
TRACE=r'''
# name | class | x,y ... (half-resolution image coordinates)
Northgate Avenue|road|835,528 834,548 844,572 855,595 869,627 885,641
Hallow Heart Ring|road|894,641 920,637 949,639 977,647 1004,664 1021,687 1033,715 1032,744 1022,776 1003,801 977,818 945,826 914,821 887,806 866,785 851,758 847,726 852,696 866,669 894,641
Coin's Avenue|road|1033,715 1045,749 1069,761 1108,756 1150,751 1190,750 1206,755 1240,744
Highhammer Avenue|road|1003,801 1022,821 1042,848 1058,872 1081,891
Towers Avenue|road|851,726 823,728 796,745 762,772 728,800 690,830 651,860 614,888 574,916 535,945
Towers Crescent|road|690,830 698,853 714,877 740,896 766,915 796,932 820,947
Highhammer Crescent|lane|977,818 978,839 960,861 942,884 930,911 918,930 909,950
Badges Ring|road|909,950 904,927 890,909 869,901 845,905 828,919 819,939 817,962 829,983 850,994 876,993 896,978 909,950
Chimes Avenue|road|909,950 945,949 982,941 1017,928 1053,911 1081,891 1116,881 1154,866 1188,853 1221,840 1241,834 1250,865 1260,895 1273,930
Oldmarket Avenue|road|1022,776 1048,798 1074,825 1098,853 1116,881
Oldmarket Square|road|1048,798 1083,792 1119,780 1154,776 1193,775 1227,785 1239,807 1241,834 1204,847 1164,861 1126,875 1116,881
Oldmarket Inner Lane|lane|1074,825 1104,815 1141,807 1179,803 1193,812 1200,832 1204,847
Oldmarket East Street|road|1193,775 1214,758 1248,750 1263,756 1273,769 1278,803 1295,821 1311,832 1347,852
Coin Street|road|1033,715 1045,749 1069,761 1108,756 1150,751 1190,750 1206,755
Coin Court|lane|1069,761 1065,735 1080,713 1093.5,700 1110,697.5 1127,697.5 1146,705 1147,730 1142,751
Senate Lane|lane|1127,697.5 1161,701 1175,715 1182,734 1190,750
Foundry Street|road|1240,744 1226,714 1212,686 1206,661
Steamwall Avenue|road|1347,852 1365,816 1379,785 1397,753 1416,716 1436,680 1448,652 1453,625
Steamwall Street|road|1310,660 1319,633 1324,606 1325,575 1320,543 1311,513 1298,487 1287,460 1284,434
Merchant Hill Road|road|1275,649 1263,621 1255,590 1252,558 1254,525 1254,497 1267,473 1287,460 1318,453 1352,459 1389,472 1423,485 1440,489
Cathedral Ring|road|1440,489 1414,492 1395,507 1385,532 1387,557 1396,580 1406,607 1421,634 1440,646 1453,645 1475,630 1492,609 1497,581 1493,552 1481,526 1464,504 1440,489
Harrowholm Bridge|bridge|1341,384.5 1345,368 1352,346 1358,328 1368,319
Harrowholm Walk|path|1368,319 1378,324 1386,322 1387,307 1380,296 1375,288 1364,289 1354,290 1345,296 1342,306 1348,314 1358,320 1368,319
Merchant Upper Walk|lane|1250,421 1261,422.5 1272,420 1286,420 1302,420 1319,421 1330,420
Academy Lane|path|1013,641 1023,643 1038,639 1051,639 1065,636 1079,631 1090,620 1102.5,607.5 1108,603.5 1113,597.5
Academy Lower Court Walk|path|1038,639 1038,625 1038,614 1038,603 1033,598
Academy Riverwalk|path|1020,537 1015,521 1013,500 1017,480 1032,480 1046,484 1059,487 1075,480 1080,474.5 1076.5,471 1060,457 1054,446 1056,436 1062.5,432.5 1062.5,421 1080,415 1095,415 1110,424 1120,433.5 1124,440.5
Academy Peninsula Walk|path|1100,474.5 1102,466 1104,462.5 1104.5,460
Hallow Eastern Deck Walk|path|1033.5,767 1034.5,759 1035,748 1035.5,737 1036,728 1036,722
Hallow Northeast Inner Approach|path|1008,677 1005,681 1007,686
Hallow Northeast Outer Approach|path|1019,668 1020,662 1019,658
Hallow Eastern Outer Approach|path|1032,768 1040,770
Institute Walk|path|1037,524 1041,523 1045,520
Garden South Walk|path|1108,603.5 1107,610 1105.5,617.5 1110,625 1120,635 1119,643 1122,652 1125,654
Garden Eastern Walk|path|1137,559 1156,551.5 1164,545.5 1175,545 1167,518 1166,488 1180,461 1202,441 1225,429 1250,421
Smartwalk|road|1013,641 1023,643 1040,638 1071,650 1095,657 1125,654 1150,645 1173,635 1196,628 1225,634 1244,645 1275,649
Smartwalk East|road|1196,628 1221,610 1255,590
Northgate Wall Road|lane|835,528 859,515 885,499 907,483 933,465 956,449 978,435 997,416 1026,402 1056,397 1096,405
Northgate East Lane|road|851,555 870,547 887,555 904,576 921,595 943,611 971,620 977,628 983,632 989,633
Northgate Cross|lane|866,590 885,585 904,576
Northgate Lower Street|lane|881,632 904,623 929,624 949,624 966,627 982,636 989,633
Northgate Upper Lane|lane|870,547 887,531 900,532 915,549 938,560 955,579 971,601 971,620
Northgate Artisan Lane|lane|887,531 885,499
Northgate Garden Lane|lane|955,579 972,563 987,548 995,530 985,510 974,488 978,435
Oldfort Wall Road|road|835,528 807,546 777,565 742,586 707,609 687,630 675,660 661,692 646,730 632,771 614,803 583,825 550,850
Oldfort East Street|road|851,555 831,571 813,588 804,612 797,638 791,667 795,690 816,707 830,713 851,726
Oldfort Lane|lane|777,565 783,590 791,615 797,638
Oldfort Chancery Lane|lane|742,586 760,607 768,630 783,650 791,667
Oldfort Orchard Lane|lane|707,609 724,638 737,661 741,684 737,706 730,729 720,748 708,768 705,788 700,800 697,800
Oldfort South Lane|lane|661,692 685,702 710,704 737,706 763,707 795,690
Oldfort Library Lane|lane|795,690 821,673 836,664 858,676
Wallside Street|road|550,850 575,866 602,874 629,870 638,858 644,851 650,847
Shacks Shore Road|road|632,771 637,766 639,752 639,739 635,727 627,722 637,706 646,695 651,684 656,670 656,658 650,650 650,647 672,628 687,630
Shacks Northern Access Deck|bridge|641.5,655 635,658 630,661 626,665
Shacks Northern Landing Approach|path|641.5,655 642,653 644,650 648,650 650,650 656,658
Shacks Northern Upper Perimeter|path|626,665 628.5,658.5 628,653 623.5,650 620,649.5
Shacks Northern Boardwalk|path|626,665 622,672 617,678 607,680 599,677 602,671 603,668
Shacks Northern East Deck|path|626,665 629,672 634,677 631,684
Shacks Middle Access Deck|bridge|627,722 621,720 616,718 612,717
Shacks Southern Raft Boardwalk|path|584,748 586,750 586,750.5 583.5,750.5 580.5,753.5 580,753.5 576.5,757 575,757 574,757 573,758 572,758 567,763 567,765 567.5,766.5 565,769 562.5,771 560,773 558.5,774.5 557,776.5 557,777 555,779 552,781 549,783.5 547,784 546,784 539,777 537,777 535,779 533,777 533,776 532,777 529,774 529,770
Shacks Southern East Boardwalk|path|547,784 551,784
Shacks Southern East Boardwalk Spur|path|590,782 590,786 592,788 592,789 593,790 593,792 595,794 597,794 599,792 598,791 598,789
Shacks Southern North Boardwalk|path|584,748 582,743 574,740 569,735
Side Harbor Southern Quay|road|490,943 487,949 482,988 477,1027 472,1064 454,1082 430,1096 394,1118 361,1140
Side Harbor Quay|road|550,850 519,868 500,881 491,911 493,924
Newkort Avenue|road|491,911 513,916 540,913 569,900 602,877 614,888
Newkort Upper Street|lane|500,881 521,893 545,887 575,866
Newkort South Street|road|487,949 512,956 536,978 550,976 575,957 600,940 626,920 651,901 675,882 695,867 704,863
Roselantern Road|road|482,988 506,986 530,988 550,1000 575,982 600,963 625,945 650,925 675,904 700,879 711,876
Roselantern South Street|road|477,1027 504,1026 530,1027 550,1023 575,1005 600,985 625,966 650,945 675,925 700,905 730,882
Swath Road|lane|472,1064 491,1050 519,1045 544,1058 575,1037 600,1018 625,999 650,980 675,960 700,941 725,922 740,914
Mirkwater Street|road|492,1131 526,1107 562,1084 596,1058 628,1034 660,1007
Mirkwater North Street|lane|574,1068 605,1068 630,1081 648,1091 676,1090 711,1090 742,1091 773,1093 804,1094 835,1095 877,1081
Badges North Street|lane|738,948 758,972 779,999 803,1025 819,1046 838,1060 857,1065 880,1054 899,1035 906,1007 901,997
Badges South Street|road|660,1007 678,1030 680,1048 680,1061 684,1067 699.5,1068 715,1068 723.5,1068 723.5,1084.5 731,1089 742,1091
Chimes Canal Gate Bridge|bridge|1248,936 1238,944
Chimes Wall Road|road|1238,944 1218,952 1188,978 1160,1006 1131,1028 1105,1047 1080,1047 1064,1047 1041,1047 1015,1047 987,1047 958,1047 932,1050 910,1065 908,1076 905,1088 901,1098 894,1106
Chimes South Street|lane|1034,952 1037,972 1041,995 1041,1025 1041,1047
Chimes Middle Street|lane|1053,911 1063,935 1072,958 1074,980 1066,1000 1064,1030 1064,1047
Chimes East Street|lane|1120,896 1124,908 1138,933 1150,954 1168,978 1188,978
Chimes Inner Lane|lane|984,972 990,992 1004,1015 1015,1038 1015,1047
Harbor Western North Bank Approach|path|684,1119.5 684,1105 700,1105 723,1105 742,1105 760,1100 779,1100 779,1089
Harbor Eastern North Bank Approach|path|777.5,1119.5 771,1115 779,1109 779,1100
Mirkwater Landing|road|596,1163 627,1164 658,1165 691,1165 722,1166 753,1167 785,1167 817,1168 847,1167 868,1184
Mirkwater Upper Quay|road|596,1126 627,1127 658,1128 691,1129 722,1130 753,1131 785,1131 816,1132 847,1132 876,1133
Saltmarket Street|road|361,1140 385,1159 404,1175 427,1197 448,1218 465,1233
Saltmarket Upper Lane|lane|394,1118 421,1138 438,1155 455,1173 474,1190 491,1202 518,1187 546,1168 556,1160
Saltmarket Shore Road|road|361,1140 349,1164 337,1189 321,1216 308,1241 294,1265 327,1261 359,1254 391,1246 422,1238 448,1218 479,1212 507,1194 536,1175 561,1161
Brightfyr Upper Lane|lane|337,1189 355,1198 372,1212 391,1227 398,1244
Brightfyr Beacon Walk|lane|308,1241 327,1235 344,1220 355,1198
Saltmarket Cross Lane|lane|385,1159 403,1149 421,1138
Waterlock Street|road|847,1132 847,1114 855,1099 877,1081
Mirk Landing West|lane|596,1163 596,1154 605,1159
Mirk Landing Mid|lane|658,1165 658,1155
Mirk Landing East|lane|785,1167 785,1155
Mirk Landing Pier Walk|path|648,1165 648,1173.5 648,1202 644,1202
Mirk Landing Eastern Covered Pier|path|722,1166 721,1173.5 721,1203 725,1203
Mirk Landing Center Finger|bridge|689,1165 688,1165 688,1174 689.5,1175 689.5,1187.5 678,1187.5 689.5,1187.5 703.5,1187.5
Mirk Landing East Finger|bridge|721,1175 721,1187.5 741,1187.5 741,1206.5
Mirk Landing Outer Finger|bridge|764,1187.5 764,1206.5
West Harbor Mole|path|550,850 527,824 503,798 479,771
Harbor Upper Pier|bridge|519,822.5 531,815 540,807 550,798 561,788.5 569,781.5
Shacks Southern Ground Approach|path|519,822.5 519,828.5 521,828.5 525,831 528.5,831 531,828 531,829 541,840 550,850
Harbor Lower Pier|bridge|497,899 486,899 480,899 474,899 468,899 464,901 451,901 451,898 439.5,883.5 430.5,888.5 420,897
Side Harbor Western Roof Frontage|path|497,899 480,899 473.5,898.5 474.5,889 473.5,880 475.5,872.5 479,869
'''
TRACE += r"""
Northgate Bridge|bridge|835,528 815,505 792,477 772,452 751,427 731,401
Woodhollow Road|path|731,401 703,385 681,364 664,341 650,322 636,305 628,288 627,262
Woodhollow North Bridge|bridge|627,262 608,236 584,207 561,176 541,149 527,124
Northern Approach|path|527,124 510,101 493,76 471,44 454,18
Woodhollow Quay|path|636,305 659,293 682,277 695,278 705.5,274 710,266 710,258.5 709,246 728,230 755,221 780,222 812,224 827,219
Woodhollow Mill Road|path|627,262 647,253 673,249 695,253 702.5,252.5 710,258.5
Woodhollow Farm Lane|path|682,277 689,287 690,299 701,303 724,310 731,320 738,321 748,315 755,309 762,302 785,285 812,280 827,258 827,219
Woodhollow Orchard Lane|path|703,385 707,366 712,345 715,327 715,308
Woodhollow Field Lane|path|664,341 648,357 631,377 610,388 587,402 558,417 540,431
Woodhollow Tower Lane|path|631,377 644,396 621,410 594,421 568,428 540,431 539,451 540,475
Western Reed Road|path|540,475 520,485 498,485 475,492 456,510 435,522 420,536 399,551 382,570 365,587 352,610 338,636
Woodhollow West Farm Lane|path|540,431 517,444 503,460 498,485
Western Reed Yard|path|456,510 446,497 427,486 411,489 406,506 420,536
Northern Forest Road|path|471,44 484,19
Northwest Forest Road|path|493,76 488,101 476,123 455,142 436,158 420,174 399,162 383,145 369,133 352,112 341,91 330,73
Northwest Clearing Road|path|399,162 391,181 375,199 355,211 329,229 310,246 289,274 260,295 231,311 197,330 163,343 129,346 104,352 81,371 62,394
Northwest Forest Spur|path|355,211 353,195 354,172 352,150 352,112
Aelindor Bridge|bridge|1604,347 1580,366 1556,383 1522,405 1482,433 1444,462 1423,485
Aelindor Approach|road|1604,347 1619,362 1635,374 1656,378 1678,379 1693,365 1696,341 1701,323 1715,311 1695,306 1684,298 1691,285 1701,280 1723,270 1729,260 1735,245 1745,233
Aelindor Courtyard Walk|path|1745,233 1758,240 1760,255 1748,258 1735,245 1745,233
Aelindor Castle Walk|path|1745,233 1735,222 1735,213 1747,200 1755,198
Aelindor Upper Courtyard|path|1735,222 1725,211 1724,201 1733,192
Aelindor North Walk|path|1733,192 1743,182 1758,183 1767,193 1755,198
Aelindor Outer Walk|path|1691,285 1675,279 1655,278 1645,290 1628,273 1620,254 1626,239 1643,229 1663,215 1688,198 1706,190 1719,193 1724,201
Aelindor Dock Walk|path|1620,254 1611,242 1614,219 1627,208
Aelindor South Garden|path|1696,341 1675,337 1651,332 1634,325 1620,310 1610,291 1620,254
Old Gate Bridge|bridge|1347,852 1378,867 1407,882 1437,896 1465,910
Chim Gate Bridge|bridge|1131,1028 1139,1028 1156,1049 1170,1067 1182,1080 1198,1097 1215,1113
East Bank Road|path|1465,910 1485,931 1506,948 1531,962 1558,975 1584,987 1607,999
East Bank Bridge|bridge|1607,999 1641,1016 1664,1028 1682,1037
Eastern Approach|path|1682,1037 1710,1054 1736,1074 1761,1090 1784,1106 1811,1131 1839,1163 1866,1194 1897,1230 1922,1266 1952,1302 1980,1341 2004,1380 2024,1418
East Bank Mill Lane|path|1506,948 1523,927 1527,915 1527.5,906 1532.5,900 1539.5,893 1541.5,880.5 1547.5,872 1552,864 1555,855 1552.5,846 1565,832 1593,811 1617,789 1635,765 1650,745 1667,720 1684,694 1705,667 1721,639 1734,610 1747,575 1759.5,545 1783,545 1785,530 1791,517.5 1803.5,512.5 1805,510
East Bank Shore Walk|path|1541.5,880.5 1535,872 1527.5,872 1523.5,879 1519,883.5
East Bank Cottage Lane|path|1527.5,906 1531.5,914.5 1551.5,915 1570,919 1595,921 1614,936 1621,951 1607,999
Reedbank Road|path|1506,948 1494,969 1476,987 1456,1000 1432,1019 1407,1040 1377,1062 1350,1082 1322,1102 1290,1120 1262,1131 1238,1140 1215,1144 1191,1153 1164,1174 1137,1197 1110,1220 1081,1241 1057,1259 1032,1272 1000,1290 967,1308 938,1328 913,1334 885,1340 860,1347 840,1348 821,1354 800,1356 779,1363 754,1370
Chim Bank Lane|path|1215,1113 1215,1144
Reedbank Upper Lane|path|1456,1000 1448,986 1427,993 1408,1004 1407,1040
Reedbank Farm Lane|path|1377,1062 1392,1075 1381,1094 1358,1108 1336,1115 1322,1102
Reedbank Field Lane|path|1290,1120 1278,1105 1260,1100 1236,1116 1223,1128 1238,1140
Reedbank Southern Bridge|bridge|1293,1188 1310,1207 1330,1229 1354,1250
South Bank Road|path|1354,1250 1375,1261 1390,1282 1411,1297 1438,1305 1460,1309 1486,1321 1510,1340 1527,1365 1545,1385 1560,1408 1572,1431 1580,1454
South Bank Mill Lane|path|1438,1305 1455,1285 1477,1269 1502,1258 1522,1250 1542,1236 1568,1225 1590,1214 1616,1195 1639,1170 1653,1144 1664,1117 1675,1088 1682,1060 1682,1037
South Bank Village Lane|path|1477,1269 1492,1284 1513,1295 1534,1306 1554,1298 1570,1284 1586,1265 1590,1240 1590,1214
Southern Shore Road|path|1390,1282 1372,1301 1350,1316 1325,1330 1300,1343 1271,1362 1249,1383 1222,1401 1193,1415 1165,1422 1134,1425 1101,1432 1071,1441 1040,1451 1004,1463 970,1478 943,1494
Southern Homestead Lane|path|1249,1383 1237,1402 1246,1421 1262,1432
Eastern Farmland Road|path|1710,1054 1727,1023 1753,992 1783,966 1810,944 1837,929 1855,914 1874,899 1900,884 1923,863 1947,839 1975,815 1998,793 2028,766
East Orchard Lane|path|1837,929 1834,915 1836,904 1833.5,891 1832.5,879 1839,869 1846,865 1857.5,868 1870,872 1884,878 1900,884
Eastern Homestead Road|path|1839,1163 1817,1185 1800,1208 1784,1231 1764,1250 1748,1278 1749,1304 1768,1335 1785,1363 1796,1394 1802,1420 1800,1447 1813,1473 1832,1502
East Field Crossroad|path|1874,899 1900,930 1924,953 1948,971 1975,991 2005,1016 2031,1040
East Field South Road|path|1784,1106 1802,1073 1829,1045 1855,1023 1886,1003 1924,953
East Forest Path|path|1975,991 1945,1039 1920,1080 1909,1113 1915,1142 1922,1166 1910,1192 1893,1216 1870,1238 1844,1262 1824,1295 1810,1321 1800,1351 1796,1394
East Forest Upper Spur|path|1947,839 1925,811 1915,784 1902,748 1917.5,710 1920,690 1925,680 1937,642
East Forest Lower Spur|path|1948,971 1980,946 2006,924 2026,909
"""

TRACE += r"""
# Raised railway deck centers reviewed at native image scale. The northern
# track continues under Northgate and across both northern river bridges.
# The eastern line continues under its covered station and gate across two more
# river bridges; its visible mill loop is included. The western and southern
# dock spur branches from the western viaduct. No passenger service is inferred.
Northgate Railway|rail|451.5,14 472.5,41.5 491,68 509,92.5 530.5,120.5 549.5,147 568.5,173.5 588,200 603.5,223 621,247.5 636.5,268 654,290 671.5,312 689,334 705.5,356 722.5,378.5 738,399.5 753.5,420.5 770,442.5 787,465 805,488.5 822.5,513 835,529.5 844,545 850.5,555.5 860.5,566 872,582.5 881,602 887.5,619 894,636.5 900.5,653.5 908,673 915,690.5 924.5,705 930.5,714 934,720 942,726.5
Coin Railway|rail|942,726.5 957.5,727.2 974.85,723.9 994.7,722.1 1011.8,717.4 1031.4,712.15 1053.55,703.95 1075.95,696.75 1098.35,689.3 1120.2,681.35 1142.15,672.35 1156.2,666.85 1168.4,662.25 1184.1,657.6 1200.2,656.5 1214,658.75 1227.3,665.05 1240.3,672.35 1253.55,682.95 1263.55,694.7 1273.3,708.2 1280.65,719.95 1286.85,732.5 1289,745 1292.5,760 1296,775 1299,790 1301.5,805 1304,820 1312.5,834 1325,848 1337,858 1349,866 1370,876.5 1390,886.5 1410,896.5 1430,906.5 1450,916.5 1470,926.5 1490,936.5 1510,946.5 1530,956.5 1550,966.5 1570,976.5 1590,986.5 1610,996.5 1630,1006.5 1650,1016.5 1670,1026.5 1688,1041 1708,1051 1738,1068.5 1768,1086.5 1798,1104.5 1828,1124.5 1853,1142 1873,1160 1893,1179 1913,1199.5 1933,1220.5 1953,1242 1973,1265 1993,1286 2013,1303.5 2026,1313.5
Highhammer Railway|rail|942,726.5 937,744.5 929.5,764 921,782.5 910.5,802.5 897.5,820 883.5,835 868.5,849.5 853,864 837.5,877 820.5,890 800.5,905 780.5,920 760.5,935 740.5,950 720.5,965 700.5,980 680.5,995 660.5,1010 640.5,1025 620.5,1040 600.5,1055 583,1069 567.5,1082.5 556,1092.5 540.5,1104 525.5,1115 510.5,1126 495.5,1137 484.5,1145 471.5,1155 458.5,1165 445.5,1175 432.5,1185 423.5,1192.5
Mirkwater Railway|rail|556,1092.5 563.5,1095 570,1098 580,1098 595,1098 615,1098 635,1098 660,1098 690,1098 720,1098 760,1098
Eastern Mill Railway Loop|rail|1490,936.5 1496.5,952 1507,964 1520,971.5 1535,975.5 1550,976.5 1570,976.5
Reedbank Bridge Approach|path|1290,1120 1302,1134 1308,1151 1302,1169 1293,1188
Highhammer West Walk|lane|900,817 881,837 855,863 830,887 816,902 822,914 842,913
Highhammer Lower Walk|lane|918,930 911,903 897,880 881,855 881,837
Towers Square Walk|lane|732,844 742,844 766,838 789,833 809,829 822,814 843,797 866,785
Towers Northern Walk|lane|724,829 731,829 741,829 750,835 766,839 779,843
Towers Southern Walk|lane|711,876 720,875 727,875
Towers South Market Walk|lane|743,873 752,857 766,838
Towers Eastern Walk|lane|766,889 774,867 792,853 809,829
Towers Upper Terrace|lane|703.5,815.5 707,809 717,801.5 741,783 766,760 791,738.5 803,726 815,726 828.5,726
Swath Upper Alley|lane|544,1058 562,1056 588,1035 615,1015 643,994 669,974 697,943 720,935
Swath Lower Alley|lane|574,1068 594,1084 612,1088 625,1075 648,1058 673,1039 695,1023 711,1012 735,1002 751,991 758,972
Oldfort Green Interior Alley|path|660.5,769 661.5,777.5 662,785 665,792 666,796.5 667.5,802 669,807 669,813.5 669,820 677,819 675,822 668,826 659,831 650,838 638,846 635,850 638,858
Mirkwater West Lane|lane|605,1068 619,1058 635,1047 648,1036 659,1025 672,1015 691,1002 701,990
Mirkwater Mid Lane|lane|630,1081 643,1071 660,1060 678,1051 694,1050
Mirkwater East Lane|lane|711,1090 699.5,1068 699.5,1050 708,1046.5 718,1046.5 723,1051 745,1044 758,1041 778,1039 803,1025
Badges Inner Walk|lane|829,983 813,996 805,1012 811,1024 829,1029 851,1021 866,1009 876,993
Badges Eastern Walk|lane|901,997 917,986 929,1001 922,1017 909,1030 899,1035
Badges Southern Walk|lane|851,1021 856,1041 857,1065
Chimes Cross Lane|lane|906,1007 925,1008 951,1011 971,1012 990,992 1013,982 1037,972 1057,969 1072,958 1096,947 1117,940 1138,933
Chimes Lower Lane|lane|880,1054 899,1055 918,1048 941,1039 966,1036 987,1033 1004,1015 1020,1004 1041,995 1066,1000 1090,984 1114,969 1150,954
Chimes Market Lane|lane|1095,906 1100,919 1117,940 1114,969 1127,990 1147,1007 1160,1006
Chimes East Lane|lane|1159,884 1162,896 1162,910 1170,925 1187,932 1197,944 1215,956 1238,944
Chimes Outer Lane|lane|1221,840 1226,870 1236,893 1242,916 1250,939 1253,946
Oldmarket West Lane|lane|1048,798 1053,826 1074,850 1098,865 1116,881
Oldmarket Garden Lane|lane|1074,825 1085,846 1109,852 1133,847 1158,838 1179,830 1200,832
Oldmarket East Alley|lane|1227,785 1227,811 1228,832 1235,851 1245,875 1252,899 1252,914
Station Forecourt Walk|lane|1273,769 1295,752 1315,752 1335,759 1348,777 1353,797 1342,815 1320,822 1295,821
Coin Fountain Walk|lane|1127,697.5 1133,692 1151,686 1171,675
Coin Eastern Walk|lane|1171,675 1184,692 1196,712 1209,730 1221,744 1240,744
Coin Northern Walk|lane|1184,692 1169,707 1178,723 1196,712
Steamwall Factory Lane|lane|1311,832 1317,808 1321,784 1318,759 1312,742 1330,717 1340,692 1340,678 1332,681
Steamwall Lower Lane|lane|1340,692 1361,699 1378,710 1394,727 1397,753
Steamwall East Lane|lane|1353,797 1379,785
Steamwall Upper Lane|lane|1319,633 1335,635 1358,638 1383,648 1408,661 1436,680
Merchant's Lower Court|lane|1275,649 1291,647 1308,632 1310,611 1301,595 1289,584 1273,572 1252,558
Merchant's Central Lane|lane|1289,584 1284,562 1280,542 1278,521 1281,500 1287,477 1287,460
Merchant's West Lane|lane|1255,590 1267,609 1280,624 1291,647
Merchant's Crown Lane|lane|1254,497 1275,489 1297,494 1308,513 1312,537 1311,557 1310,577 1301,595
Merchant's North Row|lane|1287,460 1272,446 1279,427 1284,407 1300,405 1304,426
Merchant's North Court|lane|1304,426 1312,409 1326,409 1332,429
Merchant's East Row|lane|1332,429 1342,409 1358,409 1365,439
Merchant's Wall Row|lane|1365,439 1376,422 1387,425 1394,440 1394,457
Merchant's Fountain Lane|lane|1318,453 1334,462 1336,473 1336,484 1334,491 1322,497 1339,495 1354,486 1363,472 1374,465 1389,472
Cathedral West Walk|path|1395,507 1381,512 1370,528 1367,549 1369,568 1374,589 1385,610 1402,633 1421,648 1440,646
Cathedral East Walk|path|1464,504 1473,488 1484,490 1490,511 1497,535 1502,558 1508,581 1506,606 1496,633 1478,652 1453,660 1436,680
Cathedral Nave Walk|path|1406,607 1422,602 1437,612 1440,646
Cathedral Chapel Walk|path|1475,630 1460,612 1457,590 1468,580 1497,581
Smartwalk Upper Lane|lane|1071,650 1080,631 1094,628 1111,641 1125,654
Smartwalk Workshop Lane|lane|1150,645 1144,629 1155,610 1174,603 1194,611 1196,628
Northgate River Court|lane|859,515 871,536 886,552 903,557 915,549
Northgate Market Court|lane|904,576 918,566 938,560
Oldfort Water Lane|lane|650,647 672,660 694,668 710,677 720,689 710,704
Oldfort Garden Lane|lane|724,638 709,645 694,658 694,668
Oldfort Inner Lane|lane|768,630 750,641 742,660 741,684
Oldfort South Court|lane|730,729 750,730 773,720 791,710 816,707
Oldfort East Court|lane|797,638 822,639 836,650 836,664
Oldfort West Court|lane|763,707 772,687 783,670 791,667
"""

TRACE += r"""
Side Harbor Outer Quay|road|418,978 415,1002 414,1024 411,1042 402,1063 384,1080 360,1096 347,1112 361,1140
Harbor Warehouse Cross|lane|421,930 449,936 464,938 487,949
Harbor Exchange Cross|lane|420,954 443,960 461,965 485,969
Harbor Temple Cross|lane|415,1002 438,1008 458,1014 479,1017
Harbor South Cross|lane|402,1063 420,1074 438,1090 454,1082
Harbor Northern Wharf|bridge|479,869 471,874 470.5,877 470.5,885 470.5,894 467.5,899 464,901 451,901 451,898 439.5,883.5
Harbor First Pier|path|421,930 401,927 390,926 392,902
Harbor Second Pier|bridge|400,986.5 382.5,981 378,982
Harbor Third Pier|bridge|401,1029 385,1025 379,1023
Harbor West Wharf Exit|path|401,1029 398,1036 396,1042 398,1052 402,1063
Harbor Fourth Pier|path|411,1042 390,1047 371,1059 358,1073
Saltmarket Quay|lane|347,1112 363,1119 388,1122 409,1136 430,1151 448,1170 465,1187 479,1212
Saltmarket Dock Walk|path|448,1218 453,1232 439,1244 425,1254 410,1262
Saltmarket First Dock|path|507,1194 514,1207 529,1227
Harbor Eastern Gray Pier West Deck|bridge|782.5,1172.5 782.5,1176 782.5,1185 782.5,1198 782.5,1212
Harbor Eastern Gray Pier East Deck|bridge|797,1172.5 797,1184 797,1196 797,1211.5
Mirk Landing East Quay|path|817,1168 835,1185 853,1199 868,1184
"""

TRACE += r"""
Northern Bank Field Path|path|471,44 491,53 514,56 540,54 562,46 589,36 618,29 649,25 676,29 707,36 738,41 761,43 784,48 814,54 847,56 874,50 898,44 930,45 956,55 984,68 1011,79 1039,88 1060,91 1082,87 1105,76 1125,71 1147,64 1172,55 1195,47 1225,42 1255,41 1284,43 1310,47 1328,59
Northern Homestead Lane|path|761,43 768,33 784,28 804,23 821,21
Northern Cottages Lane|path|874,50 882,35 895,25 907,26 920,24 930,27.5 934,39 930,45
North Ferry Hamlet Path|path|1082,87 1089,66 1093,51 1105,42 1120,42 1129,32 1135,15
North Shore Farm Lane|path|1310,47 1317,39.5 1324.5,40 1335.5,45 1345,42 1353.5,36 1365,41 1380,38.5 1390,32 1391,22.5
North Shore Upper Lane|path|1345,42 1344,35 1342.5,30 1345,24 1350,19 1355,15.5 1359,15
North Shore Landing Path|path|1310,47 1324,48 1342.5,50 1342.5,58.5 1347.5,63.5 1353.5,68.5
Mill Shore Landing Proposal|path|1803.5,512.5 1800,515 1797.5,517
Islet Ferry|ferry|1797.5,517 1795,513 1778,510 1765,522 1730,532 1701,536 1678,536 1665,537
River Islet Landing Walk|path|1665,537 1660.5,537.5 1657.5,539.5 1654,541.5
"""

TRACE += r"""
Woodhollow Eastern Field Margin|path|827,258 842,266 863,265 882,263 902,258 917,253 929,250 933,249 947,251 971,245 995,235 1006,225 1004,211 986,210 967,212 949,216 934,219 927,224 926,238 933,249
Woodhollow Northeast Farm Lane|path|927,224 920,217 913,215
Aelindor West Garden Walk|path|1604,347 1596,330 1585,309 1576,290 1562,271 1548,253
Eastern Ferry House Walk|path|1617,789 1608.5,765 1610,755 1612.5,747.5 1611,745
Eastern Ferry Footbridge|bridge|1611,745 1607.5,744.5 1604,744 1601.5,742 1599,740 1596.5,737.5 1594.5,735.5
Eastern Ferry Island Approach|path|1594.5,735.5 1594,732.5 1592,728 1591,725.5
Eastern Ferry Landing Walk|path|1591,725.5 1587.5,724 1581.5,724 1579.5,725 1577,725.5
Eastern Ferry Western Landing Deck|bridge|1577,725.5 1575.5,725.5 1575.5,733.5
East Bank Forest House Walk|path|1705,667 1713,659 1718,650 1717.5,638.5
East Bank South Field Margin|path|1456,1000 1470,1013 1476,1031 1486,1044 1490,1055 1486,1064 1475,1071 1457,1072 1445,1066 1434,1052 1407,1040
"""

TRACE += r"""
Harrowholm Entry Lane|lane|1341,384.5 1337,389.5 1332,398.5 1329,410 1330,420 1326,429.5 1321,438 1324,450 1327,454 1332,465 1352,472
"""

TRACE += r"""
Academy Western Bank|path|1020,537 1017,548 1011,557 1006,570 1007,580
Institute Footbridge|bridge|1020,537 1037,524
Academy North Footbridge|bridge|1080,474.5 1100,474.5
Academy Eastern Bank|path|1100,474.5 1104,487.5 1115,494.5 1125,504 1133.5,510 1145,512 1155,520 1157.5,530 1155,540 1147.5,548 1145,553.5 1137,559 1138,572 1135,584 1127,594 1113,597.5
Academy Southern Footbridge|bridge|1122,559 1137,559
Academy Inner Walk|path|1122,559 1114,552 1105,546.5 1095,541.5 1081.5,546 1074.5,555 1073.5,568 1082.5,577.5 1095,584.5 1105,578.5 1116.5,571 1122,559
Academy Inner West Walk|path|1073.5,568 1063,575 1055,580 1051,583 1045,584
Academy Lower Footbridge|bridge|989,633 1000,636 1013,641
Watertowers West Walk|path|859,724.5 869,728 879,724
Hallow Western Bridge Approach|path|847,724.5 842,724.5 838.5,723
Towers Western Northern Approach|path|558,927 558,920
Towers Northern Bridge Plaza Approach|path|828.5,726 828.5,721 824,718
Towers Crescent Northern Approach|path|822.5,937 823,932 821,929
Towers Crescent Southern Approach|path|820,948.5 821,952
Chimes Western Northern Approach|path|924,961 924,956
Chimes Western Southern Approach|path|923,976 923,982
Chimes Eastern Northern Approach|path|1218,857 1218,852 1221,850
Chimes Eastern Southern Approach|path|1213,870 1211,875 1207,878
Badges Southern Inner Approach|path|863,977 864,974 866,970
Badges Southern Outer Approach|path|855,995.5 856,1004
Watertowers Pond Footbridge|bridge|879,724 889,724
Watertowers Base Approach|path|889,724 894,729 900,730
Badges Court Alley|lane|711,1012 723.5,1042 723.5,1055 723.5,1068 723.5,1084.5
Badges West Court Alley|lane|699.5,1068 699.5,1050 708,1046.5
Badges Fountain Court|lane|723.5,1055 733,1055 742,1055 750,1048
Badges Eastern Court Alley|lane|780,1027.5 779,1045 779.5,1065 779.5,1080 779,1087 773,1093
Badges Southern Court Lane|lane|742,1091 748,1085 754,1076 763,1068
"""

GARDEN_WATERWAYS = [
 # One continuous winding canal, not a closed loop around the north mansion.
 [(1145,383),(1130,395),(1129,405),(1138,415),(1158,422),(1170,434),(1172,444),(1166,452),(1150,457),(1131,457),(1120,450),(1104,438),(1090,429),(1075,432),(1067,442),(1071,454),(1084,463),(1090,474),(1087,489),(1078,498),(1058,500),(1044,494),(1033,496),(1030,505),(1030,516),(1038,532),(1060,525),(1100,525),(1120,534),(1130,552),(1120,584),(1098,598),(1062,598),(1044,590),(1035,587)],
 [(1035,587),(1023,591),(1014,596),(1006,605),(1002,616),(996,628),(991,640),(986,649),(977,654)],
]


def distance(a,b):return math.hypot(a[0]-b[0],a[1]-b[1])
def projection(p,a,b):
 dx,dy=b[0]-a[0],b[1]-a[1];den=dx*dx+dy*dy
 t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/den)) if den else 0
 return (a[0]+dx*t,a[1]+dy*t),t

def intersection(a,b,c,d):
 rx,ry=b[0]-a[0],b[1]-a[1];sx,sy=d[0]-c[0],d[1]-c[1]
 den=rx*sy-ry*sx
 if abs(den)<1e-9:return None
 qx,qy=c[0]-a[0],c[1]-a[1];t=(qx*sy-qy*sx)/den;u=(qx*ry-qy*rx)/den
 if -1e-7<=t<=1+1e-7 and -1e-7<=u<=1+1e-7:return (a[0]+t*rx,a[1]+t*ry),t,u
 return None

def annotate_rail_structures(data):
 source_path=ROOT/'design/stomion/rail-structures.json'
 if not source_path.exists():return data
 structures=json.loads(source_path.read_text())
 def overlaps(edge,polygon):
  points=[(c[1],HEIGHT-c[0]) for c in edge['coordinates']]
  return not (max(p[0] for p in points)<min(p[0] for p in polygon) or min(p[0] for p in points)>max(p[0] for p in polygon) or max(p[1] for p in points)<min(p[1] for p in polygon) or min(p[1] for p in points)>max(p[1] for p in polygon))
 for edge in data['edges']:
  if edge['kind']!='rail':continue
  for field in ('travelOcclusions','travelCoverSources','travelBridgeIds'):
   edge.pop(field,None)
  covered=[s for s in structures['coveredPassages'] if overlaps(edge,s['footprint'])]
  bridges=[s['id'] for s in structures['railBridges'] if overlaps(edge,s['footprint'])]
  if covered:
   edge['travelOcclusions']=[[[HEIGHT-y,x] for x,y in s['footprint']] for s in covered]
   edge['travelCoverSources']=[s['id'] for s in covered]
  if bridges:edge['travelBridgeIds']=bridges
 data['metadata']['railStructureSource']='design/stomion/rail-structures.json'
 data['metadata']['railCoveredGeometry']='Continuous track interpolated between visible mouths beneath roofs and crossing decks. Cover polygons affect rendering, not routing or distance. Surface street crossings do not transfer to rail.'
 return data

def build(trace):
 roads=[]
 for line in trace.splitlines():
  if not line.strip() or line.lstrip().startswith('#'):continue
  name,kind,pts=line.split('|')
  coords=[tuple(map(float,p.split(','))) for p in pts.split()]
  roads.append({'id':re.sub('[^a-z0-9]+','-',name.lower()).strip('-'),'name':name,'kind':kind,'pixels':coords})
 # Snap road ends to near centerlines. Distinct crossing streets remain at the
 # hand-traced intersection, and no inferred connection can exceed 10 map pixels.
 for ri,r in enumerate(roads):
  if r['kind'] in ('bridge','ferry'):continue # preserve source-verified landings
  for e in (0,len(r['pixels'])-1):
   p=r['pixels'][e];best=None
   for si,s in enumerate(roads):
    if si==ri or (r['kind']=='rail') != (s['kind']=='rail'):continue
    for j,(a,b) in enumerate(zip(s['pixels'],s['pixels'][1:])):
     q,t=projection(p,a,b);dist=distance(p,q)
     if dist<=5 and (best is None or dist<best[0]):best=(dist,q,si,j)
   if best:r['pixels'][e]=best[1]
 segments=[]
 for ri,r in enumerate(roads):
  for j,(a,b) in enumerate(zip(r['pixels'],r['pixels'][1:])):
   if distance(a,b)<.001:continue
   segments.append({'ri':ri,'j':j,'a':a,'b':b,'split':[(0,a),(1,b)]})
 for i,s in enumerate(segments):
  for t in segments[i+1:]:
   if (roads[s['ri']]['kind']=='rail') != (roads[t['ri']]['kind']=='rail'):continue
   if s['ri']==t['ri'] and abs(s['j']-t['j'])<=1:continue
   v=intersection(s['a'],s['b'],t['a'],t['b'])
   if v:
    p,ts,tt=v;s['split'].append((ts,p));t['split'].append((tt,p))
 nodes=[];lookup={};edges=[]
 def node(p,layer):
  p=tuple(round(v*2,1) for v in p)
  key=(layer,*p)
  if key not in lookup:
   lookup[key]=f'stomion-{layer}-{len(nodes)+1:04d}'
   nodes.append({'id':lookup[key],'layer':layer,'coordinates':[round(HEIGHT-p[1],1),p[0]],'imageCoordinates':list(p)})
  return lookup[key]
 paths=collections.defaultdict(list)
 for s in segments:
  pts=[]
  for _,p in sorted(s['split']):
   if not pts or distance(pts[-1],p)>.01:pts.append(p)
  for a,b in zip(pts,pts[1:]):
   r=roads[s['ri']]
   layer='rail' if r['kind']=='rail' else 'street'
   na,nb=node(a,layer),node(b,layer)
   if na==nb:continue
   edge={'id':f"{r['id']}-{len(paths[s['ri']])+1:03d}",'streetId':r['id'],'name':r['name'],'kind':r['kind'],'from':na,'to':nb,'coordinates':[[round(HEIGHT-a[1]*2,1),round(a[0]*2,1)],[round(HEIGHT-b[1]*2,1),round(b[0]*2,1)]]}
   edges.append(edge);paths[s['ri']].append(edge)
 for i,r in enumerate(roads):
  r['coordinates']=[[round(HEIGHT-y*2,1),round(x*2,1)] for x,y in r.pop('pixels')]
  r['edgeIds']=[e['id'] for e in paths[i]]
  if r['kind']=='ferry':
   r['provenance']='Newly authored proposed boat access from a proposed dry-shore landing beside the eastern mill peninsula to the depicted river-islet landing; artwork depicts no ferry service, mainland pier, schedule or fare.'
   r['proposed']=True
  if r['name'].startswith('Shacks') and r['kind']=='bridge':
   r['provenance']='Source-visible narrow beige wooden deck or board bridge; walking centerline follows the depicted boards.'
 # Stable logical IDs preserve the source tracing identity. Display names are
 # separately authored readable addresses, independent of contour numbering.
 name_source=ROOT/'design/stomion/street-names.json'
 authored_names=json.loads(name_source.read_text()) if name_source.exists() else {}
 for r in roads:
  if r['id'] in authored_names:
   r['sourceTraceLabel']=r['name'];r['name']=authored_names[r['id']]
 for edge in edges:edge['name']=authored_names.get(edge['streetId'],edge['name'])
 data={'metadata':{'mapId':'The-Port-City-of-Stomion','sourceImage':'maps/The-Port-City-of-Stomion.webp','sourceWidth':WIDTH,'sourceHeight':HEIGHT,'coordinateSystem':'Leaflet [3072 - imageY, imageX] in original image pixels','provenance':'Hand-traced visible street and path centerlines from supplied map artwork. Street names newly authored for map addresses; no claim of prior lore canon.','scaleKilometers':13,'scalePixels':4080,'streetNamesAreNewlyAuthored':True,'railReview':RAIL_REVIEW,'railGradeSeparation':'Raised railway centerlines are a separate rail layer; geometric surface crossings do not connect.','fieldMarginPaths':'Narrow rural paths follow source-visible pale dirt approaches and unobstructed field margins where the artwork has no named road.','isletFerry':'The small river-islet structure has no depicted bridge. A ferry leg from a newly proposed dry-shore landing beside the eastern mill peninsula is authored as a navigation assumption. The mainland pier and ferry service are not depicted; no schedule is inferred.','proposedFerries':[{'streetId':r['id'],'name':r['name'],'provenance':r['provenance'],'fare':'unknown','schedule':'unknown'} for r in roads if r['kind']=='ferry'],'bridgeWalkways':'Bridge artwork does not resolve pedestrian sidewalks separately. Road bridge centerlines represent walking along the depicted bridge, assuming pedestrian access. Distances follow bridge geometry.'},'streets':roads,'nodes':nodes,'edges':edges}
 return annotate_rail_structures(data)

def write_overlay(data):
 im=Image.open(ROOT/'maps/The-Port-City-of-Stomion.webp').convert('RGB');d=ImageDraw.Draw(im)
 colors={'road':'#00ddff','lane':'#ffdc35','path':'#ed84ff','bridge':'#ff784f','rail':'#ff5065','ferry':'#54ff92'}
 for r in data['streets']:
  if r['kind']=='rail':continue
  pts=[(c[1],HEIGHT-c[0]) for c in r['coordinates']]
  d.line(pts,fill=colors[r['kind']],width=5 if r['kind']=='road' else 3)
 rail=Image.new('RGBA',im.size);draw=ImageDraw.Draw(rail)
 for edge in data['edges']:
  if edge['kind']=='rail':draw.line([(c[1],HEIGHT-c[0]) for c in edge['coordinates']],fill=colors['rail'],width=3)
 covered=Image.new('L',im.size,255);mask=ImageDraw.Draw(covered)
 for edge in data['edges']:
  for polygon in edge.get('travelOcclusions',[]):mask.polygon([(c[1],HEIGHT-c[0]) for c in polygon],fill=0)
 from PIL import ImageChops
 rail.putalpha(ImageChops.multiply(rail.getchannel('A'),covered))
 im.paste(rail,(0,0),rail);d=ImageDraw.Draw(im)
 for n in data['nodes']:
  x,y=n['imageCoordinates']
  if n.get('layer')=='rail' and not covered.getpixel((round(x),round(y))):continue
  d.ellipse((x-3,y-3,x+3,y+3),fill='white')
 im.save(ROOT/'design/stomion/streets-overlay.png')
 im.resize((2048,1536)).save(ROOT/'design/stomion/streets-overlay-half.png')

def report(data):
 adj=collections.defaultdict(set)
 for e in data['edges']:adj[e['from']].add(e['to']);adj[e['to']].add(e['from'])
 unseen=set(adj);components=[]
 while unseen:
  todo=[min(unseen)];seen=set()
  while todo:
   n=todo.pop()
   if n in seen:continue
   seen.add(n);todo.extend(adj[n]-seen)
  unseen-=seen;components.append(sorted(seen))
 components.sort(key=len,reverse=True)
 return {'streetCount':len(data['streets']),'nodeCount':len(data['nodes']),'edgeCount':len(data['edges']),'componentCount':len(components),'componentSizes':[len(x) for x in components],'components':components,'deadEnds':[n for n in adj if len(adj[n])==1]}

def replace_railways(data):
 """Apply the manual rail revision without rerunning pedestrian refinement."""
 raw=build(TRACE)
 def replace(items,new,is_rail):
  first=next((i for i,item in enumerate(items) if is_rail(item)),len(items))
  return items[:first]+new+[item for item in items[first:] if not is_rail(item)]
 for key in ('streets','edges','nodes'):
  is_rail=lambda item:item.get('layer' if key=='nodes' else 'kind')=='rail'
  data[key]=replace(data[key],[item for item in raw[key] if is_rail(item)],is_rail)
 data['metadata']['railReview']=RAIL_REVIEW
 for key in ('railStructureSource','railCoveredGeometry'):
  if key in raw['metadata']:data['metadata'][key]=raw['metadata'][key]
 return data

if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--rail-only',action='store_true',help='Revise rail geometry while preserving the current refined walking network.')
 args=parser.parse_args()
 data=replace_railways(json.loads((ROOT/'design/stomion/streets.json').read_text())) if args.rail_only else build(TRACE)
 (ROOT/'design/stomion/streets.json').write_text(json.dumps(data,indent=2)+'\n')
 write_overlay(data)
 qa=report(data)
 (ROOT/'design/stomion/streets-qa.json').write_text(json.dumps(qa,indent=2)+'\n')
 print(json.dumps({k:v for k,v in qa.items() if k not in ['components','deadEnds']},indent=2))
