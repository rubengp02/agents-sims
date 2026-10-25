# Conversaciones como centro de la oficina

Implementación y comprobación local del 22 de octubre de 2026. El plan visual
y el comportamiento de pendientes y redirección fueron aprobados por el usuario.

## Entregas implementadas

1. Chat a pantalla completa, navegación plegable de 260 px y columna de hasta
   800 px. Tipografía del sistema, mensajes de 16 px, historial legible y escritura
   disponible mientras trabaja. La oficina pixelada conserva su editor y ajustes.
2. Un estado actual derivado del servidor junto al cuadro de escritura. Actividad
   interna desplegable, entregas finales y adjuntos visibles, confirmaciones dentro
   de la conversación y avisos antiguos sin atribuciones no demostradas.
3. Pendientes persistentes con identificador y revisión. Despacho en orden tras
   cerrar el objetivo completo y liberar sus recursos, con un único trabajo activo.
   Parada, error, cancelación y reinicio retienen los mensajes sin ejecutarlos.
4. Aplicar ahora mediante `turn/steer` con identidad del turno comprobada. Si trabaja
   un empleado, se detiene de forma controlada y vuelve el Jefe. Cambiar requisitos
   invalida la revisión anterior y las aprobaciones de la operación sustituida.
   Una entrega incierta pausa el objetivo y conserva el mensaje para revisión.
5. Comprobaciones automáticas, navegador, prueba real acotada y actualización local
   sin reanudar encargos ni alterar el contenido del historial del usuario.

## Evidencia

- Servidor: 911 pruebas aprobadas y dos pruebas opcionales omitidas.
- Interfaz: 72 pruebas aprobadas.
- Contrato del paquete: siete pruebas aprobadas.
- Tipos, lint y empaquetado de producción aprobados. Vite advierte del tamaño del
  paquete principal; no impide compilar.
- Navegador Edge: tres recorridos aprobados con procesos HTTP y almacenes reales,
  ejecutores de IA simulados. Incluyen imágenes, pegado y arrastre, persistencia,
  aprobaciones, modo manual, autonomía, pendientes, edición, retirada y redirección.
- Capturas de escritorio y móvil de chat vacío, historial largo con imágenes y
  mensajes pendientes. Se comprueba que no hay desbordamiento horizontal, que el
  cuadro de escritura está visible y que actualizar mensajes no desplaza al lector
  cuando está leyendo el principio del historial. El texto largo de esta prueba
  visual se inyecta como datos simulados; no acredita inferencia.
- Revisión independiente con tres pruebas de regresión: selección de modelo
  interrumpida, entrega nativa incierta y error posterior al envío. Los tres casos
  están corregidos y aprobados.

## Comprobación con Codex real

En una carpeta temporal y con cuota incluida comprobada, una petición leyó un
archivo y realizó una espera local. Durante su turno se guardó un seguimiento
y se aplicó una corrección inmediata. La respuesta incorporó la corrección y,
tras finalizar, se ejecutó el seguimiento. Dos ejecuciones completadas y cinco
mensajes recuperados al reabrir el almacén, sin cambios en el archivo de prueba.

El primer intento detectó un problema: una indicación de formato colocaba texto
después del marcador de resultado y la oficina bloqueaba el cierre. Se corrigió
conservando explícitamente el contrato de resultado al redirigir, sin relajar su
validación. Otro contraste detectó estados de peticiones desactualizados; ahora
petición, indicaciones y respuesta conservan el mismo estado final.

La evidencia privada está en `.local-office/chat-real-acceptance/verified.json`;
los recibos y las transcripciones no se publican. El recorrido nuevo de interrupción
de especialistas y revisión del Jefe se comprobó con simulaciones, no con una nueva
evaluación real de toda la oficina. La aceptación estética final corresponde al usuario.

## Actualización de la instancia

Se actualizó `http://127.0.0.1:4173` cuando no había ejecuciones activas.
Conserva sus 15 encargos y 30 mensajes. La comparación de identificadores,
contenido y referencias de adjuntos antes y después coincide; no se reanudó
ningún encargo. La inspección del navegador en esta instancia confirma un solo
estado actual, texto del sistema a 16 px y ausencia de desbordamiento horizontal.
Las capturas privadas están en `.local-office/chat-live-desktop.png` y
`.local-office/chat-live-mobile.png`.
