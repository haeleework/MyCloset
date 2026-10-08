import fs from 'node:fs/promises';
// Remove unused medium-model payloads from the generated dependency installation.
// Small inference remains fully local to the Vercel function; no model download at runtime.
if(process.env.VERCEL){
 const base=new URL('./node_modules/@imgly/background-removal-node/dist/',import.meta.url);
 const resources=JSON.parse(await fs.readFile(new URL('resources.json',base),'utf8'));
 const keep=new Set(resources['/models/small'].chunks.map(c=>c.hash));
 for(const chunk of resources['/models/medium'].chunks){
  if(!/^[a-f0-9]{64}$/.test(chunk.hash))throw Error('Invalid model asset');
  if(!keep.has(chunk.hash))await fs.rm(new URL(chunk.hash,base),{force:true});
 }
 await fs.writeFile(new URL('resources.json',base),JSON.stringify({'/models/small':resources['/models/small']}));
}
