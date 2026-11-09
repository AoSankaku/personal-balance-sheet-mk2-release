---
id: budget
titleJa: 予算システム（仮想バケット）
titleEn: Budget System (Virtual Buckets)
titleEs: Sistema de Presupuesto (Cubos Virtuales)
---

# Sistema de Presupuesto (Cubos Virtuales)

Las categorías de presupuesto son cubos virtuales superpuestos sobre cuentas reales de efectivo y bancarias. El saldo real de la cuenta permanece donde está, mientras que el sistema de presupuesto divide ese dinero por propósito, como gastos discrecionales, gastos necesarios, fondos de viaje o reservas de inversión.

## Conceptos Centrales

| Elemento | Rol |
| --- | --- |
| Cuenta | Elemento real del libro mayor, como una cuenta bancaria, tarjeta, salario o gasto de alimentos |
| Categoría de presupuesto | Cubo virtual basado en propósitos para efectivo/depósitos |
| Cuentas de gastos vinculadas | Deciden qué presupuesto se consume mediante asientos de gasto |
| Cuentas de tenencia objetivo | Describen dónde intentas mantener el dinero para un presupuesto |

Crea categorías desde Configuración -> Configuración de Presupuesto. Una categoría puede tener un grupo, saldo meta, límite de saldo, destino de excedente, cuentas de gastos vinculadas y cuentas de tenencia objetivo.

## Reintegro, Reinicio y Límites

Los presupuestos regulares se trasladan en su totalidad, tanto si son positivos como negativos. Un presupuesto negativo representa un exceso de gasto, pero no se cuenta como una segunda reserva porque la salida de efectivo ya lo refleja. Tampoco aumenta el dinero asignable.

Si las importaciones históricas o correcciones hacen que un saldo sea poco realista, usa Entrada -> Ajuste de Presupuesto -> Reinicio de Presupuesto para llevar esa categoría a cero. La página de Resumen muestra una insignia de reinicio con fecha para el mes. Los límites de saldo pueden enviar el exceso de presupuesto a otra categoría.

## Distribución de Ingresos y Ajustes

Los asientos de ingreso pueden aplicar un filtro de presupuesto para distribuir el depósito entre categorías. Los filtros usan pasos fijos, limitados y de división proporcional. Los ajustes manuales de presupuesto pueden luego aumentar o disminuir categorías individuales y pueden incluir un comentario opcional.

## Colocación del Presupuesto

Las cuentas de efectivo/bancarias tienen una configuración "incluir en fuente de presupuesto asignable". Solo las cuentas habilitadas cuentan como efectivo asignable y como saldos reales en la colocación del presupuesto.

La tabla de Colocación del Presupuesto aparece en Configuración -> Configuración de Presupuesto y Estados Financieros -> Presupuesto -> Verificación de Consistencia del Presupuesto.

| Visualización | Significado |
| --- | --- |
| Objetivo | Saldo presupuestario destinado al grupo de cuentas |
| Real | Saldo real de efectivo/bancario para las cuentas objetivo |
| Diferencia | Real - Objetivo |

Los objetivos siguen la misma regla que el dinero asignable: solo se suman los saldos positivos de las categorías. Los saldos negativos no reducen los objetivos y se muestran por separado como exceso de presupuesto sin financiar. En la página Presupuesto se puede alternar entre la base de hoy y la que incluye ingresos futuros; la notificación de falta de fondos abre la vista de hoy.

Si un presupuesto se vincula a múltiples cuentas, o múltiples presupuestos se vinculan a una cuenta, los presupuestos y cuentas relacionados se fusionan en un grupo. Cuando existen diferencias, las sugerencias muestran cuánto mover entre grupos de cuentas, o cuánto presupuesto agregar o reducir.

## Transferencias y Movimiento de Presupuesto

Al registrar una transferencia de cuenta en Entrada Simple, opcionalmente puedes mover el presupuesto al mismo tiempo. Elige una categoría de presupuesto de origen y destino para registrar una transferencia de presupuesto, o deja el destino vacío para consumir/desaparecer el presupuesto, como al invertir el dinero reservado.

La transferencia real y el movimiento de presupuesto son eventos separados. Los vínculos presupuesto-cuenta son orientación de colocación; no fuerzan que la asignación de ingresos y las transferencias bancarias ocurran al mismo tiempo.

## Consistencia del Presupuesto {#budget-reconciliation}

Presupuesto -> Verificación de Consistencia del Presupuesto detecta discrepancias entre los montos de los asientos contables y los montos de asignación presupuestaria guardados. Para entradas multilínea y transacciones fuera del seguimiento de presupuesto, la aplicación no adivina categorías de presupuesto a menos que se hayan guardado asignaciones explícitas.

Pasa el puntero o el foco sobre el icono «?» de un cálculo detallado para ver una explicación breve. Haz clic o tócalo en una pantalla táctil para abrir la sección correspondiente de esta guía.

Compara la misma moneda y el mismo período. «A día de hoy» e «Incluyendo ingresos futuros» usan datos distintos. El filtro por fecha de los avisos del diario de abajo no modifica el cálculo general de arriba.

### Recursos en efectivo para el presupuesto (C) {#budget-resources}

Efectivo y saldos bancarios incluidos como recursos presupuestarios, menos los pasivos que se descuentan del presupuesto. La deuda de tarjetas se descuenta de forma predeterminada. No se incluyen el efectivo excluido, los activos comprados ni las inversiones. Aunque la etiqueta dice efectivo, este importe ya resta los pasivos seleccionados.

### Saldo presupuestario neto, incluidos los negativos (N) {#budget-net-balance}

Suma de los saldos de todas las categorías, incluidos los negativos. Si P son los importes de presupuesto positivos y O el exceso sin financiar, `N = P − O`.

