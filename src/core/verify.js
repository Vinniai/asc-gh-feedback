const enc = new TextEncoder()

const toHex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')

export async function hmacHex(secret, bodyBytes) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return toHex(await crypto.subtle.sign('HMAC', key, bodyBytes))
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function verifySignature(bodyBytes, headers, secret) {
  const header = headers.get('x-apple-signature') || headers.get('x-apple-signature-sha256') || ''
  if (!header) return false
  const provided = header.replace(/^hmacsha256=/i, '').trim().toLowerCase()
  const digest = await hmacHex(secret, bodyBytes)
  return constantTimeEqual(provided, digest)
}
