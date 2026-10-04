# Audit Commit 6 (pre-Rev413) — Settling / completed semántica (fix C)

Fecha: 2026-10-04
Autor: Claude Opus 4.7
Contexto: Rev412 (Commit 5) desplegado. Toca Commit 6 — fix C del
audit Rev407.

---

## Qué dice el audit original

> **C. Settling declara "completed" por tiempo sin convergencia
> [CONFIRMADO audit externa]**
> - Si no hay `environment.wind.angleApparent` o si el AWA es ruidoso
>   y nunca cae dentro de SETTLE_TOLERANCE_DEG (10°), tras 15 s declara
>   completed/ok.
> - **Fix:** separar outcome en `completed` (dwell confirmado) vs
>   `settling-timeout` (sin confirmar).

---

## Estado actual tras Rev407

El backend YA separa el outcome
([src/autopilot-provider.ts:1174](src/autopilot-provider.ts#L1174)):

```ts
setPhase("completed", settledOk ? "ok" : "settling-timeout");
```

`outcomeReason` se publica en el snapshot `state.virtualTack`
([src/index.ts:3604](src/index.ts#L3604)). SETTLE_TIMEOUT_MS=30000ms,
SETTLE_DWELL_MS=2000ms, SETTLE_TOLERANCE_DEG=10°.

→ **El backend ya es correcto**. Lo que falta es que **el visor
distinga** en el case terminal.

---

## Confirmación del gap en el visor

[public/app.js:2639-2672](public/app.js#L2639-L2672):

```js
if (wasActive && !isActive) {
  // ...
  if (terminalPhase === "completed" && typeof state.virtualTack?.finalWindTargetRad === "number") {
    state.target = state.virtualTack.finalWindTargetRad;      // ← mismo tratamiento
  }
  // ...
  if (terminalPhase === "failed") {
    // toast rojo "Virada fallida: {reason}"              ← Rev410 U.3
  }
  // ...  cancelled: silent
}
```

Hoy un `completed:settling-timeout` queda **indistinguible** de un
`completed:ok` para el sailor:
- Mismo target aplicado.
- Sin toast.
- Sin voz.

Pero técnicamente la virada **completó la rotación** (el barco está
en el nuevo rumbo compass), lo que no se confirmó es la convergencia
en espacio AWA. En viento muy ruidoso o AWA con flapping, esto puede
ser normal.

---

## Fix C — distinguir `settling-timeout` en el visor

### C.1 — Toast informativo amarillo

Si `terminalPhase === "completed" && outcomeReason === "settling-timeout"`:
- Toast amarillo (warn, no error) "Virada completada, viento sin converger".
- Voz suave "virada completada".
- No bloqueante — el target se aplica igual (la rotación compass sí
  terminó).

Reutilizar `#pypilot-reconnect-toast` ya instrumentado para el toast
U.3 de Rev410. Añadir una clase CSS `.warn` para diferenciar color.

### C.2 — i18n

```
empopado.NA (no toca empopado)
tack.vtCompletedTimeout = "Virada completada, viento sin converger"
tack.vtCompletedTimeoutSpeak = "virada completada"
```

### C.3 — CSS variant

```css
.pypilot-reconnect-toast.warn { background: var(--warn); color: #222; }
```

### C.4 — Posible fuente del settling-timeout: AWA roto

Carlos ya tiene reportado "en viento flojo, AWS≈0, el AWA es ruido".
Esto es exactamente la condición para settling-timeout. Commit 4
(AWA dampened) debería mejorar la convergencia. Hasta entonces, al
menos el sailor ve que la virada terminó sin convergir y puede
decidir si re-nudgear.

---

## Scope de Commit 6

| Fix | Riesgo | Ubicación |
|-----|--------|-----------|
| C.1 — toast warn settling-timeout | mínimo | `public/app.js` case virtualTack terminal |
| C.2 — i18n ES + EN | mínimo | `public/app.js` _i18n |
| C.3 — CSS .warn para toast | mínimo | `public/style.css` |

Rev target: Rev413. Build + deploy + QA Rev413.

Fuera de scope:
- Modificar los umbrales SETTLE_* del backend (Rev407 ya los puso
  conservadores a 10°/30s).
- Cambiar la decisión de aplicar target final en caso de timeout —
  Carlos ya decidió "nos quedamos en ese rumbo tras cualquier
  maniobra" en Rev407.

No hay preguntas abiertas. Procedo.
