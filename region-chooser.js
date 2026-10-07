import {provinces,districtPlaces,townPlaces,placeById,regionSource} from './region-data.js';
import {cityName,regionIds} from './user-settings.js';
export const maxActivityRegions=8;
export function createRegionChooser(group,{refresh=()=>{}}={}){
 group.classList.remove('choice-grid');group.classList.add('region-chooser');
 const doc=group.ownerDocument;let selected=[];
 const fields=doc.createElement('div');fields.className='region-fields';
 function field(title,suffix){
  const label=doc.createElement('label');label.append(doc.createTextNode(title));
  const select=doc.createElement('select');select.id=group.id+'-'+suffix;
  label.append(select);fields.append(label);return select;
 }
 function option(select,text,value){const node=doc.createElement('option');node.textContent=text;node.value=value;select.append(node);}
 const province=field('시·도 선택','province'),district=field('시·군·구 선택','district'),town=field('읍·면·동 선택','town');
 option(province,'시·도를 골라주세요','');for(const p of provinces)option(province,p.name,p.id);
 const add=doc.createElement('button');add.type='button';add.className='secondary full';add.textContent='이 지역 추가';add.disabled=true;
 const list=doc.createElement('div');list.className='selected-regions';list.setAttribute('aria-label','선택한 활동 지역');
 const status=doc.createElement('p');status.className='small-text';status.setAttribute('role','status');
 const legacy=doc.createElement('p');legacy.className='small-text';legacy.hidden=true;
 legacy.textContent='이전에 고른 도시 설정은 그대로 보관했어요. 더 정확한 날씨를 원하면 읍·면·동을 추가하고 이전 도시를 지워주세요.';
 const source=doc.createElement('p');source.className='small-text';const link=doc.createElement('a');link.href=regionSource.sourceUrl;link.target='_blank';link.rel='noopener';link.textContent='기상청 지역·예보 지점 자료 · 출처';source.append(link);
 group.replaceChildren(fields,add,list,status,legacy,source);
 function render(){
  list.replaceChildren();
  for(const id of selected){
   const chip=doc.createElement('div');chip.className='selected-region';
   const input=doc.createElement('input');input.type='checkbox';input.name='locationIds';input.value=id;input.checked=true;input.hidden=true;
   const name=doc.createElement('span');name.textContent=cityName(id)+(placeById.has(id)?'':' (이전 도시 설정)');
   const remove=doc.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label',cityName(id)+' 삭제');
   remove.addEventListener('click',()=>{selected=selected.filter(value=>value!==id);render();status.textContent='지역을 목록에서 뺐어요. 설정을 저장하면 반영됩니다.';});
   chip.append(input,name,remove);list.append(chip);
  }
  if(!selected.length){const empty=doc.createElement('p');empty.className='small-text';empty.textContent='등록한 활동 지역이 없어요. 모르면 나중에 추가해도 괜찮아요.';list.append(empty);}
  legacy.hidden=!selected.some(id=>!placeById.has(id));
  add.disabled=!town.value||selected.includes(town.value)||selected.length>=maxActivityRegions;
 }
 function changeProvince(){
  district.replaceChildren();option(district,province.value?'시·군·구를 골라주세요':'시·도를 먼저 골라주세요','');
  for(const p of districtPlaces.filter(p=>p.provinceId===province.value))option(district,p.districtLabel,p.id);
  district.disabled=!province.value;changeDistrict();
 }
 function changeDistrict(){
  town.replaceChildren();option(town,district.value?'읍·면·동을 골라주세요':'시·군·구를 먼저 골라주세요','');
  for(const p of townPlaces.filter(p=>p.districtId===district.value))option(town,p.town,p.id);
  town.disabled=!district.value;status.textContent='';render();refresh();
 }
 province.addEventListener('change',changeProvince);
 district.addEventListener('change',changeDistrict);
 town.addEventListener('change',()=>{render();refresh();});
 add.addEventListener('click',()=>{
  const place=placeById.get(town.value);
  if(!place?.town||place.provinceId!==province.value||place.districtId!==district.value||selected.includes(place.id)||selected.length>=maxActivityRegions)return;
  selected.push(place.id);render();status.textContent=cityName(place.id)+' 추가했어요. '+(selected.length>=maxActivityRegions?'활동 지역은 최대 8곳까지 선택할 수 있어요.':'다른 지역도 이어서 추가할 수 있어요.');
 });
 changeProvince();
 return {setSelected(ids){selected=regionIds({locationIds:ids});status.textContent=selected.length>=maxActivityRegions?'활동 지역은 최대 8곳까지 선택할 수 있어요.':'';render();refresh();}};
}
