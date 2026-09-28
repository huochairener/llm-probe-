// 最小化内存 WebDAV 服务器，仅用于驱动 scripts/test-webdav.mjs
// 支持：Basic Auth、MKCOL（幂等）、PUT、GET、PROPFIND Depth:0、OPTIONS
// 不支持除上述以外的方法——够跑通黑盒脚本即可。
import http from 'node:http'

const USER = process.env.WEBDAV_USER || 'user'
const PASS = process.env.WEBDAV_PASS || 'pass'
const PORT = Number(process.env.WEBDAV_PORT || 8080)

// 内存文件系统：path -> Buffer。目录用结尾 '/' 标记为空字符串占位
const files = new Map()

function auth(req) {
  const h = req.headers.authorization || ''
  if (!h.startsWith('Basic ')) return false
  const decoded = Buffer.from(h.slice(6), 'base64').toString('utf8')
  const [u, p] = decoded.split(':')
  return u === USER && p === PASS
}

const server = http.createServer((req, res) => {
  if (!auth(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="webdav"' })
    res.end('auth required')
    return
  }
  const url = new URL(req.url, `http://localhost`)
  const p = url.pathname
  switch (req.method) {
    case 'OPTIONS':
      res.writeHead(200, {
        'DAV': '1,2',
        'Allow': 'OPTIONS,GET,PUT,MKCOL,PROPFIND',
      })
      res.end()
      break
    case 'MKCOL': {
      // 目录已存在视为 405（幂等成功）
      const dirKey = p.endsWith('/') ? p : p + '/'
      if (files.has(dirKey)) {
        res.writeHead(405); res.end('already exists')
      } else {
        files.set(dirKey, '')
        res.writeHead(201); res.end('created')
      }
      break
    }
    case 'PUT': {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        files.set(p, Buffer.concat(chunks))
        res.writeHead(201); res.end('created')
      })
      break
    }
    case 'GET': {
      if (!files.has(p)) { res.writeHead(404); res.end('not found'); break }
      const buf = files.get(p)
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      res.end(buf)
      break
    }
    case 'PROPFIND': {
      // Depth:0 只需返回该资源自身的 prop。根路径 / 视为始终存在。
      const exists = p === '/' || files.has(p) || files.has(p.endsWith('/') ? p : p + '/')
      if (!exists) { res.writeHead(404); res.end('not found'); break }
      const body = `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"><D:response><D:href>${p}</D:href></D:response></D:multistatus>`
      res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' })
      res.end(body)
      break
    }
    default:
      res.writeHead(405); res.end('method not allowed')
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock webdav listening on http://127.0.0.1:${PORT} (user=${USER})`)
})
