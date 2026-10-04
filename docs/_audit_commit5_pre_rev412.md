# Audit Commit 5 (pre-Rev412) — Hot-gains empopado (fix Q + W)

Fecha: 2026-10-04
Autor: Claude Opus 4.7
Contexto: siguiendo el plan post-sea-trial 2026-10-03 (Carlos pidió
orden "5 y 6 y luego 4"). Rev410 (Commit 2) y Rev411 (Commit 3)
desplegados y validados.

---

## Qué dice el audit original

De `docs/_audit_vt_pre_rev407.md`:

> **Q. `_empopadoApplyHotGains` lee `catalog[path].value` en vez del
> cache [CONFIRMADO audit externa]**
> - Catalog contiene metadatos (min/max/type), no valores actuales.
> - Resultado: aplica 0 ganancias. El modo empopado NO ajusta los PID
>   como se esperaba.
> - **Fix:** leer de `state.pypilotValues[path]` o similar cache de
>   valores actuales.
> - **Precaución Codex:** este fix activa ajustes de ganancia que
>   hasta ahora no se aplicaban. Hay que validar que las ganancias
>   calculadas tienen sentido. **Commit separado**.

> **Bug NUEVO — W**
> `_empopadoApplyHotGains` tiene flujo "fire-and-forget" con
> `.catch(() => {})` en línea 7358. Si el bug Q está activo (= siempre),
> los `applied` quedan `{}` pero el flow sigue como si todo bien. Al
> restaurar luego, `_empopadoRestoreHotGains` ve snap={} y no hace
> nada. **El sailor no recibe ningún feedback de que no se aplicaron
> las ganancias agresivas**. En un empopado con viento fuerte, esto
> es **peligroso** porque el sailor cree que tiene el pilot en modo
> "nervioso" pero sigue con PID normal.

---

## Confirmación por inspección del código actual

