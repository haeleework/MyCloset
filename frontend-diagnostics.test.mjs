import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderRecommendationDiagnostics } from './frontend-diagnostics.js';
import { emptyRecommendationResponse } from './recommendation-contract.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/recommendation-contract.json', import.meta.url), 'utf8'));
const response = () => structuredClone(fixture.response);
function field(html, label) {
  const start = html.indexOf(`<dt>${label}</dt><dd>`);
  assert.notEqual(start, -1, `Missing diagnostic field: ${label}`);
  return html.slice(start + `<dt>${label}</dt><dd>`.length).split('</dd>')[0];
}

test('shared contract fixture renders forecast, real candidate counts and selected color score', () => {
  const data = response();
  const snapshot = structuredClone(data);
  const html = renderRecommendationDiagnostics(data);
  assert.match(field(html, '자료 종류'), /^예보/);
  assert.equal(field(html, '최저 온도'), '18 °C');
  assert.equal(field(html, '최고 온도'), '22 °C');
  assert.equal(field(html, '습도'), '60 %');
  assert.equal(field(html, '저장된 날씨 재사용'), '재사용');
  assert.equal(field(html, '생성한 전체 후보'), '1개');
  assert.equal(field(html, '온도 등 조건 필터 통과'), '1개');
  assert.equal(field(html, '상위 후보 수'), '1개');
  assert.equal(field(html, '선택 후보 색 조합 점수'), '20점');
  assert.deepEqual(data, snapshot, 'Rendering must not mutate the server response');
});

test('null metrics stay unknown even when Gemini was not called', () => {
  const html = renderRecommendationDiagnostics(emptyRecommendationResponse());
  for (const label of ['최저 온도', '최고 온도', '습도', '발표 시각', '가져온 시각',
    '브라우저 요청 전체', '앱 서버 처리', '저장된 날씨 조회', '기상청 외부 요청', 'Gemini 요청',
    '입력 토큰', '출력 토큰', '생각 토큰', '총 토큰']) {
    assert.equal(field(html, label), '미확인', label);
  }
  assert.equal(field(html, '이번 추천 요청 호출'), '미호출');
  assert.equal(field(html, '생성한 전체 후보'), '0개', 'An explicitly reported zero remains zero');
  assert.equal(field(html, '기상청 외부 호출'), '외부 호출 여부 미확인');
  assert.doesNotMatch(html, /0 토큰|0 ms/);
});

test('observation values and original timestamps remain distinct from forecast and timing metrics', () => {
  const data = response();
  Object.assign(data.weather, { kind: 'observation', temperatureMin: -7.5, temperatureMax: 0, humidity: 0,
    issuedAt: '2026-10-08T09:00:00+09:00', fetchedAt: '2026-10-08T00:02:03Z', cached: false, stale: true });
  data.diagnostics.weatherProviderCalled = true;
  data.diagnostics.timingsMs = { server: 52.3, weatherCacheRead: 0, weatherProvider: 38.7, gemini: null };
  const html = renderRecommendationDiagnostics(data, { clientMs: 61.2 });
  assert.match(field(html, '자료 종류'), /^관측/);
  assert.equal(field(html, '최저 온도'), '-7.5 °C');
  assert.equal(field(html, '최고 온도'), '0 °C');
  assert.equal(field(html, '습도'), '0 %');
  assert.equal(field(html, '발표 시각'), '<time>2026-10-08T09:00:00+09:00</time>');
  assert.equal(field(html, '가져온 시각'), '<time>2026-10-08T00:02:03Z</time>');
  assert.equal(field(html, '오래된 자료 여부'), '오래된 자료');
  assert.equal(field(html, '브라우저 요청 전체'), '61.2 ms');
  assert.equal(field(html, '앱 서버 처리'), '52.3 ms');
  assert.equal(field(html, '저장된 날씨 조회'), '0 ms');
  assert.equal(field(html, '기상청 외부 요청'), '38.7 ms');
  assert.equal(field(html, '기상청 외부 호출'), '이번 요청에서 기상청 외부 호출함');
});

test('cached weather does not imply a provider call and absent provider duration is not fabricated', () => {
  const data = response();
  data.diagnostics.weatherProviderCalled = false;
  data.diagnostics.timingsMs.weatherCacheRead = 2.4;
  const html = renderRecommendationDiagnostics(data);
  assert.equal(field(html, '기상청 외부 호출'), '이번 요청에서 기상청 외부 호출 없음');
  assert.equal(field(html, '기상청 외부 요청'), '미확인');
  assert.equal(field(html, '저장된 날씨 조회'), '2.4 ms');
});

test('raw Gemini usage keeps output and thought tokens separate and does not calculate missing totals', () => {
  const data = response();
  data.diagnostics.gemini = { called: true, cached: false, model: 'synthetic-model',
    usage: { promptTokenCount: 123, candidatesTokenCount: 45, thoughtsTokenCount: 6, totalTokenCount: 174 } };
  let html = renderRecommendationDiagnostics(data);
  assert.equal(field(html, '이번 추천 요청 호출'), '호출함');
  assert.equal(field(html, '입력 토큰'), '123 토큰');
  assert.equal(field(html, '출력 토큰'), '45 토큰');
  assert.equal(field(html, '생각 토큰'), '6 토큰');
  assert.equal(field(html, '총 토큰'), '174 토큰');
  delete data.diagnostics.gemini.usage.totalTokenCount;
  html = renderRecommendationDiagnostics(data);
  assert.equal(field(html, '총 토큰'), '미확인');
});

