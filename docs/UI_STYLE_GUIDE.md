# UI Style Guide — signalk-pypilot-newui visor

Fecha: 2026-09-24. Motivo: Carlos identificó incoherencias entre cards
del Setup del visor y pidió auditar todo, escribir un libro de estilo,
y unificar.

Este documento es la **fuente de verdad** para los estilos de las
setup-cards del visor. Cualquier card nueva o refactor de card
existente debe seguirlo. Si necesitas algo que aquí no aparece,
propón añadirlo al doc antes de escribirlo en CSS/HTML.

---

## Referencia de oro: card "Conexión pypilot"

La card `data-block-key="connection"` es el ejemplo canónico. Sigue
este patrón siempre.

### Estructura

```html
<div class="setup-block" data-setup-order="N" data-block-key="X">
  <div class="section-title">Título de la card</div>
  <div class="setup-block-status" id="setup-status-X"></div>

  <div class="conn-sub">
    <div class="conn-sub-title">Título de la subsección</div>
    <!-- contenido -->
  </div>
  <div class="conn-sub">
    <div class="conn-sub-title">Otra subsección</div>
    <!-- contenido -->
  </div>
</div>
```

### Reglas de estilo

1. **Subsecciones**: siempre `.conn-sub`. Es la clase con separador
   `border-top: 1px dashed var(--border)` que Carlos elogia. Nunca
   `.smart-section` ni inline `border-top` a mano.
2. **Título de subsección**: siempre `.conn-sub-title`. Uppercase,
   11px, 800 weight, letter-spacing 1px, color `--fg-dim`. Deja el
   verdadero jerarquia visual con la parte de arriba.
3. **Nota o descripción**: siempre `.hint`. Sin `style="font-size:11px"`
   ni `style="font-size:12px"` inline — usa la clase pelada.
4. **Nota importante** (llamada de atención, warn, opt-in con riesgo):
   `.hint` + `style="color: var(--warn);"` (naranja). Ejemplo actual:
   `setup.absorb.hint` en Conexión pypilot.
5. **Estado en monospace** (status text con números): `.hint` +
   `style="font-family: ui-monospace, monospace;"`. Idealmente añadir
   utilidad `.mono` pero mientras eso no exista, este inline queda
   documentado como aceptable.
6. **Botones**: `.primary` para acción principal, `.ghost` para
   secundaria/destructiva. Nunca `class="secondary"`.
7. **Toggles / checkboxes touch-friendly**: `.smart-toggle-row` para
   fila (label + checkbox); `.ac-toggle` para toggle-switch (la card
   Alarms usa este).
8. **Sliders**: siempre vía JS `_buildSliderRow({...})`. Retorna
   `{row, rng, val, commit}` — appendChild(.row). Pasar
   `showBaseline: true` cuando quieras el "was: X" en naranja.
9. **Autosave**: no meter botón "Save" al pie de card. Cada cambio
   dispara un debounce corto (~800ms) y el save es transparente.
   Patrón: Smart Pilot Rev303 (`_smartMarkDirty`).
10. **Colores**: nunca hardcoded (`#e67e22`, `#2ecc71`). Siempre
    variables (`var(--warn)`, `var(--ok)`, `var(--err)`, `var(--border)`,
    `var(--engaged)`, `var(--fg-dim)`).
11. **Negritas**: `<b>` estándar.

---

## Auditoría de cards existentes (2026-09-24)

Snapshot de qué cards usan qué patrón.

| Card / block-key | Subsección | Título subsec. | Notas |
|---|---|---|---|
| `connection` | ✅ `conn-sub` | ✅ `conn-sub-title` | Referencia. Todo OK. |
| `calibration` | ✅ `conn-sub` | ✅ `conn-sub-title` | Coherente con connection. |
| `smartpilot` | ❌ `smart-section` inline | ❌ `section-title` con inline `font-size:13px` | **A unificar** (patrón viejo pre-Rev107). |
| `alarms` (Rev101) | (Sin subsecciones) | — | Lista de reglas via `_alRenderConfig`. Ver bloque separado abajo. |
| `precheck` | (Sin subsecciones) | — | Card simple. OK. |
| `doctor` | (Sin subsecciones) | — | Card simple con headline. OK. |
| `trips` | (Sin subsecciones) | — | Card simple. OK. |
| `quality` | (Sin subsecciones) | — | Card con tabla. OK. |
| `emergency` | ⚠ Sin subsecciones formales | Divs sueltos | Podría beneficiarse de `.conn-sub`. |
| `language` | (Sin subsecciones) | — | Card simple. OK. |

**Trabajo pendiente**:

- `smartpilot`: unificar sus 4 secciones internas usando `.conn-sub` +
  `.conn-sub-title`. Ver siguiente sección para el diff propuesto.
- `emergency`: mismo tratamiento si se quiere consistencia.
- `alarms` (Rev101): el listado de reglas ya usa `.ac-*` propio que
  funciona bien; el emoji de severidad (Rev303) es suficiente. Nada
  que unificar salvo mover la leyenda del semáforo a un `.hint.warn`
  o similar si conviene destacarla.

---

## Estilo "conn-sub" refactor — propuesta para smartpilot

Antes (`smart-section` con inline):
```html
<div class="smart-section" style="margin-top:14px;padding-top:10px;border-top:1px solid var(--border)">
  <div class="section-title" style="font-size:13px">Título</div>
  <div class="hint" style="font-size:11px">Descripción</div>
  <!-- contenido -->
</div>
```

Después (`conn-sub` limpio):
```html
<div class="conn-sub">
  <div class="conn-sub-title">Título</div>
  <div class="hint">Descripción</div>
  <!-- contenido -->
</div>
```

Impacto visual:
- Separador entre secciones pasa de línea sólida a **línea de puntos**
  (que Carlos elogia en connection).
- Título de subsección pasa a UPPERCASE 11px 800 letter-spacing 1px.
- Descripción hint queda a tamaño base (no forzado a 11px).

---

## Reglas duras a partir de hoy

- Nueva card = usar Conexión pypilot como plantilla.
- Nueva subsección = `.conn-sub` + `.conn-sub-title`.
- Nueva llamada de atención = `.hint` + `color: var(--warn)`.
- Cero `style="font-size:...`" ni `style="margin-top:..."` inline
  cuando la clase pelada da el resultado correcto.
- Ante duda: **grep en este documento primero, preguntar después.
  NO improvisar** (ver `feedback_no_ui_improvisation`).
