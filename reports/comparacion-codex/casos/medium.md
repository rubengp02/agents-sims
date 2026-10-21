# Media: factura en céntimos

Implementa parseCents en money.mjs y calculateInvoice en invoice.mjs según el contrato, conservando exports.

parseCents(value) acepta únicamente strings con patrón ^(0|[1-9][0-9]*)\.[0-9]{2}$,
sin espacios, signos ni notación exponencial. Devuelve céntimos enteros seguros;
lanza TypeError ante sintaxis/tipo incorrectos y RangeError si excede MAX_SAFE_INTEGER.
calculateInvoice(lines, discountBps=0) recibe un array, posiblemente vacío, de
{price: string, quantity: entero entre 1 y 1000}. Usa parseCents para cada precio.
discountBps debe ser entero entre 0 y 10000. Array/objeto/tipos incorrectos lanzan
TypeError; cantidad/descuento fuera de rango y subtotal inseguro lanzan RangeError.
Calcula subtotalCents como suma exacta de priceCents*quantity. Aplica el descuento
una sola vez al subtotal; discountCents se redondea al entero más cercano, con .5
hacia arriba. Devuelve {subtotalCents, discountCents, totalCents}. Sin coma flotante
para los cálculos monetarios, sin mutar entradas. No modifica otras claves del contrato.

Archivos modificables: money.mjs, invoice.mjs.
Pruebas públicas: `node --test contract.test.mjs`.
Modelo solicitado: GPT-6.1 Sol; razonamiento: medium, igual para todos los papeles de ambos métodos.

Orden fijado: office → direct.
Papeles de oficina esperados: architect, developer, tester.
