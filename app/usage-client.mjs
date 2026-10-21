import { spawn } from 'node:child_process';
import readline from 'node:readline';

export class UsageClient {
  constructor(python, script, home) {
    this.child = spawn(python, [script, home], { windowsHide: true, shell: false,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    this.pending = [];
    this.failure = null;
    readline.createInterface({ input: this.child.stdout }).on('line', line => {
      const request = this.pending.shift();
      if (!request) return;
      clearTimeout(request.timer);
      try { request.resolve(JSON.parse(line)); } catch { request.reject(new Error('Invalid usage backend response')); }
    });
    // Backend errors are reduced to a type/code, never echoed session content.
    this.child.stderr.on('data', () => {});
    const fail = error => {
      this.failure = error;
      for (const request of this.pending.splice(0)) { clearTimeout(request.timer); request.reject(error); }
    };
    this.child.on('error', () => fail(new Error('Usage backend failed to start')));
    this.child.on('exit', () => fail(new Error('Usage backend exited')));
  }
  read(threadId) {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const request = { resolve, reject, timer: null };
      request.timer = setTimeout(() => { this.child.kill(); reject(new Error('Usage backend timed out')); }, 8000);
      this.pending.push(request);
      this.child.stdin.write(JSON.stringify({ threadId }) + '\n', error => { if (error) this.child.kill(); });
    });
  }
  close() { this.child.kill(); }
}
