// ─── Node.js compatibility shim ─────────────────────────────────────────────
// fetch  → native in Node ≥ 18
// btoa   → native in Node ≥ 16
// For SSE we use the native fetch streaming API (same as browser).

// ─── Core classes ────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════════
// OpenHABClient
// ═══════════════════════════════════════════════════════════════════════════════

export class OpenHABClient {
  /**
   * @param {string}      url
   * @param {string|null} [username]
   * @param {string|null} [password]
   * @param {string|null} [token]
   */
  constructor(url, username = null, password = null, token = null) {
    this.url      = url.replace(/\/$/, "");
    this.username = username;
    this.password = password;
    this.token    = token;
    this.isCloud  = false;
    this.isLoggedIn = false;
  }

  _buildHeaders(extra = {}) {
    const h = { ...extra };
    if (this.token) {
      h["Authorization"] = `Bearer ${this.token}`;
      if (!h["Content-Type"]) h["Content-Type"] = "application/json";
    } else if (this.username && this.password) {
      h["Authorization"] = "Basic " + btoa(`${this.username}:${this.password}`);
    }
    return h;
  }

  _normalise(endpoint) {
    if (!endpoint.startsWith("/"))     endpoint = "/" + endpoint;
    if (!endpoint.startsWith("/rest")) endpoint = "/rest" + endpoint;
    return endpoint;
  }

  async _executeRequest(method, endpoint, headers = {}, data = null, params = null) {
    const path = this._normalise(endpoint);
    let url = this.url + path;

    if (params) {
      const filtered = Object.fromEntries(
        Object.entries(params).filter(([, v]) => v !== null && v !== undefined)
      );
      const qs = new URLSearchParams(filtered).toString();
      if (qs) url += "?" + qs;
    }

    const options = { method: method.toUpperCase(), headers: this._buildHeaders(headers) };
    if (data !== null && data !== undefined) {
      options.body = typeof data === "string" ? data : JSON.stringify(data);
    }

    const response = await fetch(url, options);

    if (response.headers.get("Location")) return response;

    if (!response.ok) {
      const err = new Error(`HTTP ${response.status}: ${response.statusText}`);
      err.status   = response.status;
      err.response = response;
      throw err;
    }

    const text = await response.text();
    if (!text.trim()) return { status: response.status };

    const ct = response.headers.get("Content-Type") || "";
    if (ct.includes("application/json")) {
      try { return JSON.parse(text); } catch { return text; }
    }
    return text;
  }

  /** Returns a fetch Response whose body is a readable SSE stream */
  _executeSSE(url, headers = {}) {
    const fullUrl = url.startsWith("http") ? url : this.url + url;
    return fetch(fullUrl, {
      method: "GET",
      headers: this._buildHeaders({ Accept: "text/event-stream", ...headers }),
    });
  }

  async login() {
    this.isCloud = this.url === "https://myopenhab.org";
    try {
      const r = await fetch(this.url + "/rest", { headers: this._buildHeaders() });
      if (r.ok || r.status === 200) this.isLoggedIn = true;
    } catch (e) {
      console.error("openHAB login error:", e.message);
    }
    return this;
  }

  get(ep, h = {}, p = null)             { return this._executeRequest("GET",    ep, h, null, p); }
  post(ep, h = {}, d = null, p = null)  { return this._executeRequest("POST",   ep, h, d,    p); }
  put(ep, h = {}, d = null, p = null)   { return this._executeRequest("PUT",    ep, h, d,    p); }
  delete(ep, h = {}, d = null, p = null){ return this._executeRequest("DELETE", ep, h, d,    p); }
}

export class AsyncOpenHABClient extends OpenHABClient {}

// ═══════════════════════════════════════════════════════════════════════════════
// Items
// ═══════════════════════════════════════════════════════════════════════════════

export class Items {
  constructor(client) { this.client = client; }

