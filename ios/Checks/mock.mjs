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
  if (url.pathname === '/server-error') {
    res.writeHead(502).end()
  } else if (url.pathname === '/startup-retry' && !/startup-retry=t/.test(req.headers.cookie ?? '')) {
    res.writeHead(502, { 'set-cookie': 'startup-retry=t; Path=/' }).end()
  } else if (url.pathname === '/flaky' && flaky++ === 0) {
    // What the server's reverse proxy sends while DSH or its tunnel is down: an empty 502.
    res.writeHead(502).end()
  } else if (url.searchParams.get('pair') === 'ok') {
    res.writeHead(303, { location: url.pathname, 'set-cookie': 'dsh-remote-control=t; Max-Age=34560000; Path=/; HttpOnly; SameSite=Lax' }).end()
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
  } else if (url.pathname === '/startup-script.js') {
    setTimeout(() => res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' })
      .end('document.body.append("脚本已就绪")'), 3000)
  } else if (url.pathname === '/startup-script') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      .end(head + '<h1>正在加载脚本</h1><script src="/startup-script.js"></script>')
  } else if (url.pathname === '/startup') {
    // A slow first response exposes WebKit's empty-page canvas before any HTML is available.
    setTimeout(() => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      .end(head + '<style>html{color-scheme:dark}body{background:#1b1b1b!important;color:#eee}</style>'
        + '<h1>启动检查完成</h1><p>延迟响应后，页面正常显示。</p>'), 3000)
  } else if (url.pathname === '/keyboard') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      .end(head + '<h1>键盘检查</h1><p>输入框与键盘之间不应出现上下箭头和完成工具栏。</p>'
        + '<textarea aria-label="消息" placeholder="点此输入" style="font:20px system-ui;width:100%;height:100px;box-sizing:border-box"></textarea>')
  } else {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      .end(head + `<h1>已配对 DSH Web</h1><p>${req.headers.host}${req.url}</p><p id=u></p>`
        + '<p id=o>no session link</p><script>u.textContent=navigator.userAgent;'
        + 'addEventListener("dsh-remote-open",()=>{o.textContent="打开会话："+__dshRemoteOpen.splice(0).join(",")})</script>')
  }
}).listen(port, () => { console.log('mock on', port) })
