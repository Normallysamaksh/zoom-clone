import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
process.env.BACKEND_URL ||= "http://127.0.0.1:8000";
process.env.NEXT_PUBLIC_DEMO_MODE ||= "false";

const venvPython =
  process.platform === "win32"
    ? ".venv/Scripts/python.exe"
    : ".venv/bin/python";
const python =
  process.env.PYTHON_EXECUTABLE ||
  (existsSync(venvPython) ? venvPython : "python");
const backend = spawn(
  python,
  [
    "-m",
    "uvicorn",
    "backend.main:app",
    "--host",
    "127.0.0.1",
    "--port",
    "8000",
  ],
  { stdio: "inherit", env: process.env },
);
const frontend = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    process.argv.includes("--production") ? "start" : "dev",
    "--hostname",
    "127.0.0.1",
  ],
  { stdio: "inherit", env: process.env },
);
let closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  backend.kill();
  frontend.kill();
  process.exitCode = code;
}
for (const child of [backend, frontend]) {
  child.on("error", (error) => {
    console.error(error.message);
    close(1);
  });
  child.on("exit", (code) => close(code || 0));
}
process.on("SIGINT", () => close());
process.on("SIGTERM", () => close());
console.log(
  "Opening your workspace at http://127.0.0.1:3000. Press Ctrl+C to stop.",
);