  getItems({ type=null, tags=null, metadata=".*", recursive=false,
             fields=null, staticDataOnly=false, language=null } = {}) {
    const h = { Accept: "application/json" };
    if (language) h["Accept-Language"] = language;
    return this.client.get("/items", h,
      { type, tags, metadata, recursive: String(recursive), fields, staticDataOnly: String(staticDataOnly) });
  }
  addOrUpdateItems(items) {
    return this.client.put("/items", { "Content-Type": "application/json", Accept: "*/*" }, JSON.stringify(items));
  }
  getItem(itemName, { metadata=".*", recursive=true, language=null } = {}) {
    const h = { Accept: "application/json" };
    if (language) h["Accept-Language"] = language;
    return this.client.get(`/items/${itemName}`, h, { metadata, recursive: String(recursive) });
  }
  addOrUpdateItem(itemName, itemData, language=null) {
    const h = { "Content-Type": "application/json", Accept: "*/*" };
    if (language) h["Accept-Language"] = language;
    return this.client.put(`/items/${itemName}`, h, JSON.stringify(itemData));
  }
  sendCommand(itemName, command) {
    return this.client.post(`/items/${itemName}`, { "Content-Type": "text/plain" }, command);
  }
  postUpdate(itemName, state) { return this.updateItemState(itemName, state); }
  deleteItem(itemName)        { return this.client.delete(`/items/${itemName}`); }
  addGroupMember(itemName, memberItemName)    { return this.client.put(`/items/${itemName}/members/${memberItemName}`); }
  removeGroupMember(itemName, memberItemName) { return this.client.delete(`/items/${itemName}/members/${memberItemName}`); }
  addMetadata(itemName, namespace, metadata) {
    return this.client.put(`/items/${itemName}/metadata/${namespace}`,
      { "Content-Type": "application/json" }, JSON.stringify(metadata));
  }
  removeMetadata(itemName, namespace) { return this.client.delete(`/items/${itemName}/metadata/${namespace}`); }
  getMetadataNamespaces(itemName, language=null) {
    const h = { Accept: "application/json" };
    if (language) h["Accept-Language"] = language;
    return this.client.get(`/items/${itemName}/metadata/namespaces`, h);
  }
  getSemanticItem(itemName, semanticClass, language=null) {
    const h = { Accept: "application/json" };
    if (language) h["Accept-Language"] = language;
    return this.client.get(`/items/${itemName}/semantic/${semanticClass}`, h);
  }
  getItemState(itemName)     { return this.client.get(`/items/${itemName}/state`, { Accept: "text/plain" }); }
  updateItemState(itemName, state, language=null) {
    const h = { "Content-Type": "text/plain" };
    if (language) h["Accept-Language"] = language;
    return this.client.put(`/items/${itemName}/state`, h, state);
  }
  addTag(itemName, tag)    { return this.client.put(`/items/${itemName}/tags/${tag}`); }
  removeTag(itemName, tag) { return this.client.delete(`/items/${itemName}/tags/${tag}`); }
  purgeOrphanedMetadata()  { return this.client.post("/items/metadata/purge"); }
}
export class AsyncItems extends Items {}

// ═══════════════════════════════════════════════════════════════════════════════
// Things
// ═══════════════════════════════════════════════════════════════════════════════

export class Things {
  constructor(client) { this.client = client; }
  getThings(summary=false, staticDataOnly=false, language=null) {
    const h = { Accept: "application/json" };
    if (language) h["Accept-Language"] = language;
    return this.client.get("/things", h, { summary, staticDataOnly });
  }
  createThing(thingData, language=null) {
    const h = { "Content-Type": "application/json", Accept: "application/json" };
    if (language) h["Accept-Language"] = language;
    return this.client.post("/things", h, JSON.stringify(thingData));
  }
  getThing(thingUID, language=null) {
    const h = { Accept: "application/json" };
    if (language) h["Accept-Language"] = language;
    return this.client.get(`/things/${thingUID}`, h);
  }
  updateThing(thingUID, thingData, language=null) {
    const h = { "Content-Type": "application/json", Accept: "application/json" };
    if (language) h["Accept-Language"] = language;
    return this.client.put(`/things/${thingUID}`, h, JSON.stringify(thingData));
  }
  deleteThing(thingUID, force=false, language=null) {
    const h = {};
    if (language) h["Accept-Language"] = language;
    return this.client.delete(`/things/${thingUID}`, h, null, { force });
  }
  updateThingConfiguration(thingUID, configurationData, language=null) {
    const h = { "Content-Type": "application/json", Accept: "application/json" };
    if (language) h["Accept-Language"] = language;
    return this.client.put(`/things/${thingUID}/config`, h, JSON.stringify(configurationData));
  }
  getThingConfigStatus(thingUID, language=null) {
    const h = { Accept: "application/json" };
    if (language) h["Accept-Language"] = language;
    return this.client.get(`/things/${thingUID}/config/status`, h);
  }
  setThingStatus(thingUID, enabled, language=null) {
    const h = { "Content-Type": "text/plain" };
    if (language) h["Accept-Language"] = language;
    return this.client.put(`/things/${thingUID}/enable`, h, String(enabled));
  }
  enableThing(thingUID)  { return this.setThingStatus(thingUID, true); }
  disableThing(thingUID) { return this.setThingStatus(thingUID, false); }
  updateThingFirmware(thingUID, firmwareVersion, language=null) {
    const h = { "Content-Type": "application/json" };
    if (language) h["Accept-Language"] = language;
    return this.client.put(`/things/${thingUID}/firmware/${firmwareVersion}`, h);
  }
  getThingFirmwareStatus(thingUID, language=null) {
    const h = { Accept: "application/json" };
    if (language) h["Accept-Language"] = language;
    return this.client.get(`/things/${thingUID}/firmware/status`, h);
  }
  getThingFirmwares(thingUID, language=null) {
    const h = { Accept: "application/json" };
    if (language) h["Accept-Language"] = language;
    return this.client.get(`/things/${thingUID}/firmwares`, h);
  }
  getThingStatus(thingUID, language=null) {
    const h = { Accept: "application/json" };
    if (language) h["Accept-Language"] = language;
    return this.client.get(`/things/${thingUID}/status`, h);
  }
}
export class AsyncThings extends Things {}

// ═══════════════════════════════════════════════════════════════════════════════
// Events
// ═══════════════════════════════════════════════════════════════════════════════

