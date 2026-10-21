# Contexto, reparto y clasificación: estudio preliminar

Seguimiento del 21 de octubre: [implementación, pruebas locales y piloto de dos
variantes](OPTIMIZACION.md). Ese piloto usa una tarea nueva y no sustituye ni
reescribe las cuatro ejecuciones históricas descritas aquí.

Fecha: 21 de octubre de 2026. Esta fase no ha llamado a modelos ni cambiado la
configuración de la oficina, instrucciones globales o diseño. Las variantes nuevas
están preparadas para comparar, todavía sin ejecución ni porcentajes de ahorro.

Actualización posterior: se aplicó la
[separación de instrucciones por proyecto](SEPARACION_INSTRUCCIONES.md), verificada
con cuatro diagnósticos locales sin inferencia. Las mediciones de este estudio
siguen describiendo el ensayo histórico anterior a esa separación.

## Lo que ya se ha medido

Se analizaron los cuatro recibos y sus historiales oficiales del ensayo aceptado.
El analizador solo escribe longitudes, contadores y tiempos; no copia instrucciones,
prompts, comandos, contenido de archivos ni credenciales al informe.

| Papel       | Entrada | Caché de entrada | Entrada sin caché | Salida | Tiempo CLI |
| ----------- | ------: | ---------------: | ----------------: | -----: | ---------: |
| Jefe        |  15.227 |                0 |            15.227 |    312 |   15,483 s |
| Arquitecto  |  28.792 |                0 |            28.792 |    232 |   12,372 s |
| Programador |  48.448 |           36.096 |            12.352 |  1.277 |   46,879 s |
| Tester      |  32.094 |           24.192 |             7.902 |    190 |   38,539 s |
| Total       | 124.561 |           60.288 |            64.273 |  2.011 |  113,273 s |

Fuente reproducible: [baseline.json](baseline.json). Los 126.572 tokens totales
son un 98,4 % de entrada; un 48,4 % de esa entrada figura en caché. El tiempo es
la suma de duraciones del CLI, incluidos sus controles, y excluye los huecos de
revisión y pausa humana. No es un percentil ni un promedio de varias repeticiones.
Cuatro ejecuciones CLI no equivalen necesariamente a cuatro consultas internas:
el modelo recibe resultados de herramientas y vuelve a responder dentro de la tarea.

Los cuatro contextos iniciales contenían un bloque de 14.033 caracteres con
instrucciones de AjudesClares. Se confirmó que el AGENTS.md global del usuario
contenía instrucciones de ese proyecto: 13.373 caracteres en el archivo original.
El bloque del historial incluye contexto adicional del proyecto de prueba.
Durante el estudio inicial no se modificó ese archivo; la migración posterior
se documenta por separado y no altera estas mediciones históricas.

En el Programador se observaron 21.546 caracteres de instrucciones base del CLI,
3.208 de catálogo de skills y el bloque de 14.033 del otro proyecto, además de
permisos, entorno y petición. **Caracteres no son tokens exactos** y estas sumas
no incluyen necesariamente todos los esquemas de herramientas ni instrucciones
ocultas. No puede deducirse un porcentaje de ahorro en tokens desde esas longitudes.

El Arquitecto con Luna tuvo más entrada sin caché que el Programador con Sol.
Eso no demuestra que un modelo sea más eficiente para el mismo encargo: realizaron
trabajos diferentes y recibieron cachés diferentes. Tampoco permite convertir
tokens o precios API en cuota de ChatGPT. Falta una comparación controlada.

## Qué debe decidir cada parte

El Jefe debe decidir qué resultados hacen falta, qué especialista los produce,
dependencias, riesgos y cuándo una incertidumbre justifica más análisis. La
aplicación debe aplicar el catálogo permitido, preparar contexto, comprobar cuotas,
controlar concurrencia y límites, ejecutar pruebas y registrar las mediciones.
No conviene añadir una llamada de clasificación IA a todos los encargos.

Para trabajo sencillo y conocido, reglas locales pueden seleccionar un circuito
preparado sin una llamada de planificación. Para peticiones inciertas o de varias
etapas, una única planificación compacta puede justificar los especialistas. Los
roles son responsabilidades, no un requisito de consultar siempre a cuatro modelos.

Propuesta de criterio técnico, todavía no implementado:

| Encargo                                                      | Circuito candidato                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Explicación breve o consulta concreta                        | Un agente, sin planificación separada                                           |
| Función pequeña con contrato y tests existentes              | Programador y aceptación local; revisión IA según riesgo                        |
| Cambio en varios componentes                                 | Planificación si hay incertidumbre, Programador y revisión independiente        |
| Arquitectura, datos, autenticación o cambios de alto impacto | Arquitecto y revisión independiente; pruebas obligatorias                       |
| Trabajo visual solicitado                                    | Diseñador cuando aporte una decisión necesaria; aprobación creativa del usuario |

La clasificación debe considerar alcance, riesgo, incertidumbre, archivos o módulos
afectados y disponibilidad de pruebas, además del texto del encargo. Las palabras
sueltas no bastan: documentar seguridad y modificar autenticación tienen riesgos
distintos. El modelo y razonamiento se eligen entre combinaciones disponibles y
comparadas; un resultado local simple usa la política sin inferencia, y el Jefe
solo propone elecciones dentro de ese catálogo. El usuario conserva su override.

## Cambios de contexto que merece la pena comparar