test('normalized usage and result reuse are displayed without claiming a new charge', () => {
  const data = response();
  data.diagnostics.gemini = { called: false, cached: true, model: 'synthetic-model',
    usage: { inputTokens: 100, outputTokens: 20, thoughtsTokens: 0, totalTokens: 120 } };
  const html = renderRecommendationDiagnostics(data);
  assert.equal(field(html, '이번 추천 요청 호출'), '미호출');
  assert.equal(field(html, '이전 결과 재사용'), '재사용');
  assert.equal(field(html, '입력 토큰'), '100 토큰');
  assert.equal(field(html, '출력 토큰'), '20 토큰');
  assert.equal(field(html, '생각 토큰'), '0 토큰');
  assert.match(html, /이번 요청의 새 과금량을 뜻하지 않습니다/);
});

test('selected candidate score, signed reasons, exclusions and all returned candidates are inspectable', () => {
  const data = response();
  data.looks.push({ candidateId: 'look-second', scores: { color: -15, total: 12.5 },
    scoreReasons: [{ reason: '색 대비 감점', delta: -15 }, { description: '단정함', points: 5 }] });
  data.selectedLookId = 'look-second';
  Object.assign(data.diagnostics, { candidatesGenerated: 8, candidatesAfterFilter: 3, topKCount: 2,
    excludedCounts: { warmth: 3, unavailable: 2, future_reason: 1 } });
  const html = renderRecommendationDiagnostics(data);
  assert.equal(field(html, '선택 후보 색 조합 점수'), '-15점');
  assert.equal(field(html, '선택 후보 종합 점수'), '12.5점');
  assert.match(html, /색 대비 감점 \(-15점\)/);
  assert.match(html, /단정함 \(5점\)/);
  assert.match(html, /보온 조건: 3개/);
  assert.match(html, /착용 불가: 2개/);
  assert.match(html, /future_reason: 1개/);
  assert.match(html, /반환 후보 2개 점수 보기/);
  assert.match(html, /look-fixture/);
});

test('missing selected ID never borrows a score from an unselected or malformed look', () => {
  for (const selectedLookId of [null, undefined, '', 'missing']) {
    const data = response();
    data.selectedLookId = selectedLookId;
    data.looks.push({ scores: { color: 999, total: 999 } });
    const html = renderRecommendationDiagnostics(data);
    assert.match(html, /선택 후보의 점수: 미확인/);
    assert.doesNotMatch(html, /<dt>선택 후보 색 조합 점수<\/dt>/);
  }
});

test('malformed measurements do not become zero or valid-looking counts', () => {
  const data = response();
  data.weather = { kind: 'other', cached: 'false', humidity: NaN, stale: 0 };
  data.diagnostics = { candidatesGenerated: -1, candidatesAfterFilter: 1.2, topKCount: '5',
    timingsMs: { server: Infinity, weatherCacheRead: '0', weatherProvider: -2 },
    gemini: { called: 'false', cached: 1, usage: { inputTokens: -1, outputTokens: 0.5, totalTokens: '12' } } };
  const html = renderRecommendationDiagnostics(data, { clientMs: -2 });
  for (const label of ['자료 종류', '습도', '저장된 날씨 재사용', '오래된 자료 여부', '생성한 전체 후보',
    '온도 등 조건 필터 통과', '상위 후보 수', '앱 서버 처리', '저장된 날씨 조회', '기상청 외부 요청',
    '브라우저 요청 전체', '이번 추천 요청 호출', '이전 결과 재사용', '입력 토큰', '출력 토큰', '총 토큰']) {
    assert.equal(field(html, label), '미확인', label);
  }
  for (const input of [undefined, null, [], 'invalid', { looks: [null, false], diagnostics: [] }]) {
    assert.doesNotThrow(() => renderRecommendationDiagnostics(input));
  }
});

test('all server-supplied text is escaped before insertion as HTML', () => {
  const data = response();
  const attack = '<img src=x onerror="alert(1)"> & \'text\'';
  data.requestId = attack;
  data.wardrobeRevision = attack;
  data.selectedLookId = attack;
  data.weather.issuedAt = attack;
  data.weather.fetchedAt = attack;
  data.diagnostics.gemini.model = attack;
  data.diagnostics.excludedCounts = { [attack]: 1, constructor: 2 };
  data.looks = [{ candidateId: attack, scores: { color: 0 }, scoreReasons: [{ reason: attack, score: 1 }] }];
  data.warnings = [attack, { message: attack }];
  const html = renderRecommendationDiagnostics(data);
  assert.doesNotMatch(html, /<img|<script|function Object/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; &#39;text&#39;/);
  assert.match(html, /constructor: 2개/);
  assert.match(html, /관리자 인증이나 접근 권한을 부여하지 않습니다/);
});

test('server search caps and current exclusion codes are explained without claiming exhaustive search', () => {
  const data = response();
  data.diagnostics.search = {totalCombinations:200000,limitReached:true};
  data.diagnostics.excludedCounts = {invalid_item:1,hot_heavy:4,cold_light:2,required_formality:3};
  const html = renderRecommendationDiagnostics(data);
  assert.equal(field(html,'가능한 전체 조합'),'200000개');
  assert.equal(field(html,'탐색 한도 도달'),'일부 조합만 탐색');
  assert.match(html,/잘못된 옷 정보: 1개/);
  assert.match(html,/더운 시간대의 두꺼운 옷: 4개/);
  assert.match(html,/추운 시간대의 보온 부족: 2개/);
  assert.match(html,/일정의 필수 격식 조건: 3개/);
  assert.match(html,/합계가 제외된 조합 수와 같지는 않습니다/);
});
