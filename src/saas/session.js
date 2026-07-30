const enc = new TextEncoder()

const b64url = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))

async function sign(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data))))
}

export async function makeSession(env, user) {
  const payload = b64url(enc.encode(JSON.stringify({ ...user, exp: Date.now() + 30 * 86400e3 })))
  return `${payload}.${await sign(env.SESSION_SECRET, payload)}`
}

export async function readSession(env, request) {
  if (!env.SESSION_SECRET) return null
  const cookie = request.headers.get('cookie') || ''
  const m = cookie.match(/(?:^|;\s*)fl_sess=([^;]+)/)
  if (!m) return null
  const [payload, sig] = m[1].split('.')
  if (!payload || !sig) return null
  if (await sign(env.SESSION_SECRET, payload) !== sig) return null
  try {
    const user = JSON.parse(new TextDecoder().decode(unb64url(payload)))
    if (!user.exp || Date.now() > user.exp) return null
    return user
  } catch { return null }
}

export const sessionCookie = (value, maxAge = 30 * 86400) =>
  `fl_sess=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`

export const clearCookie = () => 'fl_sess=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
