/**
 * SSE Streaming Test
 *
 * Lauscht 10 Sekunden auf ItemStateChangedEvent und zeigt
 * alle eingehenden Events an. Parallel dazu sendet es alle
 * 2 Sekunden einen Befehl an testSwitch, um Events auszulösen.
 *
 * Ausführen:
 *   node test/test-sse.js
 */

import { OpenHABClient, ItemEvents, Items } from "../dist/esm/index.js";

const URL      = "http://127.0.0.1:8080";
const USERNAME = "openhab";
const PASSWORD = "habopen";
const ITEM     = "testSwitch";
const DURATION = 10_000; // ms

const GREEN  = "\x1b[32m";
const YELLOW = "\x1b[33m";
const PURPLE = "\x1b[35m";
const DIM    = "\x1b[2m";
const BOLD   = "\x1b[1m";
const RESET  = "\x1b[0m";

async function main() {
  console.log(`\n${BOLD}╔════════════════════════════════════════╗`);
  console.log(`║    openhab-rest-client — SSE Test      ║`);
  console.log(`╚════════════════════════════════════════╝${RESET}`);
  console.log(`  Item: ${YELLOW}${ITEM}${RESET}   Dauer: ${DURATION / 1000}s\n`);

  const client     = new OpenHABClient(URL, USERNAME, PASSWORD);
  const itemsAPI   = new Items(client);
  const itemEvents = new ItemEvents(client);

  await client.login();
  if (!client.isLoggedIn) {
    console.error("Verbindung fehlgeschlagen.");
    process.exit(1);
  }
  console.log(`  ${GREEN}✓${RESET} Verbunden\n`);

  // ── SSE-Stream öffnen ──────────────────────────────────────────────────────
  console.log(`  ${PURPLE}⚡${RESET} Öffne SSE-Stream: ItemStateChangedEvent("${ITEM}") …\n`);
  const response = await itemEvents.ItemStateChangedEvent(ITEM);

  if (!response.ok) {
    console.error(`SSE-Stream Fehler: HTTP ${response.status}`);
    process.exit(1);
  }

  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  let   buffer  = "";
  let   count   = 0;

  // ── Stop nach DURATION ms ──────────────────────────────────────────────────
  const timer = setTimeout(() => {
    reader.cancel();
  }, DURATION);

  // ── Kommandos senden, um Events zu erzeugen ────────────────────────────────
  let toggle   = true;
  const sender = setInterval(async () => {
    const cmd = toggle ? "ON" : "OFF";
    await itemsAPI.sendCommand(ITEM, cmd).catch(() => {});
    console.log(`  ${DIM}→ sendCommand ${ITEM} ${cmd}${RESET}`);
    toggle = !toggle;
  }, 2000);

  // ── Stream lesen ───────────────────────────────────────────────────────────
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop(); // letztes unvollständiges Stück aufheben

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;

        count++;
        try {
          const event = JSON.parse(raw);
          const ts    = new Date().toLocaleTimeString("de-DE");
          console.log(`  ${PURPLE}⚡${RESET} [${ts}] ${GREEN}${event.type ?? "Event"}${RESET}`);
          if (event.payload) {
            try {
              const payload = JSON.parse(event.payload);
              console.log(`     ${DIM}topic:   ${event.topic ?? "—"}${RESET}`);
              console.log(`     ${DIM}value:   ${payload.value ?? JSON.stringify(payload)}${RESET}`);
              if (payload.oldValue !== undefined)
                console.log(`     ${DIM}oldValue: ${payload.oldValue}${RESET}`);
            } catch {
              console.log(`     ${DIM}payload: ${event.payload}${RESET}`);
            }
          }
        } catch {
          console.log(`  ${PURPLE}⚡${RESET} ${DIM}${raw}${RESET}`);
        }
      }
    }
  } catch (e) {
    if (!e.message?.includes("cancel")) console.error("Stream-Fehler:", e.message);
  } finally {
    clearTimeout(timer);
    clearInterval(sender);
  }

  console.log(`\n  ${GREEN}✓${RESET} Stream beendet — ${count} Event(s) empfangen in ${DURATION / 1000}s\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
