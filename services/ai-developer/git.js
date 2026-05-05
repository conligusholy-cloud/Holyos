// =============================================================================
// HolyOS — AI Vývojář / git wrapper (přes child_process git CLI)
// =============================================================================
// Žádný simple-git dep — voláme system git binárku. Postačuje pro Fázi 1.
// Token pro HTTPS clone se vkládá do URL: https://x-access-token:TOKEN@github.com/...

const { spawn } = require('child_process');

function runGit(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: opts.cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...(opts.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        const err = new Error(`git ${args.join(' ')} exited ${code}: ${stderr.trim()}`);
        err.code = code;
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      }
    });
  });
}

function authedHttpsUrl(gitUrl, token) {
  if (!token) return gitUrl;
  if (!gitUrl.startsWith('https://')) return gitUrl;
  // https://github.com/foo/bar.git → https://x-access-token:TOKEN@github.com/foo/bar.git
  return gitUrl.replace('https://', `https://x-access-token:${token}@`);
}

async function clone({ gitUrl, branch, dir, token, depth = 1 }) {
  const url = authedHttpsUrl(gitUrl, token);
  const args = ['clone', '--depth', String(depth)];
  if (branch) args.push('--branch', branch);
  args.push(url, dir);
  await runGit(args);
}

async function checkoutNewBranch({ cwd, branch }) {
  await runGit(['checkout', '-b', branch], { cwd });
}

async function setIdentity({ cwd, name, email }) {
  await runGit(['config', 'user.name', name], { cwd });
  await runGit(['config', 'user.email', email], { cwd });
}

async function statusPorcelain({ cwd }) {
  const { stdout } = await runGit(['status', '--porcelain'], { cwd });
  return stdout.split('\n').filter(Boolean).map((line) => {
    const status = line.slice(0, 2);
    const path = line.slice(3);
    return { status, path };
  });
}

async function addAll({ cwd }) {
  await runGit(['add', '-A'], { cwd });
}

async function commit({ cwd, message }) {
  await runGit(['commit', '-m', message], { cwd });
}

async function push({ cwd, branch, token, gitUrl }) {
  // Použij authed URL pro push (jinak by HTTPS clone bez tokenu selhal)
  const url = authedHttpsUrl(gitUrl, token);
  await runGit(['push', url, branch], { cwd });
}

async function getHeadSha({ cwd }) {
  const { stdout } = await runGit(['rev-parse', 'HEAD'], { cwd });
  return stdout.trim();
}

async function getChangedFiles({ cwd, fromBranch = 'origin/main' }) {
  try {
    const { stdout } = await runGit(['diff', '--name-only', fromBranch, 'HEAD'], { cwd });
    return stdout.split('\n').filter(Boolean);
  } catch (_e) {
    // Fallback: jen aktuální status
    const status = await statusPorcelain({ cwd });
    return status.map((s) => s.path);
  }
}

module.exports = {
  runGit,
  authedHttpsUrl,
  clone,
  checkoutNewBranch,
  setIdentity,
  statusPorcelain,
  addAll,
  commit,
  push,
  getHeadSha,
  getChangedFiles,
};
