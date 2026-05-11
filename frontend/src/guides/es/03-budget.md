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

Los presupuestos regulares se reintegran en su totalidad, ya sean positivos o negativos. Un presupuesto negativo es un excedente, por lo que reduce el dinero asignable en lugar de aumentarlo.

Si las importaciones históricas o correcciones hacen que un saldo sea poco realista, usa Entrada -> Ajuste de Presupuesto -> Reinicio de Presupuesto para llevar esa categoría a cero. La página de Resumen muestra una insignia de reinicio con fecha para el mes. Los límites de saldo pueden enviar el exceso de presupuesto a otra categoría.

## Distribución de Ingresos y Ajustes

Los asientos de ingreso pueden aplicar un filtro de presupuesto para distribuir el depósito entre categorías. Los filtros usan pasos fijos, limitados y de división proporcional. Los ajustes manuales de presupuesto pueden luego aumentar o disminuir categorías individuales y pueden incluir un comentario opcional.

## Colocación del Presupuesto

Las cuentas de efectivo/bancarias tienen una configuración "incluir en fuente de presupuesto asignable". Solo las cuentas habilitadas cuentan como efectivo asignable y como saldos reales en la colocación del presupuesto.

La tabla de Colocación del Presupuesto aparece en Configuración -> Configuración de Presupuesto y Estados Financieros -> Balance de Comprobación -> Verificación de Consistencia del Presupuesto.

| Visualización | Significado |
| --- | --- |
| Objetivo | Saldo presupuestario destinado al grupo de cuentas |
| Real | Saldo real de efectivo/bancario para las cuentas objetivo |
| Diferencia | Real - Objetivo |

Si un presupuesto se vincula a múltiples cuentas, o múltiples presupuestos se vinculan a una cuenta, los presupuestos y cuentas relacionados se fusionan en un grupo. Cuando existen diferencias, las sugerencias muestran cuánto mover entre grupos de cuentas, o cuánto presupuesto agregar o reducir.

## Transferencias y Movimiento de Presupuesto

Al registrar una transferencia de cuenta en Entrada Simple, opcionalmente puedes mover el presupuesto al mismo tiempo. Elige una categoría de presupuesto de origen y destino para registrar una transferencia de presupuesto, o deja el destino vacío para consumir/desaparecer el presupuesto, como al invertir el dinero reservado.

La transferencia real y el movimiento de presupuesto son eventos separados. Los vínculos presupuesto-cuenta son orientación de colocación; no fuerzan que la asignación de ingresos y las transferencias bancarias ocurran al mismo tiempo.

## Consistencia del Presupuesto

Balance de Comprobación -> Verificación de Consistencia del Presupuesto detecta discrepancias entre los montos de los asientos contables y los montos de asignación presupuestaria guardados. Para entradas multilínea y transacciones fuera del seguimiento de presupuesto, la aplicación no adivina categorías de presupuesto a menos que se hayan guardado asignaciones explícitas.
