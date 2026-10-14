// Wording for the device authorization history in the parent console.
const MESSAGES = {
  pair_requested: event => `新设备请求配对（配对码 ${event.code}）`,
  pair_rejected: () => '配对请求过多，已拒绝新的请求',
  approved: event => `授权了「${event.label}」`,
  approve_failed: event => `配对码 ${event.code} 无效或已过期`,
  approve_blocked: () => '配对码错误次数过多，暂停授权 10 分钟',
  revoked: event => `撤销了「${event.label}」`,
  file_added: event => `授权文件中新增了「${event.label}」`,
  file_removed: event => `授权文件中删除了「${event.label}」`
};

export const isWarning = event => ['pair_rejected', 'approve_failed', 'approve_blocked'].includes(event.type);

export function describeEvent(event) {
  return MESSAGES[event.type]?.(event) ?? event.type;
}

// A short name for a browser, e.g. "iPhone Safari"; unknown agents are shortened as they are.
export function describeAgent(userAgent) {
  if (!userAgent) return '';
  const system = [[/iPad/, 'iPad'], [/iPhone/, 'iPhone'], [/Android/, 'Android'], [/Macintosh|Mac OS X/, 'Mac'], [/Windows/, 'Windows'], [/Linux/, 'Linux']]
    .find(([pattern]) => pattern.test(userAgent))?.[1];
  const browser = [[/MicroMessenger/, '微信'], [/EdgA?\//, 'Edge'], [/FxiOS|Firefox\//, 'Firefox'], [/CriOS|Chrome\//, 'Chrome'], [/Safari\//, 'Safari']]
    .find(([pattern]) => pattern.test(userAgent))?.[1];
  if (system || browser) return [system, browser].filter(Boolean).join(' ');
  return userAgent.length > 40 ? `${userAgent.slice(0, 40)}…` : userAgent;
}

// Who acted and from where. Requests made from the parent console name that device; the others
// show the address and browser that asked.
export function describeOrigin(event) {
  if (event.source === 'cli') return '服务器命令';
  if (event.source === 'file') return '手动编辑授权文件';
  if (event.actor) return `在「${event.actor}」上操作`;
  return [event.ip && `来源 ${event.ip}`, describeAgent(event.user_agent)].filter(Boolean).join(' · ');
}
