// Mimics the pairing proxy's responses (src/index.ts browserProxy) for simulator checks.
import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? 18731)
let flaky = 0
const head = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
  + '<body style="margin:0;padding:env(safe-area-inset-top) 16px 0;font:20px system-ui;background:#e8f4ff">'
createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const paired = /dsh-remote-control=t/.test(req.headers.cookie ?? '')
  console.log(req.method, req.headers.host, req.url, paired ? 'cookie' : 'no-cookie')
  if (url.pathname === '/flaky' && flaky++ === 0) {
    // What the server's reverse proxy sends while DSH or its tunnel is down: an empty 502.
    res.writeHead(502).end()
  } else if (url.searchParams.get('pair') === 'ok') {
    res.writeHead(303, { location: '/', 'set-cookie': 'dsh-remote-control=t; Max-Age=34560000; Path=/; HttpOnly; SameSite=Lax' }).end()
  } else if (!paired) {
    res.writeHead(401, { 'content-type': 'text/html; charset=utf-8', 'x-dsh-remote-control': 'unpaired' })
      .end(head + '<h1>无法打开远程页面</h1><p>访问凭据无效或配对已被替换，需要重新扫码。</p>')
  } else if (url.pathname === '/file') {
    res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="session.zip"' }).end('PK')
  } else if (url.pathname === '/download') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      .end(head + '<h1>下载测试</h1><script>const a=document.createElement("a");a.href="/file";a.download="session.zip";a.click()</script>')
  } else if (url.pathname === '/external') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      .end(head + `<h1>外链测试</h1><script>setTimeout(()=>{location.href="http://localhost:${port}/elsewhere"},300)</script>`)
  } else {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      .end(head + `<h1>已配对 DSH Web</h1><p>${req.headers.host}${req.url}</p><p id=u></p>`
        + '<p id=o>no session link</p><script>u.textContent=navigator.userAgent;'
        + 'addEventListener("dsh-remote-open",()=>{o.textContent="打开会话："+__dshRemoteOpen.splice(0).join(",")})</script>')
  }
}).listen(port, () => { console.log('mock on', port) })
