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

### Actions

```js
const actions = new Actions(client);   // or new AsyncActions(client)
```

#### `getActions(thingUID, language = null)`

Get all available actions for provided thing UID.

- `thingUID` – The UID of the thing for which actions are to be retrieved.
- `language` – (Optional) Language setting for the Accept-Language headers.

**Returns:** A list of actions.

#### `executeAction(thingUID, actionUID, actionInputs, language = null)`

Executes a thing action.

- `thingUID` – The UID of the thing on which the action is to be executed.
- `actionUID` – The UID of the action to be executed.
- `actionInputs` – The inputs for the action as a object.
- `language` – (Optional) Language setting for the Accept-Language headers.

**Returns:** A response from the server.

---

### Addons

```js
const addons = new Addons(client);   // or new AsyncAddons(client)
```

#### `getAddons(serviceID = null, language = null)`

Retrieves a list of all available add-ons.

- `serviceID` – Optional service ID to filter the results.
- `language` – Optional language preference for the response.

**Returns:** A object containing the add-ons data.

#### `getAddon(addonID, serviceID = null, language = null)`

Retrieves details of a specific add-on by its ID.

- `addonID` – The unique identifier of the add-on.
- `serviceID` – Optional service ID to filter the results.
- `language` – Optional language preference for the response.

**Returns:** A object containing details of the specified add-on.

#### `getAddonConfig(addonID, serviceID = null)`

Retrieves the configuration of a specific add-on.

- `addonID` – The unique identifier of the add-on.
- `serviceID` – Optional service ID to filter the results.

**Returns:** A object containing the configuration of the specified add-on.

#### `updateAddonConfig(addonID, configData, serviceID = null)`

Updates the configuration of a specific add-on and returns the updated configuration.

- `addonID` – The unique identifier of the add-on.
- `configData` – A object containing the new configuration settings.
- `serviceID` – Optional service ID to specify the target service.

**Returns:** A object containing the updated configuration.

#### `installAddon(addonID, serviceID = null)`

Installs an add-on by its ID.

- `addonID` – The unique identifier of the add-on.
- `serviceID` – Optional service ID to specify the target service.

**Returns:** A object containing the installation status.

#### `uninstallAddon(addonID, serviceID = null)`

Uninstalls an add-on by its ID.

- `addonID` – The unique identifier of the add-on.
- `serviceID` – Optional service ID to specify the target service.

**Returns:** A object containing the uninstallation status.

#### `getAddonServices(language = null)`

Retrieves a list of all available add-on services.

- `language` – Optional language preference for the response.

**Returns:** A object containing the available add-on services.

#### `getAddonSuggestions(language = null)`

Retrieves a list of suggested add-ons for installation.

- `language` – Optional language preference for the response.

**Returns:** A object containing suggested add-ons.

#### `getAddonTypes(serviceID = null, language = null)`

Retrieves a list of all available add-on types.

- `language` – Optional language preference for the response.

**Returns:** A object containing available add-on types.

#### `installAddonFromUrl(url)`

Installs an add-on from a given URL.

- `url` – The URL of the add-on to install.

**Returns:** A object containing the installation status.

---

### Audio

```js
const audio = new Audio(client);   // or new AsyncAudio(client)
```

#### `getDefaultSink(language = null)`

Retrieves the default sink if defined, or the first available sink.

- `language` – (Optional) Language setting for the Accept-Language header.

**Returns:** A object containing information about the default sink.

#### `getDefaultSource(language = null)`

Retrieves the default source if defined, or the first available source.

- `language` – (Optional) Language setting for the Accept-Language header.

**Returns:** A object containing information about the default source.

#### `getSinks(language = null)`

Retrieves a list of all available sinks.

- `language` – (Optional) Language setting for the Accept-Language header.

**Returns:** A list of available sinks.

#### `getSources(language = null)`

Retrieves a list of all available sources.

- `language` – (Optional) Language setting for the Accept-Language header.

**Returns:** A list of available sources.

---

### Auth

```js
const auth = new Auth(client);   // or new AsyncAuth(client)
```

#### `getAPITokens()`

Retrieve the API tokens associated with the authenticated user.

- `language` – (Optional) Language setting for the API request.

**Returns:** JSON response from the server.

#### `revokeAPIToken(tokenName)`

Revoke a specific API token associated with the authenticated user.

- `tokenName` – Name of the API token to be revoked.
- `language` – (Optional) Language setting for the API request.

**Returns:** JSON response from the server.

#### `logout(refreshToken, sessionID)`

Terminate the session associated with a refresh token.

- `refreshToken` – The refresh token used to delete the session.
- `id` – The user ID associated with the refresh token.

**Returns:** JSON response from the server.

#### `getSessions()`

Retrieve the sessions associated with the authenticated user.

**Returns:** JSON response from the server.

#### `getToken({ useCookie = false, grantType = null, code = null, redirectURI = null, clientID = null, refreshToken = null, codeVerifier = null } = {})`

Obtain access and refresh tokens.

- `useCookie` – (Optional) Whether to use cookies for the session.
- `grantType` – (Optional) The type of grant being requested.
- `code` – (Optional) Authorization code for authentication.
- `redirectUri` – (Optional) Redirect URI for OAuth authentication.
- `clientID` – (Optional) Client ID for authentication.
- `refreshToken` – (Optional) Refresh token for token renewal.
- `codeVerifier` – (Optional) Code verifier for PKCE authentication.

**Returns:** JSON response from the server.

---

### ChannelTypes

```js
const channelTypes = new ChannelTypes(client);   // or new AsyncChannelTypes(client)
```

#### `getChannelTypes(prefixes = null, language = null)`

Retrieves all available channel types.

- `language` – Optional headers 'Accept-Language' to specify the preferred language.
- `prefixes` – Optional query parameter to filter channel types by prefix.

**Returns:** A list of channel types.

#### `getChannelType(channelTypeUID, language = null)`

