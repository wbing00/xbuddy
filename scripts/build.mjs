// Bundle the small, dependency-free ESM graph and front end into one Sites Worker.
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const read=p=>readFile(new URL(p,root),'utf8');
const parts=[];
for(const [name,api] of [['providers',['getIndexHistory','compareIndices','modelJSON','fuyao']],['harness',['action','benchmarks','createThread','problem','registry','step','subjects']],['research-tools',['researchTools','queryResearchTool']],['ifind',['hasIfind','requestIfind']],['agent',['newResearch','advanceResearch','researchAction']],['api',['api']]]){
  const source=(await read('lib/'+name+'.mjs')).replace(/^import .*?;$/gm,'').replace(/^export /gm,'');
  parts.push('const {'+api.join(',')+'} = (() => {\n'+source+'\nreturn {'+api.join(',')+'};\n})();');
}
const assets={};
for(const [route,file,mime] of [['/','index.html','text/html'],['/app.js','app.js','application/javascript'],['/style.css','style.css','text/css']]){
  assets[route]=[mime,await read('public/'+file)];
}
const worker=(await read('worker.mjs')).replace(/^import .*?;$/gm,'').replace('const assets = {};',()=> 'const assets = '+JSON.stringify(assets)+';');
await mkdir(new URL('dist/server/',root),{recursive:true});await mkdir(new URL('dist/.openai/',root),{recursive:true});
await writeFile(new URL('dist/server/index.js',root),parts.join('\n')+'\n'+worker);
await copyFile(new URL('.openai/hosting.json',root),new URL('dist/.openai/hosting.json',root));
