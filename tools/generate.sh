#!/bin/bash
# Regenerates src/index.js and README.md from python-openhab-rest-client.
#   bash tools/generate.sh [path/to/python-openhab-rest-client/openhab]
set -e
cd "$(dirname "$0")/.."
PY=${1:-$(python3 -c 'import openhab, os; print(os.path.dirname(openhab.__file__))')}
python3 tools/py2js.py "$PY" \
  | sed -E 's/^const __generatedClasses = \{ (.*) \};$/export { \1 };/' > tools/.classes.js
mkdir -p src
cat tools/core_head.js tools/.classes.js tools/core_tail.js > src/index.js
rm tools/.classes.js
python3 tools/py2js.py "$PY" --markdown > tools/reference.md
cat tools/readme_head.md tools/reference.md tools/readme_tail.md > README.md
echo "generated from $PY: $(wc -l < src/index.js) lines"