Retrieves the item types the given trigger channel type UID can be linked to.

- `channelTypeUID` – The unique UID of the channel type.
- `language` – Optional headers 'Accept-Language' to specify the preferred language.

**Returns:** Details of the specific channel type.

#### `getLinkableItemTypes(channelTypeUID)`

Retrieves the item types that can be linked to the specified trigger channel type.

- `channelTypeUID` – The unique UID of the channel type.

**Returns:** A list of item types.

---

### ConfigDescriptions

```js
const configDescriptions = new ConfigDescriptions(client);   // or new AsyncConfigDescriptions(client)
```

#### `getConfigDescriptions(scheme = null, language = null)`

Retrieves all available config descriptions.

- `language` – Optional headers 'Accept-Language' to specify the preferred language.
- `scheme` – Optional query parameter to filter results by a specific scheme.

**Returns:** A list of configuration descriptions.

#### `getConfigDescription(uri, language = null)`

Retrieves a config description by URI.

- `uri` – The URI of the requested configuration description.
- `language` – Optional headers 'Accept-Language' to specify the preferred language.

**Returns:** Details of the specific configuration description.

---

### Discovery

```js
const discovery = new Discovery(client);   // or new AsyncDiscovery(client)
```

#### `getDiscoveryBindings()`

Gets all bindings that support discovery.

**Returns:** Eine Liste der Bindings als Strings.

#### `getBindingInfo(bindingID, language = null)`

Gets information about the discovery services for a binding.

- `bindingId` – The ID of the binding to get discovery information for.
- `language` – Optional language parameter for the response (Accept-Language header).

**Returns:** Information about the discovery service for the specified binding.

#### `startBindingScan(bindingID, input = null)`

Starts asynchronous discovery process for a binding and returns the timeout in seconds of the discovery operation.

- `bindingID` – The ID of the binding for which the discovery is to be started.
- `input` – An input parameter to start the discovery.

**Returns:** Timeout duration of the discovery operation in seconds.

---

### Events

```js
const events = new Events(client);   // or new AsyncEvents(client)
```

#### `getEvents(topics = null)`

Get all available events, optionally filtered by topic.

- `topics` – A comma-separated list of topics to filter the events by (e.g. "openhab/items/*/statechanged,openhab/things/*/statuschanged"). The wildcard * also matches slashes.

**Returns:** A SSE stream of events (fetch Response) or {"error": ...}.

#### `initiateStateTracker()`

Initiates a new item state tracker connection. The first event of the stream carries the connection ID, which is needed for updateSSEConnectionItems().

**Returns:** A SSE stream (fetch Response) or {"error": ...}.

#### `updateSSEConnectionItems(connectionID, items)`

Changes the list of items a SSE connection will receive state updates for.

- `connectionID` – The ID of the existing connection.
- `items` – A list of item names to subscribe to for state updates.

**Returns:** A success message when the update is completed.

---

### ItemEvents

```js
const itemEvents = new ItemEvents(client);   // or new AsyncItemEvents(client)
```

#### `ItemEvent()`

Get all item-related events.

**Returns:** A SSE stream of item events.

#### `ItemAddedEvent(itemName = "*")`

Get events for added items.

- `itemName` – The name of the item (default is "*").

**Returns:** A SSE stream of added item events.

#### `ItemRemovedEvent(itemName = "*")`

Get events for removed items.

- `itemName` – The name of the item (default is "*").

**Returns:** A SSE stream of removed item events.

#### `ItemUpdatedEvent(itemName = "*")`

Get events for updated items.

- `itemName` – The name of the item (default is "*").

**Returns:** A SSE stream of updated item events.

#### `ItemCommandEvent(itemName = "*")`

Get events for item commands.

- `itemName` – The name of the item (default is "*").

**Returns:** A SSE stream of item command events.

#### `ItemStateEvent(itemName = "*")`

Get events for item state updates.

- `itemName` – The name of the item (default is "*").

**Returns:** A SSE stream of item state events.

#### `ItemStatePredictedEvent(itemName = "*")`

Get events for predicted item state changes.

- `itemName` – The name of the item (default is "*").

**Returns:** A SSE stream of item state predicted events.

#### `ItemStateChangedEvent(itemName = "*")`

Get events for item state changes. Note: with the default "*", state changes of group items are included as well, because their topic openhab/items/<group>/<member>/statechanged also matches the pattern.

- `itemName` – The name of the item (default is "*").

**Returns:** A SSE stream of item state changed events.

#### `GroupItemStateChangedEvent(itemName = "*", memberName = "*")`

Get events for state changes of group items.

- `itemName` – The name of the group item (default is "*").
- `memberName` – The name of the group member that caused the change (default is "*").

**Returns:** A SSE stream of group item state changed events.

---

### ThingEvents

```js
const thingEvents = new ThingEvents(client);   // or new AsyncThingEvents(client)
```

#### `ThingAddedEvent(thingUID = "*")`

Get events for added things.

- `thingUID` – The UID of the thing (default is "*").

**Returns:** A SSE stream of added thing events.

#### `ThingRemovedEvent(thingUID = "*")`

Get events for removed things.

- `thingUID` – The UID of the thing (default is "*").

**Returns:** A SSE stream of removed thing events.

#### `ThingUpdatedEvent(thingUID = "*")`

Get events for updated things.

- `thingUID` – The UID of the thing (default is "*").

**Returns:** A SSE stream of updated thing events.

#### `ThingStatusInfoEvent(thingUID = "*")`

Get events for thing status information.

- `thingUID` – The UID of the thing (default is "*").

**Returns:** A SSE stream of thing status information events.

#### `ThingStatusInfoChangedEvent(thingUID = "*")`

Get events for thing status information changes.

- `thingUID` – The UID of the thing (default is "*").

**Returns:** A SSE stream of thing status information changed events.

---

### InboxEvents

```js
const inboxEvents = new InboxEvents(client);   // or new AsyncInboxEvents(client)
```

