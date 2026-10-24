// 通信加密层
// HKDF-SHA256(ikm, salt, info="v1") -> AES-256-GCM
// 封包: base64( [ver(1)] | iv(12) | ciphertext | tag(16) )
//
// 密钥来源优先级:环境变量 > 内置默认值
// 生产部署请务必设置 CRYPTO_IKM / CRYPTO_SALT（32 字节十六进制），
// 一旦更换密钥，旧的前端缓存会解不开，需重新登录。
import crypto from 'node:crypto';
import { randomBytes } from 'node:crypto';

const DEFAULT_IKM  = 'c7a1f3e8b2d4096517a8c3e5f2b406981d3a7e9c0b5f284716d9e3a1c8b50f72';
const DEFAULT_SALT = '7f3c9e1da4b8e2f631d7c05af9826b4e';

function normalizeHex(input, fallback, bytes = 32) {
  const v = String(input || '').trim();
  if (/^[0-9a-fA-F]+$/.test(v) && v.length >= bytes * 2) return v.slice(0, bytes * 2);
  return fallback;
}

const IKM_HEX  = normalizeHex(process.env.CRYPTO_IKM, DEFAULT_IKM, 32);
const SALT_HEX = normalizeHex(process.env.CRYPTO_SALT, DEFAULT_SALT, 16);

const IKM  = Buffer.from(IKM_HEX, 'hex');
const SALT = Buffer.from(SALT_HEX, 'hex');
const INFO = Buffer.from('v1', 'utf8');
const VER  = 1;

const KEY = Buffer.from(crypto.hkdfSync('sha256', IKM, SALT, INFO, 32));

export function encryptPayload(obj) {
  const iv = crypto.randomBytes(12);
  const c  = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final(), c.getAuthTag()]);
  return Buffer.concat([Buffer.from([VER]), iv, ct]).toString('base64');
}

export function decryptPayload(b64) {
  const buf = Buffer.from(String(b64), 'base64');
  if (!buf.length || buf[0] !== VER) throw new Error('payload version mismatch');
  const iv = buf.subarray(1, 13);
  const rest = buf.subarray(13);
  const tag = rest.subarray(rest.length - 16);
  const ct = rest.subarray(0, rest.length - 16);
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString('utf8'));
}

/** 生成一套新的密钥(部署时可用它生成自己的) */
export function generateKeyPair() {
  return {
    CRYPTO_IKM: randomBytes(32).toString('hex'),
    CRYPTO_SALT: randomBytes(16).toString('hex'),
  };
}
