import { makeSession, readSession, sessionCookie, clearCookie } from '../src/saas/session.js'
import { getUser, putUser } from '../src/saas/store.js'

const json = (status, obj, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...headers } })
const redirect = (to, headers = {}) => new Response(null, { status: 302, headers: { Location: to, ...headers } })

const workosEnabled = (env) => Boolean(env.WORKOS_CLIENT_ID && env.WORKOS_API_KEY)

const cleanNext = (url) => (url.searchParams.get('next') || '/dash.html').match(/^\/[\w./?=&-]*$/)?.[0] || '/dash.html'

const stateCookie = (state, nextPath) =>
  `fl_state=${state}.${encodeURIComponent(nextPath)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`

const readState = (request) => {
  const raw = (request.headers.get('cookie') || '').match(/(?:^|;\s*)fl_state=([^;]+)/)?.[1] || ''
  const dot = raw.indexOf('.')
  const state = dot === -1 ? raw : raw.slice(0, dot)
  const encodedNext = dot === -1 ? '' : raw.slice(dot + 1)
  return { state, nextPath: decodeURIComponent(encodedNext || '%2Fdash.html') }
}

const newState = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('')

function githubAuthorize(env, origin, state) {
  const auth = new URL('https://github.com/login/oauth/authorize')
  auth.searchParams.set('client_id', env.GH_OAUTH_CLIENT_ID)
  auth.searchParams.set('redirect_uri', `${origin}/api/auth?action=callback`)
  auth.searchParams.set('scope', 'read:user repo')
  auth.searchParams.set('state', state)
  return auth.toString()
}

const CANONICAL = 'https://appshake.tocld.com'