#### `InboxAddedEvent(thingUID = "*")`

Get events for added things in the inbox.

- `thingUID` – The UID of the thing (default is "*").

**Returns:** A SSE stream of added inbox events.

#### `InboxRemovedEvent(thingUID = "*")`

Get events for removed things in the inbox.

- `thingUID` – The UID of the thing (default is "*").

**Returns:** A SSE stream of removed inbox events.

#### `InboxUpdatedEvent(thingUID = "*")`

Get events for updated things in the inbox.

- `thingUID` – The UID of the thing (default is "*").

**Returns:** A SSE stream of updated inbox events.

---

### LinkEvents

```js
const linkEvents = new LinkEvents(client);   // or new AsyncLinkEvents(client)
```

#### `ItemChannelLinkAddedEvent(itemName = "*", channelUID = "*")`

Get events for added item-channel links.

- `itemName` – The name of the item (default is "*").
- `channelUID` – The UID of the channel (default is "*").

**Returns:** A SSE stream of added item-channel link events.

#### `ItemChannelLinkRemovedEvent(itemName = "*", channelUID = "*")`

Get events for removed item-channel links.

- `itemName` – The name of the item (default is "*").
- `channelUID` – The UID of the channel (default is "*").

**Returns:** A SSE stream of removed item-channel link events.

---

### ChannelEvents

```js
const channelEvents = new ChannelEvents(client);   // or new AsyncChannelEvents(client)
```

#### `ChannelDescriptionChangedEvent(channelUID = "*")`

Get events for changes in channel descriptions.

- `channelUID` – The UID of the channel (default is "*").

**Returns:** A SSE stream of channel description changed events.

#### `ChannelTriggeredEvent(channelUID = "*")`

Get events for triggered channels.

- `channelUID` – The UID of the channel (default is "*").

**Returns:** A SSE stream of channel triggered events.

---

### Iconsets

```js
const iconsets = new Iconsets(client);   // or new AsyncIconsets(client)
```

#### `getIconsets(language = null)`

Gets all icon sets.

- `language` – Optional language preference for the response (e.g. 'en', 'de').

**Returns:** A list of icon sets with details such as ID, label, description and supported formats.

---

### Inbox

```js
const inbox = new Inbox(client);   // or new AsyncInbox(client)
```

#### `getDiscoveredThings(includeIgnored = true)`

Get all discovered things.

- `includeIgnored` – Whether ignored entries should also be included (default: true).

**Returns:** A list of discovered things with details such as UID, flag, label, and properties.

#### `removeDiscoveryResult(thingUID)`

Removes the discovery result from the inbox.

- `thingUID` – The UID of the discovered thing to be removed.

**Returns:** The API response to the delete request.

#### `approveDiscoveryResult(thingUID, thingLabel, newThingID = null, language = null)`

Approves the discovery result by adding the thing to the registry.

- `thingUID` – The UID of the discovered thing.
- `thingLabel` – The new name of the thing.
- `newThingID` – Optional: The new thing ID.
- `language` – Optional: Language preference for the response.

**Returns:** The API response to the approval request.

#### `ignoreDiscoveryResult(thingUID)`

Flags a discovery result as ignored for further processing.

- `thingUID` – The UID of the discovered thing.

**Returns:** The API response to the ignore request.

#### `unignoreDiscoveryResult(thingUID)`

Removes the ignore flag from a discovery result.

- `thingUID` – The UID of the discovered thing.

**Returns:** The API response to the unignore request.

---

### Items

```js
const items = new Items(client);   // or new AsyncItems(client)
```

#### `getItems({ type = null, tags = null, metadata = ".*", recursive = false, fields = null, staticDataOnly = false, language = null, parents = null } = {})`

Get all available items.

- `type` – Optional; Item type filter.
- `tags` – Optional; Item tag filter.
- `metadata` – Optional; Metadata selector (default: .*).
- `recursive` – Optional; Whether to fetch group members recursively (default: false).
- `fields` – Optional; Limit to specific fields (comma-separated).
- `staticDataOnly` – Optional; Only returns cached data (default: false).
- `language` – Optional; Language filter for headers "Accept-Language".
- `parents` – Optional; Include the parent groups of each item (openHAB 4.1+).

**Returns:** A list containing the item data as returned by the API.

#### `addOrUpdateItems(items)`

Adds a list of items to the registry or updates the existing items.

- `items` – A list of item data (object).

**Returns:** A response object or confirmation that the items were successfully added or updated.

#### `getItem(itemName, { metadata = ".*", recursive = true, language = null, parents = null } = {})`

Gets a single item.

- `itemName` – The name of the item.
- `metadata` – Optional; Metadata selector (default: .*).
- `recursive` – Optional; Whether to fetch group members recursively (default: true).
- `language` – Optional; Language filter for headers "Accept-Language".

**Returns:** A object containing the requested item data.

#### `addOrUpdateItem(itemName, itemData, language = null)`

Adds a new item to the registry or updates the existing item.

- `itemName` – The name of the item.
- `itemData` – The data of the item (object).
- `language` – Optional; Language filter for headers "Accept-Language".

**Returns:** A response object or confirmation that the item was successfully added or updated.

#### `sendCommand(itemName, command, source = null)`

Sends a command to an item.

- `itemName` – The name of the item.
- `command` – The command to be sent (e.g., ON, OFF).
- `source` – Optional; Source of the command, shown in the event (openHAB 4.1+).

**Returns:** A response object or confirmation that the command was successfully sent.

#### `postUpdate(itemName, state, source = null)`

Updates the state of an item.

- `itemName` – The name of the item.
- `state` – The state to be signaled for the item.

**Returns:** A response object or confirmation that the state was successfully updated.

#### `deleteItem(itemName)`

Removes an item from the registry.

- `itemName` – The name of the item.

**Returns:** A response object or confirmation that the item was successfully deleted.

