import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {publicAssets} from './public-assets.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),output=path.join(root,'dist');
// Guard generated-output deletion against symlinks and paths outside this project.
if(path.dirname(output)!==root||path.basename(output)!=='dist')throw Error('Unsafe output path');
try{const info=await fs.lstat(output);if(info.isSymbolicLink()||await fs.realpath(output)!==output)throw Error('Output must be a local directory');await fs.rm(output,{recursive:true});}catch(error){if(error.code!=='ENOENT')throw error;}
await fs.mkdir(output);
for(const name of publicAssets){const to=path.join(output,name);await fs.mkdir(path.dirname(to),{recursive:true});await fs.copyFile(path.join(root,name),to);}
console.log(`Static assets: ${publicAssets.length}. API runtime is separate; this folder alone is not a complete deployment.`);
