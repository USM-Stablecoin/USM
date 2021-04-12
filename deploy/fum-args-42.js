// Used for contract verification on Etherscan
const addresses = {
    'USMv0.1': '0x21453979384f21D09534f8801467BDd5d90eCD6C',
    'FUMv0.1': '0x96F8F5323Aa6CB0e6F311bdE6DEEFb1c81Cb1898',
    'USMv0.2-rc1': '0xf05627D4F72bC4778BAECcbeaCa44b013e9b8227',
    'FUMv0.2-rc1': '0xe13b57555e5a538785130fda6e918185b9fe1599',
    'USMv0.2': '0x6dcc375aE1f43c8FA4e13D56E6ec584BeE25A88F',
    'FUMv0.2': '0xf99b440d8e18f850187ae53cdd4ebc959ebf36df',
    'USMv0.3': '0x19b490DAA2B58d9B12BFb15Cd3eFC2358ad2Bd67',
    'FUMv0.3': '0x0f682f36363b4cd5261dd613f4caec6e6c8a5eef',
    'USMv0.4': '0x7dbC406E09c876C77949A45BBE4173Aa6CdF9470',
    'FUMv0.4': '0x6ee47863a96a488a53053dea290ccf7f8979d6a9',
}
  
module.exports = [
    [
        addresses['USMv0.1'],
        addresses['FUMv0.1'],
        addresses['USMv0.2-rc1'],
        addresses['FUMv0.2-rc1'],
        addresses['USMv0.2'],
        addresses['FUMv0.2'],
        addresses['USMv0.3'],
        addresses['FUMv0.3'],
        addresses['USMv0.4'],
        addresses['FUMv0.4'],
    ],
];