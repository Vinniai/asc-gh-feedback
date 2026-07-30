const api = 'https://api.github.com'
let defaultBranch = null

function toBase64(bytes) {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

async function gh(cfg, method, path, body) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.github.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'asc-gh-feedback',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  if (!res.ok) throw new Error(`GitHub ${res.status} ${method} ${path}: ${(await res.text()).slice(0, 500)}`)
  return res.json()
}

async function branch(cfg) {
  if (defaultBranch) return defaultBranch
  const repo = await gh(cfg, 'GET', `/repos/${cfg.github.repo}`)
  defaultBranch = repo.default_branch
  return defaultBranch
}

export async function alreadyFiled(cfg, submissionId) {
  const q = encodeURIComponent(`repo:${cfg.github.repo} in:body "asc-feedback-id: ${submissionId}"`)
  const res = await gh(cfg, 'GET', `/search/issues?q=${q}`)
  return res.total_count > 0 ? res.items[0].html_url : null
}

export async function uploadScreenshot(cfg, submissionId, index, bytes) {
  const path = `${cfg.github.assetDir}/${submissionId}/screenshot-${index + 1}.png`
  await gh(cfg, 'PUT', `/repos/${cfg.github.repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`, {
    message: `chore: testflight feedback screenshot ${submissionId} #${index + 1}`,
    content: toBase64(bytes)
  })
  return `https://raw.githubusercontent.com/${cfg.github.repo}/${await branch(cfg)}/${path}`
}

const fmtBytes = (n) => n == null ? null : `${(n / 1e9).toFixed(2)} GB`

export async function createIssue(cfg, fb, screenshotLinks) {
  const title = fb.kind === 'crash'
    ? `[TestFlight][Crash] ${fb.comment?.slice(0, 80) || `Crash on ${fb.device || 'unknown device'} (${fb.osVersion || '?'})`}`
    : `[TestFlight] ${fb.comment?.slice(0, 80) || `Screenshot feedback from ${fb.device || 'tester'}`}`

  const meta = [
    ['App', fb.appName && fb.bundleId ? `${fb.appName} (${fb.bundleId})` : fb.appName || fb.bundleId],
    ['Version / Build', [fb.appVersion, fb.build].filter(Boolean).join(' / ')],
    ['Submitted', fb.createdDate],
    ['Tester', fb.email],
    ['Device', fb.device],
    ['OS', fb.osVersion],
    ['Platform', fb.appPlatform],
    ['Locale / TZ', [fb.locale, fb.timeZone].filter(Boolean).join(' / ')],
    ['Connection', fb.connectionType],
    ['Battery', fb.batteryPercentage != null ? `${fb.batteryPercentage}%` : null],
    ['Disk free', fmtBytes(fb.diskBytesAvailable)],
    ['App uptime', fb.appUptimeMs != null ? `${Math.round(fb.appUptimeMs / 1000)}s` : null]
  ].filter(([, v]) => v)

  const body = [
    `## TestFlight ${fb.kind === 'crash' ? 'crash report' : 'feedback'}`,
    '',
    fb.comment ? `> ${fb.comment.replace(/\n/g, '\n> ')}` : '_No comment provided._',
    '',
    '| Field | Value |',
    '| --- | --- |',
    ...meta.map(([k, v]) => `| ${k} | ${v} |`),
    '',
    ...(screenshotLinks.length
      ? ['## Screenshots', '', ...screenshotLinks.map((u, i) => `![screenshot ${i + 1}](${u})`), '']
      : []),
    ...(fb.crashText
      ? ['## Crash log', '', '<details><summary>Expand crash log</summary>', '', '```', fb.crashText, '```', '', '</details>', '']
      : []),
    '---',
    `<!-- asc-feedback-id: ${fb.id} -->`,
    `asc-feedback-id: ${fb.id}`
  ].join('\n')

  const issue = await gh(cfg, 'POST', `/repos/${cfg.github.repo}/issues`, {
    title,
    body,
    labels: [...cfg.github.labels, ...(fb.kind === 'crash' ? ['crash'] : [])]
  })
  return issue.html_url
}
