/**
 * Exercises the optional review-input CLI against real Git snapshots. These outcomes protect
 * the distinction between files present locally and knowledge available in a review revision;
 * they make no claim about an artifact's acceptance, sufficiency, or semantic correctness.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/** The packaged executable is exercised as consumers invoke it, without imported internals. */
const script = resolve('plugins/spec-skills/skills/spec-audit/scripts/review-inputs.mjs');
/** Each case owns a disposable repository so staging and history cannot leak between cases. */
let repo;

/** Runs only local Git operations in the fixture, with deterministic fixture author identity. */
function git(...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

/** Creates project material at a literal path, including nested collection layouts. */
function write(path, content = '# Accepted current obligation\n') {
  const target = join(repo, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

/** Captures the fixture's selected knowledge as an actual reviewable commit. */
function commit() {
  git('add', '--all');
  git('-c', 'core.hooksPath=/dev/null', 'commit', '--no-gpg-sign', '-qm', 'Fixture knowledge');
  return git('rev-parse', 'HEAD');
}

/** Returns both protocol output and process status; failures must not masquerade as reports. */
function run(paths, revision = 'HEAD') {
  const result = spawnSync(process.execPath, [script, '--repo', repo, '--revision', revision, '--', ...paths], { encoding: 'utf8' });
  return { ...result, report: result.stdout ? JSON.parse(result.stdout) : undefined };
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'spec-inputs-'));
  git('init', '-q');
  git('config', 'user.name', 'Fixture Author');
  git('config', 'user.email', 'fixture@example.invalid');
  write('README.md', '# Fixture\n');
  commit();
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('review knowledge in an explicit committed revision', () => {
  it('identifies exact regular blobs and the resolved commit without exposing file content', () => {
    write('design/domain.md');
    const revision = commit();
    const result = run(['design/domain.md']);
    expect(result.status).toBe(0);
    expect(result.report.commit).toBe(revision);
    expect(result.report.artifacts).toEqual([{
      path: 'design/domain.md', status: 'present', mode: '100644',
      object: git('rev-parse', 'HEAD:design/domain.md'),
    }]);
    expect(result.stdout).not.toContain('Accepted current obligation');
  });

  it('does not count local, staged, or ignored material as part of a review commit', () => {
    write('.gitignore', 'private/\n');
    commit();
    write('local.md');
    write('staged.md');
    git('add', 'staged.md');
    write('private/decision.md');
    const result = run(['local.md', 'staged.md', 'private/decision.md']);
    expect(result.status).toBe(1);
    expect(result.report.artifacts.map((item) => item.status)).toEqual(['missing', 'missing', 'missing']);
  });

  it('uses the requested historical revision even when HEAD and the worktree contain newer intent', () => {
    const earlier = git('rev-parse', 'HEAD');
    write('contract.md');
    commit();
    expect(run(['contract.md'], earlier).report.artifacts[0].status).toBe('missing');
    expect(run(['contract.md']).report.artifacts[0].status).toBe('present');
  });

  it('reports committed content even when the working file has changed or been removed', () => {
    write('domain.md');
    commit();
    const object = git('rev-parse', 'HEAD:domain.md');
    write('domain.md', '# Unaccepted local replacement\n');
    expect(run(['domain.md']).report.artifacts[0].object).toBe(object);
    rmSync(join(repo, 'domain.md'));
    expect(run(['domain.md']).report.artifacts[0].object).toBe(object);
  });

  it('does not follow a committed symlink or accept a directory as review substance', () => {
    write('design/plan.md');
    symlinkSync('/unavailable/private/decision.md', join(repo, 'decision.md'));
    commit();
    const result = run(['decision.md', 'design']);
    expect(result.status).toBe(1);
    expect(result.report.artifacts.map((item) => item.status)).toEqual(['not-regular-file', 'not-regular-file']);
    expect(result.report.artifacts.map((item) => item.mode)).toEqual(['120000', '040000']);
  });

  it('does not treat a submodule pointer as checked-in specification content', () => {
    const object = git('rev-parse', 'HEAD');
    git('update-index', '--add', '--cacheinfo', `160000,${object},external-spec`);
    git('-c', 'core.hooksPath=/dev/null', 'commit', '--no-gpg-sign', '-qm', 'Fixture submodule');
    expect(run(['external-spec']).report.artifacts[0].status).toBe('not-regular-file');
  });

  it('treats spaces, wildcard characters, and pathspec magic literally', () => {
    write('design/real plan.md');
    write('design/[x].md');
    commit();
    const result = run(['design/real plan.md', 'design/[x].md', ':(glob)**/*.md']);
    expect(result.report.artifacts.map((item) => item.status)).toEqual(['present', 'present', 'missing']);
  });

  it.each(['../outside.md', '/tmp/outside.md', 'design/../../outside.md', '.git/config', 'design/./plan.md', 'design//plan.md'])('rejects unbounded or ambiguous path %s', (path) => {
    const result = run([path]);
    expect(result.status).toBe(2);
    expect(result.report).toBeUndefined();
    expect(result.stderr).toContain('repository-relative');
  });

  it('requires a real commit, rather than inventing a snapshot for unborn or invalid refs', () => {
    const result = run(['README.md'], 'does-not-exist');
    expect(result.status).toBe(2);
    expect(result.report).toBeUndefined();
    expect(result.stderr).toContain('commit');
  });

  it('requires an explicit revision and at least one selected artifact', () => {
    const result = spawnSync(process.execPath, [script, '--repo', repo, '--', 'README.md'], { encoding: 'utf8' });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Usage:');
    expect(run([]).status).toBe(2);
  });

  it('does not modify working files, index, or HEAD while reporting unavailable inputs', () => {
    write('pending.md');
    git('add', 'pending.md');
    const before = [git('status', '--porcelain=v1'), git('write-tree'), git('rev-parse', 'HEAD')];
    expect(run(['README.md', 'pending.md']).report.artifacts[1].status).toBe('missing');
    expect([git('status', '--porcelain=v1'), git('write-tree'), git('rev-parse', 'HEAD')]).toEqual(before);
  });

  it('does not let inherited Git worktree selectors redirect the explicit repository', () => {
    const result = spawnSync(process.execPath, [script, '--repo', repo, '--revision', 'HEAD', '--', 'README.md'], {
      encoding: 'utf8', env: { ...process.env, GIT_DIR: '/unavailable/other/.git', GIT_WORK_TREE: '/unavailable/other' },
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).commit).toBe(git('rev-parse', 'HEAD'));
  });

  it('selects a linked worktree snapshot without silently using the main checkout HEAD', () => {
    const linked = join(repo, 'linked');
    git('worktree', 'add', '--quiet', '--detach', linked, 'HEAD');
    writeFileSync(join(linked, 'linked-plan.md'), '# This checkout owns this plan\n');
    execFileSync('git', ['-C', linked, 'add', 'linked-plan.md']);
    execFileSync('git', ['-C', linked, '-c', 'core.hooksPath=/dev/null', 'commit', '--no-gpg-sign', '-qm', 'Linked plan']);
    const result = spawnSync(process.execPath, [script, '--repo', linked, '--revision', 'HEAD', '--', 'linked-plan.md'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).commit).not.toBe(git('rev-parse', 'HEAD'));
    expect(run(['linked-plan.md']).report.artifacts[0].status).toBe('missing');
  });

  it('reports unavailable partial-clone tree data without trying to fetch it', () => {
    write('design/nested/plan.md');
    commit();
    const tree = git('rev-parse', 'HEAD:design/nested');
    rmSync(join(repo, '.git', 'objects', tree.slice(0, 2), tree.slice(2)));
    git('config', 'extensions.partialClone', 'origin');
    git('config', 'remote.origin.promisor', 'true');
    git('config', 'remote.origin.url', 'file:///unavailable/spec-inputs-fixture');
    const trace = join(repo, 'git-trace.log');
    const result = spawnSync(process.execPath, [script, '--repo', repo, '--revision', 'HEAD', '--', 'design/nested/plan.md'], {
      encoding: 'utf8', env: { ...process.env, GIT_TRACE: trace },
    });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    const operations = existsSync(trace) ? readFileSync(trace, 'utf8') : '';
    expect(operations).not.toMatch(/fetch|upload-pack|remote-https/);
  });
});
