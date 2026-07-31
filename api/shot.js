import { getTenant } from '../src/saas/store.js'

const enc = new TextEncoder()

export async function shotSig(secret, tenant, sub, n) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`shot:${tenant}/${sub}/${n}`)))
  return [...mac.slice(0, 16)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function GET(request) {
  const env = process.env
  const url = new URL(request.url)
  const tenant = url.searchParams.get('tenant')
  const sub = url.searchParams.get('sub')
  const n = url.searchParams.get('n')
  const sig = url.searchParams.get('s')
  if (!tenant || !sub || !n || !sig) return new Response('missing params', { status: 400 })
  if (!/^[\w-]+$/.test(sub) || !/^\d+$/.test(n)) return new Response('bad params', { status: 400 })

  if (sig !== await shotSig(env.TENANT_ENC_KEY, tenant, sub, n)) return new Response('forbidden', { status: 403 })
  const t = await getTenant(env, tenant)
  if (!t) return new Response('unknown tenant', { status: 404 })

  const path = `${t.assetDir || '.testflight/feedback'}/${sub}/screenshot-${n}.png`
  const res = await fetch(`https://api.github.com/repos/${t.repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`, {
    headers: {
      Authorization: `Bearer ${t.githubToken}`,
      Accept: 'application/vnd.github.raw+json',
      'User-Agent': 'appshake'
    }
  })
  if (!res.ok) return new Response('not found', { status: 404 })
  return new Response(res.body, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable'
    }
  })
}