#### `addGroupMember(itemName, memberItemName)`

Adds a new member to a group item.

- `itemName` – The name of the group item.
- `memberItemName` – The name of the member item.

**Returns:** A response object or confirmation that the group member was successfully added.

#### `removeGroupMember(itemName, memberItemName)`

Removes an existing member from a group item.

- `itemName` – The name of the group item.
- `memberItemName` – The name of the member item.

**Returns:** A response object or confirmation that the group member was successfully removed.

#### `addMetadata(itemName, namespace, metadata)`

Adds metadata to an item.

- `itemName` – The name of the item.
- `namespace` – The namespace of the metadata.
- `metadata` – A object containing the metadata.

**Returns:** A response object or confirmation that the metadata was successfully added.

#### `removeMetadata(itemName, namespace)`

Removes metadata from an item.

- `itemName` – The name of the item.
- `namespace` – The namespace of the metadata.

**Returns:** A response object or confirmation that the metadata was successfully removed.

#### `getMetadataNamespaces(itemName, language = null)`

Gets the namespaces of an item.

- `itemName` – The name of the item.
- `language` – Optional; Language filter for headers "Accept-Language".

**Returns:** A list of namespaces associated with the item.

#### `getSemanticItem(itemName, semanticClass, language = null)`

Gets the item that defines the requested semantics of an item.

- `itemName` – The name of the item.
- `semanticClass` – The requested semantic class.
- `language` – Optional; Language filter for headers "Accept-Language".

**Returns:** A object containing the semantic item data.

#### `getItemState(itemName)`

Gets the state of an item.

- `itemName` – The name of the item.

**Returns:** A object containing the current state of the item.

#### `updateItemState(itemName, state, language = null, source = null)`

Updates the state of an item.

- `itemName` – The name of the item.
- `state` – The new state of the item.
- `language` – Optional; Language filter for headers "Accept-Language".

**Returns:** A response object or confirmation that the state was successfully updated.

#### `addTag(itemName, tag)`

Adds a tag to an item.

- `itemName` – The name of the item.
- `tag` – The tag to be added.

**Returns:** A response object or confirmation that the tag was successfully added.

#### `removeTag(itemName, tag)`

Removes a tag from an item.

- `itemName` – The name of the item.
- `tag` – The tag to be removed.

**Returns:** A response object or confirmation that the tag was successfully removed.

#### `purgeOrphanedMetadata()`

Remove unused/orphaned metadata.

**Returns:** A response object or confirmation that orphaned metadata was successfully purged.

---

### Links

```js
const links = new Links(client);   // or new AsyncLinks(client)
```

#### `getLinks(channelUID = null, itemName = null)`

Gets all available links.

- `channelUID` – Optional; Filters by the Channel UID.
- `itemName` – Optional; Filters by the Item Name.

**Returns:** A list of links containing details such as ItemName, ChannelUID, and configuration.

#### `getLink(itemName, channelUID)`

Retrieves an individual link.

- `itemName` – The name of the item.
- `channelUID` – The UID of the channel.

**Returns:** The link with details of the item, channel UID, and configuration.

#### `linkItemToChannel(itemName, channelUID, configuration)`

Links an item to a channel.

- `itemName` – The name of the item.
- `channelUID` – The UID of the channel.
- `configuration` – The configuration for the link.

**Returns:** The API response when the link is successfully created.

#### `unlinkItemFromChannel(itemName, channelUID)`

Unlinks an item from a channel.

- `itemName` – The name of the item.
- `channelUID` – The UID of the channel.

**Returns:** The API response when the link is successfully removed.

#### `deleteAllLinks(object)`

Delete all links that refer to an item or thing.

- `object` – The name of the item or the UID of the thing.

**Returns:** The API response when all links are successfully deleted.

#### `getOrphanLinks()`

Get orphan links between items and broken/non-existent thing channels.

**Returns:** A list of orphan links.

#### `purgeUnusedLinks()`

Remove unused/orphaned links.

**Returns:** The API response when the links are successfully removed.

---

### Logging

```js
const logging = new Logging(client);   // or new AsyncLogging(client)
```

#### `getLoggers()`

Get all loggers.

**Returns:** A list of loggers with names and levels.

#### `getLogger(loggerName)`

Get a single logger.

- `loggerName` – The name of the logger.

**Returns:** The logger with the specified name and level.

#### `modifyOrAddLogger(loggerName, level)`

Modify or add a logger.

- `loggerName` – The name of the logger.
- `level` – The level of the logger.

**Returns:** The API response after modification or addition.

#### `removeLogger(loggerName)`

Remove a single logger.

- `loggerName` – The name of the logger.

**Returns:** The API response after removing the logger.

---

### ModuleTypes

```js
const moduleTypes = new ModuleTypes(client);   // or new AsyncModuleTypes(client)
```

#### `getModuleTypes(tags = null, typeFilter = null, language = null)`

Get all available module types.

- `tags` – Optional filter for tags.
- `typeFilter` – Optional filter for the type (action, condition, trigger).
- `language` – (Optional) Language setting for the Accept-Language header.

**Returns:** A list of module types.

#### `getModuleType(moduleTypeUID, language = null)`

Gets a module type corresponding to the given UID.

- `moduleTypeUID` – The UID of the module type.
- `language` – (Optional) Language setting for the Accept-Language header.

**Returns:** A object with the module type information.

---

### Persistence

```js
const persistence = new Persistence(client);   // or new AsyncPersistence(client)
```

#### `getServices(language = null)`

Gets a list of persistence services.

**Returns:** A list of persistence services with IDs, labels, and types.

#### `getServiceConfiguration(serviceID)`

Gets a persistence service configuration.

- `serviceID` – The ID of the persistence service.

**Returns:** The configuration of the service.

#### `setServiceConfiguration(serviceID, config)`

Sets a persistence service configuration.

- `serviceID` – The ID of the persistence service.
- `config` – The configuration data.

