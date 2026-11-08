"use strict";
/**
 * nodejs-openhab-rest-client
 *
 * Node.js client for the openHAB REST API (openHAB 4 and 5).
 * Mirrors python-openhab-rest-client and js-openhab-rest-client: same class
 * names, same method names, same parameters, same return values
 * ({ message } / { error } / JSON / text).
 *
 * Node.js >= 18 (native fetch, ReadableStream). No dependencies.
 *
 *   import { OpenHABClient, Items, ItemEvents, iterSSEEvents } from "nodejs-openhab-rest-client";
 *   // or: const { OpenHABClient, Items } = require("nodejs-openhab-rest-client");
 *
 *   const client = new OpenHABClient("http://127.0.0.1:8080", null, null, process.env.OPENHAB_TOKEN);
 *   const items = new Items(client);
 *   await items.sendCommand("Wohnzimmer_Licht", "ON");
 *   console.log(await items.getItemState("Wohnzimmer_Licht"));
 *
 *   const stream = await new ItemEvents(client).ItemStateChangedEvent();
 *   for await (const event of iterSSEEvents(stream)) {
 *     console.log(event.topic, event.payload.value);
 *   }
 *
 * All methods return Promises. The Async* classes are aliases kept for
 * symmetry with the Python library.
 *
 * The REST classes are generated from python-openhab-rest-client with
 * tools/py2js.py – fix behaviour there and regenerate (npm run generate).
 *
 * @license MIT
 * @version 2.0.0
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Result types and errors
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Result of a request whose response has no body (e.g. 200 with empty body,
 * 201 Created, 202 Accepted). Contains `status` and, if sent, `location`.
 * Being its own class, it is never confused with a JSON object that happens
 * to contain a "status" field.
 */
class StatusResponse {
  constructor(status, location = null) {
    this.status = status;
    if (location) this.location = location;
  }
}

/**
 * Thrown by OpenHABClient.get/post/put/delete/executeSSE for 4xx/5xx responses.
 * The REST classes catch it and return { error: "…" } instead.
 */
class OpenHABHTTPError extends Error {
  constructor(message, status, url, openhabMessage = "", response = null) {
    super(message);
    this.name = "OpenHABHTTPError";
    this.status = status;
    this.url = url;
    this.openhabMessage = openhabMessage;
    this.response = response;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Small helpers used by the generated code
// ═══════════════════════════════════════════════════════════════════════════════

function _isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function _contains(container, value) {
  if (container === null || container === undefined) return false;
  if (typeof container === "string" || Array.isArray(container)) return container.includes(value);
  if (container instanceof Map || container instanceof Set) return container.has(value);
  return Object.prototype.hasOwnProperty.call(container, value);
}

function _urlencode(data) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(data || {})) {
    if (value !== null && value !== undefined) params.append(key, String(value));
  }
  return params.toString();
}

/** Base64 of UTF-8 text (btoa alone fails for umlauts and other non-Latin-1 characters). */
function _base64(text) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

// ═══════════════════════════════════════════════════════════════════════════════
// OpenHABClient
// ═══════════════════════════════════════════════════════════════════════════════

class OpenHABClient {
  /**
   * @param url       Base URL of the openHAB server, e.g. "http://127.0.0.1:8080".
   * @param username  Optional; user name for Basic Authentication.
   * @param password  Optional; password for Basic Authentication.
   * @param token     Optional; API token (Bearer). Takes precedence over Basic Authentication.
   * @param timeout   Optional; timeout in seconds for normal requests (default 10).
   *                  Event streams only use it for connecting.
   */
  constructor(url, username = null, password = null, token = null, timeout = 10) {
    this.url = String(url).replace(/\/+$/, "");
    this.username = username;
    this.password = password;
    this.token = token;
    this.timeout = timeout;
    this.isCloud = false;
    this.isLoggedIn = false;
    /** Resolves to this client once the connection check is done (never rejects). */
    this.ready = this.login();
  }

  /** Headers sent with every request (authentication). */
  _authHeaders() {
    if (this.token) return { Authorization: `Bearer ${this.token}` };
    if (this.username && this.password) {
      return { Authorization: `Basic ${_base64(`${this.username}:${this.password}`)}` };
    }
    return {};
  }

  /** Checks whether the server is reachable and the credentials are accepted. */
  async login() {
    this.isCloud = ["https://myopenhab.org", "https://home.myopenhab.org"].includes(this.url);
    try {
      const response = await this._fetch(this.url + "/rest/", { headers: this._authHeaders() });
      this.isLoggedIn = response.ok;
      if (!response.ok) console.warn(`openHAB: HTTP ${response.status} for ${this.url}/rest/`);
    } catch (err) {
      this.isLoggedIn = false;
      console.warn(`openHAB: ${this.url} not reachable (${err.message})`);
    }
    return this;
  }

