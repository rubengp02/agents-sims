# Orden de trabajo y paralelismo condicionado

Fecha: 21 de octubre de 2026.

Actualización: el intento posterior con Codex real está documentado en
[validación real](../validacion-real/VERIFICACION.md). Encontró un bloqueo de
herramientas y no valida todavía el desarrollo completo ni el paralelismo real.

## Comportamiento implementado

El Jefe propone dependencias e indica cuándo una tarea de lectura es independiente.
La aplicación valida el plan completo antes de crear tareas, añade barreras entre
análisis, desarrollo y QA, reordena las tareas cuando es posible y rechaza ciclos.
No añade personajes ni llamadas de clasificación por su cuenta.

Si el plan incluye Arquitecto o Diseñador, el Programador espera sus resultados.
El Tester espera a los pasos previos de análisis y desarrollo presentes en el plan.
Dos análisis sin dependencias mutuas pueden coincidir si el Jefe los declara
independientes. Una declaración ausente o dudosa conserva la ejecución por orden.

El límite es dos ejecuciones, ajustable a una. No se duplica el mismo personaje.
Las escrituras siguen siendo exclusivas: no se ha implementado trabajo paralelo
con cambios de código en copias aisladas, ni se han creado ramas/worktrees.
Las tareas directas conservan sus dependencias explícitas y no se suponen
independientes automáticamente.

CodexExecutor anuncia dos plazas de lectura y utiliza bloqueos locales compartidos
con el lanzador individual actualizado. Dos lectores tienen procesos y registros
separados; una tercera ejecución, un escritor incompatible o un bloqueo abandonado
impiden el arranque. Cada ejecución conserva su diagnóstico oficial de suscripción,
cuota y ausencia de créditos, sin API keys ni alternativas de pago.

Se reservan llamadas antes del diagnóstico concurrente y se considera el contexto
de entrada observado al reservar presupuesto para los lectores. El límite de tokens
sigue siendo orientativo entre llamadas; no es una garantía exacta dentro de una
respuesta ni una reserva de cuota del proveedor frente a otros clientes.

Las tarjetas explican las dependencias y el motivo de espera o exclusividad.
Se mantiene el diseño de la oficina. Claude continúa desactivado y con el mismo
bloqueo de verificación financiera; Antigravity no se ha conectado.

## Pruebas

- 559 pruebas de servidor.
- 52 pruebas de oficina/componentes.
- 7 pruebas de contrato de empaquetado.
- 8 pruebas de navegador standalone.
- Total: 626 pruebas automáticas correctas.

De ellas, 23 son nuevas para este cambio: normalización del plan, fases omitidas,
ciclos, lectura compartida, exclusión de escritores, bloqueos abandonados, límite
de dos procesos, orden de dependencias, independencia explícita, límite manual
de una ejecución y reserva de tokens durante concurrencia.

La prueba de navegador existente se ha ampliado a cinco personajes: Jefe,
Arquitecto, Diseñador, Programador y Tester. HTTP, WebSocket, React y canvas son
reales; el ejecutor es simulado. Se comprueba un pico de dos análisis concurrentes,
que el Programador esté solo y reciba ambos resultados, que QA arranque después,
la explicación de orden en las cinco tarjetas y el funcionamiento en móvil.

Otra prueba crea dos procesos locales de CLI simulados con PID diferentes y
comprueba el rechazo de un tercero y de una escritura incompatible. Se valida
el ejecutor real con dependencias de proceso sustituidas; no se llama a modelos.

TypeScript, compilación, formato y lint comprobados. Permanece el aviso anterior
de dependencias de un hook React en App.tsx; no hay errores nuevos de lint.
No se ha hecho inferencia real en esta fase: las pruebas no consumen cuota de
las suscripciones. No se presenta esto como una prueba de dos modelos reales
trabajando a la vez ni de la calidad semántica de un plan generado por un modelo.

## Revisión de la entrega

Autoevaluación según `agent-self-evaluation`: exactitud 4/5 (procesos y UI probados,
sin prueba de inferencia concurrente); completitud 4/5 (lecturas paralelas y fases
implementadas, escrituras aisladas fuera de alcance); claridad 4/5 (motivos visibles,
la independencia sigue siendo una propuesta del Jefe); utilidad 4/5 (servicio
compilado, cola aún no persistente); concisión 4/5 (sin dependencias nuevas ni
llamadas adicionales para clasificar). Media: 4,0/5.

Mejoras posibles: verificar una ejecución concurrente real cuando se quiera gastar
cuota en esa comprobación; añadir aislamiento de cambios si se solicita desarrollo
paralelo; recuperar cola y resultados tras reinicio si se pide persistencia.
La valoración debe entenderse junto con esas limitaciones, sin presentar las
simulaciones como ejecuciones de suscripción.
