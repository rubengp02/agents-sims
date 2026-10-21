# Optimización de contexto y coordinación

21 de octubre de 2026. Se ha implementado y probado el soporte técnico sin cambiar
el diseño, los recursos gráficos, el editor ni las animaciones. Se conservó el
trabajo previo del repositorio. No se hicieron commits ni publicaciones.

## 1. Comparación de contexto

Se preparan paquetes con objetivo, archivos relevantes, decisiones, aceptación y
comprobaciones. La aplicación valida el paquete, identifica su contenido mediante
hash y conserva límites en los traspasos. Un resultado recortado se marca como
incompleto. No se adjuntan historiales completos al paquete específico ni se
eliminan instrucciones de seguridad del CLI.

El piloto real compara una tarea **nueva**, pequeña y de solo lectura: detectar
un defecto de `clamp`, escoger entre tres reparaciones y calcular seis resultados.
La variante de referencia incluye un historial **sintético** con hechos repetidos;
la otra incluye el paquete específico. No se usaron conversaciones privadas como
contenido del experimento. No se ejecutó una reparación de archivos en este piloto.

Se mantuvieron tarea, modelo solicitado GPT-6.1 Sol, razonamiento bajo, papel
Programador, permisos, herramientas disponibles, archivos iniciales y aceptación.
El catálogo y la versión CLI coincidieron. El CLI no comunicó modelo confirmado;
no se sustituye ese dato ausente por el modelo solicitado.

| Variante            | Entrada | Entrada en caché | Entrada sin caché | Salida |  Total | Tiempo completo |
| ------------------- | ------: | ---------------: | ----------------: | -----: | -----: | --------------: |
| Historial sintético |  13.755 |            5.120 |             8.635 |     38 | 13.793 |         8,468 s |
| Contexto específico |  12.985 |            9.216 |             3.769 |     38 | 13.023 |         8,472 s |

Ambas superaron **7/7 comprobaciones**, sin defectos, reparaciones ni herramientas:
JSON válido, defecto correcto, reparación correcta, seis resultados correctos,
declaración de finalización, archivos intactos y ausencia de herramientas.
El tiempo incluye la comprobación previa adicional y la ejecución; las duraciones
del ejecutor por separado fueron 7,221 y 7,322 segundos.

Se observaron **770 tokens comunicados menos (5,58 %)** en esta pareja. La diferencia
temporal fue **+4 ms**: no demuestra mayor rapidez. La selección conservadora no
declara una variante ganadora, porque no mejoró ambos recursos y solo hay una
observación por variante. Los contextos preparados tenían 4.809 y 1.914 caracteres;
esas longitudes no se han convertido en tokens estimados.

No se puede atribuir toda la diferencia de caché al paquete: el orden fue referencia
→ específico, sin alternarlo, y no se controló caché fría. El primer caso ya tenía
caché. No se compara este piloto con los 126.572 tokens del ensayo histórico de
cuatro papeles: no son la misma tarea ni el mismo experimento.

Datos: [piloto-real.json](piloto-real.json),
[auditoría independiente de controles](piloto-auditoria.json).

## 2. Especialistas necesarios y clasificación

Se implementó clasificación local por alcance, riesgo, incertidumbre, módulos y
pruebas. Sin datos fiables se conserva la revisión. Los cambios sensibles mantienen
Arquitecto y Tester. Documentar seguridad se distingue de modificar autenticación;
«cambio autorizado» se distingue del dominio de autorización.

El circuito local nuevo puede preparar tareas sin llamada al Jefe. Un cambio
acotado solo retira al Tester cuando hay un módulo conocido, riesgo e incertidumbre
bajos, pruebas disponibles y un comando local marcado como aceptación. Un lint
exitoso no sustituye esas pruebas. Las explicaciones directas son de solo lectura.
Los cambios visuales no se activan por defecto.

Se comparó la selección con el circuito completo sobre **18 casos representativos**.
La política nueva cumple dificultad y papeles esperados en todos; la regla anterior
se evalúa aparte solo en dificultad, porque no tenía selector local de especialistas.
Los números exactos por caso están en
[optimizacion-local.json](optimizacion-local.json) y los contratos en
[casos-clasificacion.json](casos-clasificacion.json). Son casos dirigidos, no una
estimación estadística de precisión en todos los proyectos.

