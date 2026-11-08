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

