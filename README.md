# Verity

Verity is a private bounty marketplace on Starknet. Creators post bounties for investigations and fund them privately; anonymous investigators stake, submit findings, and winners get paid — with funding, staking, and payouts routed through STRK20 private transactions instead of public transfers.

## How it works

1. Creator creates a bounty.
2. Creator privately funds it.
3. Investigators privately stake to participate.
4. Eligible investigators submit investigations privately.
5. Creator reviews submissions and selects a winner.
6. Winner privately claims the reward.

## Technology

* Starknet (Sepolia testnet) + Cairo contracts
* Next.js web app
* STRK20 privacy pool via the Ready X wallet

## Local development

```bash
pnpm install
pnpm dev:web        # run the web app
pnpm build:web      # production build
pnpm test:web       # frontend unit tests
```

Contracts need the Cairo toolchain inside WSL Ubuntu-24.04 (see `scripts/setup-wsl-toolchain.sh`):

```bash
wsl -d Ubuntu-24.04 -- bash -lc 'cd /mnt/c/Users/User/Documents/Verity && scarb build && snforge test'
```

Copy `apps/web/.env.example` to `apps/web/.env.local` to override the default RPC URL or contract addresses.

## Production

* Network: Starknet Sepolia
* BountyManager: `0x04315e84d96b7d0e4daf4d0ee0382d3951a4963a85d6b7572520cb4155135807`
* VerityAnonymizer: `0x03602dc4f3a8bd209d47fca442c87f22151536e6ed7387b7025e92c4ebcf9682`
* STRK20 pool: `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91`
* STRK token: `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d`

Mainnet deployment is not live yet.

## License

MIT — see [LICENSE](./LICENSE).