**Returns:** The response from the API after modification.

#### `deleteServiceConfiguration(serviceID)`

Deletes a persistence service configuration.

- `serviceID` – The ID of the persistence service.

**Returns:** The response from the API after deleting the configuration.

#### `getItemsFromService(serviceID = null, itemName = null)`

Gets a list of items available via a specific persistence service.

- `serviceID` – Optional; The ID of the persistence service (default service if omitted).
- `itemName` – Optional; Only return information for this item.

**Returns:** A list of items with their last and earliest timestamps.

#### `getItemPersistenceData(itemName, serviceID = null, { startTime = null, endTime = null, page = null, pageLength = null, boundary = false, itemState = false, displayState = null, language = null } = {})`

Gets item persistence data from the persistence service.

- `itemName` – The name of the item.
- `serviceID` – Optional; The ID of the persistence service. If omitted, the default service is used.
- `startTime` – Optional; Start time (ISO 8601, e.g. "2026-10-30T00:00:00.000Z"). Defaults to 1 day before `endTime`.
- `endTime` – Optional; End time (ISO 8601). Defaults to the current time.
- `page` – Optional; Page number, starting at 0. Paging is only active if `pageLength` is set as well.
- `pageLength` – Optional; Number of data points per page. Without it, all data points are returned.
- `boundary` – Optional; Also return the values just before and after the time range (default: false).
- `itemState` – Optional; Add the current item state at the end of the series (default: false).
- `displayState` – Optional; Add a formatted display state to every data point (openHAB 5.0+).
- `language` – Optional; Value for the "Accept-Language" header.

**Returns:** The retrieved data points of the item.

#### `storeItemData(itemName, time, state, serviceID = null)`

Stores item persistence data into the persistence service.

- `serviceID` – The ID of the persistence service.
- `itemName` – The name of the item.
- `time` – The time of the storage.
- `state` – The state of the item to be stored.

**Returns:** The response from the API after storing the data.

#### `deleteItemData(itemName, startTime, endTime, serviceID)`

Deletes item persistence data from a specific persistence service in a given time range.

- `serviceID` – The ID of the persistence service.
- `itemName` – The name of the item.
- `startTime` – The start time of the data to be deleted.
- `endTime` – The end time of the data to be deleted.

**Returns:** The response from the API after deleting the data.

---

### ProfileTypes

```js
const profileTypes = new ProfileTypes(client);   // or new AsyncProfileTypes(client)
```

#### `getProfileTypes(channelTypeUID = null, itemType = null, language = null)`

Gets all available profile types.

- `channelTypeUID` – Optional filter for the channel type.
- `itemType` – Optional filter for the item type.
- `language` – (Optional) Language setting for the Accept-Language header.

**Returns:** A list of profile types.

---

### Rules

```js
const rules = new Rules(client);   // or new AsyncRules(client)
```

#### `getRules(prefix = null, tags = null, summary = false, staticDataOnly = false)`

Get available rules, optionally filtered by tags and/or prefix.

- `prefix` – Optional prefix to filter the results.
- `tags` – Optional tag array to filter the results.
- `summary` – If true, only summary fields will be returned.
- `staticDataOnly` – If true, only static data will be returned.

**Returns:** A list of rules (JSON objects).

#### `createRule(ruleData)`

Creates a rule.

- `ruleData` – The rule data to be created (as a object).

**Returns:** The created rule (JSON).

#### `getRule(ruleUID)`

Gets the rule corresponding to the given UID.

- `ruleUID` – The UID of the rule to retrieve.

**Returns:** The rule object (JSON).

#### `updateRule(ruleUID, ruleData)`

Updates an existing rule corresponding to the given UID.

- `ruleUID` – The UID of the rule to update.
- `ruleData` – The new rule data (as a object).

**Returns:** The updated rule (JSON).

#### `deleteRule(ruleUID)`

Removes an existing rule corresponding to the given UID.

- `ruleUID` – The UID of the rule to delete.

**Returns:** The API response (status code).

#### `getModule(ruleUID, moduleCategory, moduleID)`

Gets the rule's module corresponding to the given category and ID.

- `ruleUID` – The UID of the rule.
- `moduleCategory` – The category of the module.
- `moduleID` – The ID of the module.

**Returns:** The module (JSON).

#### `getModuleConfig(ruleUID, moduleCategory, moduleID)`

Gets the module's configuration.

- `ruleUID` – The UID of the rule.
- `moduleCategory` – The category of the module.
- `moduleID` – The ID of the module.

**Returns:** The module configuration (JSON).

#### `getModuleConfigParam(ruleUID, moduleCategory, moduleID, param)`

Gets the module's configuration parameter.

- `ruleUID` – The UID of the rule.
- `moduleCategory` – The category of the module.
- `moduleID` – The ID of the module.
- `param` – The name of the configuration parameter.

**Returns:** The configuration parameter value (JSON).

#### `setModuleConfigParam(ruleUID, moduleCategory, moduleID, param, value)`

Sets the module's configuration parameter value.

- `ruleUID` – The UID of the rule.
- `moduleCategory` – The category of the module.
- `moduleID` – The ID of the module.
- `param` – The name of the configuration parameter.
- `value` – The value to set for the configuration parameter.

**Returns:** The API response (status code).

#### `getActions(ruleUID)`

Gets the rule actions.

- `ruleUID` – The UID of the rule.

**Returns:** A list of actions (JSON).

#### `getConditions(ruleUID)`

Gets the rule conditions.

- `ruleUID` – The UID of the rule.

**Returns:** A list of conditions (JSON).

#### `getConfiguration(ruleUID)`

Gets the rule configuration values.

- `ruleUID` – The UID of the rule.

**Returns:** The configuration of the rule (JSON).

#### `updateConfiguration(ruleUID, configData)`

Sets the rule configuration values.

- `ruleUID` – The UID of the rule.
- `configData` – The new configuration data (as a object).

