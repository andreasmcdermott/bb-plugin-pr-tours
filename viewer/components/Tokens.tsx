import type { CSSProperties } from "react";
import type { Token } from "../highlight.ts";

const ITALIC = 1;
const BOLD = 2;
const UNDERLINE = 4;

function tokenStyle({ color, darkColor, fontStyle = 0 }: Token): CSSProperties | undefined {
  if (!color && fontStyle <= 0) return undefined;
  return {
    color: color && darkColor ? `light-dark(${color}, ${darkColor})` : color,
    fontStyle: fontStyle & ITALIC ? "italic" : undefined,
    fontWeight: fontStyle & BOLD ? "bold" : undefined,
    textDecoration: fontStyle & UNDERLINE ? "underline" : undefined,
  };
}

export function Tokens({ tokens }: { tokens: Token[] }) {
  return tokens.map((token, index) => (
    <span key={index} style={tokenStyle(token)}>
      {token.content}
    </span>
  ));
}