export class Events {
  constructor(client) { this.client = client; }
  getEvents(topics=null) {
    const url = this.client.url + "/rest/events" + (topics ? `?topics=${topics}` : "");
    return this.client._executeSSE(url);
  }
  initiateStateTracker() {
    return this.client._executeSSE(this.client.url + "/rest/events/states", { Accept: "*/*" });
  }
  updateSSEConnectionItems(connectionID, items) {
    return this.client.post(`/events/states/${connectionID}`,
      { "Content-Type": "application/json" }, JSON.stringify(items));
  }
}
export class AsyncEvents extends Events {}

export class ItemEvents {
  constructor(client) { this.client = client; }
  ItemEvent()                                   { return this.client._executeSSE(this.client.url + "/rest/events?topics=openhab/items"); }
  ItemAddedEvent(itemName="*")                  { return this.client._executeSSE(this.client.url + `/rest/events?topics=openhab/items/${itemName}/added`); }
  ItemRemovedEvent(itemName="*")                { return this.client._executeSSE(this.client.url + `/rest/events?topics=openhab/items/${itemName}/removed`); }
  ItemUpdatedEvent(itemName="*")                { return this.client._executeSSE(this.client.url + `/rest/events?topics=openhab/items/${itemName}/updated`); }
  ItemCommandEvent(itemName="*")                { return this.client._executeSSE(this.client.url + `/rest/events?topics=openhab/items/${itemName}/command`); }
  ItemStateEvent(itemName="*")                  { return this.client._executeSSE(this.client.url + `/rest/events?topics=openhab/items/${itemName}/state`); }
  ItemStatePredictedEvent(itemName="*")         { return this.client._executeSSE(this.client.url + `/rest/events?topics=openhab/items/${itemName}/statepredicted`); }
  ItemStateChangedEvent(itemName="*")           { return this.client._executeSSE(this.client.url + `/rest/events?topics=openhab/items/${itemName}/statechanged`); }
  GroupItemStateChangedEvent(itemName, member)  { return this.client._executeSSE(this.client.url + `/rest/events?topics=openhab/items/${itemName}/${member}/statechanged`); }
}
export class AsyncItemEvents extends ItemEvents {}

export class ThingEvents {
  constructor(client) { this.client = client; }
  ThingAddedEvent(thingUID="*")             { return this.client._executeSSE(this.client.url + `/rest/events?topics=openhab/things/${thingUID}/added`); }
  ThingRemovedEvent(thingUID="*")           { return this.client._executeSSE(this.client.url + `/rest/events?topics=openhab/things/${thingUID}/removed`); }
  ThingUpdatedEvent(thingUID="*")           { return this.client._executeSSE(this.client.url + `/rest/events?topics=openhab/things/${thingUID}/updated`); }
  ThingStatusInfoEvent(thingUID="*")        { return this.client._executeSSE(this.client.url + `/rest/events?topics=openhab/things/${thingUID}/status`); }
  ThingStatusInfoChangedEvent(thingUID="*") { return this.client._executeSSE(this.client.url + `/rest/events?topics=openhab/things/${thingUID}/statuschanged`); }
}
export class AsyncThingEvents extends ThingEvents {}

export class InboxEvents {
  constructor(client) { this.client = client; }
  InboxAddedEvent(thingUID="*")   { return this.client._executeSSE(this.client.url + `/rest/events?topics=openhab/inbox/${thingUID}/added`); }
  InboxRemovedEvent(thingUID="*") { return this.client._executeSSE(this.client.url + `/rest/events?topics=openhab/inbox/${thingUID}/removed`); }
  InboxUpdatedEvent(thingUID="*") { return this.client._executeSSE(this.client.url + `/rest/events?topics=openhab/inbox/${thingUID}/updated`); }
}
export class AsyncInboxEvents extends InboxEvents {}

export class LinkEvents {
  constructor(client) { this.client = client; }
  ItemChannelLinkAddedEvent(itemName="*", channelUID="*")   { return this.client._executeSSE(this.client.url + `/rest/events?topics=openhab/links/${itemName}-${channelUID}/added`); }
  ItemChannelLinkRemovedEvent(itemName="*", channelUID="*") { return this.client._executeSSE(this.client.url + `/rest/events?topics=openhab/links/${itemName}-${channelUID}/removed`); }
}
export class AsyncLinkEvents extends LinkEvents {}

export class ChannelEvents {
  constructor(client) { this.client = client; }
  ChannelDescriptionChangedEvent(channelUID="*") { return this.client._executeSSE(this.client.url + `/rest/events?topics=openhab/channels/${channelUID}/descriptionchanged`); }
  ChannelTriggeredEvent(channelUID="*")          { return this.client._executeSSE(this.client.url + `/rest/events?topics=openhab/channels/${channelUID}/triggered`); }
}
export class AsyncChannelEvents extends ChannelEvents {}

// ═══════════════════════════════════════════════════════════════════════════════
// Actions
// ═══════════════════════════════════════════════════════════════════════════════

export class Actions {
  constructor(client) { this.client = client; }
  getActions(thingUID, language=null) {
    const h = { Accept: "application/json" };
    if (language) h["Accept-Language"] = language;
    return this.client.get(`/actions/${thingUID}`, h);
  }
  executeAction(thingUID, actionUID, actionInputs, language=null) {
    const h = { "Content-Type": "application/json", Accept: "application/json" };
    if (language) h["Accept-Language"] = language;
    return this.client.post(`/actions/${thingUID}/${actionUID}`, h, JSON.stringify(actionInputs));
  }
}
export class AsyncActions extends Actions {}

