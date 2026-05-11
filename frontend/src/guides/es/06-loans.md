---
id: loans
titleJa: 貸し借り管理
titleEn: Loan Management
titleEs: Gestión de Préstamos
---

# Gestión de Préstamos

Esta aplicación puede gestionar préstamos personales, deudas y créditos por separado de los gastos. El dinero que prestas a alguien se registra como un activo, y el dinero que tomas prestado de alguien se registra como un pasivo.

Si el préstamo o la deuda se trata como un gasto, la situación real se vuelve difícil de ver más adelante cuando ocurre el reembolso o el cobro. La gestión de préstamos te permite revisar por separado los montos no cobrados, los montos no pagados y el historial completado.

## Corto Plazo vs. Largo Plazo

| Tipo | Uso |
| --- | --- |
| Préstamo a corto plazo | Adelantos temporales, pequeños préstamos a amigos y similares |
| Préstamo a largo plazo | Préstamos con un período de reembolso largo, o préstamos donde deseas rastrear el saldo por contraparte |
| Deuda a corto plazo | Montos pagados temporalmente en tu nombre |
| Deuda a largo plazo | Créditos, pago a plazos, o deudas donde deseas rastrear el saldo por contraparte |

Los préstamos y deudas a corto plazo se gestionan como transacciones individuales no resueltas, y puedes elegir qué transacción se liquida al pagar o cobrar. Los préstamos y deudas a largo plazo se gestionan principalmente por saldo de cuenta.

## Cómo Registrar

En la página de Entrada, elige Préstamo/Pago en la entrada simple. Hay cuatro direcciones:

| Dirección | Significado |
| --- | --- |
| Pedir prestado | Tomaste dinero prestado, o alguien pagó en tu nombre |
| Pagar | Pagaste dinero que debías |
| Prestar | Prestaste dinero, o pagaste en nombre de otro |
| Cobrar | Recibiste dinero que te debían |

Para pedir prestado o prestar, elige la cuenta de préstamo objetivo y la cuenta de activo o gasto contraparte. Para pagar o cobrar, selecciona la transacción que se está liquidando para que la aplicación sepa qué préstamo se resolvió.

## Pagos o Cobros con Diferencias

El monto del pago o cobro puede no coincidir exactamente con el monto original debido a comisiones, descuentos, diferencias cambiarias, redondeos, regalos o razones similares.

En ese caso, elige una cuenta de diferencia para registrar la diferencia como una ganancia o pérdida. Por ejemplo, recibir más del monto que prestaste es un ingreso, mientras que recibir menos es un gasto.

## Página de Gestión de Préstamos

Estados Financieros -> Gestión de Préstamos lista los préstamos y deudas. La página está dividida en préstamos a corto plazo, préstamos a largo plazo, deudas a corto plazo y deudas a largo plazo.

Los elementos de corto plazo no resueltos se muestran como tarjetas. Los elementos de corto plazo completados y los de largo plazo cuyo saldo llegó a cero se almacenan en un acordeón de completados.

Desde cada tarjeta, presionando "Registrar desde aquí" se abre el flujo de entrada de préstamos en la página de Entrada. Para préstamos o deudas a largo plazo, también puedes forzar que un elemento se trate como completado cuando realmente está terminado pero es difícil determinarlo solo por el saldo del libro mayor.

## Cerrar un Préstamo

Un préstamo o deuda a corto plazo pasa a completado una vez que se registra un asiento de pago o cobro. Si el monto coincide exactamente con el original, selecciona la transacción objetivo y liquidala — eso es todo lo que se necesita para marcarlo como completado.

Un préstamo o deuda a largo plazo se trata automáticamente como completado cuando el saldo llega a cero. Si el saldo no llega a cero aunque el reembolso esté realmente hecho, usa "Forzar completado" en la página de Gestión de Préstamos. Sin embargo, se recomienda primero verificar por qué el saldo no coincide (por ejemplo, un asiento omitido o un error de entrada) antes de forzar la finalización.

## Manejo de Diferencias en Pagos o Cobros

El monto del pago o cobro puede no coincidir exactamente con el original.

| Caso | Cómo manejarlo |
| --- | --- |
| Recibiste más de lo que prestaste | Registra la diferencia como ingreso (ej., ingreso misceláneo, ingreso por intereses) |
| Recibiste menos de lo que prestaste | Registra la diferencia como un gasto (ej., pérdida miscelánea) |
| Pagaste menos de lo que pediste prestado (deuda condonada) | Registra la diferencia como ingreso (ganancia por condonación de deuda) |
| Pagaste más de lo que pediste prestado (intereses o comisiones) | Registra la diferencia como un gasto (gasto por intereses, comisiones) |

En cada caso, el objetivo es llevar el saldo de la cuenta de préstamo a cero. Puedes elegir la cuenta de diferencia en el formulario de entrada de préstamos sin tener que construir manualmente un asiento multilínea.

## Manejo de Deudas Incobrables

Cuando no se espera poder cobrar una cuenta por cobrar, cancélala como gasto por deuda incobrable.

Pasos:
1. En Configuración, crea una cuenta de gasto por Deuda Incobrable si aún no existe.
2. Usa un asiento multilínea para acreditar la cuenta de préstamo (disminuir el activo) y debitar la cuenta de deuda incobrable (aumentar el gasto).
3. En la página de Gestión de Préstamos, usa Forzar completado para mover el elemento a completado.

Si solo se puede cobrar una parte del monto, combina un asiento por el efectivo que sí recibiste con un segundo asiento que cancele el resto como deuda incobrable.

## Cómo Crear Cuentas

Si tienes muchos adelantos temporales, usar cuentas compartidas como Préstamo a Corto Plazo y Deuda a Corto Plazo suele ser más fácil. Si deseas rastrear un saldo para una persona o préstamo específico durante un largo período, crea cuentas separadas a largo plazo como "Préstamo a A" o "Hipoteca."

Prestar y tomar prestado no son gastos domésticos en sí mismos. El dinero entra o sale, pero debido a que se espera que sea devuelto o debe ser reembolsado, se trata como un activo o pasivo. Si finalmente no será devuelto, o ya no necesita ser reembolsado, liquidalo como una pérdida/ganancia o pérdida/ganancia miscelánea.
