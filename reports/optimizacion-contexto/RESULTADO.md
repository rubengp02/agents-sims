# Auditoría de contexto y comparación preparada

21 de octubre de 2026. Esta etapa usa análisis de código, recibos agregados y
pruebas locales. **Cero inferencias nuevas y cero presupuesto real autorizado.**
No se han cambiado modelos, interfaz, personajes, escenarios, animaciones,
instrucciones globales ni presupuestos anteriores. Agent Orchestrator sigue siendo
opcional; Claude sigue desactivado y Antigravity sin conectar.

## Qué explica probablemente el exceso

En el último piloto hubo 13.090 tokens más de entrada y 254 menos de salida: el
exceso neto fue de 12.836. El problema está en la entrada acumulada, no en una
respuesta final más larga. La entrada sin caché aumentó de 12.880 a 19.698; la
caché se registra por separado, sin sumarla de nuevo ni convertirla en cuota.

Se reconstruyó el prompt del Programador desde el código y el caso original:
**2.762 caracteres**. Su huella coincide con el recibo privado del piloto. El
prompt directo histórico tenía 1.566 caracteres antes del prefijo que añade su
ejecutor. Estas longitudes son caracteres, no tokens, y no incluyen las
instrucciones internas ni los resultados de herramientas del proveedor.

La causa probable combina contexto redundante y su procesamiento durante el
ciclo de herramientas. No se ha demostrado cuánto aporta cada factor. Un turno
autorizado puede incluir varias peticiones internas al modelo: la entrada del
recibo no equivale al tamaño de nuestro primer prompt. Una lectura agrupada
tampoco equivale necesariamente a una herramienta por archivo.

Hay además variables que impiden atribuir el resultado solo al contexto:

- El directo usó Sol/medium y el piloto adaptativo Sol/low.
- El directo empleó `codex exec`; la oficina usó el puente AO a `app-server`.
- El CLI directo fija `--ignore-user-config` y un límite de contexto de skills de
  1.000 tokens. El lanzador AO inspeccionado no fija esas dos opciones. Sí bloquea
  proveedores externos y herramientas adicionales mediante otras opciones.
- El CLI directo antepone restricciones al prompt; AO recibe el prompt de la
  oficina sin ese prefijo. Se mantienen las reglas de suscripción en ambos.
- Los recibos muestran la misma versión de CLI, pero condiciones de caché distintas.
  No se ha inspeccionado configuración privada para especular sobre su contenido.

El contador histórico directo registra cuatro herramientas terminadas; AO registra
cinco inicios de actividad. **No son unidades comparables.** No sabemos si hubo una
lectura más ni cuántas peticiones internas causaron los tokens adicionales.

## Duplicaciones encontradas

`chief-pilot.mjs` entrega el objetivo y el contrato dividido en criterios al
coordinador. Este crea una tarea cuyo encargo vuelve a ser el objetivo.
`taskContext.ts` serializa el contexto y añade otra vez el encargo. En paralelo,
`fixtureFiles` ya ha escrito el objetivo y el contrato íntegro en `TASK.md`.

| Información        | Dónde se repite                                     | Tratamiento preparado                                          |
| ------------------ | --------------------------------------------------- | -------------------------------------------------------------- |
| Objetivo           | Contexto, encargo y `TASK.md`                       | Omitir el encargo solo si coincide exactamente con el objetivo |
| Contrato           | Aceptación del prompt y `TASK.md`                   | Variante experimental con el contrato en el archivo verificado |
| Pruebas públicas   | Guía del proyecto, `TASK.md` y `package.json`       | Conservar; no se elimina ninguna comprobación                  |
| Reglas y resultado | Guía, perfil del papel e instrucciones del ejecutor | Conservar permisos, responsabilidades y declaración honesta    |
| Historial vacío    | Rótulo y `[]` en un agente sin dependencias         | Omitir solo si no hay dependencias                             |

La copia de criterios en el registro mecánico es necesaria para acreditar cobertura.
**Se conserva completa en todas las variantes**, aunque no se repita en el prompt.
No se suprimen instrucciones por parecido aproximado ni se recortan criterios para
que el contexto quepa. Los traspasos truncados siguen marcados como incompletos.

## Variantes listas para comparar

