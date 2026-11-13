import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Perfis em $XDG_CONFIG_HOME/delta/config.json (arquivo só do usuário: 600). */
export function configPath(env) {
  const base = env.DELTA_CONFIG_DIR ?? env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return env.DELTA_CONFIG_DIR ? join(base, 'config.json') : join(base, 'delta', 'config.json');
}

export async function loadConfig(env) {
  try {
    const parsed = JSON.parse(await readFile(configPath(env), 'utf8'));
    return { current: parsed.current ?? 'default', profiles: parsed.profiles ?? {} };
  } catch {
    return { current: 'default', profiles: {} };
  }
}

export async function saveConfig(env, config) {
  const path = configPath(env);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

/** Variáveis de ambiente (DELTA_URL, DELTA_TOKEN) têm precedência sobre o perfil salvo. */
export function resolveProfile(config, env, name) {
  const profileName = name ?? env.DELTA_PROFILE ?? config.current ?? 'default';
  const saved = config.profiles[profileName] ?? {};
  return {
    name: profileName,
    url: env.DELTA_URL ?? saved.url ?? null,
    token: env.DELTA_TOKEN ?? saved.token ?? null,
  };
}
