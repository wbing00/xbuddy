// Use the Streamable HTTP endpoint copied from the user's iFinD service settings.
export function hasIfind(env){return Boolean(env.IFIND_MCP_URL&&env.IFIND_MCP_KEY);}
export async function requestIfind(method,params,env){
  const url=new URL(env.IFIND_MCP_URL);
  if(url.protocol!=='https:'||!url.hostname.endsWith('.51ifind.com')||url.username||url.password||url.search)throw Error('请配置 iFinD 官方 HTTPS MCP 服务地址');
  const headers={'Content-Type':'application/json',Accept:'application/json, text/event-stream',Authorization:env.IFIND_MCP_KEY};
  async function send(name,arguments_,id){
    const response=await (env.fetch||fetch)(url,{method:'POST',headers,redirect:'error',signal:AbortSignal.timeout(12000),
      body:JSON.stringify({jsonrpc:'2.0',id,method:name,params:arguments_})});
    if(!response.ok)throw Error('iFinD 返回 HTTP '+response.status);
    const session=response.headers.get('mcp-session-id');
    if(session)headers['Mcp-Session-Id']=session;
    if(id===undefined){await response.body?.cancel();return;}
    const body=await response.text();
    let message;
    if(response.headers.get('content-type')?.includes('text/event-stream')){
      message=body.split(/\r?\n\r?\n/).map(frame=>frame.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5)).join('\n')).filter(Boolean).map(JSON.parse).find(m=>m.id===id);
    }else message=JSON.parse(body);
    if(message?.id!==id||message.error||!message.result||message.result.isError)throw Error('iFinD 工具调用失败或返回格式无效');
    return message.result;
  }
  const init=await send('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'xbuddy',version:'1'}},1);
  headers['MCP-Protocol-Version']=init.protocolVersion;
  await send('notifications/initialized',{},undefined);
  return send(method,params,2);
}
