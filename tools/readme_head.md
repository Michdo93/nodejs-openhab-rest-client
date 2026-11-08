# nodejs-openhab-rest-client

A Node.js client for the openHAB REST API (openHAB 4 and 5) – for scripts, services, CLI tools and servers. No dependencies, ES module and CommonJS, TypeScript declarations included. For the browser there is a separate library, [js-openhab-rest-client](https://github.com/Michdo93/js-openhab-rest-client).

It mirrors [python-openhab-rest-client](https://github.com/Michdo93/python-openhab-rest-client): **same classes, same methods, same parameters, same return values.** The REST classes are generated from the Python library (`tools/py2js.py`), so the Python, browser and Node.js libraries always behave the same – a script can be ported line by line.

## Features

- All endpoints of the openHAB REST API: Actions, Addons, Audio, Auth, ChannelTypes, ConfigDescriptions, Discovery, Events (ItemEvents, ThingEvents, InboxEvents, LinkEvents, ChannelEvents), Iconsets, Inbox, Items, Links, Logging, ModuleTypes, Persistence, ProfileTypes, Rules, Services, Sitemaps, Systeminfo, Tags, Templates, ThingTypes, Things, Transformations, UI, UUID, Voice
- Server-Sent Events with `for await … of iterSSEEvents(stream)` – payloads already decoded
- Token and Basic authentication (also with umlauts in the password), myopenHAB
- Errors as `{ error: "…" }` objects with openHAB's own explanation, exactly like the Python library
- Timeouts, `#` in channel/action UIDs, form bodies, `source` for commands and updates

## Requirements

Node.js 18 or newer (native `fetch` and `ReadableStream`). No npm dependencies.

## Installation

From GitHub:

```sh
npm install github:Michdo93/nodejs-openhab-rest-client
```

or, once published, from npm:

```sh
npm install nodejs-openhab-rest-client
```

## Usage

```js
import { OpenHABClient, Items, Rules } from "nodejs-openhab-rest-client";
// CommonJS: const { OpenHABClient, Items, Rules } = require("nodejs-openhab-rest-client");

// Token (recommended) …
const client = new OpenHABClient("http://openhab:8080", null, null, process.env.OPENHAB_TOKEN);
// … or Basic authentication:  new OpenHABClient(url, "user", "password")
// optional 5th parameter: timeout in seconds (default 10)

await client.ready;                      // connection check, like the Python constructor
console.log(client.isLoggedIn);

const items = new Items(client);
await items.sendCommand("Wohnzimmer_Licht", "ON", "my-service");     // source is optional
await items.postUpdate("Werkstatt_Temperatur", "21.5 °C");
console.log(await items.getItemState("Wohnzimmer_Licht"));           // "ON"

const item = await items.getItem("Wohnzimmer_Temperatur", { parents: true });
const lights = await items.getItems({ tags: "Light", fields: "name,state" });

await new Rules(client).runNow("my-rule");
```

Methods that have many optional parameters (`Items.getItems`, `Items.getItem`, `Persistence.getItemPersistenceData`, `Voice.startDialog`, `Voice.listenAndAnswer`, `Auth.getToken`) take them as one object – that is the JavaScript counterpart to Python's keyword arguments. All other methods take positional parameters in the same order as in Python.

Keep the token out of the source code – read it from an environment variable or a file that is not checked in.

### Return values and errors

| openHAB answers | Python | JavaScript |
|---|---|---|
| JSON | `dict` / `list` | object / array |
| Text (e.g. an item state) | `str` | string |
| Empty body (200, 201, 202) | `{"message": "OK"}` etc. | `{ message: "OK" }` etc. |
| Error (4xx/5xx, network) | `{"error": "Item not found."}` | `{ error: "Item not found." }` |

The REST classes never throw for HTTP or network errors – check for `error`:

```js
const result = await items.sendCommand("Wohnzimmer_Dimmer", "BLAU");
if (result.error) console.error(result.error);    // "Invalid command for this item."
```

The low-level methods `client.get/post/put/delete/executeSSE` throw an `OpenHABHTTPError` (with `status`, `url` and `openhabMessage`) so that you can handle every status code yourself.

### Server-Sent Events

Every event method resolves to a stream (a fetch `Response`) or to `{ error }`. `iterSSEEvents` turns it into events with an already decoded payload; leaving the loop closes the stream.

```js
const stream = await new ItemEvents(client).ItemStateChangedEvent("Wohnzimmer_Licht");
for await (const event of iterSSEEvents(stream)) {
  console.log(event.topic, event.payload.value, "was", event.payload.oldValue);
}

// several topics at once
const all = await new Events(client).getEvents(
  "openhab/items/*/statechanged,openhab/things/*/statuschanged");

// stop a stream from outside (e.g. on SIGINT)
stream.abort();
```

`iterSSEEvents(stream, true)` also yields ALIVE messages and events without a topic (sitemap events). For the state tracker read lines with `iterSSELines` – its first `data:` line is the connection id:

```js
const events = new Events(client);
const tracker = await events.initiateStateTracker();
let id = null;
for await (const line of iterSSELines(tracker)) {
  if (!line.startsWith("data:")) continue;
  if (!id) { id = line.slice(5).trim(); await events.updateSSEConnectionItems(id, ["Wohnzimmer_Licht"]); continue; }
  console.log(JSON.parse(line.slice(5)));   // { Wohnzimmer_Licht: { state, displayState, type } }
}
```

### Async variants

`AsyncOpenHABClient`, `AsyncItems`, `AsyncThings`, … are aliases of the normal classes – in JavaScript every method already returns a Promise. They exist so that code from the Python library's async variant can be ported unchanged.

## JavaScript vs. Python

| Topic | Python | JavaScript |
|---|---|---|
| Call | `items.getItems()` | `await items.getItems()` |
| Keyword arguments | `getItem("X", parents=True)` | `getItem("X", { parents: true })` |
| Event stream | `for e in iterSSEEvents(stream):` | `for await (const e of iterSSEEvents(stream))` |
| Close stream | `stream.close()` | `stream.abort()` or `break` |
| Connection check | in the constructor | `await client.ready` |
| TLS with self-signed certificate | `verify="ca.pem"` | trust the certificate in the browser / operating system |
| Install | `pip install python-openhab-rest-client` | `<script src="…/openhab.min.js">` |

## CORS

A page that is not served by openHAB itself (e.g. `file://` or another host) needs CORS to be enabled in openHAB: *Settings → API Security → Enable CORS* (or `org.openhab.cors:enable=true`). Pages in `$OPENHAB_CONF/html` are served by openHAB under `/static/` and need no CORS.

## Test page

`index.html` is an interactive test page for all classes: open it in the browser, enter URL and token (or user and password) and run the methods one by one or section by section.

## Upgrading from 1.x

Version 2 behaves like the Python library. Code written for 1.x needs these changes:

- Methods no longer throw for HTTP errors – they return `{ error: "…" }`. Replace `try/catch` around REST calls by a check of `result.error`.
- Empty answers are `{ message: "OK" }` (or `"Accepted."`, `"Subscription created."`, …) instead of `{ status: 200 }`.
- Create calls (`createRule`, `createThing`, `addUIComponent`, …) return a result object instead of a raw `Response`.
- Event methods return the stream or `{ error }`; read it with `iterSSEEvents` instead of a hand-written reader.
- `getItemPersistenceData` no longer pages by default (1.x always sent `page=1&pagelength=50` and therefore skipped the first 50 values).

## Development

The REST classes are generated from python-openhab-rest-client. Fix behaviour in the Python library and regenerate – only Python is needed:

```bash
pip install python-openhab-rest-client rjsmin   # or pass the path of a checkout
bash tools/build.sh [path/to/python-openhab-rest-client/openhab]
```

`tools/core_head.js` (client, errors, SSE helpers) is written by hand, `tools/py2js.py` translates the classes and the reference below. The translator refuses Python constructs it does not know, so nothing is translated silently wrong.

---

## Reference

### OpenHABClient

```js
const client = new OpenHABClient(url, username = null, password = null, token = null, timeout = 10);
```

| Member | Description |
|---|---|
| `ready` | Promise that resolves to the client after the connection check (never rejects) |
| `login()` | Repeats the connection check; sets `isLoggedIn` and `isCloud` |
| `get(endpoint, headers, params)` | GET; resolves to JSON, text or a `StatusResponse` (`{ status, location }`); throws `OpenHABHTTPError` |
| `post/put/delete(endpoint, headers, data, params)` | Same for the other methods. A string body without `Content-Type` is sent as JSON or text/plain, an object as JSON (or as form with `application/x-www-form-urlencoded`) |
| `executeSSE(url, headers, params)` | Opens an event stream (fetch `Response` with an extra `abort()`) |
| `close()` | No-op, for symmetry with Python |

Endpoints may be given with or without `/rest` (`"/items"`, `"items"`, `"/rest/items"`).

### SSE helpers

| Function | Description |
|---|---|
| `iterSSEEvents(stream, includeAlive = false)` | Async generator: events as objects, payload decoded |
| `iterSSELines(stream)` | Async generator: raw lines, each as soon as it is complete |
| `parseSSEData(line)` | Decodes one `data:` line or returns `null` |
| `aiterSSEEvents`, `aiterSSELines` | Aliases (names of the Python async variants) |

