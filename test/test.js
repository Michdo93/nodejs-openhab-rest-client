/**
 * openhab-rest-client — Node.js Testanwendung
 *
 * Anpassen:
 *   const URL      = "http://127.0.0.1:8080";
 *   const USERNAME = "openhab";
 *   const PASSWORD = "habopen";
 *   // oder:
 *   const TOKEN    = "oh.openhab.xxxx";
 *
 * Ausführen:
 *   node test/test.js
 */

import {
  OpenHABClient,
  Items, Things, Rules, Actions, Addons,
  Audio, Auth, ChannelTypes, ConfigDescriptions,
  Discovery, Iconsets, Inbox, Links, Logging,
  ModuleTypes, Persistence, ProfileTypes,
  Services, Sitemaps, Systeminfo, Tags,
  Templates, ThingTypes, Transformations,
  UI, UUID, Voice,
} from "../dist/esm/index.js";

// ─── Konfiguration ────────────────────────────────────────────────────────────
const URL      = "http://127.0.0.1:8080";
const USERNAME = "openhab";
const PASSWORD = "habopen";
const TOKEN    = null;           // Alternativ: Token statt Basic Auth

// ─── Testvariablen ────────────────────────────────────────────────────────────
const TEST_ITEM         = "testSwitch";
const TEST_NUMBER_ITEM  = "testNumber";
const TEST_GROUP        = "Static";
const TEST_THING_UID    = "astro:sun:b54938fe5c";
const TEST_LOGGER       = "org.openhab.test.js";
const TEST_RULE_UID     = "test_color-4";

// ─── Ausgabe-Hilfsfunktionen ─────────────────────────────────────────────────
const GREEN  = "\x1b[32m";
const RED    = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BLUE   = "\x1b[34m";
const RESET  = "\x1b[0m";
const BOLD   = "\x1b[1m";
const DIM    = "\x1b[2m";

let passed = 0, failed = 0, total = 0;

function header(num, name) {
  console.log(`\n${DIM}${"─".repeat(4)}${RESET} ${BOLD}Test #${num}: ${name}()${RESET} ${DIM}${"─".repeat(Math.max(2, 46 - name.length))}${RESET}`);
}

function ok(label, value) {
  const preview = value === undefined ? ""
    : typeof value === "string"       ? ` → "${value.slice(0, 80)}"`
    : Array.isArray(value)            ? ` → [${value.length} items]`
    : typeof value === "object" && value !== null ? ` → ${JSON.stringify(value).slice(0, 100)}`
    : ` → ${value}`;
  console.log(`  ${GREEN}✓${RESET} ${label}${DIM}${preview}${RESET}`);
  passed++;
}

function fail(label, err) {
  console.log(`  ${RED}✗${RESET} ${label}: ${RED}${err?.message ?? err}${RESET}`);
  failed++;
}

function info(msg) { console.log(`  ${BLUE}ℹ${RESET} ${DIM}${msg}${RESET}`); }