// ═══════════════════════════════════════════════════════════════════════════════
// Addons
// ═══════════════════════════════════════════════════════════════════════════════

export class Addons {
  constructor(client) { this.client = client; }
  getAddons(serviceID=null, language=null) {
    const h = { Accept: "application/json" };
    if (language) h["Accept-Language"] = language;
    return this.client.get("/addons", h, serviceID ? { serviceId: serviceID } : null);
  }
  getAddon(addonID, serviceID=null, language=null) {
    const h = { Accept: "application/json" };
    if (language) h["Accept-Language"] = language;
    return this.client.get(`/addons/${addonID}`, h, serviceID ? { serviceId: serviceID } : null);
  }
  getAddonConfig(addonID, serviceID=null)                     { return this.client.get(`/addons/${addonID}/config`, {}, serviceID ? { serviceId: serviceID } : null); }
  updateAddonConfig(addonID, configData, serviceID=null)      { return this.client.put(`/addons/${addonID}/config`, { "Content-Type": "application/json" }, JSON.stringify(configData), serviceID ? { serviceId: serviceID } : null); }
  installAddon(addonID, serviceID=null)                       { return this.client.post(`/addons/${addonID}/install`, {}, null, serviceID ? { serviceId: serviceID } : null); }
  uninstallAddon(addonID, serviceID=null)                     { return this.client.post(`/addons/${addonID}/uninstall`, {}, null, serviceID ? { serviceId: serviceID } : null); }
  getAddonServices(language=null)      { const h = { Accept: "application/json" }; if (language) h["Accept-Language"] = language; return this.client.get("/addons/services", h); }
  getAddonSuggestions(language=null)   { const h = { Accept: "application/json" }; if (language) h["Accept-Language"] = language; return this.client.get("/addons/suggestions", h); }
  getAddonTypes(serviceID=null, language=null) { const h = { Accept: "application/json" }; if (language) h["Accept-Language"] = language; return this.client.get("/addons/types", h, serviceID ? { serviceId: serviceID } : null); }
  installAddonFromUrl(url)             { return this.client.post("/addons/url", { "Content-Type": "text/plain" }, url); }
}
export class AsyncAddons extends Addons {}

// ═══════════════════════════════════════════════════════════════════════════════
// Audio
// ═══════════════════════════════════════════════════════════════════════════════

export class Audio {
  constructor(client) { this.client = client; }
  getDefaultSink(language=null)   { const h = { Accept: "application/json" }; if (language) h["Accept-Language"] = language; return this.client.get("/audio/defaultsink",   h); }
  getDefaultSource(language=null) { const h = { Accept: "application/json" }; if (language) h["Accept-Language"] = language; return this.client.get("/audio/defaultsource", h); }
  getSinks(language=null)         { const h = { Accept: "application/json" }; if (language) h["Accept-Language"] = language; return this.client.get("/audio/sinks",         h); }
  getSources(language=null)       { const h = { Accept: "application/json" }; if (language) h["Accept-Language"] = language; return this.client.get("/audio/sources",       h); }
}
export class AsyncAudio extends Audio {}

// ═══════════════════════════════════════════════════════════════════════════════
// Auth
// ═══════════════════════════════════════════════════════════════════════════════

export class Auth {
  constructor(client) { this.client = client; }
  getAPITokens()                     { return this.client.get("/auth/apitokens"); }
  revokeAPIToken(tokenName)          { return this.client.delete(`/auth/apitokens/${tokenName}`); }
  logout(refreshToken, sessionID)    { return this.client.delete("/auth/logout", {}, null, { refreshToken, sessionId: sessionID }); }
  getSessions()                      { return this.client.get("/auth/sessions"); }
  getToken({ grantType=null, code=null, redirectURI=null, clientID=null, refreshToken=null, codeVerifier=null } = {}) {
    const body = new URLSearchParams();
    if (grantType)    body.append("grant_type",   grantType);
    if (code)         body.append("code",          code);
    if (redirectURI)  body.append("redirect_uri",  redirectURI);
    if (clientID)     body.append("client_id",     clientID);
    if (refreshToken) body.append("refresh_token", refreshToken);
    if (codeVerifier) body.append("code_verifier", codeVerifier);
    return this.client.post("/auth/token", { "Content-Type": "application/x-www-form-urlencoded" }, body.toString());
  }
}
export class AsyncAuth extends Auth {}

// ═══════════════════════════════════════════════════════════════════════════════
// ChannelTypes
// ═══════════════════════════════════════════════════════════════════════════════

export class ChannelTypes {
  constructor(client) { this.client = client; }
  getChannelTypes(prefixes=null, language=null) {
    const h = { Accept: "application/json" };
    if (language) h["Accept-Language"] = language;
    return this.client.get("/channel-types", h, prefixes ? { prefixes } : null);
  }
  getChannelType(channelTypeUID, language=null) {
    const h = { Accept: "application/json" };
    if (language) h["Accept-Language"] = language;
    return this.client.get(`/channel-types/${channelTypeUID}`, h);
  }
  getLinkableItemTypes(channelTypeUID) { return this.client.get(`/channel-types/${channelTypeUID}/linkableItemTypes`); }
}
export class AsyncChannelTypes extends ChannelTypes {}

