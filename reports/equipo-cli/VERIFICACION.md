# Coordinación local de agentes: comprobación

Fecha: 20 de octubre de 2026.

Este informe describe la entrega inicial. El cambio posterior de orden de fases
y lectura simultánea se documenta en [verificación de paralelismo](../paralelismo/VERIFICACION.md).

## Entrega

- Panel Equipo con las vistas Oficina y panel / Mesa de asignaciones.
- Modo automático inicial; manual y mixto con confirmación por tarea.
- Cola con roles, dependencias, asignaciones revisables, cancelación y pausa.
- Jefe planificador mediante el ejecutor oficial Codex: una llamada y validación
  del JSON antes de crear tareas. No ejecuta automáticamente el plan.
- Selección acotada por reglas de dificultad y catálogo real; sin llamadas
  adicionales para clasificar ni ampliación automática a otros modelos.
- Escritura explícita, límites por tanda y contexto de dependencias acotado.
- Puente a los personajes y al protocolo de actividad de la oficina existente.
- Diagnóstico Claude oficial, desactivado inicialmente y sin inferencia autorizada.
- Código adaptado de Claw-Empire con licencia y procedencia conservadas.
- Cierre local que detiene tareas antes de terminar el host, incluido Windows.

## Pruebas automáticas

Las pruebas usan datos temporales y ejecutores/procesos simulados. No conectan con
cuentas ni modelos reales.

| Grupo                            | Resultado   |
| -------------------------------- | ----------- |
| Servidor y ejecución             | 536 pruebas |
| Oficina y componentes existentes | 52 pruebas  |
| Contrato de empaquetado          | 7 pruebas   |
| Navegador standalone             | 8 pruebas   |
| Total                            | 603 pruebas |

Cobertura añadida: combinación de dos proveedores simulados, orden y contexto de
dependencias, selección acotada, elección manual, confirmación mixta, límites,
reserva de llamadas concurrentes, ausencia de fallback, pausas durante diagnóstico,
cancelación, cierre, planes inválidos, cuota desconocida, entorno y gate Claude,
puente a personajes y controles HTTP locales.

La prueba de navegador utiliza HTTP, WebSocket, React y canvas reales con un
ejecutor simulado. Recorre planificación, dependencias, tres personajes y respuesta;
comprueba ambas vistas, anchura de móvil y ausencia de errores JavaScript.

Compilación, TypeScript, ESLint y comprobación de formato ejecutados. Permanece un
aviso anterior de dependencias de un hook React en App.tsx; no hay errores de lint.
Se comprobó el manifiesto real de `npm pack --dry-run --ignore-scripts`: incluye
ambos ejecutables, avisos de atribución y copia de la licencia de Claw-Empire.

## Comprobación real adicional de esta integración

El panel/servicio local comprobó la sesión ChatGPT, cuota, ausencia de créditos y
catálogo a través del CLI oficial antes de autorizar una tarea de solo lectura.

- Proveedor: Codex.
- Modelo solicitado: GPT-6 Luna, razonamiento bajo.
- Resultado esperado y obtenido: `OFICINA_MULTIAGENTE_OK`.
- Estado: completada; personaje asociado en el almacén de la oficina.
- Llamadas de inferencia en esta comprobación: una.
- Consumo comunicado: 14.070 tokens entre entrada y salida, incluido contexto base.
- Identificador del registro: `cb839391-38eb-4e4c-ba34-08ef722ba34e`.
- Herramientas, escrituras, API keys o compras de créditos: ninguna solicitada.
- El CLI no comunicó un modelo confirmado: el dato permanece nulo.

El resto de comprobaciones locales fueron diagnósticos, compilaciones o pruebas
offline. El servidor se reinició para cargar la versión final; la tarea de prueba
no se reinyectó como demostración ni se presentó como nueva ejecución.

## Límites honestos

1. Claude Code no está instalado en este ordenador. El diagnóstico devuelve
   `claude_missing` sin inferencia. Aunque se instale e inicie sesión, falta una
   comprobación oficial previa de créditos adicionales; continúa bloqueado bajo
   las reglas actuales. No hay prueba real conjunta Claude/Codex.
2. El presupuesto de tokens se controla entre llamadas y no garantiza un corte
   exacto dentro de una respuesta. Las comprobaciones de cuota son independientes.
3. Prompts, respuestas, cola y contadores de equipo viven durante la sesión del
   servidor. Los ajustes y metadatos de ejecución sí se guardan. Continuar una
   tarea pausada inicia una ejecución nueva; no hay recuperación automática de
   contexto ni de trabajo tras un reinicio.
4. Un proceso por proveedor. Las tareas Codex se ejecutan en serie. La capacidad
   de dos proveedores se valida offline, sin habilitar Claude artificialmente.
5. La evaluación de dificultad es por reglas; no es un benchmark de modelos ni
   una prueba de que un modelo tenga la mejor calidad en todos los trabajos.
6. Antigravity no se ha conectado. No se ha sustituido el motor visual de Pixel
   Office ni incorporado la interfaz de Claw-Empire.

## Autoevaluación de la entrega

Aplicada la guía `agent-self-evaluation`; media: 3,8/5.

| Eje                | Valor | Evidencia y mejora                                                                                                                                                    |
| ------------------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exactitud          | 4     | Ejecución real Codex y pruebas deterministas; Claude se declara bloqueado. Falta verificación real Claude cuando exista una superficie oficial suficiente.            |
| Completitud        | 3     | Coordinación y controles implementados; la ejecución conjunta real queda bloqueada por instalación y verificación de consumo de Claude. No se rebaja esa restricción. |
| Claridad           | 4     | Guía breve de uso y separación entre solicitado/confirmado. Algunos códigos de pausa siguen siendo técnicos.                                                          |
| Utilidad inmediata | 4     | Oficina iniciada y control Equipo disponible. La cola no se recupera tras un reinicio.                                                                                |
| Concisión          | 4     | Reutiliza oficina y ejecutor sin dependencias nuevas; documentación técnica separada de las instrucciones básicas. El coordinador puede dividirse si crece.           |

Mejoras por impacto: mantener visible el bloqueo de Claude; recuperar tareas de
forma segura si el usuario pide persistencia; sustituir códigos de pausa por
mensajes aún más sencillos. El bloqueo de Claude no se resuelve suponiendo una
configuración financiera ni usando APIs de pago.

¿Coincidiría el usuario con esta evaluación? Debería poder usar Codex ahora, pero
la expectativa de trabajo conjunto real con Claude aún no está satisfecha. Se
entrega lo implementado y verificado con esa limitación explícita.
