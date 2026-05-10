import { memo, type CSSProperties } from "react";
import type { IconType } from "react-icons";
import {
  FaAsterisk,
  FaAt,
  FaBolt,
  FaCheck,
  FaCircle,
  FaCircleDot,
  FaDiamond,
  FaEquals,
  FaHashtag,
  FaHeart,
  FaInfinity,
  FaMinus,
  FaPercent,
  FaPlus,
  FaShield,
  FaSlash,
  FaStar,
  FaSquare,
  FaWaveSquare,
  FaXmark,
} from "react-icons/fa6";
import {
  DEFAULT_CUSTOM_CURRENCY_ICON,
  type CustomCurrencyIconKey,
} from "../lib/customCurrencySymbols";

const ICONS: Record<CustomCurrencyIconKey, IconType> = {
  circle: FaCircle,
  circleDot: FaCircleDot,
  square: FaSquare,
  diamond: FaDiamond,
  star: FaStar,
  heart: FaHeart,
  bolt: FaBolt,
  shield: FaShield,
  plus: FaPlus,
  minus: FaMinus,
  xmark: FaXmark,
  check: FaCheck,
  asterisk: FaAsterisk,
  at: FaAt,
  hashtag: FaHashtag,
  percent: FaPercent,
  infinity: FaInfinity,
  equals: FaEquals,
  slash: FaSlash,
  wave: FaWaveSquare,
};

interface CustomCurrencyIconProps {
  icon: string | null | undefined;
  size?: number;
}

function CustomCurrencyIconComponent({
  icon,
  size = 22,
}: CustomCurrencyIconProps) {
  const key = (icon || DEFAULT_CUSTOM_CURRENCY_ICON) as CustomCurrencyIconKey;
  const Icon = ICONS[key] ?? ICONS[DEFAULT_CUSTOM_CURRENCY_ICON];
  const style: CSSProperties = {
    alignItems: "center",
    background: "#111827",
    border: "1px solid rgba(255, 255, 255, 0.22)",
    borderRadius: 999,
    color: "#fff",
    display: "inline-flex",
    flexShrink: 0,
    height: size,
    justifyContent: "center",
    lineHeight: 1,
    width: size,
  };

  return (
    <span aria-hidden="true" style={style}>
      <Icon size={Math.max(12, Math.round(size * 0.58))} />
    </span>
  );
}

export const CustomCurrencyIcon = memo(CustomCurrencyIconComponent);