// ═══════════════════════════════════════════════════════════════════════════════
// ConfigDescriptions
// ═══════════════════════════════════════════════════════════════════════════════

export class ConfigDescriptions {
  constructor(client) { this.client = client; }
  getConfigDescriptions(scheme=null, language=null) {
    const h = { Accept: "application/json" };
    if (language) h["Accept-Language"] = language;
    return this.client.get("/config-descriptions", h, scheme ? { scheme } : null);
  }
  getConfigDescription(uri, language=null) {
    const h = { Accept: "application/json" };
    if (language) h["Accept-Language"] = language;
    return this.client.get(`/config-descriptions/${encodeURIComponent(uri)}`, h);
  }
}
export class AsyncConfigDescriptions extends ConfigDescriptions {}

// ═══════════════════════════════════════════════════════════════════════════════
// Discovery
// ═══════════════════════════════════════════════════════════════════════════════

export class Discovery {
  constructor(client) { this.client = client; }
  getDiscoveryBindings()                    { return this.client.get("/discovery"); }
  getBindingInfo(bindingID, language=null)  { const h = { Accept: "application/json" }; if (language) h["Accept-Language"] = language; return this.client.get(`/bindings/${bindingID}`, h); }
  startBindingScan(bindingID, input=null)   { return this.client.post(`/discovery/bindings/${bindingID}/scan`, {}, input); }
}
export class AsyncDiscovery extends Discovery {}

// ═══════════════════════════════════════════════════════════════════════════════
// Iconsets
// ═══════════════════════════════════════════════════════════════════════════════

export class Iconsets {
  constructor(client) { this.client = client; }
  getIconsets(language=null) { const h = { Accept: "application/json" }; if (language) h["Accept-Language"] = language; return this.client.get("/iconsets", h); }
}
export class AsyncIconsets extends Iconsets {}

// ═══════════════════════════════════════════════════════════════════════════════
// Inbox
// ═══════════════════════════════════════════════════════════════════════════════

export class Inbox {
  constructor(client) { this.client = client; }
  getDiscoveredThings(includeIgnored=true)  { return this.client.get("/inbox", {}, { includeIgnored }); }
  removeDiscoveryResult(thingUID)            { return this.client.delete(`/inbox/${thingUID}`); }
  approveDiscoveryResult(thingUID, thingLabel, newThingID=null, language=null) {
    const h = { "Content-Type": "text/plain" };
    if (language) h["Accept-Language"] = language;
    return this.client.post(`/inbox/${thingUID}/approve`, h, thingLabel, newThingID ? { newThingId: newThingID } : null);
  }
  ignoreDiscoveryResult(thingUID)   { return this.client.post(`/inbox/${thingUID}/ignore`); }
  unignoreDiscoveryResult(thingUID) { return this.client.post(`/inbox/${thingUID}/unignore`); }
}
export class AsyncInbox extends Inbox {}

// ═══════════════════════════════════════════════════════════════════════════════
// Links
// ═══════════════════════════════════════════════════════════════════════════════

export class Links {
  constructor(client) { this.client = client; }
  getLinks(channelUID=null, itemName=null) { return this.client.get("/links", {}, { channelUID, itemName }); }
  getLink(itemName, channelUID)            { return this.client.get(`/links/${itemName}/${encodeURIComponent(channelUID)}`); }
  linkItemToChannel(itemName, channelUID, configuration) {
    return this.client.put(`/links/${itemName}/${encodeURIComponent(channelUID)}`,
      { "Content-Type": "application/json" }, JSON.stringify({ configuration }));
  }
  unlinkItemFromChannel(itemName, channelUID) { return this.client.delete(`/links/${itemName}/${encodeURIComponent(channelUID)}`); }
  deleteAllLinks(object)   { return this.client.delete(`/links/${object}`); }
  getOrphanLinks()         { return this.client.get("/links/orphan"); }
  purgeUnusedLinks()       { return this.client.post("/links/purge"); }
}
export class AsyncLinks extends Links {}

// ═══════════════════════════════════════════════════════════════════════════════
// Logging
// ═══════════════════════════════════════════════════════════════════════════════

export class Logging {
  constructor(client) { this.client = client; }
  getLoggers()                           { return this.client.get("/loggers"); }
  getLogger(loggerName)                  { return this.client.get(`/loggers/${loggerName}`); }
  modifyOrAddLogger(loggerName, level)   { return this.client.put(`/loggers/${loggerName}`, { "Content-Type": "application/json" }, JSON.stringify({ level })); }
  removeLogger(loggerName)               { return this.client.delete(`/loggers/${loggerName}`); }
}
export class AsyncLogging extends Logging {}

// ═══════════════════════════════════════════════════════════════════════════════
// ModuleTypes
// ═══════════════════════════════════════════════════════════════════════════════

export class ModuleTypes {
  constructor(client) { this.client = client; }
  getModuleTypes(tags=null, typeFilter=null, language=null) {
    const h = { Accept: "application/json" };
    if (language) h["Accept-Language"] = language;
    return this.client.get("/module-types", h, { tags, type: typeFilter });
  }
  getModuleType(moduleTypeUID, language=null) {
    const h = { Accept: "application/json" };
    if (language) h["Accept-Language"] = language;
    return this.client.get(`/module-types/${moduleTypeUID}`, h);
  }
}
export class AsyncModuleTypes extends ModuleTypes {}

