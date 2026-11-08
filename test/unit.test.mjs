// Unit tests without openHAB: a tiny local HTTP server records what the client sends.
// Run: npm test
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import * as oh from "../dist/esm/index.js";

let server, base, last;
before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", d => (body += d));
    req.on("end", () => {
      last = { method: req.method, url: req.url, headers: req.headers, body };
      if (req.url.startsWith("/rest/events")) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write('event: message\ndata: {"topic":"openhab/items/A/statechanged","payload":"{\\"value\\":\\"ON\\"}","type":"ItemStateChangedEvent"}\n\n');
        res.write('event: alive\ndata: {"type":"ALIVE","interval":10}\n\n');
        res.end('data: {"topic":"openhab/items/B/statechanged","payload":"{\\"value\\":\\"OFF\\"}","type":"ItemStateChangedEvent"}\n\n');
        return;
      }
      if (req.url.startsWith("/rest/items/Missing")) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":{"message":"Item Missing does not exist!","http-code":404}}');
        return;
      }
      if (req.url.startsWith("/rest/items/Empty")) { res.writeHead(202); res.end(); return; }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server.close());

test("Basic authentication encodes UTF-8 credentials", async () => {
  const c = new oh.OpenHABClient(base, "admin", "pässwörd");
  await c.ready;
  assert.equal(Buffer.from(last.headers.authorization.slice(6), "base64").toString(), "admin:pässwörd");
});

test("token wins over Basic authentication", async () => {
  const c = new oh.OpenHABClient(base, "u", "p", "oh.token.x");
  await c.get("/items");
  assert.equal(last.headers.authorization, "Bearer oh.token.x");
});

test("paths get the /rest prefix exactly once", async () => {
  const c = new oh.OpenHABClient(base);
  for (const p of ["items", "/items", "rest/items", "/rest/items"]) {
    await c.get(p);
    assert.equal(last.url, "/rest/items");
  }
});

test("channel UIDs with # are escaped", async () => {
  const c = new oh.OpenHABClient(base);
  await new oh.Links(c).getLink("Item", "astro:sun:home:rise#start");
  assert.equal(last.url, "/rest/links/Item/astro%3Asun%3Ahome%3Arise%23start");
  await new oh.Actions(c).getActions("mqtt:topic:x#y");
  assert.match(last.url, /%23y$/);
});

test("commands are sent as text/plain with source parameter", async () => {
  const c = new oh.OpenHABClient(base);
  const r = await new oh.Items(c).sendCommand("Dimmer", 30, "test");
  assert.deepEqual(r, {});
  assert.equal(last.body, "30");
  assert.equal(last.headers["content-type"], "text/plain");
  assert.equal(last.url, "/rest/items/Dimmer?source=test");
});

test("empty 202 body becomes { message: 'Accepted.' }", async () => {
  const c = new oh.OpenHABClient(base);
  assert.deepEqual(await new oh.Items(c).postUpdate("Empty", "ON"), { message: "Accepted." });
});

test("errors are returned as { error } like in the Python library", async () => {
  const c = new oh.OpenHABClient(base);
  assert.deepEqual(await new oh.Items(c).getItem("Missing"), { error: "Item not found." });
  await assert.rejects(c.get("/items/Missing"), e => e instanceof oh.OpenHABHTTPError && e.status === 404
    && e.openhabMessage === "Item Missing does not exist!");
});

test("logout sends a form body", async () => {
  const c = new oh.OpenHABClient(base);
  await new oh.Auth(c).logout("refresh", "session");
  assert.equal(last.headers["content-type"], "application/x-www-form-urlencoded");
  assert.equal(last.body, "refresh_token=refresh&id=session");
});

test("persistence data: no paging unless asked for", async () => {
  const c = new oh.OpenHABClient(base);
  await new oh.Persistence(c).getItemPersistenceData("T", "inmemory", { startTime: "2026-01-01T00:00:00Z" });
  assert.doesNotMatch(last.url, /page/);
  await new oh.Persistence(c).getItemPersistenceData("T", "inmemory", { pageLength: 10 });
  assert.match(last.url, /page=0&pagelength=10/);
});

test("iterSSEEvents decodes payloads and skips ALIVE", async () => {
  const c = new oh.OpenHABClient(base);
  const stream = await new oh.ItemEvents(c).ItemStateChangedEvent();
  assert.equal(new URL(last.url, base).searchParams.get("topics"), "openhab/items/*/statechanged");
  const events = [];
  for await (const e of oh.iterSSEEvents(stream)) events.push(e.payload.value);
  assert.deepEqual(events, ["ON", "OFF"]);
});

test("parseSSEData", () => {
  assert.equal(oh.parseSSEData("event: message"), null);
  assert.equal(oh.parseSSEData("data: 5f0c-connection-id"), null);
  assert.deepEqual(oh.parseSSEData('data: {"type":"ALIVE"}'), { type: "ALIVE" });
});
