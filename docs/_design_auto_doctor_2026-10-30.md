# Diseño — Doctor automático (auto-ajuste con medida antes / después)

Estado: **propuesta, sin código**. Para revisar con Carlos antes de programar.

## La idea (Carlos, 2026-10-30)

> "Si somos capaces de ver el problema antes, podemos ver el resultado tras
> el ajuste y ver si falla porque nos hemos pasado. Eso a cada parámetro."

Es decir, un ciclo cerrado por parámetro:

1. **Medir** cómo gobierna ahora (tramo base).
2. **Ajustar** un solo parámetro, un paso pequeño.
3. **Medir** otra vez (tramo de prueba).
4. **Comparar**: si mejora, se queda; si no mejora o nos hemos pasado, se deshace.

Hoy el Doctor ya hace el paso 1 y propone el 2, pero no aplica nada solo
(`src/doctor.ts`: "Nothing is applied automatically"). Falta el 3 y el 4, y
hacerlo de forma continua mientras se navega.

## Qué medimos ya

Del historiador (`src/historian.ts`, 1 muestra/s): error de rumbo (objetivo
vs real, en el modo activo), timón, corriente del servo, TWS/TWA/AWS/AWA,
SOG, escora y cabeceo, modo y si el piloto está conectado.

Derivado (Doctor + `src/episodes.ts`):

| Métrica | De dónde | Qué dice |
|---|---|---|
| Error medio (sesgo) | Doctor | Se va siempre hacia un lado |
| Error RMS | Doctor | Cuánto se separa del rumbo en general |
| Cruces por cero y periodo | Doctor | Oscila, y si rápido o lento |
| Uso del servo (duty) | Doctor | % del tiempo que el motor trabaja |
| Tiempo de subida | Episodios | Cuánto tarda en llegar a un rumbo nuevo |
| Sobrepaso | Episodios | Cuánto se pasa al llegar |
| Tiempo de asentamiento | Episodios | Cuánto tarda en quedarse quieto en el rumbo |
| Error final tras el cambio | Episodios | Si se queda desviado tras llegar |
| No llegó (timeout 60 s) | Episodios | No consiguió asentarse |

Un "episodio" se abre en cada cambio de objetivo de 3° o más, así que el
tiempo de llegada solo se mide cuando hay cambios de rumbo (±1/±10, viradas
no, ver más abajo).

## Cada parámetro: síntoma de que falta y de que sobra

Esta tabla es la que permite "ver si nos hemos pasado":

| Parámetro | Falta (subir) | Sobra (nos pasamos) |
|---|---|---|
| **P** (fuerza de corrección) | Tarda en llegar al rumbo, error RMS alto, y el servo **tiene margen** | Sobrepaso al llegar, oscilación rápida, servo trabajando mucho con poco error |
| **I** (corrige desvío sostenido) | Sesgo sostenido hacia un lado, error final tras el cambio | Oscilación lenta (periodo largo), sobrepaso que tarda en asentarse |
| **D** (amortigua) | Oscilación, sobrepaso al llegar | Servo "nervioso": mucho trabajo con error muy pequeño, más corriente |

DD, PR y FF quedan fuera de la primera versión: sus efectos son más
difíciles de separar y el Doctor tampoco los ajusta hoy.

**Cuando el ajuste no es la solución** (no se toca nada, solo aviso, como
hace ya el Doctor): servo trabajando más del 75 % del tiempo con error RMS
de más de 5°. El motor ya va al límite; subir ganancias solo lo hace más
brusco.

## El ciclo

```
 tramo base (90 s estable)
      │  ¿hay un síntoma claro de "falta"?  ── no ──► seguir observando
      ▼ sí
 aplicar 1 paso en 1 parámetro (sobre copia del perfil)
      │
 tramo de prueba (90 s estable, condiciones comparables)
      │
 vuelta a la base (90 s): si la mar o el viento cambiaron entre la
 primera y la segunda base, la prueba no vale (A/B/A, propuesto por
 Gemini y GPT)
      │
      ├─ mejora el síntoma y no aparece ningún síntoma de "sobra" ──► se queda
      ├─ aparece un síntoma de "sobra" (nos pasamos) ─────────────► se deshace
      └─ no mejora, o las condiciones cambiaron ─────────────────► se deshace
      │
 espera mínima antes del siguiente cambio
```

Regla de oro: **en la duda, se deshace**. Un cambio solo se queda si la
mejora se ve con claridad.

## El punto difícil: comparar tramos

El riesgo de este método es que el viento o la mar cambien entre el tramo
base y el de prueba, y entonces un cambio bueno parezca malo, o al revés.
Por eso dos tramos solo se comparan si:

- mismo modo del piloto (compás, aparente, real, GPS);
- viento real en la misma franja (Light / Medium / Heavy del Smart Pilot) y
  sin variar más de ±20 % de media;
- estado de mar parecido: RMS de escora y de cabeceo dentro de ±25 %;
- sin viradas, trasluchadas, rachas detectadas ni cambios de modo dentro de
  ningún tramo;
- 90 s cada uno (A/B/A: base, prueba, base) (Carlos: 10 min "no es nada dinámico"). Es el mínimo
  para que entren bastantes olas (periodo 5–15 s) y la comparación no la
  decida una ola suelta.

Si no se cumple, la prueba no vale y se vuelve al valor anterior.

Para dar el cambio por bueno, la métrica del síntoma tiene que mejorar al
menos un 15 % y ninguna métrica de "sobra" puede empeorar más de un 10 %.
(Umbrales iniciales, a ajustar tras las primeras salidas.)

