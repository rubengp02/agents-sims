# P1: presupuesto, evidencias y programación desde Conversaciones

Verificado el 25 de octubre de 2026. Esta comprobación usa Codex App Server
oficial y cuota incluida; las pruebas habituales del repositorio usan simulaciones.
No acredita una mejora general del equipo frente a Codex individual.

## Implementación

- Presupuesto plegable con intentos, tokens comunicados y consumo desconocido.
  La cuota compartida de la suscripción se muestra por separado. Se conserva
  el margen existente del 10%; no se introduce un corte temporal en el chat.
- Ficha persistente junto al resumen final del Jefe: archivos y huellas comparados,
  pruebas registradas por el servidor, revisión independiente vigente, artefactos
  y limitaciones. Las afirmaciones del modelo no se convierten en pruebas.
- Corrección de las aprobaciones de archivos: el adaptador rechazaba también las
  ediciones locales autorizadas. Ahora acepta una sola propuesta observada del
  Programador, vinculada a su conversación, turno e identificador. Comprueba todos
  los archivos y destinos de movimientos dentro del proyecto; rechaza enlaces,
  archivos sensibles, cambios desconocidos y ampliaciones de raíz. No concede
  permisos de sesión ni escritura a los lectores. Cancelar o redirigir invalida
  las propuestas pendientes.

## Recorrido real

En Edge, desde la interfaz de Conversaciones, se registró un proyecto de prueba
aislado y se pidió corregir una función que inicialmente devolvía el texto sin
normalizar. Cinco pruebas independientes, preparadas antes de la inferencia,
exigían recortar, colapsar espacios y tabulaciones, conservar acentos y mayúsculas,
usar un texto de reserva y conservar un nombre válido. El encargo incluía saltos
de línea; el Tester los comprobó adicionalmente, sin modificar las pruebas.

Resultado verificado:

- Jefe → Programador → Jefe → Tester → resumen final, cinco turnos oficiales.
- Solo cambió `src/label.mjs`; pruebas, configuración e instrucciones permanecieron
  intactas. La comprobación registrada `test` terminó con código 0; también pasó
  una ejecución independiente posterior de las cinco pruebas.
- El Tester revisó sin escribir y su huella coincide con la de la entrega.
  Su comando Git no reconoció el árbol de trabajo; contrastó el diff proporcionado
  con el archivo actual. No se presenta ese comando fallido como una prueba pasada.
- La ficha muestra ejecución oficial y no simulada. No hay artefactos en este caso.
- Presupuesto completo: cinco intentos, cero recibos desconocidos, **310.350 tokens**
  comunicados y **196.088 ms** acumulados en ejecuciones. Incluyen contexto cargado
  y entrada en caché; no equivalen a precio ni a un porcentaje de suscripción.
- Recargar y reconstruir el servidor de prueba conservó mensajes, ficha y
  presupuesto con las mismas huellas, sin nuevas inferencias.

Se conservan también las incidencias del primer proyecto de prueba: un límite
de 30.000 tokens introducido en el verificador y el rechazo erróneo de escritura
del adaptador. La continuación respetó ese rechazo histórico y pidió aclararlo.
Ese proyecto acumula cinco intentos y 262.967 tokens: es coste de diagnóstico,
separado de los cinco turnos del caso satisfactorio, no una segunda aceptación.
No se borraron recibos ni se repitió una operación externa.

## Pruebas locales y actualización

- 63 pruebas focalizadas de protocolo y permisos, sin inferencia.
- Batería completa con dos trabajadores: **1.142 aprobadas, dos omitidas**.
  En la primera ejecución concurrente, 1.141 pasaron y una integración Git agotó
  su espera; pasó aislada y después en la batería completa. No se aumentó su plazo.
- Tipos, lint y empaquetado aprobados. Permanecen los avisos conocidos del efecto
  de `App.tsx` y del tamaño del bundle.
- Las comprobaciones anteriores de interfaz cubren escritorio, móvil, adjuntos,
  pausa, recibos incompletos y recuperación. No se atribuyen a un modelo real.
- Oficina local actualizada estando inactiva: **diez conversaciones y 135 mensajes**.
  La huella de todos los campos originales coincide antes y después. Solo se añadió
  `autonomyBudget` a las respuestas recuperadas. No se reanudó trabajo.

El [CI del presupuesto](https://github.com/rubengp02/agents-sims/actions/runs/40209178594)
terminó correctamente. Las revisiones posteriores requieren su propio resultado
de CI; este documento no lo sustituye. Capturas, recibos y transcripciones de
aceptación permanecen en el almacén privado local, fuera de Git.

## Límites de esta aceptación

Es una tarea pequeña sobre JavaScript, en un proyecto de prueba y una máquina
Windows. Verifica el recorrido de programación y persistencia, no todos los
lenguajes, herramientas externas, diseños posibles ni la eficiencia del equipo.
El benchmark controlado de P2 sigue pendiente.
