import {api} from './lib/api.mjs';

// The build inserts a self-contained map of the three public assets here.
const assets = {};
function researchStore(bucket,owner){
  const base='research/'+encodeURIComponent(owner)+'/';
  return {
    async get(key){const obj=await bucket.get(base+key);return obj?{tag:obj.etag,value:await obj.json()}:null;},
    async list(key){
      const rows=await bucket.list({prefix:base+key,limit:100,include:['customMetadata']});
      return rows.objects.map(x=>JSON.parse(x.customMetadata.summary));
    },
    async put(key,value,expected){
      const options={};
      if(expected!==undefined)options.onlyIf=expected===null?{etagDoesNotMatch:'*'}:{etagMatches:expected};
      if(key.startsWith('thread/')){
        const {id,title,mode,status,updatedAt,createdAt,symbol,benchmark,days,goal}=value;
        options.customMetadata={summary:JSON.stringify({id,title,mode,status,updatedAt,createdAt,symbol,benchmark,days,goal})};
      }
      const obj=await bucket.put(base+key,JSON.stringify(value),options);return obj?.etag||null;
    }
  };
}
export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    if(path.startsWith('/api/')){
      const owner=request.headers.get('oai-authenticated-user-id')||request.headers.get('Cookie')?.match(/(?:^|;\s*)xb_owner=([a-f0-9-]{36})/)?.[1]||crypto.randomUUID();
      const response=await api(request,env,researchStore(env.BUCKET,owner));
      if(!request.headers.get('oai-authenticated-user-id')&&!request.headers.get('Cookie')?.includes('xb_owner='))response.headers.append('Set-Cookie','xb_owner='+owner+'; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=31536000');
      return response;
    }
    const a=assets[path];return a?new Response(a[1],{headers:{'Content-Type':a[0]+'; charset=utf-8','X-Content-Type-Options':'nosniff'}}):new Response('Not found',{status:404});
  }
};