  /** Builds the absolute URL for a resource path (with or without the /rest prefix). */
  _buildUrl(resourcePath, params = null) {
    let path = String(resourcePath).trim();
    if (!/^https?:\/\//.test(path)) {
      if (!path.startsWith("/")) path = "/" + path;
      if (!(path === "/rest" || path.startsWith("/rest/") || path.startsWith("/rest?"))) {
        path = "/rest" + path;
      }
      path = this.url + path;
    }
    // "#" is valid inside openHAB UIDs (channel and action UIDs) but would start a fragment.
    const q = path.indexOf("?");
    let base = q >= 0 ? path.slice(0, q) : path;
    let query = q >= 0 ? path.slice(q + 1) : "";
    base = base.replace(/#/g, "%23");
    const extra = OpenHABClient._cleanParams(params);
    if (extra) {
      const qs = new URLSearchParams(extra).toString();
      if (qs) query = query ? `${query}&${qs}` : qs;
    }
    return query ? `${base}?${query}` : base;
  }

  /** Removes null/undefined values, converts booleans to "true"/"false" and arrays to "a,b". */
  static _cleanParams(params) {
    if (!params) return null;
    const clean = {};
    for (const [key, value] of Object.entries(params)) {
      if (value === null || value === undefined) continue;
      clean[key] = Array.isArray(value) ? value.join(",") : String(value);
    }
    return Object.keys(clean).length ? clean : null;
  }

  /** fetch with timeout (seconds). */
  async _fetch(url, options = {}, timeout = this.timeout) {
    if (!timeout) return fetch(url, options);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Timeout after ${timeout} s`)), timeout * 1000);
    try {
      return await fetch(url, { ...options, signal: options.signal || controller.signal });
    } catch (err) {
      if (controller.signal.aborted) throw new Error(`Timeout after ${timeout} s: ${url}`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Throws OpenHABHTTPError for 4xx/5xx and adds the error message openHAB sends in the body. */
  static async _raiseForStatus(response) {
    if (response.status < 400) return;
    let message = "";
    let text = "";
    try {
      text = await response.text();
      let body = JSON.parse(text);
      // some endpoints (e.g. the sitemap event stream) send the error object as a JSON string
      if (typeof body === "string" && body.trimStart().startsWith("{")) body = JSON.parse(body);
      if (_isPlainObject(body)) {
        const error = body.error;
        message = _isPlainObject(error) ? (error.message || "") : String(error || "");
      }
    } catch {
      message = (text || "").trim().slice(0, 200);
    }
    const kind = response.status < 500 ? "Client Error" : "Server Error";
    let msg = `${response.status} ${kind}: ${response.statusText} for url: ${response.url}`;
    if (message) msg += ` (${message})`;
    throw new OpenHABHTTPError(msg, response.status, response.url, message, response);
  }

  async _executeRequest(method, resourcePath, headers = null, data = null, params = null) {
    if (!resourcePath || !method) throw new Error("You must specify a valid resource path and HTTP method!");
    method = method.toUpperCase();
    if (!["GET", "POST", "PUT", "DELETE"].includes(method)) throw new Error("Invalid HTTP method provided!");

    const url = this._buildUrl(resourcePath, params);
    const requestHeaders = { ...this._authHeaders() };
    for (const [k, v] of Object.entries(headers || {})) {
      if (v !== null && v !== undefined) requestHeaders[k] = v;
    }
    const contentTypeKey = Object.keys(requestHeaders).find(k => k.toLowerCase() === "content-type");
    let body;
    if (data !== null && data !== undefined) {
      if (typeof data === "string") {
        body = data;
        if (data && !contentTypeKey) {
          // openHAB rejects bodies without a matching media type (415)
          const first = data.trimStart()[0];
          requestHeaders["Content-Type"] = first === "{" || first === "[" ? "application/json" : "text/plain";
        }
      } else if (_isPlainObject(data) && contentTypeKey &&
                 /x-www-form-urlencoded/i.test(requestHeaders[contentTypeKey])) {
        body = _urlencode(data);
      } else if (typeof data === "number" || typeof data === "boolean") {
        body = String(data);
        if (!contentTypeKey) requestHeaders["Content-Type"] = "text/plain";
      } else {
        body = JSON.stringify(data);
        if (!contentTypeKey) requestHeaders["Content-Type"] = "application/json";
      }
    }

    const response = await this._fetch(url, { method, headers: requestHeaders, body });
    await OpenHABClient._raiseForStatus(response);

    const text = await response.text();
    if (!text.trim()) return new StatusResponse(response.status, response.headers.get("Location"));
    if ((response.headers.get("Content-Type") || "").includes("json")) {
      try { return JSON.parse(text); } catch { return text; }
    }
    return text;
  }

  /**
   * Opens a Server-Sent Events stream. Resolves to the fetch Response; read it
   * with iterSSEEvents(response) / iterSSELines(response). Throws
   * OpenHABHTTPError if the server rejects the request.
   *
   * @param url     Absolute URL or resource path, e.g. "/rest/events".
   * @param headers Optional; additional headers.
   * @param params  Optional; query parameters.
   */
  async executeSSE(url, headers = null, params = null) {
    const requestHeaders = {
      ...this._authHeaders(),
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
    };
    for (const [k, v] of Object.entries(headers || {})) {
      if (v !== null && v !== undefined) requestHeaders[k] = v;
    }
    // The timeout only applies until the response headers have arrived.
    const controller = new AbortController();
    const timer = this.timeout
      ? setTimeout(() => controller.abort(new Error("Timeout while connecting")), this.timeout * 1000)
      : null;
    let response;
    try {
      response = await fetch(this._buildUrl(url, params), { headers: requestHeaders, signal: controller.signal });
    } catch (err) {
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
    await OpenHABClient._raiseForStatus(response);
    response.abort = () => controller.abort();
    return response;
  }

  /** Backwards compatibility with 1.x */
  _executeSSE(url, headers = null) {
    return this.executeSSE(url, headers);
  }

  get(endpoint, headers = null, params = null) {
    return this._executeRequest("GET", endpoint, headers, null, params);
  }

  post(endpoint, headers = null, data = null, params = null) {
    return this._executeRequest("POST", endpoint, headers, data, params);
  }

  put(endpoint, headers = null, data = null, params = null) {
    return this._executeRequest("PUT", endpoint, headers, data, params);
  }

  delete(endpoint, headers = null, data = null, params = null) {
    return this._executeRequest("DELETE", endpoint, headers, data, params);
  }

  /** For symmetry with the Python library – fetch keeps no session. */
  close() {}
}

class AsyncOpenHABClient extends OpenHABClient {}

// ═══════════════════════════════════════════════════════════════════════════════
// Server-Sent Events helpers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Yields the lines of an SSE stream (fetch Response) as strings, each one as
 * soon as it is complete. Breaking out of the loop closes the stream.
 */
async function* iterSSELines(response) {
  if (!response || !response.body) throw new TypeError("iterSSELines expects a fetch Response with a body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, "");
        buffer = buffer.slice(index + 1);
        yield line;
      }
    }
    buffer += decoder.decode();
    if (buffer) yield buffer;
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
  }
}

/**
 * Decodes one "data:" line of the openHAB event stream.
 * Returns the event with its payload already decoded (JSON in JSON), the raw
 * object for control messages such as { type: "ALIVE" }, or null for all
 * other lines (event:, comments, empty lines, the connection id of the state tracker).
 */
function parseSSEData(line) {
  if (typeof line !== "string" || !line.startsWith("data:")) return null;
  let event;
  try {
    event = JSON.parse(line.slice(5).trim());
  } catch {
    return null;
  }
  if (!_isPlainObject(event)) return null;
  if (typeof event.payload === "string") {
    try { event.payload = JSON.parse(event.payload); } catch { /* plain text payload */ }
  }
  return event;
}

/**
 * Yields the events of an SSE stream as objects with decoded payload.
 * @param response      The stream, e.g. from new ItemEvents(client).ItemStateChangedEvent().
 * @param includeAlive  Also yield ALIVE messages (default false).
 */
async function* iterSSEEvents(response, includeAlive = false) {
  for await (const line of iterSSELines(response)) {
    const event = parseSSEData(line);
    if (event === null) continue;
    if ("topic" in event || includeAlive) yield event;
  }
}

// Same functions under the names of the Python library's async variants.
const aiterSSELines = iterSSELines;
const aiterSSEEvents = iterSSEEvents;

/**
 * Opens an event stream and translates HTTP errors into { error } objects.
 * Resolves to the fetch Response or to { error: "…" }.
 */
async function _openStream(client, topics = null, { path = "/rest/events", headers = null, errors = null } = {}) {
  errors = errors || {};
  try {
    return await client.executeSSE(path, headers, topics ? { topics } : null);
  } catch (err) {
    if (!(err instanceof OpenHABHTTPError)) return { error: `Request error: ${err.message}` };
    if (_contains(errors, err.status)) return { error: errors[err.status] };
    return { error: `HTTP error ${err.status}: ${err.message}` };
  }
}

// =============================================================================
// Actions  (generated from Actions.py)
// =============================================================================

class Actions {
  constructor(client) {
    this.client = client;
  }

  /**
   * Get all available actions for provided thing UID.
   *
   * @param thingUID: The UID of the thing for which actions are to be retrieved.
   * @param language: (Optional) Language setting for the Accept-Language headers.
   *
   * @returns A list of actions.
   */
  async getActions(thingUID, language = null) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.get(`/actions/${thingUID}`, headers, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 204) {
        return { error: "No actions found." };
      } else if (status_code === 404) {
        return { error: `Thing not found: ${thingUID}` };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 204) {
      return { error: "No actions found." };
    } else if (status_code === 404) {
      return { error: `Thing not found: ${thingUID}` };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Executes a thing action.
   *
   * @param thingUID: The UID of the thing on which the action is to be executed.
   * @param actionUID: The UID of the action to be executed.
   * @param actionInputs: The inputs for the action as a object.
   * @param language: (Optional) Language setting for the Accept-Language headers.
   *
   * @returns A response from the server.
   */
  async executeAction(thingUID, actionUID, actionInputs, language = null) {
    let headers = { "Content-Type": "application/json", Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.post(`/actions/${thingUID}/${actionUID}`, headers, JSON.stringify(actionInputs), null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Action not found." };
      } else if (status_code === 500) {
        return { error: "Creation of action handler or execution failed." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Action not found." };
    } else if (status_code === 500) {
      return { error: "Creation of action handler or execution failed." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }
}

class AsyncActions extends Actions {}

// =============================================================================
// Addons  (generated from Addons.py)
// =============================================================================

class Addons {
  constructor(client) {
    this.client = client;
  }

  /**
   * Retrieves a list of all available add-ons.
   *
   * @param serviceID: Optional service ID to filter the results.
   * @param language: Optional language preference for the response.
   *
   * @returns A object containing the add-ons data.
   */
  async getAddons(serviceID = null, language = null) {
    let params = (serviceID ? { serviceId: serviceID } : {});
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.get("/addons", headers, params);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Service not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Service not found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Retrieves details of a specific add-on by its ID.
   *
   * @param addonID: The unique identifier of the add-on.
   * @param serviceID: Optional service ID to filter the results.
   * @param language: Optional language preference for the response.
   *
   * @returns A object containing details of the specified add-on.
   */
  async getAddon(addonID, serviceID = null, language = null) {
    let params = (serviceID ? { serviceId: serviceID } : {});
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.get(`/addons/${addonID}`, headers, params);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Not found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Retrieves the configuration of a specific add-on.
   *
   * @param addonID: The unique identifier of the add-on.
   * @param serviceID: Optional service ID to filter the results.
   *
   * @returns A object containing the configuration of the specified add-on.
   */
  async getAddonConfig(addonID, serviceID = null) {
    let params = (serviceID ? { serviceId: serviceID } : {});
    let response, status_code;
    try {
      response = await this.client.get(`/addons/${addonID}/config`, { Accept: "application/json" }, params);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 500) {
        return { error: "Configuration can not be read due to internal error." };
      } else if (status_code === 404) {
        return { error: "Add-on does not exist." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Add-on does not exist." };
    } else if (status_code === 500) {
      return { error: "Configuration can not be read due to internal error." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Updates the configuration of a specific add-on and returns the updated configuration.
   *
   * @param addonID: The unique identifier of the add-on.
   * @param configData: A object containing the new configuration settings.
   * @param serviceID: Optional service ID to specify the target service.
   *
   * @returns A object containing the updated configuration.
   */
  async updateAddonConfig(addonID, configData, serviceID = null) {
    let data = { ...configData };
    let response, status_code;
    try {
      response = await this.client.put(`/addons/${addonID}/config`, { "Content-Type": "application/json", Accept: "application/json" }, JSON.stringify(data), { serviceId: serviceID });
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 500) {
        return { error: "Configuration can not be updated due to internal error." };
      } else if (status_code === 404) {
        return { error: "Add-on does not exist." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Add-on does not exist." };
    } else if (status_code === 500) {
      return { error: "Configuration can not be updated due to internal error." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Installs an add-on by its ID.
   *
   * @param addonID: The unique identifier of the add-on.
   * @param serviceID: Optional service ID to specify the target service.
   *
   * @returns A object containing the installation status.
   */
  async installAddon(addonID, serviceID = null) {
    let data = (serviceID ? { serviceId: serviceID } : {});
    let response, status_code;
    try {
      response = await this.client.post(`/addons/${addonID}/install`, {}, null, data);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Not found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Uninstalls an add-on by its ID.
   *
   * @param addonID: The unique identifier of the add-on.
   * @param serviceID: Optional service ID to specify the target service.
   *
   * @returns A object containing the uninstallation status.
   */
  async uninstallAddon(addonID, serviceID = null) {
    let data = (serviceID ? { serviceId: serviceID } : {});
    let response, status_code;
    try {
      response = await this.client.post(`/addons/${addonID}/uninstall`, {}, null, data);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Not found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Retrieves a list of all available add-on services.
   *
   * @param language: Optional language preference for the response.
   *
   * @returns A object containing the available add-on services.
   */
  async getAddonServices(language = null) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.get("/addons/services", headers, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Retrieves a list of suggested add-ons for installation.
   *
   * @param language: Optional language preference for the response.
   *
   * @returns A object containing suggested add-ons.
   */
  async getAddonSuggestions(language = null) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.get("/addons/suggestions", headers, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Retrieves a list of all available add-on types.
   *
   * @param language: Optional language preference for the response.
   *
   * @returns A object containing available add-on types.
   */
  async getAddonTypes(serviceID = null, language = null) {
    let params = (serviceID ? { serviceId: serviceID } : {});
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.get("/addons/types", headers, params);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Service not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Service not found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Installs an add-on from a given URL.
   *
   * @param url: The URL of the add-on to install.
   *
   * @returns A object containing the installation status.
   */
  async installAddonFromUrl(url) {
    let encoded_url = encodeURIComponent(url);
    let endpoint = `/addons/url/${encoded_url}/install`;
    let response, status_code;
    try {
      response = await this.client.post(endpoint, {}, null, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 400) {
        return { error: "The given URL is malformed or not valid." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 400) {
      return { error: "The given URL is malformed or not valid." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }
}

class AsyncAddons extends Addons {}

// =============================================================================
// Audio  (generated from Audio.py)
// =============================================================================

class Audio {
  constructor(client) {
    this.client = client;
  }

  /**
   * Retrieves the default sink if defined, or the first available sink.
   *
   * @param language: (Optional) Language setting for the Accept-Language header.
   *
   * @returns A object containing information about the default sink.
   */
  async getDefaultSink(language = null) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.get("/audio/defaultsink", headers, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Sink not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Sink not found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Retrieves the default source if defined, or the first available source.
   *
   * @param language: (Optional) Language setting for the Accept-Language header.
   *
   * @returns A object containing information about the default source.
   */
  async getDefaultSource(language = null) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.get("/audio/defaultsource", headers, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Sink not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Service not found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Retrieves a list of all available sinks.
   *
   * @param language: (Optional) Language setting for the Accept-Language header.
   *
   * @returns A list of available sinks.
   */
  async getSinks(language = null) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.get("/audio/sinks", headers, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Retrieves a list of all available sources.
   *
   * @param language: (Optional) Language setting for the Accept-Language header.
   *
   * @returns A list of available sources.
   */
  async getSources(language = null) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.get("/audio/sources", headers, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }
}

class AsyncAudio extends Audio {}

// =============================================================================
// Auth  (generated from Auth.py)
// =============================================================================

class Auth {
  constructor(client) {
    this.client = client;
  }

  /**
   * Retrieve the API tokens associated with the authenticated user.
   *
   * @param language: (Optional) Language setting for the API request.
   *
   * @returns JSON response from the server.
   */
  async getAPITokens() {
    let headers = { Accept: "application/json" };
    let response, status_code;
    try {
      response = await this.client.get("/auth/apitokens", headers, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 401) {
        return { error: "User is not authenticated." };
      } else if (status_code === 404) {
        return { error: "User not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "User not found." };
    } else if (status_code === 401) {
      return { error: "User is not authenticated." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Revoke a specific API token associated with the authenticated user.
   *
   * @param tokenName: Name of the API token to be revoked.
   * @param language: (Optional) Language setting for the API request.
   *
   * @returns JSON response from the server.
   */
  async revokeAPIToken(tokenName) {
    let response, status_code;
    try {
      response = await this.client.delete(`/auth/apitokens/${tokenName}`, {}, null, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 401) {
        return { error: "User is not authenticated." };
      } else if (status_code === 404) {
        return { error: "User not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "User not found." };
    } else if (status_code === 401) {
      return { error: "User is not authenticated." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Terminate the session associated with a refresh token.
   *
   * @param refreshToken: The refresh token used to delete the session.
   * @param id: The user ID associated with the refresh token.
   *
   * @returns JSON response from the server.
   */
  async logout(refreshToken, sessionID) {
    let headers = { "Content-Type": "application/x-www-form-urlencoded" };
    let data = { refresh_token: refreshToken, id: sessionID };
    let response, status_code;
    try {
      response = await this.client.post("/auth/logout", headers, data, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 401) {
        return { error: "User is not authenticated." };
      } else if (status_code === 404) {
        return { error: "User not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "User not found." };
    } else if (status_code === 401) {
      return { error: "User is not authenticated." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Retrieve the sessions associated with the authenticated user.
   *
   * @returns JSON response from the server.
   */
  async getSessions() {
    let headers = { Accept: "application/json" };
    let response, status_code;
    try {
      response = await this.client.get("/auth/sessions", headers, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 401) {
        return { error: "User is not authenticated." };
      } else if (status_code === 404) {
        return { error: "User not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "User not found." };
    } else if (status_code === 401) {
      return { error: "User is not authenticated." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Obtain access and refresh tokens.
   *
   * @param useCookie: (Optional) Whether to use cookies for the session.
   * @param grantType: (Optional) The type of grant being requested.
   * @param code: (Optional) Authorization code for authentication.
   * @param redirectUri: (Optional) Redirect URI for OAuth authentication.
   * @param clientID: (Optional) Client ID for authentication.
   * @param refreshToken: (Optional) Refresh token for token renewal.
   * @param codeVerifier: (Optional) Code verifier for PKCE authentication.
   *
   * @returns JSON response from the server.
   */
  async getToken({ useCookie = false, grantType = null, code = null, redirectURI = null, clientID = null, refreshToken = null, codeVerifier = null } = {}) {
    let headers = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
    let params = { useCookie: String(useCookie).toLowerCase() };
    let body = { grant_type: grantType, code, redirect_uri: redirectURI, client_id: clientID, refresh_token: refreshToken, code_verifier: codeVerifier };
    body = Object.fromEntries(Object.entries(body).filter(([k, v]) => (v !== null && v !== undefined)).map(([k, v]) => [k, v]));
    let encodedBody = _urlencode(body);
    let response, status_code;
    try {
      response = await this.client.post("/auth/token", headers, encodedBody, params);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 400) {
        return { error: "Invalid request parameters." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return response;
    } else if (status_code === 400) {
      return { error: "Invalid request parameters." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }
}

class AsyncAuth extends Auth {}

// =============================================================================
// ChannelTypes  (generated from ChannelTypes.py)
// =============================================================================

class ChannelTypes {
  constructor(client) {
    this.client = client;
  }

  /**
   * Retrieves all available channel types.
   *
   * @param language: Optional headers 'Accept-Language' to specify the preferred language.
   * @param prefixes: Optional query parameter to filter channel types by prefix.
   *
   * @returns A list of channel types.
   */
  async getChannelTypes(prefixes = null, language = null) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let params = {};
    if (prefixes) {
      params["prefixes"] = prefixes;
    }
    let response, status_code;
    try {
      response = await this.client.get("/channel-types", headers, params);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Retrieves the item types the given trigger channel type UID can be linked to.
   *
   * @param channelTypeUID: The unique UID of the channel type.
   * @param language: Optional headers 'Accept-Language' to specify the preferred language.
   *
   * @returns Details of the specific channel type.
   */
  async getChannelType(channelTypeUID, language = null) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.get(`/channel-types/${channelTypeUID}`, headers, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Channel type with provided channelTypeUID does not exist." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Channel type with provided channelTypeUID does not exist." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Retrieves the item types that can be linked to the specified trigger channel type.
   *
   * @param channelTypeUID: The unique UID of the channel type.
   *
   * @returns A list of item types.
   */
  async getLinkableItemTypes(channelTypeUID) {
    let response, status_code;
    try {
      response = await this.client.get(`/channel-types/${channelTypeUID}/linkableItemTypes`, { Accept: "application/json" }, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 204) {
        return { error: "No content: channel type has no linkable items or is no trigger channel." };
      } else if (status_code === 404) {
        return { error: "Given channel type UID not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Given channel type UID not found." };
    } else if (status_code === 204) {
      return { error: "No content: channel type has no linkable items or is no trigger channel." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }
}

class AsyncChannelTypes extends ChannelTypes {}

// =============================================================================
// ConfigDescriptions  (generated from ConfigDescriptions.py)
// =============================================================================

class ConfigDescriptions {
  constructor(client) {
    this.client = client;
  }

  /**
   * Retrieves all available config descriptions.
   *
   * @param language: Optional headers 'Accept-Language' to specify the preferred language.
   * @param scheme: Optional query parameter to filter results by a specific scheme.
   *
   * @returns A list of configuration descriptions.
   */
  async getConfigDescriptions(scheme = null, language = null) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let params = {};
    if (scheme) {
      params["scheme"] = scheme;
    }
    let response, status_code;
    try {
      response = await this.client.get("/config-descriptions", headers, params);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Retrieves a config description by URI.
   *
   * @param uri: The URI of the requested configuration description.
   * @param language: Optional headers 'Accept-Language' to specify the preferred language.
   *
   * @returns Details of the specific configuration description.
   */
  async getConfigDescription(uri, language = null) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.get(`/config-descriptions/${uri}`, headers, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 400) {
        return { error: "Invalid URI syntax." };
      } else if (status_code === 404) {
        return { error: "Not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Not found." };
    } else if (status_code === 400) {
      return { error: "Invalid URI syntax." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }
}

class AsyncConfigDescriptions extends ConfigDescriptions {}

// =============================================================================
// Discovery  (generated from Discovery.py)
// =============================================================================

class Discovery {
  constructor(client) {
    this.client = client;
  }

  /**
   * Gets all bindings that support discovery.
   *
   * @returns Eine Liste der Bindings als Strings.
   */
  async getDiscoveryBindings() {
    let response, status_code;
    try {
      response = await this.client.get("/discovery", { Accept: "application/json" }, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Gets information about the discovery services for a binding.
   *
   * @param bindingId: The ID of the binding to get discovery information for.
   * @param language: Optional language parameter for the response (Accept-Language header).
   *
   * @returns Information about the discovery service for the specified binding.
   */
  async getBindingInfo(bindingID, language = null) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.get(`/discovery/bindings/${bindingID}/info`, headers, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Discovery service not found." };
      } else if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return response;
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Starts asynchronous discovery process for a binding and returns the timeout in seconds of the discovery operation.
   *
   * @param bindingID: The ID of the binding for which the discovery is to be started.
   * @param input: An input parameter to start the discovery.
   *
   * @returns Timeout duration of the discovery operation in seconds.
   */
  async startBindingScan(bindingID, input = null) {
    let params = { input };
    let response, status_code;
    try {
      response = await this.client.post(`/discovery/bindings/${bindingID}/scan`, { Accept: "text/plain" }, null, params);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }
}

class AsyncDiscovery extends Discovery {}

// =============================================================================
// Events, ItemEvents, ThingEvents, InboxEvents, LinkEvents, ChannelEvents  (generated from Events.py)
// =============================================================================

class Events {
  constructor(client) {
    this.client = client;
  }

  /**
   * Get all available events, optionally filtered by topic.
   *
   * @param topics: A comma-separated list of topics to filter the events by
   *                (e.g. "openhab/items/* /statechanged,openhab/things/* /statuschanged").
   *                The wildcard * also matches slashes.
   *
   * @returns A SSE stream of events (fetch Response) or {"error": ...}.
   */
  getEvents(topics = null) {
    return _openStream(this.client, topics, { errors: { [400]: "Topic is empty or contains invalid characters." } });
  }

  /**
   * Initiates a new item state tracker connection.
   *
   * The first event of the stream carries the connection ID, which is needed for
   * updateSSEConnectionItems().
   *
   * @returns A SSE stream (fetch Response) or {"error": ...}.
   */
  initiateStateTracker() {
    return _openStream(this.client, null, { path: "/rest/events/states", headers: { Accept: "*/*" } });
  }

  /**
   * Changes the list of items a SSE connection will receive state updates for.
   *
   * @param connectionID: The ID of the existing connection.
   * @param items: A list of item names to subscribe to for state updates.
   *
   * @returns A success message when the update is completed.
   */
  async updateSSEConnectionItems(connectionID, items) {
    let response, statusCode;
    try {
      response = await this.client.post(`/events/states/${connectionID}`, { "Content-Type": "application/json" }, JSON.stringify(items), null);
      if (response instanceof StatusResponse) {
        statusCode = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      statusCode = err.status;
      if (statusCode === 404) {
        return { error: "Unknown connectionID." };
      }
      return { error: `HTTP error ${statusCode}: ${err.message}` };
    }
    if (statusCode === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${statusCode}` };
  }
}

