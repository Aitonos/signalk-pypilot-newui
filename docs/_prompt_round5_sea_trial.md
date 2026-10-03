# Prompt Round-5 — Sea Trial 2026-10-03 — Virtual Tack catastrophic failure

**Para: Codex, Gemini + Claude. Analizadlo los tres por separado SIN discutir entre vosotros. Luego cruzaremos vuestras respuestas.**

## Contexto

Rev406 desplegado al Pi. Carlos salió a navegar hoy (2026-10-03, 19:00-19:35 CEST = 17:00-17:35 UTC) con la lancha Tunatunes. Viento real variable, probó virtual tack (VT), aproado, empopado en varios modos (wind, true wind, compass) con velocidades 2-5 kn. Resultado reportado: todas las viradas en modo wind fallaron por timeout de 20s. Los otros flujos (aproado/empopado) también presentaron bugs serios.

El código actual del VT: FSM compass→wind con fases `preparing / turning / handover / settling / completed / cancelling / cancelled / failed`. En `turning` ejecuta pasos compass intermediates (máx 170° cada uno, re-fractionate si delta > 170°). Timeout por step: 20s (`DEFAULT_PHASE1_STEP_TIMEOUT_MS` en `src/virtual-tack.ts:100`).

Round-4 cerró con sea trial pendiente. Este es el sea trial real. Carlos reportó verbalmente **"desastre"**, **"la lógica de virar en viento está absolutamente rota es peligrosísima"**.

## Comentarios de Carlos (transcritos del speech-to-text, "mirada" = "virada")

> ~19:00-19:05 — Enganché modo compass, el barco se fue mal a babor luego a estribor luego cogió rumbo. Pasé a viento aparente, target bien marcado. Pulsé virada a +90° a estribor (debería ir a −90°, girar para que el viento pase de starboard a port). **Empezó bien pero cuando le faltaban como unos 20 grados ha abortado y ha vuelto al rumbo original**. Lo mismo hacia babor (trasluchada): empezó bien, a 20° del final abortó y volvió.
>
> ~19:09 — Diagnóstico: **"las miradas pueden durar más de 20 segundos entonces cuando llega al fin se auto cancela"**. Hay que quitar o aumentar el timer de 20s.
>
> También: **"cuando vuelve a rumbo pues vuelve según le dé la gana por el arco más corto"** → pypilot al abortar vuelve al target wind original pero por el camino corto, no respeta la dirección de la virada que se pidió.
>
> ~19:11 — 4,7 nudos, "casi casi a puntito de hacerlo", virada a estribor.
>
> ~19:13 — Virada a babor, "casi ha llegado pero no ha conseguido hacer lock al llegar... se ha cancelado y se me acaba de hacer 360° de mirada". **Un timeout → 360° de giro completo**.
>
> ~19:16 — Trasluchada con viento a +160°, lanzada a babor: **"ha hecho la trasluchada perfectamente"** (delta chico = 124°, cabe en 20s).
>
> ~19:17-19:18 — Modo empopado: "lo ha hecho bien pero se ha pasado... maniobra completada 27 segundos 0.08 millas náuticas pero **no me pregunta qué quiero hacer**. Que si recuerdas hablamos de que hubiera un menú que me preguntaras si queríamos volver a rumbo o qué, porque me está volviendo a llevar al rumbo que teníamos".
>
> ~19:20 — Trasluchada con viento real popa −135° a +135°. Nada: límite de tiempo. "intenta volver a su rumbo original y no sé qué narices hace... se vuelve absolutamente loco, está dando vueltas todo el rato".
>
> ~19:22 — Modo compass, virada a estribor 100°. "me dice mirando y aquí sí me salen los grados y me ha salido del infobox **y me pone tack pay pilot silent en verde**... Nada se ha hecho". Virada a babor igual: "pypilot silent, aparentemente no hay ninguna caída de red ni nada".
>
> ~19:24 — Mando a distancia, virada a babor. "me dice mirando y me dice los segundos pero no los grados (solo tiempo, no deg restantes en HUD)". Y "virada no llegó" (= no completó).
>
> ~19:25 — Repito virada 100° a babor con botones del visor. "salen los botones naranjas con la X que antes no salían... **7-8 segundos** se ha cortado la maniobra".
>
> ~19:28 — Mando a distancia, virada a babor. **"me dice mirando pero me pone que es como hacia babor cuando en realidad está girando a estribor"**. HUD con direction MAL detectada.
>
> ~19:29-19:30 — Mando a distancia tackea a babor y **se hace a estribor** (al revés). Luego botones del visor pide estribor y hace babor (como trasluchada).
>
> **"En la lógica de virar en viento está absolutamente rota es peligrosísima porque se va para donde le da la gana"**.
>
> También: **"la veleta cuando está girando el barco no es muy preciso porque hace saltos de aparente muy rápidos"** — AWA ruidoso durante la rotación.
>
> ~19:31 — Aproado "le está costando un montón, va a trompicones, se intenta acercar se le aleja otra vez en la aparente, se queda como a 8/6/5/4 grados" (oscila sin converger).
>
> Veredicto final: "aproado y empopado más o menos funciona pero tiene fallos. El salir del modo y volver a rumbo me parece peligrosísimo, es casi mejor quedarnos en el rumbo que estamos. **Todo lo demás funciona fatal**".

