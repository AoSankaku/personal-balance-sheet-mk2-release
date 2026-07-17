---
id: crypto
titleJa: 暗号資産の残高照合
titleEn: Crypto Balance Reconciliation
titleEs: Conciliación de Saldos de Criptoactivos
---

# Conciliación de Saldos de Criptoactivos

La conciliación vincula direcciones de billetera a cuentas de criptoactivos para comparar el saldo real con el saldo del libro mayor. Adminístrala desde Estados Financieros -> Conciliación de saldos.

El saldo real obtenido de la cadena se utiliza únicamente para la comparación. No sobrescribe el saldo del libro mayor ni la valoración mostrada en los estados financieros.

## Dos formas de utilizar criptoactivos

La categoría cripto de una cuenta y su moneda cumplen funciones diferentes. La categoría indica para qué se mantiene el activo, mientras que la moneda indica la unidad utilizada en los asientos contables.

| Modelo de uso | Ejemplo de configuración | Uso principal |
| --- | --- | --- |
| Inversión o especulación | Crear una cuenta «BTC - Inversión» en la categoría de activos cripto | Mantenerla fuera de los gastos diarios y registrar compras, ventas, transferencias, recompensas y comisiones como actividad de inversión. Se puede vincular una billetera para obtener el saldo real |
| Moneda de pago cotidiana | Habilitar BTC en Configuración de monedas y, si resulta útil, crear una cuenta de efectivo como «BTC - Diario» | Seleccionar BTC con el selector de moneda y registrar ingresos, gastos y transferencias ordinarios en BTC |

Los dos modelos pueden utilizarse a la vez. Por ejemplo, cuentas separadas «BTC - Diario» y «BTC - Inversión» permiten administrar por finalidad saldos de la misma moneda BTC. La conciliación los compara por cuenta, en lugar de combinarlos únicamente por código de moneda.

La obtención automática desde una billetera está destinada a cuentas de la categoría cripto. También puedes introducir manualmente el saldo real de cada cuenta, incluidas las de uso diario, y la obtención automática no sobrescribe un valor que hayas editado manualmente.

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
2. Abre Estados Financieros -> Conciliación de saldos y selecciona Entrada de saldo real.
3. Agrega una billetera, luego elige la cadena, dirección y cuenta vinculada.
4. Usa Obtener y aplicar para introducir la cantidad disponible como saldo real.
5. Guarda la instantánea y revisa las diferencias con el saldo del libro mayor.

En general, una cuenta está vinculada a una configuración de billetera. Incluso con la misma dirección de Solana, es posible que desees tratar SOL, SKR, mSOL y activos similares por separado, así que crea cuentas separadas cuando sea necesario.

## Cómo se Manejan las Monedas

Los estados financieros convierten el saldo del libro mayor con los precios disponibles para mostrar su equivalente en la moneda de visualización. Los precios proceden de fuentes externas y pueden actualizarse.

La cantidad obtenida de la billetera se conserva en su moneda original y solo sirve como saldo real para la conciliación; no sustituye los importes derivados de los asientos contables.

## Relación con los Asientos Contables

La conciliación sirve para comprobar la cantidad mantenida frente al libro mayor. No contabiliza automáticamente cada compra, venta, intercambio, transferencia, comisión, ganancia realizada o pérdida realizada.

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

La conciliación sirve para verificar las tenencias frente al libro mayor. No contabiliza automáticamente compras, ventas, intercambios o transferencias. Registra las transacciones reales por separado como asientos contables multilínea.

### Diferencia entre el Saldo Real y el Libro Mayor

La pantalla de conciliación muestra por separado el saldo real obtenido y el saldo calculado a partir de los asientos. Si existe una diferencia, revisa el historial de la billetera y registra los asientos que falten; obtener el saldo no modifica el libro mayor.

Para las acciones, tampoco hay revalorización automática mensual. La base del costo permanece en el libro mayor y la ganancia o pérdida real se registra en el momento de la venta.

## Notas de Finanzas Domésticas

Los precios de mercado de los criptoactivos pueden cambiar bruscamente. Las conversiones mostradas en el Resumen y los estados financieros son estimaciones para comprender el patrimonio neto actual del hogar. No reemplazan la base del costo fiscal, el cálculo de ganancias/pérdidas, el promedio móvil, el promedio total ni el tratamiento de comisiones.

Después de grandes transacciones, verifica por separado los asientos contables contra el historial del exchange y de la billetera.
