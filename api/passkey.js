import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse
} from '@simplewebauthn/server'
import { readSession, makeSession, sessionCookie } from '../src/saas/session.js'
import { getUser, putUser } from '../src/saas/store.js'

const enc = new TextEncoder()
const json = (status, obj, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...headers } })

async function sign(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return Buffer.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)))).toString('base64url')
}

const chalCookie = async (env, challenge) =>
  `fl_chal=${challenge}.${await sign(env.SESSION_SECRET, challenge)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=300`

async function readChallenge(env, request) {
  const m = (request.headers.get('cookie') || '').match(/(?:^|;\s*)fl_chal=([^;]+)/)
  if (!m) return null
  const [challenge, sig] = m[1].split('.')
  if (await sign(env.SESSION_SECRET, challenge) !== sig) return null
  return challenge
}

export async function POST(request) {
  const env = process.env
  const url = new URL(request.url)
  const rpID = url.hostname
  const origin = url.origin
  let body
  try { body = await request.json() } catch { return json(400, { error: 'invalid json' }) }

  try {
    if (body.action === 'reg-options') {
      const user = await readSession(env, request)
      if (!user) return json(401, { error: 'sign in with GitHub first to add a passkey' })
      const rec = (await getUser(env, user.login)) || {}
      const options = await generateRegistrationOptions({
        rpName: 'AppShake',
        rpID,
        userName: user.login,
        userID: enc.encode(user.login),
        attestationType: 'none',
        excludeCredentials: (rec.passkeys || []).map(p => ({ id: p.id })),
        authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' }
      })
      return json(200, { options }, { 'Set-Cookie': await chalCookie(env, options.challenge) })
    }

    if (body.action === 'reg-verify') {
      const user = await readSession(env, request)
      if (!user) return json(401, { error: 'sign in first' })
      const expectedChallenge = await readChallenge(env, request)
      if (!expectedChallenge) return json(400, { error: 'challenge expired — try again' })
      const v = await verifyRegistrationResponse({
        response: body.credential,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID
      })
      if (!v.verified) return json(400, { error: 'passkey verification failed' })
      const rec = (await getUser(env, user.login)) || {}
      rec.passkeys = rec.passkeys || []
      const cred = v.registrationInfo.credential
      rec.passkeys.push({
        id: cred.id,
        publicKey: Buffer.from(cred.publicKey).toString('base64url'),
        counter: cred.counter,
        addedAt: new Date().toISOString()
      })
      rec.avatar = rec.avatar || user.avatar
      await putUser(env, user.login, rec)
      return json(200, { ok: true, passkeys: rec.passkeys.length })
    }

    if (body.action === 'login-options') {
      const options = await generateAuthenticationOptions({ rpID, userVerification: 'preferred', allowCredentials: [] })
      return json(200, { options }, { 'Set-Cookie': await chalCookie(env, options.challenge) })
    }

    if (body.action === 'login-verify') {
      const expectedChallenge = await readChallenge(env, request)
      if (!expectedChallenge) return json(400, { error: 'challenge expired — try again' })
      const userHandle = body.credential?.response?.userHandle
      if (!userHandle) return json(400, { error: 'no user handle in passkey' })
      const login = Buffer.from(userHandle, 'base64url').toString()
      const rec = await getUser(env, login)
      const pk = rec?.passkeys?.find(p => p.id === body.credential.id)
      if (!pk) return json(404, { error: 'passkey not recognized' })
      const v = await verifyAuthenticationResponse({
        response: body.credential,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: { id: pk.id, publicKey: Buffer.from(pk.publicKey, 'base64url'), counter: pk.counter || 0 }
      })
      if (!v.verified) return json(401, { error: 'passkey verification failed' })
      pk.counter = v.authenticationInfo.newCounter
      await putUser(env, login, rec)
      const sess = await makeSession(env, { login, avatar: rec.avatar || '', name: rec.name || login, ghToken: rec.ghToken || '' })
      return json(200, { ok: true, login }, { 'Set-Cookie': sessionCookie(sess) })
    }

    return json(400, { error: 'unknown action' })
  } catch (e) {
    return json(422, { error: e.message })
  }
}
