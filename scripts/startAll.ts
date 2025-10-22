const processes = [
  {
    name: 'api',
    cmd: ['bun', 'run', 'index.ts'],
  },
  {
    name: 'worker:outbound',
    cmd: ['bun', 'run', 'src/workers/outboundWorker.ts'],
  },
  {
    name: 'worker:send',
    cmd: ['bun', 'run', 'src/workers/whatsappSendWorker.ts'],
  },
  {
    name: 'worker:bootstrap',
    cmd: ['bun', 'run', 'src/workers/welcomeBootstrapWorker.ts'],
  },
];

const running: { name: string; proc: Bun.Subprocess }[] = [];

function startProcess(name: string, cmd: string[]) {
  const proc = Bun.spawn(cmd, {
    stdout: 'inherit',
    stderr: 'inherit',
  });

  running.push({ name, proc });

  proc.exited.then((code) => {
    console.error(`❌ ${name} exited with code ${code}`);
    shutdown(code ?? 1);
  });
}

function shutdown(exitCode = 0) {
  for (const { proc } of running) {
    try {
      proc.kill();
    } catch (error) {
      console.warn('⚠️ Failed to kill process', error);
    }
  }
  process.exit(exitCode);
}

process.on('SIGINT', () => {
  console.log('\n🛑 Caught SIGINT, shutting down...');
  shutdown(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Caught SIGTERM, shutting down...');
  shutdown(0);
});

for (const { name, cmd } of processes) {
  console.log(`🚀 Starting ${name} (${cmd.join(' ')})`);
  startProcess(name, cmd);
}

// Keep main process alive
setInterval(() => {}, 1 << 30);
