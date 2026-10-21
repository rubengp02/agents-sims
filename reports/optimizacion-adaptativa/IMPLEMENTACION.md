# Primera entrega implementada y comprobada localmente

21 de octubre de 2026. Se implementa la primera parte del plan aprobado, sin
inferencia real, sin activar Claude/Antigravity y sin cambios visuales. El informe
histórico C y la propuesta inicial se conservan sin alterar sus resultados.

## Qué cambió

- **P0:** historial agregado y deduplicado; estimación conservadora por perfil y
  contexto; revisión humana para incertidumbre; reserva del plan completo y
  conservación de tokens/tiempo y pausas. Pérdida de recibo se registra como
  consumo desconocido. La predicción histórica aún no es un límite del proveedor.
- **P1:** vía local del Jefe con cobertura verificada; propuesta de modelo/esfuerzo
  por tarea; planes completos validados antes de crear trabajadores. Dos módulos
  conocidos pueden usar un Programador; la cobertura declarada por IA no basta.
- **P2:** revisión independiente centrada en diff y pruebas de la misma revisión,
  evidencias con referencias validadas, comprobación de solo lectura y reutilización
  de pruebas vigentes. Para diffs grandes se conserva un bloqueo explícito.
- **P3 inicial:** ejecutor offline de las cinco variantes solicitadas más oficina
  adaptativa. Diecinueve escenarios con el coordinador real y respuestas conocidas.
  No es una evaluación de calidad ni eficiencia de modelos reales.
- **P4 conservado/reforzado:** continuidad explícita existente en AO, diferenciada
  en el presupuesto; el revisor siempre usa una sesión independiente. No se ha
  demostrado todavía una ventaja de continuar sesiones.
- **P5 pendiente:** no se habilitaron varios Programadores escribiendo en paralelo.
  Falta propiedad de archivos, integración y aceptación del resultado conjunto.

El servidor standalone conecta estas políticas al arrancar, manteniendo AO opcional
y el motor anterior por defecto. No se reinició la oficina abierta ni se arrancaron
tareas de modelo para probar la implementación. Los usos antiguos del constructor
sin servicios adaptativos permanecen como compatibilidad de pruebas/estudios; la
nueva evaluación inyecta explícitamente el runtime adaptativo, como producción.

## Evidencia local

- 19 pruebas nuevas cubren historial, censura, reservas completas, arranque sin
  datos, revisión humana, pérdida de recibos, cambio de asignación, selección del
  Jefe, cobertura inventada y revisión por diff con referencias verificadas.
- La matriz offline recorre 19 escenarios: 15 aceptados y 4 rechazados según lo
  esperado. Tres rechazos corresponden a variantes sin revisión de riesgo exigida
  en el caso delicado; el otro, a una implementación defectuosa inyectada.
  Son decisiones de política y pruebas de conectividad, no fallos medidos de IA.
- Cinco escenarios del puente nativo, con AO compilado y proveedor de protocolo
  simulado, comprueban transporte, continuidad, contadores, aislamiento y circuito.
- La batería completa, incluidas las pruebas previas de suscripción y permisos,
  está registrada en [VALIDACION_LOCAL.json](VALIDACION_LOCAL.json). Se conservan
  los avisos previos de React sin cambiar la interfaz para resolverlos.
  Superó 59 pruebas de interfaz, 660 de servidor y 7 de empaquetado (726 en total),
  además de 33 comprobaciones de políticas/estudios, 19 escenarios simulados y los
  cinco escenarios del puente nativo. Tipos, lint y compilación también pasaron.
- Se importaron siete observaciones históricas para calibración, con contexto
  desconocido y sin promociones automáticas. Volver a importarlas no duplica datos.
- Cero llamadas reales a modelos. La consulta de catálogo de la etapa de propuesta
  fue solo metadatos. En esta etapa las comprobaciones de proveedor de las pruebas
  son fixtures, no autenticación ni inferencia reales.

Las comprobaciones parciales pasaron y se repitieron al añadir agrupación por
riesgo/sesión y diagnóstico de recibos perdidos. No se descartaron casos fallidos
para mejorar cifras. Los intentos fallidos de parche durante edición no ejecutaron
modelos ni alteraron informes históricos. No hay reparaciones ni reintentos de IA.

## Límites prácticos

Todavía no hay un ahorro de cuota demostrado. Un modelo disponible no se considera
eficiente por su nombre: Luna para código permanece como candidato y la promoción
automática está vacía. El selector local conserva una opción equilibrada y respeta
las elecciones manuales; cada turno vuelve a validar suscripción y catálogo.

El límite inicial de 30.000 tokens no se ha aumentado. Puede ser insuficiente para
un trabajo real. Sin historial comparable el equipo pide revisión humana por la
API local; no hay una casilla visual nueva ni una calibración que gaste cuota sin
autorización. Los presupuestos de pilotos anteriores permanecen cerrados.

No se implementó todavía una memoria automática del Jefe, revisión paginada,
validación semántica universal de hallazgos ni integración entre worktrees de varios
escritores. La documentación de operación y alcance está en
[ORQUESTACION_ADAPTATIVA.md](../../docs/ORQUESTACION_ADAPTATIVA.md).

## Siguiente etapa recomendada

Ampliar la evaluación local con corpus externo, defectos no detectados por pruebas
públicas y calibración cronológica. Después, preparar una autorización real acotada
para comparar solo las combinaciones que tengan evidencia y presupuesto defendible.
Los Programadores paralelos deben incorporarse tras validar integración y conflictos;
no son un atajo para reducir tokens en tareas pequeñas.