// ═══════════════════════════════════════════════════════════════════════════════
// Persistence
// ═══════════════════════════════════════════════════════════════════════════════

export class Persistence {
  constructor(client) { this.client = client; }
  getServices(language=null) { const h = { Accept: "application/json" }; if (language) h["Accept-Language"] = language; return this.client.get("/persistence", h); }
  getServiceConfiguration(serviceID)           { return this.client.get(`/persistence/${serviceID}`); }
  setServiceConfiguration(serviceID, config)   { return this.client.put(`/persistence/${serviceID}`, { "Content-Type": "application/json" }, JSON.stringify(config)); }
  deleteServiceConfiguration(serviceID)        { return this.client.delete(`/persistence/${serviceID}`); }
  getItemsFromService(serviceID=null)          { return this.client.get("/persistence/items", {}, serviceID ? { serviceId: serviceID } : null); }
  getItemPersistenceData(itemName, serviceID, { startTime=null, endTime=null, page=1, pageLength=50, boundary=false, itemState=false } = {}) {
    return this.client.get(`/persistence/items/${itemName}`, {}, { serviceId: serviceID, starttime: startTime, endtime: endTime, page, pagelength: pageLength, boundary, itemState });
  }
  storeItemData(itemName, time, state, serviceID=null) {
    const p = { time };
    if (serviceID) p.serviceId = serviceID;
    return this.client.put(`/persistence/items/${itemName}`, { "Content-Type": "text/plain" }, state, p);
  }
  deleteItemData(itemName, startTime, endTime, serviceID) {
    return this.client.delete(`/persistence/items/${itemName}`, {}, null, { serviceId: serviceID, starttime: startTime, endtime: endTime });
  }
}
export class AsyncPersistence extends Persistence {}

// ═══════════════════════════════════════════════════════════════════════════════
// ProfileTypes
// ═══════════════════════════════════════════════════════════════════════════════

export class ProfileTypes {
  constructor(client) { this.client = client; }
  getProfileTypes(channelTypeUID=null, itemType=null, language=null) {
    const h = { Accept: "application/json" };
    if (language) h["Accept-Language"] = language;
    return this.client.get("/profile-types", h, { channelTypeUID, itemType });
  }
}
export class AsyncProfileTypes extends ProfileTypes {}

// ═══════════════════════════════════════════════════════════════════════════════
// Rules
// ═══════════════════════════════════════════════════════════════════════════════

export class Rules {
  constructor(client) { this.client = client; }
  getRules(prefix=null, tags=null, summary=false, staticDataOnly=false) { return this.client.get("/rules", { Accept: "application/json" }, { prefix, tags, summary, staticDataOnly }); }
  createRule(ruleData)                      { return this.client.post("/rules", { "Content-Type": "application/json" }, JSON.stringify(ruleData)); }
  getRule(ruleUID)                          { return this.client.get(`/rules/${ruleUID}`); }
  updateRule(ruleUID, ruleData)             { return this.client.put(`/rules/${ruleUID}`, { "Content-Type": "application/json" }, JSON.stringify(ruleData)); }
  deleteRule(ruleUID)                       { return this.client.delete(`/rules/${ruleUID}`); }
  getModule(ruleUID, moduleCategory, moduleID)            { return this.client.get(`/rules/${ruleUID}/${moduleCategory}/${moduleID}`); }
  getModuleConfig(ruleUID, moduleCategory, moduleID)      { return this.client.get(`/rules/${ruleUID}/${moduleCategory}/${moduleID}/config`); }
  getModuleConfigParam(ruleUID, moduleCategory, moduleID, param) { return this.client.get(`/rules/${ruleUID}/${moduleCategory}/${moduleID}/config/${param}`); }
  setModuleConfigParam(ruleUID, moduleCategory, moduleID, param, value) { return this.client.put(`/rules/${ruleUID}/${moduleCategory}/${moduleID}/config/${param}`, { "Content-Type": "text/plain" }, value); }
  getActions(ruleUID)                       { return this.client.get(`/rules/${ruleUID}/actions`); }
  getConditions(ruleUID)                    { return this.client.get(`/rules/${ruleUID}/conditions`); }
  getTriggers(ruleUID)                      { return this.client.get(`/rules/${ruleUID}/triggers`); }
  getConfiguration(ruleUID)                 { return this.client.get(`/rules/${ruleUID}/config`); }
  updateConfiguration(ruleUID, configData)  { return this.client.put(`/rules/${ruleUID}/config`, { "Content-Type": "application/json" }, JSON.stringify(configData)); }
  setRuleState(ruleUID, enable)             { return this.client.post(`/rules/${ruleUID}/enable`, { "Content-Type": "text/plain" }, String(enable)); }
  enable(ruleUID)                           { return this.setRuleState(ruleUID, true); }
  disable(ruleUID)                          { return this.setRuleState(ruleUID, false); }
  runNow(ruleUID, contextData=null)         { return this.client.post(`/rules/${ruleUID}/runnow`, contextData ? { "Content-Type": "application/json" } : {}, contextData ? JSON.stringify(contextData) : null); }
  simulateSchedule(fromTime, untilTime)     { return this.client.get("/rules/schedule/simulations", {}, { from: fromTime, until: untilTime }); }
}
export class AsyncRules extends Rules {}

