# Quince encargos de programación para una evaluación de producto

Estado: diseño para revisión, sin ejecución real ni autorización. Estos casos
son trabajo sobre una aplicación existente, no ejercicios de funciones aisladas.
Se eligió Agents Sims porque es el producto que queremos poder utilizar cada día.
La conclusión de esta batería quedaría limitada a esta aplicación y esta clase
de trabajo; no representaría todos los lenguajes o repositorios del mundo.

Base candidata: `59fdf10242954336966a2dcf3903c12ccb745b6f`, que se congelará o
sustituirá expresamente al preparar la evaluación. No se probarán tareas ya
implementadas contra una aceptación que pasaría sin cambiar nada. Cada caso
requiere prevalidación de su base y pruebas de aceptación externas aún por crear.
Las áreas de código que se citan existen; los resultados pedidos son propuestas,
no nuevas capacidades que afirmemos tener terminadas.

La dificultad es provisional por riesgo, dependencias y amplitud, no una cuota
de líneas. Una revisión local puede reclasificar antes de congelar el protocolo;
nunca después de ver qué estrategia gana. Los casos se ejecutan desde copias
independientes de su base, no encadenando soluciones de casos anteriores.

## Cinco sencillos

### S01 — Conservar un encargo al cerrar y abrir Equipo

Petición: «Si cierro el panel para mirar la oficina, conserva el proyecto y lo
que estaba escribiendo cuando lo abra de nuevo».

- Área existente: estado React de `TeamPanel` y `TeamScopeForm`, montaje en `App`.
- Aceptación: conserva proyecto, objetivo, permiso y borrador avanzado durante
  la misma sesión; una recarga puede descartarlos si ese es el contrato acordado;
  no modifica escenarios ni distribución; cerrar no cancela el trabajo del servidor;
  abrir no lanza inferencia ni registra el borrador en el informe público.
- Evidencia: prueba de navegador de cierre/reapertura con borrador simple y con
  reparto, cero despachos al abrir, continuidad de una ejecución simulada en curso.
- Completarlo exige integrar formularios y ciclo de vida, no solo almacenar un texto.

### S02 — Guardar ajustes iguales sin perder asignaciones

Petición: «No me hagas elegir y confirmar otra vez los modelos si no he cambiado
realmente los ajustes».

- Área: `TeamCoordinator.configure`, ajustes y tarjetas actuales.
- Aceptación: un guardado idéntico conserva modelo, confirmación y estado;
  un cambio efectivo mantiene las invalidaciones de seguridad necesarias;
  no modifica contadores; no permite cambiar configuración durante actividad;
  el resultado se mantiene al consultar de nuevo el estado.
- Evidencia: pruebas de servidor y HTTP con modo automático/mixto/manual, guardado
  idéntico y cambio efectivo, y comprobación de ausencia de despachos adicionales.

### S03 — Explicar pausas con una acción concreta

Petición: «Cuando no puedas continuar, dime qué falta y qué puedo hacer sin
cambiar de sistema de pago ni borrar mi trabajo».

- Área: códigos `ExecutionBlocked`, respuesta local y presentación textual actual.
- Aceptación: motivos de cuota no verificable, presupuesto pendiente, consumo
  desconocido y recuperación tienen explicación diferenciada; conservan código
  técnico como detalle; un código nuevo tiene explicación segura genérica;
  ningún texto promete reiniciar una cuota o aceptar un candidato; no cambia el layout.
- Evidencia: tabla de casos y navegador con errores inyectados, sin mostrar
  mensajes crudos del proveedor ni habilitar un botón de reanudación indebido.
- El texto propuesto se aprobará antes de cambiar la presentación del producto.

### S04 — Diferenciar prueba fallida de prueba no ejecutada

Petición: «Si falla la primera comprobación, quiero saber cuáles fallaron y cuáles
no llegaron a ejecutarse».

