# Audit Commit 4 (pre-Rev414) — AWA dampened (fix V)

Fecha: 2026-10-04
Autor: Claude Opus 4.7
Contexto: tras Commit 5 (Rev412 hot-gains) y Commit 6 (Rev413
settling-timeout toast), queda Commit 4 — AWA dampened.

---

## Qué dice el audit original

> **V. ¿Qué path consume el visor para AWA?**
> - Hipótesis: visor usa `environment.wind.angleApparent` (SK estándar,
>   raw del sensor).
> - Pypilot core expone también `wind.direction` (dampened?) y
>   `wind.compass_direction` (TWD).
> - **Investigar:** qué paths de pypilot están dampened. Posiblemente
>   cambiar el visor a usar el valor dampened para el render Y para
>   el cálculo del final target del VT.

Y la nota en Fix V (línea 313 del audit):
> en Commit 4: (a) añadir dampening local al visor con EMA (τ≈2s)
> para `state.windAngle` → `state.windAngleDampened`, (b) usar
> `windAngleDampened` en renderWindRose y en el cálculo del
> `angleStartRad` que pasamos a `computeTackGeometry` al pulsar TACK.
> Mantener `state.windAngle` raw para quien lo necesite.

---

## Hallazgos tras investigar hoy

### 1. Visor hoy usa `state.windAngle` raw de `environment.wind.angleApparent`

[public/app.js:2888-2889](public/app.js#L2888-L2889):
```js
case "environment.wind.angleApparent":
  state.windAngle = numericOrNull(value); break;
```

Consumers de `state.windAngle`:
- `renderWindRose` (dibujo del diamante AWA) — [public/app.js:3448-3452](public/app.js#L3448-L3452).
- Lecturas numéricas en ajustes/overlays.
- Logs de maneuver-trace.
- `_tackCountdownAwaSignAtStart` para decidir vueltas.
- `_detectManeuverKind` (lookup).

### 2. VT backend hoy NO recibe AWA del visor

Rev409 cambió el backend para leerse el AWA directamente del bus SK
en `startVirtualTack`
([src/autopilot-provider.ts:763-764](src/autopilot-provider.ts#L763-L764)):

```ts
const awaPath = windMode === "wind"
  ? "environment.wind.angleApparent"
  : "environment.wind.angleTrueWater";
```

→ **Un dampening client-side NO afecta a la geometría del VT**. Si
queremos que la rotación salga de un AWA menos ruidoso, hay que
dampear en backend.

### 3. Settling loop también usa raw AWA

[src/autopilot-provider.ts:1145-1151](src/autopilot-provider.ts#L1145-L1151):
```ts
const skPath = windMode === "wind" ? "environment.wind.angleApparent" : "environment.wind.angleTrueWater";
let windNowRad: number | null = null;
try {
  const p = this.app?.getSelfPath?.(skPath);
  const v = p?.value;
  if (typeof v === "number" && Number.isFinite(v)) windNowRad = v;
} catch { /* noop */ }
```

→ Un AWA ruidoso aquí es exactamente lo que provoca
`settling-timeout` (Commit 6). Dampear este loop es un fix directo
del Rev413 complementario.

### 4. No hay path "dampened" publicado por pypilot core en el bus SK

Grep de `wind.direction`, `wind.compass_direction`, `wind*filtered`,
`wind*smooth`, `wind*dampened` en todo `src/`: nada. Pypilot core
sí publica `wind.direction` internamente, pero no lo expone como SK
path (no está en el catalog). → Hay que dampear nosotros.

---

## Fix V — scope mínimo "menos es más"

### V.1 — Backend EMA durante settling (safety: ignora ruido)

Añadir EMA (τ=2 s = alpha ≈ 0.13 con tick 300 ms) a la lectura del
AWA en el while de settling. Reset al entrar a la fase.

```ts
setPhase("settling");
const settleStart = Date.now();
// Rev414 fix V.1: EMA τ≈2s to ignore raw AWA noise, which caused
// settling-timeout in Carlos's sea trials with AWS≈0.
let awaEmaRad: number | null = null;
const EMA_ALPHA = 0.13;
while (true) {
  // ...
  if (windNowRad !== null) {
    awaEmaRad = awaEmaRad === null ? windNowRad : awaEmaRad + EMA_ALPHA * normalizeSignedPi(windNowRad - awaEmaRad);
    const errDeg = Math.abs(((((awaEmaRad - geometry.angleNewRad) * RAD_TO_DEG) + 540) % 360) - 180);
    // ...
  }
}
```

Riesgo: medio. Si τ es muy largo el settling tarda más en confirmar;
si es muy corto el ruido pasa. τ=2s es el típico para AWS low (barco
en estela de ola, flapping AWA). Es la constante que Codex recomendó
en el audit externo.

**Importante**: wrap-around angular. Usar `normalizeSignedPi` para
que la diferencia nunca salte 360° (si angle pasa de +170° a -170°,
la diferencia bruta sería -340° pero realmente son 20°). Si no se
corrige, el EMA diverge.

### V.2 — Visor cosmético: dampened en renderWindRose

Añadir `state.windAngleDampened` también con EMA τ=2 s. Actualizar
dentro del case delta (misma frecuencia que el raw, ~1-2 Hz).
Mantener raw para logs y detección de signo.

Consumer único (minimizar impacto): `renderWindRose` lee dampened
sólo para la posición del diamante AWA. Los lookup de signo, lecturas
numéricas y detección de maneuver kind siguen leyendo raw.

Riesgo: mínimo (sólo rendering).

### V.3 — Fuera de scope en este commit

- Dampear el AWA en `startVirtualTack` (lectura inicial del
  `angleStartRad`). Carlos quiere que el TACK se dispare contra el
  valor instantáneo que vé: si dampea, el sailor pulsa TACK con el
  diamante a +45° pero el backend arranca con +43° suavizado, y
  Carlos puede percibir "va a destino incorrecto". Mejor dejarlo
  raw y confiar en la instrumentación Rev410 fix S + Rev407.
- EMA alpha configurable por Setup. Introducir una constante y basta;
  si Carlos quiere tunearla, pedir en un commit aparte.

---

## Scope de Commit 4

| Fix | Riesgo | Ubicación |
|-----|--------|-----------|
| V.1 — Backend EMA en settling | medio | `src/autopilot-provider.ts` _runVirtualTack settling loop |
| V.2 — Visor state.windAngleDampened + renderWindRose | mínimo | `public/app.js` delta + renderWindRose |

Rev target: Rev414.

### Preguntas abiertas

Ninguna crítica. Procedo con τ=2 s y EMA simple. Si tras QA Carlos
nota que settling tarda demasiado, bajamos τ a 1 s en un rev de
tuneo.