## Logs - fuente 1: journal del Pi5 (`sudo journalctl -u signalk`)

Ventana 19:00-19:35 CEST. Timestamps en CEST (UTC+2).

```
19:05:56 setTarget rad=1.5569 deg=89.20
19:06:45 setMode re-anchor: no measurement for wind.direction; sailor will nudge
19:06:45 setTarget rad=1.3614 deg=78.00
19:06:47 [virtual-tack vt-...ebhytj] turning dir=starboard fromMode=wind angle=78.4deg delta=156.8deg steps=1
19:06:47 setMode re-anchor: no measurement for ap.heading; sailor will nudge
19:06:48 setTarget rad=4.3319 deg=248.20 (= compass intermediate target)
19:07:08 turning step 0 timeout (no rotation in 20s)
19:07:08 setMode re-anchor: no measurement for wind.direction; sailor will nudge
19:07:08 setTarget rad=1.3683 deg=78.40 (restore)
19:07:09 driver threw: turning step 0 timeout (no rotation in 20s)

19:07:29 [vt ...davg7l] turning dir=port fromMode=wind angle=78.4deg delta=-203.2deg steps=2
19:07:29 setTarget rad=5.6929 deg=326.18 (compass intermediate step 0)
19:07:49 turning step 0 timeout (no rotation in 20s)
19:07:50 setTarget rad=1.3683 deg=78.40 (restore)
19:07:50 driver threw

19:09:40 [vt ...mciwxz] turning dir=port fromMode=wind angle=78.4deg delta=-203.2deg steps=2
19:09:40 setTarget rad=5.2746 deg=302.21
19:10:00 timeout
19:10:00 setTarget restore 78.40
19:10:01 driver threw

19:11:14 [vt ...wkpypf] turning dir=starboard fromMode=wind angle=78.4deg delta=156.8deg steps=1
19:11:15 setTarget rad=4.6447 deg=266.12
19:11:35 timeout
19:11:35 restore 78.40
19:11:36 driver threw

19:12:02 [vt ...bn78p8] turning dir=port fromMode=wind angle=78.4deg delta=-203.2deg steps=2
19:12:02 setTarget rad=5.5222 deg=316.40
19:12:22 timeout
19:12:23 restore
19:12:23 driver threw

19:13:09 [vt ...0qu12h] turning dir=port fromMode=wind angle=78.4deg delta=-203.2deg steps=2
19:13:10 setTarget rad=5.3050 deg=303.95
19:13:30 timeout
19:13:31 restore
19:13:31 driver threw

19:16:25 [vt ...07rpaz] turning dir=port fromMode=wind angle=118.0deg delta=-124.0deg steps=1
19:16:25 setTarget rad=5.2987 deg=303.59
19:16:45 timeout
19:16:46 restore rad=2.0595 deg=118.00
19:16:46 driver threw

(aproado/empopado aquí sin VT)
19:17:45 setMode: same target-space (wind) — no anchor needed
19:17:46 setTarget rad=3.1406 deg=179.94 (empopado)
19:18:37 setMode: same target-space (wind) — no anchor needed
19:18:37 setTarget rad=2.2340 deg=128.00

(cambios manuales de target por Carlos durante los "giros locos")
19:20:40 setTarget -25.00
19:20:53 setTarget -134.75

19:20:56 [vt ...ptjr5d] turning dir=starboard fromMode=true wind angle=-134.7deg delta=90.5deg steps=1
19:20:56 setTarget rad=4.7585 deg=272.64
19:21:16 timeout
19:21:17 restore -134.75
19:21:17 driver threw

(cambios manuales adicionales...)
19:21:55 setTarget 48.69
19:22:13 setTarget -62.51
19:22:54 setTarget 28.33
19:23:47 setTarget -81.70

19:28:53 setTarget 73.00

19:30:52 [vt ...92piz7] turning dir=port fromMode=wind angle=38.5deg delta=-283.0deg steps=2
19:30:52 setTarget rad=4.1578 deg=238.23
19:31:12 timeout
19:31:13 restore 38.50
19:31:13 driver threw
```

