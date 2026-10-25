# P3: propuesta de representación del trabajo

El director creativo aprobó **Señales discretas** el 25 de octubre de 2026.
Implementada sobre los personajes y sprites existentes. La alternativa
«Entrega a la vista» se conserva como referencia y no se implementa.

**Señales discretas**, recomendada: una etiqueta breve sobre cada empleado
indica su actividad observable. El activo se distingue por una señal junto al
puesto. Una pausa detiene la representación de trabajo; solo el Jefe muestra
entrega cuando el objetivo dispone de cierre y revisión vigentes.

**Entrega a la vista**: añade a esas señales un espacio lateral de última entrega,
con archivos, pruebas y revisión. Da más presencia al resultado y ocupa más espacio.
Los detalles completos siguen en Conversaciones.

Las dos alternativas permiten explorar programación, revisión, pausa y entrega
en la vista previa. Se comprobaron los cuatro estados en escritorio y móvil,
sin desbordamiento ni errores de JavaScript. Esta comprobación corresponde a
la propuesta, no a una integración funcional con los eventos de la aplicación.

La conexión a estados registrados respeta estas reglas:

- No representar actividad de empleados a partir de sesiones ajenas observadas.
- Mostrar el papel y la acción comunicada; no inventar herramientas ni pensamiento.
- Un fallo, pausa, desconexión o espera de aprobación detiene la señal de trabajo.
- La entrega depende del estado registrado del objetivo, nunca de una animación.
- La señal de entrega conduce al resumen y las evidencias de la conversación.
- Respetar movimiento reducido y distinguir los estados con texto además del color.

## Implementación y comprobación

La presencia del servidor incorpora una señal derivada de la asignación registrada:
edición, comando, búsqueda, revisión o coordinación. Las aprobaciones pendientes,
pausas y cancelaciones tienen prioridad sobre una actividad anterior. Los empleados
observados fuera de la oficina no reciben estas señales. La entrega del Jefe exige
un objetivo completado con ficha de la revisión actual; el fin de una subtarea no
se presenta como entrega del objetivo. Las respuestas directas se distinguen de
las entregas revisadas.

La etiqueta permanece visible sobre el personaje sin necesidad de seleccionarlo.
El clic selecciona la conversación mediante la API local protegida y abre
Conversaciones, donde se encuentran el resumen y las evidencias. Si la operación
falla se informa del error. Una conexión perdida desactiva la etiqueta y la señal
de trabajo; los sprites y las personalizaciones se conservan.

Verificación sin cuota: 103 pruebas de interfaz; regresiones de presencia y señales
para subtareas, revisiones antiguas, cancelación y permisos; y navegador Edge con
servidor real, personajes reales y tareas simuladas. Se comprobaron trabajo,
revisión, pausa y entrega en anchuras de 1280 y 390 px, navegación a la conversación,
pérdida de conexión y movimiento reducido. Las capturas se revisaron visualmente.
No hubo inferencia de un modelo en este bloque. La compilación de interfaz se
comprobó en una carpeta separada, sin reemplazar el servidor personal.

La actualización del servidor activo queda pendiente: el árbol compartido contiene
cambios ajenos de proveedores y runtime; esta entrega no los incluye ni los despliega.
