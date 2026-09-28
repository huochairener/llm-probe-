// WebDAV 同步全链路手测脚本（黑盒，对运行中的服务发 HTTP）
//
// 前置：
//   1. pnpm dev（或 pnpm start）已起，http://127.0.0.1:3173 可用
//   2. 已设置口令并解锁——把解锁后的 token 放到环境变量 SESSION
//   3. WebDAV 凭据放到环境变量：
//        WEBDAV_URL / WEBDAV_USER / WEBDAV_PASS
//
// 用法：
//   BASE=http://127.0.0.1:3173 SESSION=<token> \
//   WEBDAV_URL=https://dav.example.com/dav/ WEBDAV_USER=user WEBDAV_PASS=pass \
//   node scripts/test-webdav.mjs
//
// 本地 WebDAV 快速起一个（用于测试）：
//   rclone serve webdav ./webdav-root --addr :8080 --user user pass

const BASE = process.env.BASE || 'http://127.0.0.1:3173'
const SESSION = process.env.SESSION
const { WEBDAV_URL, WEBDAV_USER, WEBDAV_PASS } = process.env

if (!SESSION || !WEBDAV_URL || !WEBDAV_USER || !WEBDAV_PASS) {
  console.error('请设置 SESSION / WEBDAV_URL / WEBDAV_USER / WEBDAV_PASS 环境变量')
  process.exit(1)
}

const headers = { 'Content-Type': 'application/json', 'x-session': SESSION }
let pass = 0, fail = 0

function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.error(`  ✗ ${name} ${detail}`) }
}

async function main() {
  // 1. status 初始应为未配置（注意：若本机已配过 webdav，此项会失败——
  //    测试前请删除 server/data/webdav.json 以获得干净状态）
  let r = await fetch(`${BASE}/api/sync/status`, { headers })
  let j = await r.json()
  check('GET /status 初始 configured=false', j.configured === false, JSON.stringify(j))

  // 2. 保存凭据
  r = await fetch(`${BASE}/api/sync/config`, {
    method: 'PUT', headers,
    body: JSON.stringify({ url: WEBDAV_URL, username: WEBDAV_USER, password: WEBDAV_PASS }),
  })
  j = await r.json()
  check('PUT /config 保存成功', r.ok && j.ok, JSON.stringify(j))

  // 3. status 现在应返回已配置但不带密码
  r = await fetch(`${BASE}/api/sync/status`, { headers })
  j = await r.json()
  check('GET /status 已配置且不泄漏密码', j.configured === true && j.url === WEBDAV_URL && !('passwordCipher' in j), JSON.stringify(j))

  // 4. 测试连接
  r = await fetch(`${BASE}/api/sync/test`, { method: 'POST', headers, body: '{}' })
  j = await r.json()
  check('POST /test 连接成功', r.ok && j.ok, JSON.stringify(j))

  // 5. 备份
  r = await fetch(`${BASE}/api/sync/backup`, { method: 'POST', headers, body: '{}' })
  j = await r.json()
  check('POST /backup 备份成功', r.ok && typeof j.count === 'number', JSON.stringify(j))
  const backupCount = j.count

  // 6. 二次备份（验证 MKCOL 405 幂等，目录已存在不应失败）
  r = await fetch(`${BASE}/api/sync/backup`, { method: 'POST', headers, body: '{}' })
  j = await r.json()
  check('POST /backup 二次备份成功（MKCOL 幂等）', r.ok && j.count === backupCount, JSON.stringify(j))

  // 7. 恢复（口令正确，应成功并清 session）
  r = await fetch(`${BASE}/api/sync/restore`, { method: 'POST', headers, body: '{}' })
  j = await r.json()
  check('POST /restore 恢复成功', r.ok && j.count === backupCount, JSON.stringify(j))

  // 8. 恢复后旧 session 应失效（clearSessions）
  r = await fetch(`${BASE}/api/configs`, { headers })
  check('恢复后旧 session 失效（401）', r.status === 401, `status=${r.status}`)

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
