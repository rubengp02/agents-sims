# Entrega por etapas: oficina adaptativa y paralelismo seguro

Esta entrega implementa el plan aprobado con proveedores simulados. No ejecuta
modelos reales ni amplía sus presupuestos. Los informes anteriores permanecen
intactos. La operación se describe en [OFICINA_PARALELA.md](../../docs/OFICINA_PARALELA.md).

| Etapa          | Implementación y evidencia local                                                                                                                                                                                                                                                                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Supervisión | Diferencia lectura, validación y escritura; conserva primera incidencia segura, fase, antigüedad y proceso. Ciclo de cuatro ejecuciones locales, pérdidas de controlador/monitores/descendiente, identidad de PID, consumo desconocido y ausencia de reintentos. Conserva los plazos anteriores. La causa histórica permanece indeterminada.                                                  |
| 2. Identidades | Papel profesional separado de trabajador, tarea, flujo, sesión y workspace. Dos Programadores independientes con los personajes existentes, continuación explícita y checkpoints v1/v2 sin reactivación automática.                                                                                                                                                                           |
| 3. Escritores  | AO fijado prepara dos copias limpias del mismo commit; la capacidad interna acredita sus rutas. Propiedad de archivos, contratos compartidos, exclusión por copia y dos plazas globales. Bloqueos ajenos o abandonados impiden nuevos arranques. Codex CLI sigue predeterminado.                                                                                                              |
| 4. Integración | Tercera copia, índices privados, parches reproducibles con altas/bajas y huellas. Conflictos conservados, comprobación conjunta obligatoria, rechazo de cambios posteriores y revisión independiente del diff integrado. No hace merge ni publicación.                                                                                                                                        |
| 5. Jefe        | Decisión local con alcance, riesgo, incertidumbre, cobertura, dependencias y propiedad. Reserva trabajadores, revisión y operaciones antes de empezar. Sin ventaja defendible mantiene secuencia; sin estimaciones suficientes pide revisión humana. Reutiliza cinco medidas completas comparables con margen conservador, conservando fallos. Mantiene modelos y elección manual existentes. |
| 6. Evaluación  | Doce tareas distintas, dos por familia, por seis estrategias: 72 combinaciones. Calidad, política y finalización separadas. Baseline individual estricto sin papeles obligatorios de oficina. Protocolos futuros fijo/adaptativo preparados, sin límites autorizados.                                                                                                                         |

## Qué se ha comprobado

La primera matriz completa está en
[MATRIZ-d4c32ef4.json](evaluacion-local/MATRIZ-d4c32ef4.json).
Sus 72 resultados superan aceptación y finalizan el circuito. Dos alcanzan dos
trabajadores simultáneos. Los baselines acotados sin revisión en tareas delicadas
conservan su resultado correcto y se distinguen como incumplimiento de la política
de oficina; el baseline individual se evalúa con sus propias reglas.

Las tareas son **fixtures estructurales pequeños**, incluidos los patrones de
trabajo grande separable y acoplado. No prueban que un modelo resuelva tareas
grandes reales ni permiten calcular ahorro de tokens. Se ejecutan Git, procesos,
comprobaciones y el coordinador real; las respuestas de modelos se simulan.
Entrada, salida y caché reales figuran como desconocidas/no aplicables, nunca
como ahorro demostrado. Se registran también fases, sesiones, participación,
concurrencia, operaciones y tiempos locales.

AO nativo ha superado el caso de dos escritores, misma base y tercera copia,
además de sus cinco comprobaciones previas de protocolo, continuación explícita,
caché acumulada, aceptación y consumo desconocido. El proveedor de esa prueba es
un ejecutable compilado local sin modelo, red ni credenciales. No demuestra
paralelismo ni consumo de la suscripción con IA real.

La regresión general inicial superó 683 pruebas de servidor, 59 de interfaz y
7 del contrato de empaquetado. Las comprobaciones de políticas superaron 39 casos.
El empaquetado incluye tipos y lint; conserva un aviso previo de dependencia de
React en `App.tsx`, sin modificar el diseño.

Los archivos `VALIDACION-*.json` contienen los resultados de las validaciones
reproducibles posteriores, sus tiempos y la huella del código comprobado.
Cada matriz y protocolo utiliza un nombre nuevo; no sustituye otro intento.

## Intentos fallidos y correcciones

