# Conversaciones guardadas

La oficina guarda las conversaciones en este equipo. Cerrar el panel, el navegador
o la oficina no borra los mensajes enviados. No hace falta buscar archivos del CLI
para volver a leerlos.

## Uso

1. Abre **Equipo**. Escribe la carpeta del proyecto y abre **Guardar proyecto e
   instrucciones**. Ponle un nombre, añade las instrucciones que quieras conservar
   y pulsa **Guardar proyecto**.
2. Pulsa **Nueva conversación**. Escribe un mensaje y pulsa **Enviar mensaje**.
   El mensaje se guarda y el encargo queda preparado. **Ejecutar cola** inicia el
   trabajo, con las comprobaciones de suscripción, presupuesto y permisos habituales.
3. Vuelve cuando quieras mediante **Abrir conversación**. Puedes buscar por título
   o proyecto, leer las respuestas y descargar una copia. Abrir un historial no
   consulta ni ejecuta modelos.
4. Para seguir conversando, escribe el siguiente mensaje en esa conversación.
   Primero debes resolver o cancelar un encargo que todavía esté pendiente.
   Si la oficina quedó en pausa al cerrar, revisa el motivo y permite continuar
   antes de ejecutar la cola.

**Guardar borrador** conserva un mensaje que todavía no has enviado. El texto que
solo has escrito, sin enviar ni guardar como borrador, no se guarda automáticamente.

Las opciones de modelos, presupuestos y reparto siguen en los apartados
desplegables. Los controles se conservan; la oficina, los personajes y el editor
visual no cambian.

## Proyectos y pruebas

Cada proyecto recuerda su nombre, carpeta, instrucciones y último contrato acotado
guardado. Ese contrato conserva archivos, decisiones, aceptación y pruebas; no se
presupone que cubra cualquier petición posterior. Revísalo si cambia el encargo.

En **Pruebas del proyecto** puedes revisar y aprobar las comprobaciones que el
servidor encuentra en su configuración npm: `check-types`, `lint`, `test` y
`package`, cuando existen. Se muestran también sus pasos previos y posteriores.
El navegador no puede proporcionar ejecutables ni registrar comandos arbitrarios.
La aprobación se guarda con la huella de `package.json` y la ruta de npm; un cambio
de esa configuración invalida la aprobación. También puedes desmarcar y guardar
para retirar una aprobación. Solo se ejecutan las pruebas que el encargo incluye.

Ejecutar una prueba satisfactoria no demuestra por sí solo que se hayan cumplido
todos los requisitos. Las pruebas generales no reciben cobertura de requisitos
inventada; se mantienen los controles de revisión independiente del motor.
Los proyectos sin esas comprobaciones npm siguen admitiendo conversaciones, pero
la oficina no inventa un verificador ni marca su aceptación como acreditada.

## Almacenamiento y recuperación

El arranque standalone configura el archivo `conversations.json` bajo el directorio
privado de estado adaptativo de esa oficina: en Windows, dentro de
`LOCALAPPDATA/AgentsSims/adaptive/<identificador>/library/`. No está en el repositorio
editable ni es un servicio remoto. No contiene credenciales, pero sí mensajes,
respuestas, instrucciones y rutas privadas: protege sus copias como tus documentos.

Las escrituras sustituyen el archivo mediante un temporal y mantienen una copia
anterior `.bak`. Si el principal no se puede leer, se intenta recuperar esa copia
y se avisa de que los últimos mensajes podrían faltar. El archivo dañado se
conserva. Si tampoco se puede leer la copia, se bloquean las escrituras y los nuevos
encargos; nunca se reemplazan los datos ilegibles por un historial vacío.
Un error al guardar pausa el trabajo y muestra un aviso; no debe cerrarse la oficina
hasta resolverlo. No es una garantía frente a averías del disco: descarga copias
de las conversaciones que necesites conservar por separado.

Las conversaciones se guardan aparte de la cola de ejecución. Una carpeta movida
o un checkpoint inválido no borran su archivo de historial. El proyecto debe volver
a estar disponible antes de ejecutar nuevos encargos sobre él. Leer un historial
no exige que la carpeta siga existiendo.

Las respuestas nuevas se conservan completas, aunque la tarjeta del encargo solo
muestre un resumen de 20.000 caracteres. Las tareas anteriores a esta función se
incorporan con el contenido disponible en su checkpoint; no se recupera texto que
ya hubiera sido recortado. El límite actual del archivo es 64 MiB: al alcanzarlo se
bloquean nuevos guardados sin borrar mensajes. No hay sincronización entre equipos
ni importación o compactación automática de archivos exportados.

Para continuar un encargo se prepara una ejecución nueva con las instrucciones del
proyecto y un contexto reciente acotado: hasta ocho mensajes anteriores, de hasta
1.500 caracteres cada uno. El historial visible conserva el texto completo. Esto
no promete continuar la misma sesión del CLI ni mandar todo el historial al modelo;
las revisiones independientes no reciben la conversación del autor.

Al crecer la cola se pueden retirar de ella encargos terminados sin dependencias
ni flujos asociados, conservando sus mensajes en el historial. No se libera
presupuesto, se borran mensajes ni se reanudan tareas por esa retirada.