1. Delimitar las instrucciones por proyecto: mantener las normas universales y
   situar las específicas de AjudesClares en su ámbito correcto, tras revisar sus
   efectos. No resolverlo truncando instrucciones o quitando controles de seguridad.
2. Enviar a cada trabajador contrato, archivos relevantes, dependencias necesarias
   y criterios de aceptación. No pasar toda la conversación ni respuestas duplicadas.
   La oficina ya limita el handoff por caracteres; hay que medir su contenido útil.
3. Compartir un documento breve de proyecto con hechos estables y hashes/versiones.
   Recuperar detalles bajo demanda. Un archivo referenciado solo ahorra si evita
   lectura repetida: leerlo entero en cada paso también consume contexto.
4. Conservar instrucciones estables y aislar el contenido variable. Medir caché,
   no asumirla. La [documentación oficial de caché](https://developers.openai.com/api/docs/guides/prompt-caching)
   describe la reutilización del prefijo y la compatibilidad de configuración.
   Sus controles y precios API no se configuran aquí ni se trasladan a cuotas personales.
5. Evaluar continuación de sesiones para reparaciones del mismo trabajo cuando
   pueda conservarse correctamente el estado, modelo, permisos y controles de
   suscripción. [Codex CLI documenta resume por identificador](https://learn.chatgpt.com/docs/non-interactive-mode).
   No usar una sesión universal creciente ni compartir el contexto del autor con
   QA independiente por defecto. Reutilizar un muñeco no reutiliza una sesión CLI.
6. Ejecutar comprobaciones deterministas configuradas de forma local y entregar
   resumen, código de salida y rutas de evidencias. No gastar una consulta al modelo
   solo para pedirle arrancar un test. El comando autorizado y sus permisos requieren
   configuración; no se habilita ejecución arbitraria fuera del proyecto.

El catálogo de skills ya tiene un presupuesto de 1.000 tokens en las invocaciones.
La [referencia oficial](https://learn.chatgpt.com/docs/config-file/config-reference)
ofrece límites de catálogo y salida de herramientas; no son un límite del contexto
completo. Acotar herramientas y skills debe conservar las necesarias para la tarea.
Una respuesta más corta o razonamiento bajo no garantizan menor consumo total si
añaden lecturas, correcciones o más rondas; eso debe evaluarse con el resultado final.

## Comparación propuesta

Las [variantes y controles](experimentos.json) separan factores:

| Variante                                            | Cambia respecto a la anterior                            | Estado               |
| --------------------------------------------------- | -------------------------------------------------------- | -------------------- |
| A: cuatro papeles históricos                        | Referencia del caso ya aceptado                          | Una observación real |
| B: mismos papeles con contexto delimitado           | Contexto; conservar modelos y razonamiento               | Sin ejecutar         |
| C: Programador y Tester, mismo contexto B           | Número de especialistas, sin planificador en caso simple | Sin ejecutar         |
| D: Programador y aceptación local, mismo contexto B | Sustituir comprobación mecánica por ejecución local      | Sin ejecutar         |

Primero se comparan contextos manteniendo papeles y modelo. Después se estudia
reducir roles. Finalmente se comparan Luna y Sol y razonamientos bajo/medio sobre
los finalistas, con el mismo tipo de tarea y catálogo verificado. No probar una
matriz completa de todas las combinaciones de entrada: consumiría demasiada cuota.
No restar de A los tokens del Jefe y Arquitecto y presentar el resultado como
ahorro de C: las tareas y sus contextos cambiarían y hay que medirlos de nuevo.

Casos para una validación útil: explicación, función acotada, defecto con prueba
regresiva y cambio entre módulos. Un caso de seguridad mantiene revisión independiente
aunque una variante con menos agentes parezca más barata. El piloto empieza con
un caso y dos variantes; solo se amplía con señales de mejora y presupuesto definido.

Cada comparación real debe usar los mismos archivos iniciales, criterios de calidad,
permisos y herramientas; carpetas temporales independientes; registrar versión del
CLI y catálogo; alternar el orden y distinguir caché fría/caliente. Una sola
repetición orienta, pero no demuestra una mejora estable. Medir éxito al primer
intento, defectos, reparaciones, entrada total y sin caché, salida, tiempo total
y fases. El ganador debe cumplir primero la misma calidad y seguridad; entre
los válidos se buscan alternativas que no gasten más y tarden más simultáneamente.
No elegir pesos de precio API para representar una cuota cuyo cálculo se desconoce.

## Preparación entregada

`node scripts/context-study.mjs` reproduce el diagnóstico offline con los
historiales existentes. `node --test scripts/context-study.test.mjs` comprueba
privacidad de salida, caché, acumulación y contadores inválidos. Cuatro pruebas
superadas. No hay una variante ganadora ni porcentaje de ahorro demostrado.
La oficina y sus animaciones no se han modificado en esta fase.

Autoevaluación `agent-self-evaluation`: exactitud 4/5 (métricas locales verificadas,
sin conversión a cuota); completitud 4/5 (diagnóstico y comparación preparada,
variantes reales pendientes); claridad 4/5 (unidades y estados separados);
utilidad 4/5 (reproducción offline y criterio de aceptación); concisión 4/5 (sin
inferencias adicionales, matriz acotada). Media 4,0/5. Próximo paso concreto:
preparar el primer A/B con un presupuesto explícito, una vez verificada la separación
del AGENTS.md global, manteniendo las reglas universales y el control por suscripción.
