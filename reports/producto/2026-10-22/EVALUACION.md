# Evaluación de productividad: propuesta sin autorización

Fecha: 22 de octubre de 2026. Estado: protocolo para revisar. **Cero inferencias
autorizadas por este documento.** Los límites siguientes son propuestas, no
configuración aplicada ni una ampliación de presupuestos anteriores.

## Pregunta que queremos responder

¿Cuándo el producto adaptativo entrega la misma calidad que un Codex individual
con menos tiempo, menos consumo o menos intervención? Una ventaja en una dimensión
no se presenta como mejora en las otras. La estrategia normal seguirá siendo
individual mientras no haya evidencia defendible para ampliar el equipo.

## Estrategias y separación de experimentos

- **D: Codex individual estricto.** Codex CLI oficial, sesión nueva, sin delegación
  nativa ni subagentes, mismo permiso y aceptación externa. Un único implementador;
  solo una reparación adicional como máximo si cabe y estaba autorizada.
- **A: Agents Sims adaptativo.** Codex CLI inicial, decisión local sin coste de
  inferencia cuando basta; planificador/revisor/especialista solo justificados,
  con todas sus llamadas y coordinación cargadas al mismo presupuesto del método.
  AO no se activa automáticamente. El número de personajes no es un criterio de calidad.
- **P: variante experimental de dos escritores**, únicamente C03/C04/C05 y AO
  seleccionado expresamente. Incluye preparación, trabajadores, integración,
  revisión y checks del conjunto. Acreditar concurrencia no acredita aceptación.

Protocolo principal: comparación de producto con el mismo modelo/razonamiento
solicitado para D y el implementador inicial de A, elegido antes de ver resultados.
No experimentar a la vez con Luna, continuación de sesiones y contexto distinto.
Una sesión continuada o un cambio de modelo será otro experimento aprobado.

La política adaptativa puede solicitar revisión profunda cuando haga falta y
eso cuenta como coste de A; no se exige al baseline repartir el trabajo en
papeles de oficina. Registrar modelo y razonamiento de cada llamada. Si el CLI
no confirma el modelo efectivo, dejarlo desconocido y hablar de configuración
solicitada equivalente, no de equivalencia interna del proveedor demostrada.

AO cambia también el motor/adaptador: una diferencia D/P no aísla el efecto del
número de escritores. Si merece la pena atribuir esa causa, preparar después
un control AO con un escritor. No añadir ese control a escondidas ni atribuir
todo el efecto a paralelismo a partir de la comparación inicial.

## Condiciones iguales y aceptación

Mismo commit del caso, encargo, instrucciones de proyecto, permiso, criterios,
pruebas públicas, verificador externo, CLI, entorno y dependencias bloqueadas.
Todos los métodos disponen del mismo perfil de proyecto y de la misma aceptación
local conocida, sin instrucciones de otros proyectos ni historial completo.
La oficina puede estructurar el contexto; se registra texto/longitudes de forma
privada y su huella. La diferencia forma parte del producto y no de requisitos distintos.

Preparar pruebas/dependencias antes del reloj de cada variante, igual para ambas.
Registrar el coste humano y de máquina de esa preparación por separado y su
amortización; nunca ocultar una preparación específica de A o P como si fuese
infraestructura común. La preparación de worktrees por encargo sí entra en el reloj.

Cada variante empieza en copia fresca y sesión nueva. No ve el parche ni la
respuesta de la otra. No se manipulan cachés ni credenciales para intentar forzar
un arranque frío. Se mide la caché comunicada y se registra orden/carga/cuota.
No reutilizar una antigua referencia si ha cambiado cualquier condición relevante.

Los criterios y checks obligatorios se congelan fuera del workspace editable.
El baseline pasa si satisface el producto y los permisos, aunque no use nuestra
estructura de papeles. Un CLI terminado, una declaración `OFFICE_RESULT` y cada
mitad correcta por separado no sustituyen la aceptación global vigente.

Una entrega aceptada requiere todas las comprobaciones obligatorias, contrato,
alcance, candidato identificado y ausencia de defectos bloqueantes conocidos.
Tras aceptar, un verificador independiente ejecuta casos de borde y regresión
reservados derivados de los mismos requisitos. Los defectos descubiertos ahí
son escapes; ningún verificador permite afirmar ausencia absoluta de defectos.
La revisión humana usa el mismo formulario, desconoce la etiqueta del método
cuando sea viable, y todo tiempo o ayuda de programación aportada cuenta.

## Quince casos, orden y repeticiones

Casos: [CASOS_15.md](CASOS_15.md), cinco por dificultad. D y A en todos:
30 celdas; P en tres divisibles: 3 adicionales; total 33 celdas por bloque completo.

