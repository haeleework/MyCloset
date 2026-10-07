import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createAppServer} from './app-server.mjs';
import {createRecommendationService} from './recommendation-service.mjs';
import {createGeminiRecommender} from './recommendation-gemini.mjs';
import {createRecommendationController, recommendationToOutfit} from './frontend-recommendations.js';
import {renderRecommendationDiagnostics} from './frontend-diagnostics.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const closet = () => [
  {id: 'qa-top-a', category: 'top', name: '합성 검정 티셔츠', itemType: '티셔츠', color: '검정', warmth: 1, formal: 0, available: true},
  {id: 'qa-top-b', category: 'top', name: '합성 흰색 티셔츠', itemType: '티셔츠', color: '흰색', warmth: 1, formal: 0, available: true},
  {id: 'qa-slacks', category: 'bottom', name: '합성 슬랙스', itemType: '슬랙스', color: '검정', warmth: 1, formal: 0, available: true},
  {id: 'qa-jeans', category: 'bottom', name: '합성 진', itemType: '청바지', color: '회색', warmth: 1, formal: 0, available: true},
  {id: 'qa-shoe', category: 'shoe', name: '합성 운동화', itemType: '운동화', color: '흰색', formal: 0, comfort: true, available: true},
];
const request = wardrobe => ({wardrobeRevision: 'qa:1', wardrobe: wardrobe ?? closet(), profile: {}, context: {formal: 0, locationIds: ['seoul'], date: '2026-10-08'}, options: {topK: 5, skip: 0}});
const syntheticWeather = () => ({weather: {kind: 'forecast', min: 20, max: 24, humidity: 60, rain: 80, snow: false, hourly: [{hour: 12, temp: 24, rain: 80, pty: 1}], fetchedAt: '2026-10-08T03:00:00Z', issuedAt: '2026-10-08T02:00:00Z', cached: true, stale: false}, timingsMs: {weatherCacheRead: 2, weatherProvider: null}, warnings: []});