| Intento                       | Resultado y tratamiento                                                                                                                                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primer comando de Vitest      | Directorio/configuración incorrectos: no encontró pruebas. Se corrigió el directorio y se ejecutaron las suites.                                                                                                                                                                                        |
| Tipos del proveedor de prueba | `plan` se infería como cadena general. Se corrigió el literal de la fixture; tipos superados.                                                                                                                                                                                                           |
| Primera regresión focalizada  | 80 pruebas pasaron y una falló: una tarea clonada con otro papel heredaba `workerId` y reutilizaba el personaje incorrecto. Se corrigió la clave a papel + trabajador y se añadió el caso de dos instancias. La ejecución posterior superó 86/86.                                                       |
| Primer lint de los cambios    | Cuatro errores de orden de imports. El argumento `--fix` de ese comando no alcanzó al primer ESLint; se ejecutó el autofix dirigido y luego lint completo.                                                                                                                                              |
| Primer ensayo nativo nuevo    | `workspace_base_mismatch` por LF/CRLF de Git en Windows entre dos árboles limpios. Se cambió la acreditación inicial a commit común + estado limpio + identidad del repositorio; las huellas concretas se mantienen en sellado e integración. El segundo ensayo superó las seis comprobaciones nativas. |

La primera validación final repetible superó tipos, lint, empaquetado, aplicación,
políticas y 12 pruebas de supervisión. El caso nativo nuevo falló con `EEXIST`:
la fixture reutilizaba `native-parallel` y se negó a sobrescribir `integration.json`
de un ensayo anterior. Se corrigió la fixture para crear un identificador nuevo
por intento. Se conserva [VALIDACION-df019b1e.json](VALIDACION-df019b1e.json).
No se borró la evidencia anterior.

La segunda validación completa, [VALIDACION-e2705f4d.json](VALIDACION-e2705f4d.json),
superó los siete grupos, incluida la nueva matriz de 72 combinaciones y ocho
pruebas de navegador. Su huella permaneció estable durante toda la validación.
Después se añadió el control de identidad concreta del worktree: sustituir una
copia por otra en la misma ruta y commit ya no conserva sus permisos anteriores.
Se añadió asimismo el cierre de un escritor durante la transacción del diario,
comprobando que conserva contadores y pausa anteriores.

El primer intento de esa prueba de identidad falló con `EPERM` al intentar
escribir directamente un archivo `.git` protegido (13 pruebas pasaron, una falló).
La fixture se corrigió para utilizar operaciones normales de Git sobre su
repositorio temporal: mueve el worktree, conserva su copia y crea otro en la
misma ruta. No cambia permisos ni modifica metadatos protegidos directamente.
La prueba focalizada posterior pasó y conserva el rechazo de la identidad antigua.

No se han descartado resultados adversos. El caso de ambos módulos aceptados
por separado y conjunto fallido permanece como prueba de regresión, igual que
conflictos, alcance indebido, presupuesto insuficiente, bloqueo abandonado y
consumo desconocido.

## Validación final de la entrega

[VALIDACION-1b96216f.json](VALIDACION-1b96216f.json) supera los siete grupos y
confirma que el código no cambió durante su ejecución. Incluye tipos, lint y
empaquetado; 685 pruebas de servidor, 59 de interfaz y 7 del contrato de paquete;
39 pruebas de políticas; 13 de supervisión; seis comprobaciones de AO nativo;
la [matriz final](evaluacion-local/MATRIZ-d1376b5f.json) y ocho pruebas de navegador.

La matriz conserva 72 resultados correctos y 72 circuitos finalizados. Cumplen
la política correspondiente 68: cuatro variantes acotadas sin revisión en los
dos casos delicados quedan excluidas por política, aunque su código de referencia
supere la aceptación. No se consideran mejoras admisibles. Los dos casos
separables de la oficina adaptativa alcanzan concurrencia dos y aceptación
conjunta en una tercera copia. Todos los contadores de consumo real permanecen
sin medición: no se ha ejecutado inferencia en estos ensayos.

## Lo que queda pendiente de medición real

Los dos protocolos futuros requieren elegir tareas de tamaño real, repeticiones,
modelo/razonamiento cuando sean fijos, condiciones de caché/sesión, límites totales
y autorización nueva. No hay ejecutor real en la matriz local. La continuación
y Luna/low siguen siendo variables independientes: compartir personaje no
reutiliza una conversación y figurar en el catálogo no demuestra ahorro de cuota.

No se atribuye esta entrega a una mejora real de velocidad o tokens. Se ha
preparado y comprobado el circuito seguro necesario para medirla después.

Los cambios de supervisión quedan en el commit local `384db63`; el circuito de
trabajadores, integración y Jefe, en `72cb299`. La evaluación, los protocolos y
este informe se entregan en un tercer commit local. Los tres pasan el control
de secretos y los hooks de revisión configurados; no se hace push automático.
