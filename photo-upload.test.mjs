import test from 'node:test';import assert from 'node:assert/strict';
import {preparePhotoUpload,photoUploadLimit} from './photo-upload.js';
test('mobile original is retained while processing gets a bounded oriented copy',async()=>{
 const original={type:'image/jpeg',size:9*1024*1024};let closed=false,draws=0;const sizes=[];
 const canvas={getContext:()=>({fillRect(){},drawImage(){draws++;}}),toBlob(cb,type,q){sizes.push(q);cb(new Blob(['image'],{type}));}};
 const result=await preparePhotoUpload(original,{createBitmap:async(file,opts)=>{assert.equal(file,original);assert.equal(opts.imageOrientation,'from-image');return {width:4000,height:6000,close(){closed=true;}};},makeCanvas:()=>canvas,read:async b=>{assert.ok(b.size<photoUploadLimit);return 'fixture';}});
 assert.deepEqual(result,{mimeType:'image/jpeg',data:'fixture'});assert.equal(canvas.height,1600);assert.equal(canvas.width,1067);assert.equal(draws,1);assert.equal(closed,true);assert.equal(original.size,9*1024*1024);
});
test('oversized conversion fails instead of exceeding Vercel request limit',async()=>{
 let closed=false;const canvas={getContext:()=>({fillRect(){},drawImage(){}}),toBlob(cb){cb({size:photoUploadLimit+1});}};
 await assert.rejects(preparePhotoUpload({type:'image/png',size:100},{createBitmap:async()=>({width:100,height:100,close(){closed=true;}}),makeCanvas:()=>canvas}));assert.equal(closed,true);
});
