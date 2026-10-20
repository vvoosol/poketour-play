(function(root){
 'use strict';
 const cfg=root.GameConfig;
 const distance=(a,b)=>{const r=Math.PI/180,dLat=(b[1]-a[1])*r,dLon=(b[0]-a[0])*r,h=Math.sin(dLat/2)**2+Math.cos(a[1]*r)*Math.cos(b[1]*r)*Math.sin(dLon/2)**2;return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));};
 function schoolGrade(name,amenity){if(amenity==='university')return 'university';if(/초등학교|초등교/.test(name)&&!/중학교|초중/.test(name))return 'elementary';if(/중학교/.test(name)&&!/고등|중·고|중고/.test(name))return 'middle';if(/고등학교/.test(name)&&!/중고|중·고/.test(name))return 'high';return null;}
 const canonical=name=>name.replace(/^서울/,'').replace(/\s/g,'').replace(/초등교$/,'초등학교');
 function facilities(data,evidence,inside){const out=[],seen=new Set();for(const e of data.elements){const t=e.tags||{},name=t['name:ko']||t.name,pos=e.center||e;if(!name||!Number.isFinite(pos.lon)||!inside([pos.lon,pos.lat]))continue;let type,grade=null;
  if(['school','university'].includes(t.amenity)){type='school';grade=schoolGrade(name,t.amenity);if(!grade&&/초중|중고|중·고|초등학교\/중학교/.test(name))continue;}
  else if(t.natural==='water')type='water';else continue;
  const key=type+':'+canonical(name);if(seen.has(key))continue;seen.add(key);out.push({id:`${type}-${canonical(name)}`,name,type,coord:[pos.lon,pos.lat],grade,source:'https://www.openstreetmap.org/copyright',sourceNote:'OSM 2026-09-27 지도 등록 정보. 학교급은 이름·태그 기반이며 미확인은 난이도 미정',real:true});
 }
 for(const p of evidence.parks)if(Number.isFinite(p.areaM2)&&p.areaM2>=cfg.parkMinimumAreaM2&&inside(p.coord))out.push({...p,type:'park',source:p.source||evidence.parksSource,real:true});
 for(const p of evidence.hospitals)if(cfg.hospitalClasses.includes(p.classification)&&inside(p.coord))out.push({...p,type:'hospital',real:true});
 for(const p of evidence.shops)if(['백화점','쇼핑센터','복합쇼핑몰'].includes(p.classification)&&inside(p.coord))out.push({...p,type:'shop',real:true});return out;
 }
 function blank(){return {version:2,mode:null,game:null,travel:null,activity:null,player:{party:[],mounts:[],money:0,progress:{}},lastArrivalId:null};}
 function pointAlong(coords,fraction){if(!coords?.length)throw Error('경로 없음');const f=Math.min(1,Math.max(0,fraction));let total=0;const lengths=coords.slice(1).map((c,i)=>{const d=distance(coords[i],c);total+=d;return d;});let remaining=total*f;for(let i=0;i<lengths.length;i++){if(remaining<=lengths[i]&&lengths[i]>0){const r=remaining/lengths[i];return coords[i].map((v,j)=>v+(coords[i+1][j]-v)*r);}remaining-=lengths[i];}return coords.at(-1).slice();}
 function tick(s,now){if(!s.travel)return false;const t=s.travel,p=Math.min(1,Math.max(0,(now-t.departAt)/(t.arriveAt-t.departAt)));s.game={coord:pointAlong(t.geometry,p),placeId:null};if(now<t.arriveAt)return false;s.game={coord:t.geometry.at(-1).slice(),placeId:t.destinationId};s.lastArrivalId=t.id;s.travel=null;return true;}
 function start(s,plan,now,id){if(!s.game||s.travel||s.activity)throw Error('현재 상태에서는 출발할 수 없습니다.');if(!plan||!Number.isFinite(plan.durationMs)||plan.durationMs<=0)throw Error('유효한 경로가 필요합니다.');if(distance(s.game.coord,plan.origin)>1)throw Error('출발 위치가 바뀌었습니다. 경로를 다시 확인하세요.');s.travel={...plan,id,departAt:now,arriveAt:now+plan.durationMs};s.game.placeId=null;return s.travel;}
 function cancel(s,now){tick(s,now);if(s.travel){s.game={coord:pointAlong(s.travel.geometry,(now-s.travel.departAt)/(s.travel.arriveAt-s.travel.departAt)),placeId:null};s.travel=null;}}
 function gpsUsable(g,now,inside){return !!g&&Number.isFinite(g.accuracy)&&g.accuracy<=cfg.gpsMaxAccuracyM&&now-g.timestamp>=-5000&&now-g.timestamp<=cfg.gpsMaxAgeMs&&inside(g.coord);}
 function join(s,g,now,inside){if(s.activity)throw Error('활동을 완료하거나 닫은 뒤 합류하세요.');if(!gpsUsable(g,now,inside))throw Error('송파구 안의 최신 GPS 위치(오차 100m 이하)를 확인해 주세요.');s.travel=null;s.game={coord:g.coord.slice(),placeId:null};s.mode='gps';s.player.mounts=s.player.mounts.filter(id=>!id.startsWith('test-'));s.player.party=s.player.party.filter(p=>!p.testOnly);}
 function canUse(s,id){return !!s.game&&!s.travel&&s.game.placeId===id;}
 function heal(s,id){if(!canUse(s,id))throw Error('도착한 센터에서만 치료할 수 있습니다.');for(const p of s.player.party){p.hp=p.maxHp;p.status=null;p.fainted=false;}s.activity=null;}
 function mountFor(s,mode){return s.player.mounts.map(id=>cfg.mounts[id]).find(m=>m?.capabilities.includes(mode));}
 function modeAllowed(s,mode){return mode==='walk'||!!mountFor(s,mode);}
 function airPlan(origin,dest,speed=cfg.speedsKmh.air){const meters=distance(origin,dest.coord);return {origin:origin.slice(),destinationId:dest.id,mode:'air',geometry:[origin.slice(),dest.coord.slice()],distanceM:meters,durationMs:Math.max(1000,Math.ceil(meters/(speed/3.6)*1000)),estimate:`공중 가상 경로 · 자체 추정 시간 · 임시 속도 ${speed}km/h`,endpointNote:'공중 이동은 게임 규칙이며 실제 비행 허가·안전 경로가 아닙니다.'};}
 function landPlan(origin,dest,response,mode,speed=cfg.speedsKmh[mode]){if(response.code!=='Ok'||!response.routes?.length)throw Error('보행 경로 산정 불가. 직선 이동으로 대체하지 않습니다.');const r=response.routes[0],coords=r.geometry?.coordinates;if(!coords||coords.length<2||!Number.isFinite(r.distance)||r.distance<0||!response.waypoints?.length)throw Error('보행 경로 응답이 올바르지 않습니다.');if(response.waypoints.some(w=>w.distance>cfg.maxRoadSnapM))throw Error('시설 또는 출발점이 보행로에서 100m 이상 떨어져 있습니다. 다른 접근 지점을 선택하세요.');
  const startGap=distance(origin,coords[0]),endGap=distance(dest.coord,coords.at(-1));
  // Only tolerate <=20m coordinate alignment, disclosed explicitly. Larger
  // access gaps are not disguised as a pedestrian route.
  if(startGap>20)throw Error('현재 게임 위치에서 보행로까지 20m 이상 차이가 나며 접근 경로가 없습니다. 정확한 GPS 위치를 다시 확인하거나 체험 출발점을 이용하세요.');
  const accessMs=Math.ceil(startGap/(cfg.speedsKmh.walk/3.6)*1000);
  return {origin:origin.slice(),destinationId:dest.id,mode,geometry:[origin.slice(),...coords.map(c=>c.slice())],startSnapM:startGap,distanceM:r.distance+startGap,durationMs:Math.max(1000,accessMs+Math.ceil(r.distance/(speed/3.6)*1000)),estimate:`OSM 보행 경로 · 자체 추정 시간 · 임시 속도 ${speed}km/h`,endpointNote:`출발 좌표→보행로 ${Math.round(startGap)}m는 위치 정합 연결 추정(20m 초과는 이동 불가). 도착은 시설 근처 보행로 지점이며 시설 좌표와 ${Math.round(endGap)}m 차이. 실제 내비게이션이 아닙니다.`};
 }
 root.GameCore={distance,schoolGrade,facilities,blank,pointAlong,tick,start,cancel,gpsUsable,join,canUse,heal,mountFor,modeAllowed,airPlan,landPlan};
})(typeof window==='undefined'?globalThis:window);
