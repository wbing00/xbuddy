// Injected only into the single-file demonstration. All records stay on this device.
const storagePrefix='xbuddy-offline-v1/';
const offlineStore={
  async get(key){return JSON.parse(localStorage.getItem(storagePrefix+key)||'null');},
  async list(prefix){return Object.keys(localStorage).filter(k=>k.startsWith(storagePrefix+prefix)).map(k=>JSON.parse(localStorage.getItem(k)).value);},
  async put(key,value,expected){
    const k=storagePrefix+key;
    const prior=JSON.parse(localStorage.getItem(k)||'null');
    if(expected!==undefined&&(prior?.tag??null)!==expected)return null;
    const tag=crypto.randomUUID();
    localStorage.setItem(k,JSON.stringify({value,tag}));return tag;
  }
};
async function offlineRequest(path,opts){
  if(opts.body && JSON.parse(opts.body).mode==='live')return new Response('{"error":"离线演练仅支持构造数据"}',{status:400});
  const response=await api(new Request('https://offline.invalid'+path,opts),{},offlineStore);
  if(path==='/api/meta'){
    const meta=await response.json();meta.modes=['demo'];return Response.json(meta);
  }
  return response;
}
