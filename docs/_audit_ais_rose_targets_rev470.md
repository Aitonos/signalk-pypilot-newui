# Audit — targets AIS en la rosa (posición + proyección) — pre-Rev470

Fecha: 2026-10-14. Reporte Carlos con 3 capturas (10:42-10:44, amarrado en
Moaña): alarma **PELAGOS** (CPA 0.02 NM, 0 min, "Closing 4.8 kn"). El hull
del target sale montado sobre el SVG central del propio barco y la línea
de proyección "no tiene nada que ver con la realidad".

Código: `public/app.js` `renderAisAlarms()` (aprox. L4200-4380) y
`_handleAisAlarmDelta()` (aprox. L4102). DOM: `public/index.html` L160-182
(`#rose-boat`) y L578 (`#ais-alarm-layer`).

## Datos reales (SK REST en el Pi5, 2026-10-14 17:53 local)

| Vessel | lat, lon | SOG | COG | headingTrue |
|---|---|---|---|---|
| TUNATUNES (self) | 42.27610, -8.734712 | 0 | — | 5.058 rad = **289.8°** |
| PELAGOS 244060022 | 42.276547, -8.734785 | **0.051 m/s (0.1 kn)** | 5.582 rad = 319.8° | — (no publica) |

Geometría: distancia aproximada de **50 m (0.027 NM)**, demora absoluta de
aproximadamente 353°. Demora relativa = 353 − 290 = **+63°** (amura de
estribor).

## Bug 1 — el target queda debajo del propio casco (escala radial)

- La rosa tiene radio `R = 92` (viewBox de 200 unidades).
- El propio barco es `boat-cenital.svg` 456 × 152 con `scale(0.22)`, o sea
  **100 × 33 unidades**. La semieslora es de **50 unidades = 54 % del radio**.
- La escala AIS es lineal hasta `AIS_RADIAL_MAX_NM = 2.0`, con un suelo
  `AIS_RADIAL_MIN_FRAC = 0.18`, que equivale a **16.6 unidades**.
- Cualquier target a menos de aproximadamente 0.36 NM cae en el suelo
  (16.6 u), **dentro de la silueta del propio barco**. En puerto o
  fondeadero eso son todos los targets.
- PELAGOS: 0.027/2 = 0.0135 se lleva al suelo de 0.18, con offset
  (+14.8, −7.5) u. Es justo donde aparece en la captura 3: pegado al mástil,
  a estribor.

La posición angular es **correcta** (+63°). Lo que falla es la escala.

## Bug 2 — el casco y la proyección apuntan 180° al revés

`boat-cenital.svg` dibuja la proa en **+x local**. El propio barco usa
`rotate(-90)` para tener la proa arriba. En SVG, `rotate(θ)` positivo gira
en sentido horario (y hacia abajo).

Rev457 usa `hullRotDeg = cogRelDeg + 90`:

| cogRel | rotate | +x acaba apuntando | Correcto |
|---|---|---|---|
| 0° (mismo rumbo que nosotros) | 90° | **abajo** | arriba |
| +90° (cruza a estribor) | 180° | **izquierda** | derecha |

El `+90` se copió de la rama fallback (`relDeg + 90`). Esa rama SÍ es
correcta, porque allí queremos que la proa apunte **hacia el centro**, es
decir, en sentido opuesto a la demora. Para el COG el término es **−90**.

Con PELAGOS: cogRel = 319.8 − 289.8 = +30°. Hoy rota 120° y la línea sale
hacia abajo-izquierda (en la captura 3 la línea discontinua va hacia el
sector 210-240). Lo correcto sería −60°, hacia arriba-derecha.

**Fix**: `hullRotDeg = cogRelDeg - 90`.

## Bug 3 — un COG de un barco parado es ruido

PELAGOS tiene SOG de 0.1 kn y no publica `headingTrue`. Su COG (320°) es
ruido del GPS. Aunque el signo estuviera bien, la proyección mentiría.

Regla propuesta:
1. Orientación del casco: `headingTrue` si existe. Si no existe, el COG solo
   cuando SOG ≥ 0.5 kn. Si no hay ninguno de los dos, se dibuja el casco
   orientado hacia nosotros, sin línea, como fallback actual.
2. **Línea de proyección solo si SOG ≥ 0.5 kn** y siempre a lo largo del
   **COG** (el rumbo efectivo, no la proa). Un barco parado no tiene
   proyección.
3. Para eso el cache `_aisRefreshTargetPos` tiene que pedir también
   `navigation/headingTrue`.

## Bug 4 — el filtro "estacionario" no se re-evalúa al llegar el cache

`_handleAisAlarmDelta` decide `targetStationary` con
`state.aisTargetPos.get(mmsi)` **en el momento del delta**. En el primer
delta el cache está vacío, así que el target entra en `state.aisAlarms`.
Después `_aisRefreshTargetPos` llena el cache (SOG 0.05 m/s < 0.08) pero
solo llama a `renderAisAlarms()`: **no lo saca del Map**. Si
collision-alerts no vuelve a emitir un delta (lo hace al cambiar de
estado), PELAGOS se queda pintado y alarmando aunque esté amarrado.

