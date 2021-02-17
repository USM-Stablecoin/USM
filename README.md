# USM - Minimalist USD Stablecoin

Originally proposed by [@jacob-eliosoff](https://github.com/jacob-eliosoff) in [this Medium article](https://medium.com/@jacob.eliosoff/whats-the-simplest-possible-decentralized-stablecoin-4a25262cf5e8), USM is an attempt to answer the question "What is the simplest possible decentralised stablecoin?"

## Networks & Addresses

### USM v0.3 (Kovan testnet)

 - Oracle: [0x8e91D25324833D62Fb3eC67aDEE26048696c8909](https://kovan.etherscan.io/address/0x8e91D25324833D62Fb3eC67aDEE26048696c8909)
 - USM: [0x19b490DAA2B58d9B12BFb15Cd3eFC2358ad2Bd67](https://kovan.etherscan.io/address/0x19b490DAA2B58d9B12BFb15Cd3eFC2358ad2Bd67)
 - FUM: [0x0f682f36363b4cd5261dd613f4caec6e6c8a5eef](https://kovan.etherscan.io/address/0x0f682f36363b4cd5261dd613f4caec6e6c8a5eef)
 - USMView: [0xfd1B7a306D0a28d886f15Fb0D2F4d8A720E10B4c](https://kovan.etherscan.io/address/0xfd1B7a306D0a28d886f15Fb0D2F4d8A720E10B4c)
 - Proxy: [0xa026638f21E6f1deD6dE7A6bd1DB8b4376A49b68](https://kovan.etherscan.io/address/0xa026638f21E6f1deD6dE7A6bd1DB8b4376A49b68)

### USM v0.1 ("Baby USM") - Mainnet

[Live Stats](https://usmfum.github.io/USM-Stats/)

Baby USM is a "beta" version of USM. Baby USM expires on the 15th of January 2021 when it becomes withdraw-and-read-only. At this point, FUM and USM will be redeemable for ETH, but no more minting of either can occur.

Baby USM and Baby FUM is not redeemable for USM or FUM. It is for test and reserach purposes only.

USM: [0x03eb7Ce2907e202bB70BAE3D7B0C588573d3cECC](https://etherscan.io/address/0x03eb7Ce2907e202bB70BAE3D7B0C588573d3cECC)

FUM: [0xf04a5D82ff8a801f7d45e9C14CDcf73defF1a394](https://etherscan.io/address/0xf04a5D82ff8a801f7d45e9C14CDcf73defF1a394)

## How It Works

USM is pegged to United States dollar, and maintains its stable value by minting USM in exchange for ETH, using the price of ETH at the time of minting.

If ETH is worth $200, I deposit 1 ETH, I get 200 USM in return (minus a small minting fee). The same goes for burning, but in the opposite direction.

This is what's known as a **CDP: Collateralised Debt Position.**

The problem with CDPs is that if the asset used as collateral drops in value, which in our case is highly probable at any time due to the volatility of ETH, the contract could become undercollateralised. This is where the concept of Minimalist Funding Tokens, or FUM, come in.

For more information on how FUM de-risks USM, read [Jacob's original article](https://medium.com/@jacob.eliosoff/whats-the-simplest-possible-decentralized-stablecoin-4a25262cf5e8).

**UPDATE:** Read part two on [protecting against price exploits](https://medium.com/@jacob.eliosoff/usm-minimalist-stablecoin-part-2-protecting-against-price-exploits-a16f55408216).