// ═══════════════════════════════════════════════════════════════════════════════
// Services
// ═══════════════════════════════════════════════════════════════════════════════

export class Services {
  constructor(client) { this.client = client; }
  getServices(language=null) { const h = { Accept: "application/json" }; if (language) h["Accept-Language"] = language; return this.client.get("/services", h); }
  getService(serviceID, language=null) { const h = { Accept: "application/json" }; if (language) h["Accept-Language"] = language; return this.client.get(`/services/${serviceID}`, h); }
  getServiceConfig(serviceID)          { return this.client.get(`/services/${serviceID}/config`); }
  updateServiceConfig(serviceID, configData, language=null) { const h = { "Content-Type": "application/json" }; if (language) h["Accept-Language"] = language; return this.client.put(`/services/${serviceID}/config`, h, JSON.stringify(configData)); }
  deleteServiceConfig(serviceID)       { return this.client.delete(`/services/${serviceID}/config`); }
  getServiceContexts(serviceID, language=null) { const h = { Accept: "application/json" }; if (language) h["Accept-Language"] = language; return this.client.get(`/services/${serviceID}/contexts`, h); }
}
export class AsyncServices extends Services {}

// ═══════════════════════════════════════════════════════════════════════════════
// Sitemaps
// ═══════════════════════════════════════════════════════════════════════════════

export class Sitemaps {
  constructor(client) { this.client = client; }
  getSitemaps() { return this.client.get("/sitemaps"); }
  getSitemap(sitemapName, type=null, jsonCallback=null, includeHidden=false, language=null) {
    const h = {};
    if (language) h["Accept-Language"] = language;
    return this.client.get(`/sitemaps/${sitemapName}`, h, { type, jsoncallback: jsonCallback, includeHidden });
  }
  getSitemapPage(sitemapName, pageID, subscriptionID=null, includeHidden=false, language=null) {
    const h = {};
    if (language) h["Accept-Language"] = language;
    return this.client.get(`/sitemaps/${sitemapName}/${pageID}`, h, { subscriptionid: subscriptionID, includeHidden });
  }
  getFullSitemap(sitemapName, subscriptionID=null, includeHidden=false, language=null) {
    const h = {};
    if (language) h["Accept-Language"] = language;
    return this.client.get(`/sitemaps/${sitemapName}/*`, h, { subscriptionid: subscriptionID, includeHidden });
  }
  getSitemapEvents(subscriptionID, sitemapName=null, pageID=null) {
    let url = this.client.url + `/rest/sitemaps/events/${subscriptionID}`;
    const p = [];
    if (sitemapName) p.push(`sitemap=${sitemapName}`);
    if (pageID)      p.push(`pageid=${pageID}`);
    if (p.length)    url += "?" + p.join("&");
    return this.client._executeSSE(url);
  }
  getFullSitemapEvents(subscriptionID, sitemapName=null) {
    let url = this.client.url + `/rest/sitemaps/events/${subscriptionID}`;
    if (sitemapName) url += `?sitemap=${sitemapName}`;
    return this.client._executeSSE(url);
  }
  subscribeToSitemapEvents() { return this.client.post("/sitemaps/events/subscribe"); }
}
export class AsyncSitemaps extends Sitemaps {}

// ═══════════════════════════════════════════════════════════════════════════════
// Systeminfo
// ═══════════════════════════════════════════════════════════════════════════════

export class Systeminfo {
  constructor(client) { this.client = client; }
  getSystemInfo() { return this.client.get("/systeminfo"); }
  getUoMInfo()    { return this.client.get("/systeminfo/uom"); }
}
export class AsyncSysteminfo extends Systeminfo {}

// ═══════════════════════════════════════════════════════════════════════════════
// Tags
// ═══════════════════════════════════════════════════════════════════════════════

export class Tags {
  constructor(client) { this.client = client; }
  getTags(language=null)                     { const h = { Accept: "application/json" }; if (language) h["Accept-Language"] = language; return this.client.get("/tags", h); }
  createTag(tagData, language=null)          { const h = { "Content-Type": "application/json" }; if (language) h["Accept-Language"] = language; return this.client.post("/tags", h, JSON.stringify(tagData)); }
  getTag(tagID, language=null)               { const h = { Accept: "application/json" }; if (language) h["Accept-Language"] = language; return this.client.get(`/tags/${tagID}`, h); }
  updateTag(tagID, tagData, language=null)   { const h = { "Content-Type": "application/json" }; if (language) h["Accept-Language"] = language; return this.client.put(`/tags/${tagID}`, h, JSON.stringify(tagData)); }
  deleteTag(tagID, language=null)            { const h = {}; if (language) h["Accept-Language"] = language; return this.client.delete(`/tags/${tagID}`, h); }
}
export class AsyncTags extends Tags {}

// ═══════════════════════════════════════════════════════════════════════════════
// Templates
// ═══════════════════════════════════════════════════════════════════════════════

export class Templates {
  constructor(client) { this.client = client; }
  getTemplates(language=null)              { const h = { Accept: "application/json" }; if (language) h["Accept-Language"] = language; return this.client.get("/templates", h); }
  getTemplate(templateUID, language=null)  { const h = { Accept: "application/json" }; if (language) h["Accept-Language"] = language; return this.client.get(`/templates/${templateUID}`, h); }
}
export class AsyncTemplates extends Templates {}

