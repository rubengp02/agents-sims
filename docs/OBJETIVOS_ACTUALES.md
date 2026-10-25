# Objetivos actuales de la oficina

Acordados con el usuario el 25 de octubre de 2026. Esta hoja de ruta establece
las nuevas prioridades; el objetivo anterior del ecosistema permanece cerrado
con sus limitaciones aceptadas. Registrar estos objetivos no acredita su ejecución.

## Prioridades y aceptación

| Prioridad | Trabajo                                                             | Por qué                                   | Evidencia necesaria para cerrar                                                                                                                                                                          | Estado                      |
| --------- | ------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| P0        | Resolver el fallo del runtime en CI                                 | Validar la última gran integración        | Identificar la ejecución y causa del fallo, corregirlo y acreditar una ejecución de CI satisfactoria de la revisión corregida. Un pase local no sustituye CI.                                            | En diagnóstico y corrección |
| P1        | Añadir un presupuesto de autonomía comprensible                     | Proteger la cuota frente a ciclos largos  | Mostrar consumo conocido, incertidumbre, progreso y motivo de pausa; comprobar continuación y recuperación sin borrar consumo ni imponer cortes arbitrarios de duración.                                 | Pendiente                   |
| P1        | Completar una ficha final de evidencias junto al resumen del Jefe   | Hacer la entrega más fiable y verificable | Una entrega identifica cambios, pruebas y resultados, artefactos, revisión y limitaciones; persiste al reabrir el chat y distingue simulación de comprobación real.                                      | Pendiente                   |
| P1        | Probar una tarea completa de programación con la interfaz real      | Validar el producto, no solo el backend   | Ejecutar una petición desde Conversaciones hasta cambios, pruebas, revisión y resumen final; conservar evidencia de la interfaz y verificar historial tras reabrir.                                      | Pendiente                   |
| P2        | Benchmark controlado de Codex individual frente al equipo iterativo | Medir calidad, tiempo y tokens            | Comparar tareas y condiciones equivalentes, con criterios de calidad previos y registro de tiempo, tokens, coordinación, revisión e integración; declarar consumos desconocidos y límites de la muestra. | Pendiente                   |
| P2        | Simplificar los módulos más extensos gradualmente                   | Reducir coste de mantenimiento            | Elegir módulos por evidencia de complejidad, extraer responsabilidades en cambios pequeños y verificar compatibilidad con pruebas pertinentes.                                                           | Pendiente                   |
| P3        | Perfeccionar la representación pixelada de trabajo y entregas       | Diferenciar el producto visualmente       | Propuesta aprobada por el director creativo, implementación vinculada a estados reales y comprobación visual de trabajo, pausa y entrega.                                                                | Pendiente de propuesta      |

## Orden de trabajo y reglas

1. Resolver P0 antes de ampliar capacidades. Recoger el fallo real de CI antes
   de atribuir una causa o modificar el runtime.
2. Abordar P1 en el orden de la tabla; usar la tarea real para comprobar también
   el presupuesto y la ficha final de evidencias.
3. Preparar el benchmark con condiciones y consumo acotados; no iniciar pruebas
   de IA ilimitadas ni recurrir a servicios de pago alternativos.
4. Simplificar gradualmente, evitando una reescritura general.
5. Presentar la propuesta visual P3 antes de cambios importantes de diseño.

El presupuesto de autonomía debe ser entendible y permitir tareas largas. Su
diseño no fija ahora un número de minutos, tokens o iteraciones: primero se revisan
los controles existentes y la evidencia de consumo. Se conservan la cuota incluida,
la parada del usuario, las pausas por incertidumbre y las aprobaciones externas.

Cada entrega registrará la revisión comprobada, qué se implementó, qué se probó
localmente o con simulaciones, qué se validó realmente y qué queda pendiente.
Los detalles privados y las transcripciones permanecen fuera de Git.

## Primer trabajo

P0 en curso. En la [ejecución de la última integración](https://github.com/rubengp02/agents-sims/actions/runs/40196864694),
el job Agent runtime falla en la batería de aplicación sin identificar el archivo;
su diagnóstico adicional muestra pruebas de navegador que intentan pulsar Settings
bajo Conversaciones. Las comprobaciones generales y el paquete Node 20 sí pasaron.

Correcciones locales: navegación visible para abrir Settings; pruebas de sesiones
externas adaptadas a su separación de los empleados; estado de trabajo basado
también en herramientas comunicadas por hooks, no solo en entradas JSONL; plazo
de 30 segundos para una prueba con varios worktrees Git (sin cambiar presupuestos
de ejecución); diagnóstico público de archivos Vitest fallidos sin publicar logs.

Evidencia local: 96 pruebas de interfaz; 19 de integración Git; cuatro de presencia;
dos del filtro de diagnósticos. La batería de navegador detectó el fallo real de
presencia: once recorridos pasaron y uno falló; tras corregirlo, ese recorrido
también pasó. Pendiente comprobar el conjunto corregido en CI y confirmar la causa
del fallo inicial de aplicación. No se declara cerrado P0.
