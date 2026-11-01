# Tour guiado de primera vez: guion y diseño (propuesta)

Fecha: 2026-11-01. Carlos: "un tour guiado con pasos y bocadillos, un guion
para noobs; el plugin tiene muchas funciones, muchas ocultas; en la primera
instalación que haga un tour de lo más importante".

Estado: **propuesta para aprobar**. No hay código todavía.

## Cómo se ve

- La pantalla se oscurece salvo el elemento del que se habla, que queda
  iluminado con un borde del color de acento.
- Al lado sale un **bocadillo** con una flecha hacia ese elemento:
  título corto, 1-3 frases, contador "3 / 13" y botones **Atrás**,
  **Siguiente** y **Saltar tour**.
- Mientras dura el tour **no se puede pulsar nada del visor** (ni AP, ni
  rumbo, ni viradas): el tour enseña, nunca toca el piloto.
- Si un paso es de otra pestaña, el tour la abre; al terminar vuelve a
  Control.
- Funciona en vertical, apaisado y móvil: el bocadillo se coloca donde
  quepa (arriba, abajo, a un lado) y nunca se sale de la pantalla.

## Cuándo sale

- **La primera vez que se abre el visor en cada dispositivo**, cuando ya
  ha cargado y no hay otra ventana abierta (login de Signal K, permisos).
- Se marca como visto en ese dispositivo al terminarlo o saltarlo. Es por
  dispositivo a propósito: el móvil de un invitado necesita su tour
  aunque la tablet de a bordo ya lo haya visto.
- **Repetir tour** desde la pestaña Info y desde el menú del barco.
- Si en una versión futura se añaden pasos importantes, se puede volver a
  ofrecer solo lo nuevo (número de versión del tour).

## Guion (13 pasos)

| # | Señala | Título | Texto |
|---|---|---|---|
| 1 | Toda la pantalla | Bienvenido a PyPilot New-UI | Te enseño lo básico en un minuto. Durante el tour no se toca el piloto. Puedes saltarlo y repetirlo cuando quieras desde la pestaña Info. |
| 2 | La rosa | La rosa | Tu barco visto desde arriba. Arriba, el rumbo. La flecha amarilla **A** es el viento aparente y la verde **T** el viento real. El rombo azul es el rumbo que lleva el piloto. |
| 3 | Una esquina | Datos en las esquinas | Las cuatro esquinas muestran los datos que elijas. **Mantén pulsada una esquina** para abrir la Configuración del visor. |
| 4 | Botón AP | Conectar el piloto | **AP** conecta y desconecta el piloto. En gris está desconectado; al conectarlo, mantiene el rumbo o el ángulo de viento actual. |
| 5 | Botón de modo | Modo y perfil | Elige cómo gobierna: compás, GPS, viento aparente, viento real o **Auto viento** (aparente en ceñida, real en popa). Aquí también eliges el perfil de ajustes. |
| 6 | Fila « 10 ‹ 1 1 › 10 » | Cambiar el rumbo | Corrige el rumbo de 1 en 1 o de 10 en 10 grados, a babor o a estribor. |
| 7 | Botones de virada | Virar | Las flechas roja y verde viran a babor o a estribor, con la maniobra completa. En modos de viento cambian de amura. |
| 8 | Panel multifunción | Panel multifunción | Muestra la escora (o el timón). **Doble toque**: cambia a gráfica o a la carta. **Pulsación larga**: sus ajustes. Con el dedo sobre la gráfica ves los valores de ese momento. |
| 9 | La rosa | La carta, a un doble toque | **Doble toque en la rosa** abre la carta (Freeboard-SK, si está instalado) dentro de la rosa. Doble toque otra vez para volver. |
| 10 | Barra de pestañas | Pestañas | Pasa de pestaña **deslizando el dedo a los lados**. El triángulo del panel oculta o muestra esta barra; el botón de la esquina pone pantalla completa. |
| 11 | Pestaña Ajustes | Ajustes del piloto | Las ganancias de pypilot con explicación de cada una. Están bloqueadas: desbloquéalas para tocar. |
| 12 | Pestaña Setup | Setup | Perfiles, calibraciones, el Doctor que analiza cómo gobierna y te propone ajustes, la bitácora y la caja negra. |
| 13 | Pestaña Control | Listo | Para alarmas AIS (modos Puerto / Fondeo / Navegando y zonas de puerto) y todo lo de la pantalla: **pulsación larga en una esquina**. Buen viento. |

Textos en español e inglés (alemán y francés usan el inglés hasta
traducirlos).

## Cómo se hace (técnico)

- Módulo pequeño propio en `app.js` (~200 líneas): sin librerías externas
  (el visor funciona sin internet a bordo).
- Cada paso: selector del elemento, título y texto (claves i18n), pestaña
  donde está. Si el elemento no existe o no se ve (por ejemplo sin
  Freeboard), el paso se adapta o se salta.
- Estilo con las variables y botones ya existentes (`button.primary`,
  `button.ghost`, color de acento, radio de la app).
- Marca de "visto" en el navegador del dispositivo (como la vista del
  panel multifunción), con versión del tour.

## Para decidir

1. ¿Te vale el guion así, o quitas / añades pasos?
2. ¿Repetir tour desde Info y el menú del barco, o en otro sitio?

## Versión implementada (Rev620-621)

Aprobado "de momento" por Carlos; tras verlo pidió viñetas, no tapar la
rosa, abrir de verdad Freeboard y la gráfica, y hablar de mareas.

16 pasos: bienvenida, rosa, esquinas, AP, modo y perfil, cambiar rumbo,
virar, panel multifunción, panel gráfica (se abre), la carta en la rosa
(Freeboard se abre), mareas y fondeo (solo si signalk-mareas-ihm está),
bitácora (solo si su botón está), pestañas, ajustes, setup, final.

- Textos en viñetas cortas (ES / EN).
- El bocadillo va debajo o encima del elemento; si es grande (la rosa en
  apaisado), al lado; nunca encima salvo que no quepa en ningún sitio.
- Lo que el tour abre (gráfica del panel, Freeboard en la rosa) se cierra
  al cambiar de paso o al saltar el tour, y el panel vuelve a la vista que
  tenía el usuario.
- Repetir: botón en la pestaña Info y "Tour guiado" en el menú del barco.

## Rev622

Carlos: el final como la primera página; AnchorWatch Pro siempre por su
nombre y abierto en el tour; Freeboard explicado como plotter gratuito; si
falta un plugin, captura simulada y botón Instalar; pasar por Info (repetir
tour, instrucciones) y por lo que hay que instalar; el dato de abajo en el
centro; Freeboard en el panel; invitar a explorar.

21 fichas: bienvenida, rosa, esquinas, dato de abajo en el centro, AP,
modo y perfil, rumbo, virar, panel, panel gráfica, panel plotter, plotter
en la rosa, AnchorWatch Pro mareas, AnchorWatch Pro fondeo, bitácora,
pestañas, ajustes, setup, qué instalar (lista de plugins de Info), Info,
final centrado.

- Plugin ausente (Freeboard-SK o AnchorWatch Pro, detectado al empezar el
  tour): la ficha no abre nada, enseña una captura real en `public/tour/`
  y un botón Instalar a su ficha de la App Store.
- Gráfica sin datos (en puerto): a los 1,5 s se enseña `tour/chart.jpg`
  como ejemplo navegando.
- Capturas: mareas y fondeo sacadas del visor actual en la Pi; gráfica con
  datos inventados; Freeboard en rosa y en panel, de las capturas de
  Carlos del 2026-11-01.
