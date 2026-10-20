import {createEngine} from '../shared/engine.mjs';
import {createWorld, routePlan, fetchWorld} from '../shared/world.mjs';
import {createFootRouter} from '../shared/routing.mjs';

const json = (body, status = 200) => Response.json(body, {status});
const requestResult = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const transactionDone = transaction => new Promise((resolve, reject) => {
  transaction.oncomplete = resolve;
  transaction.onabort = () => reject(transaction.error || Error('저장을 완료하지 못했습니다.'));
  transaction.onerror = () => {};
});

export async function createBrowserStore({
  fetcher = (...args) => fetch(...args),
  indexedDB = globalThis.indexedDB,
  clock = () => Date.now(),
  dbName = 'poketour-browser-v1',
  allowDebug = false,
  baseUrl = new URL('../', import.meta.url),
} = {}) {
  if (!indexedDB) throw Error('이 브라우저에서는 저장소를 사용할 수 없습니다. 일반 브라우저 창으로 열어 주세요.');
  const asset = async name => {
    const response = await fetcher(new URL(name, baseUrl));
    if (!response.ok) throw Error(name + ' 불러오기 실패');
    return response.json();
  };
  const [data, settings, seed, evidence] = await Promise.all(['pokemon-data.json', 'game-settings.json', 'world-seed.json', 'facility-evidence.json'].map(asset));
  const world = createWorld(seed, evidence);
  world.world.status = '기본 지도 준비됨 · 상세 경계 확인 전';
  const engine = createEngine(data, settings, world.world);
  const opening = indexedDB.open(dbName, 1);
  opening.onupgradeneeded = () => {
    const db = opening.result;
    db.createObjectStore('saves');
    db.createObjectStore('events', {keyPath:'id'});
    db.createObjectStore('cache');
  };
  opening.onblocked = () => {};
  const db = await requestResult(opening);
  db.onversionchange = () => db.close();
  let graphPromise;
  let worldPromise;
  const router = () => graphPromise ||= asset('foot-graph.json').then(createFootRouter).catch(error => { graphPromise = null; throw error; });
  const read = async (store, key) => {
    const transaction = db.transaction(store);
    return requestResult(transaction.objectStore(store).get(key));
  };
  const cachedWorld = await read('cache', 'world');
  if (cachedWorld) world.ingest(cachedWorld);
  const snapshot = async () => {
    const stored = await read('saves', 'current');
    const t = clock();
    return {state:engine.migrate(stored?.state || null, t, 196912), revision:stored?.revision || 0, serverNow:t, worldStatus:world.world.status};
  };
  const commit = async (state, expectedRevision) => {
    const transaction = db.transaction(['saves','events'], 'readwrite');
    const done = transactionDone(transaction);
    const saves = transaction.objectStore('saves');
    let conflict = false;
    saves.get('current').onsuccess = event => {
      const current = event.target.result;
      if ((current?.revision || 0) !== expectedRevision) { conflict = true; return; }
      const all = [...state.events, ...(state.newEvents || [])];
      delete state.newEvents;
      saves.put({state, revision:expectedRevision + 1}, 'current');
      for (const item of all) transaction.objectStore('events').put(item);
    };
    await done;
    return !conflict;
  };
  async function loadWorld() {
    if (cachedWorld) return world.world;
    if (!worldPromise) worldPromise = (async () => {
      try {
        const raw = await fetchWorld();
        world.ingest(raw);
        const transaction = db.transaction('cache', 'readwrite');
        const done = transactionDone(transaction);
        transaction.objectStore('cache').put(raw, 'world');
        await done;
      } catch (error) { world.world.status = '상세 경계 조회 실패 · 기본 지도 이용 가능'; }
      return world.world;
    })();
    return worldPromise;
  }
  return {
    async request(path, options = {}) {
      try {
        const url = new URL(path, 'https://poketour.invalid');
        const method = options.method || 'GET';
        if (url.pathname === '/api/world' && method === 'GET') return json(await loadWorld());
        if (url.pathname === '/api/events' && method === 'GET') {
          const before = Number(url.searchParams.get('before') || Number.MAX_SAFE_INTEGER);
          if (!Number.isSafeInteger(before) || before < 0) return json({error:'기록 페이지 오류'},400);
          const transaction = db.transaction('events');
          const rows = [];
          await new Promise((resolve, reject) => {
            const request = transaction.objectStore('events').openCursor(null, 'prev');
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const cursor = request.result;
              if (!cursor || rows.length === 51) return resolve();
              if (cursor.value.id < before) rows.push(cursor.value);
              cursor.continue();
            };
          });
          return json({events:rows.slice(0,50),nextBefore:rows.length>50?rows[49].id:null});
        }
        const current = await snapshot();
        if (url.pathname === '/api/state' && method === 'GET') return json(current);
        if (!['/api/action','/api/route'].includes(url.pathname)) return json({error:'없는 기능'},404);
        if (method !== 'POST') return json({error:'잘못된 요청'},405);
        if (typeof options.body !== 'string' || options.body.length > 16000) return json({error:'요청 크기 오류'},413);
        let input;
        try { input = JSON.parse(options.body); } catch { return json({error:'요청 형식 오류'},400); }
        if (!Number.isInteger(input.revision) || typeof input.requestId !== 'string' || input.requestId.length > 100) return json({error:'요청 번호 오류'},400);
        const {state, revision} = current;
        if (state.receipts?.includes(input.requestId)) return json({...current,replayed:true});
        if (input.revision !== revision && input.action !== 'sync') return json({...current,error:'다른 탭에서 저장이 변경되었습니다. 최신 상태를 확인하세요.'},409);
        const t = clock();
        engine.advance(state, t);
        const payload = input.payload || {};
        if (url.pathname === '/api/route') {
          if (state.pending) throw Error('이전 사건을 정산 중입니다. 잠시 후 다시 계산하세요.');
          if (!state.starter) throw Error('스타팅을 선택하세요.');
          let plan;
          if (payload.fieldWildId) {
            if (payload.mode !== 'walk') throw Error('야생 개체에게는 도보로 이동하세요.');
            const wild = state.fieldWilds.find(w => w.id === payload.fieldWildId && w.expiresAt > t);
            if (!wild) throw Error('대상이 이미 사라졌습니다.');
            plan = await routePlan(engine,state,{id:wild.id,name:data.species[wild.speciesId].name,coord:engine.fieldPosition(wild,t),fieldWildId:wild.id},'walk',await router());
            for (const old of state.fieldWilds) if (old.pursued && old.id !== wild.id) { old.pursued=false; old.moveUntil=t; }
            state.huntTargetId = wild.id;
            const coord = engine.fieldPosition(wild,t);
            Object.assign(wild,{coord,from:coord,to:coord,moveAt:t,moveUntil:0,pursued:true});
          } else plan = await routePlan(engine,state,payload.id,payload.mode,await router());
          state.routePlan = {...plan,token:crypto.randomUUID(),expiresAt:t+120000};
        } else if (input.action === 'start') {
          if (!state.routePlan || payload.token !== state.routePlan.token || t > state.routePlan.expiresAt) throw Error('경로를 다시 계산하세요.');
          engine.apply(state,'start',{plan:state.routePlan},t);
          delete state.routePlan;
        } else {
          if (input.action === 'debug-spawn' && !allowDebug) throw Error('배포 버전에서는 시험 출현을 사용할 수 없습니다.');
          engine.apply(state,input.action,payload,t);
        }
        state.receipts = [...(state.receipts || []),input.requestId].slice(-40);
        if (!await commit(state,revision)) return json({...await snapshot(),error:'다른 탭에서 저장이 변경되었습니다. 다시 시도하세요.'},409);
        return json({state,revision:revision+1,serverNow:clock(),plan:state.routePlan,worldStatus:world.world.status});
      } catch (error) { return json({error:error.message || '브라우저 저장을 처리하지 못했습니다.'},400); }
    },
    async backup() {
      const transaction = db.transaction(['saves','events']);
      const [stored,events] = await Promise.all([requestResult(transaction.objectStore('saves').get('current')),requestResult(transaction.objectStore('events').getAll())]);
      return {format:'poketour-backup-v1',exportedAt:clock(),state:engine.migrate(stored?.state || null,clock(),196912),events};
    },
    async restore(backup) {
      if (backup?.format !== 'poketour-backup-v1' || !backup.state || ![2,3,4,5].includes(backup.state.version)) throw Error('지원하지 않는 저장 파일입니다.');
      const state = engine.migrate(structuredClone(backup.state), clock());
      const owned = [...state.player.party,...state.box];
      if (!Number.isFinite(state.player.money) || state.player.money < 0 || state.player.party.length > 6 || owned.some(p=>!data.species[p.speciesId] || !p.uid || !Number.isFinite(p.hp)) || new Set(owned.map(p=>p.uid)).size !== owned.length || Object.values(state.bag).some(n=>!Number.isInteger(n)||n<0)) throw Error('저장 파일의 개체·재화 정보가 잘못되었습니다.');
      const events = backup.events || state.events;
      if (!Array.isArray(events) || events.length > 100000 || events.some(e=>!Number.isSafeInteger(e.id)||!Number.isFinite(e.at))) throw Error('저장 파일의 기록 정보가 잘못되었습니다.');
      const current = await snapshot();
      const transaction = db.transaction(['saves','events'],'readwrite');
      const done = transactionDone(transaction);
      let conflict = false;
      transaction.objectStore('saves').get('current').onsuccess = event => {
        if ((event.target.result?.revision || 0) !== current.revision) { conflict=true; return; }
        state.receipts=[];
        transaction.objectStore('saves').put({state,revision:current.revision+1},'current');
        const archive = transaction.objectStore('events'); archive.clear();
        for (const item of events) archive.put(item);
      };
      await done;
      if (conflict) throw Error('다른 탭에서 저장이 변경되었습니다. 다시 불러와 주세요.');
      return snapshot();
    },
    close: () => db.close(),
  };
}
