// Keep the named select for existing form storage; avoid the phone's field-navigation toolbar.
export function installSurveyPicker(root=document){
 const dialog=root.createElement('dialog');
 dialog.id='surveyChoiceDialog';dialog.className='survey-choice-dialog';
 dialog.setAttribute('aria-labelledby','surveyChoiceTitle');
 const title=root.createElement('h2');title.id='surveyChoiceTitle';
 const options=root.createElement('div');options.className='survey-choice-options';
 options.setAttribute('role','radiogroup');options.setAttribute('aria-labelledby',title.id);
 const footer=root.createElement('div');footer.className='survey-choice-footer';
 const done=root.createElement('button');done.type='button';done.className='primary full';done.textContent='완료';
 footer.append(done);dialog.append(title,options,footer);root.body.append(dialog);
 const controls=new WeakMap();let active=null,nextId=0;
 function refresh(){
  for(const select of root.querySelectorAll('#setupForm select, #profileForm select, #places select, #garmentForm select, #purchaseForm select')){
   if(select.multiple)continue;
   if(!controls.has(select))enhance(select);
   const {button,value,title}=controls.get(select);value.textContent=select.selectedOptions[0]?.textContent||'선택해 주세요';button.setAttribute('aria-label',title+': '+value.textContent);button.disabled=select.disabled;
  }
 }
 function open(control){
  if(dialog.open)return;
  active=control;title.textContent=control.title;options.replaceChildren();
  for(const option of control.select.options){
   const label=root.createElement('label');const radio=root.createElement('input');
   radio.type='radio';radio.name='survey-choice';radio.value=option.value;
   radio.checked=option.selected;radio.disabled=option.disabled;
   const text=root.createElement('span');text.textContent=option.textContent;
   const group=option.parentElement;
   if(group?.tagName==='OPTGROUP'){const hint=root.createElement('small');hint.textContent=group.label;text.append(hint);}
   label.append(radio,text);options.append(label);
  }
  dialog.showModal();(options.querySelector('input:checked')||options.querySelector('input:not(:disabled)')||done).focus();
 }
 function enhance(select){
  const label=select.closest('label');
  const heading=[...label.childNodes].filter(node=>node.nodeType===3).map(node=>node.textContent).join('').trim();
  const button=root.createElement('button');button.type='button';button.className='survey-select-trigger';
  button.id='survey-select-'+nextId++;button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls',dialog.id);
  const value=root.createElement('span');const arrow=root.createElement('span');arrow.textContent='⌄';arrow.setAttribute('aria-hidden','true');
  button.append(value,arrow);label.htmlFor=button.id;select.hidden=true;select.classList.add('survey-native-select');select.after(button);
  const control={select,button,value,title:heading};controls.set(select,control);
  button.addEventListener('click',()=>open(control));select.addEventListener('change',refresh);
  select.addEventListener('invalid',event=>{event.preventDefault();button.focus();const status=root.querySelector('#garmentStatus');if(select.closest('#garmentForm')&&status)status.textContent=heading+' 항목을 선택해주세요.';});
 }
 done.addEventListener('click',()=>{
  const checked=options.querySelector('input:checked');
  if(!active||!checked)return;
  const select=active.select;const changed=select.value!==checked.value;
  select.value=checked.value;refresh();
  if(changed){select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));}
  dialog.close();
 });
 // Escape/back dismisses without committing a tentative choice. Focus returns to this field.
 dialog.addEventListener('close',()=>{const previous=active;active=null;previous?.button.focus();});
 refresh();return {refresh};
}