La creación de tareas y sus dependencias, el fallo de aceptación, la espera de
dependientes, la pausa y la cancelación se comprobaron con ejecutores simulados y
procesos locales reales. **No se ha medido ahorro real de tokens al reducir roles**;
restar llamadas históricas no sería una comparación válida. El nuevo circuito es
una entrada del servidor (`/api/team/scope`), sin alterar el diseño del panel ni
sustituir automáticamente los planes existentes.

## 3. Comprobaciones mecánicas

`npm run verify:local` arranca directamente tipos, lint, pruebas, estudio y paquete,
desde un registro local de comandos. No consulta un modelo para que ejecute cada
comprobación. Un prompt o petición HTTP no puede definir comandos nuevos. El
registro está vinculado al proyecto y usa procesos sin shell, límites y cancelación.

Los checks de una tarea terminan antes de liberar sus dependientes. Un resultado
negativo bloquea el trabajo posterior. Los logs completos permanecen ignorados por
Git; el informe público registra identificadores, códigos, duraciones y resultados.
Las comprobaciones están en [validacion-local.json](validacion-local.json).

La revisión final superó **702 pruebas**: 59 de interfaz, 628 de servidor, 7 de
contrato del paquete, 7 del estudio y su política, y una de navegador. Tipos,
lint y empaquetado terminaron con código cero. La prueba de navegador pasó al
tercer intento (3,6 segundos de prueba; 5,2 con el runner), con HTTP, WebSocket,
React y Canvas reales y ejecutor simulado: valida dependencias, dos lectores,
cinco personajes, ausencia de errores JS y panel móvil. Sus cinco ejecuciones
simuladas no gastan cuota ni se suman a las dos ejecuciones reales. El resultado
consolidado está en [verificacion-final.json](verificacion-final.json).

La advertencia previa de hooks en `App.tsx` se conserva. No se ha tocado ese archivo
para silenciarla. Las pruebas habituales del adaptador Claude son simuladas; no
habilitan su inferencia.

## 4. Caché, sesiones y límites

Los recibos nuevos conservan entrada, salida y caché comunicadas, versión del CLI,
fecha de verificación, hash del contexto y modo de sesión. Los contadores ausentes
o inválidos quedan desconocidos; nunca se transforman en ahorro inventado.

El piloto usó **dos sesiones nuevas y distintas**, sin `resume`. Se observó caché
entre ellas; esto no significa continuar una conversación. Reutilizar un personaje
en la oficina tampoco reutiliza una sesión CLI. No se ha implementado una sesión
universal ni continuación automática para reparaciones.

Antes de comenzar se fijaron 2 intentos, 4 minutos en total, 90 segundos por ejecución,
60.000 tokens comunicados y reserva de 30.000 por intento. Se usaron **26.816 tokens**
y **16,946 segundos**. El registro persistente cerró el presupuesto al completar los
dos intentos. No se aumentó ni se reinició. El corte por tokens ocurre al comunicarse
el consumo del turno; no es un tope exacto durante la generación.

Cada ejecución pasó el diagnóstico y los controles internos oficiales de suscripción,
catálogo, cuota y ausencia de créditos adicionales, además de la verificación final.
No se usaron APIs de pago, créditos adicionales ni cambios de credenciales. Claude
permanece desactivado y Antigravity sin conectar. Los tokens, incluidos los de caché,
no se convierten a dinero ni a porcentaje de cuota de ChatGPT.

## Intentos fallidos y alcance de la evidencia

Se conservan los fallos en [incidencias-optimizacion.json](incidencias-optimizacion.json):
una importación de tipo omitida, un traspaso mayor que el límite anterior, una
expectativa de navegador de la clasificación antigua y el falso positivo de
«autorizado». Los defectos de implementación se corrigieron; la expectativa se
actualizó para la nueva política y se mantuvieron las otras aserciones.
El piloto real no tuvo intentos fallidos ni reintentos.

Las protecciones adicionales de aceptación/cancelación y la corrección de ese falso
positivo son posteriores al piloto. Se verificaron localmente; no se atribuyen
ejecuciones reales a esa revisión posterior. La auditoría guarda ambas huellas de
código. El consumo del chat de desarrollo no está incluido en los contadores del
CLI del piloto.

Queda pendiente demostrar estabilidad con orden alternado y más tipos de tarea,
medir reducción de especialistas con IA real y evaluar continuación de sesiones.
Esas comparaciones no se han ejecutado al agotarse el límite de dos intentos.
No se presenta como aceptada una mejora general de calidad, rapidez o cuota que
estas mediciones no demuestran.

Uso técnico: [OPTIMIZACION_CONTEXTO.md](../../docs/OPTIMIZACION_CONTEXTO.md).
