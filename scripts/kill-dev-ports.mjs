import { execSync } from 'child_process';

const PORTS = [5173, 5174, 5175];

function killPortWindows(port) {
  try {
    const output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
    const pids = new Set();
    for (const line of output.split('\n')) {
      const match = line.trim().match(/\s+(\d+)\s*$/);
      if (match && match[1] !== '0') pids.add(match[1]);
    }
    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
        console.log(`Freed port ${port} (PID ${pid})`);
      } catch {
        // process may have already exited
      }
    }
  } catch {
    // no process on this port
  }
}

if (process.platform === 'win32') {
  for (const port of PORTS) killPortWindows(port);
}