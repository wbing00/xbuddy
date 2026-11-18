import test from 'node:test';
import assert from 'node:assert/strict';
import {requestIfind} from '../lib/ifind.mjs';

test('iFinD HTTP MCP negotiates the session before calling an approved tool',async()=>{
  const methods=[];
  const env={IFIND_MCP_URL:'https://mcp.51ifind.com/test',IFIND_MCP_KEY:'test',
    async fetch(_url,{headers,body}){
      const {method,params,id}=JSON.parse(body);methods.push(method);
      if(method==='initialize')return Response.json({id,result:{protocolVersion:'2025-03-26'}},{headers:{'mcp-session-id':'test-session'}});
      assert.equal(headers['Mcp-Session-Id'],'test-session');
      if(method==='notifications/initialized')return new Response(null,{status:202});
      assert.equal(params.name,'query_prices');
      return new Response('data: '+JSON.stringify({id,result:{content:[{type:'text',text:'ok'}]}})+'\n\n',{headers:{'content-type':'text/event-stream'}});
    }};
  const r=await requestIfind('tools/call',{name:'query_prices',arguments:{}},env);
  assert.equal(r.content[0].text,'ok');
  assert.deepEqual(methods,['initialize','notifications/initialized','tools/call']);
});
