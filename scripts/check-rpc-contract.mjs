import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverRoot = process.env.KOMARI_REPO || path.resolve(root, "../komari");
const contract = JSON.parse(fs.readFileSync(path.join(serverRoot, "contracts/rpc-v2.json"), "utf8"));
const generated = fs.readFileSync(path.join(root, "src/generated/rpcContract.ts"), "utf8");

if (!generated.includes(`RPC_CONTRACT = ${JSON.stringify(contract.contract)}`)) {
  throw new Error(`generated contract does not match ${contract.contract}`);
}
for (const [name, version] of Object.entries(contract.capabilities)) {
  if (!generated.includes(`${JSON.stringify(name)}: ${JSON.stringify(version)}`)) {
    throw new Error(`generated capability is missing: ${name}@${version}`);
  }
}
for (const method of contract.required_methods) {
  if (!generated.includes(JSON.stringify(method))) {
    throw new Error(`generated method is missing: ${method}`);
  }
}
console.log(`verified generated theme types against ${contract.contract}`);