- Área: `LocalChecks.run`, resultados de tarea y conjunto.
- Aceptación: conserva orden y ejecución una sola vez; una prueba fallida no marca
  las siguientes como superadas; informa las omitidas; abortar deja cancelación
  diferenciada; conserva código de salida y duración; ninguna tarea queda aceptada.
- Evidencia: procesos locales con tres checks, fallo del primero, aborto del segundo
  y éxito completo. No se ejecuta un modelo para arrancar las pruebas.

### S05 — Obtener un resumen compartible sin datos privados

Petición: «Necesito compartir el resultado y las pruebas sin enviar mis prompts,
rutas personales ni mensajes del proveedor».

- Área: recibos, `UsageHistory` y rutas HTTP protegidas existentes.
- Aceptación: exporta ID de encargo/ejecución, resultado, conteos y pruebas;
  omite prompts, comandos, argumentos, tokens de control y rutas absolutas;
  conserva `null` para consumo desconocido; caché no se suma al total de entrada;
  mantiene origen y nonce en las mutaciones si las hubiera.
- Evidencia: HTTP y prueba de privacidad con canarios, recibo final e interrumpido.
  No requiere crear un nuevo panel o un nuevo motor de informes.

## Cinco de dificultad media

### M01 — Registrar y volver a seleccionar proyectos

Petición: «Quiero incorporar un proyecto una vez y después elegirlo por nombre».

- Área: validación de carpeta, almacenamiento local, API del equipo y estado del panel.
- Aceptación: registro local persistente con identificador y nombre; carpeta real
  validada; reapertura recupera la lista; carpeta desaparecida se explica sin crearla;
  una ruta remitida por un modelo no registra un proyecto ni amplía permisos;
  sin exploración indiscriminada del disco ni ejecución de scripts.
- Evidencia: reinicio de servidor, carpeta renombrada/eliminada, entrada ajena y
  selección mediante contrato de cliente. Diseño de selector pendiente de aprobación.

### M02 — Asociar comprobaciones al proyecto correcto

Petición: «Al cambiar de proyecto, utiliza sus pruebas aprobadas y no las de la oficina».

- Área: construcción en `cli.ts`, `pixelOfficeChecks`, `LocalChecks`, catálogo público.
- Aceptación: dos proyectos con registros aprobados diferentes; el catálogo y ejecución
  usan el proyecto elegido; un ID ajeno se rechaza; no se acepta shell o ejecutables
  enviados por HTTP; un repositorio sin perfil pide incorporación; cobertura completa
  no se declara desde el modelo. Conserva el perfil actual de Pixel Office.
- Evidencia: dos repositorios temporales de aplicación con scripts distintos,
  resultados identificables, rutas ajenas y pruebas de origen/nonce.

### M03 — Entregar cambios y aceptación de un encargo individual

Petición: «Al terminar, dame los archivos cambiados, las pruebas y los problemas
del encargo en una entrega única».

- Área: captura de revisión y diff, tarea individual, checks y recibos.
- Aceptación: base capturada antes de escribir; registra archivos añadidos,
  modificados y eliminados; asocia pruebas a la huella candidata; separa cierre de
  CLI y aceptación; un cambio posterior invalida pruebas vigentes; conserva trabajo
  previo del usuario y no atribuye esos cambios al agente; sin merge o push automático.
- Evidencia: modificación controlada antes/durante/después, pruebas fallidas y
  repositorio con trabajo previo. Contrato de entrega verificable sin rediseñar UI.

### M04 — Reparar una tarea bloqueada sin repetir el plan completo

Petición: «Si una prueba falla, corrige esa incidencia conservando lo ya hecho y
el presupuesto restante».

- Área: continuación explícita, dependencias, recibos, historial, cotas y pausa.
- Aceptación: la reparación es una ejecución nueva identificada y expresamente
  autorizada; recibe defecto y diff vigentes, no todo el historial; no repite
  análisis completados; conserva total y consumo desconocido; bloquea si no cabe;
  tras reparar vuelve a ejecutar aceptación conjunta; el revisor no continúa la
  sesión del autor. No se activa reparación por el mero hecho de abrir el panel.