async function run(num, name, fn) {
  total++;
  header(num, name);
  try {
    await fn();
  } catch (e) {
    fail(name, e);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${BOLD}╔═══════════════════════════════════════════════════════╗`);
  console.log(`║     openhab-rest-client — Node.js Testanwendung      ║`);
  console.log(`╚═══════════════════════════════════════════════════════╝${RESET}`);
  console.log(`  URL: ${YELLOW}${URL}${RESET}   Auth: ${TOKEN ? "Token" : "Basic"}`);

  // ── Client-Verbindung ───────────────────────────────────────────────────────
  const client = TOKEN
    ? new OpenHABClient(URL, null, null, TOKEN)
    : new OpenHABClient(URL, USERNAME, PASSWORD);

  await client.login();

  if (!client.isLoggedIn) {
    console.log(`\n${RED}${BOLD}Verbindung fehlgeschlagen. Bitte URL / Zugangsdaten prüfen.${RESET}\n`);
    process.exit(1);
  }
  console.log(`\n  ${GREEN}✓${RESET} Verbunden  isCloud=${client.isCloud}  isLoggedIn=${client.isLoggedIn}`);

  // ════════════════════════════════════════════════════════════════════════════
  // UUID / Systeminfo — schnelle Basisprüfung
  // ════════════════════════════════════════════════════════════════════════════

  await run(1, "getUUID", async () => {
    const uuid = await new UUID(client).getUUID();
    ok("UUID", uuid);
  });

  await run(2, "getSystemInfo", async () => {
    const r = await new Systeminfo(client).getSystemInfo();
    ok("systemInfo.version", r?.systemInfo?.version ?? r);
  });

  await run(3, "getUoMInfo", async () => {
    const r = await new Systeminfo(client).getUoMInfo();
    ok("UoMInfo", r);
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Items
  // ════════════════════════════════════════════════════════════════════════════

  const itemsAPI = new Items(client);

  await run(4, "getItems", async () => {
    const r = await itemsAPI.getItems();
    ok("Alle Items", r);
    if (Array.isArray(r) && r.length > 0) info(`Beispiel: name="${r[0].name}" type="${r[0].type}"`);
  });

  await run(5, "getItems (gefiltert)", async () => {
    const r = await itemsAPI.getItems({ type: "Switch" });
    ok("Switch-Items", r);
  });

  await run(6, "getItem", async () => {
    const r = await itemsAPI.getItem(TEST_ITEM);
    ok(`Item "${TEST_ITEM}"`, r?.name);
  });

  await run(7, "getItemState", async () => {
    const r = await itemsAPI.getItemState(TEST_ITEM);
    ok(`State von "${TEST_ITEM}"`, r);
  });

  await run(8, "sendCommand ON", async () => {
    const r = await itemsAPI.sendCommand(TEST_ITEM, "ON");
    ok("sendCommand ON", r);
  });

  await run(9, "sendCommand OFF", async () => {
    const r = await itemsAPI.sendCommand(TEST_ITEM, "OFF");
    ok("sendCommand OFF", r);
  });

  await run(10, "updateItemState", async () => {
    const r = await itemsAPI.updateItemState(TEST_NUMBER_ITEM, "42");
    ok("updateItemState → 42", r);
  });

  await run(11, "postUpdate", async () => {
    const r = await itemsAPI.postUpdate(TEST_NUMBER_ITEM, "100");
    ok("postUpdate → 100", r);
  });

  await run(12, "addOrUpdateItem (create)", async () => {
    const data = { type: "Switch", name: "jsTestSwitch", label: "JS Test Switch", groupNames: [], tags: [] };
    const r = await itemsAPI.addOrUpdateItem("jsTestSwitch", data);
    ok("addOrUpdateItem", r);
  });

  await run(13, "addOrUpdateItems (bulk)", async () => {
    const items = [
      { type: "Number", name: "jsTestNumber", label: "JS Test Number" },
    ];
    const r = await itemsAPI.addOrUpdateItems(items);
    ok("addOrUpdateItems", r);
  });

  await run(14, "addTag", async () => {
    const r = await itemsAPI.addTag(TEST_ITEM, "Lighting");
    ok("addTag", r);
  });

  await run(15, "removeTag", async () => {
    const r = await itemsAPI.removeTag(TEST_ITEM, "Lighting");
    ok("removeTag", r);
  });

  await run(16, "addMetadata", async () => {
    const r = await itemsAPI.addMetadata(TEST_ITEM, "jsTestNS", { value: "jsValue", config: {} });
    ok("addMetadata", r);
  });

  await run(17, "getMetadataNamespaces", async () => {
    const r = await itemsAPI.getMetadataNamespaces(TEST_ITEM);
    ok("getMetadataNamespaces", r);
  });

  await run(18, "removeMetadata", async () => {
    const r = await itemsAPI.removeMetadata(TEST_ITEM, "jsTestNS");
    ok("removeMetadata", r);
  });

  await run(19, "addGroupMember", async () => {
    const r = await itemsAPI.addGroupMember(TEST_GROUP, "jsTestNumber");
    ok("addGroupMember", r);
  });

  await run(20, "removeGroupMember", async () => {
    const r = await itemsAPI.removeGroupMember(TEST_GROUP, "jsTestNumber");
    ok("removeGroupMember", r);
  });

  await run(21, "purgeOrphanedMetadata", async () => {
    const r = await itemsAPI.purgeOrphanedMetadata();
    ok("purgeOrphanedMetadata", r);
  });

  await run(22, "deleteItem", async () => {
    await itemsAPI.deleteItem("jsTestSwitch");
    await itemsAPI.deleteItem("jsTestNumber");
    ok("deleteItem (beide Test-Items gelöscht)");
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Things
  // ════════════════════════════════════════════════════════════════════════════

  const thingsAPI = new Things(client);

  await run(23, "getThings", async () => {
    const r = await thingsAPI.getThings();
    ok("Alle Things", r);
    if (Array.isArray(r) && r.length > 0) info(`Beispiel: uid="${r[0].UID}"`);
  });

  await run(24, "getThing", async () => {
    const r = await thingsAPI.getThing(TEST_THING_UID);
    ok(`Thing "${TEST_THING_UID}"`, r?.UID ?? r);
  });

  await run(25, "getThingStatus", async () => {
    const r = await thingsAPI.getThingStatus(TEST_THING_UID);
    ok("getThingStatus", r);
  });

  await run(26, "enableThing / disableThing", async () => {
    await thingsAPI.enableThing(TEST_THING_UID);
    ok("enableThing");
    await thingsAPI.disableThing(TEST_THING_UID);
    ok("disableThing");
    await thingsAPI.enableThing(TEST_THING_UID);
    ok("enableThing (wiederherstellen)");
  });

  await run(27, "getThingFirmwares", async () => {
    const r = await thingsAPI.getThingFirmwares(TEST_THING_UID);
    ok("getThingFirmwares", r);
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Rules
  // ════════════════════════════════════════════════════════════════════════════

  const rulesAPI = new Rules(client);

  await run(28, "getRules", async () => {
    const r = await rulesAPI.getRules();
    ok("Alle Regeln", r);
    if (Array.isArray(r) && r.length > 0) info(`Beispiel: uid="${r[0].uid}"`);
  });

  await run(29, "getRule", async () => {
    const r = await rulesAPI.getRule(TEST_RULE_UID);
    ok(`Regel "${TEST_RULE_UID}"`, r?.uid ?? r);
  });

  await run(30, "createRule / enable / disable / runNow / deleteRule", async () => {
    const uid = `jsTestRule_${Date.now()}`;
    const data = { uid, name: "JS Test Rule", description: "Created by Node.js test", triggers: [], conditions: [], actions: [] };
    await rulesAPI.createRule(data);
    ok("createRule");
    await rulesAPI.enable(uid);
    ok("enable");
    await rulesAPI.disable(uid);
    ok("disable");
    await rulesAPI.deleteRule(uid);
    ok("deleteRule");
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Actions
  // ════════════════════════════════════════════════════════════════════════════

  await run(31, "getActions", async () => {
    const r = await new Actions(client).getActions(TEST_THING_UID);
    ok("getActions", r);
    if (Array.isArray(r)) info(`${r.length} Aktionen gefunden`);
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Addons
  // ════════════════════════════════════════════════════════════════════════════

  const addonsAPI = new Addons(client);

  await run(32, "getAddons", async () => {
    const r = await addonsAPI.getAddons();
    ok("getAddons", r);
  });

  await run(33, "getAddonTypes", async () => {
    const r = await addonsAPI.getAddonTypes();
    ok("getAddonTypes", r);
  });

  await run(34, "getAddonSuggestions", async () => {
    const r = await addonsAPI.getAddonSuggestions();
    ok("getAddonSuggestions", r);
  });

  await run(35, "getAddonServices", async () => {
    const r = await addonsAPI.getAddonServices();
    ok("getAddonServices", r);
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Audio
  // ════════════════════════════════════════════════════════════════════════════

  const audioAPI = new Audio(client);

  await run(36, "getDefaultSink",   async () => { ok("getDefaultSink",   await audioAPI.getDefaultSink()); });
  await run(37, "getDefaultSource", async () => { ok("getDefaultSource", await audioAPI.getDefaultSource()); });
  await run(38, "getSinks",         async () => { ok("getSinks",         await audioAPI.getSinks()); });
  await run(39, "getSources",       async () => { ok("getSources",       await audioAPI.getSources()); });

  // ════════════════════════════════════════════════════════════════════════════
  // Logging
  // ════════════════════════════════════════════════════════════════════════════

  const loggingAPI = new Logging(client);

  await run(40, "getLoggers", async () => {
    const r = await loggingAPI.getLoggers();
    ok("getLoggers", r);
  });

  await run(41, "modifyOrAddLogger / getLogger / removeLogger", async () => {
    await loggingAPI.modifyOrAddLogger(TEST_LOGGER, "DEBUG");
    ok("modifyOrAddLogger (DEBUG)");
    const r = await loggingAPI.getLogger(TEST_LOGGER);
    ok("getLogger", r);
    await loggingAPI.removeLogger(TEST_LOGGER);
    ok("removeLogger");
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Links
  // ════════════════════════════════════════════════════════════════════════════

  await run(42, "getLinks", async () => {
    const r = await new Links(client).getLinks();
    ok("getLinks", r);
  });

  await run(43, "getOrphanLinks", async () => {
    const r = await new Links(client).getOrphanLinks();
    ok("getOrphanLinks", r);
  });

  // ════════════════════════════════════════════════════════════════════════════
  // ChannelTypes / ThingTypes / ConfigDescriptions
  // ════════════════════════════════════════════════════════════════════════════

  await run(44, "getChannelTypes", async () => {
    const r = await new ChannelTypes(client).getChannelTypes();
    ok("getChannelTypes", r);
  });

  await run(45, "getThingTypes", async () => {
    const r = await new ThingTypes(client).getThingTypes();
    ok("getThingTypes", r);
  });

  await run(46, "getConfigDescriptions", async () => {
    const r = await new ConfigDescriptions(client).getConfigDescriptions();
    ok("getConfigDescriptions", r);
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Persistence
  // ════════════════════════════════════════════════════════════════════════════

  await run(47, "getServices (Persistence)", async () => {
    const r = await new Persistence(client).getServices();
    ok("Persistence.getServices", r);
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Discovery / Inbox
  // ════════════════════════════════════════════════════════════════════════════

  await run(48, "getDiscoveryBindings", async () => {
    const r = await new Discovery(client).getDiscoveryBindings();
    ok("getDiscoveryBindings", r);
  });

  await run(49, "getDiscoveredThings (Inbox)", async () => {
    const r = await new Inbox(client).getDiscoveredThings();
    ok("getDiscoveredThings", r);
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Sitemaps
  // ════════════════════════════════════════════════════════════════════════════

  await run(50, "getSitemaps", async () => {
    const r = await new Sitemaps(client).getSitemaps();
    ok("getSitemaps", r);
    if (Array.isArray(r) && r.length > 0) info(`Erste Sitemap: "${r[0].name}"`);
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Tags / Templates / ModuleTypes / ProfileTypes
  // ════════════════════════════════════════════════════════════════════════════

  await run(51, "getTags",          async () => { ok("getTags",          await new Tags(client).getTags()); });
  await run(52, "getTemplates",     async () => { ok("getTemplates",     await new Templates(client).getTemplates()); });
  await run(53, "getModuleTypes",   async () => { ok("getModuleTypes",   await new ModuleTypes(client).getModuleTypes()); });
  await run(54, "getProfileTypes",  async () => { ok("getProfileTypes",  await new ProfileTypes(client).getProfileTypes()); });

  // ════════════════════════════════════════════════════════════════════════════
  // Transformations / UI / Services / Iconsets / Auth / Voice
  // ════════════════════════════════════════════════════════════════════════════

  await run(55, "getTransformations",     async () => { ok("getTransformations",     await new Transformations(client).getTransformations()); });
  await run(56, "getTransformationServices", async () => { ok("getTransformationServices", await new Transformations(client).getTransformationServices()); });
  await run(57, "getUITiles",             async () => { ok("getUITiles",             await new UI(client).getUITiles()); });
  await run(58, "getServices",            async () => { ok("getServices",            await new Services(client).getServices()); });
  await run(59, "getIconsets",            async () => { ok("getIconsets",            await new Iconsets(client).getIconsets()); });
  await run(60, "getAPITokens (Auth)",    async () => { ok("getAPITokens",           await new Auth(client).getAPITokens()); });
  await run(61, "getSessions (Auth)",     async () => { ok("getSessions",            await new Auth(client).getSessions()); });
  await run(62, "getVoices",             async () => { ok("getVoices",             await new Voice(client).getVoices()); });
  await run(63, "getDefaultVoice",       async () => { ok("getDefaultVoice",       await new Voice(client).getDefaultVoice()); });
  await run(64, "getInterpreters",       async () => { ok("getInterpreters",       await new Voice(client).getInterpreters()); });

  // ─── Zusammenfassung ────────────────────────────────────────────────────────
  console.log(`\n${BOLD}${"═".repeat(55)}${RESET}`);
  console.log(`  Ergebnis: ${total} Tests   ${GREEN}${BOLD}${passed} bestanden${RESET}   ${failed > 0 ? RED + BOLD : ""}${failed} fehlgeschlagen${RESET}`);
  console.log(`${BOLD}${"═".repeat(55)}${RESET}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
