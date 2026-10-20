window.GameConfig={
  version:2,timeScale:1,parkMinimumAreaM2:30000,hospitalClasses:['종합병원','상급종합'],
  speedsKmh:{walk:4,ground:8,air:20,water:8},
  speedNote:'모든 속도는 게임 밸런스용 임시값. 도보는 실제 보행 경로 길이로 자체 추정하며 현실 시간과 1:1입니다.',
  gpsMaxAccuracyM:100,gpsMaxAgeMs:60000,maxRoadSnapM:100,
  routeEndpoint:'https://routing.openstreetmap.de/routed-foot/route/v1/foot/',
  mounts:{'test-ground':{name:'지상 테스트 탈것 (가상)',capabilities:['ground'],travelSpeedsKmh:{ground:8}},'test-air':{name:'공중 테스트 탈것 (가상)',capabilities:['air'],travelSpeedsKmh:{air:20}},'test-water':{name:'수상 테스트 탈것 (가상)',capabilities:['water'],travelSpeedsKmh:{water:8}}},
  schoolLevels:{elementary:{label:'초등학교',difficulty:1},middle:{label:'중학교',difficulty:2},high:{label:'고등학교',difficulty:3},university:{label:'대학교',difficulty:4}},
  waterNetworks:{nodes:[],edges:[],boardingPoints:[],verified:false},
  habitatContent:{default:{encounterWeight:2,spawnList:[]}},
  gymContent:{default:{leader:null,specialtyType:null,party:[],reward:null}},
  shopCatalog:[{category:'몬스터볼',name:'몬스터볼',price:null},{category:'회복 도구',name:'상처약',price:null},{category:'진화의 돌',name:'진화의 돌 목록 미정',price:null},{category:'기술머신',name:'기술머신 목록 미정',price:null}]
};