## Dos capas: reaccionar en segundos, aprender en minutos

Carlos quiere ajuste "en tiempo real". Medir si un cambio ha mejorado no se
puede en segundos (la ola decide el error a corto plazo), y un ajustador que
cambia ganancias tan rápido como el piloto corrige entra en el bucle y lo
puede hacer oscilar. Se separa en dos capas:

**Capa rápida (segundos) — elige.** Según las condiciones de ahora mismo,
pone al instante los ajustes ya conocidos para esa situación. No mide si
funciona, solo elige, por eso puede ser inmediata. Ya existe en parte
(perfil por franja de viento, D +20 % durante 20 s en racha). Se amplía a:

- estado de la mar (escora, cabeceo, guiñada del IMU);
- velocidad del barco (a poca velocidad el timón manda menos);
- rumbo respecto al viento (ceñida / través / empopada).

**Capa lenta (pruebas A/B/A de 3 × 90 s) — aprende.** El ciclo medir → ajustar → medir →
conservar o deshacer de arriba. Lo que aprende queda guardado por
situación, y la capa rápida lo usa en cuanto se repite esa situación.
Corrección (GPT, 2026-10-30): con A/B/A de 3 × 90 s más asentamiento,
cada prueba son unos 5 min; en 4 h caben como máximo ~45, y en la práctica
bastantes menos tras descartar maniobras y cambios de condiciones
(estimación: 15–30). El aprendizaje se acumula sobre todo de una salida a
otra.

## Base de datos de navegación (IMU + resultados)

Carlos: "con el IMU tenemos muchos datos que podemos usar para ir haciendo
una DB". Es la memoria de la capa lenta.

Ya existe la mitad: el **session recorder** (`src/session-recorder.ts`,
Rev143, pensado como "fase 1 del Doctor con IA") graba cada navegación con
el piloto conectado, a 1 Hz, con las ganancias al inicio, en JSONL en la Pi.

Lo nuevo sería **una fila por tramo de 90 s**, no muestras crudas:

| Grupo | Campos |
|---|---|
| Condiciones | modo, TWS, TWA (ceñida/través/empopada), SOG, RMS de escora, RMS de cabeceo, guiñada del IMU (`imu.headingrate`), periodo de ola estimado |
| Ajuste usado | perfil, P, I, D (y DD/PR/FF tal cual) |
| Resultado | error medio, error RMS, oscilación (cruces y periodo), uso del servo, corriente media, episodios (subida, sobrepaso, asentamiento) |
| Decisión | qué parámetro se probó, se quedó o se deshizo, por qué |

- Unos 200 bytes por fila: 4 h de navegación son ~240 filas. Nada para la
  Pi.
- Fichero JSONL en el directorio de datos del plugin, sin dependencias
  nuevas (sin SQLite). Persiste entre salidas y reinicios (el backend es el
  dueño de los datos, no el navegador).
- Las estadísticas del IMU (RMS de escora, cabeceo y guiñada) se calculan
  con todas las muestras que lleguen, no solo con la de cada segundo, para
  no perder el movimiento de ola corto.
- Para elegir ajuste se agrupan las filas por situación (franja de viento ×
  mar × rumbo al viento × velocidad). Con pocas filas en una situación, se
  usa la situación vecina o el perfil original.
- Exportable para analizarla fuera (como ya permite el session recorder).

## Límites de seguridad

- Un solo parámetro a la vez, un paso del 10–20 %.
- Nunca más de ±40 % sobre el perfil original.
- Una prueba A/B/A cada vez, y nunca dos seguidos en el
  mismo parámetro sin un tramo de comprobación entre medias.
- Se trabaja sobre una **copia** del perfil de la franja de viento; el
  original no se toca y se vuelve a él con un toque.
- Cualquier alarma, pérdida de autoridad, desconexión del piloto o maniobra
  **cancela la prueba en curso y deshace el último cambio**.
- Apagado por defecto. Interruptor en el Doctor.

## Lo que ve el usuario

- Aviso por voz y notificación en cada cambio: "Subo I un 20 %: desvío
  sostenido a babor". Y al deshacer: "Deshago I: no mejora".
- Historial de cambios con el antes/después de cada uno.
- Botón "volver al perfil original".

## Fases propuestas

1. **Modo sombra**: hace todo el ciclo pero **sin aplicar nada**; solo
   registra qué habría cambiado y por qué. Así se valida en el agua sin
   riesgo y vemos si sus decisiones tienen sentido.
2. **P e I automáticos**: los dos casos más claros (desvío sostenido,
   tarda en llegar).
3. **D automático**, si las fases anteriores salen bien.

## Lo que no sabemos aún

- Si los tramos de 3 min son lo bastante comparables en la ría con mar y
  viento cambiantes. El modo sombra lo dirá.
- Los umbrales: son iniciales. Antes de programar, pasar el algoritmo por
  GPT y Gemini (como con otros algoritmos físicos).

## Preguntas para Carlos

1. ¿Empezamos por el modo sombra o directamente con P e I?
2. ~~¿Un cambio cada 10 minutos?~~ Resuelto: dos capas; pruebas A/B/A de
   3 × 90 s (Gemini y GPT).
3. ¿El aviso por voz en cada cambio, o solo en el historial?
4. ¿Empezamos ya a llenar la base de datos (filas por tramo) aunque el
   ajuste automático tarde en llegar? Cuantas más salidas grabadas, antes
   sabrá qué va bien en cada situación.
