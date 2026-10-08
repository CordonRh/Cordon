import Image from "@/components/compat/image";

const SIZE = {
  /** Brand panel mark 3888:7076 — 28, radius 8. */
  md: {
    box: "size-7 rounded-footer-mark",
    glyph: "size-7",
    src: "/brand/cordon-symbol.png",
    px: 28,
  },
  /** Relay Labs mark 3888:7105 — 26, radius 8. */
  sm: {
    box: "size-6.5 rounded-footer-mark",
    glyph: "size-6.5",
    src: "/brand/cordon-symbol.png",
    px: 26,
  },
} as const;

/** Lime logo tile: gradient fill + hairline, chevron glyph from the export. */
export const LogoMark = ({
  size,
  className = "",
}: {
  size: keyof typeof SIZE;
  className?: string;
}) => {
  const s = SIZE[size];
  return (
    <span
      aria-hidden
      className={`relative block shrink-0 overflow-clip border border-footer-mark-border bg-linear-[135deg_in_srgb] bg-origin-border from-footer-mark-from to-footer-mark-to to-[71.429%] ${s.box} ${className}`}
    >
      <Image
        src={s.src}
        alt=""
        width={s.px}
        height={s.px}
        className={`absolute -top-px -left-px max-w-none ${s.glyph}`}
      />
    </span>
  );
};
