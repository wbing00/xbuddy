// Optional local launcher for the original candidate workspace.
import { readFile } from 'node:fs/promises';

const note = await readFile(new URL('../../相关信息.md', import.meta.url), 'utf8').catch(() => '');
const fields = {
  DEEPSEEK_API_KEY: /^api-key[：:]\s*([^\s]+)\s*$/mi,
  FUYAO_API_KEY: /^扶摇api-key[：:]\s*([^\s]+)\s*$/mi,
};
for (const [name, pattern] of Object.entries(fields)) {
  const value = process.env[name] || note.match(pattern)?.[1];
  if (!value) throw new Error('本地启动缺少 ' + name + '；请检查父目录中的相关信息.md 或现有环境变量。');
  process.env[name] = value;
}
if (process.argv.includes('--verify-live')) {
  await import('./verify-live.mjs');
} else {
  await import('../server.mjs');
}
