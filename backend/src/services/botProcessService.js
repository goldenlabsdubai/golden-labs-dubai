import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pm2 from "pm2";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_DIR = path.resolve(__dirname, "..", "..");
const BOTS_DIR = path.resolve(BACKEND_DIR, "..", "bots");
const BOTS_ENV_PATH = path.join(BOTS_DIR, ".env");

function getBotScriptPath(botId) {
  return path.join(BOTS_DIR, "universal-bot.js");
}

function getProcessName(botId) {
  return `golden-bot-${botId}`;
}

function readBotsEnv() {
  if (!fs.existsSync(BOTS_ENV_PATH)) return {};
  const raw = fs.readFileSync(BOTS_ENV_PATH, "utf8");
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    out[key] = value;
  }
  return out;
}

function validateBotEnvForStart(botId) {
  const env = readBotsEnv();
  const keyVar = `BOT${botId}_PRIVATE_KEY`;
  const missing = [];
  if (!env[keyVar]) missing.push(keyVar);
  if (!env.MARKETPLACE_CONTRACT_ADDRESS) missing.push("MARKETPLACE_CONTRACT_ADDRESS");
  if (!env.NFT_CONTRACT_ADDRESS) missing.push("NFT_CONTRACT_ADDRESS");
  if (!env.USDT_ADDRESS) missing.push("USDT_ADDRESS");
  if (!env.RPC_URL) missing.push("RPC_URL");
  if (missing.length > 0) {
    throw new Error(`Missing bots/.env fields for bot ${botId}: ${missing.join(", ")}`);
  }
}

function connectPm2() {
  return new Promise((resolve, reject) => {
    pm2.connect((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function disconnectPm2() {
  try {
    pm2.disconnect();
  } catch (_) {}
}

async function withPm2(action) {
  await connectPm2();
  try {
    return await action();
  } finally {
    disconnectPm2();
  }
}

function describeProcess(name) {
  return new Promise((resolve, reject) => {
    pm2.describe(name, (err, list) => {
      if (err) return reject(err);
      resolve(Array.isArray(list) ? list : []);
    });
  });
}

function pm2Start(config) {
  return new Promise((resolve, reject) => {
    pm2.start(config, (err, proc) => {
      if (err) return reject(err);
      resolve(proc);
    });
  });
}

function pm2Stop(name) {
  return new Promise((resolve, reject) => {
    pm2.stop(name, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function pm2Delete(name) {
  return new Promise((resolve, reject) => {
    pm2.delete(name, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function isOnline(proc) {
  const status = proc?.pm2_env?.status;
  return status === "online" || status === "launching";
}

export async function getBotRuntimeState(botIds) {
  return withPm2(async () => {
    const result = {};
    for (const id of botIds) {
      const name = getProcessName(id);
      const described = await describeProcess(name);
      result[String(id)] = described.some(isOnline);
    }
    return result;
  });
}

export async function startBotProcess(botId) {
  const id = String(botId);
  const script = getBotScriptPath(id);
  if (!fs.existsSync(script)) {
    throw new Error(`Bot script not found for bot ${id}`);
  }
  validateBotEnvForStart(id);

  return withPm2(async () => {
    await pm2Start({
      name: getProcessName(id),
      script,
      cwd: BOTS_DIR,
      interpreter: "node",
      args: [id],
      env: { BOT_ID: id },
      autorestart: true,
      max_restarts: 1000,
      restart_delay: 3000,
      time: true,
      merge_logs: true,
    });
    const described = await describeProcess(getProcessName(id));
    return described.some(isOnline);
  });
}

export async function stopBotProcess(botId) {
  const name = getProcessName(String(botId));
  return withPm2(async () => {
    const described = await describeProcess(name);
    if (!described.length) return false;
    await pm2Stop(name).catch(() => {});
    await pm2Delete(name).catch(() => {});
    return true;
  });
}

export async function syncBotProcessesWithState(botConfig, runningStateById) {
  for (const bot of botConfig) {
    const id = String(bot.id);
    const shouldRun = Boolean(runningStateById?.[id]);
    try {
      if (shouldRun) {
        await startBotProcess(id);
      } else {
        await stopBotProcess(id);
      }
    } catch (e) {
      console.warn(`botProcessService sync bot ${id}:`, e?.message);
    }
  }
}
