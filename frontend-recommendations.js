import {RECOMMENDATION_ENDPOINT, RECOMMENDATION_TOP_K} from './recommendation-contract.js';
// Keep extensible JSON garment fields while stripping private media/analysis at
// every level, including nested Blob/File values and source-image metadata.
const privateKeys = new Set(['photo', 'cutout', 'capture', 'vision', 'sourceImage', 'inlineData', 'image', 'imageData', 'photoData', 'base64']);
function transportValue(value) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return /^(?:data:image\/|blob:)/i.test(value) ? undefined : value;
  if (Array.isArray(value)) return value.map(transportValue).filter(entry => entry !== undefined);
  if (value && Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.entries(value).filter(([key]) => !privateKeys.has(key)).map(([key, entry]) => [key, transportValue(entry)]).filter(([, entry]) => entry !== undefined));
  return undefined;
}
export function recommendationWardrobe(wardrobe) {
  return (Array.isArray(wardrobe) ? wardrobe : []).map(item => transportValue(item) || {});
}
const failure = (code, message) => Object.assign(new Error(message), {code});
const validId = id => typeof id === 'string' && id.trim().length > 0;
const stringList = values => Array.isArray(values) ? values.filter(value => typeof value === 'string') : [];
// Canonical comparison ignores property insertion order; array order remains meaningful.
const stable = value => JSON.stringify(value, (_, entry) => entry && Object.getPrototypeOf(entry) === Object.prototype ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);

export function validateRecommendationResponse(data, request, wardrobe = request.wardrobe) {
  if (!data || data.requestId !== request.requestId || data.wardrobeRevision !== request.wardrobeRevision) throw failure('stale_response', '옷장 정보가 바뀌어 이전 추천을 적용하지 않았어요.');
  if (!['rules', 'gemini'].includes(data.source) || !Array.isArray(data.looks) || data.looks.length > RECOMMENDATION_TOP_K) throw failure('invalid_response', '추천 응답 형식을 확인하지 못했어요. 다시 시도해주세요.');
  const items = new Map(wardrobe.map(item => [item.id, item]));
  if (items.size !== wardrobe.length || wardrobe.some(item => !validId(item.id))) throw failure('invalid_items', '옷을 구분하는 정보가 겹쳐 추천을 적용하지 않았어요.');
  const seen = new Set();
  for (const look of data.looks) {
    if (!look || !validId(look.candidateId) || seen.has(look.candidateId) || !Array.isArray(look.itemIds) || !look.itemIds.length || new Set(look.itemIds).size !== look.itemIds.length || look.itemIds.some(id => !validId(id) || !items.has(id) || items.get(id).available === false)) throw failure('invalid_items', '현재 옷장에 없는 옷이 포함되어 추천을 적용하지 않았어요.');
    seen.add(look.candidateId);
  }
  if (data.looks.length ? !seen.has(data.selectedLookId) : data.selectedLookId != null) throw failure('invalid_selection', '선택된 추천을 확인하지 못했어요. 다시 시도해주세요.');
  return data;
}

