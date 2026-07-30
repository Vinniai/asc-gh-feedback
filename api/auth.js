import { makeSession, readSession, sessionCookie, clearCookie } from '../src/saas/session.js'

const json = (status, obj, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...headers } })
const redirect = (to, headers = {}) => new Response(null, { status: 302, headers: { Location: to, ...headers } })

export async function GET(request) {
  const env = process.env
  const url = new URL(request.url)
  const action = url.searchParams.get('action') || 'me'
  const origin = url.origin

  if (action === 'login') {
    if (!env.GH_OAUTH_CLIENT_ID) return json(500, { error: 'GitHub OAuth not configured (GH_OAUTH_CLIENT_ID missing)' })
    const state = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('')
    const auth = new URL('https://github.com/login/oauth/authorize')
    auth.searchParams.set('client_id', env.GH_OAUTH_CLIENT_ID)
    auth.searchParams.set('redirect_uri', `${origin}/api/auth?action=callback`)
    auth.searchParams.set('scope', 'read:user')
    auth.searchParams.set('state', state)
    return redirect(auth.toString(), { 'Set-Cookie': `fl_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600` })
  }

  if (action === 'callback') {
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const cookieState = (request.headers.get('cookie') || '').match(/(?:^|;\s*)fl_state=([^;]+)/)?.[1]
    if (!code || !state || state !== cookieState) return json(400, { error: 'invalid oauth state' })

    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: env.GH_OAUTH_CLIENT_ID, client_secret: env.GH_OAUTH_CLIENT_SECRET, code })
    })
    const tok = await tokenRes.json()
    if (!tok.access_token) return json(401, { error: 'oauth exchange failed' })

    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${tok.access_token}`, 'User-Agent': 'feedbackloop' }
    })
    const u = await userRes.json()
    if (!u.login) return json(401, { error: 'could not read GitHub user' })

    const sess = await makeSession(env, { login: u.login, avatar: u.avatar_url, name: u.name || u.login })
    return redirect('/dash.html', { 'Set-Cookie': sessionCookie(sess) })
  }

  if (action === 'logout') return redirect('/', { 'Set-Cookie': clearCookie() })

  const user = await readSession(env, request)
  return user ? json(200, { user }) : json(401, { error: 'not signed in' })
}