[public/app.js:7243-7270](public/app.js#L7243-L7270):

```js
async function _empopadoApplyHotGains(ap) {
  if (!ap || ap._hotGainSnapshot) return;
  const pilot = state.pilot;
  if (!pilot) return;
  const cat = state.catalog || {};                        // ← metadatos, no values
  const targets = [
    { path: `ap.pilot.${pilot}.P`,  mult: 1.5 },
    { path: `ap.pilot.${pilot}.D`,  mult: 1.7 },
    { path: `servo.max_slew_speed`, mult: 1.3 },
  ];
  const applied = {};
  for (const t of targets) {
    const entry = cat[t.path];
    const cur = entry?.value;                             // ← BUG Q: catalog no tiene .value
    if (typeof cur !== "number") continue;                // ← todo entra en continue
    const max = typeof entry.max === "number" ? entry.max : Infinity;
    const next = Math.min(cur * t.mult, max);
    if (Math.abs(next - cur) < 1e-6) continue;
    try {
      await pluginRaw(t.path, next);
      applied[t.path] = cur;
    } catch (e) { console.warn(...); }
  }
  ap._hotGainSnapshot = applied;                          // ← queda {} (BUG W: sin aviso)
}
```

Confirmado:
- `state.catalog` se puebla desde `GET /plugins/.../catalog` que retorna
  metadatos (type, min, max, units, description). **No** incluye `value`.
- Los valores actuales viven en `state.pypilotValues`, poblado por
  `refreshPypilotValues()` → `GET /plugins/.../values` (ver
  [public/app.js:6062-6090](public/app.js#L6062-L6090)).
- `state.pypilotValues["ap.pilot.basic.P"]` → número real (el PID
  actual). `state.catalog["ap.pilot.basic.P"].max` → techo que sí
  necesitamos para el clamp.

**Impacto confirmado**: `_empopadoApplyHotGains` nunca ha aplicado
ninguna gain desde Rev320. El modo "empopado agresivo" ha sido un
no-op funcional. Esto fue un **bug silencioso** durante toda la
historia del empopado — Carlos no lo notó porque también acompañaba
un cambio de perfil ("heavy / reactive") que SÍ se aplicaba y daba la
sensación de pilot más nervioso.

---

## Fix Q — leer del cache de valores actuales

```js
const cat = state.catalog || {};
const vals = state.pypilotValues || {};
// ...
for (const t of targets) {
  const entry = cat[t.path];
  const cur = vals[t.path];                               // ← fix
  if (typeof cur !== "number") continue;
  const max = typeof entry?.max === "number" ? entry.max : Infinity;
  // ... resto igual
}
```

El clamp con `entry?.max` es defensivo: si el pypilot no publica el
path en catalog (variantes de firmware), caemos a `Infinity` y el
multiplicador se aplica sin tope. Es el mismo comportamiento que
había pretendido el autor original.

### Validación de multiplicadores

Los multiplicadores están en línea 7220-7224:
- `P × 1.5`, `D × 1.7`, `SLEW × 1.3`

Pypilot típico (Tunatunes `basic` pilot):
- P≈0.003 → 0.0045 (max típico 0.01). OK.
- D≈0.15 → 0.255 (max típico 0.5). OK.
- `servo.max_slew_speed`≈4.0 → 5.2 (max típico 20). OK.

Los multiplicadores están **conservadores** y los `max` de catalog
los acotan. No es un cambio peligroso en sí mismo.

---

## Fix W — avisar si hot-gains quedan vacíos + badge HUD

### W.1 — Log warning si `applied` queda {} con targets válidos

Si todos los targets devuelven `typeof cur !== "number"` (p. ej.
porque `pilot` no está publicado o `pypilotValues` está sin cargar),
hoy el flow sigue silencioso. Cambio:

```js
if (Object.keys(applied).length === 0) {
  console.warn(`[empopado] hot gains NO aplicadas — pilot='${pilot}' vals keys=${Object.keys(vals).length}`);
}
```

### W.2 — Badge en HUD empopado

Añadir `data-hot="on|off|failed"` al container `#empopado-hud`:
- `on`: aplicó al menos una gain.
- `off`: salió sin aplicar nada (todas no-op, p. ej. ya en máximo).
- `failed`: intentó aplicar pero `pluginRaw` falló (puede pasar con
  Rev411 si pypilot refusa el write — ahora propaga 503).

El badge visible en el HUD:

```html
<span class="aproado-hud-hotbadge" id="empopado-hud-hotbadge"
      data-i18n="empopado.hud.hotbadge">PID normal</span>
```

CSS mínimo:
```css
.aproado-hud[data-hot="on"]     .aproado-hud-hotbadge { color: #58a; }
.aproado-hud[data-hot="failed"] .aproado-hud-hotbadge { color: #d44; }
.aproado-hud[data-hot="off"]    .aproado-hud-hotbadge { color: #888; }
```

Y en i18n:
- ES: `empopado.hud.hotbadge.on = "PID agresivo"`, `.off = "PID normal"`, `.failed = "PID fallo"`.
- EN: `"HOT PID"`, `"Normal PID"`, `"PID failed"`.

### W.3 — Restore también actualiza el badge

Cuando `_empopadoRestoreHotGains` revierte, `data-hot="off"`.

---

## Scope de Commit 5

| Fix | Riesgo | Ubicación |
|-----|--------|-----------|
| Q — leer `pypilotValues[path]` para `cur` | medio (activa comportamiento dormido) | `public/app.js` `_empopadoApplyHotGains` |
| W.1 — warning si `applied={}` | mínimo | idem |
| W.2 — badge en HUD + CSS + i18n | mínimo | `public/index.html`, `public/style.css`, `public/app.js` i18n keys |
| W.3 — badge off en restore | mínimo | `_empopadoRestoreHotGains` |

Rev target: Rev412.

### Nota de riesgo del fix Q

Este fix **activa un comportamiento dormido**. El empopado en viento
fuerte pasará a tener PID más agresivo que hasta ahora. Carlos debe
validar en agua que no causa oscilación. Los multiplicadores están
conservadores pero no son los que el autor original "había
validado" porque **nunca llegó a aplicarlos**. Mitigación:
- El badge W.2 hace visible el estado — Carlos puede abortar si lo ve
  en "PID agresivo" y el pilot oscila.
- Los `max` de catalog siguen acotando el techo.
- `_empopadoRestoreHotGains` ya restauraba (aunque con `{}` no hacía
  nada); ahora sí restaurará los valores previos.

### Preguntas abiertas

Ninguna crítica. El fix está autocontenido.
