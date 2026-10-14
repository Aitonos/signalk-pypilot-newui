# TODO — próxima publish (3.1.3 o 3.2.0)

## README: cambiar recomendación de chart provider

En `README.md` sección **"Chart provider is required for the embedded plotter"**:

Actualmente recomienda:
```markdown
- **[`@signalk/charts-plugin`](https://www.npmjs.com/package/@signalk/charts-plugin)**
  — serves local MBTiles / S57 / XYZ chart sets you drop into
  `~/.signalk/charts/` (OpenCPN-style). Recommended default.
```

Cambiar a (recomendado por dirkwa, mantenedor de signalk-collision-alerts
con quien tenemos coordinación activa):

```markdown
- **[`signalk-charts-provider-simple`](https://github.com/dirkwa/signalk-charts-provider-simple)**
  by @dirkwa — simple provider that serves local chart tilesets.
  Recommended for Freeboard-SK embedded in pypilot-newui.
- **[`@signalk/charts-plugin`](https://www.npmjs.com/package/@signalk/charts-plugin)**
  — the official SK provider, serves local MBTiles / S57 / XYZ chart
  sets you drop into `~/.signalk/charts/` (OpenCPN-style).
```

Carlos 2026-10-11: "Me refería a esto: https://github.com/dirkwa/signalk-charts-provider-simple
Este recomendado. Cuando publiquemos nueva version lo cambiamos."

## Otras cosas acumuladas para próxima publish

- CHANGELOG section 3.1.3 con el stack Rev460-Rev464:
  - Rev460: callback para que el refresh async actualice el slider al vuelo.
  - Rev461: Freeboard embed persistente + refresh periódico 10s.
  - Rev462: harbor auto re-instaurado + X no tapa MMSI + log [ais pos].
  - Rev463: fix root cause URN duplicado en MMSI (`_mmsiFromAlarmPath`).
  - Rev464: toggle UI para desactivar harbor-auto desde el overlay-card.