Una celda es un método sobre un caso, no una llamada. Una sola vuelta de 33
celdas sigue siendo exploratoria: hay variedad pero escasa repetición por caso.
No se publica una mejora general a partir de una pareja favorable.

Secuencia propuesta de autorización:

1. Cerrar los verificadores locales y el recorrido de producto. No ejecutar la
   batería sobre el formulario técnico actual como si evaluara ya la experiencia nueva.
2. Autorizar, si el usuario quiere, **una pareja sencilla S02 D/A**. Revisar calidad,
   registro y límites antes de más consumo. No solicita ni obtiene autorización aquí.
3. Si esa pareja sirve, aprobar por separado una pareja media y una compleja.
4. Solo entonces considerar el resto de casos y la variante paralela. La decisión
   del Jefe se registra; una negativa segura no se oculta como resultado faltante.
5. Repetir casos representativos en un bloque independiente si la evidencia inicial
   lo justifica. Las primeras ejecuciones y los fallos permanecen en el total del estudio.

Orden contrabalanceado D/A y A/D entre casos, con sorteo y semilla registrados
antes del primer despacho. En triples, alternar el orden de D/A/P entre casos.
El bloque de repetición invierte o balancea el orden. Modelos, perfiles y protocolos
se congelan por bloque; una modificación posterior crea una versión nueva.

## Límites propuestos

No hay capacidad nueva aplicada al runtime. Cada celda debe caber en los topes
actuales y no puede tomar presupuesto de otra. Máximo de dos ejecuciones
simultáneas globales; celdas de métodos diferentes se ejecutan por turnos.

| Dificultad | Tokens comunicados, entrada + salida, por celda | Tiempo total hasta aceptar o parar | Máximo de llamadas por celda A/P | Máximo D |
| ---------- | ----------------------------------------------: | ---------------------------------: | -------------------------------: | -------: |
| Sencilla   |                                         100.000 |                          3 minutos |                                2 |        2 |
| Media      |                                         150.000 |                          6 minutos |                                4 |        2 |
| Compleja   |                                         200.000 |                         12 minutos |                                6 |        2 |

Son techos de evaluación, no previsiones de gasto ni reservas defendibles por
trabajador. Se proponen porque los intentos anteriores de un único Codex fueron
del orden de 43–60 mil tokens y 41–72 s en otros encargos; no son evidencia de
que estos quince casos quepan. Deben revisarse por tarea antes de aprobarlos.

Mismo techo de tokens y tiempo para los métodos del caso; D dispone de menos
llamadas porque se define como un implementador con, a lo sumo, una reparación.
A/P no obtienen más tokens o tiempo por invocar especialistas. Máximo una
ejecución de reparación por celda, incluida en llamadas, tokens y tiempo; no
alcanza un nuevo límite por separado. Si una revisión adicional imprescindible
no cabe, se detiene, no se retira para hacer que el resultado parezca económico.

No se inicia una llamada sin reserva defendible del trabajo restante completo:
salida, posibles checks, revisión exigida, integración y cierre. El historial
confiable y la revisión humana existente son las fuentes; no se copian las
reservas fijas insuficientes de pilotos anteriores. Si no hay evidencia para
distribuir el techo, queda pendiente de revisión y no empieza la celda.

El límite de tokens es sobre consumo que el proveedor comunica y puede
sobrepasarse dentro del turno antes de poder parar. Se conserva margen de
suscripción y se pausa al primer evento que indique exceso; no se presenta un
tope local como garantía de generación del proveedor. Consumo final desconocido
impide otro despacho hasta resolverlo, sin convertirlo en cero.

Para decidir con conocimiento del máximo acumulado:

| Bloque candidato          | Celdas | Máximo de tokens | Máximo de tiempo sumado | Máximo de llamadas |
| ------------------------- | -----: | ---------------: | ----------------------: | -----------------: |
| Primera pareja sencilla   |      2 |          200.000 |               6 minutos |                  4 |
| Una pareja por dificultad |      6 |          900.000 |              42 minutos |                 18 |
| Quince casos D/A y tres P |     33 |        5.100.000 |             246 minutos |                108 |

El coste completo es considerable: **no recomiendo autorizar toda la batería
de una vez**. Repetir todo el bloque duplicaría esos máximos y necesitaría otra
autorización. No se preautoriza «hasta terminar». La duración sumada no es una
promesa de calendario y el token no equivale a porcentaje de cuota ChatGPT.