**Returns:** The updated configuration (JSON).

#### `setRuleState(ruleUID, enable)`

Sets the rule configuration values. Activates or deactivates the rule.

- `ruleUID` – The UID of the rule.
- `enable` – If true, the rule will be activated. If false, the rule will be deactivated.

**Returns:** The API response (status code).

#### `enable(ruleUID)`

#### `disable(ruleUID)`

#### `runNow(ruleUID, contextData = null)`

Executes the rule's actions immediately.

- `ruleUID` – The UID of the rule.
- `contextData` – Optional context data for executing the rule.

**Returns:** The API response (status code).

#### `getTriggers(ruleUID)`

Gets the rule triggers.

- `ruleUID` – The UID of the rule.

**Returns:** A list of triggers (JSON).

#### `simulateSchedule(fromTime, untilTime)`

Simulates the executions of rules filtered by tag 'Schedule' within the given times.

- `fromTime` – Simulates the executions of rules filtered by tag 'Schedule' within the given times.
- `untilTime` – Simulates the executions of rules filtered by tag 'Schedule' within the given times.

**Returns:** The simulation results (JSON).

---

### Services

```js
const services = new Services(client);   // or new AsyncServices(client)
```

#### `getServices(language = null)`

Get all configurable services.

- `language` – Optional language setting (as header).

**Returns:** A list of services (JSON).

#### `getService(serviceID, language = null)`

Get configurable service for the given service ID.

- `serviceID` – The ID of the service to retrieve.
- `language` – Optional language setting (as header).

**Returns:** The service object (JSON).

#### `getServiceConfig(serviceID)`

Get service configuration for the given service ID.

- `serviceID` – The ID of the service.

**Returns:** The configuration of the service (JSON).

#### `updateServiceConfig(serviceID, configData, language = null)`

Updates a service configuration for the given service ID and returns the old configuration.

- `serviceID` – The ID of the service.
- `configData` – The new configuration data (as a object).

**Returns:** The old configuration of the service (JSON).

#### `deleteServiceConfig(serviceID)`

Deletes a service configuration for the given service ID and returns the old configuration.

- `serviceID` – The ID of the service.

**Returns:** The old configuration of the service (JSON).

#### `getServiceContexts(serviceID, language = null)`

Get existing multiple context service configurations for the given factory PID.

- `serviceID` – The ID of the service.
- `language` – Optional language setting (as header).

**Returns:** A list of contexts (JSON).

---

### Sitemaps

```js
const sitemaps = new Sitemaps(client);   // or new AsyncSitemaps(client)
```

#### `getSitemaps()`

Get all available sitemaps.

**Returns:** A list of sitemaps (JSON).

#### `getSitemap(sitemapName, type = null, jsonCallback = null, includeHidden = false, language = null)`

Get sitemap by name.

- `sitemapName` – The name of the sitemap to retrieve.
- `type` – Optional query parameter for type.
- `jsonCallback` – Optional query parameter for JSON callback.
- `includeHidden` – Whether hidden widgets should be included.
- `language` – Optional language setting (as header).

**Returns:** The sitemap object (JSON).

#### `getSitemapPage(sitemapName, pageID, subscriptionID = null, includeHidden = false, language = null)`

Polls the data for one page of a sitemap.

- `sitemapName` – The name of the sitemap.
- `pageID` – The ID of the page.
- `subscriptionID` – Optional query parameter for the subscription ID.
- `includeHidden` – Whether hidden widgets should be included.
- `language` – Optional language setting (as header).

**Returns:** The sitemap page (JSON).

#### `getFullSitemap(sitemapName, subscriptionID = null, includeHidden = false, language = null)`

Polls the data for a whole sitemap. Not recommended due to potentially high traffic.

- `sitemapName` – The name of the sitemap.
- `subscriptionID` – Optional query parameter for the subscription ID.
- `includeHidden` – Whether hidden widgets should be included.
- `language` – Optional language setting (as header).

**Returns:** The complete sitemap (JSON).

#### `getSitemapEvents(subscriptionID, sitemapName = null, pageID = null)`

Opens the event stream (SSE) of a sitemap subscription for one page.

- `subscriptionID` – The ID of the subscription (see subscribeToSitemapEvents()).
- `sitemapName` – The name of the sitemap.
- `pageID` – The ID of the page (the sitemap name for the home page).

**Returns:** A SSE stream (fetch Response, read it with iterSSEEvents()) or {"error": ...}.

#### `getFullSitemapEvents(subscriptionID, sitemapName = null)`

Opens the event stream (SSE) of a sitemap subscription for the whole sitemap. Not recommended due to potentially high traffic.

- `subscriptionID` – The ID of the subscription.
- `sitemapName` – The name of the sitemap.

**Returns:** A SSE stream (fetch Response) or {"error": ...}.

#### `subscribeToSitemapEvents()`

Creates a sitemap event subscription.

**Returns:** The response to the subscription request (JSON).

---

### Systeminfo

```js
const systeminfo = new Systeminfo(client);   // or new AsyncSysteminfo(client)
```

#### `getSystemInfo()`

Gets information about the system.

**Returns:** A object with system informations.

#### `getUoMInfo()`

Get all supported dimensions and their system units.

**Returns:** A object with UOM informations.

---

### Tags

```js
const tags = new Tags(client);   // or new AsyncTags(client)
```

#### `getTags(language = null)`

Get all available semantic tags.

- `language` – Optional headers for language setting.

**Returns:** A list of semantic tags (JSON).

#### `createTag(tagData, language = null)`

Creates a new semantic tag and adds it to the registry.

- `tagData` – The data object for the tag to be created.
- `language` – Optional headers for language setting.

**Returns:** The response to the tag creation request (JSON).

#### `getTag(tagID, language = null)`

Gets a semantic tag and its sub-tags.

- `tagID` – The ID of the tag to retrieve.
- `language` – Optional headers for language setting.

