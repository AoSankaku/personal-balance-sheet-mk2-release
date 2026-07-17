---
id: currencies
titleJa: 複数通貨の扱い
titleEn: Multi-Currency Handling
titleEs: Manejo de Múltiples Monedas
---

# Manejo de Múltiples Monedas

Esta aplicación permite cambiar entre las monedas habilitadas en Configuración de monedas. La moneda se guarda en cada línea del asiento, por lo que los saldos en moneda extranjera y cripto pueden administrarse por separado según la moneda.

## Idea Central

El selector de moneda de la parte superior de la pantalla determina la moneda utilizada para la entrada y la visualización. Por ejemplo, si seleccionas USD y registras un depósito de 1,000 en una cuenta bancaria en USD, el asiento se guarda en USD.

Una cuenta no está limitada a una sola moneda. Puedes mantener saldos de varias monedas en la misma cuenta o crear cuentas separadas por moneda y finalidad. Cuando sea importante separar claramente los saldos, utiliza cuentas específicas como «Cuenta bancaria USD» y «BTC - Diario».

## Comenzar a Usar una Moneda Extranjera

1. Habilita la moneda deseada, como USD o EUR, en Configuración de monedas.
2. Selecciónala con el selector de moneda de la parte superior de la pantalla.
3. Si deseas separar su saldo por finalidad, crea una cuenta específica.
4. Usa el formulario de saldo inicial para registrar el saldo actual en la moneda seleccionada.

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

Los estados financieros normalmente muestran solo los saldos de la moneda elegida en el selector. Al activar Incluir todas las monedas, los saldos de otras monedas se convierten a la moneda de visualización con los tipos configurados en Configuración de monedas y se incluyen en los totales.

Los valores convertidos varían según la fuente de precios y el momento de consulta. El libro mayor conserva las cantidades en su moneda original; la conversión de visualización nunca modifica los asientos.

## Agregar o Quitar una Moneda

Agregar una moneda no afecta a las cuentas ni a los asientos existentes. Una moneda con saldo pendiente no puede deshabilitarse; si ya no la necesitas, primero lleva su saldo a cero mediante transferencias o asientos de cambio de moneda.

## Criptoactivos y Moneda

Los criptoactivos admiten dos modelos de uso.

- Para pagos cotidianos, habilita BTC u otra criptomoneda en Configuración de monedas, selecciónala con el selector y registra ingresos, gastos y transferencias ordinarios. Crea una cuenta de efectivo como «BTC - Diario» cuando quieras mantener su saldo separado.
- Para inversión o especulación, crea una cuenta como «BTC - Inversión» en la categoría de activos cripto y registra compras, ventas, recompensas y comisiones como actividad de inversión.

Puedes mantener el mismo BTC para ambos fines. Las cuentas separadas conservan los saldos distintos aunque el código de moneda sea el mismo, y la conciliación compara cada cuenta de forma independiente. Las cuentas de inversión pueden obtener el saldo real de la billetera; todas las cuentas, incluidas las de uso diario, permiten introducirlo manualmente. Consulta la guía de Conciliación de saldos de criptoactivos.
