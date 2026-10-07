import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import exifr from 'exifr';import {parseCapture,captureGroups} from './engine.js';
test('JPEG 실제 EXIF 파서가 원본 촬영 시각과 시간대·기기를 읽고 묶음 후보를 만든다',async()=>{
 const items=[];
 for(const name of ['capture-a.jpg','capture-b.jpg']){
  const bytes=await readFile(new URL('./fixtures/'+name,import.meta.url));
  const meta=await exifr.parse(bytes,{pick:['DateTimeOriginal','OffsetTimeOriginal','Make','Model','Flash','WhiteBalance'],reviveValues:false,translateValues:false,gps:false});
  assert.equal(meta.Model,'QA camera');assert.equal(meta.OffsetTimeOriginal,'+09:00');
  const capture=parseCapture(meta.DateTimeOriginal,meta.OffsetTimeOriginal);assert(capture);assert.equal(capture.hasZone,true);
  items.push({id:name,capture:{...capture,model:meta.Model,make:meta.Make,flash:meta.Flash,whiteBalance:meta.WhiteBalance}});
 }
 assert.equal(captureGroups(items).length,1);assert.equal(captureGroups(items)[0].length,2);
});