## Logs - fuente 2: maneuver-trace JSONL

Formato: `{ts (segundos desde 17:00 UTC), fields, [{p=path, v=value}]}`. target en grados (wind modes) o compass heading. VT snapshot con `phase`, `dir`, `finalRad` (grados), `remain` (grados restantes de rotación según el backend FSM).

**T1 (19:06, starboard, delta=+156.8°)**:
```
ts=407 preparing  target=78.4   mode=wind     VT{tack, dir=starboard, remain=156.8}
ts=408 preparing  target=78.4   mode=compass  VT{..., remain=156.79}
ts=408 target=92.2 (intermediate step 0 half)
ts=408 turning    target=92.2   mode=compass
ts=408 target=248.2 (intermediate step 0 full)
ts=428 cancelling target=248.2 mode=compass  VT{outcome:"turning step 0 timeout (no rotation in 20s)", remain=29.1}
ts=428 cancelling target=248.2 mode=wind
ts=428 target=-26.5
ts=428 target=78.4
ts=429 failed     target=78.4   mode=wind     VT{remain=24.9}
```

**T2 (19:07, port, delta=-203.2°)**:
```
ts=449 preparing  target=78.4   mode=wind    VT{jibe, port, remain=170}
ts=449 preparing  target=78.4   mode=compass VT{..., remain=168.4}
ts=449 target=113.3 (intermediate)
ts=449 turning    target=113.3  mode=compass
ts=449 target=326.2 (full step)
ts=469 cancelling target=326.2 mode=compass VT{outcome:timeout, remain=53.5}
ts=470 cancelling target=326.2 mode=wind
ts=470 target=-124.8
ts=470 target=78.4
ts=470 failed     target=78.4   mode=wind    VT{remain=47.8}
```

**T6 (19:16, port, delta=-124° con AWA=118°)**:
```
ts=985 preparing  target=118.0 mode=wind    VT{jibe, port, finalRad=-118, remain=124}
ts=985 target=72.9 (intermediate)
ts=985 turning
ts=985 target=303.6 (full step)
ts=1005 cancelling VT{outcome:timeout, remain=19.1}
ts=1006 cancelling target=303.6 mode=wind
ts=1006 target=-48
ts=1006 target=118
ts=1006 failed VT{remain=17.0}
```

