// `shadowbrain install [agent]` — register the MCP server in detected agents.
import { detectAgents, INSTALLERS } from '../install/detect.mjs';
import { log } from '../log.mjs';

export async function cmdInstall(agent, opts = {}) {
  const agents = await detectAgents();
  const targets = agent
    ? agents.filter((a) => a.name === agent)
    : opts.all
      ? agents.filter((a) => a.installed)
      : agents.filter((a) => a.installed);

  if (targets.length === 0) {
    process.stderr.write('shadowbrain: no matching coding agents detected.\n');
    return 1;
  }

  let okCount = 0;
  for (const t of targets) {
    const installer = INSTALLERS[t.name];
    if (!installer) {
      log.warn(`no installer for ${t.name}, skipping`);
      continue;
    }
    if (opts.dryRun || opts['dry-run']) {
      const plan = await installer.plan();
      process.stdout.write(`[dry-run] ${t.name}: ${JSON.stringify(plan)}\n`);
      okCount++;
      continue;
    }
    try {
      await installer.install();
      process.stdout.write(`installed: ${t.name}\n`);
      okCount++;
    } catch (err) {
      process.stderr.write(`failed: ${t.name}: ${err.message}\n`);
    }
  }
  return okCount === targets.length ? 0 : 1;
}