- Evidencia: primer resultado defectuoso simulado, reparación válida, falta de
  presupuesto y recibo perdido. Se cuenta toda intervención humana.

### M05 — Seguir las pruebas locales en curso

Petición: «Quiero saber si estás implementando o comprobando y qué prueba está
en marcha, sin confundirlo con una consulta a la IA».

- Área: `CheckRunner`, coordinador, snapshot/observador y reconciliación existente.
- Aceptación: inicio/fin/resultado de cada check con IDs de tarea y flujo; secuencia
  correcta tras recarga; duración medida y no inventada; cancelación no aparece
  como éxito; no duplica personajes; no publica comandos ni output crudo; consumo
  de inferencia de los checks separado y cero. Sin cambiar animaciones ni colores.
- Evidencia: check lento local, recarga durante ejecución, desconexión, fallo y pausa.

## Cinco complejos

### C01 — Resolver una petición cotidiana con un único Codex cuando basta

Petición: «En este proyecto registrado, corrige el error que describo y entrégame
el resultado comprobado sin obligarme a preparar el contrato técnico».

- Área: entrada del encargo, decisión local del Jefe, tareas, permisos, presupuesto,
  checks y entrega. Se apoya en el proyecto/perfil preparado para todas las variantes.
- Aceptación: una petición clara con perfil y aceptación acreditada usa un Codex,
  sin planificador IA separado; falta de aceptación pide la aclaración concreta;
  una solicitud delicada conserva revisión justificada; permiso de escritura
  denegado se respeta; reserva completa antes de arrancar; cierre solo con evidencia.
  Manual y mixto siguen requiriendo sus confirmaciones.
- Evidencia: contrato HTTP y navegador con proveedores deterministas y entornos
  reales de aplicación. La aceptación evalúa lo implementado, no el papel usado
  por el baseline para producirlo. No se exige a Codex directo aparentar una oficina.
- Paralelismo: no propuesto; el trabajo está acoplado al ciclo completo del encargo.

### C02 — Recuperar un candidato aceptado sin confiar en una ruta guardada

Petición: «Tras reiniciar, quiero revisar un resultado conservado y verificarlo de
nuevo sin volver a llamar al modelo ni aceptar archivos que hayan cambiado».

- Área: checkpoints, gestor de worktrees, evidencia externa, `verifyIntegrated`, checks.
- Aceptación: siempre empieza pausado; recuperación explícita basada en acreditación
  independiente de los campos HTTP/checkpoint; valida identidad Git, base, proyecto,
  huella y pruebas vigentes; worktree eliminado, sustituido, modificado o ruta ajena
  nunca se acepta; consumo y pausas conservados; no mata procesos no acreditados;
  no repite inferencias ni borra aportaciones para recuperar.
- Evidencia: reinicio con gestor nuevo, corrupción, sustitución con mismo commit,
  revisión intacta y cambio durante checks. Revisión de seguridad independiente.
- Paralelismo: no propuesto; las decisiones de acreditación comparten invariantes.

### C03 — Incorporar perfiles aprobables para proyectos Node y Python

Petición: «Quiero trabajar con mis aplicaciones Node y Python utilizando sus
comprobaciones locales aprobadas, sin escribir configuraciones internas».

- Área: perfil de proyecto, registro confiable de checks y API de incorporación.
- Aceptación: identifica manifiesto y runtime sin ejecutar scripts al explorar;
  propone comandos concretos para revisión y los activa solo tras aprobación;
  Node usa scripts permitidos del proyecto; Python usa el entorno elegido y
  pruebas ya instaladas, sin instalar ni descargar nada; ejecutable ausente queda
  pendiente, nunca superado; aislamiento/rutas/nonce iguales en ambos perfiles;
  cobertura y catálogo siguen siendo propiedad del registro local.