**T8 (19:20, starboard, true wind, delta=+90.5°)**:
```
ts=1256 preparing  target=-134.7 mode=true wind VT{jibe, starboard, finalRad=134.7, remain=90.5}
ts=1256 preparing  target=-134.7 mode=compass   VT{..., remain=90.5}
ts=1256 target=169.5 (intermediate)
ts=1256 turning   target=169.5  mode=compass    VT{remain=92.9}
ts=1256 target=272.6 (full)
ts=1261 target=274.3 VT{remain=86.7}
ts=1276 cancelling VT{outcome:timeout, remain=22.3}
ts=1277 cancelling target=274.3 mode=true wind
ts=1277 target=-175.1
ts=1277 target=-134.7
```

## Logs - fuente 3: TinyPilot (pypilot core)

NO disponibles. TinyPilot (Pi Zero W) no acepta SSH; sin logs, sin shell. Caja negra desde fuera. Solo observamos su comportamiento a través de los deltas que publica a SignalK y las aceptaciones/rechazos de los `setTarget` / `setMode` del backend.

## Audit externa previa de Rev406 (hallazgos sin verificar)

Un code review previo (fuente desconocida) identificó estos puntos. **No han sido verificados en navegador ni en Pi real**:

1. `cancelVirtualTack()` marca "cancelling", pero al terminar la espera del modo se sobrescribe con "turning" y se envía la siguiente consigna. Reproducido en prueba aislada por el revisor. `src/autopilot-provider.ts:917`.
2. `/raw` y los PUT de variables ignoran el resultado booleano de `client.set()`. Si pypilot rechaza, el visor igualmente recibe `ok: true` / 200. `src/index.ts:1717` y `:4998`.
3. La virada admite al arrancar varias fuentes de heading (SignalK heading, `ap.heading`, `imu.heading`); durante el giro consulta solo `ap.heading`. Si únicamente otra fuente está disponible, termina por timeout aunque el barco haya alcanzado el rumbo. `src/autopilot-provider.ts:945`.
4. Una virada puede declararse completada sin alcanzar el objetivo: tras 15 segundos de estabilización, incluso sin viento disponible, publica `completed/ok`. `src/autopilot-provider.ts:1024`.
5. `_empopadoApplyHotGains()` busca `catalog[path].value`; el catálogo contiene metadatos y los valores actuales se guardan aparte. Aplica cero ajustes. `public/app.js:7183`.
6. `startVirtualTack()` sin heading devuelve respuesta vacía de éxito (`{id:"", alreadyRunning:false}`). El error solo se registra en consola. `src/autopilot-provider.ts:730`.

## Preguntas a los 3 LLMs

Para cada punto, analizadlo con los datos (comentarios + journal + trace + código apuntado):

1. ¿Por qué están fallando las viradas en wind? Causa raíz, fix, riesgo.
2. ¿Por qué al abortar el barco "vuelve por donde le da la gana"? Causa raíz, fix, riesgo.
3. ¿Por qué el mando físico ejecuta el tack a la dirección contraria de la pedida? Causa raíz, fix, riesgo.
4. ¿Por qué "pypilot silent" en modo compass? Causa raíz, fix, riesgo.
5. Aproado oscila 8°/6°/5°/4° sin converger: causa raíz, fix, riesgo.
6. Empopado "se pasa" + no ofrece elección post-completed: diseño propuesto.
7. HUD tack via mando no muestra grados restantes: causa raíz, fix.
8. Audit externa — ¿confirmáis los 6 hallazgos leyendo el código? ¿Prioridad? ¿Fixes?
9. ¿Hay algún refactor arquitectónico mayor que recomendéis antes de iterar por bugs? El sailor tiene un sea trial más programado.

### Formato de respuesta

Para cada punto (1-9):
- Causa raíz exacta (archivo:línea cuando aplique).
- Fix propuesto (diff textual).
- Riesgo del fix.
- Prioridad 1-10 (10 = peligro físico inminente).

Los 3 LLMs: analizadlo por separado SIN mirar las conclusiones de los otros. Después de entregar vuestras respuestas se cruzarán.
