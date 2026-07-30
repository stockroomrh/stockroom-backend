import Image from "next/image";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand-lockup">
      <Image src="/stockroom-logo.png" width={40} height={46} alt="Stockroom logo" priority />
      {!compact && <span>STOCKROOM</span>}
    </div>
  );
}
