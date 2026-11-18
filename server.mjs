import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {api} from './lib/api.mjs';
const root=new URL('./',import.meta.url);
await mkdir(new URL('.data/',root),{recursive:true});
const db=new DatabaseSync(fileURLToPath(new URL('.data/research.sqlite',root)));
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY,value TEXT NOT NULL,tag TEXT NOT NULL)');
function store(owner){
  const prefix=owner+'/';
  return {
    async get(k){const row=db.prepare('SELECT * FROM records WHERE key=?').get(prefix+k);return row?{value:JSON.parse(row.value),tag:row.tag}:null;},
    async list(k){return db.prepare('SELECT value FROM records WHERE key LIKE ? ORDER BY rowid DESC LIMIT 100').all(prefix+k+'%').map(r=>JSON.parse(r.value));},
    async put(k,value,expect){const tag=randomUUID(),key=prefix+k,s=JSON.stringify(value);
      const r=expect===undefined?db.prepare('INSERT INTO records VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,tag=excluded.tag').run(key,s,tag)
      :expect===null?db.prepare('INSERT OR IGNORE INTO records VALUES (?,?,?)').run(key,s,tag)
      :db.prepare('UPDATE records SET value=?,tag=? WHERE key=? AND tag=?').run(s,tag,key,expect);
      return r.changes?tag:null;}
  };
}
const mime={'.html':'text/html','.css':'text/css','.js':'application/javascript','.svg':'image/svg+xml'};
const server=createServer(async (req,res)=>{
  try{
    const host=req.headers.host||'localhost',url=new URL(req.url,process.env.RENDER_EXTERNAL_URL||'http://'+host),path=url.pathname;
    if(path.startsWith('/api/')){
      const existing=(req.headers.cookie||'').match(/(?:^|;\s*)xb_owner=([0-9a-f-]{36})(?:;|$)/)?.[1],owner=existing||randomUUID();
      if(!existing)res.setHeader('Set-Cookie','xb_owner='+owner+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000');
      let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>8192){res.writeHead(413);res.end();return;}chunks.push(c);}
      const response=await api(new Request(url,{method:req.method,headers:req.headers,body:req.method==='POST'?Buffer.concat(chunks):undefined}),process.env,store(owner));
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;
    }
    const file=path==='/'?'index.html':path.slice(1);
    if(!/^[a-zA-Z0-9_.-]+$/.test(file)||!Object.keys(mime).some(x=>file.endsWith(x))){res.writeHead(404);res.end();return;}
    const body=await readFile(new URL('public/'+file,root));res.writeHead(200,{'Content-Type':mime[file.slice(file.lastIndexOf('.'))]+'; charset=utf-8'});res.end(body);
  }catch(e){res.writeHead(e.code==='ENOENT'?404:500);res.end();}
});
const port=Number(process.env.PORT||4173);server.listen(port,process.env.HOST||'127.0.0.1',()=>console.log('X Buddy listening on http://'+(process.env.HOST||'127.0.0.1')+':'+port));
