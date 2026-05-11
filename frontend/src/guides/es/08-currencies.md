---
id: currencies
titleJa: 複数通貨の扱い
titleEn: Multi-Currency Handling
titleEs: Manejo de Múltiples Monedas
---

# Manejo de Múltiples Monedas

Esta aplicación soporta múltiples monedas. Puedes establecer una moneda para cada cuenta, por lo que las cuentas bancarias en moneda extranjera y los activos en moneda extranjera pueden incluirse en el libro mayor.

## Idea Central

Cada asiento contable se registra por moneda. Por ejemplo, un depósito de 1,000 USD en una cuenta bancaria en USD se registra en USD. La aplicación no obtiene automáticamente los tipos de cambio. Al registrar transacciones en moneda extranjera, ingresa el monto en moneda extranjera directamente. Para ver un total convertido en los estados financieros, ingresa un asiento de conversión manualmente.

## Crear una Cuenta en Moneda Extranjera

1. En Configuración, crea una nueva cuenta.
2. Establece la moneda de la cuenta a la moneda objetivo, como USD o EUR.
3. Ingresa el saldo inicial en la moneda extranjera usando el formulario de saldo inicial.

## Registrar Transacciones en Moneda Extranjera

Los depósitos y retiros en moneda extranjera se registran de la misma manera que los asientos normales. Ingresa el monto en la moneda extranjera.

| Ejemplo de transacción | Cómo registrarlo |
| --- | --- |
| Depositar 1,000 USD en una cuenta USD | Selecciona la cuenta USD como destino de ingreso, ingresa 1,000 |
| Pagar 100 USD de gasto desde una cuenta USD | Selecciona la cuenta USD como fuente de gasto, ingresa 100 |
| Convertir cuenta USD a cuenta JPY | Usa un asiento multilínea entre las dos cuentas |

## Asiento Contable de Conversión de Moneda

Al convertir entre una cuenta en JPY y una cuenta en moneda extranjera, usa un asiento multilínea.

**Ejemplo: Convertir 1,000 USD (adquiridos a 150 JPY/USD) por 145,000 JPY**

| Débito | Crédito |
| --- | --- |
| Cuenta bancaria (JPY) 145,000 | Cuenta USD 1,000 (base de costo 150,000 JPY equivalente) |
| Pérdida por tipo de cambio 5,000 | |

La diferencia entre la tasa de adquisición y la tasa de conversión se convierte en una ganancia o pérdida por tipo de cambio, que se registra como ingreso o gasto.

Esta aplicación soporta asientos de intercambio de moneda que permiten una discrepancia en los montos de débito/crédito (`is_currency_exchange`). En el formulario de entrada multilínea, registrar asientos como intercambio de moneda te permite guardar combinaciones de montos en diferentes monedas.

## Visualización en los Estados Financieros

En los totales de los estados financieros, los saldos en diferentes monedas se muestran como números simples uno al lado del otro. Por ejemplo, si tienes 100,000 JPY en una cuenta JPY y 500 USD en una cuenta USD, el total de activos muestra un número combinado de 100,000 + 500.

Cuando las monedas están mezcladas, trata los totales solo como valores de referencia. Para un total preciso, verifica los saldos convertidos manualmente o consolida en una sola moneda ingresando asientos contables de conversión.

## Cambiar una Moneda

La moneda de una cuenta que ya tiene asientos contables no se puede cambiar. Si la moneda se configuró incorrectamente, usa la función de Edición y Reemplazo Masivo para mover los asientos contables a una cuenta diferente, luego elimina la cuenta original.

Agregar una nueva moneda (por ejemplo, abrir una nueva cuenta EUR) solo requiere crear una nueva cuenta configurada en EUR. Las cuentas existentes y los asientos contables no se ven afectados.

## Criptoactivos y Moneda

Los criptoactivos como BTC, ETH y SOL también se tratan como un tipo de moneda extranjera. Crea una cuenta en la categoría de cripto y establece la moneda a BTC o similar. Los asientos contables se registran entonces en esa unidad de cripto.

Para verificar el valor equivalente en JPY, usa la Vigilancia de Criptoactivos para obtener precios de fuentes externas y multiplicarlos por la cantidad mantenida. Consulta la guía de Vigilancia de Criptoactivos para más detalles.
