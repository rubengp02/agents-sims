# Codex directo frente a Pixel Office: comparación preparada

Nueva preparación: [protocolo v2 con presupuesto simétrico por método y ejecución
del conjunto](v2/PROTOCOLO.md). Los límites y resultados v1 siguientes se conservan
como evidencia histórica; no se han ampliado ni reiniciado sus registros.

Seguimiento: la etapa fácil se autorizó e inició posteriormente y quedó
[pausada por presupuesto tras Codex directo](RESULTADO_FACIL.md). No se ejecutó
la oficina ni se autorizaron las otras etapas. El estado de preparación que sigue
es histórico; los límites y resultados originales se conservan.

Estado: **preparado y validado localmente; ejecución real sin autorizar**.
El piloto anterior conserva sus límites agotados y sus mediciones. Esta preparación
no llama a modelos, no comprueba cuentas ni modifica credenciales. Claude sigue
desactivado y Antigravity sin conectar. Diseño y animaciones no se han modificado.

La [verificación final](VERIFICACION.json) registra 12 pruebas nuevas del arnés,
59 de interfaz, 628 de servidor, 7 del paquete y 7 del estudio previo, todas
superadas; tipos y lint correctos. Permanece una advertencia previa de hooks en
`App.tsx`. Se comprobó que el lanzador rechaza la falta de autorización antes de
consultar la cuenta y sin crear un registro de ejecución real. Las tres referencias
pasan y los tres códigos defectuosos iniciales fallan, como se esperaba.

## Pregunta que responderemos

Para una tarea fácil, una media y una difícil: ¿aporta el circuito de oficina más
calidad, menos tiempo o menor consumo que dar el encargo completo a Codex directamente?

La referencia será **una sesión de Codex CLI oficial con la tarea completa**, las
herramientas locales y sus pruebas. Usa el mismo ejecutor protegido de suscripción,
sin planificador, sin repartir tareas y sin añadir un historial artificial. No es
una comparación de la velocidad de la interfaz del chat de Codex Desktop.

La oficina usará el `TeamCoordinator` real y la selección local de especialistas
que ya implementamos. No se impondrán cuatro papeles a tareas que no los necesitan.
Las asignaciones se fijan manualmente en el experimento para controlar modelo y
razonamiento; esto no cambia la configuración normal de la aplicación.

## Casos y aceptación

| Dificultad               | Encargo                                                                    |                                      Aceptación externa | Codex directo | Oficina                           |
| ------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------: | ------------- | --------------------------------- |
| [Fácil](casos/easy.md)   | Corregir normalización de etiquetas, espacios Unicode y tipos              |                                       15 comprobaciones | Programador   | Programador + aceptación local    |
| [Media](casos/medium.md) | Factura en dos módulos: importes exactos, validación, descuento y redondeo | 36 comprobaciones, una con 114 combinaciones monetarias | Programador   | Arquitecto → Programador → Tester |
| [Difícil](casos/hard.md) | Cola en dos módulos: concurrencia, FIFO, idempotencia y cancelación        |     16 comprobaciones, varias con secuencias asíncronas | Programador   | Arquitecto → Programador → Tester |

Las etiquetas de dificultad describen estas tareas sintéticas concretas, no una
escala universal de proyectos. El caso difícil no modifica la cola real de la
oficina: se trabaja en una copia pequeña y aislada.

Cada caso tiene código inicial con defectos conocidos, pruebas públicas disponibles
para ambos métodos y una implementación de referencia para validar el verificador.
El verificador externo se ejecuta fuera de los archivos modificables y no confía en
la respuesta del modelo ni en las pruebas públicas que este haya ejecutado.
También comprueba cambios fuera de alcance, pruebas, contrato e instrucciones
intactos y declaración de finalización. Un test público exitoso no basta.

La preparación confirma que el código inicial falla y la referencia pasa en los
tres casos. Un caso de mutación adicional demuestra que el verificador detecta un
fallo de espacios Unicode que las pruebas públicas no cubren. Los tests externos
no se entregan en el prompt; no se promete que su ubicación sea un límite de secreto
frente a un agente que explore el resto del repositorio.

## Controles de la comparación

- Mismos bytes iniciales y hashes, contrato completo, mapa de archivos, datos de
  alcance y pruebas públicas para ambos métodos. Dos carpetas nuevas y separadas.
- GPT-6.1 Sol solicitado en todos los papeles: esfuerzo bajo en fácil, medio en
  media y alto en difícil. Dentro de cada pareja no cambia modelo ni esfuerzo.
- Mismo perfil oficial de escritura para ambos Programadores. Arquitecto y Tester
  de solo lectura. Mismas restricciones sobre archivos y herramientas.
- Catálogo y suscripción oficiales verificados antes de cada ejecución; catálogo
  estable dentro de la etapa. Versiones CLI, modelo solicitado y confirmado se
  registran por separado. Si el CLI no confirma el modelo, queda desconocido.
- Todas las sesiones nuevas. No se reutiliza una sesión del autor para el Tester,
  ni se interpreta reutilizar personaje o caché como continuar una conversación.
- Orden fijado antes de medir: directo → oficina en fácil, oficina → directo en
  media, directo → oficina en difícil. La caché se observa, no se fuerza ni borra.
