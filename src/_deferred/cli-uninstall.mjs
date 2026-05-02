// `shadowbrain uninstall [agent]` — remove MCP registration, restore .bak.
import { detectAgents, INSTALLERS } from '../install/detect.mjs';

export async function cmdUninstall(agent, opts = {}) {
  const agents = await detectAgents();
  const targets = agent
    ? agents.filter((a) => a.name === agent)
    : agents.filter((a) => a.registered);

  if (targets.length === 0) {
    process.stdout.write('shadowbrain: nothing to uninstall.\n');
    return 0;
  }

  let okCount = 0;
  for (const t of targets) {
    const installer = INSTALLERS[t.name];
    if (!installer) continue;
    try {
      await installer.uninstall();
      process.stdout.write(`uninstalled: ${t.name}\n`);
      okCount++;
    } catch (err) {
      process.stderr.write(`failed: ${t.name}: ${err.message}\n`);
    }
  }
  return okCount === targets.length ? 0 : 1;
}