- Evidencia: dos aplicaciones de integración con dependencias bloqueadas y tests
  reales de HTTP/persistencia, runtime ausente, manifiesto cambiado tras aprobación
  y cambio de proyecto. No se sustituye una aplicación por dos funciones de juguete.
- Divisible: perfil Node y perfil Python, cada uno en archivos propios contra un
  contrato común congelado. Integración conjunta con el mismo registro, límites
  y protección; dos perfiles correctos por separado no acreditan el conjunto.

### C04 — Exportar evidencia completa en JSONL y CSV con privacidad

Petición: «Necesito comparar trabajos y compartir diagnósticos en herramientas
habituales, incluso cuando hubo interrupciones o varias reparaciones».

- Área: recibos, muestras de uso, proyección pública y entrega por encargo.
- Aceptación: dos formatos sobre el mismo contrato; múltiples agentes y reparaciones
  se atribuyen una vez por recibo; conserva totales desconocidos y observaciones
  parciales; caché incluida en entrada; exportación con límites de memoria y tamaño;
  CSV evita fórmulas activas y escapa comillas/saltos; JSONL maneja escritura/cancelación
  sin presentar un archivo incompleto como exportación final; canarios privados
  excluidos en ambos; no abre archivos o enlaces remitidos por el modelo.
- Evidencia: historial de aplicación con éxito, fallo, duplicados, consumo desconocido,
  caracteres especiales y volumen grande; consumidores independientes verifican ambos.
- Divisible: serializador/flujo JSONL y serializador/flujo CSV con interfaz y
  proyección de privacidad comunes congeladas. Integración verifica totales e
  identidad entre formatos, cancelación y límites. No son dos sumas independientes.

### C05 — Reconectar la oficina sin perder ni inventar actividad

Petición: «Si se desconecta o recargo, quiero recuperar quién está trabajando,
sus pruebas y sus decisiones pendientes sin personajes duplicados».

- Área: snapshot y eventos HTTP/WS existentes, puente de oficina y estado cliente.
- Aceptación: snapshot y eventos tienen revisión/correlación; se descartan respuestas
  antiguas; la fase de checks permanece activa aunque terminó el CLI; se distinguen
  dato actual, dato retrasado y dato desconocido; no duplica trabajadores del mismo
  flujo ni mezcla dos instancias de Programador; recuperación sigue en pausa; sin
  pérdida de contadores, ejecución duplicada o publicación de payloads sensibles.
- Evidencia: navegador con latencia y respuestas fuera de orden, recarga durante
  checks e integración, caída del servidor y dos escritores simulados reales en Git.
- Divisible: productor de datos del servidor y consumidor/reconciliador cliente con
  contrato compartido congelado, cada uno con sus tests. La aceptación final ejerce
  ambos a la vez. No se modifica layout, color, sprite o animación.

## Qué falta antes de que estos casos se puedan ejecutar

1. Revisar que representan el trabajo cotidiano deseado y aprobar los contratos.
2. Para cada caso, fijar un commit base concreto y su entorno; cuando necesita un
   contrato previo, preparar el mismo soporte mínimo para todas las estrategias,
   registrando su coste y sin incluir la solución. No mezclar estados de producto.
3. Construir aceptación externa que compruebe estos criterios y regresión relevante;
   acreditar que falla en la base y que detecta implementaciones deliberadamente
   incompletas. No hace falta escribir quince soluciones para probar el verificador.
4. Definir archivos autorizados y criterios protegidos; las pruebas externas no
   pueden editarse desde el workspace del escritor. Los requisitos son conocidos;
   los casos de borde reservados no incorporan requisitos secretos.
5. Preparar reproducción, límites y autorización por bloque según
   [EVALUACION.md](EVALUACION.md). No habilitar modelos reales durante esos preparativos.

Solo C03, C04 y C05 tienen una variante paralela propuesta. También deberán superar
la decisión local del Jefe: si hay archivos compartidos de escritura, dependencia
real o coste no defendible, se registra rechazo de paralelismo. No se fuerza a
dos escritores para rellenar una columna favorable.
