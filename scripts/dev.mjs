#!/usr/bin/env node
import { spawn } from 'node:child_process';
import net from 'node:net';
import process from 'node:process';
import { Client as PgClient } from 'pg';

const root = process.cwd();
const children = new Set();
let shuttingDown = false;
const defaults = {
  DATABASE_URL: 'postgres://cardflow:cardflow@localhost:15432/cardflow',
  REDIS_URL: 'redis://localhost:16379',
  S3_ENDPOINT: 'localhost',
  S3_PORT: '19000',
  S3_USE_SSL: 'false',
  S3_ACCESS_KEY: 'cardflow',
  S3_SECRET_KEY: 'cardflowsecret',
  S3_BUCKET: 'cardflow-dev',
  API_PORT: '3400',
  NEXT_PUBLIC_API_URL: 'http://localhost:3400',
};

function log(message) {
  process.stdout.write(`[dev] ${message}\n`);
}

function mergedEnv(extra = {}) {
  return { ...process.env, ...defaults, ...extra };
}

function spawnBackground(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    cwd: root,
    env: mergedEnv(options.env ?? {}),
    shell: false,
    ...options,
  });
  children.add(child);
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (!shuttingDown && code !== 0) {
      log(`${command} ${args.join(' ')} exited with ${signal ?? code}`);
      shutdown(code ?? 1);
    }
  });
  return child;
}

function runChecked(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      cwd: root,
      env: mergedEnv(options.env ?? {}),
      shell: false,
      ...options,
    });
    children.add(child);
    child.on('exit', (code, signal) => {
      children.delete(child);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with ${signal ?? code}`));
    });
  });
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    child.kill('SIGTERM');
  }
  setTimeout(() => {
    for (const child of children) {
      child.kill('SIGKILL');
    }
    process.exit(code);
  }, 4000).unref();
}

function waitForPort(port, host = '127.0.0.1', timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.createConnection({ port, host });
      const done = (err) => {
        socket.removeAllListeners();
        socket.destroy();
        if (err) {
          if (Date.now() > deadline) {
            reject(err);
            return;
          }
          setTimeout(attempt, 1000);
          return;
        }
        resolve();
      };
      socket.once('connect', () => done());
      socket.once('error', () => done(new Error(`port ${port} on ${host} not ready`)));
    };
    attempt();
  });
}

async function waitForPostgres(connectionString, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const client = new PgClient({ connectionString });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch (error) {
      try {
        await client.end();
      } catch {}
      if (Date.now() > deadline) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function main() {
  log('starting infra');
  await runChecked('docker', ['compose', 'down', '-v', '--remove-orphans']);
  await runChecked('docker', ['compose', 'up', '-d', 'postgres', 'redis', 'minio']);

  log('waiting for postgres, redis, and minio');
  await Promise.all([
    waitForPostgres(defaults.DATABASE_URL),
    waitForPort(16379),
    waitForPort(19000),
  ]);

  log('running migrations');
  await runChecked('npm', ['run', 'db:migrate']);

  log('starting services');
  spawnBackground('npm', ['run', 'dev', '--workspace', '@cardflow/api']);
  spawnBackground('npm', ['run', 'dev', '--workspace', '@cardflow/worker']);
  spawnBackground('npm', ['run', 'dev', '--workspace', '@cardflow/web']);

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
