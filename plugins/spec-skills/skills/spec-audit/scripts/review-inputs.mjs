/**
 * Reports whether explicitly selected review knowledge exists as regular files in a committed
 * Git snapshot. It reads tree metadata only: working files, staged drafts, symlink targets,
 * private state, external services, and document semantics are outside its responsibility.
 * A present artifact is available to a repository reviewer; that does not make it authoritative.
 */
import { spawnSync } from 'node:child_process';

/** Explicit selection prevents accidental claims about HEAD or a whole specification collection. */
const usage = 'Usage: node review-inputs.mjs --repo <checkout> --revision <commit-ish> -- <repository-relative-file>...';

/**
 * Parses the deliberately small interface. Paths follow a separator so filenames cannot become
 * options; all selectors must be supplied rather than inferred from ambient repository state.
 */
function parseArguments(args) {
  const separator = args.indexOf('--');
  if (separator < 0 || separator === args.length - 1) {
    throw new Error(usage);
  }
  const options = new Map();
  for (let index = 0; index < separator; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!['--repo', '--revision'].includes(option) || !value || index + 1 >= separator || options.has(option)) {
      throw new Error(usage);
    }
    options.set(option, value);
  }
  if (!options.has('--repo') || !options.has('--revision')) {
    throw new Error(usage);
  }
  const paths = [...new Set(args.slice(separator + 1))];
  for (const path of paths) {
    const segments = path.split('/');
    if (path.includes('\0') || path.includes('\\') || /^[A-Za-z]:/.test(path) || segments.some((part) => ['', '.', '..', '.git'].includes(part))) {
      throw new Error(`Expected an unambiguous repository-relative file path: ${JSON.stringify(path)}`);
    }
  }
  return { repo: options.get('--repo'), revision: options.get('--revision'), paths };
}

/**
 * Keeps the explicit checkout authoritative even when launched from another Git-oriented tool.
 * Object replacement is disabled so reported object IDs describe the actual committed snapshot.
 * Missing partial-clone objects remain unavailable; inspection must not trigger a lazy fetch.
 * An empty transport allowlist also prevents a Git child from reaching a configured remote.
 */
function gitEnvironment() {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: '' };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) {
    delete env[key];
  }
  return env;
}

/**
 * Runs bounded local Git reads without a shell or content filters. Literal path selection avoids
 * glob/pathspec expansion; failures remain errors instead of being reported as missing content.
 */
function git(repo, args) {
  const result = spawnSync('git', ['--literal-pathspecs', '-C', repo, ...args], {
    encoding: 'utf8', env: gitEnvironment(), timeout: 10_000, maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message ?? result.stderr.trim() ?? 'Git read failed');
  }
  return result.stdout;
}

/**
 * Classifies one exact tree entry. Symlinks, directories, and submodules carry references rather
 * than the selected document's substance and are never followed or counted as regular files.
 */
function inspectArtifact(repo, commit, path) {
  const entries = git(repo, ['ls-tree', '-z', '--full-tree', commit, '--', path]).split('\0').filter(Boolean);
  for (const entry of entries) {
    const boundary = entry.indexOf('\t');
    if (entry.slice(boundary + 1) !== path) {
      continue;
    }
    const [mode, type, object] = entry.slice(0, boundary).split(' ');
    const present = type === 'blob' && ['100644', '100755'].includes(mode);
    return { path, status: present ? 'present' : 'not-regular-file', mode, object };
  }
  return { path, status: 'missing' };
}

/**
 * Emits one machine-readable report, with exit 1 for unavailable selected material and exit 2
 * for invalid input or read failure. No report is emitted after an incomplete inspection.
 */
function main(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write(`${usage}\n`);
    return;
  }
  const { repo, revision, paths } = parseArguments(args);
  const root = git(repo, ['rev-parse', '--show-toplevel']).trim();
  let commit;
  try {
    commit = git(root, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`]).trim();
  } catch {
    throw new Error(`Cannot resolve the requested commit: ${JSON.stringify(revision)}`);
  }
  const artifacts = paths.map((path) => inspectArtifact(root, commit, path));
  process.stdout.write(`${JSON.stringify({ repository: root, commit, artifacts }, null, 2)}\n`);
  process.exitCode = artifacts.every((artifact) => artifact.status === 'present') ? 0 : 1;
}

try {
  main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
