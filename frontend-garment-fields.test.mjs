import test from 'node:test';
import assert from 'node:assert/strict';
import {renderGarmentConfirmationFields, populateGarmentConfirmationFields, readGarmentConfirmationFields} from './frontend-garment-fields.js';
import {garmentAttributes} from './recommendation-attributes.js';
import {colorAttributes} from './recommendation-color.js';
const keys = ['material', 'materialConfirmed', 'thickness', 'length', 'colorFamily', 'colorLightness', 'colorChroma', 'colorHue'];
const form = () => ({elements: Object.fromEntries([...keys, 'itemType', 'warmth'].map(key => [key, {value: '', checked: false}]))});
test('추가 확인 양식은 기존 종류와 보온 입력을 중복 생성하지 않는다', () => {
  const html = renderGarmentConfirmationFields();
  for (const key of keys) assert.match(html, new RegExp(`name="${key}"`));
  assert.doesNotMatch(html, /name="(?:itemType|warmth)"/);
  assert.match(html, /실제 소재/);
});
test('모르는 속성은 모두 null이고 기존 종류·보온을 보존한다', () => {
  const f = form(); f.elements.itemType.value = '청바지'; f.elements.warmth.value = '1.5';
  populateGarmentConfirmationFields(f, {name: '울 코트', surface: '두꺼워 보임', color: '빨강', vision: {material: '울'}});
  assert.deepEqual(readGarmentConfirmationFields(f), Object.fromEntries(keys.map(key => [key, null])));
  assert.equal(f.elements.itemType.value, '청바지'); assert.equal(f.elements.warmth.value, '1.5');
});
test('사용자가 확인한 소재·톤 속성을 저장 후 다시 읽는다', () => {
  const f = form();
  const item = {material: '면 100%', materialConfirmed: true, thickness: 'thin', length: 'long', colorFamily: '초록', colorLightness: 25, colorChroma: 15, colorHue: 120};
  populateGarmentConfirmationFields(f, item);
  assert.deepEqual(readGarmentConfirmationFields(f), item);
  assert.equal(garmentAttributes(readGarmentConfirmationFields(f)).thickness, 0);
  assert.equal(garmentAttributes(readGarmentConfirmationFields(f)).material, '면 100%');
  assert.deepEqual(colorAttributes(readGarmentConfirmationFields(f)), {family: 'green', hue: 120, lightness: 25, chroma: 15});
  assert.equal(item.colorHue, 120);
});
test('소재는 별도 확인 없으면 미확인이고 지우면 확인도 해제한다', () => {
  const f = form(); f.elements.material.value = ' 울 혼방 ';
  assert.equal(readGarmentConfirmationFields(f).materialConfirmed, false);
  f.elements.materialConfirmed.checked = true;
  assert.equal(readGarmentConfirmationFields(f).materialConfirmed, true);
  f.elements.material.value = '  ';
  assert.equal(readGarmentConfirmationFields(f).material, null);
  assert.equal(readGarmentConfirmationFields(f).materialConfirmed, null);
});
test('잘못된 값은 자동 추정하지 않으며 새 옷을 열면 이전 값이 남지 않는다', () => {
  const f = form(); populateGarmentConfirmationFields(f, {material: '린넨', materialConfirmed: true, thickness: 'giant', colorHue: 360});
  assert.equal(readGarmentConfirmationFields(f).thickness, null); assert.equal(readGarmentConfirmationFields(f).colorHue, null);
  populateGarmentConfirmationFields(f);
  assert.deepEqual(readGarmentConfirmationFields(f), Object.fromEntries(keys.map(key => [key, null])));
  f.elements.colorHue.value = '0'; assert.equal(readGarmentConfirmationFields(f).colorHue, 0);
  f.elements.colorHue.value = '359.5'; assert.equal(readGarmentConfirmationFields(f).colorHue, 359.5);
  f.elements.colorHue.value = '-1'; assert.equal(readGarmentConfirmationFields(f).colorHue, null);
});