export async function GET(request) {
  const env = process.env
  const url = new URL(request.url)
  const action = url.searchParams.get('action') || 'me'
  let origin = url.origin
  if (['login', 'github'].includes(action) && url.hostname.endsWith('.vercel.app')) {
    return redirect(`${CANONICAL}${url.pathname}${url.search}`)
  }

  if (action === 'config') return json(200, { workos: workosEnabled(env), github: Boolean(env.GH_OAUTH_CLIENT_ID) })

  if (action === 'login') {
    const nextPath = cleanNext(url)
    const state = newState()
    if (workosEnabled(env)) {
      const a = new URL('https://api.workos.com/user_management/authorize')
      a.searchParams.set('client_id', env.WORKOS_CLIENT_ID)
      a.searchParams.set('redirect_uri', `${origin}/api/auth/callback`)
      a.searchParams.set('response_type', 'code')
      a.searchParams.set('provider', url.searchParams.get('provider') || 'authkit')
      a.searchParams.set('state', state)
      return redirect(a.toString(), { 'Set-Cookie': stateCookie(state, nextPath) })
    }
    if (!env.GH_OAUTH_CLIENT_ID) return json(500, { error: 'no auth provider configured' })
    return redirect(githubAuthorize(env, origin, state), { 'Set-Cookie': stateCookie(state, nextPath) })
  }

  if (action === 'github') {
    if (!env.GH_OAUTH_CLIENT_ID) return json(500, { error: 'GitHub OAuth not configured' })
    const nextPath = cleanNext(url)
    const state = newState()
    return redirect(githubAuthorize(env, origin, state), { 'Set-Cookie': stateCookie(state, nextPath) })
  }

  if (action === 'workos-callback') {
    const provErr = url.searchParams.get('error_description') || url.searchParams.get('error')
    if (provErr) return redirect(`/dash.html?autherr=${encodeURIComponent(provErr.slice(0, 300))}`)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const { state: cookieState, nextPath } = readState(request)
    if (!code) return redirect('/dash.html?autherr=' + encodeURIComponent('No authorization code returned — try signing in again.'))
    if (!state || state !== cookieState) return redirect('/dash.html?autherr=' + encodeURIComponent('Sign-in session expired (state mismatch) — please try again.'))

    const res = await fetch('https://api.workos.com/user_management/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: env.WORKOS_CLIENT_ID,
        client_secret: env.WORKOS_API_KEY,
        grant_type: 'authorization_code',
        code
      })
    })
    const data = await res.json()
    if (!res.ok || !data.user) {
      console.error(`workos authenticate: ${res.status} ${JSON.stringify(data).slice(0, 300)}`)
      const detail = data.error_description || data.error || data.message || `authentication failed (${res.status})`
      return redirect('/dash.html?autherr=' + encodeURIComponent(String(detail).slice(0, 300)))
    }
    const wu = data.user
    const uid = wu.id

    let ghToken = '', ghLogin = ''
    const toks = [].concat(data.oauth_tokens || [])
    const gh = toks.find(t => (t?.provider || '').toLowerCase().includes('github')) || (data.oauth_tokens && !Array.isArray(data.oauth_tokens) ? data.oauth_tokens : null)
    if (gh?.access_token) {
      ghToken = gh.access_token
      try {
        const gu = await (await fetch('https://api.github.com/user', {
          headers: { Authorization: `Bearer ${ghToken}`, 'User-Agent': 'appshake' }
        })).json()
        ghLogin = gu.login || ''
      } catch {}
    }

    let rec = {}
    try {
      rec = (await getUser(env, uid)) || {}
      await putUser(env, uid, {
        ...rec,
        email: wu.email,
        name: [wu.first_name, wu.last_name].filter(Boolean).join(' ') || wu.email,
        avatar: wu.profile_picture_url || rec.avatar || '',
        ...(ghToken ? { ghToken, ghLogin: ghLogin || rec.ghLogin || '' } : {})
      })
    } catch (e) { console.error(`user record: ${e.message}`) }

    const sess = await makeSession(env, {
      uid,
      login: ghLogin || rec.ghLogin || wu.email,
      name: [wu.first_name, wu.last_name].filter(Boolean).join(' ') || wu.email,
      avatar: wu.profile_picture_url || rec.avatar || '',
      ghToken: ghToken || rec.ghToken || '',
      ghLogin: ghLogin || rec.ghLogin || ''
    })
    return redirect(nextPath, { 'Set-Cookie': sessionCookie(sess) })
  }

  if (action === 'callback') {
    const provErr = url.searchParams.get('error_description') || url.searchParams.get('error')
    if (provErr) return redirect(`/dash.html?autherr=${encodeURIComponent(provErr.slice(0, 300))}`)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const { state: cookieState, nextPath } = readState(request)
    if (!code || !state || state !== cookieState) return redirect('/dash.html?autherr=' + encodeURIComponent('Sign-in session expired — please try again.'))

    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: env.GH_OAUTH_CLIENT_ID, client_secret: env.GH_OAUTH_CLIENT_SECRET, code })
    })
    const tok = await tokenRes.json()
    if (!tok.access_token) return json(401, { error: 'oauth exchange failed' })

    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${tok.access_token}`, 'User-Agent': 'appshake' }
    })
    const u = await userRes.json()
    if (!u.login) return json(401, { error: 'could not read GitHub user' })

    const existing = await readSession(env, request)
    if (existing?.uid) {
      try {
        const rec = (await getUser(env, existing.uid)) || {}
        await putUser(env, existing.uid, { ...rec, ghToken: tok.access_token, ghLogin: u.login })
      } catch (e) { console.error(`user record: ${e.message}`) }
      const sess = await makeSession(env, { ...existing, ghToken: tok.access_token, ghLogin: u.login })
      return redirect(nextPath, { 'Set-Cookie': sessionCookie(sess) })
    }

    try {
      const rec = (await getUser(env, u.login)) || {}
      await putUser(env, u.login, { ...rec, ghToken: tok.access_token, ghLogin: u.login, avatar: u.avatar_url, name: u.name || u.login })
    } catch (e) { console.error(`user record: ${e.message}`) }

    const sess = await makeSession(env, { login: u.login, ghLogin: u.login, avatar: u.avatar_url, name: u.name || u.login, ghToken: tok.access_token })
    return redirect(nextPath, { 'Set-Cookie': sessionCookie(sess) })
  }

  if (action === 'logout') return redirect('/', { 'Set-Cookie': clearCookie() })

  const user = await readSession(env, request)
  return user ? json(200, { user: { ...user, ghToken: undefined } }) : json(401, { error: 'not signed in' })
}
