"use client";

import { useState } from "react";
import { useAuth } from "./AuthProvider";

export function WalletButton() {
  const { session, walletAddress, connecting, error, walletOptions, signInWithWallet, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  if (session && walletAddress) {
    return (
      <button className="wallet-button" type="button" onClick={() => void signOut()} title={walletAddress}>
        {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}
      </button>
    );
  }

  return (
    <div className="wallet-connect">
      <button className="wallet-button" type="button" disabled={connecting} onClick={() => setMenuOpen((open) => !open)}>
        {connecting ? "Connecting…" : "Connect Wallet"}
      </button>
      {menuOpen && (
        <div className="wallet-menu" role="menu">
          {walletOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                void signInWithWallet(option.id);
              }}
            >
              {option.name}
            </button>
          ))}
        </div>
      )}
      {error && <span className="wallet-error" role="alert">{error}</span>}
    </div>
  );
}