test('v22 실제 HTTP 서버와 프론트 모듈 통합 — 외부 네트워크 없이 검증', {timeout: 15000}, async t => {
  const rawFetch = globalThis.fetch, origins = new Set();
  let blockedExternal = 0;
  // Every fetch in this test process is constrained to an ephemeral test server.
  t.mock.method(globalThis, 'fetch', (input, options) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (!origins.has(url.origin) || url.hostname !== '127.0.0.1') {
      blockedExternal++;
      throw new Error('외부 네트워크 호출 차단');
    }
    return rawFetch(input, {...options, redirect: 'error'});
  });
  async function setup(subtest, dependencies = {}) {
    const service = createRecommendationService({weatherProvider: async () => syntheticWeather(), ...dependencies});
    const server = createAppServer({root, store: {}, recommendations: service, readConfig: async () => {}, settings: () => ({keyPresent: false, provider: 'data', geminiEnabled: false}), kick: () => {throw new Error('예보 외부 수집 금지');}});
    await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
    const origin = `http://127.0.0.1:${server.address().port}`;
    origins.add(origin);
    subtest.after(async () => {server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); origins.delete(origin);});
    const bodies = [];
    const fetchImpl = (url, options = {}) => {
      if (options.body) bodies.push(JSON.parse(options.body));
      return fetch(new URL(url, origin), {...options, headers: {...options.headers, Origin: origin}});
    };
    return {origin, fetchImpl, bodies};
  }

  await t.test('앱과 모든 브라우저 import·새 프론트 모듈을 실제 정적 경로에서 제공한다', async st => {
    const {origin} = await setup(st);
    const pending = ['/app.js', '/frontend-storage.js', '/frontend-recommendations.js', '/frontend-garment-fields.js', '/frontend-diagnostics.js', '/recommendation-contract.js'], checked = new Set();
    while (pending.length) {
      const route = pending.pop(); if (checked.has(route)) continue; checked.add(route);
      const response = await fetch(origin + route);
      assert.equal(response.status, 200, route); assert.match(response.headers.get('content-type'), /javascript/);
      const source = await response.text();
      for (const match of source.matchAll(/(?:from\s*|import\s*)['"](\.\/[^'"]+\.js)['"]/g)) pending.push('/' + match[1].slice(2));
    }
    assert.ok(checked.size >= 18); assert.ok(checked.has('/frontend-storage.js'));
    for (const route of ['/', '/styles.css', '/favicon.svg', '/node_modules/exifr/dist/full.umd.js']) assert.equal((await fetch(origin + route)).status, 200, route);
    for (const route of ['/server.mjs', '/recommendation-service.mjs', '/.env']) assert.equal((await fetch(origin + route)).status, 404, route);
  });

  await t.test('HTTP→추천 controller→로컬 사진 연결→진단까지 실제 계약이 이어진다', async st => {
    let fakeProviderCalls = 0, reserved = 0, finished = 0;
    const gemini = createGeminiRecommender({enabled: true, allowNetwork: false, budget: {reserve: async () => `fake-${++reserved}`, finish: async () => {finished++;}}, callProvider: async ({body}) => {
      fakeProviderCalls++;
      const data = JSON.parse(body.contents[0].parts[0].text);
      assert.doesNotMatch(JSON.stringify(data), /PRIVATE_PHOTO|PRIVATE_VISION/);
      return {text: JSON.stringify({recommendations: [...data.candidates].reverse().map(candidate => ({candidateId: candidate.candidateId, tip: '가상 제공자가 돌려준 시험용 코디 설명'}))}), usageMetadata: {promptTokenCount: 123, candidatesTokenCount: 45, thoughtsTokenCount: 6, totalTokenCount: 174}};
    }});
    const {fetchImpl, bodies} = await setup(st, {gemini});
    const wardrobe = closet(); wardrobe[0].photo = new Blob(['PRIVATE_PHOTO']); wardrobe[0].vision = {analysis: 'PRIVATE_VISION'};
    const controller = createRecommendationController({fetchImpl});
    const first = await controller.request(request(wardrobe)); assert.equal(first.status, 'ready'); assert.equal(first.data.source, 'gemini');
    assert.equal(fakeProviderCalls, 1); assert.equal(reserved, 1); assert.equal(finished, 1);
    assert.doesNotMatch(JSON.stringify(bodies), /PRIVATE_PHOTO|PRIVATE_VISION/);
    const outfit = recommendationToOutfit(first.data, wardrobe);
    assert.ok(outfit.outfit.every(item => wardrobe.includes(item))); assert.equal(outfit.total, first.data.validCandidateCount);
    assert.equal(outfit.reasons[0], '가상 제공자가 돌려준 시험용 코디 설명');
    const html = renderRecommendationDiagnostics(first.data, {clientMs: first.elapsedMs});
    for (const text of ['123 토큰', '45 토큰', '6 토큰', '174 토큰', '60 %', '20 °C', '24 °C', '예보 (앞으로의 예상)', '색 조합 점수']) assert.ok(html.includes(text), text);
    assert.match(html, /기상청 외부 요청<\/dt><dd>미확인/);
    // Same input can be requested after completion, but the backend reuses its fake result.
    const cached = await controller.request(request(wardrobe)); assert.equal(cached.status, 'ready'); assert.equal(fakeProviderCalls, 1);
    assert.equal(cached.data.diagnostics.gemini.called, false); assert.equal(cached.data.diagnostics.gemini.cached, true);
  });

  await t.test('검증을 통과하지 못한 가짜 AI 선택은 HTTP 성공 규칙 추천으로 돌아온다', async st => {
    const {fetchImpl} = await setup(st, {gemini: {recommend: async () => ({source: 'gemini', looks: [{candidateId: 'injected-unknown'}], gemini: {attempted: false}})}});
    const result = await createRecommendationController({fetchImpl}).request(request());
    assert.equal(result.status, 'ready'); assert.equal(result.data.source, 'rules'); assert.ok(result.data.warnings.some(text => text.includes('검증')));
    assert.ok(recommendationToOutfit(result.data, closet()).outfit.every(item => item.id.startsWith('qa-')));
  });

  await t.test('실제 서버 형식 오류와 같은 출처 제한이 프론트 오류로 전달된다', async st => {
    const {origin, fetchImpl} = await setup(st);
    const wardrobe = closet(); wardrobe.push({...wardrobe[0]});
    const result = await createRecommendationController({fetchImpl}).request(request(wardrobe));
    assert.equal(result.status, 'error'); assert.equal(result.error.code, 'INVALID_WARDROBE');
    const denied = await fetch(origin + '/api/recommendations', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'});
    assert.equal(denied.status, 403);
  });

  await t.test('후보 없음·습도 모름은 누락 안내와 미확인으로 보존된다', async st => {
    const {fetchImpl} = await setup(st, {weatherProvider: async () => ({weather: null, warnings: ['시험용 날씨 미확인']})});
    const result = await createRecommendationController({fetchImpl}).request(request([]));
    assert.equal(result.status, 'ready'); const converted = recommendationToOutfit(result.data, []);
    assert.equal(converted.outfit, null); assert.deepEqual(converted.missing, ['상의', '하의', '신발']); assert.equal(converted.total, 0);
    const html = renderRecommendationDiagnostics(result.data);
    assert.match(html, /습도<\/dt><dd>미확인/); assert.match(html, /입력 토큰<\/dt><dd>미확인/);
  });

  await t.test('한 종류 편안함 교체 정보와 후보수가 HTTP 후에도 유지된다', async st => {
    const {fetchImpl} = await setup(st, {weatherProvider: async () => ({weather: null})});
    const wardrobe = closet().filter(item => item.id !== 'qa-top-b'), referenceIds = ['qa-top-a', 'qa-slacks', 'qa-shoe'];
    const result = await createRecommendationController({fetchImpl}).request({...request(wardrobe), options: {modifier: 'comfort', referenceIds}});
    assert.equal(result.status, 'ready'); const converted = recommendationToOutfit(result.data, wardrobe);
    assert.ok(converted.comfortAdjustment); assert.equal(converted.comfortAdjustment.changedCategories.length, 1);
    assert.equal(converted.outfit.filter(item => !referenceIds.includes(item.id)).length, 1); assert.ok(converted.outfit.some(item => item.id === 'qa-jeans'));
    assert.equal(converted.total, result.data.validCandidateCount);
  });

  await t.test('실제 HTTP 대기 중 옷장이 바뀌면 늦게 온 추천을 버린다', async st => {
    let release, started;
    const gate = new Promise(resolve => {release = resolve;}), reached = new Promise(resolve => {started = resolve;});
    st.after(() => release());
    const {fetchImpl} = await setup(st, {weatherProvider: async () => {started(); await gate; return syntheticWeather();}});
    const input = request();
    const controller = createRecommendationController({fetchImpl, getCurrentSnapshot: () => input});
    const pending = controller.request(input); await reached;
    input.wardrobe[0].available = false; input.wardrobeRevision = 'qa:2'; release();
    assert.equal((await pending).status, 'ignored'); assert.equal(controller.state.data, null);
  });

  await t.test('클라우드 모드의 Bearer와 소유 옷 확인을 실제 HTTP 서버까지 전달한다', async st => {
    const wardrobe = closet(); let resolved = 0;
    const repository = {resolveGarments: async ({accessToken, garmentIds}) => {assert.equal(accessToken, 'FAKE_AUTH_ONLY'); assert.deepEqual(garmentIds, wardrobe.map(item => item.id)); resolved++; return {user: {id: 'qa-owner'}, wardrobe};}};
    const {fetchImpl, bodies} = await setup(st, {mode: 'supabase', repository});
    const controller = createRecommendationController({fetchImpl, getAccessToken: () => 'FAKE_AUTH_ONLY'});
    const result = await controller.request(request(wardrobe)); assert.equal(result.status, 'ready'); assert.equal(resolved, 1);
    assert.equal(result.data.diagnostics.storage.ownershipVerified, true); assert.doesNotMatch(JSON.stringify(bodies), /FAKE_AUTH_ONLY/);
    const anonymous = await createRecommendationController({fetchImpl}).request(request(wardrobe));
    assert.equal(anonymous.status, 'error'); assert.equal(anonymous.error.code, 'AUTH_REQUIRED');
  });

  assert.equal(blockedExternal, 0, '시험 중 외부 네트워크 시도가 없어야 합니다.');
});
