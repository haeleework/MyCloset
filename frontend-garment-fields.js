import {thicknessOptions} from './thickness-policy.js';
// User-confirmed attributes only. Never derive composition or tone from a photo,
// garment name, visual surface, or the existing approximate colour description.
export const garmentConfirmationOptions = {
  thickness: thicknessOptions,
  length: [['short', '짧음'], ['regular', '보통 길이'], ['long', '김']],
  colorFamily: ['검정', '흰색', '회색', '베이지', '남색', '파랑', '초록', '갈색', '분홍', '빨강', '노랑', '보라', '혼합'].map(value => [value, value]),
};
const toneFields = {colorLightness: ['명도 · 밝고 어두운 정도', 100], colorChroma: ['채도 · 차분하고 선명한 정도', 100], colorHue: ['색상각도', 359.999]};
const select = (name, label) => `<label>${label}<select name="${name}"><option value="">아직 모름</option>${garmentConfirmationOptions[name].map(([value, text]) => `<option value="${value}">${text}</option>`).join('')}</select></label>`;
export function renderGarmentConfirmationFields() {
  return `<details class="garment-confirmation-fields"><summary>소재·두께·색톤 확인 (선택)</summary><p class="small-text">두께는 최초 사진 분석에서 AI가 추정해 채워요. 필요할 때만 수정하면 됩니다. 실제 소재나 보온 성능은 사진만으로 확정하지 않아요. 모르는 항목은 비워둘 수 있어요.</p><div class="form-grid"><label>소재 (라벨·상품정보)<input name="material" maxlength="160" placeholder="예: 면 100%, 울 혼방"></label><label class="check"><input type="checkbox" name="materialConfirmed">라벨이나 상품정보에서 소재를 확인했어요</label>${select('thickness', '두께 · AI 추정 후 수정 가능')}${select('length', '직접 확인한 길이')}${select('colorFamily', '실물에서 확인한 색 계열')}</div><p class="small-text">정밀 색상값은 색상표에서 확인했을 때만 입력해주세요. 명도·채도는 0~100, 색상각도는 0 이상 360 미만입니다. 빨강 0도, 초록 120도, 파랑 240도이며 사진만 보고 추측할 필요는 없어요.</p><div class="form-grid">${Object.entries(toneFields).map(([name, [label, max]]) => `<label>${label} (선택)<input name="${name}" type="number" min="0" max="${max}" step="any" placeholder="아직 모름"></label>`).join('')}</div></details>`;
}
const element = (form, name) => form?.elements?.namedItem?.(name) || form?.elements?.[name];
const knownOption = (name, value) => garmentConfirmationOptions[name].some(([option]) => option === value) ? value : null;
const toneValue = (name, value) => value === '' || value == null || typeof value === 'boolean' || !Number.isFinite(Number(value)) || Number(value) < 0 || (name === 'colorHue' ? Number(value) >= 360 : Number(value) > 100) ? null : Number(value);
export function populateGarmentConfirmationFields(form, item = {}) {
  const material = element(form, 'material');
  if (material) material.value = typeof item.material === 'string' ? item.material : '';
  const confirmed = element(form, 'materialConfirmed');
  if (confirmed) confirmed.checked = Boolean(item.material && item.materialConfirmed === true);
  for (const name of Object.keys(garmentConfirmationOptions)) {
    const field = element(form, name);
    if (field) field.value = knownOption(name, item[name]) ?? '';
  }
  for (const name of Object.keys(toneFields)) {
    const field = element(form, name);
    if (field) field.value = toneValue(name, item[name]) ?? '';
  }
}
export function readGarmentConfirmationFields(form) {
  const text = element(form, 'material')?.value;
  const material = typeof text === 'string' && text.trim() ? text.trim().slice(0, 160) : null;
  return {
    material,
    materialConfirmed: material ? element(form, 'materialConfirmed')?.checked === true : null,
    ...Object.fromEntries(Object.keys(garmentConfirmationOptions).map(name => [name, knownOption(name, element(form, name)?.value)])),
    ...Object.fromEntries(Object.keys(toneFields).map(name => [name, toneValue(name, element(form, name)?.value)])),
  };
}
