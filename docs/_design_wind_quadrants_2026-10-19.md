# Propuesta — viento real / aparente por cuadrantes y reactividad (2026-10-19)

Estado: **A implementada como pseudo-modo AUTO VIENTO (Rev518)** a
petición de Carlos: corte 120° TWA (histéresis ±5°, 10 s, ≥ 30 s entre
cambios), un perfil por lado elegido en la ventana de modo (la
reactividad de real viene de su perfil, sin multiplicadores ocultos).
B (ganancias por ángulo) sigue como propuesta.

## Lo que dicen los datos

- **2026-10-19 18:48-18:49**: objetivo AWA −139° (aleta de babor) en
  **aparente**. El barco pasa de largo hasta AWA ±175° (casi popa
  cerrada) y oscila ±40° durante 2 min. 18:49:50 cambio a **real**: lo
  mantiene bien (Carlos: "en rumbo real lo ha mantenido bien").
- **19:02** a motor con poco SOG en aparente: se va.
- **2026-10-18**: el modo "Popa TWS 10 SIN OLA" funcionó a 20-24 kn;
  en ceñida con viento fuerte hace falta más reactividad.

Física: con el viento por detrás, el aparente cambia mucho con la
velocidad del barco (surf, racha, frenada) aunque el viento real no
cambie. El piloto en aparente persigue esos cambios → eses. Ciñendo
pasa lo contrario: el aparente es estable y da la información útil.

## Propuesta A — modo por cuadrante (sugerencia, no automático)

| \|TWA\| | Modo recomendado |
|---|---|
| < 100° | aparente (`wind`) |
| > 110° | real (`true wind`) |
| 100-110° | histéresis: se queda el que haya |

- El visor muestra un aviso discreto ("Recomendado: REAL") cuando el
  modo no encaja con el cuadrante durante 20 s. Un toque lo cambia.
- Opción "Cambio automático por cuadrante" (Smart Pilot, por defecto
  **OFF**). Si se activa: cambia tras 20 s fuera de cuadrante, **nunca**
  durante una virada, aproado o empopado, y avisa por voz.
- Al cambiar de modo el rumbo se conserva (pypilot ya lo hace al
  cambiar de modo, ver audit 2026-10-19 §7; hay que esperar a que lo
  procese antes de escribir nada).

## Propuesta B — reactividad por ángulo

El empopado ya usa PID "caliente" (P×1.5, D×1.7). Generalizar con
moderación, solo con la opción activada:

| \|TWA\| | Ganancias |
|---|---|
| < 50° (ceñida) | P×1.2, D×1.3 |
| 50-140° | perfil tal cual |
| > 140° (popa) | P×1.5, D×1.7 (como el empopado) |

- Se aplican sobre el perfil activo y se **restauran siempre** al salir
  del tramo, al desacoplar o al cambiar de perfil (mismo mecanismo y
  salvaguardas que gust "boost-D").
- Validar en agua por pasos: primero solo popa, después ceñida.

## Lo que NO propongo

- Cambiar el aproado: sigue en aparente (decisión de Carlos 2026-10-19).
- Automatismos activados por defecto (regla BASIC/Performance).

## Preguntas para Carlos

1. ¿A (sugerencia + opción automática OFF) te vale, o lo quieres
   automático por defecto en el Tunatunes?
2. ¿Umbrales 100/110° bien, o prefieres otro corte?
3. ¿B empezando solo por popa?