| Variante            | Caracteres del prompt | Diferencia frente al actual | Estado                                                                     |
| ------------------- | --------------------: | --------------------------: | -------------------------------------------------------------------------- |
| Actual              |                 2.762 |                           0 | Control reconstruido                                                       |
| Compacta            |                 2.528 |                        −234 | Opción explícita `minimal-v1`; conserva toda la aceptación inline          |
| Contrato en archivo |                 1.420 |                      −1.342 | Prototipo exclusivo de la comparación, con archivos protegidos verificados |

Son reducciones de **caracteres visibles**, no porcentajes de ahorro de tokens.
En la tercera variante el modelo debe leer `AGENTS.md` y `TASK.md` completos antes
de editar. Esa lectura cuesta contexto y puede necesitar otra herramienta; podría
anular el ahorro o aumentar el tiempo. Precisamente por eso no se ha activado como
predeterminada. El renderizador normal tampoco cambia su prompt: el compacto
requiere una opción explícita y aún no está conectado a la selección de producción.

El prototipo valida los bytes de guía, contrato, pruebas y manifiesto de la tarea
conocida antes de usar referencias. Si cambia uno, rechaza la referencia. No se
presenta como solución genérica para cualquier repositorio. El contrato completo,
incluidas las precisiones sobre tipos, `NaN`, infinitos y redondeo, permanece intacto.

## Qué podemos registrar de forma segura

Se incorporó `RunRecord.metrics` en los dos ejecutores. Es un añadido de metadatos;
no altera herramientas, permisos, opciones de modelo ni el texto enviado. No añade
escrituras a disco por cada actividad: los contadores se guardan con los recibos
que ya emitía el ejecutor.

| Dato                                                              | CLI directo                            | Puente AO actual                           |
| ----------------------------------------------------------------- | -------------------------------------- | ------------------------------------------ |
| Caracteres y bytes UTF-8 del prompt y del envío local con prefijo | Sí                                     | Sí                                         |
| Entrada, salida, caché y duración                                 | Ya disponibles                         | Ya disponibles                             |
| Eventos de actividad                                              | Sí, eventos de inicio de item          | Sí, inicios de actividad del puente        |
| Herramientas terminadas por categoría                             | Sí, eventos del protocolo              | Desconocido; no se sustituye por actividad |
| Bytes observados de salida de comandos                            | Si el CLI comunica `aggregated_output` | Desconocido                                |
| Cierres de turno y eventos de consumo                             | Sí                                     | Sí                                         |
| Número exacto de archivos leídos                                  | Desconocido                            | Desconocido                                |
| Peticiones internas al modelo                                     | Desconocido                            | Desconocido                                |

No se almacenan comandos, argumentos, rutas, resultados, prompts, errores del
proveedor ni identificadores de herramientas en estas métricas. Los identificadores
se usan solo en un conjunto temporal acotado para evitar contar dos veces un item
completado. Si se alcanza ese límite queda marcado; un contador incompleto no
prueba menor trabajo. Cuando falta salida de comandos se cuenta esa ausencia;
los bytes observados son un dato parcial, no tokens ni toda la salida posible.

Los contadores AO y CLI conservan su procedencia y semántica. Un cierre del turno
de usuario no revela cuántas llamadas internas al modelo hubo. Las métricas nuevas
no pueden rellenar retroactivamente lo que los informes históricos no registraron.
El informe de auditoría extrae solo campos permitidos de recibos concretos, sin
leer transcripciones ni credenciales, y puede dejar esos campos desconocidos si
los recibos privados no están disponibles en otra instalación.

## Cómo se hará la comparación justa

El plan mecánico de la comparación está en `validacion-1-comparacion.json`, dentro
de `comparison`. Contiene seis brazos: directo y oficina para cada una de las tres
variantes. Es un diseño local validado, **sin ejecutor de experimentos reales**.

El contraste principal usa el **mismo Codex CLI, Sol/low y sesión nueva** en ambos
casos. Dentro de cada variante, directo y oficina deben enviar exactamente el
mismo prompt, incluido el prefijo del ejecutor. Se verificaron las huellas del
envío, de los archivos iniciales y de los criterios. El Jefe utiliza reglas locales
y elige un solo Programador. Esto permite separar el efecto del contexto del coste
de coordinación. La oficina ya admite ese motor; AO no se elimina ni se modifica.

