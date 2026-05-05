// =============================================================================
// HolyOS — AI Vývojář / git wrapper (isomorphic-git, čistě JS)
// =============================================================================
// Žádný system git CLI — Railway/mise build image ho nemá v PATH a explicitní
// instalaci přes nixpacks.toml ignoruje. isomorphic-git je čistě JS knihovna,
// která pracuje přímo s file systémem a HTTP. Funguje na clone, branch, add,
// commit, push.
//
// Auth pro HTTPS: onAuth callback vrací { username: 'x-access-token', password: PAT }
// (stejný pattern jako GitHub Apps a fine-grained PATs).

const fs = require('fs');
const git = require('isomorphic-git');
const http = require('isomorphic-git/http/node');

const AGENT_AUTHOR = {
  name: 'Alan, AI Vývojář',
  email: 'ai-vyvojar@holyos.local',
};

function makeOnAuth(token) {
  return () => ({ username: 'x-access-token', password: token });
}

async function clone({ gitUrl, branch, dir, token, depth = 1 }) {
  await fs.promises.mkdir(dir, { recursive: true });
  await git.clone({
    fs,
    http,
    dir,
    url: gitUrl,
    ref: branch,
    singleBranch: true,
    depth,
    onAuth: makeOnAuth(token),
  });
}

async function checkoutNewBranch({ cwd, branch }) {
  // isomorphic-git: vytvoř novou větev z aktuálního HEAD a checkoutni ji
  await git.branch({ fs, dir: cwd, ref: branch, checkout: true });
}

async function setIdentity({ cwd, name, email }) {
  // identity se předává v commit() přes author. Tady jen zapíšeme do configu
  // pro konzistenci (audit log si to taky čte).
  await git.setConfig({ fs, dir: cwd, path: 'user.name', value: name });
  await git.setConfig({ fs, dir: cwd, path: 'user.email', value: email });
}

async function statusPorcelain({ cwd }) {
  // statusMatrix vrátí [filepath, headStatus, workdirStatus, stageStatus]
  // headStatus:    0 = absent, 1 = present
  // workdirStatus: 0 = absent, 1 = match HEAD, 2 = different
  // stageStatus:   0 = absent, 1 = match HEAD, 2 = match workdir, 3 = different
  const matrix = await git.statusMatrix({ fs, dir: cwd });
  const out = [];
  for (const [filepath, head, workdir, stage] of matrix) {
    if (head === 1 && workdir === 1 && stage === 1) continue; // unchanged
    let code = '??';
    if (head === 0 && workdir === 1) code = 'A ';
    else if (head === 1 && workdir === 0) code = 'D ';
    else if (head === 1 && workdir === 2) code = ' M';
    out.push({ status: code, path: filepath });
  }
  return out;
}

async function addAll({ cwd }) {
  const matrix = await git.statusMatrix({ fs, dir: cwd });
  for (const [filepath, head, workdir] of matrix) {
    if (workdir === 0 && head === 1) {
      await git.remove({ fs, dir: cwd, filepath });
    } else if (workdir > 0) {
      await git.add({ fs, dir: cwd, filepath });
    }
  }
}

async function commit({ cwd, message }) {
  const sha = await git.commit({
    fs,
    dir: cwd,
    message,
    author: AGENT_AUTHOR,
    committer: AGENT_AUTHOR,
  });
  return sha;
}

async function push({ cwd, branch, token, gitUrl }) {
  await git.push({
    fs,
    http,
    dir: cwd,
    url: gitUrl,
    remote: 'origin',
    ref: branch,
    onAuth: makeOnAuth(token),
  });
}

async function getHeadSha({ cwd }) {
  return git.resolveRef({ fs, dir: cwd, ref: 'HEAD' });
}

async function getChangedFiles({ cwd }) {
  const status = await statusPorcelain({ cwd });
  return status.map((s) => s.path);
}

module.exports = {
  AGENT_AUTHOR,
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