class AsyncEvents extends Events {}

class ItemEvents {
  constructor(client) {
    this.client = client;
  }

  /**
   * Get all item-related events.
   *
   * @returns A SSE stream of item events.
   */
  ItemEvent() {
    return _openStream(this.client, "openhab/items/*");
  }

  /**
   * Get events for added items.
   *
   * @param itemName: The name of the item (default is "*").
   *
   * @returns A SSE stream of added item events.
   */
  ItemAddedEvent(itemName = "*") {
    return _openStream(this.client, `openhab/items/${itemName}/added`);
  }

  /**
   * Get events for removed items.
   *
   * @param itemName: The name of the item (default is "*").
   *
   * @returns A SSE stream of removed item events.
   */
  ItemRemovedEvent(itemName = "*") {
    return _openStream(this.client, `openhab/items/${itemName}/removed`);
  }

  /**
   * Get events for updated items.
   *
   * @param itemName: The name of the item (default is "*").
   *
   * @returns A SSE stream of updated item events.
   */
  ItemUpdatedEvent(itemName = "*") {
    return _openStream(this.client, `openhab/items/${itemName}/updated`);
  }

  /**
   * Get events for item commands.
   *
   * @param itemName: The name of the item (default is "*").
   *
   * @returns A SSE stream of item command events.
   */
  ItemCommandEvent(itemName = "*") {
    return _openStream(this.client, `openhab/items/${itemName}/command`);
  }

  /**
   * Get events for item state updates.
   *
   * @param itemName: The name of the item (default is "*").
   *
   * @returns A SSE stream of item state events.
   */
  ItemStateEvent(itemName = "*") {
    return _openStream(this.client, `openhab/items/${itemName}/state`);
  }

  /**
   * Get events for predicted item state changes.
   *
   * @param itemName: The name of the item (default is "*").
   *
   * @returns A SSE stream of item state predicted events.
   */
  ItemStatePredictedEvent(itemName = "*") {
    return _openStream(this.client, `openhab/items/${itemName}/statepredicted`);
  }

  /**
   * Get events for item state changes.
   *
   * Note: with the default "*", state changes of group items are included as
   * well, because their topic openhab/items/<group>/<member>/statechanged also
   * matches the pattern.
   *
   * @param itemName: The name of the item (default is "*").
   *
   * @returns A SSE stream of item state changed events.
   */
  ItemStateChangedEvent(itemName = "*") {
    return _openStream(this.client, `openhab/items/${itemName}/statechanged`);
  }

  /**
   * Get events for state changes of group items.
   *
   * @param itemName: The name of the group item (default is "*").
   * @param memberName: The name of the group member that caused the change (default is "*").
   *
   * @returns A SSE stream of group item state changed events.
   */
  GroupItemStateChangedEvent(itemName = "*", memberName = "*") {
    return _openStream(this.client, `openhab/items/${itemName}/${memberName}/statechanged`);
  }
}

class AsyncItemEvents extends ItemEvents {}

class ThingEvents {
  constructor(client) {
    this.client = client;
  }

  /**
   * Get events for added things.
   *
   * @param thingUID: The UID of the thing (default is "*").
   *
   * @returns A SSE stream of added thing events.
   */
  ThingAddedEvent(thingUID = "*") {
    return _openStream(this.client, `openhab/things/${thingUID}/added`);
  }

  /**
   * Get events for removed things.
   *
   * @param thingUID: The UID of the thing (default is "*").
   *
   * @returns A SSE stream of removed thing events.
   */
  ThingRemovedEvent(thingUID = "*") {
    return _openStream(this.client, `openhab/things/${thingUID}/removed`);
  }

  /**
   * Get events for updated things.
   *
   * @param thingUID: The UID of the thing (default is "*").
   *
   * @returns A SSE stream of updated thing events.
   */
  ThingUpdatedEvent(thingUID = "*") {
    return _openStream(this.client, `openhab/things/${thingUID}/updated`);
  }

  /**
   * Get events for thing status information.
   *
   * @param thingUID: The UID of the thing (default is "*").
   *
   * @returns A SSE stream of thing status information events.
   */
  ThingStatusInfoEvent(thingUID = "*") {
    return _openStream(this.client, `openhab/things/${thingUID}/status`);
  }

  /**
   * Get events for thing status information changes.
   *
   * @param thingUID: The UID of the thing (default is "*").
   *
   * @returns A SSE stream of thing status information changed events.
   */
  ThingStatusInfoChangedEvent(thingUID = "*") {
    return _openStream(this.client, `openhab/things/${thingUID}/statuschanged`);
  }
}

class AsyncThingEvents extends ThingEvents {}

class InboxEvents {
  constructor(client) {
    this.client = client;
  }

  /**
   * Get events for added things in the inbox.
   *
   * @param thingUID: The UID of the thing (default is "*").
   *
   * @returns A SSE stream of added inbox events.
   */
  InboxAddedEvent(thingUID = "*") {
    return _openStream(this.client, `openhab/inbox/${thingUID}/added`);
  }

  /**
   * Get events for removed things in the inbox.
   *
   * @param thingUID: The UID of the thing (default is "*").
   *
   * @returns A SSE stream of removed inbox events.
   */
  InboxRemovedEvent(thingUID = "*") {
    return _openStream(this.client, `openhab/inbox/${thingUID}/removed`);
  }

  /**
   * Get events for updated things in the inbox.
   *
   * @param thingUID: The UID of the thing (default is "*").
   *
   * @returns A SSE stream of updated inbox events.
   */
  InboxUpdatedEvent(thingUID = "*") {
    return _openStream(this.client, `openhab/inbox/${thingUID}/updated`);
  }
}

class AsyncInboxEvents extends InboxEvents {}

class LinkEvents {
  constructor(client) {
    this.client = client;
  }

  /**
   * Get events for added item-channel links.
   *
   * @param itemName: The name of the item (default is "*").
   * @param channelUID: The UID of the channel (default is "*").
   *
   * @returns A SSE stream of added item-channel link events.
   */
  ItemChannelLinkAddedEvent(itemName = "*", channelUID = "*") {
    return _openStream(this.client, `openhab/links/${itemName}-${channelUID}/added`);
  }

  /**
   * Get events for removed item-channel links.
   *
   * @param itemName: The name of the item (default is "*").
   * @param channelUID: The UID of the channel (default is "*").
   *
   * @returns A SSE stream of removed item-channel link events.
   */
  ItemChannelLinkRemovedEvent(itemName = "*", channelUID = "*") {
    return _openStream(this.client, `openhab/links/${itemName}-${channelUID}/removed`);
  }
}

class AsyncLinkEvents extends LinkEvents {}

class ChannelEvents {
  constructor(client) {
    this.client = client;
  }

  /**
   * Get events for changes in channel descriptions.
   *
   * @param channelUID: The UID of the channel (default is "*").
   *
   * @returns A SSE stream of channel description changed events.
   */
  ChannelDescriptionChangedEvent(channelUID = "*") {
    return _openStream(this.client, `openhab/channels/${channelUID}/descriptionchanged`);
  }

  /**
   * Get events for triggered channels.
   *
   * @param channelUID: The UID of the channel (default is "*").
   *
   * @returns A SSE stream of channel triggered events.
   */
  ChannelTriggeredEvent(channelUID = "*") {
    return _openStream(this.client, `openhab/channels/${channelUID}/triggered`);
  }
}

class AsyncChannelEvents extends ChannelEvents {}

// =============================================================================
// Iconsets  (generated from Iconsets.py)
// =============================================================================

class Iconsets {
  constructor(client) {
    this.client = client;
  }

  /**
   * Gets all icon sets.
   *
   * @param language: Optional language preference for the response (e.g. 'en', 'de').
   *
   * @returns A list of icon sets with details such as ID, label, description and supported formats.
   */
  async getIconsets(language = null) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.get("/iconsets", headers, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }
}

class AsyncIconsets extends Iconsets {}

// =============================================================================
// Inbox  (generated from Inbox.py)
// =============================================================================

class Inbox {
  constructor(client) {
    this.client = client;
  }

