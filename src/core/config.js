const req = (env, name) => {
  const v = env[name]
  if (!v) throw new Error(`Missing env: ${name}`)
  return v
}

export function makeConfig(env) {
  return {
    webhookSecret: req(env, 'ASC_WEBHOOK_SECRET'),
    asc: {
      keyId: req(env, 'ASC_KEY_ID'),
      issuerId: req(env, 'ASC_ISSUER_ID'),
      privateKey: () => {
        if (env.ASC_PRIVATE_KEY_B64) return atob(env.ASC_PRIVATE_KEY_B64)
        if (env.ASC_PRIVATE_KEY) return env.ASC_PRIVATE_KEY.replace(/\\n/g, '\n')
        throw new Error('Missing env: ASC_PRIVATE_KEY or ASC_PRIVATE_KEY_B64')
      },
      baseUrl: 'https://api.appstoreconnect.apple.com'
    },
    github: {
      token: req(env, 'GITHUB_TOKEN'),
      repo: req(env, 'GITHUB_REPO'),
      assetDir: env.GITHUB_ASSET_DIR || '.testflight/feedback',
      labels: (env.GITHUB_LABELS || 'testflight-feedback,needs-triage').split(',').map(s => s.trim()).filter(Boolean)
    },
    routine: {
      id: env.CLAUDE_ROUTINE_ID || '',
      token: env.CLAUDE_ROUTINE_TOKEN || '',
      fireUrl: (id) => `https://api.anthropic.com/v1/claude_code/routines/${id}/fire`
    }
  }
}
