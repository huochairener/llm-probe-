import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isSea, getAsset } from 'node:sea'

// esbuild 打包成 CJS 后 import.meta.url 会变成 undefined，这里兜底
const __dirname = (() => {
  try {
    return path.dirname(fileURLToPath(import.meta.url))
  } catch {
    return process.cwd()
  }
})()
// SEA 单文件打包时，数据目录落在 exe 同目录；否则用源码相对路径
const DATA_BASE = isSea() ? path.dirname(process.execPath) : path.join(__dirname, '..')
const DATA_DIR = path.join(DATA_BASE, 'data')
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')
const CONFIGS_FILE = path.join(DATA_DIR, 'configs.json')

export interface Settings {
  hasPassword: boolean
  passwordSalt: string
  passwordHash: string
}

export interface Config {
  id: string
  name: string
  protocol: 'openai' | 'anthropic' | 'ollama' | 'custom'
  baseUrl: string
  apiKeyCipher: string
  modelId: string
  prompt: string
  params: {
    temperature: number
    maxTokens: number
    topP: number
    stream: boolean
  }
  customHeaders: Record<string, string>
  customBodyTemplate: string
  createdAt: number
  updatedAt: number
}

export function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

export function readSettings(): Settings {
  if (!fs.existsSync(SETTINGS_FILE)) {
    return { hasPassword: false, passwordSalt: '', passwordHash: '' }
  }
  return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
}

export function writeSettings(s: Settings) {
  ensureDataDir()
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2))
}

export function readConfigs(): Config[] {
  if (!fs.existsSync(CONFIGS_FILE)) return []
  try {
    return JSON.parse(fs.readFileSync(CONFIGS_FILE, 'utf8'))
  } catch {
    return []
  }
}

export function writeConfigs(list: Config[]) {
  ensureDataDir()
  fs.writeFileSync(CONFIGS_FILE, JSON.stringify(list, null, 2))
}

// 口令 hash：scrypt
export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(password, salt, 32)
  return { salt: salt.toString('base64'), hash: hash.toString('base64') }
}

export function verifyPassword(password: string, saltB64: string, hashB64: string) {
  try {
    const salt = Buffer.from(saltB64, 'base64')
    const expected = Buffer.from(hashB64, 'base64')
    const actual = crypto.scryptSync(password, salt, 32)
    if (expected.length !== actual.length) return false
    return crypto.timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

// apiKey 加密：scrypt 派生密钥 + AES-256-GCM
// 密文打包格式: base64( salt(16) || iv(12) || ciphertext || authTag(16) )
// @fastify/static 可能用 require 加载 assets（ESM createRequire 在 SEA 下不可用），
// 这里用全局 require 兜底，把 SEA 内嵌资源读出为 Buffer
export function readSeaAsset(key: string): Buffer | null {
  try {
    if (!isSea()) return null
    return Buffer.from(getAsset(key) as ArrayBuffer)
  } catch {
    return null
  }
}

export function encryptApiKey(password: string, plaintext: string): string {
  const salt = crypto.randomBytes(16)
  const key = crypto.scryptSync(password, salt, 32)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([salt, iv, enc, tag]).toString('base64')
}

export function decryptApiKey(password: string, packed: string): string {
  const buf = Buffer.from(packed, 'base64')
  if (buf.length < 16 + 12 + 16) throw new Error('密文格式无效')
  const salt = buf.subarray(0, 16)
  const iv = buf.subarray(16, 28)
  const tag = buf.subarray(buf.length - 16)
  const enc = buf.subarray(28, buf.length - 16)
  const key = crypto.scryptSync(password, salt, 32)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const dec = Buffer.concat([decipher.update(enc), decipher.final()])
  return dec.toString('utf8')
}