// ═══════════════════════════════════════════════════════════════════════════════
// ThingTypes
// ═══════════════════════════════════════════════════════════════════════════════

export class ThingTypes {
  constructor(client) { this.client = client; }
  getThingTypes(bindingID=null, language=null) { const h = { Accept: "application/json" }; if (language) h["Accept-Language"] = language; return this.client.get("/thing-types", h, bindingID ? { bindingId: bindingID } : null); }
  getThingType(thingTypeUID, language=null)    { const h = { Accept: "application/json" }; if (language) h["Accept-Language"] = language; return this.client.get(`/thing-types/${thingTypeUID}`, h); }
}
export class AsyncThingTypes extends ThingTypes {}

// ═══════════════════════════════════════════════════════════════════════════════
// Transformations
// ═══════════════════════════════════════════════════════════════════════════════

export class Transformations {
  constructor(client) { this.client = client; }
  getTransformations()                                     { return this.client.get("/transformations"); }
  getTransformation(transformationUID)                     { return this.client.get(`/transformations/${transformationUID}`); }
  updateTransformation(transformationUID, transformationData) { return this.client.put(`/transformations/${transformationUID}`, { "Content-Type": "application/json" }, JSON.stringify(transformationData)); }
  deleteTransformation(transformationUID)                  { return this.client.delete(`/transformations/${transformationUID}`); }
  getTransformationServices()                              { return this.client.get("/transformations/services"); }
}
export class AsyncTransformations extends Transformations {}

// ═══════════════════════════════════════════════════════════════════════════════
// UI
// ═══════════════════════════════════════════════════════════════════════════════

export class UI {
  constructor(client) { this.client = client; }
  getUIComponents(namespace, summary=false)                          { return this.client.get(`/ui/components/${namespace}`, {}, { summary }); }
  addUIComponent(namespace, componentData)                           { return this.client.post(`/ui/components/${namespace}`, { "Content-Type": "application/json" }, JSON.stringify(componentData)); }
  getUIComponent(namespace, componentUID)                            { return this.client.get(`/ui/components/${namespace}/${componentUID}`); }
  updateUIComponent(namespace, componentUID, componentData)          { return this.client.put(`/ui/components/${namespace}/${componentUID}`, { "Content-Type": "application/json" }, JSON.stringify(componentData)); }
  deleteUIComponent(namespace, componentUID)                         { return this.client.delete(`/ui/components/${namespace}/${componentUID}`); }
  getUITiles()                                                       { return this.client.get("/ui/tiles"); }
}
export class AsyncUI extends UI {}

// ═══════════════════════════════════════════════════════════════════════════════
// UUID
// ═══════════════════════════════════════════════════════════════════════════════

export class UUID {
  constructor(client) { this.client = client; }
  getUUID() { return this.client.get("/uuid"); }
}
export class AsyncUUID extends UUID {}

// ═══════════════════════════════════════════════════════════════════════════════
// Voice
// ═══════════════════════════════════════════════════════════════════════════════

export class Voice {
  constructor(client) { this.client = client; }
  getDefaultVoice()  { return this.client.get("/voice/defaultvoice"); }
  startDialog(sourceID, { ksID=null, sttID=null, ttsID=null, voiceID=null, hliIDs=null, sinkID=null, keyword=null, listeningItem=null } = {}) {
    return this.client.post("/voice/dialog/start", {}, null, { sourceId: sourceID, ksId: ksID, sttId: sttID, ttsId: ttsID, voiceId: voiceID, hliIds: hliIDs, sinkId: sinkID, keyword, listeningItem });
  }
  stopDialog(sourceID)                { return this.client.post("/voice/dialog/stop", {}, null, { sourceId: sourceID }); }
  getInterpreters(language=null)      { const h = {}; if (language) h["Accept-Language"] = language; return this.client.get("/voice/interpreters", h); }
  interpretText(text, language=null)  { const h = { "Content-Type": "text/plain" }; if (language) h["Accept-Language"] = language; return this.client.post("/voice/interpreters", h, text); }
  getInterpreter(interpreterID, language=null) { const h = {}; if (language) h["Accept-Language"] = language; return this.client.get(`/voice/interpreters/${interpreterID}`, h); }
  interpretTextBatch(text, IDs, language=null) { const h = { "Content-Type": "text/plain" }; if (language) h["Accept-Language"] = language; return this.client.post(`/voice/interpreters/${IDs.join(",")}`, h, text); }
  listenAndAnswer(sourceID, sttID, ttsID, voiceID, { hliIDs=null, sinkID=null, listeningItem=null } = {}) {
    return this.client.post("/voice/listenandanswer", {}, null, { sourceId: sourceID, sttId: sttID, ttsId: ttsID, voiceId: voiceID, hliIds: hliIDs, sinkId: sinkID, listeningItem });
  }
  sayText(text, voiceID, sinkID, volume="100") { return this.client.post("/voice/say", {}, null, { text, voiceId: voiceID, sinkId: sinkID, volume }); }
  getVoices() { return this.client.get("/voice/voices"); }
}
export class AsyncVoice extends Voice {}
