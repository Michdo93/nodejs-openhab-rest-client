#!/usr/bin/env node
/**
 * Simple zero-dependency build script.
 * Reads src/index.js and produces:
 *   dist/esm/index.js  — ES Module (keep export keywords)
 *   dist/cjs/index.js  — CommonJS  (replace export with module.exports)
 *   dist/types/index.d.ts — TypeScript type declarations
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = __dirname;
const SRC       = join(ROOT, "src", "index.js");

const src = readFileSync(SRC, "utf8");

// ── Collect all exported names ────────────────────────────────────────────────
const exportedNames = [];
for (const m of src.matchAll(/^export class (\w+)/gm)) {
  exportedNames.push(m[1]);
}

// ── ESM dist ─────────────────────────────────────────────────────────────────
mkdirSync(join(ROOT, "dist", "esm"), { recursive: true });
writeFileSync(join(ROOT, "dist", "esm", "index.js"), src, "utf8");
writeFileSync(join(ROOT, "dist", "esm", "package.json"), JSON.stringify({ type: "module" }), "utf8");
console.log(`✓ ESM   → dist/esm/index.js   (${exportedNames.length} exports)`);

// ── CJS dist ─────────────────────────────────────────────────────────────────
// Strategy: remove "export" keyword, append module.exports at the end
let cjs = src
  .replace(/^export class /gm, "class ")      // export class Foo → class Foo
  .replace(/^export \{ .+ \};\s*$/gm, "");    // remove any explicit export {} blocks

cjs += `\n\nmodule.exports = {\n${exportedNames.map(n => `  ${n},`).join("\n")}\n};\n`;

mkdirSync(join(ROOT, "dist", "cjs"), { recursive: true });
writeFileSync(join(ROOT, "dist", "cjs", "index.js"), cjs, "utf8");
writeFileSync(join(ROOT, "dist", "cjs", "package.json"), JSON.stringify({ type: "commonjs" }), "utf8");
console.log(`✓ CJS   → dist/cjs/index.js`);

// ── TypeScript declarations ───────────────────────────────────────────────────
const dts = `// Auto-generated type declarations for openhab-rest-client
// Full source: src/index.js

export declare class OpenHABClient {
  url: string;
  username: string | null;
  password: string | null;
  token: string | null;
  isCloud: boolean;
  isLoggedIn: boolean;
  constructor(url: string, username?: string | null, password?: string | null, token?: string | null);
  login(): Promise<this>;
  get(endpoint: string, headers?: Record<string, string>, params?: Record<string, unknown> | null): Promise<unknown>;
  post(endpoint: string, headers?: Record<string, string>, data?: unknown, params?: Record<string, unknown> | null): Promise<unknown>;
  put(endpoint: string, headers?: Record<string, string>, data?: unknown, params?: Record<string, unknown> | null): Promise<unknown>;
  delete(endpoint: string, headers?: Record<string, string>, data?: unknown, params?: Record<string, unknown> | null): Promise<unknown>;
  _executeSSE(url: string, headers?: Record<string, string>): Promise<Response>;
}
export declare class AsyncOpenHABClient extends OpenHABClient {}

export declare class Items {
  constructor(client: OpenHABClient);
  getItems(options?: { type?: string|null; tags?: string|null; metadata?: string; recursive?: boolean; fields?: string|null; staticDataOnly?: boolean; language?: string|null }): Promise<unknown>;
  addOrUpdateItems(items: object[]): Promise<unknown>;
  getItem(itemName: string, options?: { metadata?: string; recursive?: boolean; language?: string|null }): Promise<unknown>;
  addOrUpdateItem(itemName: string, itemData: object, language?: string|null): Promise<unknown>;
  sendCommand(itemName: string, command: string): Promise<unknown>;
  postUpdate(itemName: string, state: string): Promise<unknown>;
  deleteItem(itemName: string): Promise<unknown>;
  addGroupMember(itemName: string, memberItemName: string): Promise<unknown>;
  removeGroupMember(itemName: string, memberItemName: string): Promise<unknown>;
  addMetadata(itemName: string, namespace: string, metadata: object): Promise<unknown>;
  removeMetadata(itemName: string, namespace: string): Promise<unknown>;
  getMetadataNamespaces(itemName: string, language?: string|null): Promise<unknown>;
  getSemanticItem(itemName: string, semanticClass: string, language?: string|null): Promise<unknown>;
  getItemState(itemName: string): Promise<unknown>;
  updateItemState(itemName: string, state: string, language?: string|null): Promise<unknown>;
  addTag(itemName: string, tag: string): Promise<unknown>;
  removeTag(itemName: string, tag: string): Promise<unknown>;
  purgeOrphanedMetadata(): Promise<unknown>;
}
export declare class AsyncItems extends Items {}

export declare class Things {
  constructor(client: OpenHABClient);
  getThings(summary?: boolean, staticDataOnly?: boolean, language?: string|null): Promise<unknown>;
  createThing(thingData: object, language?: string|null): Promise<unknown>;
  getThing(thingUID: string, language?: string|null): Promise<unknown>;
  updateThing(thingUID: string, thingData: object, language?: string|null): Promise<unknown>;
  deleteThing(thingUID: string, force?: boolean, language?: string|null): Promise<unknown>;
  updateThingConfiguration(thingUID: string, configurationData: object, language?: string|null): Promise<unknown>;
  getThingConfigStatus(thingUID: string, language?: string|null): Promise<unknown>;
  setThingStatus(thingUID: string, enabled: boolean, language?: string|null): Promise<unknown>;
  enableThing(thingUID: string): Promise<unknown>;
  disableThing(thingUID: string): Promise<unknown>;
  updateThingFirmware(thingUID: string, firmwareVersion: string, language?: string|null): Promise<unknown>;
  getThingFirmwareStatus(thingUID: string, language?: string|null): Promise<unknown>;
  getThingFirmwares(thingUID: string, language?: string|null): Promise<unknown>;
  getThingStatus(thingUID: string, language?: string|null): Promise<unknown>;
}
export declare class AsyncThings extends Things {}

export declare class Events {
  constructor(client: OpenHABClient);
  getEvents(topics?: string|null): Promise<Response>;
  initiateStateTracker(): Promise<Response>;
  updateSSEConnectionItems(connectionID: string, items: string[]): Promise<unknown>;
}
export declare class AsyncEvents extends Events {}

export declare class ItemEvents {
  constructor(client: OpenHABClient);
  ItemEvent(): Promise<Response>;
  ItemAddedEvent(itemName?: string): Promise<Response>;
  ItemRemovedEvent(itemName?: string): Promise<Response>;
  ItemUpdatedEvent(itemName?: string): Promise<Response>;
  ItemCommandEvent(itemName?: string): Promise<Response>;
  ItemStateEvent(itemName?: string): Promise<Response>;
  ItemStatePredictedEvent(itemName?: string): Promise<Response>;
  ItemStateChangedEvent(itemName?: string): Promise<Response>;
  GroupItemStateChangedEvent(itemName: string, memberName: string): Promise<Response>;
}
export declare class AsyncItemEvents extends ItemEvents {}

export declare class ThingEvents {
  constructor(client: OpenHABClient);
  ThingAddedEvent(thingUID?: string): Promise<Response>;
  ThingRemovedEvent(thingUID?: string): Promise<Response>;
  ThingUpdatedEvent(thingUID?: string): Promise<Response>;
  ThingStatusInfoEvent(thingUID?: string): Promise<Response>;
  ThingStatusInfoChangedEvent(thingUID?: string): Promise<Response>;
}
export declare class AsyncThingEvents extends ThingEvents {}

export declare class InboxEvents {
  constructor(client: OpenHABClient);
  InboxAddedEvent(thingUID?: string): Promise<Response>;
  InboxRemovedEvent(thingUID?: string): Promise<Response>;
  InboxUpdatedEvent(thingUID?: string): Promise<Response>;
}
export declare class AsyncInboxEvents extends InboxEvents {}

export declare class LinkEvents {
  constructor(client: OpenHABClient);
  ItemChannelLinkAddedEvent(itemName?: string, channelUID?: string): Promise<Response>;
  ItemChannelLinkRemovedEvent(itemName?: string, channelUID?: string): Promise<Response>;
}
export declare class AsyncLinkEvents extends LinkEvents {}

export declare class ChannelEvents {
  constructor(client: OpenHABClient);
  ChannelDescriptionChangedEvent(channelUID?: string): Promise<Response>;
  ChannelTriggeredEvent(channelUID?: string): Promise<Response>;
}
export declare class AsyncChannelEvents extends ChannelEvents {}

export declare class Actions {
  constructor(client: OpenHABClient);
  getActions(thingUID: string, language?: string|null): Promise<unknown>;
  executeAction(thingUID: string, actionUID: string, actionInputs: object, language?: string|null): Promise<unknown>;
}
export declare class AsyncActions extends Actions {}

export declare class Addons {
  constructor(client: OpenHABClient);
  getAddons(serviceID?: string|null, language?: string|null): Promise<unknown>;
  getAddon(addonID: string, serviceID?: string|null, language?: string|null): Promise<unknown>;
  getAddonConfig(addonID: string, serviceID?: string|null): Promise<unknown>;
  updateAddonConfig(addonID: string, configData: object, serviceID?: string|null): Promise<unknown>;
  installAddon(addonID: string, serviceID?: string|null): Promise<unknown>;
  uninstallAddon(addonID: string, serviceID?: string|null): Promise<unknown>;
  getAddonServices(language?: string|null): Promise<unknown>;
  getAddonSuggestions(language?: string|null): Promise<unknown>;
  getAddonTypes(serviceID?: string|null, language?: string|null): Promise<unknown>;
  installAddonFromUrl(url: string): Promise<unknown>;
}
export declare class AsyncAddons extends Addons {}

export declare class Audio {
  constructor(client: OpenHABClient);
  getDefaultSink(language?: string|null): Promise<unknown>;
  getDefaultSource(language?: string|null): Promise<unknown>;
  getSinks(language?: string|null): Promise<unknown>;
  getSources(language?: string|null): Promise<unknown>;
}
export declare class AsyncAudio extends Audio {}

export declare class Auth {
  constructor(client: OpenHABClient);
  getAPITokens(): Promise<unknown>;
  revokeAPIToken(tokenName: string): Promise<unknown>;
  logout(refreshToken: string, sessionID: string): Promise<unknown>;
  getSessions(): Promise<unknown>;
  getToken(options?: { grantType?: string; code?: string; redirectURI?: string; clientID?: string; refreshToken?: string; codeVerifier?: string }): Promise<unknown>;
}
export declare class AsyncAuth extends Auth {}

export declare class ChannelTypes {
  constructor(client: OpenHABClient);
  getChannelTypes(prefixes?: string|null, language?: string|null): Promise<unknown>;
  getChannelType(channelTypeUID: string, language?: string|null): Promise<unknown>;
  getLinkableItemTypes(channelTypeUID: string): Promise<unknown>;
}
export declare class AsyncChannelTypes extends ChannelTypes {}

export declare class ConfigDescriptions {
  constructor(client: OpenHABClient);
  getConfigDescriptions(scheme?: string|null, language?: string|null): Promise<unknown>;
  getConfigDescription(uri: string, language?: string|null): Promise<unknown>;
}
export declare class AsyncConfigDescriptions extends ConfigDescriptions {}

export declare class Discovery {
  constructor(client: OpenHABClient);
  getDiscoveryBindings(): Promise<unknown>;
  getBindingInfo(bindingID: string, language?: string|null): Promise<unknown>;
  startBindingScan(bindingID: string, input?: string|null): Promise<unknown>;
}
export declare class AsyncDiscovery extends Discovery {}

export declare class Iconsets {
  constructor(client: OpenHABClient);
  getIconsets(language?: string|null): Promise<unknown>;
}
export declare class AsyncIconsets extends Iconsets {}

export declare class Inbox {
  constructor(client: OpenHABClient);
  getDiscoveredThings(includeIgnored?: boolean): Promise<unknown>;
  removeDiscoveryResult(thingUID: string): Promise<unknown>;
  approveDiscoveryResult(thingUID: string, thingLabel: string, newThingID?: string|null, language?: string|null): Promise<unknown>;
  ignoreDiscoveryResult(thingUID: string): Promise<unknown>;
  unignoreDiscoveryResult(thingUID: string): Promise<unknown>;
}
export declare class AsyncInbox extends Inbox {}

export declare class Links {
  constructor(client: OpenHABClient);
  getLinks(channelUID?: string|null, itemName?: string|null): Promise<unknown>;
  getLink(itemName: string, channelUID: string): Promise<unknown>;
  linkItemToChannel(itemName: string, channelUID: string, configuration: object): Promise<unknown>;
  unlinkItemFromChannel(itemName: string, channelUID: string): Promise<unknown>;
  deleteAllLinks(object: string): Promise<unknown>;
  getOrphanLinks(): Promise<unknown>;
  purgeUnusedLinks(): Promise<unknown>;
}
export declare class AsyncLinks extends Links {}

export declare class Logging {
  constructor(client: OpenHABClient);
  getLoggers(): Promise<unknown>;
  getLogger(loggerName: string): Promise<unknown>;
  modifyOrAddLogger(loggerName: string, level: string): Promise<unknown>;
  removeLogger(loggerName: string): Promise<unknown>;
}
export declare class AsyncLogging extends Logging {}

export declare class ModuleTypes {
  constructor(client: OpenHABClient);
  getModuleTypes(tags?: string|null, typeFilter?: string|null, language?: string|null): Promise<unknown>;
  getModuleType(moduleTypeUID: string, language?: string|null): Promise<unknown>;
}
export declare class AsyncModuleTypes extends ModuleTypes {}

export declare class Persistence {
  constructor(client: OpenHABClient);
  getServices(language?: string|null): Promise<unknown>;
  getServiceConfiguration(serviceID: string): Promise<unknown>;
  setServiceConfiguration(serviceID: string, config: object): Promise<unknown>;
  deleteServiceConfiguration(serviceID: string): Promise<unknown>;
  getItemsFromService(serviceID?: string|null): Promise<unknown>;
  getItemPersistenceData(itemName: string, serviceID: string, options?: { startTime?: string; endTime?: string; page?: number; pageLength?: number; boundary?: boolean; itemState?: boolean }): Promise<unknown>;
  storeItemData(itemName: string, time: string, state: string, serviceID?: string|null): Promise<unknown>;
  deleteItemData(itemName: string, startTime: string, endTime: string, serviceID: string): Promise<unknown>;
}
export declare class AsyncPersistence extends Persistence {}

export declare class ProfileTypes {
  constructor(client: OpenHABClient);
  getProfileTypes(channelTypeUID?: string|null, itemType?: string|null, language?: string|null): Promise<unknown>;
}
export declare class AsyncProfileTypes extends ProfileTypes {}

export declare class Rules {
  constructor(client: OpenHABClient);
  getRules(prefix?: string|null, tags?: string[]|null, summary?: boolean, staticDataOnly?: boolean): Promise<unknown>;
  createRule(ruleData: object): Promise<unknown>;
  getRule(ruleUID: string): Promise<unknown>;
  updateRule(ruleUID: string, ruleData: object): Promise<unknown>;
  deleteRule(ruleUID: string): Promise<unknown>;
  getModule(ruleUID: string, moduleCategory: string, moduleID: string): Promise<unknown>;
  getModuleConfig(ruleUID: string, moduleCategory: string, moduleID: string): Promise<unknown>;
  getModuleConfigParam(ruleUID: string, moduleCategory: string, moduleID: string, param: string): Promise<unknown>;
  setModuleConfigParam(ruleUID: string, moduleCategory: string, moduleID: string, param: string, value: string): Promise<unknown>;
  getActions(ruleUID: string): Promise<unknown>;
  getConditions(ruleUID: string): Promise<unknown>;
  getTriggers(ruleUID: string): Promise<unknown>;
  getConfiguration(ruleUID: string): Promise<unknown>;
  updateConfiguration(ruleUID: string, configData: object): Promise<unknown>;
  setRuleState(ruleUID: string, enable: boolean): Promise<unknown>;
  enable(ruleUID: string): Promise<unknown>;
  disable(ruleUID: string): Promise<unknown>;
  runNow(ruleUID: string, contextData?: object|null): Promise<unknown>;
  simulateSchedule(fromTime: string, untilTime: string): Promise<unknown>;
}
export declare class AsyncRules extends Rules {}

export declare class Services {
  constructor(client: OpenHABClient);
  getServices(language?: string|null): Promise<unknown>;
  getService(serviceID: string, language?: string|null): Promise<unknown>;
  getServiceConfig(serviceID: string): Promise<unknown>;
  updateServiceConfig(serviceID: string, configData: object, language?: string|null): Promise<unknown>;
  deleteServiceConfig(serviceID: string): Promise<unknown>;
  getServiceContexts(serviceID: string, language?: string|null): Promise<unknown>;
}
export declare class AsyncServices extends Services {}

export declare class Sitemaps {
  constructor(client: OpenHABClient);
  getSitemaps(): Promise<unknown>;
  getSitemap(sitemapName: string, type?: string|null, jsonCallback?: string|null, includeHidden?: boolean, language?: string|null): Promise<unknown>;
  getSitemapPage(sitemapName: string, pageID: string, subscriptionID?: string|null, includeHidden?: boolean, language?: string|null): Promise<unknown>;
  getFullSitemap(sitemapName: string, subscriptionID?: string|null, includeHidden?: boolean, language?: string|null): Promise<unknown>;
  getSitemapEvents(subscriptionID: string, sitemapName?: string|null, pageID?: string|null): Promise<Response>;
  getFullSitemapEvents(subscriptionID: string, sitemapName?: string|null): Promise<Response>;
  subscribeToSitemapEvents(): Promise<unknown>;
}
export declare class AsyncSitemaps extends Sitemaps {}

export declare class Systeminfo {
  constructor(client: OpenHABClient);
  getSystemInfo(): Promise<unknown>;
  getUoMInfo(): Promise<unknown>;
}
export declare class AsyncSysteminfo extends Systeminfo {}

export declare class Tags {
  constructor(client: OpenHABClient);
  getTags(language?: string|null): Promise<unknown>;
  createTag(tagData: object, language?: string|null): Promise<unknown>;
  getTag(tagID: string, language?: string|null): Promise<unknown>;
  updateTag(tagID: string, tagData: object, language?: string|null): Promise<unknown>;
  deleteTag(tagID: string, language?: string|null): Promise<unknown>;
}
export declare class AsyncTags extends Tags {}

export declare class Templates {
  constructor(client: OpenHABClient);
  getTemplates(language?: string|null): Promise<unknown>;
  getTemplate(templateUID: string, language?: string|null): Promise<unknown>;
}
export declare class AsyncTemplates extends Templates {}

export declare class ThingTypes {
  constructor(client: OpenHABClient);
  getThingTypes(bindingID?: string|null, language?: string|null): Promise<unknown>;
  getThingType(thingTypeUID: string, language?: string|null): Promise<unknown>;
}
export declare class AsyncThingTypes extends ThingTypes {}

export declare class Transformations {
  constructor(client: OpenHABClient);
  getTransformations(): Promise<unknown>;
  getTransformation(transformationUID: string): Promise<unknown>;
  updateTransformation(transformationUID: string, transformationData: object): Promise<unknown>;
  deleteTransformation(transformationUID: string): Promise<unknown>;
  getTransformationServices(): Promise<unknown>;
}
export declare class AsyncTransformations extends Transformations {}

export declare class UI {
  constructor(client: OpenHABClient);
  getUIComponents(namespace: string, summary?: boolean): Promise<unknown>;
  addUIComponent(namespace: string, componentData: object): Promise<unknown>;
  getUIComponent(namespace: string, componentUID: string): Promise<unknown>;
  updateUIComponent(namespace: string, componentUID: string, componentData: object): Promise<unknown>;
  deleteUIComponent(namespace: string, componentUID: string): Promise<unknown>;
  getUITiles(): Promise<unknown>;
}
export declare class AsyncUI extends UI {}

export declare class UUID {
  constructor(client: OpenHABClient);
  getUUID(): Promise<string>;
}
export declare class AsyncUUID extends UUID {}

export declare class Voice {
  constructor(client: OpenHABClient);
  getDefaultVoice(): Promise<unknown>;
  startDialog(sourceID: string, options?: { ksID?: string|null; sttID?: string|null; ttsID?: string|null; voiceID?: string|null; hliIDs?: string|null; sinkID?: string|null; keyword?: string|null; listeningItem?: string|null }): Promise<unknown>;
  stopDialog(sourceID: string): Promise<unknown>;
  getInterpreters(language?: string|null): Promise<unknown>;
  interpretText(text: string, language?: string|null): Promise<unknown>;
  getInterpreter(interpreterID: string, language?: string|null): Promise<unknown>;
  interpretTextBatch(text: string, IDs: string[], language?: string|null): Promise<unknown>;
  listenAndAnswer(sourceID: string, sttID: string, ttsID: string, voiceID: string, options?: { hliIDs?: string|null; sinkID?: string|null; listeningItem?: string|null }): Promise<unknown>;
  sayText(text: string, voiceID: string, sinkID: string, volume?: string): Promise<unknown>;
  getVoices(): Promise<unknown>;
}
export declare class AsyncVoice extends Voice {}
`;

mkdirSync(join(ROOT, "dist", "types"), { recursive: true });
writeFileSync(join(ROOT, "dist", "types", "index.d.ts"), dts, "utf8");
console.log(`✓ Types → dist/types/index.d.ts`);

console.log("\n✅ Build complete.");
