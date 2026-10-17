# Audit — avisos que suenan pero no se ven / rachas que no salen (2026-10-17)

Reporte Carlos (navegando 2026-10-17):
1. Tablet: la infobox AIS no sale (recargar, desactivar/activar: nada).
   Portátil: sí sale (captura PIRATA DE ONS, WARN).
2. Móvil: discrepancia de modo/target con otro dispositivo.
3. Rachas de viento (racha fantasma) no salen en tablet ni móvil.

## Hallazgos

### A. Preferencias de seguridad guardadas POR NAVEGADOR (localStorage)

| Preferencia | Clave | Efecto si difiere entre dispositivos |
|---|---|---|
| Modo AIS Puerto/Fondeo/Navegación | `pypilotnewui.aisMode` | "Puerto" (off) = sin infobox, sin rosa, sin voz en ESE dispositivo |
| Voz AIS | `pypilotnewui.aisAlarmVoice` | un dispositivo habla y otro no |
| Racha fantasma | `pypilotnewui.gustGhost` | rachas visibles solo donde está ON |
| Silenciados AIS por MMSI (TTL) | `state.aisLocalAckedMmsis` | silenciar en un dispositivo no silencia los otros, y viceversa |

Además `_aisMode()` aplica un **puerto automático** (Rev462): si ESE visor
vio SOG≈0 durante 2 min, fuerza "off". Cada visor lo calcula desde que se
cargó la página → dos dispositivos pueden estar en estados distintos.

Viola la regla dura "backend = única fuente de verdad" (Q-N,
`feedback_backend_is_source_of_truth`, `feedback_backend_owns_persistent_data`).

Las otras ~23 claves (idioma, esquinas, flechas, fullscreen, token,
historial SSH...) son de presentación/sesión: OK por dispositivo.

### B. Banner de alarmas del piloto tapado (corregido Rev497)

`.alarm-banner` z-index 900 quedaba bajo Freeboard maximizado (1300),
popups (3000), HUD regata (5000), banners red/offline (9998-10000).
Pitido + voz sin banner visible. Rev497: z-index 10001.
La infobox AIS sigue en z 20 (Carlos: no debe tapar Freeboard).

### C. "Compás a las 19:13"

Backend, visores A/B (trace) y grabaciones sesión/viaje: modo `wind`
(VIENTO APARENTE) desde 19:10:01, sin cambios hasta 19:30. A las
19:13:29-30 hubo disengage+engage (coincide con "engage autopilot" desde
Freeboard). Ningún visor pypilot pudo mostrar COMPÁS en vivo. Pendiente
de saber qué pantalla lo mostró (probable panel de piloto de Freeboard).

## Propuesta (pendiente OK Carlos)

Mover al backend (config del plugin, endpoint GET/PUT + delta SK para que
todos los visores se enteren al instante):
- modo AIS, voz AIS, racha fantasma;
- silenciados AIS por MMSI (ack compartido entre dispositivos);
- puerto automático evaluado en backend (una sola decisión para todos).
Migración: el primer visor que arranque con valor local lo sube si el
backend no tiene valor; a partir de ahí manda el backend.
Requiere `.\deploy.ps1 -Restart` (cambio en src/).

## Implementado Rev498-499 (2026-10-18, OK Carlos)

- `src/visor-prefs.ts` (+ 6 tests): `visor-prefs.json` en el data dir con
  aisMode / aisVoice / aisHarborAuto / gustGhost / aisAcks (mmsi -> TTL).
  Puerto automático evaluado en backend (timer 1 Hz con la SOG propia,
  mismos umbrales Rev462: <0.6 kn 2 min entra, >1.2 kn 30 s sale).
- Endpoints `GET/PUT /visor-prefs`, `POST /visor-prefs/ais-ack`,
  `POST /visor-prefs/ais-unack`.
- Visor: getters/setters leen/escriben `_vp` (espejo del backend,
  refrescado con el poll de alarmas cada 5 s). Primer visor con backend
  sin inicializar sube sus valores de localStorage (migración).
- Rev499: los radios muestran el modo ELEGIDO (no el efectivo); con
  puerto automático activo un tap en "Navegación" ya no rebota a "off".

Verificado en la Pi con 2 perfiles Firefox autenticados: migración OK,
cambio de modo AIS y racha fantasma desde "otro dispositivo" llega en
≤ 7 s sin recargar. 260/260 tests OK.

Pendiente QA en barco: tablet + móvil + portátil a la vez (silenciar un
AIS en uno y comprobar que se silencia en los otros).
