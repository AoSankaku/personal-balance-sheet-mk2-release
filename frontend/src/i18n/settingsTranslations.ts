import type { Locale, TranslationKey } from "./translations";

type ExtraLocale = Exclude<Locale, "en" | "ja">;

export const settingsTranslations: Record<
  ExtraLocale,
  Partial<Record<TranslationKey, string>>
> = {
  fr: {
    defaultPaymentSource: "Source de paiement par défaut",
    defaultPaymentSourceHint:
      "Préremplit le champ « Payé depuis » lors de la saisie des dépenses.",
    preferredPaymentMethod: "Moyen de paiement préféré",
    preferredPaymentMethodHint:
      "Ce compte est présélectionné et affiché en premier dans « Payé depuis ».",
    preferredPaymentMethodNone: "Aucune préférence",
  },
  es: {
    defaultPaymentSource: "Origen de pago predeterminado",
    defaultPaymentSourceHint:
      "Rellena automáticamente el campo « Pagado desde » al introducir gastos.",
    preferredPaymentMethod: "Método de pago preferido",
    preferredPaymentMethodHint:
      "Esta cuenta se preselecciona y aparece primero en « Pagado desde ».",
    preferredPaymentMethodNone: "Sin preferencia",
  },
  "zh-CN": {
    defaultPaymentSource: "默认付款来源",
    defaultPaymentSourceHint: "输入支出时预填“付款来源”字段。",
    preferredPaymentMethod: "首选付款方式",
    preferredPaymentMethodHint: "此账户会预先选中，并在“付款来源”中优先显示。",
    preferredPaymentMethodNone: "无偏好",
  },
  "zh-TW": {
    defaultPaymentSource: "預設付款來源",
    defaultPaymentSourceHint: "輸入支出時預填「付款來源」欄位。",
    preferredPaymentMethod: "偏好的付款方式",
    preferredPaymentMethodHint: "此帳戶會預先選取，並在「付款來源」中優先顯示。",
    preferredPaymentMethodNone: "無偏好",
  },
};

