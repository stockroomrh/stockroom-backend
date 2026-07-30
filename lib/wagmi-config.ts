// `injected` is imported from wagmi's own top-level export (backed by the
// lightweight @wagmi/core connector). `walletConnect` is imported from
// `@wagmi/connectors`'s own subpath export, NOT the package's default `.`
// barrel — that barrel re-exports every connector, including several whose
// optional peer packages (porto, safe, tempo) aren't installed and aren't
// needed here, which breaks the dev bundler.
import { createConfig, http, injected } from "wagmi";
import { walletConnect } from "@wagmi/connectors/walletConnect";
import { robinhoodMainnet, robinhoodTestnet } from "./chain-config";

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

export const wagmiConfig = createConfig({
  chains: [robinhoodTestnet, robinhoodMainnet],
  connectors: [
    injected(),
    // Only registered when a project ID is configured — without one,
    // WalletConnect throws at connect time, so we hide the option instead.
    ...(walletConnectProjectId
      ? [walletConnect({ projectId: walletConnectProjectId, showQrModal: true })]
      : []),
  ],
  transports: {
    [robinhoodTestnet.id]: http(),
    [robinhoodMainnet.id]: http(),
  },
  ssr: true,
});

export const isWalletConnectEnabled = Boolean(walletConnectProjectId);
