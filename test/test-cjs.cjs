/**
 * CommonJS-Test — prüft, ob require() korrekt funktioniert.
 * (Für Projekte ohne "type":"module" in package.json)
 *
 * Ausführen:
 *   node test/test-cjs.cjs
 */

"use strict";

const {
  OpenHABClient,
  Items,
  Things,
  UUID,
  Systeminfo,
} = require("../dist/cjs/index.js");

const URL      = "http://127.0.0.1:8080";
const USERNAME = "openhab";
const PASSWORD = "habopen";

const GREEN = "\x1b[32m";
const RED   = "\x1b[31m";
const BOLD  = "\x1b[1m";
const RESET = "\x1b[0m";

async function main() {
  console.log(`\n${BOLD}CommonJS (require) Test${RESET}`);
  console.log("─".repeat(40));

  const client = new OpenHABClient(URL, USERNAME, PASSWORD);
  await client.login();

  if (!client.isLoggedIn) {
    console.log(`${RED}✗ Verbindung fehlgeschlagen${RESET}`);
    process.exit(1);
  }
  console.log(`${GREEN}✓ Verbunden (CJS)${RESET}`);

  // UUID
  const uuid = await new UUID(client).getUUID();
  console.log(`${GREEN}✓ UUID:${RESET} ${uuid}`);

  // Systeminfo
  const sysinfo = await new Systeminfo(client).getSystemInfo();
  console.log(`${GREEN}✓ Systeminfo:${RESET} version=${sysinfo?.systemInfo?.version ?? "—"}`);

  // Items
  const items = await new Items(client).getItems({ type: "Switch" });
  console.log(`${GREEN}✓ Switch-Items:${RESET} ${Array.isArray(items) ? items.length : "?"}`);

  // Things
  const things = await new Things(client).getThings(true);
  console.log(`${GREEN}✓ Things (summary):${RESET} ${Array.isArray(things) ? things.length : "?"}`);

  console.log(`\n${GREEN}${BOLD}CommonJS-Test erfolgreich.${RESET}\n`);
}

main().catch(e => { console.error(RED + "Fehler:" + RESET, e.message); process.exit(1); });
