// Server-side maintenance commands, e.g. inside Docker:
//   docker exec taskie-app node src/cli.js approve-device 384921 爸爸的iPhone
//   docker exec taskie-app node src/cli.js list-devices
//   docker exec taskie-app node src/cli.js revoke-device <设备编号>
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

// `docker exec` runs as root; act as the owner of the data directory so files stay writable by the app.
if (process.getuid?.() === 0) {
  try {
    const { uid, gid } = fs.statSync(path.dirname(config.dbPath));
    if (uid !== 0) {
      process.setgid(gid);
      process.setuid(uid);
    }
  } catch {}
}

const { getDb } = require('./db');
const { DeviceRegistry } = require('./device-auth');

function openRegistry() {
  // Keep database initialization logs out of the command output.
  const log = console.log;
  console.log = () => {};
  try {
    return new DeviceRegistry(getDb(config.dbPath), config.authorizedTokensFile);
  } finally {
    console.log = log;
  }
}

const commands = {
  'approve-device'(code, ...label) {
    if (!code) throw new Error('用法：node src/cli.js approve-device <配对码> [备注]');
    const device = openRegistry().approve(code, label.join(' '), { source: 'cli' });
    console.log(`已授权设备「${device.label}」（编号 ${device.id}）。新设备页面会自动进入应用。`);
  },
  'list-devices'() {
    const devices = openRegistry().list();
    if (!devices.length) return console.log('还没有已授权的设备。');
    for (const device of devices) {
      console.log(`${device.id}  ${device.label}  授权于 ${device.created_at || '未知'}  最近使用 ${device.last_seen_at || '暂无'}`);
    }
  },
  'revoke-device'(id) {
    if (!id) throw new Error('用法：node src/cli.js revoke-device <设备编号>');
    openRegistry().remove(id, { source: 'cli' });
    console.log(`已撤销设备 ${id}。`);
  }
};

const [command, ...args] = process.argv.slice(2);
try {
  if (!commands[command]) {
    console.log('可用命令：\n  approve-device <配对码> [备注]\n  list-devices\n  revoke-device <设备编号>');
    process.exitCode = command ? 1 : 0;
  } else {
    commands[command](...args);
  }
} catch (err) {
  console.error(err.message || err);
  process.exitCode = 1;
}