Encaja con el "Closing 4.8 kn" absurdo: el visor muestra `range/tcpa` con
una tcpa casi cero, calculada a partir del ruido del GPS de dos barcos
parados.

**Fix**: mover el gate (modo + estacionario) a una función
`_aisGateAlarm(mmsi)` y llamarla también al resolverse
`_aisRefreshTargetPos`. Si el gate falla, `state.aisAlarms.delete(mmsi)`
antes de renderizar.

Nota: el umbral 0.08 m/s (0.16 kn) es bajo para un barco amarrado con
GPS de clase B. El ruido típico es de 0.1-0.5 kn. Propuesta: 0.25 m/s
(0.5 kn), el mismo umbral que el de la proyección. **Pregunta para Carlos.**

## Propuesta de escala radial (Bug 1)

Corona útil entre el borde del casco propio y el aro:
`r_min = 0.58 R` (justo por fuera de la proa, que está en 0.54 R) y
`r_max = R`.

Escala **logarítmica** en distancia, con escalones de 50 m → 2 NM:

```
r = r_min + (R - r_min) * clamp( ln(d / 50 m) / ln(2 NM / 50 m), 0, 1 )
```

| Distancia | r / R |
|---|---|
| ≤ 50 m | 0.58 (pegado al casco, sin solapar) |
| 200 m | 0.73 |
| 0.5 NM | 0.86 |
| 1 NM | 0.93 |
| ≥ 2 NM | 1.00 |

Más una etiqueta pequeña con la distancia ("50 m", "0.4 NM") junto al
casco del target. Con escala no lineal, la etiqueta es lo que da la
lectura real. Alternativa más simple: lineal entre 0.58 R y R. Pero en
puerto todos los targets se apilarían en el borde del casco.

Se descarta reducir el propio barco: la rosa es la pantalla principal del
piloto y el barco central es la referencia de proa y popa.

## Plan (un commit por bug, regla 3)

- **Rev470**: Bug 2 (signo −90) + Bug 3 (headingTrue, umbral SOG para la
  línea). Riesgo bajo, localizado.
- **Rev471**: Bug 4 (gate re-evaluado en el callback del cache) + umbral
  estacionario (si Carlos lo aprueba).
- **Rev472**: Bug 1 (escala log en corona + etiqueta de distancia).

## QA Rev470-472 (amarrado en Moaña sirve)

1. Con un target real en movimiento por la ría, el casco apunta en el
   mismo sentido que su icono en Freeboard.
2. La línea discontinua sale de su proa en la dirección de su COG.
3. Un target amarrado (PELAGOS, LUNA ROSSA...) no tiene línea.
4. Un target amarrado en modo NAVEGACIÓN deja de alarmar tras la primera
   lectura del cache (≤ 30 s).
5. Ningún target se pinta encima del casco propio. La etiqueta de
   distancia coincide aproximadamente con la regla de Freeboard.

## Bug 5 (CAUSA RAÍZ, Rev474) — el cache REST del target nunca se llenaba

QA Carlos 2026-10-14 con PIRATA DE ONS entrando en Moaña a 2,8 kn: "me
viene por las 11 en la rosa y el barco viene por las 7". Casco a "0 m".

- `_aisRefreshTargetPos` pedía
  `/signalk/v1/api/vessels/${encodeURIComponent(ctx)}/navigation/...`. Con
  la URN codificada (`urn%3Amrn%3Aimo%3Ammsi%3A224182590`), **SK responde
  404**; en crudo (`urn:mrn:imo:mmsi:224182590`) responde 200. Verificado
  con curl en el Pi5.
- Rev463 arregló una causa del 404 (la URN duplicada) pero no esta. El
  síntoma siguió igual.
- Con el cache vacío, `tgtPos` caía a `d.cpaPositions.target` = posición
  **futura** del target en el CPA. Estando nosotros parados, ese punto
  queda a la distancia del CPA (≈ 0 m) y en la dirección de **hacia dónde
  va**, no de dónde viene. De ahí las 11 frente a las 7.
- Consecuencia colateral: sog, cog y hdg siempre fueron `null`. Los fixes
  Rev470 (orientación y línea) y Rev471 (gate de parado) **nunca tuvieron
  datos**, y el modo Fondeo silenciaba todo (SOG desconocido = no se
  mueve).

Fix Rev474:
1. URN en crudo en las 4 peticiones REST.
2. Sin fallback a `cpaPositions.target`: si no hay posición actual, no se
   pinta casco en la rosa (la ficha sigue mostrando el aviso).
3. Refresco del cache de 30 s a 5 s.

Lección: **verificar con curl la URL REST exacta** antes de dar por bueno
un fix de AIS. Dos revisiones (Rev436 y Rev463) pasaron sin esa prueba.
