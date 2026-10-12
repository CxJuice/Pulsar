const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const retry = fs.readFileSync(path.join(__dirname,'../../electron/translation-retry.cjs'),'utf8');
const fixture = `(() => { const module = {exports:{}}; ${retry}; window.__auditRetryTranslation = module.exports.withTranslationTimeoutRetries; })();` + fs.readFileSync(path.join(__dirname,'browser-fixture.js'),'utf8');
const server = http.createServer((req,res)=>{
  const upstream=http.request({hostname:'127.0.0.1',port:3000,path:req.url,method:req.method,headers:{...req.headers,host:'127.0.0.1:3000','accept-encoding':'identity'}},response=>{
    const headers={...response.headers}; delete headers['content-length']; delete headers['transfer-encoding'];
    if((headers['content-type']||'').includes('text/html')){
      let html=''; response.setEncoding('utf8'); response.on('data',part=>html+=part);
      response.on('end',()=>{res.writeHead(response.statusCode,headers);res.end(html.replace('<head>','<head><script>'+fixture+'</script>'));});
    }else{res.writeHead(response.statusCode,headers);response.pipe(res);}
  });
  upstream.on('error',()=>{res.writeHead(502);res.end('Audit preview upstream unavailable');});
  req.pipe(upstream);
});
server.listen(3001,'127.0.0.1',()=>console.log('Local audit fixture on port 3001. No real ParaTranz writes.'));
