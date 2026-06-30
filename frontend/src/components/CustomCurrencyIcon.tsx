import { memo, type CSSProperties } from "react";
import type { IconType } from "react-icons";
import {
  FaArrowsRotate,
  FaAsterisk,
  FaAt,
  FaBolt,
  FaCheck,
  FaCircle,
  FaCircleDot,
  FaCircleHalfStroke,
  FaCircleNotch,
  FaCrosshairs,
  FaCrown,
  FaDiamond,
  FaDroplet,
  FaGear,
  FaGem,
  FaGlobe,
  FaHashtag,
  FaHeart,
  FaInfinity,
  FaKey,
  FaMoon,
  FaRing,
  FaShield,
  FaSnowflake,
  FaSquare,
  FaStar,
  FaStarHalfStroke,
  FaSun,
  FaXmark,
} from "react-icons/fa6";
import {
  DEFAULT_CUSTOM_CURRENCY_ICON,
  type CustomCurrencyIconKey,
} from "../lib/customCurrencySymbols";
import {
  getReadableTextColor,
  normalizeCurrencyBackgroundColor,
} from "../lib/currencyIconDisplay";

const ICONS: Record<CustomCurrencyIconKey, IconType> = {
  circle: FaCircle,
  circleDot: FaCircleDot,
  square: FaSquare,
  diamond: FaDiamond,
  star: FaStar,
  heart: FaHeart,
  bolt: FaBolt,
  shield: FaShield,
  xmark: FaXmark,
  check: FaCheck,
  asterisk: FaAsterisk,
  at: FaAt,
  hashtag: FaHashtag,
  infinity: FaInfinity,
  crosshairs: FaCrosshairs,
  circleHalf: FaCircleHalfStroke,
  circleNotch: FaCircleNotch,
  ring: FaRing,
  starHalf: FaStarHalfStroke,
  sun: FaSun,
  moon: FaMoon,
  droplet: FaDroplet,
  snowflake: FaSnowflake,
  gear: FaGear,
  key: FaKey,
  gem: FaGem,
  globe: FaGlobe,
  crown: FaCrown,
  arrowsRotate: FaArrowsRotate,
};

interface CustomCurrencyIconProps {
  icon: string | null | undefined;
  backgroundColor?: string | null;
  size?: number;
}

function CustomCurrencyIconComponent({
  backgroundColor,
  icon,
  size = 22,
}: CustomCurrencyIconProps) {
  const key = (icon || DEFAULT_CUSTOM_CURRENCY_ICON) as CustomCurrencyIconKey;
  const Icon = ICONS[key] ?? ICONS[DEFAULT_CUSTOM_CURRENCY_ICON];
  const normalizedBackground = normalizeCurrencyBackgroundColor(backgroundColor);
  const style: CSSProperties = {
    alignItems: "center",
    background: normalizedBackground ?? "#111827",
    border: "1px solid rgba(255, 255, 255, 0.22)",
    borderRadius: 999,
    color: normalizedBackground
      ? getReadableTextColor(normalizedBackground)
      : "#fff",
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
