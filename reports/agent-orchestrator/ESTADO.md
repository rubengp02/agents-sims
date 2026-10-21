# Integración preparada; promoción a motor predeterminado pendiente

21 de octubre de 2026.

Se ha preparado y compilado una integración acotada con Agent Orchestrator,
revisión `1550d440b82ac9cfb3e671b060709457cdffbaea`. Reutiliza sus módulos reales
de conversaciones nativas de Codex y espacios Git aislados. La cola de la oficina
conserva la asignación, los límites, los permisos y las comprobaciones. No es una
migración completa al daemon y a todos los servicios de AO.

## Qué está implementado

- Motor seleccionable por configuración, revisión fijada y ejecutable verificado.
- Verificación de suscripción antes de conectar y antes de cada turno; no hay
  alternativa de API ni cambios de cuenta o créditos.
- Inicio y continuación nativa explícita. Reutilizar personaje no continúa sesión.
- Programador en espacio aislado; sus dependientes y sus pruebas usan ese espacio.
- Perfiles estables por papel y finalización del diagnóstico separada de la
  aceptación del producto.
- Cola privada persistente, recuperación en pausa y contadores conservados.
  Consumo desconocido o estado corrupto bloquean la recuperación.
- Contadores de entrada, salida y caché sin duplicar los acumulados al continuar.
- Integración con los personajes existentes y prevención de duplicados al observar
  una conversación continuada. Ningún archivo visual ha cambiado.
- Preparación reproducible, comprobaciones locales y licencia Apache 2.0 incluida.

## Qué se midió con Codex real

Piloto nuevo de una tarea media, con contratos de aceptación precisados antes
de ejecutarla. Ambos métodos pidieron el mismo modelo y razonamiento. Límites
fijados: cuatro ejecuciones, ocho minutos y 400.000 tokens en total; cada método
disponía de 200.000 tokens y cuatro minutos. No hubo reintentos ni ampliaciones.

| Método         | Entrada | Salida | Caché incluida en entrada |  Total | Tiempo del método | Aceptación                                   |
| -------------- | ------: | -----: | ------------------------: | -----: | ----------------: | -------------------------------------------- |
| Codex directo  |  57.503 |  2.189 |                    46.208 | 59.692 |          61,989 s | 36/36 y archivos correctos                   |
| Oficina con AO |  42.862 |    981 |                    31.744 | 43.843 |          43,030 s | Detenida tras Arquitecto; sin implementación |

Se consumieron dos ejecuciones y **103.535 tokens**, en aproximadamente 105 s.
Se verificó la suscripción en ambas. El modelo confirmado no fue comunicado.
Los hashes de los archivos iniciales coinciden entre métodos.

El resultado de oficina no constituye ahorro: quedó el código inicial, del que
pasaban 10/36 comprobaciones. La causa fue un defecto del puente: leía `Text` en
los incrementos que AO entrega en `Delta`, y no atendía al mensaje completado.
La auditoría local de la respuesta nativa confirmó que el Arquitecto sí declaró
su diagnóstico completado. La cola recibió cero caracteres y bloqueó los pasos
posteriores. `completed` en PILOTO_REAL.json describe el cierre del ensayo, no
la aceptación de ambos métodos.

El presupuesto se ha cerrado. Se conserva el resultado original en
[PILOTO_REAL.json](PILOTO_REAL.json); las reparaciones posteriores y el diagnóstico
figuran en [AUDITORIA.json](AUDITORIA.json). **No se repitió inferencia tras reparar.**

## Correcciones y pruebas posteriores

Se corrigió la entrega de mensajes incrementales y completos, evitando duplicados.
La prueba completa posterior encontró además que el Programador heredaba la
carpeta original del Arquitecto como si fuese un espacio gestionado; se corrigió.

La prueba nativa local supera cinco escenarios usando los módulos compilados de
AO y un proveedor de protocolo simulado: las tres formas de respuesta; continuidad
y caché tras reiniciar; aislamiento y destino del Tester; pausa por uso desconocido;
y Arquitecto → Programador → Tester con aceptación mecánica independiente.
El proveedor simulado no es un modelo y no demuestra calidad de IA real.
[Evidencia nativa](VALIDACION_NATIVE.json).

Las pruebas de navegador superaron ocho escenarios, incluido el trabajo del equipo,
animación, importación y exportación del editor. La validación final de tipos,
lint, aplicación, estudios, puente y compilación está en
[VALIDACION_LOCAL.json](VALIDACION_LOCAL.json). Se conserva el aviso previo de
React sobre la dependencia `editor`; no se ha modificado el diseño para resolverlo.

La batería original de AO no pasó íntegramente en este Windows: contiene rutas
POSIX, una expectativa de mensaje distinta y una prueba de enlaces simbólicos
que requiere privilegios no disponibles. Se ha registrado esta limitación y no
se ha cambiado esa batería para declarar un resultado favorable.

## Decisión de entrega

**El motor anterior sigue siendo el predeterminado.** El candidato AO está
compilado, integrado y comprobado localmente; su promoción requiere una aceptación
real nueva de la corrección. No se han activado Claude ni Antigravity, publicado
cambios, fusionado espacios de trabajo ni alterado la oficina abierta.

Queda pendiente demostrar calidad completa y comparar rapidez y cuota tras esa
corrección. La continuidad con IA real tampoco se ha medido: está validada con el
proveedor simulado. Los casos fácil y difícil tienen verificadores comprobados,
pero no se ejecutaron con modelos en este piloto.

Uso y límites: [guía del motor](../../docs/MOTOR_AGENT_ORCHESTRATOR.md).
