
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