- Pruebas públicas y aceptación externa se ejecutan localmente. Codex también puede
  ejecutar las pruebas disponibles durante su trabajo, igual que el Programador
  de la oficina. No se prohíben herramientas al método directo para abaratarlo.

El tiempo total de cada método incluye preparación de su carpeta, contexto,
asignaciones, diagnósticos durante el método, ejecuciones y comprobaciones finales.
Se registran por separado preparación, ejecución con checks locales y aceptación
externa. La comprobación común inicial de disponibilidad queda en el tiempo de la
etapa; no se atribuye exclusivamente al método que vaya primero.

## Presupuestos propuestos, todavía no autorizados

| Etapa   | Máximo de intentos CLI, ambos métodos | Tiempo de etapa | Por ejecución | Tokens comunicados de etapa | Reserva por intento |
| ------- | ------------------------------------: | --------------: | ------------: | --------------------------: | ------------------: |
| Fácil   |                                     2 |           4 min |          90 s |                      60.000 |              30.000 |
| Media   |                                     4 |           6 min |          90 s |                     120.000 |              30.000 |
| Difícil |                                     4 |           8 min |         120 s |                     160.000 |              40.000 |

Son **6 recorridos de método y hasta 10 intentos CLI**, no seis llamadas a modelos.
Dentro de una ejecución CLI puede haber varias rondas internas con herramientas.
Los contadores de tokens comunicados incluyen esas rondas y la entrada en caché.
Los presupuestos son conservadores y pueden impedir acabar una etapa; no garantizan
que la tarea difícil quepa en ellos.

Primero se autorizaría únicamente la fácil. Cada etapa exige autorización humana
separada y vigente para su caso, huellas de código y protocolo y límites exactos.
No se puede iniciar media sin una comparación fácil completa y verificable, ni
difícil sin media. Completar una etapa no autoriza la siguiente.

No hay reparaciones automáticas ni presupuesto reservado para reintentos externos
(`maxRepairRuns=0`). Las correcciones que haga Codex dentro de su propia sesión sí
consumen su tiempo y tokens. Si el resultado final falla, se conserva como fallo;
no se excluye de la comparación ni se reinicia hasta que parezca un éxito. Una
segunda fase con reparaciones externas necesitaría un protocolo y presupuesto nuevos.

El registro persistente consume un intento antes de llamar al ejecutor. Una cuota
no verificable, cambio de catálogo, límite, cancelación, consumo desconocido o fallo
del CLI pausa la etapa. El registro exclusivo evita repetirla tras un cierre o
reiniciar su presupuesto. No se eleva ningún límite automáticamente.
El consumo se conoce al terminar el turno: el umbral por tokens **no es un corte
exacto durante la generación**, y no equivale a dinero ni a cuota porcentual.

## Métricas y decisión

Por ejecución y por método se registrarán entrada, salida, caché, entrada sin caché,
tiempo, intentos CLI, papeles, cambios, pruebas superadas y fallidas, estado de la
tarea y reparaciones externas (cero en esta fase). Datos ausentes permanecen
desconocidos. Los fallos de aceptación son identificadores de comprobaciones;
varios tests fallidos no se presentan como varios defectos únicos confirmados.
No se publican prompts, respuestas, comandos del agente, rutas personales ni sesiones
sin anonimizar. Los logs locales permanecen ignorados por Git.

Solo se compara eficiencia si ambos métodos cumplen la misma aceptación y los
controles son verificables. Una diferencia de calidad se registra aparte, sin
declarar que un fallo más barato sea una victoria. Si uno consume menos pero tarda
más, se registra el intercambio, sin inventar una puntuación monetaria de ChatGPT.

Una observación por método y dificultad será **exploratoria**. No demostrará una
ventaja estable; para afirmarla harían falta repeticiones y orden alternado dentro
de cada caso. No se elegirán los casos ganadores para ocultar resultados adversos.
También es un resultado válido que Codex directo convenga en las tres tareas.

## Reproducción y estado de preparación

Desde `pixel-office`:

```powershell
npm run benchmark:prepare
npm run benchmark:test
```

Ambos comandos son offline. La preparación conserva sus intentos en
[preparacion-local.json](preparacion-local.json), publica los contratos y el
[protocolo legible por el lanzador](protocolo.json), y ensaya los dos métodos
con el coordinador real y ejecutor **simulado**. Sus tokens artificiales no son
una medición de ahorro y solo se guardan como evidencia de simulación local.

El lanzador real ya está implementado y probado con simulaciones. Sus borradores
de autorización están bajo `.local-office/comparison-v1/authorizations/`, con
`approved=false`. Los archivos `*.template.json` se regeneran con las huellas
actuales; los archivos de autorización existentes no se sobrescriben. Solo tras
un encargo humano explícito se podría copiar el borrador vigente al archivo del
caso y registrar aprobación, motivo y caducidad máxima de 24 horas. No hay botones
nuevos ni cambios visuales.

Después de esa autorización, el comando técnico para la primera etapa sería:

```powershell
npm run benchmark:run -- --case easy
```

Actualmente queda bloqueado antes de descubrir el CLI o consultar la cuenta. No se
ha ejecutado esta comparación con IA real. Los presupuestos del piloto previo no
se han reutilizado ni alterado. Esta preparación no demuestra ninguna ventaja del
sistema frente a Codex directo.