### Diferencia neta de conciliación (G) {#budget-net-gap}

`G = C − N`. Un resultado positivo indica que los recursos superan los saldos presupuestarios netos; uno negativo indica que los presupuestos superan los recursos. Los fondos sin asignar, las reservas y los ajustes por gastos no monetarios también pueden producir una diferencia, por lo que un valor distinto de cero no siempre indica un error de entrada.

### Reserva para gastos no seguidos (R) {#budget-reference-reserve}

Campo para el dinero separado para gastos no seguidos. Actualmente es cero; los registros de referencia no consumen el presupuesto ordinario. Las transferencias a cuentas excluidas y los importes de referencia no rellenan automáticamente este campo.

### Reserva de compra restante {#budget-purchase-reserve}

Parte de la reserva creada al comprar que aún no se ha aplicado al reconocimiento mensual del gasto. Ya afectó los saldos presupuestarios en el momento de la compra, por lo que no se descuenta otra vez de la diferencia neta. Un reinicio elimina las reservas anteriores.

### Ajuste por gastos mensuales no monetarios posteriores al reinicio (D) {#budget-non-cash-offset}

Después de que un reinicio borre una reserva de compra, el reconocimiento mensual del gasto puede reducir el presupuesto sin un nuevo pago. Este ajuste evita que esa disminución genere dinero recién asignable. Por categoría, suma la parte positiva de «saldo positivo según efectivo − saldo positivo ordinario». Puede diferir del gasto mensual total.

### Diferencia de conciliación tras reservas (A) {#budget-adjusted-gap}

`A = G − R − D`. Resta de la diferencia neta la reserva para gastos no seguidos y el ajuste por gastos no monetarios. No vuelvas a descontar la reserva de compra restante. Si R y D valen cero, A es igual a G. Una diferencia negativa restante puede señalar una reducción de recursos sin la reducción presupuestaria correspondiente; una positiva puede incluir fondos sin asignar.

### Importes de presupuesto positivos (P) {#budget-positive-claims}

Suma únicamente los saldos positivos de las categorías, sin compensarlos con categorías negativas. Representa los recursos necesarios para que se puedan usar por completo todos los presupuestos positivos.

### Importe ya reservado (S) {#budget-secured}

`S = P + R + D`. Importes positivos de presupuesto más la reserva y el ajuste por gastos no monetarios.

### Dinero recién asignable / falta de fondos presupuestarios (F) {#budget-funding-gap}

`F = C − S = A − O`. Un resultado igual o superior a cero es dinero recién asignable; uno negativo indica falta de fondos. Aunque la diferencia de conciliación sea cero, las categorías negativas generan una falta de fondos equivalente a su exceso. La disminución de efectivo por el exceso ya está reflejada en C; no restes O de F otra vez.

### Exceso de presupuesto sin financiar (O) {#budget-overspending}

Suma los valores absolutos de los saldos de categoría negativos. Cúbrelo con otro presupuesto o asignando ingresos posteriores. Mover la misma cantidad entre categorías no cambia N ni G.

### Diferencia frente al exceso o déficit de colocación {#budget-placement-gap}

El exceso o déficit de colocación es el efectivo de las cuentas menos los presupuestos positivos, las reservas y los ajustes necesarios para esas cuentas. Aún no descuenta pasivos como la deuda de tarjetas. La columna «Después de las transferencias» proyecta las transferencias propuestas para equilibrar la colocación; el total «Después de descontar deuda de tarjetas» también resta los pasivos correspondientes. Una transferencia puede cambiar la diferencia de una cuenta concreta, pero mover dinero entre cuentas presupuestarias incluidas no resuelve la diferencia global de conciliación.

Ejemplo ficticio: efectivo de `100,000`, deuda de tarjeta deducible de `10,000`, saldos de categoría de `100,000` y `−15,000`, R de `2,000` y D de `3,000`. Actualmente R es cero.

| Elemento | Cálculo |
| --- | --- |
| Recursos C | 100,000 − 10,000 = 90,000 |
| Saldo neto N | 100,000 − 15,000 = 85,000 |
| Diferencia neta G | 90,000 − 85,000 = 5,000 |
| Diferencia ajustada A | 5,000 − 2,000 − 3,000 = 0 |
| Importe reservado S | 100,000 + 2,000 + 3,000 = 105,000 |
| Falta de fondos F | 90,000 − 105,000 = −15,000 |
| Diferencia total de colocación | 100,000 − 105,000 = −5,000 |

La conciliación es cero, mientras que el exceso sin financiar es `15,000` y la falta de fondos es `−15,000`. La diferencia de colocación de `−5,000` es anterior al descuento de la deuda de tarjetas, por lo que difiere de la falta de fondos.

### Comprobar transferencias a cuentas excluidas {#budget-excluded-transfers}

Si recibes efectivo no seguido y envías la misma cantidad desde una cuenta bancaria incluida, el hogar ha intercambiado dinero, pero los recursos presupuestarios C disminuyen. Sin registrar una reducción presupuestaria igual, N no cambia y G y A disminuyen. En Entrada Simple, elige el presupuesto pagador como origen y «Desaparición» como destino para reducir el presupuesto. Una transferencia entre categorías por sí sola no reduce N.

La comprobación también detecta una reducción presupuestaria insuficiente en transferencias a cuentas excluidas aunque no haya una cuenta de gastos. En asientos compuestos con gastos y transferencias a cuentas excluidas, tiene en cuenta las reducciones presupuestarias guardadas. Si decides usar fondos sin asignar, la disminución de recursos consume ese excedente; el aviso no reduce automáticamente ningún presupuesto.
