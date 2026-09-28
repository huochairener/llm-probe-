import { readConfigs, readSettings, writeConfigs, writeSettings, verifyPassword, type Config, type Settings, type WebdavConfig } from './storage.js'

const BACKUP_PATH = 'llm-probe-backup/backup.json'

export interface BackupPackage {
  version: 1
  createdAt: number
  configs: Config[]
  settings: Settings
}

export interface BackupResult {
  ok: true
  count: number
  createdAt: number
}

export interface RestoreResult {
  ok: true
  count: number
}

function basicAuth(username: string, password: string): string {
  return 'Basic ' + Buffer.from(`${username}:${password}`, 'utf8').toString('base64')
}

/** 规范化根 URL：保证结尾有且仅有一个斜杠 */
function normalizeRoot(url: string): string {
  return url.endsWith('/') ? url : url + '/'
}

function backupUrl(webdav: WebdavConfig): string {
  return normalizeRoot(webdav.url) + BACKUP_PATH
}

function dirUrl(webdav: WebdavConfig): string {
  return normalizeRoot(webdav.url) + 'llm-probe-backup/'
}

/** 测试连接：PROPFIND Depth:0 */
export async function testConnection(webdav: WebdavConfig, password: string): Promise<{ ok: true }> {
  const res = await fetch(normalizeRoot(webdav.url), {
    method: 'PROPFIND',
    headers: {
      Authorization: basicAuth(webdav.username, password),
      Depth: '0',
    },
  })
  // 很多 WebDAV 对 PROPFIND 返回 207 Multi-Status；401/403/404 才算失败
  if (res.status === 401 || res.status === 403) {
    throw new Error('WebDAV 认证失败（用户名/密码错误）')
  }
  if (res.status >= 400) {
    throw new Error(`WebDAV 连接失败：HTTP ${res.status}`)
  }
  return { ok: true }
}

/** 确保备份目录存在（MKCOL，已存在则 405，视为成功） */
async function ensureDir(webdav: WebdavConfig, password: string): Promise<void> {
  const res = await fetch(dirUrl(webdav), {
    method: 'MKCOL',
    headers: { Authorization: basicAuth(webdav.username, password) },
  })
  if (res.status === 201 || res.status === 200 || res.status === 405) return
  if (res.status === 401 || res.status === 403) {
    throw new Error('WebDAV 认证失败')
  }
  throw new Error(`创建备份目录失败：HTTP ${res.status}`)
}

async function pushBackup(webdav: WebdavConfig, password: string, body: string): Promise<void> {
  const res = await fetch(backupUrl(webdav), {
    method: 'PUT',
    headers: {
      Authorization: basicAuth(webdav.username, password),
      'Content-Type': 'application/json',
    },
    body,
  })
  if (res.status === 401 || res.status === 403) throw new Error('WebDAV 认证失败')
  if (!res.ok) throw new Error(`备份写入失败：HTTP ${res.status}`)
}

async function pullBackup(webdav: WebdavConfig, password: string): Promise<string> {
  const res = await fetch(backupUrl(webdav), {
    method: 'GET',
    headers: { Authorization: basicAuth(webdav.username, password) },
  })
  if (res.status === 401 || res.status === 403) throw new Error('WebDAV 认证失败')
  if (res.status === 404) throw new Error('远端没有备份文件，请先备份')
  if (!res.ok) throw new Error(`拉取备份失败：HTTP ${res.status}`)
  return res.text()
}

export async function doBackup(webdav: WebdavConfig, webdavPassword: string): Promise<BackupResult> {
  const configs = readConfigs()
  const settings = readSettings()
  const pkg: BackupPackage = {
    version: 1,
    createdAt: Date.now(),
    configs,
    settings,
  }
  await ensureDir(webdav, webdavPassword)
  await pushBackup(webdav, webdavPassword, JSON.stringify(pkg, null, 2))
  return { ok: true, count: configs.length, createdAt: pkg.createdAt }
}

export async function doRestore(webdav: WebdavConfig, webdavPassword: string, appPassword: string): Promise<RestoreResult> {
  const raw = await pullBackup(webdav, webdavPassword)
  let pkg: BackupPackage
  try {
    pkg = JSON.parse(raw)
  } catch {
    throw new Error('远端备份文件不是合法 JSON')
  }
  if (pkg.version !== 1 || !Array.isArray(pkg.configs) || !pkg.settings) {
    throw new Error('备份文件格式或版本不兼容')
  }
  if (!pkg.settings.hasPassword) {
    throw new Error('备份的 settings 缺少口令，无法安全恢复')
  }
  // 二次校验：当前应用口令必须能匹配备份里的口令 hash，否则恢复后 apiKey 解不开
  const matched = verifyPassword(appPassword, pkg.settings.passwordSalt, pkg.settings.passwordHash)
  if (!matched) {
    throw new Error('当前口令与备份中的口令不匹配，无法解密恢复出的 apiKey')
  }
  writeSettings(pkg.settings)
  writeConfigs(pkg.configs)
  return { ok: true, count: pkg.configs.length }
}
