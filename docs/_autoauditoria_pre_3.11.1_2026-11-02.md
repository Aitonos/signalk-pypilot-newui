# Autoauditoría antes de publicar 3.11.1

Fecha: 2026-11-02. Alcance: todo lo cambiado desde 3.11.0 (Rev628 → Rev629
y dos commits sin Rev: `recommends` y workflow).
Lista aplicada: la de `docs/_autoauditoria_pre_3.8.2_2026-10-31.md`.

## Qué cambia

- `recommends` del App Store: `@signalk/collision-alerts` (era el nombre
  antiguo y salía "Not installed" aunque estuviera instalado).
- Workflow `publish`: job `release` que crea (o edita) la Release de GitHub
  con la sección del CHANGELOG del tag. Es lo que lee la pestaña Changelog
  del App Store; antes salía el título del commit cortado.
- Revisión de idiomas: francés antiguo con acentos y "vous", alemán antiguo
  con diéresis, ~60 tildes y 6 "¿" en español; 4 claves de virada que no
  existían (se veía la clave en bruto); `{pilot}` literal en DE/FR.
- Test `i18n-coverage.test.ts` (duplicados, cobertura, marcadores, claves
  usadas sin definir).
- Histórico de la gráfica: guardado cada 30 min en vez de 10, además de al
  parar.

## Lista

| Pregunta | Resultado |
|---|---|
| ¿Qué cambia durante cada `await` / temporizador? | Solo cambia el periodo del temporizador del histórico; se sigue parando en `stop()`. |
| ¿Se comprueba cada escritura? | Sin escrituras nuevas. El job `release` falla en rojo si no encuentra la sección del CHANGELOG. |
| ¿Dato ausente / no finito / antiguo? | Sin lógica nueva de datos. |
| ¿Sobrevive a un reinicio? | El histórico se sigue guardando al parar; con un corte de luz se pierden como mucho 30 min de gráfica (antes 10). |
| ¿Una operación vieja pisa una nueva? | No aplica. |
| ¿Pasa por `allowWrites`? | No hay escrituras a pypilot. |
| ¿Bucles que pueden no terminar? | No. |
| ¿Tests nuevos? ¿Código de salida real? | `i18n-coverage.test.ts` (8 casos); comprobado que falla con el `app.js` anterior a los arreglos. `npm test`: 457 en verde, código de salida 0. Extracción de notas del job `release` probada en local con 3.11.0, 3.10.0, 3.7.0 y 2.8.0. |

## Anotado sin arreglar

- El job `release` se estrena con este tag; si falla, la publicación en NPM
  ya está hecha (va después) y la Release se crea a mano.
- Traducciones DE/FR sin revisión de nativo.
