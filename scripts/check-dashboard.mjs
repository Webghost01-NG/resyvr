import { readFile } from "node:fs/promises";

const [html, app, wallet] = await Promise.all([
  readFile(new URL("../dashboard/index.html", import.meta.url), "utf8"),
  readFile(new URL("../dashboard/app.js", import.meta.url), "utf8"),
  readFile(new URL("../dashboard/wallet.js", import.meta.url), "utf8"),
]);

const definedIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
const referencedIds = new Set(
  [...`${app}\n${wallet}`.matchAll(/(?:byId|setText|setLink|setPendingLink)\("([^"]+)"/g)].map((match) => match[1]),
);
const duplicateIds = [...definedIds].filter((id) => html.match(new RegExp(`\\bid="${id}"`, "g"))?.length !== 1);
const missingIds = [...referencedIds].filter((id) => !definedIds.has(id));

if (duplicateIds.length > 0) throw new Error(`Duplicate dashboard IDs: ${duplicateIds.join(", ")}`);
if (missingIds.length > 0) throw new Error(`Missing dashboard IDs: ${missingIds.join(", ")}`);

for (const path of ["../config/networks.json", "../config/pilot.json", "../docs/deployments/creditcoin.json", "../config/issuance.json"]) {
  if (!`${app}\n${wallet}`.includes(`fetchJson("${path}")`)) throw new Error(`Dashboard does not load ${path}`);
}

if (!wallet.includes('fetchJson("../config/issuance.json")')) throw new Error("Wallet flow does not load issuance config");

console.log(`PASS dashboard structure: ${definedIds.size} unique IDs, ${referencedIds.size} scripted targets`);
