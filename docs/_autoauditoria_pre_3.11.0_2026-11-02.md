# Autoauditoría antes de publicar 3.11.0

Fecha: 2026-11-02. Alcance: todo lo cambiado desde 3.10.0 (Rev620 → Rev628).
Lista aplicada: la de `docs/_autoauditoria_pre_3.8.2_2026-10-31.md`.

## Qué cambia

- **Tour guiado** de primer arranque (21 pasos, foco + burbuja), diseño en
  `docs/_tour_guiado_guion_2026-11-01.md`. Abre de verdad la gráfica,
  Freeboard (panel y rosa) y las ventanas de marea y fondeo de AnchorWatch
  Pro; si falta un plugin compañero enseña una captura real (ampliable al
  tocar) y un botón Instalar. Se repite desde Info y desde el menú del barco.
- **Info**: botones Estrella en GitHub y Feedback; título sin "+ SK Paths".
- **Traducciones**: 908 textos que faltaban en alemán y francés
  (configuración, Doctor, alarmas, sesiones, bitácora, AIS, maniobras, tour…).
  DE y FR cubren ahora todas las claves de EN.
- Backend: solo cambia `PLUGIN_REVISION`.

## Lista

| Pregunta | Resultado |
|---|---|
| ¿Qué cambia durante cada `await` / temporizador? | Tour: la detección de plugins (HEAD a Freeboard y a mareas) es asíncrona; si termina con el tour ya cerrado no hace nada. Los temporizadores de las animaciones se cancelan al pasar de paso o salir. |
| ¿Se comprueba cada escritura? | No hay escrituras nuevas al backend. El tour solo guarda `pypilotnewui.tourDone` en localStorage (dentro de try/catch; si falla, el tour vuelve a salir, sin más efecto). |
| ¿Dato ausente / no finito / antiguo? | Pasos con `needs` se saltan o muestran la captura si falta el plugin; selectores ausentes = burbuja centrada. |
| ¿Sobrevive a un reinicio? | Estado del tour por dispositivo; al salir del tour se restaura la vista del panel, la pestaña y las ventanas abiertas. |
| ¿Una operación vieja pisa una nueva? | Cada paso invalida las fases pendientes del anterior (contador de paso). |
| ¿Pasa por `allowWrites`? | El tour no toca el piloto: no engancha, no cambia modo ni rumbo. Las pulsaciones que simula son solo de vistas (doble toque en rosa/panel, botón de marea). |
| ¿Bucles que pueden no terminar? | No hay bucles nuevos. |
| ¿Tests nuevos? ¿Código de salida real? | El visor no tiene arnés; verificado en Edge sin interfaz contra la Pi (capturas de cada paso en ES/EN, y el paso 1 en FR y DE con Rev628). Traducciones: script que comprueba que cada clave EN existe en DE y FR y que coinciden los marcadores `{x}`, etiquetas HTML y saltos de línea; `node --check` correcto. `npm test`: 449 en verde, código de salida 0. |

## Anotado sin arreglar

- Las traducciones DE/FR son mías, sin revisión de nativo; los términos
  náuticos (empannage, Halse, Schwojkreis, cercle d'évitage…) son los
  habituales, pero algún texto largo puede sonar poco natural.
- Las capturas del tour están en español/inglés (interfaz del Tunatunes);
  en DE/FR el texto de la burbuja va traducido pero la imagen no.
- El paquete crece ~380 KB por las 6 capturas de `public/tour/`.
