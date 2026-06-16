# npm-Paket veröffentlichen — Schritt-für-Schritt

## Voraussetzungen

- Node.js ≥ 18 installiert (`node --version`)
- npm Account unter https://www.npmjs.com/signup erstellt
- (Optional) GitHub-Repository für das Paket

---

## 1. Paket bauen

```bash
cd openhab-js
npm run build
```

Erzeugt:
- `dist/esm/index.js`  — ES Module
- `dist/cjs/index.js`  — CommonJS (require)
- `dist/types/index.d.ts` — TypeScript-Typen

---

## 2. npm-Account einrichten

### Account erstellen (einmalig)
```bash
# Auf npmjs.com registrieren, dann:
npm login
# → Username eingeben
# → Passwort eingeben
# → E-Mail eingeben
# → OTP (One-Time Password) aus E-Mail eingeben
```

Eingeloggten User prüfen:
```bash
npm whoami
# → michdo93
```

---

## 3. Paketname prüfen

```bash
# Prüfen ob der Name schon vergeben ist:
npm search openhab-rest-client

# Oder direkt auf npmjs.com:
# https://www.npmjs.com/package/openhab-rest-client
```

Falls der Name belegt ist, in `package.json` anpassen — z.B. mit Scope:
```json
{
  "name": "@michdo93/openhab-rest-client"
}
```

Scoped Pakete sind immer unter dem eigenen Username verfügbar.

---

## 4. package.json finalisieren

```json
{
  "name": "openhab-rest-client",
  "version": "1.0.0",
  "description": "JavaScript client for the openHAB REST API",
  "author": "Michael Christian Dörflinger <michaeldoerflinger93@gmail.com>",
  "license": "MIT",
  "homepage": "https://github.com/Michdo93/js-openhab-rest-client",
  "repository": {
    "type": "git",
    "url": "https://github.com/Michdo93/js-openhab-rest-client.git"
  },
  "keywords": ["openhab", "smarthome", "iot", "rest", "api", "home-automation"]
}
```

---

## 5. Trockenlauf (dry run)

Zeigt genau, was ins Paket kommt, ohne es zu veröffentlichen:

```bash
npm pack --dry-run
```

Ausgabe sieht so aus:
```
npm notice Tarball Contents
npm notice 1.1kB  LICENSE
npm notice 3.5kB  README.md
npm notice 53.1kB dist/cjs/index.js
npm notice 52.5kB dist/esm/index.js
npm notice 18.8kB dist/types/index.d.ts
npm notice 1.1kB  package.json

npm notice package size: 18.2 kB
npm notice unpacked size: 130.2 kB
```

Richtig: `src/`, `test/`, `scripts/` sind **nicht** enthalten (durch `.npmignore`).

---

## 6. Veröffentlichen

```bash
# Erstveröffentlichung (public):
npm publish --access public

# Bei einem Scoped Paket (@michdo93/...) ist --access public Pflicht,
# sonst ist es standardmäßig private (kostenpflichtig).
```

Erfolgreiche Ausgabe:
```
npm notice Publishing to https://registry.npmjs.org/
+ openhab-rest-client@1.0.0
```

Das Paket ist sofort verfügbar unter:
`https://www.npmjs.com/package/openhab-rest-client`

---

## 7. Version hochzählen und neu veröffentlichen

npm folgt **Semantic Versioning** (`MAJOR.MINOR.PATCH`):

| Änderungstyp | Befehl | Beispiel |
|---|---|---|
| Bugfix, keine API-Änderung | `npm version patch` | 1.0.0 → 1.0.1 |
| Neue Methoden, abwärtskompatibel | `npm version minor` | 1.0.0 → 1.1.0 |
| Breaking Changes | `npm version major` | 1.0.0 → 2.0.0 |

```bash
# Patch-Update (z.B. Bugfix):
npm version patch
npm run build
npm publish --access public

# Minor-Update (z.B. neue Methode):
npm version minor
npm run build
npm publish --access public
```

`npm version` aktualisiert `package.json` und erstellt automatisch einen Git-Tag.

---

## 8. Paket lokal testen vor Veröffentlichung

### Option A: npm link (symlink in globale node_modules)

```bash
cd openhab-js
npm run build
npm link

# In einem anderen Projekt:
cd /pfad/zu/mein-projekt
npm link openhab-rest-client

# Testen:
node -e "const { OpenHABClient } = require('openhab-rest-client'); console.log('OK');"
```

### Option B: Lokaler Pfad in package.json

```json
{
  "dependencies": {
    "openhab-rest-client": "file:../openhab-js"
  }
}
```

```bash
npm install
```

### Option C: npm pack + install .tgz

```bash
cd openhab-js
npm run build
npm pack
# → erzeugt openhab-rest-client-1.0.0.tgz

cd /pfad/zu/mein-projekt
npm install ../openhab-js/openhab-rest-client-1.0.0.tgz
```

---

## 9. GitHub Actions — automatisches Publizieren (optional)

Datei `.github/workflows/publish.yml` im Repository anlegen:

```yaml
name: Publish to npm

on:
  push:
    tags:
      - 'v*'   # Trigger bei jedem Tag wie v1.0.1, v2.0.0

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          registry-url: 'https://registry.npmjs.org'

      - run: npm run build

      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

npm-Token in GitHub hinterlegen:
1. Auf npmjs.com → Account → Access Tokens → Generate New Token → "Automation"
2. In GitHub-Repository → Settings → Secrets → New Secret → `NPM_TOKEN`

Danach reicht ein Git-Tag für automatische Veröffentlichung:
```bash
git tag v1.0.1
git push origin v1.0.1
```

---

## 10. Paket zurückziehen (falls nötig)

```bash
# Nur innerhalb von 72 Stunden nach Veröffentlichung möglich:
npm unpublish openhab-rest-client@1.0.0

# Oder deprecated markieren (besser als unpublish):
npm deprecate openhab-rest-client@1.0.0 "Bitte Version 2.0.0 verwenden"
```

---

## Kurzübersicht der wichtigsten Befehle

```bash
npm login                          # Einloggen
npm whoami                         # Eingeloggten User prüfen
npm run build                      # Paket bauen
npm pack --dry-run                 # Vorschau was publiziert wird
npm publish --access public        # Veröffentlichen
npm version patch|minor|major      # Version hochzählen
npm deprecate <pkg>@<ver> "..."    # Als veraltet markieren
npm unpublish <pkg>@<ver>          # Zurückziehen (max. 72h)
```
