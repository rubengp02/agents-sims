# Fácil: normalizar etiquetas

Corrige normalizeLabel en label.mjs conservando su export y sin modificar otros archivos.

normalizeLabel(value) exige un string y lanza TypeError para cualquier otro tipo.
Recorta espacios al principio y al final, convierte cada grupo de espacios Unicode
internos (incluidos tabuladores y saltos de línea) en un espacio ASCII y pasa a
minúsculas con toLowerCase. Conserva acentos y puntuación. El string vacío es válido.
No cambia el valor de entrada ni hace conversiones implícitas de tipos.

Archivos modificables: label.mjs.
Pruebas públicas: `node --test contract.test.mjs`.
Modelo solicitado: GPT-6.1 Sol; razonamiento: low, igual para todos los papeles de ambos métodos.

Orden fijado: direct → office.
Papeles de oficina esperados: developer.
