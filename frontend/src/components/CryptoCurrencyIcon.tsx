import { memo, type CSSProperties } from "react";
import type { IconType } from "react-icons";
import {
  SiEthereum,
  SiSolana,
  SiTether,
  SiCircle,
  SiXrp,
  SiCardano,
  SiDogecoin,
  SiPolkadot,
  SiChainlink,
  SiLitecoin,
  SiBnbchain,
} from "react-icons/si";
import { FaAtom, FaBtc } from "react-icons/fa6";
import {
  getCryptoCurrencyIconMeta,
  type CryptoIconKey,
  type CryptoIconStyle,
} from "../lib/cryptoCurrencyIcons";

const ICONS: Record<CryptoIconKey, IconType> = {
  btc: FaBtc,
  eth: SiEthereum,
  sol: SiSolana,
  bnb: SiBnbchain,
  usdt: SiTether,
  usdc: SiCircle,
  xrp: SiXrp,
  ada: SiCardano,
  doge: SiDogecoin,
  dot: SiPolkadot,
  link: SiChainlink,
  ltc: SiLitecoin,
  atom: FaAtom,
};

interface CryptoCurrencyIconProps {
  code: string;
  styleMode: CryptoIconStyle;
  size?: number;
  symbol?: string;
}

function CryptoCurrencyIconComponent({
  code,
  styleMode,
  size = 22,
  symbol,
}: CryptoCurrencyIconProps) {
  const meta = getCryptoCurrencyIconMeta(code);
  const displaySymbol = symbol ?? meta.symbol;
  const Icon = meta.iconKey ? ICONS[meta.iconKey] : null;
  const baseStyle: CSSProperties = {
    alignItems: "center",
    display: "inline-flex",
    flexShrink: 0,
    height: size,
    justifyContent: "center",
    lineHeight: 1,
    width: size,
  };

  if (styleMode === "symbol") {
    return (
      <span
        aria-hidden="true"
        title={meta.label}
        style={{
          ...baseStyle,
          background: "#111827",
          border: "1px solid rgba(255, 255, 255, 0.22)",
          borderRadius: 999,
          boxShadow: "inset 0 0 0 1px rgba(0, 0, 0, 0.18)",
          color: "#fff",
          fontSize: Math.max(11, Math.round(size * 0.62)),
          fontWeight: 800,
        }}
      >
        {displaySymbol}
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      title={meta.label}
      style={{
        ...baseStyle,
        background: meta.colors[0],
        border: "1px solid rgba(15, 23, 42, 0.12)",
        borderRadius: 999,
        color: "#fff",
        fontSize: Math.max(11, Math.round(size * 0.58)),
        fontWeight: 900,
      }}
    >
      {Icon ? (
        <Icon size={Math.max(12, Math.round(size * 0.64))} />
      ) : (
        displaySymbol
      )}
    </span>
  );
}

export const CryptoCurrencyIcon = memo(CryptoCurrencyIconComponent);
