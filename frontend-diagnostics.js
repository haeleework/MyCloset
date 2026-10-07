// Display only reported measurements. This module never calls external services.
const UNKNOWN = '미확인';
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const record = value => isRecord(value) ? value : {};
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const text = value => (typeof value === 'string' && value.trim()) || (typeof value === 'number' && Number.isFinite(value)) ? escape(value) : UNKNOWN;
const number = (value, unit = '', { negative = false } = {}) => typeof value === 'number' && Number.isFinite(value) && (negative || value >= 0) ? `${escape(value)}${unit}` : UNKNOWN;
const count = (value, unit) => Number.isSafeInteger(value) && value >= 0 ? number(value, unit) : UNKNOWN;
const boolean = (value, yes, no) => value === true ? yes : value === false ? no : UNKNOWN;
const field = (label, value) => `<div class="diagnostic-field"><dt>${escape(label)}</dt><dd>${value}</dd></div>`;
const section = (title, content) => `<section class="diagnostic-block"><h4>${escape(title)}</h4>${content}</section>`;
const list = rows => rows.length ? `<ul class="diagnostic-list">${rows.map(row => `<li>${row}</li>`).join('')}</ul>` : `<p>${UNKNOWN}</p>`;
const firstValue = (source, keys) => {
  for (const key of keys) if (source[key] !== null && source[key] !== undefined) return source[key];
  return null;
};
const time = value => {
  if (typeof value !== 'string' || !value.trim()) return UNKNOWN;
  // Keep the reported timezone and precision; formatting must not invent either.
  return `<time>${escape(value)}</time>`;
};
const exclusionLabels = {
  comfort_no_improvement: '편안함 개선 없음', comfort_condition:'편안함 변경 시 필수 조건 유지', formal_no_progress:'격식 개선 없음',
  temperature: '온도 조건', warmth: '보온 조건',
  weather: '날씨 조건', formality: '일정 격식', formal: '일정 격식',
  unavailable: '착용 불가', duplicate: '중복', missing: '필수 옷 없음',
  comfort: '착용감 조건', unknown: '정보 미확인', required: '필수 옷 조건',
  history: '이전 추천', invalid: '잘못된 옷 정보', budget: '사용 예산',
  invalid_item: '잘못된 옷 정보', duplicate_item: '중복된 옷', unavailable_item: '착용 불가 또는 구매 후보',
  required_item: '필수로 지정한 옷 조건', required_formality: '일정의 필수 격식 조건', office_slippers:'출근에 맞지 않는 슬리퍼', office_sportswear:'출근에 맞지 않는 운동복',
  hot_heavy: '더운 시간대의 두꺼운 옷', cold_light: '추운 시간대의 보온 부족',
  comfort_one_category: '한 종류만 바꾸는 조건', comfort_not_improved: '편안함 개선 없음',
  formal_no_progress: '단정함 개선 없음', already_shown: '이미 본 조합',
};

function reasonText(reason) {
  if (typeof reason === 'string' || typeof reason === 'number') return text(reason);
  if (!isRecord(reason)) return UNKNOWN;
  const description = firstValue(reason, ['reason', 'message', 'description', 'label', 'text', 'code']);
  const score = firstValue(reason, ['score', 'points', 'delta', 'value']);
  return `${text(description)}${typeof score === 'number' && Number.isFinite(score) ? ` (${number(score, '점', { negative: true })})` : ''}`;
}

function reasons(value) {
  if (Array.isArray(value)) return list(value.map(reasonText));
  if (isRecord(value)) return list(Object.entries(value).map(([key, reason]) => {
    if (Array.isArray(reason)) return `${text(key)}: ${reason.map(reasonText).join(' · ') || UNKNOWN}`;
    return `${text(key)}: ${reasonText(reason)}`;
  }));
  return `<p>${reasonText(value)}</p>`;
}

