# P3: propuesta de representación del trabajo

Preparada para aprobación creativa; no aplicada a la interfaz de la oficina.
Las dos vistas previas usan estados ilustrativos y conservan la idea de los
personajes y sus puestos. La implementación conservará los sprites existentes.

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

Antes de implementar se requiere la elección del director creativo según AGENTS.md.
La conexión a estados reales deberá respetar estas reglas:

- No representar actividad de empleados a partir de sesiones ajenas observadas.
- Mostrar el papel y la acción comunicada; no inventar herramientas ni pensamiento.
- Un fallo, pausa, desconexión o espera de aprobación detiene la señal de trabajo.
- La entrega depende del estado registrado del objetivo, nunca de una animación.
- La señal de entrega conduce al resumen y las evidencias de la conversación.
- Respetar movimiento reducido y distinguir los estados con texto además del color.
