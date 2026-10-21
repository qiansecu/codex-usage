import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', windowsHide: true }).split('\0').filter(Boolean))];
if (!files.length) throw new Error('No public source files found');
const failures = [];
for (const name of files) {
  if (/(^|\/)(runtime[^/]*|profile|codex-home|state|test-fixtures|__pycache__|node_modules)\//i.test(name)
      || /\.(exe|lnk|pyc|jsonl|db|sqlite(?:-[\w]+)?|log)(?:$|\.)/i.test(name)
      || /\.local\.json$/i.test(name)
      || /(^|\/)(auth\.json|config\.toml|\.env(?:\..*)?)$/i.test(name)) {
    failures.push(`${name}: private/generated file type`); continue;
  }
  const file = path.join(root, name);
  if (fs.lstatSync(file).isSymbolicLink()) { failures.push(`${name}: symlink requires separate review`); continue; }
  const text = fs.readFileSync(file, 'utf8');
  const patterns = [
    [/\b[A-Z]:[\\/]+Users[\\/]+[^\\/\r\n"'<>]+/i, 'personal absolute home path'],
    [/(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}/, 'possible GitHub credential'],
    [/\bsk-[A-Za-z0-9_-]{20,}/, 'possible API credential'],
    [/\bAKIA[A-Z0-9]{16}\b/, 'possible cloud credential'],
    [/\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/, 'possible session token'],
    [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, 'personal email requires review'],
    [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'private key'],
  ];
  for (const [pattern, reason] of patterns) if (pattern.test(text)) failures.push(`${name}: ${reason}`);
}
if (failures.length) throw new Error(failures.join('\n'));
console.log(`Checked ${files.length} public files: no blocked paths or credential patterns. Review is still required before publishing.`);
