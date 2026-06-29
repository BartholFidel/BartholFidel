const { execSync } = require("child_process");

const ports = [3000, 4000];
const platform = process.platform;

function execCommand(command) {
  try {
    return execSync(command, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

function parseWindowsNetstat(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      return Number(parts.at(-1));
    })
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

function parseUnixLsof(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(1)
    .map((line) => {
      const parts = line.split(/\s+/);
      return Number(parts[1]);
    })
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

function getProcessCommand(pid) {
  if (platform === "win32") {
    const output = execCommand(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`);
    return output.trim().toLowerCase();
  }

  const output = execCommand(`ps -p ${pid} -o comm=`);
  return output.trim().toLowerCase();
}

function isDevProcess(command) {
  return /node|tsx|next|npm/.test(command);
}

for (const port of ports) {
  let pids = [];
  if (platform === "win32") {
    const output = execCommand(`netstat -ano | findstr ":${port}"`);
    pids = parseWindowsNetstat(output);
  } else {
    const output = execCommand(`lsof -iTCP:${port} -sTCP:LISTEN -n -P`);
    pids = parseUnixLsof(output);
  }

  pids = [...new Set(pids)];
  if (pids.length === 0) {
    continue;
  }

  for (const pid of pids) {
    const command = getProcessCommand(pid);
    if (!command) {
      continue;
    }

    if (!isDevProcess(command)) {
      console.warn(`[cleanup-dev-ports] port ${port} is in use by PID ${pid}, command: ${command}. Skipping because it is not a dev process.`);
      continue;
    }

    try {
      if (platform === "win32") {
        execCommand(`taskkill /PID ${pid} /F`);
      } else {
        process.kill(pid, "SIGKILL");
      }
      console.log(`[cleanup-dev-ports] killed process ${pid} on port ${port}`);
    } catch (error) {
      console.warn(`[cleanup-dev-ports] failed to kill PID ${pid} on port ${port}:`, error);
    }
  }
}