  /**
   * Get all discovered things.
   *
   * @param includeIgnored: Whether ignored entries should also be included (default: true).
   *
   * @returns A list of discovered things with details such as UID, flag, label, and properties.
   */
  async getDiscoveredThings(includeIgnored = true) {
    let response, status_code;
    try {
      response = await this.client.get("/inbox", { Accept: "application/json" }, { includeIgnored: String(includeIgnored).toLowerCase() });
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Removes the discovery result from the inbox.
   *
   * @param thingUID: The UID of the discovered thing to be removed.
   *
   * @returns The API response to the delete request.
   */
  async removeDiscoveryResult(thingUID) {
    let response, status_code;
    try {
      response = await this.client.delete(`/inbox/${thingUID}`, {}, null, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Discovery result not found in the inbox." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Discovery result not found in the inbox." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Approves the discovery result by adding the thing to the registry.
   *
   * @param thingUID: The UID of the discovered thing.
   * @param thingLabel: The new name of the thing.
   * @param newThingID: Optional: The new thing ID.
   * @param language: Optional: Language preference for the response.
   *
   * @returns The API response to the approval request.
   */
  async approveDiscoveryResult(thingUID, thingLabel, newThingID = null, language = null) {
    let response, status_code;
    try {
      response = await this.client.post(`/inbox/${thingUID}/approve`, (language ? { "Accept-Language": language, "Content-Type": "text/plain" } : { "Content-Type": "text/plain" }), thingLabel, (newThingID ? { newThingId: newThingID } : {}));
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 400) {
        return { error: "Invalid new thing ID." };
      } else if (status_code === 404) {
        return { error: "Thing unable to be approved." };
      } else if (status_code === 409) {
        return { error: "No binding found that supports this thing." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 400) {
      return { error: "Invalid new thing ID." };
    } else if (status_code === 404) {
      return { error: "Thing unable to be approved." };
    } else if (status_code === 409) {
      return { error: "No binding found that supports this thing." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Flags a discovery result as ignored for further processing.
   *
   * @param thingUID: The UID of the discovered thing.
   *
   * @returns The API response to the ignore request.
   */
  async ignoreDiscoveryResult(thingUID) {
    let response, status_code;
    try {
      response = await this.client.post(`/inbox/${thingUID}/ignore`, {}, null, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Removes the ignore flag from a discovery result.
   *
   * @param thingUID: The UID of the discovered thing.
   *
   * @returns The API response to the unignore request.
   */
  async unignoreDiscoveryResult(thingUID) {
    let response, status_code;
    try {
      response = await this.client.post(`/inbox/${thingUID}/unignore`, {}, null, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }
}

class AsyncInbox extends Inbox {}

// =============================================================================
// Items  (generated from Items.py)
// =============================================================================

class Items {
  constructor(client) {
    this.client = client;
  }

  /**
   * Get all available items.
   *
   * @param type: Optional; Item type filter.
   * @param tags: Optional; Item tag filter.
   * @param metadata: Optional; Metadata selector (default: .*).
   * @param recursive: Optional; Whether to fetch group members recursively (default: false).
   * @param fields: Optional; Limit to specific fields (comma-separated).
   * @param staticDataOnly: Optional; Only returns cached data (default: false).
   * @param language: Optional; Language filter for headers "Accept-Language".
   * @param parents: Optional; Include the parent groups of each item (openHAB 4.1+).
   *
   * @returns A list containing the item data as returned by the API.
   */
  async getItems({ type = null, tags = null, metadata = ".*", recursive = false, fields = null, staticDataOnly = false, language = null, parents = null } = {}) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let params = { type, tags, metadata, recursive: String(recursive).toLowerCase(), fields, staticDataOnly: String(staticDataOnly).toLowerCase(), parents };
    params = Object.fromEntries(Object.entries(params).filter(([key, value]) => (value !== null && value !== undefined)).map(([key, value]) => [key, value]));
    let response, status_code;
    try {
      response = await this.client.get("/items", headers, params);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Adds a list of items to the registry or updates the existing items.
   *
   * @param items: A list of item data (object).
   *
   * @returns A response object or confirmation that the items were successfully added or updated.
   */
  async addOrUpdateItems(items) {
    let response, status_code;
    try {
      response = await this.client.put("/items", { "Content-Type": "application/json", Accept: "*/*" }, JSON.stringify(items), null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 400) {
        return { error: "Payload is invalid." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 400) {
      return { error: "Payload is invalid." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Gets a single item.
   *
   * @param itemName: The name of the item.
   * @param metadata: Optional; Metadata selector (default: .*).
   * @param recursive: Optional; Whether to fetch group members recursively (default: true).
   * @param language: Optional; Language filter for headers "Accept-Language".
   *
   * @returns A object containing the requested item data.
   */
  async getItem(itemName, { metadata = ".*", recursive = true, language = null, parents = null } = {}) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let params = { metadata, recursive: String(recursive).toLowerCase(), parents };
    let response, status_code;
    try {
      response = await this.client.get(`/items/${itemName}`, headers, params);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Item not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Item not found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Adds a new item to the registry or updates the existing item.
   *
   * @param itemName: The name of the item.
   * @param itemData: The data of the item (object).
   * @param language: Optional; Language filter for headers "Accept-Language".
   *
   * @returns A response object or confirmation that the item was successfully added or updated.
   */
  async addOrUpdateItem(itemName, itemData, language = null) {
    let headers = { "Content-Type": "application/json", Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.put(`/items/${itemName}`, headers, JSON.stringify(itemData), null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 400) {
        return { error: "Payload invalid." };
      } else if (status_code === 404) {
        return { error: "Item not found or name in path invalid." };
      } else if (status_code === 405) {
        return { error: "Item not editable." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 201) {
      return { message: "Item created." };
    } else if (status_code === 400) {
      return { error: "Payload invalid." };
    } else if (status_code === 404) {
      return { error: "Item not found or name in path invalid." };
    } else if (status_code === 405) {
      return { error: "Item not editable." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Sends a command to an item.
   *
   * @param itemName: The name of the item.
   * @param command: The command to be sent (e.g., ON, OFF).
   * @param source: Optional; Source of the command, shown in the event (openHAB 4.1+).
   *
   * @returns A response object or confirmation that the command was successfully sent.
   */
  async sendCommand(itemName, command, source = null) {
    let response, status_code;
    try {
      response = await this.client.post(`/items/${itemName}`, { "Content-Type": "text/plain" }, String(command), { source });
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 400) {
        return { error: "Invalid command for this item." };
      } else if (status_code === 404) {
        return { error: "Item not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Item not found." };
    } else if (status_code === 400) {
      return { error: "Invalid command for this item." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Updates the state of an item.
   *
   * @param itemName: The name of the item.
   * @param state: The state to be signaled for the item.
   *
   * @returns A response object or confirmation that the state was successfully updated.
   */
  postUpdate(itemName, state, source = null) {
    return this.updateItemState(itemName, state, source);
  }

  /**
   * Removes an item from the registry.
   *
   * @param itemName: The name of the item.
   *
   * @returns A response object or confirmation that the item was successfully deleted.
   */
  async deleteItem(itemName) {
    let response, status_code;
    try {
      response = await this.client.delete(`/items/${itemName}`, {}, null, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Item not found or item is not editable." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Item not found or item is not editable." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Adds a new member to a group item.
   *
   * @param itemName: The name of the group item.
   * @param memberItemName: The name of the member item.
   *
   * @returns A response object or confirmation that the group member was successfully added.
   */
  async addGroupMember(itemName, memberItemName) {
    let response, status_code;
    try {
      response = await this.client.put(`/items/${itemName}/members/${memberItemName}`, {}, null, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 405) {
        return { error: "Member item is not editable." };
      } else if (status_code === 404) {
        return { error: "Item or member item not found or item is not of type group item." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Item or member item not found or item is not of type group item." };
    } else if (status_code === 405) {
      return { error: "Member item is not editable." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Removes an existing member from a group item.
   *
   * @param itemName: The name of the group item.
   * @param memberItemName: The name of the member item.
   *
   * @returns A response object or confirmation that the group member was successfully removed.
   */
  async removeGroupMember(itemName, memberItemName) {
    let response, status_code;
    try {
      response = await this.client.delete(`/items/${itemName}/members/${memberItemName}`, {}, null, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 405) {
        return { error: "Member item is not editable." };
      } else if (status_code === 404) {
        return { error: "Item or member item not found or item is not of type group item." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Item or member item not found or item is not of type group item." };
    } else if (status_code === 405) {
      return { error: "Member item is not editable." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Adds metadata to an item.
   *
   * @param itemName: The name of the item.
   * @param namespace: The namespace of the metadata.
   * @param metadata: A object containing the metadata.
   *
   * @returns A response object or confirmation that the metadata was successfully added.
   */
  async addMetadata(itemName, namespace, metadata) {
    let response, status_code;
    try {
      response = await this.client.put(`/items/${itemName}/metadata/${namespace}`, { "Content-Type": "application/json" }, JSON.stringify(metadata), null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 400) {
        return { error: "Metadata value empty." };
      } else if (status_code === 405) {
        return { error: "Metadata not editable." };
      } else if (status_code === 404) {
        return { error: "Item not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 201) {
      return { message: "Created." };
    } else if (status_code === 400) {
      return { error: "Metadata value empty." };
    } else if (status_code === 404) {
      return { error: "Item not found." };
    } else if (status_code === 405) {
      return { error: "Metadata not editable." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Removes metadata from an item.
   *
   * @param itemName: The name of the item.
   * @param namespace: The namespace of the metadata.
   *
   * @returns A response object or confirmation that the metadata was successfully removed.
   */
  async removeMetadata(itemName, namespace) {
    let response, status_code;
    try {
      response = await this.client.delete(`/items/${itemName}/metadata/${namespace}`, {}, null, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 405) {
        return { error: "Meta data not editable." };
      } else if (status_code === 404) {
        return { error: "Item not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Item not found." };
    } else if (status_code === 405) {
      return { error: "Meta data not editable." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Gets the namespaces of an item.
   *
   * @param itemName: The name of the item.
   * @param language: Optional; Language filter for headers "Accept-Language".
   *
   * @returns A list of namespaces associated with the item.
   */
  async getMetadataNamespaces(itemName, language = null) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.get(`/items/${itemName}/metadata/namespaces`, headers, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Item not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Item not found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Gets the item that defines the requested semantics of an item.
   *
   * @param itemName: The name of the item.
   * @param semanticClass: The requested semantic class.
   * @param language: Optional; Language filter for headers "Accept-Language".
   *
   * @returns A object containing the semantic item data.
   */
  async getSemanticItem(itemName, semanticClass, language = null) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.get(`/items/${itemName}/semantic/${semanticClass}`, headers, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Item not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Item not found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Gets the state of an item.
   *
   * @param itemName: The name of the item.
   *
   * @returns A object containing the current state of the item.
   */
  async getItemState(itemName) {
    let headers = { Accept: "text/plain" };
    let response, status_code;
    try {
      response = await this.client.get(`/items/${itemName}/state`, headers, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Item not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Item not found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Updates the state of an item.
   *
   * @param itemName: The name of the item.
   * @param state: The new state of the item.
   * @param language: Optional; Language filter for headers "Accept-Language".
   *
   * @returns A response object or confirmation that the state was successfully updated.
   */
  async updateItemState(itemName, state, language = null, source = null) {
    let headers = { "Content-Type": "text/plain" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.put(`/items/${itemName}/state`, headers, String(state), { source });
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 400) {
        return { error: "Invalid state for this item." };
      } else if (status_code === 404) {
        return { error: "Item not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 202) {
      return { message: "Accepted." };
    } else if (status_code === 404) {
      return { error: "Item not found." };
    } else if (status_code === 400) {
      return { error: "Invalid state for this item." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Adds a tag to an item.
   *
   * @param itemName: The name of the item.
   * @param tag: The tag to be added.
   *
   * @returns A response object or confirmation that the tag was successfully added.
   */
  async addTag(itemName, tag) {
    let response, status_code;
    try {
      response = await this.client.put(`/items/${itemName}/tags/${tag}`, {}, null, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 405) {
        return { error: "Item not editable." };
      } else if (status_code === 404) {
        return { error: "Item not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Item not found." };
    } else if (status_code === 405) {
      return { error: "Item not editable." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Removes a tag from an item.
   *
   * @param itemName: The name of the item.
   * @param tag: The tag to be removed.
   *
   * @returns A response object or confirmation that the tag was successfully removed.
   */
  async removeTag(itemName, tag) {
    let response, status_code;
    try {
      response = await this.client.delete(`/items/${itemName}/tags/${tag}`, {}, null, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 405) {
        return { error: "Item not editable." };
      } else if (status_code === 404) {
        return { error: "Item not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Item not found." };
    } else if (status_code === 405) {
      return { error: "Item not editable." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Remove unused/orphaned metadata.
   *
   * @returns A response object or confirmation that orphaned metadata was successfully purged.
   */
  async purgeOrphanedMetadata() {
    let response, status_code;
    try {
      response = await this.client.post("/items/metadata/purge", {}, null, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }
}

class AsyncItems extends Items {}

// =============================================================================
// Links  (generated from Links.py)
// =============================================================================

class Links {
  constructor(client) {
    this.client = client;
  }

  /**
   * Gets all available links.
   *
   * @param channelUID: Optional; Filters by the Channel UID.
   * @param itemName: Optional; Filters by the Item Name.
   *
   * @returns A list of links containing details such as ItemName, ChannelUID, and configuration.
   */
  async getLinks(channelUID = null, itemName = null) {
    let params = {};
    if (channelUID) {
      params["channelUID"] = channelUID;
    }
    if (itemName) {
      params["itemName"] = itemName;
    }
    let response, status_code;
    try {
      response = await this.client.get("/links", { Accept: "application/json" }, params);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Retrieves an individual link.
   *
   * @param itemName: The name of the item.
   * @param channelUID: The UID of the channel.
   *
   * @returns The link with details of the item, channel UID, and configuration.
   */
  async getLink(itemName, channelUID) {
    let itemPath = encodeURIComponent(itemName);
    let channelPath = encodeURIComponent(channelUID);
    let response, status_code;
    try {
      response = await this.client.get(`/links/${itemPath}/${channelPath}`, { Accept: "application/json" }, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Link not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Link not found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Links an item to a channel.
   *
   * @param itemName: The name of the item.
   * @param channelUID: The UID of the channel.
   * @param configuration: The configuration for the link.
   *
   * @returns The API response when the link is successfully created.
   */
  async linkItemToChannel(itemName, channelUID, configuration) {
    let itemPath = encodeURIComponent(itemName);
    let channelPath = encodeURIComponent(channelUID);
    let response, status_code;
    try {
      response = await this.client.put(`/links/${itemPath}/${channelPath}`, { "Content-Type": "application/json" }, JSON.stringify({ itemName, channelUID, configuration }), null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 405) {
        return { error: "Link is not editable." };
      } else if (status_code === 400) {
        return { error: "Content does not match the path." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 400) {
      return { error: "Content does not match the path." };
    } else if (status_code === 405) {
      return { error: "Link is not editable." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Unlinks an item from a channel.
   *
   * @param itemName: The name of the item.
   * @param channelUID: The UID of the channel.
   *
   * @returns The API response when the link is successfully removed.
   */
  async unlinkItemFromChannel(itemName, channelUID) {
    let itemPath = encodeURIComponent(itemName);
    let channelPath = encodeURIComponent(channelUID);
    let response, status_code;
    try {
      response = await this.client.delete(`/links/${itemPath}/${channelPath}`, { "Content-Type": "application/json" }, null, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 405) {
        return { error: "Link not editable." };
      } else if (status_code === 404) {
        return { error: "Link not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Link not found." };
    } else if (status_code === 405) {
      return { error: "Link not editable." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Delete all links that refer to an item or thing.
   *
   * @param object: The name of the item or the UID of the thing.
   *
   * @returns The API response when all links are successfully deleted.
   */
  async deleteAllLinks(object) {
    let response, status_code;
    try {
      response = await this.client.delete(`/links/${object}`, { Accept: "application/json" }, null, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Get orphan links between items and broken/non-existent thing channels.
   *
   * @returns A list of orphan links.
   */
  async getOrphanLinks() {
    let response, status_code;
    try {
      response = await this.client.get("/links/orphans", { Accept: "application/json" }, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Remove unused/orphaned links.
   *
   * @returns The API response when the links are successfully removed.
   */
  async purgeUnusedLinks() {
    let response, status_code;
    try {
      response = await this.client.post("/links/purge", {}, null, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }
}

class AsyncLinks extends Links {}

// =============================================================================
// Logging  (generated from Logging.py)
// =============================================================================

class Logging {
  constructor(client) {
    this.client = client;
  }

  /**
   * Get all loggers.
   *
   * @returns A list of loggers with names and levels.
   */
  async getLoggers() {
    let response, status_code;
    try {
      response = await this.client.get("/logging", { Accept: "application/json" }, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Get a single logger.
   *
   * @param loggerName: The name of the logger.
   *
   * @returns The logger with the specified name and level.
   */
  async getLogger(loggerName) {
    let response, status_code;
    try {
      response = await this.client.get(`/logging/${loggerName}`, { Accept: "application/json" }, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Modify or add a logger.
   *
   * @param loggerName: The name of the logger.
   * @param level: The level of the logger.
   *
   * @returns The API response after modification or addition.
   */
  async modifyOrAddLogger(loggerName, level) {
    let data = { loggerName, level };
    let response, status_code;
    try {
      response = await this.client.put(`/logging/${loggerName}`, { "Content-Type": "application/json" }, JSON.stringify(data), null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 400) {
        return { error: "Payload is invalid." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 400) {
      return { error: "Payload is invalid." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Remove a single logger.
   *
   * @param loggerName: The name of the logger.
   *
   * @returns The API response after removing the logger.
   */
  async removeLogger(loggerName) {
    let response, status_code;
    try {
      response = await this.client.delete(`/logging/${loggerName}`, {}, null, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }
}

class AsyncLogging extends Logging {}

// =============================================================================
// ModuleTypes  (generated from ModuleTypes.py)
// =============================================================================

class ModuleTypes {
  constructor(client) {
    this.client = client;
  }

  /**
   * Get all available module types.
   *
   * @param tags: Optional filter for tags.
   * @param typeFilter: Optional filter for the type (action, condition, trigger).
   * @param language: (Optional) Language setting for the Accept-Language header.
   *
   * @returns A list of module types.
   */
  async getModuleTypes(tags = null, typeFilter = null, language = null) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let params = {};
    if (tags) {
      params["tags"] = tags;
    }
    if (typeFilter) {
      params["type"] = typeFilter;
    }
    let response, status_code;
    try {
      response = await this.client.get("/module-types", headers, params);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Gets a module type corresponding to the given UID.
   *
   * @param moduleTypeUID: The UID of the module type.
   * @param language: (Optional) Language setting for the Accept-Language header.
   *
   * @returns A object with the module type information.
   */
  async getModuleType(moduleTypeUID, language = null) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.get(`/module-types/${moduleTypeUID}`, headers, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Module Type corresponding to the given UID was not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Module Type corresponding to the given UID was not found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }
}

class AsyncModuleTypes extends ModuleTypes {}

// =============================================================================
// Persistence  (generated from Persistence.py)
// =============================================================================

class Persistence {
  constructor(client) {
    this.client = client;
  }

  /**
   * Gets a list of persistence services.
   *
   * @returns A list of persistence services with IDs, labels, and types.
   */
  async getServices(language = null) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.get("/persistence", headers, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Gets a persistence service configuration.
   *
   * @param serviceID: The ID of the persistence service.
   *
   * @returns The configuration of the service.
   */
  async getServiceConfiguration(serviceID) {
    let response, status_code;
    try {
      response = await this.client.get(`/persistence/${serviceID}`, { Accept: "application/json" }, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Service configuration not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Service configuration not found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Sets a persistence service configuration.
   *
   * @param serviceID: The ID of the persistence service.
   * @param config: The configuration data.
   *
   * @returns The response from the API after modification.
   */
  async setServiceConfiguration(serviceID, config) {
    let response, status_code;
    try {
      config["serviceId"] = serviceID;
      response = await this.client.put(`/persistence/${serviceID}`, { "Content-Type": "application/json", Accept: "application/json" }, JSON.stringify(config), null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 400) {
        return { error: "Payload invalid." };
      } else if (status_code === 405) {
        return { error: "PersistenceServiceConfiguration not editable." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 201) {
      return { message: "PersistenceServiceConfiguration created." };
    } else if (status_code === 400) {
      return { error: "Payload invalid." };
    } else if (status_code === 405) {
      return { error: "PersistenceServiceConfiguration not editable." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Deletes a persistence service configuration.
   *
   * @param serviceID: The ID of the persistence service.
   *
   * @returns The response from the API after deleting the configuration.
   */
  async deleteServiceConfiguration(serviceID) {
    let response, status_code;
    try {
      response = await this.client.delete(`/persistence/${serviceID}`, {}, null, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 400) {
        return { error: "Payload invalid." };
      } else if (status_code === 405) {
        return { error: "PersistenceServiceConfiguration not editable." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 400) {
      return { error: "Payload invalid." };
    } else if (status_code === 405) {
      return { error: "PersistenceServiceConfiguration not editable." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Gets a list of items available via a specific persistence service.
   *
   * @param serviceID: Optional; The ID of the persistence service (default service if omitted).
   * @param itemName: Optional; Only return information for this item.
   *
   * @returns A list of items with their last and earliest timestamps.
   */
  async getItemsFromService(serviceID = null, itemName = null) {
    let response, status_code;
    try {
      response = await this.client.get("/persistence/items", { Accept: "application/json" }, { serviceId: serviceID, itemName });
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Unknown persistence service." };
      }
      if (status_code === 405) {
        return { error: "The persistence service does not provide item information." };
      }
      return { error: `HTTP error ${status_code}: ${err.message}` };
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Gets item persistence data from the persistence service.
   *
   * @param itemName: The name of the item.
   * @param serviceID: Optional; The ID of the persistence service. If omitted, the default service is used.
   * @param startTime: Optional; Start time (ISO 8601, e.g. "2026-10-30T00:00:00.000Z"). Defaults to 1 day before `endTime`.
   * @param endTime: Optional; End time (ISO 8601). Defaults to the current time.
   * @param page: Optional; Page number, starting at 0. Paging is only active if `pageLength` is set as well.
   * @param pageLength: Optional; Number of data points per page. Without it, all data points are returned.
   * @param boundary: Optional; Also return the values just before and after the time range (default: false).
   * @param itemState: Optional; Add the current item state at the end of the series (default: false).
   * @param displayState: Optional; Add a formatted display state to every data point (openHAB 5.0+).
   * @param language: Optional; Value for the "Accept-Language" header.
   *
   * @returns The retrieved data points of the item.
   */
  async getItemPersistenceData(itemName, serviceID = null, { startTime = null, endTime = null, page = null, pageLength = null, boundary = false, itemState = false, displayState = null, language = null } = {}) {
    if ((pageLength !== null && pageLength !== undefined) && (page === null || page === undefined)) {
      page = 0;
    }
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.get(`/persistence/items/${itemName}`, headers, { serviceId: serviceID, starttime: startTime, endtime: endTime, page, pagelength: pageLength, boundary, itemState, displayState });
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Unknown Item or persistence service." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Unknown Item or persistence service." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Stores item persistence data into the persistence service.
   *
   * @param serviceID: The ID of the persistence service.
   * @param itemName: The name of the item.
   * @param time: The time of the storage.
   * @param state: The state of the item to be stored.
   *
   * @returns The response from the API after storing the data.
   */
  async storeItemData(itemName, time, state, serviceID = null) {
    let response, status_code;
    try {
      response = await this.client.put(`/persistence/items/${itemName}`, {}, null, { serviceId: serviceID, time, state });
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Unknown Item or persistence service." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Unknown Item or persistence service." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Deletes item persistence data from a specific persistence service in a given time range.
   *
   * @param serviceID: The ID of the persistence service.
   * @param itemName: The name of the item.
   * @param startTime: The start time of the data to be deleted.
   * @param endTime: The end time of the data to be deleted.
   *
   * @returns The response from the API after deleting the data.
   */
  async deleteItemData(itemName, startTime, endTime, serviceID) {
    let response, status_code;
    try {
      response = await this.client.delete(`/persistence/items/${itemName}`, { Accept: "application/json" }, null, { serviceId: serviceID, starttime: startTime, endtime: endTime });
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 400) {
        return { error: `Invalid filter parameters or service not modifiable: ${err.message}` };
      } else if (status_code === 404) {
        return { error: "Unknown persistence service." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Unknown persistence service." };
    } else if (status_code === 400) {
      return { error: "Invalid filter parameters." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }
}

class AsyncPersistence extends Persistence {}

// =============================================================================
// ProfileTypes  (generated from ProfileTypes.py)
// =============================================================================

class ProfileTypes {
  constructor(client) {
    this.client = client;
  }

  /**
   * Gets all available profile types.
   *
   * @param channelTypeUID: Optional filter for the channel type.
   * @param itemType: Optional filter for the item type.
   * @param language: (Optional) Language setting for the Accept-Language header.
   *
   * @returns A list of profile types.
   */
  async getProfileTypes(channelTypeUID = null, itemType = null, language = null) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let params = {};
    if (channelTypeUID) {
      params["channelTypeUID"] = channelTypeUID;
    }
    if (itemType) {
      params["itemType"] = itemType;
    }
    let response, status_code;
    try {
      response = await this.client.get("/profile-types", headers, params);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }
}

class AsyncProfileTypes extends ProfileTypes {}

// =============================================================================
// Rules  (generated from Rules.py)
// =============================================================================

class Rules {
  constructor(client) {
    this.client = client;
  }

  /**
   * Get available rules, optionally filtered by tags and/or prefix.
   *
   * @param prefix: Optional prefix to filter the results.
   * @param tags: Optional tag array to filter the results.
   * @param summary: If true, only summary fields will be returned.
   * @param staticDataOnly: If true, only static data will be returned.
   *
   * @returns A list of rules (JSON objects).
   */
  async getRules(prefix = null, tags = null, summary = false, staticDataOnly = false) {
    let response, status_code;
    try {
      response = await this.client.get("/rules", { Accept: "application/json" }, { prefix, tags, summary, staticDataOnly });
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Creates a rule.
   *
   * @param ruleData: The rule data to be created (as a object).
   *
   * @returns The created rule (JSON).
   */
  async createRule(ruleData) {
    let location, response, status_code;
    try {
      response = await this.client.post("/rules", { "Content-Type": "application/json" }, JSON.stringify(ruleData), null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
        location = (response["location"] ?? null);
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 400) {
        return { error: "Creation refused: Missing required parameter." };
      } else if (status_code === 409) {
        return { error: "Creation refused: Rule with the same UID already exists." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 201) {
      return { message: "Rule successfully created.", location: (location ? location : "No Location headers provided.") };
    } else if (status_code === 400) {
      return { error: "Creation refused: Missing required parameter." };
    } else if (status_code === 409) {
      return { error: "Creation refused: Rule with the same UID already exists." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Gets the rule corresponding to the given UID.
   *
   * @param ruleUID: The UID of the rule to retrieve.
   *
   * @returns The rule object (JSON).
   */
  async getRule(ruleUID) {
    let response, status_code;
    try {
      response = await this.client.get(`/rules/${ruleUID}`, { Accept: "application/json" }, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Rule not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Rule not found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Updates an existing rule corresponding to the given UID.
   *
   * @param ruleUID: The UID of the rule to update.
   * @param ruleData: The new rule data (as a object).
   *
   * @returns The updated rule (JSON).
   */
  async updateRule(ruleUID, ruleData) {
    let response, status_code;
    try {
      response = await this.client.put(`/rules/${ruleUID}`, { "Content-Type": "application/json" }, JSON.stringify(ruleData), null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Rule corresponding to the given UID was not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Rule corresponding to the given UID was not found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Removes an existing rule corresponding to the given UID.
   *
   * @param ruleUID: The UID of the rule to delete.
   *
   * @returns The API response (status code).
   */
  async deleteRule(ruleUID) {
    let response, status_code;
    try {
      response = await this.client.delete(`/rules/${ruleUID}`, {}, null, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Rule corresponding to the given UID was not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Rule corresponding to the given UID was not found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Gets the rule's module corresponding to the given category and ID.
   *
   * @param ruleUID: The UID of the rule.
   * @param moduleCategory: The category of the module.
   * @param moduleID: The ID of the module.
   *
   * @returns The module (JSON).
   */
  async getModule(ruleUID, moduleCategory, moduleID) {
    let response, status_code;
    try {
      response = await this.client.get(`/rules/${ruleUID}/${moduleCategory}/${moduleID}`, { Accept: "application/json" }, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Rule corresponding to the given UID was not found or does not have a module with such Category and ID." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Rule corresponding to the given UID was not found or does not have a module with such Category and ID." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Gets the module's configuration.
   *
   * @param ruleUID: The UID of the rule.
   * @param moduleCategory: The category of the module.
   * @param moduleID: The ID of the module.
   *
   * @returns The module configuration (JSON).
   */
  async getModuleConfig(ruleUID, moduleCategory, moduleID) {
    let response, status_code;
    try {
      response = await this.client.get(`/rules/${ruleUID}/${moduleCategory}/${moduleID}/config`, { Accept: "application/json" }, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Rule corresponding to the given UID was not found or does not have a module with such Category and ID." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Rule corresponding to the given UID was not found or does not have a module with such Category and ID." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Gets the module's configuration parameter.
   *
   * @param ruleUID: The UID of the rule.
   * @param moduleCategory: The category of the module.
   * @param moduleID: The ID of the module.
   * @param param: The name of the configuration parameter.
   *
   * @returns The configuration parameter value (JSON).
   */
  async getModuleConfigParam(ruleUID, moduleCategory, moduleID, param) {
    let response, status_code;
    try {
      response = await this.client.get(`/rules/${ruleUID}/${moduleCategory}/${moduleID}/config/${param}`, { Accept: "text/plain" }, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Rule corresponding to the given UID was not found or does not have a module with such Category and ID." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Rule corresponding to the given UID was not found or does not have a module with such Category and ID." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Sets the module's configuration parameter value.
   *
   * @param ruleUID: The UID of the rule.
   * @param moduleCategory: The category of the module.
   * @param moduleID: The ID of the module.
   * @param param: The name of the configuration parameter.
   * @param value: The value to set for the configuration parameter.
   *
   * @returns The API response (status code).
   */
  async setModuleConfigParam(ruleUID, moduleCategory, moduleID, param, value) {
    let response, status_code;
    try {
      response = await this.client.put(`/rules/${ruleUID}/${moduleCategory}/${moduleID}/config/${param}`, { "Content-Type": "text/plain" }, String(value), null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Rule corresponding to the given UID was not found or does not have a module with such Category and ID." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Rule corresponding to the given UID was not found or does not have a module with such Category and ID." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Gets the rule actions.
   *
   * @param ruleUID: The UID of the rule.
   *
   * @returns A list of actions (JSON).
   */
  async getActions(ruleUID) {
    let response, status_code;
    try {
      response = await this.client.get(`/rules/${ruleUID}/actions`, { Accept: "application/json" }, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Rule corresponding to the given UID was not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Rule corresponding to the given UID was not found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Gets the rule conditions.
   *
   * @param ruleUID: The UID of the rule.
   *
   * @returns A list of conditions (JSON).
   */
  async getConditions(ruleUID) {
    let response, status_code;
    try {
      response = await this.client.get(`/rules/${ruleUID}/conditions`, { Accept: "application/json" }, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Rule corresponding to the given UID was not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Rule corresponding to the given UID was not found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Gets the rule configuration values.
   *
   * @param ruleUID: The UID of the rule.
   *
   * @returns The configuration of the rule (JSON).
   */
  async getConfiguration(ruleUID) {
    let response, status_code;
    try {
      response = await this.client.get(`/rules/${ruleUID}/config`, { Accept: "application/json" }, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Rule corresponding to the given UID was not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Rule corresponding to the given UID was not found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Sets the rule configuration values.
   *
   * @param ruleUID: The UID of the rule.
   * @param configData: The new configuration data (as a object).
   *
   * @returns The updated configuration (JSON).
   */
  async updateConfiguration(ruleUID, configData) {
    let response, status_code;
    try {
      response = await this.client.put(`/rules/${ruleUID}/config`, { "Content-Type": "application/json" }, JSON.stringify(configData), null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Rule corresponding to the given UID was not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Rule corresponding to the given UID was not found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Sets the rule configuration values. Activates or deactivates the rule.
   *
   * @param ruleUID: The UID of the rule.
   * @param enable: If true, the rule will be activated. If false, the rule will be deactivated.
   *
   * @returns The API response (status code).
   */
  async setRuleState(ruleUID, enable) {
    let response, status_code;
    try {
      response = await this.client.post(`/rules/${ruleUID}/enable`, { "Content-Type": "text/plain" }, (enable ? "true" : "false"), null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Rule corresponding to the given UID was not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Rule corresponding to the given UID was not found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  enable(ruleUID) {
    return this.setRuleState(ruleUID, true);
  }

  disable(ruleUID) {
    return this.setRuleState(ruleUID, false);
  }

  /**
   * Executes the rule's actions immediately.
   *
   * @param ruleUID: The UID of the rule.
   * @param contextData: Optional context data for executing the rule.
   *
   * @returns The API response (status code).
   */
  async runNow(ruleUID, contextData = null) {
    let response, status_code;
    try {
      response = await this.client.post(`/rules/${ruleUID}/runnow`, { "Content-Type": "application/json", Accept: "application/json" }, JSON.stringify((contextData || {})), null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Rule corresponding to the given UID was not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Rule corresponding to the given UID was not found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Gets the rule triggers.
   *
   * @param ruleUID: The UID of the rule.
   *
   * @returns A list of triggers (JSON).
   */
  async getTriggers(ruleUID) {
    let response, status_code;
    try {
      response = await this.client.get(`/rules/${ruleUID}/triggers`, { Accept: "application/json" }, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Rule corresponding to the given UID was not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Rule corresponding to the given UID was not found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Simulates the executions of rules filtered by tag 'Schedule' within the given times.
   *
   * @param fromTime: Simulates the executions of rules filtered by tag 'Schedule' within the given times.
   * @param untilTime: Simulates the executions of rules filtered by tag 'Schedule' within the given times.
   *
   * @returns The simulation results (JSON).
   */
  async simulateSchedule(fromTime, untilTime) {
    let response, status_code;
    try {
      response = await this.client.get("/rules/schedule/simulations", { Accept: "application/json" }, { from: fromTime, until: untilTime });
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 400) {
        return { error: "The max. simulation duration of 180 days is exceeded." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 400) {
      return { error: "The max. simulation duration of 180 days is exceeded." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }
}

class AsyncRules extends Rules {}

// =============================================================================
// Services  (generated from Services.py)
// =============================================================================

class Services {
  constructor(client) {
    this.client = client;
  }

  /**
   * Get all configurable services.
   *
   * @param language: Optional language setting (as header).
   *
   * @returns A list of services (JSON).
   */
  async getServices(language = null) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.get("/services", headers, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Get configurable service for the given service ID.
   *
   * @param serviceID: The ID of the service to retrieve.
   * @param language: Optional language setting (as header).
   *
   * @returns The service object (JSON).
   */
  async getService(serviceID, language = null) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.get(`/services/${serviceID}`, headers, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Not found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Get service configuration for the given service ID.
   *
   * @param serviceID: The ID of the service.
   *
   * @returns The configuration of the service (JSON).
   */
  async getServiceConfig(serviceID) {
    let response, status_code;
    try {
      response = await this.client.get(`/services/${serviceID}/config`, { Accept: "application/json" }, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 500) {
        return { error: "Configuration can not be read due to internal error." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 500) {
      return { error: "Configuration can not be read due to internal error." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Updates a service configuration for the given service ID and returns the old configuration.
   *
   * @param serviceID: The ID of the service.
   * @param configData: The new configuration data (as a object).
   *
   * @returns The old configuration of the service (JSON).
   */
  async updateServiceConfig(serviceID, configData, language = null) {
    let headers = { "Content-Type": "application/json", Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.put(`/services/${serviceID}/config`, headers, JSON.stringify(configData), null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 500) {
        return { error: "Configuration can not be updated due to internal error." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 204) {
      return { message: "OK, no old configuration." };
    } else if (status_code === 500) {
      return { error: "Configuration can not be updated due to internal error." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Deletes a service configuration for the given service ID and returns the old configuration.
   *
   * @param serviceID: The ID of the service.
   *
   * @returns The old configuration of the service (JSON).
   */
  async deleteServiceConfig(serviceID) {
    let response, status_code;
    try {
      response = await this.client.delete(`/services/${serviceID}/config`, { Accept: "application/json" }, null, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 500) {
        return { error: "Configuration can not be updated due to internal error." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 204) {
      return { message: "OK, no old configuration." };
    } else if (status_code === 500) {
      return { error: "Configuration can not be updated due to internal error." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Get existing multiple context service configurations for the given factory PID.
   *
   * @param serviceID: The ID of the service.
   * @param language: Optional language setting (as header).
   *
   * @returns A list of contexts (JSON).
   */
  async getServiceContexts(serviceID, language = null) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.get(`/services/${serviceID}/contexts`, headers, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }
}

class AsyncServices extends Services {}

// =============================================================================
// Sitemaps  (generated from Sitemaps.py)
// =============================================================================

class Sitemaps {
  constructor(client) {
    this.client = client;
  }

  /**
   * Opens a sitemap SSE stream; returns the streaming response or {"error": ...}.
   */
  async _openEventStream(path, params, errors) {
    let statusCode;
    try {
      return await this.client.executeSSE(path, null, params);
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      statusCode = err.status;
      if (_contains(errors, statusCode)) {
        return { error: errors[statusCode] };
      }
      return { error: `HTTP error ${statusCode}: ${err.message}` };
    }
  }

  /**
   * Get all available sitemaps.
   *
   * @returns A list of sitemaps (JSON).
   */
  async getSitemaps() {
    let response, status_code;
    try {
      response = await this.client.get("/sitemaps", { Accept: "application/json" }, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Get sitemap by name.
   *
   * @param sitemapName: The name of the sitemap to retrieve.
   * @param type: Optional query parameter for type.
   * @param jsonCallback: Optional query parameter for JSON callback.
   * @param includeHidden: Whether hidden widgets should be included.
   * @param language: Optional language setting (as header).
   *
   * @returns The sitemap object (JSON).
   */
  async getSitemap(sitemapName, type = null, jsonCallback = null, includeHidden = false, language = null) {
    if (includeHidden) {
      includeHidden = "true";
    } else {
      includeHidden = "false";
    }
    let response, status_code;
    try {
      response = await this.client.get(`/sitemaps/${sitemapName}`, (language ? { "Accept-Language": language } : {}), { type, jsoncallback: jsonCallback, includeHidden });
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Polls the data for one page of a sitemap.
   *
   * @param sitemapName: The name of the sitemap.
   * @param pageID: The ID of the page.
   * @param subscriptionID: Optional query parameter for the subscription ID.
   * @param includeHidden: Whether hidden widgets should be included.
   * @param language: Optional language setting (as header).
   *
   * @returns The sitemap page (JSON).
   */
  async getSitemapPage(sitemapName, pageID, subscriptionID = null, includeHidden = false, language = null) {
    if (includeHidden) {
      includeHidden = "true";
    } else {
      includeHidden = "false";
    }
    let response, status_code;
    try {
      response = await this.client.get(`/sitemaps/${sitemapName}/${pageID}`, (language ? { "Accept-Language": language } : {}), { subscriptionid: subscriptionID, includeHidden });
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 400) {
        return { error: "Invalid subscription id has been provided." };
      } else if (status_code === 404) {
        return { error: "Sitemap with requested name does not exist or page does not exist, or page refers to a non-linkable widget." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Sitemap with requested name does not exist or page does not exist, or page refers to a non-linkable widget." };
    } else if (status_code === 400) {
      return { error: "Invalid subscription id has been provided." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Polls the data for a whole sitemap. Not recommended due to potentially high traffic.
   *
   * @param sitemapName: The name of the sitemap.
   * @param subscriptionID: Optional query parameter for the subscription ID.
   * @param includeHidden: Whether hidden widgets should be included.
   * @param language: Optional language setting (as header).
   *
   * @returns The complete sitemap (JSON).
   */
  async getFullSitemap(sitemapName, subscriptionID = null, includeHidden = false, language = null) {
    if (includeHidden) {
      includeHidden = "true";
    } else {
      includeHidden = "false";
    }
    let response, status_code;
    try {
      response = await this.client.get(`/sitemaps/${sitemapName}/*`, (language ? { "Accept-Language": language } : {}), { subscriptionid: subscriptionID, includeHidden });
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 400) {
        return { error: "Invalid subscription id has been provided." };
      } else if (status_code === 404) {
        return { error: "Sitemap with requested name does not exist." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Sitemap with requested name does not exist." };
    } else if (status_code === 400) {
      return { error: "Invalid subscription id has been provided." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Opens the event stream (SSE) of a sitemap subscription for one page.
   *
   * @param subscriptionID: The ID of the subscription (see subscribeToSitemapEvents()).
   * @param sitemapName: The name of the sitemap.
   * @param pageID: The ID of the page (the sitemap name for the home page).
   *
   * @returns A SSE stream (fetch Response, read it with iterSSEEvents()) or {"error": ...}.
   */
  getSitemapEvents(subscriptionID, sitemapName = null, pageID = null) {
    return this._openEventStream(`/rest/sitemaps/events/${subscriptionID}`, { sitemap: sitemapName, pageid: pageID }, { [400]: "Missing sitemap or page parameter, or page not linked successfully to the subscription.", [404]: "Subscription not found." });
  }

  /**
   * Opens the event stream (SSE) of a sitemap subscription for the whole sitemap.
   * Not recommended due to potentially high traffic.
   *
   * @param subscriptionID: The ID of the subscription.
   * @param sitemapName: The name of the sitemap.
   *
   * @returns A SSE stream (fetch Response) or {"error": ...}.
   */
  getFullSitemapEvents(subscriptionID, sitemapName = null) {
    return this._openEventStream(`/rest/sitemaps/events/${subscriptionID}/*`, { sitemap: sitemapName }, { [400]: "Missing sitemap parameter, or sitemap not linked successfully to the subscription.", [404]: "Subscription not found." });
  }

  /**
   * Creates a sitemap event subscription.
   *
   * @returns The response to the subscription request (JSON).
   */
  async subscribeToSitemapEvents() {
    let headers, location, response, status_code, value;
    try {
      response = await this.client.post("/sitemaps/events/subscribe", {}, null, null);
      location = null;
      if (_isPlainObject(response)) {
        location = (response["location"] ?? null);
        if (!(location)) {
          headers = ((((response["context"] ?? null) || {})["headers"] ?? null) || {});
          value = (headers["Location"] ?? null);
          location = ((Array.isArray(value) && value) ? value[0] : value);
        }
      }
      if (location) {
        return { message: "Subscription created.", location, subscriptionID: location.replace(/\/+$/, "").split("/").at(-1) };
      }
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 503) {
        return { error: "Subscriptions limit reached." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 201) {
      return { message: "Subscription created." };
    } else if (status_code === 503) {
      return { error: "Subscriptions limit reached." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }
}

class AsyncSitemaps extends Sitemaps {}

// =============================================================================
// Systeminfo  (generated from Systeminfo.py)
// =============================================================================

class Systeminfo {
  constructor(client) {
    this.client = client;
  }

  /**
   * Gets information about the system.
   *
   * @returns A object with system informations.
   */
  async getSystemInfo() {
    let response, status_code;
    try {
      response = await this.client.get("/systeminfo", { Accept: "application/json" }, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Get all supported dimensions and their system units.
   *
   * @returns A object with UOM informations.
   */
  async getUoMInfo() {
    let response, status_code;
    try {
      response = await this.client.get("/systeminfo/uom", { Accept: "application/json" }, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }
}

class AsyncSysteminfo extends Systeminfo {}

// =============================================================================
// Tags  (generated from Tags.py)
// =============================================================================

class Tags {
  constructor(client) {
    this.client = client;
  }

  /**
   * Get all available semantic tags.
   *
   * @param language: Optional headers for language setting.
   *
   * @returns A list of semantic tags (JSON).
   */
  async getTags(language = null) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.get("/tags", headers, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Creates a new semantic tag and adds it to the registry.
   *
   * @param tagData: The data object for the tag to be created.
   * @param language: Optional headers for language setting.
   *
   * @returns The response to the tag creation request (JSON).
   */
  async createTag(tagData, language = null) {
    let headers = { "Content-Type": "application/json", Accept: "*/*" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.post("/tags", headers, JSON.stringify(tagData), null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 400) {
        return { error: "The tag identifier is invalid or the tag label is missing." };
      } else if (status_code === 409) {
        return { error: "A tag with the same identifier already exists." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 201) {
      return { message: "Created" };
    } else if (status_code === 400) {
      return { error: "The tag identifier is invalid or the tag label is missing." };
    } else if (status_code === 409) {
      return { error: "A tag with the same identifier already exists." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Gets a semantic tag and its sub-tags.
   *
   * @param tagID: The ID of the tag to retrieve.
   * @param language: Optional headers for language setting.
   *
   * @returns The tag object and its sub-tags (JSON).
   */
  async getTag(tagID, language = null) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.get(`/tags/${tagID}`, headers, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Semantic tag not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Semantic tag not found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Updates a semantic tag.
   *
   * @param tagID: The ID of the tag to be updated.
   * @param tagData: The new tag data.
   * @param language: Optional headers for language setting.
   *
   * @returns The response to the tag update request (JSON).
   */
  async updateTag(tagID, tagData, language = null) {
    let headers = { "Content-Type": "application/json", Accept: "*/*" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.put(`/tags/${tagID}`, headers, JSON.stringify(tagData), null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 405) {
        return { error: "Semantic tag not editable." };
      } else if (status_code === 404) {
        return { error: "Semantic tag not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Semantic tag not found." };
    } else if (status_code === 405) {
      return { error: "Semantic tag not editable." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Removes a semantic tag and its sub-tags from the registry.
   *
   * @param tagID: The ID of the tag to be removed.
   * @param language: Optional headers for language setting.
   *
   * @returns The response to the tag deletion request (JSON).
   */
  async deleteTag(tagID, language = null) {
    let response, status_code;
    try {
      response = await this.client.delete(`/tags/${tagID}`, (language ? { "Accept-Language": language } : {}), null, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 405) {
        return { error: "Semantic tag not removable." };
      } else if (status_code === 404) {
        return { error: "Semantic tag not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK, was deleted." };
    } else if (status_code === 404) {
      return { error: "Semantic tag not found." };
    } else if (status_code === 405) {
      return { error: "Semantic tag not removable." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }
}

class AsyncTags extends Tags {}

// =============================================================================
// Templates  (generated from Templates.py)
// =============================================================================

class Templates {
  constructor(client) {
    this.client = client;
  }

  /**
   * Get all available templates.
   *
   * @param language: (Optional) Language setting for the Accept-Language header.
   * @returns A list of templates.
   */
  async getTemplates(language = null) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.get("/templates", headers, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Gets a template corresponding to the given UID.
   *
   * @param templateUID: The UID of the template.
   * @param language: (Optional) Language setting for the Accept-Language header.
   *
   * @returns A object with the details of the template.
   */
  async getTemplate(templateUID, language = null) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.get(`/templates/${templateUID}`, headers, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Template corresponding to the given UID was not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Template corresponding to the given UID was not found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }
}

class AsyncTemplates extends Templates {}

// =============================================================================
// ThingTypes  (generated from ThingTypes.py)
// =============================================================================

class ThingTypes {
  constructor(client) {
    this.client = client;
  }

  /**
   * Gets all available thing types without config description, channels, and properties.
   *
   * @param bindingID: (Optional) Filter by binding ID.
   * @param language: (Optional) Language setting for the Accept-Language header.
   *
   * @returns A list of thing types.
   */
  async getThingTypes(bindingID = null, language = null) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.get("/thing-types", headers, (bindingID ? { bindingId: bindingID } : {}));
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Gets a thing type by UID.
   *
   * @param thingTypeUID: The UID of the thing type.
   * @param language: (Optional) Language setting for the Accept-Language header.
   *
   * @returns A object with the details of the thing type or an empty response with status 204.
   */
  async getThingType(thingTypeUID, language = null) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.get(`/thing-types/${thingTypeUID}`, headers, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "No Content." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "No Content." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }
}

class AsyncThingTypes extends ThingTypes {}

// =============================================================================
// Things  (generated from Things.py)
// =============================================================================

class Things {
  constructor(client) {
    this.client = client;
  }

  /**
   * Get all available things.
   *
   * @param summary: If true, returns only the summary fields.
   * @param staticDataOnly: If true, returns a cacheable list.
   * @param language: The preferred language for the response.
   *
   * @returns JSON response with the things.
   */
  async getThings(summary = false, staticDataOnly = false, language = null) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.get("/things", headers, { summary, staticDataOnly });
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Creates a new thing and adds it to the registry.
   *
   * @param thingData: The JSON object containing the thing data.
   * @param language: The preferred language for the response.
   *
   * @returns The API response.
   */
  async createThing(thingData, language = null) {
    let headers = { "Content-Type": "application/json", Accept: "*/*" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.post("/things", headers, JSON.stringify(thingData), null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 409) {
        return { error: "A thing with the same uid already exists." };
      } else if (status_code === 400) {
        return { error: "A uid must be provided, if no binding can create a thing of this type." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 400) {
      return { error: "A uid must be provided, if no binding can create a thing of this type." };
    } else if (status_code === 409) {
      return { error: "A thing with the same uid already exists." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Gets a thing by UID.
   *
   * @param thingUID: The UID of the thing.
   * @param language: The preferred language for the response.
   *
   * @returns JSON response with the thing data.
   */
  async getThing(thingUID, language = null) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.get(`/things/${thingUID}`, headers, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Thing not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "THing not found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Updates a thing.
   *
   * @param thingUID: The UID of the thing.
   * @param thingData: The JSON object containing the updated thing data.
   * @param language: The preferred language for the response.
   *
   * @returns The API response.
   */
  async updateThing(thingUID, thingData, language = null) {
    let headers = { "Content-Type": "application/json", Accept: "*/*" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.put(`/things/${thingUID}`, headers, JSON.stringify(thingData), null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 409) {
        return { error: "Thing could not be updated as it is not editable." };
      } else if (status_code === 404) {
        return { error: "Thing not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Thing not found." };
    } else if (status_code === 409) {
      return { error: "Thing could not be updated as it is not editable." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Removes a thing from the registry. Set 'force' to __true__ if you want the thing to be removed immediately.
   *
   * @param thingUID: The UID of the thing.
   * @param force: If true, the thing will be immediately removed.
   * @param language: The preferred language for the response.
   *
   * @returns The API response.
   */
  async deleteThing(thingUID, force = false, language = null) {
    let response, status_code;
    try {
      response = await this.client.delete(`/things/${thingUID}`, (language ? { "Accept-Language": language } : {}), null, { force });
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 409) {
        return { error: "Thing could not be deleted because it's not editable." };
      } else if (status_code === 404) {
        return { error: "Thing not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK, was deleted." };
    } else if (status_code === 202) {
      return { message: "ACCEPTED for asynchronous deletion." };
    } else if (status_code === 404) {
      return { error: "Thing not found." };
    } else if (status_code === 409) {
      return { error: "Thing could not be deleted because it's not editable." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Updates a thing's configuration.
   *
   * @param thingUID: The UID of the thing.
   * @param configurationData: The configuration data of the thing.
   * @param language: The preferred language for the response.
   *
   * @returns The API response.
   */
  async updateThingConfiguration(thingUID, configurationData, language = null) {
    let headers = { "Content-Type": "application/json", Accept: "*/*" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.put(`/things/${thingUID}/config`, headers, JSON.stringify(configurationData), null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 400) {
        return { error: "Configuration of the thing is not valid." };
      } else if (status_code === 404) {
        return { error: "Thing not found." };
      } else if (status_code === 409) {
        return { error: "Thing could not be updated as it is not editable." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 400) {
      return { error: "Configuration of the thing is not valid." };
    } else if (status_code === 404) {
      return { error: "Thing not found." };
    } else if (status_code === 409) {
      return { error: "Thing could not be updated as it is not editable." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Gets the thing's configuration status.
   *
   * @param thingUID: The UID of the thing.
   * @param language: The preferred language for the response.
   *
   * @returns JSON response with the thing's configuration status.
   */
  async getThingConfigStatus(thingUID, language = null) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.get(`/things/${thingUID}/config/status`, headers, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Thing not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Thing not found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Sets the thing's enabled status.
   *
   * @param thingUID: The UID of the thing.
   * @param enabled: If true, the thing will be enabled.
   * @param language: The preferred language for the response.
   *
   * @returns The API response.
   */
  async setThingStatus(thingUID, enabled, language = null) {
    let headers = { "Content-Type": "text/plain", Accept: "*/*" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.put(`/things/${thingUID}/enable`, headers, (enabled ? "true" : "false"), null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Thing not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Thing not found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  enableThing(thingUID) {
    return this.setThingStatus(thingUID, true);
  }

  disableThing(thingUID) {
    return this.setThingStatus(thingUID, false);
  }

  /**
   * Updates the firmware of a thing.
   *
   * @param thingUID: The UID of the thing.
   * @param firmwareVersion: The firmware version.
   * @param language: The preferred language for the response.
   *
   * @returns The API response.
   */
  async updateThingFirmware(thingUID, firmwareVersion, language = null) {
    let response, status_code;
    try {
      response = await this.client.put(`/things/${thingUID}/firmware/${firmwareVersion}`, (language ? { "Accept-Language": language } : {}), null, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 400) {
        return { error: "Firmware update preconditions not satisfied." };
      } else if (status_code === 404) {
        return { error: "Thing not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Thing not found." };
    } else if (status_code === 400) {
      return { error: "Firmware update preconditions not satisfied." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Gets the thing's firmware status.
   *
   * @param thingUID: The UID of the thing.
   * @param language: The preferred language for the response.
   *
   * @returns JSON response with the firmware status.
   */
  async getThingFirmwareStatus(thingUID, language = null) {
    let headers = { Accept: "*/*" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.get(`/things/${thingUID}/firmware/status`, headers, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 204) {
      return { error: "No firmware status provided by this Thing." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Gets all available firmwares for the provided thing UID.
   *
   * @param thingUID: The UID of the thing.
   * @param language: The preferred language for the response.
   *
   * @returns A list of available firmwares.
   */
  async getThingFirmwares(thingUID, language = null) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.get(`/things/${thingUID}/firmwares`, headers, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 204) {
      return { error: "No firmwares found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Gets the thing's status.
   *
   * @param thingUID: The UID of the thing.
   * @param language: The preferred language for the response.
   *
   * @returns JSON response with the thing's status.
   */
  async getThingStatus(thingUID, language = null) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.get(`/things/${thingUID}/status`, headers, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Thing not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Thing not found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }
}

class AsyncThings extends Things {}

// =============================================================================
// Transformations  (generated from Transformations.py)
// =============================================================================

class Transformations {
  constructor(client) {
    this.client = client;
  }

  /**
   * Get a list of all transformations.
   *
   * @returns A list of transformations (JSON).
   */
  async getTransformations() {
    let response, status_code;
    try {
      response = await this.client.get("/transformations", { Accept: "application/json" }, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Get a single transformation.
   *
   * @param transformationUID: The transformationUID of the transformation to retrieve.
   *
   * @returns The transformation (JSON).
   */
  async getTransformation(transformationUID) {
    let response, status_code;
    try {
      response = await this.client.get(`/transformations/${transformationUID}`, { Accept: "application/json" }, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Not found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Update a single transformation.
   *
   * @param transformationUID: The transformationUID of the transformation to update.
   * @param transformationData: The new data for the transformation.
   *
   * @returns The response to the transformation update request (JSON).
   */
  async updateTransformation(transformationUID, transformationData) {
    let response, status_code;
    try {
      response = await this.client.put(`/transformations/${transformationUID}`, { "Content-Type": "application/json" }, JSON.stringify(transformationData), null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 400) {
        return { error: "Bad Request (content missing or invalid)" };
      } else if (status_code === 405) {
        return { error: "Transformation not editable." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 400) {
      return { error: "Bad Request (content missing or invalid)" };
    } else if (status_code === 405) {
      return { error: "Transformation not editable." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Delete a single transformation.
   *
   * @param transformationUID: The transformationUID of the transformation to delete.
   *
   * @returns The response to the transformation update request (JSON) or status/error message.
   */
  async deleteTransformation(transformationUID) {
    let response, status_code;
    try {
      response = await this.client.delete(`/transformations/${transformationUID}`, {}, null, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 405) {
        return { error: "Transformation not editable." };
      } else if (status_code === 404) {
        return { error: "UID not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "UID not found." };
    } else if (status_code === 405) {
      return { error: "Transformation not editable." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Get all transformation services.
   *
   * @returns A list of transformation services (JSON).
   */
  async getTransformationServices() {
    let response, status_code;
    try {
      response = await this.client.get("/transformations/services", { Accept: "application/json" }, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }
}

class AsyncTransformations extends Transformations {}

// =============================================================================
// UI  (generated from UI.py)
// =============================================================================

class UI {
  constructor(client) {
    this.client = client;
  }

  /**
   * Get all registered UI components in the specified namespace.
   *
   * @param namespace: The namespace for which UI components should be retrieved.
   * @param summary: If true, only summary fields will be returned.
   *
   * @returns A list of UI components (JSON).
   */
  async getUIComponents(namespace, summary = false) {
    let response, status_code;
    try {
      response = await this.client.get(`/ui/components/${namespace}`, { Accept: "application/json" }, (summary ? { summary } : {}));
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Add a UI component in the specified namespace.
   *
   * @param namespace: The namespace where the UI component should be added.
   * @param componentData: The data of the UI component (JSON) to be added.
   *
   * @returns The response to the request (JSON).
   */
  async addUIComponent(namespace, componentData) {
    let response, status_code;
    try {
      response = await this.client.post(`/ui/components/${namespace}`, { "Content-Type": "application/json", Accept: "application/json" }, JSON.stringify(componentData), null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Get a specific UI component in the specified namespace.
   *
   * @param namespace: The namespace where the UI component is located.
   * @param componentUID: The UID of the UI component to retrieve.
   *
   * @returns The UI component (JSON).
   */
  async getUIComponent(namespace, componentUID) {
    let response, status_code;
    try {
      response = await this.client.get(`/ui/components/${namespace}/${componentUID}`, { Accept: "application/json" }, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Component not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Component not found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Update a specific UI component in the specified namespace.
   *
   * @param namespace: The namespace where the UI component should be updated.
   * @param componentUID: The UID of the UI component to update.
   * @param componentData: The new data for the UI component (JSON).
   *
   * @returns The response to the request (JSON).
   */
  async updateUIComponent(namespace, componentUID, componentData) {
    let response, status_code;
    try {
      response = await this.client.put(`/ui/components/${namespace}/${componentUID}`, { "Content-Type": "application/json", Accept: "application/json" }, JSON.stringify(componentData), null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Component not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Component not found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Remove a specific UI component in the specified namespace.
   *
   * @param namespace: The namespace where the UI component should be removed.
   * @param componentUID: The UID of the UI component to delete.
   *
   * @returns The response to the request (JSON).
   */
  async deleteUIComponent(namespace, componentUID) {
    let response, status_code;
    try {
      response = await this.client.delete(`/ui/components/${namespace}/${componentUID}`, {}, null, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Component not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Component not found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Get all registered UI tiles.
   *
   * @returns A list of UI tiles (JSON).
   */
  async getUITiles() {
    let response, status_code;
    try {
      response = await this.client.get("/ui/tiles", { Accept: "application/json" }, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }
}

class AsyncUI extends UI {}

// =============================================================================
// UUID  (generated from UUID.py)
// =============================================================================

class UUID {
  constructor(client) {
    this.client = client;
  }

  /**
   * A unified unique id.
   *
   * @returns The UUID as String.
   */
  async getUUID() {
    let response, status_code;
    try {
      response = await this.client.get("/uuid", { Accept: "text/plain" }, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response.trim();
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }
}

class AsyncUUID extends UUID {}

// =============================================================================
// Voice  (generated from Voice.py)
// =============================================================================

class Voice {
  constructor(client) {
    this.client = client;
  }

  /**
   * Gets the default voice.
   *
   * @returns A object with the details of the default voice.
   */
  async getDefaultVoice(language = null) {
    let response, status_code;
    try {
      response = await this.client.get("/voice/defaultvoice", { Accept: "application/json", "Accept-Language": language }, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "No default voice was found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "No default voice was found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Start dialog processing for a given audio source.
   *
   * @param sourceID: The ID of the audio source.
   * @param ksID: The ID of the keyword spotter (optional).
   * @param sttID: The ID of the speech-to-text system (optional).
   * @param ttsID: The ID of the text-to-speech system (optional).
   * @param voiceID: The ID of the voice (optional).
   * @param hliIDs: A comma-separated list of interpreter IDs (optional).
   * @param sinkID: The ID of the audio output (optional).
   * @param keyword: The keyword used to start the dialog (optional).
   * @param listeningItem: The name of the item to listen to (optional).
   * @param language: The language for the request (optional).
   *
   * @returns The response from the server.
   */
  async startDialog(sourceID, { ksID = null, sttID = null, ttsID = null, voiceID = null, hliIDs = null, sinkID = null, keyword = null, listeningItem = null, language = null } = {}) {
    let response, status_code;
    try {
      response = await this.client.post("/voice/dialog/start", (language ? { "Accept-Language": language } : {}), null, { sourceId: sourceID, ksId: ksID, sttId: sttID, ttsId: ttsID, voiceId: voiceID, hliIds: hliIDs, sinkId: sinkID, keyword, listeningItem });
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 400) {
        return { error: "Services are missing or language is not supported by services or dialog processing is already started for the audio source." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 400) {
      return { error: "Services are missing or language is not supported by services or dialog processing is already started for the audio source." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Stop dialog processing for a given audio source.
   *
   * @param sourceID: The ID of the audio source.
   * @returns The response from the server.
   */
  async stopDialog(sourceID) {
    let response, status_code;
    try {
      response = await this.client.post("/voice/dialog/stop", {}, null, { sourceId: sourceID });
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 405) {
        return { error: "No dialog processing is started for the audio source." };
      } else if (status_code === 404) {
        return { error: "No audio source was found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "No audio source was found." };
    } else if (status_code === 400) {
      return { error: "No dialog processing is started for the audio source." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Get the list of all interpreters.
   *
   * @param language: The language for the request (optional).
   *
   * @returns A list of interpreters if successful.
   */
  async getInterpreters(language = null) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.get("/voice/interpreters", headers, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Sends a text to the default human language interpreter.
   *
   * @param text: The text to be interpreted.
   * @param language: The language of the text.
   * @param IDs: A list of interpreter IDs (optional).
   *
   * @returns The response from the server.
   */
  async interpretText(text, language = null) {
    let headers = { "Content-Type": "text/plain", Accept: "text/plain" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.post("/voice/interpreters", headers, text, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 400) {
        return { error: `Interpretation exception occurs: ${err.message}` };
      } else if (status_code === 404) {
        return { error: "No human language interpreter was found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "No human language interpreter was found." };
    } else if (status_code === 400) {
      return { error: "Interpretation exception occurs." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Gets a single interpreter.
   *
   * @param interpreterID: The ID of the interpreter.
   * @param language: The language for the request (optional).
   *
   * @returns The details of the interpreter.
   */
  async getInterpreter(interpreterID, language = null) {
    let headers = { Accept: "application/json" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.get(`/voice/interpreters/${interpreterID}`, headers, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 404) {
        return { error: "Interpreter not found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "Interpreter not found." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Sends a text to a given human language interpreter(s).
   *
   * @param text: The text to be interpreted.
   * @param language: The language of the text.
   * @param IDs: A list of interpreter IDs.
   *
   * @returns The response from the server.
   */
  async interpretTextBatch(text, IDs, language = null) {
    let headers = { "Content-Type": "text/plain", Accept: "text/plain" };
    if (language) {
      headers["Accept-Language"] = language;
    }
    let response, status_code;
    try {
      response = await this.client.post(`/voice/interpreters/${IDs.join(",")}`, headers, text, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 400) {
        return { error: `Interpretation exception occurs: ${err.message}` };
      } else if (status_code === 404) {
        return { error: "No human language interpreter was found." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "No human language interpreter was found." };
    } else if (status_code === 400) {
      return { error: "Interpretation exception occurs." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Executes a simple dialog sequence without keyword spotting for a given audio source.
   *
   * @param sourceID: The ID of the audio source.
   * @param sttID: The ID of the speech-to-text system.
   * @param ttsID: The ID of the text-to-speech system.
   * @param voiceID: The ID of the voice.
   * @param hliIDs: A list of interpreter IDs (optional).
   * @param sinkID: The ID of the audio output (optional).
   * @param listeningItem: The name of the item to listen to (optional).
   * @param language: The language for the request (optional).
   *
   * @returns The response from the server.
   */
  async listenAndAnswer(sourceID, sttID, ttsID, voiceID, { hliIDs = null, sinkID = null, listeningItem = null, language = null } = {}) {
    let response, status_code;
    try {
      response = await this.client.post("/voice/listenandanswer", (language ? { "Accept-Language": language } : {}), null, { sourceId: sourceID, sttId: sttID, ttsId: ttsID, voiceId: voiceID, hliIds: (hliIDs ? hliIDs.join(",") : null), sinkId: sinkID, listeningItem });
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code === 400) {
        return { error: "Services are missing or language is not supported by services or dialog processing is already started for the audio source." };
      } else if (status_code === 404) {
        return { error: "One of the given ids is wrong." };
      } else {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    } else if (status_code === 404) {
      return { error: "One of the given ids is wrong." };
    } else if (status_code === 400) {
      return { error: "Services are missing or language is not supported by services or dialog processing is already started for the audio source." };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Speaks a given text with a given voice through the given audio sink.
   *
   * @param text: The text to be spoken.
   * @param voiceID: The ID of the voice.
   * @param sinkID: The ID of the audio output.
   * @param volume: The volume level (default: 100).
   *
   * @returns The response from the server.
   */
  async sayText(text, voiceID, sinkID, volume = "100") {
    let response, status_code;
    try {
      response = await this.client.post("/voice/say", { "Content-Type": "text/plain" }, text, { voiceid: voiceID, sinkid: sinkID, volume });
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }

  /**
   * Get the list of all voices.
   *
   * @returns A list of voices if successful.
   */
  async getVoices(language = null) {
    let response, status_code;
    try {
      response = await this.client.get("/voice/voices", { Accept: "application/json", "Accept-Language": language }, null);
      if (response instanceof StatusResponse) {
        status_code = response["status"];
      } else {
        return response;
      }
    } catch (err) {
      if (!(err instanceof OpenHABHTTPError)) {
        return { error: `Request error: ${err.message}` };
      }
      status_code = err.status;
      if (status_code !== 200) {
        return { error: `HTTP error ${status_code}: ${err.message}` };
      }
    }
    if (status_code === 200) {
      return { message: "OK" };
    }
    return { error: `Unexpected response: ${status_code}` };
  }
}

class AsyncVoice extends Voice {}


// ═══════════════════════════════════════════════════════════════════════════════
// Export
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
  Actions,
  AsyncActions,
  Addons,
  AsyncAddons,
  Audio,
  AsyncAudio,
  Auth,
  AsyncAuth,
  ChannelTypes,
  AsyncChannelTypes,
  ConfigDescriptions,
  AsyncConfigDescriptions,
  Discovery,
  AsyncDiscovery,
  Events,
  AsyncEvents,
  ItemEvents,
  AsyncItemEvents,
  ThingEvents,
  AsyncThingEvents,
  InboxEvents,
  AsyncInboxEvents,
  LinkEvents,
  AsyncLinkEvents,
  ChannelEvents,
  AsyncChannelEvents,
  Iconsets,
  AsyncIconsets,
  Inbox,
  AsyncInbox,
  Items,
  AsyncItems,
  Links,
  AsyncLinks,
  Logging,
  AsyncLogging,
  ModuleTypes,
  AsyncModuleTypes,
  Persistence,
  AsyncPersistence,
  ProfileTypes,
  AsyncProfileTypes,
  Rules,
  AsyncRules,
  Services,
  AsyncServices,
  Sitemaps,
  AsyncSitemaps,
  Systeminfo,
  AsyncSysteminfo,
  Tags,
  AsyncTags,
  Templates,
  AsyncTemplates,
  ThingTypes,
  AsyncThingTypes,
  Things,
  AsyncThings,
  Transformations,
  AsyncTransformations,
  UI,
  AsyncUI,
  UUID,
  AsyncUUID,
  Voice,
  AsyncVoice,
  OpenHABClient,
  AsyncOpenHABClient,
  StatusResponse,
  OpenHABHTTPError,
  iterSSELines,
  iterSSEEvents,
  parseSSEData,
  aiterSSELines,
  aiterSSEEvents,
};
