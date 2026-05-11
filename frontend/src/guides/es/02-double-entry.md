---
id: double-entry
titleJa: 複式簿記とシンプル入力
titleEn: Double-Entry & Simple Input
titleEs: Partida Doble y Entrada Simple
---

# Partida Doble y Entrada Simple

Todos los datos del libro mayor en esta aplicación se almacenan como asientos contables de partida doble. En la contabilidad por partida doble, cada transacción registra tanto "lo que aumentó" como "lo que disminuyó". Esto permite verificar posteriormente las relaciones entre activos, pasivos, patrimonio neto, ingresos y gastos.

No necesitas pensar en débitos y créditos para el registro diario. En la entrada simple, eliges el tipo de transacción, el monto y la cuenta contraparte, y la aplicación crea el asiento contable correspondiente.

## Asientos Creados por la Entrada Simple

| Tipo de entrada | Ejemplo | Lo que hace la aplicación internamente |
| --- | --- | --- |
| Gasto | Pagar alimentos desde una cuenta bancaria | Aumenta el gasto y disminuye el activo de pago |
| Ingreso | El salario se deposita en una cuenta bancaria | Aumenta el activo y aumenta el ingreso |
| Transferencia | Mover dinero de ahorros a una cuenta de corretaje | Disminuye un activo y aumenta otro activo |
| Pedir prestado | Un amigo paga en tu nombre | Aumenta un gasto o activo, y aumenta un pasivo |
| Pagar | Devolver dinero prestado | Disminuye un pasivo y disminuye el activo de pago |
| Prestar | Prestar dinero a alguien | Aumenta un activo prestado y disminuye el efectivo/depósitos |
| Cobrar | Recibir dinero que fue prestado | Aumenta el efectivo/depósitos y disminuye el activo prestado |

## Por Qué Puedes Usarlo Sin Conocer Partida Doble

La entrada simple solicita información de la vida real. Para un gasto, eliges en qué gastaste dinero y desde dónde pagaste. Para un ingreso, eliges qué tipo de ingreso fue y dónde se depositó. La aplicación determina las direcciones de débito y crédito a partir de los tipos de cuenta.

En la página del Libro Mayor, los mismos asientos contables se pueden ver tanto en formato simple como de partida doble. Si no estás acostumbrado a la contabilidad, es suficiente revisar la vista simple y solo abrir la vista de partida doble cuando los saldos parezcan incorrectos o necesites manejar una transacción especial.

## Cuándo Usar Entradas Multilínea

Usa entradas multilínea cuando una transacción involucre tres o más cuentas. Ejemplos incluyen depósitos con tarifas deducidas, transacciones que combinan adelantos de negocios y gastos personales, o ventas donde quieras registrar explícitamente una ganancia o pérdida.

Para entradas multilínea, el total de débitos y el total de créditos deben coincidir. Las transacciones desbalanceadas no se pueden guardar. Esta es la regla central que mantiene el libro mayor consistente.

## Reglas de Débito y Crédito

En la contabilidad por partida doble, cada tipo de cuenta aumenta en un lado y disminuye en el otro.

| Tipo de cuenta | Aumenta en | Disminuye en |
| --- | --- | --- |
| Activo | Débito | Crédito |
| Pasivo | Crédito | Débito |
| Patrimonio (neto) | Crédito | Débito |
| Ingreso | Crédito | Débito |
| Gasto | Débito | Crédito |

Una vez que conoces esta tabla, puedes determinar las direcciones del asiento por tu cuenta. Por ejemplo, "pagó alimentos desde una cuenta bancaria" significa que la cuenta bancaria es un activo, por lo que va en el lado del crédito. El gasto de alimentos aumenta, por lo que va en el lado del débito. Juntas, esas dos líneas forman un asiento contable completo.

## Cómo Leer los Asientos Contables

En la página del Libro Mayor, la vista de partida doble muestra cada línea como un detalle de débito o crédito.

| Lado | Significado |
| --- | --- |
| Débito (izquierda) | La cuenta aumentó (activo, gasto) o disminuyó (pasivo, patrimonio, ingreso) |
| Crédito (derecha) | La cuenta aumentó (pasivo, patrimonio, ingreso) o disminuyó (activo, gasto) |

En un asiento contable, el total de débitos debe ser siempre igual al total de créditos. Los asientos donde no coinciden no se pueden guardar.

## Tipos de Cuenta y Sus Roles

| Tipo | Ejemplos | Descripción |
| --- | --- | --- |
| Activo | Cuenta bancaria, efectivo, préstamos, cripto | Cosas que posees |
| Pasivo | Tarjeta de crédito, préstamo, deudas | Montos que debes a otros |
| Patrimonio | Saldo inicial | Patrimonio neto (activos menos pasivos) |
| Ingreso | Salario, intereses ganados, ganancias por ventas | Razones por las que el dinero aumenta |
| Gasto | Alimentos, servicios públicos, depreciación | Razones por las que el dinero disminuye |

El patrimonio se calcula como activos menos pasivos, por lo que rara vez se ingresa directamente. La entrada de saldo inicial es su uso principal.

## Notas al Editar

Puedes editar asientos contables desde la página del Libro Mayor. Los asientos creados mediante entrada simple se pueden convertir de vuelta al formato de entrada original cuando sea posible. Los asientos de depreciación mensual y los asientos que incluyen cuentas especiales del sistema pueden romper cálculos relacionados si se editan directamente. En esos casos, es más seguro editar la entrada fuente o la configuración.

Cuando los saldos no coincidan, verifica la diferencia contra los saldos reales en la página de Balance de Comprobación antes de eliminar asientos basándote en suposiciones. Corregir asientos después de identificar la causa facilita entender el impacto en los presupuestos y reportes.
