# Primer piloto real del paralelismo: preparación

Estado: preparado para revisión de límites; **sin inferencias reales**.

## Comparación concreta

Un encargo aislado implementa un lector CSV estricto y un planificador de
dependencias en dos módulos. Sus interfaces están fijadas y no dependen de la
implementación del otro. Un test conjunto procesa un CSV y planifica sus trabajos.

Se comparan Codex individual estricto, sin delegación, y la oficina con dos
Programadores aislados mediante AO fijado e integración en una tercera copia.
El Jefe usa evaluación local y un reparto explícito por contratos independientes.
No se fuerza un equipo de Arquitecto, Tester y Programador. La revisión es
mecánica en este ejercicio aislado de bajo riesgo. No se trata de una prueba
de planificación libre con IA, tareas acopladas o varias familias de problemas.

Mismo encargo, base inicial, aceptación de 50 pruebas, modelo
`gpt-6.1-sol`, razonamiento `low`, sesiones nuevas y permisos de escritura sobre
los mismos dos archivos. El trabajador de cada módulo solo puede editar el suyo.
Contrato, instrucciones y pruebas no pueden cambiar. Los checks por módulo
preceden a la integración y la aceptación completa se repite sobre el candidato.

El motor del baseline es Codex CLI; el paralelo utiliza el adaptador opcional de
AO para Codex. Por ello mide el circuito de producto completo, no exclusivamente
el efecto de dos escritores en un motor idéntico. No se reutiliza el baseline
histórico porque no tiene el mismo encargo. Orden directo primero: una sola pareja
no elimina sesgos de orden/caché ni demuestra un beneficio generalizable.

## Límites propuestos, pendientes de autorización exacta

| Límite                                      | Valor                                |
| ------------------------------------------- | ------------------------------------ |
| Ejecuciones de modelos                      | 3: una individual y dos trabajadores |
| Simultáneas                                 | 2                                    |
| Tokens observados totales, entrada + salida | 200.000                              |
| Reserva individual                          | 80.000                               |
| Reserva por trabajador                      | 60.000                               |
| Tiempo global                               | 12 minutos                           |
| Tiempo máximo por llamada                   | 3 minutos                            |
| Tiempo de oficina, incluido el circuito     | 8 minutos, dentro del global         |
| Preparación / integración                   | 20 segundos de reserva cada una      |
| Reparaciones o reintentos automáticos       | 0                                    |

Se detiene ante cuota no verificada, créditos adicionales, consumo desconocido,
exceso de presupuesto, fallo de aceptación o de integración. Cada arranque se
persiste antes de enviar el encargo. El diario no se sobrescribe ni concede
presupuesto nuevo al reiniciar. La primera causa de parada se conserva.

El CLI comunica tokens al finalizar el turno: estos valores **no son un límite
duro garantizado por el proveedor**. Un exceso observado pausa lo restante y se
registra; no se oculta ni permite aceptar el resultado como mejora.

Se registran recibos, suscripción comprobada, modelo solicitado/confirmado,
versión del CLI cuando se comunica, entrada, salida, caché, entrada no cacheada,
contadores de herramientas/turnos cuando existen, tiempo de pared, suma de
duraciones, planificación local, preparación, integración, checks y concurrencia.
La caché ya forma parte de la entrada. Desconocido nunca se transforma en cero.
Los prompts y eventos crudos permanecen privados.

## Validación sin modelo y errores conservados

La aceptación rechaza el código inicial (48 fallos de 50), acepta la referencia
(50/50) y rechaza el conjunto cuando solo se ha implementado correctamente el CSV,
aunque sus pruebas individuales pasen.

Las pruebas del piloto usan proveedores inyectados y procesos/Git/checks reales.
Comprueban bloqueo sin autorización, circuito completo con concurrencia dos,
integración conjunta, rechazo de repetir el mismo diario, consumo perdido y
parada ante exceso de tokens. Sus resultados son simulaciones y se guardan en
`.local-office`, separados de los informes de inferencia real.

Primer ensayo: tres fallos al heredar el contexto del runner Node en pruebas
anidadas. Se aisló el entorno de los checks con una lista de variables permitidas.
Segundo ensayo: bloqueo por añadir especialistas al no acreditar cobertura; el
registro local se vinculó a los criterios exactos de cada módulo y del conjunto.
Tercer ensayo: presupuesto de tiempo del circuito secuencial previo no cabía
en seis minutos. La preparación se corrigió antes de solicitar autorización:
ocho minutos de oficina, conservando doce globales y tres por llamada.
Posteriormente pasaron los casos de simulación. No hubo llamadas reales ni se
cambiaron límites autorizados: estos límites todavía están pendientes.

La lógica del runtime, la interfaz y los recursos visuales no se modifican.
Claude permanece desactivado y Antigravity desconectado. Las comprobaciones de
suscripción oficiales se mantienen en cada ejecución; no se leen credenciales.

Para ejecutar se necesita autorización vigente vinculada al hash del PLAN y a
estos límites. No se genera un `approved: true` a partir de esta preparación.
El protocolo vigente exige aprobación nueva de límites antes de la inferencia.

Preparación final: `parallel-dccc1111`. Pasaron 7/7 pruebas del piloto y del
protocolo futuro, además de tipos. La consulta oficial de metadatos confirmó
Plus y `gpt-6.1-sol/low`; no ejecutó inferencia. La aprobación pendiente permanece
en falso. El plan completo está en [PLAN.json](parallel-dccc1111/PLAN.json).
