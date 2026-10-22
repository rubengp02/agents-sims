# Entrega: proyectos y conversaciones guardadas

Fecha: 22 de octubre de 2026.

Se implementó y verificó el recorrido local de registro del proyecto, aprobación
de sus pruebas, creación de conversaciones, conservación de mensajes y respuestas,
reapertura tras reiniciar el proceso y seguimiento con contexto reciente.

## Resultado entregado

- Registro independiente de proyectos: identidad estable, carpeta, nombre,
  instrucciones y último contrato acotado. La selección se recupera al abrir el panel.
- Catálogo por proyecto de scripts npm conocidos, revisión explícita de sus pasos,
  aprobación persistida y retirada de esa aprobación. Cambiar `package.json`
  invalida la autorización. Un identificador enviado por HTTP no registra un comando
  ni acredita cobertura de requisitos nuevos.
- Conversaciones identificadas y buscables por título o proyecto, con mensajes,
  respuestas completas, borradores guardados explícitamente y descarga en JSON.
- Un archivo privado independiente de la cola, con escritura mediante temporal,
  copia anterior y recuperación con aviso. Un error de escritura conserva el cambio
  en memoria y pausa el trabajo; una corrupción irrecuperable no se sobrescribe.
- Abrir un historial no hace inferencia. Enviar guarda y prepara; ejecutar sigue
  siendo una acción explícita sujeta a los controles existentes. Seguir conversando
  utiliza instrucciones y contexto reciente, sin prometer la misma sesión del CLI.

El uso está explicado en [CONVERSACIONES.md](CONVERSACIONES.md). La interfaz utiliza
los controles y estilos existentes y concentra las opciones técnicas en apartados
desplegables. Se corrigió una carrera entre la carga periódica del panel y la
selección de conversación que podía vaciar el campo al escribir inmediatamente.

## Pruebas ejecutadas

Se añadieron nueve pruebas en `server/__tests__/conversationLibrary.test.ts`:

1. Recuperación de proyecto, instrucciones, selección y borrador sin llamadas a IA.
2. Conservación de respuestas de más de 20.000 caracteres y seguimiento con contexto.
3. Separación de conversaciones y acceso al historial con la carpeta movida.
4. Aprobación, persistencia, ejecución real de un script Node mediante npm e
   invalidación de la aprobación tras cambiar la configuración.
5. Rechazo de enlaces a proyectos ajenos y protección de las seis rutas nuevas.
6. Recuperación de la copia, conservación del original dañado y bloqueo si ambas
   copias están corruptas.
7. Error real de escritura provocado en una carpeta temporal, conservación en
   memoria, aviso visible y guardado posterior.
8. Recuperación desde la copia cuando falta el archivo principal.
9. Revocación de permisos incluso para un ejecutor ya creado y separación de
   aprobaciones entre proyectos.

Las cinco pruebas de persistencia de la revisión inicial también se conservan.
La prueba nueva `e2e/tests/standalone/conversations.spec.ts` usa Edge y un servidor
en un proceso hijo propio. Lo cierra, inicia otro proceso sobre el mismo almacén
y comprueba desde el panel:

- Proyecto, instrucciones y aprobación conservados.
- Mensaje guardado antes de ejecutar y respuesta accesible después.
- Cierre y reapertura del panel con borrador y carpeta recordados.
- Reapertura tras reiniciar el proceso y envío de otro mensaje con contexto.
- Descarga, selección de otra conversación y retorno a la anterior.
- Panel accesible en un ancho móvil de 390 píxeles.

La IA y la evidencia de suscripción de estas pruebas son simuladas. El navegador,
los procesos del servidor, los archivos y el script local de comprobación son reales.
Los contadores de prueba no son mediciones de consumo de modelos.

Validaciones aprobadas:

- `npm test`: 59 pruebas de interfaz, 708 del servidor y 7 del contrato del paquete.
- `npm run package`: tipos, lint y empaquetado completos. Lint mantiene una
  advertencia previa en `App.tsx` sobre la dependencia `editor` de un efecto.
- Tras los ajustes finales del backend: 71 pruebas dirigidas aprobadas, incluidas
  persistencia, conversaciones, rutas y coordinador.
- Estudio local de contexto: 4 pruebas aprobadas.
- Navegador sobre el paquete compilado: conversaciones, equipo y flujos,
  3 pruebas aprobadas.

## Alcance y límites

No se ha ejecutado inferencia real ni un piloto con cuota de suscripción. No se ha
afirmado funcionamiento perfecto ni aceptación universal a partir de simulaciones.
La ejecución real sigue necesitando sus verificaciones y autorización propias.

El archivo tiene un límite de 64 MiB y no hay sincronización entre equipos. Los
borradores se guardan mediante su botón; las respuestas anteriores a esta función
solo pueden migrarse con el texto disponible en el checkpoint. Las pruebas
registrables desde esta interfaz corresponden a los cuatro scripts npm indicados,
sin inventar verificadores para otros sistemas. El contexto de seguimiento está
acotado y la revisión independiente conserva su separación.

## Revisión de calidad

Resumen de la autoevaluación `ecc:agent-self-evaluation`: 4,0/5. Es una revisión del
trabajo, no una decisión humana de aceptación.

| Eje           | Nota | Evidencia y mejora posible                                                                                                           |
| ------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Exactitud     | 4/5  | Persistencia, controles y proceso reiniciado comprobados; la inferencia real queda sin evaluar y se declara así.                     |
| Cobertura     | 4/5  | Recorrido solicitado y fallos de almacenamiento cubiertos; el límite de archivo y el soporte npm están documentados.                 |
| Claridad      | 4/5  | Historial y mensajes visibles, opciones técnicas desplegables y guía breve; la valoración final de comodidad corresponde al usuario. |
| Uso inmediato | 4/5  | Paquete compilado y recorrido probado en navegador; hay que abrir la versión actualizada de la oficina.                              |
| Concisión     | 4/5  | Explicación de uso separada del informe técnico; quedan controles heredados agrupados para conservar compatibilidad.                 |

No se identificaron ejes críticos. Las mejoras posteriores con mayor impacto son
la paginación de historiales grandes y la evaluación real por bloques cuando se
autorice. La autoevaluación prioriza el objetivo expresado por el usuario:
conversaciones guardadas y accesibles desde una interfaz sencilla. La aprobación
visual y la aceptación de los resultados reales continúan correspondiendo al usuario.
