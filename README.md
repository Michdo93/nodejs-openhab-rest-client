# nodejs-openhab-rest-client

A Node.js client for the openHAB REST API. This library enables easy interaction with the openHAB REST API to control smart home devices, retrieve status information, and process events — from Node.js scripts, servers, and CLI tools.

It mirrors the [python-openhab-rest-client](https://github.com/Michdo93/python-openhab-rest-client) and [js-openhab-rest-client](https://github.com/Michdo93/js-openhab-rest-client) libraries: same class names, same method names, same usage pattern.

## Features

Supports the following openHAB REST API endpoints:

- Actions
- Addons
- Audio
- Auth
- ChannelTypes
- ConfigDescriptions
- Discovery
- Events (ItemEvents, ThingEvents, InboxEvents, LinkEvents, ChannelEvents)
- Iconsets
- Inbox
- Items
- Links
- Logging
- ModuleTypes
- Persistence
- ProfileTypes
- Rules
- Services
- Sitemaps
- Systeminfo
- Tags
- Templates
- ThingTypes
- Things
- Transformations
- UI
- UUID
- Voice

All classes are also available as `Async` variants (e.g. `AsyncItems`, `AsyncThings`) using `AsyncOpenHABClient`. In JavaScript both are Promise-based and behave identically — the `Async` prefix is purely for naming consistency with the Python library.

Supports both Server-Sent Events (SSE) and regular REST requests via the native Node.js 18+ `fetch` API. No external dependencies required.

## Requirements

- **Node.js 18.0.0 or higher** (for native `fetch` and `btoa`)
- No external npm dependencies

## Installation

### Via npm (recommended)

```sh
npm install nodejs-openhab-rest-client
```

### Via yarn

```sh
yarn add nodejs-openhab-rest-client
```

### Build from source

Clone the repository and build the distribution files yourself:

```sh
git clone https://github.com/Michdo93/nodejs-openhab-rest-client.git
cd nodejs-openhab-rest-client
node build.js
```

This produces:
- `dist/esm/index.js` — ES Module
- `dist/cjs/index.js` — CommonJS
- `dist/types/index.d.ts` — TypeScript declarations

---

## Import

The package supports both ES Modules and CommonJS.

### ES Module (recommended)

For projects with `"type": "module"` in `package.json` or `.mjs` files:

```js
import {
  OpenHABClient,
  Items,
  Things,
  Rules,
  ItemEvents,
} from "nodejs-openhab-rest-client";
```

### CommonJS

For projects without `"type": "module"` in `package.json` or `.cjs` files:

```js
const {
  OpenHABClient,
  Items,
  Things,
  UUID,
  Systeminfo,
} = require("nodejs-openhab-rest-client");
```

### From a local build (dist path)

If you built from source and want to import directly from the dist folder:

```js
// ESM
import { OpenHABClient, Items } from "./dist/esm/index.js";

// CommonJS
const { OpenHABClient, Items } = require("./dist/cjs/index.js");
```

### TypeScript

The package ships with TypeScript declarations at `dist/types/index.d.ts`. No additional `@types` package is needed:

```ts
import { OpenHABClient, Items } from "nodejs-openhab-rest-client";

const client = new OpenHABClient("http://127.0.0.1:8080", "openhab", "habopen");
const itemsAPI = new Items(client);
const items = await itemsAPI.getItems();
```

---

## Usage

### Authentication

#### Basic Authentication

```js
import { OpenHABClient } from "nodejs-openhab-rest-client";

const client = new OpenHABClient("http://127.0.0.1:8080", "openhab", "habopen");
```

#### Token-based Authentication

```js
const client = new OpenHABClient(
  "http://127.0.0.1:8080",
  null,
  null,
  "oh.openhab.U0doM1Lz4kJ6tPlVGjH17jjm4ZcTHIHi7sMwESzrIybKbCGySmBMtysPnObQLuLf7PgqnI7jWQ5LosySY8Q"
);
```

#### myopenhab.org Cloud

```js
const client = new OpenHABClient("https://myopenhab.org", "your@email.com", "yourpassword");
```

### Verifying Connectivity

Call `login()` to verify the connection before making requests. It sets `client.isLoggedIn` and `client.isCloud`:

```js
await client.login();

if (!client.isLoggedIn) {
  console.error("Connection failed.");
  process.exit(1);
}
console.log("Connected to openHAB");
```

### Normal REST Requests

All methods return `Promise`s. Use `await` in an async context:

```js
import { OpenHABClient, Items } from "nodejs-openhab-rest-client";

const client = new OpenHABClient("http://127.0.0.1:8080", "openhab", "habopen");
await client.login();

const itemsAPI = new Items(client);
const allItems = await itemsAPI.getItems();
console.log(allItems);

await itemsAPI.sendCommand("MyLightSwitch", "ON");
```

### Async Variants

The `Async` prefixed classes (`AsyncItems`, `AsyncThings`, etc.) behave identically to the base classes in JavaScript. They exist for naming consistency with the Python library:

```js
import { AsyncOpenHABClient, AsyncItems } from "nodejs-openhab-rest-client";

const client = new AsyncOpenHABClient("http://127.0.0.1:8080", "openhab", "habopen");
const asyncItems = new AsyncItems(client);

const items = await asyncItems.getItems();
console.log(items);
```

### Server-Sent Events (SSE)

SSE streams are returned as a `Promise<Response>`. Use the native `ReadableStream` API to consume them:

```js
import { OpenHABClient, ItemEvents, Items } from "nodejs-openhab-rest-client";

const client     = new OpenHABClient("http://127.0.0.1:8080", "openhab", "habopen");
const itemEvents = new ItemEvents(client);
const itemsAPI   = new Items(client);

await client.login();

// Open SSE stream
const response = await itemEvents.ItemStateChangedEvent("MyLightSwitch");

if (!response.ok) {
  console.error(`SSE error: HTTP ${response.status}`);
  process.exit(1);
}

const reader  = response.body.getReader();
const decoder = new TextDecoder();
let   buffer  = "";

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop(); // keep incomplete last chunk

  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const raw = line.slice(6).trim();
    if (!raw) continue;

    try {
      const event = JSON.parse(raw);
      console.log("Event:", event.type);
      if (event.payload) {
        const payload = JSON.parse(event.payload);
        console.log("  value:", payload.value);
      }
    } catch {}
  }
}
```

### Running the Tests

The package includes three test files that can be run against a local openHAB instance. Edit the connection settings inside each file first:

```sh
# REST API test (all classes)
node test/test.js

# SSE streaming test (listens 10 seconds, sends commands to trigger events)
node test/test-sse.js

# CommonJS compatibility test
node test/test-cjs.cjs
```

---

## Full List of Methods

---

### OpenHABClient

`OpenHABClient` is the base client class that handles authentication and HTTP communication with the openHAB REST API. All API classes receive an `OpenHABClient` instance in their constructor.

All methods return **Promises**.

#### Constructor

```js
new OpenHABClient(url, username = null, password = null, token = null)
```

**Parameters:**
- `url` (string): The base URL of the openHAB server (e.g. `"http://127.0.0.1:8080"`).
- `username` (string, optional): Username for Basic Authentication.
- `password` (string, optional): Password for Basic Authentication.
- `token` (string, optional): Bearer Token for Token-based Authentication.

**Example:**

```js
const client = new OpenHABClient("http://127.0.0.1:8080", "admin", "password");
```

#### Properties

| Property | Type | Description |
|---|---|---|
| `url` | string | Base URL of the openHAB server |
| `username` | string\|null | Username (Basic Auth) |
| `password` | string\|null | Password (Basic Auth) |
| `token` | string\|null | Bearer token |
| `isCloud` | boolean | `true` when connected to `myopenhab.org` |
| `isLoggedIn` | boolean | `true` after a successful `login()` call |

#### Methods

##### `login()`

Verifies connectivity to the openHAB server. Sets `isLoggedIn` and `isCloud`.

**Returns:** `Promise<this>` — returns itself for chaining.

```js
await client.login();
console.log(client.isLoggedIn); // true
```

##### `get(endpoint, headers = {}, params = null)`

Sends a GET request.

**Parameters:**
- `endpoint` (string): The API endpoint (e.g. `"/items"`).
- `headers` (object, optional): Additional request headers.
- `params` (object|null, optional): Query parameters — `null` values are filtered out automatically.

**Returns:** `Promise<unknown>` — parsed JSON, plain text, or `{ status }` for empty responses.

##### `post(endpoint, headers = {}, data = null, params = null)`

Sends a POST request.

**Parameters:**
- `endpoint` (string): The API endpoint.
- `headers` (object, optional): Additional headers.
- `data` (unknown, optional): Request body (string, object, or null).
- `params` (object|null, optional): Query parameters.

**Returns:** `Promise<unknown>`.

##### `put(endpoint, headers = {}, data = null, params = null)`

Sends a PUT request. Parameters identical to `post`.

**Returns:** `Promise<unknown>`.

##### `delete(endpoint, headers = {}, data = null, params = null)`

Sends a DELETE request. Parameters identical to `post`.

**Returns:** `Promise<unknown>`.

##### `_executeSSE(url, headers = {})`

Opens a Server-Sent Events stream. Used internally by all event classes.

**Parameters:**
- `url` (string): The full SSE URL.
- `headers` (object, optional): Additional headers.

**Returns:** `Promise<Response>` — the raw fetch Response; iterate `response.body` with a `ReadableStream` reader.

---

### AsyncOpenHABClient

`AsyncOpenHABClient` extends `OpenHABClient` with an explicit async name for consistency with the Python library. It is functionally identical.

```js
import { AsyncOpenHABClient, AsyncItems } from "nodejs-openhab-rest-client";

const client = new AsyncOpenHABClient("http://127.0.0.1:8080", "openhab", "habopen");
const asyncItems = new AsyncItems(client);
const items = await asyncItems.getItems();
```

---

### Actions

Provides methods to retrieve and execute thing actions.

#### Constructor

```js
import { OpenHABClient, Actions } from "nodejs-openhab-rest-client";

const client  = new OpenHABClient("http://127.0.0.1:8080", "openhab", "habopen");
const actions = new Actions(client);
```

#### Methods

##### `getActions(thingUID, language = null)`

Gets all available actions for a thing.

**Parameters:**
- `thingUID` (string): The UID of the thing.
- `language` (string, optional): Language for the `Accept-Language` header.

**Returns:** `Promise<unknown>` — list of available actions.

```js
const list = await actions.getActions("zwave:device:controller:node5");
```

##### `executeAction(thingUID, actionUID, actionInputs, language = null)`

Executes a specific action on a thing.

**Parameters:**
- `thingUID` (string): The UID of the thing.
- `actionUID` (string): The UID of the action.
- `actionInputs` (object): Input parameters for the action.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

```js
await actions.executeAction("myThingUID", "myActionUID", { param1: "value1" });
```

Also available as `AsyncActions`.

---

### Addons

Provides methods to manage openHAB add-ons.

#### Constructor

```js
const addons = new Addons(client);
```

#### Methods

##### `getAddons(serviceID = null, language = null)`

Gets all available add-ons.

**Parameters:**
- `serviceID` (string, optional): Filter by service ID.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `getAddon(addonID, serviceID = null, language = null)`

Gets a specific add-on by ID.

**Parameters:**
- `addonID` (string): The unique identifier of the add-on.
- `serviceID` (string, optional): Filter by service ID.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `getAddonConfig(addonID, serviceID = null)`

Gets the configuration of a specific add-on.

**Parameters:**
- `addonID` (string): The add-on identifier.
- `serviceID` (string, optional): Filter by service ID.

**Returns:** `Promise<unknown>`.

##### `updateAddonConfig(addonID, configData, serviceID = null)`

Updates the configuration of a specific add-on.

**Parameters:**
- `addonID` (string): The add-on identifier.
- `configData` (object): New configuration settings.
- `serviceID` (string, optional): Filter by service ID.

**Returns:** `Promise<unknown>`.

##### `installAddon(addonID, serviceID = null)`

Installs an add-on by its ID.

**Parameters:**
- `addonID` (string): The add-on identifier.
- `serviceID` (string, optional): Filter by service ID.

**Returns:** `Promise<unknown>`.

##### `uninstallAddon(addonID, serviceID = null)`

Uninstalls an add-on by its ID.

**Parameters:**
- `addonID` (string): The add-on identifier.
- `serviceID` (string, optional): Filter by service ID.

**Returns:** `Promise<unknown>`.

##### `getAddonServices(language = null)`

Gets all available add-on services.

**Parameters:**
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `getAddonSuggestions(language = null)`

Gets suggested add-ons for installation.

**Parameters:**
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `getAddonTypes(serviceID = null, language = null)`

Gets all available add-on types.

**Parameters:**
- `serviceID` (string, optional): Filter by service ID.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `installAddonFromUrl(url)`

Installs an add-on from a URL.

**Parameters:**
- `url` (string): The URL of the add-on to install.

**Returns:** `Promise<unknown>`.

Also available as `AsyncAddons`.

---

### Audio

Provides methods to interact with the openHAB audio system.

#### Constructor

```js
const audio = new Audio(client);
```

#### Methods

##### `getDefaultSink(language = null)`

Gets the default audio sink.

**Parameters:**
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `getDefaultSource(language = null)`

Gets the default audio source.

**Parameters:**
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `getSinks(language = null)`

Gets all available audio sinks.

**Parameters:**
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `getSources(language = null)`

Gets all available audio sources.

**Parameters:**
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

Also available as `AsyncAudio`.

---

### Auth

Provides methods for authentication token and session management.

#### Constructor

```js
const auth = new Auth(client);
```

#### Methods

##### `getAPITokens()`

Gets all API tokens for the current user.

**Returns:** `Promise<unknown>`.

##### `revokeAPIToken(tokenName)`

Revokes a specific API token.

**Parameters:**
- `tokenName` (string): The name of the token to revoke.

**Returns:** `Promise<unknown>`.

##### `logout(refreshToken, sessionID)`

Terminates a session.

**Parameters:**
- `refreshToken` (string): The refresh token associated with the session.
- `sessionID` (string): The session ID.

**Returns:** `Promise<unknown>`.

##### `getSessions()`

Gets all active sessions for the current user.

**Returns:** `Promise<unknown>`.

##### `getToken({ grantType, code, redirectURI, clientID, refreshToken, codeVerifier } = {})`

Obtains access and refresh tokens. Parameters are passed as a destructured object.

**Parameters:**
- `grantType` (string, optional): The OAuth grant type.
- `code` (string, optional): Authorization code.
- `redirectURI` (string, optional): OAuth redirect URI.
- `clientID` (string, optional): OAuth client ID.
- `refreshToken` (string, optional): Refresh token for renewal.
- `codeVerifier` (string, optional): PKCE code verifier.

**Returns:** `Promise<unknown>`.

```js
const tokenData = await auth.getToken({ grantType: "password", clientID: "my-app" });
```

Also available as `AsyncAuth`.

---

### ChannelTypes

Provides methods to retrieve channel type information.

#### Constructor

```js
const channelTypes = new ChannelTypes(client);
```

#### Methods

##### `getChannelTypes(prefixes = null, language = null)`

Gets all available channel types.

**Parameters:**
- `prefixes` (string, optional): Filter by prefix.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `getChannelType(channelTypeUID, language = null)`

Gets a specific channel type.

**Parameters:**
- `channelTypeUID` (string): The UID of the channel type.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `getLinkableItemTypes(channelTypeUID)`

Gets item types that can be linked to a trigger channel type.

**Parameters:**
- `channelTypeUID` (string): The UID of the channel type.

**Returns:** `Promise<unknown>`.

Also available as `AsyncChannelTypes`.

---

### ConfigDescriptions

Provides methods to retrieve configuration descriptions.

#### Constructor

```js
const configDescriptions = new ConfigDescriptions(client);
```

#### Methods

##### `getConfigDescriptions(scheme = null, language = null)`

Gets all configuration descriptions.

**Parameters:**
- `scheme` (string, optional): Filter by scheme.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `getConfigDescription(uri, language = null)`

Gets a specific configuration description by URI.

**Parameters:**
- `uri` (string): The URI of the configuration description.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

Also available as `AsyncConfigDescriptions`.

---

### Discovery

Provides methods to interact with the openHAB discovery service.

#### Constructor

```js
const discovery = new Discovery(client);
```

#### Methods

##### `getDiscoveryBindings()`

Gets all bindings that support discovery.

**Returns:** `Promise<unknown>` — list of binding IDs.

##### `getBindingInfo(bindingID, language = null)`

Gets information about a specific binding.

**Parameters:**
- `bindingID` (string): The ID of the binding.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `startBindingScan(bindingID, input = null)`

Starts the discovery scan for a binding.

**Parameters:**
- `bindingID` (string): The ID of the binding.
- `input` (string, optional): Optional scan input.

**Returns:** `Promise<unknown>` — timeout duration in seconds.

```js
const timeout = await discovery.startBindingScan("zwave");
console.log("Scan timeout:", timeout, "seconds");
```

Also available as `AsyncDiscovery`.

---

### Events

Provides methods to subscribe to the openHAB event bus via SSE.

#### Constructor

```js
const events = new Events(client);
```

#### Methods

##### `getEvents(topics = null)`

Gets a stream of all openHAB events, optionally filtered by topic.

**Parameters:**
- `topics` (string, optional): Comma-separated list of topics to filter.

**Returns:** `Promise<Response>` — SSE stream.

##### `initiateStateTracker()`

Initiates a new state tracker connection.

**Returns:** `Promise<unknown>` — the SSE connection ID.

##### `updateSSEConnectionItems(connectionID, items)`

Updates the items tracked by an existing SSE connection.

**Parameters:**
- `connectionID` (string): The ID of the SSE connection.
- `items` (Array): List of item names to track.

**Returns:** `Promise<unknown>`.

Also available as `AsyncEvents`.

---

### ItemEvents

Provides SSE streams for item-related events.

#### Constructor

```js
const itemEvents = new ItemEvents(client);
```

#### Methods

##### `ItemEvent()`

Subscribes to all item events.

**Returns:** `Promise<Response>`.

##### `ItemAddedEvent(itemName = "*")`

Subscribes to item added events.

**Parameters:**
- `itemName` (string, optional): Filter by item name (default `"*"` for all).

**Returns:** `Promise<Response>`.

##### `ItemRemovedEvent(itemName = "*")`

Subscribes to item removed events.

**Parameters:**
- `itemName` (string, optional): Filter by item name (default `"*"`).

**Returns:** `Promise<Response>`.

##### `ItemUpdatedEvent(itemName = "*")`

Subscribes to item updated events.

**Parameters:**
- `itemName` (string, optional): Filter by item name (default `"*"`).

**Returns:** `Promise<Response>`.

##### `ItemCommandEvent(itemName = "*")`

Subscribes to item command events.

**Parameters:**
- `itemName` (string, optional): Filter by item name (default `"*"`).

**Returns:** `Promise<Response>`.

##### `ItemStateEvent(itemName = "*")`

Subscribes to item state events.

**Parameters:**
- `itemName` (string, optional): Filter by item name (default `"*"`).

**Returns:** `Promise<Response>`.

##### `ItemStatePredictedEvent(itemName = "*")`

Subscribes to item state predicted events.

**Parameters:**
- `itemName` (string, optional): Filter by item name (default `"*"`).

**Returns:** `Promise<Response>`.

##### `ItemStateChangedEvent(itemName = "*")`

Subscribes to item state changed events.

**Parameters:**
- `itemName` (string, optional): Filter by item name (default `"*"`).

**Returns:** `Promise<Response>`.

```js
const response = await itemEvents.ItemStateChangedEvent("MyLightSwitch");
const reader   = response.body.getReader();
const decoder  = new TextDecoder();
let   buffer   = "";

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop();

  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const raw = line.slice(6).trim();
    if (!raw) continue;
    try {
      const event   = JSON.parse(raw);
      const payload = JSON.parse(event.payload);
      console.log(event.type, "→", payload.value);
    } catch {}
  }
}
```

##### `GroupItemStateChangedEvent(itemName, memberName)`

Subscribes to group item state changed events for a specific member.

**Parameters:**
- `itemName` (string): The name of the group item.
- `memberName` (string): The name of the member item.

**Returns:** `Promise<Response>`.

Also available as `AsyncItemEvents`.

---

### ThingEvents

Provides SSE streams for thing-related events.

#### Constructor

```js
const thingEvents = new ThingEvents(client);
```

#### Methods

##### `ThingAddedEvent(thingUID = "*")`

Subscribes to thing added events.

**Parameters:**
- `thingUID` (string, optional): Filter by thing UID (default `"*"`).

**Returns:** `Promise<Response>`.

##### `ThingRemovedEvent(thingUID = "*")`

Subscribes to thing removed events.

##### `ThingUpdatedEvent(thingUID = "*")`

Subscribes to thing updated events.

##### `ThingStatusInfoEvent(thingUID = "*")`

Subscribes to thing status info events.

##### `ThingStatusInfoChangedEvent(thingUID = "*")`

Subscribes to thing status info changed events.

All methods accept an optional `thingUID` filter (default `"*"`).

Also available as `AsyncThingEvents`.

---

### InboxEvents

Provides SSE streams for inbox (discovery) events.

#### Constructor

```js
const inboxEvents = new InboxEvents(client);
```

#### Methods

##### `InboxAddedEvent(thingUID = "*")`

Subscribes to inbox added events.

##### `InboxRemovedEvent(thingUID = "*")`

Subscribes to inbox removed events.

##### `InboxUpdatedEvent(thingUID = "*")`

Subscribes to inbox updated events.

All methods accept an optional `thingUID` filter (default `"*"`).

Also available as `AsyncInboxEvents`.

---

### LinkEvents

Provides SSE streams for item-channel link events.

#### Constructor

```js
const linkEvents = new LinkEvents(client);
```

#### Methods

##### `ItemChannelLinkAddedEvent(itemName = "*", channelUID = "*")`

Subscribes to link added events.

**Parameters:**
- `itemName` (string, optional): Filter by item name (default `"*"`).
- `channelUID` (string, optional): Filter by channel UID (default `"*"`).

**Returns:** `Promise<Response>`.

##### `ItemChannelLinkRemovedEvent(itemName = "*", channelUID = "*")`

Subscribes to link removed events.

Also available as `AsyncLinkEvents`.

---

### ChannelEvents

Provides SSE streams for channel events.

#### Constructor

```js
const channelEvents = new ChannelEvents(client);
```

#### Methods

##### `ChannelDescriptionChangedEvent(channelUID = "*")`

Subscribes to channel description changed events.

**Parameters:**
- `channelUID` (string, optional): Filter by channel UID (default `"*"`).

**Returns:** `Promise<Response>`.

##### `ChannelTriggeredEvent(channelUID = "*")`

Subscribes to channel triggered events.

**Parameters:**
- `channelUID` (string, optional): Filter by channel UID (default `"*"`).

**Returns:** `Promise<Response>`.

Also available as `AsyncChannelEvents`.

---

### Iconsets

Provides methods to retrieve available iconsets.

#### Methods

##### `getIconsets(language = null)`

Gets all available iconsets.

**Parameters:**
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

Also available as `AsyncIconsets`.

---

### Inbox

Provides methods to manage the openHAB inbox (discovery results).

#### Constructor

```js
const inbox = new Inbox(client);
```

#### Methods

##### `getDiscoveredThings(includeIgnored = true)`

Gets all discovered things.

**Parameters:**
- `includeIgnored` (boolean, optional): Include ignored results (default `true`).

**Returns:** `Promise<unknown>`.

##### `removeDiscoveryResult(thingUID)`

Removes a discovery result.

**Parameters:**
- `thingUID` (string): The UID of the thing to remove.

**Returns:** `Promise<unknown>`.

##### `approveDiscoveryResult(thingUID, thingLabel, newThingID = null, language = null)`

Approves a discovery result and creates the thing.

**Parameters:**
- `thingUID` (string): The UID of the thing.
- `thingLabel` (string): The label for the new thing.
- `newThingID` (string, optional): Optional new thing ID.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `ignoreDiscoveryResult(thingUID)`

Marks a discovery result as ignored.

**Parameters:**
- `thingUID` (string): The UID of the thing.

**Returns:** `Promise<unknown>`.

##### `unignoreDiscoveryResult(thingUID)`

Removes the ignore flag from a discovery result.

**Parameters:**
- `thingUID` (string): The UID of the thing.

**Returns:** `Promise<unknown>`.

Also available as `AsyncInbox`.

---

### Items

Provides methods to manage openHAB items.

#### Constructor

```js
import { OpenHABClient, Items } from "nodejs-openhab-rest-client";

const client   = new OpenHABClient("http://127.0.0.1:8080", "openhab", "habopen");
const itemsAPI = new Items(client);
```

#### Methods

##### `getItems({ type, tags, metadata, recursive, fields, staticDataOnly, language } = {})`

Gets all available items. Parameters are passed as a destructured object.

**Parameters:**
- `type` (string, optional): Item type filter.
- `tags` (string, optional): Item tag filter.
- `metadata` (string, optional): Metadata selector (default `".*"`).
- `recursive` (boolean, optional): Fetch group members recursively (default `false`).
- `fields` (string, optional): Comma-separated list of fields to return.
- `staticDataOnly` (boolean, optional): Return only cached data (default `false`).
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

```js
const switches = await itemsAPI.getItems({ type: "Switch", recursive: true });
```

##### `addOrUpdateItems(items)`

Adds or updates a list of items.

**Parameters:**
- `items` (object[]): List of item data objects.

**Returns:** `Promise<unknown>`.

##### `getItem(itemName, { metadata, recursive, language } = {})`

Gets a single item. Options are passed as a destructured object.

**Parameters:**
- `itemName` (string): The name of the item.
- `metadata` (string, optional): Metadata selector (default `".*"`).
- `recursive` (boolean, optional): Fetch group members recursively (default `true`).
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

```js
const item = await itemsAPI.getItem("MyLightSwitch");
```

##### `addOrUpdateItem(itemName, itemData, language = null)`

Adds or updates a single item.

**Parameters:**
- `itemName` (string): The name of the item.
- `itemData` (object): The item data.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `sendCommand(itemName, command)`

Sends a command to an item.

**Parameters:**
- `itemName` (string): The name of the item.
- `command` (string): The command to send (e.g. `"ON"`, `"OFF"`, `"50"`).

**Returns:** `Promise<unknown>`.

```js
await itemsAPI.sendCommand("MyLightSwitch", "ON");
```

##### `postUpdate(itemName, state)`

Updates the state of an item. Alias for `updateItemState`.

**Parameters:**
- `itemName` (string): The name of the item.
- `state` (string): The new state.

**Returns:** `Promise<unknown>`.

##### `deleteItem(itemName)`

Removes an item from the registry.

**Parameters:**
- `itemName` (string): The name of the item.

**Returns:** `Promise<unknown>`.

##### `addGroupMember(itemName, memberItemName)`

Adds a member to a group item.

**Parameters:**
- `itemName` (string): The group item name.
- `memberItemName` (string): The member item name.

**Returns:** `Promise<unknown>`.

##### `removeGroupMember(itemName, memberItemName)`

Removes a member from a group item.

**Parameters:**
- `itemName` (string): The group item name.
- `memberItemName` (string): The member item name.

**Returns:** `Promise<unknown>`.

##### `addMetadata(itemName, namespace, metadata)`

Adds metadata to an item.

**Parameters:**
- `itemName` (string): The item name.
- `namespace` (string): The metadata namespace.
- `metadata` (object): The metadata to add.

**Returns:** `Promise<unknown>`.

##### `removeMetadata(itemName, namespace)`

Removes metadata from an item.

**Parameters:**
- `itemName` (string): The item name.
- `namespace` (string): The metadata namespace to remove.

**Returns:** `Promise<unknown>`.

##### `getMetadataNamespaces(itemName, language = null)`

Gets all metadata namespaces of an item.

**Parameters:**
- `itemName` (string): The item name.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `getSemanticItem(itemName, semanticClass, language = null)`

Gets the item that defines the requested semantics.

**Parameters:**
- `itemName` (string): The item name.
- `semanticClass` (string): The requested semantic class.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `getItemState(itemName)`

Gets the state of an item as plain text.

**Parameters:**
- `itemName` (string): The item name.

**Returns:** `Promise<unknown>` — the current state as a string.

```js
const state = await itemsAPI.getItemState("MyLightSwitch");
console.log(state); // "ON"
```

##### `updateItemState(itemName, state, language = null)`

Updates the state of an item.

**Parameters:**
- `itemName` (string): The item name.
- `state` (string): The new state.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `addTag(itemName, tag)`

Adds a tag to an item.

**Parameters:**
- `itemName` (string): The item name.
- `tag` (string): The tag to add.

**Returns:** `Promise<unknown>`.

##### `removeTag(itemName, tag)`

Removes a tag from an item.

**Parameters:**
- `itemName` (string): The item name.
- `tag` (string): The tag to remove.

**Returns:** `Promise<unknown>`.

##### `purgeOrphanedMetadata()`

Removes unused/orphaned metadata from all items.

**Returns:** `Promise<unknown>`.

Also available as `AsyncItems`.

---

### Links

Provides methods to manage item-channel links.

#### Constructor

```js
const links = new Links(client);
```

#### Methods

##### `getLinks(channelUID = null, itemName = null)`

Gets all links, optionally filtered.

**Parameters:**
- `channelUID` (string, optional): Filter by channel UID.
- `itemName` (string, optional): Filter by item name.

**Returns:** `Promise<unknown>`.

##### `getLink(itemName, channelUID)`

Gets a specific link.

**Parameters:**
- `itemName` (string): The item name.
- `channelUID` (string): The channel UID (URL-encoded automatically).

**Returns:** `Promise<unknown>`.

##### `linkItemToChannel(itemName, channelUID, configuration)`

Links an item to a channel.

**Parameters:**
- `itemName` (string): The item name.
- `channelUID` (string): The channel UID.
- `configuration` (object): The link configuration.

**Returns:** `Promise<unknown>`.

##### `unlinkItemFromChannel(itemName, channelUID)`

Unlinks an item from a channel.

**Parameters:**
- `itemName` (string): The item name.
- `channelUID` (string): The channel UID.

**Returns:** `Promise<unknown>`.

##### `deleteAllLinks(object)`

Deletes all links for an item or thing.

**Parameters:**
- `object` (string): The item name or thing UID.

**Returns:** `Promise<unknown>`.

##### `getOrphanLinks()`

Gets all orphan links (links to non-existent channels).

**Returns:** `Promise<unknown>`.

##### `purgeUnusedLinks()`

Removes all unused/orphaned links.

**Returns:** `Promise<unknown>`.

Also available as `AsyncLinks`.

---

### Logging

Provides methods to manage openHAB loggers.

#### Constructor

```js
const logging = new Logging(client);
```

#### Methods

##### `getLoggers()`

Gets all loggers and their levels.

**Returns:** `Promise<unknown>`.

##### `getLogger(loggerName)`

Gets a specific logger.

**Parameters:**
- `loggerName` (string): The logger name.

**Returns:** `Promise<unknown>`.

##### `modifyOrAddLogger(loggerName, level)`

Modifies or adds a logger.

**Parameters:**
- `loggerName` (string): The logger name.
- `level` (string): The log level (`"DEBUG"`, `"INFO"`, `"WARN"`, `"ERROR"`).

**Returns:** `Promise<unknown>`.

##### `removeLogger(loggerName)`

Removes a logger.

**Parameters:**
- `loggerName` (string): The logger name.

**Returns:** `Promise<unknown>`.

Also available as `AsyncLogging`.

---

### ModuleTypes

Provides methods to retrieve rule module types.

#### Constructor

```js
const moduleTypes = new ModuleTypes(client);
```

#### Methods

##### `getModuleTypes(tags = null, typeFilter = null, language = null)`

Gets all available module types.

**Parameters:**
- `tags` (string, optional): Filter by tags.
- `typeFilter` (string, optional): Filter by type (`"trigger"`, `"condition"`, `"action"`).
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `getModuleType(moduleTypeUID, language = null)`

Gets a specific module type.

**Parameters:**
- `moduleTypeUID` (string): The UID of the module type.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

Also available as `AsyncModuleTypes`.

---

### Persistence

Provides methods to interact with openHAB persistence services.

#### Constructor

```js
const persistence = new Persistence(client);
```

#### Methods

##### `getServices(language = null)`

Gets all persistence services.

**Parameters:**
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `getServiceConfiguration(serviceID)`

Gets the configuration of a persistence service.

**Parameters:**
- `serviceID` (string): The persistence service ID.

**Returns:** `Promise<unknown>`.

##### `setServiceConfiguration(serviceID, config)`

Sets the configuration of a persistence service.

**Parameters:**
- `serviceID` (string): The persistence service ID.
- `config` (object): The configuration data.

**Returns:** `Promise<unknown>`.

##### `deleteServiceConfiguration(serviceID)`

Deletes the configuration of a persistence service.

**Parameters:**
- `serviceID` (string): The persistence service ID.

**Returns:** `Promise<unknown>`.

##### `getItemsFromService(serviceID = null)`

Gets all items available via a persistence service.

**Parameters:**
- `serviceID` (string, optional): The persistence service ID.

**Returns:** `Promise<unknown>`.

##### `getItemPersistenceData(itemName, serviceID, { startTime, endTime, page, pageLength, boundary, itemState } = {})`

Gets item persistence data for a time range. Options are passed as a destructured object.

**Parameters:**
- `itemName` (string): The item name.
- `serviceID` (string): The persistence service ID.
- `startTime` (string, optional): Start timestamp.
- `endTime` (string, optional): End timestamp.
- `page` (number, optional): Page number (default `1`).
- `pageLength` (number, optional): Items per page (default `50`).
- `boundary` (boolean, optional): Include boundary values (default `false`).
- `itemState` (boolean, optional): Return item state instead of raw value (default `false`).

**Returns:** `Promise<unknown>`.

```js
const data = await persistence.getItemPersistenceData(
  "MyTemperatureSensor",
  "rrd4j",
  {
    startTime: "2024-01-01T00:00:00.000+0000",
    endTime:   "2024-01-02T00:00:00.000+0000",
    pageLength: 100
  }
);
```

##### `storeItemData(itemName, time, state, serviceID = null)`

Stores a data point for an item.

**Parameters:**
- `itemName` (string): The item name.
- `time` (string): The timestamp.
- `state` (string): The state value.
- `serviceID` (string, optional): The persistence service ID.

**Returns:** `Promise<unknown>`.

##### `deleteItemData(itemName, startTime, endTime, serviceID)`

Deletes item data within a time range.

**Parameters:**
- `itemName` (string): The item name.
- `startTime` (string): Start timestamp.
- `endTime` (string): End timestamp.
- `serviceID` (string): The persistence service ID.

**Returns:** `Promise<unknown>`.

Also available as `AsyncPersistence`.

---

### ProfileTypes

Provides methods to retrieve profile types.

#### Constructor

```js
const profileTypes = new ProfileTypes(client);
```

#### Methods

##### `getProfileTypes(channelTypeUID = null, itemType = null, language = null)`

Gets all available profile types.

**Parameters:**
- `channelTypeUID` (string, optional): Filter by channel type UID.
- `itemType` (string, optional): Filter by item type.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

Also available as `AsyncProfileTypes`.

---

### Rules

Provides methods to manage openHAB rules.

#### Constructor

```js
const rules = new Rules(client);
```

#### Methods

##### `getRules(prefix = null, tags = null, summary = false, staticDataOnly = false)`

Gets all rules.

**Parameters:**
- `prefix` (string, optional): Filter by rule UID prefix.
- `tags` (string, optional): Filter by tags.
- `summary` (boolean, optional): Return summary only (default `false`).
- `staticDataOnly` (boolean, optional): Return only cached data (default `false`).

**Returns:** `Promise<unknown>`.

##### `createRule(ruleData)`

Creates a new rule.

**Parameters:**
- `ruleData` (object): The rule configuration.

**Returns:** `Promise<unknown>`.

##### `getRule(ruleUID)`

Gets a specific rule.

**Parameters:**
- `ruleUID` (string): The rule UID.

**Returns:** `Promise<unknown>`.

##### `updateRule(ruleUID, ruleData)`

Updates an existing rule.

**Parameters:**
- `ruleUID` (string): The rule UID.
- `ruleData` (object): The updated rule data.

**Returns:** `Promise<unknown>`.

##### `deleteRule(ruleUID)`

Deletes a rule.

**Parameters:**
- `ruleUID` (string): The rule UID.

**Returns:** `Promise<unknown>`.

##### `getModule(ruleUID, moduleCategory, moduleID)`

Gets a specific module of a rule.

**Parameters:**
- `ruleUID` (string): The rule UID.
- `moduleCategory` (string): The module category (`"triggers"`, `"conditions"`, `"actions"`).
- `moduleID` (string): The module ID.

**Returns:** `Promise<unknown>`.

##### `getModuleConfig(ruleUID, moduleCategory, moduleID)`

Gets the configuration of a module.

**Parameters:**
- `ruleUID` (string): The rule UID.
- `moduleCategory` (string): The module category.
- `moduleID` (string): The module ID.

**Returns:** `Promise<unknown>`.

##### `getModuleConfigParam(ruleUID, moduleCategory, moduleID, param)`

Gets a specific configuration parameter of a module.

**Parameters:**
- `ruleUID` (string): The rule UID.
- `moduleCategory` (string): The module category.
- `moduleID` (string): The module ID.
- `param` (string): The parameter name.

**Returns:** `Promise<unknown>`.

##### `setModuleConfigParam(ruleUID, moduleCategory, moduleID, param, value)`

Sets a configuration parameter of a module.

**Parameters:**
- `ruleUID` (string): The rule UID.
- `moduleCategory` (string): The module category.
- `moduleID` (string): The module ID.
- `param` (string): The parameter name.
- `value` (string): The new value.

**Returns:** `Promise<unknown>`.

##### `getActions(ruleUID)`

Gets all action modules of a rule.

**Parameters:**
- `ruleUID` (string): The rule UID.

**Returns:** `Promise<unknown>`.

##### `getConditions(ruleUID)`

Gets all condition modules of a rule.

**Parameters:**
- `ruleUID` (string): The rule UID.

**Returns:** `Promise<unknown>`.

##### `getTriggers(ruleUID)`

Gets all trigger modules of a rule.

**Parameters:**
- `ruleUID` (string): The rule UID.

**Returns:** `Promise<unknown>`.

##### `getConfiguration(ruleUID)`

Gets the configuration of a rule.

**Parameters:**
- `ruleUID` (string): The rule UID.

**Returns:** `Promise<unknown>`.

##### `updateConfiguration(ruleUID, configData)`

Updates the configuration of a rule.

**Parameters:**
- `ruleUID` (string): The rule UID.
- `configData` (object): The new configuration.

**Returns:** `Promise<unknown>`.

##### `setRuleState(ruleUID, enable)`

Enables or disables a rule.

**Parameters:**
- `ruleUID` (string): The rule UID.
- `enable` (boolean): `true` to enable, `false` to disable.

**Returns:** `Promise<unknown>`.

##### `enable(ruleUID)`

Enables a rule. Convenience wrapper for `setRuleState(ruleUID, true)`.

**Returns:** `Promise<unknown>`.

##### `disable(ruleUID)`

Disables a rule. Convenience wrapper for `setRuleState(ruleUID, false)`.

**Returns:** `Promise<unknown>`.

##### `runNow(ruleUID, contextData = null)`

Executes a rule immediately.

**Parameters:**
- `ruleUID` (string): The rule UID.
- `contextData` (object, optional): Context data for the execution.

**Returns:** `Promise<unknown>`.

##### `simulateSchedule(fromTime, untilTime)`

Simulates the rule schedule between two timestamps.

**Parameters:**
- `fromTime` (string): The start timestamp.
- `untilTime` (string): The end timestamp.

**Returns:** `Promise<unknown>`.

Also available as `AsyncRules`.

---

### Services

Provides methods to manage openHAB configurable services.

#### Constructor

```js
const services = new Services(client);
```

#### Methods

##### `getServices(language = null)`

Gets all configurable services.

**Parameters:**
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `getService(serviceID, language = null)`

Gets a specific service by ID.

**Parameters:**
- `serviceID` (string): The service ID.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `getServiceConfig(serviceID)`

Gets the configuration of a service.

**Parameters:**
- `serviceID` (string): The service ID.

**Returns:** `Promise<unknown>`.

##### `updateServiceConfig(serviceID, configData, language = null)`

Updates the configuration of a service.

**Parameters:**
- `serviceID` (string): The service ID.
- `configData` (object): The new configuration.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `deleteServiceConfig(serviceID)`

Deletes the configuration of a service.

**Parameters:**
- `serviceID` (string): The service ID.

**Returns:** `Promise<unknown>`.

##### `getServiceContexts(serviceID, language = null)`

Gets all contexts of a multi-context service.

**Parameters:**
- `serviceID` (string): The service ID.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

Also available as `AsyncServices`.

---

### Sitemaps

Provides methods to interact with openHAB sitemaps.

#### Constructor

```js
const sitemaps = new Sitemaps(client);
```

#### Methods

##### `getSitemaps()`

Gets all available sitemaps.

**Returns:** `Promise<unknown>`.

##### `getSitemap(sitemapName, type = null, jsonCallback = null, includeHidden = false, language = null)`

Gets a specific sitemap.

**Parameters:**
- `sitemapName` (string): The sitemap name.
- `type` (string, optional): The subscription type.
- `jsonCallback` (string, optional): JSONP callback name.
- `includeHidden` (boolean, optional): Include hidden widgets (default `false`).
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `getSitemapPage(sitemapName, pageID, subscriptionID = null, includeHidden = false, language = null)`

Gets a specific page of a sitemap.

**Parameters:**
- `sitemapName` (string): The sitemap name.
- `pageID` (string): The page ID.
- `subscriptionID` (string, optional): Subscription ID for real-time updates.
- `includeHidden` (boolean, optional): Include hidden widgets (default `false`).
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `getFullSitemap(sitemapName, subscriptionID = null, includeHidden = false, language = null)`

Gets the full sitemap including all pages.

**Parameters:**
- `sitemapName` (string): The sitemap name.
- `subscriptionID` (string, optional): Subscription ID for real-time updates.
- `includeHidden` (boolean, optional): Include hidden widgets (default `false`).
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `getSitemapEvents(subscriptionID, sitemapName = null, pageID = null)`

Gets sitemap events for a subscription as an SSE stream.

**Parameters:**
- `subscriptionID` (string): The subscription ID.
- `sitemapName` (string, optional): Filter by sitemap name.
- `pageID` (string, optional): Filter by page ID.

**Returns:** `Promise<Response>` — SSE stream.

##### `getFullSitemapEvents(subscriptionID, sitemapName = null)`

Gets full sitemap events for a subscription as an SSE stream.

**Parameters:**
- `subscriptionID` (string): The subscription ID.
- `sitemapName` (string, optional): Filter by sitemap name.

**Returns:** `Promise<Response>` — SSE stream.

##### `subscribeToSitemapEvents()`

Creates a new subscription for sitemap events.

**Returns:** `Promise<unknown>` — contains the subscription ID.

Also available as `AsyncSitemaps`.

---

### Systeminfo

Provides methods to retrieve openHAB system information.

#### Constructor

```js
const systeminfo = new Systeminfo(client);
```

#### Methods

##### `getSystemInfo()`

Gets general system information.

**Returns:** `Promise<unknown>`.

```js
const info = await systeminfo.getSystemInfo();
console.log(info);
```

##### `getUoMInfo()`

Gets units of measurement information.

**Returns:** `Promise<unknown>`.

Also available as `AsyncSysteminfo`.

---

### Tags

Provides methods to manage openHAB semantic tags.

#### Constructor

```js
const tags = new Tags(client);
```

#### Methods

##### `getTags(language = null)`

Gets all available semantic tags.

**Parameters:**
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `createTag(tagData, language = null)`

Creates a new semantic tag.

**Parameters:**
- `tagData` (object): The tag data.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `getTag(tagID, language = null)`

Gets a specific semantic tag.

**Parameters:**
- `tagID` (string): The tag ID.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `updateTag(tagID, tagData, language = null)`

Updates a semantic tag.

**Parameters:**
- `tagID` (string): The tag ID.
- `tagData` (object): The new tag data.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `deleteTag(tagID, language = null)`

Deletes a semantic tag.

**Parameters:**
- `tagID` (string): The tag ID.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

Also available as `AsyncTags`.

---

### Templates

Provides methods to retrieve rule templates.

#### Constructor

```js
const templates = new Templates(client);
```

#### Methods

##### `getTemplates(language = null)`

Gets all available rule templates.

**Parameters:**
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `getTemplate(templateUID, language = null)`

Gets a specific rule template.

**Parameters:**
- `templateUID` (string): The template UID.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

Also available as `AsyncTemplates`.

---

### ThingTypes

Provides methods to retrieve thing types.

#### Constructor

```js
const thingTypes = new ThingTypes(client);
```

#### Methods

##### `getThingTypes(bindingID = null, language = null)`

Gets all available thing types.

**Parameters:**
- `bindingID` (string, optional): Filter by binding ID.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `getThingType(thingTypeUID, language = null)`

Gets a specific thing type.

**Parameters:**
- `thingTypeUID` (string): The thing type UID.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

Also available as `AsyncThingTypes`.

---

### Things

Provides methods to manage openHAB things.

#### Constructor

```js
const things = new Things(client);
```

#### Methods

##### `getThings(summary = false, staticDataOnly = false, language = null)`

Gets all things.

**Parameters:**
- `summary` (boolean, optional): Return summary only (default `false`).
- `staticDataOnly` (boolean, optional): Return only cached data (default `false`).
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `createThing(thingData, language = null)`

Creates a new thing.

**Parameters:**
- `thingData` (object): The thing configuration.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `getThing(thingUID, language = null)`

Gets a specific thing.

**Parameters:**
- `thingUID` (string): The thing UID.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `updateThing(thingUID, thingData, language = null)`

Updates a thing.

**Parameters:**
- `thingUID` (string): The thing UID.
- `thingData` (object): The updated thing data.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `deleteThing(thingUID, force = false, language = null)`

Deletes a thing.

**Parameters:**
- `thingUID` (string): The thing UID.
- `force` (boolean, optional): Force deletion even if linked (default `false`).
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `updateThingConfiguration(thingUID, configurationData, language = null)`

Updates the configuration of a thing.

**Parameters:**
- `thingUID` (string): The thing UID.
- `configurationData` (object): The new configuration.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `getThingConfigStatus(thingUID, language = null)`

Gets the configuration status of a thing.

**Parameters:**
- `thingUID` (string): The thing UID.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `setThingStatus(thingUID, enabled, language = null)`

Enables or disables a thing.

**Parameters:**
- `thingUID` (string): The thing UID.
- `enabled` (boolean): `true` to enable, `false` to disable.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `enableThing(thingUID)`

Enables a thing. Convenience wrapper for `setThingStatus(thingUID, true)`.

**Returns:** `Promise<unknown>`.

##### `disableThing(thingUID)`

Disables a thing. Convenience wrapper for `setThingStatus(thingUID, false)`.

**Returns:** `Promise<unknown>`.

##### `updateThingFirmware(thingUID, firmwareVersion, language = null)`

Updates the firmware of a thing.

**Parameters:**
- `thingUID` (string): The thing UID.
- `firmwareVersion` (string): The firmware version to install.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `getThingFirmwareStatus(thingUID, language = null)`

Gets the firmware update status of a thing.

**Parameters:**
- `thingUID` (string): The thing UID.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `getThingFirmwares(thingUID, language = null)`

Gets all available firmware versions for a thing.

**Parameters:**
- `thingUID` (string): The thing UID.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `getThingStatus(thingUID, language = null)`

Gets the status of a thing.

**Parameters:**
- `thingUID` (string): The thing UID.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

Also available as `AsyncThings`.

---

### Transformations

Provides methods to manage openHAB transformations.

#### Constructor

```js
const transformations = new Transformations(client);
```

#### Methods

##### `getTransformations()`

Gets all transformations.

**Returns:** `Promise<unknown>`.

##### `getTransformation(transformationUID)`

Gets a specific transformation.

**Parameters:**
- `transformationUID` (string): The transformation UID.

**Returns:** `Promise<unknown>`.

##### `updateTransformation(transformationUID, transformationData)`

Updates a transformation.

**Parameters:**
- `transformationUID` (string): The transformation UID.
- `transformationData` (object): The new transformation data.

**Returns:** `Promise<unknown>`.

##### `deleteTransformation(transformationUID)`

Deletes a transformation.

**Parameters:**
- `transformationUID` (string): The transformation UID.

**Returns:** `Promise<unknown>`.

##### `getTransformationServices()`

Gets all available transformation services.

**Returns:** `Promise<unknown>`.

Also available as `AsyncTransformations`.

---

### UI

Provides methods to manage UI components and tiles.

#### Constructor

```js
const ui = new UI(client);
```

#### Methods

##### `getUIComponents(namespace, summary = false)`

Gets all UI components in a namespace.

**Parameters:**
- `namespace` (string): The namespace.
- `summary` (boolean, optional): Return summary only (default `false`).

**Returns:** `Promise<unknown>`.

##### `addUIComponent(namespace, componentData)`

Adds a UI component to a namespace.

**Parameters:**
- `namespace` (string): The namespace.
- `componentData` (object): The component data.

**Returns:** `Promise<unknown>`.

##### `getUIComponent(namespace, componentUID)`

Gets a specific UI component.

**Parameters:**
- `namespace` (string): The namespace.
- `componentUID` (string): The component UID.

**Returns:** `Promise<unknown>`.

##### `updateUIComponent(namespace, componentUID, componentData)`

Updates a UI component.

**Parameters:**
- `namespace` (string): The namespace.
- `componentUID` (string): The component UID.
- `componentData` (object): The new component data.

**Returns:** `Promise<unknown>`.

##### `deleteUIComponent(namespace, componentUID)`

Deletes a UI component.

**Parameters:**
- `namespace` (string): The namespace.
- `componentUID` (string): The component UID.

**Returns:** `Promise<unknown>`.

##### `getUITiles()`

Gets all registered UI tiles.

**Returns:** `Promise<unknown>`.

Also available as `AsyncUI`.

---

### UUID

Provides a method to retrieve the openHAB instance UUID.

#### Constructor

```js
const uuid = new UUID(client);
```

#### Methods

##### `getUUID()`

Gets the UUID of the openHAB instance.

**Returns:** `Promise<unknown>`.

```js
const id = await uuid.getUUID();
console.log(id);
```

Also available as `AsyncUUID`.

---

### Voice

Provides methods to interact with the openHAB voice system.

#### Constructor

```js
const voice = new Voice(client);
```

#### Methods

##### `getDefaultVoice()`

Gets the default voice.

**Returns:** `Promise<unknown>`.

##### `getVoices()`

Gets all available voices.

**Returns:** `Promise<unknown>`.

##### `getInterpreters(language = null)`

Gets all available human language interpreters.

**Parameters:**
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `getInterpreter(interpreterID, language = null)`

Gets a specific interpreter.

**Parameters:**
- `interpreterID` (string): The interpreter ID.
- `language` (string, optional): Language for the response.

**Returns:** `Promise<unknown>`.

##### `interpretText(text, language = null)`

Sends text to the default interpreter.

**Parameters:**
- `text` (string): The text to interpret.
- `language` (string, optional): The language of the text.

**Returns:** `Promise<unknown>`.

##### `interpretTextBatch(text, IDs, language = null)`

Sends text to multiple interpreters.

**Parameters:**
- `text` (string): The text to interpret.
- `IDs` (string[]): List of interpreter IDs.
- `language` (string, optional): The language of the text.

**Returns:** `Promise<unknown>`.

##### `startDialog(sourceID, { ksID, sttID, ttsID, voiceID, hliIDs, sinkID, keyword, listeningItem } = {})`

Starts dialog processing for an audio source. Options are passed as a destructured object.

**Parameters:**
- `sourceID` (string): The audio source ID.
- `ksID` (string, optional): Keyword spotter ID.
- `sttID` (string, optional): Speech-to-text ID.
- `ttsID` (string, optional): Text-to-speech ID.
- `voiceID` (string, optional): Voice ID.
- `hliIDs` (string, optional): Comma-separated interpreter IDs.
- `sinkID` (string, optional): Audio output ID.
- `keyword` (string, optional): Keyword to start the dialog.
- `listeningItem` (string, optional): Item name to listen to.

**Returns:** `Promise<unknown>`.

```js
await voice.startDialog("javasound:source:microphone", {
  sttID:   "googlestt",
  ttsID:   "googletts",
  voiceID: "google:en-US:en-US-Wavenet-A"
});
```

##### `stopDialog(sourceID)`

Stops dialog processing for an audio source.

**Parameters:**
- `sourceID` (string): The audio source ID.

**Returns:** `Promise<unknown>`.

##### `listenAndAnswer(sourceID, sttID, ttsID, voiceID, { hliIDs, sinkID, listeningItem } = {})`

Executes a single listen-and-answer dialog without keyword spotting. Optional parameters are passed as a destructured object.

**Parameters:**
- `sourceID` (string): The audio source ID.
- `sttID` (string): The speech-to-text ID.
- `ttsID` (string): The text-to-speech ID.
- `voiceID` (string): The voice ID.
- `hliIDs` (string, optional): Comma-separated interpreter IDs.
- `sinkID` (string, optional): Audio output ID.
- `listeningItem` (string, optional): Item name to listen to.

**Returns:** `Promise<unknown>`.

##### `sayText(text, voiceID, sinkID, volume = "100")`

Speaks text aloud.

**Parameters:**
- `text` (string): The text to speak.
- `voiceID` (string): The voice ID.
- `sinkID` (string): The audio output ID.
- `volume` (string, optional): Volume level (default `"100"`).

**Returns:** `Promise<unknown>`.

```js
await voice.sayText("Hello from openHAB!", "voicerss:en-us", "javasound:sink:default");
```

Also available as `AsyncVoice`.

---

## Node.js vs. Browser JS — Key Differences

| Topic | nodejs-openhab-rest-client | js-openhab-rest-client |
|---|---|---|
| Install | `npm install nodejs-openhab-rest-client` | `<script src="...openhab.js">` |
| Import (ESM) | `import { Items } from "nodejs-openhab-rest-client"` | `import { Items } from "./openhab.js"` |
| Import (CJS) | `const { Items } = require("nodejs-openhab-rest-client")` | not applicable |
| TypeScript | ✅ bundled `index.d.ts` | ❌ not included |
| Distribution | `dist/esm/`, `dist/cjs/`, `dist/types/` | single `openhab.js` + `openhab.min.js` |
| CDN | ❌ | jsDelivr, GitHack |
| Global namespace | ❌ | `window.openHAB` |
| SSE stream | `response.body.getReader()` with `buffer` | `response.body.getReader()` |
| Min. runtime | Node.js ≥ 18 | any modern browser |
| Auth (`getToken`) | no `useCookie` parameter | has `useCookie` parameter |
| `getItemPersistenceData` | options as destructured object `{ startTime, ... }` | positional parameters |

---

## Contributing

Contributions are welcome! Please create an issue or pull request to suggest changes.

### How to contribute:
1. Fork the repository.
2. Create a new branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. Commit your changes:
   ```bash
   git commit -m "Add your feature description"
   ```
4. Push to the branch:
   ```bash
   git push origin feature/your-feature-name
   ```
5. Open a pull request.

Please ensure your code follows the existing style and includes relevant documentation.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