/** Render the server recommendation contract without changing it or guessing metrics. */
export function renderRecommendationDiagnostics(response, { clientMs } = {}) {
  const result = record(response);
  const weather = record(result.weather);
  const diagnostics = record(result.diagnostics);
  const timings = record(diagnostics.timingsMs);
  const gemini = record(diagnostics.gemini);
  const usage = record(gemini.usage);
  const looks = Array.isArray(result.looks) ? result.looks.filter(isRecord) : [];
  const selected = typeof result.selectedLookId === 'string' && result.selectedLookId.trim()
    ? looks.find(look => look.candidateId === result.selectedLookId) : undefined;
  const weatherKind = weather.kind === 'forecast' ? '예보 (앞으로의 예상)' : weather.kind === 'observation' ? '관측 (실제 측정)' : UNKNOWN;
  const token = keys => count(firstValue(usage, keys), ' 토큰');
  const excluded = record(diagnostics.excludedCounts);
  const search = record(diagnostics.search);
  const callStatus = boolean(gemini.called, '호출함', '미호출');
  const providerCalled = firstValue(diagnostics, ['weatherProviderCalled']) ?? firstValue(weather, ['providerCalled']);
  const weatherSource = providerCalled === true ? '이번 요청에서 기상청 외부 호출함' : providerCalled === false ? '이번 요청에서 기상청 외부 호출 없음' : '외부 호출 여부 미확인';
  const sections = [
    section('추천 요청', `<dl>${field('요청 번호', text(result.requestId))}${field('옷장 변경 번호', text(result.wardrobeRevision))}${field('추천 방식', result.source === 'gemini' ? 'Gemini 추천' : result.source === 'rules' ? '규칙 기반 추천' : UNKNOWN)}${field('선택 후보', text(result.selectedLookId))}</dl>`),
    section('기상청 날씨', `<dl>${field('자료 종류', weatherKind)}${field('최저 온도', number(weather.temperatureMin, ' °C', { negative: true }))}${field('최고 온도', number(weather.temperatureMax, ' °C', { negative: true }))}${field('습도', number(weather.humidity, ' %'))}${field('발표 시각', time(weather.issuedAt))}${field('가져온 시각', time(weather.fetchedAt))}${field('저장된 날씨 재사용', boolean(weather.cached, '재사용', '재사용 아님'))}${field('오래된 자료 여부', boolean(weather.stale, '오래된 자료', '유효한 자료'))}${field('기상청 외부 호출', weatherSource)}</dl>`),
    section('응답 시간', `<p class="small-text">단위 ms는 1,000분의 1초입니다. 저장 조회와 기상청 외부 호출은 별도 측정값이며, 값이 없으면 미확인입니다.</p><dl>${field('브라우저 요청 전체', number(clientMs, ' ms'))}${field('앱 서버 처리', number(timings.server, ' ms'))}${field('저장된 날씨 조회', number(timings.weatherCacheRead, ' ms'))}${field('기상청 외부 요청', number(timings.weatherProvider, ' ms'))}${field('Gemini 요청', number(timings.gemini, ' ms'))}</dl>`),
    section('Gemini 사용량', `<p class="small-text">토큰은 AI가 글을 처리하는 단위입니다. 응답에 보고된 사용량만 표시하며, 재사용된 결과의 사용량은 이번 요청의 새 과금량을 뜻하지 않습니다.</p><dl>${field('이번 추천 요청 호출', callStatus)}${field('이전 결과 재사용', boolean(gemini.cached, '재사용', '재사용 아님'))}${field('모델', text(gemini.model))}${field('입력 토큰', token(['inputTokens', 'promptTokenCount', 'input', 'prompt']))}${field('출력 토큰', token(['outputTokens', 'candidatesTokenCount', 'output', 'candidates']))}${field('생각 토큰', token(['thoughtsTokens', 'thoughtTokens', 'thoughtsTokenCount', 'thinkingTokens', 'thoughts', 'thinking']))}${field('총 토큰', token(['totalTokens', 'totalTokenCount', 'total']))}</dl>`),
    section('후보 생성과 제외', `<dl>${field('생성한 전체 후보', count(diagnostics.candidatesGenerated, '개'))}${field('온도 등 조건 필터 통과', count(diagnostics.candidatesAfterFilter, '개'))}${field('상위 후보 수', count(diagnostics.topKCount, '개'))}${field('가능한 전체 조합', count(search.totalCombinations, '개'))}${field('탐색 한도 도달', boolean(search.limitReached, '일부 조합만 탐색', '전체 조합 탐색'))}</dl><p><strong>제외 사유별 수</strong></p><p class="small-text">옷 자체와 조합의 제외 사유가 함께 포함되며, 한 조합에 여러 사유가 있을 수 있어 합계가 제외된 조합 수와 같지는 않습니다.</p>${list(Object.entries(excluded).map(([key, value]) => `${text(Object.hasOwn(exclusionLabels, key) ? exclusionLabels[key] : key)}: ${count(value, '개')}`))}`),
    section('Color Harmony Score · 색 조합 점수', `<p class="small-text">등록한 색 정보를 바탕으로 계산한 추천 기준 점수입니다. 실제 옷의 색감이나 조화의 정확도를 보장하지 않습니다.</p>${selected ? `<dl>${field('선택 후보 색 조합 점수', number(record(selected.scores).color, '점', { negative: true }))}${field('선택 후보 종합 점수', number(record(selected.scores).total, '점', { negative: true }))}</dl><p><strong>점수 근거</strong></p>${reasons(selected.scoreReasons)}` : `<p>선택 후보의 점수: ${UNKNOWN}</p>`}${looks.length ? `<details><summary>반환 후보 ${looks.length}개 점수 보기</summary>${looks.map(look => `<div class="diagnostic-candidate"><p><strong>${text(look.candidateId)}</strong> · 색 ${number(record(look.scores).color, '점', { negative: true })} · 종합 ${number(record(look.scores).total, '점', { negative: true })}</p>${reasons(look.scoreReasons)}</div>`).join('')}</details>` : ''}`),
  ];
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  return `<div class="recommendation-diagnostics"><p class="small-text">개발자 모드는 표시 항목만 바꾸며 관리자 인증이나 접근 권한을 부여하지 않습니다.</p><div class="diagnostic-grid">${sections.join('')}</div>${warnings.length ? section('추천 안내', list(warnings.map(reasonText))) : ''}</div>`;
}
