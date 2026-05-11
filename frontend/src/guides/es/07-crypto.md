---
id: crypto
titleJa: 暗号資産ウォッチ
titleEn: Crypto Asset Watch
titleEs: Vigilancia de Criptoactivos
---

# Vigilancia de Criptoactivos

La Vigilancia de Criptoactivos vincula direcciones de billetera a cuentas de criptoactivos para que puedas verificar saldos y valores equivalentes en JPY. Adminístralo desde Estados Financieros -> Cripto.

Además de los saldos calculados a partir de asientos contables normales, la aplicación puede obtener saldos reales en cadena y reflejarlos en la valoración de criptoactivos que se muestra en los estados financieros.

## Principales Tipos Soportados

| Tipo | Contenido |
| --- | --- |
| BTC | Saldo de una dirección de Bitcoin |
| ETH | Saldo de una dirección de Ethereum |
| SOL | Saldo SOL de una billetera Solana |
| SKR | Saldo SKR en una dirección de la familia Solana |
| mSOL | Saldo equivalente a SOL apostado a través de Marinade |
| SOL Stake | Saldo de una cuenta de participación nativa de Solana |

La integración con Binance está actualmente deshabilitada. Si deseas administrar saldos de exchanges, crea cuentas de criptoactivos y adminístralos con asientos contables manuales o verificaciones de saldo real según sea necesario.

## Agregar una Billetera

1. En Configuración, crea una cuenta de activo en la categoría de cripto.
2. Abre Estados Financieros -> Cripto.
3. Agrega una billetera, luego elige la cadena, dirección y cuenta vinculada.
4. Usa la obtención de saldo para verificar la cantidad disponible y el monto equivalente en JPY.
5. Guárdalo para mostrar la billetera en la lista de criptoactivos.

En general, una cuenta está vinculada a una configuración de billetera. Incluso con la misma dirección de Solana, es posible que desees tratar SOL, SKR, mSOL y activos similares por separado, así que crea cuentas separadas cuando sea necesario.

## Cómo se Manejan los Valores en JPY

En la página de Cripto, la aplicación multiplica las cantidades obtenidas por los datos de precio para mostrar valores equivalentes en JPY. Los precios se obtienen de fuentes de precios externas y se pueden actualizar en la pantalla.

Para cuentas en la categoría de cripto, la valoración mostrada en los estados financieros puede ser sobrescrita por el valor calculado a partir de la cantidad obtenida y el precio, en lugar del saldo calculado solo a partir de asientos contables. Esto te permite ver los activos totales más cercanos al valor de mercado actual.

## Relación con los Asientos Contables

La Vigilancia de Criptoactivos es para verificar la cantidad mantenida y la valoración. No contabiliza automáticamente cada compra, venta, intercambio, transferencia, comisión, ganancia realizada o pérdida realizada.

Cuando compras criptoactivos, aún necesitas un asiento contable que disminuya el activo de pago y aumente la cuenta de criptoactivos. Cuando vendes, registra el aumento en efectivo/depósitos, la disminución en criptoactivos y la ganancia o pérdida si es necesario.

## Notas para Activos de la Familia Solana

SOL, SKR, mSOL y SOL Stake pueden usar formatos de dirección similares. La detección automática puede no distinguirlos correctamente, así que elige explícitamente la cadena cuando sea necesario.

Marinade mSOL y las cuentas de participación nativas usan métodos de obtención de saldo diferentes a los de las billeteras normales. Si la obtención de saldo falla, verifica si el tipo de dirección es correcto y si el objetivo es una dirección de billetera o una dirección de cuenta de participación.

## Gestión de Acciones y Valores

Las acciones, fondos mutuos y valores similares se gestionan creando una cuenta en la categoría de inversión de activos. El saldo se calcula a partir de asientos contables.

### Asiento Contable de Compra

Usa un asiento multilínea al comprar acciones.

| Débito | Crédito |
| --- | --- |
| Cuenta de inversión (acciones mantenidas) | Cuenta de pago (efectivo/depósitos) |
| Comisión de compra (gasto, si aplica) | |

Anotar el precio de compra o la base del costo en el campo de descripción ayudará con el cálculo de ganancias/pérdidas más adelante.

### Asiento Contable de Venta

Una venta genera una ganancia realizada si el precio de venta excede la base del costo, o una pérdida realizada si está por debajo.

**Venta con ganancia:**

| Débito | Crédito |
| --- | --- |
| Cuenta receptora (efectivo/depósitos) | Cuenta de inversión (acciones mantenidas) |
| | Ganancia por venta de valores |

**Venta con pérdida:**

| Débito | Crédito |
| --- | --- |
| Cuenta receptora (efectivo/depósitos) | Cuenta de inversión (acciones mantenidas) |
| Pérdida por venta de valores | |

"Ganancia por venta de valores" y "Pérdida por venta de valores" están disponibles como cuentas del sistema.

## Registro de Intercambios de Criptoactivos

Las ventas de criptoactivos siguen la misma lógica que los valores.

| Tipo | Cuenta del sistema a usar |
| --- | --- |
| Ganancia por venta | Ganancia por venta de criptoactivos |
| Pérdida por venta | Pérdida por venta de criptoactivos |

La Vigilancia de Criptoactivos es para verificar tenencias y valoraciones. No contabiliza automáticamente compras, ventas, intercambios o transferencias. Registra las transacciones reales por separado como asientos contables multilínea.

### Diferencia entre Valoración y Valor Contable

Cuando la Vigilancia de Criptoactivos está activa, los estados financieros muestran valoraciones a precios actuales de mercado. El saldo del libro mayor, sin embargo, se basa en los montos registrados en el momento de la adquisición. La brecha entre estos es una ganancia o pérdida no realizada y no se refleja en el libro mayor hasta que vendas.

Para las acciones, tampoco hay revalorización automática mensual. La base del costo permanece en el libro mayor y la ganancia o pérdida real se registra en el momento de la venta.

## Notas de Finanzas Domésticas

Los valores del mercado de cripto pueden cambiar bruscamente. La valoración mostrada en el Resumen y los estados financieros es una estimación para comprender el patrimonio neto actual del hogar. No reemplaza completamente la base del costo fiscal, el cálculo de ganancias/pérdidas, el promedio móvil, el promedio total o el tratamiento de comisiones.

Después de grandes transacciones, verifica por separado los asientos contables contra el historial del exchange y de la billetera.
