import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecommendationController, recommendationWardrobe, validateRecommendationResponse, recommendationToOutfit} from './frontend-recommendations.js';
import {createRuleRecommendations} from './recommendation-rules.js';
const input = () => ({wardrobeRevision: 1, wardrobe: [{id: 'top', category: 'top', name: '합성 상의'}, {id: 'bottom', category: 'bottom'}, {id: 'shoe', category: 'shoe'}], profile: {}, context: {weatherMode: 'forecast'}, options: {}});
const result = payload => ({requestId: payload.requestId, wardrobeRevision: payload.wardrobeRevision, source: 'rules', selectedLookId: 'look-1', looks: [{candidateId: 'look-1', itemIds: ['top', 'bottom', 'shoe'], stylingTip: '합성 안내', reasons: ['색 계열 고려']}], warnings: [], diagnostics: {candidatesAfterFilter: 8}});
const response = data => ({ok: true, status: 200, json: async () => data});
const deferred = () => {let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve};};
test('추천 POST 계약을 지키고 미디어·분석만 재귀 제거하며 일반 속성은 보존한다', async () => {
  const request = input(); request.wardrobe[0] = {...request.wardrobe[0], photo: new Blob(['PRIVATE']), cutout: 'PRIVATE', capture: {location: 'PRIVATE'}, vision: {analysis: 'PRIVATE'}, material: '면', materialConfirmed: true, extra: {feature: 'preserved', vision: 'PRIVATE', attachment: new Blob(['PRIVATE'])}, nested: [{imageData: 'PRIVATE', scalar: 1}], thumbnail: 'data:image/png;base64,PRIVATE'};
  request.profile.photo = 'PRIVATE'; request.context.vision = 'PRIVATE';
  let count = 0;
  const controller = createRecommendationController({fetchImpl: async (url, options) => {
    count++; assert.equal(url, '/api/recommendations'); assert.equal(options.method, 'POST'); assert.equal(options.headers['Content-Type'], 'application/json');
    const payload = JSON.parse(options.body); assert.equal(payload.options.topK, 5); assert.equal(payload.wardrobe[0].material, '면'); assert.deepEqual(payload.wardrobe[0].extra, {feature: 'preserved'}); assert.deepEqual(payload.wardrobe[0].nested, [{scalar: 1}]); assert.doesNotMatch(options.body, /PRIVATE/);
    return response(result(payload));
  }});
  assert.equal((await controller.request(request)).status, 'ready'); assert.equal(count, 1);
  assert.ok(request.wardrobe[0].photo instanceof Blob); assert.equal(request.wardrobe[0].vision.analysis, 'PRIVATE');
});
test('동일 요청 중복 클릭은 진행 중 Promise와 단 한 요청을 재사용한다', async () => {
  const gate = deferred(); let count = 0, payload;
  const controller = createRecommendationController({fetchImpl: async (_, options) => {count++; payload = JSON.parse(options.body); await gate.promise; return response(result(payload));}});
  const first = controller.request(input()); const second = controller.request({...input(), requestId: 'ignored-new-id'});
  assert.equal(first, second); assert.equal(count, 1); gate.resolve(); assert.equal((await first).status, 'ready');
});
test('클라우드 인증값은 Bearer 헤더에만 들어가며 상태·본문에 저장하지 않는다', async () => {
  const states = [];
  const controller = createRecommendationController({getAccessToken: () => 'FAKE_TEST_TOKEN', onState: state => states.push(state), fetchImpl: async (_, options) => {
    assert.equal(options.headers.Authorization, 'Bearer FAKE_TEST_TOKEN'); assert.doesNotMatch(options.body, /FAKE_TEST_TOKEN/);
    return response(result(JSON.parse(options.body)));
  }});
  await controller.request(input()); assert.doesNotMatch(JSON.stringify(states), /FAKE_TEST_TOKEN/);
});
test('다른 요청을 시작하면 이전 요청을 취소하고 늦은 응답은 새 화면을 덮지 않는다', async () => {
  const gate = deferred(); const calls = [];
  const controller = createRecommendationController({fetchImpl: async (_, options) => {const payload = JSON.parse(options.body); calls.push(options); if (payload.wardrobeRevision === 1) await gate.promise; return response(result(payload));}});
  const first = controller.request(input()); const second = controller.request({...input(), wardrobeRevision: 2});
  assert.equal(calls[0].signal.aborted, true); assert.equal((await first).status, 'ignored'); assert.equal((await second).status, 'ready');
  gate.resolve(); await Promise.resolve(); assert.equal(controller.state.data.wardrobeRevision, 2);
});
test('옷장 변경 시 invalidate는 진행 요청과 이미 보인 추천을 즉시 폐기한다', async () => {
  const gate = deferred(); let signal;
  const controller = createRecommendationController({fetchImpl: async (_, options) => {signal = options.signal; const payload = JSON.parse(options.body); await gate.promise; return response(result(payload));}});
  const pending = controller.request(input()); controller.invalidate(); assert.equal(signal.aborted, true); assert.equal(controller.state.status, 'idle'); assert.equal(controller.state.data, null);
  assert.equal((await pending).status, 'ignored'); gate.resolve();
});
test('revision을 갱신하지 않은 실제 옷 속성 변경도 도착 시 검출한다', async () => {
  const gate = deferred(), request = input();
  const controller = createRecommendationController({getCurrentSnapshot: () => request, fetchImpl: async (_, options) => {const payload = JSON.parse(options.body); await gate.promise; return response(result(payload));}});
  const pending = controller.request(request); request.wardrobe[0].available = false; gate.resolve();
  assert.equal((await pending).status, 'ignored'); assert.equal(controller.state.status, 'idle');
});
test('사진만 바뀌고 추천 속성은 같으면 미디어 때문에 결과를 폐기하지 않는다', async () => {
  const request = input();
  const controller = createRecommendationController({getCurrentSnapshot: () => request, fetchImpl: async (_, options) => {request.wardrobe[0].photo = new Blob(['local']); return response(result(JSON.parse(options.body)));}});
  assert.equal((await controller.request(request)).status, 'ready');
});
test('제한시간은 AbortSignal을 무시하는 응답도 중단하며 자동 재시도하지 않는다', async () => {
  let count = 0, signal;
  const controller = createRecommendationController({timeoutMs: 8, fetchImpl: (_, options) => {count++; signal = options.signal; return new Promise(() => {});}});
  const out = await controller.request(input()); assert.equal(out.status, 'error'); assert.equal(out.error.code, 'timeout'); assert.equal(signal.aborted, true); assert.equal(count, 1);
});
test('이전 요청 실패는 새 요청의 성공 상태를 변경하지 않는다', async () => {
  const gate = deferred(); let count = 0;
  const controller = createRecommendationController({fetchImpl: async (_, options) => {if (++count === 1) {await gate.promise; throw new Error('late failure');} return response(result(JSON.parse(options.body)));}});
  const first = controller.request(input()); await controller.request({...input(), wardrobeRevision: 2}); gate.resolve(); await first;
  assert.equal(controller.state.status, 'ready'); assert.equal(controller.state.data.wardrobeRevision, 2);
});
for (const [label, fetchImpl, code] of [
  ['네트워크 실패', async () => {throw new Error('private upstream');}, 'network'],
  ['JSON 형식 실패', async () => ({ok: true, json: async () => {throw new Error('bad json');}}), 'invalid_response'],
  ['HTTP 실패', async () => ({ok: false, status: 503, json: async () => ({error: 'private upstream', code: 'RECOMMENDATION_BUSY'})}), 'RECOMMENDATION_BUSY'],
]) test(`${label}는 안전한 오류로 표시되고 이전 추천은 남지 않는다`, async () => {
  const controller = createRecommendationController({fetchImpl}); const out = await controller.request(input());
  assert.equal(out.status, 'error'); assert.equal(out.error.code, code); assert.doesNotMatch(out.error.message, /private/); assert.equal(controller.state.data, null);
});
test('요청·revision 불일치 및 존재하지 않는 선택·중복 옷 ID를 거부한다', () => {
  const request = {...input(), requestId: 'qa'};
  for (const mutate of [data => {data.requestId = 'old';}, data => {data.wardrobeRevision = 0;}, data => {data.selectedLookId = 'missing';}, data => {data.looks[0].itemIds.push('missing');}, data => {data.looks[0].itemIds.push('top');}, data => {data.looks.push({...data.looks[0]});}, data => {data.looks[0] = null;}]) {
    const data = result(request); mutate(data); assert.throws(() => validateRecommendationResponse(data, request));
  }
  assert.throws(() => validateRecommendationResponse(result(request), request, [...request.wardrobe, request.wardrobe[0]]));
  assert.throws(() => validateRecommendationResponse(result(request), request, request.wardrobe.map(item => ({...item, available: false}))));
});
test('서버 추천을 로컬 사진을 포함하는 실제 옷 참조에 연결하고 후보수를 보존한다', () => {
  const request = {...input(), requestId: 'qa'}; request.wardrobe[0].photo = new Blob(['LOCAL']);
  const out = recommendationToOutfit(result(request), request.wardrobe);
  assert.equal(out.outfit[0], request.wardrobe[0]); assert.equal(out.total, 8); assert.deepEqual(out.reasons, ['합성 안내', '색 계열 고려']);
  assert.deepEqual(recommendationWardrobe(request.wardrobe)[0], {id: 'top', category: 'top', name: '합성 상의'});
});
test('후보가 없는 정상 응답은 빈 결과로 표시하며 누락 정보를 보존한다', () => {
  const request = {...input(), requestId: 'qa'};
  const data = {...result(request), looks: [], selectedLookId: null, missing: ['신발'], warnings: ['추가해주세요.']};
  const out = recommendationToOutfit(data, request.wardrobe); assert.equal(out.outfit, null); assert.equal(out.total, 0); assert.deepEqual(out.missing, ['신발']); assert.deepEqual(out.notices, ['추가해주세요.']);
});
test('실제 규칙 엔진 응답의 편안함 설명·적격 후보수·누락 사유가 화면 결과까지 이어진다', () => {
  const wardrobe = [
    {id: 'top', name: '상의', category: 'top', itemType: '티셔츠', warmth: 1, formal: 0},
    {id: 'slacks', name: '슬랙스', category: 'bottom', itemType: '슬랙스', warmth: 1, formal: 0},
    {id: 'jeans', name: '진', category: 'bottom', itemType: '청바지', warmth: 1, formal: 0},
    {id: 'shoe', name: '신발', category: 'shoe', itemType: '운동화', formal: 0},
  ];
  const rules = createRuleRecommendations(wardrobe, {}, {formal: 0}, null, {modifier: 'comfort', referenceIds: ['top', 'slacks', 'shoe'], topK: 5});
  const data = {...rules, requestId: 'rules-qa', wardrobeRevision: 1};
  const out = recommendationToOutfit(data, wardrobe);
  assert.ok(out.comfortAdjustment); assert.deepEqual(out.comfortAdjustment, rules.legacyResult.comfortAdjustment);
  assert.equal(out.total, rules.legacyResult.total); assert.equal(out.signature, rules.legacyResult.signature);
  for (const notice of rules.legacyResult.notices) assert.ok(out.notices.includes(notice));
  const empty = {...createRuleRecommendations([], {}, {}, null), requestId: 'empty-qa', wardrobeRevision: 1};
  assert.deepEqual(recommendationToOutfit(empty, []).missing, ['상의', '하의', '신발']);
});
test('Gemini가 선택 순서를 바꾸면 다른 기존 후보의 경고·교체 설명을 붙이지 않는다', () => {
  const request = {...input(), requestId: 'qa'};
  const data = result(request); data.legacyResult = {outfit: [{id: 'different'}], notices: ['다른 후보 안내'], comfortAdjustment: {status: 'confirmed'}, signature: 'different', total: 9};
  const out = recommendationToOutfit(data, request.wardrobe);
  assert.equal(out.comfortAdjustment, undefined); assert.ok(!out.notices.includes('다른 후보 안내')); assert.notEqual(out.signature, 'different'); assert.equal(out.total, 9);
});
