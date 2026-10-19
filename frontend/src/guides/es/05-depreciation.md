---
id: depreciation
titleJa: 予算分割振替
titleEn: Budget installment transfers
titleEs: Transferencias presupuestarias en cuotas
---

# Transferencias presupuestarias en cuotas

Esta función distribuye el coste de una compra en gastos mensuales y gestiona su impacto presupuestario a lo largo del tiempo. Al comprar, el importe se registra primero en la «Cuenta de activo de compra» seleccionada y luego se transfiere a la «Cuenta de gasto» durante el período configurado. El saldo restante de la cuenta de activo de compra representa el importe del plan aún no contabilizado como gasto; no representa el valor de mercado de la compra ni su valor fiscal.

Por ejemplo, el coste de un ordenador de 120.000 yenes repartido en 12 meses se transfiere de la cuenta de activo de compra a la cuenta de gasto a razón de unos 10.000 yenes al mes. Si se activa la reposición presupuestaria mensual, también se transfieren fondos cada mes desde las categorías presupuestarias habituales al presupuesto de compra.

## Métodos presupuestarios

| Método | Tratamiento del presupuesto en la compra y cada mes |
| --- | --- |
| Presupuesto asignado | El presupuesto de compra seleccionado disminuye al comprar. Cada mes se repone con transferencias desde las fuentes presupuestarias configuradas por porcentaje. |
| Presupuesto especial | Un presupuesto especial dedicado empieza con saldo negativo. Cada mes se repone con transferencias desde las fuentes presupuestarias configuradas. |
| Sin asignar | La parte de la compra que cuenta para el presupuesto se cubre con fondos sin asignar al comprar. Los asientos de gasto mensuales continúan, pero no hay reposiciones presupuestarias mensuales. |

## Registro y porcentajes presupuestarios

En la página de Entrada, activa «Transferencias presupuestarias en cuotas», selecciona la «Cuenta de activo de compra» y la «Cuenta de gasto», y define el período con «Meses de transferencia» o «Importe de transferencia mensual». Para los métodos con reposición presupuestaria mensual, el editor de «Porcentajes presupuestarios» toma inicialmente los porcentajes de la cuenta de gasto. Cada plan guardado conserva una instantánea de sus porcentajes, por lo que los cambios posteriores en la cuenta de gasto no alteran los planes existentes.

Edita directamente el porcentaje de cada categoría presupuestaria o ajústalo introduciendo un importe para el mes representativo que muestra el editor. Al introducir un importe se establece su porcentaje según esa transferencia representativa; las transferencias reales pueden variar cada mes, por ejemplo, si el primer mes se prorratea. «Restaurar los valores predeterminados de la cuenta de gasto» vuelve a cargar los porcentajes presupuestarios actuales de esa cuenta.

Si el total de las categorías con nombre es inferior al 100 %, el resto se considera una transferencia desde los fondos sin asignar, y para guardar se requiere una confirmación explícita. No se pueden guardar porcentajes superiores al 100 %. Las transferencias desde fondos sin asignar reducen esos fondos mientras reponen el presupuesto de compra.

Los restos se distribuyen en la unidad mínima de la moneda mediante el método de mayores restos. Los empates se resuelven por ID de categoría presupuestaria ascendente y los fondos sin asignar se procesan al final. Cada mes, el total de las fuentes presupuestarias coincide con el importe repuesto al presupuesto de compra.

## Edición y eliminación

Editar la compra o la configuración del plan puede afectar a los asientos de gasto mensuales y a las reposiciones presupuestarias. Haz los cambios desde la entrada de compra original o la configuración del plan; no edites directamente los asientos mensuales ni los registros presupuestarios generados. Elimina el plan relacionado cuando ya no sea necesario.

## Diferencia con la depreciación

Esta función distribuye el coste de una compra en gastos mensuales para la gestión doméstica y administra el impacto mensual en el presupuesto mediante transferencias entre categorías presupuestarias. El saldo restante en la cuenta de activo de compra representa el importe del plan aún no contabilizado como gasto. La función no determina el valor de mercado del activo, su vida útil, el método de depreciación, el porcentaje de uso empresarial ni el tratamiento fiscal. Gestiona por separado cualquier tratamiento contable o fiscal formal según las normas aplicables.