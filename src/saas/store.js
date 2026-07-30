const enc = new TextEncoder()
const dec = new TextDecoder()

const b64 = (u8) => btoa(String.fromCharCode(...u8))
const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0))

async function aesKey(env) {
  const raw = unb64(env.TENANT_ENC_KEY)
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptTenant(env, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), enc.encode(JSON.stringify(obj))))
  return b64(iv) + '.' + b64(ct)
}

export async function decryptTenant(env, blob) {
  const [iv, ct] = blob.trim().split('.')
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aesKey(env), unb64(ct))
  return JSON.parse(dec.decode(pt))
}

async function gh(env, method, path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.SERVICE_GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'asc-gh-feedback-saas',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`tenant store ${res.status} ${method} ${path}: ${(await res.text()).slice(0, 300)}`)
  return res.json()
}

export async function getTenant(env, id) {
  if (!/^[a-z0-9-]{6,40}$/.test(id)) return null
  const file = await gh(env, 'GET', `/repos/${env.TENANT_STORE_REPO}/contents/tenants/${id}.json`)
  if (!file) return null
  const blob = atob(file.content.replace(/\n/g, ''))
  return decryptTenant(env, blob)
}

export async function putTenant(env, id, tenant) {
  const existing = await gh(env, 'GET', `/repos/${env.TENANT_STORE_REPO}/contents/tenants/${id}.json`)
  const content = btoa(await encryptTenant(env, tenant))
  await gh(env, 'PUT', `/repos/${env.TENANT_STORE_REPO}/contents/tenants/${id}.json`, {
    message: `tenant ${id}`,
    content,
    ...(existing ? { sha: existing.sha } : {})
  })
}
