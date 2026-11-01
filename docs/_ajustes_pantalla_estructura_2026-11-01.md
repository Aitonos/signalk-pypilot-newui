# Configuración del visor (ventana de la rosa): estructura

Fecha: 2026-11-01 (Rev607-608). Carlos: "ordena esto, ya no me aclaro".
Se abre con pulsación larga en una esquina de la rosa (o pulsación larga
en el panel multifunción, que abre directamente su sección; o desde el menú del barco, "Configuración del visor").

| Sección | Qué contiene |
|---|---|
| Datos en esquinas (abierta) | Qué dato va en cada esquina; datos de polares disponibles; ruta Signal K propia |
| Datos sobre el visor | Flecha A, flecha T, COG, corriente, marca de rachas |
| Panel multifunción | Escora o timón; qué vistas recorre el doble toque; series y ventana de la gráfica |
| Alarma de colisión (AIS) | Modo (Puerto / Fondeo / Navegando), voz, puerto automático, ajustes del plugin, silenciadas; zonas de puerto |
| Sonidos y cartas | Sonido al tocar; Freeboard en segundo plano |
| Presets de visualización | Guardar / aplicar la disposición de la pantalla |

## Alarma AIS, en una frase por modo

- **Puerto:** no avisa de nada.
- **Fondeo:** avisa de barcos que se mueven (2 kn o más) o que entran en
  tu círculo de borneo aunque digan estar parados. Si mareas-ihm vigila el
  fondeo, ese segundo aviso ya lo da mareas y el visor no lo repite.
- **Navegando:** avisa de todo menos de barcos parados.
- **Puerto automático:** parado 2 min, pasa solo a Puerto.

Quien calcula las alarmas es el plugin collision-alerts (distancias y
tiempos en sus ajustes); el visor las dibuja, las dice y filtra según el
modo. Las zonas de puerto marcadas aquí las usará collision-alerts para
callar barcos parados dentro (PR SignalK/collision-alerts#47).

Mismos controles e identificadores que antes: solo cambia el orden y que
cada tema se pliega.

## Estilo (Rev609-610)

Nombres aprobados por Carlos. Selectores con esquinas de 8 px como los
botones "2 min / 10 min" (antes en forma de píldora); Escora | Timón como
dos botones de selección; datos de polares como selectores en línea; el
desplegable de zonas con el mismo estilo que los de las esquinas.