Cada autorización futura fijará casos, variantes, orden, perfiles solicitados,
reservas, máximos de llamadas/tokens/tiempo y caducidad, ligada a huellas de código
y protocolo mediante el verificador existente. Una política nueva no reutiliza
autorizaciones de pilotos anteriores. No se modifican límites automáticamente.

## Qué se registra

| Dimensión           | Medida y regla                                                                                                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Calidad             | Aceptación obligatoria, checks y casos externos superados/total; defectos por gravedad; escapes y observaciones de revisión. Sin porcentaje mágico combinado.                                                     |
| Entrega             | Fecha de solicitud y aceptación; pausa/fallo no es tiempo de entrega. Contar también preparación por encargo, espera, checks, revisión, integración y reparación.                                                 |
| Tiempo              | Pared total y tiempo activo separados; suma de duraciones de agentes separada; intervalos de concurrencia real. Checks superpuestos no se suman dos veces a pared.                                                |
| Tokens              | Entrada I, salida O y caché C por recibo. Total comunicado I+O; entrada sin caché I−C solo si C es conocido y válido. C ya pertenece a I.                                                                         |
| Interrupciones      | Estado final, motivo, intento y contador observado como límite inferior; total desconocido sigue desconocido. No excluir fallos al calcular coste por entrega aceptada.                                           |
| Reparaciones        | Ejecución enlazada al defecto y a su predecesor; número, coste y resultado. Continuar una sesión no demuestra que haya reparación.                                                                                |
| Intervención humana | Número de aprobaciones, aclaraciones, ajustes de cotas, edición de contratos y rescates; minutos activos y espera. Setup inicial separado del trabajo recurrente.                                                 |
| Coordinación        | Tiempo y tokens de Jefe, especialistas y traspasos; longitud/huella del contexto, herramientas/lecturas/turnos cuando el proveedor los comunica.                                                                  |
| Integración         | Tiempo de preparación, checks por trabajador, generación/aplicación de parches, conflictos, pruebas conjuntas y revisión final.                                                                                   |
| Recursos locales    | CPU y pico de memoria atribuibles a procesos propios, uso de disco de worktrees/parches y bytes de artefactos cuando se puedan medir con fiabilidad; si no, desconocido. No incluir credenciales ni datos crudos. |
| Selección           | Estrategia propuesta y efectiva, motivo, modelo/razonamiento solicitado y confirmado, catálogo y verificación de suscripción por llamada, versión CLI/motor.                                                      |

Los recibos, el historial y los contadores existentes se reutilizan. Aún falta
instrumentar parte de la intervención humana, recursos y aceptación por encargo;
no se afirma que esas métricas ya estén conectadas al producto. La preparación
del evaluador debe verificar que los logs sensibles permanecen privados y que
el informe público solo contiene proyecciones seguras.

## Decisión sobre mejoras

Comparar por caso y familia: entregas aceptadas, coste de todos los intentos por
entrega aceptada, tiempo de entrega y tiempo humano. Informar los casos no
aceptados por separado con su coste; no tratarlos como entregas rápidas.

No aceptar una variante que falle un criterio obligatorio, debilite permisos,
carezca de aceptación final o oculte consumo. Una diferencia de tiempo o tokens
no es admisible si hay más defectos bloqueantes o calidad insuficiente. Evaluar
velocidad, consumo y facilidad de uso por separado; presentar resultados pareados,
medianas y dispersión solo cuando haya datos suficientes, con intervalos o
limitaciones explícitas. Dos repeticiones tampoco certifican equivalencia general.

Para promover la ruta paralela se exigirán entregas integradas aceptadas y
ventaja repetida en casos divisibles contando su sobrecoste. Si no supera ese
umbral, queda experimental. Un negativo del estudio también es un resultado útil.

## Condiciones de parada y controles permanentes

Suscripción no verificable, margen de cuota alcanzado, créditos adicionales no
descartados, presupuesto/reserva insuficiente, uso desconocido, conflicto de
integración, alcance alterado o limpieza no acreditada: detener/pausar y conservar
evidencia. No subir límites, cambiar de motor o abrir otra llamada por conveniencia.
Comprobar de nuevo la suscripción antes de **cada** ejecución, incluidas reparación,
planificación y revisión. Sin APIs de pago, recargas ni manipulación de credenciales.

Claude sigue desactivado y Antigravity desconectado. Los benchmarks reales se
ejecutarían localmente con los CLIs oficiales, no con credenciales de usuario en
Actions. GitHub valida verificadores, reproducción y regresión sin inferencia.

Se reutilizan `verifyFutureTrial`, recibos y pilotos como referencias, pero sus
IDs de protocolo y autorizaciones antiguas no cubren esta batería. No se implementa
otro runner durante la auditoría: primero contrato, verificador y aprobación.
