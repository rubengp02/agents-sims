# Reintento real: aceptación superada

Fecha: 21 de octubre de 2026.

El mismo contrato pequeño del primer intento se ha ejecutado con Codex real,
mediante el servicio de la oficina: Jefe → Arquitecto → Programador → Tester.
No se han usado adaptadores de inferencia simulados en este recorrido.

## Corrección de permisos

La sesión nativa del Programador anterior registraba `read-only`, a pesar del
argumento antiguo que solicitaba escritura. La integración utilizaba ese argumento
y omitía la selección explícita del sandbox de Windows al aislar la configuración.

Se usan ahora los perfiles oficiales `default_permissions=":read-only"` y
`default_permissions=":workspace"`, sin mezclarlos con `--sandbox`/`sandbox_mode`.
En Windows se selecciona explícitamente `windows.sandbox="elevated"`, ya preparado
en este equipo. No se reinstaló el sandbox ni se modificó la configuración global.
El entorno esencial de las herramientas conserva PATH; el entorno del proceso CLI
sigue limitado por la lista permitida y sin variables de proveedor o claves API.
El catálogo de skills se acota a 1.000 tokens; no se afirma una reducción medida
del contexto total por ese cambio.

Los [perfiles de permisos oficiales](https://learn.chatgpt.com/docs/config-file/config-reference)
documentan esas selecciones y su incompatibilidad con la configuración antigua.
La [documentación de Windows](https://learn.chatgpt.com/docs/windows/windows-sandbox)
describe la implementación elevada. Se mantienen las reglas administradas,
la política de aprobación `never`, las restricciones de red y los permisos por tarea.
No se utiliza acceso completo ni una alternativa sin sandbox.

Antes de inferencia se ejecutó una comprobación local con el sandbox oficial:
lectura permitida en ambos perfiles, escritura denegada en lectura, escritura
permitida dentro del proyecto en workspace y escritura denegada fuera del proyecto.
Un archivo testigo externo conservó sus bytes. Esa comprobación no llamó a modelos.
Registro: [preflight](reintento-preflight.json).

## Resultado del recorrido

| Papel       | Modelo solicitado | Razonamiento | Entrada | Salida | Resultado                                  |
| ----------- | ----------------- | ------------ | ------: | -----: | ------------------------------------------ |
| Jefe        | GPT-6.1 Sol       | bajo         |  15.227 |    312 | Plan válido de tres tareas                 |
| Arquitecto  | GPT-6 Luna        | bajo         |  28.792 |    232 | Contrato leído y resumido                  |
| Programador | GPT-6.1 Sol       | bajo         |  48.448 |  1.277 | Dos archivos creados; 11 pruebas aprobadas |
| Tester      | GPT-6.1 Sol       | bajo         |  32.094 |    190 | Revisión y nueva ejecución: 11 aprobadas   |

Cuatro llamadas, sin repetir ninguna tarea completada; total comunicado: **126.572
tokens**. Los datos exactos están en [verification](reintento-verification.json).
Todas las ejecuciones superaron los controles oficiales de sesión ChatGPT personal,
cuotas, ausencia de créditos adicionales y catálogo, repetidos por el ejecutor.
No hubo claves API, cambio de cuenta, compras de créditos ni alternativa de pago.
El modelo confirmado continúa nulo: el CLI no lo comunicó.

El presupuesto temporal inicial de 120.000 pausó correctamente la cola antes del
Tester, al considerar el consumo de entrada observado. Tras revisar que solo
faltaba QA y comprobar de nuevo la suscripción, se amplió manualmente a 160.000,
conservando el máximo de cuatro llamadas. Se reanudó únicamente esa tarea.
Después se restauraron exactamente los ajustes originales: automático, Claude
apagado, ocho llamadas, dos plazas, quince minutos y 30.000 tokens orientativos.
No se modificó el límite del proveedor ni se reinició su cuota.

Tras guardar las evidencias se reinició únicamente la oficina para devolverla con
cola y contadores locales vacíos y sus ajustes originales. No hay inferencia activa;
los resultados no se reinyectan como una demostración. Los límites de suscripción
siguen siendo los del proveedor y se comprobarán de nuevo ante el próximo encargo.

Los 76.776 tokens del intento anterior son adicionales a este reintento: el total
comunicado entre ambos es 203.348. Estos contadores incluyen contexto y herramientas;
no son una medida de tokens nuevos sin caché, euros ni cuota porcentual del plan.
El consumo de un encargo multiagente pequeño sigue siendo una limitación importante.

## Evidencias independientes

- Se inspeccionaron los dos archivos y se ejecutaron localmente sus once pruebas:
  once aprobadas, cero fallos.
- Se comprobaron otras **139 entradas y propiedades** del contrato: combinaciones
  de estados, ceros, resultado nuevo, entradas inválidas y ausencia de mutaciones.
- Los 424 archivos de la línea base conservaron sus hashes durante el ensayo.
  El proyecto solo añadió los dos entregables previstos; el testigo externo no cambió.
- Los tiempos de los registros verifican el orden de dependencias sin solapamiento.
- Las sesiones nativas registran lectura para Jefe, Arquitecto y Tester, y
  `workspace-write` para el Programador. Los historiales oficiales contienen una
  ejecución real de `node --test task-summary.test.mjs` con salida 0 y once pruebas
  aprobadas tanto para Programador como Tester. Se extrajeron únicamente estos
  metadatos; no se leyeron archivos de autenticación. [Registro](reintento-native-evidence.json).
- Las cuatro tareas quedaron completadas y asociadas a personajes del almacén de
  la oficina. No se realizó una nueva inspección visual del navegador/canvas.

Los [entregables](entregables/task-summary.mjs), sus
[pruebas](entregables/task-summary.test.mjs) y sus [hashes](entregables/sha256.json)
se conservan como copia exacta de los archivos creados por el Programador real.
No forman parte de una funcionalidad nueva de la aplicación.

## Regresión y límites

579 pruebas de servidor, 52 de componentes y siete de empaquetado superadas:
**638 pruebas automáticas de la aplicación**, aparte de las once pruebas del
entregable y sus 139 comprobaciones independientes. Hay tres casos nuevos para
la configuración de Windows y la separación de plataformas. Tipos, formato,
lint y compilación de producción superados. Solo persiste el aviso previo del
hook React en App.tsx. No se han ejecutado las pruebas de navegador en esta fase.

Este resultado valida un encargo pequeño y secuencial. No demuestra paralelismo
real, integración real con Claude, recuperación de cola tras reinicios ni un
verificador universal de calidad. La declaración final del agente sigue sin
sustituir la aceptación independiente; en este ensayo sí se hizo esa comprobación.
No se cambió el diseño ni se conectó Antigravity.

## Autoevaluación

Aplicada la guía `agent-self-evaluation`: exactitud 4/5 (modelo confirmado ausente);
completitud 4/5 (recorrido solicitado validado, alcance pequeño); claridad 4/5
(evidencias técnicas separadas de las instrucciones de uso); utilidad 4/5 (permisos
corregidos, presupuesto habitual insuficiente para este recorrido); concisión 3/5
(cuatro llamadas y 126.572 tokens comunicados para una función pequeña; hace falta
medir y reducir contexto y personajes antes de usarlo de forma habitual).
Media: 3,8/5. La optimización de consumo requiere trabajo adicional y no se da por
conseguida mediante un ajuste de catálogo. Prioridades: medir ese contexto, usar
tareas directas cuando basten y verificar nuevos tipos de proyectos de forma acotada.
La valoración solo es razonable junto con estos límites y el consumo comunicado.