**Returns:** The tag object and its sub-tags (JSON).

#### `updateTag(tagID, tagData, language = null)`

Updates a semantic tag.

- `tagID` – The ID of the tag to be updated.
- `tagData` – The new tag data.
- `language` – Optional headers for language setting.

**Returns:** The response to the tag update request (JSON).

#### `deleteTag(tagID, language = null)`

Removes a semantic tag and its sub-tags from the registry.

- `tagID` – The ID of the tag to be removed.
- `language` – Optional headers for language setting.

**Returns:** The response to the tag deletion request (JSON).

---

### Templates

```js
const templates = new Templates(client);   // or new AsyncTemplates(client)
```

#### `getTemplates(language = null)`

Get all available templates.

- `language` – (Optional) Language setting for the Accept-Language header.

**Returns:** A list of templates.

#### `getTemplate(templateUID, language = null)`

Gets a template corresponding to the given UID.

- `templateUID` – The UID of the template.
- `language` – (Optional) Language setting for the Accept-Language header.

**Returns:** A object with the details of the template.

---

### ThingTypes

```js
const thingTypes = new ThingTypes(client);   // or new AsyncThingTypes(client)
```

#### `getThingTypes(bindingID = null, language = null)`

Gets all available thing types without config description, channels, and properties.

- `bindingID` – (Optional) Filter by binding ID.
- `language` – (Optional) Language setting for the Accept-Language header.

**Returns:** A list of thing types.

#### `getThingType(thingTypeUID, language = null)`

Gets a thing type by UID.

- `thingTypeUID` – The UID of the thing type.
- `language` – (Optional) Language setting for the Accept-Language header.

**Returns:** A object with the details of the thing type or an empty response with status 204.

---

### Things

```js
const things = new Things(client);   // or new AsyncThings(client)
```

#### `getThings(summary = false, staticDataOnly = false, language = null)`

Get all available things.

- `summary` – If true, returns only the summary fields.
- `staticDataOnly` – If true, returns a cacheable list.
- `language` – The preferred language for the response.

**Returns:** JSON response with the things.

#### `createThing(thingData, language = null)`

Creates a new thing and adds it to the registry.

- `thingData` – The JSON object containing the thing data.
- `language` – The preferred language for the response.

**Returns:** The API response.

#### `getThing(thingUID, language = null)`

Gets a thing by UID.

- `thingUID` – The UID of the thing.
- `language` – The preferred language for the response.

**Returns:** JSON response with the thing data.

#### `updateThing(thingUID, thingData, language = null)`

Updates a thing.

- `thingUID` – The UID of the thing.
- `thingData` – The JSON object containing the updated thing data.
- `language` – The preferred language for the response.

**Returns:** The API response.

#### `deleteThing(thingUID, force = false, language = null)`

Removes a thing from the registry. Set 'force' to __true__ if you want the thing to be removed immediately.

- `thingUID` – The UID of the thing.
- `force` – If true, the thing will be immediately removed.
- `language` – The preferred language for the response.

**Returns:** The API response.

#### `updateThingConfiguration(thingUID, configurationData, language = null)`

Updates a thing's configuration.

- `thingUID` – The UID of the thing.
- `configurationData` – The configuration data of the thing.
- `language` – The preferred language for the response.

**Returns:** The API response.

#### `getThingConfigStatus(thingUID, language = null)`

Gets the thing's configuration status.

- `thingUID` – The UID of the thing.
- `language` – The preferred language for the response.

**Returns:** JSON response with the thing's configuration status.

#### `setThingStatus(thingUID, enabled, language = null)`

Sets the thing's enabled status.

- `thingUID` – The UID of the thing.
- `enabled` – If true, the thing will be enabled.
- `language` – The preferred language for the response.

**Returns:** The API response.

#### `enableThing(thingUID)`

#### `disableThing(thingUID)`

#### `updateThingFirmware(thingUID, firmwareVersion, language = null)`

Updates the firmware of a thing.

- `thingUID` – The UID of the thing.
- `firmwareVersion` – The firmware version.
- `language` – The preferred language for the response.

**Returns:** The API response.

#### `getThingFirmwareStatus(thingUID, language = null)`

Gets the thing's firmware status.

- `thingUID` – The UID of the thing.
- `language` – The preferred language for the response.

**Returns:** JSON response with the firmware status.

#### `getThingFirmwares(thingUID, language = null)`

Gets all available firmwares for the provided thing UID.

- `thingUID` – The UID of the thing.
- `language` – The preferred language for the response.

**Returns:** A list of available firmwares.

#### `getThingStatus(thingUID, language = null)`

Gets the thing's status.

- `thingUID` – The UID of the thing.
- `language` – The preferred language for the response.

**Returns:** JSON response with the thing's status.

---

### Transformations

```js
const transformations = new Transformations(client);   // or new AsyncTransformations(client)
```

#### `getTransformations()`

Get a list of all transformations.

**Returns:** A list of transformations (JSON).

#### `getTransformation(transformationUID)`

Get a single transformation.

- `transformationUID` – The transformationUID of the transformation to retrieve.

**Returns:** The transformation (JSON).

#### `updateTransformation(transformationUID, transformationData)`

Update a single transformation.

- `transformationUID` – The transformationUID of the transformation to update.
- `transformationData` – The new data for the transformation.

**Returns:** The response to the transformation update request (JSON).

#### `deleteTransformation(transformationUID)`

Delete a single transformation.

- `transformationUID` – The transformationUID of the transformation to delete.

**Returns:** The response to the transformation update request (JSON) or status/error message.

#### `getTransformationServices()`

Get all transformation services.

**Returns:** A list of transformation services (JSON).

---

### UI

```js
const uI = new UI(client);   // or new AsyncUI(client)
```

#### `getUIComponents(namespace, summary = false)`

Get all registered UI components in the specified namespace.

- `namespace` – The namespace for which UI components should be retrieved.
- `summary` – If true, only summary fields will be returned.

