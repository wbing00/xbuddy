// Bundle the small, dependency-free ESM graph and front end into one Sites Worker.
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const read=p=>readFile(new URL(p,root),'utf8');
const parts=[];
for(const [name,api] of [['providers',['getIndexHistory','compareIndices','modelJSON']],['harness',['action','benchmarks','createThread','problem','registry','step','subjects']],['api',['api']]]){
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
const transport=await read('scripts/offline-transport.js');
const ui=(await read('public/app.js')).replace("await fetch('/api/'+path,options)","await offlineRequest('/api/'+path,options)");
const offlineJS='(()=>{'+parts.join('\n')+'\n'+transport+'\n;(()=>{'+ui+'})();})();';
const html=(await read('public/index.html'))
  .replace('<link rel="stylesheet" href="/style.css">',()=>'<style>'+assets['/style.css'][1]+'</style>')
  .replace('<script src="/app.js" defer></script>','')
  .replace('</body>',()=>'<script>'+offlineJS.replace(/<\/script/gi,'<\\/script')+'</script></body>');
await writeFile(new URL('dist/离线演练.html',root),html);
