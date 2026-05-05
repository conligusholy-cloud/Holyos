// =============================================================================
// HolyOS — AI Vývojář / GitHub REST API (fetch)
// =============================================================================
// Minimální wrapper pro Fázi 1 — bez @octokit dep. Stačí: parseRepo, openPR,
// getPR. Token se předává explicitně, ne z env (ať to volající má pod kontrolou).

const GITHUB_API = 'https://api.github.com';

/**
 * Parse "https://github.com/foo/bar.git" / "[email protected]:foo/bar.git" / "foo/bar"
 * → { owner: 'foo', repo: 'bar' } | null pokud nelze rozpoznat.
 */
function parseRepo(gitUrl) {
  if (!gitUrl) return null;
  let m;
  // https://github.com/owner/repo(.git)?
  m = gitUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?\/?$/);
  if (m) return { owner: m[1], repo: m[2] };
  // [email protected]:owner/repo(.git)?
  m = gitUrl.match(/^git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (m) return { owner: m[1], repo: m[2] };
  // owner/repo
  m = gitUrl.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (m) return { owner: m[1], repo: m[2] };
  return null;
}

async function ghRequest(path, { method = 'GET', token, body } = {}) {
  if (!token) throw new Error('GitHub token chybí (AI_DEV_GITHUB_TOKEN)');
  const url = path.startsWith('http') ? path : `${GITHUB_API}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'HolyOS-AI-Vyvojar/1.0',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_e) { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(
      `GitHub API ${method} ${path} → ${res.status} ${res.statusText}: ${data?.message || text}`
    );
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function openPullRequest({ token, owner, repo, head, base, title, body }) {
  return ghRequest(`/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    token,
    body: { title, head, base, body, draft: false },
  });
}

async function getPullRequest({ token, owner, repo, number }) {
  return ghRequest(`/repos/${owner}/${repo}/pulls/${number}`, { token });
}

async function listRequiredCheckRuns({ token, owner, repo, ref }) {
  // Vrátí check_runs pro daný ref (sha nebo branch)
  return ghRequest(`/repos/${owner}/${repo}/commits/${ref}/check-runs`, { token });
}

module.exports = {
  parseRepo,
  ghRequest,
  openPullRequest,
  getPullRequest,
  listRequiredCheckRuns,
};