**Returns:** A list of UI components (JSON).

#### `addUIComponent(namespace, componentData)`

Add a UI component in the specified namespace.

- `namespace` – The namespace where the UI component should be added.
- `componentData` – The data of the UI component (JSON) to be added.

**Returns:** The response to the request (JSON).

#### `getUIComponent(namespace, componentUID)`

Get a specific UI component in the specified namespace.

- `namespace` – The namespace where the UI component is located.
- `componentUID` – The UID of the UI component to retrieve.

**Returns:** The UI component (JSON).

#### `updateUIComponent(namespace, componentUID, componentData)`

Update a specific UI component in the specified namespace.

- `namespace` – The namespace where the UI component should be updated.
- `componentUID` – The UID of the UI component to update.
- `componentData` – The new data for the UI component (JSON).

**Returns:** The response to the request (JSON).

#### `deleteUIComponent(namespace, componentUID)`

Remove a specific UI component in the specified namespace.

- `namespace` – The namespace where the UI component should be removed.
- `componentUID` – The UID of the UI component to delete.

**Returns:** The response to the request (JSON).

#### `getUITiles()`

Get all registered UI tiles.

**Returns:** A list of UI tiles (JSON).

---

### UUID

```js
const uUID = new UUID(client);   // or new AsyncUUID(client)
```

#### `getUUID()`

A unified unique id.

**Returns:** The UUID as String.

---

### Voice

```js
const voice = new Voice(client);   // or new AsyncVoice(client)
```

#### `getDefaultVoice(language = null)`

Gets the default voice.

**Returns:** A object with the details of the default voice.

#### `startDialog(sourceID, { ksID = null, sttID = null, ttsID = null, voiceID = null, hliIDs = null, sinkID = null, keyword = null, listeningItem = null, language = null } = {})`

Start dialog processing for a given audio source.

- `sourceID` – The ID of the audio source.
- `ksID` – The ID of the keyword spotter (optional).
- `sttID` – The ID of the speech-to-text system (optional).
- `ttsID` – The ID of the text-to-speech system (optional).
- `voiceID` – The ID of the voice (optional).
- `hliIDs` – A comma-separated list of interpreter IDs (optional).
- `sinkID` – The ID of the audio output (optional).
- `keyword` – The keyword used to start the dialog (optional).
- `listeningItem` – The name of the item to listen to (optional).
- `language` – The language for the request (optional).

**Returns:** The response from the server.

#### `stopDialog(sourceID)`

Stop dialog processing for a given audio source.

- `sourceID` – The ID of the audio source.

**Returns:** The response from the server.

#### `getInterpreters(language = null)`

Get the list of all interpreters.

- `language` – The language for the request (optional).

**Returns:** A list of interpreters if successful.

#### `interpretText(text, language = null)`

Sends a text to the default human language interpreter.

- `text` – The text to be interpreted.
- `language` – The language of the text.
- `IDs` – A list of interpreter IDs (optional).

**Returns:** The response from the server.

#### `getInterpreter(interpreterID, language = null)`

Gets a single interpreter.

- `interpreterID` – The ID of the interpreter.
- `language` – The language for the request (optional).

**Returns:** The details of the interpreter.

#### `interpretTextBatch(text, IDs, language = null)`

Sends a text to a given human language interpreter(s).

- `text` – The text to be interpreted.
- `language` – The language of the text.
- `IDs` – A list of interpreter IDs.

**Returns:** The response from the server.

#### `listenAndAnswer(sourceID, sttID, ttsID, voiceID, { hliIDs = null, sinkID = null, listeningItem = null, language = null } = {})`

Executes a simple dialog sequence without keyword spotting for a given audio source.

- `sourceID` – The ID of the audio source.
- `sttID` – The ID of the speech-to-text system.
- `ttsID` – The ID of the text-to-speech system.
- `voiceID` – The ID of the voice.
- `hliIDs` – A list of interpreter IDs (optional).
- `sinkID` – The ID of the audio output (optional).
- `listeningItem` – The name of the item to listen to (optional).
- `language` – The language for the request (optional).

**Returns:** The response from the server.

#### `sayText(text, voiceID, sinkID, volume = "100")`

Speaks a given text with a given voice through the given audio sink.

- `text` – The text to be spoken.
- `voiceID` – The ID of the voice.
- `sinkID` – The ID of the audio output.
- `volume` – The volume level (default: 100).

**Returns:** The response from the server.

#### `getVoices(language = null)`

Get the list of all voices.

**Returns:** A list of voices if successful.

---


## Upgrading from 1.x

Version 2 behaves like the Python library. Code written for 1.x needs these changes:

- Methods no longer throw for HTTP errors – they return `{ error: "…" }`. Replace `try/catch` around REST calls by a check of `result.error`.
- Empty answers are `{ message: "OK" }` (or `"Accepted."`, `"Subscription created."`, …) instead of `{ status: 200 }`.
- Create calls (`createRule`, `createThing`, `addUIComponent`, …) return a result object instead of a raw `Response`.
- Event methods return the stream or `{ error }`; read it with `iterSSEEvents` instead of a hand-written reader.
- `getItemPersistenceData` no longer sends `page=1&pagelength=50` by default.

## Development

```sh
npm run generate   # src/index.js and README.md from python-openhab-rest-client (needs Python 3)
npm run build      # dist/esm, dist/cjs, dist/types
npm test           # unit tests; integration tests run when OPENHAB_URL and OPENHAB_TOKEN are set
```

`npm run generate` uses the installed Python package (`pip install python-openhab-rest-client`) or a path: `bash tools/generate.sh path/to/python-openhab-rest-client/openhab`.

## Contributing

Contributions are welcome! Please create an issue or pull request. Changes to the REST classes belong into [python-openhab-rest-client](https://github.com/Michdo93/python-openhab-rest-client) – all three libraries are generated from the same source.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