export function createRecommendationController({fetchImpl = globalThis.fetch?.bind(globalThis), onState = () => {}, timeoutMs = 20000, getCurrentSnapshot = null, getAccessToken = () => null} = {}) {
  let generation = 0, active = null, sequence = 0;
  let state = {status: 'idle', data: null, error: null, elapsedMs: null};
  const publish = update => { state = {...state, ...update}; onState(state); };
  const invalidate = () => { generation++; active?.controller.abort(); active = null; publish({status: 'idle', data: null, error: null, elapsedMs: null, requestId: null}); };
  function request(input) {
    const snapshot = transportValue({wardrobeRevision: input.wardrobeRevision, wardrobe: recommendationWardrobe(input.wardrobe), profile: input.profile || {}, context: input.context || {}, options: {...input.options, topK: RECOMMENDATION_TOP_K}});
    const fingerprint = stable(snapshot);
    if (active?.fingerprint === fingerprint) return active.promise;
    active?.controller.abort();
    const currentGeneration = ++generation;
    const requestId = input.requestId || `recommend-${Date.now()}-${++sequence}`;
    const payload = {...snapshot, requestId};
    const controller = new AbortController();
    const started = performance.now();
    let timedOut = false, timer;
    const pending = {fingerprint, controller, promise: null};
    active = pending;
    publish({status: 'loading', data: null, error: null, elapsedMs: null, requestId});
    pending.promise = (async () => {
      try {
        const cancelled = new Promise((_, reject) => {
          controller.signal.addEventListener('abort', () => reject(failure(timedOut ? 'timeout' : 'aborted', timedOut ? '추천 응답이 늦어지고 있어요. 다시 시도해주세요.' : '이전 추천 요청을 취소했어요.')), {once: true});
          timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
        });
        const received = (async () => {
          const token = getAccessToken();
          const headers = {'Content-Type': 'application/json', ...(typeof token === 'string' && token ? {Authorization: `Bearer ${token}`} : {})};
          const response = await fetchImpl(RECOMMENDATION_ENDPOINT, {method: 'POST', headers, body: JSON.stringify(payload), signal: controller.signal});
          let data;
          try { data = await response.json(); } catch { throw failure('invalid_response', '추천 응답을 읽지 못했어요. 다시 시도해주세요.'); }
          if (!response.ok) throw failure(typeof data?.code === 'string' ? data.code : `http_${response.status}`, '추천을 가져오지 못했어요. 잠시 후 다시 시도해주세요.');
          return data;
        })();
        const data = await Promise.race([received, cancelled]);
        if (generation !== currentGeneration) return {status: 'ignored'};
        const current = getCurrentSnapshot?.();
        if (current && (current.wardrobeRevision !== payload.wardrobeRevision || stable(recommendationWardrobe(current.wardrobe)) !== stable(payload.wardrobe))) { invalidate(); return {status: 'ignored'}; }
        validateRecommendationResponse(data, payload, current?.wardrobe || payload.wardrobe);
        const elapsedMs = Math.round((performance.now() - started) * 10) / 10;
        publish({status: 'ready', data, error: null, elapsedMs});
        return {status: 'ready', data, elapsedMs};
      } catch (cause) {
        if (generation !== currentGeneration || cause?.code === 'aborted') return {status: 'ignored'};
        const error = typeof cause?.code === 'string' ? cause : failure('network', '연결을 확인한 뒤 추천을 다시 시도해주세요.');
        const elapsedMs = Math.round((performance.now() - started) * 10) / 10;
        publish({status: 'error', error, data: null, elapsedMs});
        return {status: 'error', error, elapsedMs};
      } finally { clearTimeout(timer); if (active === pending) active = null; }
    })();
    return pending.promise;
  }
  return {request, invalidate, get state() { return state; }};
}

export function recommendationToOutfit(data, wardrobe) {
  validateRecommendationResponse(data, {requestId: data?.requestId, wardrobeRevision: data?.wardrobeRevision}, wardrobe);
  const legacy = data.legacyResult || {};
  const selected = data.looks.find(look => look.candidateId === data.selectedLookId);
  if (!selected) return {outfit: null, missing: stringList(data.missing || legacy.missing).length ? stringList(data.missing || legacy.missing) : ['현재 조건에 맞는 옷'], notices: [...new Set([...stringList(data.warnings), ...stringList(legacy.notices)])], reasons: [], total: 0, signature: null, apiResponse: data};
  const byId = new Map(wardrobe.map(item => [item.id, item]));
  if (selected.itemIds.some(id => !byId.has(id) || byId.get(id).available === false)) throw failure('invalid_items', '현재 옷장에 없는 옷이 포함되어 추천을 적용하지 않았어요.');
  const legacyMatches = Array.isArray(legacy.outfit) && legacy.outfit.length === selected.itemIds.length && legacy.outfit.every(item => selected.itemIds.includes(item?.id));
  const total = [data.validCandidateCount, legacy.total, data.diagnostics?.search?.eligibleCount, data.diagnostics?.candidatesAfterFilter, data.looks.length].find(value => Number.isInteger(value) && value >= data.looks.length);
  const comfortAdjustment = selected.comfortAdjustment || data.comfortAdjustment || (legacyMatches ? legacy.comfortAdjustment : null);
  const formalAdjustment = selected.formalAdjustment || data.formalAdjustment || (legacyMatches ? legacy.formalAdjustment : null);
  return {outfit: selected.itemIds.map(id => byId.get(id)), missing: [], notices: [...new Set([...stringList(data.warnings), ...stringList(selected.notices), ...(legacyMatches ? stringList(legacy.notices) : [])])], reasons: [...new Set([selected.stylingTip, ...stringList(selected.reasons)].filter(text => typeof text === 'string' && text))], total, signature: legacyMatches && typeof legacy.signature === 'string' ? legacy.signature : [...selected.itemIds].sort().join('|'), stylingTip: typeof selected.stylingTip === 'string' ? selected.stylingTip : '', source: data.source, ...(comfortAdjustment ? {comfortAdjustment} : {}), ...(formalAdjustment ? {formalAdjustment} : {}), apiResponse: data};
}
