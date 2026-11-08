// Integration tests against a real openHAB 5 (skipped without OPENHAB_URL).
//   OPENHAB_URL=http://127.0.0.1:8080 OPENHAB_TOKEN=oh.xxx npm test
// Needs an item "JsTest_Switch" free to create/delete and the openHAB demo of
// your choice; everything the tests create is removed again.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as oh from "../dist/esm/index.js";

const url = process.env.OPENHAB_URL;
const skip = url ? false : "OPENHAB_URL not set";
const client = url ? new oh.OpenHABClient(url, process.env.OPENHAB_USER || null,
  process.env.OPENHAB_PASSWORD || null, process.env.OPENHAB_TOKEN || null) : null;
const NAME = "JsTest_Switch";

test("connection", { skip }, async () => {
  await client.ready;
  assert.ok(client.isLoggedIn);
  assert.ok((await new oh.Systeminfo(client).getSystemInfo()).systemInfo);
});

test("item lifecycle, command and state event", { skip }, async () => {
  const items = new oh.Items(client);
  await items.addOrUpdateItem(NAME, { type: "Switch", name: NAME, label: "JS Test" });
  try {
    const stream = await new oh.ItemEvents(client).ItemStateChangedEvent(NAME);
    setTimeout(() => items.sendCommand(NAME, "ON", "js-test"), 300);
    const timer = setTimeout(() => stream.abort(), 5000);
    let event;
    for await (const e of oh.iterSSEEvents(stream)) { event = e; break; }
    clearTimeout(timer);
    assert.equal(event.payload.value, "ON");
    assert.equal(await items.getItemState(NAME), "ON");
    assert.deepEqual(await items.postUpdate(NAME, "OFF"), { message: "Accepted." });
    assert.deepEqual(await items.sendCommand(NAME, "BLAU"), { error: "Invalid command for this item." });
  } finally {
    assert.deepEqual(await items.deleteItem(NAME), { message: "OK" });
  }
  assert.deepEqual(await items.getItem(NAME), { error: "Item not found." });
});

test("rule: create, change module parameter, run, delete", { skip }, async () => {
  const rules = new oh.Rules(client);
  const items = new oh.Items(client);
  await items.addOrUpdateItem(NAME, { type: "Switch", name: NAME });
  try {
    await rules.createRule({ uid: "jstest", name: "JS test", triggers: [], conditions: [],
      actions: [{ id: "1", type: "core.ItemCommandAction", configuration: { itemName: NAME, command: "OFF" } }] });
    assert.deepEqual(await rules.setModuleConfigParam("jstest", "actions", "1", "command", "ON"), { message: "OK" });
    assert.equal(await rules.getModuleConfigParam("jstest", "actions", "1", "command"), "ON");
    await rules.runNow("jstest");
    await new Promise(r => setTimeout(r, 500));
    assert.equal(await items.getItemState(NAME), "ON");
  } finally {
    await rules.deleteRule("jstest");
    await items.deleteItem(NAME);
  }
});

test("links: deleteAllLinks returns the count", { skip }, async () => {
  const things = await new oh.Things(client).getThings(true);
  const thing = things.find(t => t.statusInfo?.status === "ONLINE");
  if (!thing) return;
  const full = await new oh.Things(client).getThing(thing.UID);
  const channel = full.channels.find(c => c.kind === "STATE");
  if (!channel) return;
  const items = new oh.Items(client);
  await items.addOrUpdateItem(NAME, { type: channel.itemType || "String", name: NAME });
  try {
    await new oh.Links(client).linkItemToChannel(NAME, channel.uid, {});
    assert.deepEqual(await new oh.Links(client).deleteAllLinks(NAME), { count: 1 });
  } finally {
    await items.deleteItem(NAME);
  }
});