Antes de cualquier ensayo real habrá que fijar los brazos concretos, el número
total de ejecuciones, tokens y tiempo autorizados. El plan actual permite **cero**.
El controlador experimental de inferencia todavía queda pendiente; no se han creado
autorizaciones ni reabierto registros anteriores.

Cada brazo deberá tener los mismos permisos efectivos, comprobación oficial de
suscripción, contrato, fuentes, pruebas públicas, 36 comprobaciones independientes
y control de archivos modificados. Los espacios y sesiones serán nuevos y
separados, sin ejecuciones simultáneas. Se registrarán el orden y la caché observada;
no se promete fabricar una caché equivalente ni se manipularán datos de la cuenta.

Se alternará el orden en parejas repetidas, sin elegir solo el mejor intento.
Los límites, fallos, defectos y reparaciones se incluyen en el coste y no se borran.
Un exceso o consumo desconocido impide presentar la ejecución como éxito eficiente.
No basta con superar las pruebas públicas ni con declarar `completed`.

Para promover una variante exigiremos todas las comprobaciones actuales, menos
tokens totales y una mediana de tiempo que no supere la del control emparejado de
la oficina. Se publicarán los valores individuales, medianas, dispersión y tamaño de
muestra. El objetivo de velocidad sigue siendo conservar la mejora anterior; el
valor histórico de 48,596 s sirve como referencia, no como sustituto de repetir un
control bajo las condiciones nuevas. Una única pareja seguirá siendo exploratoria.

## Experimentos posteriores separados

1. **AO frente a CLI:** mismo contexto, modelo y razonamiento; alinear y comprobar
   configuración y permisos antes de comparar. No mezclar ese cambio con el de contexto.
2. **Luna/low frente a Sol/low:** consultar disponibilidad real mediante metadatos
   oficiales sin inferencia; mantener lo demás fijo. No se ha supuesto disponibilidad
   actual ni ahorro. Contar también fallos y reparaciones; ninguna promoción automática.
3. **Sesión nueva frente a continuación:** tarea en dos pasos, mismo objetivo y
   misma revisión al iniciar el segundo. Comparar `new/new` con `new/resume`, sumando
   el coste completo de ambos pasos y usando diferencias de contadores acumulados.
   Medir contexto obsoleto, defectos, caché y tiempo. Reutilizar personaje no reanuda
   una sesión; el revisor conserva una sesión independiente del autor.

## Verificación local y reproducción

La primera preparación está en [preparacion-1.json](preparacion-1.json). La batería
completa y su nueva preparación están en [validacion-1.json](validacion-1.json) y
[validacion-1-comparacion.json](validacion-1-comparacion.json). Los nombres de salida
son exclusivos: un archivo existente bloquea la repetición con ese nombre, de modo
que tampoco se pierdan intentos fallidos. Para otro intento se utiliza otro nombre.

```text
node --test scripts/context-experiment.test.mjs
node scripts/context-audit.mjs preparacion-2
node scripts/verify-context.mjs validacion-2
```

Las simulaciones inyectan implementaciones conocidas mediante un adaptador en
memoria: seis pasan 36/36 y una implementación defectuosa se rechaza incluso cuando
el adaptador declara `completed`. Esto prueba el circuito y sus controles, no la
capacidad de un modelo ni una reducción de cuota. Los diminutos contadores de
consumo internos del adaptador son ficticios y no se publican como mediciones.

Las pruebas nuevas cubren conservación de reglas, referencias manipuladas,
huellas equivalentes, contador de caché separado, privacidad de agregados,
deduplicación y tamaño UTF-8. La validación incluye tipos, lint, toda la suite,
políticas, puente nativo con proveedor falso y empaquetado. Comprueba además por
hash que los informes históricos no cambiaron. Las comprobaciones funcionales
exigidas se conservan completas; la mejora de consumo real sigue pendiente.

Resultado de la batería completa: **735 pruebas** (59 de interfaz, 669 de servidor
y 7 de empaquetado), **39 comprobaciones de políticas/preparación**, siete
simulaciones del circuito, tipos, lint, puente nativo y compilación superados.
Se conservaron por hash los **86 informes históricos** y el código no cambió
durante la verificación. Permanece el aviso previo de React sobre la dependencia
`editor`; no hay errores de lint. Los intentos locales de esta etapa pasaron;
el caso defectuoso fue rechazado como se esperaba, sin reparar ni ocultar su salida.
