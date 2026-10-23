/**
 * `anyfreebook health` — is the API reachable?
 */

export async function healthCommand(opts, ctx) {
  const data = await ctx.api.health();

  if (ctx.json) {
    ctx.out.write(`${JSON.stringify(data, null, 2)}\n`);
    return;
  }

  const uptime = Number(data.uptimeSeconds);
  const lines = [];
  lines.push(`${ctx.style.bold('Status')}     ${data.status || 'unknown'}`);
  if (data.apiVersion) lines.push(`${ctx.style.bold('API ver')}    ${data.apiVersion}`);
  if (Number.isFinite(uptime)) {
    const minutes = Math.floor(uptime / 60);
    const seconds = uptime % 60;
    lines.push(`${ctx.style.bold('Uptime')}     ${uptime}s (${minutes}m ${seconds}s)`);
  }
  lines.push(`${ctx.style.bold('Base URL')}   ${ctx.config.base}`);
  ctx.out.write(`${lines.join('\n')}\n`);
}
