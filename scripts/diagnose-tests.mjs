#!/usr/bin/env node
/**
 * `npm run test:doctor` — measures how expensive this machine makes the integration half of
 * the test suite, without running the suite.
 *
 * Every database/filesystem test in this repository works the way the app does: a temporary
 * storage directory, `photobooth-paths.json`, the migrations, then one better-sqlite3
 * connection per repository call (see src/features/storage/database/connection.ts). That is a
 * lot of small files, and small files are exactly what Windows antivirus and spinning disks
 * make expensive. This script times the same operations so a slow run can be attributed to the
 * machine instead of to the code, and prints what to do about it.
 *
 * It is a plain Node script on purpose: it must run even when the TypeScript build is broken.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const TEMP_FILES = 40;
const COMMITS = 24;
const SAMPLE_ROWS = 400;

function line(label, value) {
  console.log(`  ${label.padEnd(28)}${value}`);
}

function instruction(text) {
  console.log(`    → ${text}`);
}

function timed(fn) {
  const started = process.hrtime.bigint();
  const result = fn();
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  return { ms, result };
}

function average(fn, count) {
  const started = process.hrtime.bigint();
  for (let index = 0; index < count; index += 1) fn(index);
  return Number(process.hrtime.bigint() - started) / 1e6 / count;
}

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'photobooth-doctor-'));
const findings = [];

try {
  console.log('\nphoto-booth test doctor');
  console.log('=======================');
  line('platform', `${process.platform} ${os.release()} (${process.arch})`);
  line('node', process.version);
  line('cpu count', `${os.cpus().length} × ${os.cpus()[0]?.model ?? 'unknown'}`);
  line('total memory', `${Math.round(os.totalmem() / 1024 ** 3)} GB`);
  line('temp directory', os.tmpdir());
  line('test timeout budget', '30 s per test (vite.config.ts)');
  line('date', new Date().toISOString());

  // --- raw temp directory cost -------------------------------------------------------------
  console.log('\ntemp directory writes (what the path file and the migrations cost)');
  const writeMs = average((index) => {
    const file = path.join(directory, `probe-${index}.json`);
    const handle = fs.openSync(file, 'w');
    try {
      fs.writeSync(handle, '{"photosDirectory":"probe","backupDirectory":"probe"}\n');
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
  }, TEMP_FILES);
  line(`${TEMP_FILES} create + fsync`, `${writeMs.toFixed(2)} ms each`);

  const deleteMs = average((index) => {
    fs.rmSync(path.join(directory, `probe-${index}.json`), { force: true });
  }, TEMP_FILES);
  line('delete', `${deleteMs.toFixed(2)} ms each`);
  if (writeMs > 10) {
    findings.push('temp-writes');
  }

  // --- better-sqlite3, the way the repositories use it -------------------------------------
  console.log('\nbetter-sqlite3 commits (every repository call opens and closes a connection)');
  let Database = null;
  try {
    Database = require('better-sqlite3');
  } catch (error) {
    const message = String(error?.message ?? error);
    console.log('  the native addon could not be loaded:');
    console.log(`    ${message.split('\n')[0]}`);
    if (/NODE_MODULE_VERSION|was compiled against a different Node\.js version/i.test(message)) {
      instruction('the addon is currently built for Electron — run `npm run rebuild:node`, then');
      instruction('run this again. `npm test` rebuilds it for Node for you and restores Electron after.');
    } else {
      instruction('run `npm install` (a C++ toolchain is required on Windows; docs/vscode-setup.md).');
    }
  }

  if (Database) {
    const databasePath = path.join(directory, 'probe.sqlite');
    const database = new Database(databasePath);
    database.pragma('foreign_keys = ON');
    database.exec('CREATE TABLE probe (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    const insert = database.prepare('INSERT INTO probe (key, value) VALUES (?, ?)');

    const commitMs = average((index) => {
      // One autocommit statement per call, which is what a single `withDatabase` write costs.
      insert.run(`commit-${index}`, createHash('sha1').update(String(index)).digest('hex'));
    }, COMMITS);
    line(`${COMMITS} autocommit writes`, `${commitMs.toFixed(2)} ms each`);

    const batch = timed(() => {
      database.transaction(() => {
        for (let index = 0; index < SAMPLE_ROWS; index += 1) insert.run(`batch-${index}`, 'x');
      })();
    });
    line(`${SAMPLE_ROWS} writes in one txn`, `${batch.ms.toFixed(2)} ms total`);
    if (commitMs > 0) line('fsync penalty', `${Math.round(batch.ms === 0 ? 0 : (commitMs * SAMPLE_ROWS) / Math.max(batch.ms, 0.001))}× slower outside a transaction`);

    const readStart = process.hrtime.bigint();
    database.prepare('SELECT count(*) AS n FROM probe').get();
    line('first read after writes', `${(Number(process.hrtime.bigint() - readStart) / 1e6).toFixed(2)} ms`);

    const reopenMs = average(() => {
      const connection = new Database(databasePath);
      try {
        connection.prepare('SELECT count(*) AS n FROM probe').get();
      } finally {
        connection.close();
      }
    }, 5);
    line('open + read + close', `${reopenMs.toFixed(2)} ms each`);
    database.close();
    if (commitMs > 4) findings.push('commits');
  }

  // --- the admin PIN hash, which is deliberately expensive ---------------------------------
  console.log('\nscrypt (the admin PIN hash: N=16384, r=8, p=1)');
  const { scryptSync } = await import('node:crypto');
  const scryptMs = average(() => {
    scryptSync('123456', 'doctor-salt', 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  }, 3);
  line('one hash', `${scryptMs.toFixed(1)} ms`);
  if (scryptMs > 400) findings.push('scrypt');

  // --- what a full run would cost ----------------------------------------------------------
  console.log('\nwhat this means');
  if (findings.length === 0) {
    console.log('  This machine is fast enough for the suite as it is. If a test still fails, it is');
    console.log('  failing on an assertion rather than on time — read the failure message itself.');
  } else {
    console.log('  This machine makes small files expensive, which is what most of this suite does:');
    if (findings.includes('temp-writes')) {
      console.log('  • writing a 50-byte file costs more than 10 ms, so each temp storage directory');
      console.log('    and each better-sqlite3 journal file is expensive.');
    }
    if (findings.includes('commits')) {
      console.log('  • a single autocommit write costs more than 4 ms, so every repository call in the');
      console.log('    suite pays an fsync. Tests that do a dozen repository calls spend a minute on I/O.');
    }
    if (findings.includes('scrypt')) {
      console.log('  • the PIN hash is slow on this CPU, so the admin PIN tests are genuinely heavy.');
    }
    console.log('\n  Fixes, in the order worth trying:');
    console.log('  1. Exclude the project folder AND the temp directory above from antivirus real-time');
    console.log('     scanning (Windows Security → Virus & threat protection → Manage settings →');
    console.log('     Exclusions). This is usually the whole difference.');
    console.log('  2. Keep the temp directory on a local SSD: set TEMP and TMP to e.g. C:\\Temp\\pb-temp,');
    console.log('     open a new terminal, and check the value printed above changed.');
    console.log('  3. Do not keep the checkout in a OneDrive/Dropbox folder or on a network or USB drive.');
    console.log('  4. Run a subset while iterating instead of the whole suite:');
    console.log('     npm test -- src/features/security');
    console.log('  5. If a specific test still needs longer, do not edit it — raise the budget for one run:');
    console.log('     npm test -- --testTimeout=120000');
  }
  console.log('\nFull explanation: docs/testing.md\n');
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
