# SF Housing Simulator

A free, open-source tool for painting zoning and building changes onto a map of San Francisco and seeing the theoretical maximum buildout against housing targets. Numbers are a ceiling on what the rules allow, not a forecast.

Built with SvelteKit 2, Svelte 5 and Tailwind 4 on Cloudflare Workers (D1 + R2). No paid APIs or vendor keys are needed to run or build it.

## Quick start

```bash
nvm use
npm install
npm run data:fixture   # fixture dataset into local R2
npm run db:migrate     # local D1
npm run dev
```

Run the checks with `npm run check`, `npm run lint` and `npm test`.

## Documentation

Contributor and agent guidance lives in [CLAUDE.md](CLAUDE.md), which indexes the developer docs in [docs/dev/](docs/dev/). Design documents and specs are under `docs/superpowers/`.

## Licences

- **Code:** MIT, see [LICENSE](LICENSE).
- **Data:** the OpenStreetMap/Protomaps basemap and Overture Maps data are under the ODbL; DataSF data is under the PDDL / public domain. Derived files served under `/data/` that incorporate OpenStreetMap or Overture data are made available under the ODbL 1.0. Sources, vintages and licences for the current dataset are listed in the app at `/attribution`.
